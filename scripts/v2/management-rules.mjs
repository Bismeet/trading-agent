// scripts/v2/management-rules.mjs — Phase 8 §6, §7, §8, §9, §12, §13, §14, §19.
//
// Adaptive post-entry trade management simulator.
// Simulates bar-by-bar progression, excursion tracking, dynamic stop moves,
// adaptive holding, partial position management, and fee/slippage accounting.
//
// Strictly CAUSAL: decisions at bar j depend only on bars <= j.
import { sideSign, fillPrice, slippageFraction, tradeFee, emaUpdate, isLiquidated, markPosition } from "./perp.mjs";
import { classifyTradeState, calcMfeCaptureRatio } from "./management-features.mjs";

export function simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId = "MGMT_CONTROL", portfolioSizing = false }) {
  const market = cand.market || "crypto";
  const baseMargin = 100;
  let margin = baseMargin;

  // Setup-quality sizing adjustment (§18)
  if (portfolioSizing) {
    const agree = cand.features?.strategy_agreement_count ?? 0;
    if (agree >= 2) margin = spec?.portfolioControls?.qualitySizing?.confirmedMarginUsd ?? 125;
    else if (agree === 1) margin = 100;
    else margin = spec?.portfolioControls?.qualitySizing?.soloMarginUsd ?? 75;
  }

  const leverage = cand.baseLev || 10;
  const tiers = cfg.v2.maintenanceTiers?.[market];
  const halfSpread = (cfg.slippage[market] ?? 0.0005) / 2;
  const notional = margin * leverage;
  const entrySlip = slippageFraction(notional, cfg.slippage[market] ?? 0.02);
  const entryRef = cand.price;
  const entry = fillPrice(entryRef, cand.side, halfSpread, entrySlip);

  const pos = {
    symbol: cand.symbol,
    market,
    side: cand.side,
    entryPrice: entry,
    mark: entry,
    margin,
    leverage,
    qty: (margin * leverage) / entry,
    liqPrice: null,
  };
  // Calculate liquidation price
  const mmr = tiers?.[0]?.mmr ?? 0.004;
  const sgn = sideSign(cand.side);
  pos.liqPrice = cand.side === "long"
    ? entry * (1 - (1 / leverage) + mmr)
    : entry * (1 + (1 / leverage) - mmr);

  const takerFeeRate = cfg.v2.perpFees.taker;
  const entryFee = tradeFee(pos.qty * entry, takerFeeRate);
  let totalFees = entryFee;
  let totalSpreadSlip = Math.abs(entry - entryRef) * pos.qty;

  // Strategy stop and target percentages
  const stratGeom = prod.perStrategyGeometry?.[cand.strategy_id] || { stopPct: 0.05, targetPct: 0.10 };
  let currentStopPct = stratGeom.stopPct;
  const targetPct = stratGeom.targetPct;
  const stopDistUsd = pos.qty * entry * currentStopPct;

  // Policy parameters
  let maxHoldHours = 4;
  let breakevenStopActive = false;
  let allowAdaptiveHold = false;
  let cutDeterioratingActive = false;
  let partialExitActive = false;
  let trailingConfig = { enabled: true, activateRoi: 0.50, giveRoi: 0.25 };

  switch (policyId) {
    case "MGMT_CONTROL":
      maxHoldHours = 4;
      break;
    case "MGMT_EXTENDED_HOLD_12H":
      maxHoldHours = 12;
      break;
    case "MGMT_BREAKEVEN_STOP":
      maxHoldHours = 4;
      breakevenStopActive = true;
      break;
    case "MGMT_CUT_DETERIORATING":
      maxHoldHours = 4;
      cutDeterioratingActive = true;
      break;
    case "MGMT_ADAPTIVE_HOLD":
      maxHoldHours = 4;
      allowAdaptiveHold = true;
      cutDeterioratingActive = true;
      break;
    case "MGMT_PARTIAL_EXIT":
      maxHoldHours = 12;
      partialExitActive = true;
      breakevenStopActive = true;
      break;
    case "MGMT_TIGHT_TRAIL":
      maxHoldHours = 4;
      trailingConfig = { enabled: true, activateRoi: 0.30, giveRoi: 0.15 };
      break;
    case "MGMT_ADAPTIVE_COMPOSITE":
      maxHoldHours = 4;
      allowAdaptiveHold = true;
      cutDeterioratingActive = true;
      breakevenStopActive = true;
      trailingConfig = { enabled: true, activateRoi: 0.30, giveRoi: 0.15 };
      break;
    default:
      maxHoldHours = 4;
  }

  // Simulation state
  const n = rows.ts.length;
  let favMax = entry;
  let advMin = entry;
  let peakUPnl = 0;
  let peakMfeR = 0;
  let worstMaeR = 0;
  let lastMfePeakTs = cand.ts;
  let exitReason = null;
  let exitRef = null;
  let exitTs = null;
  let exitJ = null;
  let holdHours = 0;

  // Partial position tracking (§14)
  let partialClosed = false;
  let partialRealizedGross = 0;
  let activeQty = pos.qty;

  for (let j = cand.i + 1; j < n; j++) {
    const ts = rows.ts[j];
    const relMs = ts - cand.ts;
    const relH = relMs / 3600000;
    const o = rows.open[j];
    const h = rows.high[j];
    const l = rows.low[j];
    const c = rows.close[j];

    const worst = cand.side === "long" ? l : h;
    const best = cand.side === "long" ? h : l;

    pos.mark = emaUpdate(pos.mark, c, cfg.v2.markEmaAlpha ?? 0.25);
    const uPnl = (pos.mark - entry) * activeQty * sgn;

    favMax = Math.max(favMax, best);
    advMin = Math.min(advMin, worst);

    // Current excursions
    const curMfeR = stopDistUsd > 0 ? (sgn * (favMax - entry)) / (entry * currentStopPct) : 0;
    const curMaeR = stopDistUsd > 0 ? (sgn * (advMin - entry)) / (entry * currentStopPct) : 0;
    if (curMfeR > peakMfeR) {
      peakMfeR = curMfeR;
      lastMfePeakTs = ts;
    }
    worstMaeR = Math.min(worstMaeR, curMaeR);
    peakUPnl = Math.max(peakUPnl, uPnl);

    const stalledHours = (ts - lastMfePeakTs) / 3600000;
    const state = classifyTradeState({
      relHours: relH,
      mfeR: peakMfeR,
      maeR: worstMaeR,
      curR: stopDistUsd > 0 ? uPnl / stopDistUsd : 0,
      peakR: peakMfeR,
      stalledHours,
      trendPersists: true,
      opposingSignal: false,
    });

    // 1. Partial Exit Logic (+1.0 R threshold)
    if (partialExitActive && !partialClosed && peakMfeR >= 1.0) {
      partialClosed = true;
      const trancheQty = activeQty * 0.5;
      activeQty -= trancheQty;
      const trancheGross = (pos.mark - entry) * trancheQty * sgn;
      partialRealizedGross += trancheGross;
      const trancheFee = tradeFee(trancheQty * pos.mark, takerFeeRate);
      const trancheSlip = slippageFraction(trancheQty * pos.mark, cfg.slippage[market] ?? 0.02);
      totalFees += trancheFee;
      totalSpreadSlip += (halfSpread + trancheSlip) * trancheQty * pos.mark;
      // Move stop to breakeven on remaining tranche
      currentStopPct = 0.001; // Breakeven floor
    }

    // 2. Breakeven Stop Logic
    if (breakevenStopActive && !partialClosed && peakMfeR >= 0.5) {
      currentStopPct = 0.001; // Lock at entry
    }

    // 3. Adaptive Holding Extension Logic
    let effectiveMaxHold = maxHoldHours;
    if (allowAdaptiveHold && (state === "FAVORABLE" || peakMfeR >= 0.5)) {
      effectiveMaxHold = 12; // Extend winning trade
    }

    // 4. Early Cut for Deteriorating Trades Logic
    const cutEarly = cutDeterioratingActive && relH >= 2.0 && state === "DETERIORATING";

    // 5. Exit Checks in strict execution order
    const stopLevel = entry * (1 - sgn * currentStopPct);
    const targetLevel = entry * (1 + sgn * targetPct);

    const liqHit = (cand.side === "long" && worst <= pos.liqPrice) || (cand.side === "short" && worst >= pos.liqPrice);
    const stopHit = cand.side === "long" ? worst <= stopLevel : worst >= stopLevel;
    const targetHit = cand.side === "long" ? best >= targetLevel : best <= targetLevel;
    const timeHit = relH >= effectiveMaxHold;
    const trailHit = trailingConfig.enabled && margin > 0
      && peakUPnl / margin >= trailingConfig.activateRoi
      && (peakUPnl - uPnl) / margin >= trailingConfig.giveRoi;

    if (liqHit) {
      exitReason = "liquidation";
      exitRef = pos.mark;
    } else if (cutEarly) {
      exitReason = "cut-deteriorating";
      exitRef = pos.mark;
    } else if (stopHit) {
      exitReason = currentStopPct <= 0.002 ? "breakeven-stop" : "stop-loss";
      exitRef = cand.side === "long" ? Math.min(stopLevel, o) : Math.max(stopLevel, o);
    } else if (targetHit) {
      exitReason = "take-profit";
      exitRef = targetLevel;
    } else if (timeHit) {
      exitReason = "time-stop";
      exitRef = pos.mark;
    } else if (trailHit) {
      exitReason = "trailing-stop";
      exitRef = pos.mark;
    }

    if (exitReason) {
      exitTs = ts;
      exitJ = j;
      holdHours = relH;
      break;
    }
  }

  // Unresolved position at end of data
  if (!exitReason) {
    return {
      tradeId: cand.tradeId,
      resolved: false,
      exit_reason: "unresolved-end-of-panel",
    };
  }

  // Calculate final exit execution costs and PnL
  const exitNotional = activeQty * exitRef;
  const exitFee = tradeFee(exitNotional, takerFeeRate);
  const exitSlipFrac = slippageFraction(exitNotional, cfg.slippage[market] ?? 0.02);
  const exitActual = fillPrice(exitRef, cand.side === "long" ? "short" : "long", halfSpread, exitSlipFrac);
  const exitSpreadSlip = Math.abs(exitActual - exitRef) * activeQty;

  totalFees += exitFee;
  totalSpreadSlip += exitSpreadSlip;

  const finalGross = partialRealizedGross + ((exitActual - entry) * activeQty * sgn);
  const netPnlUsd = finalGross - totalFees;
  const rawRetPct = (exitRef - entryRef) / entryRef * sgn;
  const realizedR = stopDistUsd > 0 ? netPnlUsd / stopDistUsd : 0;
  const mfeCapture = calcMfeCaptureRatio(realizedR, peakMfeR);

  return {
    tradeId: cand.tradeId,
    symbol: cand.symbol,
    strategy_id: cand.strategy_id,
    side: cand.side,
    ts: cand.ts,
    fold: cand.fold,
    subFold: cand.subFold ?? null,
    resolved: true,
    policyId,
    entry,
    exitActual,
    exit_reason: exitReason,
    holdHours,
    exitTs,
    raw_ret_pct: rawRetPct,
    gross_pnl_usd: finalGross,
    net_pnl_usd: netPnlUsd,
    fees_usd: totalFees,
    spread_slip_usd: totalSpreadSlip,
    realized_R: realizedR,
    mfe_R: peakMfeR,
    mae_R: worstMaeR,
    mfe_capture_ratio: mfeCapture,
    margin,
    leverage,
  };
}

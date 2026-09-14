// scripts/v2/alpha-horizons.mjs — ALPHA RESEARCH: forward outcome measurement.
//
// Measures what actually happened AFTER a signal using the SAME cost primitives
// as production (perp.mjs): adverse entry fill (half spread + sqrt impact),
// adverse exit fill, taker fee on both legs. Produces the exact decomposition:
//
//   raw   = pure price move, no frictions                 (information)
//   gross = raw after adverse fills (spread + impact)      (+ execution drag)
//   net   = gross after taker fees on both legs            (+ fees)
//
// Nothing here decides anything; it only measures. Only bars AFTER the decision
// bar are ever read.
import { sideSign, fillPrice, slippageFraction, tradeFee } from "./perp.mjs";
import { HOURLY_MS } from "./alpha-features.mjs";

export function horizonBars(horizonHours, barMs = HOURLY_MS) {
  return Math.max(1, Math.round((horizonHours * 3600000) / barMs));
}

// Full economic decomposition for one trade, given entry and exit references.
// `exitActual` may be supplied directly (a managed exit that already embeds the
// adverse fill) — then exitSlip is ignored.
export function tradeEconomics({
  entryRef, exitRef, side, marginUsd, leverage, cfg, market, spec,
  costMultiplier = 1.0, exitActual = null,
}) {
  const notional = Math.max(0, marginUsd) * Math.max(1, leverage);
  const halfSpread = ((cfg?.slippage?.[market] ?? 0.0005) / 2) * costMultiplier;
  const slipCfg = cfg?.slippage?.[market] ?? 0.0005;
  const qty = entryRef > 0 ? notional / entryRef : 0;
  const entrySlip = slippageFraction(notional, slipCfg) * costMultiplier;
  const entry = fillPrice(entryRef, side, halfSpread, entrySlip);
  const exitNotional = Math.abs(qty * exitRef);
  const exitSlip = slippageFraction(exitNotional, slipCfg) * costMultiplier;
  const exit = exitActual != null ? exitActual : fillPrice(exitRef, side === "long" ? "short" : "long", halfSpread, exitSlip);
  const sgn = sideSign(side);
  const takerRate = (spec?.costModel?.takerFee ?? cfg?.v2?.perpFees?.taker ?? 0.0005) * costMultiplier;
  const fees = tradeFee(Math.abs(qty * entry), takerRate) + tradeFee(exitNotional, takerRate);
  const rawPnl = (exitRef - entryRef) * qty * sgn;
  const grossPnl = (exit - entry) * qty * sgn;
  const netPnl = grossPnl - fees;
  const spreadSlipUsd = rawPnl - grossPnl;   // >= 0: total execution drag in USD
  const baseNotional = Math.abs(qty * entryRef) || notional;
  return {
    qty, notional: baseNotional, entry, exit, fees, rawPnl, grossPnl, netPnl, spreadSlipUsd,
    rawRet: entryRef > 0 ? (exitRef / entryRef - 1) * sgn : 0,
    grossRet: entry > 0 ? (exit / entry - 1) * sgn : 0,
    netRet: baseNotional > 0 ? netPnl / baseNotional : 0,
    rawBps: entryRef > 0 ? (exitRef / entryRef - 1) * sgn * 1e4 : 0,
    grossBps: entry > 0 ? (exit / entry - 1) * sgn * 1e4 : 0,
    netBps: baseNotional > 0 ? (netPnl / baseNotional) * 1e4 : 0,
    costUsd: fees + spreadSlipUsd,
    costBps: baseNotional > 0 ? ((fees + spreadSlipUsd) / baseNotional) * 1e4 : 0,
    feeBps: baseNotional > 0 ? (fees / baseNotional) * 1e4 : 0,
    slipBps: baseNotional > 0 ? (spreadSlipUsd / baseNotional) * 1e4 : 0,
  };
}

// Fixed-horizon measurement: enter at the decision bar's close (or the next
// bar's open for the delay-robustness variant), exit at the close `h` bars
// later. No stop, no target, no trailing — this isolates the SIGNAL, not the
// management layer.
export function measureHorizon({
  rows, i, side, horizonHours, cfg, market, marginUsd, leverage, stopPct, targetPct,
  spec, costMultiplier = 1.0, entryMode = "close",
}) {
  const n = rows.ts.length;
  const hBars = horizonBars(horizonHours);
  let entryIdx, entryRef;
  if (entryMode === "nextOpen") {
    entryIdx = i + 1;
    if (entryIdx >= n) return { resolved: false, censored: true, exit_reason: "no-entry-bar", hBars };
    entryRef = rows.open[entryIdx];
  } else {
    entryIdx = i;
    entryRef = rows.close[i];
  }
  if (!(entryRef > 0)) return { resolved: false, censored: true, exit_reason: "bad-entry", hBars };

  const lastIdx = n - 1;
  const idealExit = entryIdx + hBars;
  const censored = idealExit > lastIdx;
  const exitIdx = Math.min(idealExit, lastIdx);
  const exitRef = rows.close[exitIdx];

  const sgn = sideSign(side);
  let mfe = entryRef, mae = entryRef;      // favourable / adverse extremes
  let timeToMfe = 0, timeToTarget = null, timeToStop = null;
  const scanStart = entryMode === "nextOpen" ? entryIdx : entryIdx + 1;
  for (let j = scanStart; j <= exitIdx; j++) {
    const hi = rows.high[j], lo = rows.low[j];
    const fav = side === "long" ? hi : lo;
    const adv = side === "long" ? lo : hi;
    if (sgn * (fav - entryRef) > sgn * (mfe - entryRef)) { mfe = fav; timeToMfe = j - entryIdx; }
    if (sgn * (adv - entryRef) < sgn * (mae - entryRef)) mae = adv;
    if (timeToTarget == null && targetPct != null && sgn * (fav - entryRef) / entryRef >= targetPct) timeToTarget = j - entryIdx;
    if (timeToStop == null && stopPct != null && sgn * (adv - entryRef) / entryRef <= -stopPct) timeToStop = j - entryIdx;
  }

  const eco = tradeEconomics({ entryRef, exitRef, side, marginUsd, leverage, cfg, market, spec, costMultiplier });
  const riskUsd = Math.abs(eco.qty * entryRef * (stopPct ?? 0.05)) || Math.abs(marginUsd);
  const mfeBps = (sgn * (mfe - entryRef) / entryRef) * 1e4;
  const maeBps = (sgn * (mae - entryRef) / entryRef) * 1e4;
  const mfeR = stopPct > 0 ? (sgn * (mfe - entryRef) / entryRef) / stopPct : 0;
  const maeR = stopPct > 0 ? (sgn * (mae - entryRef) / entryRef) / stopPct : 0;
  const realizedR = riskUsd > 0 ? eco.netPnl / riskUsd : 0;

  return {
    resolved: true,
    censored,
    exit_reason: censored ? "horizon-censored-end-of-panel" : "horizon",
    entryMode,
    entryIdx, exitIdx, hBars, holdHours: exitIdx - entryIdx,
    entryRef, exitRef, ...eco,
    riskUsd, realized_R: realizedR, gross_R: riskUsd > 0 ? eco.grossPnl / riskUsd : 0, raw_R: riskUsd > 0 ? eco.rawPnl / riskUsd : 0,
    mfeBps, maeBps, mfe_R: mfeR, mae_R: maeR,
    mfeCostRatio: eco.costBps > 0 ? mfeBps / eco.costBps : 0,
    mfe_capture_ratio: mfeR > 0 ? realizedR / mfeR : 0,
    favBeforeAdverse: sgn * (mfe - entryRef) >= sgn * (entryRef - mae),
    timeToMfeBars: timeToMfe, timeToMfeHours: timeToMfe,
    timeToTargetBars: timeToTarget, timeToStopBars: timeToStop,
    touchedTarget: timeToTarget != null, touchedStop: timeToStop != null,
  };
}

// Adapter: maps the output of the FROZEN Phase 8 simulator
// (management-rules.mjs#simulateManagedTrade) onto the same measurement shape,
// so managed and fixed-horizon arms aggregate identically.
export function managedTradeAdapter(sim, { marginUsd, leverage, stopPct }) {
  if (!sim || !sim.resolved) return { resolved: false, censored: true, exit_reason: sim?.exit_reason ?? "unresolved" };
  const notional = Math.max(0, sim.margin ?? marginUsd) * Math.max(1, sim.leverage ?? leverage);
  const rawBps = (sim.raw_ret_pct ?? 0) * 1e4;
  return {
    resolved: true,
    censored: false,
    exit_reason: sim.exit_reason,
    holdHours: sim.holdHours ?? 0,
    entryRef: sim.entry, exitRef: sim.exitActual,
    notional, qty: notional / (sim.entry || 1),
    rawPnl: (sim.raw_ret_pct ?? 0) * notional,
    grossPnl: sim.gross_pnl_usd ?? 0,
    netPnl: sim.net_pnl_usd ?? 0,
    fees: sim.fees_usd ?? 0,
    spreadSlipUsd: sim.spread_slip_usd ?? 0,
    rawBps,
    grossBps: notional > 0 ? ((sim.gross_pnl_usd ?? 0) / notional) * 1e4 : 0,
    netBps: notional > 0 ? ((sim.net_pnl_usd ?? 0) / notional) * 1e4 : 0,
    costBps: notional > 0 ? (((sim.fees_usd ?? 0) + (sim.spread_slip_usd ?? 0)) / notional) * 1e4 : 0,
    feeBps: notional > 0 ? ((sim.fees_usd ?? 0) / notional) * 1e4 : 0,
    slipBps: notional > 0 ? ((sim.spread_slip_usd ?? 0) / notional) * 1e4 : 0,
    riskUsd: notional * (stopPct ?? 0.05),
    realized_R: sim.realized_R ?? 0,
    gross_R: notional * (stopPct ?? 0.05) > 0 ? (sim.gross_pnl_usd ?? 0) / (notional * (stopPct ?? 0.05)) : 0,
    raw_R: notional * (stopPct ?? 0.05) > 0 ? ((sim.raw_ret_pct ?? 0) * notional) / (notional * (stopPct ?? 0.05)) : 0,
    mfeBps: (sim.mfe_R ?? 0) * (stopPct ?? 0.05) * 1e4,
    maeBps: (sim.mae_R ?? 0) * (stopPct ?? 0.05) * 1e4,
    mfe_R: sim.mfe_R ?? 0,
    mae_R: sim.mae_R ?? 0,
    mfeCostRatio: (sim.fees_usd ?? 0) + (sim.spread_slip_usd ?? 0) > 0 ? ((sim.mfe_R ?? 0) * (stopPct ?? 0.05) * 1e4) / ((((sim.fees_usd ?? 0) + (sim.spread_slip_usd ?? 0)) / notional) * 1e4) : 0,
    mfe_capture_ratio: sim.mfe_capture_ratio ?? 0,
    touchedTarget: sim.exit_reason === "take-profit",
    touchedStop: /stop|liquidation|cut-deteriorating/.test(sim.exit_reason ?? ""),
    timeToMfeBars: null,
    timeToTargetBars: null, timeToStopBars: null,
  };
}
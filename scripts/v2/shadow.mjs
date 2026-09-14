// scripts/v2/shadow.mjs — Phase 3 deterministic SHADOW/counterfactual layer.
//
// PURPOSE: every valid strategy candidate that was NOT executed becomes a shadow
// trade resolved against REAL future prices using the SAME execution math as the
// live engine (perp.mjs: adverse fills, fees, slippage, EMA marks, funding,
// liquidation, stop/target/time/trailing exits in the same strict order).
// Counterfactual DATASET — not a strategy, not an equity backtest.
//
// HARD SEPARATION (spec §3/§5/§6):
//   - shadow P&L NEVER touches state.equity / wallet / journal / trades /
//     episodes / strategies.json / the live learner store.
//   - shadow records live ONLY in V2.shadowOpen / V2.shadowTrades.
//   - the live learner is trained ONLY by real executed closes.
//
// CAUSAL RULE (spec §4): at decision time T the record is built ONLY from info
// available at T. Exit resolution consumes ONLY quotes with ts >= decisionTs.
//
// Documented differences vs live engine (spec §5): margin is nominal
// (cfg.v2.shadow.marginUsd ?? startingCapital) so sqrt-impact slippage is at the
// same ~$100-margin scale as real trades; no wallet check; no council/survival
// gates (the rejection reason is recorded instead); funding = last known rate.
import { V2, readJSON, writeJSON, appendJSONL } from "./store.mjs";
import {
  openPosition, markPosition, sideSign, emaUpdate,
  crossedFundingTimestamps, fundingPayment, tradeFee, slippageFraction, fillPrice,
} from "./perp.mjs";

export function shadowEnabled(cfg) {
  return cfg?.v2?.shadow?.enabled !== false;
}
function shadowMargin(cfg) {
  return cfg?.v2?.shadow?.marginUsd ?? cfg?.v2?.startingCapital ?? 100;
}
export function loadShadowBook(path) {
  const d = readJSON(path || V2.shadowOpen, null);
  if (d && typeof d === "object" && d.open) return d;
  return { open: {} };
}
export function saveShadowBook(book, path) {
  writeJSON(path || V2.shadowOpen, book);
  return book;
}
export function resetShadow(path) {
  saveShadowBook({ open: {} }, path);
}
export function shadowOpenCount(path) {
  return Object.keys(loadShadowBook(path).open || {}).length;
}

// Open a shadow position from a candidate that was NOT executed.
export function openShadow(book, cfg, cand, quote, t) {
  const id = cand.trade_id ?? `sh_${t}_${cand.symbol}_${cand.strategy_id}`;
  if (book.open[id]) return null; // idempotent
  const market = cand.market ?? "crypto";
  const ref = quote?.ok ? (quote.priceUsd ?? quote.price) : null;
  if (!Number.isFinite(ref) || ref <= 0) return null;
  const margin = shadowMargin(cfg);
  const notionalEst = margin * (cand.leverage ?? 10);
  const halfSpread = (cfg.slippage[market] ?? 0.0005) / 2;
  const slip = slippageFraction(notionalEst, cfg.slippage[market] ?? 0.02);
  const entry = fillPrice(ref, cand.side, halfSpread, slip); // same adverse fill as executeOpen
  const pos = openPosition({
    symbol: cand.symbol, market, side: cand.side, entryMark: entry,
    margin, leverage: cand.leverage ?? 10, tiers: cfg.v2.maintenanceTiers[market],
    meta: {
      trade_id: id, strategy_id: cand.strategy_id ?? null,
      setup_tag: cand.setup_tag ?? null, stopPct: cand.stopPct ?? 0.05,
      targetPct: cand.targetPct ?? null, reason: cand.reason ?? null,
      regime: cand.setupRegime ?? cand.regime ?? null,
    },
  }, t);
  const fee = tradeFee(pos.notional, cfg.v2.perpFees.taker);
  pos.entryFeePaid = fee;
  pos.feesPaid = fee;
  pos.mark = entry;
  pos.maxHoldHours = cfg.v2.aggression.maxHoldHours;
  book.open[id] = {
    pos,
    decisionTs: cand.decisionTs ?? t,
    rejectReason: cand.rejectReason ?? null, // learner-lost | learner-blocked | cap | council-veto | survival
    learner: cand.learner ?? null,          // learner snapshot AT DECISION TIME (no future)
    // Phase 4 §5: decision-time attribution for later selected-vs-alternative comparison.
    baseScore: Number.isFinite(cand.baseScore) ? cand.baseScore : null,
    learnerScore: Number.isFinite(cand.learnerScore) ? cand.learnerScore : null,
    rank: Number.isFinite(cand.rank) ? cand.rank : null,
    actualSelectedStrategy: cand.actualSelectedStrategy ?? null,
  };
  return book.open[id];
}

// Manage all open shadow positions against current quotes. Same exit ORDER and
// thresholds as engine.markAndManage: liq -> stop -> target -> time -> trailing.
// Resolved outcomes append to V2.shadowTrades; NEVER mutates live state.
export function manageShadow(book, cfg, quotes, t, fundingRate) {
  let closed = 0;
  for (const [id, rec] of Object.entries(book.open)) {
    const pos = rec.pos;
    const q = quotes[pos.symbol];
    // CAUSAL: a quote from before entry cannot be used to manage this position.
    if (q && Number.isFinite(q.ts) && q.ts < rec.decisionTs) continue;
    let px = q?.ok && Number.isFinite(q.priceUsd) ? q.priceUsd : null;
    if (px == null) px = Number(pos.mark); // last-good mark (same policy as live)
    if (Number.isFinite(fundingRate) && pos.market === "crypto" && cfg.v2.leverage.crypto.funding) {
      const crossed = crossedFundingTimestamps(pos.lastFundingTs, t, cfg.v2.fundingHoursUTC);
      for (const fts of crossed) {
        pos.fundingAccrued = (pos.fundingAccrued ?? 0) + fundingPayment(Math.abs(pos.qty * pos.mark), fundingRate, pos.side);
        pos.lastFundingTs = fts;
      }
    }
    pos.mark = emaUpdate(pos.mark ?? null, px, cfg.v2.markEmaAlpha);
    const mk = markPosition(pos, pos.mark);
    if (pos.isolatedMargin > 0) {
      const roi = mk.uPnl / pos.isolatedMargin;
      pos.mfeRoi = Math.max(pos.mfeRoi ?? roi, roi);
      pos.maeRoi = Math.min(pos.maeRoi ?? roi, roi);
      pos.peakUPnl = Math.max(pos.peakUPnl ?? 0, mk.uPnl);
    }
    const stopPct = pos.openMeta.stopPct, targetPct = pos.openMeta.targetPct;
    let reason = null;
    if (mk.liquidated) reason = "liquidation";
    else if (stopPct != null) {
      const stop = pos.entryPrice * (1 - sideSign(pos.side) * stopPct);
      if ((pos.side === "long" && pos.mark <= stop) || (pos.side === "short" && pos.mark >= stop)) reason = "stop-loss";
    }
    if (!reason && targetPct != null) {
      const tgt = pos.entryPrice * (1 + sideSign(pos.side) * targetPct);
      if ((pos.side === "long" && pos.mark >= tgt) || (pos.side === "short" && pos.mark <= tgt)) reason = "take-profit";
    }
    if (!reason && (t - pos.openedAt) / 3600000 >= (pos.maxHoldHours ?? 4)) reason = "time-stop";
    if (!reason && pos.isolatedMargin > 0) {
      const peakRoi = pos.peakUPnl / pos.isolatedMargin;
      const curRoi = mk.uPnl / pos.isolatedMargin;
      if (peakRoi >= cfg.v2.aggression.trailActivateRoi && peakRoi - curRoi >= cfg.v2.aggression.trailGiveRoi) reason = "trailing-stop";
    }
    if (!reason) continue;
    closeShadow(book, cfg, id, pos.mark, reason, t);
    closed += 1;
  }
  return closed;
}

// Resolve one shadow position with the SAME P&L math as engine.closePosition.
export function closeShadow(book, cfg, id, mark, reason, t) {
  const rec = book.open[id];
  if (!rec) return null;
  const pos = rec.pos;
  const exitAction = pos.side === "long" ? "sell" : "buy";
  const notional = Math.abs(pos.qty * mark);
  const halfSpread = (cfg.slippage[pos.market] ?? 0.0005) / 2;
  const slip = slippageFraction(notional, cfg.slippage[pos.market] ?? 0.02);
  const xPrice = fillPrice(mark, exitAction, halfSpread, slip);
  const gross = (xPrice - pos.entryPrice) * pos.qty * sideSign(pos.side);
  const exitFee = tradeFee(notional, cfg.v2.perpFees.taker);
  const net = gross - exitFee + (pos.fundingAccrued ?? 0);
  const risk = Math.abs(pos.qty * pos.entryPrice * (pos.openMeta.stopPct ?? 0.05)) || pos.isolatedMargin;
  const realizedR = net / risk;
  const row = {
    shadow: true, // explicit: NEVER real P&L
    trade_id: id,
    strategy_id: pos.openMeta.strategy_id, setup_tag: pos.openMeta.setup_tag,
    symbol: pos.symbol, market: pos.market, side: pos.side,
    regime: pos.openMeta.regime, decisionTs: rec.decisionTs,
    entryTs: pos.openedAt, exitTs: t,
    entry: pos.entryPrice, exit: xPrice, mark,
    leverage: pos.leverage, margin: pos.isolatedMargin,
    stopPct: pos.openMeta.stopPct, targetPct: pos.openMeta.targetPct,
    reason: pos.openMeta.reason ?? null,
    rejectReason: rec.rejectReason,
    learner: rec.learner ?? null,
    exit_reason: reason, net_pnl: net, realized_R: realizedR,
    baseScore: rec.baseScore ?? null, learnerScore: rec.learnerScore ?? null,
    rank: rec.rank ?? null, actualSelectedStrategy: rec.actualSelectedStrategy ?? null,
    roi_on_margin: pos.isolatedMargin > 0 ? net / pos.isolatedMargin : null,
    hold_secs: (t - pos.openedAt) / 1000,
    mae_roi: pos.maeRoi ?? null, mfe_roi: pos.mfeRoi ?? null,
    fees: (pos.entryFeePaid ?? 0) + exitFee, fundingAccrued: pos.fundingAccrued ?? 0,
  };
  appendJSONL(V2.shadowTrades, row);
  delete book.open[id];
  return row;
}

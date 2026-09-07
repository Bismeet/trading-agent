// scripts/v2/strategies.mjs — P4: exact six seeds, signals, exits, dispatch.
import { V2, readJSON, writeJSON, sma, rsi, now, sha256, clamp } from "./store.mjs";

const ALL = ["crypto", "us", "india"];

export const SEEDS = [
  { id: "tsmom", name: "Time-series momentum", setup_tag: "momentum", markets: ALL, baseLev: 12, stopPct: 0.05, targetPct: 0.10,
    text: "Long when the 28-day trend is up (price > 200-SMA); short when down. Fast-resolving version for active trading." },
  { id: "donchian", name: "Donchian breakout", setup_tag: "breakout", markets: ALL, baseLev: 12, stopPct: 0.05, targetPct: 0.08,
    text: "Long a 20-day high breakout above the 200-SMA; short the 20-day breakdown below it. Turtle-style trend following." },
  { id: "rsi2dip", name: "RSI-2 dip (Connors)", setup_tag: "mean-reversion", markets: ALL, baseLev: 10, stopPct: 0.05, targetPct: 0.06,
    text: "Buy 2-day oversold ONLY in an uptrend (RSI2<10 & price>200-SMA); short overbought in a downtrend." },
  { id: "mom_trend", name: "Momentum + trend", setup_tag: "trend", markets: ALL, baseLev: 10, stopPct: 0.05, targetPct: 0.08,
    text: "Long strong 28-day momentum above the 200-SMA; ride the trailing exit." },
  { id: "orb", name: "Opening-range breakout", setup_tag: "orb", markets: ["us"], baseLev: 5, stopPct: 0.016, targetPct: 0.028,
    text: "Trade the break of the first 30m session range at the US open (live-only)." },
  { id: "ibreakout", name: "Intraday breakout (discovered)", setup_tag: "breakout-15m", markets: ["crypto"], baseLev: 15, stopPct: 0.015, targetPct: 0.08, intraday: true,
    text: "15-minute breakout of the prior ~12h range (48 bars). Tight 1.5% stop, 8% target. Forward-test only." },
];

// ensureStrategies: merge seeds without clobbering learned stats (P4/P8).
export function ensureStrategies() {
  const lib = readJSON(V2.strategies, null) || { strategies: [] };
  const byId = new Map((lib.strategies || []).map((s) => [s.id, s]));
  for (const seed of SEEDS) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, { ...seed, status: "candidate", n: 0, expectancy_R: 0, win_rate: 0, kelly: 0.12, confidence: 0.2 });
    }
  }
  const out = { strategies: SEEDS.map((s) => byId.get(s.id)) };
  writeJSON(V2.strategies, out);
  return out;
}

// ---- Signal functions (docs/09 exact thresholds; strict inequalities) ----
// [DECISION D03] retN literal source index: c[last]/c[last-1-n] - 1
const retN = (c, n) => c[c.length - 1] / c[c.length - 1 - n] - 1;

export function sigTsmom(q) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < 30) return null;
  const r28 = retN(c, 28);
  const s200 = sma(c, 200);
  if (r28 > 0.03 && (s200 == null || q.price > s200))
    return { side: "long", baseLev: 12, stopPct: 0.05, targetPct: 0.10, confidence: 0.62, reason: "28d trend up" };
  if (r28 < -0.03 && (s200 == null || q.price < s200))
    return { side: "short", baseLev: 12, stopPct: 0.05, targetPct: 0.10, confidence: 0.55, reason: "28d trend down" };
  return null;
}

export function sigDonchian(q) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < 25) return null;
  const prior = c.slice(c.length - 21, c.length - 1); // prior 20 closes, latest excluded
  const hi = Math.max(...prior), lo = Math.min(...prior);
  const s200 = sma(c, 200);
  if (q.price > hi && (s200 == null || q.price > s200))
    return { side: "long", baseLev: 12, stopPct: 0.05, targetPct: 0.08, confidence: 0.60, reason: "20d high breakout" };
  if (q.price < lo && (s200 == null || q.price < s200))
    return { side: "short", baseLev: 12, stopPct: 0.05, targetPct: 0.08, confidence: 0.55, reason: "20d low breakdown" };
  return null;
}

export function sigRsi2dip(q) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < 210) return null;
  const r2 = rsi(c, 2);
  const s200 = sma(c, 200);
  if (r2 == null || s200 == null) return null;
  if (r2 < 10 && q.price > s200)
    return { side: "long", baseLev: 10, stopPct: 0.05, targetPct: 0.06, confidence: 0.60, reason: "RSI2 oversold in uptrend" };
  if (r2 > 90 && q.price < s200)
    return { side: "short", baseLev: 10, stopPct: 0.05, targetPct: 0.06, confidence: 0.55, reason: "RSI2 overbought in downtrend" };
  return null;
}

export function sigMomTrend(q) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < 30) return null;
  const r28 = retN(c, 28);
  const s200 = sma(c, 200);
  if ((s200 == null || q.price > s200) && r28 > 0.05 && Number.isFinite(q.mom) && q.mom > 1 && Number.isFinite(q.rsi) && q.rsi < 78)
    return { side: "long", baseLev: 10, stopPct: 0.05, targetPct: 0.08, confidence: 0.55, reason: "strong 28d momentum above trend" };
  return null; // no short entry specified
}

// ORB: live-only, US. cache.orb[symbol] = {day, orHi, orLo, formed, eligible}.
// Eligible only if first observed within ~5 minutes of actual session open (P4).
export function sigOrb(q, cache, nowTs = now()) {
  if (!q.sessionStart || !Number.isFinite(q.price)) return null;
  const st = (cache.orb ||= {});
  const o = (st[q.symbol] ||= { day: null, orHi: null, orLo: null, formed: false, eligible: false });
  if (o.day !== q.sessionStart) {
    const sinceOpen = nowTs - q.sessionStart;
    st[q.symbol] = { day: q.sessionStart, orHi: q.price, orLo: q.price, formed: false, eligible: sinceOpen >= 0 && sinceOpen <= 5 * 60000 };
    return null; // late observation invalidates the session
  }
  if (!o.eligible) return null;
  const sinceOpen = nowTs - q.sessionStart;
  if (sinceOpen <= 30 * 60000) {
    o.orHi = Math.max(o.orHi, q.price);
    o.orLo = Math.min(o.orLo, q.price);
    return null; // still building the first-30m range
  }
  o.formed = true;
  if (q.price > o.orHi) return { side: "long", baseLev: 5, stopPct: 0.016, targetPct: 0.028, confidence: 0.55, reason: "ORB break up" };
  if (q.price < o.orLo) return { side: "short", baseLev: 5, stopPct: 0.016, targetPct: 0.028, confidence: 0.50, reason: "ORB break down" };
  return null;
}

// ibreakout: latest 15m close strictly outside prior 48 completed bars.
export function sigBreakoutIntraday(q) {
  const c = q.closesIntraday;
  if (!Array.isArray(c) || c.length < 49) return null;
  const prior = c.slice(c.length - 49, c.length - 1); // 48 bars, latest excluded
  const hi = Math.max(...prior), lo = Math.min(...prior);
  const last = c[c.length - 1];
  if (last > hi) return { side: "long", baseLev: 15, stopPct: 0.015, targetPct: 0.08, confidence: 0.50, reason: "15m breakout of 48-bar high" };
  if (last < lo) return { side: "short", baseLev: 15, stopPct: 0.015, targetPct: 0.08, confidence: 0.50, reason: "15m breakout of 48-bar low" };
  return null;
}

export const SIGNALS = { tsmom: sigTsmom, donchian: sigDonchian, rsi2dip: sigRsi2dip, mom_trend: sigMomTrend, orb: sigOrb, ibreakout: sigBreakoutIntraday };

// strategyExit(pos, q, regime): regime named but unused by source (docs/09).
export function strategyExit(pos, q, regime) {
  const id = pos?.openMeta?.strategy_id;
  const c = q?.closes;
  if (!Array.isArray(c) || c.length < 30) return null;
  if (id === "rsi2dip") {
    const r2 = rsi(c, 2);
    if (r2 == null) return null;
    if (pos.side === "long" && r2 >= 65) return "rsi2-reverted";
    if (pos.side === "short" && r2 <= 35) return "rsi2-reverted";
    return null;
  }
  if (id === "donchian") {
    const prior = c.slice(c.length - 11, c.length - 1); // prior 10 closes
    const hi = Math.max(...prior), lo = Math.min(...prior);
    if (pos.side === "long" && q.price < lo) return "strategy-exit";
    if (pos.side === "short" && q.price > hi) return "strategy-exit";
    return null;
  }
  if (id === "tsmom" || id === "mom_trend") {
    if (c.length < 30) return null;
    const r28 = retN(c, 28);
    if (pos.side === "long" && r28 < 0) return "trend-flip";
    if (pos.side === "short" && r28 > 0) return "trend-flip";
  }
  return null;
}

// P4 dispatch: exits first, then entries; one position/symbol; 120s cooldown; max 10.
export function runStrategies(state, eq, cfg, histCache) {
  const lib = readJSON(V2.strategies, { strategies: [] });
  const stats = new Map(lib.strategies.map((s) => [s.id, s]));
  const maxPos = cfg.v2.strategies.maxConcurrentPositions;
  const cache = (histCache.strategyCache ||= {});
  const cooldowns = (histCache.cooldowns ||= {});
  const orders = [];
  const t = now();

  // 1. exits for open positions, queued before entry scanning
  for (const [symbol, pos] of Object.entries(state.positions || {})) {
    const q = histCache.quotes?.[symbol];
    if (!q || !q.ok || q.stale) continue;
    const why = strategyExit(pos, q, state.regime);
    if (why) orders.push({ op: "close", symbol, reason: why, trade_id: pos.openMeta?.trade_id ?? null });
  }

  // 2-5. entry scan
  const openCount = Object.keys(state.positions || {}).length;
  let reserved = 0;
  for (const w of cfg.watchlist) {
    if (openCount + reserved >= maxPos) break;
    const symbol = w.symbol;
    if (state.positions?.[symbol]) continue;
    if (cooldowns[symbol] && t - cooldowns[symbol] < 120000) continue;
    if (orders.some((o) => o.symbol === symbol)) continue; // queued close blocks same-tick reopen
    const q = histCache.quotes?.[symbol];
    if (!q || !q.ok || q.stale || !Number.isFinite(q.price) || q.price <= 0) continue;
    if (w.market !== "crypto" && q.marketState !== "REGULAR") continue; // market-open gate
    let best = null;
    for (const seed of SEEDS) {
      const st2 = stats.get(seed.id);
      if (st2?.status === "retired") continue;
      if (!seed.markets.includes(w.market)) continue;
      const sig = SIGNALS[seed.id](q, cache, t);
      if (!sig) continue;
      const score = sig.confidence * (0.5 + (st2?.confidence ?? 0.2));
      if (!best || score > best.score) best = { seed, sig, score };
    }
    if (!best) continue;
    const { seed, sig } = best;
    const leverage = clamp(sig.baseLev, 1, state.aggression.leverageCap);
    orders.push({
      op: "open",
      symbol,
      side: sig.side,
      leverage,
      strategy_id: seed.id,
      setup_tag: seed.setup_tag,
      stopPct: sig.stopPct,
      targetPct: sig.targetPct,
      confidence: sig.confidence,
      reason: sig.reason,
      trade_id: `t_${t}_${sha256(symbol + seed.id + t)}`,
      sizePct: null,
      createdAt: t,
    });
    cooldowns[symbol] = t; // cooldown set at queue time
    reserved++;
  }
  return orders;
}

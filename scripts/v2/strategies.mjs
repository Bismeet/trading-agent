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

// ---- Phase 5 CONTROL parameters (docs/09 exact thresholds) ----
// These ARE the production thresholds: every signal function below defaults to
// this object, so all live call paths (SIGNALS[id](q, cache, t)) are unchanged.
// config/strategies.control.json is a frozen snapshot of this object and
// tests/phase5.test.mjs fails if the two ever diverge. Phase 5 calibration
// passes an explicit params object instead; it may move only signal-detection
// thresholds, never risk geometry (stop/target/leverage) or strategy semantics.
export const CONTROL_PARAMS = {
  tsmom: { retN: 28, smaN: 200, momThreshold: 0.03, baseLev: 12, stopPct: 0.05, targetPct: 0.10, confLong: 0.62, confShort: 0.55 },
  donchian: { lookback: 20, smaN: 200, baseLev: 12, stopPct: 0.05, targetPct: 0.08, confLong: 0.60, confShort: 0.55 },
  rsi2dip: { rsiN: 2, rsiLow: 10, rsiHigh: 90, smaN: 200, baseLev: 10, stopPct: 0.05, targetPct: 0.06, confLong: 0.60, confShort: 0.55 },
  mom_trend: { retN: 28, smaN: 200, retThreshold: 0.05, momMin: 1, rsiMax: 78, baseLev: 10, stopPct: 0.05, targetPct: 0.08, confLong: 0.55 },
  orb: { rangeMinutes: 30, eligibilityMinutes: 5, baseLev: 5, stopPct: 0.016, targetPct: 0.028, confLong: 0.55, confShort: 0.50 },
  ibreakout: { bars: 48, baseLev: 15, stopPct: 0.015, targetPct: 0.08, conf: 0.50 },
};

// ---- Signal functions (docs/09 exact thresholds; strict inequalities) ----
// UNIFORM DISPATCH SIGNATURE: every signal is called as (q, cache, t, P) by
// runStrategies. P (signal parameters) is always the 4th argument and defaults
// to CONTROL_PARAMS, so the live path passes only (q, cache, t) and is unchanged.
// [DECISION D03] retN literal source index: c[last]/c[last-1-n] - 1
const retN = (c, n) => c[c.length - 1] / c[c.length - 1 - n] - 1;

export function sigTsmom(q, cache, t, P = CONTROL_PARAMS.tsmom) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < Math.max(30, P.retN + 2)) return null;
  const r28 = retN(c, P.retN);
  const s200 = sma(c, P.smaN);
  if (r28 > P.momThreshold && (s200 == null || q.price > s200))
    return { side: "long", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confLong, reason: "28d trend up" };
  if (r28 < -P.momThreshold && (s200 == null || q.price < s200))
    return { side: "short", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confShort, reason: "28d trend down" };
  return null;
}

export function sigDonchian(q, cache, t, P = CONTROL_PARAMS.donchian) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < Math.max(25, P.lookback + 5)) return null;
  const prior = c.slice(c.length - (P.lookback + 1), c.length - 1); // prior N closes, latest excluded
  const hi = Math.max(...prior), lo = Math.min(...prior);
  const s200 = sma(c, P.smaN);
  if (q.price > hi && (s200 == null || q.price > s200))
    return { side: "long", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confLong, reason: `${P.lookback}d high breakout` };
  if (q.price < lo && (s200 == null || q.price < s200))
    return { side: "short", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confShort, reason: `${P.lookback}d low breakdown` };
  return null;
}

export function sigRsi2dip(q, cache, t, P = CONTROL_PARAMS.rsi2dip) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < Math.max(210, P.smaN + 10)) return null;
  const r2 = rsi(c, P.rsiN);
  const s200 = sma(c, P.smaN);
  if (r2 == null || s200 == null) return null;
  if (r2 < P.rsiLow && q.price > s200)
    return { side: "long", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confLong, reason: "RSI2 oversold in uptrend" };
  if (r2 > P.rsiHigh && q.price < s200)
    return { side: "short", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confShort, reason: "RSI2 overbought in downtrend" };
  return null;
}

export function sigMomTrend(q, cache, t, P = CONTROL_PARAMS.mom_trend) {
  const c = q.closes;
  if (!Array.isArray(c) || c.length < Math.max(30, P.retN + 2)) return null;
  const r28 = retN(c, P.retN);
  const s200 = sma(c, P.smaN);
  if ((s200 == null || q.price > s200) && r28 > P.retThreshold && Number.isFinite(q.mom) && q.mom > P.momMin && Number.isFinite(q.rsi) && q.rsi < P.rsiMax)
    return { side: "long", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confLong, reason: "strong 28d momentum above trend" };
  return null; // no short entry specified
}

// ORB: live-only, US. cache.orb[symbol] = {day, orHi, orLo, formed, eligible}.
// Eligible only if first observed within ~5 minutes of actual session open (P4).
export function sigOrb(q, cache, nowTs = now(), P = CONTROL_PARAMS.orb) {
  if (!q.sessionStart || !Number.isFinite(q.price)) return null;
  const st = (cache.orb ||= {});
  const o = (st[q.symbol] ||= { day: null, orHi: null, orLo: null, formed: false, eligible: false });
  if (o.day !== q.sessionStart) {
    const sinceOpen = nowTs - q.sessionStart;
    st[q.symbol] = { day: q.sessionStart, orHi: q.price, orLo: q.price, formed: false, eligible: sinceOpen >= 0 && sinceOpen <= P.eligibilityMinutes * 60000 };
    return null; // late observation invalidates the session
  }
  if (!o.eligible) return null;
  const sinceOpen = nowTs - q.sessionStart;
  if (sinceOpen <= P.rangeMinutes * 60000) {
    o.orHi = Math.max(o.orHi, q.price);
    o.orLo = Math.min(o.orLo, q.price);
    return null; // still building the opening range
  }
  o.formed = true;
  if (q.price > o.orHi) return { side: "long", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confLong, reason: "ORB break up" };
  if (q.price < o.orLo) return { side: "short", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.confShort, reason: "ORB break down" };
  return null;
}

// ibreakout: latest 15m close strictly outside prior N completed bars.
export function sigBreakoutIntraday(q, cache, t, P = CONTROL_PARAMS.ibreakout) {
  const c = q.closesIntraday;
  if (!Array.isArray(c) || c.length < Math.max(49, P.bars + 1)) return null;
  const prior = c.slice(c.length - (P.bars + 1), c.length - 1); // N bars, latest excluded
  const hi = Math.max(...prior), lo = Math.min(...prior);
  const last = c[c.length - 1];
  if (last > hi) return { side: "long", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.conf, reason: `15m breakout of ${P.bars}-bar high` };
  if (last < lo) return { side: "short", baseLev: P.baseLev, stopPct: P.stopPct, targetPct: P.targetPct, confidence: P.conf, reason: `15m breakout of ${P.bars}-bar low` };
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
// Learner sits ABOVE signals: runStrategies emits per-symbol CANDIDATES (all passing
// signals with baseScore + frozen context), engine ranks via learning.mjs, applies
// same-setup concentration cap + abstention, then queues winner(s).
// Phase 3: also returns `evaluated` — one attribution row per (symbol x applicable
// strategy) INCLUDING no-signal evaluations, so candidate diversity is measurable
// ("did other strategies generate candidates, or none at all?"). Structurally
// ineligible seeds (retired status / market mismatch) are NOT evaluated rows.
export function runStrategies(state, eq, cfg, histCache) {
  const lib = readJSON(V2.strategies, { strategies: [] });
  const stats = new Map(lib.strategies.map((s) => [s.id, s]));
  const maxPos = cfg.v2.strategies.maxConcurrentPositions;
  const cache = (histCache.strategyCache ||= {});
  const cooldowns = (histCache.cooldowns ||= {});
  const orders = [];
  const evaluated = [];
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
    const cands = [];
    for (const seed of SEEDS) {
      const st2 = stats.get(seed.id);
      if (st2?.status === "retired") continue; // structurally ineligible: NOT an evaluated row
      if (!seed.markets.includes(w.market)) continue; // structurally ineligible: NOT an evaluated row
      const sig = SIGNALS[seed.id](q, cache, t);
      if (!sig) {
        // Phase 3 attribution: evaluated but no signal (answer: "was TSMOM the only generator?")
        evaluated.push({
          ts: t, symbol, strategy_id: seed.id, setup_tag: seed.setup_tag,
          fired: false, side: null, baseScore: null, reason: null,
        });
        continue;
      }
      const score = sig.confidence * (0.5 + (st2?.confidence ?? 0.2));
      evaluated.push({
        ts: t, symbol, strategy_id: seed.id, setup_tag: seed.setup_tag,
        fired: true, side: sig.side, baseScore: score, reason: sig.reason,
      });
      cands.push({ seed, sig, score });
    }
    if (!cands.length) continue;
    // emit ALL passing signals as candidates with frozen context for the learner
    for (const { seed, sig, score } of cands) {
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
        baseScore: score, // pre-learner signal score for audit + ranking
        setupRegime: state.regime, // frozen entry context (regime can shift mid-trade)
        closes: Array.isArray(q.closes) ? q.closes.slice(-30) : undefined, // vol bucket + audit
        fng: undefined, funding: undefined, session: undefined,
      });
    }
    // cooldown set at queue time (per symbol; learner caps same-setup separately)
    cooldowns[symbol] = t;
    reserved++;
  }
  return { orders, evaluated }; // Phase 3: orders + attribution rows
}

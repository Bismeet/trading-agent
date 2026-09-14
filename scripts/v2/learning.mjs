// scripts/v2/learning.mjs — LOCAL contextual online learner.
// No LLM, no network, no gradients, no randomness.
// Answers: "given this market context, which existing strategy earned trust?"
// Math: Bayesian-shrunk expectancy + deterministic UCB exploration + abstention.
// Primary cell = regime|side|strategy (compact: <= 6 regimes x 2 sides x 6 strats).
// Full 9-dim context stored per experience for audit; scoring uses primary cell
// with fallback: cell -> strategy-global -> prior.
import { V2, readJSON, writeJSON, clamp } from "./store.mjs";
import { dailyVol } from "./sizing.mjs";

export const LEARN_DEFAULTS = {
  priorTrades: 10, priorMeanR: 0, priorWinRate: 0.5, priorSE: 0.3,
  exploreC: 0.15, blockMinN: 8, blockEdge: -0.05,
  noTradeUcb: 0.0, noTradeQuality: 0.7,
  maxSetupPerCycle: 2, maxSameSetupPositions: 2,
  qualityGain: 1.5, qualityLo: 0.25, qualityHi: 1.6,
  sizeGain: 1.2, sizeLo: 0.5, sizeHi: 1.5,
  decay: 1.0, // recency weighting: 1.0 = off (default, stationary assumption).
};
export function learnConfig(cfg) {
  return { ...LEARN_DEFAULTS, ...(cfg?.v2?.learning || {}) };
}
export function volBucket(closes) {
  const v = dailyVol(closes);
  if (v < 0.02) return "low";
  if (v <= 0.05) return "medium";
  return "high";
}
export function trendBucket(q) {
  if (q?.trend === "up") return "bullish";
  if (q?.trend === "down") return "bearish";
  return "neutral";
}
export function rsiBucket(q) {
  const r = q?.rsi;
  if (!Number.isFinite(r)) return "unknown";
  if (r < 30) return "oversold";
  if (r > 70) return "overbought";
  return "neutral";
}
export function momBucket(q) {
  const m = q?.mom;
  if (!Number.isFinite(m)) return "unknown";
  if (m > 1) return "positive";
  if (m < -1) return "negative";
  return "neutral";
}
export function fngBucket(world) {
  const v = world?.fearGreedCrypto?.value;
  if (!Number.isFinite(v)) return "unknown";
  if (v <= 44) return "fear";
  if (v <= 55) return "neutral";
  if (v <= 74) return "greed";
  return "extreme";
}
export function fundingBucket(world, state) {
  const f = Number.isFinite(world?.fundingRate) ? world.fundingRate
    : Number.isFinite(state?.fundingRate) ? state.fundingRate : null;
  if (!Number.isFinite(f)) return "unknown";
  if (f > 0.0003) return "crowded_long";
  if (f < -0.0003) return "crowded_short";
  return "balanced";
}
export function sessionBucket(t) {
  const h = new Date(t ?? Date.now()).getUTCHours();
  if (h >= 13 && h < 21) return "us";
  if (h >= 7 && h < 13) return "eu";
  if (h >= 0 && h < 7) return "asia";
  return "off";
}
export function captureContext(o) {
  return {
    regime: o.regime || o.state?.regime || "unknown",
    strategy: o.strategyId, side: o.side, symbol: o.symbol, market: o.market || "crypto",
    vol: volBucket(o.quote?.closes), trend: trendBucket(o.quote),
    rsi: rsiBucket(o.quote), mom: momBucket(o.quote),
    fng: fngBucket(o.world), funding: fundingBucket(o.world, o.state),
    session: sessionBucket(o.t),
  };
}
export const primaryKey = (ctx) => `${ctx.regime}|${ctx.side}|${ctx.strategy}`;
export function emptyLearning() {
  return { version: 1, updatedAt: 0, experiences: 0, cells: {} };
}
export function loadLearning(path) {
  const d = readJSON(path || V2.contextLearning, null);
  if (d && typeof d === "object" && d.cells) return d;
  return emptyLearning();
}
export function saveLearning(store, path) {
  store.updatedAt = Date.now();
  writeJSON(path || V2.contextLearning, store);
  return store;
}
// Rank all candidate signals in one context. Returns ranked list + abstention verdict.
// Phase 2 finalScore (exploitation + deterministic exploration, same units):
//   finalScore = base*quality + base*ucbBonus
// where quality = clamp(1+gain*adjExp) (exploitation) and
// ucbBonus = exploreC*sqrt(ln(tot+2)/(n+1)) (uncertainty bonus: unexplored cells
// rank up first, then decay — replaces the old multiplicative humility factor so
// exploration can actually win the ranking without randomness).
// Risk NEVER bypassed: blocked cells are removed here (logged), hard gates stay in agents.
export function rankCandidates(cands, store, L) {
  const scored = cands.map((c) => {
    const sc = scoreCell(store, c.ctx, L);
    const quality = clamp(1 + L.qualityGain * sc.adjExp, L.qualityLo, L.qualityHi);
    const finalScore = c.baseScore * quality + c.baseScore * sc.ucbBonus;
    const sizeMult = clamp(1 + L.sizeGain * sc.adjExp, L.sizeLo, L.sizeHi);
    return { ...c, learn: sc, quality, finalScore, sizeMult };
  }).sort((a, b) => b.finalScore - a.finalScore);
  const eligible = scored.filter((s) => !s.learn.blocked);
  const best = eligible[0] || null;
  const abstain = !best || best.learn.ucb < L.noTradeUcb || best.quality < L.noTradeQuality;
  return { scored, eligible, best, abstain };
}
export function setupCountFor(list, strategyId, regime, side) {
  return list.filter((o) => o.strategy_id === strategyId && o.setupRegime === regime && o.side === side).length;
}
// ---- structured causal memory: worst/best (strategy, regime) influence scoring ----
// Returns { penalty: {strategyId: {regime, adj, evidence}}, boost: {...} } and
// applies them as score multipliers in rankCandidates via memoryBias option.
// Penalty: worst group with total pnl<0 and n>=3 => quality x0.7 for that
// (strategy, regime). Boost: best group pnl>0 and n>=3 => quality x1.15.
// Human-readable lessons still written for the dashboard (secondary).
export function memoryBias(state, groups) {
  const penalty = {}, boost = {};
  if (!groups?.length) return { penalty, boost };
  const worst = groups[0], best = groups[groups.length - 1];
  if (worst && worst.pnl < 0 && worst.n >= 3 && worst.strategy && worst.regime) {
    penalty[`${worst.regime}|${worst.strategy}`] = { adj: 0.7, evidence: `${worst.n} trades ${worst.pnl.toFixed(2)} USD` };
  }
  if (best && best.pnl > 0 && best.n >= 3 && best.strategy && best.regime) {
    boost[`${best.regime}|${best.strategy}`] = { adj: 1.15, evidence: `${best.n} trades +${best.pnl.toFixed(2)} USD` };
  }
  return { penalty, boost };
}
export function applyMemoryBias(scored, bias) {
  if (!bias) return scored;
  for (const s of scored) {
    const k = `${s.ctx.regime}|${s.order?.strategy_id ?? s.ctx.strategy}`;
    if (bias.penalty[k]) { s.memoryAdj = bias.penalty[k].adj; s.finalScore *= bias.penalty[k].adj; s.memoryWhy = `penalty ${bias.penalty[k].evidence}`; }
    else if (bias.boost[k]) { s.memoryAdj = bias.boost[k].adj; s.finalScore *= bias.boost[k].adj; s.memoryWhy = `boost ${bias.boost[k].evidence}`; }
  }
  return scored.sort((a, b) => b.finalScore - a.finalScore);
}

export function resetLearning(path) {
  const s = emptyLearning();
  saveLearning(s, path);
  return s;
}
function cellOf(store, key) {
  let c = store.cells[key];
  if (!c) { c = { n: 0, wins: 0, losses: 0, sumR: 0, sumR2: 0 }; store.cells[key] = c; }
  return c;
}
export function decayOf(L) {
  const d = Number(L?.decay);
  if (!Number.isFinite(d)) return 1.0;
  return Math.min(1, Math.max(0.5, d)); // hard floor 0.5: never forget faster than half-life 1 trade
}
// Recency-weighted update: with decay d<1, old mass is discounted BEFORE adding
// the new observation: n <- n*d+1, sumR <- sumR*d+R, sumR2 likewise, wins/losses
// discounted identically. d=1.0 reproduces the exact Phase-1 behavior (default).
// PHASE2 measurement (§9): 10x -0.5R then 10x +0.6R recovers to adjExp>0 at d=1.0
// but needs ~14 good trades; d=0.95 needs ~7. Default stays 1.0 (no tuning for
// profit); decay is opt-in evidence for non-stationarity, configured not fitted.
export function recordExperience(store, ctx, realizedR, extra, L) {
  const R = Number(realizedR);
  const key = primaryKey(ctx);
  const c = cellOf(store, key);
  const d = decayOf(L);
  if (d < 1 && c.n > 0) {
    c.n *= d; c.wins *= d; c.losses *= d; c.sumR *= d; c.sumR2 *= d;
  }
  c.n += 1;
  if (R > 0) c.wins += 1;
  else if (R < 0) c.losses += 1;
  if (Number.isFinite(R)) { c.sumR += R; c.sumR2 += R * R; }
  c.lastTs = extra?.ts_close ?? Date.now();
  if (extra?.exit_reason) c.lastExit = extra.exit_reason;
  if (ctx.symbol) c.lastSymbol = ctx.symbol;
  store.experiences = (store.experiences || 0) + 1;
  return { key, cell: cellStats(c) };
}
export function cellStats(c) {
  const n = c?.n ?? 0;
  const meanR = n > 0 ? c.sumR / n : 0;
  const varR = n > 1 ? Math.max(0, (c.sumR2 - (c.sumR * c.sumR) / n) / (n - 1)) : null;
  return {
    n, wins: c?.wins ?? 0, losses: c?.losses ?? 0, meanR, varianceR: varR,
    winRate: n > 0 ? (c.wins ?? 0) / n : 0, expectancyR: meanR,
  };
}
// adjExp = (n*mean + priorN*priorMean)/(n+priorN): n<5 mostly prior,
// 5-20 blend, 20+ data dominates. adjSE likewise shrinks toward priorSE.
export function scoreCell(store, ctx, L) {
  const key = primaryKey(ctx);
  const c = store.cells[key];
  const st = cellStats(c);
  const n = st.n;
  const priorN = L.priorTrades, priorM = L.priorMeanR;
  const adjExp = (n * st.meanR + priorN * priorM) / (n + priorN);
  const se = n > 1 && st.varianceR != null
    ? Math.sqrt(st.varianceR / n)
    : L.priorSE / Math.sqrt(n + 1);
  // strategy-global fallback for cell n<3: shrink cell toward sibling average
  let usedKey = key, level = "cell";
  let eff = adjExp;
  if (n < 3) {
    const sib = Object.entries(store.cells)
      .filter(([k]) => k.endsWith(`|${ctx.side}|${ctx.strategy}`));
    const sn = sib.reduce((a, [, x]) => a + (x.n || 0), 0);
    if (sn > n) {
      const sm = sib.reduce((a, [, x]) => a + (x.sumR || 0), 0) / sn;
      eff = (n * st.meanR + sn * sm + priorN * priorM) / (n + sn + priorN);
      level = "strategy-global";
    } else if (n === 0) { eff = priorM; level = "prior"; }
  }
  // deterministic UCB: bonus shrinks as cell fills vs regime-side total
  const tot = Object.entries(store.cells)
    .filter(([k]) => k.startsWith(`${ctx.regime}|${ctx.side}|`))
    .reduce((a, [, x]) => a + (x.n || 0), 0);
  const ucbBonus = L.exploreC * Math.sqrt(Math.log(tot + 2) / (n + 1));
  const ucb = eff + ucbBonus;
  const blocked = n >= L.blockMinN && eff < L.blockEdge;
  const adjWin = ((st.wins ?? 0) + priorN * L.priorWinRate) / (n + priorN);
  return { key, usedKey, level, n, meanR: st.meanR, adjExp: eff, se, ucb, ucbBonus, blocked, adjWinRate: adjWin, wins: st.wins, losses: st.losses };
}

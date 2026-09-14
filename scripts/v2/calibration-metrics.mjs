// scripts/v2/calibration-metrics.mjs — Phase 5 measurement layer (pure, no I/O).
//
// Every metric is either computed from real observations or explicitly
// reported as INSUFFICIENT. Missing evidence is never converted to zero
// (spec §16) and thin samples are never rewarded (spec §6/§13).
import { mean, stdev, clamp } from "./store.mjs";
import { emptyLearning, recordExperience, rankCandidates } from "./learning.mjs";

export const INSUFFICIENT = "INSUFFICIENT";

// ---- signal frequency (spec §3) ---------------------------------------------
// Runs, gaps and co-firing are computed per symbol, then aggregated, so a
// symbol with fewer usable bars cannot dominate the statistics.
export function frequencyStats({ signals, evaluations, symbols }) {
  const perSymbol = {};
  for (const s of signals) perSymbol[s.symbol] = (perSymbol[s.symbol] || 0) + 1;
  const perSide = {};
  for (const s of signals) perSide[s.side] = (perSide[s.side] || 0) + 1;
  const perTrend = {};
  for (const s of signals) perTrend[s.trendContext] = (perTrend[s.trendContext] || 0) + 1;
  const runs = [], gaps = [];
  for (const sym of new Set(signals.map((s) => s.symbol))) {
    const idx = signals.filter((s) => s.symbol === sym).map((s) => s.i).sort((a, b) => a - b);
    let run = 0, prev = null;
    for (const i of idx) {
      if (prev != null && i === prev + 1) run += 1;
      else { if (run) runs.push(run + 1); run = 0; }
      if (prev != null) gaps.push(i - prev);
      prev = i;
    }
    if (run) runs.push(run + 1);
  }
  return {
    evaluations,
    signals: signals.length,
    candidateRate: evaluations > 0 ? signals.length / evaluations : null,
    symbolsCovered: Object.keys(perSymbol).length,
    symbolsAvailable: symbols,
    perSymbol,
    perSide,
    perTrend,
    maxConsecutiveFiring: runs.length ? Math.max(...runs) : 0,
    meanConsecutiveFiring: runs.length ? mean(runs) : null,
    meanBarsBetweenSignals: gaps.length ? mean(gaps) : null,
    medianBarsBetweenSignals: gaps.length ? median(gaps) : null,
  };
}
export function median(a) {
  const x = (a || []).filter(Number.isFinite).slice().sort((p, q) => p - q);
  if (!x.length) return null;
  const m = x.length / 2;
  return x.length % 2 ? x[Math.floor(m)] : (x[m - 1] + x[m]) / 2;
}

// ---- multi-strategy cohorts (spec §14) --------------------------------------
// A cohort = the SAME symbol, the SAME decision bar and >= 2 DISTINCT
// strategies producing valid candidates in that bar. Single-strategy decisions
// are counted but are NOT cohorts (they cannot compare strategy choice).
export function buildCohorts(signalsByStrategy) {
  const byBar = new Map();
  for (const [id, res] of Object.entries(signalsByStrategy)) {
    for (const s of res.signals || []) {
      const k = `${s.symbol}|${s.ts}`;
      if (!byBar.has(k)) byBar.set(k, { symbol: s.symbol, ts: s.ts, members: [] });
      byBar.get(k).members.push({ ...s, strategy_id: id });
    }
  }
  const cohorts = [...byBar.values()].filter((b) => new Set(b.members.map((m) => m.strategy_id)).size >= 2);
  cohorts.sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
  return cohorts;
}
export function summarizeCohorts(cohorts, barsWithSignal) {
  const size = (n) => cohorts.filter((c) => new Set(c.members.map((m) => m.strategy_id)).size === n).length;
  const fourPlus = cohorts.filter((c) => new Set(c.members.map((m) => m.strategy_id)).size >= 4).length;
  return {
    barsWithSignal,
    cohorts: cohorts.length,
    twoWay: size(2),
    threeWay: size(3),
    fourPlus,
    maxWidth: cohorts.reduce((a, c) => Math.max(a, new Set(c.members.map((m) => m.strategy_id)).size), 0),
    coFireRate: barsWithSignal > 0 ? cohorts.length / barsWithSignal : null,
  };
}

// ---- counterfactual outcome statistics (spec §15/§16) ------------------------
export function outcomeStats(rows, minSample = 8) {
  const res = rows.filter((r) => r.resolved && Number.isFinite(r.realized_R));
  const Rs = res.map((r) => r.realized_R);
  const out = {
    candidates: rows.length,
    resolved: res.length,
    unresolved: rows.length - res.length,
    sufficient: res.length >= minSample,
    n: res.length,
    meanR: res.length ? mean(Rs) : null,
    medianR: res.length ? median(Rs) : null,
    winRate: res.length ? Rs.filter((r) => r > 0).length / res.length : null,
    sdR: stdev(Rs),
    sumR: res.length ? Rs.reduce((a, b) => a + b, 0) : 0,
    meanMaeRoi: res.length ? mean(res.map((r) => r.mae_roi)) : null,
    meanMfeRoi: res.length ? mean(res.map((r) => r.mfe_roi)) : null,
    meanFeesUsd: res.length ? mean(res.map((r) => r.fees)) : null,
    maxDrawdownR: maxDrawdownR(res),
    exitReasons: countBy(res, (r) => r.exit_reason),
    bySide: groupStats(res, (r) => r.side, minSample),
    byTrend: groupStats(res, (r) => r.trendContext, minSample),
    byStrategy: groupStats(res, (r) => r.strategy_id, minSample),
    bySymbol: groupStats(res, (r) => r.symbol, minSample),
  };
  // "cost-adjusted" is explicit: net R already includes taker fees on both legs
  // and adverse slippage; funding is omitted (documented) so USD costs are also
  // reported for audit.
  out.costAdjusted = true;
  return out;
}
// Max drawdown of the cumulative R sequence in CHRONOLOGICAL order
// (R-space drawdown, not an equity curve).
export function maxDrawdownR(rows) {
  const ordered = rows.slice().sort((a, b) => (a.exitTs ?? a.decisionTs) - (b.exitTs ?? b.decisionTs));
  let cum = 0, peak = 0, dd = 0;
  for (const r of ordered) {
    cum += r.realized_R;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}
const countBy = (rows, fn) => rows.reduce((a, r) => { const k = fn(r); a[k] = (a[k] || 0) + 1; return a; }, {});
function groupStats(rows, keyFn, minSample) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r) ?? "unknown";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([key, rs]) => ({
    key, n: rs.length, meanR: mean(rs.map((x) => x.realized_R)),
    winRate: rs.filter((x) => x.realized_R > 0).length / rs.length,
    sufficient: rs.length >= minSample,
  })).sort((a, b) => a.key.localeCompare(b.key));
}
// Turnover: resolved candidates per calendar day of the fold (real, observable).
export function turnoverPerDay(rows, foldSpanMs) {
  const span = foldSpanMs && foldSpanMs[1] > foldSpanMs[0] ? (foldSpanMs[1] - foldSpanMs[0]) / 86400000 : null;
  if (!span || span <= 0) return null;
  return rows.filter((r) => r.resolved).length / span;
}

// ---- selection score (spec §6, componentForms) ------------------------------
// Composite of availability, diversity, co-firing, cost-adjusted quality,
// stability, minus a drawdown penalty. Volume alone can never win: availability
// is capped at 1 and penalised ABOVE maxCandidateRate (turnover/cost), quality
// is neutral (never rewarded) when the resolved sample is thin.
export function selectionScore(m, spec) {
  const O = spec.objective;
  const W = O.weights;
  const rate = m.frequency?.candidateRate ?? null;
  let availability = 0;
  if (rate != null && rate > 0) {
    availability = Math.min(1, rate / O.targetCandidateRate);
    if (rate > O.maxCandidateRate) availability *= O.maxCandidateRate / rate;
  }
  const symRatio = m.symbolsAvailable > 0 ? (m.frequency?.symbolsCovered ?? 0) / m.symbolsAvailable : 0;
  const sides = Object.keys(m.frequency?.perSide || {}).length;
  const sideCoverage = sides >= 2 ? 1 : sides === 1 ? 0.5 : 0;
  const trends = Object.keys(m.frequency?.perTrend || {}).filter((k) => k !== "trend_unknown").length;
  const trendCoverage = Math.min(1, trends / 2);
  const diversity = 0.5 * symRatio + 0.25 * sideCoverage + 0.25 * trendCoverage;
  const ctl = m.controlCoFireRate;
  const cf = m.coFireRate;
  const cofire = cf == null || ctl == null ? 0.5
    : clamp(0.5 + 0.5 * ((cf - ctl) / Math.max(ctl, 0.05)), 0, 1);
  const quality = m.outcomes?.sufficient
    ? clamp(0.5 + (m.outcomes.meanR ?? 0) / O.qualityWindowR, 0, 1)
    : O.qualityNeutral;
  const stability = m.stability ?? 0;
  const dd = m.outcomes?.maxDrawdownR ?? 0;
  const ddPenalty = O.drawdownPenaltyWeight * Math.min(1, dd / O.maxDrawdownR);
  const score = W.availability * availability + W.diversity * diversity + W.cofire * cofire
    + W.quality * quality + W.stability * stability - ddPenalty;
  return {
    score: round6(score),
    components: {
      availability: round6(availability), diversity: round6(diversity), cofire: round6(cofire),
      quality: round6(quality), qualitySource: m.outcomes?.sufficient ? "resolved-sample" : "neutral-thin-sample",
      stability: round6(stability), drawdownPenalty: round6(ddPenalty),
      candidateRate: rate, coFireRate: cf, controlCoFireRate: ctl, maxDrawdownR: dd,
      sideCoverage: round6(sideCoverage), trendCoverage: round6(trendCoverage), symbolCoverage: round6(symRatio),
    },
  };
}
const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);

// Fraction of chronological sub-folds in which the configuration produced at
// least one candidate: "does it fire across time", not "does it fire a lot".
export function stabilityAcrossFolds(perFoldFrequencies) {
  const folds = perFoldFrequencies.filter(Boolean);
  if (!folds.length) return 0;
  return folds.filter((f) => (f.signals ?? 0) > 0).length / folds.length;
}
export function foldSlices(bounds, folds) {
  const [a, b] = bounds;
  const out = [];
  const size = Math.floor((b - a) / folds);
  for (let k = 0; k < folds; k++) {
    const s = a + k * size;
    const e = k === folds - 1 ? b : s + size;
    if (e > s) out.push([s, e]);
  }
  return out;
}

// ---- learner A/B on offline cohorts (spec §18) ------------------------------
// The SAME learner code (learning.mjs) is replayed on offline cohorts with an
// EMPTY store: no live learner file is read and nothing is written. The context
// "regime" dimension is the offline trend PROXY (historical engine regime
// labels do not exist offline), which is reported as such.
export function learnerAB({ cohorts, L, minCohorts }) {
  const usable = cohorts
    .filter((c) => c.members.some((m) => Number.isFinite(m.realized_R)))
    .map((c) => ({ ...c, members: c.members.filter((m) => Number.isFinite(m.realized_R)) }))
    .sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
  if (usable.length < minCohorts) {
    return { ran: false, reason: `cohorts with resolved outcomes ${usable.length} < required ${minCohorts}`, cohorts: usable.length };
  }
  const store = emptyLearning();
  const pending = usable.flatMap((c) => c.members.map((m) => ({ ...m })))
    .sort((a, b) => (a.exitTs ?? a.decisionTs) - (b.exitTs ?? b.decisionTs) || a.strategy_id.localeCompare(b.strategy_id));
  let p = 0;
  const acc = {
    decisions: 0, withAlternatives: 0, abstentions: 0, beatsBest: 0, beatsAvg: 0,
    regret: [], pickedR: [], picks: {}, switches: 0, lastPick: null,
  };
  for (const c of usable) {
    while (p < pending.length && (pending[p].exitTs ?? pending[p].decisionTs) <= c.ts) {
      const m = pending[p];
      recordExperience(store, { regime: m.trendContext, side: m.side, strategy: m.strategy_id, symbol: m.symbol },
        m.realized_R, { ts_close: m.exitTs }, L);
      p += 1;
    }
    const { best, abstain } = rankCandidates(c.members.map((m) => ({
      order: { strategy_id: m.strategy_id },
      ctx: { regime: m.trendContext, side: m.side, strategy: m.strategy_id, symbol: m.symbol },
      baseScore: m.confidence,
    })), store, L);
    acc.decisions += 1;
    if (abstain || !best) { acc.abstentions += 1; continue; }
    const picked = c.members.find((m) => m.strategy_id === best.order.strategy_id);
    if (!picked) continue;
    acc.picks[picked.strategy_id] = (acc.picks[picked.strategy_id] || 0) + 1;
    if (acc.lastPick && acc.lastPick !== picked.strategy_id) acc.switches += 1;
    acc.lastPick = picked.strategy_id;
    acc.pickedR.push(picked.realized_R);
    const alt = c.members.filter((m) => m.strategy_id !== picked.strategy_id);
    if (alt.length) {
      const Rs = alt.map((m) => m.realized_R);
      const bestA = Math.max(...Rs);
      const avgA = mean(Rs);
      acc.withAlternatives += 1;
      acc.beatsBest += picked.realized_R >= bestA ? 1 : 0;
      acc.beatsAvg += picked.realized_R >= avgA ? 1 : 0;
      acc.regret.push(picked.realized_R - bestA);
    }
  }
  return {
    ran: true,
    cohorts: usable.length,
    decisions: acc.decisions,
    withAlternatives: acc.withAlternatives,
    sufficient: acc.withAlternatives >= minCohorts,
    abstentions: acc.abstentions,
    beatBestRate: acc.withAlternatives ? acc.beatsBest / acc.withAlternatives : null,
    beatAvgRate: acc.withAlternatives ? acc.beatsAvg / acc.withAlternatives : null,
    meanRegret: acc.regret.length ? mean(acc.regret) : null,
    pickedMeanR: acc.pickedR.length ? mean(acc.pickedR) : null,
    pickedN: acc.pickedR.length,
    switches: acc.switches,
    picks: acc.picks,
    learningCells: Object.keys(store.cells).length,
    learningExperiences: store.experiences || 0,
    minCohorts,
    note: "offline proxy context (trend bucket replaces the engine regime label); same learner code, empty store, no live contamination",
  };
}

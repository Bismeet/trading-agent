// scripts/v2/geometry-metrics.mjs — Phase 6 §10..§17 measurement layer.
//
// Pure functions over the geometry dataset produced by geometry-run.mjs. No file
// access, no randomness, no live state. Everything that could be mistaken for a
// claim is sample-gated: below the pre-registered sufficiency thresholds a metric
// is returned as null (printed INSUFFICIENT) and NEVER as 0.
import { mean, stdev, profitFactor } from "./store.mjs";

export const INSUFFICIENT = "INSUFFICIENT";

export function median(xs) {
  const a = (xs || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function quantile(xs, p) {
  const a = (xs || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[idx];
}
// R-space drawdown in CHRONOLOGICAL order (a diagnostic of the metric sequence,
// not a portfolio equity curve).
export function maxDrawdownR(rows, key = "realized_R") {
  const ordered = rows.filter((r) => Number.isFinite(r[key]))
    .slice().sort((a, b) => (a.exitTs ?? a.ts) - (b.exitTs ?? b.ts));
  let cum = 0, peak = 0, dd = 0;
  for (const r of ordered) { cum += r[key]; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return dd;
}
export const countBy = (rows, fn) => rows.reduce((a, r) => { const k = String(fn(r)); a[k] = (a[k] || 0) + 1; return a; }, {});
const share = (n, d) => (d > 0 ? n / d : null);

// ---- §10 three-layer reward + §13 exit mix + §11/§12 excursions --------------
// `minSample` is the pre-registered sufficiency threshold from the spec.
export function geometryStats(rows, minSample) {
  const all = rows || [];
  const res = all.filter((r) => r.resolved && Number.isFinite(r.net_pnl_usd));
  const n = res.length;
  const R = res.map((r) => r.realized_R);
  const Rown = res.map((r) => r.realized_R_own);
  const gross = res.map((r) => r.gross_pnl_usd);
  const grossRef = res.map((r) => r.grossRef_pnl_usd);
  const net = res.map((r) => r.net_pnl_usd);
  const raw = res.map((r) => r.raw_ret_pct);
  const fees = res.map((r) => r.fees_usd);
  const slip = res.map((r) => r.spread_slip_usd);
  const sufficient = n >= minSample;
  const exits = countBy(res, (r) => r.exit_reason);
  const held = res.filter((r) => Number.isFinite(r.hold_secs));
  return {
    configuration: res[0]?.config ?? all[0]?.config ?? null,
    candidates: all.length,
    resolved: n,
    unresolved: all.length - n,
    sufficient,
    n,
    // §10 raw price edge (market movement only: no fills, no fees)
    meanRawRetPct: sufficient ? mean(raw) : null,
    medianRawRetPct: sufficient ? median(raw) : null,
    rawWinRate: sufficient ? share(raw.filter((x) => x > 0).length, n) : null,
    // §10 gross (adverse fills included, fees excluded) and net (after fees)
    meanGrossRefUsd: sufficient ? mean(grossRef) : null,
    meanGrossUsd: sufficient ? mean(gross) : null,
    meanNetUsd: sufficient ? mean(net) : null,
    // §10 costs
    meanFeesUsd: sufficient ? mean(fees) : null,
    meanSpreadSlipUsd: sufficient ? mean(slip) : null,
    meanCostUsd: sufficient ? mean(res.map((r) => (r.fees_usd ?? 0) + (r.spread_slip_usd ?? 0))) : null,
    meanBreakEvenMovePct: sufficient ? mean(res.map((r) => r.break_even_move_pct)) : null,
    // primary cross-geometry comparable unit + own-risk unit
    meanR: sufficient ? mean(R) : null,
    medianR: sufficient ? median(R) : null,
    winRate: sufficient ? share(R.filter((x) => x > 0).length, n) : null,
    sdR: sufficient ? stdev(R) : null,
    sumR: sufficient ? R.reduce((a, b) => a + b, 0) : null,
    profitFactor: sufficient ? profitFactor(R) : null,
    meanROwn: sufficient ? mean(Rown) : null,
    meanRoiOnMargin: sufficient ? mean(res.map((r) => r.roi_on_margin)) : null,
    maxDrawdownR: sufficient ? maxDrawdownR(res) : null,
    // §11/§12 excursions, normalised by the CONTROL risk unit (horizon = 24h)
    meanMfeR: sufficient ? mean(res.map((r) => r.horizon_mfe_R)) : null,
    medianMfeR: sufficient ? median(res.map((r) => r.horizon_mfe_R)) : null,
    meanMaeR: sufficient ? mean(res.map((r) => r.horizon_mae_R)) : null,
    medianMaeR: sufficient ? median(res.map((r) => r.horizon_mae_R)) : null,
    meanMfeRoi: sufficient ? mean(res.map((r) => r.mfe_roi)) : null,
    meanMaeRoi: sufficient ? mean(res.map((r) => r.mae_roi)) : null,
    // §13 exit composition
    exits,
    timeStopRate: share(exits["time-stop"] || 0, n),
    stopRate: share(exits["stop-loss"] || 0, n),
    targetRate: share(exits["take-profit"] || 0, n),
    trailingRate: share(exits["trailing-stop"] || 0, n),
    liquidationRate: share(exits["liquidation"] || 0, n),
    meanHoldHours: held.length ? mean(held.map((r) => r.hold_secs / 3600)) : null,
    // §11 time-to-event medians (hours, along this geometry's own path)
    medianTimeToTargetH: median(res.map((r) => r.time_to_event?.target_h)),
    medianTimeToStopH: median(res.map((r) => r.time_to_event?.stop_h)),
    byStrategy: groupStats(res, (r) => r.strategy_id, minSample),
    bySide: groupStats(res, (r) => r.side, minSample),
    bySymbol: groupStats(res, (r) => r.symbol, minSample),
    byTrend: groupStats(res, (r) => r.trendContext, minSample),
  };
}

export function groupStats(rows, keyFn, minSample) {
  const groups = new Map();
  for (const r of rows) {
    const k = String(keyFn(r) ?? "unknown");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const R = rs.map((x) => x.realized_R);
    const ok = rs.length >= minSample;
    return {
      key, n: rs.length, sufficient: ok,
      meanR: ok ? mean(R) : null,
      medianR: ok ? median(R) : null,
      winRate: ok ? share(R.filter((x) => x > 0).length, rs.length) : null,
      meanRawRetPct: ok ? mean(rs.map((x) => x.raw_ret_pct)) : null,
      meanNetUsd: ok ? mean(rs.map((x) => x.net_pnl_usd)) : null,
      meanMfeR: ok ? mean(rs.map((x) => x.horizon_mfe_R)) : null,
      meanMaeR: ok ? mean(rs.map((x) => x.horizon_mae_R)) : null,
      timeStopRate: share(rs.filter((x) => x.exit_reason === "time-stop").length, rs.length),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

// ---- §15 holding-period curve ------------------------------------------------
// For EVERY resolved candidate, measure the reward along that trade's OWN path at
// each pre-registered horizon. A stop/target first touch before the horizon is
// honoured (the trade really would have ended there), so the curve is a real
// strategy-at-horizon view, not a mark-to-market fantasy.
export function holdingPeriodCurve(rows, spec) {
  const horizons = spec.diagnostics.timeToEventHours;
  const minSample = spec.sufficiency.minResolvedForStrategyClaim;
  return horizons.map((h) => {
    const key = `h${h}`;
    const usable = rows.filter((r) => r.resolved && r.horizons && r.horizons[key] && r.horizons[key].censored !== true && Number.isFinite(r.horizons[key].net_pnl_usd));
    const censored = rows.filter((r) => r.horizons?.[key]?.censored === true).length;
    const net = usable.map((r) => r.horizons[key].net_pnl_usd);
    const R = usable.map((r) => r.horizons[key].net_pnl_usd / r.risk_ctrl_usd);
    const ok = usable.length >= minSample;
    return {
      horizonHours: h,
      evaluated: rows.filter((r) => r.resolved).length,
      usable: usable.length,
      censored,
      sufficient: ok,
      meanGrossUsd: ok ? mean(usable.map((r) => r.horizons[key].gross_pnl_usd)) : null,
      meanNetUsd: ok ? mean(net) : null,
      meanR: ok ? mean(R) : null,
      medianR: ok ? median(R) : null,
      meanRawRetPct: ok ? mean(usable.map((r) => r.horizons[key].raw_ret_pct)) : null,
      winRate: ok ? share(net.filter((x) => x > 0).length, net.length) : null,
      meanCostUsd: ok ? mean(usable.map((r) => r.horizons[key].fees_usd + r.horizons[key].spread_slip_usd)) : null,
      meanMfeR: ok ? mean(usable.map((r) => r.horizons[key].mfe_R)) : null,
      meanMaeR: ok ? mean(usable.map((r) => r.horizons[key].mae_R)) : null,
      targetHitRate: share(usable.filter((r) => r.horizons[key].exit_reason === "take-profit").length, usable.length),
      stopHitRate: share(usable.filter((r) => r.horizons[key].exit_reason === "stop-loss").length, usable.length),
      timeStopRate: share(usable.filter((r) => r.horizons[key].exit_reason === "time-stop").length, usable.length),
    };
  });
}

// ---- §16 risk/reward curve ---------------------------------------------------
export function riskRewardCurve(rowsByConfig, spec) {
  const minSample = spec.sufficiency.minResolvedForStrategyClaim;
  return [...rowsByConfig.entries()].map(([config, rows]) => {
    const s = geometryStats(rows, minSample);
    return {
      configuration: config, n: s.n, sufficient: s.sufficient,
      meanR: s.meanR, medianR: s.medianR, winRate: s.winRate, profitFactor: s.profitFactor,
      maxDrawdownR: s.maxDrawdownR, meanCostUsd: s.meanCostUsd, meanBreakEvenMovePct: s.meanBreakEvenMovePct,
      timeStopRate: s.timeStopRate, stopRate: s.stopRate, targetRate: s.targetRate, trailingRate: s.trailingRate,
      meanRawRetPct: s.meanRawRetPct, meanGrossRefUsd: s.meanGrossRefUsd, meanNetUsd: s.meanNetUsd,
    };
  });
}

// ---- §17 strategy x geometry matrix -----------------------------------------
export function strategyGeometryMatrix(rowsByConfig, strategies, minSample) {
  const out = {};
  for (const id of strategies) {
    out[id] = {};
    for (const [config, rows] of rowsByConfig.entries()) {
      const rs = rows.filter((r) => r.strategy_id === id && r.resolved && Number.isFinite(r.net_pnl_usd));
      const ok = rs.length >= minSample;
      out[id][config] = {
        n: rs.length, sufficient: ok,
        meanR: ok ? mean(rs.map((r) => r.realized_R)) : null,
        meanRawRetPct: ok ? mean(rs.map((r) => r.raw_ret_pct)) : null,
        timeStopRate: share(rs.filter((r) => r.exit_reason === "time-stop").length, rs.length),
      };
    }
  }
  return out;
}

// ---- §18 stability across chronological sub-folds ----------------------------
export function stabilityAcrossFolds(rows, folds) {
  if (!folds || folds < 1) return null;
  const span = rows.length ? [Math.min(...rows.map((r) => r.ts)), Math.max(...rows.map((r) => r.ts))] : null;
  if (!span || span[1] <= span[0]) return null;
  const size = (span[1] - span[0]) / folds;
  const buckets = new Array(folds).fill(null).map(() => []);
  for (const r of rows) {
    const k = Math.min(folds - 1, Math.floor(((r.ts - span[0]) / size) || 0));
    buckets[k].push(r);
  }
  const means = buckets.map((b) => {
    const R = b.filter((r) => r.resolved && Number.isFinite(r.realized_R)).map((r) => r.realized_R);
    return R.length >= 10 ? mean(R) : null;
  });
  const usable = means.filter((m) => m != null);
  if (usable.length < 2) return { folds, means, stable: null, positiveFolds: usable.filter((m) => m > 0).length, usable: usable.length };
  return {
    folds, means,
    positiveFolds: usable.filter((m) => m > 0).length,
    usable: usable.length,
    stable: usable.filter((m) => m > 0).length / usable.length,
    spread: Math.max(...usable) - Math.min(...usable),
  };
}

// ---- §16/§18 objective (spec.objective) --------------------------------------
// Availability is capped at 1 = parity with CONTROL, so a geometry can NEVER earn
// score by generating more trades than CONTROL. Thin samples score neutral.
export function geometryScore(stats, spec) {
  const O = spec.objective;
  const W = O.weights;
  const edge = stats.sufficient ? clamp01(0.5 + (stats.meanR ?? 0) / O.qualityWindowR) : O.qualityNeutral;
  const stability = stats.stability == null ? O.qualityNeutral : clamp01(stats.stability);
  const availability = clamp01(stats.availabilityRatio);
  const costEfficiency = stats.sufficient
    ? clamp01(1 - (stats.meanCostUsd ?? O.costCapUsd) / O.costCapUsd)
    : O.qualityNeutral;
  const dd = stats.maxDrawdownR ?? 0;
  const ddPenalty = O.drawdownPenaltyWeight * Math.min(1, dd / O.maxDrawdownR);
  const score = W.edge * edge + W.stability * stability + W.availability * availability + W.costEfficiency * costEfficiency - ddPenalty;
  return {
    score: round6(score),
    components: {
      edge: round6(edge), stability: round6(stability), availability: round6(availability),
      costEfficiency: round6(costEfficiency), drawdownPenalty: round6(ddPenalty),
      edgeSource: stats.sufficient ? "resolved-sample" : "neutral-thin-sample",
      availabilityRatio: stats.availabilityRatio, meanR: stats.meanR, maxDrawdownR: stats.maxDrawdownR,
    },
  };
}
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);

// Deterministic ranking: score desc, then configuration id asc. The preferred
// (CONTROL) id is only consulted when scores tie exactly.
export function rankConfigurations(entries, preferred) {
  return entries.slice().sort((a, b) => {
    const scoreA = typeof a.score === "object" ? (a.score?.score ?? a.score?.total) : a.score;
    const scoreB = typeof b.score === "object" ? (b.score?.score ?? b.score?.total) : b.score;
    if (scoreB !== scoreA) return (scoreB ?? 0) - (scoreA ?? 0);
    if (a.id === preferred) return -1;
    if (b.id === preferred) return 1;
    return a.id.localeCompare(b.id);
  });
}

// ---- §18 pre-registered validation gate -------------------------------------
// Returns {chosen, reason, gate[]}. Failures are reported, never hidden.
export function validationGate({ winner, control, spec, winnerKey, controlKey }) {
  const G = spec.validationGate;
  const gate = [];
  const fail = (code, detail) => gate.push({ check: code, pass: false, detail });
  const pass = (code, detail) => gate.push({ check: code, pass: true, detail });
  if (!winner || winner.id === controlKey) {
    return { chosen: "CONTROL", reason: winner ? "CONTROL scored at least as well as every experimental geometry on TRAIN" : "no geometry qualified on TRAIN", gate };
  }
  const w = winner.stats, c = control.stats;
  if ((w.resolved ?? 0) < G.minTrainResolved) fail("minTrainResolved", `${w.resolved} < ${G.minTrainResolved}`);
  else pass("minTrainResolved", `${w.resolved}`);
  if ((winner.validation?.resolved ?? 0) < G.minValidationResolved) fail("minValidationResolved", `${winner.validation?.resolved} < ${G.minValidationResolved}`);
  else pass("minValidationResolved", `${winner.validation?.resolved}`);
  const thin = Object.entries(winner.validation?.byStrategy ?? {})
    .filter(([, s]) => s.n < G.minValidationResolvedPerStrategy).map(([k, s]) => `${k}:${s.n}`);
  if (thin.length) fail("minValidationResolvedPerStrategy", `thin: ${thin.join(",")} (min ${G.minValidationResolvedPerStrategy})`);
  else pass("minValidationResolvedPerStrategy", `${Object.keys(winner.validation?.byStrategy ?? {}).length} strategies`);
  const cValResolved = control.validation?.resolved ?? c.resolved;
  const avail = cValResolved > 0 ? (winner.validation?.resolved ?? 0) / cValResolved : null;
  if (avail == null || avail < G.minAvailabilityRatioVsControl) fail("availabilityFloor", `validation availability ${avail == null ? "INSUFFICIENT" : avail.toFixed(3)} < ${G.minAvailabilityRatioVsControl}`);
  else pass("availabilityFloor", avail.toFixed(3));
  const dv = (winner.validation?.meanR ?? 0) - (control.validation?.meanR ?? c.meanR ?? 0);
  if (dv < -G.qualityToleranceR) fail("qualityCollapse", `validation dR ${dv.toFixed(4)} < -${G.qualityToleranceR}`);
  else pass("qualityCollapse", `validation dR ${dv.toFixed(4)}`);
  const ddCap = Math.max(((control.validation?.maxDrawdownR ?? c.maxDrawdownR) ?? 0) * G.maxDrawdownMultipleVsControl, G.drawdownFloorR);
  if (winner.validation?.maxDrawdownR == null) fail("drawdown", "validation drawdown INSUFFICIENT");
  else if (winner.validation.maxDrawdownR > ddCap) fail("drawdown", `${winner.validation.maxDrawdownR.toFixed(2)} > ${ddCap.toFixed(2)}`);
  else pass("drawdown", `${winner.validation.maxDrawdownR.toFixed(2)} <= ${ddCap.toFixed(2)}`);
  const stab = typeof winner.stats.stability === "object" ? (winner.stats.stability?.stable ?? 0) : (winner.stats.stability ?? 0);
  if (stab < G.minStableFolds / spec.objective.stabilityFolds) fail("stability", `stable folds ${stab} < ${G.minStableFolds}/${spec.objective.stabilityFolds}`);
  else pass("stability", `${stab}`);
  const winnerScoreVal = typeof winner.score === "object" ? (winner.score?.score ?? winner.score?.total) : winner.score;
  const controlScoreVal = typeof control.score === "object" ? (control.score?.score ?? control.score?.total) : control.score;
  if (G.requireScoreNotWorse && !(winnerScoreVal > controlScoreVal)) fail("scoreNotWorse", `score ${winnerScoreVal} <= CONTROL ${controlScoreVal}`);
  else pass("scoreNotWorse", `${winnerScoreVal} > ${controlScoreVal}`);
  const failed = gate.filter((g) => !g.pass);
  return failed.length
    ? { chosen: "CONTROL", reason: `TRAIN winner ${winner.id} REJECTED by validation gate: ${failed.map((f) => f.check).join(", ")}`, gate }
    : { chosen: winner.id, reason: `TRAIN winner ${winner.id} passed every pre-registered validation gate`, gate };
}



// ---- streaming accumulators (used by geometry-run.mjs) ------------------------
// The search resolves ~10^6 candidate x geometry combinations. Retaining full row
// objects for all of them would exhaust memory, so outcomes are folded into an
// accumulator as they are produced and the accumulator is converted to exactly
// the same shape as geometryStats() (tests assert the two agree).
function newGroup() {
  return { n: 0, sumR: 0, sumRaw: 0, sumNet: 0, sumMfeR: 0, sumMaeR: 0, wins: 0, tStops: 0, Rs: [] };
}
const groupPush = (g, r) => {
  g.n += 1;
  g.sumR += r.realized_R ?? 0;
  g.sumRaw += r.raw_ret_pct ?? 0;
  g.sumNet += r.net_pnl_usd ?? 0;
  g.sumMfeR += r.horizon_mfe_R ?? 0;
  g.sumMaeR += r.horizon_mae_R ?? 0;
  if ((r.realized_R ?? 0) > 0) g.wins += 1;
  if (r.exit_reason === "time-stop") g.tStops += 1;
  g.Rs.push(r.realized_R ?? 0);
};
const groupOut = (key, g, minSample) => ({
  key, n: g.n, sufficient: g.n >= minSample,
  meanR: g.n >= minSample ? g.sumR / g.n : null,
  medianR: g.n >= minSample ? median(g.Rs) : null,
  winRate: g.n >= minSample ? share(g.wins, g.n) : null,
  meanRawRetPct: g.n >= minSample ? g.sumRaw / g.n : null,
  meanNetUsd: g.n >= minSample ? g.sumNet / g.n : null,
  meanMfeR: g.n >= minSample ? g.sumMfeR / g.n : null,
  meanMaeR: g.n >= minSample ? g.sumMaeR / g.n : null,
  timeStopRate: g.n ? share(g.tStops, g.n) : null,
});

export function makeAccumulator(configName) {
  return {
    configuration: configName, candidates: 0, resolved: 0, n: 0,
    arrays: { raw: [], R: [], Rown: [], mfeR: [], maeR: [], tTarget: [], tStop: [], hold: [], be: [] },
    sums: { grossRef: 0, gross: 0, net: 0, fees: 0, slip: 0, cost: 0, roi: 0, mfeRoi: 0, maeRoi: 0 },
    exits: {}, min: [],
    groups: { strategy_id: new Map(), side: new Map(), symbol: new Map(), trendContext: new Map() },
  };
}
export function accPush(acc, r) {
  acc.candidates += 1;
  if (!r.resolved || !Number.isFinite(r.net_pnl_usd)) return;
  const A = acc.arrays, S = acc.sums;
  acc.resolved += 1; acc.n += 1;
  A.raw.push(r.raw_ret_pct); A.R.push(r.realized_R); A.Rown.push(r.realized_R_own);
  A.mfeR.push(r.horizon_mfe_R); A.maeR.push(r.horizon_mae_R);
  if (Number.isFinite(r.time_to_event?.target_h)) A.tTarget.push(r.time_to_event.target_h);
  if (Number.isFinite(r.time_to_event?.stop_h)) A.tStop.push(r.time_to_event.stop_h);
  if (Number.isFinite(r.hold_secs)) A.hold.push(r.hold_secs / 3600);
  A.be.push(r.break_even_move_pct);
  S.grossRef += r.grossRef_pnl_usd ?? 0; S.gross += r.gross_pnl_usd ?? 0; S.net += r.net_pnl_usd;
  S.fees += r.fees_usd ?? 0; S.slip += r.spread_slip_usd ?? 0;
  S.cost += (r.fees_usd ?? 0) + (r.spread_slip_usd ?? 0);
  S.roi += r.roi_on_margin ?? 0; S.mfeRoi += r.mfe_roi ?? 0; S.maeRoi += r.mae_roi ?? 0;
  acc.exits[r.exit_reason] = (acc.exits[r.exit_reason] || 0) + 1;
  acc.min.push({ ts: r.ts, exitTs: r.exitTs ?? r.ts, resolved: true, realized_R: r.realized_R, strategy_id: r.strategy_id });
  for (const [gkey, field] of [["strategy_id", "strategy_id"], ["side", "side"], ["symbol", "symbol"], ["trendContext", "trendContext"]]) {
    const m = acc.groups[gkey];
    const k = String(r[field] ?? "unknown");
    if (!m.has(k)) m.set(k, newGroup());
    groupPush(m.get(k), r);
  }
}
export function accStats(acc, minSample) {
  const A = acc.arrays, S = acc.sums, n = acc.n;
  const ok = n >= minSample;
  const div = (x) => (ok && n ? x / n : null);
  const R = A.R.filter(Number.isFinite);
  return {
    configuration: acc.configuration,
    candidates: acc.candidates, resolved: acc.resolved, unresolved: acc.candidates - acc.resolved,
    sufficient: ok, n,
    meanRawRetPct: div(A.raw.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)),
    medianRawRetPct: ok ? median(A.raw) : null,
    rawWinRate: ok ? share(A.raw.filter((x) => Number.isFinite(x) && x > 0).length, n) : null,
    meanGrossRefUsd: div(S.grossRef), meanGrossUsd: div(S.gross), meanNetUsd: div(S.net),
    meanFeesUsd: div(S.fees), meanSpreadSlipUsd: div(S.slip), meanCostUsd: div(S.cost),
    meanBreakEvenMovePct: ok ? median(A.be) : null,
    meanR: div(R.reduce((a, b) => a + b, 0)), medianR: ok ? median(A.R) : null,
    winRate: ok ? share(R.filter((x) => x > 0).length, R.length || n) : null,
    sdR: ok ? stdev(A.R) : null,
    sumR: ok ? R.reduce((a, b) => a + b, 0) : null,
    profitFactor: ok ? profitFactor(A.R) : null,
    meanROwn: div(A.Rown.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)),
    meanRoiOnMargin: div(S.roi),
    maxDrawdownR: ok ? maxDrawdownR(acc.min) : null,
    meanMfeR: ok ? mean(A.mfeR) : null, medianMfeR: ok ? median(A.mfeR) : null,
    meanMaeR: ok ? mean(A.maeR) : null, medianMaeR: ok ? median(A.maeR) : null,
    meanMfeRoi: div(S.mfeRoi), meanMaeRoi: div(S.maeRoi),
    exits: acc.exits,
    timeStopRate: share(acc.exits["time-stop"] || 0, n),
    stopRate: share(acc.exits["stop-loss"] || 0, n),
    targetRate: share(acc.exits["take-profit"] || 0, n),
    trailingRate: share(acc.exits["trailing-stop"] || 0, n),
    liquidationRate: share(acc.exits["liquidation"] || 0, n),
    meanHoldHours: n && A.hold.length ? mean(A.hold) : null,
    medianTimeToTargetH: median(A.tTarget), medianTimeToStopH: median(A.tStop),
    byStrategy: [...acc.groups.strategy_id.entries()].map(([k, g]) => groupOut(k, g, minSample)).sort((a, b) => a.key.localeCompare(b.key)),
    bySide: [...acc.groups.side.entries()].map(([k, g]) => groupOut(k, g, minSample)).sort((a, b) => a.key.localeCompare(b.key)),
    bySymbol: [...acc.groups.symbol.entries()].map(([k, g]) => groupOut(k, g, minSample)).sort((a, b) => a.key.localeCompare(b.key)),
    byTrend: [...acc.groups.trendContext.entries()].map(([k, g]) => groupOut(k, g, minSample)).sort((a, b) => a.key.localeCompare(b.key)),
  };
}



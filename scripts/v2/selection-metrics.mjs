// scripts/v2/selection-metrics.mjs — Phase 7 §7, §8, §10, §11, §16, §18.
//
// Metrics, streaming accumulators, single-feature bucketing, validation gating,
// and offline learner evaluation for Phase 7 trade selection.
import { mean, stdev, profitFactor } from "./store.mjs";
import { emptyLearning, rankCandidates, recordExperience } from "./learning.mjs";

export const INSUFFICIENT = "INSUFFICIENT";

// ---- Accumulator for trade outcomes -----------------------------------------
export function makeSelectionAccumulator(id = "acc") {
  return {
    id,
    candidates: 0,
    accepted: 0,
    rejected: 0,
    resolved: 0,
    unresolved: 0,
    Rs: [],
    rawRets: [],
    grossUsds: [],
    netUsds: [],
    feesUsds: [],
    costsUsds: [],
    mfeRs: [],
    maeRs: [],
    holdHours: [],
    exits: {
      "time-stop": 0,
      "stop-loss": 0,
      "take-profit": 0,
      "trailing-stop": 0,
      liquidation: 0,
      other: 0,
    },
    byStrategy: {},
    bySide: { long: [], short: [] },
    byRegime: {},
    byAgreement: {},
    folds: [0, 0, 0, 0].map(() => []),
  };
}

export function accPushCandidate(acc, cand, take) {
  acc.candidates += 1;
  if (take) {
    acc.accepted += 1;
  } else {
    acc.rejected += 1;
  }
}

export function accPushResolved(acc, r, subFoldIdx = null) {
  acc.resolved += 1;
  const netR = r.realized_R ?? 0;
  acc.Rs.push(netR);
  acc.rawRets.push(r.raw_ret_pct ?? 0);
  acc.grossUsds.push(r.gross_pnl_usd ?? 0);
  acc.netUsds.push(r.net_pnl_usd ?? 0);
  acc.feesUsds.push(r.fees_usd ?? 0);
  acc.costsUsds.push((r.fees_usd ?? 0) + (r.spread_slip_usd ?? 0));
  if (Number.isFinite(r.mfe_R)) acc.mfeRs.push(r.mfe_R);
  if (Number.isFinite(r.mae_R)) acc.maeRs.push(r.mae_R);
  if (Number.isFinite(r.holdHours)) acc.holdHours.push(r.holdHours);

  const ex = r.exit_reason || "other";
  acc.exits[ex] = (acc.exits[ex] || 0) + 1;

  const strat = r.strategy_id || "unknown";
  if (!acc.byStrategy[strat]) acc.byStrategy[strat] = [];
  acc.byStrategy[strat].push(netR);

  const side = r.side || "unknown";
  if (!acc.bySide[side]) acc.bySide[side] = [];
  acc.bySide[side].push(netR);

  const regime = r.trendContext || "unknown";
  if (!acc.byRegime[regime]) acc.byRegime[regime] = [];
  acc.byRegime[regime].push(netR);

  const agree = r.strategy_agreement_count ?? 0;
  const agreeKey = agree >= 2 ? "2+" : String(agree);
  if (!acc.byAgreement[agreeKey]) acc.byAgreement[agreeKey] = [];
  acc.byAgreement[agreeKey].push(netR);

  if (subFoldIdx != null && subFoldIdx >= 0 && subFoldIdx < 4) {
    acc.folds[subFoldIdx].push(netR);
  }
}

// ---- Chronological max drawdown in R-multiple -------------------------------
export function calcMaxDrawdownR(Rs) {
  if (!Rs.length) return 0;
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (let i = 0; i < Rs.length; i++) {
    cum += Rs[i];
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ---- Summary statistics from accumulator ------------------------------------
export function summarizeSelection(acc, minResolved = 100) {
  const n = acc.resolved;
  const sufficient = n >= minResolved;
  const Rs = acc.Rs;

  const meanR = n > 0 ? mean(Rs) : null;
  const medianR = n > 0 ? medianVal(Rs) : null;
  const winCount = Rs.filter((x) => x > 0).length;
  const winRate = n > 0 ? winCount / n : null;
  const sdR = n > 1 ? stdev(Rs) : null;
  const sumR = Rs.reduce((a, b) => a + b, 0);

  const meanMfeR = acc.mfeRs.length > 0 ? mean(acc.mfeRs) : null;
  const meanMaeR = acc.maeRs.length > 0 ? mean(acc.maeRs) : null;
  const mfeMaeRatio = (meanMfeR != null && meanMaeR != null && meanMaeR !== 0)
    ? Math.abs(meanMfeR / meanMaeR)
    : null;

  const meanCost = acc.costsUsds.length > 0 ? mean(acc.costsUsds) : null;
  const meanNetUsd = acc.netUsds.length > 0 ? mean(acc.netUsds) : null;
  const meanGrossUsd = acc.grossUsds.length > 0 ? mean(acc.grossUsds) : null;
  const meanRawRet = acc.rawRets.length > 0 ? mean(acc.rawRets) : null;
  const meanHold = acc.holdHours.length > 0 ? mean(acc.holdHours) : null;

  const timeStopRate = n > 0 ? (acc.exits["time-stop"] || 0) / n : null;
  const stopRate = n > 0 ? (acc.exits["stop-loss"] || 0) / n : null;
  const targetRate = n > 0 ? (acc.exits["take-profit"] || 0) / n : null;
  const trailingRate = n > 0 ? (acc.exits["trailing-stop"] || 0) / n : null;

  const maxDrawdownR = calcMaxDrawdownR(Rs);
  const pf = n > 0 ? profitFactor(acc.netUsds) : null;

  const acceptedRate = acc.candidates > 0 ? acc.accepted / acc.candidates : 0;
  const rejectionRate = acc.candidates > 0 ? acc.rejected / acc.candidates : 0;

  // Stratified summaries
  const stratSummary = {};
  for (const [k, arr] of Object.entries(acc.byStrategy)) {
    stratSummary[k] = {
      n: arr.length,
      meanR: arr.length ? mean(arr) : null,
      winRate: arr.length ? arr.filter((x) => x > 0).length / arr.length : null,
    };
  }

  const sideSummary = {};
  for (const [k, arr] of Object.entries(acc.bySide)) {
    sideSummary[k] = {
      n: arr.length,
      meanR: arr.length ? mean(arr) : null,
      winRate: arr.length ? arr.filter((x) => x > 0).length / arr.length : null,
    };
  }

  const regimeSummary = {};
  for (const [k, arr] of Object.entries(acc.byRegime)) {
    regimeSummary[k] = {
      n: arr.length,
      meanR: arr.length ? mean(arr) : null,
      winRate: arr.length ? arr.filter((x) => x > 0).length / arr.length : null,
    };
  }

  const agreementSummary = {};
  for (const [k, arr] of Object.entries(acc.byAgreement)) {
    agreementSummary[k] = {
      n: arr.length,
      meanR: arr.length ? mean(arr) : null,
      winRate: arr.length ? arr.filter((x) => x > 0).length / arr.length : null,
    };
  }

  const subFoldMeans = acc.folds.map((f) => (f.length >= 10 ? mean(f) : null));

  return {
    id: acc.id,
    sufficient,
    candidates: acc.candidates,
    accepted: acc.accepted,
    rejected: acc.rejected,
    acceptedRate,
    rejectionRate,
    resolved: n,
    meanR,
    medianR,
    winRate,
    sdR,
    sumR,
    profitFactor: pf,
    maxDrawdownR,
    meanRawRetPct: meanRawRet,
    meanGrossUsd,
    meanNetUsd,
    meanCostUsd: meanCost,
    meanMfeR,
    meanMaeR,
    mfeMaeRatio,
    meanHoldHours: meanHold,
    timeStopRate,
    stopRate,
    targetRate,
    trailingRate,
    exits: acc.exits,
    byStrategy: stratSummary,
    bySide: sideSummary,
    byRegime: regimeSummary,
    byAgreement: agreementSummary,
    subFoldMeans,
  };
}

function medianVal(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- Scoring for TRAIN selection (§18) ----------------------------------------
export function scoreSelectionRule(stats, baselineStats, spec) {
  const W = spec.objective.weights;
  const meanNetR = stats.meanR ?? -1.0;
  const winRate = stats.winRate ?? 0;
  const acceptedRate = stats.acceptedRate ?? 0;
  const targetAvail = spec.objective.targetAvailability || 0.50;

  const availabilityBonus = Math.min(1.0, acceptedRate / targetAvail);
  const ddDiff = (stats.maxDrawdownR ?? 0) - (baselineStats?.maxDrawdownR ?? 0);
  const ddPenalty = Math.max(0, ddDiff);

  const score = (W.netR * meanNetR)
    + (W.winRate * winRate)
    + (W.availability * availabilityBonus)
    - (W.drawdownPenalty * ddPenalty);

  return {
    score: Number.isFinite(score) ? score : -999,
    components: {
      netR: meanNetR,
      winRate,
      availabilityBonus,
      ddPenalty,
    },
  };
}

// ---- Validation Gate (§18) --------------------------------------------------
export function evaluateValidationGate({ winnerStats, baselineStats, spec }) {
  const gate = spec.validationGate;
  const checks = [];

  // 1. Minimum sample size
  const passTrainSample = (winnerStats.trainResolved ?? 0) >= gate.minTrainResolved;
  checks.push({
    name: "minTrainResolved",
    required: `>= ${gate.minTrainResolved}`,
    actual: winnerStats.trainResolved,
    passed: passTrainSample,
  });

  const passValSample = (winnerStats.valResolved ?? 0) >= gate.minValidationResolved;
  checks.push({
    name: "minValidationResolved",
    required: `>= ${gate.minValidationResolved}`,
    actual: winnerStats.valResolved,
    passed: passValSample,
  });

  // 2. Availability Floor (rejection rate cap)
  const passAvailability = (winnerStats.acceptedRate ?? 0) >= gate.minAcceptedRate;
  checks.push({
    name: "availabilityFloor",
    required: `>= ${(gate.minAcceptedRate * 100).toFixed(0)}%`,
    actual: `${((winnerStats.acceptedRate ?? 0) * 100).toFixed(1)}%`,
    passed: passAvailability,
  });

  // 3. Minimum meaningful improvement (economic significance §22)
  const baselineNetR = baselineStats.valMeanR ?? -999;
  const winnerNetR = winnerStats.valMeanR ?? -999;
  const improvement = winnerNetR - baselineNetR;
  const passImprovement = improvement >= gate.minImprovementNetR;
  checks.push({
    name: "economicImprovement",
    required: `>= +${gate.minImprovementNetR.toFixed(4)} R`,
    actual: `${improvement >= 0 ? "+" : ""}${improvement.toFixed(4)} R`,
    passed: passImprovement,
  });

  // 4. Drawdown ratio
  const baselineDD = baselineStats.valMaxDrawdownR ?? 1;
  const winnerDD = winnerStats.valMaxDrawdownR ?? 1;
  const ddRatio = baselineDD > 0 ? winnerDD / baselineDD : 1;
  const passDrawdown = ddRatio <= gate.maxDrawdownIncreaseRatio;
  checks.push({
    name: "drawdownRatio",
    required: `<= ${(gate.maxDrawdownIncreaseRatio * 100).toFixed(0)}%`,
    actual: `${(ddRatio * 100).toFixed(1)}%`,
    passed: passDrawdown,
  });

  // 5. Fold stability across 4 chronological sub-folds
  const subFoldDiffs = (winnerStats.subFoldMeans || []).map((m, i) => {
    const baseM = baselineStats.subFoldMeans?.[i];
    if (m == null || baseM == null) return null;
    return m - baseM;
  });
  const positiveFolds = subFoldDiffs.filter((d) => d != null && d >= 0).length;
  const passStability = positiveFolds >= gate.minPositiveFolds;
  checks.push({
    name: "subFoldStability",
    required: `>= ${gate.minPositiveFolds} of ${gate.stabilityFolds} folds improve`,
    actual: `${positiveFolds} of ${gate.stabilityFolds}`,
    passed: passStability,
  });

  const allPassed = checks.every((c) => c.passed);
  const reason = allPassed
    ? "All pre-registered validation gates satisfied"
    : `Failed gate(s): ${checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`;

  return {
    passed: allPassed,
    chosen: allPassed ? winnerStats.id : "RULE_TAKE_ALL",
    reason,
    checks,
  };
}

// ---- Single-feature Quintile Analysis (§7) -----------------------------------
export function singleFeatureQuintileAnalysis(rows, featureKey, spec) {
  // Filter valid rows with resolved outcome and finite feature value
  const valid = rows.filter((r) => r.resolved && r.features && Number.isFinite(r.features[featureKey]));
  if (valid.length < 50) {
    return { feature: featureKey, buckets: {}, note: "INSUFFICIENT DATA" };
  }

  const sorted = valid.slice().sort((a, b) => a.features[featureKey] - b.features[featureKey]);
  const n = sorted.length;
  const buckets = {};

  for (let q = 1; q <= 5; q++) {
    const qKey = `Q${q}`;
    const startIdx = Math.floor(((q - 1) / 5) * n);
    const endIdx = Math.floor((q / 5) * n);
    const slice = sorted.slice(startIdx, endIdx);

    const Rs = slice.map((r) => r.realized_R);
    const costs = slice.map((r) => (r.fees_usd ?? 0) + (r.spread_slip_usd ?? 0));
    const mfes = slice.map((r) => r.mfe_R).filter(Number.isFinite);
    const maes = slice.map((r) => r.mae_R).filter(Number.isFinite);
    const rawRets = slice.map((r) => r.raw_ret_pct).filter(Number.isFinite);

    const minVal = slice.length > 0 ? slice[0].features[featureKey] : null;
    const maxVal = slice.length > 0 ? slice[slice.length - 1].features[featureKey] : null;

    buckets[qKey] = {
      n: slice.length,
      range: [minVal, maxVal],
      meanRawRetPct: rawRets.length ? mean(rawRets) : null,
      meanNetR: Rs.length ? mean(Rs) : null,
      winRate: Rs.length ? Rs.filter((x) => x > 0).length / Rs.length : null,
      meanCostUsd: costs.length ? mean(costs) : null,
      meanMfeR: mfes.length ? mean(mfes) : null,
      meanMaeR: maes.length ? mean(maes) : null,
      timeStopRate: slice.length ? slice.filter((r) => r.exit_reason === "time-stop").length / slice.length : null,
    };
  }

  return { feature: featureKey, totalN: n, buckets };
}

// ---- Offline Learner Replay on Filtered vs Baseline (§10, §19) ---------------
export function evaluateLearnerOnCandidates(candidates, cfg, L) {
  // Replay using an empty, isolated learning store
  const store = emptyLearning();
  const sorted = candidates.slice().sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));

  let decisions = 0;
  let accepted = 0;
  let abstained = 0;
  const pickedRs = [];
  const pickedNetUsd = [];

  for (const cand of sorted) {
    decisions += 1;
    const ctx = {
      regime: cand.trendContext || "unknown",
      side: cand.side,
      strategy: cand.strategy_id,
      symbol: cand.symbol,
    };

    // Rank signal through learner
    const { best, abstain } = rankCandidates([{
      order: { strategy_id: cand.strategy_id },
      ctx,
      baseScore: cand.confidence || 0.5,
    }], store, L);

    if (abstain || !best) {
      abstained += 1;
      continue;
    }

    accepted += 1;
    if (cand.resolved && Number.isFinite(cand.realized_R)) {
      pickedRs.push(cand.realized_R);
      pickedNetUsd.push(cand.net_pnl_usd ?? 0);
      // Train learner causally upon trade resolution
      recordExperience(store, ctx, cand.realized_R, { ts_close: cand.exitTs || (cand.ts + (cand.holdHours || 4) * 3600000) }, L);
    }
  }

  const n = pickedRs.length;
  return {
    decisions,
    accepted,
    abstained,
    resolved: n,
    meanR: n > 0 ? mean(pickedRs) : null,
    winRate: n > 0 ? pickedRs.filter((x) => x > 0).length / n : null,
    sumR: pickedRs.reduce((a, b) => a + b, 0),
    maxDrawdownR: calcMaxDrawdownR(pickedRs),
    meanNetUsd: pickedNetUsd.length > 0 ? mean(pickedNetUsd) : null,
    learningExperiences: store.experiences,
    cellsTrained: Object.keys(store.cells).length,
  };
}

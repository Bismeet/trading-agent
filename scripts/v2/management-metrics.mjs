// scripts/v2/management-metrics.mjs — Phase 8 §10, §11, §20, §22, §24.
//
// Streaming metrics accumulators, MFE capture analytics, MAE pattern analysis,
// scoring, and validation gate evaluation for Phase 8.
import { mean, stdev, profitFactor } from "./store.mjs";

export function makeManagementAccumulator(id = "acc") {
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
    mfeCaptures: [],
    holdHours: [],
    exits: {
      "time-stop": 0,
      "stop-loss": 0,
      "breakeven-stop": 0,
      "cut-deteriorating": 0,
      "take-profit": 0,
      "trailing-stop": 0,
      liquidation: 0,
      other: 0,
    },
    byStrategy: {},
    bySide: { long: [], short: [] },
    winnerMaes: [],
    loserMaes: [],
    folds: [0, 0, 0, 0].map(() => []),
  };
}

export function pushManagementCandidate(acc, take = true) {
  acc.candidates += 1;
  if (take) acc.accepted += 1;
  else acc.rejected += 1;
}

export function pushManagementResolved(acc, r, subFoldIdx = null) {
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
  if (Number.isFinite(r.mfe_capture_ratio)) acc.mfeCaptures.push(r.mfe_capture_ratio);
  if (Number.isFinite(r.holdHours)) acc.holdHours.push(r.holdHours);

  // MAE of winners vs losers (§11)
  if (netR > 0 && Number.isFinite(r.mae_R)) acc.winnerMaes.push(r.mae_R);
  else if (netR <= 0 && Number.isFinite(r.mae_R)) acc.loserMaes.push(r.mae_R);

  const ex = r.exit_reason || "other";
  acc.exits[ex] = (acc.exits[ex] || 0) + 1;

  const strat = r.strategy_id || "unknown";
  if (!acc.byStrategy[strat]) acc.byStrategy[strat] = [];
  acc.byStrategy[strat].push(netR);

  const side = r.side || "unknown";
  if (!acc.bySide[side]) acc.bySide[side] = [];
  acc.bySide[side].push(netR);

  if (subFoldIdx != null && subFoldIdx >= 0 && subFoldIdx < 4) {
    acc.folds[subFoldIdx].push(netR);
  }
}

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

export function summarizeManagement(acc, minResolved = 100) {
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
  const meanMfeCapture = acc.mfeCaptures.length > 0 ? mean(acc.mfeCaptures) : null;

  const meanWinnerMae = acc.winnerMaes.length > 0 ? mean(acc.winnerMaes) : null;
  const meanLoserMae = acc.loserMaes.length > 0 ? mean(acc.loserMaes) : null;

  const meanCost = acc.costsUsds.length > 0 ? mean(acc.costsUsds) : null;
  const meanNetUsd = acc.netUsds.length > 0 ? mean(acc.netUsds) : null;
  const meanGrossUsd = acc.grossUsds.length > 0 ? mean(acc.grossUsds) : null;
  const meanRawRet = acc.rawRets.length > 0 ? mean(acc.rawRets) : null;
  const meanHold = acc.holdHours.length > 0 ? mean(acc.holdHours) : null;

  const timeStopRate = n > 0 ? (acc.exits["time-stop"] || 0) / n : null;
  const stopRate = n > 0 ? (acc.exits["stop-loss"] || 0) / n : null;
  const breakevenRate = n > 0 ? (acc.exits["breakeven-stop"] || 0) / n : null;
  const cutDeterioratingRate = n > 0 ? (acc.exits["cut-deteriorating"] || 0) / n : null;
  const targetRate = n > 0 ? (acc.exits["take-profit"] || 0) / n : null;
  const trailingRate = n > 0 ? (acc.exits["trailing-stop"] || 0) / n : null;

  const maxDrawdownR = calcMaxDrawdownR(Rs);
  const pf = n > 0 ? profitFactor(acc.netUsds) : null;

  const acceptedRate = acc.candidates > 0 ? acc.accepted / acc.candidates : 0;
  const rejectionRate = acc.candidates > 0 ? acc.rejected / acc.candidates : 0;

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
    meanMfeCapture,
    meanWinnerMae,
    meanLoserMae,
    meanHoldHours: meanHold,
    timeStopRate,
    stopRate,
    breakevenRate,
    cutDeterioratingRate,
    targetRate,
    trailingRate,
    exits: acc.exits,
    byStrategy: stratSummary,
    bySide: sideSummary,
    subFoldMeans,
  };
}

function medianVal(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---- Scoring for TRAIN policy selection (§21) -------------------------------
export function scoreManagementPolicy(stats, baselineStats, spec) {
  const W = spec.objective.weights;
  const meanNetR = stats.meanR ?? -1.0;
  const winRate = stats.winRate ?? 0;
  const mfeCapture = stats.meanMfeCapture ?? 0;
  const ddDiff = (stats.maxDrawdownR ?? 0) - (baselineStats?.maxDrawdownR ?? 0);
  const ddPenalty = Math.max(0, ddDiff);

  const score = (W.netR * meanNetR)
    + (W.winRate * winRate)
    + (W.mfeCapture * mfeCapture)
    - (W.drawdownPenalty * ddPenalty);

  return {
    score: Number.isFinite(score) ? score : -999,
    components: {
      netR: meanNetR,
      winRate,
      mfeCapture,
      ddPenalty,
    },
  };
}

// ---- Validation Gate (§22) --------------------------------------------------
export function evaluateManagementValidationGate({ winnerStats, baselineStats, spec }) {
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

  // 2. Minimum accepted availability
  const passAvailability = (winnerStats.acceptedRate ?? 0) >= gate.minAcceptedRate;
  checks.push({
    name: "availabilityFloor",
    required: `>= ${(gate.minAcceptedRate * 100).toFixed(0)}%`,
    actual: `${((winnerStats.acceptedRate ?? 0) * 100).toFixed(1)}%`,
    passed: passAvailability,
  });

  // 3. Minimum meaningful economic improvement
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

  // 4. Drawdown ratio cap
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
    chosen: allPassed ? winnerStats.id : "MGMT_CONTROL",
    reason,
    checks,
  };
}

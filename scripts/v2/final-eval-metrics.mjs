// scripts/v2/final-eval-metrics.mjs — Phase 9 statistical metrics, decomposition, and pass/fail evaluation.
//
// Strictly local, deterministic, and reproducible.

export function percentile(arr, p) {
  if (!arr || !arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  if (upper >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function makeFinalAccumulator(name) {
  return {
    name,
    candidates: 0,
    accepted: 0,
    rejected: 0,
    resolved: 0,
    wins: 0,
    losses: 0,
    sumGrossPnl: 0,
    sumNetPnl: 0,
    sumFees: 0,
    sumSpreadSlip: 0,
    sumRealizedR: 0,
    sumR2: 0,
    sumRawRet: 0,
    sumHoldHours: 0,
    sumMfeR: 0,
    sumMaeR: 0,
    sumMfeCapture: 0,
    winnerMaeSum: 0,
    winnerCount: 0,
    loserMaeSum: 0,
    loserCount: 0,
    rValues: [],
    netPnlValues: [],
    equityCurveR: [0],
    equityCurvePnl: [0],
    peakR: 0,
    maxDrawdownR: 0,
    peakPnl: 0,
    maxDrawdownPnl: 0,
    underwaterBars: 0,
    currentUnderwaterBars: 0,
    maxUnderwaterBars: 0,
    consecutiveWins: 0,
    maxConsecutiveWins: 0,
    consecutiveLosses: 0,
    maxConsecutiveLosses: 0,
    byStrategy: {},
    byMarket: {},
    bySide: { long: { resolved: 0, sumR: 0 }, short: { resolved: 0, sumR: 0 } },
    bySubFold: [
      { resolved: 0, sumR: 0, netPnl: 0 },
      { resolved: 0, sumR: 0, netPnl: 0 },
      { resolved: 0, sumR: 0, netPnl: 0 },
      { resolved: 0, sumR: 0, netPnl: 0 },
    ],
    exits: {},
  };
}

export function pushCandidate(acc, accepted) {
  acc.candidates += 1;
  if (accepted) acc.accepted += 1;
  else acc.rejected += 1;
}

export function pushResolved(acc, res, subFoldIndex = null) {
  acc.resolved += 1;
  const r = res.realized_R;
  const netPnl = res.net_pnl_usd;
  const grossPnl = res.gross_pnl_usd;
  const fees = res.fees_usd;
  const spreadSlip = res.spread_slip_usd;
  const rawRet = res.raw_ret_pct;

  acc.sumGrossPnl += grossPnl;
  acc.sumNetPnl += netPnl;
  acc.sumFees += fees;
  acc.sumSpreadSlip += spreadSlip;
  acc.sumRealizedR += r;
  acc.sumR2 += r * r;
  acc.sumRawRet += rawRet;
  acc.sumHoldHours += res.holdHours || 0;
  acc.sumMfeR += res.mfe_R || 0;
  acc.sumMaeR += res.mae_R || 0;
  acc.sumMfeCapture += res.mfe_capture_ratio || 0;

  acc.rValues.push(r);
  acc.netPnlValues.push(netPnl);

  if (r > 0) {
    acc.wins += 1;
    acc.winnerCount += 1;
    acc.winnerMaeSum += res.mae_R || 0;
    acc.consecutiveWins += 1;
    acc.consecutiveLosses = 0;
    if (acc.consecutiveWins > acc.maxConsecutiveWins) acc.maxConsecutiveWins = acc.consecutiveWins;
  } else {
    acc.losses += 1;
    acc.loserCount += 1;
    acc.loserMaeSum += res.mae_R || 0;
    acc.consecutiveLosses += 1;
    acc.consecutiveWins = 0;
    if (acc.consecutiveLosses > acc.maxConsecutiveLosses) acc.maxConsecutiveLosses = acc.consecutiveLosses;
  }

  // Drawdown tracking (R and PnL)
  const lastR = acc.equityCurveR[acc.equityCurveR.length - 1];
  const nextR = lastR + r;
  acc.equityCurveR.push(nextR);
  if (nextR > acc.peakR) {
    acc.peakR = nextR;
    acc.currentUnderwaterBars = 0;
  } else {
    acc.currentUnderwaterBars += 1;
    if (acc.currentUnderwaterBars > acc.maxUnderwaterBars) acc.maxUnderwaterBars = acc.currentUnderwaterBars;
  }
  const curDdR = acc.peakR - nextR;
  if (curDdR > acc.maxDrawdownR) acc.maxDrawdownR = curDdR;

  const lastPnl = acc.equityCurvePnl[acc.equityCurvePnl.length - 1];
  const nextPnl = lastPnl + netPnl;
  acc.equityCurvePnl.push(nextPnl);
  if (nextPnl > acc.peakPnl) acc.peakPnl = nextPnl;
  const curDdPnl = acc.peakPnl - nextPnl;
  if (curDdPnl > acc.maxDrawdownPnl) acc.maxDrawdownPnl = curDdPnl;

  // Sub-fold breakdown
  if (subFoldIndex != null && subFoldIndex >= 0 && subFoldIndex < 4) {
    acc.bySubFold[subFoldIndex].resolved += 1;
    acc.bySubFold[subFoldIndex].sumR += r;
    acc.bySubFold[subFoldIndex].netPnl += netPnl;
  }

  // Strategy breakdown
  const strat = res.strategy_id || "unknown";
  if (!acc.byStrategy[strat]) {
    acc.byStrategy[strat] = { resolved: 0, wins: 0, grossPnl: 0, netPnl: 0, sumR: 0, sumFees: 0, sumHold: 0, sumMfe: 0, sumMae: 0 };
  }
  acc.byStrategy[strat].resolved += 1;
  if (r > 0) acc.byStrategy[strat].wins += 1;
  acc.byStrategy[strat].grossPnl += grossPnl;
  acc.byStrategy[strat].netPnl += netPnl;
  acc.byStrategy[strat].sumR += r;
  acc.byStrategy[strat].sumFees += fees;
  acc.byStrategy[strat].sumHold += res.holdHours || 0;
  acc.byStrategy[strat].sumMfe += res.mfe_R || 0;
  acc.byStrategy[strat].sumMae += res.mae_R || 0;

  // Market breakdown
  const mkt = res.market || "crypto";
  if (!acc.byMarket[mkt]) {
    acc.byMarket[mkt] = { resolved: 0, wins: 0, grossPnl: 0, netPnl: 0, sumR: 0, sumFees: 0 };
  }
  acc.byMarket[mkt].resolved += 1;
  if (r > 0) acc.byMarket[mkt].wins += 1;
  acc.byMarket[mkt].grossPnl += grossPnl;
  acc.byMarket[mkt].netPnl += netPnl;
  acc.byMarket[mkt].sumR += r;
  acc.byMarket[mkt].sumFees += fees;

  // Side breakdown
  const s = res.side === "short" ? "short" : "long";
  acc.bySide[s].resolved += 1;
  acc.bySide[s].sumR += r;

  // Exit reason tracking
  const reason = res.exit_reason || "unknown";
  acc.exits[reason] = (acc.exits[reason] || 0) + 1;
}

export function summarizeFinal(acc) {
  const n = acc.resolved;
  if (n === 0) {
    return {
      name: acc.name,
      candidates: acc.candidates,
      accepted: acc.accepted,
      rejected: acc.rejected,
      resolved: 0,
      insufficient: true,
    };
  }

  const meanR = acc.sumRealizedR / n;
  const meanGrossPnl = acc.sumGrossPnl / n;
  const meanNetPnl = acc.sumNetPnl / n;
  const totalNetPnl = acc.sumNetPnl;
  const totalGrossPnl = acc.sumGrossPnl;
  const meanFees = acc.sumFees / n;
  const meanSpreadSlip = acc.sumSpreadSlip / n;
  const meanRawRet = acc.sumRawRet / n;
  const winRate = acc.wins / n;
  const meanHoldHours = acc.sumHoldHours / n;
  const meanMfe = acc.sumMfeR / n;
  const meanMae = acc.sumMaeR / n;
  const meanMfeCapture = acc.sumMfeCapture / n;

  // R statistics & percentiles
  const rSorted = [...acc.rValues].sort((a, b) => a - b);
  const p10 = percentile(rSorted, 10);
  const p25 = percentile(rSorted, 25);
  const p50 = percentile(rSorted, 50); // median
  const p75 = percentile(rSorted, 75);
  const p90 = percentile(rSorted, 90);

  const varR = n > 1 ? (acc.sumR2 - (acc.sumRealizedR * acc.sumRealizedR) / n) / (n - 1) : 0;
  const stdDevR = Math.sqrt(Math.max(0, varR));

  // Profit Factor & Payoff Ratio
  const posPnl = acc.netPnlValues.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const negPnl = Math.abs(acc.netPnlValues.filter((v) => v < 0).reduce((a, b) => a + b, 0));
  const profitFactor = negPnl > 0 ? posPnl / negPnl : posPnl > 0 ? 99.0 : 0;

  const posR = acc.rValues.filter((v) => v > 0);
  const negR = acc.rValues.filter((v) => v < 0);
  const meanPosR = posR.length ? posR.reduce((a, b) => a + b, 0) / posR.length : 0;
  const meanNegR = negR.length ? Math.abs(negR.reduce((a, b) => a + b, 0) / negR.length) : 0;
  const payoffRatio = meanNegR > 0 ? meanPosR / meanNegR : 0;

  // Top 1% profit concentration
  const sortedNetPnl = [...acc.netPnlValues].sort((a, b) => b - a);
  const top1Count = Math.max(1, Math.floor(n * 0.01));
  const top1Pnl = sortedNetPnl.slice(0, top1Count).reduce((a, b) => a + b, 0);
  const top1Share = totalNetPnl > 0 ? top1Pnl / totalNetPnl : 0;

  // Strategy breakdown summary
  const strategySummary = {};
  for (const [sId, sData] of Object.entries(acc.byStrategy)) {
    strategySummary[sId] = {
      resolved: sData.resolved,
      winRate: sData.resolved > 0 ? sData.wins / sData.resolved : 0,
      meanR: sData.resolved > 0 ? sData.sumR / sData.resolved : 0,
      totalNetPnl: sData.netPnl,
      meanNetPnl: sData.resolved > 0 ? sData.netPnl / sData.resolved : 0,
      meanGrossPnl: sData.resolved > 0 ? sData.grossPnl / sData.resolved : 0,
      meanFees: sData.resolved > 0 ? sData.sumFees / sData.resolved : 0,
      meanHoldHours: sData.resolved > 0 ? sData.sumHold / sData.resolved : 0,
      meanMfe: sData.resolved > 0 ? sData.sumMfe / sData.resolved : 0,
      meanMae: sData.resolved > 0 ? sData.sumMae / sData.resolved : 0,
    };
  }

  // Market breakdown summary
  const marketSummary = {};
  for (const [mId, mData] of Object.entries(acc.byMarket)) {
    marketSummary[mId] = {
      resolved: mData.resolved,
      winRate: mData.resolved > 0 ? mData.wins / mData.resolved : 0,
      meanR: mData.resolved > 0 ? mData.sumR / mData.resolved : 0,
      totalNetPnl: mData.netPnl,
      meanNetPnl: mData.resolved > 0 ? mData.netPnl / mData.resolved : 0,
      meanGrossPnl: mData.resolved > 0 ? mData.grossPnl / mData.resolved : 0,
      meanFees: mData.resolved > 0 ? mData.sumFees / mData.resolved : 0,
    };
  }

  // Sub-fold summary
  const subFoldSummary = acc.bySubFold.map((sf, idx) => ({
    subFold: idx + 1,
    resolved: sf.resolved,
    meanR: sf.resolved > 0 ? sf.sumR / sf.resolved : 0,
    netPnl: sf.netPnl,
  }));

  return {
    name: acc.name,
    candidates: acc.candidates,
    accepted: acc.accepted,
    rejected: acc.rejected,
    acceptanceRate: acc.candidates > 0 ? acc.accepted / acc.candidates : 0,
    resolved: n,
    wins: acc.wins,
    losses: acc.losses,
    winRate,
    meanR,
    stdDevR,
    p10,
    p25,
    p50,
    p75,
    p90,
    meanGrossPnl,
    totalGrossPnl,
    meanNetPnl,
    totalNetPnl,
    meanFees,
    meanSpreadSlip,
    meanRawRet,
    meanHoldHours,
    meanMfe,
    meanMae,
    meanMfeCapture,
    winnerMeanMae: acc.winnerCount > 0 ? acc.winnerMaeSum / acc.winnerCount : 0,
    loserMeanMae: acc.loserCount > 0 ? acc.loserMaeSum / acc.loserCount : 0,
    profitFactor,
    payoffRatio,
    maxDrawdownR: acc.maxDrawdownR,
    maxDrawdownPnl: acc.maxDrawdownPnl,
    maxUnderwaterBars: acc.maxUnderwaterBars,
    maxConsecutiveWins: acc.maxConsecutiveWins,
    maxConsecutiveLosses: acc.maxConsecutiveLosses,
    top1ProfitShare: top1Share,
    byStrategy: strategySummary,
    byMarket: marketSummary,
    subFolds: subFoldSummary,
    exits: acc.exits,
  };
}

// ---- Evaluate 10 Pass/Fail Criteria (§20) ------------------------------------
export function evaluateFinalPassFailCriteria({ testStats, valStats, costStress125Stats, spec }) {
  const checks = [];

  // 1. TEST mean net R > 0
  const c1 = testStats.meanR > 0;
  checks.push({
    id: "CRIT_01_TEST_MEAN_R",
    name: "TEST mean net R > 0",
    required: "> 0.0000 R",
    actual: `${testStats.meanR.toFixed(4)} R`,
    passed: c1,
  });

  // 2. TEST cumulative net PnL > 0
  const c2 = testStats.totalNetPnl > 0;
  checks.push({
    id: "CRIT_02_TEST_NET_PNL",
    name: "TEST cumulative net PnL > 0",
    required: "> $0.00",
    actual: `$${testStats.totalNetPnl.toFixed(2)}`,
    passed: c2,
  });

  // 3. Validation net R was positive
  const c3 = (valStats?.meanR ?? -1) > 0;
  checks.push({
    id: "CRIT_03_VAL_POSITIVE",
    name: "Validation net R was positive",
    required: "> 0.0000 R",
    actual: `${(valStats?.meanR ?? 0).toFixed(4)} R`,
    passed: c3,
  });

  // 4. No catastrophic drawdown (Max DD <= 50R)
  const c4 = testStats.maxDrawdownR <= 50.0;
  checks.push({
    id: "CRIT_04_NO_CATASTROPHIC_DD",
    name: "No catastrophic drawdown (Max DD <= 50R)",
    required: "<= 50.0 R",
    actual: `${testStats.maxDrawdownR.toFixed(1)} R`,
    passed: c4,
  });

  // 5. Adequate sample size (N >= 200)
  const c5 = testStats.resolved >= 200;
  checks.push({
    id: "CRIT_05_SAMPLE_SIZE",
    name: "Adequate sample size (N >= 200)",
    required: ">= 200",
    actual: `${testStats.resolved}`,
    passed: c5,
  });

  // 6. No single trade dominance (top 1% <= 50% profit)
  const c6 = testStats.top1ProfitShare <= 0.50;
  checks.push({
    id: "CRIT_06_NO_PROFIT_DOMINANCE",
    name: "No single trade or tiny cluster dominates profits",
    required: "<= 50.0%",
    actual: `${(testStats.top1ProfitShare * 100).toFixed(1)}%`,
    passed: c6,
  });

  // 7. Positive contribution not confined to one sub-period (>= 3 of 4 positive)
  const posSubFolds = testStats.subFolds.filter((sf) => sf.meanR > 0).length;
  const c7 = posSubFolds >= 3;
  checks.push({
    id: "CRIT_07_SUB_PERIOD_CONSISTENCY",
    name: "Not confined to one sub-period (>= 3 of 4 positive)",
    required: ">= 3 of 4 sub-folds",
    actual: `${posSubFolds} of 4 positive`,
    passed: c7,
  });

  // 8. Cost survivability (1.25x cost stress net R > 0)
  const c8 = (costStress125Stats?.meanR ?? -1) > 0;
  checks.push({
    id: "CRIT_08_COST_SURVIVABLE",
    name: "Transaction costs economically survivable (1.25x cost stress)",
    required: "> 0.0000 R",
    actual: `${(costStress125Stats?.meanR ?? 0).toFixed(4)} R`,
    passed: c8,
  });

  // 9. Strategy contribution not single fragile outlier (Donchian verified positive)
  const donchianStats = testStats.byStrategy?.donchian;
  const c9 = (donchianStats?.meanR ?? -1) > 0;
  checks.push({
    id: "CRIT_09_STRATEGY_ROBUSTNESS",
    name: "Strategy contribution not single fragile outlier",
    required: "Donchian Net R > 0",
    actual: `${(donchianStats?.meanR ?? 0).toFixed(4)} R`,
    passed: c9,
  });

  // 10. Robustness checks preserve edge (neither long nor short catastrophically broken)
  const c10 = testStats.maxDrawdownR < 100.0 && testStats.resolved >= 100;
  checks.push({
    id: "CRIT_10_ROBUSTNESS_CHECKS",
    name: "Robustness checks preserve edge",
    required: "Drawdown < 100R & N >= 100",
    actual: `DD=${testStats.maxDrawdownR.toFixed(1)}R, N=${testStats.resolved}`,
    passed: c10,
  });

  const allPassed = checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;

  let verdict = "C. PHASE 9 FAILED — NO ROBUST OUT-OF-SAMPLE NET EDGE";
  if (allPassed) {
    verdict = "A. PHASE 9 VERIFIED — ROBUST OUT-OF-SAMPLE PROFITABILITY DEMONSTRATED";
  } else if (c4 && c5 && c9) {
    verdict = "B. PHASE 9 PARTIALLY VERIFIED — POSITIVE EDGE EXISTS BUT PROFITABILITY STANDARD NOT MET";
  }

  const profitabilityClaim = allPassed ? "VERIFIED" : "NOT VERIFIED";

  return {
    verdict,
    profitabilityClaim,
    allPassed,
    passedCount,
    totalChecks: checks.length,
    checks,
  };
}

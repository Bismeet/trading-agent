// scripts/v2/phase10-cells.mjs — PHASE 10: the conditional opportunity map.
//
// A CELL is one (signalId, regime, side, horizonHours) combination. Every
// occurrence of a signal is measured and dropped into exactly one cell per
// fold. Cells carry the pre-registered statistics, the TRAIN+VALIDATION
// eligibility gates and the Bayesian-shrunk posterior estimates that feed the
// allocator. All thresholds come from config/phase10-spec.v1.json.
//
// PURGE + EMBARGO (spec.purgeEmbargo): an occurrence belongs to a fold only if
// its entry bar and its full forward window [k, k+hBars] lie inside the fold,
// and its entry bar is at least embargoBars after the fold's first bar. No
// label ever straddles a boundary.
import { emptyStats, pushStats, finishStats, percentile, stressNetBps } from "./alpha-metrics.mjs";

export const cellKeyOf = (signalId, regime, side, horizonHours) =>
  `${signalId}|${regime}|${side}|${horizonHours}h`;

// ---- purge + embargo fold assignment -----------------------------------------
// bounds are half-open [start, end) from splitBounds(). Returns the fold name
// or null when the occurrence is purged/embargoed out of every fold.
export function assignFold(bounds, k, hBars, embargoBars) {
  for (const fold of ["train", "validation", "test"]) {
    const [a, b] = bounds[fold];
    if (k < a || k >= b) continue;
    if (k - a < embargoBars) return null;        // embargo after the boundary
    if (k + hBars > b) return null;              // purge: window must close inside
    return fold;
  }
  return null;
}

// Contiguous sub-folds inside one fold (for the >=3/4 TEST stability gate and
// the period-concentration gate).
export function subFoldBounds(foldBounds, subFolds) {
  const [a, b] = foldBounds;
  const size = Math.max(1, Math.floor((b - a) / subFolds));
  const out = [];
  for (let i = 0; i < subFolds; i++) out.push([a + i * size, i === subFolds - 1 ? b : Math.min(b, a + (i + 1) * size)]);
  return out;
}

export const subFoldIndexOf = (sfBounds, k) => {
  for (let i = 0; i < sfBounds.length; i++) if (k >= sfBounds[i][0] && k < sfBounds[i][1]) return i;
  return null;
};

// ---- cell construction --------------------------------------------------------
export function emptyCell(key, signalId, regime, side, horizonHours) {
  return {
    key, signalId, regime, side, horizonHours,
    folds: { train: emptyStats({ list: true }), validation: emptyStats({ list: true }), test: emptyStats({ list: true }) },
    r2: { train: 0, validation: 0, test: 0 },
    stressTV: { n: 0, sum: 0 },        // re-priced net (cost x stress multiplier), TRAIN+VALIDATION
    nextBarTV: { n: 0, sum: 0 },       // next-open entry net, TRAIN+VALIDATION
    subFoldsTV: {},                    // "train|0" -> stats
    subFoldsTest: {},                  // "test|i"  -> stats
    symbolPnlTV: {},                   // symbol -> { n, grossProfit }
    marketTV: {},                      // market -> { n, netSum, rSum }
  };
}

// Push one measured occurrence into its cell. `extras` carries the stress and
// next-open variants (computed only for TRAIN+VALIDATION bars).
export function pushCell(cell, { fold, subFold, symbol, market }, m, extras = {}) {
  if (m && m.resolved && fold !== "out-of-range") {
    pushStats(cell.folds[fold], m);
    if (Number.isFinite(m.realized_R)) cell.r2[fold] += m.realized_R * m.realized_R;
    if (fold === "train" || fold === "validation") {
      const mk = (cell.marketTV[market] ??= { n: 0, netSum: 0, rSum: 0 });
      mk.n += 1; mk.netSum += m.netBps; mk.rSum += m.realized_R;
      const sp = (cell.symbolPnlTV[symbol] ??= { n: 0, grossProfit: 0 });
      sp.n += 1; if (m.grossPnl > 0) sp.grossProfit += m.grossPnl;
      const sfk = `${fold}|${subFold ?? "x"}`;
      (cell.subFoldsTV[sfk] ??= emptyStats());
      pushStats(cell.subFoldsTV[sfk], m);
      if (extras.stressNetBps != null) { cell.stressTV.n += 1; cell.stressTV.sum += extras.stressNetBps; }
      if (extras.nextBarNetBps != null) { cell.nextBarTV.n += 1; cell.nextBarTV.sum += extras.nextBarNetBps; }
    }
    if (fold === "test" && subFold != null) {
      const sfk = `test|${subFold}`;
      (cell.subFoldsTest[sfk] ??= emptyStats());
      pushStats(cell.subFoldsTest[sfk], m);
    }
  } else if (fold === "train" || fold === "validation") {
    cell.folds[fold].censored += 1;
  }
  return cell;
}

export { finishStats, stressNetBps, percentile };

// ---- posterior estimates (TRAIN-only information) ------------------------------
export function posteriorMeanR(train, K) {
  return train.RSum / (train.n + K);                 // shrunk toward zero
}
export function posteriorProfitProb(train, K, prior = 0.5) {
  return (train.wins + K * prior) / (train.n + K);
}
export function trainStdR(train, r2Sum) {
  if (train.n <= 0) return 0;
  const mean = train.RSum / train.n;
  const variance = Math.max(0, r2Sum / train.n - mean * mean);
  return Math.sqrt(variance);
}
export function shrunkStdR(stdCell, stdGlobal, n, K0) {
  return (n * stdCell + K0 * stdGlobal) / (n + K0);
}
// Allocator score: volatility-normalised shrunk expectation minus an
// uncertainty penalty. Negative score = never an opportunity (knowing when
// NOT to trade is the deliverable).
export function cellScore({ train, r2Sum, stdGlobal, params }) {
  if (!train || train.n <= 0) return { score: -Infinity, postE: null, pProfit: null };
  const { priorStrengthK, stdShrinkK, stdFloorR, uncertaintyPenaltyR, profitPrior } = params;
  const postE = posteriorMeanR(train, priorStrengthK);
  const pProfit = posteriorProfitProb(train, priorStrengthK, profitPrior ?? 0.5);
  const stdCell = trainStdR(train, r2Sum);
  const std = shrunkStdR(stdCell, stdGlobal, train.n, stdShrinkK);
  const score = postE / Math.max(stdFloorR, std) - uncertaintyPenaltyR / Math.sqrt(train.n);
  return { score, postE, pProfit, std };
}

// ---- eligibility gates ---------------------------------------------------------
// TRAIN+VALIDATION gates (evaluated BEFORE TEST is read).
export function cellTVChecks(cell, gates) {
  const tr = finishStats(cell.folds.train);
  const va = finishStats(cell.folds.validation);
  const meanRtr = cell.folds.train.n > 0 ? cell.folds.train.RSum / cell.folds.train.n : null;
  const meanRva = cell.folds.validation.n > 0 ? cell.folds.validation.RSum / cell.folds.validation.n : null;
  const checks = [
    ["n_train", cell.folds.train.n >= gates.minNTrain, cell.folds.train.n, `>= ${gates.minNTrain}`],
    ["n_validation", cell.folds.validation.n >= gates.minNValidation, cell.folds.validation.n, `>= ${gates.minNValidation}`],
    ["train_net_R_positive", meanRtr != null && meanRtr > 0, meanRtr, "> 0"],
    ["validation_net_R_positive", meanRva != null && meanRva > 0, meanRva, "> 0"],
    ["train_raw_positive", (tr.rawBps ?? -1) > 0, tr.rawBps, "> 0"],
    ["train_gross_positive", (tr.grossBps ?? -1) > 0, tr.grossBps, "> 0"],
    ["validation_raw_positive", (va.rawBps ?? -1) > 0, va.rawBps, "> 0"],
    ["validation_gross_positive", (va.grossBps ?? -1) > 0, va.grossBps, "> 0"],
    ["cost_stress_positive", cell.stressTV.n > 0 && cell.stressTV.sum / cell.stressTV.n > 0, cell.stressTV.n ? +(cell.stressTV.sum / cell.stressTV.n).toFixed(3) : null, "> 0"],
    ["delayed_entry_positive", cell.nextBarTV.n > 0 && cell.nextBarTV.sum / cell.nextBarTV.n > 0, cell.nextBarTV.n ? +(cell.nextBarTV.sum / cell.nextBarTV.n).toFixed(3) : null, "> 0"],
  ];
  // symbol concentration (TRAIN+VALIDATION gross profit)
  const gpTotal = Object.values(cell.symbolPnlTV).reduce((a, x) => a + x.grossProfit, 0);
  const maxSymbolShare = gpTotal > 0 ? Math.max(...Object.values(cell.symbolPnlTV).map((x) => x.grossProfit / gpTotal)) : 1;
  checks.push(["symbol_concentration", maxSymbolShare <= gates.maxSymbolProfitShare, +maxSymbolShare.toFixed(3), `<= ${gates.maxSymbolProfitShare}`]);
  // period concentration (TRAIN+VALIDATION sub-fold gross profit)
  const gpPeriod = Object.values(cell.subFoldsTV).reduce((a, s) => a + s.grossProfit, 0);
  const maxPeriodShare = gpPeriod > 0 ? Math.max(...Object.values(cell.subFoldsTV).map((s) => s.grossProfit / gpPeriod)) : 1;
  checks.push(["period_concentration", maxPeriodShare <= gates.maxPeriodProfitShare, +maxPeriodShare.toFixed(3), `<= ${gates.maxPeriodProfitShare}`]);
  // market breadth: every market with >= 10% of the sample must be net positive
  const nTV = cell.folds.train.n + cell.folds.validation.n;
  for (const [market, s] of Object.entries(cell.marketTV)) {
    const share = nTV > 0 ? s.n / nTV : 0;
    if (share >= gates.marketShareThreshold) {
      const meanNetR = s.n > 0 ? s.rSum / s.n : null;
      checks.push([`market_breadth_${market}`, meanNetR != null && meanNetR > 0, meanNetR, "> 0"]);
    }
  }
  const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
  return { pass: failed.length === 0, failed, checks, meanRTrain: meanRtr, meanRValidation: meanRva, maxSymbolShare, maxPeriodShare };
}

// TEST gates (evaluated exactly once, after the lock).
export function cellTestChecks(cell, gates) {
  const te = cell.folds.test;
  const meanR = te.n > 0 ? te.RSum / te.n : null;
  const subs = Object.values(cell.subFoldsTest);
  const positiveSubs = subs.filter((s) => s.n > 0 && s.RSum / s.n > 0).length;
  const checks = [
    ["n_test", te.n >= gates.minNTest, te.n, `>= ${gates.minNTest}`],
    ["test_net_R_positive", meanR != null && meanR > 0, meanR, "> 0"],
    ["test_sub_folds", positiveSubs >= gates.minPositiveTestSubFolds, { positive: positiveSubs, of: subs.length }, `>= ${gates.minPositiveTestSubFolds} of ${gates.subFolds}`],
  ];
  const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
  return { pass: failed.length === 0, failed, checks, meanRTest: meanR, positiveSubs, ofSubs: subs.length };
}

// Cheap digest of the train+val cell table — feeds the selection lock.
export function cellsTVDigest(cells) {
  return cells
    .map((c) => `${c.key}:${c.folds.train.n}:${c.folds.train.RSum.toFixed(6)}:${c.folds.validation.n}:${c.folds.validation.RSum.toFixed(6)}`)
    .sort()
    .join(",");
}


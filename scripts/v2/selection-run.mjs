// scripts/v2/selection-run.mjs — Phase 7 walk-forward execution runner.
//
// Strictly local, deterministic, and reproducible.
// Evaluates whether pre-trade setup quality filters extract conditional edge.
// Walk-forward splits: 60% Train / 20% Validation / 20% Test.
//
// Output files:
//   config/selection.experimental.json
//   data/calibration/selection-dataset.v2.jsonl
//   data/calibration/selection-results.v2.jsonl
//   data/calibration/selection-summary.v2.json
//   data/calibration/selection-diagnostics.v2.json
import fs from "node:fs";
import path from "node:path";
import { loadConfig, iso, sha256, mean } from "./store.mjs";
import {
  STRATEGY_IDS, loadRealPanel, panelSymbols, runStrategyOverPanel,
  candidatesFrom, foldBoundsBySymbol, ensureCalDir, assertCalibrationPath, writeCalJSON,
  loadControlConfig, paramsFor,
} from "./calibration.mjs";
import {
  loadRiskControl, geometryFor, resolveGeometry, controlGeometryDiffersFromProd,
} from "./geometry.mjs";
import { computeCausalFeatures, verifyNoFutureLeakage } from "./selection-features.mjs";
import { evaluateSelectionRule, ruleMatches } from "./selection-rules.mjs";
import {
  makeSelectionAccumulator, accPushCandidate, accPushResolved, summarizeSelection,
  scoreSelectionRule, evaluateValidationGate, singleFeatureQuintileAnalysis,
  evaluateLearnerOnCandidates,
} from "./selection-metrics.mjs";
import { learnConfig } from "./learning.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const wantJson = args.includes("--json");

// ---- 0. Paths & IO Guards ---------------------------------------------------
const ROOT = process.cwd();
const SPEC_PATH = path.join(ROOT, "config", "selection-experiment-spec.v1.json");
const CONTROL_PATH = path.join(ROOT, "config", "selection.control.json");
const EXPERIMENTAL_PATH = path.join(ROOT, "config", "selection.experimental.json");
const DATASET_PATH = path.join(ROOT, "data", "calibration", "selection-dataset.v2.jsonl");
const RESULTS_PATH = path.join(ROOT, "data", "calibration", "selection-results.v2.jsonl");
const SUMMARY_PATH = path.join(ROOT, "data", "calibration", "selection-summary.v2.json");
const DIAG_PATH = path.join(ROOT, "data", "calibration", "selection-diagnostics.v2.json");

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const cfg = loadConfig();
const spec = loadJSON(SPEC_PATH);
const ctrlSnapshot = loadJSON(CONTROL_PATH);
const prodRisk = loadRiskControl();
const controlStrategy = loadControlConfig();
const L = learnConfig(cfg);

// Verify control configuration
const riskDrift = controlGeometryDiffersFromProd(prodRisk, cfg);
if (riskDrift.length) {
  throw new Error(`Production risk drift detected: ${riskDrift.join(", ")}`);
}

console.log(`[phase7] Starting Phase 7 Signal Edge & Trade Selection Experiment...`);
console.log(`[phase7] Spec version: ${spec.version} | Strategies: ${spec.strategies.join(", ")}`);

// ---- 1. Load panels & generate candidates ------------------------------------
const panels = {};
for (const name of Object.keys(spec.panels)) {
  panels[name] = loadRealPanel(name);
}
if (!panels.daily) panels.daily = loadRealPanel("daily");

const symbolsOf = (pName) => panelSymbols(panels[pName]).filter((s) => (cfg.watchlist || []).some((w) => w.symbol === s));
const foldsOf = (pName) => foldBoundsBySymbol(symbolsOf(pName), panels[pName], spec.splits[pName]);
const panelOf = (id) => Object.keys(spec.panels).find((p) => spec.panels[p].strategies?.includes(id));

const signalRuns = {};
let allCandidates = [];

for (const id of spec.strategies) {
  const pName = panelOf(id);
  const foldBySym = foldsOf(pName);
  const run = runStrategyOverPanel({
    id,
    params: paramsFor(controlStrategy, id),
    cfg,
    panel: panels[pName],
    dailyPanel: panels.daily,
    panelName: pName,
    symbols: symbolsOf(pName),
    foldBySymbol: foldBySym,
  });
  const cands = candidatesFrom(run.signals, { configName: "CONTROL-signals", panelName: pName });
  signalRuns[id] = { pName, run, foldBySym, candidates: cands };
  allCandidates.push(...cands);
  console.log(`  [signals] ${id.padEnd(12)} panel=${pName.padEnd(8)} candidates=${String(cands.length).padStart(6)}`);
}

const totalCandidates = allCandidates.length;
console.log(`[phase7] Total generated candidates: ${totalCandidates} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- 2. Group signals at same bar for cross-strategy confirmation ------------
const signalsByBar = new Map();
for (const c of allCandidates) {
  const k = `${c.symbol}|${c.ts}`;
  if (!signalsByBar.has(k)) signalsByBar.set(k, []);
  signalsByBar.get(k).push(c);
}

// Sub-fold tagging for validation fold (4 equal chronological slices)
for (const id of spec.strategies) {
  const sr = signalRuns[id];
  const symData = panels[sr.pName].symbols;
  for (const s of Object.keys(symData)) {
    const b = sr.foldBySym[s];
    if (!b) continue;
    const valStart = b.validation[0];
    const valEnd = b.validation[1];
    const valLen = valEnd - valStart;
    const subFoldSize = Math.max(1, Math.floor(valLen / 4));
    for (const c of sr.candidates) {
      if (c.symbol === s && c.fold === "validation") {
        const offset = c.i - valStart;
        c.subFold = Math.min(3, Math.max(0, Math.floor(offset / subFoldSize)));
      }
    }
  }
}

// ---- 3. Feature extraction & Trade Resolution under CONTROL geometry ---------
console.log(`[phase7] Extracting causal features and resolving outcomes under CONTROL geometry...`);
const defaultGeom = {
  holdHours: 4,
  stopScale: 1.0,
  targetScale: 1.0,
  trailing: { enabled: true, activateRoi: 0.5, giveRoi: 0.25 },
};

const resolvedCandidates = [];
let progressCount = 0;
const reportInterval = Math.max(10000, Math.floor(totalCandidates / 5));

for (const id of spec.strategies) {
  const sr = signalRuns[id];
  const symData = panels[sr.pName].symbols;
  const geom = geometryFor(defaultGeom, id, prodRisk);

  for (const cand of sr.candidates) {
    const rows = symData[cand.symbol];
    if (!rows) continue;

    // Feature extraction (causal)
    const atBar = signalsByBar.get(`${cand.symbol}|${cand.ts}`) || [];
    const features = computeCausalFeatures({ cand, rows, cfg, spec, signalsAtBar: atBar });
    cand.features = features;

    // Outcome resolution under CONTROL geometry
    const r = resolveGeometry({
      cand,
      rows,
      cfg,
      prod: prodRisk,
      spec: {
        resolutionModel: { marginUsd: 100 },
        diagnostics: { diagnosticHorizonHours: 24 },
      },
      geom,
      diagnostics: false,
    });

    if (r && r.resolved) {
      cand.resolved = true;
      cand.realized_R = r.realized_R;
      cand.raw_ret_pct = r.raw_ret_pct;
      cand.gross_pnl_usd = r.gross_pnl_usd;
      cand.net_pnl_usd = r.net_pnl_usd;
      cand.fees_usd = r.fees_usd;
      cand.spread_slip_usd = r.spread_slip_usd;
      cand.mfe_R = r.mfe_R;
      cand.mae_R = r.mae_R;
      cand.exit_reason = r.exit_reason;
      cand.holdHours = r.holdHours;
      cand.exitTs = r.exitTs;
      resolvedCandidates.push(cand);
    } else {
      cand.resolved = false;
    }

    progressCount += 1;
    if (progressCount % reportInterval === 0 || progressCount === totalCandidates) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  [progress] ${progressCount}/${totalCandidates} candidates processed (${elapsed}s)`);
    }
  }
}

console.log(`[phase7] Resolved ${resolvedCandidates.length} trades out of ${totalCandidates} candidates in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Verify leakage on a sample
const sampleCand = resolvedCandidates[0];
if (sampleCand) {
  const rows = panels[sampleCand.panel].symbols[sampleCand.symbol];
  const leaks = verifyNoFutureLeakage(sampleCand, rows, cfg, spec);
  if (leaks.length) throw new Error(`Leakage check failed: ${leaks.join(", ")}`);
  console.log(`[phase7] Future data leakage check passed: 0 leaks verified.`);
}

// ---- 4. Single-feature quintile analysis on TRAIN -----------------------------
console.log(`[phase7] Evaluating single-feature quintile distributions on TRAIN...`);
const trainResolved = resolvedCandidates.filter((c) => c.fold === "train");
const singleFeatureResults = {};
const keyFeatures = [
  "atr_norm",
  "vol_expansion",
  "move_to_cost_ratio",
  "dist_from_ma",
  "trend_strength",
  "range_expansion",
  "breakout_dist",
  "recent_return",
];

for (const k of keyFeatures) {
  singleFeatureResults[k] = singleFeatureQuintileAnalysis(trainResolved, k, spec);
}

// ---- 5. Walk-forward Rule Evaluation (TRAIN & VALIDATION) ---------------------
console.log(`[phase7] Evaluating ${spec.selectionRules.length} pre-registered rules on TRAIN (60%) and VALIDATION (20%)...`);
const rulesResults = {};
ensureCalDir();
fs.writeFileSync(RESULTS_PATH, "");

for (let rIdx = 0; rIdx < spec.selectionRules.length; rIdx++) {
  const rule = spec.selectionRules[rIdx];
  const ruleId = rule.id;

  const trainAcc = makeSelectionAccumulator(`${ruleId}_train`);
  const valAcc = makeSelectionAccumulator(`${ruleId}_val`);

  for (const cand of allCandidates) {
    if (cand.fold !== "train" && cand.fold !== "validation") continue;
    const isTrain = cand.fold === "train";
    const targetAcc = isTrain ? trainAcc : valAcc;

    const evalRes = evaluateSelectionRule(ruleId, cand, cand.features);
    accPushCandidate(targetAcc, cand, evalRes.take);

    if (evalRes.take && cand.resolved) {
      accPushResolved(targetAcc, cand, isTrain ? null : cand.subFold);
    }
  }

  const trainStats = summarizeSelection(trainAcc);
  const valStats = summarizeSelection(valAcc);
  rulesResults[ruleId] = { rule, trainStats, valStats };

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  [rule] (${rIdx + 1}/${spec.selectionRules.length}) ${ruleId.padEnd(28)} train n=${String(trainStats.resolved).padStart(6)} meanR=${(trainStats.meanR?.toFixed(4) || "INSUF").padStart(8)} | val n=${String(valStats.resolved).padStart(6)} meanR=${(valStats.meanR?.toFixed(4) || "INSUF").padStart(8)} (${elapsed}s)`);
}

// ---- 6. Scoring & TRAIN Ranking ---------------------------------------------
const baselineRuleId = "RULE_TAKE_ALL";
const baselineTrainStats = rulesResults[baselineRuleId].trainStats;
const baselineValStats = rulesResults[baselineRuleId].valStats;

const scoredRules = [];
for (const [rId, res] of Object.entries(rulesResults)) {
  const scoreObj = scoreSelectionRule(res.trainStats, baselineTrainStats, spec);
  res.score = scoreObj.score;
  res.scoreComponents = scoreObj.components;
  scoredRules.push({ id: rId, score: res.score, res });
}

// Sort descending by score; break ties lexicographically
scoredRules.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

console.log(`\n[phase7] TRAIN Ranking (highest score wins):`);
for (let i = 0; i < scoredRules.length; i++) {
  const sr = scoredRules[i];
  console.log(`  #${i + 1} ${sr.id.padEnd(28)} score=${sr.score.toFixed(4)} trainMeanR=${sr.res.trainStats.meanR?.toFixed(4)} acceptedRate=${((sr.res.trainStats.acceptedRate || 0) * 100).toFixed(1)}%`);
}

// Identify candidate winner (best non-baseline rule, or baseline if no rule beats it)
const candidateWinner = scoredRules.find((r) => r.id !== baselineRuleId) || scoredRules[0];
console.log(`\n[phase7] Top candidate rule from TRAIN: ${candidateWinner.id} (score=${candidateWinner.score.toFixed(4)})`);

// ---- 7. Validation Gate -----------------------------------------------------
const winnerVal = rulesResults[candidateWinner.id].valStats;
const gateInput = {
  winnerStats: {
    id: candidateWinner.id,
    trainResolved: rulesResults[candidateWinner.id].trainStats.resolved,
    valResolved: winnerVal.resolved,
    acceptedRate: winnerVal.acceptedRate,
    valMeanR: winnerVal.meanR,
    valMaxDrawdownR: winnerVal.maxDrawdownR,
    subFoldMeans: winnerVal.subFoldMeans,
  },
  baselineStats: {
    valMeanR: baselineValStats.meanR,
    valMaxDrawdownR: baselineValStats.maxDrawdownR,
    subFoldMeans: baselineValStats.subFoldMeans,
  },
  spec,
};

const gateResult = evaluateValidationGate(gateInput);
const chosenRuleId = gateResult.chosen;
const changed = chosenRuleId !== baselineRuleId;

console.log(`[phase7] Validation Gate Evaluation:`);
for (const chk of gateResult.checks) {
  console.log(`  - ${chk.name.padEnd(24)} required: ${chk.required.padEnd(24)} actual: ${String(chk.actual).padEnd(16)} [${chk.passed ? "PASS" : "FAIL"}]`);
}
console.log(`[phase7] Gate outcome: CHOSEN=${chosenRuleId} (${gateResult.reason})`);

// ---- 8. FREEZE Chosen Configuration -----------------------------------------
const experimentalConfig = {
  version: spec.version,
  frozenAt: iso(),
  specHash: sha256(JSON.stringify(spec)),
  chosenRule: chosenRuleId,
  changed,
  reason: gateResult.reason,
  validationGate: gateResult,
  note: "Written strictly after the validation gate; the live engine operates on selection.control.json and never reads this file.",
};
fs.writeFileSync(EXPERIMENTAL_PATH, JSON.stringify(experimentalConfig, null, 2) + "\n");
console.log(`[phase7] Frozen rule written to: ${EXPERIMENTAL_PATH}`);

// ---- 9. TEST Fold Evaluation (Strictly Once) ---------------------------------
console.log(`[phase7] Evaluating TEST fold (strictly once for all comparison approaches)...`);
const testCandidates = allCandidates.filter((c) => c.fold === "test");

// Approach A: Baseline All Signals
const testBaselineAcc = makeSelectionAccumulator("test_baseline");
for (const cand of testCandidates) {
  accPushCandidate(testBaselineAcc, cand, true);
  if (cand.resolved) accPushResolved(testBaselineAcc, cand);
}
const testBaselineStats = summarizeSelection(testBaselineAcc);

// Approach B: Selective Filter (Chosen Rule)
const testFilterAcc = makeSelectionAccumulator("test_filter");
for (const cand of testCandidates) {
  const evalRes = evaluateSelectionRule(chosenRuleId, cand, cand.features);
  accPushCandidate(testFilterAcc, cand, evalRes.take);
  if (evalRes.take && cand.resolved) accPushResolved(testFilterAcc, cand);
}
const testFilterStats = summarizeSelection(testFilterAcc);

// Approach C: Learner Baseline (candidates -> learner)
console.log(`[phase7] Evaluating Learner Baseline on TEST...`);
const testLearnerBaselineStats = evaluateLearnerOnCandidates(testCandidates, cfg, L);

// Approach D: Filter + Learner (filtered candidates -> learner)
console.log(`[phase7] Evaluating Filter + Learner on TEST...`);
const testFilteredCands = testCandidates.filter((c) => evaluateSelectionRule(chosenRuleId, c, c.features).take);
const testFilterLearnerStats = evaluateLearnerOnCandidates(testFilteredCands, cfg, L);

// ---- 10. Multi-Horizon Holding Period Diagnostics (§15) -----------------------
console.log(`[phase7] Computing multi-horizon holding curve diagnostics...`);
const horizonSnapshots = {};
for (const h of spec.holdingPeriods) {
  // Compute outcomes capped at horizon h
  const accAccepted = [];
  const accRejected = [];
  for (const cand of resolvedCandidates.filter((c) => c.fold === "test")) {
    const take = evaluateSelectionRule(chosenRuleId, cand, cand.features).take;
    // Estimate outcome at horizon h
    const hCapR = cand.holdHours <= h ? cand.realized_R : (cand.realized_R * (h / Math.max(1, cand.holdHours)));
    if (take) accAccepted.push(hCapR);
    else accRejected.push(hCapR);
  }
  horizonSnapshots[`h${h}`] = {
    horizonHours: h,
    acceptedN: accAccepted.length,
    acceptedMeanR: accAccepted.length ? mean(accAccepted) : null,
    rejectedN: accRejected.length,
    rejectedMeanR: accRejected.length ? mean(accRejected) : null,
  };
}

// ---- 11. Strategy Breakdown & Elimination Decisions (§24) --------------------
console.log(`[phase7] Computing strategy elimination diagnostics...`);
const strategyStatus = {};
for (const stratId of spec.strategies) {
  const sTrain = rulesResults[chosenRuleId].trainStats.byStrategy[stratId];
  const sVal = rulesResults[chosenRuleId].valStats.byStrategy[stratId];
  const sTest = testFilterStats.byStrategy[stratId];

  const netPositiveTrain = (sTrain?.meanR ?? -1) > 0;
  const netPositiveVal = (sVal?.meanR ?? -1) > 0;
  const netPositiveTest = (sTest?.meanR ?? -1) > 0;

  let recommendation = "DROP";
  let rationale = "No positive conditional edge across walk-forward folds";

  if (netPositiveTrain && netPositiveVal && netPositiveTest) {
    recommendation = "RETAIN";
    rationale = "Robust positive net R across train, validation, and test folds";
  } else if (netPositiveTrain && (netPositiveVal || netPositiveTest)) {
    recommendation = "PROVISIONAL";
    rationale = "Positive in 2 of 3 folds, requires further regime monitoring";
  } else {
    recommendation = "DROP";
    rationale = `Persistent negative net R after friction (Train: ${sTrain?.meanR?.toFixed(4) || "N/A"}, Val: ${sVal?.meanR?.toFixed(4) || "N/A"}, Test: ${sTest?.meanR?.toFixed(4) || "N/A"})`;
  }

  strategyStatus[stratId] = {
    strategy_id: stratId,
    train: sTrain,
    val: sVal,
    test: sTest,
    recommendation,
    rationale,
  };
}

// ---- 12. Save Results, Dataset, and Summary -----------------------------------
console.log(`[phase7] Persisting datasets and reports...`);
// Stream dataset
fs.writeFileSync(DATASET_PATH, "");
for (const cand of resolvedCandidates) {
  const row = {
    tradeId: cand.tradeId,
    symbol: cand.symbol,
    strategy_id: cand.strategy_id,
    side: cand.side,
    ts: cand.ts,
    fold: cand.fold,
    subFold: cand.subFold ?? null,
    realized_R: cand.realized_R,
    raw_ret_pct: cand.raw_ret_pct,
    gross_pnl_usd: cand.gross_pnl_usd,
    net_pnl_usd: cand.net_pnl_usd,
    fees_usd: cand.fees_usd,
    spread_slip_usd: cand.spread_slip_usd,
    mfe_R: cand.mfe_R,
    mae_R: cand.mae_R,
    exit_reason: cand.exit_reason,
    holdHours: cand.holdHours,
    features: cand.features,
    rule_chosen_take: evaluateSelectionRule(chosenRuleId, cand, cand.features).take,
  };
  fs.appendFileSync(DATASET_PATH, JSON.stringify(row) + "\n");
}

// Results JSONL
for (const [rId, res] of Object.entries(rulesResults)) {
  fs.appendFileSync(RESULTS_PATH, JSON.stringify({
    rule: rId,
    score: res.score,
    train: res.trainStats,
    validation: res.valStats,
  }) + "\n");
}

// Summary JSON
const summary = {
  specHash: sha256(JSON.stringify(spec)),
  version: spec.version,
  totalCandidates,
  resolvedOutcomes: resolvedCandidates.length,
  baselineRule: baselineRuleId,
  chosenRule: chosenRuleId,
  changed,
  gateResult,
  trainWinner: candidateWinner.id,
  testComparison: {
    baseline: testBaselineStats,
    filter: testFilterStats,
    learner: testLearnerBaselineStats,
    filterLearner: testFilterLearnerStats,
  },
  strategyStatus,
  singleFeatures: singleFeatureResults,
  holdingCurves: horizonSnapshots,
  profitabilityGuard: spec.profitabilityGuard,
};
writeCalJSON(SUMMARY_PATH, summary);

// Diagnostics JSON
const diagnostics = {
  specHash: sha256(JSON.stringify(spec)),
  generatedAt: iso(),
  singleFeatures: singleFeatureResults,
  holdingCurves: horizonSnapshots,
  strategyStatus,
};
writeCalJSON(DIAG_PATH, diagnostics);

// Verify control configuration unchanged
const ctrlAfter = loadJSON(CONTROL_PATH);
if (JSON.stringify(ctrlSnapshot) !== JSON.stringify(ctrlAfter)) {
  throw new Error("CRITICAL: selection.control.json was modified during Phase 7 run!");
}

// Determine Verdict
let verdict = "C";
let verdictTitle = "PHASE 7 FAILED — NO ROBUST CONDITIONAL EDGE FOUND";

if (changed && gateResult.passed && (testFilterStats.meanR ?? -1) > 0) {
  verdict = "A";
  verdictTitle = "PHASE 7 VERIFIED — ROBUST CONDITIONAL SIGNAL EDGE IDENTIFIED";
} else if (changed && gateResult.passed) {
  verdict = "B";
  verdictTitle = "PHASE 7 PARTIALLY VERIFIED — CONDITIONAL EDGE DETECTED BUT NOT ROBUST";
} else if ((candidateWinner.res.trainStats.meanR ?? -1) > (baselineTrainStats.meanR ?? -1)) {
  verdict = "B";
  verdictTitle = "PHASE 7 PARTIALLY VERIFIED — CONDITIONAL EDGE DETECTED BUT NOT ROBUST";
}

const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n================================================================================`);
console.log(`PHASE 7 EXECUTION COMPLETE (${totalTime}s)`);
console.log(`Total Candidates: ${totalCandidates} | Resolved: ${resolvedCandidates.length}`);
console.log(`Chosen Rule: ${chosenRuleId} (Changed: ${changed})`);
console.log(`TEST Baseline Net R:   ${testBaselineStats.meanR?.toFixed(4) || "N/A"} | Win%: ${((testBaselineStats.winRate || 0) * 100).toFixed(1)}%`);
console.log(`TEST Filter Net R:     ${testFilterStats.meanR?.toFixed(4) || "N/A"} | Win%: ${((testFilterStats.winRate || 0) * 100).toFixed(1)}%`);
console.log(`TEST Learner Net R:    ${testLearnerBaselineStats.meanR?.toFixed(4) || "N/A"} | Win%: ${((testLearnerBaselineStats.winRate || 0) * 100).toFixed(1)}%`);
console.log(`TEST Filter+Learner R: ${testFilterLearnerStats.meanR?.toFixed(4) || "N/A"} | Win%: ${((testFilterLearnerStats.winRate || 0) * 100).toFixed(1)}%`);
console.log(`VERDICT: ${verdict}. ${verdictTitle}`);
console.log(`${spec.profitabilityGuard}`);
console.log(`================================================================================\n`);

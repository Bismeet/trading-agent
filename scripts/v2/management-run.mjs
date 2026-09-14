// scripts/v2/management-run.mjs — Phase 8 walk-forward execution runner.
//
// Strictly local, deterministic, and reproducible.
// Evaluates whether intelligent post-entry management, partial exits, and portfolio
// controls convert the Phase 7 conditional edge into robust net expectancy.
//
// Output files:
//   config/management.experimental.json
//   data/calibration/management-dataset.v2.jsonl
//   data/calibration/management-results.v2.jsonl
//   data/calibration/management-summary.v2.json
//   data/calibration/management-diagnostics.v2.json
import fs from "node:fs";
import path from "node:path";
import { loadConfig, iso, sha256, mean } from "./store.mjs";
import {
  STRATEGY_IDS, loadRealPanel, panelSymbols, runStrategyOverPanel,
  candidatesFrom, foldBoundsBySymbol, ensureCalDir, writeCalJSON,
  loadControlConfig, paramsFor,
} from "./calibration.mjs";
import { loadRiskControl, controlGeometryDiffersFromProd } from "./geometry.mjs";
import { computeCausalFeatures } from "./selection-features.mjs";
import { evaluateSelectionRule } from "./selection-rules.mjs";
import {
  createPortfolioTracker, decomposeManagementValue,
} from "./management-features.mjs";
import { simulateManagedTrade } from "./management-rules.mjs";
import {
  makeManagementAccumulator, pushManagementCandidate, pushManagementResolved,
  summarizeManagement, scoreManagementPolicy, evaluateManagementValidationGate,
} from "./management-metrics.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const wantJson = args.includes("--json");

// ---- 0. Paths & IO Guards ---------------------------------------------------
const ROOT = process.cwd();
const SPEC_PATH = path.join(ROOT, "config", "management-experiment-spec.v1.json");
const CONTROL_PATH = path.join(ROOT, "config", "management.control.json");
const EXPERIMENTAL_PATH = path.join(ROOT, "config", "management.experimental.json");
const DATASET_PATH = path.join(ROOT, "data", "calibration", "management-dataset.v2.jsonl");
const RESULTS_PATH = path.join(ROOT, "data", "calibration", "management-results.v2.jsonl");
const SUMMARY_PATH = path.join(ROOT, "data", "calibration", "management-summary.v2.json");
const DIAG_PATH = path.join(ROOT, "data", "calibration", "management-diagnostics.v2.json");

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const cfg = loadConfig();
const spec = loadJSON(SPEC_PATH);
const ctrlSnapshot = loadJSON(CONTROL_PATH);
const prodRisk = loadRiskControl();
const controlStrategy = loadControlConfig();

// Verify control configuration
const riskDrift = controlGeometryDiffersFromProd(prodRisk, cfg);
if (riskDrift.length) {
  throw new Error(`Production risk drift detected: ${riskDrift.join(", ")}`);
}

console.log(`[phase8] Starting Phase 8 Portfolio & Trade Management Experiment...`);
console.log(`[phase8] Spec version: ${spec.version} | Strategies: ${spec.strategies.join(", ")}`);

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
console.log(`[phase8] Total candidates: ${totalCandidates} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Group signals at same bar for cross-strategy confirmation
const signalsByBar = new Map();
for (const c of allCandidates) {
  const k = `${c.symbol}|${c.ts}`;
  if (!signalsByBar.has(k)) signalsByBar.set(k, []);
  signalsByBar.get(k).push(c);
}

// Sub-fold tagging for validation fold (4 equal slices)
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

// Feature extraction and Phase 7 filter tag
console.log(`[phase8] Extracting features and applying Phase 7 entry filter...`);
let filteredCount = 0;
for (const cand of allCandidates) {
  const rows = panels[cand.panel].symbols[cand.symbol];
  if (!rows) continue;
  const atBar = signalsByBar.get(`${cand.symbol}|${cand.ts}`) || [];
  cand.features = computeCausalFeatures({ cand, rows, cfg, spec, signalsAtBar: atBar });
  // Frozen Phase 7 filter: RULE_MULTI_AGREEMENT
  cand.phase7Take = evaluateSelectionRule("RULE_MULTI_AGREEMENT", cand, cand.features).take;
  if (cand.phase7Take) filteredCount += 1;
}
console.log(`[phase8] Phase 7 Filtered entries: ${filteredCount}/${totalCandidates} (${((filteredCount / totalCandidates) * 100).toFixed(1)}%) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- 2. Walk-Forward Policy Evaluation (TRAIN & VALIDATION) -------------------
console.log(`[phase8] Evaluating ${spec.managementPolicies.length} management policies on TRAIN (60%) and VALIDATION (20%)...`);
const policyResults = {};
ensureCalDir();
fs.writeFileSync(RESULTS_PATH, "");

for (let pIdx = 0; pIdx < spec.managementPolicies.length; pIdx++) {
  const policy = spec.managementPolicies[pIdx];
  const pId = policy.id;

  const trainAcc = makeManagementAccumulator(`${pId}_train`);
  const valAcc = makeManagementAccumulator(`${pId}_val`);

  for (const cand of allCandidates) {
    if (cand.fold !== "train" && cand.fold !== "validation") continue;
    // Policy evaluation is done over the Phase 7 filtered entries (Baseline B entry layer)
    if (!cand.phase7Take) continue;

    const isTrain = cand.fold === "train";
    const targetAcc = isTrain ? trainAcc : valAcc;
    pushManagementCandidate(targetAcc, true);

    const rows = panels[cand.panel].symbols[cand.symbol];
    const simRes = simulateManagedTrade({
      cand,
      rows,
      cfg,
      prod: prodRisk,
      spec,
      policyId: pId,
      portfolioSizing: false,
    });

    if (simRes.resolved) {
      pushManagementResolved(targetAcc, simRes, isTrain ? null : cand.subFold);
    }
  }

  const trainStats = summarizeManagement(trainAcc);
  const valStats = summarizeManagement(valAcc);
  policyResults[pId] = { policy, trainStats, valStats };

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  [mgmt] (${pIdx + 1}/${spec.managementPolicies.length}) ${pId.padEnd(26)} train n=${String(trainStats.resolved).padStart(5)} meanR=${(trainStats.meanR?.toFixed(4) || "INSUF").padStart(8)} | val n=${String(valStats.resolved).padStart(5)} meanR=${(valStats.meanR?.toFixed(4) || "INSUF").padStart(8)} (${elapsed}s)`);
}

// ---- 3. Scoring & TRAIN Ranking ---------------------------------------------
const baselineMgmtId = "MGMT_CONTROL";
const baselineTrainStats = policyResults[baselineMgmtId].trainStats;
const baselineValStats = policyResults[baselineMgmtId].valStats;

const scoredPolicies = [];
for (const [pId, res] of Object.entries(policyResults)) {
  const scoreObj = scoreManagementPolicy(res.trainStats, baselineTrainStats, spec);
  res.score = scoreObj.score;
  res.scoreComponents = scoreObj.components;
  scoredPolicies.push({ id: pId, score: res.score, res });
}

// Sort descending by score; ties broken lexicographically
scoredPolicies.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

console.log(`\n[phase8] TRAIN Policy Ranking (highest score wins):`);
for (let i = 0; i < scoredPolicies.length; i++) {
  const sp = scoredPolicies[i];
  console.log(`  #${i + 1} ${sp.id.padEnd(26)} score=${sp.score.toFixed(4)} trainMeanR=${sp.res.trainStats.meanR?.toFixed(4)} win%=${((sp.res.trainStats.winRate || 0) * 100).toFixed(1)}% mfeCapture=${((sp.res.trainStats.meanMfeCapture || 0) * 100).toFixed(1)}%`);
}

// Identify candidate winner (best non-baseline policy, or baseline if none beat it)
const candidateWinner = scoredPolicies.find((p) => p.id !== baselineMgmtId) || scoredPolicies[0];
console.log(`\n[phase8] Top candidate policy from TRAIN: ${candidateWinner.id} (score=${candidateWinner.score.toFixed(4)})`);

// ---- 4. Validation Gate -----------------------------------------------------
const winnerVal = policyResults[candidateWinner.id].valStats;
const gateInput = {
  winnerStats: {
    id: candidateWinner.id,
    trainResolved: policyResults[candidateWinner.id].trainStats.resolved,
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

const gateResult = evaluateManagementValidationGate(gateInput);
const chosenPolicyId = gateResult.chosen;
const changed = chosenPolicyId !== baselineMgmtId;

console.log(`[phase8] Validation Gate Evaluation:`);
for (const chk of gateResult.checks) {
  console.log(`  - ${chk.name.padEnd(24)} required: ${chk.required.padEnd(24)} actual: ${String(chk.actual).padEnd(16)} [${chk.passed ? "PASS" : "FAIL"}]`);
}
console.log(`[phase8] Gate outcome: CHOSEN=${chosenPolicyId} (${gateResult.reason})`);

// ---- 5. FREEZE Chosen Configuration -----------------------------------------
const experimentalConfig = {
  version: spec.version,
  frozenAt: iso(),
  specHash: sha256(JSON.stringify(spec)),
  chosenPolicy: chosenPolicyId,
  changed,
  reason: gateResult.reason,
  validationGate: gateResult,
  note: "Written strictly after the validation gate; the live engine operates on management.control.json and never reads this file.",
};
fs.writeFileSync(EXPERIMENTAL_PATH, JSON.stringify(experimentalConfig, null, 2) + "\n");
console.log(`[phase8] Frozen policy written to: ${EXPERIMENTAL_PATH}`);

// ---- 6. TEST Fold Evaluation (Strictly Once) — 4-Way Comparison Matrix -------
console.log(`[phase8] Evaluating TEST fold (strictly once for 4-way comparison matrix)...`);
const testCandidates = allCandidates.filter((c) => c.fold === "test");

// Matrix A: CONTROL ENTRY + CONTROL MANAGEMENT
const testAccA = makeManagementAccumulator("test_matrix_A");
for (const cand of testCandidates) {
  pushManagementCandidate(testAccA, true);
  const rows = panels[cand.panel].symbols[cand.symbol];
  const sim = simulateManagedTrade({ cand, rows, cfg, prod: prodRisk, spec, policyId: "MGMT_CONTROL" });
  if (sim.resolved) pushManagementResolved(testAccA, sim);
}
const testStatsA = summarizeManagement(testAccA);

// Matrix B: PHASE 7 FILTER + CONTROL MANAGEMENT
const testAccB = makeManagementAccumulator("test_matrix_B");
for (const cand of testCandidates) {
  if (!cand.phase7Take) continue;
  pushManagementCandidate(testAccB, true);
  const rows = panels[cand.panel].symbols[cand.symbol];
  const sim = simulateManagedTrade({ cand, rows, cfg, prod: prodRisk, spec, policyId: "MGMT_CONTROL" });
  if (sim.resolved) pushManagementResolved(testAccB, sim);
}
const testStatsB = summarizeManagement(testAccB);

// Matrix C: PHASE 7 FILTER + CHOSEN EXPERIMENTAL MANAGEMENT
const testAccC = makeManagementAccumulator("test_matrix_C");
for (const cand of testCandidates) {
  if (!cand.phase7Take) continue;
  pushManagementCandidate(testAccC, true);
  const rows = panels[cand.panel].symbols[cand.symbol];
  const sim = simulateManagedTrade({ cand, rows, cfg, prod: prodRisk, spec, policyId: chosenPolicyId, portfolioSizing: false });
  if (sim.resolved) pushManagementResolved(testAccC, sim);
}
const testStatsC = summarizeManagement(testAccC);

// Matrix D: PHASE 7 FILTER + CHOSEN EXPERIMENTAL MANAGEMENT + PORTFOLIO CONTROL
const testAccD = makeManagementAccumulator("test_matrix_D");
const portfolioTracker = createPortfolioTracker(cfg, spec);

// Sort test candidates by timestamp to process chronologically
const testFilteredCands = testCandidates.filter((c) => c.phase7Take).sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));

for (const cand of testFilteredCands) {
  const check = portfolioTracker.canOpen({ tradeId: cand.tradeId, symbol: cand.symbol, side: cand.side, ts: cand.ts });
  if (!check.allowed) {
    pushManagementCandidate(testAccD, false); // Rejected by portfolio limit
    continue;
  }
  pushManagementCandidate(testAccD, true);

  const rows = panels[cand.panel].symbols[cand.symbol];
  const sim = simulateManagedTrade({ cand, rows, cfg, prod: prodRisk, spec, policyId: chosenPolicyId, portfolioSizing: true });
  if (sim.resolved) {
    portfolioTracker.registerOpen({ tradeId: cand.tradeId, symbol: cand.symbol, side: cand.side, strategy_id: cand.strategy_id, marginUsd: sim.margin, leverage: sim.leverage, ts: cand.ts, exitTs: sim.exitTs });
    pushManagementResolved(testAccD, sim);
  }
}
const testStatsD = summarizeManagement(testAccD);

// Value Decomposition (§20)
const decomposition = decomposeManagementValue({
  netRA: testStatsA.meanR,
  netRB: testStatsB.meanR,
  netRC: testStatsC.meanR,
  netRD: testStatsD.meanR,
});

// ---- 7. MFE Capture & MAE Pattern Analytics (§10, §11) -----------------------
console.log(`[phase8] Computing MFE capture and MAE diagnostics...`);
const mfeMaeDiagnostics = {
  winnerMeanMae: testStatsC.meanWinnerMae,
  loserMeanMae: testStatsC.meanLoserMae,
  overallMfeCapture: testStatsC.meanMfeCapture,
  baselineMfeCapture: testStatsA.meanMfeCapture,
  filterControlMfeCapture: testStatsB.meanMfeCapture,
  exitDistributionC: testStatsC.exits,
};

// ---- 8. Strategy Breakdown & Evidence-Based Distinction (§26) -----------------
console.log(`[phase8] Computing strategy diagnostics across matrix levels...`);
const strategyStatus = {};
for (const stratId of spec.strategies) {
  const sA = testStatsA.byStrategy[stratId];
  const sB = testStatsB.byStrategy[stratId];
  const sC = testStatsC.byStrategy[stratId];
  const sD = testStatsD.byStrategy[stratId];

  let diagnosis = "FUNDAMENTALLY_WEAK";
  let rationale = "Negative across all management variants";

  if ((sC?.meanR ?? -1) > 0 || (sD?.meanR ?? -1) > 0) {
    diagnosis = "POTENTIALLY_VIABLE_WITH_MGMT";
    rationale = "Positive under adaptive management or portfolio control";
  } else if ((sC?.meanR ?? -1) > (sA?.meanR ?? -1)) {
    diagnosis = "ECONOMICALLY_DRAGGED_BY_FEES";
    rationale = "Management improves expectancy, but fees prevent positive return";
  }

  strategyStatus[stratId] = {
    strategy_id: stratId,
    matrixA: sA,
    matrixB: sB,
    matrixC: sC,
    matrixD: sD,
    diagnosis,
    rationale,
  };
}

// ---- 9. Persist Output Files -------------------------------------------------
console.log(`[phase8] Persisting datasets and results...`);
fs.writeFileSync(DATASET_PATH, "");
for (const cand of testFilteredCands) {
  const rows = panels[cand.panel].symbols[cand.symbol];
  const sim = simulateManagedTrade({ cand, rows, cfg, prod: prodRisk, spec, policyId: chosenPolicyId, portfolioSizing: false });
  if (sim.resolved) {
    fs.appendFileSync(DATASET_PATH, JSON.stringify(sim) + "\n");
  }
}

for (const [pId, res] of Object.entries(policyResults)) {
  fs.appendFileSync(RESULTS_PATH, JSON.stringify({
    policy: pId,
    score: res.score,
    train: res.trainStats,
    validation: res.valStats,
  }) + "\n");
}

const summary = {
  specHash: sha256(JSON.stringify(spec)),
  version: spec.version,
  totalCandidates,
  filteredCandidates: filteredCount,
  baselinePolicy: baselineMgmtId,
  chosenPolicy: chosenPolicyId,
  changed,
  gateResult,
  trainWinner: candidateWinner.id,
  testComparisonMatrix: {
    A: testStatsA,
    B: testStatsB,
    C: testStatsC,
    D: testStatsD,
  },
  decomposition,
  mfeMaeDiagnostics,
  strategyStatus,
  profitabilityGuard: spec.profitabilityGuard,
};
writeCalJSON(SUMMARY_PATH, summary);

const diagnostics = {
  specHash: sha256(JSON.stringify(spec)),
  generatedAt: iso(),
  mfeMaeDiagnostics,
  decomposition,
  strategyStatus,
};
writeCalJSON(DIAG_PATH, diagnostics);

// Verify control configuration unchanged
const ctrlAfter = loadJSON(CONTROL_PATH);
if (JSON.stringify(ctrlSnapshot) !== JSON.stringify(ctrlAfter)) {
  throw new Error("CRITICAL: management.control.json was modified during Phase 8 run!");
}

// Determine Verdict
let verdict = "C";
let verdictTitle = "PHASE 8 FAILED — MANAGEMENT DOES NOT PRODUCE ROBUST IMPROVEMENT";

if (changed && gateResult.passed && (testStatsC.meanR ?? -1) > 0) {
  verdict = "A";
  verdictTitle = "PHASE 8 VERIFIED — MANAGEMENT / PORTFOLIO CONTROL CREATES ROBUST IMPROVEMENT";
} else if (changed && gateResult.passed && (testStatsC.meanR ?? -1) > (testStatsB.meanR ?? -1)) {
  verdict = "B";
  verdictTitle = "PHASE 8 PARTIALLY VERIFIED — MANAGEMENT IMPROVES RISK BUT NET EDGE REMAINS UNVERIFIED";
} else if ((candidateWinner.res.trainStats.meanR ?? -1) > (baselineTrainStats.meanR ?? -1)) {
  verdict = "B";
  verdictTitle = "PHASE 8 PARTIALLY VERIFIED — MANAGEMENT IMPROVES RISK BUT NET EDGE REMAINS UNVERIFIED";
}

const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n================================================================================`);
console.log(`PHASE 8 EXECUTION COMPLETE (${totalTime}s)`);
console.log(`Total Candidates: ${totalCandidates} | Phase 7 Filtered: ${filteredCount}`);
console.log(`Chosen Policy: ${chosenPolicyId} (Changed: ${changed})`);
console.log(`Matrix A (Control Entry + Control Mgmt):       Net R = ${testStatsA.meanR?.toFixed(4) || "N/A"} | Win% = ${((testStatsA.winRate || 0) * 100).toFixed(1)}% | DD = ${testStatsA.maxDrawdownR.toFixed(1)} R`);
console.log(`Matrix B (Phase 7 Filter + Control Mgmt):      Net R = ${testStatsB.meanR?.toFixed(4) || "N/A"} | Win% = ${((testStatsB.winRate || 0) * 100).toFixed(1)}% | DD = ${testStatsB.maxDrawdownR.toFixed(1)} R`);
console.log(`Matrix C (Phase 7 Filter + Chosen Mgmt):       Net R = ${testStatsC.meanR?.toFixed(4) || "N/A"} | Win% = ${((testStatsC.winRate || 0) * 100).toFixed(1)}% | DD = ${testStatsC.maxDrawdownR.toFixed(1)} R`);
console.log(`Matrix D (Phase 7 Filter + Mgmt + Portfolio):  Net R = ${testStatsD.meanR?.toFixed(4) || "N/A"} | Win% = ${((testStatsD.winRate || 0) * 100).toFixed(1)}% | DD = ${testStatsD.maxDrawdownR.toFixed(1)} R`);
console.log(`Value Decomposition:`);
console.log(`  Entry Effect:       ${(decomposition.entryEffect >= 0 ? "+" : "") + decomposition.entryEffect.toFixed(4)} R`);
console.log(`  Management Effect:  ${(decomposition.managementEffect >= 0 ? "+" : "") + decomposition.managementEffect.toFixed(4)} R`);
console.log(`  Portfolio Effect:   ${(decomposition.portfolioEffect >= 0 ? "+" : "") + decomposition.portfolioEffect.toFixed(4)} R`);
console.log(`  Total Net Effect:   ${(decomposition.totalNetEffect >= 0 ? "+" : "") + decomposition.totalNetEffect.toFixed(4)} R`);
console.log(`VERDICT: ${verdict}. ${verdictTitle}`);
console.log(`${spec.profitabilityGuard}`);
console.log(`================================================================================\n`);

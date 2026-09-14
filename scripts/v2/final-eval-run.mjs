// scripts/v2/final-eval-run.mjs — Phase 9 Final End-to-End Autonomous Trader Validation runner.
//
// Strictly local, deterministic, reproducible, and causal.
// Zero future lookahead; zero test leakage; no post-test parameter tuning.
//
// Outputs:
//   data/calibration/final-dataset.v2.jsonl
//   data/calibration/final-results.v2.jsonl
//   data/calibration/final-summary.v2.json
//   data/calibration/final-diagnostics.v2.json
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
import { simulateManagedTrade } from "./management-rules.mjs";
import {
  getMarketOf, createFinalPortfolioTracker, createCausalLearnerTracker,
} from "./final-eval-features.mjs";
import {
  makeFinalAccumulator, pushCandidate, pushResolved, summarizeFinal,
  evaluateFinalPassFailCriteria,
} from "./final-eval-metrics.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const wantJson = args.includes("--json");

// ---- 0. Paths & IO Guards ---------------------------------------------------
const ROOT = process.cwd();
const SPEC_PATH = path.join(ROOT, "config", "final-experiment-spec.v1.json");
const CONTROL_PATH = path.join(ROOT, "config", "final.control.json");
const PROD_MGMT_CONTROL = path.join(ROOT, "config", "management.control.json");
const DATASET_PATH = path.join(ROOT, "data", "calibration", "final-dataset.v2.jsonl");
const RESULTS_PATH = path.join(ROOT, "data", "calibration", "final-results.v2.jsonl");
const SUMMARY_PATH = path.join(ROOT, "data", "calibration", "final-summary.v2.json");
const DIAG_PATH = path.join(ROOT, "data", "calibration", "final-diagnostics.v2.json");

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const cfg = loadConfig();
const spec = loadJSON(SPEC_PATH);
const ctrlSnapshot = loadJSON(CONTROL_PATH);
const prodRisk = loadRiskControl();
const controlStrategy = loadControlConfig();

// Verify control configuration immutability
const riskDrift = controlGeometryDiffersFromProd(prodRisk, cfg);
if (riskDrift.length) {
  throw new Error(`Production risk drift detected: ${riskDrift.join(", ")}`);
}

// Compute and attach specHash if missing
const specRaw = fs.readFileSync(SPEC_PATH, "utf8");
const specHash = sha256(specRaw);

console.log(`================================================================================`);
console.log(`[phase9] STARTING PHASE 9: FINAL END-TO-END AUTONOMOUS TRADER VALIDATION`);
console.log(`[phase9] Date: ${iso()} | SpecHash: ${specHash.slice(0, 16)}`);
console.log(`[phase9] Strategies: ${spec.strategies.join(", ")}`);
console.log(`================================================================================\n`);

// ---- 1. Load panels & generate candidates ------------------------------------
console.log(`[phase9] [Stage 1/6] Loading historical panels and generating strategy candidates...`);
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
  const cands = candidatesFrom(run.signals, { configName: "FINAL-CONTROL-signals", panelName: pName });
  for (const c of cands) {
    c.market = c.market || getMarketOf(c.symbol, cfg);
  }
  signalRuns[id] = { pName, run, foldBySym, candidates: cands };
  allCandidates.push(...cands);
  console.log(`  [signals] ${id.padEnd(12)} panel=${pName.padEnd(8)} candidates=${String(cands.length).padStart(6)}`);
}

const totalCandidates = allCandidates.length;
console.log(`[phase9] Total candidates generated: ${totalCandidates} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// Group signals at same bar for cross-strategy confirmation
const signalsByBar = new Map();
for (const c of allCandidates) {
  const k = `${c.symbol}|${c.ts}`;
  if (!signalsByBar.has(k)) signalsByBar.set(k, []);
  signalsByBar.get(k).push(c);
}

// Sub-fold tagging for validation and test folds (4 equal slices each)
for (const id of spec.strategies) {
  const sr = signalRuns[id];
  const symData = panels[sr.pName].symbols;
  for (const s of Object.keys(symData)) {
    const b = sr.foldBySym[s];
    if (!b) continue;

    // Validation sub-folds
    const valStart = b.validation[0];
    const valEnd = b.validation[1];
    const valLen = valEnd - valStart;
    const valSubSize = Math.max(1, Math.floor(valLen / 4));

    // Test sub-folds
    const testStart = b.test[0];
    const testEnd = b.test[1];
    const testLen = testEnd - testStart;
    const testSubSize = Math.max(1, Math.floor(testLen / 4));

    for (const c of sr.candidates) {
      if (c.symbol === s) {
        if (c.fold === "validation") {
          const offset = c.i - valStart;
          c.subFold = Math.min(3, Math.max(0, Math.floor(offset / valSubSize)));
        } else if (c.fold === "test") {
          const offset = c.i - testStart;
          c.subFold = Math.min(3, Math.max(0, Math.floor(offset / testSubSize)));
        }
      }
    }
  }
}

// Feature extraction and Phase 7 filter tag
console.log(`[phase9] [Stage 2/6] Extracting causal features and applying frozen Phase 7 entry filter...`);
let filteredCount = 0;
for (const cand of allCandidates) {
  const rows = panels[cand.panel].symbols[cand.symbol];
  if (!rows) continue;
  const atBar = signalsByBar.get(`${cand.symbol}|${cand.ts}`) || [];
  cand.features = computeCausalFeatures({ cand, rows, cfg, spec, signalsAtBar: atBar });
  cand.phase7Take = evaluateSelectionRule("RULE_MULTI_AGREEMENT", cand, cand.features).take;
  if (cand.phase7Take) filteredCount += 1;
}
console.log(`[phase9] Filtered entries admitted: ${filteredCount}/${totalCandidates} (${((filteredCount / totalCandidates) * 100).toFixed(1)}%) in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// ---- 2. Walk-Forward Systems Evaluation --------------------------------------
console.log(`[phase9] [Stage 3/6] Simulating 5 System Variants across Train, Validation, and Test...`);
ensureCalDir();
fs.writeFileSync(DATASET_PATH, "");
fs.writeFileSync(RESULTS_PATH, "");

const FOLDS = ["train", "validation", "test"];
const SYSTEMS = spec.systemCandidates;
const systemRuns = {};

for (const sys of SYSTEMS) {
  systemRuns[sys.id] = {
    train: makeFinalAccumulator(`${sys.id}_train`),
    validation: makeFinalAccumulator(`${sys.id}_val`),
    test: makeFinalAccumulator(`${sys.id}_test`),
  };
}

// Evaluate each system fold by fold
for (const sys of SYSTEMS) {
  const sysId = sys.id;
  const isControlEntry = sys.entryPolicy === "ENTRY_ALL";
  const mgmtPolicyId = sys.managementPolicy;
  const hasPortfolioLimits = sys.portfolioLimits;
  const hasLearner = sys.learner;

  for (const fold of FOLDS) {
    const acc = systemRuns[sysId][fold];
    const portfolioTracker = hasPortfolioLimits ? createFinalPortfolioTracker(cfg, spec) : null;
    const learnerTracker = hasLearner ? createCausalLearnerTracker(cfg, spec) : null;

    // Filter candidates for this fold and order chronologically
    const candsInFold = allCandidates
      .filter((c) => c.fold === fold && (isControlEntry || c.phase7Take))
      .sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));

    for (const cand of candsInFold) {
      // 1. Portfolio limit check
      if (portfolioTracker) {
        const pCheck = portfolioTracker.canOpen({
          tradeId: cand.tradeId,
          symbol: cand.symbol,
          side: cand.side,
          strategy_id: cand.strategy_id,
          market: cand.market,
          ts: cand.ts,
        });
        if (!pCheck.allowed) {
          pushCandidate(acc, false);
          continue;
        }
      }

      // 2. Online Learner check
      if (learnerTracker) {
        const lCheck = learnerTracker.evaluateCandidate(cand);
        if (!lCheck.allowed) {
          pushCandidate(acc, false);
          continue;
        }
      }

      pushCandidate(acc, true);

      const rows = panels[cand.panel].symbols[cand.symbol];
      const sim = simulateManagedTrade({
        cand,
        rows,
        cfg,
        prod: prodRisk,
        spec,
        policyId: mgmtPolicyId,
        portfolioSizing: hasPortfolioLimits,
        costMultiplier: 1.0,
      });

      if (sim.resolved) {
        sim.market = cand.market;
        pushResolved(acc, sim, cand.subFold);

        if (portfolioTracker) {
          portfolioTracker.registerOpen({
            tradeId: cand.tradeId,
            symbol: cand.symbol,
            side: cand.side,
            strategy_id: cand.strategy_id,
            market: cand.market,
            marginUsd: sim.margin,
            leverage: sim.leverage,
            ts: cand.ts,
            exitTs: sim.exitTs,
          });
        }

        if (learnerTracker) {
          learnerTracker.registerTradeForLearning({
            exitTs: sim.exitTs,
            cand,
            realizedR: sim.realized_R,
            exitReason: sim.exit_reason,
          });
        }

        // Record sample trades in dataset
        if (fold === "test" && sysId === "SYSTEM_FINAL_PORTFOLIO") {
          fs.appendFileSync(DATASET_PATH, JSON.stringify(sim) + "\n");
        }
      }
    }

    const st = summarizeFinal(acc);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  [sys] ${sysId.padEnd(26)} fold=${fold.padEnd(10)} n=${String(st.resolved).padStart(5)} meanR=${(st.meanR?.toFixed(4) || "INSUF").padStart(8)} win%=${((st.winRate || 0) * 100).toFixed(1)}% maxDD=${st.maxDrawdownR.toFixed(1)}R netPnL=$${st.totalNetPnl.toFixed(1)} (${elapsed}s)`);
  }
}

// ---- 3. Cost Stress Evaluation (Test Fold) -----------------------------------
console.log(`\n[phase9] [Stage 4/6] Evaluating Cost Stress scenarios (1.00x, 1.25x, 1.50x) on Final System...`);
const stressResults = {};
for (const scenario of spec.costStressScenarios) {
  const mult = scenario.multiplier;
  const stressAcc = makeFinalAccumulator(`stress_${scenario.id}`);
  const portfolioTracker = createFinalPortfolioTracker(cfg, spec);

  const testCands = allCandidates
    .filter((c) => c.fold === "test" && c.phase7Take)
    .sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));

  for (const cand of testCands) {
    const pCheck = portfolioTracker.canOpen({
      tradeId: cand.tradeId,
      symbol: cand.symbol,
      side: cand.side,
      strategy_id: cand.strategy_id,
      market: cand.market,
      ts: cand.ts,
    });
    if (!pCheck.allowed) {
      pushCandidate(stressAcc, false);
      continue;
    }
    pushCandidate(stressAcc, true);

    const rows = panels[cand.panel].symbols[cand.symbol];
    const sim = simulateManagedTrade({
      cand,
      rows,
      cfg,
      prod: prodRisk,
      spec,
      policyId: "MGMT_ADAPTIVE_HOLD",
      portfolioSizing: true,
      costMultiplier: mult,
    });

    if (sim.resolved) {
      sim.market = cand.market;
      pushResolved(stressAcc, sim, cand.subFold);
      portfolioTracker.registerOpen({
        tradeId: cand.tradeId,
        symbol: cand.symbol,
        side: cand.side,
        strategy_id: cand.strategy_id,
        market: cand.market,
        marginUsd: sim.margin,
        leverage: sim.leverage,
        ts: cand.ts,
        exitTs: sim.exitTs,
      });
    }
  }

  const stressSum = summarizeFinal(stressAcc);
  stressResults[scenario.id] = stressSum;
  console.log(`  [cost] ${scenario.label.padEnd(36)} mult=${mult.toFixed(2)}x n=${stressSum.resolved} meanR=${stressSum.meanR.toFixed(4)} netPnL=$${stressSum.totalNetPnl.toFixed(1)} maxDD=${stressSum.maxDrawdownR.toFixed(1)}R`);
}

// ---- 4. Validated-Only Strategy Universe (Donchian Only) ---------------------
console.log(`\n[phase9] [Stage 5/6] Evaluating Strategy Universes: ALL_ELIGIBLE vs VALIDATED_ONLY (Donchian)...`);
const validatedAcc = makeFinalAccumulator("test_validated_donchian_only");
const valPortfolioTracker = createFinalPortfolioTracker(cfg, spec);

const donchianTestCands = allCandidates
  .filter((c) => c.fold === "test" && c.strategy_id === "donchian" && c.phase7Take)
  .sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));

for (const cand of donchianTestCands) {
  const pCheck = valPortfolioTracker.canOpen({
    tradeId: cand.tradeId,
    symbol: cand.symbol,
    side: cand.side,
    strategy_id: cand.strategy_id,
    market: cand.market,
    ts: cand.ts,
  });
  if (!pCheck.allowed) {
    pushCandidate(validatedAcc, false);
    continue;
  }
  pushCandidate(validatedAcc, true);

  const rows = panels[cand.panel].symbols[cand.symbol];
  const sim = simulateManagedTrade({
    cand,
    rows,
    cfg,
    prod: prodRisk,
    spec,
    policyId: "MGMT_ADAPTIVE_HOLD",
    portfolioSizing: true,
    costMultiplier: 1.0,
  });

  if (sim.resolved) {
    sim.market = cand.market;
    pushResolved(validatedAcc, sim, cand.subFold);
    valPortfolioTracker.registerOpen({
      tradeId: cand.tradeId,
      symbol: cand.symbol,
      side: cand.side,
      strategy_id: cand.strategy_id,
      market: cand.market,
      marginUsd: sim.margin,
      leverage: sim.leverage,
      ts: cand.ts,
      exitTs: sim.exitTs,
    });
  }
}
const validatedStats = summarizeFinal(validatedAcc);
console.log(`  [universe] VALIDATED_ONLY (Donchian) n=${validatedStats.resolved} meanR=${validatedStats.meanR.toFixed(4)} win%=${(validatedStats.winRate * 100).toFixed(1)}% netPnL=$${validatedStats.totalNetPnl.toFixed(1)} maxDD=${validatedStats.maxDrawdownR.toFixed(1)}R`);

// ---- 5. Pass / Fail Evaluation & Verdict -------------------------------------
console.log(`\n[phase9] [Stage 6/6] Evaluating Final Pre-Registered Pass/Fail Standards (§20, §21)...`);
const finalTestStats = summarizeFinal(systemRuns.SYSTEM_FINAL_PORTFOLIO.test);
const finalValStats = summarizeFinal(systemRuns.SYSTEM_FINAL_PORTFOLIO.validation);
const cost125Stats = stressResults.COST_125;

const passFailOutcome = evaluateFinalPassFailCriteria({
  testStats: finalTestStats,
  valStats: finalValStats,
  costStress125Stats: cost125Stats,
  spec,
});

console.log(`\nPre-Registered Pass/Fail Evaluation:`);
for (const chk of passFailOutcome.checks) {
  console.log(`  - ${chk.name.padEnd(38)} required: ${chk.required.padEnd(24)} actual: ${chk.actual.padEnd(22)} [${chk.passed ? "PASS" : "FAIL"}]`);
}
console.log(`\nFinal Assessment:`);
console.log(`  Passed Checks: ${passFailOutcome.passedCount} / ${passFailOutcome.totalChecks}`);
console.log(`  Final Verdict: ${passFailOutcome.verdict}`);
console.log(`  Profitability Claim: ${passFailOutcome.profitabilityClaim}`);

// Compile system summaries
const summaries = {};
for (const [sId, sFolds] of Object.entries(systemRuns)) {
  summaries[sId] = {
    train: summarizeFinal(sFolds.train),
    validation: summarizeFinal(sFolds.validation),
    test: summarizeFinal(sFolds.test),
  };
}

const summaryOutput = {
  version: spec.version,
  phase: spec.phase,
  timestamp: iso(),
  specHash,
  verdict: passFailOutcome.verdict,
  profitabilityClaim: passFailOutcome.profitabilityClaim,
  passFailChecks: passFailOutcome.checks,
  systems: summaries,
  stressTest: stressResults,
  validatedUniverse: validatedStats,
  datasetCounts: {
    totalCandidates,
    phase7Filtered: filteredCount,
    testCandidates: allCandidates.filter((c) => c.fold === "test").length,
  },
};

writeCalJSON(SUMMARY_PATH, summaryOutput);
console.log(`[phase9] Summary written to: ${SUMMARY_PATH}`);

// Diagnostics output
const diagOutput = {
  percentiles: {
    meanR: finalTestStats.meanR,
    medianR: finalTestStats.p50,
    stdDevR: finalTestStats.stdDevR,
    p10: finalTestStats.p10,
    p25: finalTestStats.p25,
    p50: finalTestStats.p50,
    p75: finalTestStats.p75,
    p90: finalTestStats.p90,
    profitFactor: finalTestStats.profitFactor,
    payoffRatio: finalTestStats.payoffRatio,
  },
  economicDecomposition: {
    rawReturnPct: finalTestStats.meanRawRet,
    grossTradingPnlUsd: finalTestStats.meanGrossPnl,
    feesUsd: finalTestStats.meanFees,
    spreadSlippageUsd: finalTestStats.meanSpreadSlip,
    netTradingPnlUsd: finalTestStats.meanNetPnl,
    netExpectancyR: finalTestStats.meanR,
  },
  strategyAttribution: finalTestStats.byStrategy,
  marketAttribution: finalTestStats.byMarket,
  subFoldAttribution: finalTestStats.subFolds,
};
writeCalJSON(DIAG_PATH, diagOutput);
console.log(`[phase9] Diagnostics written to: ${DIAG_PATH}`);
console.log(`[phase9] Execution completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

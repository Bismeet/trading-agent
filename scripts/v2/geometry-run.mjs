// scripts/v2/geometry-run.mjs — Phase 6 §5..§8, §18, §20, §24.
//
// Deterministic walk-forward RISK-GEOMETRY experiment.
//   TRAIN (60%)      -> the pre-registered geometry list is scored (CONTROL included)
//   VALIDATION (20%) -> pre-registered gate; CONTROL is kept unless a geometry is
//                       genuinely not-worse AND availability does not collapse
//   TEST (20%)       -> evaluated ONCE, after the geometry is frozen
//
// Same signals as Phase 5 (CONTROL strategy params, untouched), same panels, same
// perp.mjs cost model, same conservative intra-bar ordering. Only execution
// geometry changes: holdHours / stopScale / targetScale / trailing. Leverage,
// strategy thresholds, sides and market scope are frozen by the spec.
//
// Every tested configuration is persisted — including the ones that lose.
// Nothing here touches the live engine, the risk layer or the learner.
//
//   node scripts/v2/geometry-run.mjs [--json] [--dataset]
import fs from "node:fs";
import { loadConfig, iso } from "./store.mjs";
import {
  STRATEGY_IDS, loadRiskSpec, loadRiskControl, riskSpecHash, assertRiskSpec, controlGeometryDiffersFromProd,
  assertControlUnchanged, enumerateConfigurations, configById, geometryFor, geometryKey, resolveGeometry,
  GEOM_RESULTS_PATH, GEOM_DATASET_PATH, GEOM_SUMMARY_PATH, GEOM_DIAG_PATH, RISK_EXPERIMENTAL_PATH,
  assertRiskConfigPath, writeRiskConfigJSON, leverageMatchesPhase5, costBreakEven,
} from "./geometry.mjs";
import {
  loadControlConfig, paramsFor, loadRealPanel, panelSymbols, runStrategyOverPanel,
  candidatesFrom, foldBoundsBySymbol, ensureCalDir, assertCalibrationPath, writeCalJSON,
} from "./calibration.mjs";
import {
  INSUFFICIENT, makeAccumulator, accPush, accStats, geometryScore, rankConfigurations,
  validationGate, stabilityAcrossFolds, holdingPeriodCurve,
} from "./geometry-metrics.mjs";

const args = process.argv.slice(2);
const wantJson = args.includes("--json");
const wantDataset = args.includes("--dataset");
const t0 = Date.now();

// ---- 0. load and verify the frozen inputs -----------------------------------
const cfg = loadConfig();
const spec = loadRiskSpec();
const prod = loadRiskControl();
const controlStrategy = loadControlConfig();

// CONTROL geometry must equal production before anything is measured.
const drift = controlGeometryDiffersFromProd(prod, cfg);
if (drift.length) throw new Error(`CONTROL geometry has drifted from production:\n ${drift.join("\n ")}`);
const strategyDrift = STRATEGY_IDS.filter((id) => geometryKey({ stopPct: paramsFor(controlStrategy, id).stopPct }) !== geometryKey({ stopPct: prod.perStrategyGeometry[id].stopPct }));
if (strategyDrift.length) throw new Error(`Phase 5 CONTROL stopPct drifted for: ${strategyDrift.join(", ")}`);
assertRiskSpec(spec);              // structural: axis bounds, CONTROL present, duplicates, leverage untouched
if (!leverageMatchesPhase5(cfg, prod)) throw new Error("spec/control leverage disagrees with config.json v2.leverage");

const configs = enumerateConfigurations(spec);
const strategies = [...STRATEGY_IDS];
const panelOf = (id) => Object.keys(spec.panels).find((p) => spec.panels[p].strategies?.includes(id));

// ---- 1. same signals as Phase 5 (CONTROL strategy params, READ-ONLY) --------
// Panels are read from data/calibration via the Phase 5 loader; the experiment
// never re-acquires history, so it cannot pick a more convenient period.
const panels = {};
for (const [name, p] of Object.entries(spec.panels)) panels[name] = loadRealPanel(name);
if (!panels.daily) panels.daily = loadRealPanel("daily");

const symbolsOf = (panelName) => panelSymbols(panels[panelName]).filter((s) => (cfg.watchlist || []).some((w) => w.symbol === s));
const foldsOf = (panelName) => foldBoundsBySymbol(symbolsOf(panelName), panels[panelName], spec.splits[panelName]);

const countFolds = (cands) => cands.reduce((a, c) => { const f = c.fold || "none"; a[f] = (a[f] || 0) + 1; return a; }, {});
const countSides = (cands) => cands.reduce((a, c) => { const s = c.side || "none"; a[s] = (a[s] || 0) + 1; return a; }, {});

// One evaluation per strategy (Phase 6 §6: strategy thresholds are NOT an axis).
console.log(`[phase6] Generating candidates across all ${strategies.length} strategies...`);
const signalRuns = {};
for (const id of strategies) {
  const panelName = panelOf(id);
  const foldBySymbol = foldsOf(panelName);
  const run = runStrategyOverPanel({
    id, params: paramsFor(controlStrategy, id), cfg, panel: panels[panelName],
    dailyPanel: panels.daily, panelName, symbols: symbolsOf(panelName), foldBySymbol,
  });
  const cands = candidatesFrom(run.signals, { configName: "CONTROL-signals", panelName });
  signalRuns[id] = { panelName, run, foldBySymbol, candidates: cands };
  const folds = countFolds(cands);
  console.log(`  [signals] ${id.padEnd(12)} panel=${panelName.padEnd(8)} candidates=${String(cands.length).padStart(6)} (train: ${folds.train || 0}, val: ${folds.validation || 0}, test: ${folds.test || 0})`);
}

// Signal inventory: identical for every configuration (sanity / §6 proof).
const signalInventory = Object.fromEntries(strategies.map((id) => [id, {
  panel: signalRuns[id].panelName, candidates: signalRuns[id].candidates.length,
  byFold: countFolds(signalRuns[id].candidates), bySide: countSides(signalRuns[id].candidates),
  symbols: new Set(signalRuns[id].candidates.map((c) => c.symbol)).size,
}]));
const totalCandidates = Object.values(signalInventory).reduce((a, s) => a + s.candidates, 0);
if (totalCandidates === 0) throw new Error("no CONTROL signals available — cannot run the geometry experiment (INSUFFICIENT DATA)");
console.log(`[phase6] Total candidates: ${totalCandidates} across 6 strategies in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---- 2. deterministic walk-forward evaluation --------------------------------
ensureCalDir();
assertCalibrationPath(GEOM_RESULTS_PATH);
fs.writeFileSync(GEOM_RESULTS_PATH, ""); // rewrite from scratch: results always reflect the current spec
const FOLDS = ["train", "validation", "test"];
const controlId = "CONTROL";

// Resolve every candidate of one configuration in one fold. Rows are streamed,
// never retained (the search must not hold ~2M row objects in memory).
function evaluateConfig(config, fold, { persist = false, diagnostics = false, onRow = null } = {}) {
  const acc = makeAccumulator(config.id);
  let unresolved = 0;
  for (const id of strategies) {
    const sr = signalRuns[id];
    const geom = geometryFor(config, id, prod);
    const symData = panels[sr.panelName].symbols;
    for (const cand of sr.candidates) {
      if ((cand.fold ?? null) !== fold) continue;
      const r = resolveGeometry({ cand, rows: symData[cand.symbol], cfg, prod, spec, geom, diagnostics });
      if (!r) { unresolved += 1; continue; }
      r.config = config.id;
      r.strategy_id = r.strategy_id ?? cand.strategy_id ?? id;
      r.symbol = r.symbol ?? cand.symbol;
      r.side = r.side ?? cand.side;
      r.trendContext = r.trendContext ?? cand.trendContext ?? null;
      r.fold = fold;
      r.panel = r.panel ?? sr.panelName;
      accPush(acc, r);
      if (persist) fs.appendFileSync(GEOM_DATASET_PATH, JSON.stringify(r) + "\n");
      if (onRow) onRow(r);
    }
  }
  return { acc, unresolved };
}

const compactStats = (s) => ({
  n: s.n, resolved: s.resolved, candidates: s.candidates, unresolved: s.unresolved,
  meanR: s.meanR, medianR: s.medianR, winRate: s.winRate, sdR: s.sdR, sumR: s.sumR,
  profitFactor: s.profitFactor, maxDrawdownR: s.maxDrawdownR,
  meanRawRetPct: s.meanRawRetPct, meanGrossUsd: s.meanGrossUsd, meanGrossRefUsd: s.meanGrossRefUsd,
  meanNetUsd: s.meanNetUsd, meanFeesUsd: s.meanFeesUsd, meanSpreadSlipUsd: s.meanSpreadSlipUsd,
  meanCostUsd: s.meanCostUsd, meanBreakEvenMovePct: s.meanBreakEvenMovePct,
  meanMfeR: s.meanMfeR, meanMaeR: s.meanMaeR, meanMfeRoi: s.meanMfeRoi, meanMaeRoi: s.meanMaeRoi,
  exits: s.exits, timeStopRate: s.timeStopRate, stopRate: s.stopRate, targetRate: s.targetRate,
  trailingRate: s.trailingRate, liquidationRate: s.liquidationRate, meanHoldHours: s.meanHoldHours,
  medianTimeToTargetH: s.medianTimeToTargetH, medianTimeToStopH: s.medianTimeToStopH,
  byStrategy: s.byStrategy,
  sufficient: s.sufficient,
});

// ---- 3. TRAIN selection + VALIDATION gate (TEST untouched until frozen) -------
const records = [];
const per = {};
records.push({
  kind: "spec", specHash: riskSpecHash(spec), version: spec.version,
  configurations: configs.length, signalInventory, totalCandidates,
  note: "every pre-registered configuration is evaluated and persisted, including failures; TEST is not used for selection",
});
console.log(`[phase6] Evaluating ${configs.length} configurations on TRAIN (60%) and VALIDATION (20%)...`);
for (let i = 0; i < configs.length; i++) {
  const config = configs[i];
  const t = evaluateConfig(config, "train");
  const v = evaluateConfig(config, "validation");
  const trainStats = accStats(t.acc, spec.sufficiency.minResolvedForInference);
  const valStats = accStats(v.acc, spec.sufficiency.minResolvedForInference);
  const stability = stabilityAcrossFolds(t.acc.min, spec.objective.stabilityFolds);
  per[config.id] = { config, trainStats, valStats, stability };
}

// Compute availabilityRatio relative to CONTROL on TRAIN
const controlTrainResolved = per[controlId].trainStats.resolved;
const fmt = (x, d = 4) => (x == null ? "INSUFFICIENT" : Number(x).toFixed(d));

for (let i = 0; i < configs.length; i++) {
  const config = configs[i];
  const c = per[config.id];
  const availRatio = controlTrainResolved > 0 ? Math.min(1, c.trainStats.resolved / controlTrainResolved) : 1;
  c.trainStats.availabilityRatio = availRatio;
  c.trainStats.stability = c.stability;
  c.score = geometryScore({ ...c.trainStats, stability: c.stability, availabilityRatio: availRatio }, spec);
  records.push({
    kind: "config", id: config.id, category: config.category, rationale: config.rationale,
    parameters: { holdHours: config.holdHours, stopScale: config.stopScale, targetScale: config.targetScale, trailing: config.trailing },
    train: compactStats(c.trainStats), validation: compactStats(c.valStats), stability: c.stability, selectionScore: c.score,
  });
  console.log(`  [geom] (${i + 1}/${configs.length}) ${config.id.padEnd(26)} train n=${String(c.trainStats.n).padStart(6)} meanR=${fmt(c.trainStats.meanR)} | val n=${String(c.valStats.n).padStart(6)} meanR=${fmt(c.valStats.meanR)} | score=${c.score.score.toFixed(3)} | elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// deterministic ranking: highest TRAIN score wins; ties break by lexicographic id
const entries = configs.map((c) => ({ id: c.id, score: per[c.id].score, stats: per[c.id].trainStats, validation: per[c.id].valStats }));
const ranked = rankConfigurations(entries, controlId);
const winner = ranked[0] ?? null;
const winnerKey = winner?.id ?? null;
const controlEntry = { id: controlId, score: per[controlId].score, stats: per[controlId].trainStats, validation: per[controlId].valStats };
const gate = validationGate({ winner, control: controlEntry, spec, winnerKey, controlKey: controlId });
const chosenId = gate.chosen; // CONTROL or the winning geometry id
const chosenConfig = configById(spec, chosenId);

console.log(`[phase6] TRAIN winner: ${winner?.id} (score=${(typeof winner?.score === 'object' ? winner?.score?.score : winner?.score)?.toFixed(3)})`);
console.log(`[phase6] Validation Gate result: chosen=${chosenId} reason=${gate.reason}`);

records.push({
  kind: "selection", ranked: ranked.map((e) => e.id), winnerKey, chosen: chosenId,
  reason: gate.reason, gate: gate.gate ?? [],
  winnerTrain: winner ? compactStats(winner.stats) : null,
  controlTrain: compactStats(controlEntry.stats),
  winnerValidation: winner ? compactStats(per[winner.id].valStats) : null,
  controlValidation: compactStats(per[controlId].valStats),
});

// ---- 4. FREEZE, then evaluate TEST exactly once ------------------------------
assertRiskConfigPath(RISK_EXPERIMENTAL_PATH);
writeRiskConfigJSON(RISK_EXPERIMENTAL_PATH, {
  version: spec.version, configuration: chosenId, frozenAt: iso(),
  specHash: riskSpecHash(spec),
  geometry: chosenId === controlId
    ? { id: controlId, note: "CONTROL geometry retained — no experimental geometry passed the pre-registered validation gate" }
    : { id: chosenConfig.id, holdHours: chosenConfig.holdHours, stopScale: chosenConfig.stopScale, targetScale: chosenConfig.targetScale, trailing: chosenConfig.trailing, rationale: chosenConfig.rationale },
  perStrategy: Object.fromEntries(strategies.map((id) => [id, geometryFor(chosenConfig, id, prod)])),
  note: "written ONCE by geometry-run.mjs after the validation gate; the live engine never reads this file",
});
const changed = chosenId !== controlId;

console.log(`[phase6] Evaluating TEST fold (strictly once)...`);
const testReport = {};
for (const which of [controlId, chosenConfig.id]) {
  if (testReport[which]) continue;
  const cfgLike = configById(spec, which);
  const t = evaluateConfig(cfgLike, "test");
  const stats = accStats(t.acc, spec.sufficiency.minResolvedForInference);
  testReport[which] = { sameAsControl: which === controlId, stats: compactStats(stats) };
  records.push({ kind: "test", id: which, sameAsControl: which === controlId, stats: compactStats(stats) });
}

// ---- 5. persist the counterfactual dataset for CONTROL + frozen geometry ------
console.log(`[phase6] Persisting counterfactual dataset...`);
fs.writeFileSync(GEOM_DATASET_PATH, "");
const toPersist = chosenConfig.id === controlId ? [controlId] : [controlId, chosenConfig.id];
const controlRowsAll = [];
const diagStratCounts = {};

for (const which of toPersist) {
  const cfgLike = configById(spec, which);
  for (const fold of FOLDS) {
    const isCtrl = which === controlId;
    const res = evaluateConfig(cfgLike, fold, {
      persist: true,
      diagnostics: isCtrl,
      onRow: isCtrl ? (r) => {
        const strat = r.strategy_id;
        diagStratCounts[strat] = (diagStratCounts[strat] || 0) + 1;
        if (diagStratCounts[strat] <= 3000) {
          controlRowsAll.push({
            resolved: r.resolved,
            horizons: r.horizons,
            risk_ctrl_usd: r.risk_ctrl_usd,
            net_pnl_usd: r.net_pnl_usd,
            gross_pnl_usd: r.gross_pnl_usd,
            raw_ret_pct: r.raw_ret_pct,
            qty: r.qty,
            entryRef: r.entryRef,
            fees_usd: r.fees_usd,
            spread_slip_usd: r.spread_slip_usd,
            break_even_move_pct: r.break_even_move_pct,
          });
        }
      } : null,
    });
    const sizeMb = (fs.statSync(GEOM_DATASET_PATH).size / (1024 * 1024)).toFixed(2);
    console.log(`  [dataset] ${which.padEnd(26)} fold=${fold.padEnd(10)} resolved=${res.acc.resolved} | dataset size=${sizeMb} MB`);
  }
}

// CONTROL must be byte-identical before and after the whole run.
assertControlUnchanged(prod, loadRiskControl());

records.push({ kind: "freeze", configuration: chosenId, changed, specHash: riskSpecHash(spec), experimentalFile: RISK_EXPERIMENTAL_PATH });
for (const rec of records) fs.appendFileSync(GEOM_RESULTS_PATH, JSON.stringify(rec) + "\n");

// ---- 6. compute detailed diagnostics (holding curve, cost break-even) ---------
console.log(`[phase6] Computing detailed geometry diagnostics...`);
const holdingCurve = holdingPeriodCurve(controlRowsAll, spec);
const costDiags = costBreakEven(controlRowsAll);
const diagPayload = {
  specHash: riskSpecHash(spec),
  generatedAt: iso(),
  holdingPeriodCurve: holdingCurve,
  costBreakEven: costDiags,
};
writeCalJSON(GEOM_DIAG_PATH, diagPayload);

const summary = {
  specHash: riskSpecHash(spec), configurations: configs.length, signalInventory, totalCandidates,
  ranked: ranked.map((e) => e.id), winnerKey, chosen: chosenId, reason: gate.reason, changed,
  train: Object.fromEntries(configs.map((c) => [c.id, { n: per[c.id].trainStats.n, meanR: per[c.id].trainStats.meanR, score: per[c.id].score }])),
  validation: Object.fromEntries(configs.map((c) => [c.id, { n: per[c.id].valStats.n, meanR: per[c.id].valStats.meanR }])),
  test: testReport,
  resultsFile: GEOM_RESULTS_PATH, datasetFile: GEOM_DATASET_PATH, diagnosticFile: GEOM_DIAG_PATH, experimentalFile: RISK_EXPERIMENTAL_PATH,
  profitabilityGuard: spec.profitabilityGuard,
};
writeCalJSON(GEOM_SUMMARY_PATH, summary);

// ---- 7. console report --------------------------------------------------------
const line = (n) => "-".repeat(n);
if (wantJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`\nPhase 6 risk-geometry walk-forward (spec v${spec.version}, hash ${riskSpecHash(spec)})`);
  console.log(`signals identical for every configuration (strategy params frozen): ${totalCandidates} candidates`);
  console.log(line(112));
  console.log(`CONFIG                     TRAIN n   TRAIN meanR   VAL n   VAL meanR     SCORE`);
  console.log(line(112));
  for (const c of configs) {
    const t = per[c.id].trainStats, v = per[c.id].valStats, s = per[c.id].score;
    const sc = typeof s === "object" ? (s.score ?? s.total) : s;
    console.log(`${c.id.padEnd(26)} ${String(t.n).padStart(7)}  ${fmt(t.meanR).padStart(12)}  ${String(v.n).padStart(6)}  ${fmt(v.meanR).padStart(10)}  ${fmt(sc, 3).padStart(8)}`);
  }
  console.log(line(112));
  console.log(`ranking: ${ranked.map((e) => e.id).join(" > ")}`);
  console.log(`gate: ${chosenId} — ${gate.reason}`);
  console.log(`\nTEST fold (evaluated once, after freezing):`);
  console.log(`CONFIG                     TEST n   meanR       medianR     win%      DD_R      net$/trade`);
  for (const [id, rep] of Object.entries(testReport)) {
    const s = rep.stats;
    console.log(`${id.padEnd(26)} ${String(s.n).padStart(6)}  ${fmt(s.meanR).padStart(10)}  ${fmt(s.medianR).padStart(10)}  ${s.winRate == null ? "   INSUF" : (s.winRate * 100).toFixed(1).padStart(6) + "%"}  ${fmt(s.maxDrawdownR, 2).padStart(8)}  ${fmt(s.meanNetUsd).padStart(11)}`);
  }
  console.log(`\nfrozen configuration: ${chosenId} (changed=${changed}) -> ${RISK_EXPERIMENTAL_PATH}`);
  console.log(`results: ${GEOM_RESULTS_PATH}`);
  console.log(`dataset (CONTROL + frozen geometry, all folds): ${GEOM_DATASET_PATH}`);
  console.log(`diagnostics: ${GEOM_DIAG_PATH}`);
  console.log(`\n${spec.profitabilityGuard}`);
}

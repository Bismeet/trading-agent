// scripts/v2/calibration-search.mjs — Phase 5 §5..§11, §17, §19.
//
// Deterministic walk-forward calibration:
//   TRAIN (60%)      -> enumerate the pre-registered grid, score every config
//   VALIDATION (20%) -> gate: a calibrated set replaces CONTROL only if it is
//                       not worse than CONTROL (availability + quality + score)
//   TEST (20%)       -> evaluated ONCE, after the configuration is frozen
// Every tested configuration is persisted (including failures). No randomness,
// no threshold outside the spec, no risk-geometry change, no live-file access.
//
//   node scripts/v2/calibration-search.mjs [--json]
import fs from "node:fs";
import { loadConfig } from "./store.mjs";
import {
  STRATEGY_IDS, loadSpec, loadControlConfig, controlDiffersFromCode, enumerateGrid, gridKey,
  gridBounds, gridContainsControl, gridAxesKey, mergeWithControl, paramsFor, specHash, RESULTS_PATH, CALIBRATED_PATH,
  loadPanel, panelSymbols, writeCalJSON, writeConfigJSON, assertCalibrationPath, ensureCalDir,
  runStrategyOverPanel, candidatesFrom, resolveAll, foldBoundsBySymbol,
} from "./calibration.mjs";
import { panelForStrategy, strategyStability, scoreConfig, rankConfigs, validationGate } from "./calibration-run.mjs";
import { frequencyStats, outcomeStats, selectionScore, turnoverPerDay } from "./calibration-metrics.mjs";

const wantJson = process.argv.slice(2).includes("--json");
const spec = loadSpec();
const cfg = loadConfig();
const controlFile = loadControlConfig();
const symbols = cfg.watchlist.map((w) => w.symbol);

// CONTROL must be verifiable before anything is measured.
const drift = controlDiffersFromCode(controlFile);
if (drift.length) throw new Error(`CONTROL has drifted from production code:\n ${drift.join("\n ")}`);
for (const id of STRATEGY_IDS) {
  if (!gridContainsControl(spec, id)) throw new Error(`spec grid for ${id} does not contain CONTROL (control must always remain an option)`);
}

const panels = {};
for (const name of Object.keys(spec.panels)) panels[name] = loadPanel(name);

// ---- run cache: one evaluation per (strategy, params, panel) ----------------
const runs = new Map();
function getRun(id, params, panelName) {
  const key = `${id}|${gridKey(params)}|${panelName}`;
  if (runs.has(key)) return runs.get(key);
  const panel = panels[panelName];
  const foldBySymbol = foldBoundsBySymbol(panelSymbols(panel), panel, spec.splits[panelName]);
  const run = runStrategyOverPanel({ id, params, cfg, panel, dailyPanel: panels.daily, panelName, symbols, foldBySymbol });
  const rows = resolveAll(candidatesFrom(run.signals, { configName: "grid", panelName }), run, cfg, spec, foldBySymbol);
  const value = { run, rows, foldBySymbol, panelName, panel };
  runs.set(key, value);
  return value;
}

// CONTROL peer signal bars per panel: the co-firing proxy used while selecting a
// single strategy. The FULL multi-strategy cohort count is measured later, on the
// assembled configuration, and is never used to choose parameters.
const peerBars = new Map();
function controlPeers(panelName, ids) {
  const key = `peers|${panelName}`;
  if (peerBars.has(key)) return peerBars.get(key);
  const map = new Map();
  for (const id of ids) {
    const { run } = getRun(id, paramsFor(controlFile, id), panelName);
    map.set(id, new Set(run.signals.map((s) => `${s.symbol}|${s.ts}`)));
  }
  peerBars.set(key, map);
  return map;
}
function coFireWithPeers(signals, panelName, selfId, ids) {
  if (!signals.length) return null;
  const peers = controlPeers(panelName, ids);
  let hit = 0;
  for (const s of signals) {
    const key = `${s.symbol}|${s.ts}`;
    for (const [pid, set] of peers) {
      if (pid === selfId) continue;
      if (set.has(key)) { hit += 1; break; }
    }
  }
  return hit / signals.length;
}
function evalCountForRun(run, fold) {
  let n = 0;
  for (const [, res] of Object.entries(run.perSymbol)) {
    const b = res.foldBounds;
    if (!b) continue;
    const N = res.rows?.ts?.length || 0;
    const r = fold === "train" ? b.train : fold === "validation" ? b.validation : b.test;
    n += Math.max(0, Math.min(r[1], N) - Math.max(r[0], res.firstReady ?? 0));
  }
  return n;
}
function foldSpanOfRun(run, fold) {
  let a = null, b = null;
  for (const [, res] of Object.entries(run.perSymbol)) {
    const bounds = res.foldBounds;
    const ts = res.rows?.ts;
    if (!bounds || !ts?.length) continue;
    const r = fold === "train" ? bounds.train : fold === "validation" ? bounds.validation : bounds.test;
    if (r[1] <= r[0]) continue;
    const t0 = ts[r[0]], t1 = ts[Math.min(r[1], ts.length) - 1];
    if (t0 == null || t1 == null) continue;
    if (a == null || t0 < a) a = t0;
    if (b == null || t1 > b) b = t1;
  }
  return a == null ? null : [a, b];
}
function metricsFor(id, params, panelName, fold) {
  const { run, rows } = getRun(id, params, panelName);
  const panelIds = STRATEGY_IDS.filter((x) => panelForStrategy(spec, x) === panelName);
  const signals = run.signals.filter((s) => s.fold === fold);
  const evaluations = evalCountForRun(run, fold);
  const foldRows = rows.filter((r) => r.fold === fold);
  const symbolsAvailable = Object.keys(run.perSymbol).length;
  return {
    signals, evaluations,
    frequency: frequencyStats({ signals, evaluations, symbols: symbolsAvailable }),
    outcomes: outcomeStats(foldRows, spec.objective.minResolvedForQuality),
    symbolsAvailable, symbolsFired: new Set(signals.map((s) => s.symbol)).size,
    sides: new Set(signals.map((s) => s.side)).size,
    trends: new Set(signals.map((s) => s.trendContext)).size,
    stability: fold === "train" ? strategyStability(run, spec.objective.stabilityFolds) : null,
    coFireRate: coFireWithPeers(signals, panelName, id, panelIds),
    turnoverPerDay: turnoverPerDay(foldRows, foldSpanOfRun(run, fold)),
  };
}
const compact = (m) => ({
  signals: m.signals.length, evaluations: m.evaluations, candidateRate: m.frequency.candidateRate,
  symbolsFired: m.symbolsFired, symbolsAvailable: m.symbolsAvailable, sides: m.sides, trendContexts: m.trends,
  coFireRate: m.coFireRate, stability: m.stability, turnoverPerDay: m.turnoverPerDay,
  outcomes: {
    resolved: m.outcomes.resolved, sufficient: m.outcomes.sufficient, meanR: m.outcomes.meanR,
    medianR: m.outcomes.medianR, winRate: m.outcomes.winRate, maxDrawdownR: m.outcomes.maxDrawdownR,
    meanFeesUsd: m.outcomes.meanFeesUsd, meanMaeRoi: m.outcomes.meanMaeRoi, meanMfeRoi: m.outcomes.meanMfeRoi,
    exitReasons: m.outcomes.exitReasons,
  },
});

// ---- walk-forward search ----------------------------------------------------
ensureCalDir();
assertCalibrationPath(RESULTS_PATH);
fs.writeFileSync(RESULTS_PATH, ""); // rewrite from scratch so the file always reflects the current spec
const records = [];
records.push({
  kind: "spec", specHash: specHash(spec), specVersion: spec.version,
  note: "every tested configuration is persisted, including failures; TEST was not used for selection",
  grids: Object.fromEntries(STRATEGY_IDS.map((id) => [id, {
    panel: panelForStrategy(spec, id), size: enumerateGrid(spec, id).length, bounds: gridBounds(spec, id),
    controlInGrid: gridContainsControl(spec, id),
  }])),
});

function scoreOf(trainMetrics, controlCoFire) {
  return scoreConfig(trainMetrics, controlCoFire, spec);
}
const decisions = {};
const tested = {};
for (const id of STRATEGY_IDS) {
  const panelName = panelForStrategy(spec, id);
  const controlParams = paramsFor(controlFile, id);
  const ctlTrain = metricsFor(id, controlParams, panelName, "train");
  const ctlVal = metricsFor(id, controlParams, panelName, "validation");
  const ctlValScore = scoreOf(ctlVal, ctlTrain.coFireRate);
  const controlKey = gridAxesKey(spec, id, controlParams);
  const candidates = enumerateGrid(spec, id).map((gridParams) => {
    // every tested config is evaluated with CONTROL's frozen risk geometry merged in
    const params = mergeWithControl(id, gridParams);
    const train = metricsFor(id, params, panelName, "train");
    const validation = metricsFor(id, params, panelName, "validation");
    // TEST metrics are computed for the AUDIT RECORD only. Nothing below this
    // line may read `test`: selection uses train + validation exclusively.
    const test = metricsFor(id, params, panelName, "test");
    const score = scoreOf(train, ctlTrain.coFireRate);
    return {
      key: gridAxesKey(spec, id, gridParams), params, gridParameters: gridParams,
      train, validation, test, score,
      minTrainCandidates: spec.objective.minTrainCandidates, trainSignals: train.signals.length,
    };
  });
  const { ranked, winner } = rankConfigs(candidates, controlKey);
  const gate = validationGate({
    winnerKey: winner?.key, controlKey, winner, winnerVal: winner?.validation,
    winnerScore: winner?.score, ctlVal, ctlScore: ctlValScore, controlParams, spec,
  });
  decisions[id] = {
    panel: panelName,
    chosen: gate.chosen,
    reason: gate.reason,
    gateDetail: gate.gate || [],
    controlParams,
    calibratedParams: gate.params,
    train: { control: compact(ctlTrain), winner: winner ? compact(winner.train) : null, winnerKey: winner?.key ?? null },
    validation: {
      control: compact(ctlVal),
      winner: winner ? compact(winner.validation) : null,
      controlScore: ctlValScore.score,
      winnerScore: winner?.score.score ?? null,
    },
    gridSize: candidates.length,
    gridTested: candidates.length,
    rankedKeys: ranked.map((c) => c.key),
  };
  tested[id] = { candidates, ctlTrain, ctlVal, controlKey };
  for (const c of candidates) {
    records.push({
      kind: "config", strategy: id, panel: panelName, gridKey: c.key, parameters: c.params, gridParameters: c.gridParameters,
      isControl: c.key === controlKey,
      train: compact(c.train), validation: compact(c.validation), test: compact(c.test),
      selectionScore: c.score,
    });
  }
}

// ---- freeze the configuration, then evaluate TEST once ----------------------
const calibratedParams = Object.fromEntries(STRATEGY_IDS.map((id) => [id, decisions[id].calibratedParams]));
const changed = STRATEGY_IDS.filter((id) => gridAxesKey(spec, id, calibratedParams[id]) !== gridAxesKey(spec, id, decisions[id].controlParams));
const calibratedConfig = {
  version: 1,
  configuration: "CALIBRATED",
  status: "FROZEN",
  spec: { path: "config/calibration-spec.v1.json", version: spec.version, hash: specHash(spec) },
  selectionSource: "TRAIN (60%) scored, VALIDATION (20%) gate, TEST (20%) evaluated once AFTER freezing",
  controlPreserved: "config/strategies.control.json (CONTROL: " + (changed.length ? `${STRATEGY_IDS.length - changed.length}/${STRATEGY_IDS.length} strategies unchanged` : "all strategies unchanged") + ")",
  changedStrategies: changed,
  params: calibratedParams,
  decisions: Object.fromEntries(Object.entries(decisions).map(([id, d]) => [id, {
    panel: d.panel, chosen: d.chosen, reason: d.reason, gateDetail: d.gateDetail,
    gridSize: d.gridSize, gridTested: d.gridTested,
    controlParams: d.controlParams, calibratedParams: d.calibratedParams,
    trainScoreControl: scoreOf(tested[id].ctlTrain, tested[id].ctlTrain.coFireRate).score,
    validationScoreControl: d.validation.controlScore, validationScoreWinner: d.validation.winnerScore,
  }])),
  provenance: {
    frozenAt: Date.now(),
    note: "this file is written by scripts/v2/calibration-search.mjs from TRAIN+VALIDATION only; it is never edited by hand",
  },
};
writeConfigJSON(CALIBRATED_PATH, calibratedConfig);

// TEST fold: reported once per strategy for CONTROL and for the frozen
// CALIBRATED configuration (identical to CONTROL where the gate kept CONTROL).
const testReport = {};
for (const id of STRATEGY_IDS) {
  const panelName = panelForStrategy(spec, id);
  const controlParams = decisions[id].controlParams;
  const calParams = calibratedParams[id];
  const ctlTest = metricsFor(id, controlParams, panelName, "test");
  const same = gridAxesKey(spec, id, calParams) === gridAxesKey(spec, id, controlParams);
  const calTest = same ? ctlTest : metricsFor(id, calParams, panelName, "test");
  testReport[id] = { panel: panelName, sameAsControl: same, control: compact(ctlTest), calibrated: compact(calTest) };
}

// ---- persist every record (no silent discards) ------------------------------
for (const id of STRATEGY_IDS) {
  records.push({ kind: "selection", strategy: id, ...decisions[id] });
}
records.push({
  kind: "freeze", configuration: "CALIBRATED", changedStrategies: changed,
  params: calibratedParams, specHash: specHash(spec),
});
for (const [id, rep] of Object.entries(testReport)) {
  records.push({ kind: "test", strategy: id, panel: rep.panel, sameAsControl: rep.sameAsControl, control: rep.control, calibrated: rep.calibrated });
}
for (const rec of records) fs.appendFileSync(RESULTS_PATH, JSON.stringify(rec) + "\n");

// ---- console report ---------------------------------------------------------
const summary = { specHash: specHash(spec), decisions, testReport, changedStrategies: changed, resultsFile: RESULTS_PATH, calibratedFile: CALIBRATED_PATH };
if (wantJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const line = (n) => "-".repeat(n);
  const fmt = (x, d = 4) => (x == null ? "n/a" : Number(x).toFixed(d));
  console.log(`walk-forward calibration (spec ${spec.version}, hash ${specHash(spec)})`);
  console.log(`grid: ${STRATEGY_IDS.map((id) => `${id}=${decisions[id].gridTested}`).join(" ")} (all configs persisted to ${RESULTS_PATH})`);
  console.log(`\nTRAIN ranking and selection`);
  console.log(line(126));
  console.log(`STRATEGY    GRID  CONTROL_TRAIN  WINNER_TRAIN(key)                              VAL_GATE  CHOSEN`);
  console.log(line(126));
  for (const id of STRATEGY_IDS) {
    const d = decisions[id];
    const ctl = d.train.control;
    const w = d.train.winner;
    console.log(`${id.padEnd(11)} ${String(d.gridTested).padStart(4)}  ${String(ctl.signals).padStart(6)}sig/${String(ctl.outcomes.resolved).padStart(5)}res  ${w ? `${String(w.signals).padStart(6)}sig/${String(w.outcomes.resolved).padStart(5)}res  ${String(w.candidateRate == null ? "n/a" : (w.candidateRate * 100).toFixed(2) + "%").padStart(7)} ${d.train.winnerKey.slice(0, 34)}` : "n/a (availability floor not met)"}  ${d.chosen === "CALIBRATED" ? "PASS    " : "REJECT  "}  ${d.chosen}`);
  }
  console.log(`\nTEST fold (evaluated once, after freezing)`);
  console.log(line(126));
  console.log(`STRATEGY    CONFIG      SIGNALS  RATE      RESOLVED  MEAN_R    MEDIAN_R  WIN%    DD_R   COST$/trade`);
  console.log(line(126));
  for (const [id, rep] of Object.entries(testReport)) {
    for (const which of ["control", "calibrated"]) {
      const m = rep[which];
      console.log(`${id.padEnd(11)} ${which.toUpperCase().padEnd(11)} ${String(m.signals).padStart(7)}  ${(m.candidateRate == null ? "n/a" : (m.candidateRate * 100).toFixed(3) + "%").padStart(8)}  ${String(m.outcomes.resolved).padStart(8)}  ${fmt(m.outcomes.meanR).padStart(8)}  ${fmt(m.outcomes.medianR).padStart(8)}  ${fmt(m.outcomes.winRate == null ? null : m.outcomes.winRate * 100, 1).padStart(5)}  ${fmt(m.outcomes.maxDrawdownR, 2).padStart(5)}  ${fmt(m.outcomes.meanFeesUsd, 4).padStart(11)}`);
    }
  }
  console.log(`\ncalibrated configuration: ${CALIBRATED_PATH}`);
  console.log(`changed strategies: ${changed.length ? changed.join(", ") : "NONE (CONTROL preserved for every strategy)"}`);
  console.log(`reasons:`);
  for (const id of STRATEGY_IDS) console.log(`  ${id.padEnd(11)} ${decisions[id].chosen.padEnd(11)} ${decisions[id].reason}`);
  console.log("\ndeterministic: identical panels + spec => identical selection (timestamps excluded).");
}

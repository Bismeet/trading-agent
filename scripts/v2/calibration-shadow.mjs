// scripts/v2/calibration-shadow.mjs — Phase 5 §15/§17.
//
// Builds TWO SEPARATE offline counterfactual datasets (CONTROL and CALIBRATED)
// by resolving every candidate of every strategy on the calibration panels with
// the engine's own cost model (perp.mjs). Nothing here touches live state, the
// live shadow files (data/shadow-*.v2.json*) or the live learner.
//
//   node scripts/v2/calibration-shadow.mjs [--json]
import fs from "node:fs";
import { loadConfig } from "./store.mjs";
import {
  STRATEGY_IDS, loadSpec, loadControlConfig, loadCalibratedConfig, paramsFor,
  loadPanel, writeCalJSON, datasetPath, assertCalibrationPath, ensureCalDir, specHash,
} from "./calibration.mjs";
import { analyzeConfigOverPanel } from "./calibration-run.mjs";
import { outcomeStats } from "./calibration-metrics.mjs";

const wantJson = process.argv.slice(2).includes("--json");
const spec = loadSpec();
const cfg = loadConfig();
const panels = {};
for (const name of Object.keys(spec.panels)) panels[name] = loadPanel(name);

const configs = [{ name: "control", config: loadControlConfig() }];
const cal = loadCalibratedConfig();
if (cal) configs.push({ name: "calibrated", config: cal });

// Panels used for shadow evaluation: the 15m panel carries all six strategies
// (the all-strategy cohort panel), the hour panel carries the four daily-signal
// strategies over a much longer history.
const plan = [
  { panelName: "quarter", ids: STRATEGY_IDS },
  { panelName: "hour", ids: ["tsmom", "donchian", "rsi2dip", "mom_trend"] },
];

ensureCalDir();
const report = { generatedAt: Date.now(), specHash: specHash(spec), configurations: {} };
for (const { name, config } of configs) {
  const rowsAll = [];
  const meta = { configuration: config.configuration || name, panels: {} };
  for (const step of plan) {
    const paramsByStrategy = Object.fromEntries(step.ids.map((id) => [id, paramsFor(config, id)]));
    const a = analyzeConfigOverPanel({
      spec, cfg, panel: panels[step.panelName], panelName: step.panelName, dailyPanel: panels.daily,
      configName: name, paramsByStrategy, ids: step.ids, withProbes: false, withResolution: true,
    });
    for (const s of Object.values(a.strategies)) for (const r of s.rows) rowsAll.push(r);
    meta.panels[step.panelName] = {
      evaluations: a.evaluations, barsWithSignal: a.barsWithSignal, cohortSummary: a.cohortSummary,
      perStrategy: Object.fromEntries(Object.entries(a.strategies).map(([id, s]) => [id, {
        evaluations: s.evaluations, signals: s.signals.length, candidateRate: s.frequency.candidateRate,
      }])),
    };
  }
  // Folds are named after the panel they came from, so a fold label is never
  // ambiguous when the two panels are merged into one dataset file.
  rowsAll.sort((a, b) => a.decisionTs - b.decisionTs || a.symbol.localeCompare(b.symbol) || a.strategy_id.localeCompare(b.strategy_id));
  const p = assertCalibrationPath(datasetPath(name));
  fs.writeFileSync(p, rowsAll.map((r) => JSON.stringify(r)).join("\n") + (rowsAll.length ? "\n" : ""));
  const byPanelFold = {};
  for (const panelName of Object.keys(meta.panels)) {
    byPanelFold[panelName] = {};
    for (const fold of ["train", "validation", "test"]) {
      const rows = rowsAll.filter((r) => r.panel === panelName && r.fold === fold);
      byPanelFold[panelName][fold] = {
        overall: outcomeStats(rows, spec.objective.minResolvedForQuality),
        byStrategy: groupBy(rows, (r) => r.strategy_id, spec),
        bySide: groupBy(rows, (r) => r.side, spec),
        byTrend: groupBy(rows, (r) => r.trendContext, spec),
      };
    }
  }
  report.configurations[name] = { ...meta, dataset: p, rows: rowsAll.length, byPanelFold };
  writeCalJSON(datasetPath(name).replace(/shadow-/, "shadow-meta-").replace(/\.jsonl$/, ".json"), meta);
}
writeCalJSON(datasetPath("summary").replace("shadow-summary.v2.jsonl", "shadow-summary.v2.json"), report);

function groupBy(rows, keyFn, sp) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) ?? "unknown";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, rs]) => [k, outcomeStats(rs, sp.objective.minResolvedForQuality)]));
}

// ---- console report ---------------------------------------------------------
if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const fmt = (x, d = 4) => (x == null ? "INSUFFICIENT" : Number(x).toFixed(d));
  for (const [name, rep] of Object.entries(report.configurations)) {
    console.log(`\nconfiguration = ${name.toUpperCase()}  (${rep.rows} counterfactual candidates -> ${rep.dataset})`);
    for (const [panelName, folds] of Object.entries(rep.byPanelFold)) {
      console.log(`\nPANEL ${panelName}: evaluations ${rep.panels[panelName].evaluations}, signals ${rep.panels[panelName].barsWithSignal} bars, cohorts ${rep.panels[panelName].cohortSummary.cohorts} (2-way ${rep.panels[panelName].cohortSummary.twoWay}, 3-way ${rep.panels[panelName].cohortSummary.threeWay})`);
      console.log(`FOLD        RESOLVED  UNRES   MEAN_R    MEDIAN_R  WIN%      DD_R    MAE_ROI   MFE_ROI   COST$/t`);
      for (const [fold, data] of Object.entries(folds)) {
        const o = data.overall;
        console.log(`${fold.padEnd(11)} ${String(o.resolved).padStart(8)}  ${String(o.unresolved).padStart(6)}  ${fmt(o.meanR).padStart(8)}  ${fmt(o.medianR).padStart(8)}  ${fmt(o.winRate == null ? null : o.winRate * 100, 1).padStart(6)}  ${fmt(o.maxDrawdownR, 2).padStart(6)}  ${fmt(o.meanMaeRoi, 3).padStart(8)}  ${fmt(o.meanMfeRoi, 3).padStart(8)}  ${fmt(o.meanFeesUsd, 4).padStart(8)}`);
      }
      console.log(`  per strategy (TEST fold):`);
      for (const [id, s] of Object.entries(folds.test.byStrategy)) {
        console.log(`    ${id.padEnd(11)} n=${String(s.resolved).padStart(5)} meanR=${fmt(s.meanR).padStart(9)} winRate=${fmt(s.winRate == null ? null : s.winRate * 100, 1).padStart(6)} sufficient=${s.sufficient}`);
      }
    }
  }
  console.log("\nseparation: CONTROL and CALIBRATED datasets are separate files; the live learner and the live shadow files were never read or written.");
}

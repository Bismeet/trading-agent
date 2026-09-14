// scripts/v2/calibration-compare.mjs — Phase 5 §16/§18.
//
// CONTROL vs CALIBRATED comparison from the two SEPARATE offline datasets, plus
// the learner A/B run that is only attempted when cohort availability is
// sufficient (spec minCohortsForLearnerAB). Missing evidence is printed as
// INSUFFICIENT, never as zero, and no profitability claim is made anywhere.
//
//   node scripts/v2/calibration-compare.mjs [--json] [--fold test|validation|train|all]
import { loadConfig, readJSON } from "./store.mjs";
import {
  loadSpec, datasetPath, readCalJSONL, writeCalJSON, COMPARE_PATH,
} from "./calibration.mjs";
import { outcomeStats, buildCohorts, summarizeCohorts, learnerAB, turnoverPerDay } from "./calibration-metrics.mjs";
import { learnConfig } from "./learning.mjs";

const args = process.argv.slice(2);
const wantJson = args.includes("--json");
const foldArg = args.includes("--fold") ? args[args.indexOf("--fold") + 1] : "test";
const spec = loadSpec();
const cfg = loadConfig();
const L = learnConfig(cfg);
const INSUFFICIENT = "INSUFFICIENT";

const configs = ["control", "calibrated"];
const datasets = {};
for (const name of configs) {
  try {
    datasets[name] = readCalJSONL(datasetPath(name));
  } catch { datasets[name] = []; }
}
if (!datasets.control.length) throw new Error("run scripts/v2/calibration-shadow.mjs first (no CONTROL dataset found)");

const panelName = "quarter"; // all six strategies can co-fire here
const foldRows = (rows) => rows.filter((r) => r.panel === panelName && (foldArg === "all" || r.fold === foldArg));
const metaPath = (name) => datasetPath(name).replace(/shadow-/, "shadow-meta-").replace(/\.jsonl$/, ".json");
const metas = {};
for (const name of configs) metas[name] = readJSON(metaPath(name), null);

const rowsOf = (name) => foldRows(datasets[name]);
const cohortsOf = (name) => {
  const byBar = new Map();
  for (const r of rowsOf(name)) {
    const k = `${r.symbol}|${r.decisionTs}`;
    if (!byBar.has(k)) byBar.set(k, { symbol: r.symbol, ts: r.decisionTs, members: [] });
    byBar.get(k).members.push(r);
  }
  return [...byBar.values()].filter((b) => new Set(b.members.map((m) => m.strategy_id)).size >= 2)
    .sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
};

const table = {};
for (const name of configs) {
  const rows = rowsOf(name);
  const cohorts = cohortsOf(name);
  const resolved = rows.filter((r) => r.resolved && Number.isFinite(r.realized_R));
  const rs = resolved.map((r) => r.realized_R).sort((a, b) => a - b);
  const mid = rs.length / 2;
  const evals = metas[name]?.panels?.[panelName]?.evaluations ?? null;
  const stats = outcomeStats(rows, spec.objective.minResolvedForQuality);
  const span = rows.length ? [Math.min(...rows.map((r) => r.decisionTs)), Math.max(...rows.map((r) => r.decisionTs))] : null;
  table[name] = {
    configuration: name.toUpperCase(),
    panel: panelName, fold: foldArg,
    evaluations: evals,
    candidateCount: rows.length,
    candidateRate: evals ? rows.length / evals : null,
    strategyDiversity: new Set(rows.map((r) => r.strategy_id)).size,
    strategiesFiring: [...new Set(rows.map((r) => r.strategy_id))].sort(),
    sideDiversity: new Set(rows.map((r) => r.side)).size,
    sides: [...new Set(rows.map((r) => r.side))].sort(),
    regimeDiversity: INSUFFICIENT,
    regimeProxy: new Set(rows.map((r) => r.trendContext)).size,
    twoWayCohorts: cohorts.filter((c) => new Set(c.members.map((m) => m.strategy_id)).size === 2).length,
    threeWayCohorts: cohorts.filter((c) => new Set(c.members.map((m) => m.strategy_id)).size === 3).length,
    fourPlusCohorts: cohorts.filter((c) => new Set(c.members.map((m) => m.strategy_id)).size >= 4).length,
    cohortSummary: summarizeCohorts(cohorts, new Set(rows.map((r) => `${r.symbol}|${r.decisionTs}`)).size),
    resolvedShadows: resolved.length,
    unresolvedShadows: rows.length - resolved.length,
    meanShadowR: resolved.length ? stats.meanR : null,
    medianShadowR: resolved.length ? (rs.length % 2 ? rs[Math.floor(mid)] : (rs[mid - 1] + rs[mid]) / 2) : null,
    winRate: resolved.length ? resolved.filter((r) => r.realized_R > 0).length / resolved.length : null,
    costAdjustedR: resolved.length ? stats.meanR : null,
    costModel: "taker fees both legs + adverse slippage included; funding omitted (documented)",
    turnoverPerDay: turnoverPerDay(rows, span),
    drawdownR: stats.maxDrawdownR,
    sufficientSample: stats.sufficient,
    byStrategy: stats.byStrategy,
    bySide: stats.bySide,
    byTrend: stats.byTrend,
    exitReasons: stats.exitReasons,
  };
}

// ---- learner A/B (spec §18) -------------------------------------------------
const abReport = {};
for (const name of configs) {
  const cohorts = cohortsOf(name).map((c) => ({
    ts: c.ts, symbol: c.symbol,
    members: c.members.filter((m) => Number.isFinite(m.realized_R)).map((m) => ({
      strategy_id: m.strategy_id, side: m.side, trendContext: m.trendContext,
      confidence: m.confidence, realized_R: m.realized_R, exitTs: m.exitTs, symbol: m.symbol,
    })),
  }));
  abReport[name] = learnerAB({ cohorts, L, minCohorts: spec.minCohortsForLearnerAB });
}
const abStatus = !abReport.control.ran && !abReport.calibrated.ran ? "NOT RUN"
  : abReport.calibrated.ran && abReport.calibrated.sufficient && abReport.control.ran ? "COMPLETE" : "INSUFFICIENT";

const out = {
  generatedAt: Date.now(),
  panel: panelName, fold: foldArg,
  learningConfig: { priorTrades: L.priorTrades, blockMinN: L.blockMinN, exploreC: L.exploreC },
  table, learnerAB: abReport, learnerABStatus: abStatus,
  note: "counterfactual datasets only; profitability is NOT verified by this comparison",
};
writeCalJSON(COMPARE_PATH, out);

// ---- console report ---------------------------------------------------------
const fmt = (x, d = 4) => (x == null || x === INSUFFICIENT ? INSUFFICIENT : Number(x).toFixed(d));
const c = table.control, k = table.calibrated;
const rowsOut = [
  ["candidate count", c.candidateCount, k.candidateCount, 0],
  ["candidate rate", c.candidateRate == null ? INSUFFICIENT : c.candidateRate, k.candidateRate == null ? INSUFFICIENT : k.candidateRate, 5],
  ["strategy diversity", c.strategyDiversity, k.strategyDiversity, 0],
  ["regime diversity", INSUFFICIENT, INSUFFICIENT, 0],
  ["regime diversity (offline trend PROXY)", c.regimeProxy, k.regimeProxy, 0],
  ["side diversity", c.sideDiversity, k.sideDiversity, 0],
  ["2-way cohorts", c.twoWayCohorts, k.twoWayCohorts, 0],
  ["3-way cohorts", c.threeWayCohorts, k.threeWayCohorts, 0],
  ["4-way+ cohorts", c.fourPlusCohorts, k.fourPlusCohorts, 0],
  ["resolved shadows", c.resolvedShadows, k.resolvedShadows, 0],
  ["mean shadow R", c.meanShadowR, k.meanShadowR, 4],
  ["median shadow R", c.medianShadowR, k.medianShadowR, 4],
  ["win rate %", c.winRate == null ? null : c.winRate * 100, k.winRate == null ? null : k.winRate * 100, 1],
  ["cost-adjusted R", c.costAdjustedR, k.costAdjustedR, 4],
  ["turnover (candidates/day)", c.turnoverPerDay, k.turnoverPerDay, 2],
  ["drawdown (R)", c.drawdownR, k.drawdownR, 2],
];
const tableOut = { panel: panelName, fold: foldArg, rows: rowsOut.map(([metric, a, b, d]) => ({ metric, control: a, calibrated: b, digits: d })) };
out.consoleTable = tableOut;
writeCalJSON(COMPARE_PATH, out);

if (wantJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`CONTROL vs CALIBRATED — counterfactual datasets, panel=${panelName}, fold=${foldArg}`);
  console.log("-".repeat(64));
  console.log(`METRIC                                  CONTROL         CALIBRATED`);
  console.log("-".repeat(64));
  for (const [metric, a, b, d] of rowsOut) {
    const f = (x) => (x === INSUFFICIENT ? INSUFFICIENT.padStart(16) : (x == null ? INSUFFICIENT.padStart(16) : Number(x).toFixed(d).padStart(16)));
    console.log(`${metric.padEnd(38)} ${f(a)}  ${f(b)}`);
  }
  console.log("-".repeat(64));
  console.log(`strategies firing  CONTROL=[${c.strategiesFiring.join(", ")}]`);
  console.log(`                   CALIBRATED=[${k.strategiesFiring.join(", ")}]`);
  console.log(`sides              CONTROL=[${c.sides.join(",")}]  CALIBRATED=[${k.sides.join(",")}]`);
  console.log(`exit reasons       CONTROL=${JSON.stringify(c.exitReasons)}`);
  console.log(`                   CALIBRATED=${JSON.stringify(k.exitReasons)}`);
  console.log(`sample sufficiency CONTROL=${c.sufficientSample}  CALIBRATED=${k.sufficientSample} (min resolved ${spec.objective.minResolvedForQuality})`);
  console.log(`\nLEARNER A/B (same learner code, empty store, offline proxy context): ${abStatus}`);
  for (const name of configs) {
    const ab = abReport[name];
    console.log(`  ${name.toUpperCase().padEnd(11)} ${ab.ran ? `cohorts=${ab.cohorts} decisions=${ab.decisions} withAlternatives=${ab.withAlternatives} abstentions=${ab.abstentions} beatBest=${fmt(ab.beatBestRate == null ? null : ab.beatBestRate * 100, 1)}% beatAvg=${fmt(ab.beatAvgRate == null ? null : ab.beatAvgRate * 100, 1)}% meanRegret=${fmt(ab.meanRegret)} cells=${ab.learningCells} switches=${ab.switches}` : `NOT RUN (${ab.reason})`}`);
  }
  console.log(`\nSHORT/LONG structures are reported as observed, never manufactured; profitability is NOT verified here.`);
  console.log(`results written to ${COMPARE_PATH}`);
}

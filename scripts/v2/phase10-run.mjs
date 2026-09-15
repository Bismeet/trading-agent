// scripts/v2/phase10-run.mjs — PHASE 10 runner: regime-conditional opportunity
// map + offline portfolio allocator.
//
// Deterministic, causal, reproducible. Reads the pre-registered spec from
// config/phase10-spec.v1.json and NEVER invents a threshold in code.
//
// Protocol:
//   0. Freeze check: production inputs hashed against the spec's frozen baseline.
//   1. Load the research panel (hourly, 730d) and the daily context panel.
//   2. Build the causal feature series and the regime state machine per symbol.
//   3. Generate signal occurrences (existing families only; LONG/SHORT/FLAT).
//   4. Measure every occurrence at every pre-registered horizon (purge+embargo).
//   5. Build the (signal x regime x side x horizon) cells; TRAIN+VALIDATION
//      eligibility gates + Bayesian posterior maps.
//   6. LOCK the selection (hash). TEST is read exactly once after the lock.
//   7. Ablation arms A-F; robustness battery; shuffled-label negative control.
//   8. One verdict per spec.verdictRules.
//
// Outputs (only ever inside data/calibration/, via the phase 10 write guard):
//   data/calibration/phase10-summary.v1.json
//   data/calibration/phase10-trades.v1.jsonl
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, iso, sha256 } from "./store.mjs";
import { loadRealPanel, panelSymbols, splitBounds } from "./calibration.mjs";
import { getMarketOf } from "./final-eval-features.mjs";
import {
  precomputeAlphaSeries, alphaFeaturesAt, roundTripCostFraction, HOURLY_MS, utcDateOf,
  rollingPriorMax, rollingPriorMin,
} from "./alpha-features.mjs";
import { alphaSignalSides, signalFamilyOf } from "./alpha.mjs";
import { measureHorizon, horizonBars } from "./alpha-horizons.mjs";
import { stressNetBps } from "./alpha-metrics.mjs";
import {
  precomputeRegimeStates, regimeDirectionOf, hysteresisOf, REGIME_STATES,
} from "./phase10-regime.mjs";
import {
  cellKeyOf, assignFold, subFoldBounds, subFoldIndexOf, emptyCell, pushCell,
  cellTVChecks, cellTestChecks, cellsTVDigest, cellScore, finishStats,
} from "./phase10-cells.mjs";
import {
  simulateAllocator, correlationOf, portfolioMetrics, foldStatsOfTrades, tradesDigest,
} from "./phase10-allocator.mjs";
import {
  PHASE10_SPEC_PATH, PHASE10_SUMMARY_PATH, PHASE10_TRADES_PATH, PHASE10_REPORT_PATH,
  writePhase10JSON, writePhase10Trades, REPO_ROOT,
} from "./phase10-io.mjs";
import {
  auditFeatureCausality, auditTestIsolation, auditLabelIsolation,
  auditPurgeEmbargo, runLeakageAudit,
} from "./phase10-leakage.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const NO_TEST = args.includes("--no-test");
const argvSymbols = (args.find((a) => a.startsWith("--symbols=")) || "").slice("--symbols=".length);
const sideLog = (msg) => console.log(`[phase10] ${msg}`);
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const fmt = (x, d = 3) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "  n/a");
const fmtR = (x, d = 4) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(d)}` : "  n/a");
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const rnd = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);

// ---- 0. Spec + frozen baseline -------------------------------------------------
const cfg = loadConfig();
const spec = JSON.parse(fs.readFileSync(PHASE10_SPEC_PATH, "utf8"));
const specBytes = fs.readFileSync(PHASE10_SPEC_PATH, "utf8");
const specHash = sha256(specBytes);

const frozenFiles = Object.entries(spec.frozenBaseline.inputs);
const sha256Full = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const prodHashesAtStart = {};
let freezeViolation = null;
for (const [rel, expected] of frozenFiles) {
  const abs = path.join(REPO_ROOT, rel);
  const got = sha256Full(fs.readFileSync(abs, "utf8"));
  prodHashesAtStart[rel] = got;
  if (got !== expected) freezeViolation = `${rel} changed since pre-registration (expected ${expected.slice(0, 16)}, got ${got.slice(0, 16)})`;
}
if (freezeViolation) {
  sideLog(`FROZEN BASELINE VIOLATION: ${freezeViolation}`);
  sideLog("The production configuration must stay frozen for this phase. Aborting (verdict D conditions).");
  process.exit(2);
}

sideLog("================================================================================");
sideLog("PHASE 10 — REGIME-CONDITIONAL OPPORTUNITY MAP + OFFLINE PORTFOLIO ALLOCATOR");
sideLog(`specHash=${specHash.slice(0, 16)} date=${iso()} test=${NO_TEST ? "SKIPPED (--no-test)" : "FROZEN, single evaluation"}`);
sideLog(`hypothesis: existing signals may have conditional (not unconditional) edge —`);
sideLog(`the improvement is opportunity selection + allocation, not another signal search.`);
sideLog(`signals=${spec.signals.length} horizons=[${spec.horizonsHours.join(",")}]h primary=${spec.primaryHorizonHours}h regimes=[${spec.regimeState.states.join(",")}]`);
sideLog(`frozen baseline: ${frozenFiles.length} production inputs verified against the pre-registered hashes`);
sideLog("================================================================================");

// ---- 1. Panels + symbols -------------------------------------------------------
const panels = { hour: loadRealPanel(spec.data.researchPanel), daily: loadRealPanel(spec.data.contextPanel) };
const allSymbols = panelSymbols(panels.hour).filter((s) => (cfg.watchlist || []).some((w) => w.symbol === s));
const symbols = argvSymbols ? allSymbols.filter((s) => argvSymbols.split(",").includes(s)) : allSymbols;
if (symbols.length < 2) throw new Error(`phase10: need at least 2 research symbols, found ${symbols.length}`);

const symbolInfo = {};
for (const s of symbols) {
  const rows = panels.hour.symbols[s];
  const dailyRows = panels.daily.symbols[s] || null;
  symbolInfo[s] = { rows, dailyRows, bounds: splitBounds(rows.ts.length, spec.splits), market: getMarketOf(s, cfg) };
}
const embargoBars = Math.max(1, Math.round(spec.purgeEmbargo.embargoHours));
const horizons = [...spec.horizonsHours];
const hBarsOf = horizons.map((h) => horizonBars(h, spec.data.barMs));
const primaryIdx = horizons.indexOf(spec.primaryHorizonHours);
if (primaryIdx < 0) throw new Error("phase10: primaryHorizonHours must be one of horizonsHours");

sideLog(`[Stage 1/8] Research panel: ${spec.data.researchPanel} (${spec.data.researchInterval}, ${spec.data.researchRange}); embargo=${embargoBars}h after each fold start; purge: full forward window must close inside the fold`);
for (const s of symbols) {
  const info = symbolInfo[s];
  const days = (info.rows.ts.at(-1) - info.rows.ts[0]) / 86400000;
  sideLog(`  ${s.padEnd(14)} market=${info.market.padEnd(6)} bars=${String(info.rows.ts.length).padStart(6)} span=${days.toFixed(0)}d folds=${info.bounds.sizes.train}/${info.bounds.sizes.validation}/${info.bounds.sizes.test}`);
}

// ---- 2. Causal series + regime state machine -----------------------------------
const seriesBySymbol = {};
for (const s of symbols) {
  const info = symbolInfo[s];
  const series = precomputeAlphaSeries({ rows: info.rows, dailyRows: info.dailyRows, spec });
  // Extra production-faithful series for tsmom28 / donchian20 (28d and 20d are
  // CALENDAR-day production windows; 730d of hourly bars covers both).
  const n = series.n;
  const r672 = new Float64Array(n).fill(NaN);
  for (let k = 672; k < n; k++) if (info.rows.close[k - 672] > 0) r672[k] = info.rows.close[k] / info.rows.close[k - 672] - 1;
  series.r672 = r672;
  series.priorMaxClose480 = rollingPriorMax(info.rows.close, 480);
  series.priorMinClose480 = rollingPriorMin(info.rows.close, 480);
  series.regimes = precomputeRegimeStates(series, spec);
  seriesBySymbol[s] = series;
}
const H = hysteresisOf(spec);
const regimeCounts = {};
let barsTotal = 0;
for (const s of symbols) { for (const r of seriesBySymbol[s].regimes) regimeCounts[r] = (regimeCounts[r] ?? 0) + 1; barsTotal += seriesBySymbol[s].n; }
sideLog(`[Stage 2/8] Causal series + regime state machine built in ${secs()}s`);
sideLog(`           state shares: ${Object.entries(regimeCounts).map(([r, c]) => `${r}=${pct(c / barsTotal, 0)}`).join(" ")}`);

// ---- 3. Signal occurrences ------------------------------------------------------
// Production re-expressions (tsmom28 / donchian20): production thresholds
// (sigTsmom: retN=28d=672h, momThreshold=0.03, SMA200 filter; sigDonchian:
// lookback=20d=480h prior closes, SMA200 filter) at the production daily
// decision cadence (first hourly bar of the UTC day on which the condition holds).
function productionSignalSides(id, series, rows, k) {
  const above200 = series.daily.above200[k] === 1;
  if (id === "tsmom28") {
    const r = series.r672[k];
    if (!Number.isFinite(r)) return [];
    const out = [];
    if (r > 0.03 && above200) out.push("long");
    if (r < -0.03 && !above200) out.push("short");
    return out;
  }
  if (id === "donchian20") {
    const hi = series.priorMaxClose480[k], lo = series.priorMinClose480[k];
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return [];
    const out = [];
    if (rows.close[k] > hi && above200) out.push("long");
    if (rows.close[k] < lo && !above200) out.push("short");
    return out;
  }
  throw new Error(`phase10: unknown production signal ${id}`);
}

const geometryFor = (sigKey) => {
  const g = spec.allocator.geometry[sigKey] ?? spec.allocator.geometry.alpha_breakout;
  return { leverage: g.baseLev, stopPct: g.stopPct, targetPct: g.targetPct };
};

const occurrences = [];       // one per (signal, symbol, bar, side)
for (const s of symbols) {
  const info = symbolInfo[s];
  const rows = info.rows;
  const series = seriesBySymbol[s];
  const market = info.market;
  const n = series.n;
  const daySeen = new Set();       // daily cadence for the production re-expressions
  for (let k = 0; k < n; k++) {
    const ts = rows.ts[k];
    for (const sig of spec.signals) {
      let sides;
      if (sig.family === "TSMOM" || sig.family === "DONCHIAN") {
        sides = productionSignalSides(sig.id, series, rows, k);
        if (sides.length === 0) continue;
        const dayKey = `${sig.id}|${utcDateOf(ts)}|`;
        const taken = sides.filter((side) => !daySeen.has(dayKey + side));
        if (taken.length === 0) continue;
        for (const side of taken) daySeen.add(dayKey + side);
        sides = taken;
      } else {
        const fL = alphaFeaturesAt(series, rows, k, { side: "long", horizonHours: spec.primaryHorizonHours, cfg, market, spec });
        const fS = alphaFeaturesAt(series, rows, k, { side: "short", horizonHours: spec.primaryHorizonHours, cfg, market, spec });
        sides = [...alphaSignalSides(sig.id, fL, spec), ...alphaSignalSides(sig.id, fS, spec)];
        if (sides.length === 0) continue;
      }
      for (const side of sides) {
        occurrences.push({
          i: occurrences.length, symbol: s, market, k, ts, side,
          signalId: sig.id, family: sig.family, geometryKey: sig.geometry,
          regime: series.regimes[k], regimeDirection: regimeDirectionOf(series, k),
        });
      }
    }
  }
}
sideLog(`[Stage 3/8] Occurrences: ${occurrences.length} across ${spec.signals.length} signals x ${symbols.length} symbols (${secs()}s)`);
const occBySignal = {};
for (const o of occurrences) occBySignal[o.signalId] = (occBySignal[o.signalId] ?? 0) + 1;
for (const [id, c] of Object.entries(occBySignal).sort()) sideLog(`  ${id.padEnd(20)} ${c}`);

// ---- 4. Measurements across horizons — TRAIN + VALIDATION ONLY ------------------
// TEST is measured only AFTER the selection lock is frozen (stage 6). Before the
// lock no function in this file ever sees a test outcome.
const marginUsd = spec.costModel?.marginUsd ?? spec.allocator.riskUnitUsd;
const geoFor = (o) => geometryFor(o.geometryKey);
const measurements = new Array(occurrences.length).fill(null);
for (const o of occurrences) {
  const info = symbolInfo[o.symbol];
  const perH = new Array(horizons.length).fill(null);
  for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
    const hBars = hBarsOf[hIdx];
    const fold = assignFold(info.bounds, o.k, hBars, embargoBars);
    if (fold !== "train" && fold !== "validation") continue;
    const g = geoFor(o);
    const m = measureHorizon({
      rows: info.rows, i: o.k, side: o.side, horizonHours: horizons[hIdx], cfg, market: o.market, marginUsd,
      leverage: g.leverage, stopPct: g.stopPct, targetPct: g.targetPct, spec,
    });
    if (!m.resolved) continue;
    const sf = subFoldBounds(info.bounds[fold], spec.eligibilityGates.subFolds);
    perH[hIdx] = { m, fold, subFold: subFoldIndexOf(sf, o.k) };
  }
  measurements[o.i] = perH;
}
const tvMeasured = occurrences.reduce((a, o) => a + measurements[o.i].filter(Boolean).length, 0);
sideLog(`[Stage 4/8] Train+Validation measurements: ${tvMeasured} (occurrence x horizon; TEST not touched)`);

// ---- 5. Cells (TRAIN + VALIDATION) ----------------------------------------------
const cellsByHorizon = horizons.map(() => new Map());
for (const o of occurrences) {
  const perH = measurements[o.i];
  if (!perH) continue;
  for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
    const rec = perH[hIdx];
    if (!rec) continue;
    const key = cellKeyOf(o.signalId, o.regime, o.side, horizons[hIdx]);
    const map = cellsByHorizon[hIdx];
    let cell = map.get(key);
    if (!cell) {
      cell = emptyCell(key, o.signalId, o.regime, o.side, horizons[hIdx]);
      cell.tvIdx = { train: [], validation: [] };
      map.set(key, cell);
    }
    pushCell(cell, { fold: rec.fold, subFold: rec.subFold, symbol: o.symbol, market: o.market }, rec.m);
    cell.tvIdx[rec.fold].push(o.i);
  }
}
const cellCount = cellsByHorizon.reduce((a, m) => a + m.size, 0);
sideLog(`[Stage 5/8] Cells: ${cellCount} (signal x regime x side x horizon), TRAIN+VALIDATION statistics only`);

// Global TRAIN std of realized_R per horizon (volatility normalisation prior).
const scoreParams = {
  priorStrengthK: spec.cellModel.shrinkage.priorStrengthK,
  stdShrinkK: spec.cellModel.volNormalization.stdShrinkK,
  stdFloorR: spec.cellModel.volNormalization.stdFloorR,
  uncertaintyPenaltyR: spec.cellModel.uncertaintyPenaltyR,
  profitPrior: spec.cellModel.shrinkage.profitPrior,
};
const globalTrainR = horizons.map(() => ({ n: 0, sum: 0, sq: 0 }));
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const cell of cellsByHorizon[hIdx].values()) {
    globalTrainR[hIdx].n += cell.folds.train.n;
    globalTrainR[hIdx].sum += cell.folds.train.RSum;
    globalTrainR[hIdx].sq += cell.r2.train;
  }
}
const stdGlobalOf = (hIdx) => {
  const g = globalTrainR[hIdx];
  if (g.n <= 1) return 1;
  const mean = g.sum / g.n;
  return Math.sqrt(Math.max(0, g.sq / g.n - mean * mean));
};

// Candidate cells (sample-size pre-gate) -> lazy stress + delayed-entry measurement.
const gates = spec.eligibilityGates;
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const cell of cellsByHorizon[hIdx].values()) {
    if (cell.folds.train.n < gates.minNTrain || cell.folds.validation.n < gates.minNValidation) continue;
    cell.tvEvaluated = true;
    for (const fold of ["train", "validation"]) {
      for (const idx of cell.tvIdx[fold]) {
        const rec = measurements[idx][hIdx];
        if (!rec) continue;
        const stressed = stressNetBps(rec.m, gates.costStressMultiplier);
        if (stressed != null) { cell.stressTV.n += 1; cell.stressTV.sum += stressed; }
        const o = occurrences[idx];
        const g = geoFor(o);
        const nm = measureHorizon({
          rows: symbolInfo[o.symbol].rows, i: o.k, side: o.side, horizonHours: horizons[hIdx], cfg, market: o.market, marginUsd,
          leverage: g.leverage, stopPct: g.stopPct, targetPct: g.targetPct, spec, entryMode: "nextOpen",
        });
        if (nm.resolved) { cell.nextBarTV.n += 1; cell.nextBarTV.sum += nm.netBps; }
      }
    }
    cell.tv = cellTVChecks(cell, gates);
    const sc = cellScore({ train: cell.folds.train, r2Sum: cell.r2.train, stdGlobal: stdGlobalOf(hIdx), params: scoreParams });
    cell.posterior = sc;
  }
}

const eligibleTVByHorizon = horizons.map((h, hIdx) => {
  const eligible = [];
  for (const cell of cellsByHorizon[hIdx].values()) {
    if (cell.tvEvaluated && cell.tv.pass && cell.posterior && cell.posterior.score > 0) {
      eligible.push({ key: cell.key, score: cell.posterior.score, postE: cell.posterior.postE, pProfit: cell.posterior.pProfit });
    }
  }
  eligible.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return eligible;
});
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  const evaluated = [...cellsByHorizon[hIdx].values()].filter((c) => c.tvEvaluated).length;
  sideLog(`[Stage 5/8] h=${String(horizons[hIdx]).padStart(3)}h cells=${cellsByHorizon[hIdx].size} evaluated=${evaluated} eligibleTV=${eligibleTVByHorizon[hIdx].length}`);
}
const failReasonCounts = {};
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const cell of cellsByHorizon[hIdx].values()) {
    if (!cell.tvEvaluated || cell.tv.pass) continue;
    for (const f of cell.tv.failed) failReasonCounts[f] = (failReasonCounts[f] ?? 0) + 1;
  }
}
sideLog(`           TV gate failures across all evaluated cells: ${Object.entries(failReasonCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`);

// ---- 6. Selection lock ----------------------------------------------------------
// The lock is hashed BEFORE any TEST outcome is read. It contains the eligible
// cell keys, the train/val digests and every parameter that influenced selection.
const lock = {
  phase: spec.phase, specHash, primaryHorizonHours: spec.primaryHorizonHours,
  horizons: horizons,
  gates, cellModel: spec.cellModel, allocator: spec.allocator,
  eligibleTV: eligibleTVByHorizon.map((e) => e.map((x) => ({ key: x.key, score: +x.score.toFixed(6) }))),
  cellsTVDigest: sha256(cellsTVDigest(horizons.flatMap((h, hIdx) => [...cellsByHorizon[hIdx].values()]))),
};
const lockHash = sha256(JSON.stringify(lock));
sideLog(`[Stage 6/8] SELECTION LOCK frozen: ${lockHash.slice(0, 16)} (eligible TV cells: ${eligibleTVByHorizon.reduce((a, e) => a + e.length, 0)})`);

// Pre-lock leakage gate: prove that NO TEST measurement exists before the lock was
// frozen. This must hold at this exact point (after the lock, before Stage 6b reads
// any test data). If it does not, the experiment is invalid regardless of outcome.
const preLockTestIsolation = auditTestIsolation({
  occurrences, measurements, boundsOf: (s) => symbolInfo[s].bounds, hBarsOf, horizons,
  assignFold, embargoBars, expectNoTest: true,
});
if (!preLockTestIsolation.pass) {
  sideLog("[Stage 6/8] LEAKAGE: TEST data was present before the selection lock. Evaluation INVALID.");
  process.exit(3);
}
sideLog("[Stage 6/8] Pre-lock leakage gate: no TEST outcomes before the lock — OK");

if (NO_TEST) {
  sideLog("[Stage 6/8] --no-test: stopping before TEST is opened. Lock hash above identifies this frozen state.");
  writePhase10JSON(PHASE10_SUMMARY_PATH, {
    phase: spec.phase, specHash, lockHash, testEvaluated: false, prodHashes: prodHashesAtStart,
    eligibleTV: eligibleTVByHorizon.map((e, hIdx) => ({ horizonHours: horizons[hIdx], cells: e })),
  });
  sideLog("[phase10] summary written (no TEST evaluation, no verdict).");
  process.exit(0);
}

// ---- 6b. TEST — read exactly once, after the lock -------------------------------
for (const o of occurrences) {
  const info = symbolInfo[o.symbol];
  for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
    const hBars = hBarsOf[hIdx];
    if (assignFold(info.bounds, o.k, hBars, embargoBars) !== "test") continue;
    const g = geoFor(o);
    const m = measureHorizon({
      rows: info.rows, i: o.k, side: o.side, horizonHours: horizons[hIdx], cfg, market: o.market, marginUsd,
      leverage: g.leverage, stopPct: g.stopPct, targetPct: g.targetPct, spec,
    });
    if (!m.resolved) continue;
    const sf = subFoldBounds(info.bounds.test, gates.subFolds);
    measurements[o.i][hIdx] = { m, fold: "test", subFold: subFoldIndexOf(sf, o.k) };
  }
}
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const o of occurrences) {
    const rec = measurements[o.i] ? measurements[o.i][hIdx] : null;
    if (!rec || rec.fold !== "test") continue;
    const key = cellKeyOf(o.signalId, o.regime, o.side, horizons[hIdx]);
    const cell = cellsByHorizon[hIdx].get(key);
    if (!cell) continue;
    pushCell(cell, { fold: "test", subFold: rec.subFold, symbol: o.symbol, market: o.market }, rec.m);
  }
}
sideLog(`[Stage 6b/8] TEST measured exactly once (lock ${lockHash.slice(0, 16)})`);

// ---- 6c. Leakage audit (robustness check #8) -----------------------------------
// Runs on the LIVE pipeline objects (never a re-implementation) to prove that
// no feature, label or fold boundary ever peeked across a cut. A failure here
// makes the experiment EVALUATION INVALID — it cannot produce any verdict.
function sliceRows(rows, end) {
  if (end == null || end >= rows.ts.length) return rows;
  return {
    ts: rows.ts.slice(0, end), open: rows.open.slice(0, end), high: rows.high.slice(0, end),
    low: rows.low.slice(0, end), close: rows.close.slice(0, end),
  };
}
function rebuildSeriesFrom(symbol, rows, dailyRows) {
  const series = precomputeAlphaSeries({ rows, dailyRows, spec });
  const n = series.n;
  const r672 = new Float64Array(n).fill(NaN);
  for (let k = 672; k < n; k++) if (rows.close[k - 672] > 0) r672[k] = rows.close[k] / rows.close[k - 672] - 1;
  series.r672 = r672;
  series.priorMaxClose480 = rollingPriorMax(rows.close, 480);
  series.priorMinClose480 = rollingPriorMin(rows.close, 480);
  series.regimes = precomputeRegimeStates(series, spec);
  return series;
}
const leakProbe = (symbol, { rows, dailyRows }, k, o) => {
  const series = rebuildSeriesFrom(symbol, rows, dailyRows);
  const market = o.market ?? getMarketOf(symbol, cfg);
  const fL = alphaFeaturesAt(series, rows, k, { side: "long", horizonHours: spec.primaryHorizonHours, cfg, market, spec });
  const fS = alphaFeaturesAt(series, rows, k, { side: "short", horizonHours: spec.primaryHorizonHours, cfg, market, spec });
  return {
    regime: series.regimes[k], regimeDirection: regimeDirectionOf(series, k),
    featLong: fL, featShort: fS, r672: series.r672[k],
    priorMax480: series.priorMaxClose480[k], priorMin480: series.priorMinClose480[k],
    dlyAbove200: series.daily.above200[k],
  };
};
const leakRowsOf = (symbol) => ({ rows: symbolInfo[symbol].rows, dailyRows: symbolInfo[symbol].dailyRows });
const leakTruncateFor = (symbol, k) => ({ rows: sliceRows(symbolInfo[symbol].rows, k + 1), dailyRows: symbolInfo[symbol].dailyRows });
const leakMeasureAt = ({ o, hIdx, upTo }) => {
  const info = symbolInfo[o.symbol];
  const g = geometryFor(o.geometryKey);
    return measureHorizon({
    rows: sliceRows(info.rows, upTo), i: o.k, side: o.side, horizonHours: horizons[hIdx],
    cfg, market: o.market, marginUsd, leverage: g.leverage, stopPct: g.stopPct, targetPct: g.targetPct, spec,
  });
};
const leakageAudit = runLeakageAudit([
  auditFeatureCausality({ occurrences, rowsOf: leakRowsOf, truncateFor: leakTruncateFor, probe: leakProbe, sample: 48 }),
    auditTestIsolation({ occurrences, measurements, boundsOf: (s) => symbolInfo[s].bounds, hBarsOf, horizons, assignFold, embargoBars, expectNoTest: false }),
  auditLabelIsolation({ occurrences, measurements, measureAt: leakMeasureAt, sample: 48 }),
  auditPurgeEmbargo({ occurrences, measurements, boundsOf: (s) => symbolInfo[s].bounds, hBarsOf, horizons, subFoldBoundsOf: (s, f) => subFoldBounds(symbolInfo[s].bounds[f], spec.eligibilityGates.subFolds), subFolds: spec.eligibilityGates.subFolds, embargoBars }),
]);
for (const c of leakageAudit.checks) sideLog(`  leakage ${c.name.padEnd(18)} pass=${c.pass} checked=${c.checked}${c.pass ? "" : "  FAILURES=" + c.failures.length}`);
sideLog(`[Stage 6c/8] Leakage audit: ${leakageAudit.pass ? "PASSED" : "FAILED"} — evaluation ${leakageAudit.pass ? "VALID" : "INVALID"}`);

// ---- 7. TEST gates on the locked cells ------------------------------------------
const finalEligibleByHorizon = horizons.map((h, hIdx) => {
  const out = [];
  for (const e of eligibleTVByHorizon[hIdx]) {
    const cell = cellsByHorizon[hIdx].get(e.key);
    const te = cellTestChecks(cell, gates);
    if (te.pass) out.push({ ...e, test: te });
  }
  return out;
});
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  sideLog(`[Stage 7/8] h=${String(horizons[hIdx]).padStart(3)}h eligibleTV=${eligibleTVByHorizon[hIdx].length} -> passedAllGates=${finalEligibleByHorizon[hIdx].length}`);
}

// ---- 8. Ablation arms A-F --------------------------------------------------------
const firstTs = Math.min(...symbols.map((s) => symbolInfo[s].rows.ts[0]));
const lastTs = Math.max(...symbols.map((s) => symbolInfo[s].rows.ts.at(-1)));
const corrMatrix = spec.cellModel.correlationMatrix;
const correlate = (a, b) => correlationOf(a, b, corrMatrix);

// regime-level and (regime x side)-level TRAIN+VALIDATION edges at the primary horizon
const regimeAggTV = {};
const regimeSideAggTV = {};
for (const cell of cellsByHorizon[primaryIdx].values()) {
  const n = cell.folds.train.n + cell.folds.validation.n;
  const R = cell.folds.train.RSum + cell.folds.validation.RSum;
  const r = (regimeAggTV[cell.regime] ??= { n: 0, R: 0 });
  r.n += n; r.R += R;
  const rs = (regimeSideAggTV[`${cell.regime}|${cell.side}`] ??= { n: 0, R: 0 });
  rs.n += n; rs.R += R;
}
const regimePositive = new Set(Object.entries(regimeAggTV).filter(([, v]) => v.n > 0 && v.R / v.n > 0).map(([k]) => k));
const regimeSidePositive = new Set(Object.entries(regimeSideAggTV).filter(([, v]) => v.n > 0 && v.R / v.n > 0).map(([k]) => k));

const toTrade = (o, rec) => {
  const m = rec.m;
  return {
    i: o.i, signalId: o.signalId, regime: o.regime, side: o.side, horizonHours: spec.primaryHorizonHours,
    symbol: o.symbol, market: o.market, fold: rec.fold, ts: o.ts, utc: utcDateOf(o.ts), k: o.k,
    entryIdx: m.entryIdx ?? o.k, exitIdx: m.exitIdx, holdHours: m.holdHours,
    entryRef: m.entryRef, exitRef: m.exitRef, exit_reason: m.exit_reason,
    rawBps: m.rawBps, grossBps: m.grossBps, netBps: m.netBps, costBps: m.costBps, feeBps: m.feeBps, slipBps: m.slipBps,
    netPnl: m.netPnl, grossPnl: m.grossPnl, costUsd: m.costUsd, realized_R: m.realized_R,
  };
};

// Non-overlap per symbol at the primary horizon (arms A-E).
function runNonOverlapArm(indices, name) {
  const nextFree = {};
  const trades = [];
  let blocked = 0;
  const sorted = [...indices].sort((a, b) => occurrences[a].ts - occurrences[b].ts || occurrences[a].symbol.localeCompare(occurrences[b].symbol) || a - b);
  for (const idx of sorted) {
    const o = occurrences[idx];
    const rec = measurements[idx][primaryIdx];
    if (!rec) continue;
    if ((nextFree[o.symbol] ?? -1) > o.k) { blocked += 1; continue; }
    nextFree[o.symbol] = Math.max(o.k + 1, rec.m.exitIdx + 1);
    trades.push({ ...toTrade(o, rec), cellKey: cellKeyOf(o.signalId, o.regime, o.side, spec.primaryHorizonHours), arm: name });
  }
  return { name, trades, blocked };
}

const baselineIdx = occurrences.filter((o) => o.family === "TSMOM" || o.family === "DONCHIAN").map((o) => o.i);
const allIdx = occurrences.filter((o) => measurements[o.i] && measurements[o.i][primaryIdx]).map((o) => o.i);
const armA = runNonOverlapArm(baselineIdx, "A_baseline");
const armB = runNonOverlapArm(allIdx, "B_signal_only");
const armC = runNonOverlapArm(allIdx.filter((i) => regimePositive.has(occurrences[i].regime)), "C_signal_regime");
const armD = runNonOverlapArm(allIdx.filter((i) => regimeSidePositive.has(`${occurrences[i].regime}|${occurrences[i].side}`)), "D_signal_regime_side");
const eligibleKeysPrimary = new Set(eligibleTVByHorizon[primaryIdx].map((e) => e.key));
const armE = runNonOverlapArm(allIdx.filter((i) => eligibleKeysPrimary.has(cellKeyOf(occurrences[i].signalId, occurrences[i].regime, occurrences[i].side, spec.primaryHorizonHours))), "E_cell_filter");
sideLog(`[Stage 8/8] Arms: A=${armA.trades.length} B=${armB.trades.length} C=${armC.trades.length} D=${armD.trades.length} E=${armE.trades.length} trades (blocked: A=${armA.blocked} B=${armB.blocked} C=${armC.blocked} D=${armD.blocked} E=${armE.blocked})`);

// Full allocator (arm F): every (occurrence, horizon) whose cell passed the
// TRAIN+VALIDATION gates — i.e. exactly the set that was locked BEFORE TEST was
// read. The allocator must never see the TEST-inclusive set: using it would
// select on TEST and would make arms A-E and arm F incomparable. The TEST gate
// result (finalEligibleByHorizon) is reported as a post-hoc description only.
const eligibleScoreMap = new Map();
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const e of eligibleTVByHorizon[hIdx]) eligibleScoreMap.set(e.key, e.score);
}
const passedAllGatesKeys = new Set(finalEligibleByHorizon.flatMap((e) => e.map((x) => x.key)));
const Focc = [];
const Fmeas = [];
for (const o of occurrences) {
  for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
    const rec = measurements[o.i] ? measurements[o.i][hIdx] : null;
    if (!rec) continue;
    const key = cellKeyOf(o.signalId, o.regime, o.side, horizons[hIdx]);
    if (!eligibleScoreMap.has(key)) continue;
    Focc.push({ ...o, i: Focc.length, horizonHours: horizons[hIdx], cellKey: key, geometryKey: o.geometryKey, fold: rec.fold });
    Fmeas.push(rec.m);
  }
}
const allocOpts = {
  eligible: eligibleScoreMap, allocSpec: spec.allocator, correlate,
  geometryOf: (o) => spec.allocator.geometry[o.geometryKey] ?? spec.allocator.geometry.alpha_breakout,
};
const armF = simulateAllocator({ occurrences: Focc, measurements: Fmeas, ...allocOpts });
armF.name = "F_full_allocator";
sideLog(`[Stage 8/8] Arm F allocator: admitted=${armF.funnel.admitted} of ${armF.funnel.occurrences} eligible opportunities (flat: no-cell=${armF.funnel.flat_no_cell}, non-positive=${armF.funnel.flat_non_positive_score}, penalty=${armF.funnel.flat_penalty}, limits: sym=${armF.funnel.limit_symbol}/mkt=${armF.funnel.limit_market}/total=${armF.funnel.limit_total})`);
// Descriptive only: how many of the allocator's admitted trades happened to sit in
// cells that ALSO passed the TEST gates. This number never influences selection.
{
  const admittedKeys = new Set(armF.trades.map((t) => t.cellKey));
  const inTest = armF.trades.filter((t) => passedAllGatesKeys.has(t.cellKey)).length;
  sideLog(`[Stage 8/8] Arm F descriptive: ${inTest}/${armF.trades.length} admitted trades sit in cells that also pass the TEST gates; `
    + `allocator decided on ${eligibleScoreMap.size} TRAIN+VALIDATION cells, of which ${passedAllGatesKeys.size} went on to pass TEST (${admittedKeys.size} cells traded)`);
}

const armSummary = (arm) => ({
  name: arm.name,
  trades: arm.trades.length,
  funnel: arm.funnel ?? null,
  blockedNonOverlap: arm.blocked ?? null,
  stats: foldStatsOfTrades(arm.trades),
  portfolio: portfolioMetrics(arm.trades, { equityStartUsd: spec.allocator.equityStartUsd, firstTs, lastTs }),
  digest: tradesDigest(arm.trades),
});
const arms = {
  A_baseline: armSummary(armA), B_signal_only: armSummary(armB), C_signal_regime: armSummary(armC),
  D_signal_regime_side: armSummary(armD), E_cell_filter: armSummary(armE), F_full_allocator: armSummary(armF),
};
for (const [name, a] of Object.entries(arms)) {
  const t = a.stats.test;
  sideLog(`  ${name.padEnd(28)} n=${String(a.trades).padStart(5)} trainNet=${fmtR(a.stats.train.netBps, 1)} valNet=${fmtR(a.stats.validation.netBps, 1)} TESTnet=${fmtR(t.netBps, 1)} TESTmeanR=${fmtR(t.mean_R)} sharpe=${fmt(a.portfolio.Sharpe, 2)}`);
}
// determinism: identical inputs must give an identical allocator output
const armF2 = simulateAllocator({ occurrences: Focc, measurements: Fmeas, ...allocOpts });
const deterministic = tradesDigest(armF2.trades) === arms.F_full_allocator.digest;
sideLog(`[Stage 8/8] Determinism (allocator run twice): ${deterministic ? "IDENTICAL" : "MISMATCH — EVALUATION INVALID"}`);

// ---- robustness battery on arm F -------------------------------------------------
const reprice = (m, mult) => {
  const netBps = stressNetBps(m, mult);
  if (netBps == null) return null;
  const riskUsd = m.riskUsd ?? 1;
  const netPnl = m.grossPnl - (m.costUsd ?? 0) * mult;
  return { ...m, netBps, netPnl, costUsd: (m.costUsd ?? 0) * mult, realized_R: riskUsd > 0 ? netPnl / riskUsd : 0 };
};
const robustness = {};
for (const mult of spec.robustness.costMultipliers) {
  const m2 = mult === 1 ? Fmeas : Fmeas.map((m) => reprice(m, mult));
  const r = simulateAllocator({ occurrences: Focc, measurements: m2, ...allocOpts });
  robustness[`cost_x${mult}`] = { trades: r.trades.length, stats: foldStatsOfTrades(r.trades), portfolio: portfolioMetrics(r.trades, { equityStartUsd: spec.allocator.equityStartUsd, firstTs, lastTs }) };
}
// delayed entry: re-measure every allocator opportunity with next-bar-open entry
const FmeasDelayed = Fmeas.map((m, i) => {
  const o = Focc[i];
  const g = geoFor(o);
  const nm = measureHorizon({
    rows: symbolInfo[o.symbol].rows, i: o.k, side: o.side, horizonHours: o.horizonHours, cfg, market: o.market, marginUsd,
    leverage: g.leverage, stopPct: g.stopPct, targetPct: g.targetPct, spec, entryMode: "nextOpen",
  });
  return nm.resolved ? nm : null;
});
const armFDelayed = simulateAllocator({ occurrences: Focc, measurements: FmeasDelayed, ...allocOpts });
robustness.delayed_entry = { trades: armFDelayed.trades.length, stats: foldStatsOfTrades(armFDelayed.trades), portfolio: portfolioMetrics(armFDelayed.trades, { equityStartUsd: spec.allocator.equityStartUsd, firstTs, lastTs }) };
robustness.worse_fills_x1_5 = robustness["cost_x1.5"];
for (const [k, r] of Object.entries(robustness)) {
  if (k === "worse_fills_x1_5") continue;
  sideLog(`  robustness ${k.padEnd(12)} n=${String(r.trades).padStart(5)} TESTnet=${fmtR(r.stats.test.netBps, 1)} TESTmeanR=${fmtR(r.stats.test.mean_R)}`);
}

// ---- shuffled-label negative control ----------------------------------------------
// Deterministic hash permutation of outcomes within each (fold, horizon) group,
// then the ENTIRE pipeline (cells -> gates -> scores -> allocator) re-run on it.
const salt = spec.robustness.shuffledLabels.salt;
const shuffledMeas = horizons.map(() => new Array(occurrences.length).fill(null));
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  const groups = {};
  for (const o of occurrences) {
    const rec = measurements[o.i] ? measurements[o.i][hIdx] : null;
    if (rec) (groups[rec.fold] ??= []).push(o.i);
  }
  for (const [fold, idxs] of Object.entries(groups)) {
    const order = idxs.map((i) => ({ i, h: sha256(`${i}|${hIdx}|${fold}|${salt}`) })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i));
    for (let p = 0; p < idxs.length; p++) shuffledMeas[hIdx][idxs[p]] = measurements[order[p].i][hIdx];
  }
}
const shCells = horizons.map(() => new Map());
for (const o of occurrences) {
  for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
    const rec = shuffledMeas[hIdx][o.i];
    if (!rec || rec.fold === "test") continue;
    const key = cellKeyOf(o.signalId, o.regime, o.side, horizons[hIdx]);
    const map = shCells[hIdx];
    let cell = map.get(key);
    if (!cell) { cell = emptyCell(key, o.signalId, o.regime, o.side, horizons[hIdx]); cell.tvIdx = { train: [], validation: [] }; map.set(key, cell); }
    pushCell(cell, { fold: rec.fold, subFold: rec.subFold, symbol: o.symbol, market: o.market }, rec.m);
    cell.tvIdx[rec.fold].push(o.i);
  }
}
const shEligibleByHorizon = horizons.map((h, hIdx) => {
  // the vol-normalisation prior must come from the SHUFFLED train population
  const g = { n: 0, sum: 0, sq: 0 };
  for (const c of shCells[hIdx].values()) { g.n += c.folds.train.n; g.sum += c.folds.train.RSum; g.sq += c.r2.train; }
  const stdGlobalShuffled = g.n > 1 ? Math.sqrt(Math.max(0, g.sq / g.n - (g.sum / g.n) ** 2)) : 1;
  const out = [];
  for (const cell of shCells[hIdx].values()) {
    if (cell.folds.train.n < gates.minNTrain || cell.folds.validation.n < gates.minNValidation) continue;
    for (const fold of ["train", "validation"]) {
      for (const idx of cell.tvIdx[fold]) {
        const rec = shuffledMeas[hIdx][idx];
        if (!rec) continue;
        const stressed = stressNetBps(rec.m, gates.costStressMultiplier);
        if (stressed != null) { cell.stressTV.n += 1; cell.stressTV.sum += stressed; }
        const o = occurrences[idx];
        const g2 = geoFor(o);
        const nm = measureHorizon({
          rows: symbolInfo[o.symbol].rows, i: o.k, side: o.side, horizonHours: horizons[hIdx], cfg, market: o.market, marginUsd,
          leverage: g2.leverage, stopPct: g2.stopPct, targetPct: g2.targetPct, spec, entryMode: "nextOpen",
        });
        if (nm.resolved) { cell.nextBarTV.n += 1; cell.nextBarTV.sum += nm.netBps; }
      }
    }
    const tv = cellTVChecks(cell, gates);
    const sc = cellScore({ train: cell.folds.train, r2Sum: cell.r2.train, stdGlobal: stdGlobalShuffled, params: scoreParams });
    if (tv.pass && sc.score > 0) out.push({ key: cell.key, score: sc.score });
  }
  return out;
});
const shEligibleMap = new Map();
for (let hIdx = 0; hIdx < horizons.length; hIdx++) for (const e of shEligibleByHorizon[hIdx]) shEligibleMap.set(e.key, e.score);
const shOcc = [];
const shMeas = [];
for (const o of occurrences) {
  for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
    const rec = shuffledMeas[hIdx][o.i];
    if (!rec) continue;
    const key = cellKeyOf(o.signalId, o.regime, o.side, horizons[hIdx]);
    if (!shEligibleMap.has(key)) continue;
    shOcc.push({ ...o, i: shOcc.length, horizonHours: horizons[hIdx], cellKey: key, geometryKey: o.geometryKey, fold: rec.fold });
    shMeas.push(rec.m);
  }
}
const armFShuffled = simulateAllocator({
  occurrences: shOcc, measurements: shMeas, eligible: shEligibleMap,
  allocSpec: spec.allocator, geometryOf: (o) => spec.allocator.geometry[o.geometryKey] ?? spec.allocator.geometry.alpha_breakout, correlate,
});
const shuffledStats = foldStatsOfTrades(armFShuffled.trades);
const shuffledCellCount = shEligibleByHorizon.reduce((a, e) => a + e.length, 0);
sideLog(`[Stage 8/8] Shuffled-label control: eligibleTVcells=${shuffledCellCount} trades=${armFShuffled.trades.length} TESTmeanR=${fmtR(shuffledStats.test.mean_R)} (real: ${fmtR(arms.F_full_allocator.stats.test.mean_R)})`);
const realTestMeanR = arms.F_full_allocator.stats.test.mean_R;
const shuffledTestMeanR = shuffledStats.test.mean_R;
const shuffleControlValid = !(Number.isFinite(realTestMeanR) && realTestMeanR > 0 && Number.isFinite(shuffledTestMeanR) && shuffledTestMeanR > 0);
sideLog(`[Stage 8/8] Shuffled control ${shuffleControlValid ? "DESTROYED the edge — evaluation VALID" : "FAILED to destroy the edge — EVALUATION INVALID"}`);

// ---- verdict ----------------------------------------------------------------------
const cellsPassedAll = finalEligibleByHorizon.reduce((a, e) => a + e.length, 0);
const armFStats = arms.F_full_allocator.stats;
const robustA = Number.isFinite(armFStats.test.mean_R) && armFStats.test.mean_R > 0
  && Number.isFinite(robustness["cost_x1.25"].stats.test.mean_R) && robustness["cost_x1.25"].stats.test.mean_R > 0
  && Number.isFinite(robustness.delayed_entry.stats.test.mean_R) && robustness.delayed_entry.stats.test.mean_R > 0;
// B requires the locked (TV-eligible) cells to replicate a raw + gross edge on TEST
let lockedTestN = 0, lockedTestRaw = 0, lockedTestGross = 0;
for (const e of eligibleTVByHorizon[primaryIdx]) {
  const c = cellsByHorizon[primaryIdx].get(e.key);
  lockedTestN += c.folds.test.n;
  lockedTestRaw += c.folds.test.rawSum;
  lockedTestGross += c.folds.test.grossSum;
}
const rawReplicated = lockedTestN > 0 && lockedTestRaw > 0 && lockedTestGross > 0;

let verdict;
if (!shuffleControlValid || !deterministic || !leakageAudit.pass) {
  verdict = {
    grade: "D", label: "EVALUATION INVALID",
    reason: !deterministic
      ? "The allocator was not deterministic across repeated runs."
      : !shuffleControlValid
        ? "The shuffled-label control failed to destroy the apparent edge."
        : `Leakage audit failed (${leakageAudit.failed.join(", ")}): a feature, label or fold boundary looked across a cut.`,
  };
} else if (cellsPassedAll > 0 && robustA) {
  verdict = {
    grade: "A", label: "ROBUST CONDITIONAL ALPHA",
    reason: `${cellsPassedAll} (signal, regime, side, horizon) cell(s) passed every pre-registered gate (positive TRAIN, VALIDATION and TEST net R; >=3/4 TEST sub-folds positive) AND the full allocator kept positive TEST net economics under x1.25 costs and delayed entry.`,
  };
} else if (rawReplicated) {
  verdict = {
    grade: "B", label: "PROMISING BUT INSUFFICIENT",
    reason: `Locked cells replicate a positive raw+gross edge on TEST (n=${lockedTestN}, raw=${fmtR(lockedTestRaw / lockedTestN, 2)} bps) but the full economic/robustness gate set failed (cells passing all gates: ${cellsPassedAll}; allocator TEST meanR=${fmtR(armFStats.test.mean_R)}; x1.25 costs=${fmtR(robustness["cost_x1.25"].stats.test.mean_R)}; delayed=${fmtR(robustness.delayed_entry.stats.test.mean_R)}).`,
  };
} else {
  verdict = {
    grade: "C", label: "NO ROBUST EDGE",
    reason: "NO ROBUST CONDITIONAL ALPHA FOUND — no cell or allocation produced a replicated positive out-of-sample edge; the conditional map shows where the edge is NOT.",
  };
}
sideLog("================================================================================");
sideLog(`FINAL VERDICT: ${verdict.grade} — ${verdict.label}`);
sideLog(`  ${verdict.reason}`);
sideLog("================================================================================");

// ---- conditional map (signal x regime x side x horizon) for the report -------------
const conditionalMap = [];
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const cell of cellsByHorizon[hIdx].values()) {
    if (!cell.tvEvaluated) continue;
    // The accumulators only expose sums; net/gross/raw R, the median and the
    // profit factor exist solely on the FINISHED statistics. Reading the raw
    // accumulator here silently produced null for every economics column.
    const tr = finishStats(cell.folds.train);
    const va = finishStats(cell.folds.validation);
    const te = finishStats(cell.folds.test);
    conditionalMap.push({
      key: cell.key, signalId: cell.signalId, regime: cell.regime, side: cell.side, horizonHours: horizons[hIdx],
      nTrain: tr.resolved, meanRTrain: rnd(tr.mean_R),
      netTrain: rnd(tr.netBps), grossTrain: rnd(tr.grossBps), rawTrain: rnd(tr.rawBps),
      nValidation: va.resolved, meanRValidation: rnd(va.mean_R),
      netValidation: rnd(va.netBps), grossValidation: rnd(va.grossBps), rawValidation: rnd(va.rawBps),
      nTest: te.resolved, meanRTest: rnd(te.mean_R),
      netTest: rnd(te.netBps), grossTest: rnd(te.grossBps), rawTest: rnd(te.rawBps),
      medianNetRTrain: rnd(tr.medianNetBps),
      winRateTrain: rnd(tr.winRate),
      profitFactorTrain: rnd(tr.profitFactor),
      mfeOverCostTrain: rnd(tr.mfeCostRatio),
      maeMeanTrain: rnd(tr.maeBps),
      mfeMeanTrain: rnd(tr.mfeBps),
      stressMeanTV: cell.stressTV.n ? rnd(cell.stressTV.sum / cell.stressTV.n) : null,
      nextBarMeanTV: cell.nextBarTV.n ? rnd(cell.nextBarTV.sum / cell.nextBarTV.n) : null,
      tvPass: cell.tv.pass, tvFailed: cell.tv.failed.slice(0, 4),
      testPass: cellTestChecks(cell, gates).pass,
      score: cell.posterior ? rnd(cell.posterior.score) : null,
      postE: cell.posterior ? rnd(cell.posterior.postE) : null,
      pProfit: cell.posterior ? rnd(cell.posterior.pProfit) : null,
    });
  }
}
conditionalMap.sort((a, b) => (b.meanRTrain ?? -99) - (a.meanRTrain ?? -99));

// regime / side / horizon rollups (TRAIN+VALIDATION primary evidence + TEST check)
const rollup = { byRegime: {}, bySide: {}, byHorizon: {} };
const addToRollup = (bucket, k, c) => {
  const b = (bucket[k] ??= { n: 0, RSum: 0, wins: 0, netSum: 0, grossProfit: 0, grossLoss: 0, testN: 0, testRSum: 0 });
  b.n += c.folds.train.n + c.folds.validation.n; b.RSum += c.folds.train.RSum + c.folds.validation.RSum;
  b.wins += c.folds.train.wins + c.folds.validation.wins; b.netSum += c.folds.train.netSum + c.folds.validation.netSum;
  b.grossProfit += c.folds.train.grossProfit + c.folds.validation.grossProfit; b.grossLoss += c.folds.train.grossLoss + c.folds.validation.grossLoss;
  b.testN += c.folds.test.n; b.testRSum += c.folds.test.RSum;
};
for (let hIdx = 0; hIdx < horizons.length; hIdx++) {
  for (const cell of cellsByHorizon[hIdx].values()) {
    addToRollup(rollup.byHorizon, String(horizons[hIdx]), cell);
    addToRollup(rollup.byRegime, cell.regime, cell);
    addToRollup(rollup.bySide, cell.side, cell);
  }
}

// ---- end-of-run freeze check + outputs --------------------------------------------
const prodHashesAtEnd = {};
let endViolation = null;
for (const [rel] of frozenFiles) {
  const got = sha256Full(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
  prodHashesAtEnd[rel] = got;
  if (got !== prodHashesAtStart[rel]) endViolation = rel;
}
if (endViolation) {
  verdict = { grade: "D", label: "EVALUATION INVALID", reason: `Production input ${endViolation} changed during the run.` };
}

const summary = {
  phase: spec.phase, specHash, lockHash, testEvaluated: true,
  prodHashesAtStart, prodHashesAtEnd, frozenBaselineChanged: endViolation ?? null,
  runtimeSeconds: +((Date.now() - t0) / 1000).toFixed(1),
  data: {
    symbols,
    barsPerSymbol: Object.fromEntries(symbols.map((s) => [s, symbolInfo[s].rows.ts.length])),
    regimeStateShares: Object.fromEntries(Object.entries(regimeCounts).map(([r, c]) => [r, +(c / barsTotal).toFixed(4)])),
  },
  lock,
  cells: {
    total: conditionalMap.length,
    eligibleTV: eligibleTVByHorizon.map((e, hIdx) => ({ horizonHours: horizons[hIdx], count: e.length, keys: e.map((x) => x.key) })),
    passedAllGates: finalEligibleByHorizon.map((e, hIdx) => ({ horizonHours: horizons[hIdx], count: e.length, keys: e.map((x) => x.key) })),
    map: conditionalMap,
  },
  rollup,
  arms,
  robustness,
  shuffledLabelControl: { salt, eligibleCells: shuffledCellCount, trades: armFShuffled.trades.length, testMeanR: shuffledTestMeanR, realTestMeanR, valid: shuffleControlValid },
    determinism: { allocatorRunTwice: deterministic, digest: arms.F_full_allocator.digest },
  leakageAudit: {
    pass: leakageAudit.pass,
    failed: leakageAudit.failed,
    checks: leakageAudit.checks.map((c) => ({ name: c.name, pass: c.pass, checked: c.checked, ...(c.pass ? {} : { failures: c.failures }) })),
  },
  verdict,
};
writePhase10JSON(PHASE10_SUMMARY_PATH, summary);
writePhase10Trades(PHASE10_TRADES_PATH, armF.trades);
sideLog(`[phase10] wrote ${path.basename(PHASE10_SUMMARY_PATH)} (${armF.trades.length} allocator trades) in ${secs()}s`);
sideLog("[phase10] NOTE: research only. Nothing is deployed; production configuration untouched (hash-verified).");
if (endViolation) process.exit(3);

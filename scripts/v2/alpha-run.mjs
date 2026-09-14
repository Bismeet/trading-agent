// scripts/v2/alpha-run.mjs — ALPHA RESEARCH experiment runner.
//
// Deterministic, causal, reproducible. Reads the pre-registered spec from
// config/alpha-experiment-spec.v1.json and NEVER invents a threshold in code.
//
// Protocol:
//   1. Build the research panel (hourly, 730d) and the causal feature series.
//   2. Generate the pre-registered candidate signals (8 signals, 7 families).
//   3. Measure every candidate over every pre-registered horizon.
//   4. Analyse each feature/regime/rejection rule on TRAIN + VALIDATION only.
//   5. SELECT on TRAIN + VALIDATION, then LOCK the selection (hash) — frozen.
//   6. Evaluate TEST exactly once on the locked, frozen candidate set.
//   7. Apply the pre-registered gates and emit a single verdict.
//
// Outputs (only ever inside data/calibration/):
//   data/calibration/alpha-summary.v2.json
//   data/calibration/alpha-trades.v2.jsonl
//
// Production files are read-only inputs: config.json, config/final.control.json,
// config/management.control.json and config/final-experiment-spec.v1.json are
// hashed at start and re-hashed at the end; any change aborts the run.
import fs from "node:fs";
import path from "node:path";
import { loadConfig, iso, sha256 } from "./store.mjs";
import {
  STRATEGY_IDS, loadRealPanel, panelSymbols, runStrategyOverPanel, splitBounds,
  foldName, inBounds, loadControlConfig, paramsFor,
} from "./calibration.mjs";
import { getMarketOf } from "./final-eval-features.mjs";
import {
  precomputeAlphaSeries, alphaFeaturesAt, qualityScore, roundTripCostFraction, HOURLY_MS, utcDateOf,
} from "./alpha-features.mjs";
import { alphaSignalSides, decideAlphaEntry, evaluateRejectionRules, signalFamilyOf } from "./alpha.mjs";
import { simulateManagedTrade } from "./management-rules.mjs";
import { measureHorizon, managedTradeAdapter, horizonBars } from "./alpha-horizons.mjs";
import {
  emptyStats, pushStats, finishStats, dictPush, quantileEdges, bucketOf, stressNetBps,
  writeAlphaJSON, assertAlphaPath, ALPHA_SUMMARY_PATH, ALPHA_TRADES_PATH, REPO_ROOT,
  evaluateAlphaGates, computeVerdict,
} from "./alpha-metrics.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const NO_TEST = args.includes("--no-test");
const argvSymbols = (args.find((a) => a.startsWith("--symbols=")) || "").slice("--symbols=".length);
const sideLog = (msg) => console.log(`[alpha] ${msg}`);
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const fmtBps = (x) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(2)}` : "  n/a");
const fmtPct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const rnd = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);

// ---- 0. Load config + spec, snapshot production inputs -----------------------
const SPEC_PATH = path.join(REPO_ROOT, "config", "alpha-experiment-spec.v1.json");
const PRODUCTION_INPUTS = [
  path.join(REPO_ROOT, "config.json"),
  path.join(REPO_ROOT, "config", "final.control.json"),
  path.join(REPO_ROOT, "config", "management.control.json"),
  path.join(REPO_ROOT, "config", "final-experiment-spec.v1.json"),
];
const prodHashesAtStart = Object.fromEntries(
  PRODUCTION_INPUTS.map((p) => [path.basename(p), sha256(fs.readFileSync(p, "utf8"))]),
);

const cfg = loadConfig();
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
const specHash = sha256(fs.readFileSync(SPEC_PATH, "utf8"));
const controlStrategy = loadControlConfig();

sideLog("================================================================================");
sideLog("ALPHA RESEARCH — pre-registered discovery experiment");
sideLog(`specHash=${specHash.slice(0, 16)} date=${iso()} test=${NO_TEST ? "SKIPPED (--no-test)" : "FROZEN, single evaluation"}`);
sideLog(`families=${spec.signalFamilies.length} signals=${spec.signals.length} horizons=[${spec.horizonsHours.join(",")}]h primary=${spec.primaryHorizonHours}h`);
sideLog("================================================================================");

// ---- 1. Panels -----------------------------------------------------------------
const panels = { hour: loadRealPanel(spec.data.researchPanel), daily: loadRealPanel(spec.data.contextPanel) };
const allSymbols = panelSymbols(panels.hour).filter((s) => (cfg.watchlist || []).some((w) => w.symbol === s));
const symbols = argvSymbols ? allSymbols.filter((s) => argvSymbols.split(",").includes(s)) : allSymbols;
if (symbols.length < 2) throw new Error(`alpha: need at least 2 research symbols, found ${symbols.length}`);

const symbolInfo = {};
for (const s of symbols) {
  const rows = panels.hour.symbols[s];
  const dailyRows = panels.daily.symbols[s] || null;
  const bounds = splitBounds(rows.ts.length, spec.splits);
  const subSize = {
    train: Math.max(1, Math.floor((bounds.train[1] - bounds.train[0]) / spec.subFolds)),
    validation: Math.max(1, Math.floor((bounds.validation[1] - bounds.validation[0]) / spec.subFolds)),
    test: Math.max(1, Math.floor((bounds.test[1] - bounds.test[0]) / spec.subFolds)),
  };
  symbolInfo[s] = { rows, dailyRows, bounds, subSize, market: getMarketOf(s, cfg) };
}
const subFoldOf = (s, i) => {
  const info = symbolInfo[s];
  const b = info.bounds;
  if (inBounds(b.train, i)) return Math.min(spec.subFolds - 1, Math.floor((i - b.train[0]) / info.subSize.train));
  if (inBounds(b.validation, i)) return Math.min(spec.subFolds - 1, Math.floor((i - b.validation[0]) / info.subSize.validation));
  if (inBounds(b.test, i)) return Math.min(spec.subFolds - 1, Math.floor((i - b.test[0]) / info.subSize.test));
  return null;
};
const foldOf = (s, i) => foldName(symbolInfo[s].bounds, i);

sideLog(`[Stage 1/8] Research panel: ${spec.data.researchPanel} (${spec.data.researchInterval}, ${spec.data.researchRange})`);
for (const s of symbols) {
  const info = symbolInfo[s];
  const days = (info.rows.ts.at(-1) - info.rows.ts[0]) / 86400000;
  sideLog(`  ${s.padEnd(14)} market=${info.market.padEnd(6)} bars=${String(info.rows.ts.length).padStart(6)} span=${days.toFixed(0)}d ${utcDateOf(info.rows.ts[0])}..${utcDateOf(info.rows.ts.at(-1))} folds=${info.bounds.sizes.train}/${info.bounds.sizes.validation}/${info.bounds.sizes.test}`);
}
const datasetCounts = {
  symbols: symbols.length,
  markets: [...new Set(symbols.map((s) => symbolInfo[s].market))].sort(),
  hour: {
    bars: symbols.reduce((a, s) => a + symbolInfo[s].rows.ts.length, 0),
    firstTs: Math.min(...symbols.map((s) => symbolInfo[s].rows.ts[0])),
    lastTs: Math.max(...symbols.map((s) => symbolInfo[s].rows.ts.at(-1))),
  },
  daily: {
    bars: symbols.reduce((a, s) => a + symbolInfo[s].dailyRows.ts.length, 0),
    firstTs: Math.min(...symbols.map((s) => symbolInfo[s].dailyRows.ts[0])),
    lastTs: Math.max(...symbols.map((s) => symbolInfo[s].dailyRows.ts.at(-1))),
  },
  folds: Object.fromEntries(symbols.map((s) => [s, symbolInfo[s].bounds])),
};

// ---- 2. Causal feature series (one per symbol, reused by every stage) --------
const seriesBySymbol = {};
for (const s of symbols) {
  seriesBySymbol[s] = precomputeAlphaSeries({ rows: symbolInfo[s].rows, dailyRows: symbolInfo[s].dailyRows, spec });
}
sideLog(`[Stage 2/8] Causal feature series built for ${symbols.length} symbols in ${secs()}s`);

const leverageFor = (key) => spec.strategyGeometry[key]?.baseLev ?? 12;
const stopPctFor = (key) => spec.strategyGeometry[key]?.stopPct ?? 0.05;
const targetPctFor = (key) => spec.strategyGeometry[key]?.targetPct ?? 0.08;
const marginUsd = spec.costModel.marginUsd;

// Benchmark signal: frozen donchian re-expressed at hourly resolution, with the
// production DAILY decision cadence (one candidate per symbol per UTC day).
function benchDonchianSide(series, rows, k, side) {
  const L = spec.benchmarkDonchian.lookbackHours;
  const lvl = side === "long" ? series.priorMax[L]?.[k] : series.priorMin[L]?.[k];
  if (!Number.isFinite(lvl)) return false;
  const sgn = side === "long" ? 1 : -1;
  if (sgn * (rows.close[k] - lvl) <= 0) return false;
  const above200 = series.daily.above200[k] === 1;
  return side === "long" ? above200 : !above200;
}

// ---- 3. Candidate generation -------------------------------------------------
// candidates[signalId] = [{ symbol, k, side, fold, subFold, market, close, ts }]
// Also records the raw firing count (every bar on which the signal condition
// holds) so the report can show candidates vs admitted (duty cycle).
const candidates = {};
for (const sig of spec.signals) candidates[sig.id] = [];
const rawFirings = {};
for (const sig of spec.signals) rawFirings[sig.id] = 0;
const benchCandidates = [];
let benchRawFirings = 0;

for (const s of symbols) {
  const rows = symbolInfo[s].rows;
  const series = seriesBySymbol[s];
  const market = symbolInfo[s].market;
  const n = series.n;
  const daySeen = new Set();          // codes "${utcDate}|${side}" already taken for the benchmark
  for (let k = 0; k < n; k++) {
    const fL = alphaFeaturesAt(series, rows, k, { side: "long", horizonHours: spec.primaryHorizonHours, cfg, market, spec });
    const fS = alphaFeaturesAt(series, rows, k, { side: "short", horizonHours: spec.primaryHorizonHours, cfg, market, spec });
    const fold = foldOf(s, k);
    if (fold === "out-of-range") continue;
    for (const sig of spec.signals) {
      const sides = [...alphaSignalSides(sig.id, fL, spec), ...alphaSignalSides(sig.id, fS, spec)];
      if (sides.length === 0) continue;
      rawFirings[sig.id] += 1;
      candidates[sig.id].push({ symbol: s, k, side: sides[0], signalId: sig.id, fold, subFold: subFoldOf(s, k), market, ts: rows.ts[k], close: rows.close[k] });
    }
    // Benchmark (daily cadence): first hourly bar of the UTC day on which the
    // frozen donchian condition holds, per side.
    for (const side of ["long", "short"]) {
      if (!benchDonchianSide(series, rows, k, side)) continue;
      benchRawFirings += 1;
      const dayKey = `${utcDateOf(rows.ts[k])}|${side}`;
      if (daySeen.has(dayKey)) continue;
      daySeen.add(dayKey);
      benchCandidates.push({ symbol: s, k, side, signalId: "bench_donchian", fold, subFold: subFoldOf(s, k), market, ts: rows.ts[k], close: rows.close[k] });
    }
  }
}

for (const sig of spec.signals) {
  const byFold = { train: 0, validation: 0, test: 0 };
  for (const c of candidates[sig.id]) byFold[c.fold] += 1;
  sideLog(`[Stage 3/8] ${sig.id.padEnd(24)} family=${sig.family} rawFiringBars=${String(rawFirings[sig.id]).padStart(7)} candidates=${String(candidates[sig.id].length).padStart(6)} (train/val/test ${byFold.train}/${byFold.validation}/${byFold.test})`);
}
sideLog(`[Stage 3/8] ${"bench_donchian".padEnd(24)} family=bench rawFiringBars=${String(benchRawFirings).padStart(7)} candidates=${String(benchCandidates.length).padStart(6)}`);

// ---- 4. Arm evaluation machinery ---------------------------------------------
const ALL_FOLDS = ["train", "validation", "test"];

// Quality-score buckets: FIXED edges, documented here and in the report; they
// are not fitted on any data.
function scoreBucket(score) {
  if (!Number.isFinite(score)) return "na";
  if (score < 0.35) return "q0_<0.35";
  if (score < 0.5) return "q1_0.35-0.50";
  if (score < 0.65) return "q2_0.50-0.65";
  if (score < 0.8) return "q3_0.65-0.80";
  return "q4_>=0.80";
}

// Frozen Phase 7 cross-strategy agreement at DAILY decision cadence (mirrors
// production, where the daily-context strategies are evaluated on each cycle):
// a strategy "tags" every UTC day on which its frozen daily signal fires.
function buildAgreementMap() {
  const map = new Map();   // `${symbol}|${yyyy-mm-dd}|${side}` -> Set<strategyId>
  for (const id of STRATEGY_IDS) {
    const run = runStrategyOverPanel({
      id, params: paramsFor(controlStrategy, id), cfg,
      panel: panels.daily, dailyPanel: panels.daily, panelName: "daily", symbols,
    });
    for (const s of run.signals) {
      const key = `${s.symbol}|${utcDateOf(s.ts)}|${s.side}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(s.strategy_id ?? id);
    }
  }
  return map;
}

function policyTake(policy, { f, c, agreementMap }) {
  switch (policy) {
    case "all": return true;
    case "cost": return (f.comp?.costCoverage ?? 0) >= (spec.qualityScore.costCoverageFloor ?? 0.2);
    case "quality": return decideAlphaEntry({ id: c.signalId, f, spec }).take;
    case "phase7": return (agreementMap?.get(`${c.symbol}|${utcDateOf(c.ts)}|${c.side}`)?.size ?? 0) >= 1;
    default: throw new Error(`alpha: unknown entry policy "${policy}"`);
  }
}

// ---- 5. Arm execution --------------------------------------------------------
// One arm = (candidate list) x (entry policy) x (exit/management mode), walked
// chronologically with NON-OVERLAPPING sequential trades per symbol — the
// honest, tradable quantity: while a symbol has a position open under an arm,
// no further entry is taken on that symbol. Every grouping accumulator is the
// same stats cell, so the report can never disagree with stored results.
function evalArm({
  name, candList, horizonHours = spec.primaryHorizonHours, stratKey = "alpha_breakout",
  managed = null, entryMode = "close", entryPolicy = "all", folds = ALL_FOLDS,
  costMultiplier = 1.0, agreementMap = null, detail = false, keepTrades = false, trackStress = false,
}) {
  const out = {
    name, horizonHours, policy: entryPolicy, mode: managed ?? `fixed_${horizonHours}h_${entryMode}`,
    candidates: 0, accepted: 0,
    all: emptyStats(),
    folds: { train: emptyStats({ list: true }), validation: emptyStats({ list: true }), test: emptyStats({ list: true }) },
    bySubFold: {}, byMarket: {}, bySymbol: {}, byRegime: {}, byStructure: {}, byVol: {},
    bySide: {}, byScore: {}, byReject: {}, byExitReason: {},
    symbolPnl: {}, subFoldPnl: {},
    moveCost: { sum: 0, n: 0, pass2: 0, pass5: 0, pass10: 0 },
    funnel: { nonOverlapBlocked: 0, rejected: {} },
    stress: { sum: 0, n: 0 },
    trades: [],
  };
  const lastExit = {};   // symbol -> first bar index on which a new entry is allowed
  const list = [...candList].sort((a, b) => a.ts - b.ts || a.symbol.localeCompare(b.symbol));
  for (const c of list) {
    if (!folds.includes(c.fold)) continue;
    out.candidates += 1;
    const rows = symbolInfo[c.symbol].rows;
    const series = seriesBySymbol[c.symbol];
    const f = alphaFeaturesAt(series, rows, c.k, { side: c.side, horizonHours, cfg, market: c.market, spec });
    const mcr = f.moveCostRatio ?? 0;
    out.moveCost.sum += mcr; out.moveCost.n += 1;
    if (mcr >= 2) out.moveCost.pass2 += 1;
    if (mcr >= 5) out.moveCost.pass5 += 1;
    if (mcr >= 10) out.moveCost.pass10 += 1;
    // Non-overlap is an availability constraint, not a signal judgement, so it is
    // applied before the entry policy and counted separately in the funnel.
    if (lastExit[c.symbol] != null && c.k < lastExit[c.symbol]) { out.funnel.nonOverlapBlocked += 1; continue; }
    if (!policyTake(entryPolicy, { f, c, agreementMap })) {
      const why = entryPolicy === "quality"
        ? decideAlphaEntry({ id: c.signalId, f, spec }).reason
        : entryPolicy === "phase7" ? "ABSTAIN_NO_AGREEMENT"
          : entryPolicy === "cost" ? "ABSTAIN_COST" : "ABSTAIN";
      out.funnel.rejected[why] = (out.funnel.rejected[why] ?? 0) + 1;
      continue;
    }
    out.accepted += 1;
    let m;
    if (managed) {
      const sim = simulateManagedTrade({
        cand: {
          tradeId: `alpha_${name}_${c.symbol}_${c.ts}`, symbol: c.symbol, strategy_id: stratKey,
          side: c.side, price: c.close, ts: c.ts, i: c.k, baseLev: leverageFor(stratKey),
          market: c.market, fold: c.fold, subFold: c.subFold,
        },
        rows, cfg, prod: { perStrategyGeometry: spec.strategyGeometry }, spec, policyId: managed, costMultiplier,
      });
      m = managedTradeAdapter(sim, { marginUsd, leverage: leverageFor(stratKey), stopPct: stopPctFor(stratKey) });
      lastExit[c.symbol] = m.resolved ? c.k + Math.max(1, Math.round(m.holdHours ?? 1)) : c.k + 1;
    } else {
      m = measureHorizon({
        rows, i: c.k, side: c.side, horizonHours, cfg, market: c.market, marginUsd,
        leverage: leverageFor(stratKey), stopPct: stopPctFor(stratKey), targetPct: targetPctFor(stratKey),
        spec, costMultiplier, entryMode,
      });
      lastExit[c.symbol] = m.resolved ? m.exitIdx + 1 : c.k + 1;
    }
    if (!m.resolved) { out.folds[c.fold].censored += 1; continue; }
    pushStats(out.all, m);
    pushStats(out.folds[c.fold], m);
    if (detail) {
      dictPush(out.bySubFold, `${c.fold}|${c.subFold ?? "x"}`, m);
      dictPush(out.byMarket, c.market, m);
      dictPush(out.bySymbol, c.symbol, m);
      dictPush(out.byRegime, f.regime, m);
      dictPush(out.byStructure, f.structureRegime, m);
      dictPush(out.byVol, f.volRegime, m);
      dictPush(out.bySide, c.side, m);
      dictPush(out.byScore, scoreBucket(qualityScore(f, spec)), m);
      dictPush(out.byExitReason, m.exit_reason, m);
      const rej = evaluateRejectionRules(f, spec);
      dictPush(out.byReject, rej.pass ? "ALL_RULES|pass" : "ALL_RULES|any_fired", m);
      for (const r of spec.falseBreakoutRejectionRules) {
        dictPush(out.byReject, `${r.id}|${rej.rejects.includes(r.id) ? "fired" : "clear"}`, m);
      }
      const sp = (out.symbolPnl[c.symbol] ??= { n: 0, netPnl: 0, grossProfit: 0 });
      sp.n += 1; sp.netPnl += m.netPnl; if (m.grossPnl > 0) sp.grossProfit += m.grossPnl;
      const key = `${c.fold}|${c.subFold ?? "x"}`;
      const pp = (out.subFoldPnl[key] ??= { n: 0, netPnl: 0, grossProfit: 0 });
      pp.n += 1; pp.netPnl += m.netPnl; if (m.grossPnl > 0) pp.grossProfit += m.grossPnl;
    }
    if (trackStress) {
      const stressed = stressNetBps(m, spec.costStress.multiplier);
      if (stressed != null) { out.stress.sum += stressed; out.stress.n += 1; }
    }
    if (keepTrades) {
      out.trades.push({
        symbol: c.symbol, side: c.side, ts: c.ts, utc: utcDateOf(c.ts), fold: c.fold, subFold: c.subFold,
        market: c.market, regime: f.regime, score: +qualityScore(f, spec).toFixed(4),
        entryRef: +m.entryRef.toFixed(8), exitRef: +m.exitRef.toFixed(8),
        rawBps: +m.rawBps.toFixed(3), grossBps: +m.grossBps.toFixed(3), netBps: +m.netBps.toFixed(3),
        costBps: +m.costBps.toFixed(3), realized_R: +m.realized_R.toFixed(4),
        exit_reason: m.exit_reason, holdHours: m.holdHours,
      });
    }
  }
  return out;
}

const finDict = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, finishStats(v)]));

function finArm(out) {
  const gp = Object.values(out.symbolPnl).reduce((a, x) => a + x.grossProfit, 0);
  const maxSymbolProfitShare = gp > 0
    ? Math.max(...Object.values(out.symbolPnl).map((x) => x.grossProfit / gp)) : 1;
  const gpp = Object.values(out.subFoldPnl).reduce((a, x) => a + x.grossProfit, 0);
  const maxPeriodProfitShare = gpp > 0
    ? Math.max(...Object.values(out.subFoldPnl).map((x) => x.grossProfit / gpp)) : 1;
  return {
    name: out.name, horizonHours: out.horizonHours, policy: out.policy, mode: out.mode,
    candidates: out.candidates, accepted: out.accepted,
    acceptanceRate: out.candidates > 0 ? out.accepted / out.candidates : null,
    all: finishStats(out.all),
    folds: {
      train: finishStats(out.folds.train),
      validation: finishStats(out.folds.validation),
      test: finishStats(out.folds.test),
    },
    bySubFold: finDict(out.bySubFold), byMarket: finDict(out.byMarket), bySymbol: finDict(out.bySymbol),
    byRegime: finDict(out.byRegime), byStructure: finDict(out.byStructure), byVol: finDict(out.byVol),
    bySide: finDict(out.bySide), byScore: finDict(out.byScore), byReject: finDict(out.byReject),
    byExitReason: finDict(out.byExitReason),
    maxSymbolProfitShare, maxPeriodProfitShare,
    symbolPnl: out.symbolPnl, subFoldPnl: out.subFoldPnl,
    funnel: {
      candidates: out.candidates,
      nonOverlapBlocked: out.funnel.nonOverlapBlocked,
      policyRejected: out.funnel.rejected,
      accepted: out.accepted,
    },
    moveCost: {
      mean: out.moveCost.n ? out.moveCost.sum / out.moveCost.n : null,
      n: out.moveCost.n,
      passRate2: out.moveCost.n ? out.moveCost.pass2 / out.moveCost.n : null,
      passRate5: out.moveCost.n ? out.moveCost.pass5 / out.moveCost.n : null,
      passRate10: out.moveCost.n ? out.moveCost.pass10 / out.moveCost.n : null,
    },
    stressNetBps: out.stress.n ? out.stress.sum / out.stress.n : null,
    trades: out.trades,
  };
}

// Cheap structural digest of a candidate set, used to lock the selection before
// TEST is touched (ids only — no outcome information).
const candDigest = (list, folds) => {
  const h = sha256(list.filter((c) => folds.includes(c.fold)).map((c) => `${c.symbol}|${c.side}|${c.ts}`).join(","));
  return h.slice(0, 16);
};

// ---- 6. Stage 4: horizon study on TRAIN+VALIDATION ---------------------------
// Everything below this line is computed BEFORE any TEST outcome is read. The
// selection protocol (spec.selectionProtocol) consumes only these numbers.
const TV = ["train", "validation"];
const primary = spec.primaryHorizonHours;
sideLog("[Stage 4/8] building frozen Phase 7 daily agreement map ...");
const agreementMap = buildAgreementMap();
sideLog(`  agreement days tagged=${agreementMap.size}`);

const signalIds = spec.signals.map((s) => s.id);
const horizonStudy = {};        // signalId -> horizonHours -> finished arm (TRAIN+VAL)
const benchHorizonStudy = {};   // horizonHours -> finished arm (TRAIN+VAL)
for (const id of signalIds) {
  horizonStudy[id] = {};
  for (const h of spec.horizonsHours) {
    horizonStudy[id][h] = finArm(evalArm({
      name: `${id}@${h}h`, candList: candidates[id], horizonHours: h,
      folds: TV, detail: h === primary, entryPolicy: "all", trackStress: h === primary,
    }));
  }
  const a = horizonStudy[id][primary].folds;
  sideLog(`[Stage 4/8] ${id.padEnd(24)} h=${primary} train n=${String(a.train.resolved).padStart(5)} raw=${fmtBps(a.train.rawBps)} net=${fmtBps(a.train.netBps)} | val n=${String(a.validation.resolved).padStart(5)} raw=${fmtBps(a.validation.rawBps)} net=${fmtBps(a.validation.netBps)}`);
}
for (const h of spec.horizonsHours) {
  benchHorizonStudy[h] = finArm(evalArm({
    name: `bench_donchian@${h}h`, candList: benchCandidates, horizonHours: h, stratKey: "bench_donchian",
    folds: TV, detail: h === primary, entryPolicy: "all", trackStress: h === primary,
  }));
}
const b0 = benchHorizonStudy[primary].folds;
sideLog(`[Stage 4/8] ${"bench_donchian".padEnd(24)} h=${primary} train n=${String(b0.train.resolved).padStart(5)} raw=${fmtBps(b0.train.rawBps)} net=${fmtBps(b0.train.netBps)} | val n=${String(b0.validation.resolved).padStart(5)} raw=${fmtBps(b0.validation.rawBps)} net=${fmtBps(b0.validation.netBps)}`);

// ---- 7. Stage 5: TRAIN+VALIDATION analyses (no TEST outcome is read here) ----
// 5a. Causal cost-coverage filter (§14): for EVERY eligible bar, does the causal
// expected move (atrNorm * sqrt(h)) clear the round-trip cost by 2x / 5x / 10x?
// This quantifies how much of the tradeable universe a cost-aware filter removes.
function causalCostFilter({ stratKey, foldsWanted }) {
  const res = {};
  for (const h of spec.horizonsHours) res[h] = {};
  for (const s of symbols) {
    const series = seriesBySymbol[s];
    const market = symbolInfo[s].market;
    const costFrac = roundTripCostFraction({ cfg, market, marginUsd, leverage: leverageFor(stratKey), spec });
    if (!(costFrac > 0)) continue;
    for (let k = 0; k < series.n; k++) {
      const fold = foldOf(s, k);
      if (!foldsWanted.includes(fold)) continue;
      const atrN = series.atrNorm[k];
      if (!Number.isFinite(atrN)) continue;
      for (const h of spec.horizonsHours) {
        const ratio = (atrN * Math.sqrt(h)) / costFrac;
        const cell = (res[h][fold] ??= { n: 0, sum: 0, p2: 0, p5: 0, p10: 0 });
        cell.n += 1; cell.sum += ratio;
        if (ratio >= 2) cell.p2 += 1;
        if (ratio >= 5) cell.p5 += 1;
        if (ratio >= 10) cell.p10 += 1;
      }
    }
  }
  const fin = {};
  for (const h of spec.horizonsHours) {
    fin[h] = {};
    for (const fold of Object.keys(res[h])) {
      const c = res[h][fold];
      fin[h][fold] = {
        n: c.n, meanRatio: c.n ? c.sum / c.n : null,
        passRate2: c.n ? c.p2 / c.n : null,
        passRate5: c.n ? c.p5 / c.n : null,
        passRate10: c.n ? c.p10 / c.n : null,
      };
    }
  }
  return fin;
}

// 5b. Feature buckets (§15) and the signal-free base-rate control (§7).
// Bucket edges come from TRAIN ONLY; the same deterministic, non-overlapping bar
// sampling is used in every pass so TRAIN / VAL / TEST are comparable.
const FEATURE_AXES = [
  "z24", "volExpansion", "volRatio", "rangeCompression", "bodyRatio",
  "breakoutDistAtr", "atrNormBps", "agreeCount", "distFromMidAtr", "moveCostRatio",
];
function axisValue(f, axis) {
  switch (axis) {
    case "z24": return f.z24;
    case "volExpansion": return f.volExpansion;
    case "volRatio": return f.volRatio;
    case "rangeCompression": return f.rangeCompression;
    case "bodyRatio": return f.bodyRatio;
    case "breakoutDistAtr": return f.breakoutDistAtr;
    case "atrNormBps": return Number.isFinite(f.atrNorm) ? f.atrNorm * 1e4 : NaN;
    case "agreeCount": return f.agreeCount;
    case "distFromMidAtr": return f.distFromMidAtr;
    case "moveCostRatio": return f.moveCostRatio;
    default: return NaN;
  }
}
function scanBars({ foldsWanted, edges = null }) {
  const wantEdges = edges == null;
  const stats = wantEdges ? null : Object.fromEntries(foldsWanted.map((fd) => [fd, emptyStats()]));
  const buckets = wantEdges ? null : Object.fromEntries(FEATURE_AXES.map((a) => [a, {}]));
  const valsForEdges = wantEdges ? Object.fromEntries(FEATURE_AXES.map((a) => [a, []])) : null;
  const stride = horizonBars(primary);
  const need = wantEdges ? ["train"] : foldsWanted;
  for (const s of symbols) {
    const rows = symbolInfo[s].rows;
    const series = seriesBySymbol[s];
    const market = symbolInfo[s].market;
    let nextFree = -1;
    for (let k = 0; k < series.n; k++) {
      if (k < nextFree) continue;
      const fold = foldOf(s, k);
      if (!need.includes(fold)) continue;
      const r24 = series.rets[24][k];
      if (!Number.isFinite(r24) || r24 === 0) continue;   // direction is taken from causal r24 only
      const side = r24 > 0 ? "long" : "short";
      const f = alphaFeaturesAt(series, rows, k, { side, horizonHours: primary, cfg, market, spec });
      nextFree = k + stride;
      if (wantEdges) {
        for (const a of FEATURE_AXES) {
          const v = axisValue(f, a);
          if (Number.isFinite(v)) valsForEdges[a].push(v);
        }
        continue;
      }
      const m = measureHorizon({
        rows, i: k, side, horizonHours: primary, cfg, market, marginUsd,
        leverage: leverageFor("alpha_breakout"), stopPct: stopPctFor("alpha_breakout"),
        targetPct: targetPctFor("alpha_breakout"), spec,
      });
      pushStats(stats[fold], m);
      for (const a of FEATURE_AXES) {
        const b = bucketOf(axisValue(f, a), edges[a]);
        if (b == null) continue;
        const cell = (buckets[a][b] ??= {});
        (cell[fold] ??= emptyStats());
        pushStats(cell[fold], m);
      }
    }
  }
  return wantEdges
    ? { edges: Object.fromEntries(FEATURE_AXES.map((a) => [a, quantileEdges(valsForEdges[a], 5)])), trainSamples: Object.fromEntries(FEATURE_AXES.map((a) => [a, valsForEdges[a].length])) }
    : { stats, buckets };
}

const costFilterTV = causalCostFilter({ stratKey: "alpha_breakout", foldsWanted: TV });
const edgeScan = scanBars({ foldsWanted: TV });
const bucketScanTV = scanBars({ foldsWanted: TV, edges: edgeScan.edges });
const baseRateTV = Object.fromEntries(Object.entries(bucketScanTV.stats).map(([k, v]) => [k, finishStats(v)]));
for (const h of spec.horizonsHours) {
  const c = costFilterTV[h] ?? {};
  sideLog(`[Stage 5/8] cost-filter h=${String(h).padStart(3)}h train pass5x=${fmtPct(c.train?.passRate5)} pass10x=${fmtPct(c.train?.passRate10)} meanRatio=${c.train?.meanRatio?.toFixed(2) ?? "n/a"}`);
}
sideLog(`[Stage 5/8] base-rate control (r24 direction, no signal): train n=${baseRateTV.train.resolved} raw=${fmtBps(baseRateTV.train.rawBps)} net=${fmtBps(baseRateTV.train.netBps)} | val n=${baseRateTV.validation.resolved} raw=${fmtBps(baseRateTV.validation.rawBps)} net=${fmtBps(baseRateTV.validation.netBps)}`);

// ---- 8. Stage 6: selection protocol on TRAIN+VALIDATION, then LOCK ------------
const g = spec.alphaQualityGates;
const selRow = (id) => {
  const arm = horizonStudy[id][primary];
  const tr = arm.folds.train;
  const va = arm.folds.validation;
  const qualifies = (tr.netBps ?? -1) > 0 && (va.netBps ?? -1) > 0
    && tr.resolved >= g.minResolvedTrain && va.resolved >= g.minResolvedValidation
    && arm.maxSymbolProfitShare <= g.maxSymbolProfitShare;
  return {
    id, family: signalFamilyOf(id, spec),
    trainN: tr.resolved, trainRawBps: rnd(tr.rawBps, 3), trainGrossBps: rnd(tr.grossBps, 3), trainNetBps: rnd(tr.netBps, 3),
    valN: va.resolved, valRawBps: rnd(va.rawBps, 3), valGrossBps: rnd(va.grossBps, 3), valNetBps: rnd(va.netBps, 3),
    maxSymbolProfitShare: rnd(arm.maxSymbolProfitShare),
    qualifies,
  };
};
const selectionRows = signalIds.map(selRow);                                  // spec order => tie-break
const selectedRow = selectionRows.find((r) => r.qualifies) ?? null;
const bestEffortRow = selectionRows.reduce((a, b) => ((b.trainNetBps ?? -1e9) > (a.trainNetBps ?? -1e9) ? b : a), selectionRows[0]);
const alphaId = selectedRow?.id ?? bestEffortRow?.id ?? null;
const selection = {
  protocol: spec.selectionProtocol,
  evaluatedOrder: signalIds,
  rows: selectionRows,
  selected: selectedRow ? selectedRow.id : null,
  bestEffort: bestEffortRow?.id ?? null,
  usedForArms: alphaId,
  usedIsSelected: !!selectedRow,
};
const lock = {
  specHash, primaryHorizonHours: primary,
  selected: selection.selected, bestEffort: selection.bestEffort, usedForArms: alphaId,
  trainValDigest: candDigest(alphaId ? candidates[alphaId] : [], TV),
  benchmarkDigest: candDigest(benchCandidates, TV),
  selectionRows,   // no timestamp: the lock hash must be byte-stable across runs
};
const lockFrozenAt = iso();
const selectionLockHash = sha256(JSON.stringify(lock));
sideLog(`[Stage 6/8] selection=${selectionRows.map((r) => `${r.id}${r.qualifies ? ":QUALIFIES" : ":-"}`).join(" ")}`);
sideLog(`[Stage 6/8] selected=${selection.selected ?? "NONE"} bestEffort=${selection.bestEffort} armsUse=${alphaId} lockHash=${selectionLockHash.slice(0, 16)}`);

// ---- 9. Stage 7: the single, frozen TEST evaluation --------------------------
// TEST outcomes are read exactly once, after the selection has been locked.
const TEST = ["test"];
const horizonTest = {};
const benchTest = {};
const arms = {};
let stressArm = null;
let nextBarArm = null;
if (!NO_TEST && alphaId) {
  for (const id of signalIds) {
    horizonTest[id] = {};
    for (const h of spec.horizonsHours) {
      horizonTest[id][h] = finArm(evalArm({
        name: `${id}@${h}h`, candList: candidates[id], horizonHours: h, folds: TEST, detail: h === primary,
      }));
    }
  }
  for (const h of spec.horizonsHours) {
    benchTest[h] = finArm(evalArm({
      name: `bench_donchian@${h}h`, candList: benchCandidates, horizonHours: h, stratKey: "bench_donchian",
      folds: TEST, detail: h === primary,
    }));
  }
  const OOS = ["validation", "test"];
  const defs = [
    { id: "BASELINE_DONCHIAN_PROD", candList: benchCandidates, stratKey: "bench_donchian", managed: "MGMT_CONTROL" },
    { id: "DONCHIAN_H48", candList: benchCandidates, stratKey: "bench_donchian", horizonHours: primary },
    { id: "NEW_ALPHA", candList: candidates[alphaId], horizonHours: primary, entryPolicy: "all", detail: true, trackStress: true, keepTrades: true },
    { id: "NEW_ALPHA_QUALITY", candList: candidates[alphaId], horizonHours: primary, entryPolicy: "quality", detail: true, trackStress: true, keepTrades: true },
    { id: "NEW_ALPHA_PHASE7", candList: candidates[alphaId], horizonHours: primary, entryPolicy: "phase7", detail: true },
    { id: "NEW_ALPHA_PHASE8", candList: candidates[alphaId], horizonHours: primary, managed: "MGMT_ADAPTIVE_HOLD", detail: true },
    { id: "NEW_ALPHA_QUALITY_PHASE8", candList: candidates[alphaId], horizonHours: primary, entryPolicy: "quality", managed: "MGMT_ADAPTIVE_HOLD", detail: true },
  ];
  for (const d of defs) {
    arms[d.id] = finArm(evalArm({
      name: d.id, candList: d.candList, horizonHours: d.horizonHours ?? primary, stratKey: d.stratKey ?? "alpha_breakout",
      managed: d.managed ?? null, entryPolicy: d.entryPolicy ?? "all", folds: ALL_FOLDS,
      agreementMap, detail: d.detail ?? false, keepTrades: d.keepTrades ?? false, trackStress: d.trackStress ?? false,
    }));
  }
  // Cost-stress and delayed-entry robustness arms are paired with the entry
  // policy of the arm they support (pure alpha vs. quality layer).
  const stressArms = {};
  const nextBarArms = {};
  for (const pol of ["all", "quality"]) {
    stressArms[pol] = finArm(evalArm({ name: `stress_x${spec.costStress.multiplier}@${pol}`, candList: candidates[alphaId], horizonHours: primary, entryPolicy: pol, folds: OOS, costMultiplier: spec.costStress.multiplier }));
    nextBarArms[pol] = finArm(evalArm({ name: `next_open@${pol}`, candList: candidates[alphaId], horizonHours: primary, entryPolicy: pol, folds: OOS, entryMode: "nextOpen" }));
  }
  stressArm = stressArms;
  nextBarArm = nextBarArms;
  for (const id of Object.keys(arms)) {
    const a = arms[id];
    sideLog(`[Stage 7/8] ${id.padEnd(26)} test n=${String(a.folds.test.resolved).padStart(5)} raw=${fmtBps(a.folds.test.rawBps)} gross=${fmtBps(a.folds.test.grossBps)} net=${fmtBps(a.folds.test.netBps)}`);
  }
} else {
  sideLog("[Stage 7/8] TEST SKIPPED (--no-test)");
}

// ---- 10. Stage 8: gates, verdict, artefacts ----------------------------------
let gates = null;
let gatesQualityLayer = null;
let verdict = null;
let rawEdge = null;
let baseRateTest = null;
let costFilterTest = null;
let bucketScanTest = null;
let featureBuckets = {};
if (!NO_TEST && alphaId) {
  costFilterTest = causalCostFilter({ stratKey: "alpha_breakout", foldsWanted: TEST });
  bucketScanTest = scanBars({ foldsWanted: TEST, edges: edgeScan.edges });
  baseRateTest = finishStats(bucketScanTest.stats.test);

  // The pre-registered spec defines two alpha arms (alpha_selected and
  // alpha_quality_layer) but does not name which one the gate set targets, so the
  // full gate table is reported for BOTH. No threshold, horizon or arm definition
  // was changed to produce either table.
  const ctxFor = (arm, pol) => ({
    folds: { train: arm.folds.train, validation: arm.folds.validation, test: arm.folds.test },
    markets: arm.byMarket,
    symbols: arm.bySymbol,
    testSubFolds: [0, 1, 2, 3].map((k) => arm.bySubFold[`test|${k}`]).filter(Boolean),
    moveCostRatio: arm.all.mfeCostRatio,
    maxSymbolProfitShare: arm.maxSymbolProfitShare,
    maxPeriodProfitShare: arm.maxPeriodProfitShare,
    stressNetBps: stressArm[pol].all.netBps,
    nextBarNetBps: nextBarArm[pol].all.netBps,
  });
  gates = evaluateAlphaGates({ ctx: ctxFor(arms.NEW_ALPHA, "all"), spec });
  gatesQualityLayer = evaluateAlphaGates({ ctx: ctxFor(arms.NEW_ALPHA_QUALITY, "quality"), spec });
  rawEdge = {
    validationRawBps: horizonStudy[alphaId][primary].folds.validation.rawBps,
    testRawBps: horizonTest[alphaId][primary].folds.test.rawBps,
    validationResolved: horizonStudy[alphaId][primary].folds.validation.resolved,
    testResolved: horizonTest[alphaId][primary].folds.test.resolved,
    pureSignalTestGrossBps: arms.NEW_ALPHA.folds.test.grossBps,
    pureSignalTestNetBps: arms.NEW_ALPHA.folds.test.netBps,
    qualityLayerTestResolved: arms.NEW_ALPHA_QUALITY.folds.test.resolved,
    qualityLayerTestRawBps: arms.NEW_ALPHA_QUALITY.folds.test.rawBps,
    qualityLayerTestNetBps: arms.NEW_ALPHA_QUALITY.folds.test.netBps,
  };
  verdict = computeVerdict({ selection, gates, rawEdge });
  sideLog(`[Stage 8/8] rawEdge val=${fmtBps(rawEdge.validationRawBps)} n=${rawEdge.validationResolved} | test=${fmtBps(rawEdge.testRawBps)} n=${rawEdge.testResolved}`);

  featureBuckets = {};
  for (const a of FEATURE_AXES) {
    const keys = new Set([
      ...Object.keys(bucketScanTV.buckets[a] ?? {}),
      ...Object.keys(bucketScanTest?.buckets?.[a] ?? {}),
    ]);
    const buckets = [...keys].sort((x, y) => Number(x) - Number(y)).map((k) => {
      const tv = bucketScanTV.buckets[a][k] ?? {};
      const te = bucketScanTest?.buckets?.[a]?.[k] ?? {};
      return {
        bucket: Number(k),
        train: tv.train ? finishStats(tv.train) : null,
        validation: tv.validation ? finishStats(tv.validation) : null,
        test: te.test ? finishStats(te.test) : null,
      };
    });
    featureBuckets[a] = { edges: edgeScan.edges[a], trainSamples: edgeScan.trainSamples[a], buckets };
  }
  sideLog(`[Stage 8/8] gates (alpha_selected): ${gates.pass ? "ALL PASS" : `${gates.failed.length} FAILED [${gates.failed.join(", ")}]`}`);
  sideLog(`[Stage 8/8] gates (quality layer): ${gatesQualityLayer.pass ? "ALL PASS" : `${gatesQualityLayer.failed.length} FAILED [${gatesQualityLayer.failed.join(", ")}]`}`);
  sideLog(`[Stage 8/8] verdict ${verdict.grade} — ${verdict.label}`);
} else if (NO_TEST) {
  verdict = { grade: "N/A", label: "TEST NOT EVALUATED", reason: "run without --no-test for the frozen single TEST evaluation" };
}

// ---- 11. Candidate counts ----------------------------------------------------
const candidateCounts = {};
for (const id of signalIds) {
  const byFold = { train: 0, validation: 0, test: 0 };
  for (const c of candidates[id]) byFold[c.fold] = (byFold[c.fold] ?? 0) + 1;
  candidateCounts[id] = { family: signalFamilyOf(id, spec), rawFiringBars: rawFirings[id], candidates: candidates[id].length, byFold };
}
{
  const byFold = { train: 0, validation: 0, test: 0 };
  for (const c of benchCandidates) byFold[c.fold] = (byFold[c.fold] ?? 0) + 1;
  candidateCounts.bench_donchian = { family: "benchmark", rawFiringBars: benchRawFirings, candidates: benchCandidates.length, byFold };
}

// ---- 12. Assemble + write the artefacts --------------------------------------
const measuredCost = arms.NEW_ALPHA
  ? Object.fromEntries(Object.entries(arms.NEW_ALPHA.byMarket).map(([mkt, s]) => [mkt, {
    n: s.resolved, costBps: rnd(s.costBps, 3), feeBps: rnd(s.feeBps, 3), slipBps: rnd(s.slipBps, 3),
  }]))
  : null;

const summary = {
  experiment: "alpha-research-v1",
  generatedAt: iso(),
  runtimeSeconds: +secs(),
  specPath: "config/alpha-experiment-spec.v1.json",
  specHash,
  specVersion: spec.version,
  specSnapshot: spec,
  primaryHorizonHours: primary,
  horizonsHours: spec.horizonsHours,
  testEvaluated: !NO_TEST,
  testRule: "TEST outcomes are read exactly once, after the selection lock hash is computed",
  productionInputHashes: prodHashesAtStart,
  datasets: datasetCounts,
  subFolds: spec.subFolds,
  candidateCounts,
  baseRate: { train: baseRateTV.train, validation: baseRateTV.validation, test: baseRateTest },
  costFilter: { trainVal: costFilterTV, test: costFilterTest },
  measuredCostByMarket: measuredCost,
  featureBuckets,
  horizonStudyTrainVal: horizonStudy,
  horizonStudyTest: NO_TEST ? null : horizonTest,
  benchmarkTrainVal: benchHorizonStudy,
  benchmarkTest: NO_TEST ? null : benchTest,
  selection,
  selectionLockHash,
  lockFrozenAt,
  lock,
  arms,
  rawEdge,
  gates,
  gatesQualityLayer,
  stressNextBar: NO_TEST ? null : {
    stressMultiplier: spec.costStress.multiplier,
    alpha: { netBps: stressArm?.all?.netBps ?? null, folds: stressArm?.all ? { validation: stressArm.all.folds.validation, test: stressArm.all.folds.test } : null },
    qualityLayer: { netBps: stressArm?.quality?.all?.netBps ?? null },
    nextBarAlpha: { netBps: nextBarArm?.all?.netBps ?? null },
    nextBarQualityLayer: { netBps: nextBarArm?.quality?.all?.netBps ?? null },
  },
  verdict,
};
const summaryPath = writeAlphaJSON(ALPHA_SUMMARY_PATH, summary);
const tradeLines = [];
for (const armId of ["NEW_ALPHA", "NEW_ALPHA_QUALITY"]) {
  for (const t of arms[armId]?.trades ?? []) tradeLines.push(JSON.stringify({ arm: armId, ...t }));
}
if (tradeLines.length > 0) {
  const abs = assertAlphaPath(ALPHA_TRADES_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, tradeLines.join("\n") + "\n");
}
sideLog(`[Stage 8/8] wrote ${path.relative(REPO_ROOT, summaryPath)} (${(fs.statSync(summaryPath).size / 1024).toFixed(0)} KB) and ${tradeLines.length} trades`);

// ---- 13. End-of-run production immutability check ----------------------------
const prodHashesAtEnd = Object.fromEntries(
  PRODUCTION_INPUTS.map((p) => [path.basename(p), sha256(fs.readFileSync(p, "utf8"))]),
);
const prodUnchanged = JSON.stringify(prodHashesAtStart) === JSON.stringify(prodHashesAtEnd);
if (!prodUnchanged) {
  sideLog("FATAL: production input hashes changed during this run — results are not trustworthy");
  sideLog(`  atStart=${JSON.stringify(prodHashesAtStart)}`);
  sideLog(`  atEnd  =${JSON.stringify(prodHashesAtEnd)}`);
  process.exit(1);
}
sideLog("production inputs unchanged (Phase 1-9 remains frozen)");

sideLog("--------------------------------------------------------------------------------");
sideLog(`candidates: ${signalIds.map((id) => `${id}=${candidateCounts[id].candidates}`).join(" ")}`);
if (!NO_TEST && alphaId) {
  const d = arms.NEW_ALPHA;
  sideLog(`pre-registered candidate = ${alphaId} @${primary}h (alpha_selected arm)`);
  sideLog(`  test: n=${d.folds.test.resolved} raw=${fmtBps(d.folds.test.rawBps)} gross=${fmtBps(d.folds.test.grossBps)} net=${fmtBps(d.folds.test.netBps)} R=${fmtBps(d.folds.test.mean_R)}`);
  sideLog(`  gates(alpha_selected): ${gates.pass ? "ALL PASS" : `failed=${gates.failed.join(",")}`}`);
  sideLog(`  gates(quality layer): ${gatesQualityLayer.pass ? "ALL PASS" : `failed=${gatesQualityLayer.failed.join(",")}`}`);
  sideLog(`  verdict: ${verdict.grade} — ${verdict.label}`);
}
sideLog(`done in ${secs()}s`);
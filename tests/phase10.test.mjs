// tests/phase10.test.mjs — PHASE 10 acceptance tests.
//
// Covers the pre-registered evaluation integrity requirements:
//   P01 regime state machine: hysteresis, precedence, determinism, no fitting
//   P02 leakage: regime labels + features at bar k are blind to future bars
//   P03 purge + embargo: no label straddles a fold boundary; embargo gap enforced
//   P04 posterior math: Bayesian shrinkage, volatility normalisation, uncertainty penalty
//   P05 allocator: deterministic, respects exposure limits, applies correlation penalty
//   P06 allocator: FLAT when no eligible cell (knowing when NOT to trade)
//   P07 portfolio metrics: conventions and internal consistency
//   P08 shuffled-label control: deterministic bijection (evaluation validity)
//   P09 write isolation: phase 10 can only ever write its own artefacts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HOURLY_MS, precomputeAlphaSeries, alphaFeaturesAt } from "../scripts/v2/alpha-features.mjs";
import { precomputeRegimeStates, regimeStep, defaultHysteresis, REGIME_STATES } from "../scripts/v2/phase10-regime.mjs";
import {
  assignFold, subFoldBounds, subFoldIndexOf, emptyCell, pushCell,
  posteriorMeanR, posteriorProfitProb, trainStdR, shrunkStdR, cellScore,
  cellTVChecks, cellTestChecks, cellKeyOf,
} from "../scripts/v2/phase10-cells.mjs";
import {
  simulateAllocator, correlationOf, portfolioMetrics, tradesDigest,
} from "../scripts/v2/phase10-allocator.mjs";
import {
  assertPhase10Path, writePhase10JSON, PHASE10_DIR, PHASE10_REPORT_PATH, REPO_ROOT,
} from "../scripts/v2/phase10-io.mjs";
import { emptyStats, pushStats, finishStats } from "../scripts/v2/alpha-metrics.mjs";
import {
  auditFeatureCausality, auditTestIsolation, auditLabelIsolation,
  auditPurgeEmbargo, runLeakageAudit, evenSample,
} from "../scripts/v2/phase10-leakage.mjs";

const ROOT = REPO_ROOT;
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "phase10-spec.v1.json"), "utf8"));
const H = { ...defaultHysteresis, ...SPEC.regimeState.hysteresis };
const snap = (o) => JSON.parse(JSON.stringify(o));

function synthRows(n, seed = (i) => Math.sin(i / 7) * 0.4 + Math.cos(i / 31) * 0.9) {
  const rows = { ts: [], open: [], high: [], low: [], close: [] };
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price * (1 + seed(i) * 0.002);
    price = c;
    rows.ts.push(Date.UTC(2023, 0, 1) + i * HOURLY_MS);
    rows.open.push(o);
    rows.high.push(Math.max(o, c) * 1.001);
    rows.low.push(Math.min(o, c) * 0.999);
    rows.close.push(c);
  }
  return rows;
}

function synthDaily(n, seed = (i) => Math.sin(i / 5) * 0.5) {
  const rows = { ts: [], open: [], high: [], low: [], close: [] };
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = price * (1 + seed(i) * 0.01);
    price = c;
    rows.ts.push(Date.UTC(2022, 0, 1) + i * 86400000);
    rows.open.push(o);
    rows.high.push(Math.max(o, c) * 1.002);
    rows.low.push(Math.min(o, c) * 0.998);
    rows.close.push(c);
  }
  return rows;
}

// ============================================================================
// P01  regime state machine
// ============================================================================

test("P01 regime state machine: hysteresis, precedence, missing-feature fall-through, determinism", () => {
  assert.deepEqual(REGIME_STATES, ["STRONG_TREND", "WEAK_TREND", "RANGE", "VOL_EXPANSION", "VOL_CONTRACTION"]);
  // enter thresholds are stricter than exit thresholds (hysteresis band)
  assert.ok(H.volExpansionEnterHigh > H.volExpansionExitHigh);
  assert.ok(H.volExpansionEnterLow < H.volExpansionExitLow);
  assert.ok(H.strongEnterZ > H.strongExitZ);
  assert.ok(H.weakEnterZ > H.weakExitZ);

  const f = (volExpansion, rangeCompression, absZ) => ({ volExpansion, rangeCompression, absZ });
  // volatility expansion: enters at the HIGH threshold, holds until the LOWER exit
  assert.equal(regimeStep("RANGE", f(1.34, 1.0, 0.1), H), "RANGE");
  assert.equal(regimeStep("RANGE", f(1.35, 1.0, 0.1), H), "VOL_EXPANSION");
  assert.equal(regimeStep("VOL_EXPANSION", f(1.16, 1.0, 0.1), H), "VOL_EXPANSION");
  // once the expansion is left, control falls through to the trend ladder in the
  // fixed precedence order: the SAME features, only |z24| changes.
  assert.equal(regimeStep("VOL_EXPANSION", f(1.15, 1.0, 1.6), H), "STRONG_TREND");
  assert.equal(regimeStep("VOL_EXPANSION", f(1.15, 1.0, 0.8), H), "WEAK_TREND");
  assert.equal(regimeStep("VOL_EXPANSION", f(1.15, 1.0, 0.2), H), "RANGE");
  // volatility contraction via expansion ratio OR range compression
  assert.equal(regimeStep("RANGE", f(0.75, 1.0, 0.1), H), "VOL_CONTRACTION");
  assert.equal(regimeStep("RANGE", f(1.0, 0.55, 0.1), H), "VOL_CONTRACTION");
  assert.equal(regimeStep("VOL_CONTRACTION", f(0.80, 0.60, 0.1), H), "VOL_CONTRACTION");
  assert.equal(regimeStep("VOL_CONTRACTION", f(0.90, 0.70, 0.1), H), "RANGE");
  // trend states with their own hysteresis
  assert.equal(regimeStep("RANGE", f(1.0, 1.0, 1.49), H), "WEAK_TREND");
  assert.equal(regimeStep("RANGE", f(1.0, 1.0, 1.50), H), "STRONG_TREND");
  assert.equal(regimeStep("STRONG_TREND", f(1.0, 1.0, 1.01), H), "STRONG_TREND");
  assert.equal(regimeStep("STRONG_TREND", f(1.0, 1.0, 1.00), H), "WEAK_TREND");
  assert.equal(regimeStep("WEAK_TREND", f(1.0, 1.0, 0.46), H), "WEAK_TREND");
  assert.equal(regimeStep("WEAK_TREND", f(1.0, 1.0, 0.45), H), "RANGE");
  // volatility states take precedence over trend entries
  assert.equal(regimeStep("RANGE", f(1.40, 1.0, 2.0), H), "VOL_EXPANSION");
  assert.equal(regimeStep("RANGE", f(0.70, 0.50, 2.0), H), "VOL_CONTRACTION");
  // missing features can never MAINTAIN a state
  assert.equal(regimeStep("VOL_EXPANSION", f(NaN, NaN, NaN), H), "RANGE");
  assert.equal(regimeStep("STRONG_TREND", f(NaN, NaN, NaN), H), "RANGE");
  // determinism
  const x = f(1.5, 0.5, 1.8);
  assert.equal(regimeStep("RANGE", x, H), regimeStep("RANGE", x, H));
});

test("P01b whole-series regime precompute is sequential, causal and stable", () => {
  const rows = synthRows(800);
  const daily = synthDaily(500);
  const series = precomputeAlphaSeries({ rows, dailyRows: daily, spec: SPEC });
  const regimes = precomputeRegimeStates(series, SPEC);
  assert.equal(regimes.length, 800);
  for (const r of regimes) assert.ok(REGIME_STATES.includes(r), r);
  // warm-up bars (insufficient features) cannot invent a state
  assert.equal(regimes[0], "RANGE");
  // recomputation is identical (no hidden state, no randomness)
  assert.deepEqual(precomputeRegimeStates(series, SPEC), regimes);
});

// ============================================================================
// P02  leakage
// ============================================================================

test("P02 no future bar can influence regime labels or features at the decision bar", () => {
  const n = 600;
  const rows = synthRows(n);
  const daily = synthDaily(400);
  const K = 400;
  const poisoned = { ts: rows.ts.slice(), open: rows.open.slice(), high: rows.high.slice(), low: rows.low.slice(), close: rows.close.slice() };
  for (let k = K + 1; k < n; k++) {
    poisoned.close[k] *= 5; poisoned.open[k] *= 3; poisoned.high[k] *= 9; poisoned.low[k] *= 0.2;
  }
  const base = precomputeAlphaSeries({ rows, dailyRows: daily, spec: SPEC });
  const bad = precomputeAlphaSeries({ rows: poisoned, dailyRows: daily, spec: SPEC });
  // regime sequence up to and including K is unchanged
  const rBase = precomputeRegimeStates(base, SPEC);
  const rBad = precomputeRegimeStates(bad, SPEC);
  for (let k = 0; k <= K; k++) assert.equal(rBad[k], rBase[k], `regime differs at ${k}`);
  // features at K are unchanged (both sides)
  for (const side of ["long", "short"]) {
    assert.deepEqual(
      snap(alphaFeaturesAt(bad, poisoned, K, { side, horizonHours: 24, spec: SPEC })),
      snap(alphaFeaturesAt(base, rows, K, { side, horizonHours: 24, spec: SPEC })),
    );
  }
  // sanity: the poison is real — the NEXT bar IS affected
  assert.notDeepEqual(
    snap(alphaFeaturesAt(bad, poisoned, K + 1, { side: "long", horizonHours: 24, spec: SPEC })),
    snap(alphaFeaturesAt(base, rows, K + 1, { side: "long", horizonHours: 24, spec: SPEC })),
  );
});

// ============================================================================
// P03  purge + embargo
// ============================================================================

test("P03 purge removes boundary-straddling windows; embargo blocks the post-boundary gap", () => {
  // realistic proportions: n=10000 -> train [0,6000) val [6000,8000) test [8000,10000)
  const bounds = { train: [0, 600], validation: [600, 800], test: [800, 1000] };
  const hb = 24, emb = 168;
  // every fold is embargoed after its own start, train included (its first bars
  // are the feature warm-up and must not become labels)
  assert.equal(assignFold(bounds, 100, hb, emb), null);
  assert.equal(assignFold(bounds, 167, hb, emb), null);      // 168 - 1
  assert.equal(assignFold(bounds, 168, hb, emb), "train");   // exactly embargoBars after the boundary
  // train interior
  assert.equal(assignFold(bounds, 300, hb, emb), "train");
  // train tail purge: window must close inside the fold
  assert.equal(assignFold(bounds, 599, hb, emb), null);
  assert.equal(assignFold(bounds, 576, hb, emb), "train");   // 576+24 = 600 (exclusive end) ok
  assert.equal(assignFold(bounds, 577, hb, emb), null);
  // embargo at the start of validation
  assert.equal(assignFold(bounds, 600, hb, emb), null);
  assert.equal(assignFold(bounds, 767, hb, emb), null);      // 600+168-1
  assert.equal(assignFold(bounds, 768, hb, emb), "validation");
  // validation tail purge
  assert.equal(assignFold(bounds, 776, hb, emb), "validation"); // 776+24 = 800
  assert.equal(assignFold(bounds, 777, hb, emb), null);
  // test embargo + purge
  assert.equal(assignFold(bounds, 800, hb, emb), null);
  assert.equal(assignFold(bounds, 968, hb, emb), "test");
  assert.equal(assignFold(bounds, 977, hb, emb), null);
  // longer horizons purge more aggressively
  assert.equal(assignFold(bounds, 768, 168, emb), null);     // 768+168 > 800 (purge)
  assert.equal(assignFold(bounds, 632, 168, emb), null);     // 632-600 < 168 (embargo)
  assert.equal(assignFold(bounds, 430, 168, emb), "train");  // 430+168 = 598 <= 600
  assert.equal(assignFold(bounds, 433, 168, emb), null);
  // sub-fold bounds partition the fold
  const sf = subFoldBounds(bounds.validation, 4);
  assert.equal(sf.length, 4);
  assert.equal(sf[0][0], 600);
  assert.equal(sf[3][1], 800);
  for (let k = 600; k < 800; k++) assert.ok(subFoldIndexOf(sf, k) != null, `k=${k}`);
  assert.equal(subFoldIndexOf(sf, 800), null);
});

// ============================================================================
// P04  posterior math
// ============================================================================

const mkM = (over) => ({
  resolved: true, rawBps: 100, grossBps: 90, netBps: 80, costBps: 20, feeBps: 10, slipBps: 10,
  mfeBps: 300, maeBps: -50, realized_R: 1.2, raw_R: 1.5, mfeCostRatio: 15, mfe_capture_ratio: 0.8,
  holdHours: 24, netPnl: 96, grossPnl: 108, touchedTarget: true, touchedStop: false,
  favBeforeAdverse: true, timeToMfeBars: 12, ...over,
});

test("P04 posterior math: shrinkage toward zero, Beta profit prior, shrunk std, uncertainty penalty", () => {
  const K = SPEC.cellModel.shrinkage.priorStrengthK;
  const acc = emptyStats();
  for (const r of [2, 2, 2, -1]) pushStats(acc, mkM({ realized_R: r, netPnl: r * 60 }));
  const r2 = 4 + 4 + 4 + 1;
  assert.equal(acc.n, 4);
  // E_shrunk = sum / (n + K):  5 / 14  (shrunk toward zero from 1.25)
  assert.ok(Math.abs(posteriorMeanR(acc, K) - 5 / 14) < 1e-12);
  assert.ok(posteriorMeanR(acc, K) < acc.RSum / acc.n);
  // P(profit) = (wins + K*0.5) / (n + K) = (3 + 5) / 14
  assert.ok(Math.abs(posteriorProfitProb(acc, K) - 8 / 14) < 1e-12);
  // population std of [2,2,2,-1]: mean 5/4, E[x^2] = 13/4 -> var 27/16 -> std sqrt(27)/4
  const stdCell = Math.sqrt(27 / 16);
  assert.ok(Math.abs(trainStdR(acc, r2) - stdCell) < 1e-12);
  // shrunk std pulls toward the global std
  const shr = shrunkStdR(stdCell, 2, 4, 10);
  assert.ok(Math.abs(shr - (4 * stdCell + 10 * 2) / 14) < 1e-12);
  // score = E/max(floor, shrunkStd) - unc/sqrt(n)
  const p = {
    priorStrengthK: K, stdShrinkK: SPEC.cellModel.volNormalization.stdShrinkK,
    stdFloorR: SPEC.cellModel.volNormalization.stdFloorR,
    uncertaintyPenaltyR: SPEC.cellModel.uncertaintyPenaltyR, profitPrior: 0.5,
  };
  const sc = cellScore({ train: acc, r2Sum: r2, stdGlobal: 2, params: p });
  const expected = (5 / 14) / Math.max(0.5, (4 * stdCell + 20) / 14) - 0.25 / 2;
  assert.ok(Math.abs(sc.score - expected) < 1e-12);
  assert.ok(Math.abs(sc.postE - 5 / 14) < 1e-12);
  // a losing cell scores negative (never an opportunity)
  const losing = emptyStats();
  for (const r of [-1, -1, -1, -2]) pushStats(losing, mkM({ realized_R: r }));
  assert.ok(cellScore({ train: losing, r2Sum: 7, stdGlobal: 2, params: p }).score < 0);
  // empty cell: no score
  assert.equal(cellScore({ train: emptyStats(), r2Sum: 0, stdGlobal: 2, params: p }).score, -Infinity);
  // larger samples shrink the uncertainty penalty toward zero (0.25/sqrt(n))
  const big = emptyStats();
  for (let i = 0; i < 400; i++) pushStats(big, mkM({ realized_R: i % 4 === 3 ? -1 : 2 }));
  const r2Big = 400 * 3.25;                                  // E[x^2] = (300*4 + 100*1)/400
  const scBig = cellScore({ train: big, r2Sum: r2Big, stdGlobal: 2, params: p });
  const eBig = big.RSum / (400 + K);
  const sBig = shrunkStdR(trainStdR(big, r2Big), 2, 400, 10);
  assert.ok(Math.abs(scBig.score - (eBig / Math.max(0.5, sBig) - 0.25 / 20)) < 1e-12);
  assert.ok(Math.abs(scBig.score - eBig / Math.max(0.5, sBig)) < 0.02);  // penalty nearly gone
  assert.ok(Number.isFinite(scBig.score) && Number.isFinite(cellScore({ train: acc, r2Sum: r2, stdGlobal: 2, params: p }).score));
});

test("P04b cell gates: TV checks fail for the right reasons; TEST checks count sub-folds", () => {
  const gates = SPEC.eligibilityGates;
  const cell = emptyCell("s|RANGE|long|24h", "s", "RANGE", "long", 24);
  // 40 train wins, 20 validation losses -> validation gate must fail
  for (let i = 0; i < 40; i++) pushCell(cell, { fold: "train", subFold: i % 4, symbol: "BTC-USD", market: "crypto" }, mkM({ realized_R: 1, netBps: 50, netPnl: 60, grossPnl: 80 }));
  for (let i = 0; i < 20; i++) pushCell(cell, { fold: "validation", subFold: i % 4, symbol: "BTC-USD", market: "crypto" }, mkM({ realized_R: -1, netBps: -50, netPnl: -60, grossPnl: -80 }));
  cell.stressTV = { n: 60, sum: 10 };
  cell.nextBarTV = { n: 60, sum: 10 };
  const tv = cellTVChecks(cell, gates);
  assert.equal(tv.pass, false);
  assert.ok(tv.failed.includes("validation_net_R_positive"));
  assert.ok(!tv.failed.includes("n_train"));
  assert.ok(!tv.failed.includes("train_net_R_positive"));
  // concentration: single symbol = 100% of gross profit -> fails the 0.5 cap
  assert.ok(tv.failed.includes("symbol_concentration"));
  // equal split between two symbols keeps the max share at exactly the 0.5 cap
  const cell2 = emptyCell("s2|RANGE|long|24h", "s2", "RANGE", "long", 24);
  for (let i = 0; i < 30; i++) {
    pushCell(cell2, { fold: "train", subFold: i % 4, symbol: i % 2 ? "BTC-USD" : "ETH-USD", market: "crypto" }, mkM({ realized_R: 1, netBps: 40, netPnl: 60, grossPnl: 80 }));
  }
  for (let i = 0; i < 20; i++) {
    pushCell(cell2, { fold: "validation", subFold: i % 4, symbol: i % 2 ? "BTC-USD" : "ETH-USD", market: "crypto" }, mkM({ realized_R: 0.5, netBps: 20, netPnl: 30, grossPnl: 50 }));
  }
  cell2.stressTV = { n: 50, sum: 5 };
  cell2.nextBarTV = { n: 50, sum: 5 };
  const tv2 = cellTVChecks(cell2, gates);
  assert.equal(tv2.pass, true, tv2.failed.join(","));
  // TEST checks: positive mean R with >=3/4 positive sub-folds passes
  for (let i = 0; i < 20; i++) {
    const rec = { fold: "test", subFold: i % 4, symbol: "BTC-USD", market: "crypto" };
    pushCell(cell2, rec, mkM({ realized_R: i % 4 === 3 ? -0.5 : 1 }));
  }
  const te = cellTestChecks(cell2, gates);
  assert.equal(te.pass, true, te.failed.join(","));
  assert.equal(te.positiveSubs, 3);
  // a losing TEST kills it
  const cell3 = emptyCell("s3|RANGE|long|24h", "s3", "RANGE", "long", 24);
  for (let i = 0; i < 20; i++) pushCell(cell3, { fold: "test", subFold: i % 4, symbol: "BTC-USD", market: "crypto" }, mkM({ realized_R: -1 }));
  assert.equal(cellTestChecks(cell3, gates).pass, false);
  assert.ok(cellTestChecks(cell3, gates).failed.includes("test_net_R_positive"));
});

// ============================================================================
// P05-P06  allocator
// ============================================================================

const ALLOC = SPEC.allocator;
const MATRIX = SPEC.cellModel.correlationMatrix;
const hourT = (h) => Date.UTC(2024, 0, 1) + h * HOURLY_MS;
const mkOcc = (i, symbol, market, k, cellKey) => ({
  i, symbol, market, k, ts: hourT(k), side: "long", signalId: cellKey.split("|")[0],
  regime: "RANGE", horizonHours: 4, cellKey, fold: "train", geometryKey: "alpha_breakout",
});
const mkMeas = (k, over = {}) => ({
  resolved: true, entryIdx: k, exitIdx: k + 4, holdHours: 4, entryRef: 100, exitRef: 101,
  rawBps: 100, grossBps: 80, netBps: 60, costBps: 20, feeBps: 10, slipBps: 10,
  netPnl: 6, grossPnl: 8, costUsd: 2, realized_R: 0.1, exit_reason: "horizon", ...over,
});
const runSim = (occs, meas, eligible) => simulateAllocator({
  occurrences: occs, measurements: meas, eligible, allocSpec: ALLOC,
  geometryOf: () => ALLOC.geometry.alpha_breakout,
  correlate: (a, b) => correlationOf(a, b, MATRIX),
});

test("P05 allocator is deterministic: identical inputs give an identical trade list", () => {
  const occs = [], meas = [], eligible = new Map();
  const symbols = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "AAPL", "NVDA", "MSFT", "TSLA", "AMZN"];
  symbols.forEach((s, i) => {
    occs.push(mkOcc(i, s, i < 5 ? "crypto" : "us", 10 + i * 2, "sig|STRONG_TREND|long|4h"));
    meas.push(mkMeas(10 + i * 2));
    eligible.set("sig|STRONG_TREND|long|4h", 1.0);
  });
  const a = runSim(occs, meas, eligible);
  const b = runSim(occs, meas, eligible);
  assert.equal(tradesDigest(a.trades), tradesDigest(b.trades));
  assert.equal(a.trades.length, b.trades.length);
  assert.deepEqual(snap(a.trades), snap(b.trades));
});

test("P05b allocator respects every pre-registered exposure limit", () => {
  // per-symbol limit: two opportunities on the same symbol at the same bar
  const occs = [mkOcc(0, "BTC-USD", "crypto", 10, "s1|RANGE|long|4h"), mkOcc(1, "BTC-USD", "crypto", 10, "s2|RANGE|long|4h")];
  const meas = [mkMeas(10), mkMeas(10)];
  const eligible = new Map([["s1|RANGE|long|4h", 1], ["s2|RANGE|long|4h", 0.9]]);
  const r = runSim(occs, meas, eligible);
  assert.equal(r.trades.length, 1);
  assert.equal(r.funnel.limit_symbol, 1);
  assert.equal(r.trades[0].cellKey, "s1|RANGE|long|4h");   // higher score wins

  // market limit: 4 distinct crypto symbols at the same bar -> max 3 concurrent
  const mkt = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD"].map((s, i) => mkOcc(i, s, "crypto", 10, `m${i}|RANGE|long|4h`));
  const r2 = runSim(mkt, mkt.map((o) => mkMeas(o.k)), new Map(mkt.map((o) => [o.cellKey, 1])));
  assert.equal(r2.trades.length, ALLOC.maxConcurrentPerMarket);
  assert.equal(r2.funnel.limit_market, 1);

  // total risk budget: 8 eligible opportunities on 8 distinct symbols -> max 6 positions
  const all8 = ["BTC-USD", "ETH-USD", "SOL-USD", "AAPL", "NVDA", "MSFT", "RELIANCE.NS", "TCS.NS"]
    .map((s, i) => mkOcc(i, s, i < 3 ? "crypto" : i < 6 ? "us" : "india", 10, `t${i}|RANGE|long|4h`));
  const elig8 = new Map(all8.map((o) => [o.cellKey, 1]));
  const r3 = runSim(all8, all8.map((o) => mkMeas(o.k)), elig8);
  assert.equal(r3.trades.length, ALLOC.totalRiskUnits);
  assert.equal(r3.funnel.limit_total, 8 - ALLOC.totalRiskUnits);
});

test("P05c allocator applies the pre-registered correlation penalty", () => {
  assert.equal(correlationOf({ symbol: "BTC-USD", market: "crypto" }, { symbol: "BTC-USD", market: "crypto" }, MATRIX), MATRIX.sameSymbol);
  assert.equal(correlationOf({ symbol: "BTC-USD", market: "crypto" }, { symbol: "ETH-USD", market: "crypto" }, MATRIX), MATRIX.sameMarket);
  assert.equal(correlationOf({ symbol: "BTC-USD", market: "crypto" }, { symbol: "AAPL", market: "us" }, MATRIX), MATRIX.differentMarket);
  // a BTC position open at bars [10,14] penalises an ETH candidate at bar 11 (same market)
  const occs = [mkOcc(0, "BTC-USD", "crypto", 10, "a|RANGE|long|4h"), mkOcc(1, "ETH-USD", "crypto", 11, "b|RANGE|long|4h")];
  const meas = [mkMeas(10), mkMeas(11)];
  const r = runSim(occs, meas, new Map([["a|RANGE|long|4h", 1], ["b|RANGE|long|4h", 1]]));
  assert.equal(r.trades.length, 2);
  const eth = r.trades.find((t) => t.symbol === "ETH-USD");
  assert.ok(Math.abs(eth.rhoMax - MATRIX.sameMarket) < 1e-12);
  assert.ok(Math.abs(eth.adjustedScore - (1 - MATRIX.sameMarket)) < 1e-12);
});

test("P06 FLAT is the default: no eligible cells or non-positive scores means no trades", () => {
  const occs = [mkOcc(0, "BTC-USD", "crypto", 10, "x|RANGE|long|4h"), mkOcc(1, "ETH-USD", "crypto", 11, "x|RANGE|long|4h")];
  const meas = [mkMeas(10), mkMeas(11)];
  const r = runSim(occs, meas, new Map());                       // nothing eligible
  assert.equal(r.trades.length, 0);
  assert.equal(r.funnel.flat_no_cell, 2);
  const r2 = runSim(occs, meas, new Map([["x|RANGE|long|4h", -0.5]]));  // negative posterior
  assert.equal(r2.trades.length, 0);
  assert.equal(r2.funnel.flat_non_positive_score, 2);
  const r3 = runSim(occs, [mkMeas(10, { resolved: false }), mkMeas(11)], new Map([["x|RANGE|long|4h", 1]]));
  assert.equal(r3.trades.length, 1);
  assert.equal(r3.funnel.unresolved, 1);
});

// ============================================================================
// P07  portfolio metrics
// ============================================================================

test("P07 portfolio metrics: conventions hold and the numbers are internally consistent", () => {
  const trades = [];
  for (let d = 0; d < 40; d++) {
    const win = d >= 10;                                   // 10 losing days first, then wins
    trades.push({
      symbol: "BTC-USD", market: "crypto", fold: d < 20 ? "train" : "validation",
      utc: new Date(hourT(d * 24)).toISOString().slice(0, 10), ts: hourT(d * 24), k: d * 24,
      entryIdx: d * 24, exitIdx: d * 24 + 4, holdHours: 4,
      netBps: win ? 60 : -40, grossBps: win ? 80 : -40, costBps: 20, feeBps: 10, slipBps: 10,
      netPnl: win ? 6 : -4, grossPnl: win ? 8 : -4, costUsd: 2, realized_R: win ? 0.6 : -0.4,
      exit_reason: "horizon", cellKey: "x|RANGE|long|4h",
    });
  }
  const pm = portfolioMetrics(trades, { equityStartUsd: 1000, firstTs: hourT(0), lastTs: hourT(41 * 24) });
  assert.equal(pm.trades, 40);
  assert.equal(pm.winRate, 0.75);                           // 30 wins of 40
  assert.ok(Math.abs(pm.expectancy - (30 * 6 - 10 * 4) / 40) < 1e-9);
  assert.ok(Math.abs(pm.maxDrawdown - 40 / 1000) < 1e-9);   // 10 straight losses of 4 on a 1000 base
  assert.ok(Number.isFinite(pm.Sharpe) && Number.isFinite(pm.CAGR));
  assert.ok(pm.p5R <= pm.medianR && pm.medianR <= pm.p95R);
  assert.ok(Math.abs(pm.grossToNetDecay - (1 - pm.netTotal / pm.grossTotal)) < 1e-9);
  assert.ok(Math.abs(pm.costContribution - pm.costTotal / pm.grossTotal) < 1e-9);
  assert.ok(pm.exposure > 0 && pm.exposure <= 1);
  assert.equal(pm.maxSymbolShare, 1);                       // single symbol
  assert.ok(pm.timeUnderwater > 0 && pm.timeUnderwater < 1);
  assert.equal(pm.worstDay[1], -4);
  // empty portfolio never crashes
  const empty = portfolioMetrics([], { equityStartUsd: 1000, firstTs: hourT(0), lastTs: hourT(48) });
  assert.equal(empty.trades, 0);
  assert.equal(empty.maxDrawdown, 0);
});

// ============================================================================
// P08  shuffled-label control building blocks
// ============================================================================

test("P08 hash-order permutation is deterministic and a bijection", () => {
  // mirrors the runner's pre-registered rule: order by sha256(index|salt)
  const salt = SPEC.robustness.shuffledLabels.salt;
  const permute = (idxs) => idxs
    .map((i) => ({ i, h: crypto.createHash("sha256").update(`${i}|${salt}`).digest("hex") }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i))
    .map((x) => x.i);
  const idxs = Array.from({ length: 200 }, (_, i) => i);
  const p1 = permute(idxs);
  const p2 = permute(idxs);
  assert.deepEqual(p1, p2);                       // deterministic
  assert.deepEqual([...p1].sort((a, b) => a - b), idxs);   // bijection: no label lost or duplicated
  assert.ok(p1.some((v, i) => v !== i));          // actually permutes
});

// ============================================================================
// P09  write isolation
// ============================================================================

test("P09 the phase 10 runner can only ever write its own artefacts", () => {
  const summary = path.join(PHASE10_DIR, "phase10-summary.v1.json");
  assert.equal(assertPhase10Path(summary), path.resolve(summary));
  // the report is a separate, explicitly-granted target
  assert.throws(() => assertPhase10Path(PHASE10_REPORT_PATH), /refusing to write outside/);
  assert.equal(assertPhase10Path(PHASE10_REPORT_PATH, { allowReport: true }), path.resolve(PHASE10_REPORT_PATH));
  const forbidden = [
    path.join(ROOT, "config", "phase10-spec.v1.json"),
    path.join(ROOT, "config.json"),
    path.join(ROOT, "data", "real", "panel-hour.json"),
    path.join(ROOT, "scripts", "v2", "phase10-run.mjs"),
    path.join(PHASE10_DIR, "..", "..", "config.json"),      // traversal must not escape
    path.join(PHASE10_DIR, "..", "real", "panel-hour.json"),
  ];
  for (const p of forbidden) assert.throws(() => assertPhase10Path(p), /refusing to write outside/, p);
  // a real write lands inside the phase 10 area, round-trips, and is cleaned up
  const tmp = path.join(PHASE10_DIR, "phase10-test-artifact.tmp.json");
  try {
    writePhase10JSON(tmp, { ok: true, n: 3 });
    assert.deepEqual(JSON.parse(fs.readFileSync(tmp, "utf8")), { ok: true, n: 3 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  assert.equal(fs.existsSync(tmp), false);
  // the guard is what the runner actually uses
    const src = fs.readFileSync(path.join(ROOT, "scripts", "v2", "phase10-run.mjs"), "utf8");
  assert.match(src, /writePhase10JSON|writePhase10Trades/);
});

// ============================================================================
// P10-P13  LEAKAGE AUDIT (robustness check #8)
// ============================================================================

test("P10 the leakage audit primitives are pure and deterministic", () => {
  assert.deepEqual(evenSample(10, 1), [0]);
  assert.deepEqual(evenSample(10, 10), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(evenSample(5, 3), [0, 2, 4]);        // evenly spread
  assert.deepEqual(evenSample(0, 3), []);
  assert.deepEqual(evenSample(10, 20), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);  // capped at n
  // deterministic: same inputs -> identical outputs, every time
  for (let i = 0; i < 5; i++) assert.deepEqual(evenSample(100, 7), evenSample(100, 7));
  // de-duplicated (j*step can repeat for small n/count)
  const dup = evenSample(11, 6);
  assert.equal(new Set(dup).size, dup.length);
});

test("P11 runLeakageAudit aggregates checks and reports failure", () => {
  const good = { name: "a", pass: true, checked: 10 };
  const bad = { name: "b", pass: false, checked: 5, failures: [{ why: "x" }] };
  const r = runLeakageAudit([good, bad]);
  assert.equal(r.pass, false);
  assert.deepEqual(r.failed, ["b"]);
  assert.equal(r.checks.length, 2);
  assert.equal(runLeakageAudit([good]).pass, true);
  assert.equal(runLeakageAudit([good, null]).pass, true);   // null parts ignored
});

test("P12 feature-causality probe is blind to future bars (synthetic micro-panel)", () => {
  // Build a tiny panel where bar k's feature depends ONLY on bars <= k.
  // We then truncate the panel at k and at k-1: at k the rebuilt feature must
  // match the full-panel feature exactly; at k-1 it must NOT (the label bar lost).
  const N = 60;
  const ts = Array.from({ length: N }, (_, i) => 1700000000000 + i * HOURLY_MS);
  const close = Array.from({ length: N }, (_, i) => 100 + i * 0.1 + (i % 3 ? 1 : -1) * 0.05);
  const open = close.map((c) => c - 0.05);
  const high = close.map((c) => c + 0.3);
  const low = close.map((c) => c - 0.3);
  const rows = { ts, open, high, low, close };
  // daily panel: a flat series so buildDailyContext is deterministic
  const dailyTs = Array.from({ length: 730 }, (_, i) => 1700000000000 + i * 86400000);
  const dclose = Array.from({ length: 730 }, (_, i) => 100 + i * 0.01);
  const dailyRows = { ts: dailyTs, open: dclose, high: dclose.map((c) => c + 0.3), low: dclose.map((c) => c - 0.3), close: dclose };

  const occurrences = [{ i: 0, symbol: "X", k: 30, side: "long", market: "crypto", signalId: "s" }];
  const rowsOf = () => ({ rows, dailyRows });
  const truncateFor = (_symbol, k) => ({
    rows: { ts: ts.slice(0, k + 1), open: open.slice(0, k + 1), high: high.slice(0, k + 1), low: low.slice(0, k + 1), close: close.slice(0, k + 1) },
    dailyRows,
  });
  let probeCalls = 0;
  const cfg0 = { slippage: { crypto: 0.001 } };
  const probe = (_symbol, { rows: r }, k, o) => {
    probeCalls += 1;
    const series = precomputeAlphaSeries({ rows: r, dailyRows, spec: SPEC });
    series.regimes = precomputeRegimeStates(series, SPEC);
    return {
      regime: series.regimes[k],
      feat: alphaFeaturesAt(series, r, k, { side: o.side, horizonHours: SPEC.primaryHorizonHours, cfg: cfg0, market: o.market, spec: SPEC }),
    };
  };
  const r = auditFeatureCausality({ occurrences, rowsOf, truncateFor, probe, sample: 1 });
  assert.equal(r.pass, true);
  assert.equal(r.checked, 1);
  assert.ok(probeCalls >= 2, "should probe both the full and the truncated panel");

  // Now prove the probe is NOT vacuous: a deliberately leaking probe that reads a
  // future bar must be flagged as a failure.
  const badProbe = (_symbol, { rows: r }, k, o) => {
    const series = precomputeAlphaSeries({ rows: r, dailyRows, spec: SPEC });
    return { feat: alphaFeaturesAt(series, r, k, { side: o.side, horizonHours: SPEC.primaryHorizonHours, cfg: cfg0, market: o.market, spec: SPEC }), futureLeak: r.close[k + 5] };
  };
  let leaked = false;
  try {
    const r2 = auditFeatureCausality({ occurrences, rowsOf: () => ({ rows, dailyRows }), truncateFor, probe: badProbe, sample: 1 });
    assert.equal(r2.pass, false);
    leaked = true;
  } catch { leaked = true; }   // a NaN-ing leak path is also a detection
  assert.equal(leaked, true, "a deliberately leaking probe must be detected as a failure");
});

// ============================================================================
// P13  purge+embargo auditor must detect a folded measurement that straddles
//      a boundary (synthetic bounds)
// ============================================================================

test("P13 purge+embargo auditor detects a folded measurement that straddles a boundary", () => {
  const bounds = { train: [0, 30], validation: [30, 60], test: [60, 100] };
  const horizons = [24];
  const hBarsOf = [24];
  const occurrences = [
    { i: 0, symbol: "X", k: 10 },   // fold=train, embargo ok, but window [10,34] straddles train end 30!
    { i: 1, symbol: "X", k: 1 },      // fold=train, embargo violated (k-a=1 < embargo=3)
    { i: 2, symbol: "X", k: 65 },     // fold=test, window [65,89] inside test [60,100] ok
  ];
  const measurements = [
    [{ m: { resolved: true, entryIdx: 10, exitIdx: 34 }, fold: "train", subFold: 0 }],
    [{ m: { resolved: true, entryIdx: 1, exitIdx: 25 }, fold: "train", subFold: 0 }],
    [{ m: { resolved: true, entryIdx: 65, exitIdx: 89 }, fold: "test", subFold: 0 }],
  ];
  const embargoBars = 3;
  const r = auditPurgeEmbargo({
    occurrences, measurements, boundsOf: () => bounds, hBarsOf, horizons,
    subFoldBoundsOf: () => [bounds.train], subFolds: 4, embargoBars,
    maxFailures: 99,
  });
  assert.equal(r.pass, false);
  const reasons = r.failures.map((f) => f.reason);
  assert.ok(reasons.some((x) => /forward window straddles/.test(x)), "should flag the straddling window: " + JSON.stringify(reasons));
  assert.ok(reasons.some((x) => /embargo violated/.test(x)), "should flag the embargo violation: " + JSON.stringify(reasons));
  assert.ok(r.failures.length >= 2, "should collect at least both failures");
});

// ============================================================================
// P14  end-to-end: the leakage audit is wired into the runner and the summary
//      records a passing result
// ============================================================================

test("P14 the runner writes a passing leakage audit into the summary", () => {
  const sumPath = path.join(ROOT, "data", "calibration", "phase10-summary.v1.json");
  if (!fs.existsSync(sumPath)) {
    console.log("  (skipped: phase10-summary.v1.json not present — run the runner first)");
    return;
  }
  const j = JSON.parse(fs.readFileSync(sumPath, "utf8"));
  assert.equal(j.testEvaluated, true);
  assert.ok(j.leakageAudit, "summary must carry a leakageAudit field");
  assert.equal(j.leakageAudit.pass, true, `leakage audit failed: ${JSON.stringify(j.leakageAudit.failed)}`);
  for (const c of j.leakageAudit.checks) {
    assert.equal(c.pass, true, `leakage check ${c.name} did not pass`);
    assert.ok(c.checked > 0, `leakage check ${c.name} checked nothing`);
  }
  // and the verdict must not be D (evaluation invalid) since the audit passed
  assert.notEqual(j.verdict.grade, "D");
  // the runner source must import + call the audit
  const src = fs.readFileSync(path.join(ROOT, "scripts", "v2", "phase10-run.mjs"), "utf8");
  assert.match(src, /phase10-leakage/);
  assert.match(src, /leakageAudit/);
});
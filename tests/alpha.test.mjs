// tests/alpha.test.mjs — ALPHA RESEARCH acceptance tests (22 tests).
//
// Covers the properties that make the alpha experiment trustworthy:
//   1-3   causality (bit-equality under truncation, no future leaks, daily context)
//   4-5   cost model (production primitives, raw/gross/net decomposition, stress)
//   6-7   horizon measurement (fixed horizon, censoring, delayed entry)
//   8-15  the eight pre-registered signals (firing, symmetry, silence)
//   16    false-breakout rejection rules
//   17    the decision layer (TAKE / ABSTAIN / REJECTED reasons)
//   18-19 statistics + TRAIN-only bucket edges
//   20-21 pre-registered gates and the A/B/C verdict
//   22    write isolation (the alpha phase can only write its own artefacts)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../scripts/v2/store.mjs";
import { slippageFraction } from "../scripts/v2/perp.mjs";
import {
  HOURLY_MS, utcDateOf, rollingSma, roundTripCostFraction, expectedMoveFraction,
  buildDailyContext, precomputeAlphaSeries, alphaFeaturesAt, qualityScore,
} from "../scripts/v2/alpha-features.mjs";
import {
  alphaSignalSides, evaluateRejectionRules, decideAlphaEntry,
  alphaSignalIds, signalFamilyOf,
} from "../scripts/v2/alpha.mjs";
import {
  horizonBars, tradeEconomics, measureHorizon, managedTradeAdapter,
} from "../scripts/v2/alpha-horizons.mjs";
import {
  emptyStats, pushStats, finishStats, dictPush, stressNetBps,
  quantileEdges, bucketOf, evaluateAlphaGates, computeVerdict,
  assertAlphaPath, writeAlphaJSON, ALPHA_DIR, ALPHA_REPORT_PATH,
} from "../scripts/v2/alpha-metrics.mjs";

const ROOT = process.cwd();
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "alpha-experiment-spec.v1.json"), "utf8"));
const CFG = loadConfig();
const MARKET = "crypto";
const PRIMARY = SPEC.primaryHorizonHours;

// ---- deterministic mock market data -----------------------------------------
function mockRows(n = 400, { startTs = Date.UTC(2024, 0, 1), barMs = HOURLY_MS, seed = 1 } = {}) {
  const ts = [], open = [], high = [], low = [], close = [];
  let price = 100, s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < n; i++) {
    const drift = 0.05 * Math.sin(i / 37);
    const chg = drift + (rnd() - 0.5) * 1.2;
    const o = price;
    const c = Math.max(1, price + chg);
    ts.push(startTs + i * barMs);
    open.push(o); close.push(c);
    high.push(Math.max(o, c) + 0.25 + rnd() * 0.2);
    low.push(Math.min(o, c) - 0.25 - rnd() * 0.2);
    price = c;
  }
  return { ts, open, high, low, close };
}
function mockDaily(days = 300, { startTs = Date.UTC(2023, 0, 1), seed = 7, step = 0.4 } = {}) {
  const ts = [], open = [], high = [], low = [], close = [];
  let price = 80, s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < days; i++) {
    const o = price;
    const c = Math.max(1, price + step + (rnd() - 0.5) * 1.0);
    ts.push(startTs + i * 86400000);
    open.push(o); close.push(c);
    high.push(Math.max(o, c) + 0.5); low.push(Math.min(o, c) - 0.5);
    price = c;
  }
  return { ts, open, high, low, close };
}
const SERIES = (rows, daily) => precomputeAlphaSeries({ rows, dailyRows: daily, spec: SPEC });
const FEAT_OPTS = (rows) => ({ cfg: CFG, market: MARKET, spec: SPEC, horizonHours: PRIMARY });

// A feature object with every field the signals and rules read, so each signal
// test only has to override the fields that matter to it.
function baseFeatures(over = {}) {
  return {
    k: 300, ts: 0, side: "long", close: 100, atrNorm: 0.01, atr14: 1,
    r4: 0.01, r24: 0.02, r72: 0.03, z24: 2, absZ: 2,
    bd4: true, bd24: true, bd48: true, bdAtr4: 1, bdAtr24: 1, bdAtr48: 1,
    anyBreakout: true, breakoutDistAtr: 0.8, distFromMidAtr: 0.5,
    bodyRatio: 0.7, volExpansion: 1.5, volRatio: 1.1,
    rangeCompression: 0.5, rangeShort: 3, rangeLong: 6,
    dailyTrendDir: 1, dailyTrendAgree: 1, above200: true,
    trendAlignment: 1, agreeCount: 3,
    trendRegime: "strong_trend", volRegime: "normal_vol", structureRegime: "expansion",
    regime: "expansion", regimeDirection: 1,
    costFrac: 0.002, expMoveFrac: 0.04, moveCostRatio: 20,
    comp: { trendAlignment: 1, breakoutQuality: 1, volExpansion: 1, mtfAgreement: 1, costCoverage: 1 },
    ...over,
  };
}
const mirror = (over = {}) => baseFeatures({
  r4: -0.01, r24: -0.02, r72: -0.03, z24: -2, absZ: 2, dailyTrendDir: -1, above200: false,
  regimeDirection: -1, distFromMidAtr: -0.5, ...over,
});

// JSON round-trip snapshot: makes NaN -> null so deep-equality is unambiguous
// (and still compares every finite float bit-for-bit).
const snap = (o) => JSON.parse(JSON.stringify(o));

// ============================================================================
// 1-3  CAUSALITY
// ============================================================================

test("A01 features are bit-identical when the panel is truncated at the decision bar", () => {
  const rows = mockRows(400);
  const daily = mockDaily(300);
  const full = SERIES(rows, daily);
  const K = 320;
  const cut = (a) => a.slice(0, K + 1);
  const trunc = { ts: cut(rows.ts), open: cut(rows.open), high: cut(rows.high), low: cut(rows.low), close: cut(rows.close) };
  const truncSeries = SERIES(trunc, daily);
  for (const side of ["long", "short"]) {
    const a = alphaFeaturesAt(full, rows, K, { side, ...FEAT_OPTS(rows) });
    const b = alphaFeaturesAt(truncSeries, trunc, K, { side, ...FEAT_OPTS(rows) });
    assert.deepEqual(snap(b), snap(a), `truncated features differ on the ${side} side`);
  }
  // the rolling primitives themselves are causal (prior-window only)
  for (const w of SPEC.featureThresholds.breakoutLookbacks) {
    for (let k = w; k <= K; k += 7) {
      assert.equal(full.priorMax[w][k], truncSeries.priorMax[w][k], `priorMax[${w}][${k}]`);
      assert.equal(full.priorMin[w][k], truncSeries.priorMin[w][k], `priorMin[${w}][${k}]`);
    }
  }
});

test("A02 no future bar can influence the decision bar's features", () => {
  const rows = mockRows(400);
  const daily = mockDaily(300);
  const K = 300;
  const poisoned = {
    ts: rows.ts.slice(), open: rows.open.slice(), high: rows.high.slice(),
    low: rows.low.slice(), close: rows.close.slice(),
  };
  for (let k = K + 1; k < poisoned.close.length; k++) {
    poisoned.close[k] *= 5; poisoned.open[k] *= 3; poisoned.high[k] *= 9; poisoned.low[k] *= 0.2;
  }
  const base = SERIES(rows, daily);
  const bad = SERIES(poisoned, daily);
  for (const side of ["long", "short"]) {
    assert.deepEqual(
      snap(alphaFeaturesAt(bad, poisoned, K, { side, ...FEAT_OPTS(rows) })),
      snap(alphaFeaturesAt(base, rows, K, { side, ...FEAT_OPTS(rows) })),
    );
  }
  // sanity: the poison is real — it DOES change the very next bar, so this is not a vacuous test
  assert.notDeepEqual(
    snap(alphaFeaturesAt(bad, poisoned, K + 1, { side: "long", ...FEAT_OPTS(rows) })),
    snap(alphaFeaturesAt(base, rows, K + 1, { side: "long", ...FEAT_OPTS(rows) })),
  );
});

test("A03 daily context uses only completed, strictly-prior daily bars", () => {
  const daily = mockDaily(300, { startTs: Date.UTC(2023, 0, 1) });
  const hourTs = [
    Date.UTC(2023, 5, 14, 0), Date.UTC(2023, 5, 14, 5),
    Date.UTC(2023, 5, 15, 0), Date.UTC(2023, 8, 1, 0),
  ];
  const ctx = buildDailyContext(daily, hourTs, SPEC);
  const idxOf = (ts) => daily.ts.indexOf(ts);
  const fast = rollingSma(daily.close, SPEC.featureThresholds.dailySmaFastN);
  const slow = rollingSma(daily.close, SPEC.featureThresholds.dailySmaSlowN);
  const d13 = idxOf(Date.UTC(2023, 5, 13));
  const d14 = idxOf(Date.UTC(2023, 5, 14));
  const d31 = idxOf(Date.UTC(2023, 7, 31));
  assert.ok(d13 > 0 && d14 > 0 && d31 > 0);
  assert.equal(ctx.map[0], d13);     // 2023-06-14 00:00 -> last completed daily bar = 06-13
  assert.equal(ctx.map[1], d13);     // later the same UTC day -> identical context
  assert.equal(ctx.map[2], d14);     // 06-15 -> 06-14
  assert.equal(ctx.map[3], d31);     // 09-01 -> 08-31
  for (const k of [0, 1, 2, 3]) {
    const i = ctx.map[k];
    assert.equal(ctx.above50[k], 1);
    assert.equal(ctx.dir[k], daily.close[i] > fast[i] ? 1 : -1);
    assert.equal(ctx.above200[k], Number.isFinite(slow[i]) && daily.close[i] > slow[i] ? 1 : 0);
  }
  // The CURRENT (incomplete) daily bar is never used, even when it already exists.
  const extra = {
    ts: [...daily.ts, Date.UTC(2023, 5, 15)],
    open: [...daily.open, 1e6], high: [...daily.high, 2e6], low: [...daily.low, 1], close: [...daily.close, 1e6],
  };
  const ctx2 = buildDailyContext(extra, hourTs, SPEC);
  for (const k of [0, 1, 2]) {
    assert.equal(ctx2.map[k], ctx.map[k], `map[${k}] must not see the current daily bar`);
    assert.equal(ctx2.dir[k], ctx.dir[k]);
    assert.equal(ctx2.above200[k], ctx.above200[k]);
  }
  assert.equal(utcDateOf(hourTs[0]), "2023-06-14");
});

// ============================================================================
// 4-5  COST MODEL
// ============================================================================

test("A04 cost model reuses the production primitives and decomposes raw / gross / net", () => {
  const marginUsd = SPEC.costModel.marginUsd, leverage = SPEC.strategyGeometry.alpha_breakout.baseLev;
  const notional = marginUsd * leverage;
  const slip = slippageFraction(notional, CFG.slippage.crypto);
  const half = CFG.slippage.crypto / 2;
  const expected = SPEC.costModel.takerFee * 2 + 2 * (half + slip);
  const got = roundTripCostFraction({ cfg: CFG, market: MARKET, marginUsd, leverage, spec: SPEC });
  assert.ok(Math.abs(got - expected) < 1e-15, `roundTripCostFraction ${got} != ${expected}`);
  // a harsher cost multiplier scales the whole round trip linearly
  const stress = roundTripCostFraction({ cfg: CFG, market: MARKET, marginUsd, leverage, spec: SPEC, costMultiplier: SPEC.costStress.multiplier });
  assert.ok(Math.abs(stress - expected * SPEC.costStress.multiplier) < 1e-15);

  const eco = tradeEconomics({ entryRef: 100, exitRef: 104, side: "long", marginUsd, leverage, cfg: CFG, market: MARKET, spec: SPEC });
  assert.ok(Math.abs(eco.rawBps - 400) < 1e-9);
  // execution drag only ever removes from the raw move, then fees are subtracted
  assert.ok(eco.rawBps > eco.grossBps, "gross must be <= raw");
  assert.ok(eco.grossBps > eco.netBps, "net must be <= gross");
  assert.ok(eco.netBps > 0);
  assert.ok(Math.abs(eco.costBps - (eco.feeBps + eco.slipBps)) < 1e-9);
  assert.ok(Math.abs(eco.netBps - (eco.rawBps - eco.costBps)) < 1e-9);

  const short = tradeEconomics({ entryRef: 100, exitRef: 104, side: "short", marginUsd, leverage, cfg: CFG, market: MARKET, spec: SPEC });
  assert.ok(Math.abs(short.rawBps + 400) < 1e-9);
  assert.ok(short.rawBps > short.grossBps && short.grossBps > short.netBps);

  // cost is monotone in size: a bigger position pays more impact per unit notional
  const big = roundTripCostFraction({ cfg: CFG, market: MARKET, marginUsd: marginUsd * 100, leverage, spec: SPEC });
  assert.ok(big > got);
});

test("A05 cost stress re-prices fees + slippage without re-simulating", () => {
  const m = { resolved: true, rawBps: 50, feeBps: 6, slipBps: 4, netBps: 40 };
  assert.equal(stressNetBps(m, 1), 40);
  assert.equal(stressNetBps(m, 1.25), 50 - 10 * 1.25);
  assert.equal(stressNetBps({ resolved: false, rawBps: 50 }, 1.25), null);
  assert.equal(stressNetBps(null, 1.25), null);

  const eco = tradeEconomics({ entryRef: 100, exitRef: 104, side: "long", marginUsd: 100, leverage: 12, cfg: CFG, market: MARKET, spec: SPEC });
  const measured = { resolved: true, rawBps: eco.rawBps, feeBps: eco.feeBps, slipBps: eco.slipBps };
  assert.ok(Math.abs(stressNetBps(measured, 1) - eco.netBps) < 1e-9);
  assert.ok(stressNetBps(measured, 1.25) < eco.netBps);
  assert.ok(Math.abs(stressNetBps(measured, 1.25) - (eco.netBps - eco.costBps * 0.25)) < 1e-9);
});

// ============================================================================
// 6-7  HORIZON MEASUREMENT
// ============================================================================

// Deterministic, strictly monotone up-move: every excursion becomes exact.
function monotoneRows(n = 80) {
  const rows = { ts: [], open: [], high: [], low: [], close: [] };
  for (let i = 0; i < n; i++) {
    rows.ts.push(Date.UTC(2024, 0, 1) + i * HOURLY_MS);
    rows.open.push(100 + i);
    rows.high.push(101 + i);
    rows.low.push(99 + i);
    rows.close.push(100.5 + i);
  }
  return rows;
}

test("A06 fixed-horizon measurement exits exactly h bars later and reports excursions", () => {
  const rows = monotoneRows(80);
  const i = 10, horizonHours = 24;
  const geo = SPEC.strategyGeometry.alpha_breakout;
  const m = measureHorizon({
    rows, i, side: "long", horizonHours, cfg: CFG, market: MARKET, marginUsd: 100, leverage: geo.baseLev,
    stopPct: geo.stopPct, targetPct: geo.targetPct, spec: SPEC,
  });
  assert.equal(m.resolved, true);
  assert.equal(m.censored, false);
  assert.equal(m.exit_reason, "horizon");
  assert.equal(m.hBars, horizonBars(horizonHours));
  assert.equal(m.hBars, 24);
  assert.equal(m.entryIdx, i);
  assert.equal(m.entryRef, rows.close[i]);
  assert.equal(m.exitIdx, i + 24);
  assert.equal(m.exitRef, rows.close[i + 24]);
  assert.equal(m.holdHours, 24);
  assert.ok(Math.abs(m.rawBps - (rows.close[i + 24] / rows.close[i] - 1) * 1e4) < 1e-9);
  assert.ok(m.rawBps > m.grossBps && m.grossBps > m.netBps);
  assert.ok(Math.abs(m.netBps - (m.rawBps - m.costBps)) < 1e-9);
  // excursions: the up-move keeps making new highs, so the last bar is the MFE and
  // the first post-entry bar is the MAE. The ENTRY BAR ITSELF is never counted.
  assert.equal(m.mfeBps, ((rows.high[i + 24] - rows.close[i]) / rows.close[i]) * 1e4);
  assert.equal(m.maeBps, ((rows.low[i + 1] - rows.close[i]) / rows.close[i]) * 1e4);
  assert.equal(m.timeToMfeBars, 24);
  assert.equal(m.touchedTarget, true);
  assert.equal(m.touchedStop, false);
  assert.equal(m.favBeforeAdverse, true);
  assert.ok(m.mfe_R > 0 && m.mae_R < 0);
  assert.ok(m.mfeCostRatio > 0);

  // exact raw mirror for the short side
  const s = measureHorizon({ rows, i, side: "short", horizonHours, cfg: CFG, market: MARKET, marginUsd: 100, leverage: geo.baseLev, stopPct: geo.stopPct, targetPct: geo.targetPct, spec: SPEC });
  assert.ok(Math.abs(s.rawBps + m.rawBps) < 1e-9);
  assert.equal(s.touchedStop, true);
  assert.equal(s.touchedTarget, false);
  assert.equal(s.favBeforeAdverse, false);
});

test("A07 censoring, delayed entry and bad entries are explicit, never silently truncated", () => {
  const rows = mockRows(120);
  const i = rows.ts.length - 20;
  const m = measureHorizon({ rows, i, side: "long", horizonHours: 48, cfg: CFG, market: MARKET, marginUsd: 100, leverage: 12, spec: SPEC });
  assert.equal(m.resolved, true);
  assert.equal(m.censored, true);
  assert.equal(m.exitIdx, rows.ts.length - 1);
  assert.equal(m.exit_reason, "horizon-censored-end-of-panel");
  assert.equal(m.hBars, 48);
  assert.ok(m.exitIdx - m.entryIdx < m.hBars);
  assert.ok(Number.isFinite(m.netBps));   // censored trades are still measured, just flagged

  // delayed entry: the bar AFTER the decision bar, at its open
  const mono = monotoneRows(80);
  const d = measureHorizon({ rows: mono, i: 10, side: "long", horizonHours: 24, cfg: CFG, market: MARKET, marginUsd: 100, leverage: 12, spec: SPEC, entryMode: "nextOpen" });
  assert.equal(d.entryMode, "nextOpen");
  assert.equal(d.entryIdx, 11);
  assert.equal(d.entryRef, mono.open[11]);
  assert.notEqual(d.entryRef, mono.close[10]);
  assert.equal(d.exitIdx, 11 + 24);
  assert.equal(d.censored, false);

  const last = measureHorizon({ rows, i: rows.ts.length - 1, side: "long", horizonHours: 24, cfg: CFG, market: MARKET, marginUsd: 100, leverage: 12, spec: SPEC, entryMode: "nextOpen" });
  assert.equal(last.resolved, false);
  assert.equal(last.exit_reason, "no-entry-bar");

  const bad = mockRows(40);
  bad.close[20] = 0;
  const b = measureHorizon({ rows: bad, i: 20, side: "long", horizonHours: 4, cfg: CFG, market: MARKET, marginUsd: 100, leverage: 12, spec: SPEC });
  assert.equal(b.resolved, false);
  assert.equal(b.exit_reason, "bad-entry");

  // horizonBars rounds to whole bars and never returns less than one
  assert.equal(horizonBars(48), 48);
  assert.equal(horizonBars(0.5), 1);
  assert.equal(horizonBars(4, 900000), 16);
});

// ============================================================================
// 8-15  THE EIGHT PRE-REGISTERED SIGNALS
// ============================================================================
// Every signal is tested three ways: it fires on the bullish configuration, it
// fires on the exact bearish mirror (symmetry), and it stays silent when any one
// of its pre-registered conditions is violated (no accidental breadth).

test("A08 signal breakout48_trend (family A) — breakout + 24h trend, long/short symmetric", () => {
  assert.deepEqual(alphaSignalSides("breakout48_trend", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("breakout48_trend", mirror(), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("breakout48_trend", baseFeatures({ bd48: false }), SPEC), []);
  assert.deepEqual(alphaSignalSides("breakout48_trend", baseFeatures({ r24: -0.01 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("breakout48_trend", baseFeatures({ dailyTrendDir: 0 }), SPEC), []);
  // every pre-registered id is implemented and mapped to a family
  const ids = alphaSignalIds(SPEC);
  assert.equal(ids.length, 8);
  for (const id of ids) {
    assert.notEqual(signalFamilyOf(id, SPEC), null, `${id} has no family`);
    assert.ok(Array.isArray(alphaSignalSides(id, baseFeatures(), SPEC)));
  }
  assert.equal(signalFamilyOf("no_such_signal", SPEC), null);
  assert.throws(() => alphaSignalSides("no_such_signal", baseFeatures(), SPEC), /unknown signal id/);
});

test("A09 signal persistence3 (family B) — three aligned horizons above the z floor", () => {
  assert.deepEqual(alphaSignalSides("persistence3", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("persistence3", mirror(), SPEC), ["short"]);
  // |z24| below the pre-registered floor
  assert.deepEqual(alphaSignalSides("persistence3", baseFeatures({ z24: 0.5 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("persistence3", baseFeatures({ z24: NaN }), SPEC), []);
  // a single disagreeing horizon destroys persistence (r4, r24 and r72 must all agree)
  assert.deepEqual(alphaSignalSides("persistence3", baseFeatures({ r4: -0.01 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("persistence3", baseFeatures({ r72: -0.03 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("persistence3", mirror({ r4: 0.01 }), SPEC), []);
});

test("A10 signal momentum24 (family C) — 24h/72h agreement, r4 is deliberately irrelevant", () => {
  assert.deepEqual(alphaSignalSides("momentum24", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("momentum24", mirror(), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("momentum24", baseFeatures({ z24: 1.0 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("momentum24", baseFeatures({ r72: -0.03 }), SPEC), []);
  // the only thing that separates momentum24 from persistence3 is the r4 requirement
  assert.deepEqual(alphaSignalSides("momentum24", baseFeatures({ r4: -0.01 }), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("persistence3", baseFeatures({ r4: -0.01 }), SPEC), []);
});

test("A11 signal volexp_breakout (family D) — breakout only when volatility expands", () => {
  assert.deepEqual(alphaSignalSides("volexp_breakout", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("volexp_breakout", mirror(), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("volexp_breakout", baseFeatures({ volExpansion: 1.1 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("volexp_breakout", baseFeatures({ bd48: false }), SPEC), []);
  assert.deepEqual(alphaSignalSides("volexp_breakout", baseFeatures({ dailyTrendDir: -1 }), SPEC), []);
  // degenerate zero/zero satisfies both relaxed gates: a documented tie, resolved by side order
  assert.deepEqual(alphaSignalSides("volexp_breakout", baseFeatures({ r24: 0, dailyTrendDir: 0 }), SPEC), ["long", "short"]);
});

test("A12 signal compression_breakout (family E) — range compression then a breakout either way", () => {
  // family E is direction-agnostic by construction: the breakout may be up or down,
  // so it reports BOTH sides and lets the decision layer pick by side order.
  assert.deepEqual(alphaSignalSides("compression_breakout", baseFeatures(), SPEC), ["long", "short"]);
  assert.deepEqual(alphaSignalSides("compression_breakout", mirror(), SPEC), ["long", "short"]);
  assert.deepEqual(alphaSignalSides("compression_breakout", baseFeatures({ rangeCompression: 0.7 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("compression_breakout", baseFeatures({ rangeCompression: NaN }), SPEC), []);
  assert.deepEqual(alphaSignalSides("compression_breakout", baseFeatures({ bodyRatio: 0.4 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("compression_breakout", baseFeatures({ bd48: false }), SPEC), []);
});

test("A13 signal mtf_4h_24h (family F) — 4h breakout confirmed by the 24h displacement", () => {
  assert.deepEqual(alphaSignalSides("mtf_4h_24h", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("mtf_4h_24h", mirror(), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("mtf_4h_24h", baseFeatures({ bd4: false }), SPEC), []);
  assert.deepEqual(alphaSignalSides("mtf_4h_24h", baseFeatures({ z24: 0.1 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("mtf_4h_24h", baseFeatures({ dailyTrendDir: 0 }), SPEC), []);
  // the 48h channel is not required here — only the 4h one
  assert.deepEqual(alphaSignalSides("mtf_4h_24h", baseFeatures({ bd48: false }), SPEC), ["long"]);
});

test("A14 signal mtf_breakout_daily (family F) — 24h breakout with 72h trend above the 200d SMA", () => {
  assert.deepEqual(alphaSignalSides("mtf_breakout_daily", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("mtf_breakout_daily", mirror(), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("mtf_breakout_daily", baseFeatures({ bd24: false }), SPEC), []);
  assert.deepEqual(alphaSignalSides("mtf_breakout_daily", baseFeatures({ r72: -0.03 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("mtf_breakout_daily", baseFeatures({ above200: false }), SPEC), []);
  // short side needs both a down 72h trend AND a daily close below the 200d SMA
  assert.deepEqual(alphaSignalSides("mtf_breakout_daily", mirror({ above200: true }), SPEC), []);
});

test("A15 signal regime_gated_breakout (family G) — breakout only in the strong-trend regime", () => {
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures(), SPEC), ["long"]);
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", mirror(), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures({ trendRegime: "weak_trend" }), SPEC), []);
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures({ trendRegime: "range" }), SPEC), []);
  // the regime direction only chooses the SIDE — it does not silence the signal
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures({ regimeDirection: -1 }), SPEC), ["short"]);
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures({ regimeDirection: 0 }), SPEC), []);
  // a weak/range regime blocks BOTH sides, whatever the direction says
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures({ trendRegime: "weak_trend", regimeDirection: -1 }), SPEC), []);
  assert.deepEqual(alphaSignalSides("regime_gated_breakout", baseFeatures({ bd48: false }), SPEC), []);
});

// ============================================================================
// 16-17  REJECTION RULES AND THE DECISION LAYER
// ============================================================================

test("A16 false-breakout rejection rules fire independently and in a fixed order", () => {
  const clean = evaluateRejectionRules(baseFeatures(), SPEC);
  assert.equal(clean.pass, true);
  assert.deepEqual(clean.rejects, []);

  const one = (over) => evaluateRejectionRules(baseFeatures(over), SPEC);
  assert.deepEqual(one({ volExpansion: 0.5 }).rejects, ["REJ_NO_VOL_EXPANSION"]);
  assert.deepEqual(one({ bodyRatio: 0.1 }).rejects, ["REJ_WEAK_BODY"]);
  assert.deepEqual(one({ dailyTrendAgree: 0 }).rejects, ["REJ_COUNTER_DAILY_TREND"]);
  assert.deepEqual(one({ breakoutDistAtr: 0.1 }).rejects, ["REJ_MARGINAL_BREAKOUT"]);
  assert.deepEqual(one({ distFromMidAtr: 3 }).rejects, ["REJ_OVEREXTENDED"]);
  assert.deepEqual(one({ distFromMidAtr: -3 }).rejects, ["REJ_OVEREXTENDED"]);   // absolute distance
  assert.deepEqual(
    one({ volExpansion: 0.5, bodyRatio: 0.1, dailyTrendAgree: 0, breakoutDistAtr: 0.1, distFromMidAtr: 5 }).rejects,
    ["REJ_NO_VOL_EXPANSION", "REJ_WEAK_BODY", "REJ_COUNTER_DAILY_TREND", "REJ_MARGINAL_BREAKOUT", "REJ_OVEREXTENDED"],
  );
  // the pre-registered edges are strict inequalities: exactly at the edge is a pass
  assert.deepEqual(one({ volExpansion: 1.0 }).rejects, []);
  assert.deepEqual(one({ bodyRatio: 0.3 }).rejects, []);
  assert.deepEqual(one({ breakoutDistAtr: 0.25 }).rejects, []);
  assert.deepEqual(one({ distFromMidAtr: 2.0 }).rejects, []);
  // an UNKNOWN daily trend is not a counter-trend rejection
  assert.deepEqual(one({ dailyTrendDir: 0, dailyTrendAgree: 0 }).rejects, []);
  // the marginal-breakout rule only applies when there is a 48h breakout at all
  assert.deepEqual(one({ bd48: false, breakoutDistAtr: 0.1 }).rejects, []);
  // non-finite features never invent a rejection
  assert.deepEqual(one({ volExpansion: NaN, bodyRatio: NaN, breakoutDistAtr: NaN, distFromMidAtr: NaN }).rejects, []);
});

test("A17 decision layer maps signal + rejections + quality to TAKE / ABSTAIN / REJECTED", () => {
  const all = { trendAlignment: 1, breakoutQuality: 1, volExpansion: 1, mtfAgreement: 1, costCoverage: 1 };
  const take = decideAlphaEntry({ id: "breakout48_trend", f: baseFeatures(), spec: SPEC });
  assert.equal(take.take, true);
  assert.equal(take.side, "long");
  assert.equal(take.reason, "TAKE");
  assert.deepEqual(take.rejects, []);
  assert.equal(take.score, qualityScore(baseFeatures(), SPEC));
  assert.ok(Math.abs(take.score - 1) < 1e-12);

  const noSignal = decideAlphaEntry({ id: "breakout48_trend", f: baseFeatures({ bd48: false }), spec: SPEC });
  assert.equal(noSignal.take, false);
  assert.equal(noSignal.reason, "NO_SIGNAL");
  assert.equal(noSignal.side, null);

  const cheap = decideAlphaEntry({ id: "breakout48_trend", f: baseFeatures({ comp: { ...all, costCoverage: 0.1 } }), spec: SPEC });
  assert.equal(cheap.take, false);
  assert.equal(cheap.reason, "ABSTAIN_COST");

  const weak = decideAlphaEntry({
    id: "breakout48_trend",
    f: baseFeatures({ comp: { trendAlignment: 0.1, breakoutQuality: 0, volExpansion: 1, mtfAgreement: 1, costCoverage: 1 } }),
    spec: SPEC,
  });
  assert.equal(weak.take, false);
  assert.equal(weak.reason, "ABSTAIN_QUALITY");
  assert.ok(weak.score < SPEC.qualityScore.takeThreshold);

  const rejected = decideAlphaEntry({ id: "breakout48_trend", f: baseFeatures({ volExpansion: 0.5 }), spec: SPEC });
  assert.equal(rejected.take, false);
  assert.equal(rejected.reason, "REJECTED:REJ_NO_VOL_EXPANSION");
  assert.deepEqual(rejected.rejects, ["REJ_NO_VOL_EXPANSION"]);

  // rejection outranks both cost and quality when everything is wrong at once
  const worst = decideAlphaEntry({ id: "breakout48_trend", f: baseFeatures({ volExpansion: 0.5, comp: { ...all, costCoverage: 0 } }), spec: SPEC });
  assert.match(worst.reason, /^REJECTED:/);

  // shorts take as readily as longs, with the mirrored side reported
  const shortTake = decideAlphaEntry({ id: "breakout48_trend", f: mirror(), spec: SPEC });
  assert.equal(shortTake.take, true);
  assert.equal(shortTake.side, "short");
});

// ============================================================================
// 18-19  STATISTICS AND TRAIN-ONLY BUCKET EDGES
// ============================================================================

test("A18 the statistics accumulator is exact, chainable and groupable", () => {
  const mkM = (over) => ({
    resolved: true, rawBps: 100, grossBps: 90, netBps: 80, costBps: 20, feeBps: 10, slipBps: 10,
    mfeBps: 300, maeBps: -50, realized_R: 1.2, raw_R: 1.5, mfeCostRatio: 15, mfe_capture_ratio: 0.8,
    holdHours: 48, netPnl: 96, grossPnl: 108, touchedTarget: true, touchedStop: false,
    favBeforeAdverse: true, timeToMfeBars: 12, ...over,
  });
  const st = emptyStats({ list: true });
  assert.equal(st.n, 0);
  assert.equal(pushStats(st, mkM({ netBps: 120, netPnl: 120 })), st);   // returns the same accumulator
  pushStats(st, mkM({ netBps: -40, netPnl: -40, grossPnl: -20, touchedTarget: false, touchedStop: true, favBeforeAdverse: false }));
  pushStats(st, { resolved: false });                                   // censored
  pushStats(st, null);                                                  // missing measurement
  assert.equal(st.n, 2);
  assert.equal(st.censored, 2);

  const s = finishStats(st);
  assert.equal(s.resolved, 2);
  assert.equal(s.rawBps, 100);
  assert.equal(s.netBps, 40);
  assert.equal(s.costBps, 20);
  assert.equal(s.winRate, 0.5);
  assert.equal(s.lossRate, 0.5);
  assert.equal(s.profitFactor, 3);
  assert.equal(s.avgWin, 120);
  assert.equal(s.avgLoss, 40);
  assert.equal(s.payoffRatio, 3);
  assert.equal(s.targetHitRate, 0.5);
  assert.equal(s.stopHitRate, 0.5);
  assert.equal(s.favFirstRate, 0.5);
  assert.equal(s.avgHoldHours, 48);
  // percentile convention: idx = round(q * (n - 1)) over the sorted net series
  assert.equal(s.medianNetBps, 120);
  assert.equal(s.p10NetBps, -40);
  assert.equal(s.p90NetBps, 120);

  const empty = finishStats(emptyStats());
  assert.equal(empty.resolved, 0);
  assert.equal(empty.rawBps, null);
  assert.equal(empty.winRate, null);
  assert.equal(empty.profitFactor, null);
  assert.equal(empty.medianNetBps, null);

  const dict = {};
  dictPush(dict, "A", mkM({ netBps: 10, netPnl: 10 }));
  dictPush(dict, "A", mkM({ netBps: 20, netPnl: 20 }));
  dictPush(dict, "B", mkM({ netBps: -5, netPnl: -5 }));
  assert.deepEqual(Object.keys(dict).sort(), ["A", "B"]);
  assert.equal(dict.A.n, 2);
  assert.equal(dict.B.n, 1);
  assert.equal(finishStats(dict.A).netBps, 15);
  assert.equal(finishStats(dict.B).winRate, 0);
});

test("A19 bucket edges are TRAIN-only quintiles and bucketing is a deterministic partition", () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  const edges = quantileEdges(values, 5);
  assert.equal(edges.length, 4);
  assert.deepEqual(edges, [21, 41, 60, 80]);
  assert.equal(bucketOf(1, edges), 0);
  assert.equal(bucketOf(20.999, edges), 0);
  assert.equal(bucketOf(21, edges), 1);
  assert.equal(bucketOf(40, edges), 1);
  assert.equal(bucketOf(41, edges), 2);
  assert.equal(bucketOf(60, edges), 3);
  assert.equal(bucketOf(80, edges), 4);
  // values outside the TRAIN range are NOT rescaled — they simply land in an end bucket
  assert.equal(bucketOf(1e9, edges), 4);
  assert.equal(bucketOf(-1e9, edges), 0);
  assert.equal(bucketOf(NaN, edges), null);
  assert.equal(bucketOf(Infinity, edges), null);
  const counts = new Array(5).fill(0);
  for (const v of values) counts[bucketOf(v, edges)] += 1;
  assert.deepEqual(counts, [20, 20, 19, 20, 21]);
  assert.equal(counts.reduce((a, b) => a + b, 0), values.length);
  // non-finite inputs are filtered out before edges are computed
  assert.deepEqual(quantileEdges([NaN, Infinity, -Infinity], 5), []);
  assert.deepEqual(quantileEdges([], 5), []);
  assert.deepEqual(quantileEdges([5], 5), [5, 5, 5, 5]);
  // every pre-registered breakout-quality axis is a real numeric feature
  const rows = mockRows(400);
  const series = SERIES(rows, mockDaily(300));
  const f = alphaFeaturesAt(series, rows, 320, { side: "long", ...FEAT_OPTS(rows) });
  for (const axis of SPEC.breakoutQualityBuckets.axes) {
    assert.ok(axis in f, `breakout-quality axis ${axis} is missing from the feature vector`);
  }
});

// ============================================================================
// 20-21  PRE-REGISTERED GATES AND THE A/B/C VERDICT
// ============================================================================

const foldStats = (resolved, netBps, grossBps, rawBps, mean_R) => ({ resolved, netBps, grossBps, rawBps, mean_R });

function passingCtx(over = {}) {
  return {
    folds: {
      train: foldStats(400, 12, 20, 30, 0.4),
      validation: foldStats(200, 8, 15, 25, 0.3),
      test: foldStats(200, 6, 12, 22, 0.25),
    },
    markets: { crypto: { resolved: 500, netBps: 10 }, us: { resolved: 300, netBps: 4 } },
    symbols: { BTCUSDT: { resolved: 200 }, ETHUSDT: { resolved: 200 }, AAPL: { resolved: 200 } },
    moveCostRatio: 5,
    testSubFolds: [{ netBps: 1 }, { netBps: 2 }, { netBps: 3 }, { netBps: -1 }],
    maxSymbolProfitShare: 0.3,
    maxPeriodProfitShare: 0.4,
    stressNetBps: 2,
    nextBarNetBps: 1.5,
    ...over,
  };
}

test("A20 every pre-registered gate is required, and each failure is named", () => {
  const base = passingCtx();
  const g = evaluateAlphaGates({ ctx: base, spec: SPEC });
  assert.equal(g.pass, true);
  assert.deepEqual(g.failed, []);
  assert.equal(g.checks.length, 18);
  for (const c of g.checks) assert.equal(c.pass, true, `gate ${c.name} should pass`);
  const names = g.checks.map((c) => c.name);
  for (const required of [
    "sample_train", "sample_validation", "sample_test", "market_breadth", "symbol_sample",
    "raw_edge_validation", "raw_edge_test", "gross_edge_validation", "gross_edge_test", "min_gross_R_test",
    "net_edge_validation", "net_edge_test", "move_cost_ratio", "sub_fold_stability", "symbol_concentration",
    "period_concentration", "cost_stress", "next_bar_entry",
  ]) assert.ok(names.includes(required), `missing gate ${required}`);

  const fails = (over, name) => {
    const r = evaluateAlphaGates({ ctx: passingCtx(over), spec: SPEC });
    assert.equal(r.pass, false, `${name} should make the gate set fail`);
    assert.ok(r.failed.includes(name), `${name} not reported (failed: ${r.failed.join(",")})`);
    return r;
  };
  const foldsWith = (key, f) => ({ folds: { ...base.folds, [key]: f } });

  fails(foldsWith("train", foldStats(299, 12, 20, 30, 0.4)), "sample_train");
  fails(foldsWith("validation", foldStats(149, 8, 15, 25, 0.3)), "sample_validation");
  fails(foldsWith("test", foldStats(149, 6, 12, 22, 0.25)), "sample_test");
  fails(foldsWith("validation", foldStats(200, -0.5, 15, 25, 0.3)), "net_edge_validation");
  fails(foldsWith("test", foldStats(200, -0.5, 12, 22, 0.25)), "net_edge_test");
  fails(foldsWith("validation", foldStats(200, 8, -0.5, 25, 0.3)), "gross_edge_validation");
  fails(foldsWith("test", foldStats(200, 6, -0.5, 22, 0.25)), "gross_edge_test");
  fails(foldsWith("validation", foldStats(200, 8, 15, -0.5, 0.3)), "raw_edge_validation");
  fails(foldsWith("test", foldStats(200, 6, 12, -0.5, 0.25)), "raw_edge_test");
  fails(foldsWith("test", foldStats(200, 6, 12, 22, -0.1)), "min_gross_R_test");
  fails({ moveCostRatio: 2.9 }, "move_cost_ratio");
  fails({ maxSymbolProfitShare: 0.9 }, "symbol_concentration");
  fails({ maxPeriodProfitShare: 0.9 }, "period_concentration");
  fails({ stressNetBps: -0.1 }, "cost_stress");
  fails({ nextBarNetBps: -0.1 }, "next_bar_entry");

  const thinSubs = evaluateAlphaGates({ ctx: passingCtx({ testSubFolds: [{ netBps: 1 }, { netBps: -2 }, { netBps: -3 }, { netBps: 4 }] }), spec: SPEC });
  assert.ok(thinSubs.failed.includes("sub_fold_stability"));
  assert.equal(thinSubs.checks.find((c) => c.name === "sub_fold_stability").value.positive, 2);

  // a market carrying >=10% of the sample must stand on its own ...
  fails({ markets: { crypto: { resolved: 500, netBps: -1 }, us: { resolved: 300, netBps: 4 } } }, "market_breadth");
  // ... and a market set entirely below the share threshold cannot pass either
  fails({ markets: { crypto: { resolved: 50, netBps: 10 } } }, "market_breadth");
  // a dominant symbol with too few of its own trades fails, even when the total is healthy
  fails({
    folds: { train: foldStats(40, 12, 20, 30, 0.4), validation: foldStats(30, 8, 15, 25, 0.3), test: foldStats(30, 6, 12, 22, 0.25) },
    markets: { crypto: { resolved: 100, netBps: 5 } },
    symbols: { BTCUSDT: { resolved: 11 }, ETHUSDT: { resolved: 44 }, AAPL: { resolved: 45 } },
  }, "symbol_sample");
});

test("A21 the verdict is A / B / C and selection never looks at TEST", () => {
  const edge = { validationRawBps: 5, testRawBps: 3, validationResolved: 200, testResolved: 200 };
  const gatesFail = { pass: false, failed: ["net_edge_test", "cost_stress"] };

  const a = computeVerdict({ selection: { selected: true }, gates: { pass: true, failed: [] }, rawEdge: {} });
  assert.equal(a.grade, "A");
  assert.equal(a.label, "TRY IN SHADOW / PAPER");

  const b1 = computeVerdict({ selection: { selected: true }, gates: gatesFail, rawEdge: edge });
  assert.equal(b1.grade, "B");
  assert.equal(b1.label, "DO NOT TRADE YET");
  assert.match(b1.reason, /net_edge_test, cost_stress/);

  const b2 = computeVerdict({ selection: { selected: false }, gates: gatesFail, rawEdge: edge });
  assert.equal(b2.grade, "B");
  assert.match(b2.reason, /no candidate satisfied the selection protocol/i);

  // grade A needs BOTH a selected candidate AND a fully passing gate set
  assert.equal(computeVerdict({ selection: { selected: true }, gates: { pass: false, failed: ["x"] }, rawEdge: edge }).grade, "B");
  assert.equal(computeVerdict({ selection: { selected: false }, gates: { pass: true, failed: [] }, rawEdge: edge }).grade, "B");

  // a raw edge that only shows up on TEST is not a replicated edge
  const mk = (rawEdge) => computeVerdict({ selection: { selected: false }, gates: gatesFail, rawEdge });
  assert.equal(mk({ validationRawBps: -1, testRawBps: 9, validationResolved: 200, testResolved: 200 }).grade, "C");
  assert.equal(mk({ validationRawBps: 5, testRawBps: 3, validationResolved: 99, testResolved: 200 }).grade, "C");
  assert.equal(mk({ validationRawBps: 5, testRawBps: 3, validationResolved: 200, testResolved: 99 }).grade, "C");
  assert.equal(mk({ validationRawBps: 0, testRawBps: 3, validationResolved: 200, testResolved: 200 }).grade, "C");
  const c = mk({});
  assert.equal(c.grade, "C");
  assert.equal(c.label, "STOP / REDESIGN");
});

// ============================================================================
// 22  WRITE ISOLATION
// ============================================================================

test("A22 the alpha phase can only ever write its own artefacts", () => {
  const summary = path.join(ALPHA_DIR, "alpha-summary.v2.json");
  const trades = path.join(ALPHA_DIR, "alpha-trades.v2.jsonl");
  assert.equal(assertAlphaPath(summary), path.resolve(summary));
  assert.equal(assertAlphaPath(trades), path.resolve(trades));
  // the report is a separate, explicitly-granted target
  assert.throws(() => assertAlphaPath(ALPHA_REPORT_PATH), /refusing to write outside/);
  assert.equal(assertAlphaPath(ALPHA_REPORT_PATH, { allowReport: true }), path.resolve(ALPHA_REPORT_PATH));

  const forbidden = [
    path.join(ROOT, "config", "alpha-experiment-spec.v1.json"),
    path.join(ROOT, "config.json"),
    path.join(ROOT, "config", "management.control.json"),
    path.join(ROOT, "data", "real", "panel-hour.json"),
    path.join(ROOT, "scripts", "v2", "alpha.mjs"),
    path.join(ALPHA_DIR, "..", "..", "config.json"),            // traversal must not escape
    path.join(ALPHA_DIR, "..", "real", "panel-hour.json"),
  ];
  for (const p of forbidden) assert.throws(() => assertAlphaPath(p), /refusing to write outside/, p);

  // a real write lands inside the alpha area, round-trips, and is cleaned up
  const tmp = path.join(ALPHA_DIR, "alpha-test-artifact.tmp.json");
  try {
    writeAlphaJSON(tmp, { ok: true, n: 3 });
    assert.deepEqual(JSON.parse(fs.readFileSync(tmp, "utf8")), { ok: true, n: 3 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  assert.equal(fs.existsSync(tmp), false);

  // the guard is what the runner and the report actually use
  for (const rel of ["alpha-run.mjs", "alpha-report.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, "scripts", "v2", rel), "utf8");
    assert.match(src, /writeAlphaJSON|assertAlphaPath/, `${rel} does not use the alpha write guard`);
  }
});
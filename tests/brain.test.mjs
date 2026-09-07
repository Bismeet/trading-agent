// tests/brain.test.mjs — DSR, Kelly, lifecycle helpers, lexicon/fng/news (docs/16 U08, U20).
import test from "node:test";
import assert from "node:assert/strict";
import { deflatedSharpe, normCdf, normInv, skewness, kurtosis, strategyKelly, IMPORTANCE } from "../scripts/v2/brain.mjs";
import { lexiconScore, fngBand, aggregateNews, regimeScore } from "../scripts/world/score.mjs";

test("normInv/normCdf reference values", () => {
  assert.ok(Math.abs(normInv(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(normInv(0.5)) < 1e-9);
  assert.ok(Math.abs(normCdf(1.96) - 0.975002) < 1e-5);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-9);
  assert.ok(Number.isNaN(normInv(0)) && Number.isNaN(normInv(1)));
});

test("U08 DSR guards + pass flag", () => {
  assert.deepEqual(deflatedSharpe([1, 1, 1, -1, 1], 6), { sr: 0, dsr: 0, sr0: 0, pass: false }); // n<8
  assert.equal(deflatedSharpe([1, 1, 1, 1, 1, 1, 1, 1], 6).pass, false); // zero sd
  const rs = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -0.2 : 0.5)); // positive edge
  const d = deflatedSharpe(rs, 6);
  assert.ok(Number.isFinite(d.sr) && Number.isFinite(d.dsr) && Number.isFinite(d.sr0));
  assert.equal(typeof d.pass, "boolean");
  // rounded to 3 decimals
  assert.equal(d.sr, Math.round(d.sr * 1000) / 1000);
});

test("skewness/kurtosis conventions", () => {
  assert.equal(skewness([1, 1, 1]), 0); // zero variance
  assert.equal(kurtosis([1, 1, 1]), 3);
  assert.ok(Math.abs(kurtosis([1, 2, 3, 4]) - kurtosis([10, 20, 30, 40])) < 1e-9); // scale invariant
});

test("strategyKelly defaults, factor, clamps, statuses", () => {
  assert.equal(strategyKelly({ n: 0 }), 0.12);
  assert.equal(strategyKelly({ n: 3, backtest_failed: true }), 0.04);
  // strong edge: .4 * clamp(e/v, 0, 1.5) -> capped by .40 final clamp
  assert.equal(strategyKelly({ n: 40, expectancy_R: 0.5, variance_R: 0.2 }), 0.4);
  // negative edge -> .4*0 = 0 -> clamped to floor .02
  assert.equal(strategyKelly({ n: 40, expectancy_R: -0.5, variance_R: 0.2 }), 0.02);
  // probation halves
  assert.equal(strategyKelly({ n: 40, expectancy_R: 0.4, variance_R: 0.4, status: "probation" }), 0.2);
  // retired pinned
  assert.equal(strategyKelly({ n: 40, expectancy_R: 1, variance_R: 0.1, status: "retired" }), 0.02);
  // missing variance -> floor
  assert.equal(strategyKelly({ n: 40, expectancy_R: 0.5 }), 0.02);
});

test("IMPORTANCE exact values + default 2", () => {
  assert.equal(IMPORTANCE.liquidation, 10);
  assert.equal(IMPORTANCE["capital-floor"], 10);
  assert.equal(IMPORTANCE["stop-loss"], 7);
  assert.equal(IMPORTANCE["episode-end"], 6);
  assert.equal(IMPORTANCE["take-profit"], 5);
  assert.equal(IMPORTANCE["trailing-stop"], 4);
  assert.equal(IMPORTANCE["trend-flip"], 3);
  assert.equal(IMPORTANCE["rsi2-reverted"], 3);
  assert.equal(IMPORTANCE["time-stop"], undefined); // falls to default 2 at call site
});

test("lexiconScore negation, divide by 3, clamp", () => {
  assert.equal(lexiconScore("no news at all"), 0);
  assert.ok(lexiconScore("bitcoin surge rally") > 0);
  assert.ok(lexiconScore("market crash panic") < 0);
  assert.ok(lexiconScore("not crash") > lexiconScore("crash")); // negator flips sign
  assert.ok(lexiconScore("no rally") < lexiconScore("rally"));
  assert.equal(lexiconScore("crash panic bankruptcy fraud scam hack"), -1); // clamped
});

test("fngBand exact boundaries", () => {
  assert.equal(fngBand(null), "unknown");
  assert.equal(fngBand(NaN), "unknown");
  assert.equal(fngBand(24), "extreme_fear");
  assert.equal(fngBand(25), "fear");
  assert.equal(fngBand(44), "fear");
  assert.equal(fngBand(45), "neutral");
  assert.equal(fngBand(55), "neutral");
  assert.equal(fngBand(56), "greed");
  assert.equal(fngBand(74), "greed");
  assert.equal(fngBand(75), "extreme_greed");
});

test("aggregateNews mixed flag + fields", () => {
  const a = aggregateNews([{ title: "surge rally" }, { title: "crash panic" }]);
  assert.equal(a.n, 2);
  assert.equal(a.mixed, a.dispersion > 0.45);
  assert.ok(Array.isArray(a.top));
  assert.equal(aggregateNews([]).n, 0);
});

test("regimeScore labels and missing data", () => {
  const calm = regimeScore({ "^VIX": { price: 12, changePct: 0 }, "DX-Y.NYB": { price: 100, changePct: -0.5 } });
  assert.equal(calm.label, "risk_on");
  const storm = regimeScore({ "^VIX": { price: 35, changePct: 10 }, "DX-Y.NYB": { price: 105, changePct: 1 }, "^TNX": { price: 45, changePct: 2 } });
  assert.equal(storm.label, "risk_off");
  assert.ok(storm.drivers.length > 0);
  const none = regimeScore({});
  assert.equal(none.label, "neutral");
});

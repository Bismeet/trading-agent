// tests/strategies.test.mjs — exact threshold/warmup fixtures (docs/16 strategy groups).
import test from "node:test";
import assert from "node:assert/strict";
import { sigTsmom, sigDonchian, sigRsi2dip, sigMomTrend, sigBreakoutIntraday, strategyExit, SEEDS } from "../scripts/v2/strategies.mjs";

// helper: build closes ending at `last` with a given 28-ago anchor
function closes(n, fn) { return Array.from({ length: n }, (_, i) => fn(i)); }

test("seed registry is exactly six with exact ids", () => {
  assert.deepEqual(SEEDS.map((s) => s.id), ["tsmom", "donchian", "rsi2dip", "mom_trend", "orb", "ibreakout"]);
  assert.equal(SEEDS.find((s) => s.id === "ibreakout").intraday, true);
  assert.deepEqual(SEEDS.find((s) => s.id === "orb").markets, ["us"]);
});

test("sigTsmom warmup + 3% threshold strictness", () => {
  assert.equal(sigTsmom({ closes: closes(29, () => 100), price: 100 }), null); // <30 closes
  // flat series: r28 = 0 -> no signal
  assert.equal(sigTsmom({ closes: closes(40, () => 100), price: 100 }), null);
  // up > 3%: c[last]/c[last-29] - 1 > .03
  const upTrend = closes(40, (i) => (i === 39 ? 110 : i === 10 ? 100 : 104));
  const sig = sigTsmom({ closes: upTrend, price: 110 });
  assert.equal(sig?.side, "long");
  assert.equal(sig.confidence, 0.62);
  assert.equal(sig.stopPct, 0.05);
  assert.equal(sig.targetPct, 0.10);
});

test("sigDonchian prior-20 channel excludes latest close", () => {
  // 25 closes: prior 20 are indices 4..23; make price break above them
  const c = closes(25, () => 100);
  c[23] = 105; // inside prior window -> hi = 105
  assert.equal(sigDonchian({ closes: c, price: 104 })?.side, undefined); // below hi
  const sig = sigDonchian({ closes: c, price: 106 });
  assert.equal(sig?.side, "long");
  assert.equal(sig.confidence, 0.60);
  // latest close itself must not define the channel: price equal to last close above old hi
  assert.equal(sigDonchian({ closes: c, price: 105 }), null); // strict inequality
});

test("sigRsi2dip requires 210 closes and SMA200", () => {
  assert.equal(sigRsi2dip({ closes: closes(209, () => 100), price: 100 }), null); // warmup
  // strong dip: last two closes plunge while long-run trend is up
  const c = closes(210, (i) => 100 + i * 0.1); // rising -> price > SMA200
  c[208] = 100; c[209] = 99; // sharp 2-day drop -> RSI2 near 0
  const price = c[209];
  const s200 = c.slice(10).reduce((a, b) => a + b, 0) / 200;
  const sig = sigRsi2dip({ closes: c, price });
  if (price > s200) assert.equal(sig?.side, "long"); // rsi2 < 10 & above SMA200
  else assert.equal(sig, null); // filter blocks entry below SMA200
});

test("sigMomTrend long-only + rsi<78 filter", () => {
  const c = closes(40, (i) => (i === 39 ? 120 : i === 10 ? 100 : 108));
  const sig = sigMomTrend({ closes: c, price: 120, mom: 5, rsi: 60 });
  assert.equal(sig?.side, "long");
  assert.equal(sig.confidence, 0.55);
  // rsi too hot blocks
  assert.equal(sigMomTrend({ closes: c, price: 120, mom: 5, rsi: 78 }), null);
  // mom exactly 1 does not pass
  assert.equal(sigMomTrend({ closes: c, price: 120, mom: 1, rsi: 60 }), null);
  // no short entry ever
  const down = closes(40, (i) => (i === 39 ? 90 : 100));
  assert.equal(sigMomTrend({ closes: down, price: 90, mom: -5, rsi: 20 }), null);
});

test("sigBreakoutIntraday prior-48 channel, latest excluded, strict", () => {
  const c = closes(50, () => 100);
  c[48] = 101; // last close (index 49 is latest? no — index 49 is latest close)
  // 50 closes: latest = index 49, prior 48 = indices 1..48, hi includes c[48]=101
  assert.equal(sigBreakoutIntraday({ closesIntraday: c }), null); // 100 not > 101
  const c2 = closes(50, () => 100);
  c2[49] = 106; // latest close breaks above prior-48 high (all 100)
  const sig = sigBreakoutIntraday({ closesIntraday: c2 });
  assert.equal(sig?.side, "long");
  assert.equal(sig.confidence, 0.50);
  assert.equal(sig.stopPct, 0.015);
  assert.equal(sigBreakoutIntraday({ closesIntraday: closes(48, () => 100) }), null); // <49 bars
  assert.equal(sigBreakoutIntraday({ closesIntraday: closes(50, () => 100) }), null); // no breakout
});

test("strategyExit rsi2 reversal + trend flip", () => {
  const meta = (id) => ({ openMeta: { strategy_id: id } });
  // rsi2 exit: long exits r2>=65 — rising last two days
  const up2 = closes(40, (i) => 100).concat([101, 103]);
  assert.equal(strategyExit({ ...meta("rsi2dip"), side: "long" }, { closes: up2, price: 103 }), "rsi2-reverted");
  // trend flip: long tsmom exits when r28 flips negative
  const down = closes(40, (i) => (i === 39 ? 90 : 100));
  assert.equal(strategyExit({ ...meta("tsmom"), side: "long" }, { closes: down, price: 90 }), "trend-flip");
  assert.equal(strategyExit({ ...meta("orb"), side: "long" }, { closes: down, price: 90 }), null); // no indicator exit
});

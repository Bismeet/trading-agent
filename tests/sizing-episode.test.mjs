// tests/sizing-episode.test.mjs — P5 sizing vectors + P3 episode state machine.
// Uses the real config.json and isolated temp copies of data files where writes occur.
import test from "node:test";
import assert from "node:assert/strict";
import { dailyVol, sizeOrder } from "../scripts/v2/sizing.mjs";
import { freshV2State, recordEquityPeak, episodeEndReason, nextEpisode, setGoal } from "../scripts/v2/episode.mjs";
import { SEEDS } from "../scripts/v2/strategies.mjs";
import { loadConfig } from "../scripts/lib.mjs";

const cfg = loadConfig();
// Canonical seed Kelly for tsmom (n<5 default .12) — don't depend on mutable data/strategies.json,
// which live engine runs may have evolved.
const seedKelly = SEEDS.find((s) => s.id === "tsmom").kelly ?? 0.12;

function freshState() {
  const s = freshV2State(cfg);
  return s;
}

test("U04 dailyVol population variance + clamps + fallback", () => {
  assert.equal(dailyVol(undefined), 0.03);
  assert.equal(dailyVol(Array(14).fill(100)), 0.03); // <15 closes
  const flat = Array(15).fill(100);
  assert.equal(dailyVol(flat), 0.005); // zero variance -> floor
  const wild = Array.from({ length: 15 }, (_, i) => 100 * Math.exp((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.1));
  assert.ok(dailyVol(wild) <= 0.15); // ceiling applies
  assert.ok(dailyVol(wild) > 0.005); // real variance
  // exact population computation: log returns of a known series
  const c = [100, 110, 99, 108.9, 98.01, 107.811, 97.0299, 106.73289, 96.059601, 105.6655611, 95.09900499, 104.608905489, 94.1480149401, 103.562816434, 93.2065347907];
  const lr = [];
  for (let i = 1; i < 15; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const m = lr.reduce((a, b) => a + b, 0) / 14;
  const expected = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / 14);
  assert.ok(Math.abs(dailyVol(c) - Math.min(0.15, Math.max(0.005, expected))) < 1e-12);
});

test("U19 sizing: fresh seed golden example from docs/10", () => {
  const state = freshState();
  const closes = Array.from({ length: 15 }, (_, i) => 100 * Math.exp((i % 2 ? 0.02 : -0.02) * Math.ceil(i / 2)));
  // order carries the canonical seed Kelly explicitly so the test never depends on
  // mutable learned state in data/strategies.json
  const o = sizeOrder(state, { op: "open", symbol: "BTC-USD", side: "long", leverage: 12, strategy_id: null, sizePct: 0.12 }, 100, cfg, { quotes: { "BTC-USD": { closes } } });
  assert.equal(o.leverage, 12);
  // base = .12; margin0 = 12; vol mult = clamp(.0314/obs,.25,1.7)
  const obs = dailyVol(closes);
  const expected = 12 * Math.min(1.7, Math.max(0.25, (0.6 / Math.sqrt(365)) / obs));
  assert.ok(Math.abs(o.marginUsd - expected) < 1e-9);
});

test("U19 sizing: leverage caps per market", () => {
  const state = freshState();
  const mk = (sym, lev) => sizeOrder(state, { op: "open", symbol: sym, side: "long", leverage: lev, strategy_id: null, sizePct: 0.1 }, 100, cfg, { quotes: {} });
  assert.equal(mk("AAPL", 5).leverage, 4); // US max 4 even when proposed 5
  assert.equal(mk("RELIANCE.NS", 12).leverage, 5); // India max 5
  assert.equal(mk("BTC-USD", 100).leverage, 20); // account cap 20 < market max 40
});

test("U19 sizing: explicit margin bypass + wallet clamp", () => {
  const state = freshState();
  const o = sizeOrder(state, { op: "open", symbol: "BTC-USD", side: "long", leverage: 10, marginUsd: 100 }, 100, cfg, { quotes: {} });
  assert.equal(o.marginUsd, 98); // wallet 100 * .98
});

test("U19 sizing: goal multiplier only when 0<progress<1", () => {
  const state = freshState();
  const base = { op: "open", symbol: "BTC-USD", side: "long", leverage: 10, strategy_id: null, sizePct: 0.1 };
  const quotes = { quotes: { "BTC-USD": { closes: Array(15).fill(100) } } };
  const atStart = sizeOrder(state, { ...base }, 100, cfg, quotes);
  const nearStart = sizeOrder(state, { ...base }, 100.01, cfg, quotes);
  // just above start: multiplier -> 1.55x
  assert.ok(nearStart.marginUsd > atStart.marginUsd * 1.5);
  // at/above target: no bonus (and progress>=1 excluded)
  const done = sizeOrder(state, { ...base }, 500, cfg, quotes);
  assert.ok(done.marginUsd <= atStart.marginUsd + 1e-9);
  // underwater: no bonus
  const under = sizeOrder(state, { ...base }, 50, cfg, quotes);
  assert.ok(under.marginUsd <= atStart.marginUsd + 1e-9);
});

test("U19 sizing: non-open orders pass through unchanged", () => {
  const o = { op: "close", symbol: "BTC-USD" };
  assert.equal(sizeOrder(freshState(), o, 100, cfg, {}), o);
});

test("U18 episodes: end precedence blowup > goal > time", () => {
  const s = freshState();
  assert.equal(episodeEndReason(s, cfg, s.startedAt), null);
  s.equity = 0;
  assert.equal(episodeEndReason(s, cfg, s.startedAt), "blowup");
  s.equity = 500;
  assert.equal(episodeEndReason(s, cfg, s.startedAt), "goal");
  s.equity = 100;
  assert.equal(episodeEndReason(s, cfg, s.startedAt + 24 * 3600000), "time");
  assert.equal(episodeEndReason(s, cfg, s.startedAt + 24 * 3600000 - 1), null);
});

test("U18 recordEquityPeak drawdown", () => {
  const s = freshState();
  s.equity = 120; recordEquityPeak(s);
  assert.equal(s.peakEquity, 120);
  s.equity = 60; const dd = recordEquityPeak(s);
  assert.equal(dd, 50);
  assert.equal(s.maxDrawdownPct, 50);
  s.equity = 130; recordEquityPeak(s);
  assert.equal(s.peakEquity, 130);
  assert.equal(s.maxDrawdownPct, 50); // retained
});

test("episodes: nextEpisode resets capital, preserves learning", () => {
  const s = freshState();
  s.generation = 5;
  s.aggression.kellyFraction = 0.6;
  s.lifetime.totalBlowups = 2;
  s.positions = { "BTC-USD": { fake: true } };
  nextEpisode(s, cfg);
  assert.equal(s.episodeNum, 2);
  assert.equal(s.equity, 100);
  assert.equal(s.walletBalance, 100);
  assert.equal(s.generation, 5); // preserved
  assert.equal(s.aggression.kellyFraction, 0.6); // preserved
  assert.equal(s.lifetime.totalBlowups, 2); // preserved
  assert.deepEqual(s.positions, {}); // cleared
  assert.equal(s.lifetime.episodes, 2);
});

test("setGoal uses current equity + fresh time", () => {
  const s = freshState();
  s.equity = 250;
  setGoal(s, 1000, 48);
  assert.equal(s.goal.startEquity, 250);
  assert.equal(s.goal.target, 1000);
  assert.equal(s.goal.deadlineHours, 48);
});

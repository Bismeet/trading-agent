// tests/shadow.test.mjs — Phase 3: candidate attribution, shadow separation,
// no-leakage, chronological enforcement, determinism, insufficient-data guards.
// Isolated via FAB_DATA; never touches the live ledger.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-shadow-"));
const { loadConfig, loadJSON: _lj } = await import("../scripts/v2/store.mjs");
const cfg = loadConfig();
const shadow = await import("../scripts/v2/shadow.mjs");
const { freshV2State } = await import("../scripts/v2/episode.mjs");
const { runStrategies } = await import("../scripts/v2/strategies.mjs");
const { emptyLearning, loadLearning, learnConfig } = await import("../scripts/v2/learning.mjs");
const E = await import("../scripts/v2/evaluate-shadow-learning.mjs");
const L = learnConfig(cfg);
const V2 = (await import("../scripts/v2/store.mjs")).V2;

const closesUp = () => {
  const c = Array(40).fill(100);
  for (let i = 30; i < 40; i++) c[i] = 100 + (i - 29);
  return c;
};
const q = (over = {}) => ({ ok: true, stale: false, priceUsd: 110, price: 110, marketState: "REGULAR", closes: closesUp(), rsi: 90, mom: 10, ...over });

test("1 candidate attribution: strategy-level fired/no-signal rows", () => {
  const state = freshV2State(cfg);
  const { evaluated, orders } = runStrategies(state, 100, cfg, { quotes: { "BTC-USD": q() }, strategyCache: {}, cooldowns: {} });
  const rows = evaluated.filter((e) => e.symbol === "BTC-USD");
  const fired = rows.filter((r) => r.fired).map((r) => r.strategy_id).sort();
  assert.deepEqual(fired, ["donchian", "tsmom"]); // tsmom + donchian fire on this synthetic bar
  assert.ok(rows.some((r) => r.strategy_id === "rsi2dip" && !r.fired)); // warmup < 210
  assert.ok(rows.some((r) => r.strategy_id === "mom_trend" && !r.fired)); // rsi 90 blocks
  assert.ok(!rows.some((r) => r.strategy_id === "orb")); // us-only: structurally ineligible
  assert.ok(orders.some((o) => o.strategy_id === "tsmom"));
});

test("2 candidate diversity: counts reduce to strategy level deterministically", () => {
  const state = freshV2State(cfg);
  const { evaluated } = runStrategies(state, 100, cfg, { quotes: { "BTC-USD": q() }, strategyCache: {}, cooldowns: {} });
  const by = {};
  for (const r of evaluated) by[r.strategy_id] = (by[r.strategy_id] || 0) + (r.fired ? 1 : 0);
  assert.equal(by.tsmom, 1);
  assert.equal(by.donchian, 1);
  assert.equal(by.rsi2dip, 0);
});

test("3 shadow separation: own files, journal untouched", async () => {
  const book = shadow.loadShadowBook();
  const cand = {
    trade_id: "t1", symbol: "BTC-USD", market: "crypto", side: "long",
    strategy_id: "tsmom", setup_tag: "momentum", stopPct: 0.05, targetPct: 0.1,
    reason: "r", leverage: 12, setupRegime: "broad_up", decisionTs: 1000, rejectReason: "rank-lost",
  };
  const rec = shadow.openShadow(book, cfg, cand, q({ ts: 1000 }), 1500);
  assert.ok(rec);
  shadow.saveShadowBook(book);
  assert.ok(fs.existsSync(V2.shadowOpen));
  assert.ok(!fs.existsSync(V2.journal), "journal must NOT be written by shadow open");
  assert.ok(!fs.existsSync(V2.contextLearning), "learner store must NOT be written by shadow open");
});

test("4-5 shadow never touches equity or the live learner", () => {
  const state = freshV2State(cfg);
  assert.equal(state.equity, 100);
  const before = state.walletBalance;
  const book = shadow.loadShadowBook();
  const cand = {
    trade_id: "t2", symbol: "BTC-USD", market: "crypto", side: "long",
    strategy_id: "tsmom", setup_tag: "momentum", stopPct: 0.05, targetPct: 0.1,
    reason: "r", leverage: 12, setupRegime: "broad_up", decisionTs: 5000, rejectReason: "cap",
  };
  shadow.openShadow(book, cfg, cand, q({ ts: 5000 }), 6000);
  // resolve with a future price low enough to liquidate after one EMA step (mark ~80 < liq ~92)
  shadow.manageShadow(book, cfg, { "BTC-USD": q({ ts: 100000, priceUsd: 20, price: 20 }) }, 100000, 0);
  shadow.saveShadowBook(book);
  assert.equal(state.equity, 100, "state equity untouched");
  assert.equal(state.walletBalance, before, "wallet untouched");
  const rows = loadLearning();
  assert.equal(Object.keys(rows.cells).length, 0, "live learner untouched");
  const trades = fs.readFileSync(V2.shadowTrades, "utf8").trim().split("\n").length;
  assert.ok(trades >= 1);
});

test("6 no future leakage: pre-entry quotes cannot manage/close the shadow", () => {
  const book = shadow.loadShadowBook();
  const cand = {
    trade_id: "t3", symbol: "ETH-USD", market: "crypto", side: "short",
    strategy_id: "donchian", setup_tag: "breakout", stopPct: 0.05, targetPct: 0.08,
    leverage: 12, setupRegime: "broad_up", decisionTs: 10_000, rejectReason: "rank-lost",
  };
  shadow.openShadow(book, cfg, cand, q({ ts: 10_000, priceUsd: 100 }), 10_000);
  // pre-entry impossible quote must be IGNORED (ts 9000 < decisionTs 10000)
  shadow.manageShadow(book, cfg, { "ETH-USD": q({ ts: 9_000, priceUsd: 1 }) }, 10_500, 0);
  assert.ok(book.open.t3, "pre-entry quote must not close");
});

test("6b no future leakage: post-entry quote resolves normally", () => {
  const book = shadow.loadShadowBook();
  const cand = {
    trade_id: "t4", symbol: "SOL-USD", market: "crypto", side: "long",
    strategy_id: "tsmom", setup_tag: "momentum", stopPct: 0.05, targetPct: 0.1,
    leverage: 12, setupRegime: "broad_up", decisionTs: 20_000, rejectReason: "learner-lost",
  };
  shadow.openShadow(book, cfg, cand, q({ ts: 20_000, priceUsd: 100 }), 20_000);
  shadow.manageShadow(book, cfg, { "SOL-USD": q({ ts: 120_000, priceUsd: 20, price: 20 }) }, 120_000, 0);
  assert.ok(!book.open.t4, "post-entry liquidation closes");
});

test("7 chronological enforcement: shuffled input THROWS", async () => {
  const ex = [
    { ts: 1000, ts_close: 1500, symbol: "BTC-USD", strategy_id: "tsmom", regime: "r", side: "long", realized_R: 0.1 },
    { ts: 1001, ts_close: 1600, symbol: "ETH-USD", strategy_id: "tsmom", regime: "r", side: "long", realized_R: -0.1 },
  ];
  const good = E.replayShadowTimeline({ executed: ex, shadows: [] }, L, { strict: true });
  assert.equal(good.sel.decisions, 2);
  const shuffled = [ex[1], ex[0]];
  assert.throws(() => E.replayShadowTimeline({ executed: shuffled, shadows: [] }, L, { strict: true }));
  assert.throws(() => E.assertChronological([{ a: 5 }, { a: 3 }], "a", "t"));
});

test("8-10 strategy/regime/side specific shadow aggregates", () => {
  const ex = [];
  const shadows = [];
  let t = 0;
  const mk = (strategy, regime, side, R) => {
    t += 1000;
    return { ts: t, decisionTs: t, symbol: "SYN", strategy_id: strategy, regime, side, realized_R: R };
  };
  for (let i = 0; i < 8; i++) shadows.push(mk("tsmom", "broad_up", "long", 0.1 + i * 0.01));
  for (let i = 0; i < 8; i++) shadows.push(mk("donchian", "crypto_down", "short", -0.05 - i * 0.01));
  const r = E.replayShadowTimeline({ executed: ex, shadows }, L, {});
  const agg = E.aggregateShadowReport(r);
  const byCell = Object.fromEntries(agg.aggregates.byCell.map((x) => [x.key, x]));
  assert.ok(byCell["broad_up|long|tsmom"]);
  assert.ok(Math.abs(byCell["broad_up|long|tsmom"].meanR - 0.135) < 0.001);
  assert.ok(byCell["crypto_down|short|donchian"]);
  assert.equal(byCell["crypto_down|short|donchian"].winRate, 0); // all negative
});

test("11 deterministic repeated evaluation", () => {
  const ex = [{ ts: 1000, ts_close: 1500, symbol: "BTC-USD", strategy_id: "tsmom", regime: "r", side: "long", realized_R: 0.1 }];
  const shadows = [{ ts: 1000, decisionTs: 1000, symbol: "BTC-USD", strategy_id: "tsmom", regime: "r", side: "long", realized_R: 0.1 }];
  const a = JSON.stringify(E.aggregateShadowReport(E.replayShadowTimeline({ executed: ex, shadows }, L, {})));
  const b = JSON.stringify(E.aggregateShadowReport(E.replayShadowTimeline({ executed: ex, shadows }, L, {})));
  assert.equal(a, b);
});

test("12 selected-vs-shadow attribution", () => {
  const ex = [{ ts: 1000, ts_close: 1500, symbol: "BTC-USD", strategy_id: "tsmom", regime: "r", side: "long", realized_R: 0.05 }];
  const shadows = [
    { ts: 1000, decisionTs: 1000, symbol: "BTC-USD", strategy_id: "donchian", regime: "r", side: "long", realized_R: 0.30 },
    { ts: 1000, decisionTs: 1000, symbol: "BTC-USD", strategy_id: "rsi2dip", regime: "r", side: "long", realized_R: -0.10 },
  ];
  const r = E.replayShadowTimeline({ executed: ex, shadows }, L, {});
  const agg = E.aggregateShadowReport(r);
  assert.equal(agg.selectionQuality.withAlternatives, 1);
  assert.ok(agg.selectedVsBest.meanRegret < 0); // selected 0.05 < best 0.30
  assert.equal(agg.selectedVsBest.beatsBestRate, 0);
});

test("14 actual/shadow datasets stay separate in replay", async () => {
  // executed scores learner; shadow rows never appear in any aggregate labeled OBSERVED.
  const ex = [{ ts: 1000, ts_close: 1500, symbol: "BTC-USD", strategy_id: "tsmom", regime: "r", side: "long", realized_R: 0.5 }];
  const shadows = [{ ts: 1000, decisionTs: 1000, symbol: "BTC-USD", strategy_id: "donchian", regime: "r", side: "long", realized_R: -9.0 }];
  // minSample 1 exposes the counterfactual cell mean for this separation check;
  // at the default minSample the cell correctly reports insufficient (n=1 < 5).
  const r = E.replayShadowTimeline({ executed: ex, shadows }, L, { minSample: 1 });
  const agg = E.aggregateShadowReport(r);
  // -9.0 appears only in counterfactual aggregates; learner store saw only 0.5
  const cell = agg.aggregates.byCell.find((c) => c.key === "r|long|donchian");
  assert.equal(cell.meanR, -9.0);
  assert.equal(cell.n, 1);
  assert.ok(!r.store.cells["r|long|donchian"], "shadow outcome must NOT enter the replay learner store");
  assert.ok(r.store.cells["r|long|tsmom"], "executed outcome DOES enter the replay learner store");
  assert.ok(JSON.stringify(agg).indexOf("NaN") < 0);
});

test("15 insufficient-data handling: no claims, no NaN", async () => {
  const agg = E.aggregateShadowReport(E.replayShadowTimeline({ executed: [], shadows: [] }, L, {}));
  assert.equal(agg.sample.sufficientShadowEvidence, false);
  assert.equal(agg.selectionQuality.withAlternatives, 0);
  assert.equal(agg.selectedVsBest.beatsBestRate, null);
  assert.equal(agg.learnerCounterfactual.meanR, null);
  assert.ok(JSON.stringify(agg).indexOf("NaN") < 0);
});

test("13 risk dominance preserved (learner cannot override hard caps)", async () => {
  const { sizeOrder } = await import("../scripts/v2/sizing.mjs");
  const state = freshV2State(cfg);
  const o = sizeOrder(state, { op: "open", symbol: "BTC-USD", side: "long", leverage: 9e9, strategy_id: "tsmom", sizeMult: 9e9 }, 100, cfg, { quotes: { "BTC-USD": q() } });
  assert.ok(o.leverage <= 40);
  assert.ok(o.marginUsd <= state.walletBalance * 0.98 + 1e-9);
});

test("16 candidate report: statuses reduce to strategy level deterministically", () => {
  const rows = [
    { ts: 1, rows: [
      { symbol: "BTC-USD", strategy_id: "tsmom", fired: true, status: "selected", side: "long", setupRegime: "broad_up", learner: { n: 9 } },
      { symbol: "BTC-USD", strategy_id: "donchian", fired: true, status: "candidate-rejected-learner", side: "long", setupRegime: "broad_up", learner: { n: 9 } },
      { symbol: "BTC-USD", strategy_id: "rsi2dip", fired: false, status: "no-signal", side: null, setupRegime: "broad_up" },
    ] },
    { ts: 2, rows: [
      { symbol: "ETH-USD", strategy_id: "tsmom", fired: true, status: "candidate-rejected-cap", side: "long", setupRegime: "broad_up", learner: { n: 9 } },
      { symbol: "ETH-USD", strategy_id: "mom_trend", fired: true, status: "selected-council-vetoed", side: "long", setupRegime: "broad_up", learner: { n: 1 } },
    ] },
  ];
  const rep = E.candidateReport(rows);
  const tsmom = rep.byStrategy.find((s) => s.key === "tsmom");
  const donchian = rep.byStrategy.find((s) => s.key === "donchian");
  const rsi2 = rep.byStrategy.find((s) => s.key === "rsi2dip");
  const mom = rep.byStrategy.find((s) => s.key === "mom_trend");
  assert.deepEqual([tsmom.evaluated, tsmom.candidates, tsmom.selected, tsmom.capRejected], [2, 2, 1, 1]);
  assert.deepEqual([donchian.candidates, donchian.learnerRejected], [1, 1]);
  assert.equal(rsi2.noSignal, 1);
  assert.equal(mom.councilVetoed, 1);
  assert.equal(mom.abstained, 1); // learner n<3 => cold-start decision counted
  assert.equal(rep.cycles, 2);
  const a = JSON.stringify(E.candidateReport(rows));
  const b = JSON.stringify(E.candidateReport(rows));
  assert.equal(a, b);
});
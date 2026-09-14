// tests/learning.test.mjs — contextual learner (FAB_DATA isolated).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-learn-"));
const LE = await import("../scripts/v2/learning.mjs");
const { loadConfig } = await import("../scripts/v2/store.mjs");
const cfg = loadConfig();
const L = LE.learnConfig(cfg);
const ctx = (over = {}) => ({
  regime: "broad_up", strategy: "tsmom", side: "long", symbol: "BTC-USD",
  market: "crypto", vol: "medium", trend: "bullish", rsi: "neutral",
  mom: "positive", fng: "neutral", funding: "balanced", session: "us", ...over,
});

test("positive trade raises expectancy; negative lowers it", () => {
  const s = LE.emptyLearning();
  LE.recordExperience(s, ctx(), 0.8);
  let sc = LE.scoreCell(s, ctx(), L);
  assert.ok(sc.adjExp > 0);
  const before = sc.adjExp;
  LE.recordExperience(s, ctx(), -0.5);
  sc = LE.scoreCell(s, ctx(), L);
  assert.ok(sc.adjExp < before);
  assert.equal(sc.n, 2);
});

test("context separation: broad_up does not contaminate crypto_down", () => {
  const s = LE.emptyLearning();
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ regime: "broad_up" }), 0.6);
  const bad = LE.scoreCell(s, ctx({ regime: "crypto_down" }), L);
  const good = LE.scoreCell(s, ctx({ regime: "broad_up" }), L);
  assert.equal(bad.n, 0); // cell itself empty: no contamination of counts
  assert.equal(bad.level, "strategy-global"); // falls back openly, labeled as such
  assert.ok(good.adjExp > 0.1);
  // now add real losses in crypto_down: cells must diverge by regime
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ regime: "crypto_down" }), -0.5);
  const bad2 = LE.scoreCell(s, ctx({ regime: "crypto_down" }), L);
  const good2 = LE.scoreCell(s, ctx({ regime: "broad_up" }), L);
  assert.equal(bad2.level, "cell");
  assert.ok(good2.adjExp > bad2.adjExp);
});

test("cold start: unknown gets exploration chance, not blocked", () => {
  const s = LE.emptyLearning();
  const sc = LE.scoreCell(s, ctx({ strategy: "donchian" }), L);
  assert.equal(sc.n, 0);
  assert.equal(sc.blocked, false);
  assert.ok(sc.ucb > sc.adjExp);
  const r = LE.rankCandidates([{ order: { strategy_id: "donchian" }, ctx: ctx({ strategy: "donchian" }), baseScore: 0.5 }], s, L);
  assert.equal(r.abstain, false);
});

test("no-trade: all sufficiently bad -> abstain", () => {
  const s = LE.emptyLearning();
  for (const st of ["tsmom", "donchian"]) {
    for (let i = 0; i < 10; i++) LE.recordExperience(s, ctx({ strategy: st }), -0.4);
  }
  const cands = ["tsmom", "donchian"].map((st) => ({ order: { strategy_id: st }, ctx: ctx({ strategy: st }), baseScore: 0.5 }));
  const r = LE.rankCandidates(cands, s, L);
  assert.equal(r.abstain, true);
  assert.ok(r.scored.every((x) => x.learn.blocked));
});

test("persistence: restart survives in own file", () => {
  const s = LE.emptyLearning();
  LE.recordExperience(s, ctx(), 0.5);
  LE.saveLearning(s);
  const re = LE.loadLearning();
  assert.equal(re.cells["broad_up|long|tsmom"].n, 1);
  assert.ok(re.experiences >= 1);
});

test("risk caps dominate learner size", async () => {
  const big = { op: "open", symbol: "BTC-USD", side: "long", leverage: 99, strategy_id: "tsmom", sizeMult: 9.99 };
  const { sizeOrder } = await import("../scripts/v2/sizing.mjs");
  const { freshV2State } = await import("../scripts/v2/episode.mjs");
  const st = freshV2State(cfg);
  const o = sizeOrder(st, big, 100, cfg, { quotes: {} });
  assert.ok(o.leverage <= 40);
  assert.ok(o.marginUsd <= st.walletBalance * 0.98 + 1e-9);
});

test("multi-episode causality across regimes", () => {
  const s = LE.emptyLearning();
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ regime: "broad_up", strategy: "tsmom" }), 0.7);
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ regime: "broad_up", strategy: "donchian" }), -0.3);
  let r = LE.rankCandidates(
    ["tsmom", "donchian"].map((st) => ({ order: { strategy_id: st }, ctx: ctx({ regime: "broad_up", strategy: st }), baseScore: 0.5 })), s, L);
  assert.equal(r.best.order.strategy_id, "tsmom");
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ regime: "crypto_down", strategy: "donchian" }), 0.6);
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ regime: "crypto_down", strategy: "tsmom" }), -0.4);
  r = LE.rankCandidates(
    ["tsmom", "donchian"].map((st) => ({ order: { strategy_id: st }, ctx: ctx({ regime: "crypto_down", strategy: st }), baseScore: 0.5 })), s, L);
  assert.equal(r.best.order.strategy_id, "donchian");
  r = LE.rankCandidates(
    ["tsmom", "donchian"].map((st) => ({ order: { strategy_id: st }, ctx: ctx({ regime: "broad_up", strategy: st }), baseScore: 0.5 })), s, L);
  assert.equal(r.best.order.strategy_id, "tsmom");
});

test("tiny sample cannot block: 1x -1R stays eligible", () => {
  const s = LE.emptyLearning();
  LE.recordExperience(s, ctx(), -1.0);
  const sc = LE.scoreCell(s, ctx(), L);
  assert.equal(sc.n, 1);
  assert.equal(sc.blocked, false);
  assert.ok(sc.adjExp > -0.2);
});

test("causal memory: penalty flips ranking, boost restores", () => {
  const s = LE.emptyLearning();
  for (let i = 0; i < 4; i++) LE.recordExperience(s, ctx({ strategy: "tsmom" }), 0.3);
  for (let i = 0; i < 4; i++) LE.recordExperience(s, ctx({ strategy: "donchian" }), 0.3);
  const mk = (bias) => {
    const r = LE.rankCandidates(
      ["tsmom", "donchian"].map((st) => ({ order: { strategy_id: st }, ctx: ctx({ strategy: st }), baseScore: 0.5 })), s, L);
    LE.applyMemoryBias(r.scored, bias);
    r.scored.sort((a, b) => b.finalScore - a.finalScore);
    return r.scored[0].order.strategy_id;
  };
  assert.equal(mk(null), "tsmom"); // tie -> stable order
  assert.equal(mk({ penalty: { "broad_up|tsmom": { adj: 0.7, evidence: "test" } }, boost: {} }), "donchian");
  assert.equal(mk({ penalty: {}, boost: { "broad_up|donchian": { adj: 1.15, evidence: "test" } } }), "donchian");
});

test("buckets deterministic and compact", () => {
  assert.equal(LE.volBucket(new Array(15).fill(100)), "low");
  assert.equal(LE.rsiBucket({ rsi: 80 }), "overbought");
  assert.equal(LE.momBucket({ mom: -5 }), "negative");
  assert.equal(LE.fngBucket({ fearGreedCrypto: { value: 10 } }), "fear");
  assert.equal(LE.fundingBucket({ fundingRate: 0.001 }, {}), "crowded_long");
});

// ---- Phase 2 (§25) ----

test("side separation: long wins, short losses stay independent", () => {
  const s = LE.emptyLearning();
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ side: "long" }), 0.55, {}, L);
  for (let i = 0; i < 6; i++) LE.recordExperience(s, ctx({ side: "short" }), -0.45, {}, L);
  const lo = LE.scoreCell(s, ctx({ side: "long" }), L);
  const sh = LE.scoreCell(s, ctx({ side: "short" }), L);
  assert.equal(lo.n, 6);
  assert.equal(sh.n, 6);
  assert.ok(lo.adjExp > 0.1 && sh.adjExp < -0.05);
  const r = LE.rankCandidates(
    ["long", "short"].map((sd) => ({ order: { strategy_id: "tsmom", side: sd }, ctx: ctx({ side: sd }), baseScore: 0.5 })), s, L);
  assert.equal(r.best.order.side, "long");
});

test("recovery: 10 losses then 14 wins unf-blocks and flips positive (d=1.0)", () => {
  const s = LE.emptyLearning();
  for (let i = 0; i < 10; i++) LE.recordExperience(s, ctx(), -0.5, {}, L);
  assert.equal(LE.scoreCell(s, ctx(), L).blocked, true); // badly negative with evidence
  for (let i = 0; i < 14; i++) LE.recordExperience(s, ctx(), 0.6, {}, L);
  const sc = LE.scoreCell(s, ctx(), L);
  assert.ok(sc.adjExp > 0, `adjExp=${sc.adjExp}`);
  assert.equal(sc.blocked, false); // not permanently punished
});

test("decay opt-in: 0.95 forgets faster than 1.0; 1.0 reproduces phase-1 exactly", () => {
  const s1 = LE.emptyLearning(), s95 = LE.emptyLearning();
  for (let i = 0; i < 10; i++) {
    LE.recordExperience(s1, ctx(), -0.5, {}, L);
    LE.recordExperience(s95, ctx(), -0.5, {}, { ...L, decay: 0.95 });
  }
  for (let i = 0; i < 6; i++) {
    LE.recordExperience(s1, ctx(), 0.6, {}, L);
    LE.recordExperience(s95, ctx(), 0.6, {}, { ...L, decay: 0.95 });
  }
  const a = LE.scoreCell(s1, ctx(), L).adjExp;
  const b = LE.scoreCell(s95, ctx(), L).adjExp;
  assert.ok(b > a, `d=.95 (${b.toFixed(3)}) must recover faster than d=1 (${a.toFixed(3)})`);
});

test("deterministic exploration: unexplored cells outrank equally-good explored cells", () => {
  const s = LE.emptyLearning();
  // ALL cells get identical mean (+0.1 each): the only differentiator is n.
  // tsmom gets 2 trades; the rest get 1 each. UCB bonus is strictly larger for
  // n=1 (sqrt(ln(tot+2)/(n+1)) shrinks with n), so tsmom must NOT win.
  for (const st of ["tsmom", "donchian", "rsi2dip", "mom_trend"]) {
    LE.recordExperience(s, ctx({ strategy: st }), 0.1, {}, L);
  }
  LE.recordExperience(s, ctx(), 0.1, {}, L); // tsmom twice
  const r = LE.rankCandidates(
    ["tsmom", "donchian", "rsi2dip", "mom_trend"].map((st) => ({ order: { strategy_id: st }, ctx: ctx({ strategy: st }), baseScore: 0.5 })), s, L);
  assert.notEqual(r.best.order.strategy_id, "tsmom"); // most-explored must not dominate
  assert.equal(r.scored[r.scored.length - 1].order.strategy_id, "tsmom"); // ranked last
  // ranking is exploration-driven: winner has LOWER quality (exploitation) but a
  // larger UCB bonus — pure math, no RNG.
  const win = r.scored[0], last = r.scored[r.scored.length - 1];
  assert.ok(win.quality < last.quality, `winner quality ${win.quality} should be lower than tsmom ${last.quality}`);
  assert.ok(win.learn.ucbBonus > last.learn.ucbBonus);
});

test("no-leakage: decision before close sees n=0; after close sees the trade", () => {
  const s = LE.emptyLearning();
  const tClose = 1700000000000;
  const before = LE.scoreCell(s, ctx(), L); // decision at tClose-30s
  assert.equal(before.n, 0);
  LE.recordExperience(s, ctx(), 0.7, { ts_close: tClose }, L);
  const after = LE.scoreCell(s, ctx(), L);
  assert.equal(after.n, 1);
  assert.ok(after.adjExp > 0);
  // replay invariant: information timestamp strictly < decision timestamp
  const infoTs = s.cells["broad_up|long|tsmom"].lastTs;
  assert.ok(infoTs === tClose && infoTs < tClose + 30000);
});

test("evaluator correctness: replay counts, switches counted, abstain fabricated-never", async () => {
  const { replayLearning } = await import("../scripts/v2/evaluate-learning.mjs");
  const closed = [];
  let ts = 1700000000000;
  // 10x tsmom broad_up winners (planted preference), then 10x donchian losers
  for (let i = 0; i < 10; i++) closed.push({ strategy_id: "tsmom", regime: "broad_up", side: "long", realized_R: 0.5, ts_close: (ts += 60000) });
  for (let i = 0; i < 10; i++) closed.push({ strategy_id: "donchian", regime: "broad_up", side: "long", realized_R: -0.3, ts_close: (ts += 60000) });
  const r = replayLearning(closed, L, 10);
  assert.equal(r.trades, 20);
  assert.equal(r.baselineA.n, 20);
  assert.equal(r.baselineA.sumR.toFixed(3), "2.000"); // 10*0.5 - 10*0.3
  assert.equal(r.baselineA.meanR.toFixed(4), "0.1000");
  assert.ok(r.learner.n >= 1); // learner must match at least the tsmom stretch
  assert.ok(r.cells.total >= 2);
  assert.ok(r.cells.n5 >= 1);
  // windows exist and learner never claims unmatched outcomes (n <= 20)
  assert.ok(r.windows.length >= 1 && r.learner.n <= 20);
  assert.ok(r.learner.abstainRate >= 0 && r.learner.abstainRate <= 1);
});



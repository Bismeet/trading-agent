// tests/agents.test.mjs — multi-agent council (analyst/risk/investor) veto logic.
// Isolated via FAB_DATA so the live deliberation log is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-agents-"));
const { analystDecide, riskDecide, investorDecide, agentCouncil } = await import("../scripts/v2/agents.mjs");
const { freshV2State } = await import("../scripts/v2/episode.mjs");
const { loadConfig } = await import("../scripts/v2/store.mjs");
const cfg = loadConfig();

const baseIntent = (over = {}) => ({
  symbol: "BTC-USD", side: "long", market: "crypto", strategy_id: "tsmom",
  confidence: 0.6, leverage: 12, reason: "test", ...over,
});
const mkState = (over = {}) => ({ ...freshV2State(cfg), ...over });

test("analyst approves longs in broad_up regime", () => {
  const s = mkState({ regime: "broad_up" });
  const v = analystDecide(baseIntent(), s, null);
  assert.equal(v.vote, "approve");
});

test("analyst vetoes crypto longs when regime is crypto_down", () => {
  const s = mkState({ regime: "crypto_down" });
  const v = analystDecide(baseIntent(), s, null);
  assert.equal(v.vote, "veto");
  assert.ok(v.reasons[0].includes("crypto_down"));
});

test("analyst vetoes US equity longs under us_down; context adjusts confidence", () => {
  const s = mkState({ regime: "us_down" });
  const v = analystDecide(baseIntent({ symbol: "AAPL", market: "us" }), s, null);
  assert.equal(v.vote, "veto");
  // extreme fear boosts long confidence in crypto
  const sUp = mkState({ regime: "broad_up" });
  const v2 = analystDecide(baseIntent(), sUp, { fearGreedCrypto: { value: 8 } });
  assert.equal(v2.confidenceAdj, 0.05);
  // extreme greed penalizes
  const v3 = analystDecide(baseIntent(), sUp, { fearGreedCrypto: { value: 95 } });
  assert.equal(v3.confidenceAdj, -0.05);
});

test("risk vetoes on position cap, correlation cluster, or deep drawdown", () => {
  const sFull = mkState({ positions: { a: {}, b: {}, c: {}, d: {}, e: {}, f: {}, g: {}, h: {}, i: {}, j: {} } });
  assert.equal(riskDecide(baseIntent(), sFull, cfg, 0).vote, "veto");
  // crypto long cluster: 4 existing same-side longs + intent -> veto
  const sCluster = mkState({
    positions: {
      a: { market: "crypto", side: "long" }, b: { market: "crypto", side: "long" },
      c: { market: "crypto", side: "long" }, d: { market: "crypto", side: "long" },
    },
  });
  assert.equal(riskDecide(baseIntent(), sCluster, cfg, 0).vote, "veto");
  // 3 existing + 1 pending long = 4 cluster -> veto (pending counts toward the cap)
  const sCluster2 = mkState({
    positions: {
      a: { market: "crypto", side: "long" }, b: { market: "crypto", side: "long" },
      c: { market: "crypto", side: "long" },
    },
  });
  assert.equal(riskDecide(baseIntent(), sCluster2, cfg, 1).vote, "veto"); // 3 existing + 1 pending
  // 2 existing + no pending = within cap
  const sCluster3 = mkState({
    positions: { a: { market: "crypto", side: "long" }, b: { market: "crypto", side: "long" } },
  });
  assert.equal(riskDecide(baseIntent(), sCluster3, cfg, 0).vote, "approve");
  // drawdown brake
  const sDD = mkState({ maxDrawdownPct: 12 });
  assert.equal(riskDecide(baseIntent(), sDD, cfg, 0).vote, "veto");
});

test("investor vetoes on missing/stale quote or tiny wallet", () => {
  const s = mkState();
  assert.equal(investorDecide(baseIntent(), s, null).vote, "veto");
  assert.equal(investorDecide(baseIntent(), s, { ok: true, stale: true }).vote, "veto");
  assert.equal(investorDecide(baseIntent(), s, { ok: true, stale: false, priceUsd: 100 }).vote, "approve");
  const poor = mkState({ walletBalance: 1 });
  assert.equal(investorDecide(baseIntent(), poor, { ok: true, stale: false, priceUsd: 100 }).vote, "veto");
});

test("agentCouncil filters intents and exposes verdict reasons", () => {
  const s = mkState({ regime: "crypto_down" });
  const intents = [baseIntent({ symbol: "BTC-USD" }), baseIntent({ symbol: "ETH-USD" })];
  const { approved, rejected, log } = agentCouncil(intents, s, cfg, null, {
    "BTC-USD": { ok: true, stale: false, priceUsd: 100 },
    "ETH-USD": { ok: true, stale: false, priceUsd: 100 },
  });
  assert.equal(approved.length, 0);
  assert.equal(rejected.length, 2);
  assert.ok(log.every((e) => e.verdicts.length >= 1));
});

test("agentCouncil approval path applies confidence adjustments", () => {
  const s = mkState({ regime: "broad_up" });
  const intents = [baseIntent({ confidence: 0.6 })];
  const { approved } = agentCouncil(intents, s, cfg, { fearGreedCrypto: { value: 8 } }, {
    "BTC-USD": { ok: true, stale: false, priceUsd: 100 },
  });
  assert.equal(approved.length, 1);
  assert.equal(approved[0].confidence, 0.65); // 0.6 + analyst +0.05
});
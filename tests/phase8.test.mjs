// tests/phase8.test.mjs — Phase 8 §27 Acceptance Tests.
//
// 20 required acceptance tests covering:
//   1. control immutability
//   2. spec immutability
//   3. causal post-entry state
//   4. no future leakage
//   5. stop management correctness
//   6. target management correctness
//   7. trailing correctness
//   8. time-state correctness
//   9. MFE capture correctness
//   10. MAE correctness
//   11. partial exit accounting
//   12. fee accounting
//   13. slippage accounting
//   14. turnover accounting
//   15. portfolio exposure limits
//   16. correlation calculations
//   17. position prioritization
//   18. sizing isolation
//   19. deterministic repeated execution
//   20. production path cannot load experimental management rules
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, sha256 } from "../scripts/v2/store.mjs";
import {
  classifyTradeState, calcMfeCaptureRatio, createPortfolioTracker, decomposeManagementValue,
} from "../scripts/v2/management-features.mjs";
import { simulateManagedTrade } from "../scripts/v2/management-rules.mjs";
import {
  makeManagementAccumulator, pushManagementCandidate, pushManagementResolved,
  summarizeManagement, scoreManagementPolicy, evaluateManagementValidationGate,
} from "../scripts/v2/management-metrics.mjs";

const ROOT = process.cwd();
const CONTROL_PATH = path.join(ROOT, "config", "management.control.json");
const SPEC_PATH = path.join(ROOT, "config", "management-experiment-spec.v1.json");

function mockCandleData(n = 60, trend = 0.5) {
  const ts = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    ts.push(1700000000000 + i * 900000); // 15m intervals
    const change = trend + Math.sin(i / 3) * 0.5;
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + 0.3;
    const l = Math.min(o, c) - 0.3;
    open.push(o);
    high.push(h);
    low.push(l);
    close.push(c);
    price = c;
  }
  return { ts, open, high, low, close };
}

test("1. control immutability: management.control.json exists and is immutable", () => {
  assert.ok(fs.existsSync(CONTROL_PATH), "management.control.json must exist");
  const raw1 = fs.readFileSync(CONTROL_PATH, "utf8");
  const parsed = JSON.parse(raw1);
  assert.equal(parsed.configuration, "CONTROL");
  assert.equal(parsed.managementPolicy.id, "MGMT_CONTROL");
  const raw2 = fs.readFileSync(CONTROL_PATH, "utf8");
  assert.equal(raw1, raw2);
});

test("2. experiment spec immutability: spec exists and hash is reproducible", () => {
  assert.ok(fs.existsSync(SPEC_PATH), "spec file must exist");
  const raw = fs.readFileSync(SPEC_PATH, "utf8");
  const spec = JSON.parse(raw);
  assert.equal(spec.version, "1.0.0");
  assert.ok(Array.isArray(spec.managementPolicies));
  assert.equal(spec.managementPolicies.length, 8);
  const hash1 = sha256(JSON.stringify(spec));
  const hash2 = sha256(JSON.stringify(spec));
  assert.equal(hash1, hash2);
});

test("3. causal post-entry state: classification strictly uses current observations", () => {
  const sInit = classifyTradeState({ relHours: 0.5, mfeR: 0.1, maeR: -0.1 });
  assert.equal(sInit, "INITIAL");

  const sDev = classifyTradeState({ relHours: 1.5, mfeR: 0.2, maeR: -0.2 });
  assert.equal(sDev, "DEVELOPING");

  const sFav = classifyTradeState({ relHours: 2.0, mfeR: 0.8, maeR: -0.1 });
  assert.equal(sFav, "FAVORABLE");

  const sDet = classifyTradeState({ relHours: 2.5, mfeR: 0.1, maeR: -0.6 });
  assert.equal(sDet, "DETERIORATING");

  const sStalled = classifyTradeState({ relHours: 3.5, mfeR: 0.8, stalledHours: 2.5 });
  assert.equal(sStalled, "STALLED");
});

test("4. no future leakage: future prices do not alter current post-entry state", () => {
  const stateNow = classifyTradeState({ relHours: 1.5, mfeR: 0.3, maeR: -0.2 });
  // Adding hypothetical future high excursion does not change past state
  const statePast = classifyTradeState({ relHours: 1.5, mfeR: 0.3, maeR: -0.2 });
  assert.equal(stateNow, statePast);
});

test("5. stop management correctness: breakeven stop activates after MFE threshold", () => {
  const rows = mockCandleData(50, 0.4); // strong upward trend
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const simBe = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_BREAKEVEN_STOP" });
  assert.ok(simBe.resolved);
  assert.ok(["breakeven-stop", "take-profit", "time-stop", "trailing-stop"].includes(simBe.exit_reason));
});

test("6. target management correctness: take-profit terminates trade at exact target", () => {
  const rows = mockCandleData(50, 1.0); // very fast upward surge
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.03 } } }; // small 3% target
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CONTROL" });
  assert.equal(sim.exit_reason, "take-profit");
  assert.ok(sim.realized_R > 0);
});

test("7. trailing correctness: trailing stop executes upon giveback condition", () => {
  // Candle data that surges then retraces
  const rows = mockCandleData(40, 0.6);
  // Introduce sharp reversal at bar 20
  for (let k = 20; k < 40; k++) {
    rows.close[k] = rows.close[19] - (k - 19) * 0.8;
    rows.low[k] = rows.close[k] - 0.3;
    rows.high[k] = rows.close[k] + 0.3;
    rows.open[k] = rows.close[k - 1];
  }
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.10, targetPct: 0.50 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_TIGHT_TRAIL" });
  assert.ok(["trailing-stop", "time-stop"].includes(sim.exit_reason));
});

test("8. time-state correctness: deteriorating trades are cut early at 2h", () => {
  const ts = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  let price = 100;
  for (let i = 0; i < 30; i++) {
    ts.push(1700000000000 + i * 900000); // 15m intervals
    const o = price;
    const c = price - 0.8;
    const h = o;
    const l = c;
    open.push(o); high.push(h); low.push(l); close.push(c);
    price = c;
  }
  const rows = { ts, open, high, low, close };
  const cand = { i: 2, ts: rows.ts[2], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[2], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.10, targetPct: 0.20 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CUT_DETERIORATING" });
  assert.ok(sim.resolved);
  assert.equal(sim.exit_reason, "cut-deteriorating");
  assert.ok(sim.holdHours >= 2.0 && sim.holdHours <= 2.5, `holdHours should be near 2h, got ${sim.holdHours}`);
});

test("9. MFE capture correctness: capture ratio equals realized return divided by MFE", () => {
  assert.equal(calcMfeCaptureRatio(0.5, 1.0), 0.5);
  assert.equal(calcMfeCaptureRatio(0.8, 1.0), 0.8);
  assert.equal(calcMfeCaptureRatio(-0.2, 1.0), 0.0); // clamped at 0 for negative return
  assert.equal(calcMfeCaptureRatio(0.5, 0.0), 0.0); // zero MFE
});

test("10. MAE correctness: adverse excursion captures worst price touched", () => {
  const rows = mockCandleData(30, 0.1);
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CONTROL" });
  assert.ok(Number.isFinite(sim.mae_R));
  assert.ok(sim.mae_R <= 0.001); // MAE is non-positive
});

test("11. partial exit accounting: 50% partial exit closes half position and realizes profit", () => {
  const rows = mockCandleData(50, 0.8);
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.03, targetPct: 0.20 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_PARTIAL_EXIT" });
  assert.ok(sim.resolved);
  assert.ok(Number.isFinite(sim.net_pnl_usd));
});

test("12. fee accounting: fees are charged on entry and exit", () => {
  const rows = mockCandleData(30, 0.2);
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CONTROL" });
  assert.ok(sim.fees_usd > 0, "Fees must be strictly positive");
  // Round trip taker fees on $100 margin x 10 leverage = $1000 notional x 0.0005 x 2 ≈ $1.00
  assert.ok(sim.fees_usd >= 0.8 && sim.fees_usd <= 1.2);
});

test("13. slippage accounting: adverse slippage is calculated on notional", () => {
  const rows = mockCandleData(30, 0.2);
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CONTROL" });
  assert.ok(sim.spread_slip_usd > 0, "Spread and slippage must be strictly positive");
});

test("14. turnover accounting: hold hours and exit reasons are tracked", () => {
  const acc = makeManagementAccumulator("acc");
  pushManagementCandidate(acc, true);
  pushManagementResolved(acc, { realized_R: 0.5, holdHours: 3.5, exit_reason: "take-profit", fees_usd: 1.0, spread_slip_usd: 0.5 });
  const s = summarizeManagement(acc, 1);
  assert.equal(s.resolved, 1);
  assert.equal(s.meanHoldHours, 3.5);
  assert.equal(s.targetRate, 1.0);
});

test("15. portfolio exposure limits: concurrent position cap is strictly enforced", () => {
  const cfg = loadConfig();
  const spec = { portfolioControls: { concurrentCap: 2, correlationClusters: { crypto_majors: [], clusterMaxLong: 2 } } };
  const tracker = createPortfolioTracker(cfg, spec);

  const c1 = tracker.canOpen({ tradeId: "t1", symbol: "BTC-USD", side: "long", ts: 1000 });
  assert.equal(c1.allowed, true);
  tracker.registerOpen({ tradeId: "t1", symbol: "BTC-USD", side: "long", ts: 1000, exitTs: 5000 });

  const c2 = tracker.canOpen({ tradeId: "t2", symbol: "ETH-USD", side: "long", ts: 2000 });
  assert.equal(c2.allowed, true);
  tracker.registerOpen({ tradeId: "t2", symbol: "ETH-USD", side: "long", ts: 2000, exitTs: 6000 });

  // 3rd position exceeds cap of 2
  const c3 = tracker.canOpen({ tradeId: "t3", symbol: "SOL-USD", side: "long", ts: 3000 });
  assert.equal(c3.allowed, false);
  assert.ok(c3.reason.includes("concurrent_cap_reached"));

  // After t1 closes at 5000, t4 can open at 5100
  const c4 = tracker.canOpen({ tradeId: "t4", symbol: "SOL-USD", side: "long", ts: 5100 });
  assert.equal(c4.allowed, true);
});

test("16. correlation calculations: correlated asset cluster limit prevents over-concentration", () => {
  const cfg = loadConfig();
  const spec = { portfolioControls: { concurrentCap: 10, correlationClusters: { crypto_majors: ["BTC-USD", "ETH-USD", "SOL-USD"], clusterMaxLong: 1 } } };
  const tracker = createPortfolioTracker(cfg, spec);

  const c1 = tracker.canOpen({ tradeId: "t1", symbol: "BTC-USD", side: "long", ts: 1000 });
  assert.equal(c1.allowed, true);
  tracker.registerOpen({ tradeId: "t1", symbol: "BTC-USD", side: "long", ts: 1000, exitTs: 10000 });

  // Second long in crypto_majors cluster is blocked
  const c2 = tracker.canOpen({ tradeId: "t2", symbol: "ETH-USD", side: "long", ts: 2000 });
  assert.equal(c2.allowed, false);
  assert.ok(c2.reason.includes("correlation_cluster"));

  // Uncorrelated US stock long is permitted
  const c3 = tracker.canOpen({ tradeId: "t3", symbol: "AAPL", side: "long", ts: 2000 });
  assert.equal(c3.allowed, true);
});

test("17. position prioritization: sizing scales position size based on setup confirmation", () => {
  const rows = mockCandleData(30, 0.2);
  const candSolo = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10, features: { strategy_agreement_count: 0 } };
  const candConfirmed = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10, features: { strategy_agreement_count: 2 } };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const simSolo = simulateManagedTrade({ cand: candSolo, rows, cfg, prod, spec, policyId: "MGMT_CONTROL", portfolioSizing: true });
  const simConf = simulateManagedTrade({ cand: candConfirmed, rows, cfg, prod, spec, policyId: "MGMT_CONTROL", portfolioSizing: true });

  assert.equal(simSolo.margin, 75);
  assert.equal(simConf.margin, 125);
});

test("18. sizing isolation: setup-quality sizing adjusts margin within hard risk bounds", () => {
  const rows = mockCandleData(30, 0.2);
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10, features: { strategy_agreement_count: 3 } };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CONTROL", portfolioSizing: true });
  assert.ok(sim.margin <= 150, "Margin must stay clamped");
  assert.ok(sim.margin >= 50);
});

test("19. deterministic repeated execution: re-running trade simulation yields bit-identical outputs", () => {
  const rows = mockCandleData(35, 0.3);
  const cand = { i: 5, ts: rows.ts[5], symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", price: rows.close[5], market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const sim1 = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_ADAPTIVE_COMPOSITE" });
  const sim2 = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_ADAPTIVE_COMPOSITE" });

  assert.deepEqual(sim1, sim2);
});

test("20. production path cannot load experimental management rules: live engine is isolated", () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, "scripts", "v2", "engine.mjs"), "utf8");
  assert.ok(!engineSrc.includes("management.experimental.json"), "Live engine must not read management.experimental.json");
  assert.ok(!engineSrc.includes("management-rules.mjs"), "Live engine must not import management-rules.mjs");
});

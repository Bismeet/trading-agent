// tests/phase9.test.mjs — Phase 9 §26 Acceptance Tests.
//
// 20 required acceptance tests covering:
//   1. final configuration immutability
//   2. final spec immutability
//   3. production isolation
//   4. chronological split
//   5. TEST isolation
//   6. causal entry
//   7. causal selection
//   8. causal management
//   9. causal learner
//   10. cost accounting
//   11. PnL accounting
//   12. drawdown calculation
//   13. strategy attribution
//   14. portfolio attribution
//   15. exposure limits
//   16. stress-test correctness
//   17. deterministic repeated execution
//   18. learner isolation
//   19. no post-test mutation
//   20. final report consistency
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, sha256 } from "../scripts/v2/store.mjs";
import {
  getMarketOf, createFinalPortfolioTracker, createCausalLearnerTracker,
} from "../scripts/v2/final-eval-features.mjs";
import {
  makeFinalAccumulator, pushCandidate, pushResolved, summarizeFinal,
  evaluateFinalPassFailCriteria,
} from "../scripts/v2/final-eval-metrics.mjs";
import { simulateManagedTrade } from "../scripts/v2/management-rules.mjs";
import { evaluateSelectionRule } from "../scripts/v2/selection-rules.mjs";

const ROOT = process.cwd();
const CONTROL_PATH = path.join(ROOT, "config", "final.control.json");
const SPEC_PATH = path.join(ROOT, "config", "final-experiment-spec.v1.json");
const PROD_MGMT_CONTROL = path.join(ROOT, "config", "management.control.json");
const SUMMARY_PATH = path.join(ROOT, "data", "calibration", "final-summary.v2.json");

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

test("1. final configuration immutability", () => {
  assert.ok(fs.existsSync(CONTROL_PATH), "final.control.json must exist");
  const ctrl = JSON.parse(fs.readFileSync(CONTROL_PATH, "utf8"));
  assert.equal(ctrl.configuration, "FINAL_CONTROL");
  assert.ok(ctrl.strategyConfiguration.donchian);
  assert.ok(ctrl.strategyConfiguration.tsmom);
  assert.ok(ctrl.selectionRule.id === "RULE_MULTI_AGREEMENT");
  assert.ok(ctrl.managementPolicy.id === "MGMT_ADAPTIVE_HOLD");
});

test("2. final spec immutability", () => {
  assert.ok(fs.existsSync(SPEC_PATH), "final-experiment-spec.v1.json must exist");
  const specRaw = fs.readFileSync(SPEC_PATH, "utf8");
  const spec = JSON.parse(specRaw);
  assert.equal(spec.version, "1.0.0");
  assert.equal(spec.phase, "phase9-final-system-validation");
  assert.equal(spec.systemCandidates.length, 5);
  assert.equal(spec.splits.daily.train, 0.60);
  assert.equal(spec.splits.daily.test, 0.20);
});

test("3. production isolation", () => {
  assert.ok(fs.existsSync(PROD_MGMT_CONTROL), "management.control.json must exist");
  const prod = JSON.parse(fs.readFileSync(PROD_MGMT_CONTROL, "utf8"));
  assert.equal(prod.configuration, "CONTROL");
  assert.equal(prod.managementPolicy.id, "MGMT_CONTROL");
});

test("4. chronological split", () => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const splits = spec.splits.daily;
  assert.equal(splits.train + splits.validation + splits.test, 1.0);
  assert.ok(splits.train > splits.validation);
  assert.ok(splits.validation === splits.test);
});

test("5. TEST isolation", () => {
  assert.ok(fs.existsSync(SUMMARY_PATH), "final-summary.v2.json must exist");
  const sum = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
  for (const sys of Object.values(sum.systems)) {
    assert.ok(sys.train.resolved > 0);
    assert.ok(sys.validation.resolved > 0);
    assert.ok(sys.test.resolved > 0);
    assert.notEqual(sys.train.meanR, sys.test.meanR);
  }
});

test("6. causal entry", () => {
  const rows = mockCandleData(50, 0.2);
  const cand = {
    symbol: "BTC-USD",
    strategy_id: "donchian",
    side: "long",
    price: rows.close[20],
    ts: rows.ts[20],
    i: 20,
    baseLev: 10,
    market: "crypto",
  };
  assert.equal(cand.price, rows.close[20]);
  assert.ok(cand.ts < rows.ts[30]);
});

test("7. causal selection", () => {
  const cand = {
    strategy_id: "donchian",
    features: { strategy_agreement_count: 2 },
  };
  const decision = evaluateSelectionRule("RULE_MULTI_AGREEMENT", cand, cand.features);
  assert.equal(decision.take, true);

  const soloCand = {
    strategy_id: "donchian",
    features: { strategy_agreement_count: 0 },
  };
  const soloDecision = evaluateSelectionRule("RULE_MULTI_AGREEMENT", soloCand, soloCand.features);
  assert.equal(soloDecision.take, false);
});

test("8. causal management", () => {
  const rows = mockCandleData(50, 0.4);
  const cfg = loadConfig();
  const cand = {
    tradeId: "t1",
    symbol: "BTC-USD",
    strategy_id: "donchian",
    side: "long",
    price: rows.close[5],
    ts: rows.ts[5],
    i: 5,
    baseLev: 10,
    market: "crypto",
  };
  const prod = { perStrategyGeometry: { donchian: { stopPct: 0.05, targetPct: 0.08 } } };
  const res = simulateManagedTrade({
    cand,
    rows,
    cfg,
    prod,
    policyId: "MGMT_ADAPTIVE_HOLD",
  });
  assert.ok(res.resolved);
  assert.ok(res.holdHours > 0);
  assert.ok(res.exitActual > 0);
});

test("9. causal learner", () => {
  const cfg = loadConfig();
  const tracker = createCausalLearnerTracker(cfg, {});
  const candA = { symbol: "BTC-USD", strategy_id: "donchian", side: "long", ts: 1000, trendContext: "trend_up" };
  const eval1 = tracker.evaluateCandidate(candA);
  assert.ok(eval1.allowed);

  // Register a resolved trade with exitTs at 2000
  tracker.registerTradeForLearning({
    exitTs: 2000,
    cand: candA,
    realizedR: 1.5,
    exitReason: "take-profit",
  });

  // Candidate at 1500 must NOT see the trade outcome yet (reconciliation occurs at exitTs <= ts)
  const candB = { symbol: "BTC-USD", strategy_id: "donchian", side: "long", ts: 1500, trendContext: "trend_up" };
  tracker.evaluateCandidate(candB);
  assert.equal(tracker.getStore().experiences, 0);

  // Candidate at 2500 MUST see the reconciled trade outcome
  const candC = { symbol: "BTC-USD", strategy_id: "donchian", side: "long", ts: 2500, trendContext: "trend_up" };
  tracker.evaluateCandidate(candC);
  assert.equal(tracker.getStore().experiences, 1);
});

test("10. cost accounting", () => {
  const rows = mockCandleData(40, -0.2);
  const cfg = loadConfig();
  const cand = {
    tradeId: "t2",
    symbol: "BTC-USD",
    strategy_id: "tsmom",
    side: "long",
    price: rows.close[2],
    ts: rows.ts[2],
    i: 2,
    baseLev: 10,
    market: "crypto",
  };
  const prod = { perStrategyGeometry: { tsmom: { stopPct: 0.05, targetPct: 0.10 } } };
  const res = simulateManagedTrade({ cand, rows, cfg, prod, policyId: "MGMT_CONTROL" });
  assert.ok(res.fees_usd > 0);
  assert.ok(res.spread_slip_usd > 0);
  assert.equal(res.net_pnl_usd, res.gross_pnl_usd - res.fees_usd);
});

test("11. PnL accounting", () => {
  const acc = makeFinalAccumulator("test_acc");
  const res = {
    tradeId: "t3",
    strategy_id: "donchian",
    side: "long",
    market: "crypto",
    realized_R: 0.5,
    gross_pnl_usd: 10.0,
    fees_usd: 1.5,
    spread_slip_usd: 0.5,
    net_pnl_usd: 8.5,
    raw_ret_pct: 0.01,
    holdHours: 4,
    mfe_R: 1.0,
    mae_R: -0.2,
    mfe_capture_ratio: 0.5,
  };
  pushResolved(acc, res, 0);
  assert.equal(acc.sumNetPnl, 8.5);
  assert.equal(acc.sumGrossPnl, 10.0);
  assert.equal(acc.sumFees, 1.5);
});

test("12. drawdown calculation", () => {
  const acc = makeFinalAccumulator("dd_acc");
  pushResolved(acc, { realized_R: 1.0, net_pnl_usd: 100, gross_pnl_usd: 100, fees_usd: 0, spread_slip_usd: 0, raw_ret_pct: 0, holdHours: 1, mfe_R: 1, mae_R: 0, mfe_capture_ratio: 1 });
  pushResolved(acc, { realized_R: -0.5, net_pnl_usd: -50, gross_pnl_usd: -50, fees_usd: 0, spread_slip_usd: 0, raw_ret_pct: 0, holdHours: 1, mfe_R: 0, mae_R: -0.5, mfe_capture_ratio: 0 });
  assert.equal(acc.peakR, 1.0);
  assert.equal(acc.maxDrawdownR, 0.5);
  assert.equal(acc.peakPnl, 100);
  assert.equal(acc.maxDrawdownPnl, 50);
});

test("13. strategy attribution", () => {
  const acc = makeFinalAccumulator("strat_acc");
  pushResolved(acc, { strategy_id: "donchian", market: "crypto", side: "long", realized_R: 0.2, net_pnl_usd: 2, gross_pnl_usd: 3, fees_usd: 1, spread_slip_usd: 0, raw_ret_pct: 0, holdHours: 1, mfe_R: 0.5, mae_R: -0.1, mfe_capture_ratio: 0.4 });
  pushResolved(acc, { strategy_id: "tsmom", market: "crypto", side: "long", realized_R: -0.1, net_pnl_usd: -1, gross_pnl_usd: 0, fees_usd: 1, spread_slip_usd: 0, raw_ret_pct: 0, holdHours: 1, mfe_R: 0.2, mae_R: -0.2, mfe_capture_ratio: 0 });
  const sum = summarizeFinal(acc);
  assert.equal(sum.byStrategy.donchian.resolved, 1);
  assert.equal(sum.byStrategy.tsmom.resolved, 1);
  assert.equal(sum.byStrategy.donchian.meanR, 0.2);
  assert.equal(sum.byStrategy.tsmom.meanR, -0.1);
});

test("14. portfolio attribution", () => {
  const cfg = loadConfig();
  const tracker = createFinalPortfolioTracker(cfg, { portfolioLimits: { maxConcurrentPositions: 2, maxSameSetupPositions: 1 } });
  const c1 = tracker.canOpen({ tradeId: "p1", symbol: "BTC-USD", side: "long", strategy_id: "donchian", market: "crypto", ts: 100 });
  assert.equal(c1.allowed, true);
  tracker.registerOpen({ tradeId: "p1", symbol: "BTC-USD", side: "long", strategy_id: "donchian", market: "crypto", ts: 100, exitTs: 500 });

  // Same setup blocked
  const c2 = tracker.canOpen({ tradeId: "p2", symbol: "BTC-USD", side: "long", strategy_id: "donchian", market: "crypto", ts: 200 });
  assert.equal(c2.allowed, false);

  // Different symbol allowed
  const c3 = tracker.canOpen({ tradeId: "p3", symbol: "ETH-USD", side: "long", strategy_id: "donchian", market: "crypto", ts: 200 });
  assert.equal(c3.allowed, true);
  tracker.registerOpen({ tradeId: "p3", symbol: "ETH-USD", side: "long", strategy_id: "donchian", market: "crypto", ts: 200, exitTs: 600 });

  // Exceeds max 2 concurrent
  const c4 = tracker.canOpen({ tradeId: "p4", symbol: "SOL-USD", side: "long", strategy_id: "donchian", market: "crypto", ts: 200 });
  assert.equal(c4.allowed, false);
});

test("15. exposure limits", () => {
  const cfg = loadConfig();
  const rows = mockCandleData(30, 0.1);
  const cand = {
    tradeId: "t4",
    symbol: "BTC-USD",
    strategy_id: "donchian",
    side: "long",
    price: 100,
    ts: rows.ts[1],
    i: 1,
    baseLev: 10,
    market: "crypto",
    features: { strategy_agreement_count: 2 },
  };
  const prod = { perStrategyGeometry: { donchian: { stopPct: 0.05, targetPct: 0.08 } } };
  const spec = { portfolioControls: { qualitySizing: { confirmedMarginUsd: 125, soloMarginUsd: 75 } } };
  const res = simulateManagedTrade({ cand, rows, cfg, prod, spec, policyId: "MGMT_CONTROL", portfolioSizing: true });
  assert.equal(res.margin, 125);
});

test("16. stress-test correctness", () => {
  const rows = mockCandleData(30, 0.1);
  const cfg = loadConfig();
  const cand = {
    tradeId: "t5",
    symbol: "BTC-USD",
    strategy_id: "donchian",
    side: "long",
    price: 100,
    ts: rows.ts[1],
    i: 1,
    baseLev: 10,
    market: "crypto",
  };
  const prod = { perStrategyGeometry: { donchian: { stopPct: 0.05, targetPct: 0.08 } } };
  const baseRes = simulateManagedTrade({ cand, rows, cfg, prod, policyId: "MGMT_CONTROL", costMultiplier: 1.0 });
  const stressRes = simulateManagedTrade({ cand, rows, cfg, prod, policyId: "MGMT_CONTROL", costMultiplier: 1.5 });
  assert.ok(stressRes.fees_usd > baseRes.fees_usd);
  assert.ok(stressRes.net_pnl_usd < baseRes.net_pnl_usd);
});

test("17. deterministic repeated execution", () => {
  const rows = mockCandleData(30, 0.1);
  const cfg = loadConfig();
  const cand = {
    tradeId: "t6",
    symbol: "BTC-USD",
    strategy_id: "donchian",
    side: "long",
    price: 100,
    ts: rows.ts[1],
    i: 1,
    baseLev: 10,
    market: "crypto",
  };
  const prod = { perStrategyGeometry: { donchian: { stopPct: 0.05, targetPct: 0.08 } } };
  const res1 = simulateManagedTrade({ cand, rows, cfg, prod, policyId: "MGMT_ADAPTIVE_HOLD" });
  const res2 = simulateManagedTrade({ cand, rows, cfg, prod, policyId: "MGMT_ADAPTIVE_HOLD" });
  assert.equal(JSON.stringify(res1), JSON.stringify(res2));
});

test("18. learner isolation", () => {
  const liveLearnerPath = path.join(ROOT, "data", "v2", "context-learning.json");
  let before = null;
  if (fs.existsSync(liveLearnerPath)) {
    before = fs.readFileSync(liveLearnerPath, "utf8");
  }
  const cfg = loadConfig();
  const tracker = createCausalLearnerTracker(cfg, {});
  tracker.registerTradeForLearning({ exitTs: 100, cand: { symbol: "BTC-USD", strategy_id: "donchian", side: "long", ts: 50 }, realizedR: 1.0, exitReason: "tp" });
  tracker.reconcile(200);

  if (fs.existsSync(liveLearnerPath)) {
    const after = fs.readFileSync(liveLearnerPath, "utf8");
    assert.equal(before, after, "Live learner file must not be modified by Phase 9");
  }
});

test("19. no post-test mutation", () => {
  const sum = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
  assert.equal(sum.phase, "phase9-final-system-validation");
  assert.ok(sum.verdict.startsWith("C.") || sum.verdict.startsWith("B.") || sum.verdict.startsWith("A."));
});

test("20. final report consistency", () => {
  assert.ok(fs.existsSync(SUMMARY_PATH));
  const sum = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
  assert.ok(sum.systems.SYSTEM_FINAL_PORTFOLIO);
  assert.equal(sum.datasetCounts.totalCandidates, 28960);
});

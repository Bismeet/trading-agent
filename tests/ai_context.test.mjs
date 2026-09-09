// tests/ai_context.test.mjs — Unit tests for FabRich context builder for Tauric AI.
import test from "node:test";
import assert from "node:assert/strict";
import {
  selectRelevantLessons,
  summarizeStrategyContext,
  summarizeRecentTrades,
  summarizePositions,
  summarizeWorldContext,
  summarizeRecentAiDecisions,
  buildFabrichContext,
} from "../scripts/v2/ai_context.mjs";

test("selectRelevantLessons: prioritizes strategy, symbol, regime and loss lessons", () => {
  const candidate = {
    symbol: "BTC-USD",
    side: "long",
    strategy_id: "tsmom",
    regime: "momentum",
  };

  const sampleLessons = [
    {
      id: "l1",
      title: "Irrelevant lesson",
      text: "Unrelated strategy lesson",
      regime: "choppy",
      importance: 3,
      kind: "note",
    },
    {
      id: "l2",
      title: "Direct BTC TSMOM Blowup",
      text: "Liquidation risk during high leverage tsmom breakout on BTC",
      regime: "momentum",
      importance: 9,
      kind: "blowup",
    },
    {
      id: "l3",
      title: "General TSMOM trend lesson",
      text: "Wait for 4h candle close before confirming momentum",
      importance: 6,
      kind: "loss",
    },
    {
      id: "l4",
      title: "BTC symbol note",
      text: "Funding spike usually precedes pullback on BTC",
      importance: 7,
      kind: "note",
    },
    {
      id: "l5",
      title: "TSMOM extra note",
      text: "Fifth lesson to test max cut",
      importance: 1,
      kind: "note",
    },
  ];

  const selected = selectRelevantLessons(candidate, sampleLessons, 3);
  assert.equal(selected.length, 3, "should respect maxLessons = 3");
  assert.equal(selected[0].id, "l2", "top lesson should be direct matching blowup");
});

test("selectRelevantLessons: handles empty or invalid inputs", () => {
  const candidate = { symbol: "BTC-USD", strategy_id: "tsmom" };
  assert.deepEqual(selectRelevantLessons(candidate, []), []);
  assert.deepEqual(selectRelevantLessons(candidate, null), []);
  assert.deepEqual(selectRelevantLessons(null, []), []);
});

test("summarizeStrategyContext: extracts metrics and handles missing strategies", () => {
  const strategiesData = {
    strategies: [
      {
        id: "tsmom",
        n: 42,
        win_rate: 0.58,
        profit_factor: 1.85,
        expectancy_R: 0.45,
        kelly: 0.12,
        confidence: "high",
        sqn: 2.1,
        dsr: 0.85,
      },
    ],
  };

  const summary = summarizeStrategyContext("tsmom", strategiesData);
  assert.equal(summary.id, "tsmom");
  assert.equal(summary.total_trades, 42);
  assert.equal(summary.win_rate, 0.58);
  assert.equal(summary.profit_factor, 1.85);
  assert.equal(summary.expectancy_r, 0.45);
  assert.equal(summary.kelly, 0.12);
  assert.equal(summary.confidence, "high");

  // Missing strategy fallback returns null
  const missing = summarizeStrategyContext("unknown_strat", strategiesData);
  assert.equal(missing, null);
});

test("summarizeRecentTrades: computes win rate and summarizes recent fills", () => {
  const candidate = { symbol: "BTC-USD", strategy_id: "tsmom" };
  const allTrades = [
    { ts: Date.now() - 180000, op: "close", symbol: "SOL-USD", side: "long", price: 150, net_pnl: 200, reason: "tp_hit mr" },
    { ts: Date.now() - 120000, op: "close", symbol: "BTC-USD", side: "long", price: 64000, net_pnl: -50, reason: "sl_hit tsmom" },
    { ts: Date.now() - 60000, op: "close", symbol: "BTC-USD", side: "long", price: 65000, net_pnl: 150, reason: "tp_hit tsmom" },
  ];

  const summary = summarizeRecentTrades(candidate, allTrades, 5);
  assert.equal(summary.matching_count, 2, "only matching symbol/strategy counted");
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.win_rate, 0.5);
  assert.equal(summary.total_pnl, 100);
  assert.equal(summary.avg_pnl, 50);
  assert.equal(summary.recent_executions.length, 2);
  assert.equal(summary.recent_executions[0].side, "long");
  assert.equal(summary.recent_executions[0].price, 65000);
});

test("summarizePositions: handles open positions, leverage and caps", () => {
  const state = {
    equity: 1000,
    grossLeverage: 1.5,
    aggression: { leverageCap: 3.0 },
    positions: {
      "BTC-USD": { symbol: "BTC-USD", side: "long", margin: 200, leverage: 5, unrealizedPnl: 50 },
      "ETH-USD": { symbol: "ETH-USD", side: "short", margin: 300, leverage: 5, unrealizedPnl: -20 },
    },
  };

  const summary = summarizePositions(state);
  assert.equal(summary.equity, 1000);
  assert.equal(summary.open_count, 2);
  assert.equal(summary.gross_leverage, 1.5);
  assert.equal(summary.leverage_cap, 3.0);
  assert.equal(summary.correlated_crypto_count, 2);
  assert.equal(summary.open_positions.length, 2);

  // Null state fallback
  const empty = summarizePositions(null);
  assert.equal(empty.equity, null);
  assert.equal(empty.open_count, 0);
});

test("summarizeWorldContext: extracts regime, risk posture and funding", () => {
  const worldData = {
    regime: "bull",
    risk_posture: "aggressive",
    crypto: { fundingRate: 0.00015 },
    fearGreedCrypto: { value: 72, band: "Greed" },
    fearGreedStocks: { value: 60, band: "Greed" },
    macro: { drivers: ["rates_pause", "etf_inflows"], "^VIX": { price: 14.5 } },
  };

  const summary = summarizeWorldContext(worldData);
  assert.equal(summary.regime, "bull");
  assert.equal(summary.risk_posture, "aggressive");
  assert.equal(summary.funding_rate, 0.00015);
  assert.equal(summary.fear_greed_crypto.value, 72);
  assert.equal(summary.macro_vix, 14.5);
  assert.deepEqual(summary.macro_drivers, ["rates_pause", "etf_inflows"]);
});

test("summarizeRecentAiDecisions: counts approvals/rejections and captures last decision", () => {
  const candidate = { symbol: "BTC-USD" };
  const allDecisions = [
    { symbol: "BTC-USD", decision: "APPROVE", rating: "Buy", thesis: "Strong breakout", generated_at: Date.now() - 30000 },
    { symbol: "BTC-USD", decision: "REJECT", rating: "Avoid", thesis: "Overbought", generated_at: Date.now() },
    { symbol: "SOL-USD", decision: "APPROVE", rating: "Buy", thesis: "Ecosystem rally", generated_at: Date.now() - 60000 },
  ];

  const summary = summarizeRecentAiDecisions(candidate, allDecisions, 8);
  assert.equal(summary.evaluated_count, 2);
  assert.equal(summary.approvals, 1);
  assert.equal(summary.rejections, 1);
  assert.equal(summary.last_decision.decision, "REJECT");
  assert.equal(summary.last_decision.rating, "Avoid");
});

test("buildFabrichContext: combines all modules into deterministic context payload", () => {
  const candidate = {
    symbol: "BTC-USD",
    side: "long",
    strategy_id: "tsmom",
    market: "crypto",
    leverage: 8,
  };

  const context = buildFabrichContext(candidate, {
    strategies: { strategies: [{ id: "tsmom", n: 10, win_rate: 0.6 }] },
    memory: [{ id: "l1", title: "tsmom BTC lesson", text: "Test lesson", importance: 5 }],
    trades: [{ op: "close", symbol: "BTC-USD", side: "long", net_pnl: 50, reason: "tsmom" }],
    state: { equity: 500, grossLeverage: 1.0, aggression: { leverageCap: 2.0 }, positions: {} },
    world: { regime: "trend", risk_posture: "balanced" },
    decisions: [{ symbol: "BTC-USD", decision: "APPROVE" }],
  });

  assert.ok(context.metadata.generated_at);
  assert.equal(context.metadata.candidate_symbol, "BTC-USD");
  assert.equal(context.strategy.id, "tsmom");
  assert.equal(context.strategy.total_trades, 10);
  assert.equal(context.lessons.length, 1);
  assert.equal(context.recent_trades.matching_count, 1);
  assert.equal(context.positions.equity, 500);
  assert.equal(context.world.regime, "trend");
  assert.equal(context.recent_ai.evaluated_count, 1);
});

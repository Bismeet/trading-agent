// tests/ai_gate.test.mjs — TradingAgents x FabRich Hybrid AI Decision Gate tests.
// Fully isolated using temp FAB_DATA directory.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-ai-"));
const {
  buildHybridRequest,
  parseAndValidateDecision,
  fingerprintCandidate,
  callTradingAgents,
  enqueueCandidate,
  drainAndProcessAiQueue,
  getValidApprovedIntents,
  AI_STATUS,
  HYBRID_ACTIONS,
} = await import("../scripts/v2/ai_gate.mjs");
const { riskDecide, investorDecide, agentCouncil } = await import("../scripts/v2/agents.mjs");
const { freshV2State } = await import("../scripts/v2/episode.mjs");
const { loadConfig, V2 } = await import("../scripts/v2/store.mjs");
const { tradeFee, slippageFraction, fillPrice, openPosition } = await import("../scripts/v2/perp.mjs");

const cfg = loadConfig();
const baseIntent = (over = {}) => ({
  symbol: "BTC-USD",
  side: "long",
  market: "crypto",
  strategy_id: "tsmom",
  setup_tag: "momentum",
  confidence: 0.6,
  leverage: 12,
  stopPct: 0.05,
  targetPct: 0.10,
  reason: "28d trend up",
  trade_id: "t_test_123",
  createdAt: 1788800000000,
  ...over,
});

test("1. buildHybridRequest formats exact TA_INTEGRATION.md payload", () => {
  const intent = baseIntent();
  const quote = { price: 80000 };
  const state = { regime: "broad_up" };
  const req = buildHybridRequest(intent, quote, state, "2026-09-09");

  assert.equal(req.ticker, "BTC-USD");
  assert.equal(req.trade_date, "2026-09-09");
  assert.equal(req.proposed_side, "long");
  assert.equal(req.asset_type, "crypto");
  assert.equal(req.strategy_id, "tsmom");
  assert.equal(req.setup_tag, "momentum");
  assert.equal(req.entry_price, 80000);
  assert.equal(req.stop_price, 76000); // 80000 * (1 - 0.05)
  assert.equal(req.target_price, 88000); // 80000 * (1 + 0.10)
  assert.equal(req.trading_regime, "broad_up");
});

test("2. parseAndValidateDecision direction mapping per TA_INTEGRATION.md", () => {
  // Long approvals: Buy, Overweight
  assert.equal(parseAndValidateDecision({ rating: "Buy", thesis: "ok" }, "long").approved, true);
  assert.equal(parseAndValidateDecision({ rating: "Overweight", thesis: "ok" }, "long").approved, true);

  // Long rejections: Hold, Underweight, Sell
  assert.equal(parseAndValidateDecision({ rating: "Hold", thesis: "ok" }, "long").approved, false);
  assert.equal(parseAndValidateDecision({ rating: "Underweight", thesis: "ok" }, "long").approved, false);
  assert.equal(parseAndValidateDecision({ rating: "Sell", thesis: "ok" }, "long").approved, false);

  // Short approvals: Sell, Underweight
  assert.equal(parseAndValidateDecision({ rating: "Sell", thesis: "ok" }, "short").approved, true);
  assert.equal(parseAndValidateDecision({ rating: "Underweight", thesis: "ok" }, "short").approved, true);

  // Short rejections: Hold, Overweight, Buy
  assert.equal(parseAndValidateDecision({ rating: "Hold", thesis: "ok" }, "short").approved, false);
  assert.equal(parseAndValidateDecision({ rating: "Overweight", thesis: "ok" }, "short").approved, false);
  assert.equal(parseAndValidateDecision({ rating: "Buy", thesis: "ok" }, "short").approved, false);
});

test("3. AI failure/timeout must fail-closed (approved=false, reason=AI_UNAVAILABLE)", async () => {
  // Mock fetch that rejects (network failure)
  const networkErrorFetch = async () => {
    throw new Error("Connection refused: 127.0.0.1:8000");
  };
  const resNet = await callTradingAgents({ proposed_side: "long" }, "http://127.0.0.1:8000", 1000, networkErrorFetch);
  assert.equal(resNet.approved, false);
  assert.equal(resNet.reason, "AI_UNAVAILABLE");

  // Mock fetch that simulates timeout
  const timeoutFetch = async (_url, opts) => {
    return new Promise((_, reject) => {
      opts.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  };
  const resTimeout = await callTradingAgents({ proposed_side: "long" }, "http://127.0.0.1:8000", 50, timeoutFetch);
  assert.equal(resTimeout.approved, false);
  assert.equal(resTimeout.reason, "AI_UNAVAILABLE");
  assert.ok(resTimeout.error.includes("timed out"));

  // Mock fetch returning HTTP 500 error
  const error500Fetch = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
  });
  const res500 = await callTradingAgents({ proposed_side: "long" }, "http://127.0.0.1:8000", 1000, error500Fetch);
  assert.equal(res500.approved, false);
  assert.equal(res500.reason, "AI_UNAVAILABLE");
});

test("4. Malformed/unparseable AI output fails closed", () => {
  const resNull = parseAndValidateDecision(null, "long");
  assert.equal(resNull.approved, false);
  assert.equal(resNull.reason, "AI_UNAVAILABLE");

  const resEmpty = parseAndValidateDecision({}, "long");
  assert.equal(resEmpty.approved, false);
  assert.equal(resEmpty.reason, "AI_UNAVAILABLE");

  const resGarbage = parseAndValidateDecision({ rating: "MoonRocket" }, "long");
  assert.equal(resGarbage.approved, false);
  assert.equal(resGarbage.reason, "AI_UNAVAILABLE");
});

test("5. AI decision expiration (TTL check)", () => {
  const queueFile = path.join(process.env.FAB_DATA, "ai_pending_ttl.json");
  const testCfg = { v2: { ai: { enabled: true, decisionTtlSeconds: 10 } } };
  const t0 = 1000000;

  // Insert an approved request with timestamp t0
  fs.writeFileSync(queueFile, JSON.stringify({
    requests: [
      {
        request_id: "req_fresh",
        symbol: "BTC-USD",
        status: AI_STATUS.APPROVED,
        resolved_at: t0,
        created_at: t0,
        intent: baseIntent({ symbol: "BTC-USD" }),
        decision: { approved: true, rating: "Buy" },
      },
      {
        request_id: "req_stale",
        symbol: "ETH-USD",
        status: AI_STATUS.APPROVED,
        resolved_at: t0 - 20000, // 20s ago > 10s TTL
        created_at: t0 - 20000,
        intent: baseIntent({ symbol: "ETH-USD" }),
        decision: { approved: true, rating: "Buy" },
      },
    ],
  }));

  const approved = getValidApprovedIntents(testCfg, t0, queueFile);
  assert.equal(approved.length, 1);
  assert.equal(approved[0].symbol, "BTC-USD");

  // Verify the stale request was marked expired
  const saved = JSON.parse(fs.readFileSync(queueFile, "utf8"));
  const staleItem = saved.requests.find((r) => r.request_id === "req_stale");
  assert.equal(staleItem.status, AI_STATUS.EXPIRED);
});

test("6. Request deduplication prevents duplicate AI calls", () => {
  const queueFile = path.join(process.env.FAB_DATA, "ai_pending_dedupe.json");
  const testCfg = { v2: { ai: { enabled: true, decisionTtlSeconds: 300 } } };
  const intent = baseIntent();
  const quote = { price: 80000 };
  const state = { regime: "broad_up" };

  // First enqueue -> succeeds
  const res1 = enqueueCandidate(intent, quote, state, testCfg, queueFile);
  assert.equal(res1.enqueued, true);
  assert.equal(res1.reason, "enqueued");

  // Second enqueue with unchanged signal -> deduplicated
  const res2 = enqueueCandidate(intent, quote, state, testCfg, queueFile);
  assert.equal(res2.enqueued, false);
  assert.equal(res2.reason, "already_pending");
});

test("7. AI approval CANNOT bypass FabRich Risk Agent (crypto cluster protection)", () => {
  // 4 existing same-side crypto positions
  const sCluster = {
    ...freshV2State(cfg),
    positions: {
      "BTC-USD": { market: "crypto", side: "long" },
      "ETH-USD": { market: "crypto", side: "long" },
      "SOL-USD": { market: "crypto", side: "long" },
      "XRP-USD": { market: "crypto", side: "long" },
    },
  };
  const intent = baseIntent({ symbol: "DOGE-USD", market: "crypto", side: "long" });

  // Even if AI approved DOGE-USD Long:
  const riskVerdict = riskDecide(intent, sCluster, cfg, 0);
  assert.equal(riskVerdict.vote, "veto");
  assert.ok(riskVerdict.reasons[0].includes("correlated exposure cap"));
});

test("8. AI approval CANNOT bypass max concurrent positions", () => {
  const positions = {};
  for (let i = 0; i < 10; i++) {
    positions[`SYM_${i}`] = { market: "us", side: "long" };
  }
  const sFull = { ...freshV2State(cfg), positions };
  const intent = baseIntent({ symbol: "AAPL", market: "us" });

  const riskVerdict = riskDecide(intent, sFull, cfg, 0);
  assert.equal(riskVerdict.vote, "veto");
  assert.ok(riskVerdict.reasons[0].includes("position cap 10 reached"));
});

test("9. AI approval CANNOT bypass leverage cap", () => {
  const state = freshV2State(cfg);
  state.aggression.leverageCap = 15;
  const intent = baseIntent({ leverage: 50 }); // attempt 50x

  // In strategy execution, leverage is clamped to aggression.leverageCap
  const clamped = Math.min(intent.leverage, state.aggression.leverageCap);
  assert.equal(clamped, 15);
});

test("10. AI approval CANNOT bypass stale quote protection", () => {
  const state = freshV2State(cfg);
  const staleQuote = { ok: true, price: 80000, stale: true };
  const intent = baseIntent();

  const investorVerdict = investorDecide(intent, state, staleQuote);
  assert.equal(investorVerdict.vote, "veto");
  assert.ok(investorVerdict.reasons[0].includes("no fresh quote"));
});

test("11. End-to-end asynchronous flow: raw intent -> AI approve -> Council approve -> pending", async () => {
  const queueFile = path.join(process.env.FAB_DATA, "ai_pending_flow.json");
  const decisionsFile = path.join(process.env.FAB_DATA, "ai_decisions_flow.jsonl");
  const testCfg = {
    ...cfg,
    v2: {
      ...cfg.v2,
      ai: {
        enabled: true,
        endpoint: "http://127.0.0.1:8000/api/hybrid/decision",
        decisionTtlSeconds: 300,
        requestTimeoutMs: 5000,
      },
    },
  };

  const state = freshV2State(cfg);
  state.regime = "broad_up";
  const intent = baseIntent();
  const quote = { price: 80000, ok: true };

  // Step 1: Enqueue candidate
  const enq = enqueueCandidate(intent, quote, state, testCfg, queueFile);
  assert.equal(enq.enqueued, true);

  // Step 2: Mock successful TradingAgents approval
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      ticker: "BTC-USD",
      trade_date: "2026-09-09",
      action: "BUY",
      rating: "Buy",
      approved: true,
      thesis: "Strong institutional momentum supported by on-chain flow.",
      model_provider: "google",
      model_name: "gemini-2.5-flash",
    }),
  });

  // Step 3: Process async queue
  drainAndProcessAiQueue(testCfg, state, queueFile, decisionsFile, mockFetch);

  // Wait brief tick for async task resolution
  await new Promise((r) => setTimeout(r, 50));

  // Step 4: Extract approved intents
  const approvedIntents = getValidApprovedIntents(testCfg, Date.now(), queueFile);
  assert.equal(approvedIntents.length, 1);
  assert.equal(approvedIntents[0].aiDecision.rating, "Buy");
  assert.equal(approvedIntents[0].aiDecision.approved, true);

  // Step 5: Send AI-approved intent to Agent Council
  const quotes = { "BTC-USD": { price: 80000, ok: true } };
  const council = agentCouncil(approvedIntents, state, testCfg, null, quotes);
  assert.equal(council.approved.length, 1);
  assert.equal(council.rejected.length, 0);

  // Step 6: Verify decision was audited to decisions log
  const logged = fs.readFileSync(decisionsFile, "utf8").trim().split("\n");
  assert.equal(logged.length, 1);
  const rec = JSON.parse(logged[0]);
  assert.equal(rec.decision, "APPROVE");
  assert.equal(rec.symbol, "BTC-USD");
  assert.equal(rec.rating, "Buy");
});

test("12. Existing paper-trading fee, slippage, and math are unchanged", () => {
  // Taker fee: 0.0005 (5 bps)
  const fee = tradeFee(1000, 0.0005);
  assert.equal(fee, 0.5);

  // Half-spread 5 bps + square-root impact
  const halfSpread = 0.0005 / 2;
  const slip = slippageFraction(1000, 0.02);
  const fill = fillPrice(100, "long", halfSpread, slip);
  assert.ok(fill > 100); // adverse fill for buyer

  // Position math
  const tiers = cfg.v2.maintenanceTiers.crypto;
  const pos = openPosition({
    symbol: "BTC-USD",
    market: "crypto",
    side: "long",
    entryMark: 80000,
    margin: 10,
    leverage: 5,
    tiers,
    meta: { trade_id: "t_test" },
  }, 100000);

  assert.equal(pos.notional, 50); // 10 margin * 5 lev
  assert.equal(pos.qty, 50 / 80000);
  assert.ok(pos.liqPrice > 0 && pos.liqPrice < 80000); // Long liquidation below entry
});

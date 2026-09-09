#!/usr/bin/env node

/**
 * scripts/test_run.mjs
 * 
 * Triggers an end-to-end test trade candidate through FabRich & Tauric AI.
 * Simulates a strategy candidate with live context, queries Meta Muse / active LLM,
 * and outputs the multi-agent verdict.
 */

import { buildFabrichContext } from "./v2/ai_context.mjs";
import { readJSON, now, iso } from "./v2/store.mjs";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();
const configPath = path.join(ROOT, "config.json");
const statePath = path.join(ROOT, "data", "state.v2.json");

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { equity: 100, regime: "neutral" };

console.log("\n=======================================================");
console.log("  FabRich × Tauric AI — Live Test Run Initiator");
console.log("=======================================================\n");

const candidate = {
  ticker: process.argv[2] || "BTC-USD",
  trade_date: new Date().toISOString().split("T")[0],
  asset_type: "crypto",
  proposed_side: "long",
  strategy_id: "tsmom",
  setup_tag: "momentum_breakout",
  entry_price: 68500.0,
  stop_price: 65200.0,
  target_price: 74000.0,
  trading_regime: state.regime || "bullish",
};

console.log(`[1/3] Generating FabRich context for ${candidate.ticker} (${candidate.proposed_side.toUpperCase()})...`);
const context = buildFabrichContext({
  strategy_id: candidate.strategy_id,
  symbol: candidate.ticker,
  side: candidate.proposed_side,
  entry_price: candidate.entry_price,
  stop_price: candidate.stop_price,
  target_price: candidate.target_price,
}, state, null, config);

const payload = {
  ...candidate,
  fabrich_context: context,
};

const endpoint = config?.v2?.ai?.endpoint || "http://127.0.0.1:8000/api/hybrid/decision";
console.log(`[2/3] Sending candidate to AI Decision Endpoint: ${endpoint}`);
console.log(`      Active LLM: Meta Muse (muse-spark-1.3-contributor)\n`);

const t0 = Date.now();
try {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  const durationSec = ((Date.now() - t0) / 1000).toFixed(2);

  if (!res.ok) {
    console.error(`[FAIL] AI Service returned HTTP ${res.status}: ${res.statusText}`);
    process.exit(1);
  }

  const decision = await res.json();
  console.log(`[3/3] AI Analysis Completed in ${durationSec}s!\n`);
  console.log("------------------ DECISION SUMMARY ------------------");
  console.log(`Verdict:     ${decision.approved ? "✅ APPROVED" : "❌ REJECTED"}`);
  console.log(`Rating:      ${decision.rating || "Hold"}`);
  console.log(`Action:      ${decision.action || "hold"}`);
  console.log(`Confidence:  ${decision.confidence != null ? `${(decision.confidence * 100).toFixed(1)}%` : "N/A"}`);
  console.log(`Model Used:  ${decision.model_name || "meta/muse-spark-1.3-contributor"}`);
  if (decision.thesis) {
    console.log(`\nCore Thesis:\n${decision.thesis.slice(0, 300)}...`);
  }
  console.log("------------------------------------------------------\n");
  console.log("Tip: Open your Web Dashboard at http://localhost:3000 to see");
  console.log("the candidate, strategy telemetry, and debate under 'AI Analysis'!\n");
} catch (err) {
  console.error(`[ERROR] AI Test Run failed: ${err.message}`);
  process.exit(1);
}

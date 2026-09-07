// scripts/v2/agents.mjs — OWNER EXTENSION: multi-agent decision council.
// Three rule-based agents (no LLM) deliberate over every new trade intent:
//   ANALYST  — reads market structure (regime, world context: fear/greed, funding,
//              news mood) and approves/vetoes the setup's timing.
//   RISK     — enforces portfolio limits: max positions, correlated-exposure cap,
//              drawdown brake, survival-mode compliance.
//   INVESTOR — executes what survives; its veto = "not at this price/size" for
//              microstructure reasons (stale quote, tiny wallet).
// Every deliberation is logged to agents.v2.jsonl and surfaced in signals so the
// dashboard shows WHY a trade was allowed or blocked.
import { V2, readJSON, appendJSONL, now } from "./store.mjs";

export const AGENTS = ["analyst", "risk", "investor"];

// ---- ANALYST: timing/context verdict on an intent ----
export function analystDecide(intent, state, world) {
  const reasons = [];
  let vote = "approve";
  let confidenceAdj = 0;

  // Regime vs setup direction: momentum/breakout longs in crypto_down are bad timing
  const regime = state.regime;
  if (regime === "crypto_down" && intent.side === "long") {
    vote = "veto"; reasons.push(`regime ${regime}: longs against falling crypto`);
  }
  if (regime === "crypto_down_highvol" && intent.side === "long") {
    vote = "veto"; reasons.push(`regime ${regime}: longs in high-vol downtrend`);
  }
  if (regime === "us_down" && intent.market === "us" && intent.side === "long") {
    vote = "veto"; reasons.push(`regime us_down: equity longs deferred`);
  }

  // World context (optional — missing world data never blocks, just informs)
  if (world) {
    const fg = world.fearGreedCrypto?.value;
    if (Number.isFinite(fg)) {
      if (fg <= 10 && intent.side === "long" && intent.market === "crypto") {
        // extreme fear: historically decent long timing — analyst boosts confidence
        confidenceAdj = 0.05; reasons.push(`crypto F&G ${fg} (extreme fear): long timing favorable`);
      }
      if (fg >= 90 && intent.side === "long" && intent.market === "crypto") {
        confidenceAdj = -0.05; reasons.push(`crypto F&G ${fg} (extreme greed): euphoria risk`);
      }
    }
    if (Number.isFinite(world.fundingRate) && intent.side === "long" && intent.market === "crypto" && world.fundingRate > 0.001) {
      confidenceAdj = -0.05; reasons.push(`funding ${(world.fundingRate * 100).toFixed(3)}%/8h: crowded longs, carry cost high`);
    }
    if (world.newsMood?.mixed) reasons.push("news mood mixed: reduced conviction");
  } else {
    reasons.push("world context unavailable: decided on market structure alone");
  }

  if (!reasons.length) reasons.push(`regime ${regime}: no objection`);
  return { agent: "analyst", vote, confidenceAdj, reasons };
}

// ---- RISK: portfolio-level verdict ----
export function riskDecide(intent, state, cfg, pendingCount) {
  const reasons = [];
  const maxPos = cfg.v2.strategies.maxConcurrentPositions;
  const openCount = Object.keys(state.positions || {}).length;

  if (openCount + pendingCount >= maxPos) {
    return { agent: "risk", vote: "veto", reasons: [`position cap ${maxPos} reached`] };
  }

  // Correlated exposure: same-side crypto cluster
  if (intent.market === "crypto") {
    const sameSide = Object.values(state.positions || {}).filter(
      (p) => p.market === "crypto" && p.side === intent.side,
    ).length + pendingCount;
    if (sameSide >= 4) {
      return { agent: "risk", vote: "veto", reasons: [`crypto ${intent.side} cluster already ${sameSide}: correlated exposure cap`] };
    }
  }

  // Drawdown brake: deeper than 10% from peak -> no new risk at all
  if ((state.maxDrawdownPct ?? 0) > 10) {
    return { agent: "risk", vote: "veto", reasons: [`drawdown ${state.maxDrawdownPct.toFixed(1)}% > 10% brake`] };
  }

  reasons.push(`positions ${openCount}/${maxPos}, dd ${(state.maxDrawdownPct ?? 0).toFixed(1)}%: within limits`);
  return { agent: "risk", vote: "approve", reasons };
}

// ---- INVESTOR: execution sanity ----
export function investorDecide(intent, state, quote) {
  if (!quote || !quote.ok || quote.stale) {
    return { agent: "investor", vote: "veto", reasons: ["no fresh quote: will not execute blind"] };
  }
  if (state.walletBalance < 2) {
    return { agent: "investor", vote: "veto", reasons: ["wallet too small for another position"] };
  }
  return { agent: "investor", vote: "approve", reasons: [`fresh quote ${quote.priceUsd ?? quote.price}`] };
}

// ---- Council: returns {approved, rejected, log} ----
export function agentCouncil(intents, state, cfg, world, quotes) {
  const approved = [], rejected = [], log = [];
  let pendingCount = 0;
  for (const intent of intents) {
    const verdicts = [];
    let ok = true;
    for (const decide of [analystDecide, riskDecide, investorDecide]) {
      let v;
      if (decide === analystDecide) v = decide(intent, state, world);
      else if (decide === riskDecide) v = decide(intent, state, cfg, pendingCount);
      else v = decide(intent, state, quotes?.[intent.symbol]);
      verdicts.push(v);
      if (v.vote === "veto") { ok = false; break; }
      if (v.confidenceAdj) intent.confidence = Math.max(0.05, Math.min(0.95, intent.confidence + v.confidenceAdj));
    }
    const entry = {
      ts: now(), episodeId: state.episodeId, symbol: intent.symbol, side: intent.side,
      strategy_id: intent.strategy_id ?? null, approved: ok,
      verdicts,
    };
    log.push(entry);
    if (ok) { approved.push(intent); pendingCount++; }
    else rejected.push(entry);
  }
  if (log.length) appendJSONL(V2.agents, { ts: now(), episodeId: state.episodeId, decisions: log });
  return { approved, rejected, log };
}

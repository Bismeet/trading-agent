// scripts/v2/ai_gate.mjs — TradingAgents x FabRich Hybrid AI Decision Gate.
// Strictly adheres to the API contract in TA_INTEGRATION.md.
//
// Responsibilities:
// - Build AI decision request from FabRich strategy intent.
// - Call local TauricResearch TradingAgents service (POST /api/hybrid/decision).
// - Validate response and enforce fail-closed security guarantees.
// - Manage asynchronous AI pending queue (data/ai_pending.v2.json).
// - Persist AI decision audit trail (data/ai_decisions.v2.jsonl).
// - Enforce decision TTL (decisionTtlSeconds) and signal deduplication.
// - NEVER mutate wallet/equity, execute orders, or bypass FabRich risk controls.

import {
  V2, readJSON, writeJSON, appendJSONL, readJSONL, now, iso, sha256, round,
} from "./store.mjs";

export const AI_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  FAILED: "failed",
  CONSUMED: "consumed",
};

export const HYBRID_ACTIONS = {
  BUY: "BUY",
  SELL: "SELL",
  HOLD: "HOLD",
};

// Set of in-flight request IDs to prevent duplicate parallel fetches
const _inFlightRequests = new Set();

/**
 * Deterministic fingerprint to prevent repeated AI calls for unchanged signals.
 */
export function fingerprintCandidate(intent, state, quote) {
  const symbol = intent.symbol ?? "";
  const strategyId = intent.strategy_id ?? "";
  const side = intent.side ?? "";
  const regime = state?.regime ?? "unknown";
  const priceRounded = quote?.price != null ? round(quote.price, 2) : 0;
  return sha256(`${symbol}:${strategyId}:${side}:${regime}:${priceRounded}`);
}

/**
 * Builds the exact payload documented in TA_INTEGRATION.md.
 */
export function buildHybridRequest(intent, quote, state, dateOverride = null) {
  const t = intent.createdAt || now();
  const tradeDate = dateOverride || new Date(t).toISOString().slice(0, 10);
  const isCrypto = intent.market === "crypto" || (intent.symbol && intent.symbol.includes("-USD"));
  const assetType = isCrypto ? "crypto" : "stock";
  const entryPrice = quote?.price != null ? Number(quote.price) : null;

  let stopPrice = null;
  let targetPrice = null;
  if (entryPrice != null) {
    if (intent.stopPct != null) {
      stopPrice = intent.side === "long"
        ? round(entryPrice * (1 - intent.stopPct), 4)
        : round(entryPrice * (1 + intent.stopPct), 4);
    }
    if (intent.targetPct != null) {
      targetPrice = intent.side === "long"
        ? round(entryPrice * (1 + intent.targetPct), 4)
        : round(entryPrice * (1 - intent.targetPct), 4);
    }
  }

  return {
    ticker: intent.symbol,
    trade_date: tradeDate,
    proposed_side: intent.side,
    asset_type: assetType,
    strategy_id: intent.strategy_id || null,
    setup_tag: intent.setup_tag || null,
    entry_price: entryPrice,
    stop_price: stopPrice,
    target_price: targetPrice,
    trading_regime: state?.regime || null,
    instrument_context: state?.regime ? `FabRich regime=${state.regime}` : null,
  };
}

/**
 * Validates and normalizes raw response from TradingAgents per TA_INTEGRATION.md.
 */
export function parseAndValidateDecision(raw, proposedSide) {
  if (!raw || typeof raw !== "object") {
    return {
      action: HYBRID_ACTIONS.HOLD,
      rating: "Hold",
      approved: false,
      thesis: "Invalid or empty response from TradingAgents",
      reason: "AI_UNAVAILABLE",
      error: "Malformed response payload",
    };
  }

  // If TradingAgents explicitly returned an AI_UNAVAILABLE rejection
  if (raw.reason === "AI_UNAVAILABLE" || raw.approved === false && raw.reason) {
    return {
      action: raw.action || HYBRID_ACTIONS.HOLD,
      rating: raw.rating || "Hold",
      approved: false,
      thesis: raw.thesis || "TradingAgents AI pipeline unavailable",
      reason: raw.reason || "AI_UNAVAILABLE",
      error: raw.error || null,
      provider: raw.model_provider || "TradingAgents",
      model: raw.model_name || null,
    };
  }

  const rating = raw.rating;
  const validRatings = new Set(["Buy", "Overweight", "Hold", "Underweight", "Sell"]);
  if (!rating || !validRatings.has(rating)) {
    return {
      action: HYBRID_ACTIONS.HOLD,
      rating: "Hold",
      approved: false,
      thesis: "Unrecognized or missing rating from TradingAgents",
      reason: "AI_UNAVAILABLE",
      error: `Invalid rating: ${rating}`,
    };
  }

  // Exact direction / approval mapping per TA_INTEGRATION.md
  let approved = false;
  const side = (proposedSide || "").toLowerCase();
  if (side === "long") {
    approved = (rating === "Buy" || rating === "Overweight");
  } else if (side === "short") {
    approved = (rating === "Sell" || rating === "Underweight");
  }

  return {
    action: raw.action || (approved ? (side === "long" ? HYBRID_ACTIONS.BUY : HYBRID_ACTIONS.SELL) : HYBRID_ACTIONS.HOLD),
    rating,
    approved,
    thesis: raw.thesis || "",
    entry_price: raw.entry_price ?? null,
    stop_loss: raw.stop_loss ?? null,
    price_target: raw.price_target ?? null,
    position_sizing: raw.position_sizing ?? null,
    source: raw.source || "TradingAgents",
    generated_at: raw.generated_at || iso(),
    model_provider: raw.model_provider || "TradingAgents",
    model_name: raw.model_name || null,
    fabrich_strategy_id: raw.fabrich_strategy_id || null,
    fabrich_setup_tag: raw.fabrich_setup_tag || null,
    reason: approved ? null : (raw.reason || `rating_${rating.toLowerCase()}_rejected_${side}`),
  };
}

/**
 * Invokes TradingAgents HTTP endpoint with a strict timeout and fail-closed handling.
 */
export async function callTradingAgents(payload, endpoint, timeoutMs = 10000, fetchFn = globalThis.fetch) {
  if (!fetchFn) {
    return {
      action: HYBRID_ACTIONS.HOLD,
      rating: "Hold",
      approved: false,
      reason: "AI_UNAVAILABLE",
      error: "Global fetch not available",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        action: HYBRID_ACTIONS.HOLD,
        rating: "Hold",
        approved: false,
        reason: "AI_UNAVAILABLE",
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = await res.json();
    return parseAndValidateDecision(data, payload.proposed_side);
  } catch (err) {
    const isTimeout = err?.name === "AbortError" || err?.name === "TimeoutError";
    return {
      action: HYBRID_ACTIONS.HOLD,
      rating: "Hold",
      approved: false,
      reason: "AI_UNAVAILABLE",
      error: isTimeout ? `Request timed out after ${timeoutMs}ms` : (err?.message || "Network error"),
    };
  }
}

/**
 * Load the active AI pending queue.
 */
export function loadAiPendingQueue(filePath = V2.aiPending) {
  const data = readJSON(filePath, { requests: [] });
  if (!Array.isArray(data?.requests)) return { requests: [] };
  return data;
}

/**
 * Save the active AI pending queue.
 */
export function saveAiPendingQueue(queue, filePath = V2.aiPending) {
  writeJSON(filePath, queue);
}

/**
 * Append an AI decision record to data/ai_decisions.v2.jsonl.
 */
export function logAiDecision(record, filePath = V2.aiDecisions) {
  appendJSONL(filePath, {
    request_id: record.request_id,
    trade_id: record.trade_id,
    symbol: record.symbol,
    strategy_id: record.strategy_id,
    setup_tag: record.setup_tag,
    side: record.side,
    decision: record.decision, // "APPROVE" | "REJECT" | "AI_UNAVAILABLE"
    rating: record.rating || "Hold",
    thesis: record.thesis || "",
    entry_price: record.entry_price ?? null,
    stop_loss: record.stop_loss ?? null,
    target: record.price_target ?? record.target ?? null,
    generated_at: record.generated_at || iso(),
    decision_age_ms: record.decision_age_ms ?? 0,
    trading_regime: record.trading_regime || "unknown",
    provider: record.provider || record.model_provider || "TradingAgents",
    model: record.model || record.model_name || null,
    error: record.error || null,
  });
}

/**
 * Enqueue a new raw intent if not already pending or covered by an unexpired decision.
 * Returns { enqueued: boolean, request: object | null, reason: string }.
 */
export function enqueueCandidate(intent, quote, state, cfg, queuePath = V2.aiPending) {
  if (!cfg?.v2?.ai?.enabled) {
    return { enqueued: false, request: null, reason: "ai_disabled" };
  }

  const queue = loadAiPendingQueue(queuePath);
  const fp = fingerprintCandidate(intent, state, quote);
  const ttlSec = cfg.v2.ai.decisionTtlSeconds || 300;
  const nowTs = now();

  // Deduplication check
  for (const r of queue.requests) {
    if (r.fingerprint === fp) {
      if (r.status === AI_STATUS.PENDING) {
        return { enqueued: false, request: r, reason: "already_pending" };
      }
      if (r.status === AI_STATUS.APPROVED || r.status === AI_STATUS.REJECTED) {
        const ageSec = (nowTs - (r.resolved_at || r.created_at)) / 1000;
        if (ageSec < ttlSec) {
          return { enqueued: false, request: r, reason: "decision_cached" };
        }
      }
    }
  }

  const reqId = `req_${nowTs}_${sha256(fp + nowTs).slice(0, 12)}`;
  const payload = buildHybridRequest(intent, quote, state);

  const newReq = {
    request_id: reqId,
    trade_id: intent.trade_id,
    symbol: intent.symbol,
    market: intent.market,
    strategy_id: intent.strategy_id,
    setup_tag: intent.setup_tag,
    side: intent.side,
    created_at: nowTs,
    trading_regime: state.regime,
    candidate_entry: payload.entry_price,
    candidate_stop: payload.stop_price,
    candidate_target: payload.target_price,
    fingerprint: fp,
    status: AI_STATUS.PENDING,
    decision: null,
    resolved_at: null,
    intent: { ...intent }, // full intent preserved for downstream council & execution
  };

  queue.requests.push(newReq);
  saveAiPendingQueue(queue, queuePath);
  return { enqueued: true, request: newReq, reason: "enqueued" };
}

/**
 * Asynchronously process pending requests without stalling the main engine cycle.
 * Called on every engine cycle tick.
 */
export function drainAndProcessAiQueue(cfg, state, queuePath = V2.aiPending, decisionsPath = V2.aiDecisions, fetchFn = globalThis.fetch) {
  if (!cfg?.v2?.ai?.enabled) return;
  const queue = loadAiPendingQueue(queuePath);
  const pending = queue.requests.filter((r) => r.status === AI_STATUS.PENDING && !_inFlightRequests.has(r.request_id));

  if (!pending.length) return;

  const endpoint = cfg.v2.ai.endpoint || "http://127.0.0.1:8000/api/hybrid/decision";
  const timeoutMs = cfg.v2.ai.requestTimeoutMs || 10000;

  for (const req of pending) {
    _inFlightRequests.add(req.request_id);

    // Run async in background without blocking engine loop
    (async () => {
      try {
        const payload = buildHybridRequest(req.intent, { price: req.candidate_entry }, state);
        const res = await callTradingAgents(payload, endpoint, timeoutMs, fetchFn);
        const resolvedTs = now();
        const ageMs = resolvedTs - req.created_at;

        // Re-read queue to ensure safe concurrent write
        const curQueue = loadAiPendingQueue(queuePath);
        const item = curQueue.requests.find((r) => r.request_id === req.request_id);
        if (item) {
          item.status = res.approved ? AI_STATUS.APPROVED : AI_STATUS.REJECTED;
          item.decision = res;
          item.resolved_at = resolvedTs;
          saveAiPendingQueue(curQueue, queuePath);
        }

        // Log decision record
        logAiDecision({
          request_id: req.request_id,
          trade_id: req.trade_id,
          symbol: req.symbol,
          strategy_id: req.strategy_id,
          setup_tag: req.setup_tag,
          side: req.side,
          decision: res.approved ? "APPROVE" : (res.reason === "AI_UNAVAILABLE" ? "AI_UNAVAILABLE" : "REJECT"),
          rating: res.rating,
          thesis: res.thesis,
          entry_price: res.entry_price ?? req.candidate_entry,
          stop_loss: res.stop_loss ?? req.candidate_stop,
          price_target: res.price_target ?? req.candidate_target,
          generated_at: res.generated_at || iso(),
          decision_age_ms: ageMs,
          trading_regime: req.trading_regime,
          provider: res.model_provider || "TradingAgents",
          model: res.model_name || null,
          error: res.error || null,
        }, decisionsPath);
      } catch (err) {
        const curQueue = loadAiPendingQueue(queuePath);
        const item = curQueue.requests.find((r) => r.request_id === req.request_id);
        if (item) {
          item.status = AI_STATUS.FAILED;
          item.resolved_at = now();
          item.decision = { approved: false, reason: "AI_UNAVAILABLE", error: err?.message };
          saveAiPendingQueue(curQueue, queuePath);
        }
      } finally {
        _inFlightRequests.delete(req.request_id);
      }
    })();
  }
}

/**
 * Retrieves valid, unexpired approved candidate intents from the queue.
 * Marks consumed orders so they do not execute multiple times.
 */
export function getValidApprovedIntents(cfg, t = now(), queuePath = V2.aiPending) {
  const queue = loadAiPendingQueue(queuePath);
  const ttlSec = cfg?.v2?.ai?.decisionTtlSeconds || 300;
  const approvedIntents = [];
  let modified = false;

  for (const req of queue.requests) {
    if (req.status === AI_STATUS.APPROVED) {
      const ageSec = (t - (req.resolved_at || req.created_at)) / 1000;
      if (ageSec > ttlSec) {
        req.status = AI_STATUS.EXPIRED;
        modified = true;
      } else {
        // Valid fresh approval!
        req.status = AI_STATUS.CONSUMED;
        modified = true;
        // Attach AI decision metadata onto the intent object for audit / UI
        const intentWithAi = {
          ...req.intent,
          aiDecision: {
            request_id: req.request_id,
            approved: true,
            rating: req.decision?.rating || "Buy",
            thesis: req.decision?.thesis || "",
            action: req.decision?.action || "BUY",
            provider: req.decision?.model_provider || "TradingAgents",
            model: req.decision?.model_name || null,
            generated_at: req.decision?.generated_at || iso(),
          },
        };
        approvedIntents.push(intentWithAi);
      }
    }
  }

  // Clean up old consumed / expired requests older than 1 hour to prevent queue bloat
  const cutoff = t - 3600000;
  const originalLength = queue.requests.length;
  queue.requests = queue.requests.filter((r) => {
    if ((r.status === AI_STATUS.CONSUMED || r.status === AI_STATUS.EXPIRED || r.status === AI_STATUS.REJECTED) && (r.resolved_at || r.created_at) < cutoff) {
      return false;
    }
    return true;
  });
  if (queue.requests.length !== originalLength) modified = true;

  if (modified) {
    saveAiPendingQueue(queue, queuePath);
  }

  return approvedIntents;
}

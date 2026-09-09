// scripts/v2/ai_context.mjs — Deterministic context builder for Tauric AI integration.
// Extracts, scores, and compacts relevant FabRich intelligence (Strategy statistics,
// Lessons Bank, Recent Executions, Open Positions, World/Macro, Recent AI Decisions).
//
// Pure, deterministic, and non-authoritative: does not execute trades or alter risk.

import { V2, readJSON, readJSONL, now, iso, round } from "./store.mjs";

/**
 * Score and retrieve the most relevant lessons from the Lessons Bank (memory.jsonl).
 * Prioritizes lessons matching candidate's strategy, symbol, side, regime, and importance.
 */
export function selectRelevantLessons(candidate, allLessons = [], maxLessons = 4) {
  if (!Array.isArray(allLessons) || allLessons.length === 0) {
    return [];
  }

  const stratId = (candidate?.strategy_id || "").toLowerCase().trim();
  const symbol = (candidate?.symbol || "").toLowerCase().trim();
  const baseSymbol = symbol.replace(/-usd$/i, "").replace(/usd$/i, "");
  const side = (candidate?.side || "").toLowerCase().trim();
  const regime = (candidate?.regime || candidate?.trading_regime || "").toLowerCase().trim();

  const scored = allLessons.map((lesson) => {
    let score = Number(lesson.importance || 1);
    const title = (lesson.title || "").toLowerCase();
    const text = (lesson.text || "").toLowerCase();
    const lessonRegime = (lesson.regime || "").toLowerCase();

    // Matching regime
    if (regime && (lessonRegime === regime || title.includes(regime) || text.includes(regime))) {
      score += 10;
    }

    // Matching strategy
    if (stratId && (title.includes(stratId) || text.includes(stratId))) {
      score += 12;
    }

    // Matching symbol
    if (symbol && (title.includes(symbol) || text.includes(symbol) || (baseSymbol && (title.includes(baseSymbol) || text.includes(baseSymbol))))) {
      score += 15;
    }

    // Matching direction
    if (side && (title.includes(side) || text.includes(side))) {
      score += 5;
    }

    // Loss/Blowup lessons are prioritized for caution
    if (lesson.kind === "blowup" || lesson.kind === "loss") {
      score += 4;
    }

    return {
      id: lesson.id,
      title: lesson.title,
      text: lesson.text,
      kind: lesson.kind,
      regime: lesson.regime || null,
      importance: lesson.importance || 1,
      createdAt: lesson.createdAt || null,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score || (b.createdAt || 0) - (a.createdAt || 0));

  return scored.slice(0, maxLessons).map((s) => ({
    id: s.id,
    title: s.title,
    text: s.text,
    kind: s.kind,
    regime: s.regime,
    importance: s.importance,
  }));
}

/**
 * Extract historical performance and edge statistics for the candidate's strategy.
 */
export function summarizeStrategyContext(strategyId, strategiesData) {
  if (!strategyId) return null;

  const list = Array.isArray(strategiesData?.strategies)
    ? strategiesData.strategies
    : Array.isArray(strategiesData)
    ? strategiesData
    : [];

  const found = list.find((s) => (s.id || "").toLowerCase() === String(strategyId).toLowerCase());
  if (!found) return null;

  return {
    id: found.id,
    name: found.name || found.id,
    setup_tag: found.setup_tag || null,
    status: found.status || "candidate",
    total_trades: found.n || 0,
    win_rate: found.win_rate != null ? round(found.win_rate, 4) : null,
    profit_factor: found.profit_factor != null ? round(found.profit_factor, 4) : null,
    expectancy_r: found.expectancy_R != null ? round(found.expectancy_R, 4) : null,
    kelly: found.kelly != null ? round(found.kelly, 4) : null,
    confidence: typeof found.confidence === "number" ? round(found.confidence, 4) : (found.confidence ?? null),
    sqn: found.sqn != null ? round(found.sqn, 4) : null,
    dsr: found.dsr != null ? round(found.dsr, 4) : null,
  };
}

/**
 * Summarize recent executions matching symbol or strategy.
 */
export function summarizeRecentTrades(candidate, allTrades = [], maxRecent = 5) {
  if (!Array.isArray(allTrades) || allTrades.length === 0) {
    return {
      matching_count: 0,
      wins: 0,
      losses: 0,
      win_rate: null,
      total_pnl: 0,
      avg_pnl: 0,
      recent_executions: [],
    };
  }

  const sym = (candidate?.symbol || "").toLowerCase().trim();
  const strat = (candidate?.strategy_id || "").toLowerCase().trim();

  // Look at closed trades with P&L or matching fills
  const relevant = allTrades.filter((t) => {
    const tSym = (t.symbol || "").toLowerCase();
    const tReason = (t.reason || "").toLowerCase();
    return tSym === sym || (strat && tReason.includes(strat));
  });

  const closedWithPnl = relevant.filter((t) => t.op === "close" && t.net_pnl != null);

  let wins = 0;
  let losses = 0;
  let totalPnl = 0;

  for (const t of closedWithPnl) {
    const pnl = Number(t.net_pnl);
    totalPnl += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }

  const closedCount = closedWithPnl.length;
  const winRate = closedCount > 0 ? round(wins / closedCount, 4) : null;
  const avgPnl = closedCount > 0 ? round(totalPnl / closedCount, 4) : 0;

  // Take the most recent fills
  const recentExecutions = relevant.slice(-maxRecent).reverse().map((t) => ({
    symbol: t.symbol,
    op: t.op,
    side: t.side,
    price: t.price != null ? round(t.price, 4) : null,
    net_pnl: t.net_pnl != null ? round(t.net_pnl, 4) : null,
    reason: t.reason || null,
    ts: t.ts,
  }));

  return {
    matching_count: relevant.length,
    wins,
    losses,
    win_rate: winRate,
    total_pnl: round(totalPnl, 4),
    avg_pnl: avgPnl,
    recent_executions: recentExecutions,
  };
}

/**
 * Summarize current portfolio exposure, leverage, and concentration.
 */
export function summarizePositions(state) {
  const rawPositions = state?.positions;
  const posList = Array.isArray(rawPositions)
    ? rawPositions
    : typeof rawPositions === "object" && rawPositions !== null
    ? Object.values(rawPositions)
    : [];

  const openPositions = posList.map((p) => ({
    symbol: p.symbol,
    side: p.side,
    margin: p.margin != null ? round(p.margin, 2) : 0,
    leverage: p.leverage || 1,
    unrealized_pnl: p.unrealizedPnl != null ? round(p.unrealizedPnl, 4) : 0,
  }));

  const cryptoPositions = openPositions.filter((p) =>
    (p.symbol || "").toUpperCase().includes("-USD") || (p.symbol || "").toUpperCase().includes("BTC")
  );

  return {
    open_count: openPositions.length,
    gross_leverage: state?.grossLeverage != null ? round(state.grossLeverage, 2) : null,
    leverage_cap: state?.aggression?.leverageCap || null,
    equity: state?.equity != null ? round(state.equity, 2) : null,
    correlated_crypto_count: cryptoPositions.length,
    open_positions: openPositions,
  };
}

/**
 * Summarize World & Macro context from world.v2.json.
 */
export function summarizeWorldContext(worldData) {
  if (!worldData) return null;

  return {
    regime: worldData.regime || "unknown",
    risk_posture: worldData.risk_posture || "unknown",
    fear_greed_crypto: worldData.fearGreedCrypto
      ? { value: worldData.fearGreedCrypto.value, band: worldData.fearGreedCrypto.band }
      : null,
    fear_greed_stocks: worldData.fearGreedStocks
      ? { value: worldData.fearGreedStocks.value, band: worldData.fearGreedStocks.band }
      : null,
    funding_rate:
      worldData.crypto?.fundingRate ?? worldData.fundingRate ?? null,
    macro_drivers: worldData.macro?.drivers || [],
    macro_vix: worldData.macro?.["^VIX"]?.price ?? null,
    news_mixed: worldData.newsMood?.mixed ?? false,
  };
}

/**
 * Summarize recent AI decisions for this symbol or strategy.
 */
export function summarizeRecentAiDecisions(candidate, allDecisions = [], maxDecisions = 10) {
  if (!Array.isArray(allDecisions) || allDecisions.length === 0) {
    return {
      evaluated_count: 0,
      approvals: 0,
      rejections: 0,
      last_decision: null,
    };
  }

  const sym = (candidate?.symbol || "").toLowerCase().trim();
  const strat = (candidate?.strategy_id || "").toLowerCase().trim();

  const relevant = allDecisions.filter((d) => {
    const dSym = (d.symbol || "").toLowerCase();
    const dStrat = (d.strategy_id || "").toLowerCase();
    return dSym === sym || (strat && dStrat === strat);
  });

  let approvals = 0;
  let rejections = 0;

  for (const d of relevant) {
    const dec = String(d.decision || "").toUpperCase();
    if (dec.includes("APPROVE")) approvals++;
    else if (dec.includes("REJECT") || dec.includes("UNAVAILABLE")) rejections++;
  }

  const last = relevant.length > 0 ? relevant[relevant.length - 1] : null;

  return {
    evaluated_count: relevant.length,
    approvals,
    rejections,
    last_decision: last
      ? {
          symbol: last.symbol,
          side: last.side,
          decision: last.decision,
          rating: last.rating,
          thesis: last.thesis ? last.thesis.slice(0, 150) : "",
          generated_at: last.generated_at,
        }
      : null,
  };
}

/**
 * Main pure deterministic context builder.
 * Accepts candidate and optional in-memory data / files.
 * Returns structured FabRich context ready for Tauric AI.
 */
export function buildFabrichContext(candidate, options = {}) {
  const state = options.state || readJSON(V2.state, null);
  const strategies = options.strategies || readJSON(V2.strategies, { strategies: [] });
  const memory = options.memory || readJSONL(V2.memory, []);
  const trades = options.trades || readJSONL(V2.trades, []);
  const world = options.world || readJSON(V2.world, null);
  const decisions = options.decisions || readJSONL(V2.aiDecisions, []);

  const stratSummary = summarizeStrategyContext(candidate?.strategy_id, strategies);
  const relevantLessons = selectRelevantLessons(candidate, memory, 4);
  const tradeSummary = summarizeRecentTrades(candidate, trades, 5);
  const posSummary = summarizePositions(state);
  const worldSummary = summarizeWorldContext(world);
  const aiSummary = summarizeRecentAiDecisions(candidate, decisions, 8);

  return {
    strategy: stratSummary,
    lessons: relevantLessons.length > 0 ? relevantLessons : "No relevant FabRich lessons available.",
    recent_trades: tradeSummary,
    positions: posSummary,
    world: worldSummary,
    recent_ai: aiSummary,
    metadata: {
      generated_at: iso(),
      candidate_symbol: candidate?.symbol,
      candidate_strategy: candidate?.strategy_id,
      candidate_side: candidate?.side,
      selected_lesson_ids: Array.isArray(relevantLessons) ? relevantLessons.map((l) => l.id) : [],
    },
  };
}

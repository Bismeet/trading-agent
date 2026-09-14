// scripts/v2/engine.mjs — P8/P11 execution engine. 30s continuous cycle or --once.
// [DECISION D01] next-tick barrier: strategy intents from runStrategies are queued
// to pending.v2.json and filled on a later cycle using a fresh observation; risk
// exits (liquidation/stop/target/time/trail) execute immediately in the same cycle.
import {
  V2, readJSON, readJSONL, writeJSON, appendJSONL, loadConfig, now, iso, log,
  fetchQuote, fetchHistory, fetchFx, indicators, regime as computeRegime,
} from "./store.mjs";
import fs from "node:fs";
import path from "node:path";
import {
  emaUpdate, crossedFundingTimestamps, fundingPayment, tradeFee, slippageFraction,
  fillPrice, openPosition, markPosition, unrealizedPnl, sideSign,
} from "./perp.mjs";
import { recordEquityPeak, episodeEndReason, finalizeEpisode, nextEpisode } from "./episode.mjs";
import { ensureStrategies, runStrategies } from "./strategies.mjs";
import { sizeOrder } from "./sizing.mjs";
import { onClose, scoreStrategies, onEpisodeEnd, evolveTick, buildBrainV2 } from "./brain.mjs";
import { causalBias } from "./brain.mjs";
import { shadowEnabled, loadShadowBook, saveShadowBook, openShadow, manageShadow } from "./shadow.mjs";
import { recordExperience, loadLearning, saveLearning, learnConfig } from "./learning.mjs";
import { rankCandidates, applyMemoryBias } from "./learning.mjs";
import { volBucket, trendBucket, rsiBucket, momBucket } from "./learning.mjs";
import { fngBucket, fundingBucket, sessionBucket } from "./learning.mjs";
import { collectWorld } from "./world.mjs";
import { consumeCommands, survivalGate } from "./controls.mjs";
import { agentCouncil } from "./agents.mjs";

const STALE_MS = 5 * 60000; // [DECISION] quote older than 5 minutes is stale

const histCache = { quotes: {}, daily: {}, intraday: {}, lastDailyRefresh: 0, lastIntradayRefresh: 0, strategyCache: {}, cooldowns: {} };

async function gatherData(state, cfg) {
  const t = now();
  const fx = await fetchFx();
  const symbols = [...cfg.watchlist.map((w) => w.symbol), ...cfg.indices.map((i) => i.symbol)];
  const unique = [...new Set(symbols)];
  const prev = readJSON(V2.prices, {});
  const results = await Promise.all(unique.map((s) => fetchQuote(s)));
  const quotes = {};
  unique.forEach((s, i) => {
    let q = results[i];
    if (!q.ok && prev[s]?.ok && t - (prev[s].ts ?? 0) < STALE_MS) {
      q = { ...prev[s], stale: true }; // last-good marked stale (P8)
    }
    q.ts = t;
    // [DECISION D02] INR quotes normalized to USD accounting currency.
    if (q.ok && q.currency === "INR" && fx.rate > 0) q.priceUsd = q.price / fx.rate;
    else if (q.ok) q.priceUsd = q.price;
    quotes[s] = q;
  });
  histCache.quotes = quotes;

  // history refresh: 1y daily every historyRefreshMinutes; 5d/15m crypto ~every 10m
  if (t - histCache.lastDailyRefresh >= cfg.historyRefreshMinutes * 60000) {
    histCache.lastDailyRefresh = t;
    await Promise.all(unique.map(async (s) => {
      try { histCache.daily[s] = await fetchHistory(s, "1y", "1d"); } catch { /* keep old */ }
    }));
  }
  if (t - histCache.lastIntradayRefresh >= 10 * 60000) {
    histCache.lastIntradayRefresh = t;
    await Promise.all(cfg.watchlist.filter((w) => w.market === "crypto").map(async (w) => {
      try { histCache.intraday[w.symbol] = await fetchHistory(w.symbol, "5d", "15m"); } catch { /* keep old */ }
    }));
  }
  // enrich
  for (const [s, q] of Object.entries(quotes)) {
    if (!q.ok) continue;
    const closes = histCache.daily[s];
    if (Array.isArray(closes) && closes.length) Object.assign(q, indicators(closes), { closes });
    if (Array.isArray(histCache.intraday[s])) q.closesIntraday = histCache.intraday[s];
  }
  state.regime = computeRegime(quotes, state.riskState);
  return { quotes, fx };
}

function priceFor(q) {
  return q?.ok && Number.isFinite(q.priceUsd) ? q.priceUsd : null;
}

function marketOf(cfg, symbol) {
  return cfg.watchlist.find((w) => w.symbol === symbol)?.market || "crypto";
}

// Execute a close at the current mark. Returns close record or null.
function closePosition(state, cfg, symbol, mark, reason, t) {
  const pos = state.positions[symbol];
  if (!pos) return null;
  const market = pos.market;
  const exitAction = pos.side === "long" ? "sell" : "buy"; // closing action direction
  const notional = Math.abs(pos.qty * mark);
  const halfSpread = (cfg.slippage[market] ?? 0.0005) / 2;
  const slip = slippageFraction(notional, cfg.slippage[market] ?? 0.02);
  const xPrice = fillPrice(mark, exitAction, halfSpread, slip);
  const gross = (xPrice - pos.entryPrice) * pos.qty * sideSign(pos.side);
  const exitFee = tradeFee(notional, cfg.v2.perpFees.taker);
  // entry fee already left the wallet at open; funding was posted to wallet at accrual,
  // so net trade P&L for learning = gross - exitFee (+ fundingAccrued already in wallet,
  // include it in net_pnl so realized_R reflects the full carry cost).
  const net = gross - exitFee + pos.fundingAccrued;
  const risk = Math.abs(pos.qty * pos.entryPrice * (pos.openMeta.stopPct ?? 0.05)) || pos.isolatedMargin;
  const realizedR = net / risk;
  state.walletBalance += pos.isolatedMargin + gross - exitFee;
  state.realizedPnlEpisode = (state.realizedPnlEpisode ?? 0) + net;
  delete state.positions[symbol];
  const post = {
    kind: "post",
    trade_id: pos.openMeta.trade_id ?? `t_${pos.openedAt}_${symbol}`,
    ts_close: t,
    exit_reason: reason,
    net_pnl: net,
    realized_R: realizedR,
    roi_on_margin: pos.isolatedMargin > 0 ? net / pos.isolatedMargin : null,
    hold_secs: (t - pos.openedAt) / 1000,
  };
  appendJSONL(V2.journal, post);
  // LEARNER (per-trade, immediate): update contextual cell from this outcome.
  // Reconstructs entry context from frozen openMeta (no future leakage: only this
  // trade's own entry context + realized R). Survives episode reset (own file).
  try {
    const L = learnConfig(cfg);
    const store = loadLearning();
    const ctx = {
      regime: pos.openMeta?.setupRegime || pos.openMeta?.regime || state.regime || "unknown",
      strategy: pos.openMeta?.strategy_id || "manual",
      side: pos.side, symbol, market: pos.market || "crypto",
      vol: "unknown", trend: null, rsi: null, mom: null,
      fng: "unknown", funding: "unknown", session: "unknown",
    };
    recordExperience(store, ctx, realizedR, { ts_close: t, exit_reason: reason });
    saveLearning(store);
  } catch (e) { log(`learner update failed: ${e.message}`); }
  appendJSONL(V2.trades, {
    eventId: `f_${t}_${symbol}_close`, ts: t, episodeId: state.episodeId,
    op: "close", side: pos.side, symbol, leverage: pos.leverage, reason,
    price: xPrice, net_pnl: net, trade_id: post.trade_id,
  });
  onClose(state, pos, reason);
  log(`CLOSE ${pos.side.toUpperCase()} ${symbol} @ ${xPrice.toFixed(4)} (${reason}) net ${net.toFixed(2)} USD`);
  return post;
}
// Execute an open order after sizing. [DECISION D02] fee-aware affordability and
// minimum-notional enforcement at fill; entry price is the adverse fill, not the mark.
function executeOpen(state, cfg, order, q, t) {
  const market = marketOf(cfg, order.symbol);
  const ref = priceFor(q);
  if (ref == null || ref <= 0) return false;
  const notionalEst = order.marginUsd * order.leverage;
  const halfSpread = (cfg.slippage[market] ?? 0.0005) / 2;
  const slip = slippageFraction(notionalEst, cfg.slippage[market] ?? 0.02);
  const entry = fillPrice(ref, order.side, halfSpread, slip);
  const tiers = cfg.v2.maintenanceTiers[market];
  const pos = openPosition({
    symbol: order.symbol, market, side: order.side, entryMark: entry,
    margin: order.marginUsd, leverage: order.leverage, tiers,
    meta: {
      trade_id: order.trade_id, strategy_id: order.strategy_id ?? null,
      setup_tag: order.setup_tag ?? null, stopPct: order.stopPct ?? null,
      targetPct: order.targetPct ?? null, reason: order.reason ?? null,
      regime: state.regime, setupRegime: order.setupRegime ?? state.regime,
      baseScore: order.baseScore ?? null, finalScore: order.finalScore ?? null,
      quality: order.quality ?? null,
    },
  }, t);
  const fee = tradeFee(pos.notional, cfg.v2.perpFees.taker);
  if (order.marginUsd + fee > state.walletBalance) return false; // cannot afford
  if (pos.notional < cfg.v2.strategies.minNotionalUsd) return false; // min notional at fill
  pos.entryFeePaid = fee;
  pos.feesPaid = fee;
  pos.mark = entry;
  state.walletBalance -= order.marginUsd + fee;
  state.positions[order.symbol] = pos;
  appendJSONL(V2.journal, {
    kind: "pre", trade_id: pos.openMeta.trade_id, ts: t,
    symbol: order.symbol, market, side: order.side,
    strategy_id: pos.openMeta.strategy_id, setup_tag: pos.openMeta.setup_tag,
    regime: order.setupRegime ?? state.regime, leverage: order.leverage,
    margin: order.marginUsd, entry,
  });
  appendJSONL(V2.trades, {
    eventId: `f_${t}_${order.symbol}_open`, ts: t, episodeId: state.episodeId,
    op: "open", side: order.side, symbol: order.symbol, leverage: order.leverage,
    reason: order.reason, price: entry, margin: order.marginUsd, trade_id: pos.openMeta.trade_id,
  });
  log(`OPEN ${order.side.toUpperCase()} ${order.symbol} ${order.leverage}x @ ${entry.toFixed(4)} margin ${order.marginUsd.toFixed(2)} (${order.reason ?? "manual"})`);
  return true;
}

// markAndManage: EMA marks, funding accrual, exits in strict source order.
// FIX (audit §17): stale quotes still MARK + EXIT (last-good px), only new
// ENTRIES are blocked on stale. Previously stale skipped management entirely.
function markAndManage(state, cfg, quotes, t) {
  let closedAny = false;
  for (const [symbol, pos] of Object.entries(state.positions || {})) {
    const q = quotes[symbol];
    let px = priceFor(q);
    if (px == null) {
      const fallback = Number(pos.mark);
      if (!Number.isFinite(fallback)) continue;
      px = fallback; // last-good mark: manage but never open on it
    }
    // funding at crossed UTC boundaries, latest known rate (P8 collects after accrual)
    if (pos.market === "crypto" && cfg.v2.leverage.crypto.funding && Number.isFinite(state.fundingRate)) {
      const crossed = crossedFundingTimestamps(pos.lastFundingTs, t, cfg.v2.fundingHoursUTC);
      for (const fts of crossed) {
        const pay = fundingPayment(Math.abs(pos.qty * pos.mark), state.fundingRate, pos.side);
        pos.fundingAccrued += pay;
        state.walletBalance += pay; // funding posted to free wallet, once per boundary
        pos.lastFundingTs = fts;
      }
    }
    const mk = markPosition(pos, pos.mark);
    pos.peakUPnl = Math.max(pos.peakUPnl ?? 0, mk.uPnl);
    // exit order: liquidation -> stop -> target -> time -> trailing
    const stopPct = pos.openMeta.stopPct, targetPct = pos.openMeta.targetPct;
    if (mk.liquidated) {
      closedAny |= !!closePosition(state, cfg, symbol, pos.mark, "liquidation", t);
      continue;
    }
    if (stopPct != null) {
      const stop = pos.entryPrice * (1 - sideSign(pos.side) * stopPct);
      if ((pos.side === "long" && pos.mark <= stop) || (pos.side === "short" && pos.mark >= stop)) {
        closedAny |= !!closePosition(state, cfg, symbol, pos.mark, "stop-loss", t);
        continue;
      }
    }
    if (targetPct != null) {
      const tgt = pos.entryPrice * (1 + sideSign(pos.side) * targetPct);
      if ((pos.side === "long" && pos.mark >= tgt) || (pos.side === "short" && pos.mark <= tgt)) {
        closedAny |= !!closePosition(state, cfg, symbol, pos.mark, "take-profit", t);
        continue;
      }
    }
    const holdH = (t - pos.openedAt) / 3600000;
    if (holdH >= cfg.v2.aggression.maxHoldHours) {
      closedAny |= !!closePosition(state, cfg, symbol, pos.mark, "time-stop", t);
      continue;
    }
    // trailing: activate peak ROI >= .5, close on giveback of .25 ROI points (docs/08)
    if (pos.isolatedMargin > 0) {
      const peakRoi = pos.peakUPnl / pos.isolatedMargin;
      const curRoi = mk.uPnl / pos.isolatedMargin;
      if (peakRoi >= cfg.v2.aggression.trailActivateRoi && peakRoi - curRoi >= cfg.v2.aggression.trailGiveRoi) {
        closedAny |= !!closePosition(state, cfg, symbol, pos.mark, "trailing-stop", t);
      }
    }
  }
  return closedAny;
}

function computeEquity(state) {
  let eq = state.walletBalance;
  for (const pos of Object.values(state.positions || {})) {
    const mark = pos.mark ?? pos.entryPrice;
    eq += pos.isolatedMargin + unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  }
  state.equity = eq;
  return eq;
}

// publishSignals: full P8 schema.
// Phase 2 §16: compact learning diagnostics for the dashboard. Read-only from the
// learner store + last decisions; never mutates learning state.
function learningSummary(L) {
  const store = loadLearning();
  const cells = Object.entries(store.cells || {});
  const nOf = (c) => Math.round(c.n ?? 0);
  const stats = cells.map(([key, c]) => ({ key, n: nOf(c), expectancyR: c.n > 0 ? c.sumR / c.n : 0 }));
  const last = readJSONL(V2.learnDecisions, 1)[0];
  let abstain = 0, total = 0;
  for (const row of readJSONL(V2.learnDecisions, 200)) {
    for (const e of row.entries || []) {
      total += 1;
      if (String(e.decision).startsWith("ABSTAIN")) abstain += 1;
    }
  }
  // Phase 4 §18: candidate/shadow/cohort counters + honest confidence (read-only,
  // bounded reads; never mutates anything). No fake "AI confidence" percentage.
  const auditTail = readJSONL(V2.candidates, 2000);
  let candTotal = 0;
  const firing = new Set(), regimes = new Set(), sides = new Set();
  let cohorts = 0;
  for (const r of auditTail) {
    const bySym = new Map();
    for (const row of r.rows || []) {
      if (!row.fired) continue;
      candTotal += 1;
      firing.add(row.strategy_id);
      regimes.add(row.setupRegime ?? r.regime ?? "unknown");
      if (row.side) sides.add(row.side);
      if (!bySym.has(row.symbol)) bySym.set(row.symbol, new Set());
      bySym.get(row.symbol).add(row.strategy_id);
    }
    for (const s of bySym.values()) if (s.size >= 2) cohorts += 1;
  }
  const shadowResolved = readJSONL(V2.shadowTrades, 5000).length;
  let shadowOpen = 0;
  try { shadowOpen = Object.keys(readJSON(V2.shadowOpen, { open: {} }).open || {}).length; } catch { /* absent */ }
  const executedDist = {};
  let executedN = 0;
  const preBy = new Map(); // post rows lack strategy_id; join via the pre row
  for (const r of readJSONL(V2.journal, 5000)) {
    if (r?.kind === "pre") preBy.set(r.trade_id, r);
  }
  for (const p of readJSONL(V2.journal, 5000)) {
    if (p?.kind !== "post") continue;
    executedN += 1;
    const sid = preBy.get(p.trade_id)?.strategy_id ?? "unknown";
    executedDist[sid] = (executedDist[sid] ?? 0) + 1;
  }
  const why = [];
  if (firing.size <= 1) why.push("only one strategy has produced candidates");
  if (regimes.size <= 1) why.push("only one regime observed");
  if (sides.size <= 1) why.push("only one side observed");
  if (cohorts === 0) why.push("no multi-strategy decision cohorts");
  if (stats.filter((s) => s.n >= 5).length === 0) why.push("no cell has n>=5 observations");
  return {
    cells: cells.length,
    experiences: store.experiences ?? 0,
    cells5: stats.filter((s) => s.n >= 5).length,
    cells20: stats.filter((s) => s.n >= 20).length,
    blocked: stats.filter((s) => s.n >= L.blockMinN && s.expectancyR < L.blockEdge).length,
    abstainRate: total > 0 ? abstain / total : null,
    top: [...stats].sort((a, b) => b.n - a.n).slice(0, 6),
    lastDecisions: last?.entries ?? [],
    // Phase 4 §18
    candidates: candTotal,
    executedCount: executedN,
    shadowOpened: shadowResolved + shadowOpen,
    shadowResolved,
    cohorts,
    strategyDistribution: executedDist,
    confidence: why.length ? "INSUFFICIENT DATA" : "DEVELOPING",
    confidenceWhy: why.join("; ") || "multiple strategies/regimes/sides observed",
  };
}

function publishSignals(state, cfg, quotes, world) {
  const eq = state.equity;
  const g = state.goal;
  const positions = Object.entries(state.positions || {}).map(([symbol, pos]) => {
    const mark = pos.mark ?? pos.entryPrice;
    const uPnl = unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
    const w = cfg.watchlist.find((x) => x.symbol === symbol);
    return {
      symbol, name: w?.name ?? symbol, market: pos.market, side: pos.side,
      leverage: pos.leverage, notional: Math.abs(pos.qty * mark), margin: pos.isolatedMargin,
      entry: pos.entryPrice, mark, liqPrice: pos.liqPrice, uPnl,
      roiPct: pos.isolatedMargin > 0 ? (100 * uPnl) / pos.isolatedMargin : null,
      fundingAccrued: pos.fundingAccrued, setup_tag: pos.openMeta.setup_tag,
      strategy_id: pos.openMeta.strategy_id, stopPct: pos.openMeta.stopPct,
      targetPct: pos.openMeta.targetPct, reason: pos.openMeta.reason,
    };
  });
  const investedNotional = positions.reduce((a, p) => a + p.notional, 0);
  const progressPct = g && g.target > g.startEquity ? (100 * (eq - g.startEquity)) / (g.target - g.startEquity) : null;
  const signals = {
    ts: now(), iso: iso(), version: 2,
    episodeNum: state.episodeNum, episodeId: state.episodeId,
    equity: eq, walletBalance: state.walletBalance, startingCapital: state.startingCapital,
    goal: g, totalPnl: eq - state.startingCapital,
    totalPnlPct: state.startingCapital > 0 ? (100 * (eq - state.startingCapital)) / state.startingCapital : null,
    progressPct, goalGap: g ? g.target - eq : null,
    realizedPnlEpisode: state.realizedPnlEpisode, peakEquity: state.peakEquity,
    maxDrawdownPct: state.maxDrawdownPct, riskState: state.riskState, regime: state.regime,
    generation: state.generation, aggression: state.aggression, lifetime: state.lifetime,
    fundingRate: state.fundingRate ?? null, investedNotional,
    grossLeverage: eq > 0 ? investedNotional / eq : null,
    survival: state.survival ?? { enabled: false },
    survivalBlocked: survivalGate(state).blocked,
    agents: readJSONL(V2.agents, 1)[0] ?? null, // last deliberation (owner extension)
    learning: learningSummary(learnConfig(cfg)), // Phase 2 diagnostics for the dashboard
    positions,
    watch: cfg.watchlist.map((w) => {
      const q = quotes[w.symbol] || {};
      return { symbol: w.symbol, name: w.name, market: w.market, price: priceFor(q), changePct: q.changePct ?? null, trend: q.trend ?? null, bias: q.bias ?? null, rsi: q.rsi ?? null, mom: q.mom ?? null, stale: !!q.stale, ok: !!q.ok };
    }),
    brain: buildBrainV2(state, state.regime),
    world: world ?? null,
  };
  writeJSON(V2.signals, signals);
  return signals;
}

async function cycle(cfg) {
  const t = now();
  const state = readJSON(V2.state, null);
  if (!state) {
    log("No state. Run: node scripts/v2/init.mjs");
    return;
  }
  state.cycles = (state.cycles ?? 0) + 1;

  // 0. owner commands from the dashboard control panel
  for (const c of consumeCommands(state, cfg)) log(`command applied: ${c.type} ${JSON.stringify(c)}`);

  // 1-2. data + enrichment + regime
  const { quotes } = await gatherData(state, cfg);

  // 3. mark & manage (liquidation -> stop -> target -> time -> trail)
  const closedByRisk = markAndManage(state, cfg, quotes, t);

  // 4. equity
  computeEquity(state);

  // 5. process previously queued pending orders (next-tick barrier fills, D01)
  const pending = readJSON(V2.pending, { orders: [] });
  const remaining = [];
  for (const o of pending.orders || []) {
    const q = quotes[o.symbol];
    if (!q || !q.ok || q.stale || (o.createdAt && t <= o.createdAt)) { remaining.push(o); continue; }
    if (o.op === "close") {
      const px = priceFor(q);
      if (px != null && state.positions[o.symbol]) {
        const pos = state.positions[o.symbol];
        closePosition(state, cfg, o.symbol, pos.mark ?? px, o.reason ?? "strategy-exit", t);
      }
    } else {
      if (Object.keys(state.positions).length >= cfg.v2.strategies.maxConcurrentPositions) { remaining.push(o); continue; }
      if (state.positions[o.symbol]) {
        // Phase 3 attribution (case G): selected but could not execute.
        appendJSONL(V2.candidates, { ts: t, episodeId: state.episodeId, cycle: state.cycles, regime: state.regime, rows: [{
          symbol: o.symbol, strategy_id: o.strategy_id ?? null, setup_tag: o.setup_tag ?? null,
          fired: true, side: o.side, baseScore: o.baseScore ?? null, reason: o.reason ?? null,
          setupRegime: o.setupRegime ?? state.regime, status: "selected-execute-failed", rejectReason: "already-open", learner: null, rank: null,
        }] });
        continue;
      }
      const sized = sizeOrder(state, o, computeEquity(state), cfg, histCache);
      if (sized.marginUsd > 0) executeOpen(state, cfg, sized, q, t);
      else {
        // Phase 3 attribution (case G): unaffordable -> never executed.
        appendJSONL(V2.candidates, { ts: t, episodeId: state.episodeId, cycle: state.cycles, regime: state.regime, rows: [{
          symbol: o.symbol, strategy_id: o.strategy_id ?? null, setup_tag: o.setup_tag ?? null,
          fired: true, side: o.side, baseScore: o.baseScore ?? null, reason: o.reason ?? null,
          setupRegime: o.setupRegime ?? state.regime, status: "selected-execute-failed", rejectReason: "unaffordable", learner: null, rank: null,
        }] });
      }
    }
  }
  const eq = computeEquity(state);

  // 6. strategies -> LEARNER rank -> council -> queue for LATER tick (D01)
  // Survival mode: no new entries while underwater; 5x leverage cap otherwise.
  // Learner NEVER bypasses risk: it only reorders/filters/weights; council +
  // survival + sizing caps below still dominate.
  const gate = survivalGate(state);
  const { orders: rawIntents, evaluated } = gate.blocked
    ? { orders: [], evaluated: [] }
    : runStrategies(state, eq, cfg, histCache);
  const worldSnap = readJSON(V2.world, null);
  const L = learnConfig(cfg);
  const learnStore = loadLearning();

  // ---- Phase 3 candidate attribution: one audit row per (symbol x strategy) ----
  const auditRows = (evaluated || []).map((e) => ({
    symbol: e.symbol, strategy_id: e.strategy_id, setup_tag: e.setup_tag,
    fired: !!e.fired, side: e.side, baseScore: e.baseScore, reason: e.reason,
    setupRegime: state.regime, status: e.fired ? "candidate" : "no-signal",
    learner: null, rank: null, rejectReason: gate.blocked ? "survival-blocked" : null,
  }));
  const auditBy = new Map(auditRows.filter((r) => r.fired).map((r) => [`${r.symbol}|${r.strategy_id}`, r]));
  // Phase 4: join trade_id onto fired audit rows (links audit to fills for
  // execution-failure detection in live-learning-health.mjs).
  for (const o of rawIntents) {
    if (o.op !== "open") continue;
    const row = auditBy.get(`${o.symbol}|${o.strategy_id}`);
    if (row && !row.trade_id) row.trade_id = o.trade_id;
  }
  // attach full context (vol/fng/funding/session buckets) then rank per symbol
  const bySymbol = new Map();
  for (const o of rawIntents) {
    if (o.op !== "open") {
      if (!bySymbol.has(o.symbol)) bySymbol.set(o.symbol, { closes: [], opens: [] });
      bySymbol.get(o.symbol).closes.push(o);
      continue;
    }
    const q = histCache.quotes?.[o.symbol];
    const ctx = {
      regime: o.setupRegime || state.regime || "unknown",
      strategy: o.strategy_id, side: o.side, symbol: o.symbol,
      market: marketOf(cfg, o.symbol),
      vol: volBucket(q?.closes), trend: trendBucket(q), rsi: rsiBucket(q),
      mom: momBucket(q), fng: fngBucket(worldSnap),
      funding: fundingBucket(worldSnap, state), session: sessionBucket(t),
      symbolCtx: o.symbol,
    };
    o.ctx = ctx;
    if (!bySymbol.has(o.symbol)) bySymbol.set(o.symbol, { closes: [], opens: [] });
    bySymbol.get(o.symbol).opens.push(o);
  }
  // rank + abstain + same-setup concentration cap (per cycle AND portfolio-wide).
  // Portfolio-wide cap counts: existing positions + pending orders + intents already
  // accepted this cycle for the same strategy|regime|side. Ordering cannot bypass:
  // the count is checked against live state + queue, not just this cycle's picks.
  const setupSeen = new Map();
  const setupKey = (strategyId, regime, side) => `${strategyId}|${regime}|${side}`;
  const liveSetupCount = (strategyId, regime, side) => {
    let n = setupSeen.get(setupKey(strategyId, regime, side)) ?? 0;
    for (const p of Object.values(state.positions || {})) {
      if ((p.openMeta?.strategy_id ?? p.strategy_id) === strategyId &&
        (p.openMeta?.setupRegime ?? p.openMeta?.regime ?? state.regime) === regime &&
        p.side === side) n++;
    }
    for (const q of pending?.orders || []) {
      if (q.op === "open" && q.strategy_id === strategyId &&
        (q.setupRegime ?? state.regime) === regime && q.side === side) n++;
    }
    return n;
  };
  const rankedOpens = [];
  const learnLog = [];
  for (const [symbol, g] of bySymbol) {
    rankedOpens.push(...g.closes);
    if (!g.opens.length) continue;
    const cands = g.opens.map((o) => ({ order: o, ctx: o.ctx, baseScore: o.baseScore ?? o.confidence ?? 0.5 }));
    const ranked = rankCandidates(cands, learnStore, L);
    applyMemoryBias(ranked.scored, causalBias(state)); // structured lessons now causal
    ranked.scored.sort((a, b) => b.finalScore - a.finalScore);
    ranked.eligible = ranked.scored.filter((s) => !s.learn.blocked);
    ranked.best = ranked.eligible[0] || null;
    ranked.abstain = !ranked.best || ranked.best.learn.ucb < L.noTradeUcb || ranked.best.quality < L.noTradeQuality;
    const { scored, eligible, best, abstain } = ranked;
    // Phase 3 attribution: learner snapshot + rank per candidate
    for (let i = 0; i < scored.length; i++) {
      const row = auditBy.get(`${symbol}|${scored[i].order.strategy_id}`);
      if (row) {
        row.learner = {
          n: scored[i].learn.n, adjExp: scored[i].learn.adjExp, ucb: scored[i].learn.ucb,
          quality: scored[i].quality, finalScore: scored[i].finalScore,
        };
        row.rank = i + 1;
        if (scored[i].learn.blocked) { row.status = "candidate-rejected-learner"; row.rejectReason = "blocked"; }
      }
    }
    const why = scored.map((s) => {
      const st2 = s.learn.blocked ? "BLOCKED" : s.finalScore === best?.finalScore ? "selected" : "rejected";
      return `${s.order.strategy_id}: base=${s.baseScore.toFixed(3)} n=${s.learn.n} adjExp=${s.learn.adjExp.toFixed(3)} ucb=${s.learn.ucb.toFixed(3)} q=${s.quality.toFixed(2)} final=${s.finalScore.toFixed(3)} status=${st2}${s.learn.n < 3 ? " (insufficient-data)" : ""}${s.memoryWhy ? ` mem:${s.memoryWhy}` : ""}`;
    }).join(" | ");
    if (abstain || !best) {
      learnLog.push({ ts: t, episodeId: state.episodeId, symbol, decision: "ABSTAIN_LEARNER", reason: !best ? "all candidates learned-blocked" : `best ucb ${best.learn.ucb.toFixed(3)} / q ${best.quality.toFixed(2)} below thresholds`, regime: state.regime, candidates: why });
      for (const s of scored) {
        const row = auditBy.get(`${symbol}|${s.order.strategy_id}`);
        if (row) { row.status = "candidate-rejected-learner"; row.rejectReason = (row.rejectReason ?? "") + "abstain-ctx"; }
      }
      continue;
    }
    const key = `${best.order.strategy_id}|${state.regime}|${best.order.side}`;
    const capCycle = L.maxSetupPerCycle ?? 2;
    const capPort = L.maxSameSetupPositions ?? 2;
    const usedCycle = setupSeen.get(key) ?? 0;
    const usedLive = liveSetupCount(best.order.strategy_id, state.regime, best.order.side);
    if (usedCycle >= capCycle || usedLive >= capPort) {
      learnLog.push({ ts: t, episodeId: state.episodeId, symbol, decision: "CAPPED", reason: `same-setup ${key} cycle ${usedCycle}/${capCycle}, live ${usedLive}/${capPort}`, regime: state.regime, candidates: why });
      const brow = auditBy.get(`${symbol}|${best.order.strategy_id}`);
      if (brow) { brow.status = "candidate-rejected-cap"; brow.rejectReason = `same-setup cap`; }
      for (const s of scored) {
        if (s === best) continue;
        const row = auditBy.get(`${symbol}|${s.order.strategy_id}`);
        if (row && row.status === "candidate") { row.status = "candidate-rejected-learner"; row.rejectReason = "rank-lost"; }
      }
      continue;
    }
    setupSeen.set(key, usedCycle + 1);
    best.order.finalScore = best.finalScore;
    best.order.quality = best.quality;
    best.order.sizeMult = best.sizeMult; // sizing applies, clamped by hard caps
    best.order.learnExplain = { ucb: best.learn.ucb, adjExp: best.learn.adjExp, n: best.learn.n, level: best.learn.level };
    rankedOpens.push(best.order);
    learnLog.push({ ts: t, episodeId: state.episodeId, symbol, decision: "SELECT", selected: best.order.strategy_id, finalScore: best.finalScore, regime: state.regime, candidates: why });
    const brow2 = auditBy.get(`${symbol}|${best.order.strategy_id}`);
    if (brow2) { brow2.status = "selected"; brow2.rejectReason = null; }
    for (const s of scored) {
      if (s === best) continue;
      const row = auditBy.get(`${symbol}|${s.order.strategy_id}`);
      if (row && row.status === "candidate") { row.status = "candidate-rejected-learner"; row.rejectReason = "rank-lost"; }
    }
  }
  if (learnLog.length) appendJSONL(V2.learnDecisions, { ts: t, episodeId: state.episodeId, entries: learnLog });
  // council uses the last collected world snapshot (step 8 refreshes it after execution)
  const council = agentCouncil(rankedOpens, state, cfg, worldSnap, quotes);
  if (council.log.length) {
    log(`agents: ${council.approved.length} approved, ${council.rejected.length} vetoed ` +
      council.rejected.map((r) => `${r.symbol}(${r.verdicts.find((v) => v.vote === "veto")?.agent})`).join(", "));
  }
  const newOrders = council.approved;
  if (!gate.blocked && Number.isFinite(gate.maxLev)) {
    for (const o of newOrders) o.leverage = Math.min(o.leverage, gate.maxLev);
  }
  // Phase 3 attribution (case E): council veto flips "selected" -> council-vetoed.
  for (const r of council.rejected) {
    const row = auditBy.get(`${r.symbol}|${r.strategy_id ?? ""}`);
    if (row && row.status === "selected") {
      row.status = "selected-council-vetoed";
      row.rejectReason = `council:${r.verdicts.find((v) => v.vote === "veto")?.agent ?? "?"}`;
    }
  }
  // Persist the per-cycle candidate audit (one JSONL line per cycle).
  if (auditRows.length) appendJSONL(V2.candidates, {
    ts: t, episodeId: state.episodeId, cycle: state.cycles, regime: state.regime, rows: auditRows,
  });
  // ---- Phase 3 shadow layer: candidates that were NOT executed (spec §3/§6) ----
  // Shadow P&L is isolated in V2.shadowOpen/shadowTrades and NEVER feeds the live
  // learner or account. Entries use the T quote with the engine's adverse fill.
  if (shadowEnabled(cfg)) {
    const shCfg = cfg.v2.shadow || {};
    const shadowBook = loadShadowBook();
    const approvedIds = new Set(council.approved.map((o) => o.trade_id));
    const cooldownMs = shCfg.cooldownMs ?? 600000;
    const maxOpen = shCfg.maxOpen ?? 100;
    let openCount = Object.keys(shadowBook.open).length;
    // Phase 4 §5: which strategy the learner actually selected per symbol this cycle,
    // so each shadow record can name the alternative that beat it (decision cohort).
    const selectedBySymbol = new Map();
    for (const r of auditRows) if (r.status === "selected") selectedBySymbol.set(r.symbol, r.strategy_id);
    for (const [sym, g] of bySymbol) {
      for (const o of g.opens) {
        if (approvedIds.has(o.trade_id)) continue; // real intent (may execute next tick)
        if (openCount + 1 > maxOpen) continue;     // bounded by design
        const dup = Object.values(shadowBook.open).some((r) =>
          r.pos?.symbol === sym && r.pos?.openMeta?.strategy_id === o.strategy_id &&
          (t - r.decisionTs) < cooldownMs);
        if (dup) continue; // avoid opening the same setup every 30s cycle
        const row = auditBy.get(`${sym}|${o.strategy_id}`);
        const rejectReason = row
          ? (row.status === "selected-council-vetoed" ? `council-veto`
            : row.status === "candidate-rejected-cap" ? `cap`
            : row.status === "candidate-rejected-learner" ? (row.rejectReason ?? "learner-lost")
            : "not-executed")
          : "not-executed";
        const quote = histCache.quotes?.[sym];
        if (openShadow(shadowBook, cfg, {
          ...o, decisionTs: t, rejectReason, market: marketOf(cfg, sym),
          learner: row?.learner ?? null, regime: state.regime,
          baseScore: row?.baseScore ?? o.baseScore ?? null,
          learnerScore: row?.learner?.finalScore ?? null,
          rank: row?.rank ?? null,
          actualSelectedStrategy: selectedBySymbol.get(sym) ?? null,
        }, quote, t)) openCount += 1;
      }
    }
    manageShadow(shadowBook, cfg, quotes, t, state.fundingRate);
    saveShadowBook(shadowBook);
  }
  writeJSON(V2.pending, { orders: [...remaining, ...newOrders] });

  // 7. episode lifecycle
  recordEquityPeak(state);
  const reason = episodeEndReason(state, cfg, t);
  if (reason) {
    // settle survivors at mark before finalizing (docs/07 recommendation)
    for (const symbol of Object.keys(state.positions || {})) {
      const pos = state.positions[symbol];
      closePosition(state, cfg, symbol, pos.mark ?? pos.entryPrice, "episode-end", t);
    }
    computeEquity(state);
    recordEquityPeak(state);
    const rec = finalizeEpisode(state, reason);
    onEpisodeEnd(state, cfg, rec);
    nextEpisode(state, cfg);
    writeJSON(V2.pending, { orders: [] }); // old-run intents never enter the new run
    log(`EPISODE ${rec.episodeNum} END (${reason}) final $${rec.finalEquity.toFixed(2)} return ${rec.returnPct.toFixed(1)}%`);
  } else if (closedByRisk) {
    scoreStrategies(state, cfg);
  }
  if (t - (state.lastBrainTs ?? 0) >= cfg.v2.strategies.brainLoopMinutes * 60000) {
    state.lastBrainTs = t;
    evolveTick(state, cfg);
  }

  // 8. world + persistence
  let world = null;
  try { world = await collectWorld(cfg, state); } catch (e) { log(`world collect failed: ${e.message}`); }
  state.updatedAt = t;
  writeJSON(V2.state, state);
  writeJSON(V2.prices, quotes);
  appendJSONL(V2.equity, { ts: t, episodeId: state.episodeId, episodeNum: state.episodeNum, equity: state.equity });
  publishSignals(state, cfg, quotes, world);
  writeJSON(V2.heartbeat, {
    ts: t, pid: process.pid, cycle: state.cycles,
    episodeNum: state.episodeNum, episodeId: state.episodeId,
    snapshotId: `${state.episodeId}:cycle_${state.cycles}:${t}`,
  });
  log(`cycle ${state.cycles} ep${state.episodeNum} equity $${state.equity.toFixed(2)} positions ${Object.keys(state.positions).length} regime ${state.regime}`);
}

// ---- entry point ----
const once = process.argv.includes("--once");
const cfg = loadConfig();
ensureStrategies();

// Single-instance lock + graceful shutdown (production hardening).
const LOCK = path.join(DATA_DIR(), "engine.v2.lock");
function DATA_DIR() { return path.dirname(V2.state); }
function acquireLock() {
  try {
    const fd = fs.openSync(LOCK, "wx");
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    try {
      const pid = parseInt(fs.readFileSync(LOCK, "utf8"), 10);
      process.kill(pid, 0); // throws if dead
      console.error(`Another engine instance is running (pid ${pid}). Exiting.`);
      process.exit(1);
    } catch { /* stale lock */ }
    fs.rmSync(LOCK, { force: true });
    fs.writeFileSync(LOCK, String(process.pid));
  }
  const release = () => { try { fs.rmSync(LOCK, { force: true }); } catch { /* ignore */ } };
  process.on("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => { log(`received ${sig}, shutting down cleanly`); release(); process.exit(0); });
  }
}

if (once) {
  cycle(cfg).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
} else {
  acquireLock();
  const loopSec = cfg.v2.strategies.loopSeconds; // 30s v2 cadence (P11)
  log(`engine starting; cycle every ${loopSec}s. Paper trading only - fake money, real lessons.`);
  let running = false;
  const tick = async () => {
    if (running) return; // [DECISION] no overlapping cycles if a cycle exceeds the cadence
    running = true;
    try { await cycle(cfg); } catch (e) { log(`cycle error: ${e.message}`); } finally { running = false; }
  };
  tick();
  setInterval(tick, loopSec * 1000);
}

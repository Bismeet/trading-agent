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
import { collectWorld } from "./world.mjs";
import { consumeCommands, survivalGate } from "./controls.mjs";
import { agentCouncil } from "./agents.mjs";
import { enqueueCandidate, drainAndProcessAiQueue, getValidApprovedIntents } from "./ai_gate.mjs";

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
      regime: state.regime, ai: order.aiDecision ?? null,
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
    regime: state.regime, leverage: order.leverage, margin: order.marginUsd, entry,
    ai: order.aiDecision ?? null,
  });
  appendJSONL(V2.trades, {
    eventId: `f_${t}_${order.symbol}_open`, ts: t, episodeId: state.episodeId,
    op: "open", side: order.side, symbol: order.symbol, leverage: order.leverage,
    reason: order.reason, price: entry, margin: order.marginUsd, trade_id: pos.openMeta.trade_id,
    ai: order.aiDecision ?? null,
  });
  log(`OPEN ${order.side.toUpperCase()} ${order.symbol} ${order.leverage}x @ ${entry.toFixed(4)} margin ${order.marginUsd.toFixed(2)} (${order.reason ?? "manual"})`);
  return true;
}

// markAndManage: EMA marks, funding accrual, exits in strict source order.
function markAndManage(state, cfg, quotes, t) {
  let closedAny = false;
  for (const [symbol, pos] of Object.entries(state.positions || {})) {
    const q = quotes[symbol];
    const px = priceFor(q);
    if (px == null) continue; // no marking on missing/stale-free data
    if (q.stale) continue; // do not trade or smooth on stale observations
    pos.mark = emaUpdate(pos.mark ?? null, px, cfg.v2.markEmaAlpha);
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
    snapshotId: state.snapshotId ?? null, cycle: state.cycles ?? null,
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
      if (state.positions[o.symbol]) continue; // already open; drop intent
      const sized = sizeOrder(state, o, computeEquity(state), cfg, histCache);
      if (sized.marginUsd > 0) executeOpen(state, cfg, sized, q, t);
    }
  }
  const eq = computeEquity(state);

  // 6. run strategies -> AI gate -> agent council -> survivors queue for a LATER tick (D01)
  // Survival mode: no new entries while underwater; 5x leverage cap otherwise.
  const gate = survivalGate(state);
  const rawIntents = gate.blocked ? [] : runStrategies(state, eq, cfg, histCache);

  let candidatesForCouncil = rawIntents;
  if (cfg?.v2?.ai?.enabled) {
    for (const intent of rawIntents) {
      const q = quotes?.[intent.symbol];
      enqueueCandidate(intent, q, state, cfg);
    }
    drainAndProcessAiQueue(cfg, state);
    candidatesForCouncil = getValidApprovedIntents(cfg, t);
  }

  // council uses the last collected world snapshot (step 8 refreshes it after execution)
  const council = agentCouncil(candidatesForCouncil, state, cfg, readJSON(V2.world, null), quotes);
  if (council.log.length) {
    log(`agents: ${council.approved.length} approved, ${council.rejected.length} vetoed ` +
      council.rejected.map((r) => `${r.symbol}(${r.verdicts.find((v) => v.vote === "veto")?.agent})`).join(", "));
  }
  const newOrders = council.approved;
  if (!gate.blocked && Number.isFinite(gate.maxLev)) {
    for (const o of newOrders) o.leverage = Math.min(o.leverage, gate.maxLev);
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
  try { world = await collectWorld(cfg, state); } catch (e) { log(`[ep_${state.episodeId} cycle_${state.cycles}] world collect failed: ${e.message}`); }
  state.updatedAt = t;
  // [RELIABILITY F01] snapshotId ties state+signals to one cycle so the API/UI
  // can detect torn cross-file reads instead of mixing numbers from two cycles.
  state.snapshotId = `${state.episodeId}:cycle_${state.cycles}:${t}`;
  writeJSON(V2.state, state);
  writeJSON(V2.prices, quotes);
  appendJSONL(V2.equity, { ts: t, episodeId: state.episodeId, episodeNum: state.episodeNum, equity: state.equity });
  publishSignals(state, cfg, quotes, world);
  // [RELIABILITY F04] heartbeat: so the dashboard can prove the engine is alive
  // (browser refresh/reconnect just re-reads files; engine never depends on UI).
  try { writeJSON(V2.heartbeat, { ts: now(), pid: process.pid, cycle: state.cycles, episodeNum: state.episodeNum, episodeId: state.episodeId, snapshotId: state.snapshotId }); } catch { /* non-fatal */ }
  log(`[ep_${state.episodeId} cycle_${state.cycles}] event=cycle_done equity $${state.equity.toFixed(2)} positions ${Object.keys(state.positions).length} regime ${state.regime}`);
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

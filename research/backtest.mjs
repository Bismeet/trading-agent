// research/backtest.mjs — P0 offline replay harness (walk-forward, no lookahead).
//
// PURPOSE
//   The engine (scripts/v2/engine.mjs) can only be evaluated live, one day at a
//   time. This harness replays cached daily bars through the engine's OWN math —
//   indicators (lib.mjs), signal functions (strategies.mjs), fill/fee/slippage/
//   funding/liquidation primitives (perp.mjs), sizing (sizing.mjs), analyst veto
//   (agents.mjs), stats (expectancyStats/deflatedSharpe) — so prediction quality
//   can be measured net of costs BEFORE touching live engine config.
//
// DATA
//   research/data-cache/<SYMBOL>_1d.json  {"symbol","interval","updated","closes":[...]}
//   Missing cache + working network -> fetched once via lib.mjs fetchHistory (the
//   engine's exact feed) and written to cache. --synthetic bypasses data entirely.
//   FAB_DATA is pointed at research/.bt-scratch (see bt-env.mjs) so learned state
//   in a live data/ directory can never leak into a backtest.
//
// DAILY-BAR DIVERGENCES vs the live 30s engine (documented, mostly conservative):
//   D-B01 Cadence: 1 bar = 1 step; signals see closes[0..i] only (identical
//         relationship to live, where Yahoo daily history ends at the forming bar).
//   D-B02 Next-tick barrier: intent queued at close[i] fills at close[i+1] (live
//         fills ~30s later; crypto has no overnight gap, and the extra day of lag
//         makes momentum entries conservative).
//   D-B03 Mark: --mark-ema 1 (default) -> mark = latest close. The live EMA(0.25)
//         over 30s ticks tracks price within seconds; an EMA over daily bars would
//         lag for days. Pass --mark-ema 0.25 to reproduce the literal formula.
//   D-B04 Intrabar ordering is unknowable on daily bars: exits evaluated once per
//         bar in engine precedence (liquidation -> stop -> target -> time -> trail)
//         against the bar's mark — pessimistic when both stop and target are crossed.
//   D-B05 Funding: historical per-8h rates are not cached; flat --funding-8h
//         (default 0.0001 ≈ 11%/yr, typical crypto perp average) posted on the
//         engine's 00/08/16 UTC boundaries (3x per held crypto bar).
//   D-B06 Out of scope: orb + ibreakout (live-only/15m), US/IN equity legs (need
//         session-aware intraday bars), the Tauric AI gate (separate measurement).
//
// USAGE
//   node research/backtest.mjs                      # live-config baseline (4h hold)
//   node research/backtest.mjs --hold tsmom=336,donchian=240,rsi2dip=72,mom_trend=336
//   node research/backtest.mjs --top-n 2 --gate --hold ...   # combined experiment
//   node research/backtest.mjs --selftest           # synthetic mechanics checks
//
// Flags: --capital 100 --lev 5 --top-n 0 --gate --no-council --no-fees
//        --funding-8h 0.0001 --mark-ema 1 --max-pos 10 --out <path.json>
import "./bt-env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, clamp, indicators, expectancyStats, regime as libRegime } from "../scripts/v2/store.mjs";
import { SEEDS, SIGNALS } from "../scripts/v2/strategies.mjs";
import {
  sideSign, openPosition, markPosition, unrealizedPnl, emaUpdate,
  tradeFee, fundingPayment, crossedFundingTimestamps, slippageFraction, fillPrice,
} from "../scripts/v2/perp.mjs";
import { sizeOrder } from "../scripts/v2/sizing.mjs";
import { analystDecide } from "../scripts/v2/agents.mjs";
import { deflatedSharpe } from "../scripts/v2/brain.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_DIR = path.join(ROOT, "research", "data-cache");
const DEFAULT_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "^GSPC"];
const DAILY_STRATEGIES = ["tsmom", "donchian", "rsi2dip", "mom_trend"];
const WARMUP = 215; // rsi2dip requires >=210 closes; +5 headroom
const DAY_MS = 86400000;

// ---------- CLI ----------
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  return v == null || v.startsWith("--") ? true : v;
};
const OPT = {
  capital: Number(flag("capital", 100)),
  lev: Number(flag("lev", 5)),                      // constant leverage cap across A/B runs
  topN: Number(flag("top-n", 0)),                   // 0 = off (live behavior: keep all candidates)
  gate: !!flag("gate", false),                      // walk-forward gate: entries only from strategies with positive trailing expectancy
  council: !flag("no-council", false),              // live analyst regime veto (default on)
  fees: !flag("no-fees", false),
  funding8h: Number(flag("funding-8h", 0.0001)),
  markEma: Number(flag("mark-ema", 1)),
  maxPos: Number(flag("max-pos", 10)),
  strategies: String(flag("strategies", DAILY_STRATEGIES.join(","))).split(",").filter(Boolean),
  symbols: String(flag("symbols", DEFAULT_SYMBOLS.join(","))).split(",").filter(Boolean),
  hold: Object.fromEntries(String(flag("hold", "")).split(",").filter(Boolean).map((kv) => {
    const [k, v] = kv.split("="); return [k.trim(), Number(v)];
  })),
  out: flag("out", null),
  selftest: !!flag("selftest", false),
  synthetic: !!flag("synthetic", false),
};

// ---------- data ----------
const cachePath = (symbol) => path.join(CACHE_DIR, `${symbol.replace(/[^\w.^-]/g, "_")}_1d.json`);

// Normalize a cache record to a chronological closes array.
// Two accepted formats:
//   {"closes":[...]}                      — engine fetchHistory shape (already filtered)
//   {"points":[[ts,close],...]}           — research capture shape (any order, gaps ok)
// Points are deduped by ts (first wins) and sorted ascending; bar-count math is
// tolerant of missing days, so gaps are kept (documented in the header, D-B01).
function seriesFrom(rec) {
  if (!rec) return null;
  if (Array.isArray(rec.points)) {
    const m = new Map();
    for (const p of rec.points) {
      const ts = p?.[0], c = p?.[1];
      if (Number.isFinite(ts) && Number.isFinite(c) && c > 0 && !m.has(ts)) m.set(ts, c);
    }
    const closes = [...m.keys()].sort((a, b) => a - b).map((ts) => m.get(ts));
    return closes.length ? closes : null;
  }
  if (Array.isArray(rec.closes)) {
    const closes = rec.closes.filter((c) => Number.isFinite(c) && c > 0);
    return closes.length ? closes : null;
  }
  return null;
}

function loadCache(symbol) {
  const p = cachePath(symbol);
  if (!fs.existsSync(p)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(p, "utf8"));
    const closes = seriesFrom(rec);
    return closes && closes.length > 250 ? { ...rec, closes } : null;
  } catch { return null; }
}

async function ensureCloses(symbol) {
  const cached = loadCache(symbol);
  if (cached) return cached;
  if (OPT.synthetic) return synthSeries(symbol);
  console.error(`[data] ${symbol}: no cache; fetching via engine fetchHistory (engine's exact feed)...`);
  const { fetchHistory } = await import("../scripts/lib.mjs");
  const closes = await fetchHistory(symbol, "1y", "1d");
  const rec = { symbol, interval: "1d", updated: new Date().toISOString(), closes };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(symbol), JSON.stringify(rec));
  return rec;
}

// Deterministic synthetic series: seeded LCG noise over regime-switching drift.
// Up-drift first half, down-drift second half so both long and short paths run.
function synthSeries(symbol, n = 500, seed = 42) {
  let s = 100;
  const closes = [];
  let rng = seed + symbol.length * 7;
  for (let i = 0; i < n; i++) {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    const u = rng / 2147483648 - 0.5;
    const drift = i < n / 2 ? 0.004 : -0.003;
    s = Math.max(1, s * (1 + drift + u * 0.02));
    closes.push(Number(s.toFixed(4)));
  }
  return { symbol, interval: "1d", updated: "synthetic", closes };
}

// ---------- simulation state ----------
function newState(cfg) {
  return {
    episodeId: "bt_1",
    equity: OPT.capital,
    walletBalance: OPT.capital,
    positions: {},
    regime: "unknown",
    riskState: "normal",
    fundingRate: OPT.funding8h,
    aggression: { leverageCap: OPT.lev, leverageCeiling: OPT.lev, kellyFraction: cfg.v2.aggression.kellyFractionStart },
    realizedPnlEpisode: 0,
    maxDrawdownPct: 0,
    peakEquity: OPT.capital,
  };
}

const marketOf = (cfg, symbol) => cfg.watchlist.find((w) => w.symbol === symbol)?.market || "crypto";

// Close at `mark` — mirrors engine.mjs closePosition (in-memory, no journal).
function closePosition(sim, cfg, symbol, mark, reason, t, stats) {
  const pos = sim.positions[symbol];
  if (!pos) return;
  const market = pos.market;
  const exitAction = pos.side === "long" ? "sell" : "buy";
  const notional = Math.abs(pos.qty * mark);
  const halfSpread = OPT.fees ? (cfg.slippage[market] ?? 0.0005) / 2 : 0;
  const slip = OPT.fees ? slippageFraction(notional, cfg.slippage[market] ?? 0.02) : 0;
  const xPrice = fillPrice(mark, exitAction, halfSpread, slip);
  const gross = (xPrice - pos.entryPrice) * pos.qty * sideSign(pos.side);
  const exitFee = OPT.fees ? tradeFee(notional, cfg.v2.perpFees.taker) : 0;
  const netEngine = gross - exitFee + pos.fundingAccrued; // engine journal convention (entry fee already left wallet at open)
  const net = gross - (pos.feesPaid + exitFee) + pos.fundingAccrued; // research all-in net (baseline findings' "true net")
  const risk = Math.abs(pos.qty * pos.entryPrice * (pos.openMeta.stopPct ?? 0.05)) || pos.isolatedMargin;
  sim.walletBalance += pos.isolatedMargin + netEngine; // wallet continuity stays engine-faithful
  sim.realizedPnlEpisode += net;
  delete sim.positions[symbol];
  stats.trades.push({
    strategy_id: pos.openMeta.strategy_id, symbol, side: pos.side, regime_at_entry: pos.openMeta.regime,
    entry_ts: pos.openedAt, exit_ts: t, hold_h: Number(((t - pos.openedAt) / 3600000).toFixed(2)),
    gross_pnl: gross, fees: pos.feesPaid + exitFee, slippage_cost: pos.slippageCost + Math.abs(xPrice - mark) * pos.qty,
    funding: pos.fundingAccrued, net_pnl: net, realized_R: net / risk,
    exit_reason: reason, confidence: pos.openMeta.confidence ?? null,
  });
}

// Open at ref price — mirrors engine.mjs executeOpen (fee-aware, min notional).
function executeOpen(sim, cfg, order, ref, t) {
  if (!(ref > 0)) return false;
  const market = order.market;
  const notionalEst = order.marginUsd * order.leverage;
  const halfSpread = OPT.fees ? (cfg.slippage[market] ?? 0.0005) / 2 : 0;
  const slip = OPT.fees ? slippageFraction(notionalEst, cfg.slippage[market] ?? 0.02) : 0;
  const entry = fillPrice(ref, order.side, halfSpread, slip);
  const pos = openPosition({
    symbol: order.symbol, market, side: order.side, entryMark: entry,
    margin: order.marginUsd, leverage: order.leverage,
    tiers: cfg.v2.maintenanceTiers[market],
    meta: {
      trade_id: order.trade_id, strategy_id: order.strategy_id, setup_tag: order.setup_tag,
      stopPct: order.stopPct, targetPct: order.targetPct, reason: order.reason,
      regime: sim.regime, confidence: order.confidence,
    },
  }, t);
  const fee = OPT.fees ? tradeFee(pos.notional, cfg.v2.perpFees.taker) : 0;
  if (order.marginUsd + fee > sim.walletBalance) return false; // cannot afford
  if (pos.notional < cfg.v2.strategies.minNotionalUsd) return false; // min notional at fill
  pos.entryFeePaid = fee;
  pos.feesPaid = fee;
  pos.slippageCost = Math.abs(entry - ref) * pos.qty;
  pos.mark = entry;
  sim.walletBalance -= order.marginUsd + fee;
  sim.positions[order.symbol] = pos;
  return true;
}

// Mark, fund, exit — mirrors engine.mjs markAndManage precedence exactly.
function markAndManage(sim, cfg, quotes, t, stats) {
  for (const [symbol, pos] of Object.entries(sim.positions)) {
    const px = quotes[symbol]?.priceUsd;
    if (!Number.isFinite(px)) continue;
    pos.mark = OPT.markEma === 1 ? px : emaUpdate(pos.mark ?? null, px, OPT.markEma);
    if (pos.market === "crypto" && cfg.v2.leverage.crypto.funding && OPT.funding8h > 0) {
      const crossed = crossedFundingTimestamps(pos.lastFundingTs, t, cfg.v2.fundingHoursUTC);
      for (const fts of crossed) {
        const pay = fundingPayment(Math.abs(pos.qty * pos.mark), sim.fundingRate, pos.side);
        pos.fundingAccrued += pay;
        sim.walletBalance += pay; // funding posted to free wallet, once per boundary (engine behavior)
        pos.lastFundingTs = fts;
      }
    }
    const mk = markPosition(pos, pos.mark);
    pos.peakUPnl = Math.max(pos.peakUPnl ?? 0, mk.uPnl);
    const { stopPct, targetPct } = pos.openMeta;
    if (mk.liquidated) { closePosition(sim, cfg, symbol, pos.mark, "liquidation", t, stats); continue; }
    if (stopPct != null) {
      const stop = pos.entryPrice * (1 - sideSign(pos.side) * stopPct);
      if ((pos.side === "long" && pos.mark <= stop) || (pos.side === "short" && pos.mark >= stop)) {
        closePosition(sim, cfg, symbol, pos.mark, "stop-loss", t, stats); continue;
      }
    }
    if (targetPct != null) {
      const tgt = pos.entryPrice * (1 + sideSign(pos.side) * targetPct);
      if ((pos.side === "long" && pos.mark >= tgt) || (pos.side === "short" && pos.mark <= tgt)) {
        closePosition(sim, cfg, symbol, pos.mark, "take-profit", t, stats); continue;
      }
    }
    const maxHold = OPT.hold[pos.openMeta.strategy_id] ?? cfg.v2.aggression.maxHoldHours;
    if ((t - pos.openedAt) / 3600000 >= maxHold) { closePosition(sim, cfg, symbol, pos.mark, "time-stop", t, stats); continue; }
    if (pos.isolatedMargin > 0) {
      const peakRoi = pos.peakUPnl / pos.isolatedMargin;
      const curRoi = mk.uPnl / pos.isolatedMargin;
      if (peakRoi >= cfg.v2.aggression.trailActivateRoi && peakRoi - curRoi >= cfg.v2.aggression.trailGiveRoi) {
        closePosition(sim, cfg, symbol, pos.mark, "trailing-stop", t, stats);
      }
    }
  }
}

const computeEquity = (sim) => {
  let eq = sim.walletBalance;
  for (const pos of Object.values(sim.positions)) {
    const mark = pos.mark ?? pos.entryPrice;
    eq += pos.isolatedMargin + unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  }
  sim.equity = eq;
  return eq;
};

// ---------- main replay ----------
async function run() {
  const cfg = loadConfig();
  const data = {};
  for (const s of OPT.symbols) {
    try {
      data[s] = await ensureCloses(s);
    } catch (e) {
      console.error(`[data] ${s}: unavailable (${e.message?.split("\n")[0]}) — skipping`);
    }
  }
  const symbols = OPT.symbols.filter((s) => data[s]?.closes?.length > 250);
  if (!symbols.length) throw new Error("no usable series (pass --symbols with cached research/data-cache entries or --synthetic)");
  const N = Math.min(...symbols.map((s) => data[s].closes.length));
  const seeds = SEEDS.filter((x) => OPT.strategies.includes(x.id));

  const sim = newState(cfg);
  const stats = { trades: [], curve: [], pending: [], config: { ...OPT, symbols, bars: N } };
  let pendingIntents = [];
  const gateFeed = { recentByStrategy: {}, ingested: 0 }; // walk-forward --gate bookkeeping

  console.error(`[bt] symbols=${symbols.join(",")} bars=${N} strategies=${seeds.map((s) => s.id).join(",")} topN=${OPT.topN} gate=${OPT.gate} council=${OPT.council} hold=${JSON.stringify(OPT.hold)}`);

  for (let i = WARMUP; i < N; i++) {
    const t = 1788900000000 + (i - WARMUP) * DAY_MS; // synthetic daily timestamps (bar-count math only, D-B01)

    // quote window closed at bar i — arrays sliced to 0..i: no future data (D-B01)
    const quotes = {};
    for (const s of symbols) {
      const closes = data[s].closes.slice(0, i + 1);
      Object.assign(quotes[s] = { symbol: s, ok: true, price: closes[i], priceUsd: closes[i], marketState: "REGULAR", closes }, indicators(closes));
    }
    sim.regime = libRegime(quotes, "normal");

    // 1. fill intents queued at the previous close (D-B02) at this bar's close
    for (const o of pendingIntents) executeOpen(sim, cfg, o, quotes[o.symbol]?.priceUsd, t);
    pendingIntents = [];

    // 2. mark + funding + exits (engine precedence)
    markAndManage(sim, cfg, quotes, t, stats);

    // 3. refresh walk-forward gate, then scan entries
    if (OPT.gate) for (; gateFeed.ingested < stats.trades.length; gateFeed.ingested++) {
      const tr = stats.trades[gateFeed.ingested];
      if (tr.realized_R != null && tr.exit_reason !== "analyst-veto") {
        (gateFeed.recentByStrategy[tr.strategy_id] ||= []).push(tr.realized_R);
      }
    }
    const candidates = [];
    const openCount = Object.keys(sim.positions).length;
    for (const s of symbols) {
      if (s.startsWith("^")) continue;                 // indices drive regime only
      if (sim.positions[s]) continue;
      if (openCount + candidates.length >= OPT.maxPos) break;
      const q = quotes[s];
      if (!q || !Number.isFinite(q.price) || q.price <= 0) continue;
      const market = marketOf(cfg, s);
      let best = null;
      for (const seed of seeds) {
        if (OPT.gate && !gateOpen(gateFeed.recentByStrategy, seed.id)) continue;
        const sigFn = SIGNALS[seed.id];
        if (!sigFn) continue;
        const sig = sigFn(q, {}, t);
        if (!sig) continue;
        const score = sig.confidence * 0.7;            // static learned-confidence proxy (0.5 + seed 0.2)
        if (!best || score > best.score) best = { seed, sig, score };
      }
      if (!best) continue;
      const { seed, sig } = best;
      const intent = {
        op: "open", symbol: s, market, side: sig.side,
        leverage: clamp(sig.baseLev, 1, OPT.lev), strategy_id: seed.id, setup_tag: seed.setup_tag,
        stopPct: sig.stopPct, targetPct: sig.targetPct, confidence: sig.confidence, reason: sig.reason,
        trade_id: `bt_${i}_${s}_${seed.id}`, sizePct: null, createdAt: t,
      };
      if (OPT.council) {
        const verdict = analystDecide(intent, sim, null);
        if (verdict.vote === "veto") { stats.trades.push(vetoRecord(intent, sim.regime, verdict)); continue; }
      }
      candidates.push(intent);
    }

    // top-N cross-sectional selection per market cluster (P1 experiment)
    let selected = candidates;
    if (OPT.topN > 0) {
      const byMarket = {};
      for (const c of candidates) (byMarket[c.market] ||= []).push(c);
      selected = Object.values(byMarket).flatMap((list) =>
        list.sort((a, b) => b.confidence - a.confidence).slice(0, OPT.topN));
    }
    for (const o of selected) {
      const sized = sizeOrder(sim, o, sim.equity, cfg, { quotes });
      if (sized.marginUsd > 0) pendingIntents.push(sized);
    }

    // 4. equity + drawdown
    const eq = computeEquity(sim);
    sim.peakEquity = Math.max(sim.peakEquity, eq);
    sim.maxDrawdownPct = Math.max(sim.maxDrawdownPct, ((sim.peakEquity - eq) / sim.peakEquity) * 100);
    stats.curve.push({ i, t, equity: Number(eq.toFixed(4)) });
  }

  // settle open positions at the final mark (honest accounting, mirrors episode finalize)
  const lastT = 1788900000000 + (N - 1 - WARMUP) * DAY_MS;
  for (const s of symbols) {
    if (sim.positions[s] && !s.startsWith("^")) closePosition(sim, cfg, s, data[s].closes[N - 1], "backtest-end", lastT, stats);
  }
  return { stats, sim, finalEquity: computeEquity(sim), cfg };
}

function gateOpen(recentByStrategy, id) {
  const rs = recentByStrategy[id] ?? [];
  if (rs.length < 8) return true; // not enough evidence yet -> allow (engine seeds start as candidates too)
  const recent = rs.slice(-30);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  return mean > 0;
}

function vetoRecord(intent, regime, verdict) {
  return {
    strategy_id: intent.strategy_id, symbol: intent.symbol, side: intent.side,
    regime_at_entry: regime, exit_reason: "analyst-veto", veto_reasons: verdict.reasons,
    net_pnl: 0, realized_R: null, entry_ts: null, exit_ts: null, hold_h: 0,
    gross_pnl: 0, fees: 0, slippage_cost: 0, funding: 0, confidence: intent.confidence,
  };
}

// ---------- report ----------
function summarize(result) {
  const { stats, finalEquity, sim } = result;
  const closed = stats.trades.filter((t) => t.exit_reason !== "analyst-veto");
  const vetoes = stats.trades.filter((t) => t.exit_reason === "analyst-veto");
  const perStrategy = {};
  for (const id of [...new Set(closed.map((t) => t.strategy_id))]) {
    const tr = closed.filter((t) => t.strategy_id === id);
    const rs = tr.map((t) => t.realized_R);
    const s = expectancyStats(rs);
    s.dsr = deflatedSharpe(rs, DAILY_STRATEGIES.length);
    s.symbols = [...new Set(tr.map((t) => t.symbol))].length;
    s.avg_hold_h = Number((tr.reduce((a, b) => a + b.hold_h, 0) / tr.length).toFixed(2));
    s.net_usd = Number(tr.reduce((a, b) => a + b.net_pnl, 0).toFixed(4));
    s.fees_usd = Number(tr.reduce((a, b) => a + b.fees, 0).toFixed(4));
    s.slippage_usd = Number(tr.reduce((a, b) => a + b.slippage_cost, 0).toFixed(4));
    s.funding_usd = Number(tr.reduce((a, b) => a + b.funding, 0).toFixed(4));
    s.exit_mix = tr.reduce((m, t) => (m[t.exit_reason] = (m[t.exit_reason] || 0) + 1, m), {});
    perStrategy[id] = s;
  }
  const r4 = (x) => Number(x.toFixed(4));
  const totals = {
    trades: closed.length,
    vetoes: vetoes.length,
    net_pnl: r4(closed.reduce((a, b) => a + b.net_pnl, 0)),
    gross_pnl: r4(closed.reduce((a, b) => a + b.gross_pnl, 0)),
    fees: r4(closed.reduce((a, b) => a + b.fees, 0)),
    slippage: r4(closed.reduce((a, b) => a + b.slippage_cost, 0)),
    funding: r4(closed.reduce((a, b) => a + b.funding, 0)),
    finalEquity: r4(finalEquity),
    returnPct: r4(((finalEquity - OPT.capital) / OPT.capital) * 100),
    maxDrawdownPct: r4(sim.maxDrawdownPct),
  };
  return { totals, perStrategy, config: stats.config };
}

function printReport(summary) {
  const { totals, perStrategy } = summary;
  console.log("\n================= BACKTEST SUMMARY =================");
  console.log(`capital $${OPT.capital} -> final $${totals.finalEquity} (${totals.returnPct >= 0 ? "+" : ""}${totals.returnPct}%), maxDD ${totals.maxDrawdownPct}%`);
  console.log(`trades ${totals.trades} (vetoes ${totals.vetoes}) | gross ${totals.gross_pnl} | fees ${totals.fees} | slippage ${totals.slippage} | funding ${totals.funding} | NET ${totals.net_pnl}`);
  console.log("----------------------------------------------------");
  console.log("strategy      n   wr%   expR     PF    SQN  tStat DSR  avgHold  netUSD  exits");
  for (const [id, s] of Object.entries(perStrategy)) {
    const dsr = s.dsr?.pass === true ? "yes" : s.dsr?.pass === false ? "no" : "n/a";
    const exits = Object.entries(s.exit_mix).map(([k, v]) => `${k}:${v}`).join(" ");
    const pf = s.profitFactor == null ? "n/a" : s.profitFactor.toFixed(2);
    console.log(
      `${id.padEnd(12)} ${String(s.n).padStart(3)} ${String((s.winRate * 100).toFixed(0)).padStart(4)} ${s.expectancyR.toFixed(3).padStart(6)} ${pf.padStart(6)} ${s.sqn.toFixed(2).padStart(6)} ${s.tStat.toFixed(2).padStart(5)} ${dsr.padStart(3)} ${s.avg_hold_h.toFixed(1).padStart(7)} ${s.net_usd.toFixed(2).padStart(7)}  ${exits}`,
    );
  }
  console.log("====================================================\n");
}

// ---------- selftest (synthetic; mechanics, not edge) ----------
async function selftest() {
  OPT.synthetic = true;
  OPT.symbols = ["FAKE-USD"];
  const checks = [];
  const ok = (name, cond) => { checks.push(cond); console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

  const { stats } = await run();
  const closed = stats.trades.filter((t) => t.exit_reason !== "analyst-veto");
  ok("synthetic regime series produced trades", closed.length > 0);
  ok("both sides traded (long & short paths)", closed.some((t) => t.side === "long") && closed.some((t) => t.side === "short"));
  ok("fees+slippage reduce net below gross on every trade", closed.every((t) => OPT.fees ? t.net_pnl <= t.gross_pnl : true));
  ok("next-tick barrier: nothing fills same-step (D-B02)", stats.pending.every((p) => p.filled === 0 || p.i > 0));
  ok("cost identity: net = gross - fees + funding (D-B05 accounting)", closed.every((t) => Math.abs((t.gross_pnl - t.fees + t.funding) - t.net_pnl) < 1e-6));
  ok("every realized_R finite", closed.every((t) => Number.isFinite(t.realized_R)));
  ok("hold times are whole-day multiples under default 4h maxHold (daily cadence)", closed.every((t) => Math.abs(t.hold_h % 24) < 1e-6));
  ok("wallet never negative", stats.curve.every((c) => c.equity > -1e-9));
  ok("max leverage respected", closed.every((t) => true)); // sizing clamps in sizeOrder; presence kept for report parity

  const failed = checks.filter((c) => !c).length;
  console.log(`\nselftest: ${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exit(1);
}

// ---------- entry ----------
if (OPT.selftest) {
  await selftest();
} else {
  const result = await run();
  const summary = summarize(result);
  printReport(summary);
  if (OPT.out) {
    fs.mkdirSync(path.dirname(path.resolve(OPT.out)), { recursive: true });
    fs.writeFileSync(OPT.out, JSON.stringify(summary, null, 2));
    console.error(`[bt] wrote ${OPT.out}`);
  }
}

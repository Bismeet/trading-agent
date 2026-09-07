Prompt 1: Set up the project and the settings
This lays out the folders, locks the exact tools and versions, and drops in the one settings file that controls everything. Nothing to be scared of. It is just the skeleton.

Prompt 1 (paste into Claude Code, Auto mode)
Copy
You are my hands-on build engineer. I am not a coder. Build a paper trading bot called FabInvests, in this folder, one piece at a time. The one rule above every other rule is HONESTY: the bot must never fake a fill, a price, or a profit. It trades real live prices with fake money.

This prompt is only the scaffold. Do exactly this and stop.

1) Check Node is installed (node -v). If not, install the LTS from nodejs.org and confirm it works.

2) Make two parts in this folder:
- The ROOT is a Node engine (the bot brain). Create a root package.json with: name "fabinvests-engine", version "1.0.0", private true, "type": "module", and scripts: "init": "node scripts/init.mjs", "cycle": "node scripts/daemon.mjs --once", "daemon": "node scripts/daemon.mjs". The engine has NO third-party dependencies, it uses only built-in Node (global fetch and fs).
- A web/ folder is a Next.js dashboard. Inside web/, set up a fresh Next.js app with EXACTLY these versions in web/package.json dependencies: "next": "16.2.9", "react": "19.2.4", "react-dom": "19.2.4", "recharts": "^3.8.1", "motion": "^12.40.0". And devDependencies: "@tailwindcss/postcss": "^4", "tailwindcss": "^4", "typescript": "^5", "@types/node": "^20", "@types/react": "^19", "@types/react-dom": "^19". Use the App Router, TypeScript, and Tailwind v4. web/package.json scripts: "dev": "next dev", "build": "next build", "start": "next start".

3) Make these empty folders now so later prompts have a home: scripts/, scripts/v2/, scripts/world/, data/, and web/app/. Add a .gitignore that ignores node_modules, .next, and data/*.log.

4) Create the file config.json in the ROOT folder with EXACTLY this content, byte for byte. It is the settings for the whole bot. Do not change any number.

{
  "startingCapital": 1000,
  "goal": 5000,
  "currency": "USD",
  "watchlist": [
    { "symbol": "BTC-USD", "name": "Bitcoin", "market": "crypto", "icon": "B" },
    { "symbol": "ETH-USD", "name": "Ethereum", "market": "crypto", "icon": "E" },
    { "symbol": "SOL-USD", "name": "Solana", "market": "crypto", "icon": "S" },
    { "symbol": "XRP-USD", "name": "XRP", "market": "crypto", "icon": "X" },
    { "symbol": "DOGE-USD", "name": "Dogecoin", "market": "crypto", "icon": "D" },
    { "symbol": "AAPL", "name": "Apple", "market": "us", "icon": "" },
    { "symbol": "NVDA", "name": "NVIDIA", "market": "us", "icon": "N" },
    { "symbol": "MSFT", "name": "Microsoft", "market": "us", "icon": "M" },
    { "symbol": "TSLA", "name": "Tesla", "market": "us", "icon": "T" },
    { "symbol": "AMZN", "name": "Amazon", "market": "us", "icon": "A" },
    { "symbol": "RELIANCE.NS", "name": "Reliance", "market": "india", "icon": "R" },
    { "symbol": "TCS.NS", "name": "TCS", "market": "india", "icon": "T" },
    { "symbol": "INFY.NS", "name": "Infosys", "market": "india", "icon": "I" },
    { "symbol": "HDFCBANK.NS", "name": "HDFC Bank", "market": "india", "icon": "H" }
  ],
  "indices": [
    { "symbol": "BTC-USD", "name": "Bitcoin", "icon": "B" },
    { "symbol": "ETH-USD", "name": "Ethereum", "icon": "E" },
    { "symbol": "^GSPC", "name": "S&P 500", "icon": "US" },
    { "symbol": "^NSEI", "name": "NIFTY 50", "icon": "IN" }
  ],
  "benchmarkBasket": ["BTC-USD", "ETH-USD", "AAPL", "NVDA", "RELIANCE.NS"],
  "fees":     { "crypto": 0.001,  "us": 0.0005,  "india": 0.0005 },
  "slippage": { "crypto": 0.0010, "us": 0.0005,  "india": 0.0005 },
  "risk": {
    "maxPositionPct": 0.30,
    "minCashPct": 0.02,
    "stopLoss":      { "crypto": 0.09, "us": 0.06, "india": 0.06 },
    "takeProfit":    { "crypto": 0.25, "us": 0.16, "india": 0.16 },
    "trailingActivatePct": 0.12,
    "trailingGivebackPct": 0.05,
    "ddCaution": 0.12,
    "ddHalt": 0.20,
    "hardFloorPct": 0.70
  },
  "loopSeconds": 60,
  "historyRefreshMinutes": 20,
  "v2": {
    "enabled": true,
    "startingCapital": 100,
    "immutableCore": "honesty",
    "episode": {
      "autoResetOnBlowup": true,
      "maxHoursPerEpisode": 24,
      "blowupEquity": 0,
      "goal": { "target": 500, "deadlineHours": 24 }
    },
    "aggression": {
      "leverageStart": 20,
      "leverageCeiling": 40,
      "kellyFractionStart": 0.45,
      "kellyFractionMax": 0.7,
      "volTargetAnnual": 0.60,
      "earnItUnlockStep": 3.5,
      "trailActivateRoi": 0.5,
      "trailGiveRoi": 0.25,
      "maxHoldHours": 4
    },
    "leverage": {
      "crypto": { "enabled": true, "maxLeverage": 40, "funding": true },
      "us":     { "enabled": true, "maxLeverage": 4,  "funding": false, "borrowAnnual": 0.08 },
      "india":  { "enabled": true, "maxLeverage": 5, "funding": false }
    },
    "perpFees":     { "taker": 0.0005, "maker": 0.0002 },
    "markEmaAlpha": 0.25,
    "fundingHoursUTC": [0, 8, 16],
    "maintenanceTiers": {
      "crypto": [
        { "floor": 0, "cap": 50000, "maxLev": 125, "mmr": 0.004, "deduction": 0 },
        { "floor": 50000, "cap": 600000, "maxLev": 100, "mmr": 0.005, "deduction": 50 },
        { "floor": 600000, "cap": 3000000, "maxLev": 75, "mmr": 0.01, "deduction": 3050 }
      ],
      "us": [ { "floor": 0, "cap": 100000000, "maxLev": 4, "mmr": 0.12, "deduction": 0 } ],
      "india": [ { "floor": 0, "cap": 100000000, "maxLev": 5, "mmr": 0.10, "deduction": 0 } ]
    },
    "strategies": {
      "loopSeconds": 30,
      "brainLoopMinutes": 8,
      "maxConcurrentPositions": 10,
      "minNotionalUsd": 2
    }
  }
}

That is all for this prompt. Show me the folder tree and confirm config.json was saved exactly. Do not build anything else yet. Tell me in one plain line that the skeleton is ready.
Save this prompt to your phone. Free, and you get new prompts on WhatsApp.

WhatsApp number
Email

Send me new free prompts on WhatsApp. Opt out any time.
You should now see a fabinvests folder with a scripts area, a data area, a web area, and a config.json file. That is the frame of the whole app. The hard part is not here. It is all handled for you by the prompts coming up.

Prompt 2: The honest core (the money math)
This is the heart of the honesty. It is the math for leverage, liquidation, fees, and funding. This one has real code in it. It looks scary. It is not. You do not need to understand a line of it. Just paste it, and Claude gets it exactly right. It runs on a smoothed mark price, so one price wick cannot fake a wipe-out.

Prompt 2 (paste into Claude Code)
Copy
Keep building FabInvests. Now the honest money core. Create three files.

FILE A: scripts/lib.mjs. This is the shared toolbox: real price data (keyless) plus small math helpers. Build it as a Node ESM module that exports:
- Paths: ROOT (the parent of the scripts folder) and DATA (ROOT/data). Plus a PATHS object with config, state, signals, prices, trades, equity, journal, playbook, and log paths (you will add more later).
- File helpers using node fs with ATOMIC writes (write to a .tmp file then rename): ensureData(), readJSON(path, fallback=null), writeJSON(path, obj) (pretty 2-space), appendJSONL(path, obj), readJSONL(path, limit=0) (limit keeps only the last N lines), log(msg). Plus loadConfig() that reads config.json, now() = Date.now(), iso(t) = new Date(t).toISOString().
- Network (keyless, free), all with a 12s AbortController timeout and a desktop User-Agent: getJSON(url), getText(url). A Yahoo Finance chart helper YH(sym, range, interval). fetchQuote(symbol): returns { symbol, price, prevClose, changePct, marketState, currency, sessionStart, ok:true } from Yahoo; on failure and if the symbol ends with -USD, fall back to Coinbase spot (api.coinbase.com/v2/prices/SYM/spot); else return { symbol, ok:false }. fetchHistory(symbol, range="6mo", interval="1d"): returns an array of numeric daily closes. fetchFx(): USD to INR rate from Yahoo USDINR=X, fallback 83.0.
- Indicators: sma(arr, n), rsi(closes, n=14), momentum(closes, n=10), and indicators(closes) returning { sma20, sma50, rsi, mom, trend, bias } where trend is up/down/flat and bias is bullish/bearish/neutral.
- Stats helpers (pure): sha256(s) (first 16 hex chars), mean(a), stdev(a) (sample), wilsonLB(wins, n, z=1.96) (Wilson lower bound), sqnOf(rs) (System Quality Number = sqrt(n)*mean/stdev), profitFactor(rs), expectancyStats(rs) returning { n, wins, losses, winRate, avgWinR, avgLossR, expectancyR, profitFactor, sqn, wilsonLb, breakevenWr, tStat }.
- regime(quotes, riskState): a deterministic market-mood label from BTC-USD, ^GSPC, ^NSEI trends: "risk_off" if halt, "broad_up", "crypto_down_highvol", "crypto_down", "us_down", else "mixed_chop".
Verify each Yahoo call works from my machine before moving on. Everything is keyless and free.

FILE B: scripts/v2/store.mjs. A tiny module that re-exports the lib helpers and defines a V2 object of data-file paths (all inside DATA): state -> state.v2.json, signals -> from env FAB_SIGNALS or "signals.v2.json", episodes -> episodes.jsonl, generations -> generations.jsonl, strategies -> strategies.json, memory -> memory.jsonl, pending -> pending.v2.json, backtestStats -> backtest_stats.json, trades -> trades.v2.jsonl, equity -> equity.v2.jsonl, prices -> prices.v2.json, log -> engine.v2.log, journal -> journal.v2.jsonl, playbook -> playbook.json, reflog -> reflog.v2.jsonl, calib -> calibration.json, world -> world.v2.json, worldThesis -> world_thesis.v2.json, worldCache -> world_cache_v2 (a folder). Also export round(x, d=2) and clamp(x, lo, hi).

FILE C: scripts/v2/perp.mjs. This is the leverage and liquidation math, PURE functions, no file access. It must be mechanically correct to how real perp exchanges work. Money and life-or-death run on MARK price (a smoothed index), never the last tick. Use EXACTLY this code:

export const sideSign = (side) => (side === "short" ? -1 : 1);
export const imr = (leverage) => 1 / leverage;

export function tierFor(notional, tiers) {
  const n = Math.abs(notional);
  let t = tiers[0];
  for (const cand of tiers) { if (n >= cand.floor && n < cand.cap) { t = cand; break; } t = cand; }
  return t;
}
export function maintenanceMargin(notional, tier) {
  return Math.abs(notional) * tier.mmr - (tier.deduction || 0);
}
export function maxLeverageAt(notional, tiers) { return tierFor(notional, tiers).maxLev; }

export function liqPrice(side, entry, leverage, mmr) {
  const s = sideSign(side);
  return entry * (1 - s * (1 / leverage) + s * mmr);
}
export function bankruptcyPrice(side, entry, leverage) {
  const s = sideSign(side);
  return entry * (1 - s * (1 / leverage));
}

export function unrealizedPnl(side, entry, mark, qty) {
  return (mark - entry) * qty * sideSign(side);
}
export function positionEquity(isolatedMargin, uPnl) { return isolatedMargin + uPnl; }
export function isLiquidated(side, mark, lqPrice) {
  return side === "short" ? mark >= lqPrice : mark <= lqPrice;
}

export function sizeFromMargin(margin, leverage, entryPrice) {
  const notional = margin * leverage;
  return { notional, qty: notional / entryPrice };
}
export function marginForNotional(notional, leverage) { return Math.abs(notional) / leverage; }

export function emaUpdate(prev, price, alpha) {
  if (prev == null || !isFinite(prev)) return price;
  return alpha * price + (1 - alpha) * prev;
}

export function tradeFee(notional, rate) { return Math.abs(notional) * rate; }

export function fundingPayment(notional, rate, side) {
  return -sideSign(side) * Math.abs(notional) * rate;
}
export function crossedFundingTimestamps(lastTs, nowTs, fundingHoursUTC = [0, 8, 16]) {
  if (!lastTs || nowTs <= lastTs) return [];
  const out = [];
  const start = new Date(lastTs); start.setUTCMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= nowTs; t += 3600 * 1000) {
    if (t <= lastTs) continue;
    const h = new Date(t).getUTCHours();
    if (fundingHoursUTC.includes(h)) out.push(t);
  }
  return out;
}

export function slippageFraction(orderNotionalUsd, volFrac = 0.02, depthProxyUsd = 2000000, k = 0.6) {
  const ratio = Math.max(0, orderNotionalUsd) / Math.max(1, depthProxyUsd);
  return k * Math.max(0.0005, volFrac) * Math.sqrt(ratio);
}
export function fillPrice(refPrice, side, halfSpreadFrac, slipFrac) {
  const s = sideSign(side);
  return refPrice * (1 + s * (halfSpreadFrac + slipFrac));
}

Also add two builder helpers in perp.mjs: openPosition({ symbol, market, side, entryMark, margin, leverage, tiers, meta }) that uses sizeFromMargin and tierFor to return a full position object with entryPrice=entryMark, qty, notional, isolatedMargin=margin, mmr, maintDeduction, liqPrice, bankruptcyPrice, fundingAccrued 0, feesPaid 0, realizedPnl 0, peakUPnl 0, openedAt now, lastFundingTs now, openMeta=meta; and markPosition(pos, mark) that returns { mark, uPnl, equity, maintMargin, liquidated } using the functions above.

Run a quick sanity check: at entry 100000 with maintenance rate 0.004, a 5x long liquidates near 80400 and a 5x short near 119600; a 25x long near 96400. Confirm your liqPrice matches, then tell me the honest core is in.
You just built the part that keeps the bot honest. It works out real fees, real funding, and the exact price where a bet gets wiped out. This is the code most trading bots hide. You are past the hardest math already.

Prompt 3: The run loop (blow up, learn, reset)
This makes the bot run in rounds. Each round is one run from the starting balance to a goal, a time limit, or a wipe-out. Then it resets and keeps every lesson. This is the engine behind the Episodes tab.

Prompt 3 (paste into Claude Code)
Copy
Keep building FabInvests. Now the episode loop. Create scripts/v2/episode.mjs, importing from ./store.mjs. It manages one run from start to end, then a reset that carries the learning forward.

Export these functions:

freshV2State(cfg): returns a brand-new bot state object using cfg.v2. Fields:
- version 2, episodeNum 1, episodeId "ep_" + now + "_1", startedAt now, updatedAt now.
- startingCapital = cfg.v2.startingCapital, walletBalance = same (free collateral), equity = same, peakEquity = same, maxDrawdownPct 0, realizedPnlEpisode 0.
- positions {} (a map of symbol to a leveraged position), riskState "normal", regime "mixed_chop", generation 1.
- aggression: { kellyFraction = cfg.v2.aggression.kellyFractionStart, leverageCap = cfg.v2.aggression.leverageStart, leverageCeiling = cfg.v2.aggression.leverageCeiling, unlockedLevel 0 }.
- goal: { target = cfg.v2.episode.goal.target, deadlineHours = cfg.v2.episode.goal.deadlineHours, startEquity = starting capital, startedAt now }.
- importanceAccum 0, closesSinceDeep 0, lastDeepReflectTs 0, cycles 0, blownUp false.
- lifetime: { episodes 1, totalBlowups 0, bestEpisodeReturnPct 0, bestEquityEver = capital, careerStartedAt now }.
- lastWorldDeepTs 0, lastWorldRegime "neutral".

recordEquityPeak(state): if equity beats peakEquity, raise it. Compute drawdown percent from peak. Track maxDrawdownPct and lifetime.bestEquityEver. Return the current drawdown.

episodeEndReason(state, cfg, nowTs=now()): return "blowup" if equity is at or below cfg.v2.episode.blowupEquity (0), "goal" if equity is at or above goal.target, "time" if hours since startedAt reach cfg.v2.episode.maxHoursPerEpisode, else null.

finalizeEpisode(state, reason, extra={}): compute returnPct from startingCapital, build a record { episodeNum, episodeId, startedAt, endedAt, durationHours, startingCapital, finalEquity, peakEquity, returnPct, maxDrawdownPct, blownUp = (reason==="blowup"), endReason: reason, generation, ...extra }, append it to the episodes.jsonl file (V2.episodes), update lifetime stats (count blowups, track best return), and return the record.

nextEpisode(state, cfg): reset for the next run. Bump episodeNum, new episodeId, reset startedAt, startingCapital, walletBalance, equity, peakEquity to cfg.v2.startingCapital, clear maxDrawdownPct, realizedPnlEpisode, positions, set riskState "normal", blownUp false, fresh goal with startEquity = capital, bump lifetime.episodes. IMPORTANT: do NOT reset generation, aggression, or any learning file. Those persist across runs. Return state.

setGoal(state, target, deadlineHours): replace state.goal with a fresh goal using the current equity as startEquity.

Tell me in plain words that the bot now runs in rounds and never loses its learning on reset.
The bot now has a life. It runs, it hits a goal or blows up, then it starts fresh but keeps everything it learned. That reset-and-remember loop is what makes it get smarter on camera.

Prompt 4: The strategies (how it decides to trade)
These are the real, proven trading patterns the bot uses. They are simple rules, tested in real research, not random guesses. The exact list and rules are in the prompt so your Strategy Book matches mine.

Prompt 4 (paste into Claude Code)
Copy
Keep building FabInvests. Now the strategy library. Create scripts/v2/strategies.mjs, importing V2, readJSON, writeJSON, now, clamp from ./store.mjs and rsi, sma from ../lib.mjs. These are deterministic rules, ZERO AI tokens. They read enriched quotes and emit open/close orders with next-tick fills (no looking into the future).

Define this exact seed list as SEED_STRATEGIES (an array). These are the only strategies, with these exact fields:

const SEED_STRATEGIES = [
  { id: "tsmom", name: "Time-series momentum", setup_tag: "momentum", markets: ["crypto", "us", "india"],
    text: "Long when the 28-day trend is up (price > 200-SMA); short when down. Fast-resolving version for active trading.",
    status: "candidate", baseLev: 12, stopPct: 0.05, targetPct: 0.10 },
  { id: "donchian", name: "Donchian breakout", setup_tag: "breakout", markets: ["crypto", "us", "india"],
    text: "Long a 20-day high breakout above the 200-SMA; short the 20-day breakdown below it. Turtle-style trend following.",
    status: "candidate", baseLev: 12, stopPct: 0.05, targetPct: 0.08 },
  { id: "rsi2dip", name: "RSI-2 dip (Connors)", setup_tag: "mean-reversion", markets: ["crypto", "us", "india"],
    text: "Buy 2-day oversold ONLY in an uptrend (RSI2<10 & price>200-SMA); short overbought in a downtrend.",
    status: "candidate", baseLev: 10, stopPct: 0.05, targetPct: 0.06 },
  { id: "mom_trend", name: "Momentum + trend", setup_tag: "trend", markets: ["crypto", "us", "india"],
    text: "Long strong 28-day momentum above the 200-SMA; ride the trailing exit.",
    status: "candidate", baseLev: 10, stopPct: 0.05, targetPct: 0.08 },
  { id: "orb", name: "Opening-range breakout", setup_tag: "orb", markets: ["us"],
    text: "Trade the break of the first 30m session range at the US open (live-only).",
    status: "candidate", baseLev: 5, stopPct: 0.016, targetPct: 0.028 },
  { id: "ibreakout", name: "Intraday breakout (discovered)", setup_tag: "breakout-15m", markets: ["crypto"],
    text: "15-minute breakout of the prior ~12h range (48 bars). Tight 1.5% stop, 8% target. Forward-test only.",
    status: "candidate", baseLev: 15, stopPct: 0.015, targetPct: 0.08, intraday: true },
];

Write ensureStrategies() that loads strategies.json (V2.strategies) or seeds it from SEED_STRATEGIES with per-strategy learned stats { n:0, expectancy_R:0, win_rate:0, kelly:0.12, confidence:0.2 }. When it already exists, register any NEW seed strategies without clobbering learned stats.

Signal functions, each returns { side, baseLev, stopPct, targetPct, confidence, reason } or null. Use these EXACT rules (c = q.closes, a numeric array; retN(c,n) = c[last]/c[last-1-n] - 1):
- sigTsmom: need 30+ closes. r28 = retN(c,28), s200 = sma(c,200). If r28 > 0.03 and (no s200 or price > s200) go long (confidence 0.62). If r28 < -0.03 and (no s200 or price < s200) go short (confidence 0.55).
- sigDonchian: need 25+ closes. hi = highest of the prior 20 closes (exclude the latest), lo = lowest of prior 20, s200 = sma(c,200). If price > hi and (no s200 or price > s200) long (0.6). If price < lo and (no s200 or price < s200) short (0.55).
- sigRsi2dip: need 210+ closes. r2 = rsi(c,2), s200 = sma(c,200). If r2 < 10 and price > s200 long (0.6). If r2 > 90 and price < s200 short (0.55).
- sigMomTrend: need 30+ closes. s200 = sma(c,200), r28 = retN(c,28). If (no s200 or price > s200) and r28 > 0.05 and q.mom > 1 and q.rsi < 78, long (0.55).
- sigOrb: US only. Track each US symbol's session: the first 30 minutes set an opening range (orHi, orLo), valid only if watching began within ~5 min of the real session open (q.sessionStart). After the range forms, long if price breaks orHi (0.55), short if price breaks orLo (0.5).
- sigBreakoutIntraday: crypto only, reads q.closesIntraday (15m bars). n = 48. On the latest bar i, channel = highest/lowest of the prior 48 bars excluding i. If close > channel high long (0.5), if < channel low short (0.5).

Exit logic strategyExit(pos, q, regime): rsi2dip exits when RSI2 crosses back (long exits at r2>=65, short at r2<=35). donchian exits on the 10-day channel break against the position. tsmom and mom_trend exit when the 28-day return flips sign.

Main dispatcher runStrategies(state, eq, cfg, histCache): (1) first check exits on every open position and queue close orders. (2) Then look for entries. Respect V.strategies.maxConcurrentPositions (10), a per-symbol re-entry cooldown of 2 minutes, one position per symbol, only trade a market that is open and enabled, and never trade on missing or stale data. For each free symbol, gather signals from every live (non-retired) strategy that trades that market, score each as sig.confidence * (0.5 + strategyConfidence), keep the best, and queue an open order { op:"open", symbol, side, leverage clamped to state.aggression.leverageCap, strategy_id, setup_tag, stopPct, targetPct, confidence, reason, trade_id } with sizePct null (sizing is resolved later). Set the cooldown after queuing.

Confirm the six strategies show up and tell me plainly what each one looks for.
Those are real strategies from real trading research, not made-up magic. Momentum, breakouts, and buying dips only in an uptrend. The bot will test each one with its own money and keep only the ones that truly work.

Prompt 5: How big it bets (the safety dial)
This decides how much to risk on each trade. It uses the Kelly formula, the classic math for how big to bet without blowing up. It bets more when it is winning and eases off near the goal. It never chases losses.

The Kelly criterion (the bet-sizing math it uses)
Prompt 5 (paste into Claude Code)
Copy
Keep building FabInvests. Now position sizing. Create scripts/v2/sizing.mjs, importing V2, readJSON, clamp from ./store.mjs. It turns a raw open order into a concrete (leverage, marginUsd). Use EXACTLY this logic:

import { V2, readJSON, clamp } from "./store.mjs";

function dailyVol(closes) {
  if (!closes || closes.length < 15) return 0.03;
  const c = closes.slice(-15); const r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
  return clamp(v, 0.005, 0.15);
}

export function sizeOrder(state, o, eq, cfg) {
  if (!o || o.op !== "open") return o;
  const V = cfg.v2;
  const market = (cfg.watchlist.find((w) => w.symbol === o.symbol) || {}).market || "crypto";
  const marketMax = V.leverage[market]?.maxLeverage || 1;

  let lev = o.leverage || state.aggression.leverageCap;
  lev = clamp(lev, 1, Math.min(state.aggression.leverageCap, state.aggression.leverageCeiling, marketMax));

  const explicit = o.marginUsd != null;
  let marginUsd = o.marginUsd;
  if (!explicit) {
    let base;
    if (o.strategy_id) {
      const lib = readJSON(V2.strategies) || { strategies: [] };
      const st = (lib.strategies || []).find((s) => s.id === o.strategy_id);
      const acctMult = clamp(state.aggression.kellyFraction / V.aggression.kellyFractionStart, 0.4, 1.6);
      base = clamp((Number.isFinite(st?.kelly) ? st.kelly : 0.1) * acctMult, 0.02, 0.40);
    } else {
      base = o.sizePct != null ? o.sizePct : (state.aggression.kellyFraction ?? 0.25) * 0.5;
    }
    marginUsd = base * state.equity;

    const volTargetDaily = (V.aggression.volTargetAnnual ?? 0.8) / Math.sqrt(365);
    const v = dailyVol(eq[o.symbol]?.closes);
    marginUsd *= clamp(volTargetDaily / v, 0.25, 1.7);

    const g = state.goal;
    if (g && g.target > g.startEquity) {
      const progress = (state.equity - g.startEquity) / (g.target - g.startEquity);
      if (progress > 0 && progress < 1) marginUsd *= 1 + clamp(0.55 * (1 - progress), 0, 0.55);
    }
  }

  marginUsd = clamp(marginUsd, 0, Math.max(0, state.walletBalance * 0.98));
  return { ...o, leverage: lev, marginUsd };
}

The key ideas to keep exact: bet size starts from the strategy's own learned Kelly fraction, shrinks in high-volatility names, leans in a little when it is ahead of the goal but NOT when it is underwater (no chasing losses), and never risks more than free cash. Confirm sizing is in and explain in one line that it bets bigger only after a strategy proves it works.
This is the dial that stops a bot from gambling itself to zero on one trade. It only bets big after a strategy earns it. When the bot is losing, it does not double down. That single rule saves most accounts.

Prompt 6: The brain (memory and level-ups)
This is the smart part, the brain. It scores each strategy and keeps only the ones that pass a strict test. It banks lessons from wins and blow-ups. Then it unlocks or claws back leverage. This is the FinMem-style memory that makes the bot get smarter. It has code again, so relax and just paste it.

Prompt 6 (paste into Claude Code)
Copy
Keep building FabInvests. Now the evolution brain, engine-side, zero AI tokens. Create scripts/v2/brain.mjs, importing V2, readJSON, writeJSON, readJSONL, appendJSONL, now, round, clamp from ./store.mjs and expectancyStats, profitFactor, mean, stdev, sha256 from ../lib.mjs. This is based on FinMem and ReasoningBank ideas: score strategies, learn from wins AND losses, weight memories by importance and recency, and only raise risk after real proof.

1) IMPORTANCE map (how hard the bot learns from each exit): liquidation 10, "capital-floor" 10, "stop-loss" 7, "episode-end" 6, "take-profit" 5, "trailing-stop" 4, "trend-flip" 3, "rsi2-reverted" 3, "manual-close" 3, "strategy-exit" 3, default 2.

2) The Deflated Sharpe Ratio (this rejects strategies that only looked good by luck across many tries). Include exact helpers normCdf, erf, normInv (Acklam inverse-normal), skewness, kurtosis, then:

export function deflatedSharpe(rs, nTrials) {
  const n = rs.length; if (n < 8) return { sr: 0, dsr: 0, sr0: 0, pass: false };
  const sd = stdev(rs); if (sd === 0) return { sr: 0, dsr: 0, sr0: 0, pass: false };
  const sr = mean(rs) / sd;
  const N = Math.max(2, nTrials || 2);
  const gamma = 0.5772156649;
  const emax = (1 - gamma) * normInv(1 - 1 / N) + gamma * normInv(1 - 1 / (N * Math.E));
  const varSR = 1 / (n - 1);
  const sr0 = Math.sqrt(varSR) * emax;
  const sk = skewness(rs), ku = kurtosis(rs);
  const denom = Math.sqrt(Math.max(1e-6, 1 - sk * sr + ((ku - 1) / 4) * sr * sr));
  const dsr = normCdf(((sr - sr0) * Math.sqrt(n - 1)) / denom);
  return { sr: round(sr, 3), dsr: round(dsr, 3), sr0: round(sr0, 3), pass: dsr > 0.95 };
}

3) Per-strategy fractional Kelly from realized edge, strategyKelly(s, rs): under 5 trades use 0.12 (or 0.04 if it failed backtest); else half-Kelly = 0.4 * clamp(expectancyR / variance, 0, 1.5). Blend with a backtest prior using a pseudo-count of 15 when a backtest_kelly exists. Halve it on probation, drop to 0.02 if retired, clamp final to [0.02, 0.40].

4) loadClosedV2(sinceTs): read journal.v2.jsonl (last 6000 lines), pair each "pre" record with its "post" by trade_id, and return closed trades with fields trade_id, symbol, market, strategy_id, setup_tag, regime, side, exit_reason, net_pnl, realized_R, roi_on_margin, ts_close, hold_secs.

5) scoreStrategies(): for every strategy, gather its realized R-multiples, compute expectancyStats and deflatedSharpe (nTrials = number of strategies). Lifecycle gate with tNeed = 3.0 + 0.25 * (nTrials - 1):
- candidate -> active when n>=30 AND wilsonLb>breakevenWr AND profitFactor>=1.5 AND sqn>=1.5 AND expectancyR>0 AND tStat>tNeed AND dsr.pass.
- active -> probation when the last-30 profit factor < 1.2, or recent expectancy < 0, or sqn < 1.0.
- probation -> active again if it recovers (recent PF>=1.5 and recent expectancy>0), or -> retired if it keeps failing.
Set each strategy's confidence and kelly, write strategies.json, and hash-chain every lifecycle change into reflog.v2.jsonl.

6) ReasoningBank memory. addMemory appends to memory.jsonl. distillEpisodeLessons(state, rec, closedThisEp): group the run's trades by strategy and regime, then bank lessons: a heavy "blowup" lesson (importance 10) naming the worst strategy and regime with a corrective, a "loss" lesson (7) for the worst losing group, and a "win" lesson (5) for the best winning group. If no trades fired, bank a note to broaden the gates. retrieveLessons(regime, k=4): read the last 500 memories, score each by importance * recency (0.95^ageDays) * relevance (1 if same regime else 0.4), return the top k.

7) onEpisodeEnd(state, rec, cfg): score strategies, distill lessons, measure this run's edge (mean realized R). If it survived well (hit goal, or ran out of time in profit) and edge>0, raise unlockedLevel by 1 and kellyFraction by 0.07*clamp(edge,0.2,1.2). If it blew up, drop unlockedLevel by 1 and kellyFraction by 0.03. Set leverageCap = clamp(leverageStart + unlockedLevel * earnItUnlockStep, leverageStart, leverageCeiling). Bump generation, snapshot it into generations.jsonl with a plain-English note, and reflog it.

8) evolveTick(state, cfg): the same earn-it dial but on a live cadence between runs. Needs 4+ closed trades. edge = mean of the last 25 realized R. If edge>0.05 and equity is above the run start and drawdown<15, raise the level and kelly a little. If edge<-0.05 or drawdown>=18, lower them. Recompute leverageCap the same way. Reflog any level change.

9) buildBrainV2(state, regimeStr): a compact digest object for the dashboard: generation, episode, regime, aggression, importance, lifetime, the strategies list, active count, an avoid list, the retrieved lessons, and the recent generations. Also add onClose(state, pos, reasonTag) that accrues importance, and collectWorldV2 as a passthrough that reads world.v2.json.

Tell me plainly: the bot now scores its own strategies, banks lessons from wins and blow-ups, and only unlocks more leverage after it earns it.
This is the memory the reel shows off. The Lessons and Evolution tabs come straight from here. The bot learns hardest from getting wrecked, writes down what killed it, and refuses to bet bigger until it has proof it deserves to.

Prompt 7: The senses (what is happening in the world)
This feeds the bot real-world mood. Fear and greed, funding rates, headlines, all from free public sources with no keys. It powers the World tab. If a source is down, it just shows a dash instead of a fake number.

Crypto Fear and Greed Index (one free source it reads)
Prompt 7 (paste into Claude Code)
Copy
Keep building FabInvests. Now the world/senses layer, keyless and free. Create scripts/world/score.mjs and scripts/v2/world.mjs.

scripts/world/score.mjs (pure scoring, imports mean, stdev from ../lib.mjs):
- A small finance sentiment lexicon: a POS map (surge, rally, jump, gain, beat, upgrade, bullish, record, growth, breakout, adoption, approval, inflows, rebound, and similar, weighted 0.5 to 2) and a NEG map (crash, plunge, plummet, slump, miss, downgrade, bearish, selloff, hack, fraud, scam, liquidation, recession, bankruptcy, panic, and similar, weighted -1 to -2.5).
- lexiconScore(text): lowercase, strip punctuation, sum word weights, flip a weight to -0.7x if the prior word is a negator (not, no, never, without, despite), normalize to the range -1 to 1 (dividing the sum by 3), return 0 if no hits.
- fngBand(v): "extreme_fear" <=24, "fear" <=44, "neutral" <=55, "greed" <=74, else "extreme_greed"; "unknown" if the value is missing.
- regimeScore(m): from Yahoo macro quotes (each { price, changePct }) for TNX, VIX, DXY, oil, gold, build a score (dollar up lowers it, yields up lower it, high VIX lowers it, calm VIX raises it) clamped to -1..1, and return { label (risk_on / risk_off / neutral), score, posture (defensive / cautious / normal / aggressive), drivers }.
- aggregateNews(items): score each { title } with lexiconScore, return { mean_s, dispersion, volume, impact, n, top, mixed (true when dispersion > 0.45, meaning the news disagrees so do not trust the average) }.

scripts/v2/world.mjs (imports V2, readJSON, writeJSON, now, round, clamp from ./store.mjs; getJSON, getText, fetchQuote from ../lib.mjs; and the score.mjs functions). It polls a set of free sources on a cache with a TTL per source, degrades gracefully, and never blocks the trading loop. Sources, all keyless:
- macro: Yahoo quotes for ^TNX, ^VIX, DX-Y.NYB, CL=F, GC=F, scored by regimeScore.
- cryptoFng: api.alternative.me/fng/?limit=1 (crypto Fear and Greed).
- cnnFng: production.dataviz.cnn.io/index/fearandgreed/graphdata (stock Fear and Greed).
- cboePutCall: try the current CBOE put/call CSVs; HONESTLY reject any row older than about 6 days so a stale file shows a dash, not a fake-live number.
- hyperliquid: POST api.hyperliquid.xyz/info { type: "metaAndAssetCtxs" } for BTC, ETH, SOL funding, open interest, and mark; compute an average 8h funding rate and a crowd read (longs vs shorts crowded).
- stocktwits: api.stocktwits.com/api/2/streams/symbol/SYM.json for AAPL, NVDA, TSLA bull/bear counts.
- fedHeadlines: the Federal Reserve press RSS titles.
- cryptoNews: Cointelegraph and Decrypt RSS titles, aggregated with aggregateNews.
- gdeltTone: GDELT tonechart for "stock market".
Cache each with its own TTL (5 to 60 minutes), and fall back to the last good cached value if a fetch fails. Write everything to world.v2.json and set state.fundingRate from the live hyperliquid funding. Return a compact digest with exactly these fields the dashboard reads: regime, risk_posture, macro, crypto, fearGreedCrypto, fearGreedStocks, putCall, fundingRate, whaleCrowd, oiUsd, fed, headlines, newsMood, social, thesis, deep_due.

Confirm the world layer pulls live data with no keys, and that a dead source shows a dash instead of a made-up number.
Now the bot can feel the market mood, all from free public data. And it stays honest even here. When a data feed goes quiet, the dashboard shows a dash, never a fake reading. That honesty rule runs through the whole app.

Prompt 8: The engine (it ties everything together)
This is the loop that runs it all. Every cycle it pulls prices, marks positions, charges funding, checks for wipe-outs, runs the strategies, sizes the bets, and saves the results. It is the beating heart of the bot.

Prompt 8 (paste into Claude Code)
Copy
Keep building FabInvests. Now the engine that runs everything. Create scripts/v2/init.mjs and scripts/v2/engine.mjs.

scripts/v2/init.mjs: import V2, readJSON, writeJSON from ./store.mjs, loadConfig from ../lib.mjs, freshV2State from ./episode.mjs, ensureStrategies from ./strategies.mjs. If a v2 state already exists and there is no --force flag, print its status and exit. Otherwise write a fresh state (freshV2State), seed the strategy library, write an empty pending queue, and print that Episode 1 started with the starting collateral, leverage start, ceiling, Kelly, and goal.

scripts/v2/engine.mjs: the always-on loop, zero AI tokens. Import everything: store helpers, lib (fetchQuote, fetchFx, fetchHistory, indicators, regime), perp as P, the episode functions, runStrategies, sizeOrder, the brain functions (onEpisodeEnd, onClose, buildBrainV2, scoreStrategies, evolveTick), and collectWorld from world.mjs. Support a --once flag for a single cycle. Each cycle does this exact order:

1) Read state. Get the FX rate. Fetch quotes for all watchlist and index symbols in parallel; keep the last good value marked stale on a failed fetch. Refresh 1-year daily history every historyRefreshMinutes (needed for the 200-day trend filter), and 5 days of 15-minute crypto bars every ~10 minutes.
2) Build enriched quotes (price plus indicators plus daily closes plus the intraday channel for crypto). Compute the market regime.
3) markAndManage: for each open position, update its MARK price with an EMA (alpha from config), accrue 8h funding on crypto at the funding timestamps, then in strict order check honest liquidation on mark, then stop-loss, then take-profit, then a time-stop (no trade sits past maxHoldHours), then a trailing exit once profit peaks and gives back. Every close charges real fees and slippage, writes a "post" journal row with net_pnl and realized_R, and calls onClose.
4) Recompute equity = wallet + sum of (margin + unrealized) at mark.
5) Run any queued pending orders through sizeOrder, then open or close them. openPosition pays the taker fee, records the "pre" journal row, appends a fill to trades.v2.jsonl, and deducts margin plus fee from the wallet. Never open more than maxConcurrentPositions.
6) Run runStrategies, size each order, and open or close them.
7) recordEquityPeak. Check episodeEndReason. If a run ended, close survivors at mark, finalizeEpisode, run onEpisodeEnd (the post-mortem and level-up), then nextEpisode. If any trade closed but no run ended, rescore strategies live. On the brainLoopMinutes cadence, run evolveTick.
8) collectWorld. Then persist state, prices, an equity row, and publish the full signals object.

publishSignals writes signals.v2.json with: ts, iso, version 2, episodeNum, equity, walletBalance, startingCapital, goal, totalPnl, totalPnlPct, progressPct, goalGap, realizedPnlEpisode, peakEquity, maxDrawdownPct, riskState, regime, generation, aggression, lifetime, fundingRate, investedNotional, grossLeverage, a positions array (symbol, name, market, side, leverage, notional, margin, entry, mark, liqPrice, uPnl, roiPct, fundingAccrued, setup_tag, strategy_id, stopPct, targetPct, reason), a watch array, the recent episodes, the brain digest (buildBrainV2), and the world digest.

The immutable core is HONESTY: next-tick fills, mark-price liquidation, real fees, funding, and slippage, and it never rounds a loss away. Run node scripts/v2/engine.mjs --once against a fresh state and show me one clean, honest cycle in the log.
The bot is alive now. It can trade a full cycle on its own, on real prices, with fake money. You are past the whole engine. Everything left is the face you look at while it works.

Prompt 9: The look (the calm sakura design)
Now the dashboard style. This is the exact soft, warm, cherry-blossom look from the reel. The real colors, fonts, and card styles are in the prompt, so your app looks like mine, not a plain default.

Prompt 9 (paste into Claude Code)
Copy
Keep building FabInvests. Now the dashboard shell and design system in the web/ Next.js app. Build these files.

web/app/globals.css: use EXACTLY this (it defines the whole warm sakura theme with Tailwind v4 tokens):

@import "tailwindcss";

@theme {
  --color-cream: #fff7f0;
  --color-cream2: #fdeee3;
  --color-sakura: #ff9eaa;
  --color-sakurasoft: #ffd2d9;
  --color-lav: #807ea8;
  --color-lavsoft: #cdcaeb;
  --color-gold: #e3c16f;
  --color-ink: #562135;
  --color-inksoft: #8a5a68;
  --color-up: #1f9d62;
  --color-down: #e5566f;
  --color-downink: #c0354f;
  --color-upink: #157a4a;

  --font-display: "Fraunces", "Times New Roman", serif;
  --font-jp: "Zen Maru Gothic", sans-serif;
  --font-body: "M PLUS Rounded 1c", ui-rounded, sans-serif;
}

html, body { padding: 0; margin: 0; }
body { font-family: var(--font-body); color: var(--color-ink); background: #fbeee6; -webkit-font-smoothing: antialiased; min-height: 100vh; }

.sky { position: fixed; inset: 0; z-index: -2; background: radial-gradient(120% 80% at 78% 8%, #ffe7c4 0%, rgba(255,231,196,0) 42%), radial-gradient(90% 70% at 20% 0%, #ffd9e0 0%, rgba(255,217,224,0) 45%), linear-gradient(180deg, #fef0e6 0%, #fbe5e6 38%, #efe6f3 72%, #e7e3f1 100%); }
.sun { position: fixed; top: 6%; right: 12%; width: 190px; height: 190px; z-index: -2; border-radius: 9999px; background: radial-gradient(circle, #ffe9b8 0%, #ffd1a6 45%, rgba(255,209,166,0) 72%); filter: blur(2px); opacity: .85; }

.card { background: rgba(255, 252, 249, 0.72); backdrop-filter: blur(14px); border: 1px solid rgba(255, 255, 255, 0.7); border-radius: 28px; box-shadow: 0 10px 34px -16px rgba(123, 74, 90, 0.32), 0 2px 8px -4px rgba(123,74,90,.15); }
.card-quiet { background: rgba(255, 252, 249, 0.55); border: 1px solid rgba(255, 255, 255, 0.6); border-radius: 24px; }
.pill { border-radius: 9999px; background: rgba(255,255,255,.6); border: 1px solid rgba(255,255,255,.7); }

.font-display { font-family: var(--font-display); }
.font-jp { font-family: var(--font-jp); }
.tnum { font-variant-numeric: tabular-nums; }

.petal { position: fixed; top: -8%; z-index: -1; width: 14px; height: 14px; background: radial-gradient(circle at 30% 30%, #ffd6dd, #ff9eaa); border-radius: 12px 1px 12px 1px; opacity: 0; pointer-events: none; animation: fall linear infinite; }
@keyframes fall { 0% { transform: translateY(-10vh) translateX(0) rotate(0deg); opacity: 0; } 10% { opacity: .9; } 90% { opacity: .8; } 100% { transform: translateY(112vh) translateX(60px) rotate(320deg); opacity: 0; } }
@keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.floaty { animation: floaty 4s ease-in-out infinite; }
@keyframes pulsering { 0% { box-shadow: 0 0 0 0 rgba(31,157,98,.45); } 70% { box-shadow: 0 0 0 10px rgba(31,157,98,0); } 100% { box-shadow: 0 0 0 0 rgba(31,157,98,0); } }
.live-dot { animation: pulsering 2.2s infinite; }

::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: rgba(192, 158, 170, .4); border-radius: 9999px; }
::-webkit-scrollbar-track { background: transparent; }

web/app/layout.tsx: a root layout that sets the metadata title "@FabRichhhhhh . Trading Bot", imports globals.css, loads the Google Fonts Fraunces, Zen Maru Gothic, and M PLUS Rounded 1c, and renders a fixed div.sky and div.sun behind the children.

web/app/page.tsx: render a Root component.

web/app/components/Root.tsx: a client component that fetches /api/state every 6 seconds with cache no-store. While loading, show a friendly loading screen. When data arrives, render the DashboardV2 component (built next) passing the data. Show a small bot mascot on the loading screen.

web/app/lib/format.ts: helper functions used everywhere. usd(n, dp=2) formats US dollars with a dash for null. pct(n) adds a sign and a percent. signed(n) prefixes plus or a minus sign to a dollar amount. tone(n) returns "text-upink" if n>=0 else "text-downink". price(n) shows 4 decimals under 1 else 2. timeAgo(ts) returns "5s ago", "3m ago", "2h ago", "1d ago".

web/app/components/visuals.tsx: two client SVG components. Sakura renders about 16 falling petals using the petal class, positioned with a deterministic pseudo-random so the server and client match. Mascot({ size, mood }) draws a cute lavender robot face (a rounded head, a dark face screen, glowing eyes when happy or closed curves when asleep, a pink antenna, a smile, blush) using the floaty class.

web/app/api/state/route.ts: a dynamic Next route (force-dynamic, revalidate 0). It reads files from the DATA folder one level up from web/ (path.resolve(process.cwd(), "..") then /data). Read config.json, and the v2 files: signals.v2.json (or signals.json if it is version 2) as v2.signals, state.v2.json, the last 40 episodes, the last 30 generations reversed, strategies.json, the last 20 memory rows reversed, a downsampled equity.v2.jsonl (max 320 points), and the last 60 trades reversed. Return JSON with a v2 object holding all of that plus serverTs, with Cache-Control no-store. When a file is missing, return safe empty defaults so the dashboard never crashes.

Build these, then run the web dev server briefly and confirm the loading screen and the soft pink background show up. Do not build the dashboard tabs yet.
You should now see the soft pink sky, the little glowing sun, and cherry petals drifting down, with a friendly robot loading. That calm look is not an accident. It makes a scary topic like trading feel safe and kind.

Prompt 10: The dashboard (the eight tabs)
This is the screen from the reel. Eight tabs that show the bot living and learning. This prompt describes each tab, its cards, its exact wording, and its colors, so your dashboard matches mine.

Prompt 10 (paste into Claude Code)
Copy
Keep building FabInvests. Now the main dashboard. Create web/app/components/DashboardV2.tsx, a client component that takes { data } and reads data.v2 (signals, episodes, generations, strategies, memory, equity, trades). Use the format helpers and the Sakura and Mascot visuals. Layout: a left sidebar on desktop that becomes a scrolling pill bar on mobile, inside a max-width 6xl container, everything on .card and .card-quiet glass panels. The sidebar has a round pink-to-gold "F" badge, the name @FabRichhhhhh, the label "Apex Trading Bot . v2", and this exact nav, each with a small icon: Overview, Positions, Episodes, Evolution, Strategies, World, Lessons, Trades. At the bottom of the sidebar, this exact line: "Simulation on real live prices. Fake money, real lessons. Honest by design, it can lose everything, it never lies."

Colors from the theme: up = green (up / upink), down = red (down / downink), gold for warnings, lav (lavender) for candidates. Numbers use the tnum class. Build these eight views:

OVERVIEW:
- A "while you were away" banner at the top that shows the latest finished run: a skull for a blow-up, a target for a goal hit, a sparkle otherwise, with the run number, the return percent colored, how long ago, and the new generation, leverage, and Kelly. If there is no finished run yet, show a friendly "Run 1 in progress" seedling note.
- A big equity card: "Account Equity . Episode N", the equity in large display serif, the profit in dollars and percent with "this run . from $X", plus gross leverage and max drawdown on the right. Below it a small green/red sparkline of the equity curve. Below that a goal bar labeled "Goal . $500" with either "no deadline, fast as it can" (when the deadline is 1000 hours or more) or the hours left, and the progress percent, filled with a sakura-to-gold-to-green gradient.
- A "The Bot" card with a live dot, the Mascot, the generation, the number of runs and blow-ups, the best run, the last tick time, and an "Aggression . earned leverage" dial showing current leverage over the ceiling, a green-gold-red bar, the Kelly percent, and the unlock level.
- An open positions grid and a small World card (see below).

POSITIONS: a grid of position cards. Each shows a LONG or SHORT pill (green or red), the symbol without "-USD", the leverage, the strategy id, the unrealized profit and ROI colored, then Entry, Mark, and Notional, then a liquidation runway bar. The runway shows how far the mark is from the liquidation price: under 4 percent is red "danger", under 12 percent is gold "watch", else green "safe", with a bar that drains as the price nears liquidation. Add the note: "Liquidation is computed on a smoothed mark price, with real fees + funding + slippage. The bar shows how close each position is to being wiped out."

EPISODES: intro line "Each run goes until it hits the goal, runs out of time, or blows up, then resets and tries again, sharper." Once at least 3 runs finish, show a bar timeline (green for a win, gold for a small loss, red plus a skull for a blow-up, height scaled to the return). Before that, show an "in progress" card. Below, a "Finished Runs" list with the run number, the end reason, the peak, the drawdown, and the return colored.

EVOLUTION: title "Evolution, Level-Ups", intro "Every finished run banks a lesson and may promote or retire a strategy, retune Kelly, and unlock (or claw back) leverage." Then a card per generation with "Gen N after run #X", the leverage and Kelly, and the plain-English note. If none yet, a sleepy Mascot and "No level-ups yet".

STRATEGIES: title "Strategy Book", intro "A strategy only earns active after it proves a real edge (statistical gates + Deflated Sharpe). Losers get retired." A card per strategy with its name, a status pill (active green, candidate lavender, probation gold, retired red), n and Kelly, and a 4-cell grid: Exp R (colored), PF, DSR, Conf. If every strategy is still an early candidate, show a note that they are all in evaluation.

WORLD: two Fear and Greed gauges (crypto and stock), each a labeled card with the band word (Extreme Fear to Extreme Greed) colored, and a red-to-gold-to-green bar with a marker. Then a "Macro & Flow" card with a grid: Regime, Funding 8h, Crypto OI, Whales, News mood, Put/Call. Show the macro line, the thesis in a quiet card with a blossom, and a Headlines card listing Fed and news lines.

LESSONS: title "Lessons Banked", intro "The bot learns harder from blow-ups than wins. Each is tagged to a market regime." A card per lesson: the title, a kind pill (blowup red, win green, else gold), the lesson text, and the regime plus importance. If none yet, a sleepy Mascot and an empty note.

TRADES: title "Recent Fills". A row per fill: an open/close pill, a LONG/SHORT tag, the symbol, the leverage, the reason, and on the right the realized profit for a close (colored) or the margin for an open.

Make it fully responsive: the body never scrolls sideways, wide rows scroll inside their own card. Then run the web dev server and show me the Overview tab rendering live from the engine data.
This is the screen from the video. Eight tabs, all live, all reading straight from the bot. It updates every few seconds on its own. Stop and look at what you just built. That is a real trading dashboard, made from prompts.

Prompt 11: Turn it on
The last step. Start the bot, start the dashboard, and open it in your browser. Then watch it trade, learn, and level up on its own, on real prices, with fake money.

Prompt 11 (paste into Claude Code)
Copy
Final step for FabInvests. Wire it up and run it, and hold my hand through it.

1) Start a fresh run: from the root folder run node scripts/v2/init.mjs. Show me it printing "Episode 1" with the starting collateral and goal.

2) Start the bot in the background so it keeps trading: run node scripts/v2/engine.mjs so it loops every 30 seconds. Show me the first few cycle log lines (equity, positions, leverage, generation). Confirm it is fetching real live prices and that every fill charges real fees and slippage.

3) Start the dashboard: in the web/ folder run the dev server on port 3002 (next dev -p 3002). Tell me to open http://localhost:3002 in my browser.

4) Walk me through what I am seeing on each tab, in plain words: the equity and goal bar on Overview, any open positions and their liquidation runway, the Episodes timeline building up, the Strategy Book filling in stats, the World mood, and the Lessons the bot banks after its first run ends.

5) Remind me of the truth, clearly: this is a paper trading simulation on real prices with fake money. It has no guaranteed edge. Any gain on screen is variance, not skill. Never point it at real money. This is not financial advice.

Keep both running. Tell me in one sentence how to stop them (close the terminal windows) and how to start them again next time (node scripts/v2/engine.mjs from the root, and next dev -p 3002 from web/).
That is the whole thing, live on your screen. It trades, blows up, learns, resets, and levels up, all by itself, and it never lies to you about a loss. You built a real AI trading bot from prompts. You never wrote a line of code.

How you actually use it
You just watch it. Leave the bot running and open the dashboard whenever you want. The Overview shows how the current run is going. The Episodes tab fills with past runs over time.

The real learning is in two tabs. Evolution shows each level-up and why. Lessons Banked shows what the bot taught itself, in plain words, tagged to the market mood. Watch a blow-up, then read the lesson it wrote. That is the whole point of the project.

Want to change the game? Open config.json. You can change the starting balance, the goal, the markets it watches, and how bold it starts. Ask Claude to tweak a number for you and explain what it does. It is your bot now.

You are not learning to day trade. You are watching a machine learn to, with fake money, and reading its honest report card. That is a safe, calm way to understand how markets and risk really work.

If it breaks
The dashboard says loading forever: the bot must be running. Start it with node scripts/v2/engine.mjs from the root folder, then refresh the page.
The dashboard is empty or all dashes: run node scripts/v2/init.mjs once first, then start the engine. The dashboard reads the files the engine writes.
Prices show as stale or a source shows a dash: a free feed is down or blocked. This is normal and honest. Wait a few minutes, it retries on its own.
The engine log shows a fetch error: some free data sources block data-center networks. Run it on your home internet, not a server, and it works.
The web app will not start on 3002: another app may hold that port. Ask Claude to run it on a different port and open that one instead.
It is not opening any trades: that is fine early on. It only trades when a real signal fires and the market is open. Give it time, and remember crypto trades 24/7.
A number looks wrong: never patch it to look nice. Ask Claude to find the real cause. The honesty rule matters more than a pretty screen.
Is this real trading with real money?
No. It is a paper trading simulator. It uses real live prices but fake money, so you risk nothing real. It is a learning tool, not a money machine, and this is not financial advice.
Do I need to know how to code?
No. You paste my eleven prompts in order. Each one has the real code inside it, so Claude builds each part exactly right. You are the director. You never write a line of code.
Does it actually make money?
It has no guaranteed edge, so any gain on screen is luck, not skill. That is exactly why it trades on paper first. If it were pointed at real money, real loss would be possible.
Is it really free to run?
The bot uses free public price data with no keys and plays with fake money, so running it costs nothing. Building it needs Claude Code, which needs a paid Claude plan.
Why leverage? Is that not risky?
Yes, leverage is risky, which is the point of the lesson. The bot has to earn more leverage by proving an edge, and it can be liquidated. You watch that danger safely, with fake money.
What makes this bot different?
Most trading bots hide the losses. Mine shows you the real loss math. I built it to charge real fees and funding, liquidate truthfully, and never fake a profit. Honesty is the whole design, and you will not find it anywhere else.
Can I switch it to real money later?
Please do not. It has no proven edge and real money means real, total loss is possible. Keep it as a learning simulator. That is what it was built to be.
This still feels too advanced. What do I do?
Then relax. Set up Claude Code, open your folder, and paste prompt one. Then the next, and the next. I wrote every prompt to build itself and reassure you along the way. You just keep pasting.
This free guide is the what. If you want the how, I put everything I know into one course, AI Mastery. It is the only AI course you will ever need. It shows you how to build apps, agents, automations, and bots like this one, step by step, so you understand every piece. Want me to build your first one with you, live? I take a few 1:1 people each month. And if you would rather have it built for you, that is Hire FabRich, my done-for-you service where my team builds the whole thing.

The free guide ends her
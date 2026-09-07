# 07 — Trading engine and operations

## SOURCE REQUIREMENT — initialization (P8)

`node scripts/v2/init.mjs` loads config and checks V2.state. Existing state without `--force`: print status and exit; do not reset learning or collateral. Otherwise write freshV2State, ensure strategies, and empty pending queue. Print Episode 1 with starting collateral, leverage start/ceiling, Kelly and goal. With existing strategy stats, ensureStrategies must not clobber them. SOURCE DOES NOT SPECIFY clearing journals/history on force; therefore do not assume force is a career reset.

## Exact source cycle order — P8

1. Read state and fetch USD/INR FX. Fetch watchlist and index quotes in parallel. Failed quote: retain last good value marked stale. Refresh one-year daily history every `historyRefreshMinutes=20`, and five days of 15-minute crypto bars approximately every ten minutes.
2. Enrich quotes with indicators, daily closes and intraday channel data. Compute lib market regime.
3. `markAndManage`: update each position's EMA mark with alpha .25; accrue crypto funding at crossed UTC timestamps; evaluate exits in the strict order **liquidation → stop-loss → take-profit → four-hour time-stop → trailing exit**. Each close charges fees/slippage, writes a post journal row with net_pnl and realized_R, and calls onClose.
4. Recompute equity = wallet + sum(isolated margin + unrealized P&L at mark).
5. Process previously queued pending orders through sizeOrder, then open/close them. Opens pay taker fee, append pre journal and open fill, deduct margin plus fee from wallet; enforce max ten positions.
6. Run runStrategies, size each resulting order, and open/close them.
7. recordEquityPeak; check end reason. If ending: close survivors at mark, finalizeEpisode, onEpisodeEnd, nextEpisode. Otherwise rescore strategies if any close occurred. At `brainLoopMinutes=8`, call evolveTick.
8. collectWorld. Persist state, prices, one equity observation and full signals.

`--once` runs one cycle. P11 says the continuous engine loops every 30 seconds. SOURCE DOES NOT SPECIFY fixed-rate versus completion-relative scheduling, retry/backoff, overlap handling or process shutdown semantics.

### Required source contradiction

P4/P8 mandate **next-tick fills**, but step 6 executes orders generated from the current tick. These are not equivalent. The recommended interpretation is a queue boundary: cycle t generates intents, t+1 or later fills using a fresh observation acquired after the intent. This changes literal step 6 and requires an explicit decision; see D01 in 19. Exit management also needs a stated distinction between immediate risk liquidation and delayed strategy exits.

## Price and execution boundaries

SOURCE REQUIREMENT: last tick is not the liquidation mark. `emaUpdate` creates a smoothed mark. `fillPrice` adds adverse half-spread plus square-root impact to the reference. `openPosition` sets entryPrice to its argument entryMark, while P8 requires slippage-bearing fills. SOURCE DOES NOT SPECIFY whether entryMark passed to the builder is actually the executed price, which reference is used on closes, or whether stop/target triggers use mark throughout. Do not double-charge slippage by both shifting the fill and subtracting a second slippage fee.

SOURCE REQUIREMENT: no fake fills/prices/profits; do not trade on missing/stale observations. Historical closes are indicators, not guaranteed executable prices. Crypto fallback spot and Yahoo equity quotes may differ in venue/session/currency and latency from an imagined leveraged contract.

## Ledger — source statements and derived conservation

Source entry: margin M and fee F_open leave free wallet. Position collateral becomes M. Source equity: W + Σ(M + U). Source close: costs and slippage charged, trade results journaled. SOURCE DOES NOT SPECIFY the complete settlement algorithm or negative-isolated-equity treatment.

**DERIVED accounting identity, with explicit assumptions:** if signed funding C is posted to wallet once, quantity Q is positive, direction s is ±1, entry/exit are executed prices E/X, and closing notional is Q×X:

- Entry wallet: W_after = W_before − M − F_open.
- Gross realized P&L G = sQ(X−E).
- Close wallet: W_after = W_before + M + G − F_close (C already posted separately).
- Net trade P&L = G − F_open − F_close + C − borrow costs, if borrow costs are implemented.
- Across a flat episode, final wallet = initial capital + sum(net trade P&L), provided no other flows or resets occurred.

These identities specify the proposed conservation target, not a source-defined settlement venue. If funding is posted into isolated margin instead, adjust both liquidation and close settlement consistently; never post it twice. The source liquidation threshold does not react to such margin changes.

## Closing semantics and episode end

`onClose` accrues learning importance; `loadClosedV2` later joins the journal. Stable trade identity must survive restart (recommended). Source does not specify partial closes; assume no partial-fill support has been promised.

At a terminal check, survivor liquidation costs can move final equity below the goal. **RECOMMENDED IMPROVEMENT:** separately record trigger reason and post-settlement outcome, recompute equity after all closes, append old-run final equity before fresh-run state. Never erase remaining positions by nextEpisode before settlement. Losses below zero are real simulator deficits unless an explicitly documented venue model says otherwise; do not clamp them away to satisfy the marketing narrative.

## Published metrics — P8

`publishSignals` writes `ts,iso,version:2,episodeNum,equity,walletBalance,startingCapital,goal,totalPnl,totalPnlPct,progressPct,goalGap,realizedPnlEpisode,peakEquity,maxDrawdownPct,riskState,regime,generation,aggression,lifetime,fundingRate,investedNotional,grossLeverage,positions,watch,episodes,brain,world`.

Position fields: `symbol,name,market,side,leverage,notional,margin,entry,mark,liqPrice,uPnl,roiPct,fundingAccrued,setup_tag,strategy_id,stopPct,targetPct,reason`. Exact array key for “recent episodes” is implied by usage but not independently given as code; use the proposed API contract in 15 for completion.

**DERIVED recommended metric conventions:** totalPnl=equity−startingCapital; percent=100×totalPnl/startingCapital; goalGap=target−equity; progress=100×(equity−goal.startEquity)/(target−goal.startEquity); gross leverage=sum(abs(mark notional))/equity. Notional valuation basis, clipping, zero/negative denominators and whether fees enter position ROI are SOURCE DOES NOT SPECIFY. UI clipping must not overwrite raw values.

## Continuous operation — source commands (P11)

```text
node -v
node scripts/v2/init.mjs
node scripts/v2/engine.mjs --once
node scripts/v2/engine.mjs
# Separately, from web/:
next dev -p 3002
# Browser:
http://localhost:3002
```

The comment lines above describe execution locations, not added scripts. P1 npm aliases point to unresolved non-v2 files. **RECOMMENDED IMPROVEMENT:** after installing declared web dependencies, use its existing script as `npm run dev -- -p 3002` if npm is the chosen manager. This is an operational convenience, not the literal source command.

Source troubleshooting: initialize once if empty, keep engine running, retry unavailable public feeds, check port conflicts, allow no-trade periods, never patch metrics cosmetically. The assertion that home internet guarantees API availability is unverified. The source says close terminal windows to stop, despite asking for background operation; recommended supervised shutdown/restart behavior is in 19.

## SOURCE DOES NOT SPECIFY / implementation blockers

Order queue acknowledgement and cancellation, histories across restart, time-zone/session holiday rules, stale-price thresholds, FX conversion placement, marketMax versus tier max enforcement, source rate units, same-cycle equity refresh after new fills, below-minimum notional rejection, correlated exposure limits, capital-floor implementation, or whether world collection awaits network work. Resolve these before claiming honest continuous operation.

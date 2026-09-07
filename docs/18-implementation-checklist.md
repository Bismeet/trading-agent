# 18 — Implementation execution tracker

All boxes are intentionally unchecked: this change implements documentation only. **S** = SOURCE REQUIREMENT; **R** = RECOMMENDED IMPROVEMENT. Approval of a recommendation does not erase its source distinction. Follow dependency gates in 03; tests in 16 provide detailed oracles.

## Decisions and evidence

- [ ] R — Record approval/rejection for D01–D14 in 19 before affected implementation.
- [ ] R — Preserve source snapshot/attribution and exact config reference.
- [ ] R — Resolve all C01–C12 contradictions without silent changes.
- [ ] R — Verify package versions, Node/peer requirements and current provider contracts.
- [ ] R — Complete the Security Analyst Agent review before a security-readiness claim.
- [ ] R — Confirm no real-money execution or runtime LLM dependency enters scope.

## Foundation / P1

- [ ] S — Check node -v; install Node LTS if absent.
- [ ] S — Create scripts/, scripts/v2/, scripts/world/, data/, web/app/.
- [ ] S — Root package name/version/private/type exactly specified; no third-party engine dependencies.
- [ ] S — Record exact root init/cycle/daemon scripts.
- [ ] R — Resolve missing scripts/init.mjs and scripts/daemon.mjs command targets explicitly.
- [ ] S — Create complete config.json with every key/value from 05.
- [ ] R — Verify source payload comparison, not merely a subset of settings.
- [ ] S — Configure exact web dependencies and development declarations.
- [ ] S — Set web dev/build/start scripts, App Router, TypeScript, Tailwind v4.
- [ ] S — Ignore node_modules, .next and data/*.log.
- [ ] R — Record runtime/package-manager versions and reproducible lockfile.

## Shared library / store / P2

- [ ] S — Define ROOT, DATA, PATHS and every V2 path in 06.
- [ ] S — Support FAB_SIGNALS override.
- [ ] S — Implement ensureData, readJSON fallback, two-space atomic writeJSON.
- [ ] S — Implement appendJSONL/readJSONL last-N semantics and log.
- [ ] S — Implement loadConfig, now and iso.
- [ ] S — Implement getJSON/getText with 12s timeout and desktop User-Agent.
- [ ] S — Implement YH and exact fetchQuote success/failure shapes.
- [ ] S — Add -USD Coinbase spot fallback only on quote failure.
- [ ] S — Implement daily fetchHistory defaults and engine override capability.
- [ ] S — Implement fetchFx and document literal 83.0 fallback.
- [ ] R — Adopt approved non-fabricated FX/quote staleness policy.
- [ ] S — Implement sma, rsi, momentum, indicators and lib regime labels.
- [ ] R — Approve units/warmups/trend/bias/high-vol definitions first.
- [ ] S — Implement sha256 first16hex, mean, sample stdev, Wilson, SQN, PF and expectancyStats.
- [ ] S — Re-export helpers; add round(x,d=2) and clamp.
- [ ] R — Test missing/corrupt/truncated files and atomic read visibility.

## Money core / P2

- [ ] S — Implement sideSign and imr exact source behavior in reference fixtures.
- [ ] S — Implement tierFor, maintenanceMargin, maxLeverageAt.
- [ ] S — Implement liqPrice and bankruptcyPrice exact formulas.
- [ ] S — Implement unrealizedPnl, positionEquity and inclusive isLiquidated.
- [ ] S — Implement sizeFromMargin and marginForNotional.
- [ ] S — Implement emaUpdate seed/update behavior.
- [ ] S — Implement tradeFee, fundingPayment and crossedFundingTimestamps.
- [ ] S — Implement slippageFraction and fillPrice with all defaults.
- [ ] S — Implement openPosition fields and markPosition result.
- [ ] S — Verify 80400,119600,96400 liquidation sanity vectors.
- [ ] R — Validate invalid side/price/margin/leverage/tier inputs.
- [ ] R — Test close direction, gap execution and no double slippage.
- [ ] R — Freeze accounting currency, maintenance model, funding destination and net P&L equations.

## Episodes / P3

- [ ] S — Implement all freshV2State fields, including lifetime/deep-world counters.
- [ ] S — Implement recordEquityPeak/current and maximum drawdown.
- [ ] S — Implement blowup→goal→time end precedence.
- [ ] S — Implement finalizeEpisode record/append/lifetime changes.
- [ ] S — Implement nextEpisode reset and preservation matrix.
- [ ] S — Implement setGoal using current equity and fresh start time.
- [ ] R — Resolve goal deadline versus episode timeout and autoReset option.
- [ ] R — Settle survivors before clearing positions; final record includes costs.
- [ ] R — Make terminal transition idempotent and cancel old-run intents.
- [ ] R — Correct no-history versus all-negative best-run representation.

## Strategies / P4

- [ ] S — Register tsmom with exact seed metadata.
- [ ] S — Register donchian with exact seed metadata.
- [ ] S — Register rsi2dip with exact seed metadata.
- [ ] S — Register mom_trend with exact seed metadata.
- [ ] S — Register orb with exact seed metadata/live-only restriction.
- [ ] S — Register ibreakout with exact seed metadata/intraday:true/forward-only restriction.
- [ ] S — Merge new seeds without resetting learned stats or existing statuses.
- [ ] S — Implement sigTsmom warmup/return/filter/confidence rules.
- [ ] S — Implement sigDonchian prior20 exclusion/filter/confidence rules.
- [ ] S — Implement sigRsi2dip 210-close requirement/RSI2 rules.
- [ ] S — Implement sigMomTrend long-only momentum/RSI rules.
- [ ] S — Implement sigOrb real-open timing, ~5m eligibility,30m range.
- [ ] S — Implement sigBreakoutIntraday prior48 completed15m close channel.
- [ ] S — Implement RSI2/channel/trend-flip strategy exits.
- [ ] S — Dispatch exits before entries; one position per symbol; max10.
- [ ] S — Apply market open/enabled and missing/stale-data restrictions.
- [ ] S — Apply 120s re-entry cooldown after queueing.
- [ ] S — Rank confidence×(.5+strategyConfidence) and preserve exact order fields.
- [ ] R — Resolve retN indexing, tie ordering and pending reservations.
- [ ] R — Persist session/cooldown/trade identity needed across restarts.

## Sizing / P5

- [ ] S — Return non-open orders unchanged.
- [ ] S — Apply account/market/ceiling leverage caps and source fallbacks.
- [ ] S — Implement explicit-margin bypass correctly.
- [ ] S — Implement strategy Kelly/account multiplier and non-strategy sizePct branch.
- [ ] S — Implement 15-close population log-vol calculation and fallback/clamps.
- [ ] S — Apply annual/sqrt365 target and [.25,1.7] multiplier.
- [ ] S — Apply positive-progress-only goal multiplier.
- [ ] S — Apply final max(0,wallet×.98) bound.
- [ ] R — Enforce minimum notional, fee-aware affordability and tier max at fill.
- [ ] R — Test underwater/no-bonus, near-start discontinuity and multiple-order budgets.
- [ ] R — Resolve root risk settings versus v2 controls, actual stop-risk and capital floor.

## Brain / P6

- [ ] S — Implement complete IMPORTANCE map and default2.
- [ ] S — Implement verified erf/normCdf/Acklam normInv/skewness/kurtosis helpers.
- [ ] S — Implement exact DSR guards/equations/rounding/unrounded pass flag.
- [ ] S — Implement loadClosedV2 last6000 lines, pre/post pairing and output fields.
- [ ] R — Resolve realized_R denominator and missing/duplicate pre/post behavior.
- [ ] S — Implement candidate promotion with every statistical gate.
- [ ] S — Implement last30 active→probation and recovery thresholds.
- [ ] R — Define exact retirement persistence and confidence mapping.
- [ ] S — Implement strategyKelly .12/.04 defaults, .4 factor, prior15, probation/retired/clamps.
- [ ] R — Record backtest prior provenance; never create fictitious prior values.
- [ ] S — Implement hash-chained lifecycle reflog writes.
- [ ] R — Specify canonical event serialization and stable identities.
- [ ] S — Implement addMemory and group-based blowup/loss/win/no-trade lessons.
- [ ] S — Implement last500 ranked retrieval, k4, recency .95 and relevance1/.4.
- [ ] R — Define memory schema, ranking ties, worst/best grouping metric.
- [ ] S — Implement onClose and compact buildBrainV2 digest.
- [ ] S — Implement collectWorldV2 read-only passthrough.
- [ ] S — Implement onEpisodeEnd edge and +.07/−.03 account changes.
- [ ] S — Recompute cap20+3.5×level bounded20..40; generation snapshot/note/reflog.
- [ ] S — Implement evolveTick ≥4 trades, last25 edge, ±.05 and DD15/18 predicates.
- [ ] R — Resolve live increments, Kelly limits, negative levels and new-trade cursor.

## World / P7

- [ ] S — Implement lexiconScore with negation, divide3 and clamp.
- [ ] R — Approve complete POS/NEG weights and macro scoring coefficients.
- [ ] S — Implement FNG bands and missingunknown.
- [ ] S — Implement aggregateNews fields and mixed dispersion>.45.
- [ ] S — Fetch macro Yahoo instruments.
- [ ] S — Fetch cryptoFng and cnnFng.
- [ ] S — Fetch current CBOE put/call and reject >~6-day-old rows.
- [ ] S — Fetch Hyperliquid BTC/ETH/SOL context through specified POST.
- [ ] R — Verify funding interval, rate/OI units and asset coverage.
- [ ] S — Fetch Stocktwits AAPL/NVDA/TSLA counts.
- [ ] S — Fetch Federal Reserve, Cointelegraph and Decrypt titles.
- [ ] S — Fetch GDELT stock-market tonechart.
- [ ] S — Implement per-source last-good caching with5–60m TTLs and no fake readings.
- [ ] R — Select exact TTLs, endpoint versions, observation expiry and bounded concurrency.
- [ ] S — Publish all17 world digest fields and update state.fundingRate.
- [ ] R — Define thesis/deep_due behavior without introducing runtime LLM calls.

## Engine / P8

- [ ] S — Implement idempotent init and explicit --force path.
- [ ] S — Seed strategy library and pending queue on fresh initialization.
- [ ] S — Implement --once and30s continuous v2 cycle.
- [ ] S — Fetch quotes in parallel and retain failed last-good values as stale.
- [ ] S — Refresh1y daily20m and5d/15m crypto~10m histories.
- [ ] S — Enrich quotes and compute trading regime.
- [ ] S — EMA mark positions and accrue crossed funding.
- [ ] S — Enforce liquidation→stop→target→time→trail management order.
- [ ] S — Journal every close with net_pnl/realized_R and call onClose.
- [ ] S — Execute pending orders through sizing, fees and pre/fill records.
- [ ] R — Implement approved next-tick queue barrier for new strategy orders.
- [ ] R — Reconcile equity after every execution batch before terminal check.
- [ ] S — Finalize/learn/reset episodes and rescore nonterminal closes.
- [ ] S — Run brain cadence and nonblocking world collection.
- [ ] S — Persist state, prices, equity and complete publishSignals schema.
- [ ] R — Tag snapshots/runs/events and commit/recover writes consistently.
- [ ] S — Observe one clean --once log against real feeds before runtime success claim.

## API / design / P9

- [ ] S — Create exact theme tokens, fonts, sky/sun, cards, petals and animations.
- [ ] S — Implement metadata/layout/page/Root and friendly Mascot loading.
- [ ] S — Implement usd/pct/signed/tone/price/timeAgo.
- [ ] S — Implement deterministic Sakura and size/mood Mascot SVGs.
- [ ] S — Create dynamic no-store GET /api/state with root/data resolution.
- [ ] S — Read version2 signal fallback, state and every bounded history.
- [ ] S — Apply limits40 episodes/30 generations/20 memory/320 equity/60 trades.
- [ ] R — Approve exact response schema, defaults, errors and snapshot consistency.
- [ ] S — Poll every6s without cache.
- [ ] R — Distinguish server time from engine heartbeat; handle stale/error refresh honestly.

## Dashboard / P10

- [ ] S — Implement exact branding/sidebar disclaimer and eight nav labels.
- [ ] S — Overview banner, equity/P&L/sparkline/goal, bot/aggression and positions/world.
- [ ] S — Positions metrics and4%/12% runway states with exact note.
- [ ] S — Episodes≥3-run timeline and Finished Runs list.
- [ ] S — Evolution generation cards/notes and empty state.
- [ ] S — Strategy Book status colors, n/Kelly/Exp R/PF/DSR/Conf and evaluation note.
- [ ] S — World gauges, Macro & Flow, thesis and headlines.
- [ ] S — Lessons cards/kinds/regime/importance and empty state.
- [ ] S — Recent Fills open/close and margin/realized profit rows.
- [ ] S — Responsive max6xl, mobile pills and internal overflow only.
- [ ] R — Accessible navigation/chart labels, reduced motion, non-color statuses.
- [ ] R — Complete per-view empty/loading/error/stale states and null metrics.
- [ ] R — Segment equity by run and prevent duplicate refresh rows.

## Operations / validation

- [ ] S — Start engine and dashboard at localhost:3002 using documented commands.
- [ ] S — Explain paper-only/no-guaranteed-edge disclaimer and all tabs.
- [ ] R — Verify restart/shutdown behavior instead of assuming background terminal semantics.
- [ ] R — Run U01–U28 unit groups and I01–I10 integrations from16.
- [ ] R — Run all price/API/NaN/corruption/duplicate/restart/timezone/market-closed fault cases.
- [ ] R — Reconcile long/short fees/funding/slippage/FX and liquidation losses.
- [ ] R — Verify no look-ahead, future-candle leakage or same-tick signal fills.
- [ ] R — Assess survivorship, data snooping, overfitting and dependent samples.
- [ ] R — Verify restart replay equals uninterrupted ledger.
- [ ] R — Run web type/build, responsive and contract fixture checks.
- [ ] R — Record actual provider/package verification dates and unresolved failures.
- [ ] R — Do not mark release ready until required decisions/tests/reviews are complete.

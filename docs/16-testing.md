# 16 — Testing and acceptance plan

## Scope and status

SOURCE REQUIREMENT: P2 liquidation sanity vectors, Yahoo availability checks, P8 one clean --once cycle, P9 loading/design smoke, P10 live Overview, P11 running engine/dashboard. Everything beyond those is **RECOMMENDED IMPROVEMENT**. No tests are implemented or executed by this documentation change. Use built-in Node testing for the dependency-free engine if approved; frontend test tooling is a separate dependency decision, not a source package requirement.

## Test architecture

Freeze clocks, feed responses, FX and funding inputs; use isolated temporary data roots; separate unit math, file-contract integration, replay/fault injection, UI fixtures and optional live-provider smoke. Synthetic test prices must be explicitly marked fixtures and must never populate production history or be advertised as observed returns. Maintain golden results independent of production helper implementations.

## Unit-test matrix

| ID | Subject | Required cases / oracle |
|---|---|---|
| U01 | sma | Exact last-N average; insufficient/empty/NaN history; approved warmup convention; future close excluded |
| U02 | RSI14/RSI2 | Rising/falling/flat sequences, known Wilder seed/recurrence if approved, exact 10/90/65/35 boundaries, unavailable history |
| U03 | momentum/retN | Exact index and units decision; 29 vs 28 intervals exposed by nonlinear price fixture; q.mom=1 does not pass >1 |
| U04 | dailyVol | Fewer than 15→.03; 15 closes produce 14 log returns; population variance; .005/.15 clamps; nonpositive close rejection |
| U05 | indicators/regimes | trend/bias convention; halt priority; missing indices; high-vol threshold after approval; trading/world label distinction |
| U06 | mean/stdev | Empty, singleton, zero variance, sample vs population, mixed positive/negative, finite validation |
| U07 | expectancy/PF/SQN/Wilson/t | Hand-checked mixed R sample; all wins/all losses/all zero; no Infinity JSON; Wilson n=0; t/SQN zero sd |
| U08 | DSR | n=7 fails; n=8 proceeds; sd=0 fails; N fallback/min=2; Acklam reference vectors; skew/kurt convention; pass uses unrounded >.95; NaNs rejected |
| U09 | tiers | floor inclusive/cap exclusive at 50k/600k/3m; max leverage; deduction; empty/unsorted/out-of-range tiers; negative notional abs |
| U10 | leverage/margin | sizeFromMargin and inverse identities; entry=0, negative margin, extreme leverage, mismatched market/tier caps |
| U11 | liquidation | E=100000/mmr=.004: long5=80400, short5=119600, long25=96400; equality triggers; bankruptcy; long/short symmetry; deduction-model discrepancy documented |
| U12 | mark | EMA seed/null/nonfinite prev; alpha .25; repeated stale sample prohibited by proposed policy; invalid new price; raw wick vs smoothed mark |
| U13 | fees | Entry and close notional basis; long/short same absolute fee; zero notional; taker .0005; fee affordability at wallet edge |
| U14 | funding | Positive rate long debit/short credit; negative rate reversal; 00/08/16 UTC; endpoints (lastTs,nowTs]; midnight/multi-day catch-up; missing rates; exact-once restart |
| U15 | slippage/fills | Defaults k=.6,v=.02,D=2m; v floor .0005; sqrt sizing relation; buy adverse up/sell down; short close uses buy; no double-charge |
| U16 | P&L/equity | Gross/net/cost reconciliation, mark not last, funding exactly once, realized_R frozen denominator, non-USD conversion |
| U17 | stops/trail/time | Long/short stops/targets; gap fills not trigger-price guarantees; liquidation before stop; target before time/trail; exact 4h; .5/.25 ROI decision |
| U18 | drawdown/goal | Peak raises only; current/max DD; underwater >100%; zero peak; progress 0/near0/1/>1; final settlement below goal |
| U19 | sizing | Strategy fallback .1 versus seeded .12; account multiplier .4/1.6; strategy base .02/.40; vol .25/1.7; explicit bypass; wallet .98; no underwater bonus |
| U20 | seed registration | Six exact IDs/fields; add missing seed only; preserve learned stats/status; no duplicates or invented backtest prior |
| U21 | signal functions | All entry inequalities, warmups, missing SMA exception, long-only mom_trend, strict channel exclusion, no stale data |
| U22 | ORB/intraday | Real session open, within ~5m validity, incomplete 30m range, late join invalid, DST/holiday, 48 prior completed 15m bars |
| U23 | dispatch | Exit-first, per-symbol one, cooldown 120s, 10 total including approved reservations, non-retired eligibility, deterministic ties |
| U24 | lifecycle/Kelly | All promotion gates independently fail/pass; tNeed six=4.25; recent demotion/recovery; retirement policy after approval; prior count15; probation half/retired .02 |
| U25 | memory | Importance map; group selection decision; blowup/loss/win/no-trade; last500 top4; .95^ageDays; same/different regime 1/.4; stable ties |
| U26 | evolution | Profit+edge versus blowup; +.07×clamped edge/−.03; 20+3.5×level bounded20..40; live edge±.05/DD15/18; repeated sample not reused after approved fix |
| U27 | world scoring | Lexicon negation −.7, no-hit0, divide3/clamp; FNG thresholds24/44/55/74; missingunknown; dispersion>.45; provider-unit checks |
| U28 | formatting | Null dash; nonfinite dash/error convention; negative cents never become positive; under1 four decimals; signed/% units; timeAgo UTC/future cases |

## Integration tests

| ID | Boundary | Acceptance evidence |
|---|---|---|
| I01 | Market data→indicators | Provider fixtures normalize chronological completed closes, currency and timestamps; failed history cannot become valid zeros |
| I02 | Indicators→strategy→signal | Known input fires only specified seed; quote/bar causality retained in intent |
| I03 | Signal→position | Intent observed at t cannot fill at same t under approved queue barrier; later fresh quote, caps, costs and unique trade_id applied |
| I04 | Position→P&L | Long and short complete cycles reconcile wallet, isolated margin, funding, fees and adverse fill |
| I05 | P&L→episode | Survivors settle, final record includes all costs, record appended once, old-run final point kept |
| I06 | Episode→memory | Correct run-only closed trades grouped; lessons reflect actual observed loss/win groups, no fabricated rationale/data |
| I07 | Memory/stats→evolution | Retrieval changes digest, statistical histories change Kelly/status, only specified branches alter account dial; text itself does not mutate signals |
| I08 | Engine→dashboard | Real-shaped files→GET→eight tabs; all units/counts/orderings consistent; max history windows respected |
| I09 | Restart→continuation | Same starting event log replay yields same wallet, positions, trade count and funding as uninterrupted run |
| I10 | World collector→engine | Optional slow feeds do not stall price/management; approved funding history/availability policy applied |

## Fault and safety tests — functional correctness

These are financial/runtime robustness tests, not the separately delegated security assessment.

- Impossible/nonfinite/zero/negative prices, quantities and margins: reject entry; preserve diagnostic cause; never coerce to fabricated valid data.
- API timeout/429/5xx/malformed JSON: bounded failure, stale metadata retained, no phantom fresh quote. One failed symbol must not erase another's valid data.
- Stale prices and incomplete bars: do not enter; specify how existing positions are marked and visibly report uncertainty rather than silently claiming liquidation safety.
- Extreme leverage, maintenance-tier crossing, insolvency and liquidation gaps: loss not cosmetically clamped; equity may fall below zero under the selected model.
- Corrupt state versus missing fresh install: distinguish them; preserve corrupt file, stop/recover explicitly; never mint new capital on parse failure.
- Truncated JSONL and missing journal pre: no fabricated complete trade; test recovery/join handling.
- Duplicate queued intent, duplicated fill/post row and process restart between each write: no second debit, second position, duplicate closed statistic or duplicate episode.
- Restart during open position: entry metadata, funding timestamp, peak/trailing state and collateral remain intact.
- Restart after terminal settlement but before nextEpisode: terminal record/generation/lessons recorded once; no old intents in new episode.
- Clock backward/forward, leap day, UTC midnight, DST, US/India holiday/early close: no negative hold time or double funding; session-open detection correct.
- Missing FX, missing Hyperliquid rate, missing crypto subset, partial macro/news: no invented observation; proposed trade eligibility honors per-field dependency.
- Disk-full/rename failure/permission failure: no optimistic success log; old atomic snapshot stays readable; uncommitted events are recoverable.
- Engine cycle exceeds 30s: no overlap, backlog or duplicate collection; cadence policy documented.
- Market closed: no new entry; queued order expiry/session policy explicit; old observed price not labeled executable.

## Backtesting / forward-test integrity

SOURCE DOES NOT SPECIFY a backtest runner. These requirements apply to any approved future backtester and to deterministic replay; do not claim a missing backtester exists.

- Look-ahead/future leakage: timestamp every observation and intent; indicator inputs at decision time contain only available bars; channel excludes decision candle; fill observation strictly later than intent for strategy orders.
- Historical candle revisions: archive provider observations used at decision time or explicitly qualify replay limitations; do not retroactively trade adjusted future-known values.
- Survivorship: retain source watchlist limitations; a fixed current basket is not an unbiased historical universe. Do not claim delisting coverage without data.
- Realistic fills: no guaranteed execution at stop/target when market gaps; spread/impact/costs charged on both sides; unknown depth not presented as measured liquidity.
- Funding/fees/borrow: apply period-appropriate known data and declared assumptions; do not use today's funding for an entire backtest without labeling approximation.
- ORB remains live-only and ibreakout forward-test only in source mode. Retrospective optimization is not a substitute for forward evidence.
- Overfitting/data snooping: record all tested variants/parameter searches, not only six survivors; chronological train/validation/test split, no reuse of held-out results for selection.
- Statistical dependence: overlapping trades/regime clustering reduce effective sample size; DSR and t gates on nominal n are not proof of independent evidence.
- Prior provenance: backtest_kelly has dataset, interval, strategy version and cut-off; no future period enters live sizing.
- Equity resets: separate episode curves from self-financing cumulative capital; injected USD100 each run is not return.

## Release gates

Source-exact and improved-mode fixtures must be separate for intentional divergences. Require golden math, conservation, next-tick causality, idempotent crash recovery, complete source traceability and honest missing-data UI before declaring the simulator usable. Live API smoke records actual date/status/schema; do not block deterministic unit tests on public availability. Frontend type/build and accessible responsive rendering checks remain mandatory planned work. Test reports must say what was actually run and what remains unverified.

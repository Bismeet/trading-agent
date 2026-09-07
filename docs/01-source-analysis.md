# 01 — Eleven-prompt reconstruction

All entries below are SOURCE REQUIREMENT unless explicitly marked otherwise. Detailed schemas, formulas and constants are expanded in linked domain documents; those links are part of each prompt's contract. P1–P11 refer to headings in [the supplied copy](../source-article.md), not instructions executed by this planning task.

## P1 — Scaffold and configuration

**Purpose:** establish a built-in-only Node ESM engine and a separate Next app.

**Files:** root `package.json`, `config.json`, `.gitignore`, `web/package.json`; folders `scripts/`, `scripts/v2/`, `scripts/world/`, `data/`, `web/app/`. Next scaffolding support filenames are not enumerated.

**Functions:** none. **Inputs:** local Node availability; exact configuration payload. **Outputs:** folder tree, pinned dependency declarations and untouched config. **Reads/writes:** Node version inspection; writes scaffold/config only. **Algorithm:** check `node -v`; install Node LTS from nodejs.org if absent; create the two-part project. **Dependencies:** none before this stage; all later prompts consume it.

**Constraints / do not change:** engine has no third-party dependencies; preserve all values in [05](05-configuration.md), App Router, TypeScript and Tailwind v4. Root scripts point at `scripts/init.mjs` and `scripts/daemon.mjs`, even though later prompts create v2 paths. **Problems:** aliases are never supplied; LTS major and several semver ranges are not exact pins. No runtime scaffold is created by this blueprint.

## P2 — Honest money core

**Purpose:** shared I/O, public data, indicators/statistics, v2 paths and leverage primitives.

**Files:** `scripts/lib.mjs`, `scripts/v2/store.mjs`, `scripts/v2/perp.mjs`.

**Functions:** `ROOT`, `DATA`, `PATHS`; `ensureData`, `readJSON`, `writeJSON`, `appendJSONL`, `readJSONL`, `log`, `loadConfig`, `now`, `iso`; `getJSON`, `getText`, `YH`, `fetchQuote`, `fetchHistory`, `fetchFx`; `sma`, `rsi`, `momentum`, `indicators`, `sha256`, `mean`, `stdev`, `wilsonLB`, `sqnOf`, `profitFactor`, `expectancyStats`, `regime`; `V2`, `round`, `clamp`; `sideSign`, `imr`, `tierFor`, `maintenanceMargin`, `maxLeverageAt`, `liqPrice`, `bankruptcyPrice`, `unrealizedPnl`, `positionEquity`, `isLiquidated`, `sizeFromMargin`, `marginForNotional`, `emaUpdate`, `tradeFee`, `fundingPayment`, `crossedFundingTimestamps`, `slippageFraction`, `fillPrice`, `openPosition`, `markPosition`.

**Inputs:** config, paths, numeric histories, quotes, side/entry/mark/quantity/margin/leverage/tiers. **Outputs:** quote/history/FX contracts, pure stats and position/mark objects. **Data reads/writes:** generic files plus every V2 path in [06](06-data-architecture.md); perp has no file access. **Algorithms:** exact perp formulas in [08](08-trading-math.md); 12-second requests; Yahoo→Coinbase quote fallback; atomic `.tmp`→rename JSON writes.

**Dependencies:** P1; consumed by P3–P11. **Assumptions/gaps:** indicators, regime thresholds and many stats conventions are unnamed algorithms rather than full code; `openPosition` uses current time despite the pure-functions description. **Do not change:** mark-based liquidation and negative funding for positive-rate longs. **Acceptance source:** Yahoo calls work locally; liquidation examples 80,400 / 119,600 / 96,400. These checks have not been run here.

## P3 — Episode/run loop

**Files:** `scripts/v2/episode.mjs`, importing store. **Functions:** `freshV2State(cfg)`, `recordEquityPeak(state)`, `episodeEndReason(state,cfg,nowTs=now())`, `finalizeEpisode(state,reason,extra={})`, `nextEpisode(state,cfg)`, `setGoal(state,target,deadlineHours)`.

**Purpose:** reset capital without erasing learning. **Inputs:** cfg.v2, state, current time, end reason and optional extra record fields. **Outputs:** state, current drawdown, nullable reason and finished record. **Reads:** config/state supplied by caller. **Writes:** `episodes.jsonl`; caller persists mutated state. **Algorithms:** blowup→goal→time precedence and reset/preserve matrix in [11](11-episodes-and-evolution.md).

**Dependencies:** P1/P2; P6 consumes episodes, P8 drives them, P9/P10 display them. **Constraints:** preserve generation/aggression/learning. **Problems:** reset leaves several counters unspecified; `autoResetOnBlowup` and goal deadlines are not wired consistently; finalizing before/after survivor costs matters. Do not record new-run equity as old-run final equity.

## P4 — Strategy library

**Files:** `scripts/v2/strategies.mjs`. **Imports:** `V2, readJSON, writeJSON, now, clamp` from store; `rsi,sma` from lib.

**Functions/data:** `SEED_STRATEGIES`, `ensureStrategies`, `sigTsmom`, `sigDonchian`, `sigRsi2dip`, `sigMomTrend`, `sigOrb`, `sigBreakoutIntraday`, `strategyExit`, `runStrategies`; `retN` formula is supplied, not explicitly mandated as an export.

**Inputs:** state, enriched quote map `eq`, config, `histCache`, strategy library and session/cooldown state. **Outputs:** nullable signal or ordered open/close orders. **Reads/writes:** `strategies.json`; seeds merge without learned-stat loss; queue/cooldown persistence location unspecified. **Algorithms:** six exact seeds, thresholds, arbitration and exits in [09](09-strategies.md).

**Dependencies:** P1/P2; P5 sizes its orders, P6 scores its IDs, P8 executes, P10 displays. **Constraints:** zero AI tokens, exclude current channel bar, next-tick fills, stale-data prohibition, one position per symbol, ten-position maximum, two-minute re-entry cooldown set on queueing. **Problems:** `V.strategies` shorthand is undefined until mapped to cfg.v2; “live non-retired” includes candidates and probation; ORB observed session storage unspecified. Do not replace close-based channels with OHLC highs/lows without a labeled change.

## P5 — Sizing

**File:** `scripts/v2/sizing.mjs`. **Imports:** `V2,readJSON,clamp`. **Functions:** internal `dailyVol`, exported `sizeOrder(state,o,eq,cfg)`.

**Inputs:** open order, equity/wallet/aggression/goal, market config, quote closes and learned strategy Kelly. **Outputs:** original non-open order unchanged, or order with leverage and `marginUsd`. **Reads:** `strategies.json`; no persistence. **Algorithms:** exact ordering and fallbacks in [10](10-risk-and-position-sizing.md).

**Dependencies:** P1/P2/P3/P4; P6 writes future Kelly estimates; P8 calls sizing. **Constraints:** preserve explicit-margin branch, market caps, 98% free-wallet clamp, volatility and goal multipliers. **Problems:** “half-Kelly” prose differs from 0.4 coefficient in P6; seed sizing is not earned evidence; cap excludes entry fee and may consume most free collateral. Do not interpret margin fraction as stop-loss risk percentage.

## P6 — Brain/memory/evolution

**File:** `scripts/v2/brain.mjs`. **Imports:** `V2,readJSON,writeJSON,readJSONL,appendJSONL,now,round,clamp`; `expectancyStats,profitFactor,mean,stdev,sha256`.

**Functions/data:** `IMPORTANCE`, `normCdf`, `erf`, `normInv` (Acklam), `skewness`, `kurtosis`, `deflatedSharpe`, `strategyKelly`, `loadClosedV2`, `scoreStrategies`, `addMemory`, `distillEpisodeLessons`, `retrieveLessons`, `onEpisodeEnd`, `evolveTick`, `buildBrainV2`, `onClose`, `collectWorldV2`.

**Inputs:** pre/post journals, realized R, strategy count/prior, episode outcomes, regime and state. **Outputs:** scored library, lessons, aggression changes, generation snapshots and dashboard digest. **Reads/writes:** journals read last 6,000; library update; memory append/retrieve last 500; generation and reflection append; world passthrough read. **Algorithms:** [08](08-trading-math.md), [11](11-episodes-and-evolution.md), [12](12-memory-and-learning.md).

**Dependencies:** P2/P3/P4/P5 contracts; P8 supplies real outcomes; P9/P10 display. **Constraints:** sample-size and multi-trial gates, preserve learning, hash-chain lifecycle changes. **Problems:** confidence equation, probation retirement threshold, live increments, Kelly cap enforcement and variance convention unspecified. Do not claim textual memories autonomously change signals; no such link is defined.

## P7 — World context

**Files:** `scripts/world/score.mjs`, `scripts/v2/world.mjs`. **Functions:** `lexiconScore`, `fngBand`, `regimeScore`, `aggregateNews`; engine later names the world collector `collectWorld`. **Imports:** score imports `mean,stdev`; collector imports store helpers, `getJSON,getText,fetchQuote`, scoring functions.

**Inputs:** macro quotes, FNG, put/call, funding/OI, social counts, RSS titles and GDELT. **Outputs:** exact 17-field digest in [13](13-world-model.md); state funding rate. **Reads/writes:** per-provider cached last-good values, `world.v2.json`; cache/thesis internals unspecified. **Algorithms:** lexicon negation, bands, cached polling, CBOE age rejection.

**Dependencies:** P1/P2; P6 world passthrough and P8 collector integration; P10 World view. **Constraints:** keyless, no fabricated missing observations, nonblocking trading loop, 5–60-minute source TTLs. **Problems:** individual TTLs, endpoint variants, macro coefficients, funding conversion and deep-thesis behavior unspecified. No general sentiment-to-entry gate is supplied.

## P8 — Integrated engine

**Files:** `scripts/v2/init.mjs`, `scripts/v2/engine.mjs`. **Named routines:** initializer CLI; cycle orchestration, `markAndManage`, `publishSignals`; uses `openPosition` and all episode/brain/strategy/sizing/data routines.

**Inputs:** saved state, config, quotes/history/FX, pending orders, strategies, prior world state. **Outputs:** simulated positions/fills, net trade results, snapshots, logs, brain/world digests. **Reads/writes:** state, pending, prices, signals, journal/trades/equity and brain/episode files in [06](06-data-architecture.md).

**Algorithm:** exact eight steps in [07](07-trading-engine.md). **Dependencies:** P1–P7; P9–P11 require its published output. **Constraints:** `--once`, parallel quote reads, EMA mark, liquidation before all other exits, costs on every fill, no rounding losses away. **Problems:** same-cycle strategy execution contradicts next-tick mandate; final balance reconciliation, fees/funding destinations and queue consumption semantics missing. Preserve the contradiction explicitly rather than pretending both requirements can hold unchanged.

## P9 — Dashboard foundation

**Files:** `web/app/globals.css`, `layout.tsx`, `page.tsx`, `components/Root.tsx`, `lib/format.ts`, `components/visuals.tsx`, `api/state/route.ts`.

**Functions/components:** `Root`, `Sakura`, `Mascot({size,mood})`, `usd(n,dp=2)`, `pct`, `signed`, `tone`, `price`, `timeAgo`; dynamic route handler (export name not given). **Inputs:** root config and v2 data files. **Outputs:** JSON response, loading shell and visual components. **Reads:** bounded history windows in [15](15-api-contract.md); no engine-file writes.

**Algorithms:** six-second no-store polling, safe defaults, max-320-point equity downsampling, deterministic petal positioning. **Dependencies:** P1 web scaffold/P8 outputs; P10 uses shell; P11 runs it. **Constraints:** exact theme values and fonts in [14](14-dashboard.md), filesystem bridge, no database replacement. **Problems:** incomplete response schemas/error policy; fallback `signals.json` must actually be version 2; process working directory assumption; environment signals override ignored by route.

## P10 — Dashboard views

**File:** `web/app/components/DashboardV2.tsx`, client component receiving `{data}` and reading `data.v2`.

**Inputs:** signals, episodes, generations, strategies, memory, equity, trades; world/brain within signals. **Outputs:** eight read-only views, cards, timeline, sparklines and tables. **Dependencies:** P9 shell/helpers/visuals, P8 publishing/P6 learning/P7 world. **Reads/writes:** browser GET only, local navigation state; no persistence prescribed.

**Algorithms:** thresholds/metrics and exact text in [14](14-dashboard.md). **Constraints:** desktop sidebar/mobile scrolling pills, max-width 6xl, no body horizontal overflow, missing data cannot become fake metrics. **Problems:** runway denominator, small-loss threshold, empty/error behavior for several views, equity segmentation and progress clipping unspecified. Do not rename navigation “Strategies” to “Strategy Book”; the latter is its view heading.

## P11 — Run complete system

**Files/functions:** no new filename or export required. **Inputs:** installed dependencies, initialized state, home-machine feed access. **Outputs:** continuously running engine and local dashboard.

**Commands:** `node scripts/v2/init.mjs`; root `node scripts/v2/engine.mjs`; from `web/`, `next dev -p 3002`; open `http://localhost:3002`. Restart with engine and web commands; article says close terminal windows to stop. **Dependencies:** P1–P10. **Data:** existing engine persistence continues; init is idempotent without `--force`.

**Constraints:** 30-second engine cycles, show honest logs/costs, retain paper-only disclaimer. **Problems:** “background” and “close terminals” are not a reliable supervisor/shutdown specification; bare `next` may not be in shell PATH; repeated init need not print Episode 1. Runtime/start checks are future acceptance criteria, not actions performed here.

## Cross-prompt contradictions

| ID | Source statements in tension | Resolution status |
|---|---|---|
| C01 | P4/P8 next-tick fills vs P8 step 6 immediate execution | Required design decision, proposed queue barrier in 19 |
| C02 | P1 root aliases vs P8/P11 v2 executables | Undefined legacy files, no silent creation |
| C03 | P2 exchange-mechanically-correct claim vs simplified liquidation ignoring deduction/fees | Keep source equations; qualify simulator model |
| C04 | P5 proof-based sizing prose vs P4 seed Kelly 0.12 / P6 under-five fallback | Document actual algorithm, not marketing |
| C05 | P6 “half-Kelly” vs literal 0.4 factor | Preserve literal coefficient |
| C06 | P1 kellyFractionMax 0.7 vs P6 increments with no explicit final clamp | Recommended enforcement requires approval |
| C07 | P1 autoResetOnBlowup option vs P8 unconditional nextEpisode | Option semantics unresolved |
| C08 | P7 dash on dead feed vs last-good cache reuse | Proposed stale metadata distinguishes both |
| C09 | P2 6-month history default vs P4 200/210-bar rules | P8 explicitly fetches one year |
| C10 | P2 pure core vs openPosition current-time builders | Clock injection is recommended, not source |
| C11 | P4 nominal 28-day label vs literal retN index | Decide index convention before implementation |
| C12 | P3 goal.deadlineHours vs episode maxHours; P10 1000h no-deadline label | Display deadline need not control engine timeout |

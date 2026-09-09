# 00 — Project overview

## SOURCE REQUIREMENT — P1–P11

FabInvests is a continuously running, local-first, leveraged paper-trading simulator with a Next.js observation dashboard. P1 names the engine `fabinvests-engine`; P10 uses the dashboard label `Apex Trading Bot . v2`. These are different source names for the same described build, not two engines.

The effective v2 run starts with USD 100 simulated collateral and aims for USD 500 within a 24-hour episode. It may instead finish at the time limit or with equity at/below zero. A new run gets fresh capital while retaining generation, aggression, strategy statistics and memories. The root legacy settings of USD 1,000 → USD 5,000 remain in configuration; they are not the v2 balances.

The watchlist covers five cryptocurrencies, five US equities and four Indian equities. Crypto trades continuously; US/India entry requires an open market. Public observations drive deterministic momentum, breakout, dip and intraday strategies. Orders are intended to fill on the next tick with spread/slippage, fees, mark-based liquidation and crypto funding. The source's claim of exchange-level accuracy is an intent, not a verified property; see [audit](17-source-audit.md).

The dashboard is read-only: Overview, Positions, Episodes, Evolution, Strategies, World, Lessons and Trades. It polls a Next route reading the engine's JSON/JSONL outputs. No dashboard order-entry controls are specified.

## Technical meaning of learning

| Concept | What this source actually specifies |
|---|---|
| Deterministic trading strategy | Rules over closes, RSI, moving averages, momentum and observed opening ranges |
| Statistical learning | Realized-R histories update confidence, fractional Kelly and lifecycle status |
| Memory | Persisted, ranked text lessons grouped by strategy/regime |
| Evolution | Generation snapshots and incremental leverage/Kelly adjustments |
| LLM used to build software | Claude Code is the author's implementation workflow |
| Runtime LLM | None; P4/P6/P8 explicitly say zero AI tokens |
| Model training / autonomous strategy invention | SOURCE DOES NOT SPECIFY; `ibreakout` is a fixed seed despite its “discovered” name |

FinMem and ReasoningBank were the original conceptual inspirations. In the current production release, the platform has integrated an embedded **TauricResearch TradingAgents** multi-agent graph (under `ai/tauric/`) as an asynchronous research filter layer (`POST /api/hybrid/decision`), while keeping FabRich as the sole authoritative execution, sizing, risk council, and accounting engine.

## In-scope source subsystems

Built-in Node file/network helpers; pure mathematical core; episode state machine; strategy registration and dispatcher; fractional-Kelly sizing; memory/statistical brain; cached public-world collectors; engine; filesystem API; TypeScript/Tailwind/Recharts/Motion dashboard; local run commands.

## SOURCE DOES NOT SPECIFY

A historical backtest runner, external order execution, account credentials, real-money mode, a database, distributed processes, a deployment supervisor, operational recovery guarantees, multi-user service behavior, complete schemas for all reserved files, or exact formulas for several indicators/statistical helpers. Named backtest fields are priors, not evidence a backtester exists.

## RECOMMENDED IMPROVEMENT

Treat this as an educational experiment. Keep simulated capital resets visible, never sum episode profits as a self-financing lifetime account, and distinguish research claims from observed out-of-sample results. Maintain a decision log for source gaps instead of assigning invented behavior to the author.

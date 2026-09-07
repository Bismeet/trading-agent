# Decision register — implementation resolutions

The source leaves some behavior unspecified (`SOURCE DOES NOT SPECIFY`). Each choice made
during implementation is recorded here and marked `[DECISION]` in code. These are
**implementations of the docs/19 recommended conventions**, not claims about the author.

| ID | Decision | Where |
|---|---|---|
| D01 | Next-tick barrier: strategy intents are queued to `pending.v2.json` and filled on a later cycle from a fresh observation; risk exits (liquidation/stop/target/time/trail) execute immediately. | `engine.mjs` cycle steps 5–6 |
| D02 | Executed fill price ≠ mark; taker fee on entry and exit; funding posted to free wallet once per crossed boundary; INR quotes normalized to USD via fetchFx; fee-aware affordability and min-notional enforced at fill. | `engine.mjs` `executeOpen`/`closePosition`, `gatherData` |
| D03 | Wilder RSI (flat=50, gain-only=100, loss-only=0, insufficient=null); momentum in percent; literal `retN` index `c[last]/c[last-1-n]`; trend = price>SMA20>SMA50 up / price<SMA20<SMA50 down; high-vol gate = BTC \|mom\| > 8%. | `lib.mjs`, `strategies.mjs` |
| D04 | Market-open gate uses Yahoo `marketState === "REGULAR"` for US/India; quotes older than 5 minutes are stale and block entries/marks. | `strategies.mjs`, `engine.mjs` |
| D05 | Single writer (engine), stable `trade_id`/`eventId`, atomic per-file JSON via `.tmp`→rename; full cross-file crash-transaction protocol is **not** implemented (see docs/19 — future work). | `lib.mjs`, `engine.mjs` |
| D06 | Survivors settled at mark before `finalizeEpisode`; pending queue cleared on reset; trigger reason recorded as `endReason`. | `engine.mjs` cycle step 7 |
| D07 | realized_R denominator = `qty × entryPrice × stopPct` frozen at entry (fallback: isolated margin). Population moments for skew/kurtosis (Pearson kurtosis); tStat = SQN statistic. | `engine.mjs`, `brain.mjs`, `lib.mjs` |
| D08 | evolveTick "a little" = ±1 level and ±0.02 Kelly, only when new trades closed since the last tick; confidence = `clamp(0.2 + wilsonLb, .05, .95)` once n>0; retirement after 3 consecutive failing probation checks. | `brain.mjs` |
| D09 | CBOE rows older than ~6 days hard-expire; missing world data stays `null`/dash with `_stale` flags; literal FX fallback 83.0 kept but tagged `live:false`. | `world.mjs`, `lib.mjs` |
| D10 | Funding rate = mean of Hyperliquid BTC/ETH/SOL 8h rates applied to all crypto (source's approximation, documented in docs/13). | `world.mjs` |
| D11 | API response: `{serverTs, config, v2:{signals,state,episodes,generations,strategies[],memory,equity,trades}}`; equity downsample = deterministic stride preserving first/last; `signals.json` fallback only when `version===2`. | `web/app/api/state/route.ts` |
| D12 | Route reads bounded tails (40/30/20/4000→320/60). | `web/app/api/state/route.ts` |
| D13 | Root `scripts/init.mjs` and `scripts/daemon.mjs` alias the v2 CLI (source defines no legacy implementation). | `scripts/init.mjs`, `scripts/daemon.mjs` |
| D14 | Missing metrics render as `—`; stale world sources labeled; runway clamped visually only. | `DashboardV2.tsx`, `format.ts` |
| C06 | Account Kelly clamped to `[0.02, kellyFractionMax=0.7]` after end-of-run and tick updates. | `brain.mjs` |
| POST transport | `postJSON` added to complete the Hyperliquid collector transport (source's getJSON/getText have no POST). | `lib.mjs` |

## Verified at implementation time (2026-09-07)

- All engine modules pass `node --check`.
- Liquidation golden vectors: long 5x → 80400, short 5x → 119600, long 25x → 96400 (exact).
- `normInv(0.975) ≈ 1.959964`, `normCdf(1.96) ≈ 0.975002`; DSR n<8 fails as specified.
- `node scripts/v2/init.mjs` initializes Episode 1; repeated init preserves state.
- `node scripts/v2/engine.mjs --once` completed clean cycles against live feeds
  (regime computed, signals queued then filled next cycle with fees/slippage/journal/fills;
  time-stop closes observed with net P&L settled honestly, including small losses).
- `next build` passes TypeScript; `GET /api/state` returns version-2 signals, state,
  strategies, equity and world from the data directory on port 3002.
- **Unit suite `npm test`: 41/41 pass** (tests/math, strategies, sizing-episode, brain) —
  golden liquidation vectors, Wilder RSI edges, momentum units, dailyVol population-variance
  fixtures, sizing multipliers/clamps, episode precedence/reset matrix, DSR guards,
  Acklam reference values, strategyKelly branches, lexicon negation, FNG boundaries.
- **Live provider smoke `node tests/live-smoke.mjs` (2026-09-07): all 9 checks OK** —
  Yahoo quotes (BTC/AAPL/RELIANCE.NS), 1y daily history (366 bars ≥ SMA200 warmup),
  5d/15m crypto bars (463), FX USDINR, Coinbase fallback, alternative.me FNG, Hyperliquid POST.

## Hardening added after initial build

- Single-instance lock file + graceful SIGINT/SIGTERM shutdown in `engine.mjs`.
- No overlapping cycles if a cycle exceeds the 30s cadence.
- Funding accrued exactly once per crossed UTC boundary via `lastFundingTs`.
- `net_pnl` includes signed funding so `realized_R` reflects carry cost (D02 note).

## OWNER EXTENSIONS (explicit deviations from the read-only source spec)

The source mandates a read-only dashboard. The owner requested manual controls and a
survival mandate; these are implemented as a documented extension, not source behavior.

- **Control channel** (`data/commands.v2.json`, `scripts/v2/controls.mjs`, `POST /api/state`):
  the dashboard queues validated commands (`setGoal`, `restart`, `setSurvival`);
  the engine consumes them at cycle start and logs each application. Malformed
  commands are kept with an error instead of being silently dropped.
- **Manual Restart** — settles/archives the current run (endReason `manual-restart`),
  then starts a fresh episode with owner-chosen capital, goal target and duration
  (`state.episodeMaxHours` overrides the config 24h limit).
- **Survival Mode** — implements the owner mandate ("survive on your own; losses are
  not acceptable; long-term profit only") as far as an honest simulator can:
  while equity < goal.startEquity, NO new positions are opened; once above water,
  entries are allowed but leverage is hard-capped at 5x. **This reduces risk; it
  cannot guarantee profits or prevent losses.** The UI states this plainly.
- **Manual Control panel** on the dashboard Overview tab (inputs + buttons + live
  survival status badge).

Additionally added AFTER a live multi-agent request:

- **Multi-agent decision council** (`scripts/v2/agents.mjs`, `data/agents.v2.jsonl`,
  "Decision Council" card on Overview). Three **rule-based** agents — no LLM — deliberate
  over every new trade intent before it is queued:
  - **Analyst**: vetoes US equity longs under `us_down`, crypto longs under
    `crypto_down` / `crypto_down_highvol`; adjusts confidence on crypto fear/greed
    (extreme fear boosts longs, extreme greed penalizes) and funding crowding.
  - **Risk**: enforces the position cap (10), a same-side crypto correlation cluster cap
    (4), and a 10% drawdown brake.
  - **Investor**: refuses to execute without a fresh (non-stale) quote or on a tiny wallet.
  - Any single veto rejects the intent; every verdict is logged with reasons and
    surfaced live in the dashboard.
- The council does not replace the survival gate (controls.mjs) — both must pass.

Verified: `tests/agents.test.mjs` 7/7 pass; full suite 45 tests → **52/52**. A live
demo with real quotes/world data showed the analyst/risk/investor approving a BTC long
(F&G 71, funding ≈ 0). Engine runs the council every cycle with no crash.

Verified live (2026-09-07): POST setSurvival → engine consumed within one cycle →
signals.survival.enabled=true, survivalBlocked=true while equity < start. Validation
rejects invalid payloads (400). Tests: `tests/controls.test.mjs` 4/4 pass.

Not verified: multi-day soak, crash-replay equality (D05 full transaction protocol remains
documented future work), provider rate limits over time, security review.
Paper trading only — never connect to real money.

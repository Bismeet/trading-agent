# FabInvests — leveraged paper-trading simulator + offline research program

A deterministic **paper-trading simulator** with a Next.js observation terminal, plus a
pre-registered **quantitative research program** that has spent nine experiments trying to find
a tradeable edge in it.

> **This project is not profitable and does not claim to be.**
> Real market observations, **simulated money**. Nine research phases have found **no robust
> out-of-sample edge**. The most recent conclusion is that the bottleneck is the *information
> set*, not the strategy. **Never connect this to real-money execution.** This is not financial
> advice.

---

## What is this?

Two things in one repository, deliberately separated:

| | Component | Purpose |
|---|---|---|
| 1 | **The simulator** (`scripts/v2/engine.mjs`) | Continuously runs a small leveraged long/short book on real public prices with simulated money. Persists state, trades, episodes and lessons to flat files. |
| 2 | **The research program** (`config/`, `scripts/v2/phase*.mjs`, `PHASE*.md`) | Pre-registered, offline experiments that test whether any strategy family has a real edge — with leakage audits, negative controls and frozen production hashes. |

The dashboard is the **window** onto the simulator. It is **not** a source of signals, and it
**never fabricates a number**: where the backend has no value, it renders `NO DATA` or
`NOT VERIFIED`.

### Status at a glance

| Item | State |
|---|---|
| Simulator | Implemented and runnable (paper only) |
| Dashboard | Implemented — retro CRT terminal UI |
| Test suite | 256 tests, all passing |
| **Profitability** | **Not established. Not claimed.** |
| **Alpha status** | **`NOT VERIFIED`** |
| **Current research** | **`DATA / INFORMATION RESET`** |

---

## The honest headline

Nine experiments across two structurally different bet types. **Zero tradeable results.**

| Phase | Subject | Verdict | Decisive number |
|---|---|---|---|
| Alpha | 8 signal families | **C** | TRAIN 8/8 raw-positive → VALIDATION **0/8** |
| 5 | Strategy calibration | **A\*** | \*infrastructure only — profitability not verified |
| 6 | Risk geometry | **B** | raw edge +0.011% vs **break-even +0.023%** at 4h |
| 7 | Signal co-firing | **B** | −0.0932 R → −0.0509 R (still negative) |
| 8 | Portfolio management | **B** | 95% of gain came from *entry*, not management |
| 9 | Final system | **C** | **gross −$0.60/trade before any fee** |
| 10 | Regime × side × horizon | **C** | **0 of 250 cells passed all gates** |
| 11 | Cross-sectional rotation | **C** | **gross −$1,354 before any cost** |

**The key finding, stated plainly:**

> The system has repeatedly failed to find positive **gross directional alpha** from its existing
> **OHLC-only information set**. This is not a cost problem and not a model problem. Costs were
> falsified as the binding constraint (varying them by 50% moved the Phase 11 result by ~1
> percentage point), and the ranking was shown to be inert (a deterministically *shuffled*
> ranking performed **better** than the real one). The next research direction therefore requires
> **genuinely different information**, not another indicator or another ML layer.

→ Full detail: **[docs/RESEARCH.md](docs/RESEARCH.md)** and **[RESEARCH_RESET_DIAGNOSIS.md](RESEARCH_RESET_DIAGNOSIS.md)**

---

## What has been proven vs what has not

| ✅ Established | ❌ Not established |
|---|---|
| The simulator is deterministic and reproducible | Positive gross directional alpha from OHLC data |
| Costs are modelled and are **not** the binding constraint at low turnover | Any robust out-of-sample net profitability |
| The learner changes ranking/size, never signal logic | That the learner improves real results (history is one regime) |
| Leakage audits pass — the negative results are not artefacts | Anything about real-money execution or exchange-accurate fills |
| Production config is never modified by research phases | That any strategy has earned `active` status |
| The failure mode is *readable*: TRAIN-positive → TEST-negative | — |

---

## Architecture

```text
                 PUBLIC FEEDS (Yahoo chart/quote, Coinbase, Hyperliquid,
                 alternative.me FNG, CBOE put/call, Fed RSS, GDELT, …)
                                    │
                                    ▼
   config.json ───────────►  ENGINE  scripts/v2/engine.mjs
                             (30 s cycle, fully deterministic, no runtime LLM)
                                    │
        ┌───────────────┬───────────┼────────────┬──────────────┐
        ▼               ▼           ▼            ▼              ▼
    strategies      sizing      risk gates   world model    learning
    (6 frozen       (fractional  (survival,  (context,      (Bayesian-shrunk
     signals)        Kelly)       DD halt)     veto only)     UCB, no gradients)
        │               │           │            │              │
        └───────────────┴───────────┴────────────┴──────────────┘
                                    │
                                    ▼
                        PAPER EXECUTION (next-tick fill,
                        taker fee both legs, slippage, mark-based liquidation)
                                    │
                                    ▼
                    FLAT-FILE STORE  data/*.v2.json[l]
                    (state, signals, trades, equity, journal,
                     episodes, memory, candidates, shadow)
                                    │
                                    ▼
                     GET /api/state  (read-only filesystem bridge)
                                    │
                                    ▼
                     DASHBOARD  web/  (retro CRT terminal, 6 s poll)

  ── RESEARCH PROGRAM (OFFLINE, PARALLEL, NEVER TOUCHES PRODUCTION) ──
  config/*-spec.v1.json  → scripts/v2/phase*.mjs → PHASE*_REPORT.md
  (pre-registered spec + hash → single locked TEST read → leakage audit
   → negative control → acceptance gates → verdict A/B/C/D)
```

**Design rules that hold throughout:** the engine makes **no runtime LLM calls**; the filesystem
is the only bridge (no database, no broker API); learning is **adaptive statistics**, not model
training; and research code can never modify production behaviour.

---

## Current strategies

Six deterministic signals, frozen. They are rules over closes, RSI, moving averages, momentum
and opening ranges — **not** machine-learned models.

| ID | Type | Markets | Fires | Notes |
|---|---|---|---|---|
| `tsmom` | Trend / standing state | crypto, us, india | **~60% of cycles** | Fires continuously while in a trend — dominates live activity by construction |
| `donchian` | Breakout (rare event) | crypto, us, india | ~18% | Only strategy positive in Phase 8 TEST (+0.0220 R) |
| `mom_trend` | Momentum + trend | crypto, us, india | ~18% | **Long-only by design** |
| `ibreakout` | Intraday breakout (rare event) | crypto | ~11% | Fixed seed despite "discovered" naming |
| `rsi2dip` | Mean reversion RSI(2) | crypto, us, india | ~9% | Negative raw edge in Phase 6 |
| `orb` | Opening-range breakout | us | — | Negative raw edge in Phase 6 |

**Why `tsmom` dominates live activity:** it is a *standing state* that fires every cycle during a
trend, while the others are *rare events*. This is signal structure, not downstream rejection —
and it is why the live record (20 closed trades, 1 win) is 100% `tsmom|long|broad_up`.

All six strategies sit permanently at lifecycle status **`candidate`** — none has cleared the
statistical gates required to earn `active`. That is the honest and expected state.

---

## Learning system

`scripts/v2/learning.mjs` — and it is important to be precise about what it is:

| Question | Answer |
|---|---|
| Is it ML? | **No.** No gradients, no weights, no embeddings, no RL, no LLM. |
| What is it? | A **local contextual bandit**: Bayesian-shrunk expectancy + deterministic UCB exploration + abstention, over cells of `regime \| side \| strategy`. |
| What can it change? | Ranking, blocking, abstention, size multiplier, memory. |
| What can it **never** change? | Signal logic, stop-loss/take-profit, leverage caps, the council, the survival gate. |
| Does it help on real data? | **Unknown.** Evaluation against baseline was numerically identical because history contains exactly **one cell** (all 20 trades were `broad_up\|long\|tsmom`). |
| Does lesson text affect trades? | **No.** Per the deep audit, `lessons never influence trades` — they are display-only. |

The mechanism is verified against a synthetic benchmark (12/12). It has simply never had enough
data to act. On real history, printing an "improvement" number would be fabrication — so none is
printed.

---

## Risk & execution simulation

| Aspect | Implementation |
|---|---|
| Fill model | Next-tick, taker fee **both legs**, constant half-spread + square-root impact |
| Fees | Taker `0.0005`. Maker `0.0002` is configured but **never assumed offline** |
| Slippage | crypto `0.0010`, US `0.0005`, India `0.0005` |
| Liquidation | Mark-price based, smoothed EMA mark, maintenance tiers |
| Funding | Crypto only. **Historically omitted** — no offline funding series exists (`funding: "OMITTED_NO_HISTORICAL_RATE"`) |
| Sizing | Fractional Kelly with earned leverage (20× start → 40× ceiling crypto), vol target |
| Risk gates | Survival mode (no new positions while underwater, 5× cap once above water), drawdown halt, hard floor |
| Council | Rule-based analyst → risk → investor veto. **No LLM.** |

**Documented accounting fictions** (disclosed, not hidden): US and India are modelled as
**perpetual perps with funding-free leverage** (4× and 5×). This is a simplification of
equity cash-market borrow, and it is the kind of thing a reader should know before trusting any
per-trade number.

---

## Research phases

The program follows one protocol every time: **freeze the spec and its SHA-256 before reading
the test set → create a selection lock → read TEST exactly once → run the leakage audit and a
deterministic negative control → apply pre-registered acceptance gates → publish a verdict.**

| Verdict | Meaning |
|---|---|
| **A** | Verified / tradeable |
| **B** | Partial — a real effect exists but no net edge |
| **C** | No robust alpha |
| **D** | Invalid experiment |

**Nine experiments have produced no `A` for profitability.** One `A` was issued for
*infrastructure* only (Phase 5), with profitability explicitly unverified.

### Phase 5–11 findings, condensed

- **Phase 5** — Calibration created a usable decision space (**A\***, infrastructure only). Live
  starvation is **RISK** starvation — the survival gate — not signal starvation.
- **Phase 6** — Raw edge is real but **~2× too small** at 4h (+0.011% vs the +0.023% break-even).
  The 24h–72h horizon band is the only place gross economics turn positive anywhere in the
  program.
- **Phase 7** — Multi-strategy co-firing *does* contain information (2+ signals firing: +0.058%
  raw) but still nets negative. Passing every validation gate ≠ profitable.
- **Phase 8** — Management improves risk, not edge. **95% of the improvement was the entry
  decision**, and portfolio caps *subtracted* value.
- **Phase 9** — The cleanest number in the repo: **gross −$0.60/trade before fees**, net
  −$1.81/trade. 0 of 4 sub-folds positive. The learner cut loss 48.9% without flipping Net R.
- **Phase 10** — 0 of 250 regime cells passed all gates. **"Allocation is a risk technology, not
  an edge technology."** Shorts lose money in **every** measured slice.
- **Phase 11** — Cross-sectional rotation. **Gross −$1,354 before any cost.** Shuffling the
  ranking *improved* the result, proving the ranking was inert. Cost stress moved the outcome
  1.01pp, killing the cost explanation.

**Failure signature:** `TRAIN-positive → TEST-negative`, matching a pre-registered **signal-free
momentum control** that behaved identically (+18.34 bps in-sample → −77.55 bps out-of-sample).
That is regime exposure, not edge.

→ Per-phase detail with objectives, results, verdicts and artifact links: **[docs/RESEARCH.md](docs/RESEARCH.md)**

---

## Known limitations

**Research design**
- **Small samples.** Phase 11's rank IC rests on **15 TEST bars**. A real edge of a few bps/day
  **cannot be statistically resolved on 5 years of daily data over 14 symbols.** This is a
  power limit, not a bug.
- **No historical funding.** Funding is collected live but never persisted, so carry — the one
  direction that changes the *prediction target* — cannot be evaluated offline.
- **Regime concentration.** Only `VOL_EXPANSION` held out of sample. Everything else collapsed.

**Data**
- **The universe is survivorship-biased upward.** 14 current large-caps/majors, chosen with
  hindsight. Assets delisted between 2021-09 and 2026-09 are absent, and no delisted price
  history exists in this repository to correct it. The universe was deliberately **not** swapped
  to make numbers look better.
- **OHLC-only.** Five fields, no volume, no order flow, no book depth, no short interest.
- **No delisting / membership metadata.**

**Simulator**
- **No backtester exists** in this lineage; the live paper engine is the only execution path.
- **US/India perp fiction** (see above).
- No fill-probability model, no partial fills, no queue position.
- Stale quotes freeze **both** marks and exits.
- Live record is tiny: **20 closed trades, 1 win**, 100% one strategy, and collection was
  **suspended by the survival gate** at equity $99.98 vs a $100 floor.

**Meta**
- The audit scored this project **Learning 2/10, Scientific validity 2/10, Production readiness
  3/10** — and the audit is included in this repository rather than hidden. Several
  measurement bugs were found and fixed during the program (a scanner that printed `PASS` while
  reading 0 rows; a win rate computed over the wrong object; five strategies silently not firing).

---

## Run it locally

Requires **Node 22+**. All commands from the repository root unless noted.

```bash
# 1. one-time initialisation (idempotent; --force resets capital, not learning)
node scripts/v2/init.mjs

# 2. the engine — continuous, 30s cycles
node scripts/v2/engine.mjs
#    or a single cycle:
node scripts/v2/engine.mjs --once
#    or via the npm alias:
npm run daemon        # engine.mjs
npm run cycle         # single cycle

# 3. the dashboard (separate terminal)
cd web && npm install && npm run dev -- -p 3000
#    → http://localhost:3000
```

The dashboard is a **window**: it polls `GET /api/state` every 6 seconds and renders whatever the
engine has written. If the engine is stopped it says so plainly (`UPLINK LOST`) rather than
showing stale numbers as if they were live.

### Tests

```bash
# full suite (256 tests)
node --test "tests/*.test.mjs"
```

> **Note:** quote the glob. `node --test tests/` fails with `MODULE_NOT_FOUND` on Node 22 —
> the runner will not glob a bare directory. This is a harness quirk, not a test failure.

```bash
# web app: typecheck + production build
cd web && npm run build
```

CI runs the core unit suite on every push to `main` (`.github/workflows/test.yml`).

### Start the dashboard / server

| Process | Command | Default URL |
|---|---|---|
| Engine (data producer) | `node scripts/v2/engine.mjs` | — |
| Dashboard (Next.js) | `cd web && npm run dev -- -p 3000` | http://localhost:3000 |
| Production build | `cd web && npm run build && npm start` | http://localhost:3000 |
| API (read-only bridge) | served by Next.js | `GET /api/state` |

The engine writes; the API reads; the browser polls. There is no database and no broker.

---

## Repository structure

```text
trading bot/
├── README.md                    ← you are here
├── RESEARCH_RESET_DIAGNOSIS.md  ← the fundamental-bottleneck diagnosis
├── DECISIONS.md                 ← D01–D14: resolved source gaps
├── ALPHA_RESEARCH_REPORT.md     ← pre-cost signal study (verdict C)
├── PHASE5…PHASE11_*.md          ← one report per research phase
├── TRADING_AGENT_DEEP_AUDIT.md  ← independent code-traced audit
├── source-article.md            ← the original build specification
│
├── config.json                  ← the single live configuration
├── config/                      ← pre-registered experiment specs + frozen controls
│   ├── phase11-spec.v1.json     (immutable pre-registered spec)
│   ├── strategies.control.json  (frozen production thresholds)
│   └── *-experiment-spec.v1.json
│
├── scripts/
│   ├── daemon.mjs               ← alias to the v2 engine
│   ├── init.mjs
│   ├── world/                   ← public data collectors
│   └── v2/
│       ├── engine.mjs           ← the live paper engine (30 s cycle)
│       ├── strategies.mjs       ← the six frozen signals
│       ├── sizing.mjs  brain.mjs  learning.mjs  perp.mjs
│       ├── controls.mjs  shadow.mjs  world.mjs  agents.mjs  store.mjs
│       └── phase10-*.mjs  phase11-*.mjs   ← offline research modules
│
├── data/                        ← runtime state (git-ignored, local only)
│   ├── state.v2.json  signals.v2.json  trades.v2.jsonl  equity.v2.jsonl
│   ├── journal.v2.jsonl  episodes.jsonl  memory.jsonl  candidates.v2.jsonl
│   └── calibration/             ← research outputs (~900 MB, local only)
│
├── docs/                        ← architecture + data contracts (22 files)
│   ├── README.md                ← documentation map
│   ├── RESEARCH.md              ← chronological research index
│   └── 00-…22-*.md
│
├── tests/                       ← 17 test files, 256 tests
└── web/                         ← Next.js dashboard
    └── app/
        ├── api/state/route.ts   ← read-only GET + control POST
        ├── components/          ← Root, DashboardV2, visuals
        ├── lib/format.ts        ← display-only formatters
        ├── globals.css          ← retro CRT theme
        └── layout.tsx
```

---

## Development & research conventions

These are not stylistic preferences — they are the rules that make the negative results
trustworthy.

1. **Pre-registration is binding.** Freeze the spec and hash it *before* reading TEST. Record the
   selection lock. Read TEST **exactly once**. Change nothing afterwards.
2. **Charge only what is traded.** `Σ|targetWeight − driftedWeight|` — never a fictional
   full-book round trip. Reuse the frozen cost primitives in `perp.mjs`.
3. **Prove gross before arguing about costs.** If gross P&L is not positive, cost engineering is
   wasted work.
4. **Always run a negative control.** Deterministic and hash-seeded (`sha256(salt|bar|symbol)`),
   same mechanics, same costs. If shuffling does not hurt, there was no edge.
5. **Production is frozen.** Research re-verifies the production config hashes at start *and* end.
   The write-isolation guard is enforced **in code**, not by convention.
6. **Determinism is a deliverable.** Two runs must produce a byte-identical summary. No
   `Math.random()` anywhere.
7. **Do not force a positive result.** Verdict `C` is a legitimate result. Never promote a `B` to
   a near-success.
8. **The UI must never fabricate.** No invented confidence scores, no fake predictions. Missing
   value → `NO DATA` / `NOT VERIFIED`. Research conclusions are **not** live signals.
9. **Disclose limitations prominently.** Survivorship bias, sample size and missing data appear
   in every report and in this README.
10. **Separate the two regime systems.** The library regime taxonomy and the world-model regime
    taxonomy must never be merged silently (see `docs/13-world-model.md`).

---

## Documentation map

| Document | Scope |
|---|---|
| [docs/RESEARCH.md](docs/RESEARCH.md) | **Chronological research index + why another OHLC-only strategy is not justified** |
| [RESEARCH_RESET_DIAGNOSIS.md](RESEARCH_RESET_DIAGNOSIS.md) | The fundamental-bottleneck diagnosis (problem shape, not a strategy) |
| [docs/README.md](docs/README.md) | Architecture & data-contract documentation map (22 files) |
| [TRADING_AGENT_DEEP_AUDIT.md](TRADING_AGENT_DEEP_AUDIT.md) | Independent code-traced audit incl. scores and known bugs |
| [DECISIONS.md](DECISIONS.md) | Every resolved source gap, with rationale |
| [source-article.md](source-article.md) | The original eleven-prompt build specification |
| [docs/05-configuration.md](docs/05-configuration.md) | Complete configuration reference |
| [docs/09-strategies.md](docs/09-strategies.md) | All six strategies, signals and exits |
| [docs/13-world-model.md](docs/13-world-model.md) | World-model providers, caching and failure behaviour |
| [docs/15-api-contract.md](docs/15-api-contract.md) | The filesystem-backed API contract |

---

## Attribution & licence

Source specification derived from the **FabRich guide**
(<https://fabrichhhhhh.com/free/build-an-ai-trading-bot-with-claude>). Primary evidence is the
supplied repository copy, not an independently fetched live page. Source requirements are labelled
`SOURCE REQUIREMENT`; undefined behaviour is labelled `SOURCE DOES NOT SPECIFY` rather than
guessed at silently.

> **Real observations, fake money. No guaranteed edge.**
> Never connect this simulator to real-money execution. This is not financial advice.

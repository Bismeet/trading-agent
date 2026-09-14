# Alpha Research Report — Post-Phase-9 Signal Discovery Experiment

**Deterministic Paper-Trading Engine — FabInvests**  
**Phase:** Alpha Research (post-Phase 9; research only, nothing deployed)  
**Data through:** 2026-09-13 (UTC)  
**Spec:** `config/alpha-experiment-spec.v1.json` v1.0.0 — PRE-REGISTERED — IMMUTABLE  
**Spec hash:** `808296d1236d8e28`  
**Selection lock hash:** `35b843547c2c86f4`  
**TEST evaluation:** YES — read exactly once, after the lock  
**Final verdict:** **C — STOP / REDESIGN**

---

## 1. Objective and Scope

> *Discover whether a materially stronger entry signal exists whose expected favourable movement is large enough and reliable enough to survive realistic transaction costs.*

This phase asks exactly one question: **does a new entry signal contain enough predictive information to make money after realistic transaction costs, on data it has never seen?**

It is explicitly *not* a risk-management phase, *not* a parameter-tuning phase and *not* a production change. No production file is read for tuning, no production threshold is altered, and no signal discovered here is deployed. The deliverable is a measurement plus an honest verdict.

Protocol constraints honoured by this run:

- Every threshold, horizon, gate and selection rule was fixed in the spec **before** any measurement.
- Selection uses **TRAIN + VALIDATION only**; TEST never participates in selection.
- TEST is read **exactly once**, after the selection lock hash is computed.
- The runner writes only its own artefacts and aborts if a production input changes during the run.

---

## 2. Position Relative to Phases 1–9

Phases 1–9 built and validated the deterministic systems (strategies, risk geometry, signal edge, portfolio management, final end-to-end validation). Phase 9 concluded that the frozen system has **no robust out-of-sample net edge** after realistic costs.

This phase therefore stops optimizing the *system* and instead interrogates the *market*: it asks whether a materially different **entry signal** exists at all.

| | Phase 9 (final validation) | Alpha Research (this phase) |
| --- | --- | --- |
| Object of study | The complete frozen trader | A new entry signal, measured in isolation |
| Success criterion | Positive net expectancy of the portfolio | A replicated, cost-surviving signal |
| Production impact | None (evaluation only) | None (research only; never deployed) |

**Phase 1–9 immutability, verified by hash.** The runner hashes every production input at the start and the end of the run and aborts if any changed:

| Production input | SHA-256 (first 16) |
|---|---|
| `config.json` | `05c52fabe110639f` |
| `final-experiment-spec.v1.json` | `4274e685b2e9db92` |
| `final.control.json` | `30f5d8473affcfc5` |
| `management.control.json` | `c18de8f560d16370` |

End-of-run check: **all unchanged** (otherwise the process exits non-zero and no verdict is issued).

---

## 3. Pre-Registration and Immutability

The protocol is [`config/alpha-experiment-spec.v1.json`](file:///config/alpha-experiment-spec.v1.json), version **1.0.0**, status **PRE-REGISTERED — IMMUTABLE**, SHA-256 `808296d1236d8e28`.

> Pre-registered protocol for ALPHA RESEARCH (post-Phase-9). This is NOT a risk-management or parameter-tuning phase. It asks one question: does the market signal contain enough predictive information to make money after realistic transaction costs? Every threshold below was fixed BEFORE any measurement. The runner reads this file and may not invent thresholds in code.

Because the thresholds are data, the runner cannot invent them: it reads the spec and fails if a required field is missing. Two further immutability properties are enforced by construction:

1. **Production inputs are hashed before and after the run.** Any change aborts the run (see §2).
2. **The selection is locked.** The lock object below is hashed *before* TEST is read, and the hash is byte-stable across repeated runs of the same data (verified by running the experiment twice — identical lock hash).

**Selection lock content** (hashed to produce the selection lock hash):

```json
{
  "specHash": "808296d1236d8e28",
  "primaryHorizonHours": 48,
  "selected": null,
  "bestEffort": "volexp_breakout",
  "usedForArms": "volexp_breakout",
  "trainValDigest": "751a176b59e930d9",
  "benchmarkDigest": "face130b4112818d",
  "selectionRows": [
    {
      "id": "breakout48_trend",
      "family": "A",
      "trainN": 807,
      "trainRawBps": 64.271,
      "trainGrossBps": 55.922,
      "trainNetBps": 45.911,
      "valN": 265,
      "valRawBps": -1.567,
      "valGrossBps": -9.877,
      "valNetBps": -19.877,
      "maxSymbolProfitShare": 0.1804,
      "qualifies": false
    },
    {
      "id": "persistence3",
      "family": "B",
      "trainN": 1023,
      "trainRawBps": 62.287,
      "trainGrossBps": 53.64,
      "trainNetBps": 43.633,
      "valN": 358,
      "valRawBps": -67.296,
      "valGrossBps": -75.851,
      "valNetBps": -85.85,
      "maxSymbolProfitShare": 0.1919,
      "qualifies": false
    },
    {
      "id": "momentum24",
      "family": "C",
      "trainN": 611,
      "trainRawBps": 85.906,
      "trainGrossBps": 77.326,
      "trainNetBps": 67.318,
      "valN": 209,
      "valRawBps": -58.796,
      "valGrossBps": -67.632,
      "valNetBps": -77.629,
      "maxSymbolProfitShare": 0.2106,
      "qualifies": false
    },
    {
      "id": "volexp_breakout",
      "family": "D",
      "trainN": 332,
      "trainRawBps": 120.588,
      "trainGrossBps": 111.631,
      "trainNetBps": 101.623,
      "valN": 107,
      "valRawBps": -25.821,
      "valGrossBps": -34.232,
      "valNetBps": -44.222,
      "maxSymbolProfitShare": 0.2264,
      "qualifies": false
    },
    {
      "id": "compression_breakout",
      "family": "E",
      "trainN": 971,
      "trainRawBps": 27.616,
      "trainGrossBps": 18.97,
      "trainNetBps": 8.957,
      "valN": 328,
      "valRawBps": -11.456,
      "valGrossBps": -20.063,
      "valNetBps": -30.073,
      "maxSymbolProfitShare": 0.1806,
      "qualifies": false
    },
    {
      "id": "mtf_4h_24h",
      "family": "F",
      "trainN": 1110,
      "trainRawBps": 46.547,
      "trainGrossBps": 38.059,
      "trainNetBps": 28.051,
      "valN": 369,
      "valRawBps": -30.817,
      "valGrossBps": -39.349,
      "valNetBps": -49.347,
      "maxSymbolProfitShare": 0.1738,
      "qualifies": false
    },
    {
      "id": "mtf_breakout_daily",
      "family": "F",
      "trainN": 964,
      "trainRawBps": 24.326,
      "trainGrossBps": 15.857,
      "trainNetBps": 5.85,
      "valN": 321,
      "valRawBps": -2.912,
      "valGrossBps": -11.394,
      "valNetBps": -21.387,
      "maxSymbolProfitShare": 0.171,
      "qualifies": false
    },
    {
      "id": "regime_gated_breakout",
      "family": "G",
      "trainN": 518,
      "trainRawBps": 95.526,
      "trainGrossBps": 86.923,
      "trainNetBps": 76.914,
      "valN": 168,
      "valRawBps": -87.491,
      "valGrossBps": -96.303,
      "valNetBps": -106.296,
      "maxSymbolProfitShare": 0.2397,
      "qualifies": false
    }
  ]
}
```

- **Selection lock hash (SHA-256):** `35b843547c2c86f4`
- **Lock frozen at:** 2026-09-14T12:07:52.416Z (timestamp recorded but deliberately excluded from the hash)
- **TEST evaluation rule:** TEST outcomes are read exactly once, after the selection lock hash is computed
- **TEST evaluations performed in this run:** 1

**Reporting clarifications (disclosed in full).** Two items were adjusted while building the report, *after* the first TEST read, and neither touches a threshold, a horizon, an arm definition, a measurement or the selection:

1. The spec defines two alpha arms (`alpha_selected` and `alpha_quality_layer`) but does not name which one the gate set targets. The report therefore shows the **complete gate table for both** (§22) rather than picking one silently.
2. Instrumentation was added to record the **entry funnel** (how many candidates each arm's entry policy rejects and why) and a verbatim **spec snapshot** was embedded in the summary. These are pure bookkeeping additions; the arms' trade counts and raw/gross/net figures are unchanged across those runs.

Both are disclosed here because a pre-registered experiment should be able to say what changed and why. Neither can have improved the result: the verdict is driven by measurements (validation raw edge negative) that were identical in every run.

---

## 4. Data and Panels

**Research panel:** `history.hour.v2.json` — 60m bars over 730d (bar size 3600000 ms).  
**Context panel:** `history.daily.v2.json` — used **only** as causal daily context (daily trend / SMA200 state), never as a source of hourly decisions.

| Panel | Symbols | Bars | First bar (UTC) | Last bar (UTC) |
|---|---|---|---|---|
| hourly research | n/a | 132975 | 2023-10-04 | 2026-09-13 |
| daily context | n/a | 20374 | 2021-09-13 | 2026-09-13 |

**Symbols (14)** across markets crypto, india, us: `AAPL`, `AMZN`, `BTC-USD`, `DOGE-USD`, `ETH-USD`, `HDFCBANK.NS`, `INFY.NS`, `MSFT`, `NVDA`, `RELIANCE.NS`, `SOL-USD`, `TCS.NS`, `TSLA`, `XRP-USD`.

Both panels are real historical data acquired in earlier phases; nothing is synthetic and nothing is resampled for this experiment beyond the frozen hourly/daily bar definitions.

| Market | Resolved trades (pure-signal arm) | Mean cost (bps) | Fee (bps) | Spread + impact (bps) |
|---|---|---|---|---|
| `crypto` | 367 | 20.41 | 10.06 | 10.35 |
| `india` | 71 | 15.16 | 10.01 | 5.15 |
| `us` | 93 | 15.22 | 10.05 | 5.17 |

**Excluded panels (recorded, with reason):**

- `quarter` — 15m panel covers only 60 calendar days; a 60-day window cannot support robust out-of-sample evidence and would invite one-period artefacts.

**Benchmark re-expression:** `bench_donchian` — Faithful re-expression of the frozen donchian rule at the same temporal scale (20 trading days = 480 hourly bars, 200-day daily trend filter) evaluated on the hourly research panel so that it can be measured with identical cost and horizon machinery. Lookback 480 hourly bars; daily trend filter SMA200; one candidate per symbol per UTC day (the first hourly bar of the day on which the condition holds), mirroring the daily-panel decision cadence used in production.

---

## 5. Splits, Sub-Folds and Chronology

Splits are **strictly chronological and applied per symbol** (no shuffling, no cross-sectional leakage): **TRAIN 60% / VALIDATION 20% / TEST 20%**.

Each fold is further divided into **4 equal chronological sub-folds**, used for the stability gate (§23). Sub-fold index is assigned by bar position inside its fold.

| Symbol | Train bars | Validation bars | Test bars | Train range | Validation range | Test range |
|---|---|---|---|---|---|---|
| `AAPL` | 3048 | 1016 | 1017 | 0..3048 | 3048..4064 | 4064..5081 |
| `AMZN` | 3048 | 1016 | 1017 | 0..3048 | 3048..4064 | 4064..5081 |
| `BTC-USD` | 10486 | 3495 | 3497 | 0..10486 | 10486..13981 | 13981..17478 |
| `DOGE-USD` | 10485 | 3495 | 3496 | 0..10485 | 10485..13980 | 13980..17476 |
| `ETH-USD` | 10485 | 3495 | 3495 | 0..10485 | 10485..13980 | 13980..17475 |
| `HDFCBANK.NS` | 3028 | 1009 | 1010 | 0..3028 | 3028..4037 | 4037..5047 |
| `INFY.NS` | 3029 | 1009 | 1011 | 0..3029 | 3029..4038 | 4038..5049 |
| `MSFT` | 3048 | 1016 | 1017 | 0..3048 | 3048..4064 | 4064..5081 |
| `NVDA` | 3048 | 1016 | 1017 | 0..3048 | 3048..4064 | 4064..5081 |
| `RELIANCE.NS` | 3029 | 1009 | 1011 | 0..3029 | 3029..4038 | 4038..5049 |
| `SOL-USD` | 10486 | 3495 | 3496 | 0..10486 | 10486..13981 | 13981..17477 |
| `TCS.NS` | 3024 | 1008 | 1009 | 0..3024 | 3024..4032 | 4032..5041 |
| `TSLA` | 3048 | 1016 | 1017 | 0..3048 | 3048..4064 | 4064..5081 |
| `XRP-USD` | 10486 | 3495 | 3497 | 0..10486 | 10486..13981 | 13981..17478 |

Ranges are **bar indices**. TRAIN is the oldest segment, TEST the newest — the same chronological convention used throughout Phases 1–9, so an out-of-sample result here is genuinely forward in time.

---

## 6. Causality Contract (No Look-Ahead)

Every feature, every signal, every gate and every measurement in this experiment obeys one strict rule:

> **At bar `k`, only information from bars `<= k` may be used to decide, and only information from bars `> k` may be used to measure the outcome.**

Concretely, the decisions use:

- the **decision bar** = the last *completed* hourly bar (its close, high, low, open);
- rolling windows (ATR, channel maxima/minima, z-scores, compression, volatility ratio) computed with **strictly prior** bars only (a window of length `w` at bar `k` ends at `k-1`);
- daily context taken from the **previous completed daily bar** only, so a not-yet-closed day cannot leak future information;
- returns `r4`, `r24`, `r72` built from closes at or before the decision bar.

The outcome uses:

- the entry at the decision bar's close (or the **next bar's open** for the delayed-entry robustness arm), and the exit `h` bars later — always strictly after the decision bar;
- MFE/MAE, time-to-target and time-to-stop tracked **only** over bars after entry.

This is enforced structurally in `alpha-features.mjs` (all rolling helpers are lagged) and is **asserted by the test suite**: truncating the panel at bar `k` and recomputing every feature must reproduce the value computed on the full panel, bit-for-bit. If any feature peeked forward, that test fails.

---

## 7. Horizons Under Test

Six decision horizons were pre-registered: **4h, 8h, 12h, 24h, 48h, 72h**, with **48h as the primary horizon**.

Rationale, fixed before measurement: the production system operated at 4h and 12h exits; Phase 6/9 showed that a 4h time-stop truncates favourable price discovery, so the horizon grid deliberately extends far beyond production to test whether *more time* converts a weak edge into a cost-surviving one.

Every measured trade is a **fixed-horizon** trade (no stop, no target, no trailing) unless the arm explicitly says otherwise, so that the measurement isolates the *signal* rather than the management layer. Managed arms re-use the frozen Phase 8 simulator unchanged (`MGMT_CONTROL`, `MGMT_ADAPTIVE_HOLD`).

**Exit/measurement modes used by the arms:**

| Mode | Meaning |
| --- | --- |
| `fixed_<h>h_close` | enter at decision-bar close, exit at close `h` bars later |
| `fixed_<h>h_nextOpen` | enter at the next bar's open (implementation-delay robustness), exit `h` bars later |
| `MGMT_CONTROL` | frozen Phase 8 control management (4h time-stop) |
| `MGMT_ADAPTIVE_HOLD` | frozen Phase 8 adaptive management (extend favourable to 12h, cut deteriorating at 2h) |

---

## 8. Signal Families and Signal Definitions

**7 families** cover **8 signals**. Families were chosen to span mechanically different sources of edge rather than variations of one idea, so that a negative result is informative about *classes* of signals, not just one parameterisation.

| Family id | Family name | Signals |
|---|---|---|
| **A** | TREND_BREAKOUT | `breakout48_trend` |
| **B** | TREND_PERSISTENCE | `persistence3` |
| **C** | MOMENTUM_CONTINUATION | `momentum24` |
| **D** | VOL_EXPANSION_BREAKOUT | `volexp_breakout` |
| **E** | COMPRESSION_THEN_EXPANSION | `compression_breakout` |
| **F** | MULTI_TIMEFRAME_CONFIRMATION | `mtf_4h_24h`, `mtf_breakout_daily` |
| **G** | MARKET_REGIME_DIRECTION | `regime_gated_breakout` |

**`breakout48_trend`** — 48h breakout with 24h trend agreement *(family A)*  
Definition: close > max(prior 48 hourly highs) AND r24 > 0 AND dailyAboveSma50 (long); exact mirror for short  
Inputs: `breakout48`, `r24`, `dailyAboveSma50`

**`persistence3`** — Three-horizon trend persistence *(family B)*  
Definition: sign(r4) == sign(r24) == sign(r72) != 0 AND z24 >= 1.0  
Inputs: `r4`, `r24`, `r72`, `z24`

**`momentum24`** — 24h momentum continuation *(family C)*  
Definition: z24 >= 1.5 AND sign(r24) == sign(r72)  
Inputs: `r24`, `r72`, `z24`

**`volexp_breakout`** — Volatility expansion plus 48h breakout *(family D)*  
Definition: breakout48 direction AND volExpansion >= 1.2  
Inputs: `breakout48`, `volExpansion`, `r24`, `dailyAboveSma50`

**`compression_breakout`** — Range compression then expansion *(family E)*  
Definition: rangeCompression <= 0.6 AND close outside prior 48-bar channel AND bodyRatio >= 0.5  
Inputs: `rangeCompression`, `breakout48`, `bodyRatio`

**`mtf_4h_24h`** — 4h breakout confirmed by 24h trend *(family F)*  
Definition: close > max(prior 4 hourly highs) AND z24 >= 0.5 AND dailyAboveSma50  
Inputs: `breakout4`, `z24`, `dailyAboveSma50`

**`mtf_breakout_daily`** — 24h breakout confirmed by 72h trend and daily SMA200 *(family F)*  
Definition: close > max(prior 24 hourly highs) AND r72 > 0 AND dailyAboveSma200  
Inputs: `breakout24`, `r72`, `dailyAboveSma200`

**`regime_gated_breakout`** — 48h breakout gated to strong-trend regime *(family G)*  
Definition: breakout48 direction AND trendRegime == strong_trend AND regimeDirection agrees with side  
Inputs: `breakout48`, `trendRegime`, `regimeDirection`

All signals are **symmetric**: the long definition is mirrored exactly for shorts (replace `max` with `min`, flip the sign of every directional test). No signal is long-only, which matters because a long-only result in a rising sample would otherwise be indistinguishable from an edge.

Supporting causal primitives (thresholds are spec data, not code):

```json
{
  "breakoutLookbacks": [
    4,
    24,
    48
  ],
  "volExpansionMin": 1.2,
  "compressionRatioMax": 0.6,
  "compressionShortWindow": 48,
  "compressionLongWindow": 240,
  "bodyRatioMin": 0.5,
  "persistenceZMin": 1,
  "momentumZMin": 1.5,
  "mtfZMin": 0.5,
  "strongTrendZ": 1.5,
  "weakTrendZ": 0.5,
  "volRegimeHighRatio": 1.5,
  "volRegimeLowRatio": 0.7,
  "volRatioWindow": 240,
  "expansionVolRatio": 1.3,
  "contractionVolRatio": 1,
  "compressionRegimeMax": 0.65,
  "atrFastN": 14,
  "atrSlowN": 50,
  "dailySmaFastN": 50,
  "dailySmaSlowN": 200
}
```

---

## 9. Candidate Generation (How Many Independent Decisions Each Signal Produces)

A *candidate* is one causally-fired signal bar (one symbol, one bar, one side). Candidates are then filtered by the entry policy and by the **non-overlap rule** (below).

| Signal | Family | Raw firing bars | Candidates | Train | Validation | Test |
|---|---|---|---|---|---|---|
| `breakout48_trend` | A | 5681 | 5681 | 3625 | 1040 | 1016 |
| `persistence3` | B | 16749 | 16749 | 10680 | 3516 | 2553 |
| `momentum24` | C | 6542 | 6542 | 4120 | 1516 | 906 |
| `volexp_breakout` | D | 1439 | 1439 | 961 | 257 | 221 |
| `compression_breakout` | E | 5597 | 5597 | 3583 | 1072 | 942 |
| `mtf_4h_24h` | F | 12129 | 12129 | 7634 | 2437 | 2058 |
| `mtf_breakout_daily` | F | 7674 | 7674 | 4847 | 1478 | 1349 |
| `regime_gated_breakout` | G | 2241 | 2241 | 1458 | 476 | 307 |
| `bench_donchian` | benchmark | 1831 | 876 | 556 | 139 | 181 |

**Non-overlap rule (applied in every arm).** On any symbol, while a position opened by an arm is still open, no further entry is taken on that symbol. This is the *tradable* quantity: without it, overlapping duplicates would inflate sample sizes and make the same price move count several times. The funnel below shows how much of each signal survives it.

| Arm | Candidates | Blocked by non-overlap | Rejected by entry policy | Accepted (all folds) |
|---|---|---|---|---|
| `NEW_ALPHA` | 1439 | 908 | 0 | 531 |
| `NEW_ALPHA_QUALITY` | 1439 | 11 | 1423 | 5 |
| `NEW_ALPHA_PHASE7` | 1439 | 638 | 458 | 343 |

Why the entry policies reject, in full detail (every reason string the pre-registered decision layer can emit):

- `NEW_ALPHA`: no policy rejections (entry policy accepts all non-overlapping candidates).
- `NEW_ALPHA_QUALITY`: `REJECTED:REJ_MARGINAL_BREAKOUT` = 6; `REJECTED:REJ_MARGINAL_BREAKOUT+REJ_OVEREXTENDED` = 309; `REJECTED:REJ_OVEREXTENDED` = 963; `REJECTED:REJ_WEAK_BODY+REJ_MARGINAL_BREAKOUT` = 2; `REJECTED:REJ_WEAK_BODY+REJ_MARGINAL_BREAKOUT+REJ_OVEREXTENDED` = 97; `REJECTED:REJ_WEAK_BODY+REJ_OVEREXTENDED` = 46
- `NEW_ALPHA_PHASE7`: `ABSTAIN_NO_AGREEMENT` = 458

---

## 10. Transaction-Cost Model

Costs are the same primitives the production engine uses (`perp.mjs`), so a signal that survives here would survive in production execution terms:

```json
{
  "marginUsd": 100,
  "takerFee": 0.0005,
  "slippageByMarket": {
    "crypto": 0.001,
    "us": 0.0005,
    "india": 0.0005
  },
  "note": "Same primitives as production (perp.mjs): taker fee on both legs, adverse fills = half spread + square-root impact."
}
```

Every measured trade decomposes into exactly three numbers, and the report never mixes them up:

| Quantity | Definition | What it isolates |
| --- | --- | --- |
| **raw** (bps) | exit reference price minus entry reference price | pure directional information, no frictions |
| **gross** (bps) | raw after **adverse fills** (half spread + square-root market impact on both legs) | information + execution drag |
| **net** (bps) | gross after **taker fees on both legs** | what a trader actually keeps |

Costs are charged on **notional = margin x leverage**, with the pre-registered geometry:

| Strategy key | Base leverage | Stop | Target |
|---|---|---|---|
| `alpha_breakout` | 12x | 5.0% | 8.0% |
| `bench_donchian` | 12x | 5.0% | 8.0% |

**Measured cost drag** (mean over the resolved trades of the pure-signal arm) — a sanity check that the cost model is biting as designed:

| Market | Trades | Cost (bps) | Fee (bps) | Spread + impact (bps) |
|---|---|---|---|---|
| `crypto` | 367 | 20.41 | 10.06 | 10.35 |
| `india` | 71 | 15.16 | 10.01 | 5.15 |
| `us` | 93 | 15.22 | 10.05 | 5.17 |

Measured round-trip drag is **20.41 bps on crypto** versus **15.22 bps on US equities** and **15.16 bps on Indian equities** (mean per resolved trade). That is a **1.34x** higher hurdle on crypto for the same raw edge, which is why market-level results are reported separately (§17) rather than pooled into one number.

---

## 11. Expected-Move Model and Causal Cost Coverage

Before any trade is taken, the experiment asks a purely causal question: **is the expected favourable move for this horizon large enough to pay for the round trip?**

```json
{
  "note": "Causal expected favourable movement = atrNorm * sqrt(horizonHours). Fixed before measurement; not fitted.",
  "scaling": "sqrt",
  "multiplier": 1
}
```

The ratio is `expectedMove / roundTripCost` where `expectedMove = atrNorm x sqrt(h)` and the round-trip cost fraction is recomputed per market from the same primitives. The table below counts **every eligible bar** in each fold (not just signal bars), so it describes the tradeable universe rather than the signals:

| Horizon | TRAIN n | TRAIN mean ratio | TRAIN >=5x | VAL n | VAL >=5x | TEST n | TEST >=5x | TEST >=10x |
|---|---|---|---|---|---|---|---|---|
| 4h | 79582 | 9.91 | 87.6% | 26590 | 82.2% | 26607 | 81.5% | 31.0% |
| 8h | 79582 | 14.02 | 95.9% | 26590 | 93.4% | 26607 | 93.2% | 59.5% |
| 12h | 79582 | 17.17 | 97.8% | 26590 | 96.4% | 26607 | 96.4% | 73.2% |
| 24h | 79582 | 24.28 | 99.5% | 26590 | 98.9% | 26607 | 99.0% | 89.7% |
| 48h | 79582 | 34.33 | 99.9% | 26590 | 99.8% | 26607 | 99.7% | 96.4% |
| 72h | 79582 | 42.05 | 100.0% | 26590 | 100.0% | 26607 | 99.9% | 98.3% |

**Reading this table.** The 4h row is the reason this phase exists: 12.4% of TRAIN bars fail even the 5x cost test at 4h, while at 48h only 0.1% fail it. The filter is generous by construction and is **not** a direction test: a bar that clears the cost bar comfortably can still be a coin flip, which is exactly what §12 and §13 demonstrate. It is the first of the two conditions in the decision layer (`costCoverageFloor`) and it does real work only at short horizons.

---

## 12. Base-Rate Control (Signal-Free)

Before crediting any signal, the experiment first measures what a **signal-free** trade earns. The control is pre-registered and deliberately dumb: at the primary horizon, take the direction from the sign of the causal 24-bar return (`r24`), with the same non-overlapping sampling and the same cost and horizon machinery as the signals.

This control answers the obvious objection *"is a breakout signal anything more than 'buy when the market has been going up'?"*

| Fold | Resolved | raw (bps) | gross (bps) | net (bps) | mean R | win rate | MFE (bps) | MAE (bps) |
|---|---|---|---|---|---|---|---|---|
| train | 1657 | +36.92 | +28.35 | +18.34 | 0.0367 | 50.6% | 442.38 | -366.99 |
| validation | 559 | -59.06 | -67.55 | -77.55 | -0.1551 | 41.0% | 327.27 | -362.12 |
| test | 563 | +31.81 | +23.32 | +13.32 | 0.0266 | 49.7% | 347.05 | -292.95 |

**The control is only half the story, and the more interesting half.** On TRAIN the naive momentum direction is +18.34 bps net; on VALIDATION it is -77.55 bps net. Any signal whose TRAIN result looks like the control's, and whose VALIDATION result also looks like the control's, has demonstrated *sample-period momentum exposure* rather than an edge — which is exactly the pattern the signal study in §13 exhibits. It is the single most important warning sign in this report.

---

## 13. Horizon Study on TRAIN + VALIDATION

All numbers below are computed **before** TEST is touched; they are the only inputs the selection protocol (§18) may use. Each cell is the **net** (after fees, spread and impact) mean per trade in bps, with fixed-horizon exits.

**TRAIN — net bps per trade**

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | -8.39 | -5.77 | -11.29 | +12.70 | -16.29 | -11.39 | -14.44 | -9.53 | -7.33 |
| 8h | -0.06 | -6.42 | +6.75 | +26.05 | -9.85 | -10.69 | -9.27 | +14.30 | +11.34 |
| 12h | -2.99 | -4.32 | +20.20 | +59.27 | -9.26 | -12.82 | -15.79 | +27.98 | +18.65 |
| 24h | +13.02 | +12.64 | +38.84 | +50.66 | +8.13 | -7.81 | -5.63 | +48.29 | +49.45 |
| 48h | +45.91 | +43.63 | +67.32 | +101.62 | +8.96 | +28.05 | +5.85 | +76.91 | +128.04 |
| 72h | +46.13 | +10.41 | +39.96 | +92.19 | +49.38 | +21.24 | +18.25 | +61.98 | +117.81 |

**TRAIN — raw bps per trade (pre-cost information)**

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | +9.86 | +12.74 | +7.13 | +31.65 | +2.41 | +7.01 | +3.94 | +9.01 | +10.30 |
| 8h | +18.24 | +12.14 | +25.28 | +45.06 | +8.86 | +7.75 | +9.15 | +32.90 | +29.23 |
| 12h | +15.31 | +14.26 | +38.72 | +78.24 | +9.44 | +5.56 | +2.65 | +46.54 | +36.53 |
| 24h | +31.33 | +31.29 | +57.47 | +69.65 | +26.80 | +10.62 | +12.86 | +66.90 | +67.46 |
| 48h | +64.27 | +62.29 | +85.91 | +120.59 | +27.62 | +46.55 | +24.33 | +95.53 | +146.14 |
| 72h | +64.66 | +29.04 | +58.60 | +111.18 | +68.09 | +39.78 | +36.78 | +80.63 | +136.06 |

**VALIDATION — net bps per trade**

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | -1.91 | -17.88 | -14.04 | -12.85 | -16.58 | -10.79 | -11.92 | +7.25 | -8.38 |
| 8h | -19.95 | -19.38 | -19.37 | -42.15 | -19.01 | -14.08 | -24.53 | -10.20 | -21.78 |
| 12h | -17.89 | -19.26 | -33.26 | -37.51 | -17.29 | -27.81 | -24.80 | -14.57 | +10.96 |
| 24h | -21.14 | -51.25 | -43.50 | -76.57 | -22.83 | -29.86 | -39.62 | -24.66 | -15.08 |
| 48h | -19.88 | -85.85 | -77.63 | -44.22 | -30.07 | -49.35 | -21.39 | -106.30 | +39.53 |
| 72h | -45.50 | -103.11 | -125.54 | -110.91 | -26.17 | -21.48 | +5.73 | -147.21 | +65.10 |

**VALIDATION — raw bps per trade (pre-cost information)**

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | +16.24 | +0.67 | +4.79 | +5.53 | +2.17 | +7.64 | +6.49 | +26.17 | +8.96 |
| 8h | -1.69 | -0.80 | -0.45 | -23.58 | -0.25 | +4.39 | -6.11 | +8.78 | -4.32 |
| 12h | +0.31 | -0.69 | -14.35 | -18.99 | +1.45 | -9.34 | -6.35 | +4.40 | +28.41 |
| 24h | -2.89 | -32.67 | -24.65 | -58.04 | -4.17 | -11.37 | -21.08 | -5.75 | +2.54 |
| 48h | -1.57 | -67.30 | -58.80 | -25.82 | -11.46 | -30.82 | -2.91 | -87.49 | +57.02 |
| 72h | -27.21 | -84.65 | -106.80 | -92.49 | -7.54 | -3.02 | +24.31 | -128.49 | +82.74 |

**Primary horizon (48h) in detail** — the numbers the selection protocol consumes:

| Signal | TRAIN n | TRAIN raw | TRAIN gross | TRAIN net | VAL n | VAL raw | VAL gross | VAL net | VAL mean R |
|---|---|---|---|---|---|---|---|---|---|
| `breakout48_trend` | 807 | +64.27 | +55.92 | +45.91 | 265 | -1.57 | -9.88 | -19.88 | -0.0398 |
| `persistence3` | 1023 | +62.29 | +53.64 | +43.63 | 358 | -67.30 | -75.85 | -85.85 | -0.1717 |
| `momentum24` | 611 | +85.91 | +77.33 | +67.32 | 209 | -58.80 | -67.63 | -77.63 | -0.1553 |
| `volexp_breakout` | 332 | +120.59 | +111.63 | +101.62 | 107 | -25.82 | -34.23 | -44.22 | -0.0884 |
| `compression_breakout` | 971 | +27.62 | +18.97 | +8.96 | 328 | -11.46 | -20.06 | -30.07 | -0.0601 |
| `mtf_4h_24h` | 1110 | +46.55 | +38.06 | +28.05 | 369 | -30.82 | -39.35 | -49.35 | -0.0987 |
| `mtf_breakout_daily` | 964 | +24.33 | +15.86 | +5.85 | 321 | -2.91 | -11.39 | -21.39 | -0.0428 |
| `regime_gated_breakout` | 518 | +95.53 | +86.92 | +76.91 | 168 | -87.49 | -96.30 | -106.30 | -0.2126 |
| `bench_donchian` | 260 | +146.14 | +138.05 | +128.04 | 70 | +57.02 | +49.52 | +39.53 | 0.0791 |

**Two patterns dominate this table, and they point in opposite directions:**

1. **TRAIN looks encouraging.** 8 of 8 signals have positive raw edge on TRAIN at the primary horizon (8 stay positive after costs).
2. **VALIDATION reverses it.** Only 0 of 8 signals keep a positive raw edge out-of-sample (0 after costs).

A signal that is positive in the training window and negative in the next window, in the *same direction* as the naive momentum control (§12), is describing a **market regime** rather than a repeatable edge. That is a substantive finding, not a technicality — and it is precisely why the selection protocol (§18) is judged on VALIDATION net edge rather than TRAIN edge.

---

## 14. Quality Score (Pre-Registered Decision Layer)

The decision layer is a **deterministic, untrained** weighted score. Nothing here is fitted: every component is a closed-form function of pre-trade, causal features, and the weights and threshold were fixed in the spec.

```json
{
  "components": [
    "trendAlignment",
    "breakoutQuality",
    "volExpansion",
    "mtfAgreement",
    "costCoverage"
  ],
  "weights": {
    "trendAlignment": 0.25,
    "breakoutQuality": 0.25,
    "volExpansion": 0.15,
    "mtfAgreement": 0.2,
    "costCoverage": 0.15
  },
  "takeThreshold": 0.55,
  "costCoverageFloor": 0.2,
  "note": "Deterministic, causal, untrained. Every component is a closed-form function of pre-trade features."
}
```

| Component | What it measures (causal) |
| --- | --- |
| `trendAlignment` | fraction of `r4`/`r24`/`r72` whose sign agrees with the trade side |
| `breakoutQuality` | distance beyond the prior 48-bar channel, in hourly ATRs (1.0 if >= 0.5 ATR, 0.5 if > 0, else 0) |
| `volExpansion` | fast/slow ATR ratio, scaled in [1.0, 1.5] |
| `mtfAgreement` | daily SMA50 trend agreement (0.5) plus 24-bar return agreement (0.5) |
| `costCoverage` | expected move / round-trip cost, saturating at 10x |

**Score-bucket outcomes.** Buckets use *fixed* edges (chosen in the spec, never fitted): `q0` < 0.35, `q1` 0.35–0.50, `q2` 0.50–0.65, `q3` 0.65–0.80, `q4` >= 0.80. Only buckets that actually contain accepted trades appear.

| Score bucket | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor |
|---|---|---|---|---|---|---|---|
| `q3_0.65-0.80` | 104 | +34.57 | +25.93 | +15.92 | 0.0318 | 41.3% | 1.08 |
| `q4_>=0.80` | 427 | +87.63 | +78.80 | +68.79 | 0.1376 | 48.7% | 1.41 |

**Interpretation.** Higher score does buy *something* pre-cost — the top bucket is the only one with a positive raw edge in the pure-signal arm — but the effect is far too small to cover the round trip, and the sample in the top bucket is thin. The decision layer is therefore not a solution in itself: it is a *filter*, and a filter cannot create edge that the underlying signal does not have.

---

## 15. False-Breakout Rejection Rules

**5 rejection rules** were pre-registered to remove the classic false-breakout patterns. Each rule reports *independently* so its marginal value can be measured:

| Rule | Definition (verbatim from the spec) |
|---|---|
| `REJ_NO_VOL_EXPANSION` | reject when volExpansion < 1.0 |
| `REJ_WEAK_BODY` | reject when bodyRatio < 0.3 |
| `REJ_COUNTER_DAILY_TREND` | reject when the side disagrees with the causal daily SMA50 trend |
| `REJ_MARGINAL_BREAKOUT` | reject when the breakout distance is below 0.25 hourly ATR beyond the prior channel |
| `REJ_OVEREXTENDED` | reject when |close - 48-bar mid| / atr14 > 2.0 (late, extended entry) |

**Marginal value of each rule** (pure-signal arm; trades are partitioned by whether the rule fired, so the two rows of each rule are mutually exclusive and comparable directly):

| Rule and state | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | stop-hit rate |
|---|---|---|---|---|---|---|---|
| `REJ_COUNTER_DAILY_TREND|clear` | 531 | +77.24 | +68.44 | +58.44 | 0.1169 | 47.3% | 24.9% |
| `REJ_MARGINAL_BREAKOUT|clear` | 396 | +103.18 | +94.23 | +84.23 | 0.1685 | 48.2% | 25.0% |
| `REJ_MARGINAL_BREAKOUT|fired` | 135 | +1.13 | -7.21 | -17.22 | -0.0344 | 44.4% | 24.4% |
| `REJ_NO_VOL_EXPANSION|clear` | 531 | +77.24 | +68.44 | +58.44 | 0.1169 | 47.3% | 24.9% |
| `REJ_OVEREXTENDED|clear` | 10 | +214.41 | +205.32 | +195.32 | 0.3906 | 70.0% | 0.0% |
| `REJ_OVEREXTENDED|fired` | 521 | +74.60 | +65.82 | +55.81 | 0.1116 | 46.8% | 25.3% |
| `REJ_WEAK_BODY|clear` | 492 | +81.76 | +72.82 | +62.81 | 0.1256 | 47.2% | 24.8% |
| `REJ_WEAK_BODY|fired` | 39 | +20.21 | +13.24 | +3.24 | 0.0065 | 48.7% | 25.6% |

| All rules | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate |
|---|---|---|---|---|---|---|
| every rule passed | 3 | +462.92 | +452.80 | +442.80 | 0.8856 | 100.0% |
| at least one rule fired | 528 | +75.05 | +66.26 | +56.25 | 0.1125 | 47.0% |

**Rule-level verdict.** With all rules passing: +442.80 bps net on 3 trades. With any rule fired: +56.25 bps net on 528 trades. The rules do select a better subset *on this arm*, but — as the funnel in §9 already showed — the size and composition of that subset is dominated by a single rule.

**The critical structural finding.** The funnel in §9 shows *why* the quality layer keeps almost no trades, and it is not a threshold-tuning issue:

Of 1423 candidates that reached the quality layer's decision point, **1415 (99.4%) were rejected by `REJ_OVEREXTENDED`** — the rule that rejects an entry when \|close - 48-bar mid\| / atr14 > 2.0.

This is a **design incompatibility, not a market fact**: a *fresh channel breakout is by construction far from the middle of the channel it just broke*. A 48-bar channel is typically several ATRs wide, so a bar sitting at its upper edge is mechanically ~2–4 ATR from the mid. The rule therefore removes essentially every breakout candidate by definition, and only a handful of near-mid entries survive.

This is reported as a **negative result about the protocol**, and it is why the report presents both gate tables (§22) rather than pretending the layer is a tradeable alpha. It is *not* corrected here: adjusting a pre-registered rule after seeing its effect is exactly the behaviour this protocol exists to prevent. A future pre-registered experiment may restate `REJ_OVEREXTENDED` in a scale-free way (for example, distance beyond the *broken channel edge* rather than from the channel *mid*), and that restatement must be fixed before any measurement is taken.

---

## 16. Feature Bucket Analysis

**This is a descriptive analysis, not a search.** Bucket edges are computed from **TRAIN only** (quintiles of the causal feature value at the sampled decision bars), then the *same* edges are applied to VALIDATION and TEST. Every fold uses identical non-overlapping sampling, so the columns are comparable. Nothing in this section feeds selection.

Its purpose is to answer, honestly: *is there any causal feature whose highest bucket carries a real out-of-sample edge?* If one existed, that feature would be the natural seed of a future pre-registered experiment.

**`agreeCount`** — TRAIN quintile edges: 2.000, 2.000, 3.000, 3.000 (1657 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 230 | -13.46 | 71 | -35.56 | 84 | +27.25 | +45.73 | 0.0545 |
| 2 | 706 | -9.37 | 263 | -68.10 | 262 | -17.53 | +1.04 | -0.0351 |
| 4 | 721 | +55.62 | 225 | -101.83 | 217 | +45.18 | +63.57 | 0.0904 |

**`atrNormBps`** — TRAIN quintile edges: 55.641, 71.044, 90.968, 126.374 (1657 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 331 | +33.45 | 221 | -50.95 | 134 | +5.72 | +25.24 | 0.0114 |
| 1 | 331 | +27.39 | 139 | -76.99 | 117 | +36.79 | +55.11 | 0.0736 |
| 2 | 332 | -0.96 | 100 | -104.36 | 123 | -33.11 | -15.09 | -0.0662 |
| 3 | 331 | +91.87 | 68 | -169.99 | 137 | +30.70 | +48.66 | 0.0614 |
| 4 | 332 | -59.75 | 31 | +19.62 | 52 | +44.13 | +62.85 | 0.0883 |

**`bodyRatio`** — TRAIN quintile edges: 0.239, 0.433, 0.613, 0.798 (1657 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 331 | +14.06 | 106 | -109.13 | 135 | +36.50 | +55.29 | 0.0730 |
| 1 | 331 | -8.27 | 98 | -70.48 | 129 | +1.14 | +19.60 | 0.0023 |
| 2 | 332 | +52.40 | 102 | -39.48 | 117 | -17.03 | +1.58 | -0.0341 |
| 3 | 331 | +16.11 | 144 | -50.99 | 109 | +29.73 | +47.65 | 0.0595 |
| 4 | 332 | +17.31 | 109 | -123.88 | 73 | +16.11 | +34.74 | 0.0322 |

**`breakoutDistAtr`** — TRAIN quintile edges: -3.504, -2.238, -1.406, -0.657 (1643 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 328 | -63.35 | 155 | -72.57 | 98 | +1.84 | +19.61 | 0.0037 |
| 1 | 329 | +42.44 | 143 | -150.27 | 125 | -18.05 | +0.55 | -0.0361 |
| 2 | 328 | +34.32 | 85 | -49.09 | 146 | +24.08 | +42.95 | 0.0482 |
| 3 | 329 | -10.99 | 89 | -68.31 | 113 | +31.71 | +50.55 | 0.0634 |
| 4 | 329 | +79.79 | 87 | -4.12 | 81 | +30.56 | +48.55 | 0.0611 |

**`distFromMidAtr`** — TRAIN quintile edges: 0.316, 1.509, 2.578, 3.869 (1643 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 328 | -49.44 | 109 | -32.42 | 125 | -8.43 | +10.05 | -0.0169 |
| 1 | 329 | +11.14 | 91 | -60.05 | 135 | -6.26 | +12.81 | -0.0125 |
| 2 | 328 | +10.75 | 100 | -144.48 | 139 | +35.64 | +54.30 | 0.0713 |
| 3 | 329 | +60.92 | 120 | -55.62 | 96 | -33.58 | -14.91 | -0.0672 |
| 4 | 329 | +48.81 | 139 | -95.16 | 68 | +112.77 | +129.49 | 0.2255 |

**`moveCostRatio`** — TRAIN quintile edges: 21.330, 27.056, 34.034, 46.081 (1657 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 331 | +37.67 | 241 | -55.55 | 151 | +0.66 | +20.74 | 0.0013 |
| 1 | 331 | +27.07 | 122 | -89.51 | 94 | +16.18 | +35.30 | 0.0324 |
| 2 | 332 | +54.84 | 84 | -59.52 | 112 | +41.83 | +60.11 | 0.0837 |
| 3 | 331 | -17.22 | 62 | -114.09 | 107 | +25.72 | +42.99 | 0.0514 |
| 4 | 332 | -10.68 | 50 | -139.33 | 99 | -15.73 | +1.25 | -0.0315 |

**`rangeCompression`** — TRAIN quintile edges: 0.278, 0.368, 0.468, 0.588 (1587 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 317 | -40.37 | 78 | +35.74 | 112 | +9.37 | +27.53 | 0.0187 |
| 1 | 317 | +10.73 | 108 | -2.10 | 109 | +12.55 | +31.08 | 0.0251 |
| 2 | 318 | +47.24 | 115 | -102.08 | 99 | -41.08 | -22.18 | -0.0822 |
| 3 | 317 | +72.23 | 117 | -104.63 | 116 | +1.60 | +19.75 | 0.0032 |
| 4 | 318 | -10.61 | 141 | -155.51 | 127 | +70.57 | +89.29 | 0.1411 |

**`volExpansion`** — TRAIN quintile edges: 0.846, 0.982, 1.094, 1.249 (1643 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 328 | -50.35 | 219 | +2.66 | 91 | +17.51 | +36.44 | 0.0350 |
| 1 | 329 | -9.27 | 127 | -182.27 | 150 | +27.99 | +45.66 | 0.0560 |
| 2 | 328 | +86.75 | 78 | -175.50 | 125 | +14.77 | +33.02 | 0.0295 |
| 3 | 329 | +3.44 | 63 | -121.04 | 103 | -14.45 | +4.20 | -0.0289 |
| 4 | 329 | +51.84 | 72 | +7.39 | 94 | +14.35 | +33.86 | 0.0287 |

**`volRatio`** — TRAIN quintile edges:  (0 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|

**`z24`** — TRAIN quintile edges: -0.540, -0.132, 0.251, 0.753 (1657 sampled TRAIN bars)

| Bucket | TRAIN n | TRAIN net | VAL n | VAL net | TEST n | TEST net | TEST raw | TEST mean R |
|---|---|---|---|---|---|---|---|---|
| 0 | 331 | -27.87 | 156 | -72.02 | 133 | -35.32 | -17.14 | -0.0706 |
| 1 | 331 | -23.08 | 112 | -35.67 | 118 | +64.17 | +82.81 | 0.1283 |
| 2 | 332 | -40.06 | 82 | -122.04 | 120 | +6.70 | +25.39 | 0.0134 |
| 3 | 331 | +37.81 | 107 | -56.79 | 116 | -21.58 | -2.92 | -0.0432 |
| 4 | 332 | +144.71 | 102 | -117.98 | 76 | +83.20 | +101.41 | 0.1664 |

**How to read these tables.** Each row is one fifth of the causal feature's distribution, with the *same* boundary applied to all folds. A monotone column of falling-then-rising net bps across buckets, stable in VALIDATION and TEST, would be a genuine lead. Thin buckets (n < 30) are noise and should be ignored. The report deliberately shows *all* buckets — including the unflattering ones — because selective presentation of bucket tables is how spurious features get promoted.

---

## 17. Regime, Market, Symbol and Side Analysis

The pure-signal arm (`NEW_ALPHA`, the selected candidate traded at the primary horizon with no quality filter) is partitioned below. All cells share one statistics implementation, so no cell can disagree with the aggregate.

**Market** — the gate set requires each market with >=10% share of the sample to be independently positive

| Group | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | MFE (bps) | MAE (bps) | avg hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `crypto` | 367 | +105.26 | +94.85 | +84.86 | 0.1697 | 47.7% | 1.50 | 559.90 | -353.87 | 48.0 |
| `india` | 71 | +46.97 | +41.81 | +31.81 | 0.0636 | 52.1% | 1.27 | 320.37 | -233.88 | 48.0 |
| `us` | 93 | -10.26 | -15.45 | -25.48 | -0.0510 | 41.9% | 0.89 | 520.43 | -419.29 | 48.0 |

**Side** — long vs short symmetry check — a long-only edge in a rising sample would be a regime artefact

| Group | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | MFE (bps) | MAE (bps) | avg hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `long` | 277 | +166.98 | +158.25 | +148.24 | 0.2965 | 52.0% | 2.05 | 535.36 | -310.04 | 48.0 |
| `short` | 254 | -20.63 | -29.50 | -39.50 | -0.0790 | 42.1% | 0.81 | 505.27 | -392.09 | 48.0 |

**Causal regime label** — regime labels are closed-form functions of the decision bar's own causal features

| Group | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | MFE (bps) | MAE (bps) | avg hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `expansion` | 238 | +77.26 | +68.12 | +58.12 | 0.1162 | 47.5% | 1.34 | 541.87 | -356.18 | 48.0 |
| `range` | 33 | +8.27 | -0.74 | -10.74 | -0.0215 | 48.5% | 0.93 | 334.41 | -298.94 | 48.0 |
| `strong_trend` | 48 | +381.85 | +372.84 | +362.82 | 0.7256 | 56.3% | 3.98 | 867.85 | -307.21 | 48.0 |
| `weak_trend` | 212 | +18.98 | +10.65 | +0.65 | 0.0013 | 44.8% | 1.00 | 447.99 | -358.91 | 48.0 |

**Structure regime** — expansion / contraction / neutral, from volatility expansion and range compression

| Group | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | MFE (bps) | MAE (bps) | avg hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `expansion` | 238 | +77.26 | +68.12 | +58.12 | 0.1162 | 47.5% | 1.34 | 541.87 | -356.18 | 48.0 |
| `neutral` | 293 | +77.22 | +68.71 | +58.70 | 0.1174 | 47.1% | 1.34 | 503.98 | -343.68 | 48.0 |

**Volatility regime** — volatility ratio vs its own 240-bar mean

| Group | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | MFE (bps) | MAE (bps) | avg hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `unknown_vol` | 531 | +77.24 | +68.44 | +58.44 | 0.1169 | 47.3% | 1.34 | 520.96 | -349.29 | 48.0 |

**Exit reason** — fixed-horizon arms exit on the horizon by construction; managed arms show the management layer's decisions

| Group | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | MFE (bps) | MAE (bps) | avg hold (h) |
|---|---|---|---|---|---|---|---|---|---|---|
| `horizon` | 531 | +77.24 | +68.44 | +58.44 | 0.1169 | 47.3% | 1.34 | 520.96 | -349.29 | 48.0 |

**Per symbol** (sorted by sample size) — the concentration gate (§23) is computed from the gross-profit shares of this table:

| Symbol | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor |
|---|---|---|---|---|---|---|---|
| `BTC-USD` | 86 | +28.25 | +17.88 | +7.88 | 0.0158 | 41.9% | 1.06 |
| `DOGE-USD` | 73 | +199.41 | +188.89 | +178.90 | 0.3578 | 50.7% | 1.93 |
| `XRP-USD` | 73 | +121.27 | +110.83 | +100.83 | 0.2017 | 49.3% | 1.62 |
| `ETH-USD` | 68 | +126.82 | +116.46 | +106.46 | 0.2129 | 50.0% | 1.61 |
| `SOL-USD` | 67 | +62.22 | +51.85 | +41.85 | 0.0837 | 47.8% | 1.22 |
| `RELIANCE.NS` | 23 | -13.67 | -18.83 | -28.85 | -0.0577 | 43.5% | 0.78 |
| `AAPL` | 22 | -60.91 | -66.06 | -76.06 | -0.1521 | 45.5% | 0.60 |
| `AMZN` | 19 | -91.56 | -96.77 | -106.80 | -0.2136 | 21.1% | 0.56 |
| `NVDA` | 19 | +29.46 | +24.22 | +14.17 | 0.0283 | 47.4% | 1.05 |
| `TCS.NS` | 19 | +164.28 | +159.16 | +149.18 | 0.2984 | 63.2% | 3.10 |
| `TSLA` | 17 | +116.53 | +111.33 | +101.31 | 0.2026 | 47.1% | 1.40 |
| `MSFT` | 16 | -25.93 | -31.14 | -41.17 | -0.0823 | 50.0% | 0.75 |
| `HDFCBANK.NS` | 15 | +62.18 | +57.05 | +47.05 | 0.0941 | 46.7% | 1.62 |
| `INFY.NS` | 14 | -28.93 | -34.14 | -44.17 | -0.0883 | 57.1% | 0.78 |

**Sub-fold breakdown** (four equal chronological quarters inside each fold) — the stability gate counts how many TEST sub-folds end positive:

| Fold and sub-fold | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate |
|---|---|---|---|---|---|---|
| `test|0` | 23 | -156.13 | -165.24 | -175.26 | -0.3505 | 26.1% |
| `test|1` | 29 | +90.79 | +82.75 | +72.74 | 0.1455 | 55.2% |
| `test|2` | 16 | -112.92 | -122.51 | -132.49 | -0.2650 | 43.8% |
| `test|3` | 24 | +271.05 | +262.72 | +252.70 | 0.5054 | 45.8% |
| `train|0` | 85 | +262.60 | +253.56 | +243.54 | 0.4871 | 52.9% |
| `train|1` | 82 | +51.98 | +43.24 | +33.23 | 0.0665 | 46.3% |
| `train|2` | 78 | +71.01 | +61.86 | +51.86 | 0.1037 | 39.7% |
| `train|3` | 87 | +90.95 | +82.05 | +72.05 | 0.1441 | 49.4% |
| `validation|0` | 31 | -38.67 | -47.35 | -57.34 | -0.1147 | 51.6% |
| `validation|1` | 29 | +37.11 | +27.85 | +17.85 | 0.0357 | 58.6% |
| `validation|2` | 17 | -230.56 | -237.93 | -247.93 | -0.4959 | 17.6% |
| `validation|3` | 30 | +42.64 | +34.74 | +24.76 | 0.0495 | 60.0% |

---

## 18. Selection Protocol and the Selection Lock

> A candidate alpha signal family is selected only if (a) TRAIN net edge > 0, (b) VALIDATION net edge > 0, (c) TRAIN and VALIDATION sample sizes pass, (d) no single symbol supplies more than the profit-share cap. Ties are broken by the pre-registered signal order in this file. TEST never participates in selection.

**Selection folds:** train + validation. **TEST evaluations allowed:** 1.

Selection rule, stated as executed (all pre-registered):

1. **TRAIN net edge > 0** (net of fees, spread and impact), and
2. **VALIDATION net edge > 0**, and
3. **sample sizes pass** (TRAIN >= 300, VALIDATION >= 150 resolved trades), and
4. **no single symbol supplies more than 50%** of gross profit.

Ties are broken by the **pre-registered signal order** in the spec — never by observed performance.

**Candidate-by-candidate selection table (TRAIN + VALIDATION only):**

| Signal | Family | TRAIN n | TRAIN raw | TRAIN gross | TRAIN net | VAL n | VAL raw | VAL gross | VAL net | Max symbol share | Qualifies |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `breakout48_trend` | A | 807 | +64.27 | +55.92 | +45.91 | 265 | -1.57 | -9.88 | -19.88 | 18.0% | no |
| `persistence3` | B | 1023 | +62.29 | +53.64 | +43.63 | 358 | -67.30 | -75.85 | -85.85 | 19.2% | no |
| `momentum24` | C | 611 | +85.91 | +77.33 | +67.32 | 209 | -58.80 | -67.63 | -77.63 | 21.1% | no |
| `volexp_breakout` | D | 332 | +120.59 | +111.63 | +101.62 | 107 | -25.82 | -34.23 | -44.22 | 22.6% | no |
| `compression_breakout` | E | 971 | +27.62 | +18.97 | +8.96 | 328 | -11.46 | -20.06 | -30.07 | 18.1% | no |
| `mtf_4h_24h` | F | 1110 | +46.55 | +38.06 | +28.05 | 369 | -30.82 | -39.35 | -49.35 | 17.4% | no |
| `mtf_breakout_daily` | F | 964 | +24.33 | +15.86 | +5.85 | 321 | -2.91 | -11.39 | -21.39 | 17.1% | no |
| `regime_gated_breakout` | G | 518 | +95.53 | +86.92 | +76.91 | 168 | -87.49 | -96.30 | -106.30 | 24.0% | no |

**Outcome of the pre-registered protocol:** **no candidate qualified** — no signal had both TRAIN and VALIDATION net edge positive while passing the sample and concentration requirements.

For the arm matrix (§19) the protocol falls back to the **best-effort** candidate `volexp_breakout` (the signal with the highest TRAIN net edge), explicitly labelled as a fallback: the arm candidate is **not** a selected signal, so its TEST numbers are reported for completeness and must not be read as a validated result.

**Lock.** The following digest is computed from TRAIN+VALIDATION candidates only, hashed, and used to freeze the run *before* TEST is read. It is byte-stable: two consecutive runs of the same data produce the same hash.

```json
{
  "selectionLockHash": "35b843547c2c86f4",
  "lock": {
    "specHash": "808296d1236d8e28",
    "primaryHorizonHours": 48,
    "selected": null,
    "bestEffort": "volexp_breakout",
    "usedForArms": "volexp_breakout",
    "trainValDigest": "751a176b59e930d9",
    "benchmarkDigest": "face130b4112818d",
    "selectionRows": [
      {
        "id": "breakout48_trend",
        "family": "A",
        "trainN": 807,
        "trainRawBps": 64.271,
        "trainGrossBps": 55.922,
        "trainNetBps": 45.911,
        "valN": 265,
        "valRawBps": -1.567,
        "valGrossBps": -9.877,
        "valNetBps": -19.877,
        "maxSymbolProfitShare": 0.1804,
        "qualifies": false
      },
      {
        "id": "persistence3",
        "family": "B",
        "trainN": 1023,
        "trainRawBps": 62.287,
        "trainGrossBps": 53.64,
        "trainNetBps": 43.633,
        "valN": 358,
        "valRawBps": -67.296,
        "valGrossBps": -75.851,
        "valNetBps": -85.85,
        "maxSymbolProfitShare": 0.1919,
        "qualifies": false
      },
      {
        "id": "momentum24",
        "family": "C",
        "trainN": 611,
        "trainRawBps": 85.906,
        "trainGrossBps": 77.326,
        "trainNetBps": 67.318,
        "valN": 209,
        "valRawBps": -58.796,
        "valGrossBps": -67.632,
        "valNetBps": -77.629,
        "maxSymbolProfitShare": 0.2106,
        "qualifies": false
      },
      {
        "id": "volexp_breakout",
        "family": "D",
        "trainN": 332,
        "trainRawBps": 120.588,
        "trainGrossBps": 111.631,
        "trainNetBps": 101.623,
        "valN": 107,
        "valRawBps": -25.821,
        "valGrossBps": -34.232,
        "valNetBps": -44.222,
        "maxSymbolProfitShare": 0.2264,
        "qualifies": false
      },
      {
        "id": "compression_breakout",
        "family": "E",
        "trainN": 971,
        "trainRawBps": 27.616,
        "trainGrossBps": 18.97,
        "trainNetBps": 8.957,
        "valN": 328,
        "valRawBps": -11.456,
        "valGrossBps": -20.063,
        "valNetBps": -30.073,
        "maxSymbolProfitShare": 0.1806,
        "qualifies": false
      },
      {
        "id": "mtf_4h_24h",
        "family": "F",
        "trainN": 1110,
        "trainRawBps": 46.547,
        "trainGrossBps": 38.059,
        "trainNetBps": 28.051,
        "valN": 369,
        "valRawBps": -30.817,
        "valGrossBps": -39.349,
        "valNetBps": -49.347,
        "maxSymbolProfitShare": 0.1738,
        "qualifies": false
      },
      {
        "id": "mtf_breakout_daily",
        "family": "F",
        "trainN": 964,
        "trainRawBps": 24.326,
        "trainGrossBps": 15.857,
        "trainNetBps": 5.85,
        "valN": 321,
        "valRawBps": -2.912,
        "valGrossBps": -11.394,
        "valNetBps": -21.387,
        "maxSymbolProfitShare": 0.171,
        "qualifies": false
      },
      {
        "id": "regime_gated_breakout",
        "family": "G",
        "trainN": 518,
        "trainRawBps": 95.526,
        "trainGrossBps": 86.923,
        "trainNetBps": 76.914,
        "valN": 168,
        "valRawBps": -87.491,
        "valGrossBps": -96.303,
        "valNetBps": -106.296,
        "maxSymbolProfitShare": 0.2397,
        "qualifies": false
      }
    ]
  }
}
```

---

## 19. Arm Matrix and the Raw / Gross / Net Decomposition

Seven arms were pre-registered. Each is one (entry, management) combination measured over the same candidates on the same data:

| Arm | Kind | Entry | Management | Horizon |
|---|---|---|---|---|
| `BASELINE_DONCHIAN_PROD` | benchmark | `bench_donchian_prod` | `MGMT_CONTROL` | management-determined |
| `DONCHIAN_H48` | benchmark | `bench_donchian_prod` | `FIXED_HORIZON` | 48h |
| `NEW_ALPHA` | alpha | `alpha_selected` | `FIXED_HORIZON` | 48h (primary) |
| `NEW_ALPHA_QUALITY` | alpha | `alpha_quality_layer` | `FIXED_HORIZON` | 48h (primary) |
| `NEW_ALPHA_PHASE7` | alpha | `alpha_phase7_agreement` | `FIXED_HORIZON` | 48h (primary) |
| `NEW_ALPHA_PHASE8` | alpha | `alpha_selected` | `MGMT_ADAPTIVE_HOLD` | management-determined |
| `NEW_ALPHA_QUALITY_PHASE8` | alpha | `alpha_quality_layer` | `MGMT_ADAPTIVE_HOLD` | management-determined |

**TEST-fold results for every arm** (the raw/gross/net decomposition makes the cost story unambiguous):

| Arm | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | avg hold (h) | MFE cost ratio | MFE capture |
|---|---|---|---|---|---|---|---|---|---|---|
| `BASELINE_DONCHIAN_PROD` | 177 | -11.92 | -19.06 | -29.07 | -0.0581 | 23.7% | 0.20 | 2.8 | 1.56 | 0.01 |
| `DONCHIAN_H48` | 87 | -17.19 | -24.74 | -34.74 | -0.0695 | 48.3% | 0.82 | 47.5 | 23.64 | -9.46 |
| `NEW_ALPHA` | 92 | +40.66 | +32.00 | +22.00 | 0.0440 | 43.5% | 1.12 | 48.0 | 23.02 | -5.94 |
| `NEW_ALPHA_PHASE7` | 61 | +40.65 | +32.28 | +22.28 | 0.0446 | 45.9% | 1.11 | 48.0 | 26.57 | -5.04 |
| `NEW_ALPHA_PHASE8` | 163 | +6.77 | -1.64 | -11.65 | -0.0233 | 23.9% | 0.72 | 4.8 | 3.82 | 0.04 |
| `NEW_ALPHA_QUALITY` | 4 | +253.69 | +243.54 | +233.55 | 0.4671 | 75.0% | 6.48 | 48.0 | 20.96 | -14.75 |
| `NEW_ALPHA_QUALITY_PHASE8` | 4 | -0.86 | -11.15 | -21.15 | -0.0423 | 50.0% | 0.21 | 4.0 | 0.96 | 0.00 |

**Same arms, all folds pooled** (TRAIN + VALIDATION + TEST, for context only — the TEST column above is the out-of-sample evidence):

| Arm | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate | profit factor | target hit | stop hit |
|---|---|---|---|---|---|---|---|---|---|
| `BASELINE_DONCHIAN_PROD` | 857 | +1.48 | -5.96 | -15.97 | -0.0319 | 26.7% | 0.57 | 0.8% | 99.2% |
| `DONCHIAN_H48` | 417 | +97.10 | +89.23 | +79.22 | 0.1584 | 52.3% | 1.45 | 19.2% | 23.0% |
| `NEW_ALPHA` | 531 | +77.24 | +68.44 | +58.44 | 0.1169 | 47.3% | 1.34 | 18.6% | 24.9% |
| `NEW_ALPHA_PHASE7` | 343 | +117.56 | +109.00 | +98.99 | 0.1980 | 49.9% | 1.59 | 24.2% | 25.1% |
| `NEW_ALPHA_PHASE8` | 1010 | +19.51 | +11.11 | +1.10 | 0.0022 | 29.7% | 1.03 | 3.1% | 96.9% |
| `NEW_ALPHA_QUALITY` | 5 | +290.72 | +280.45 | +270.45 | 0.5409 | 80.0% | 8.93 | 20.0% | 0.0% |
| `NEW_ALPHA_QUALITY_PHASE8` | 5 | +10.20 | -0.10 | -10.11 | -0.0202 | 60.0% | 0.53 | 0.0% | 100.0% |

**What the decomposition shows.** Across every arm the raw edge is larger than the gross edge and the gross edge is larger than the net edge — the ordering is mechanically guaranteed and is the whole point of the table: the difference between columns *is* the market's friction. Where an arm's raw edge is small (a few tens of bps), the frictions consume all of it. This is the same conclusion Phase 9 reached for the production system, now measured on a completely different signal set.

**Benchmark comparison.** The frozen production Donchian, re-expressed at hourly resolution with its production daily decision cadence, is included in every table as `BASELINE_DONCHIAN_PROD` and `DONCHIAN_H48` so that the new signals are judged against the incumbent, not against zero.

---

## 20. The Single Frozen TEST Evaluation

**This is the only out-of-sample evidence in the report, and it was read exactly once** — after the selection lock hash was computed and frozen. Every number in this section comes from that single evaluation.

**TEST — net bps per trade** (fixed-horizon, after all costs):

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | -23.84 | -14.59 | -25.60 | -44.22 | -6.02 | -20.39 | -25.05 | -23.26 | -52.93 |
| 8h | -15.71 | -21.55 | -19.99 | -16.18 | -8.27 | -15.86 | -26.06 | -21.32 | -40.50 |
| 12h | -20.32 | -22.88 | -27.97 | -50.97 | -17.07 | -16.65 | -21.21 | -52.66 | -13.37 |
| 24h | -14.87 | -18.78 | -9.63 | -3.25 | -26.50 | -15.18 | -16.50 | +4.97 | -10.12 |
| 48h | -43.60 | -12.07 | -8.78 | +22.00 | -19.11 | -21.24 | -49.71 | -26.35 | -25.67 |
| 72h | -47.60 | +12.62 | +10.78 | +4.80 | +6.34 | +3.45 | -25.57 | -5.74 | -37.41 |

**TEST — raw bps per trade** (pure directional information, pre-cost):

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | -5.87 | +3.21 | -8.16 | -25.51 | +12.23 | -2.33 | -6.91 | -5.79 | -35.78 |
| 8h | +2.37 | -3.62 | -2.48 | +2.58 | +10.07 | +2.31 | -7.85 | -3.85 | -23.11 |
| 12h | -2.24 | -4.91 | -10.31 | -32.18 | +1.23 | +1.49 | -2.92 | -35.14 | +4.05 |
| 24h | +3.27 | -0.64 | +8.23 | +15.54 | -8.17 | +3.06 | +1.87 | +22.75 | +7.31 |
| 48h | -25.34 | +6.15 | +9.04 | +40.66 | -0.73 | -2.92 | -31.34 | -8.64 | -8.15 |
| 72h | -29.38 | +30.85 | +28.64 | +23.38 | +24.82 | +21.78 | -7.20 | +12.03 | -19.63 |

**TEST — sample size (resolved trades):**

| Horizon | `breakout48_trend` | `persistence3` | `momentum24` | `volexp_breakout` | `compression_breakout` | `mtf_4h_24h` | `mtf_breakout_daily` | `regime_gated_breakout` | `bench_donchian` |
|---|---|---|---|---|---|---|---|---|---|
| 4h | 590 | 885 | 319 | 142 | 693 | 1205 | 806 | 191 | 176 |
| 8h | 470 | 664 | 237 | 120 | 600 | 910 | 682 | 160 | 152 |
| 12h | 424 | 564 | 210 | 113 | 543 | 756 | 604 | 156 | 140 |
| 24h | 346 | 411 | 173 | 103 | 437 | 512 | 459 | 132 | 106 |
| 48h | 267 | 301 | 141 | 92 | 321 | 364 | 321 | 120 | 88 |
| 72h | 215 | 240 | 126 | 85 | 258 | 270 | 241 | 105 | 79 |

**Primary horizon (48h) TEST detail** — the numbers the gate set consumes for the candidate:

| Signal | n | raw | gross | net | mean R | win rate | profit factor | gross PF | MFE | MAE | MFE cost ratio |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `breakout48_trend` | 267 | -25.34 | -33.60 | -43.60 | -0.0872 | 43.4% | 0.80 | 0.84 | 363.10 | -358.52 | 20.22 |
| `persistence3` | 301 | +6.15 | -2.07 | -12.07 | -0.0241 | 45.2% | 0.93 | 0.99 | 359.40 | -327.50 | 20.09 |
| `momentum24` | 141 | +9.04 | +1.22 | -8.78 | -0.0176 | 41.8% | 0.95 | 1.01 | 367.73 | -350.35 | 20.83 |
| `volexp_breakout` | 92 | +40.66 | +32.00 | +22.00 | 0.0440 | 43.5% | 1.12 | 1.17 | 440.62 | -359.11 | 23.02 |
| `compression_breakout` | 321 | -0.73 | -9.11 | -19.11 | -0.0382 | 44.2% | 0.89 | 0.95 | 339.62 | -341.81 | 18.83 |
| `mtf_4h_24h` | 364 | -2.92 | -11.24 | -21.24 | -0.0425 | 45.3% | 0.88 | 0.94 | 356.44 | -321.03 | 19.91 |
| `mtf_breakout_daily` | 321 | -31.34 | -39.71 | -49.71 | -0.0994 | 48.0% | 0.74 | 0.79 | 320.10 | -338.71 | 18.34 |
| `regime_gated_breakout` | 120 | -8.64 | -16.35 | -26.35 | -0.0527 | 37.5% | 0.87 | 0.92 | 379.27 | -373.25 | 21.58 |
| `bench_donchian` | 88 | -8.15 | -15.67 | -25.67 | -0.0513 | 48.9% | 0.87 | 0.92 | 423.00 | -352.82 | 24.23 |

**TEST at the primary horizon: 3 of 8 signals have a positive raw edge and 1 have a positive net edge.**

This is the crux of the phase. A positive *raw* number means the market moved in the signal's direction more often than not after the signal fired; a positive *net* number means that move was large enough to pay the round trip. The gap between the two columns is the difference between **information** and **profit**.

---

## 21. The "New Alpha" Deliverable

Per the protocol, the deliverable of this phase is **the single best pre-registered candidate, described precisely enough to be replicated or falsified** — together with an honest statement of whether it passed.

| Element | Value |
| --- | --- |
| Signal | `volexp_breakout` — Volatility expansion plus 48h breakout (family D) |
| Definition | breakout48 direction AND volExpansion >= 1.2 |
| Entry side | both (long and short, exact mirror definitions) |
| Entry timing | decision-bar close; a next-bar-open variant is also measured (§23) |
| Holding period | 48h fixed horizon (management variants also measured) |
| Exit | fixed-horizon close; no stop, no target, no trailing in the primary measurement |
| Optional decision layer | quality score >= 0.55 **and** cost coverage >= 0.20 **and** no rejection rule fired |
| Selection status | did **not** qualify on TRAIN + VALIDATION (best-effort fallback) |
| TRAIN net (primary horizon) | +101.62 bps on 332 trades |
| VALIDATION net (primary horizon) | -44.22 bps on 107 trades |
| TEST net, pure signal | +22.00 bps on 92 trades |
| TEST raw, pure signal | +40.66 bps |

**Why this candidate is the one reported.** It is the fastest-qualifying candidate under a rule fixed in advance (highest TRAIN net edge among the eight signals), used only because no signal satisfied the stricter VALIDATION requirement. Reporting it is required for completeness, but the *label* matters:

The candidate did **not** satisfy the pre-registered selection criteria on TRAIN + VALIDATION. It is a **fallback**, and its TEST numbers are *not* a validated result: a fallback chosen for having the best training-window performance is exactly the object that selection protocols exist to filter out. Its TEST numbers are printed so the reader can see them, not because they support a claim.

**Decision-layer variant (secondary).** The same candidate with the pre-registered quality layer retains very few trades, for the structural reason documented in §15. Its TEST numbers appear in §19 (`NEW_ALPHA_QUALITY`) and its gate table in §22. That sample is far too small for inference, and the report says so rather than quoting an impressive-looking mean from a handful of trades.

**Deployment status: NOT DEPLOYED.** Nothing in this phase touches production. The production configuration, the frozen strategies, the management policy and the ledger are byte-identical before and after the run (verified by hash, §2). Any future use of this measurement requires a **new** pre-registration and a **new** out-of-sample window.

---

## 22. Pre-Registered Gate Evaluation

The gate set was fixed in the spec before measurement. It is applied to the candidate (pure signal) and, independently, to the quality-layer variant — the spec names two alpha arms but does not say which one the gates target, so both tables are shown in full rather than choosing silently (§3).

```json
{
  "minResolvedTrain": 300,
  "minResolvedValidation": 150,
  "minResolvedTest": 150,
  "minResolvedPerMarket": 60,
  "minResolvedPerSymbol": 15,
  "requireRawEdgePositive": true,
  "minGrossR": 0,
  "minNetRValidation": 0,
  "minNetRTest": 0,
  "minMoveCostRatio": 3,
  "minPositiveSubFolds": 3,
  "maxSymbolProfitShare": 0.5,
  "maxPeriodProfitShare": 0.5,
  "requireCostStressPositive": true,
  "requireNextBarEntryPositive": true
}
```

**Candidate arm: alpha_selected (pure signal) — 9 of 18 gates FAILED**

| Gate | Value | Threshold / expectation | Pass | Note |
|---|---|---|---|---|
| `sample_train` | 332.00 | 300 | PASS |  |
| `sample_validation` | 107.00 | 150 | **FAIL** |  |
| `sample_test` | 92.00 | 150 | **FAIL** |  |
| `market_breadth` | india, us, crypto | markets with >=10% share need n>=60 and net>0 | **FAIL** |  |
| `symbol_sample` | BTC-USD, DOGE-USD, ETH-USD, SOL-USD, XRP-USD | >=15 per >=10% symbol | PASS |  |
| `raw_edge_validation` | -25.82 | > 0 | **FAIL** | pre-cost directional information |
| `raw_edge_test` | 40.66 | > 0 | PASS |  |
| `gross_edge_validation` | -34.23 | > 0 | **FAIL** | survives spread + market impact |
| `gross_edge_test` | 32.00 | > 0 | PASS |  |
| `min_gross_R_test` | 0.04 | >= 0 | PASS |  |
| `net_edge_validation` | -44.22 | > 0 | **FAIL** | after fees, spread and impact |
| `net_edge_test` | 22.00 | > 0 | PASS |  |
| `move_cost_ratio` | 27.44 | >= 3 | PASS | favourable excursion / round-trip cost |
| `sub_fold_stability` | positive=2.00 of=4.00 | >= 3 of 4 positive | **FAIL** |  |
| `symbol_concentration` | 0.22 | <= 0.5 | PASS | largest single-symbol share of gross profit |
| `period_concentration` | 0.26 | <= 0.5 | PASS | largest single-period share of gross profit |
| `cost_stress` | -18.24 | > 0 | **FAIL** | fees+slippage x1.25 |
| `next_bar_entry` | -27.06 | > 0 | **FAIL** | one-bar delayed entry (implementation delay) |

Failed gates: `sample_validation`, `sample_test`, `market_breadth`, `raw_edge_validation`, `gross_edge_validation`, `net_edge_validation`, `sub_fold_stability`, `cost_stress`, `next_bar_entry`.

**Candidate arm: alpha_quality_layer — 7 of 18 gates FAILED**

| Gate | Value | Threshold / expectation | Pass | Note |
|---|---|---|---|---|
| `sample_train` | 0.00 | 300 | **FAIL** |  |
| `sample_validation` | 1.00 | 150 | **FAIL** |  |
| `sample_test` | 4.00 | 150 | **FAIL** |  |
| `market_breadth` | crypto | markets with >=10% share need n>=60 and net>0 | **FAIL** |  |
| `symbol_sample` | BTC-USD, DOGE-USD, ETH-USD, XRP-USD | >=15 per >=10% symbol | **FAIL** |  |
| `raw_edge_validation` | 438.83 | > 0 | PASS | pre-cost directional information |
| `raw_edge_test` | 253.69 | > 0 | PASS |  |
| `gross_edge_validation` | 428.08 | > 0 | PASS | survives spread + market impact |
| `gross_edge_test` | 243.54 | > 0 | PASS |  |
| `min_gross_R_test` | 0.47 | >= 0 | PASS |  |
| `net_edge_validation` | 418.08 | > 0 | PASS | after fees, spread and impact |
| `net_edge_test` | 233.55 | > 0 | PASS |  |
| `move_cost_ratio` | 21.71 | >= 3 | PASS | favourable excursion / round-trip cost |
| `sub_fold_stability` | positive=3.00 of=3.00 | >= 3 of 4 positive | PASS |  |
| `symbol_concentration` | 0.81 | <= 0.5 | **FAIL** | largest single-symbol share of gross profit |
| `period_concentration` | 0.53 | <= 0.5 | **FAIL** | largest single-period share of gross profit |
| `cost_stress` | 265.39 | > 0 | PASS | fees+slippage x1.25 |
| `next_bar_entry` | 287.58 | > 0 | PASS | one-bar delayed entry (implementation delay) |

Failed gates: `sample_train`, `sample_validation`, `sample_test`, `market_breadth`, `symbol_sample`, `symbol_concentration`, `period_concentration`.

**Interpretation.** The two tables fail for *different* reasons, and both reasons are informative:

- The **pure-signal arm** fails on the *economic* gates: validation raw/gross/net edge is negative, the cost-stress and delayed-entry robustness checks are negative, and the TEST sub-fold stability requirement is not met. Its TEST sample (n = 92) is also below the pre-registered minimum of 150. These are the gates that matter for the phase question, and they fail on economic content, not on a technicality.
- The **quality-layer arm** fails on *sample-size and concentration* gates because the layer keeps only n/a trades in total — a consequence of `REJ_OVEREXTENDED` (§15), which is a property of the protocol rather than a market fact. Its sample-size failures must **not** be read as evidence about the market.

Neither arm passes. Under the pre-registered decision rule the verdict is therefore **not A** (grade A requires a selected candidate that passes every gate).

---

## 23. Concentration, Sub-Fold Stability and Cost/Entry Robustness

Three robustness properties decide whether a positive average is *real* or a one-off. All three are gate inputs and are reported for both arms.

| Robustness measure | alpha_selected | alpha_quality_layer | Requirement |
|---|---|---|---|
| Max single-symbol share of gross profit | 22.0% | 80.7% | <= 50% |
| Max single-period (sub-fold) share of gross profit | 25.8% | 53.3% | <= 50% |
| Mean favourable-excursion / cost ratio | 27.44 | 21.71 | >= 3.00 |

**Cost stress (fees + slippage x1.25 on VALIDATION + TEST pooled).** An edge that disappears when costs rise 25% was never an edge — it was a measurement of the cost model:

| Arm | Net (bps) under x1 cost | Net (bps) under x1.25 cost | Still positive? |
|---|---|---|---|
| alpha_selected | +58.44 | n/a | **no** |
| alpha_quality_layer | +270.45 | +265.39 | yes |

**Delayed-entry robustness (enter at the NEXT bar's open instead of the decision bar's close).** This is the single most important execution check: it removes any advantage that comes from acting on information at a price that has already moved:

| Arm | Net at close entry (bps) | Net at next-bar-open entry (bps) |
|---|---|---|
| alpha_selected | +58.44 | n/a |
| alpha_quality_layer | +270.45 | +287.58 |

**TEST sub-fold stability.** The TEST fold is split into 4 equal chronological parts. The gate requires at least 3 of them to end net-positive; **2 of 4 did**:

| TEST sub-fold | n | raw (bps) | gross (bps) | net (bps) | mean R | win rate |
|---|---|---|---|---|---|---|
| test|0 | 23 | -156.13 | -165.24 | -175.26 | -0.3505 | 26.1% |
| test|1 | 29 | +90.79 | +82.75 | +72.74 | 0.1455 | 55.2% |
| test|2 | 16 | -112.92 | -122.51 | -132.49 | -0.2650 | 43.8% |
| test|3 | 24 | +271.05 | +262.72 | +252.70 | 0.5054 | 45.8% |

A positive full-fold average built from one good quarter and three poor ones is a one-period artefact; this table is why the gate exists. Sub-fold stability is also **necessary but not sufficient**: a signal can be stable and still lose money, and several are.

---

## 24. Failure Analysis, Threats to Validity and Limitations

This section exists so that a future reader does not have to re-derive why the phase ended where it did. Findings are ordered by how much explanatory weight they carry.

### 24.1 The dominant finding: TRAIN-positive / VALIDATION-negative reversal

At the primary horizon, 8 of 8 signals were raw-positive on TRAIN while only 0 were raw-positive out-of-sample on VALIDATION. The naive signal-free momentum control (§12) shows the *same* shape — +18.34 bps net on TRAIN, -77.55 bps on VALIDATION.

The most parsimonious explanation is a **market-regime shift inside the sample window** (a strong trending period followed by a choppy/mean-reverting one), not a property of the signals. The 730-day window is a single realisation of history; momentum-family signals are known to have multi-month regime dependence, and no amount of horizon selection removes that exposure within one window.

### 24.2 The cost structure is a real, quantified barrier

Measured round-trip drag is 20.41 bps on crypto and 15.22 bps on US equities. A signal must therefore clear that bar in *mean per-trade* terms merely to break even — while its raw edge out-of-sample at the primary horizon was +40.66 bps on the best-effort candidate and negative on VALIDATION. Costs did not need to be the culprit here: **the raw edge itself did not replicate.**

### 24.3 A protocol design incompatibility (reportable defect)

`REJ_OVEREXTENDED` rejected 1415 of 1423 candidates at the quality layer's decision point (99.4%). As explained in §15, the rule as worded is structurally incompatible with breakout-family signals, so the quality-layer arm is not a fair test of the decision layer's value. This is flagged as a **defect in this phase's pre-registration**, to be corrected in a *future* pre-registration — never retro-fitted here.

### 24.4 Threats to validity

| Threat | Assessment |
| --- | --- |
| **Single TEST window** | One 20% chronological block per symbol. A single window cannot distinguish "no edge" from "no edge *in this window*". |
| **Regime dependence** | The TRAIN/VALIDATION reversal (§24.1) is the largest single threat to *any* positive number in this report, including the best-effort candidate's TEST result. |
| **Multiple comparisons** | 8 signals x 6 horizons x 7 arms were examined. Even under the null, some cell looks good. The report never selects on TEST and never re-tunes, but the *reader* should still expect best-of-many artefacts — which is exactly why selection used TRAIN + VALIDATION only. |
| **Sample size** | Several cells are thin (benchmark VALIDATION n = 70; quality-layer arm n = 5). Thin cells are labelled rather than averaged away. |
| **Universe** | 14 symbols across crypto, india, us over 1075 calendar days. Indian and US names contribute far fewer hourly bars than the crypto names and only a handful of signals; cross-market generalisation is limited. |
| **Survivorship / selection of the universe** | The symbols were chosen in earlier phases and are all liquid, well-known names; results would likely be *worse*, not better, on an unbiased universe. |
| **Overlapping-market hours** | Indian and US sessions do not overlap fully; an hourly bar is not equally informative across markets, which adds cross-sectional noise to pooled numbers. |
| **Execution realism** | Fills assume taker-only fills with a square-root impact model and constant half-spread. Real fills, queue position and funding costs are not modelled. |
| **Reporting clarifications** | Disclosed in full in §3: gate-target ambiguity resolved by showing both tables, and bookkeeping instrumentation added after the first TEST read. No threshold, horizon, arm or measurement was changed. |

### 24.5 What was *not* found

It is worth stating the negative results precisely, because they are the phase's actual deliverable:

- No new entry signal produced a **replicated** positive raw edge on TRAIN and VALIDATION.
- No signal produced a **net-of-cost** edge on VALIDATION at any of the six pre-registered horizons (see §13).
- No feature bucket (§16) shows a stable, economically meaningful out-of-sample gradient that would justify promoting that feature.
- The frozen production benchmark did not demonstrate a robust edge either: -25.67 bps net on TEST at the primary horizon — consistent with Phase 9.

### 24.6 Limitations of the conclusion

A negative result here means: **under this universe, this 730-day window, this cost model and this pre-registered signal set, no cost-surviving edge was found.** It does not prove that no entry signal can ever work, and it is not evidence about different horizons, different instruments, or signals that require data this engine does not have (order flow, funding rates, cross-asset context). It *is* strong evidence that adding more variations of trend/momentum/breakout logic will not fix the system's economics.

---

## 25. Verdict and Decision

> **C — STOP / REDESIGN**

**Reason (generated by the pre-registered decision rule):** No candidate produced a replicated positive raw (pre-cost) edge out-of-sample; there is nothing for a cost-aware layer to exploit.

### The decision rule, and what it returned

| Grade | Meaning | Condition | Returned? |
| --- | --- | --- | --- |
| **A** | Try in shadow / paper | A selected candidate passed **every** pre-registered gate, including TEST | no |
| **B** | Do not trade yet | A real, replicated **pre-cost** information edge exists out-of-sample, but the economics do not survive | no |
| **C** | Stop / redesign | No replicated positive raw edge out-of-sample; there is nothing for a cost-aware layer to exploit | **YES** |

### What the evidence says, plainly

- **Best-effort candidate** (`volexp_breakout`, 48h): raw edge -25.82 bps on VALIDATION (n = 107) and +40.66 bps on TEST (n = 92). The validation half of the replication test failed, which is decisive: a signal that did not work on the window immediately preceding TEST is not a hypothesis that TEST can rescue.
- **No candidate qualified** under the pre-registered selection protocol, so no arm in this report is a validated alpha.
- **The production benchmark** did not produce an edge either (-25.67 bps net on TEST at the primary horizon), independently reconfirming the Phase 9 conclusion on a different measurement apparatus.

### What would change our mind (pre-committed)

So that a future phase cannot invent its own success criteria after the fact, here is what a *genuine* positive result would have to look like — and it is deliberately stricter than what was observed:

1. A signal whose raw edge is positive on **TRAIN, VALIDATION and TEST** (not just TRAIN), with at least the pre-registered minimum sample in each fold.
2. A signal-free control (§12) that does **not** exhibit the same sign pattern, proving the result is not unconditional momentum exposure.
3. A **sub-fold-stable** positive net edge, i.e. at least 3 of 4 TEST sub-folds positive.
4. Survival of the 1.25x cost-stress and the next-bar-open entry check (§23).
5. No single symbol or single period supplying more than the concentration cap of gross profit.

Nothing observed in this phase meets even items 1 and 2, which is why the verdict is C rather than B.

### Required next step

**Do not trade any signal from this experiment.** No production file was modified, and none may be modified on the strength of these results. The useful output of this phase is the negative result plus the operational lessons recorded above (regime dependence dominates signal variety; a breakout filter must be scale-free; the round-trip cost bar is large relative to achievable per-trade edges at these horizons).

### Artefacts and reproduction

| Artefact | Path |
| --- | --- |
| This report (generated, deterministic) | `ALPHA_RESEARCH_REPORT.md` |
| Frozen summary of every number | `data/calibration/alpha-summary.v2.json` |
| Per-trade records (pure signal + quality layer) | `data/calibration/alpha-trades.v2.jsonl` |
| Pre-registered protocol | `config/alpha-experiment-spec.v1.json` |
| Acceptance tests (22: causality, cost, signals, rules, metrics, gates, verdict, write isolation) | `tests/alpha.test.mjs` |
| Runner | `scripts/v2/alpha-run.mjs` |
| Report generator | `scripts/v2/alpha-report.mjs` |

```bash
# re-run the experiment (writes summary + trades; re-hashes production inputs and aborts if any changed)
node scripts/v2/alpha-run.mjs

# regenerate this report from the frozen summary (byte-identical for the same summary)
node scripts/v2/alpha-report.mjs

# run the alpha acceptance tests
node --test tests/alpha.test.mjs

# run the whole repository suite
node --test tests/*.test.mjs
```

**Reproducibility anchors:** spec `808296d1236d8e28`, selection lock `35b843547c2c86f4`, data through 2026-09-13, 14 symbols, 132975 hourly bars. Any future run that produces a different selection lock hash from the same data and spec indicates the code changed.

---

*Generated deterministically from `alpha-summary.v2.json` — 1380 lines. No number in this report is computed at report time.*
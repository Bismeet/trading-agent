# Phase 10: Regime-Conditional Opportunity Map + Offline Portfolio Allocator

**Deterministic Paper-Trading Engine — FabInvests**
**Phase:** 10 — Regime-conditional opportunity map + offline portfolio allocator
**Spec:** `config/phase10-spec.v1.json` — PRE-REGISTERED — IMMUTABLE
**Spec hash:** `782a04f6e8033ab6`
**Selection lock hash:** `16431dfe5fdaba1c`
**TEST evaluation:** YES — read exactly once, after the lock
**Final verdict:** **C — NO ROBUST EDGE**

> NO ROBUST CONDITIONAL ALPHA FOUND — no cell or allocation produced a replicated positive out-of-sample edge; the conditional map shows where the edge is NOT.

---

## 1. Objective and Scope

This phase tests one hypothesis: **existing trend/momentum signals have conditional, not unconditional, edge**.

- No random indicators, no LLM, no external AI APIs, no optimisation on historical P&L.
- Production configuration frozen and hash-verified; the runner writes only its own artefacts.
- Six pre-registered production-family signals only. No new indicators in the primary experiment.
- Regime labels use only causal, decision-time information; never fitted on future returns.
- Horizons: only 4h, 12h, 24h, 48h, 72h, 168h — no arbitrary search.
- Selection uses TRAIN + VALIDATION only. TEST is read exactly once, after the lock.
- Purge + embargo use the maximum forward horizon (168h).
- Allocator parameters were fixed a priori; nothing was optimised on TEST.

---

## 2. Pre-Registration, Immutability and the Selection Lock

```json
{
  "phase": "phase10-regime-portfolio",
  "specHash": "782a04f6e8033ab6",
  "primaryHorizonHours": 24,
  "horizons": [
    4,
    12,
    24,
    48,
    72,
    168
  ],
  "gates": {
    "evaluatedOn": "TRAIN + VALIDATION only, except the two TEST gates",
    "minNTrain": 30,
    "minNValidation": 15,
    "minNTest": 15,
    "requireTrainNetRPositive": true,
    "requireValidationNetRPositive": true,
    "requireTrainRawPositive": true,
    "requireTrainGrossPositive": true,
    "requireValidationRawPositive": true,
    "requireValidationGrossPositive": true,
    "requireCostStressPositive": true,
    "costStressMultiplier": 1.25,
    "requireDelayedEntryPositive": true,
    "maxSymbolProfitShare": 0.5,
    "maxPeriodProfitShare": 0.5,
    "subFolds": 4,
    "minPositiveTestSubFolds": 3,
    "requireTestNetRPositive": true,
    "marketShareThreshold": 0.1,
    "marketBreadthRule": "Every market carrying at least 10% of the cell's TRAIN+VALIDATION sample must have positive mean net R."
  },
  "cellModel": {
    "axes": [
      "signalId",
      "regime",
      "side",
      "horizonHours"
    ],
    "outcomeFieldsPerOccurrence": [
      "raw_return",
      "gross_return",
      "net_return",
      "MAE",
      "MFE",
      "holding_time",
      "cost",
      "expected_move",
      "move_to_cost_ratio",
      "realized_R"
    ],
    "cellFields": [
      "n",
      "mean_net_R",
      "median_net_R",
      "win_rate",
      "profit_factor",
      "MAE",
      "MFE",
      "MFE_over_MAE",
      "MFE_over_cost",
      "cost_stress_result",
      "next_bar_entry_result",
      "subfold_results"
    ],
    "shrinkage": {
      "priorStrengthK": 10,
      "profitPrior": 0.5,
      "posteriorMeanR": "E_shrunk = sum(realized_R) / (n + K)   (Bayesian shrinkage toward zero)",
      "posteriorProfitProb": "P(profit) = (wins + K * 0.5) / (n + K)   (Beta-strength prior)"
    },
    "uncertaintyPenaltyR": 0.25,
    "uncertaintyRule": "score = E_shrunk / max(stdFloor, shrunkStd) - uncertaintyPenaltyR / sqrt(n)",
    "volNormalization": {
      "stdShrinkK": 10,
      "stdFloorR": 0.5,
      "shrunkStd": "std_shrunk = (n * std_cell + K0 * std_global) / (n + K0); std_global = std of realized_R over ALL train occurrences"
    },
    "correlationMatrix": {
      "sameSymbol": 0.7,
      "sameMarket": 0.4,
      "differentMarket": 0.1,
      "application": "At selection time each candidate's score is multiplied by (1 - rho_max) where rho_max is the largest correlation against any currently open position and any candidate already admitted at the same decision bar."
    }
  },
  "allocator": {
    "note": "OFFLINE, deterministic opportunity allocator. No randomness, no neural networks, no LLM, no fitting on TEST. Allocation parameters below are fixed a priori.",
    "decisionCadence": "every hourly decision bar",
    "totalRiskUnits": 6,
    "maxConcurrentPerSymbol": 1,
    "maxConcurrentPerMarket": 3,
    "riskUnitUsd": 100,
    "geometry": {
      "alpha_breakout": {
        "baseLev": 12,
        "stopPct": 0.05,
        "targetPct": 0.08
      },
      "tsmom": {
        "baseLev": 12,
        "stopPct": 0.05,
        "targetPct": 0.1
      },
      "donchian": {
        "baseLev": 12,
        "stopPct": 0.05,
        "targetPct": 0.08
      }
    },
    "entryMode": "close",
    "equityStartUsd": 10000,
    "tieBreak": [
      "score DESC",
      "signalId ASC",
      "regime ASC",
      "side ASC",
      "horizonHours ASC"
    ],
    "exit": "A position exits at its cell horizon, at the stop, or at the target — whichever comes first (identical machinery to the measurement layer)."
  },
  "eligibleTV": [
    [],
    [
      {
        "key": "donchian20|VOL_CONTRACTION|short|12h",
        "score": 0.139791
      }
    ],
    [
      {
        "key": "donchian20|VOL_CONTRACTION|long|24h",
        "score": 0.148733
      }
    ],
    [
      {
        "key": "donchian20|VOL_CONTRACTION|long|48h",
        "score": 0.157566
      }
    ],
    [
      {
        "key": "breakout48_trend|STRONG_TREND|long|72h",
        "score": 0.340034
      },
      {
        "key": "donchian20|VOL_CONTRACTION|long|72h",
        "score": 0.227125
      }
    ],
    [
      {
        "key": "breakout48_trend|WEAK_TREND|long|168h",
        "score": 0.204355
      }
    ]
  ],
  "cellsTVDigest": "9406f671572de5e0"
}
```

- **Selection lock hash (SHA-256):** `16431dfe5fdaba1c`
- **Runtime:** 20.6 s

---

## 3. Frozen Baseline and Production Isolation

| Production input | SHA-256 start (16) | SHA-256 end (16) | Changed? |
|---|---|---|---|
| `config.json` | `05c52fabe110639f` | `05c52fabe110639f` | no |
| `config/alpha-experiment-spec.v1.json` | `808296d1236d8e28` | `808296d1236d8e28` | no |
| `config/final-experiment-spec.v1.json` | `4274e685b2e9db92` | `4274e685b2e9db92` | no |
| `config/final.control.json` | `30f5d8473affcfc5` | `30f5d8473affcfc5` | no |
| `config/management.control.json` | `c18de8f560d16370` | `c18de8f560d16370` | no |

Result: **all unchanged**. Nothing deployed.

---

## 4. Research Universe, Panels and Regime Data

| Symbol | Hourly bars |
|---|---|
| `AAPL` | 5081 |
| `AMZN` | 5081 |
| `BTC-USD` | 17478 |
| `DOGE-USD` | 17476 |
| `ETH-USD` | 17475 |
| `HDFCBANK.NS` | 5047 |
| `INFY.NS` | 5049 |
| `MSFT` | 5081 |
| `NVDA` | 5081 |
| `RELIANCE.NS` | 5049 |
| `SOL-USD` | 17477 |
| `TCS.NS` | 5041 |
| `TSLA` | 5081 |
| `XRP-USD` | 17478 |

| Regime | Share of bars |
|---|---|
| `RANGE` | 22.73% |
| `STRONG_TREND` | 3.68% |
| `VOL_CONTRACTION` | 48.87% |
| `VOL_EXPANSION` | 12.94% |
| `WEAK_TREND` | 11.78% |

---

## 5. Opportunity Model and the Conditional Map

Every signal occurrence is measured at all six horizons with the full opportunity record: raw / gross / net return, MAE, MFE, holding time, cost, expected move, move-to-cost ratio and realised R. Occurrences are grouped into **cells** keyed by (signal, regime, side, horizon): 250 cells in total.

| Horizon | Cells passing TRAIN+VALIDATION gates | Cells passing ALL gates (incl. TEST) |
|---|---|---|
| 4h | 0 | 0 |
| 12h | 1 — `donchian20|VOL_CONTRACTION|short|12h` | 0 |
| 24h | 1 — `donchian20|VOL_CONTRACTION|long|24h` | 0 |
| 48h | 1 — `donchian20|VOL_CONTRACTION|long|48h` | 0 |
| 72h | 2 — `breakout48_trend|STRONG_TREND|long|72h`, `donchian20|VOL_CONTRACTION|long|72h` | 0 |
| 168h | 1 — `breakout48_trend|WEAK_TREND|long|168h` | 0 |

No cell passed every gate, at any horizon. The six TRAIN+VALIDATION-eligible cells are listed above; each fails at least one TEST gate. The full cell map (TRAIN, VALIDATION and TEST economics per cell, Bayesian posterior) is in `phase10-summary.v1.json` under `cells.map` and summarised in §10.

A map whose shortlisted cells then fail TEST is still a successful map — it is the evidence base that lets the verdict say STOP instead of shipping.

---

## 6. Ablation A–F: Where Would the Improvement Come From?

Arms A–E are single-position, non-overlapping trade lists at the primary horizon (24h). Arm F is the offline allocator across all eligible cells and horizons.

| Arm | Trades | TRAIN n / meanR | VAL n / meanR | TEST n / meanR |
|---|---|---|---|---|
| `A_baseline` | 2423 | 1464 / -0.0020 | 467 / -0.0076 | 492 / -0.0194 |
| `B_signal_only` | 3540 | 2193 / -0.0055 | 681 / -0.0427 | 666 / -0.0334 |
| `C_signal_regime` | 3123 | 1931 / +0.0130 | 609 / -0.0333 | 583 / -0.0516 |
| `D_signal_regime_side` | 1990 | 1355 / +0.0447 | 339 / -0.0772 | 296 / +0.0266 |
| `E_cell_filter` | 195 | 163 / +0.1843 | 16 / +0.1135 | 16 / -0.2203 |
| `F_full_allocator` | 500 | 310 / +0.4649 | 80 / +0.1819 | 110 / -0.0354 |

- **A (existing baseline)** is negative on TRAIN, VALIDATION and TEST. No unconditional edge exists.
- **B (signal only) and C (signal + regime)** are both worse than A on TEST. Regime conditioning alone removes trades (B: 3540 to C: 3123) while keeping the losers.
- **D (signal + regime + side)** is the only arm with positive TEST mean net R (+0.0266, n=296). Side-conditioning is where the first genuine improvement appears — exactly what the "never assume long/short symmetry" rule was designed to detect.
- **E (cell filter)** collapses: 195 trades, TEST mean net R −0.2203, profit factor 0.43. Filtering to the best-looking in-sample cells concentrates risk instead of edge.
- **F (full allocator)** reshapes risk enormously (Sharpe 2.20, drawdown 10.8%) while per-trade TEST economics stay negative (−0.0354). Allocation reshapes risk; it cannot conjure edge.

---

## 7. Portfolio Metrics (All Mandated Fields)

| Arm | Trades | Total ret | CAGR | Ann vol | Sharpe | Sortino | Calmar | Max DD |
|---|---|---|---|---|---|---|---|---|
| A_baseline | 2423 | -0.096 | -0.0338 | 0.168 | -0.12 | -0.11 | -0.10 | 0.3488 |
| B_signal_only | 3540 | -0.381 | -0.1501 | 0.240 | -0.56 | -0.59 | -0.26 | 0.5840 |
| C_signal_regime | 3123 | -0.151 | -0.0541 | 0.174 | -0.23 | -0.24 | -0.13 | 0.4251 |
| D_signal_regime_side | 1990 | 0.254 | 0.0798 | 0.131 | 0.65 | 0.66 | 0.32 | 0.2457 |
| E_cell_filter | 195 | 0.170 | 0.0548 | 0.050 | 1.10 | 0.78 | 1.87 | 0.0293 |
| F_full_allocator | 500 | 0.929 | 0.2498 | 0.104 | 2.20 | 2.10 | 2.32 | 0.1077 |

| Arm | PF | Win | Expect | Turn/wk | Cost contrib | Gross→net | Exposure | Time UW |
|---|---|---|---|---|---|---|---|---|
| A_baseline | 1.05 | 49.4% | -0.40 | 15.8 | 2.663 | 1.495 | 0.563 | 0.871 |
| B_signal_only | 1.01 | 46.4% | -1.08 | 23.0 | 17.494 | 9.534 | 0.641 | 0.940 |
| C_signal_regime | 1.05 | 47.1% | -0.48 | 20.3 | 3.067 | 1.674 | 0.628 | 0.924 |
| D_signal_regime_side | 1.16 | 48.3% | 1.27 | 12.9 | 0.875 | 0.485 | 0.464 | 0.901 |
| E_cell_filter | 1.75 | 50.3% | 8.72 | 1.3 | 0.209 | 0.121 | 0.120 | 0.842 |
| F_full_allocator | 1.96 | 52.8% | 18.57 | 3.3 | 0.107 | 0.061 | 0.404 | 0.723 |

| Arm | Mean ρ | Worst month | Worst week | Worst day |
|---|---|---|---|---|
| A_baseline | 0.037 | 2025-04 -1143 | 2026-W31 -705 | 2024-07-31 -541 |
| B_signal_only | 0.055 | 2025-04 -2094 | 2025-W15 -1259 | 2025-04-09 -921 |
| C_signal_regime | 0.046 | 2026-04 -1078 | 2026-W31 -1003 | 2025-04-09 -716 |
| D_signal_regime_side | 0.056 | 2025-02 -1104 | 2025-W02 -671 | 2026-04-17 -378 |
| E_cell_filter | 0.011 | 2025-05 -198 | 2024-W07 -128 | 2024-06-20 -121 |
| F_full_allocator | 0.008 | 2024-12 -1194 | 2024-W51 -1008 | 2024-12-17 -537 |

No arm is close to a deployable risk-adjusted profile on a per-trade basis. Arm F's Sharpe (2.20) is a portfolio-construction artefact of a 500-trade book with capped exposure — its per-trade TEST mean net R is still −0.0354, and the verdict rules require positive TEST net economics, not a Sharpe number.

---

## 8. R Distribution (Average, Median, Tail, 5th, 95th)

| Arm | Avg R/trade | Median R/trade | Tail R | 5th % R | 95th % R |
|---|---|---|---|---|---|
| A_baseline | -0.007 | -0.009 | -1.91 | -1.28 | 1.16 |
| B_signal_only | -0.018 | -0.052 | -1.70 | -1.17 | 1.22 |
| C_signal_regime | -0.008 | -0.042 | -1.63 | -1.14 | 1.19 |
| D_signal_regime_side | 0.021 | -0.024 | -1.54 | -1.11 | 1.28 |
| E_cell_filter | 0.145 | 0.009 | -1.52 | -1.04 | 1.87 |
| F_full_allocator | 0.310 | 0.064 | -2.51 | -1.47 | 2.55 |

The R tails are wide in every arm (5th percentile around −1.1 to −1.5 R, 95th around +1.2 to +2.6 R). Median R is negative or near zero everywhere except arm E (+0.009, on only 195 trades — noise at that sample size). There is no regime, side or horizon slice whose *median* trade survives costs.

---

## 9. Regime, Side and Horizon Rollups

Every cell contributes its TRAIN+VALIDATION sample (mean net R) and its TEST sample (mean net R) to three independent cuts. These are descriptive aggregates, not selection inputs — but they answer questions 2, 3 and 4 directly.

| Regime | TV n | TV mean net R | TEST n | TEST mean net R | TV win |
|---|---|---|---|---|---|
| `RANGE` | 9935 | -0.0205 | 2835 | -0.0326 | 46.0% |
| `STRONG_TREND` | 63667 | +0.1632 | 12986 | -0.0297 | 49.8% |
| `VOL_CONTRACTION` | 105979 | +0.0163 | 17651 | -0.1401 | 46.0% |
| `VOL_EXPANSION` | 63729 | +0.0695 | 9288 | +0.4007 | 46.6% |
| `WEAK_TREND` | 48003 | +0.0166 | 10649 | -0.1111 | 45.7% |

Only VOL_EXPANSION is positive on TEST (+0.4007, n=9288) — and it is also positive on TRAIN+VALIDATION (+0.0695). STRONG_TREND, the regime that dominates the allocator's attention, is +0.1632 on TRAIN+VALIDATION and −0.0297 on TEST. That is the phase's central empirical fact in one line: the regime with the strongest in-sample edge is the one that fails out of sample.

| Side | TV n | TV mean net R | TEST n | TEST mean net R | TV win |
|---|---|---|---|---|---|
| `long` | 179011 | +0.1446 | 27782 | +0.1214 | 48.0% |
| `short` | 112302 | -0.0779 | 25627 | -0.1477 | 45.2% |

The edge is long-only and asymmetric, exactly as the no-symmetry rule requires us to report it: longs are +0.1446 on TRAIN+VALIDATION and +0.1214 on TEST; shorts are −0.0779 and −0.1477. The short side has no edge anywhere, at any horizon, in any regime.

| Horizon | TV n | TV mean net R | TEST n | TEST mean net R | TV win |
|---|---|---|---|---|---|
| `4h` | 49209 | -0.0249 | 9193 | -0.0394 | 41.2% |
| `12h` | 49110 | +0.0008 | 9132 | -0.0416 | 45.6% |
| `24h` | 48966 | +0.0156 | 9019 | +0.0090 | 47.6% |
| `48h` | 48658 | +0.0552 | 8884 | +0.0462 | 48.2% |
| `72h` | 48409 | +0.0676 | 8765 | +0.0386 | 48.1% |
| `168h` | 46961 | +0.2470 | 8416 | -0.0595 | 51.2% |

Horizons 48h (+0.0462) and 72h (+0.0386) hold a small positive TEST mean net R; 168h, the strongest in-sample horizon (+0.2470), collapses to −0.0595 on TEST. Short horizons (4h, 12h) are negative everywhere — costs eat them. No horizon survives with an edge large enough to matter after the gate set is applied.

---

## 10. The Conditional Probability / Expected-Value Map

This is the phase's mandated deliverable: E[R | signal, regime, side, horizon] with the Bayesian posterior (score, postE, pProfit) for every cell, TRAIN+VALIDATION first, TEST alongside. The table below shows the top 20 cells by posterior score. The complete map (250 cells) is in `phase10-summary.v1.json` under `cells.map`.

| Cell (signal | regime | side | h) | TV pass | TEST pass | TRAIN meanR | VAL meanR | TEST meanR | TEST n | Score | E[R] | P(profit) |
|---|---|---|---|---|---|---|---|---|---|
| `breakout48_trend | STRONG_TREND | long | 168h` | no | yes | +1.3655 | +0.2352 | +0.0533 | 86 | +0.362 | +1.3235 | 57.9% |
| `breakout48_trend | STRONG_TREND | long | 72h` | yes | no | +0.7950 | +0.0129 | +0.1392 | 86 | +0.340 | +0.7708 | 63.7% |
| `breakout48_trend | STRONG_TREND | long | 48h` | no | no | +0.6996 | -0.1626 | +0.0142 | 87 | +0.336 | +0.6787 | 63.6% |
| `breakout48_trend | STRONG_TREND | long | 24h` | no | no | +0.3548 | -0.1344 | +0.0706 | 87 | +0.279 | +0.3442 | 57.0% |
| `breakout48_trend | VOL_EXPANSION | long | 168h` | no | no | +1.0742 | -0.9652 | +0.3688 | 78 | +0.270 | +1.0443 | 57.1% |
| `momentum24 | STRONG_TREND | long | 168h` | no | yes | +0.8082 | -0.0636 | +0.0354 | 620 | +0.269 | +0.8049 | 59.0% |
| `volexp_breakout | VOL_EXPANSION | long | 168h` | no | no | +0.9406 | -0.9544 | +0.5540 | 71 | +0.258 | +0.9133 | 56.5% |
| `persistence3 | STRONG_TREND | long | 168h` | no | yes | +0.7581 | -0.1214 | +0.0397 | 686 | +0.255 | +0.7552 | 56.7% |
| `volexp_breakout | VOL_EXPANSION | long | 24h` | no | no | +0.2870 | -0.1151 | +0.2575 | 73 | +0.251 | +0.2787 | 54.9% |
| `persistence3 | STRONG_TREND | long | 72h` | no | yes | +0.4513 | -0.3330 | +0.0214 | 686 | +0.250 | +0.4496 | 59.1% |
| `breakout48_trend | VOL_EXPANSION | long | 24h` | no | no | +0.2971 | -0.1500 | +0.1907 | 80 | +0.247 | +0.2889 | 54.4% |
| `volexp_breakout | VOL_EXPANSION | long | 48h` | no | no | +0.3829 | -0.2418 | +0.5868 | 72 | +0.246 | +0.3718 | 54.3% |
| `persistence3 | STRONG_TREND | long | 48h` | no | no | +0.3820 | -0.3514 | +0.0738 | 688 | +0.244 | +0.3806 | 58.3% |
| `breakout48_trend | VOL_EXPANSION | long | 48h` | no | no | +0.3846 | -0.3362 | +0.4810 | 79 | +0.242 | +0.3739 | 53.9% |
| `momentum24 | STRONG_TREND | long | 72h` | no | yes | +0.4333 | -0.4234 | +0.0994 | 620 | +0.241 | +0.4316 | 59.4% |
| `breakout48_trend | VOL_EXPANSION | long | 72h` | no | no | +0.5006 | -0.5973 | +0.5629 | 79 | +0.234 | +0.4867 | 52.8% |
| `volexp_breakout | VOL_EXPANSION | long | 72h` | no | no | +0.4902 | -0.4993 | +0.6591 | 72 | +0.231 | +0.4760 | 53.3% |
| `momentum24 | STRONG_TREND | long | 48h` | no | no | +0.3519 | -0.3526 | +0.1443 | 622 | +0.230 | +0.3505 | 58.2% |
| `donchian20 | VOL_CONTRACTION | long | 72h` | yes | no | +0.4723 | +0.1354 | -0.2705 | 26 | +0.227 | +0.4520 | 56.2% |
| `persistence3 | VOL_EXPANSION | long | 168h` | no | no | +0.8443 | -0.5359 | +0.7425 | 572 | +0.224 | +0.8415 | 55.4% |

Read the map as a list of rejections, not recommendations. The highest-scoring cell in the experiment — breakout48_trend | STRONG_TREND | long | 168h, score 0.362 — fails the period-concentration gate on TRAIN+VALIDATION and is therefore never tradeable. The only TV-eligible cell in the top 20 (breakout48_trend | STRONG_TREND | long | 72h) fails its TEST gates. The map knows when NOT to trade: everywhere, in this dataset, at these costs.

---

## 11. Robustness Battery (All Eight Checks)

| Condition | Trades | TEST mean net R | Sharpe |
|---|---|---|---|
| costs × 1 | 500 | -0.0354 | 2.20 |
| costs × 1.25 | 500 | -0.0587 | 2.06 |
| costs × 1.5 | 500 | -0.0673 | 2.01 |

Delayed entry (next-bar-open execution): 500 trades, TEST mean net R -0.0116, Sharpe 2.14. Worse fills (×1.5 re-price): TEST mean net R -0.0673.

None of the cost or execution stresses turns a negative into a positive — they only make a negative more negative, which is the expected behaviour of a book with no edge. The 25%-higher-costs question (Q8) and the delayed-execution question (Q9) therefore answer themselves: there is nothing to survive.

**Shuffled-label negative control (salt `phase10-shuffle-v1`).** The entire pipeline re-run on hash-permuted labels within each (fold, horizon) group: 8 eligible cells, 167 allocator trades, TEST mean net R -0.1846 versus real -0.0354. Verdict on the control: **VALID — shuffling destroyed the apparent edge**.

**Deterministic repeatability.** The allocator run twice on identical inputs produces byte-identical trade lists (hash-checked).

**Leakage audit (robustness check #8).** Four independent, falsifiable checks run against the live pipeline objects — not a re-implementation — proving no feature, label or fold boundary ever peeked across a cut. Any failure forces verdict D.

| Check | Pass | Records checked |
|---|---|---|
| `feature_causality` | yes | 48 |
| `test_isolation` | yes | 344722 |
| `label_isolation` | yes | 257 |
| `purge_embargo` | yes | 344722 |

Overall: **PASSED — evaluation VALID**. The pre-lock gate additionally verified that zero TEST outcomes existed before the selection lock was frozen.

---

## 12. The Twelve Mandated Questions — Answered

1. **Is there evidence that existing signals have conditional rather than unconditional edge?** Partially. Unconditional edge is absent (arm A negative everywhere). Conditional structure exists: longs beat shorts by 0.27 R on TEST, VOL_EXPANSION is the only TEST-positive regime, 48h/72h beat 4h/12h — but every shortlisted cell still fails the gate set. The conditioning is real; the edge is not.

2. **Which regimes actually contain edge?** On TEST, only VOL_EXPANSION (+0.4007, n=9288). See §9 for the full table.

3. **Is the edge long-only, short-only, or symmetric?** Long-only. Longs: +0.1446 TV / +0.1214 TEST. Shorts: −0.0779 TV / −0.1477 TEST. No symmetry was assumed and none was found.

4. **Which horizons survive costs?** 48h and 72h hold small positive TEST mean net R (+0.0462, +0.0386). 4h and 12h are negative everywhere; 168h mean-reverts from +0.2470 in-sample to −0.0595 on TEST.

5. **Does regime conditioning improve VALIDATION?** Arm C (signal+regime) VALIDATION mean net R is −0.0333 versus arm B (signal only) −0.0427 — a marginal improvement that does not survive TEST (−0.0516 vs −0.0334). No: it reshuffles, it does not replicate.

6. **Does it survive TEST?** No. Zero of six TV-eligible cells pass the TEST gates; arm F TEST mean net R is −0.0354.

7. **Does portfolio allocation improve risk-adjusted returns?** It improves risk *shape* (Sharpe −0.56→+2.20, drawdown 58%→11%, exposure 0.56→0.40) while per-trade economics stay negative. Allocation is a risk technology, not an edge technology — this experiment isolates the two cleanly.

8. **Does the result survive 25% higher costs?** There is no positive result to survive; ×1.25 costs move arm F TEST mean net R from −0.0354 to −0.0587. The stress behaves exactly as it should.

9. **Does it survive delayed execution?** Same answer: delayed entry moves TEST mean net R to −0.0116 — still negative. Execution is not the binding constraint; edge is.

10. **How much of the improvement comes from fewer trades rather than better trades?** Most of it. The allocator admits 500 of 1,958 opportunities; arm E (195 trades) has the best in-sample per-trade numbers and the worst TEST numbers. Selectivity amplifies whatever the cells contain — here, noise.

11. **Is the apparent edge concentrated in one symbol or period?** The in-sample edge is. The highest-scoring cell in the map fails the period-concentration gate; symbol-concentration failures appear across horizons. Concentration gates are doing exactly the job they were designed for.

12. **Is there enough evidence to deploy?** No. Zero cells pass every gate, the allocator is negative on TEST under every cost and execution stress, and the evaluation itself is valid (leakage audit passed, shuffle control destroyed the edge, baseline frozen, allocator deterministic). The only honest output is the one below.

---

## 13. Final Verdict and Deployment Rule

**C — NO ROBUST EDGE**

> NO ROBUST CONDITIONAL ALPHA FOUND — no cell or allocation produced a replicated positive out-of-sample edge; the conditional map shows where the edge is NOT.

Per the pre-registered deployment rule, grade C produces exactly one output:

> **NO ROBUST CONDITIONAL ALPHA FOUND.**

No production specification is proposed. No tuning pass is authorised ("do not tune until the backtest becomes positive"). No live parameter, learner threshold, survival gate, leverage figure, sizing rule, management rule or ledger entry is touched by this phase. The map is kept as evidence of where the edge is NOT, so the next system improvement can be aimed at opportunity selection with honest priors — or at the harder conclusion that the current signal families have no tradeable conditional edge at these costs.

**Evaluation-validity statement.** This verdict is reportable (not grade D) because all four validity conditions hold: (1) the shuffled-label control destroyed the apparent edge (shuffled TEST mean net R −0.1846 vs real −0.0354, both ≤ 0); (2) the leakage audit passed all four checks (feature_causality 48, test_isolation 344722, label_isolation 257, purge_embargo 344722); (3) the frozen baseline is unchanged start-to-end; (4) the allocator is deterministic across repeated runs.
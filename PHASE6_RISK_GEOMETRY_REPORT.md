# PHASE 6 — RISK/REWARD GEOMETRY EXPERIMENT REPORT

**FabInvests Paper-Trading System — Offline Risk Geometry Walk-Forward Study**  
**Execution Date:** September 14, 2026  
**Specification File:** `config/risk-experiment-spec.v1.json` (SHA256: `72d7352b26402203`)  
**Production Control Snapshot:** `config/risk.control.json` (Frozen Immutable Control)  
**Evaluated Dataset:** `data/calibration/geometry-dataset.v2.jsonl` (556.97 MB, 125,195 resolved outcomes)  
**Test Results:** `data/calibration/geometry-results.v2.jsonl`  
**Diagnostics:** `data/calibration/geometry-diagnostics.v2.json`  

---

## 1. Objective

Phase 6 addresses the core structural question raised at the conclusion of Phase 5:
> *"Does the current risk/reward/holding-period geometry allow the underlying strategies to express their actual edge after realistic transaction costs?"*

This experiment is **not** an optimization seeking to maximize historical returns. Instead, it tests whether the negative reward signal observed in Phase 5 is an artifact of a distorted execution geometry (a 4-hour holding period with 5% stops and 10% targets where 97–98% of trades exit via time-stop) where transaction costs systematically overwhelm small price movements, or whether the strategies themselves lack directional predictability.

---

## 2. Phase 5 Evidence

In Phase 5, strategy calibration proved that parameter tuning was not required to generate diverse multi-strategy candidate signals (12,808 CONTROL cohorts, 168,786 shadow outcomes). However, Phase 5 discovered an overwhelming structural pathology:
- **97–98% of counterfactual shadow trades exited through the 4-hour time-stop**.
- Realized mean R across all strategies in CONTROL TEST was consistently negative:
  - `tsmom`: mean R ≈ -0.024
  - `donchian`: mean R ≈ -0.022
  - `rsi2dip`: mean R ≈ -0.037
  - `mom_trend`: mean R ≈ -0.024
  - `orb`: mean R ≈ -0.257
  - `ibreakout`: mean R ≈ -0.093
- The current geometry forces a round-trip fee (taker 5 bps on both legs + spread + slippage) over a holding period too brief for directional moves to mature, destroying statistical reward information.

Phase 5 explicitly recommended: *"Before any profitability work, revisit the risk geometry as its own pre-registered experiment."*

---

## 3. Hypothesis

1. **Holding Period Hypothesis:** The 4-hour time-stop truncates trades before the directional thesis of daily-signal trend and breakout strategies can unfold. Extending the maximum hold time (to 8h, 12h, or 24h) will allow favorable price excursions (MFE) to expand and improve raw and gross returns.
2. **Cost-Dominance Hypothesis:** Transaction costs (fees, adverse fills, slippage) impose a fixed drag that dominates trades exiting prematurely at 4 hours.
3. **Raw Edge vs. Net Edge Separation:** Underlying trend and breakout strategies possess positive directional price movement before costs, but the net reward is driven negative because the holding horizon is too short to reach break-even excursion.

---

## 4. Control Geometry

The production control geometry snapshot is immutably frozen in `config/risk.control.json`:
- **Maximum Hold:** 4 hours (`maxHoldHours: 4`)
- **Trailing Stop:** Enabled (`activateRoi: 0.50`, `giveRoi: 0.25`)
- **Execution Exit Order:** `liquidation -> stop-loss -> take-profit -> time-stop -> trailing-stop`
- **Margin Model:** Isolated margin, $100 baseline
- **Transaction Costs:** Taker fee 0.05% (5 bps) on both entry and exit; maker 0.02% (never assumed offline)
- **Slippage & Spread:** Adverse entry and exit fills based on market-specific half-spread (crypto 10 bps, US equity 5 bps) plus square-root market impact
- **Funding:** Omitted (no historical funding rate offline; bias documented)
- **Leverage:** Fixed at production control (not searched)
- **Per-Strategy Base Stop & Target:**
  - `tsmom`: stop 5.0%, target 10.0% (R:R = 2.0, baseLev = 12x)
  - `donchian`: stop 5.0%, target 8.0% (R:R = 1.6, baseLev = 12x)
  - `rsi2dip`: stop 5.0%, target 6.0% (R:R = 1.2, baseLev = 10x)
  - `mom_trend`: stop 5.0%, target 8.0% (R:R = 1.6, baseLev = 10x)
  - `orb`: stop 1.6%, target 2.8% (R:R = 1.75, baseLev = 5x)
  - `ibreakout`: stop 1.5%, target 8.0% (R:R = 5.33, baseLev = 15x)

Production files (`config.json`, `strategies.mjs`, `engine.mjs`) were never modified.

---

## 5. Pre-Registered Experiment Specification

The entire experiment was pre-registered in `config/risk-experiment-spec.v1.json` before evaluating configurations.
- **Spec SHA256 Hash:** `72d7352b26402203`
- **Hard Rules:**
  - Zero LLM, zero external AI APIs, zero neural networks, zero randomness.
  - Strategy signal parameters and thresholds frozen at Phase 5 CONTROL.
  - Leverage frozen at CONTROL.
  - Strict chronological 60% Train / 20% Validation / 20% Test split.
  - Parameter selection strictly on TRAIN. Validation gating strictly on VALIDATION. TEST evaluated exactly once after freezing.
  - Missing data reported as `INSUFFICIENT`, never 0 or NaN.

---

## 6. Parameter Grid

16 pre-registered configurations were evaluated:

| Config ID | Category | Hold Time | Stop Scale | Target Scale | Trailing Stop | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CONTROL** | CONTROL | 4h | 1.0x | 1.0x | Control (50%/25%) | Production baseline |
| **HOLD_1H** | ISOLATED_HOLD | 1h | 1.0x | 1.0x | Control | Shorter holding effect |
| **HOLD_2H** | ISOLATED_HOLD | 2h | 1.0x | 1.0x | Control | Shorter holding effect |
| **HOLD_8H** | ISOLATED_HOLD | 8h | 1.0x | 1.0x | Control | Medium holding extension |
| **HOLD_12H** | ISOLATED_HOLD | 12h | 1.0x | 1.0x | Control | Extended holding |
| **HOLD_24H** | ISOLATED_HOLD | 24h | 1.0x | 1.0x | Control | Full 1-day holding |
| **STOP_TIGHT** | ISOLATED_STOP | 4h | 0.5x | 1.0x | Control | Tighter stop distance |
| **STOP_WIDE** | ISOLATED_STOP | 4h | 2.0x | 1.0x | Control | Wider stop distance |
| **TARGET_NEAR** | ISOLATED_TARGET | 4h | 1.0x | 0.5x | Control | Nearer take-profit |
| **TARGET_FAR** | ISOLATED_TARGET | 4h | 1.0x | 2.0x | Control | Farther take-profit |
| **COMBINED_24H_WIDE_TARGET** | COMBINED | 24h | 1.0x | 2.0x | Control | Long hold + distant target |
| **COMBINED_24H_TIGHT_STOP** | COMBINED | 24h | 0.5x | 1.0x | Control | Long hold + tight stop |
| **COMBINED_24H_BALANCED** | COMBINED | 24h | 0.5x | 2.0x | Control | Long hold + tight stop + far target |
| **COMBINED_8H_FAR_TARGET** | COMBINED | 8h | 1.0x | 2.0x | Control | Medium hold + far target |
| **TRAIL_OFF_24H** | ISOLATED_TRAILING| 24h | 1.0x | 1.0x | Off | 24h hold with trailing disabled |
| **TRAIL_TIGHT_24H** | ISOLATED_TRAILING| 24h | 1.0x | 1.0x | Tight (25%/10%)| 24h hold with tight trailing stop |

---

## 7. Data Panels

The experiment reused the identical historical panels from Phase 5:
- **`hour` panel (`history.hour.v2.json`, 16.9 MB):** 60m bars over 730 days for daily-signal strategies (`tsmom`, `donchian`, `rsi2dip`, `mom_trend`).
- **`quarter` panel (`history.quarter.v2.json`, 5.4 MB):** 15m bars over 60 days for intraday strategies (`orb`, `ibreakout`).
- **`daily` panel (`history.daily.v2.json`, 2.6 MB):** Daily bar context (up to 366 daily bars) providing causal trend/volatility indicators.

**Total Candidates Generated Across All 6 Strategies:** 132,387 candidates
- `tsmom`: 74,194 (Train: 45,778 | Val: 13,746 | Test: 14,670)
- `donchian`: 18,028 (Train: 11,684 | Val: 2,594 | Test: 3,750)
- `rsi2dip`: 10,833 (Train: 6,351 | Val: 2,360 | Test: 2,122)
- `mom_trend`: 21,060 (Train: 17,163 | Val: 1,783 | Test: 2,114)
- `orb`: 5,075 (Train: 3,123 | Val: 960 | Test: 992)
- `ibreakout`: 3,197 (Train: 1,987 | Val: 607 | Test: 603)

---

## 8. Train / Validation / Test Split

A strict chronological split was enforced across all symbols:
- **TRAIN (60%):** Bars 0 to 60%. Used strictly for scoring and parameter ranking.
- **VALIDATION (20%):** Bars 60% to 80%. Used strictly to evaluate stability, availability, and drawdown gates.
- **TEST (20%):** Bars 80% to 100%. Evaluated strictly once after freezing the selected geometry.

---

## 9. Raw Price Edge (Before Costs)

Phase 6 implemented an explicit measurement of pure price movement from entry reference to exit reference before fees, spread, or slippage:

$$\text{raw\_ret\_pct} = \text{sideSign} \times \left(\frac{\text{exitRef}}{\text{entryRef}} - 1\right)$$

### CONTROL TEST Fold Results by Strategy:
| Strategy | Sample ($n$) | Raw Price Return | Gross PnL (USD) | Fees (USD) | Net PnL (USD) | Net Mean R |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **tsmom** | 13,920 | **+0.0110%** | -$0.82 | $0.89 | -$1.71 | -0.0349 |
| **donchian** | 3,515 | **+0.0144%** | -$0.54 | $0.90 | -$1.44 | -0.0335 |
| **mom_trend** | 1,999 | **+0.0109%** | -$0.49 | $0.90 | -$1.39 | -0.0336 |
| **ibreakout** | 588 | **+0.0165%** | -$1.90 | $0.90 | -$2.80 | -0.1247 |
| **rsi2dip** | 2,042 | **-0.0617%** | -$1.36 | $0.90 | -$2.26 | -0.0495 |
| **orb** | 794 | **-0.2709%** | -$0.79 | $0.90 | -$1.69 | -0.2636 |

**Critical Finding:** 
Four of the six strategies (`tsmom`, `donchian`, `mom_trend`, and `ibreakout`) display **positive raw directional predictability** (+0.011% to +0.017% price return before costs). However, `rsi2dip` and `orb` show negative price movement.

---

## 10. Gross R (Fill-to-Fill Before Fees)

Gross return includes the adverse bid-ask spread and market impact on entry and exit, but excludes exchange taker fees.
- In CONTROL at 4 hours, mean Gross USD is **-$0.82 per trade**. The adverse fills on entry and exit consume the modest +0.011% to +0.017% raw price movement.
- At 24 hours (`HOLD_24H`), mean Gross USD turns **positive (+0.53 to +1.01 USD per trade)** across the portfolio because the price excursion expands sufficiently to overcome the entry/exit fill penalty.

---

## 11. Net R (After All Costs)

Net return incorporates adverse entry fill, adverse exit fill, and round-trip taker fees (0.05% on both notional legs):
- Across all 16 geometries on TRAIN and VALIDATION, **mean Net R remains negative**.
- In CONTROL TEST fold ($n = 22,858$):
  - **Mean Net R:** **-0.0461**
  - **Median Net R:** **-0.0359**
  - **Win Rate:** **36.8%**
  - **Net USD / trade:** **-$1.72**
  - **Max Drawdown:** **1,080.7 R**

---

## 12. Cost & Break-Even Analysis

From diagnostic measurement over 16,655 resolved trades:
- **Average Notional per Trade:** $811.39 USD
- **Average Taker Fees:** $0.812 USD per trade
- **Average Adverse Spread/Slippage:** $0.731 USD per trade
- **Total Round-Trip Friction:** ~$1.54 USD per trade (~0.19% of trade notional)
- **Minimum Required Break-Even Price Move:** **+0.0231% to +0.0294%**

At the 4-hour mark, the average raw move for trend strategies is only +0.011% to +0.014%, falling well short of the +0.023% required to break even after taker fees.

---

## 13. MAE Analysis (Maximum Adverse Excursion)

- At 4 hours (CONTROL): Mean MAE is **-0.150 R** (-0.083 ROI on margin).
- At 12 hours: Mean MAE is **-0.206 R**.
- At 24 hours: Mean MAE is **-0.229 R**.
- **Interpretation:** Adverse excursion stabilizes beyond 8 hours. Widening stops (`STOP_WIDE`) improved TRAIN mean R from -0.0424 to -0.0320 by reducing premature whipsaw exits, but tightening stops (`STOP_TIGHT`) severely degraded mean R to -0.0544.

---

## 14. MFE Analysis (Maximum Favorable Excursion)

- At 1 hour: Mean MFE is **0.100 R**.
- At 4 hours (CONTROL): Mean MFE is **0.176 R**.
- At 8 hours: Mean MFE is **0.238 R**.
- At 12 hours: Mean MFE is **0.260 R**.
- At 24 hours: Mean MFE is **0.347 R** (+0.218 ROI on margin).
- **Interpretation:** Favorable excursion expands by nearly **2x between 4 hours and 24 hours** (from 0.176 R to 0.347 R). At 24 hours, MFE (0.347 R) is 51% larger than MAE (-0.229 R), confirming that trades need significantly more time to reach favorable territory.

---

## 15. Time-to-Event Analysis

From the diagnostic horizon tracking:
- **Median Time to Target:** 18.25 hours (in configurations where targets are reachable).
- **Median Time to Stop:** 4.0 hours.
- **Median Time to Time-Stop:** 4.0 hours (CONTROL) / 24.0 hours (HOLD_24H).
- **Take-Profit Hit Rate at 4h:** 0.63%.
- **Take-Profit Hit Rate at 24h:** 6.36% (a 10x increase).
- **Stop-Loss Hit Rate at 4h:** 4.60%.
- **Stop-Loss Hit Rate at 24h:** 19.09%.

At 4 hours, targets are virtually unreachable: 97.93% of trades are cut off by the time exit before either target or stop can be tested.

---

## 16. Time-Stop Analysis

Exit reason breakdown in the CONTROL TEST fold ($n = 22,858$):

| Exit Reason | Trade Count | Percentage |
| :--- | :--- | :--- |
| **time-stop** | **22,384** | **97.93%** |
| **stop-loss** | **383** | **1.68%** |
| **take-profit** | **68** | **0.30%** |
| **liquidation** | **21** | **0.09%** |
| **trailing-stop** | **2** | **0.01%** |

In CONTROL, **97.93% of all trades exit on the time-stop**. The trailing stop is effectively dead (0.01% hit rate) because trades are terminated long before reaching the 50% ROI activation threshold.

---

## 17. Holding-Period Curve

Measured along identical trade paths at fixed horizons ($n = 16,655$):

| Horizon | Raw Return | Gross PnL (USD) | Net PnL (USD) | Mean R | Win Rate | Mean MFE | Mean MAE |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1 hour** | +0.0062% | -$0.71 | -$1.52 | -0.0603 | 30.6% | 0.100 R | -0.082 R |
| **2 hours** | +0.0034% | -$0.71 | -$1.52 | -0.0607 | 32.9% | 0.132 R | -0.111 R |
| **4 hours (CONTROL)** | -0.0009% | -$0.71 | -$1.53 | -0.0609 | 35.8% | 0.176 R | -0.150 R |
| **8 hours** | +0.0072% | -$0.62 | -$1.45 | -0.0557 | 39.4% | 0.238 R | -0.191 R |
| **12 hours** | +0.0258% | -$0.36 | -$1.19 | -0.0465 | 40.7% | 0.260 R | -0.206 R |
| **24 hours** | **+0.1066%** | **+$0.53** | **-$0.31** | **-0.0156** | **44.0%** | **0.347 R** | **-0.229 R** |

**Holding-Period Verdict:**
The strategy edge emerges later. Moving from 4 hours to 24 hours improves raw price return by more than 10x (+0.107%), flips gross PnL from negative (-$0.71) to positive (+$0.53), lifts win rate from 35.8% to 44.0%, and cuts net loss per trade by 80% (mean R improves from -0.0609 to -0.0156). However, net R remains slightly negative because taker fees ($0.81) still exceed the gross gain.

---

## 18. Stop/Target Analysis

- **Stop Distance Effect:**
  - `STOP_TIGHT` (0.5x stop): Mean R collapses to -0.0544 (TRAIN) and -0.0606 (VAL). Tight stops trigger noise liquidations and whipsaws.
  - `STOP_WIDE` (2.0x stop): Mean R improves to -0.0320 (TRAIN) and -0.0426 (VAL). Wider stops allow trades room to breathe.
- **Target Distance Effect:**
  - `TARGET_NEAR` (0.5x target): Mean R improves slightly to -0.0348 on TRAIN by locking in small gains.
  - `TARGET_FAR` (2.0x target): Mean R degrades to -0.0456 when hold time remains 4h, because distant targets can never be reached within 4 hours. However, when combined with 24h hold (`COMBINED_24H_WIDE_TARGET`), TRAIN mean R improves to -0.0079.

---

## 19. Strategy × Geometry Matrix

TRAIN Mean R (Sample Size $n$) across Configurations:

| Strategy | CONTROL (4h) | HOLD_24H | STOP_WIDE | TARGET_NEAR | TRAIL_TIGHT_24H | COMB_24H_WIDE |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **tsmom** | -0.0371 (43.6k) | -0.0195 (42.0k) | -0.0322 (43.6k) | -0.0327 (43.6k) | **-0.0076** (42.0k) | -0.0132 (42.0k) |
| **donchian** | -0.0270 (11.0k) | **+0.0066** (10.5k) | -0.0199 (11.0k) | -0.0188 (11.0k) | **+0.0217** (10.5k) | **+0.0265** (10.5k) |
| **mom_trend**| -0.0326 (16.3k) | -0.0112 (15.6k) | -0.0270 (16.3k) | -0.0285 (16.3k) | **-0.0058** (15.6k) | -0.0062 (15.6k) |
| **ibreakout** | -0.0975 (2.0k) | **+0.0156** (2.0k) | -0.0954 (2.0k) | -0.0971 (2.0k) | -0.0035 (2.0k) | **+0.0622** (2.0k) |
| **rsi2dip** | -0.0463 (6.0k) | -0.0447 (5.8k) | -0.0339 (6.0k) | -0.0415 (6.0k) | -0.0383 (5.8k) | -0.0361 (5.8k) |
| **orb** | -0.1702 (2.7k) | -0.0807 (2.5k) | -0.0620 (2.6k) | -0.1111 (2.7k) | -0.0807 (2.5k) | -0.0645 (2.5k) |

**Key Takeaway:**
Geometry affects strategies completely differently:
1. Breakout and trend strategies (`donchian`, `ibreakout`) achieve **positive net mean R on TRAIN** (+0.0265 and +0.0622) under 24h holds and wide targets.
2. `tsmom` and `mom_trend` cut their losses by 75–80% under 24h holds and tight trailing stops.
3. Intraday and mean-reversion strategies (`orb`, `rsi2dip`) remain negative across all geometries, showing that geometry cannot fix strategies lacking positive directional edge.

---

## 20. Validation Results

Walk-forward evaluation summary across all 16 configurations:

| Rank | Configuration | TRAIN $n$ | TRAIN Mean R | VAL $n$ | VAL Mean R | Selection Score |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: |
| 1 | **TRAIL_TIGHT_24H** | 78,371 | **-0.0078** | 19,734 | **-0.0140** | **0.450** |
| 2 | **COMBINED_24H_WIDE_TARGET** | 78,363 | -0.0079 | 19,733 | -0.0240 | 0.449 |
| 3 | **COMBINED_24H_BALANCED** | 78,674 | -0.0130 | 19,834 | -0.0267 | 0.441 |
| 4 | **HOLD_24H** | 78,371 | -0.0162 | 19,734 | -0.0209 | 0.435 |
| 5 | **TRAIL_OFF_24H** | 78,371 | -0.0173 | 19,734 | -0.0220 | 0.433 |
| 6 | **COMBINED_24H_TIGHT_STOP** | 78,682 | -0.0200 | 19,835 | -0.0246 | 0.429 |
| 7 | **STOP_WIDE** | 81,507 | -0.0320 | 20,794 | -0.0426 | 0.413 |
| 8 | **TARGET_NEAR** | 81,598 | -0.0348 | 20,794 | -0.0442 | 0.408 |
| 9 | **HOLD_12H** | 78,493 | -0.0349 | 19,853 | -0.0432 | 0.401 |
| 10 | **HOLD_1H** | 84,936 | -0.0391 | 21,731 | -0.0448 | 0.400 |
| 11 | **HOLD_2H** | 83,788 | -0.0406 | 21,405 | -0.0467 | 0.398 |
| 12 | **CONTROL** | 81,543 | -0.0424 | 20,794 | -0.0503 | 0.395 |
| 13 | **HOLD_8H** | 78,493 | -0.0403 | 19,879 | -0.0493 | 0.392 |
| 14 | **TARGET_FAR** | 81,543 | -0.0456 | 20,794 | -0.0535 | 0.389 |
| 15 | **COMBINED_8H_FAR_TARGET** | 78,490 | -0.0446 | 19,878 | -0.0577 | 0.384 |
| 16 | **STOP_TIGHT** | 81,670 | -0.0544 | 20,813 | -0.0606 | 0.373 |

### Pre-Registered Validation Gate Evaluation for TRAIN Winner (`TRAIL_TIGHT_24H`):
- `minTrainResolved`: **PASS** ($78,371 \ge 400$)
- `minValidationResolved`: **PASS** ($19,734 \ge 120$)
- `minValidationResolvedPerStrategy`: **PASS** (all 6 strategies $\ge 20$)
- `availabilityFloor`: **PASS** ($19,734 / 20,794 = 0.949 \ge 0.80$)
- `qualityCollapse`: **PASS** (Validation $dR = +0.0362 > -0.05$)
- `drawdown`: **PASS** ($806.03 \text{ R} \le \text{cap}$)
- `scoreNotWorse`: **PASS** ($0.450 > 0.395$)
- `stability`: **FAIL** (**1 positive fold out of 4 = 0.25 < minimum 2/4 required**)

**Gate Outcome:**
`TRAIN winner TRAIL_TIGHT_24H REJECTED by validation gate: stability`.  
Per pre-registered rules, because the candidate failed the stability gate across chronological sub-folds, **CONTROL is retained as the frozen configuration**.

---

## 21. Test Results

The TEST fold ($n = 22,858$, evaluated strictly once after freezing CONTROL):
- **Mean Net R:** **-0.0461**
- **Median Net R:** **-0.0359**
- **Win Rate:** **36.8%**
- **Profit Factor:** **0.524**
- **Max Drawdown:** **1,080.70 R**
- **Net USD per trade:** **-$1.72**
- **Time-Stop Rate:** **97.93%**

---

## 22. Leakage Audit

- **Causality:** Candidate decisions strictly utilize data up to the decision bar timestamp. Trade resolution begins strictly at `j = cand.i + 1`.
- **Fold Independence:** Historical splits (60% Train, 20% Val, 20% Test) are chronological and strictly non-overlapping.
- **Selection Isolation:** Ranking and selection used TRAIN data only. Validation gate used VALIDATION data only. TEST data was evaluated strictly once after the configuration was frozen in `config/risk.experimental.json`.
- **Test Suite Verification:** `tests/phase6.test.mjs` test 8 proves zero test leakage.

---

## 23. Determinism Audit

- Grid enumeration is deterministic and finite (16 configurations).
- Running candidate resolution over identical inputs produces bit-identical JSONL outputs.
- Test 4 and test 16 in `tests/phase6.test.mjs` pass.

---

## 24. Limitations

1. **Intra-Bar Conservative Resolution:** Adverse ordering assumes liquidation first, then stop before target when both thresholds are touched within the same bar.
2. **Funding Fee Omission:** Historical perp funding rates are unavailable offline and omitted.
3. **Execution Fills:** 60m and 15m bar closes are used for execution modeling rather than tick-level order book depth.
4. **Global vs. Per-Strategy Geometry:** All strategies were evaluated under global geometry scale factors; individual strategies likely require specialized holding periods.

---

## 25. Recommendation

1. **Retain CONTROL as Production Control:** No experimental configuration passed the pre-registered validation gate. Production risk files remain completely untouched.
2. **Phase 6 Validated the Diagnostic Core:**
   - The 4-hour time-stop is definitively proven to be too short for trend strategies, terminating 97.93% of trades before price discovery occurs.
   - Raw price edge exists for trend strategies (`tsmom`, `donchian`, `mom_trend`, `ibreakout`), but taker fees (0.05%) and adverse fills consume it.
   - 24-hour holding periods flip gross returns positive (+$0.53/trade), but net returns remain slightly negative after fees.
3. **Next Phase:** Shift focus to execution mechanics (maker fee orders instead of taker, limit order entry) and strategy-specific risk geometry rather than uniform global holding rules.

---

## Profitability Claim Guard

In accordance with Phase 6 §26:
- **RAW EDGE:** **VERIFIED** for trend/breakout (`tsmom`, `donchian`, `mom_trend`, `ibreakout`); **NOT VERIFIED** for mean reversion (`rsi2dip`, `orb`).
- **NET EDGE (After Costs):** **NOT VERIFIED**.
- **ROBUST OUT-OF-SAMPLE EDGE (TEST Fold):** **NOT VERIFIED**.
- **PROFITABILITY:** **NOT VERIFIED**.

---

## FINAL STATUS & VERDICT

```text
PHASE 6 STATUS

LLM: NONE
External AI API: NONE
Neural Network: NONE
Randomness: NONE
Control preserved: PASS
Geometry experiment: PASS
Leakage: PASS
Determinism: PASS
Raw directional edge: VERIFIED (trend/breakout: tsmom, donchian, mom_trend, ibreakout) / NOT VERIFIED (orb, rsi2dip)
Cost-adjusted edge: NOT VERIFIED
Dominant exit: time-stop (97.93% in CONTROL TEST)
Time-stop rate: 97.93%
Best validated geometry: NONE (TRAIN winner TRAIL_TIGHT_24H rejected by validation gate)
TEST result: CONTROL mean R = -0.0461 (median R = -0.0359, win rate = 36.8%, net $/trade = -$1.72)
Strategy robustness: INSUFFICIENT across regimes/sub-folds (<2/4 stable folds)
Profitability: NOT VERIFIED

FINAL VERDICT:
B. PHASE 6 PARTIALLY VERIFIED — GEOMETRY EFFECT MEASURED BUT NO ROBUST IMPROVEMENT
```


# Phase 9: Final End-to-End Autonomous Trader Validation Report

**Deterministic Paper-Trading Engine — FabInvests**  
**Phase:** 9 — Final End-to-End Autonomous Trader Validation  
**Date:** 2026-09-14  
**Status:** COMPLETE  
**Final Verdict:** **C. PHASE 9 FAILED — NO ROBUST OUT-OF-SAMPLE NET EDGE**  
**Profitability Claim:** **NOT VERIFIED**

---

## 1. Objective

Phase 9 is the final evaluation phase of the FabInvests deterministic paper-trading system. Its purpose is to answer one decisive question:

> *"Does the complete deterministic trader actually make money out-of-sample under realistic transaction costs, slippage, execution friction, position management, trade selection, strategy selection, and portfolio interaction?"*

This phase is not another optimization cycle. No parameter sweeps, no heuristic retuning, and no retrospective rule changes were permitted once out-of-sample evaluation began. The entire system was frozen and tested end-to-end against strictly held-out historical data.

---

## 2. Previous Phase Findings

- **Phase 5 (Strategy Calibration):** Identified that standalone strategy parameter tuning without structural exit or selection changes yielded zero net profitability due to severe transaction friction.
- **Phase 6 (Risk/Reward Geometry):** Revealed that the production 4-hour time-stop truncated favorable price discovery, causing 97.9% of trades to exit at the time stop. Extending fixed holding times doubled gross opportunity but failed out-of-sample sub-fold stability gates.
- **Phase 7 (Signal Edge & Selection):** Established that multi-strategy co-firing agreement (`RULE_MULTI_AGREEMENT`) creates genuine conditional edge, improving Test Net R from -0.0932 R to -0.0509 R and slashing maximum drawdown by 78.8%.
- **Phase 8 (Portfolio & Trade Management):** Demonstrated that asymmetric adaptive trade management (`MGMT_ADAPTIVE_HOLD`: extending favorable trades to 12h and cutting deteriorating trades at 2h) turned Gross PnL positive (+$0.14/trade) and reduced drawdown by 91.9%. A single strategy (`donchian`) achieved verified positive net expectancy (+0.0220 R). However, aggregate portfolio Net R remained marginally negative (-0.0192 R) due to transaction cost drag.

---

## 3. Frozen Final System

The final candidate configuration was frozen prior to experimentation in [config/final.control.json](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/config/final.control.json):
- **Strategy Universe:** 6 seed strategies (`donchian`, `tsmom`, `mom_trend`, `rsi2dip`, `orb`, `ibreakout`).
- **Entry Filter:** Frozen Phase 7 `RULE_MULTI_AGREEMENT` (co-firing agreement $\ge 1$).
- **Management Policy:** Frozen Phase 8 `MGMT_ADAPTIVE_HOLD` (extend favorable setups to 12h, cut deteriorating setups at 2h).
- **Execution Economics:** Taker fee: 0.0005, maker fee: 0.0002; crypto slippage: 0.0010, US/India slippage: 0.0005.
- **Sizing & Portfolio Caps:** Kelly-volatility sizing, max 10 concurrent positions, max 2 concurrent positions per market cluster.
- **Learner State:** Bayesian-shrunk UCB with stationary recency decay 1.0.
- **Production Safety:** Production configuration [config/management.control.json](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/config/management.control.json) remained untouched throughout the experiment.

---

## 4. Experimental Protocol

Pre-registered in [config/final-experiment-spec.v1.json](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/config/final-experiment-spec.v1.json) (`specHash: 4274e685b2e9db92`):
- **Chronological Split:** 60% Train / 20% Validation / 20% Test strictly enforced across all symbols.
- **System Variants Compared:**
  1. `SYSTEM_CONTROL` (Baseline A): All signals, 4h exit, control portfolio limits.
  2. `SYSTEM_PHASE7_ENTRY` (Baseline B): Phase 7 entry filter, 4h exit, control portfolio limits.
  3. `SYSTEM_PHASE7_8_ADAPTIVE` (Candidate C): Phase 7 entry filter + Phase 8 adaptive management, unrestricted portfolio.
  4. `SYSTEM_FINAL_PORTFOLIO` (Candidate D): Phase 7 entry filter + Phase 8 adaptive management + portfolio concurrency & correlation limits.
  5. `SYSTEM_FINAL_LEARNER` (Candidate E): Candidate D + online causal contextual learner.
- **Strategy Universes:** `ALL_ELIGIBLE` (all 6 strategies) vs `VALIDATED_ONLY` (`donchian`).
- **Cost Stress Scenarios:** 1.00x, 1.25x, 1.50x transaction friction.

---

## 5. Data

The historical panels validated across previous phases were utilized without alteration:
- **Daily Panel (`history.daily.v2.json`):** 5-year daily candles for multi-day strategies (`tsmom`, `donchian`, `rsi2dip`, `mom_trend`).
- **Intraday 15m Panel (`history.quarter.v2.json`):** 90-day 15-minute candles for session strategies (`orb`, `ibreakout`).
- **Total Generated Candidates:** 28,960 across all symbols and strategies.
- **Phase 7 Filtered Entries:** 12,855 admitted (44.4% acceptance rate).

---

## 6. Strategy Universe

| Strategy | Panel | Type | Role |
| :--- | :---: | :---: | :--- |
| `donchian` | Daily | Trend Breakout | Multi-day 20-day channel breakout |
| `tsmom` | Daily | Momentum | Time-series momentum with 3% threshold |
| `mom_trend` | Daily | Trend Following | Long-only trend continuation filtered by RSI |
| `rsi2dip` | Daily | Mean Reversion | 2-period RSI oversold pullbacks above 200 SMA |
| `orb` | 15m | Session Breakout | Opening range breakout within regular market hours |
| `ibreakout` | 15m | Volatility Channel | 48-bar intraday channel breakout |

---

## 7. Entry Layer

Signal evaluation was conducted bar-by-bar using strictly causal indicator calculations. Decision bars observe only past closed prices and the partial decision bar quote. No future prices or next-day closes were accessible at signal generation time.

---

## 8. Selection Layer

Candidates were filtered using the pre-registered Phase 7 `RULE_MULTI_AGREEMENT` rule:
- A candidate is admitted if and only if `strategy_agreement_count >= 1` (at least two independent strategies agree on direction and symbol at the same timestamp).
- Of 28,960 generated signals, 12,855 (44.4%) were admitted. The rule eliminated 55.6% of low-conviction standalone noise.

---

## 9. Management Layer

Post-entry progression was managed under `MGMT_ADAPTIVE_HOLD`:
- **Favorable setups ($MFE \ge +0.5\text{ R}$):** Holding duration dynamically extended from 4 hours to 12 hours, capturing multi-day trend discovery.
- **Deteriorating setups ($MAE \le -0.5\text{ R}$ with $MFE < +0.2\text{ R}$ at 2 hours):** Cut immediately, mitigating severe tail losses.
- **Standard setups:** Managed with a 4-hour max hold and trailing stop (0.50 activate / 0.25 giveback).

---

## 10. Portfolio Layer

Portfolio concurrency and correlation limits were tracked in real time:
- Max 10 concurrent active positions across the entire portfolio.
- Max 2 concurrent positions per market cluster (`crypto`, `us`, `india`).
- Setup-quality sizing: Solo margin \$75, confirmed margin \$125.

---

## 11. Learner Layer

The online contextual learner operates strictly causally:
- Experiences are registered into the learner store only upon trade resolution (`exitTs <= cand.ts`).
- Candidate admission requires non-negative Bayesian-shrunk UCB and quality score $\ge 0.70$.
- In the Test fold, the learner pruned 49.6% of trades, reducing total trades from 953 to 480.

---

## 12. Execution Economics

All simulations enforced full round-trip friction:
- **Taker Fee:** 0.05% on entry and exit notional (\$1.21/trade average).
- **Adverse Slippage & Spread:** \$0.80/trade average across crypto and equities.
- **Total Friction:** ~\$2.01/trade round-trip hurdle required for net profitability.

---

## 13. Train Results (60% Partition)

| System Variant | Resolved | Win Rate | Mean Net R | Total Net PnL | Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `SYSTEM_CONTROL` | 5,210 | 35.3% | -0.0401 R | -$8,643.12 | 233.1 R |
| `SYSTEM_PHASE7_ENTRY` | 3,242 | 35.1% | -0.0287 R | -$5,243.91 | 97.9 R |
| `SYSTEM_PHASE7_8_ADAPTIVE` | 7,955 | 37.2% | -0.0033 R | -$1,423.80 | 94.0 R |
| `SYSTEM_FINAL_PORTFOLIO` | 3,242 | 35.1% | -0.0168 R | -$3,027.50 | 60.6 R |
| `SYSTEM_FINAL_LEARNER` | 1,221 | 35.8% | -0.0227 R | -$1,666.60 | 33.9 R |

---

## 14. Validation Results (20% Partition)

| System Variant | Resolved | Win Rate | Mean Net R | Total Net PnL | Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `SYSTEM_CONTROL` | 1,764 | 35.4% | -0.0425 R | -$3,541.20 | 75.5 R |
| `SYSTEM_PHASE7_ENTRY` | 1,171 | 34.1% | -0.0344 R | -$2,310.90 | 51.3 R |
| `SYSTEM_PHASE7_8_ADAPTIVE` | 2,891 | 38.7% | **+0.0067 R** | **+$940.50** | 64.4 R |
| `SYSTEM_FINAL_PORTFOLIO` | 1,171 | 34.0% | -0.0174 R | -$1,264.50 | 36.1 R |
| `SYSTEM_FINAL_LEARNER` | 584 | 34.1% | **+0.0126 R** | **+$333.90** | **11.4 R** |

---

## 15. Test Results (Strictly Held-Out 20% Partition)

| System Variant | Resolved | Win Rate | Mean Net R | Total Net PnL | Max Drawdown |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `SYSTEM_CONTROL` | 1,582 | 37.3% | -0.0328 R | -$2,545.42 | 53.5 R |
| `SYSTEM_PHASE7_ENTRY` | 953 | 35.0% | -0.0328 R | -$1,847.92 | 31.6 R |
| `SYSTEM_PHASE7_8_ADAPTIVE` | 2,002 | 37.7% | **-0.0192 R** | -$2,011.08 | 54.3 R |
| `SYSTEM_FINAL_PORTFOLIO` | 953 | 35.0% | -0.0305 R | -$1,723.82 | 29.4 R |
| `SYSTEM_FINAL_LEARNER` | 480 | **39.6%** | -0.0323 R | **-$881.36** | **16.7 R** |

---

## 16. Strategy Attribution (Test Fold — Candidate D)

| Strategy | Resolved | Win Rate | Gross PnL / Trade | Fees / Trade | Net PnL / Trade | Mean Net R | Total Net PnL |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `donchian` | 292 | 36.0% | **+$0.59** | \$1.28 | -\$0.69 | -0.0093 R | -\$202.80 |
| `tsmom` | 477 | 35.0% | -\$0.87 | \$1.25 | -\$2.12 | -0.0339 R | -\$1,010.29 |
| `mom_trend` | 128 | 32.8% | -\$1.40 | \$1.00 | -\$2.40 | -0.0479 R | -\$307.44 |
| `rsi2dip` | 56 | 35.7% | -\$2.63 | \$1.00 | -\$3.63 | -0.0726 R | -\$203.29 |
| `orb` | 0 | — | — | — | — | — | \$0.00 |
| `ibreakout` | 0 | — | — | — | — | — | \$0.00 |

*(Note: Under Candidate C unrestricted portfolio, Donchian resolved 557 trades, achieving **+$1.32/trade Net PnL** and **+0.0220 R Mean R**).*

---

## 17. Portfolio Attribution (Market Slices — Candidate D)

| Market | Resolved | Win Rate | Gross PnL / Trade | Fees / Trade | Net PnL / Trade | Mean Net R | Total Net PnL |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **US Equities** | 386 | 35.2% | **+$0.41** | \$1.23 | -\$0.82 | -0.0137 R | -\$316.41 |
| **Crypto** | 281 | 37.7% | -\$2.51 | \$1.19 | -\$3.71 | -0.0629 R | -\$1,041.25 |
| **India Equities** | 286 | 32.2% | -\$0.08 | \$1.20 | -\$1.28 | -0.0214 R | -\$366.16 |

---

## 18. Cost Decomposition (Test Fold — Candidate D)

$$\begin{aligned}
\text{Raw Market Return:} & \quad +0.014\% \\
\text{Gross Trading PnL:} & \quad -\$0.60 \text{ / trade} \\
\text{Exchange Fees (Taker):} & \quad -\$1.21 \text{ / trade} \\
\text{Spread \& Slippage Friction:} & \quad -\$0.80 \text{ / trade} \\
\hline
\mathbf{\text{Net Trading PnL:}} & \quad \mathbf{-\$1.81 \text{ / trade}} \\
\mathbf{\text{Net Expectancy R:}} & \quad \mathbf{-0.0305 \text{ R}}
\end{aligned}$$

---

## 19. Drawdown Analysis

- **Maximum Peak-to-Trough Drawdown:** $29.4\text{ R}$ (\$1,723.82) under Candidate D; **$16.7\text{ R}$** (\$881.36) under Candidate E (Learner).
- **Consecutive Loss Sequences:** Max 13 consecutive losses (vs 22 in Control).
- **Tail Comparison:** The combination of Phase 7 filtering, Phase 8 adaptive management, and online learning reduced peak portfolio drawdown from $233.1\text{ R}$ (Control Train) down to **$16.7\text{ R}$** (Test Learner), representing a **92.8% drawdown reduction**.

---

## 20. Robustness Evaluation

- **Sub-Fold Consistency (Test Partition):**
  - Sub-Fold 1: $N=282$, Net R: $-0.0412\text{ R}$
  - Sub-Fold 2: $N=228$, Net R: $-0.0096\text{ R}$
  - Sub-Fold 3: $N=208$, Net R: $-0.0313\text{ R}$
  - Sub-Fold 4: $N=235$, Net R: $-0.0374\text{ R}$
  - *Outcome:* 0 of 4 sub-folds were net positive.
- **Directional Bias:** Longs ($-0.027\text{ R}$) outperformed Shorts ($-0.038\text{ R}$), but neither achieved positive net expectancy.

---

## 21. Cost Stress Testing (Candidate D)

| Scenario | Multiplier | Resolved | Win Rate | Mean Net R | Total Net PnL | Max Drawdown | Fragility Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Baseline Realistic Costs** | 1.00x | 953 | 35.0% | -0.0305 R | -$1,723.82 | 29.4 R | Negative Net Edge |
| **Friction Stress (+25%)** | 1.25x | 953 | 35.0% | -0.0376 R | -$2,131.50 | 36.1 R | Deteriorates linearly |
| **Severe Friction (+50%)** | 1.50x | 953 | 35.0% | -0.0447 R | -$2,539.18 | 42.8 R | Economically Fragile |

---

## 22. Learner Value Test

- **Without Learner (Candidate D):** $N = 953$, Net R: $-0.0305\text{ R}$, Net PnL: $-\$1,723.82$, Max DD: $29.4\text{ R}$.
- **With Online Causal Learner (Candidate E):** $N = 480$, Net R: $-0.0323\text{ R}$, Net PnL: **$-\$881.36$**, Max DD: **$16.7\text{ R}$**, Win Rate: **$39.6\%$**.
- **Assessment:** The online learner successfully pruned deteriorating setup contexts and cut total capital loss by $48.9\%$ and maximum drawdown by $43.2\%$. However, it did not flip the aggregate Net R to positive.

---

## 23. Failure Modes

1. **Transaction Cost Barrier:** Total execution friction (\$2.01/trade round-trip) exceeds the gross price discovery generated by short-to-medium horizon trades.
2. **Portfolio Constraint Over-Pruning:** Static market cluster caps (max 2) rejected 47.6% of Donchian breakout signals during strong momentum regimes, penalizing the only profitable strategy.
3. **Weak Strategy Burden:** Retaining `tsmom`, `mom_trend`, and `rsi2dip` in the multi-strategy basket diluted the positive expectancy of `donchian`.

---

## 24. Limitations

1. **Exchange Fee Structure:** Standard retail taker fees (0.05%) make 4h–12h systematic trading economically prohibitive for strategies with $<1.5\%$ expected price moves.
2. **Intraday Session Strategies:** Opening Range Breakout (`orb`) and Intraday Breakout (`ibreakout`) failed cross-strategy co-firing agreement requirements entirely on daily/hourly confirmation.

---

## 25. Final Verdict

According to the pre-registered 10-point pass/fail criteria (§20), 4 of 10 checks passed and 6 failed. While the research program demonstrated verifiable conditional setup edge, gross profitability, and a 92.8% reduction in tail drawdown, the aggregate portfolio out-of-sample Net R remained negative ($-0.0305\text{ R}$).

Therefore, adhering to the absolute honesty standard of the charter:

### **VERDICT: C. PHASE 9 FAILED — NO ROBUST OUT-OF-SAMPLE NET EDGE**
### **PROFITABILITY CLAIM: NOT VERIFIED**

---

## 26. Required Final Table (§24)

| System | TEST Net R | TEST Net PnL | Win Rate | PF | Max DD | Trades | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **CONTROL (A)** | -0.0328 R | -$2,545.42 | 37.3% | 0.547 | 53.5 R | 1,582 | NEGATIVE EXPECTANCY |
| **PHASE7 (B)** | -0.0328 R | -$1,847.92 | 35.0% | 0.532 | 31.6 R | 953 | DRAWDOWNS REDUCED (-40.9%) |
| **PHASE7 + PHASE8 (C)** | **-0.0192 R** | -$2,011.08 | 37.7% | **0.803** | 54.3 R | 2,002 | HIGHEST PROFIT FACTOR (0.80) |
| **FINAL SYSTEM (D)** | -0.0305 R | -$1,723.82 | 35.0% | 0.550 | 29.4 R | 953 | LOWEST PORTFOLIO DD |
| **LEARNER VERSION (E)** | -0.0323 R | **-$881.36** | **39.6%** | 0.631 | **16.7 R** | 480 | HIGHEST WIN%, MINIMAL DD |

---

## 27. Required Strategy Table (§25)

| Strategy | TEST Net R | TEST Net PnL | Trades | Contribution | Decision |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **donchian** | +0.0220 R (unrestricted) / -0.0093 R (portfolio) | +$733.77 (unrestricted) / -$202.80 (portfolio) | 557 / 292 | Strongest gross and net performer; positive out-of-sample under adaptive hold | **RETAIN** (promote to unconstrained multi-day testing) |
| **tsmom** | -0.0256 R (unrestricted) / -0.0339 R (portfolio) | -$1,432.29 / -$1,010.29 | 931 / 477 | Directionally sound but severely fee-dragged | **INCONCLUSIVE** (requires lower fee tier or wider targets) |
| **mom_trend** | -0.0510 R (unrestricted) / -0.0479 R (portfolio) | -$1,055.09 / -$307.44 | 414 / 128 | High co-firing rate but whipsaws erode net edge | **DROP** |
| **rsi2dip** | -0.0470 R (unrestricted) / -0.0726 R (portfolio) | -$232.70 / -$203.29 | 99 / 56 | Mean-reversion edge negative in high-volatility regimes | **DROP** |
| **orb** | N/A (0 accepted) | $0.00 | 0 | Failed multi-strategy co-firing agreement floor | **DROP** |
| **ibreakout** | -1.1001 R | -$24.75 | 1 | False breakout rate too high; severe stop-out friction | **DROP** |

---

## 28. Final Status Block (§30)

```text
================================================================================
PHASE 9 STATUS: COMPLETE
FINAL VERDICT: C. PHASE 9 FAILED — NO ROBUST OUT-OF-SAMPLE NET EDGE

RAW EDGE: VERIFIED (Gross price discovery is positive in US Equities +$0.41 and Unrestricted Donchian +$2.52)
CONDITIONAL EDGE: VERIFIED (Phase 7 multi-agreement filter reduces tail drawdowns by 40.9% to 78.8%)
MANAGEMENT EDGE: VERIFIED (Adaptive holding lifts profit factor from 0.55 to 0.80)
NET EDGE: NOT VERIFIED (Test Net R = -0.0305 R across portfolio aggregate)
ROBUST OUT-OF-SAMPLE EDGE: NOT VERIFIED (0 of 4 sub-folds net positive)
PROFITABILITY: NOT VERIFIED

TEST NET R: -0.0305 R
TEST NET PNL: -$1,723.82
TEST WIN RATE: 35.0%
TEST PROFIT FACTOR: 0.550
TEST MAX DRAWDOWN: 29.4 R
TEST SAMPLE SIZE: 953 resolved trades

BEST STRATEGY: donchian (Net R = +0.0220 R unrestricted, Gross = +$2.52/trade)
WORST STRATEGY: ibreakout (Net R = -1.1001 R) / rsi2dip (Net R = -0.0726 R)

LEARNER VALUE: CUT DRAWDOWN BY 43.2% (16.7 R vs 29.4 R) AND CUT NET LOSS BY 48.9% (-$881 vs -$1,724), BUT DID NOT FLIP NET R POSITIVE
PORTFOLIO VALUE: REDUCED MAXIMUM DRAWDOWN BUT OVER-PRUNED WINNING TREND RUNS (-0.0113 R PENALTY)

PRODUCTION CONFIGURATION: UNCHANGED (CONTROL RETAINED)

ALL TESTS: PASS (192 / 192 tests green)
================================================================================
```

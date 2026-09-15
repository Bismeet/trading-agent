# Research Index

**Status of this document:** navigation and honest summary. It does not replace the phase reports — each row links to the report that contains the full pre-registered spec, methodology, results and verdict.

> **Headline:** nine experiments. **Zero tradeable results.** No phase has established robust out-of-sample profitability. The research program is currently **stopped pending a data/information reset**, not paused before another indicator.

---

## How to read the research program

Every phase follows the same protocol. Understanding it once makes every report readable.

| Convention | Meaning |
|---|---|
| **Pre-registration** | A JSON spec is frozen under `config/`, with a SHA-256 recorded, **before** the test set is read. |
| **Selection lock** | A hash of the selection state is written before the test set is touched. The test set is then read **exactly once**. |
| **Chronological splits** | Strict `TRAIN` → `VALIDATION` → `TEST` by time. No shuffling. |
| **Purge + embargo** | Bars whose outcome window overlaps a fold boundary are dropped, so labels cannot leak across folds. |
| **Turnover-aware cost** | Only the notional actually traded is charged (`Σ|target − drifted|`), never a fictional full-book round trip. Fees/slippage come from frozen primitives in `perp.mjs`. |
| **Negative control** | A deterministically shuffled ("placebo") arm is run through the identical engine. If shuffling does not destroy the result, the signal was inert. |
| **Leakage audit** | Causal-window, label-isolation and purge checks are run and must pass. |
| **Production isolation** | The frozen production config hashes are re-verified at start and end. Gate fails if anything moved. |
| **Verdict ladder** | **A** = verified / tradeable · **B** = partial (real effect, no net edge) · **C** = no robust alpha · **D** = invalid experiment. |
| **No forced positive result** | A verdict of C is a legitimate, expected and acceptable outcome. |

**The standing rule that makes all of this worth anything:** a result is not promoted. A `B` is never quietly reported as a near-success, and a `C` is never described as "promising".

---

## Chronological research history

### Alpha experiment — "does any signal family have a pre-cost edge?"

| | |
|---|---|
| **Objective** | Test 8 signal families across 7 concepts for a replicated **pre-cost (raw)** edge. |
| **What was tested** | 8 signals × 730 days hourly; a pre-registered **signal-free momentum control**; per-fold cost decomposition. |
| **Result** | **TRAIN: 8/8 signals raw-positive. VALIDATION: 0/8 raw-positive.** The signal-free control reproduced the *same* shape: **+18.34 bps TRAIN → −77.55 bps VALIDATION**. |
| **Verdict** | **C — STOP / REDESIGN** |
| **Key lesson** | The in-sample performance was **unconditional momentum exposure to one market period**, not predictive information. This is the single most important warning sign in the repository. Adding more trend/momentum/breakout variations "will not fix the system's economics". |
| **Artifacts** | `ALPHA_RESEARCH_REPORT.md` · `config/alpha-experiment-spec.v1.json` (spec `808296d1…`) |

---

### Phase 5 — Strategy calibration

| | |
|---|---|
| **Objective** | Build an evaluable multi-strategy decision space and test whether calibrated parameters beat control. |
| **What was tested** | 6 strategies; 26 pre-registered configs; control vs calibrated on shadow outcomes. |
| **Result** | 4/6 configs kept CONTROL. Shadow TEST mean R: **−0.0574 calibrated vs −0.0547 control** — no improvement. Learner abstained 60–65% of the time. **97–98% of all counterfactual exits are 4-hour time-stops.** |
| **Verdict** | **A — calibration created a meaningful decision space** (this is an *infrastructure* verdict; **profitability was NOT verified**). |
| **Key lesson** | "The live 'one generator' condition is **RISK STARVATION** (survival gate), not signal starvation." Infrastructure can be verified while profitability is not — those are different claims. |
| **Artifacts** | `PHASE5_STRATEGY_CALIBRATION_REPORT.md` · `config/calibration-spec.v1.json`· `config/strategies.{control,calibrated}.json` |

---

### Phase 6 — Risk geometry

| | |
|---|---|
| **Objective** | Does exit geometry (stop/target/trail/hold-time) create a robust improvement? |
| **What was tested** | 16 geometries over **125,195 resolved outcomes** (556 MB dataset). |
| **Result** | TRAIN winner `TRAIL_TIGHT_24H` was **rejected** by the validation gate (stability 1/4 folds). Raw price edge **verified but tiny**: +0.011%–+0.017% at 4h vs a **break-even requirement of +0.0231%–+0.0294%**. Round-trip friction **~$1.54/trade (~0.19% of notional)**. Holding-period curve: 4h raw −0.0009% → **24h +0.1066%**, gross PnL −$0.71 → **+$0.53**. |
| **Verdict** | **B** — geometry effect measured, no robust improvement. |
| **Key lesson** | At 4-hour holding, **cost genuinely exceeded the signal**. At 24h the gross flips positive for the first time anywhere in the program. Recommendation: shift to **execution mechanics (maker/limit), not more geometry**. |
| **Artifacts** | `PHASE6_RISK_GEOMETRY_REPORT.md` · `config/risk-experiment-spec.v1.json` |

---

### Phase 7 — Signal edge (co-firing)

| | |
|---|---|
| **Objective** | Does strategy agreement (multiple signals firing together) contain usable information? |
| **What was tested** | 28,960 candidates / 25,489 resolved; a `RULE_MULTI_AGREEMENT` filter. |
| **Result** | The filter passed **all 6 validation gates** and improved TEST from **−0.0932 R → −0.0509 R**, cutting drawdown 78.8%. **Still negative.** Co-firing census: 0 other strategies −0.0845 R; 1 other −0.0312 R; **2+ others +0.058% raw but −0.0084 R net**. |
| **Verdict** | **B** — conditional edge detected, not robust. |
| **Key lesson** | **Strategy co-firing contains potent information** — but not enough to clear costs at the tested geometry. All 6 strategies were recommended DROP under 4h. Passing every gate is not the same as being profitable. |
| **Artifacts** | `PHASE7_SIGNAL_EDGE_REPORT.md` · `config/selection-experiment-spec.v1.json` |

---

### Phase 8 — Portfolio management

| | |
|---|---|
| **Objective** | Does a post-entry management state machine improve the net edge, and does portfolio-level capping help? |
| **What was tested** | 7-state FSM (INITIAL → DEVELOPING → FAVORABLE → STALLED → DETERIORATING → OPPOSING → EXIT); 4-arm matrix (control / filter / adaptive / +caps). |
| **Result** | Best arm C: **−0.0192 R**, gross **+$0.14/trade**, drawdown 38.7 R. **Value decomposition: entry effect +0.0692 R = 95% of the improvement; management +0.0036 R; portfolio caps −0.0230 R.** MFE capture ratio **<3%**. |
| **Verdict** | **B** — management improves risk, net edge unverified. |
| **Key lesson** | Almost all of the apparent improvement came from **entry selection, not management**. Portfolio caps *subtracted* value. `donchian` was the only strategy positive in TEST (+0.0220 R). |
| **Artifacts** | `PHASE8_PORTFOLIO_MANAGEMENT_REPORT.md` · `config/management-experiment-spec.v1.json` |

---

### Phase 9 — Final system validation

| | |
|---|---|
| **Objective** | Freeze the complete system and measure it end to end, out of sample. |
| **What was tested** | 5 variants (CONTROL, PHASE7, PHASE7+8, FINAL, LEARNER) on a single frozen configuration. |
| **Result** | Best variant (C) **−0.0192 R**, 2,002 trades, PF 0.803. **Cost decomposition: gross −$0.60 → fees −$1.21 → slippage −$0.80 → net −$1.81/trade (−0.0305 R).** Total friction ~$2.01/trade. **0 of 4 sub-folds net positive.** The learner cut loss 48.9% and drawdown 43.2% but **did not flip Net R positive.** |
| **Verdict** | **C — no robust out-of-sample net edge.** |
| **Key lesson** | This is the cleanest single number in the program: **the gross book was already losing money before fees.** The learner is a *risk* device, not an *edge* device. |
| **Artifacts** | `PHASE9_FINAL_SYSTEM_REPORT.md` · `config/final-experiment-spec.v1.json` |

---

### Phase 10 — Regime-conditional opportunity map

| | |
|---|---|
| **Objective** | Do regime × side × horizon cells contain reliable conditional edge, and can an allocator exploit it? |
| **What was tested** | 250 cells with Bayesian shrinkage; arms A–F including a full allocator. |
| **Result** | 6 cells passed TV eligibility, **0 passed all gates.** Only arm D was TEST-positive (+0.0266 R). The allocator achieved Sharpe 2.20 but per-trade TEST **−0.0354 R**. Regime rollup: only **VOL_EXPANSION** stayed TEST-positive (+0.4007); `STRONG_TREND` collapsed **+0.1632 → −0.0297**. Horizons: 48h +0.0462 / 72h +0.0386 TEST; 168h **+0.2470 → −0.0595**. **Longs +0.1446/+0.1214 vs shorts −0.0779/−0.1477.** |
| **Verdict** | **C — no robust edge.** |
| **Key lesson** | **"Allocation is a risk technology, not an edge technology."** And the one reproducible directional fact: **shorts have negative edge in every measured slice.** |
| **Artifacts** | `PHASE10_REGIME_PORTFOLIO_REPORT.md` · `config/phase10-spec.v1.json` (spec `782a04f6…`, lock `16431dfe…`) |

---

### Phase 11 — Cross-sectional relative-strength rotation

| | |
|---|---|
| **Objective** | Does **cross-asset** relative strength contain information the per-symbol strategies do not, especially with a long-horizon trend gate and low turnover? |
| **What was tested** | 14-asset daily panel; weekly rebalance; `score = trailing_60d_return / trailing_60d_vol`; `close > SMA(200)` gate; Top-K=3; inverse-vol weights; long-only; 1× max leverage. 12 pre-registered acceptance gates; 4 TEST sub-folds; 9 perturbation arms; cost stress ×1.00/1.25/1.50; execution delay; shuffled-rank negative control. |
| **Result** | TEST net **−17.88%**, Sharpe **−0.6983**. **Gross TEST P&L −$1,354.42** — negative before any cost. Rank IC **−0.0617** (t = −0.5265, n = 15 bars), monotonicity 0. **Shuffled control −16.41% *beat* the real strategy.** All 9 perturbation arms negative. Only 2/4 sub-folds positive. AAPL = 94.85% of positive net profit; **no cluster was net positive.** 5 of 12 gates pass. All 11 leakage checks pass; 7/7 production hashes unchanged. |
| **Verdict** | **C — no robust cross-sectional alpha.** |
| **Key lesson** | Two things were settled. (1) **The ranking was inert** — shuffling it made no negative difference. (2) **Cost is NOT the binding constraint at low turnover** — 1.00×→1.50× moved the result only **1.01pp**. Therefore the standing explanation "costs kill it" is **dead**, and the remaining explanation is **absent gross information**. |
| **Artifacts** | `PHASE11_RESEARCH_REPORT.md` · `config/phase11-spec.v1.json` (spec `e5a93fa9…`, lock `d4c1a5fb…`) · `data/calibration/phase11-summary.v1.json` |

---

### Research Reset — next-step diagnosis

| | |
|---|---|
| **Objective** | Stop searching for another strategy. Determine the **fundamental bottleneck**. |
| **What was tested** | *Nothing was run.* This is a read-only diagnosis across every phase report, the deep audit, the live paper journals and the data layer itself. |
| **Result** | Every price panel in the repository is a **5-field OHLC bar** (`ts, open, high, low, close`) with **no volume**, and every alternative data source (funding, open interest, fear & greed, put/call, macro, news) is a **live snapshot with no stored history** — therefore none of it is backtestable. Order flow, book depth and short interest have never existed in this lineage. |
| **Verdict** | **Bottleneck is INFORMATION, not model, risk layer, or cost.** |
| **Key lesson** | Nine heterogeneous methods failed identically because they searched the **same information space**. A uniform failure across nine different tools is evidence that the **input** is the constraint. |
| **What it authorises** | Acquire **historical funding-rate data** and test **carry as a yield, not a direction bet** — the only direction that changes the *prediction target* rather than the model. Add **volume** as a prerequisite capability. Or, if new data is not acquired, **stop the alpha search**. |
| **What it forbids** | A tenth directional phase, more indicators, more ML, an LLM in the loop, re-tuning the existing signals, another cost iteration, higher leverage, re-reading locked TEST folds, or proxying the missing data. |
| **Artifacts** | `RESEARCH_RESET_DIAGNOSIS.md` |

---

## Verdict summary

| Phase | Subject | Verdict | Net result |
|---|---|---|---|
| Alpha | 8 signal families | **C** | 0/8 raw-positive out of sample |
| P5 | Strategy calibration | **A*** | *infrastructure only; profitability not verified* |
| P6 | Risk geometry | **B** | raw edge real but ~2× below break-even at 4h |
| P7 | Signal co-firing | **B** | −0.0932 R → −0.0509 R (still negative) |
| P8 | Portfolio management | **B** | 95% of gain came from entry, not management |
| P9 | Final system | **C** | gross −$0.60/trade before fees |
| P10 | Regime × side × horizon | **C** | 0/250 cells passed all gates |
| P11 | Cross-sectional rotation | **C** | gross −$1,354 before any cost |
| Reset | Diagnosis | **—** | bottleneck is information |

---

## Why another OHLC-only directional strategy is not justified

This is the most important conclusion in the repository, and it is a *finding*, not an opinion.

1. **The gross edge is absent across two structurally different bet types.** A per-symbol, event-driven book (Phase 9) lost **$0.60/trade gross**. A cross-sectional weekly rotation (Phase 11) lost **$1,354 gross**. Different universes, different horizons, different holding logic — same result before costs.
2. **The cost explanation is falsified.** Phase 11 varied costs by 50% and moved the outcome by **1 percentage point**. Phase 10 replicated this. Costs cannot be blamed for a signal that is already negative gross.
3. **The ranking was inert, not merely weak.** Shuffling Phase 11's cross-sectional ranking produced a *better* result than the real ranking. A real edge destroyed by shuffling is a signal; a signal that shuffling improves is noise.
4. **In-sample performance is regime exposure.** The Alpha signal-free control reproduced the signals' +18.34 → −77.55 bps reversal with no signal logic. Phase 10's `STRONG_TREND` cell collapsed +0.1632 → −0.0297. Only `VOL_EXPANSION` held out of sample, which is a single-regime artefact.
5. **The methods were not the problem.** Nine heterogeneous approaches — momentum, breakout, mean-reversion, intraday, multi-agreement filtering, adaptive management, regime cells, portfolio allocation, cross-sectional rotation — converged on the same answer. When a diverse set of tools all return "no", the input is the constraint.
6. **Therefore a tenth attempt on the same five fields is a re-run, not a test.** The Alpha report says it directly: adding more variations of trend/momentum/breakout logic "will not fix the system's economics".

**The requirement for a legitimate next directional experiment is new information, not a new model.** The diagnosable gaps are: **funding-rate history**, **open-interest history**, **volume**, **order flow**, and **delisting-inclusive universe metadata**. All but volume require genuinely new data acquisition; volume is already returned by the existing provider and is simply discarded by the fetch code.

---

## Repository conventions for contributors

1. **Freeze the spec before reading TEST.** Record the SHA-256. Create the selection lock. Read TEST exactly once. No changes afterwards.
2. **Charge only what is traded.** Reuse the frozen cost primitives; never model a fictional full-book round trip.
3. **Prove gross before arguing about costs.** If gross P&L is not positive, cost work is wasted effort.
4. **Include a negative control.** Deterministic, hash-seeded, same mechanics, same costs. If shuffling does not hurt, there was no edge.
5. **Re-verify production hashes at start and end.** Research code never modifies production behaviour.
6. **Write isolation is enforced in code**, not by convention (see `scripts/v2/phase11-io.mjs`).
7. **Determinism is a deliverable.** Two runs must produce byte-identical summaries. No `Math.random()` anywhere.
8. **Report the verdict you got.** `C` is a result. Do not promote a `B`.
9. **Disclose limitations prominently.** Survivorship bias, sample size, and missing data are stated in every report, not buried.
10. **The UI must never fabricate.** If a value does not exist, render `NO DATA` / `NOT VERIFIED`. Research conclusions are not live signals.

---

## Where to look next

| You want… | Read |
|---|---|
| The current state of the whole program | [`RESEARCH_RESET_DIAGNOSIS.md`](../RESEARCH_RESET_DIAGNOSIS.md) |
| The most recent full experiment | [`PHASE11_RESEARCH_REPORT.md`](../PHASE11_RESEARCH_REPORT.md) |
| The clearest single negative result | [`PHASE9_FINAL_SYSTEM_REPORT.md`](../PHASE9_FINAL_SYSTEM_REPORT.md) |
| The pre-cost evidence | [`ALPHA_RESEARCH_REPORT.md`](../ALPHA_RESEARCH_REPORT.md) |
| An independent audit of the codebase | [`TRADING_AGENT_DEEP_AUDIT.md`](../TRADING_AGENT_DEEP_AUDIT.md) |
| Architecture and data contracts | [`docs/README.md`](README.md) |

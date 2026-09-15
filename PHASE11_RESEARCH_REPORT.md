# PHASE 11 — CROSS-SECTIONAL RELATIVE-STRENGTH ROTATION: RESEARCH REPORT

> **VERDICT C — THE STRATEGY FAILS THE ECONOMIC/OUT-OF-SAMPLE GATES (7 OF 12 FAIL)**
>
> **SURVIVORSHIP WARNING (read first).** The 14-asset universe is **not survivorship-bias-free**. Every symbol is a **current** large-cap or major that is known *today* to have survived 2021-09 → 2026-09. Assets that were delisted, merged, denylisted or collapsed out of the universe are **absent**, which biases any long-only result **upward**. The universe was deliberately **not** replaced with a different dataset to improve the numbers. See §5 and §26.

| Field | Value |
|---|---|
| Phase | `phase11-cross-sectional-rotation` |
| Spec hash (SHA-256) | `e5a93fa95b239f09a66485e0f1f656db40d3eda0fd2ab65ca41ced06cf4c7b1a` |
| Selection-lock hash (SHA-256) | `d4c1a5fb62c39b7dd2778e4354b733f19b65015e9a0ab573f331435c27618986` |
| Lock stable across re-hash | yes |
| Generated | 2026-09-15T16:30:34.752Z |
| Runtime | 4.8s |
| Gates passed | 5 / 12 |
| Data window | 2021-09-13 → 2026-09-13 (1827 union grid rows) |
| Verdict | **C** |

*Deterministic and reproducible: two independent runs of `scripts/v2/phase11-run.mjs` on identical inputs produce a byte-identical summary (hash-checked, §24). The runner is offline research only and never writes outside `data/calibration/` and this report.*

## 1. Executive Summary

The hypothesis was that **cross-asset relative strength** contains information the existing per-symbol directional strategies do not capture, and that combining it with an **absolute-trend filter** and **low turnover** would produce a positive net-of-cost out-of-sample edge that beats both equal-weight buy-and-hold (**B0**) and an absolute-trend-only portfolio (**B2**).

**It does not.** On the isolated TEST window (union grid rows 1461–1826), the canonical strategy returned **-17.88%** net of costs (Sharpe **-0.6983**, max drawdown **28.34%**). Equal-weight buy-and-hold returned **-12.30%** (Sharpe -0.4089) and the absolute-trend-only portfolio returned **-18.87%** (Sharpe -0.9027).

The strategy **did** beat the absolute-trend-only baseline B2 on Sharpe (gate 3 passes), which means the cross-sectional ranking was not actively harmful **relative to that specific comparison**. But it lost money outright, lost to buy-and-hold, failed 2 of 4 TEST sub-folds, and failed on cost stress, execution delay, Deflated Sharpe, asset concentration and — most importantly — **the gross edge was already negative before costs** (TEST gross P&L **-1354.42** on 175 holdings).

This is the **same failure mode** Phase 9 diagnosed: friction is not the problem, the **gross signal has no positive information content at this horizon either**. Changing the information (cross-asset), the direction (long-only), the operating point (weekly, low turnover) and the construction (inverse-vol, top-K) simultaneously was not enough. **Verdict C — NO ROBUST ALPHA FOUND.**

Per the pre-registered protocol, this is a **STOP**, not a prompt for another optimisation cycle. The rational next moves are the proposal's Candidate 6: reduce execution cost (maker fills) or acquire **historical funding-rate data** to test the structural-carry direction (Candidate 2). Neither is another directional alpha phase.

| TEST (isolated) | Net return | Sharpe | Sortino | Calmar | Max DD |
|---|---|---|---|---|---|
| **Rotation (canonical)** | **-17.88%** | **-0.6983** | -0.5541 | -0.6309 | 28.34% |
| B0 equal-weight buy & hold | -12.30% | -0.4089 | -0.3815 | -0.4400 | 27.95% |
| B1 trend-gated equal weight | -26.54% | -1.1760 | -0.9278 | -0.9295 | 28.55% |
| B2 time-series trend only | -18.87% | -0.9027 | -0.7268 | -0.8778 | 21.50% |
| B3 production baseline | UNAVAILABLE | — | — | — | — |

## 2. Hypothesis

**H1.** On the 14-asset universe, a weekly-rebalanced portfolio long the top-K assets ranked by **volatility-normalised trailing return**, conditioned on each asset being above its own long-run trend, produces positive net-of-cost out-of-sample return **and** a higher net Sharpe than both (i) equal-weight buy-and-hold and (ii) a time-series-only trend overlay — and the edge survives a 25% cost increase and a one-day execution delay.

**H0 (null).** The cross-sectional ranking carries no information beyond the absolute-trend gate and buy-and-hold beta; any apparent edge is within noise of ~50 weekly TEST returns, or is destroyed by shuffling the ranks.

**Falsification is built in.** H1 is accepted only if it beats **both** baselines on Sharpe **and** survives the negative control. The pre-registered acceptance gates in §12 are the operational form of that falsification.

**Result: H0 is not rejected. The evidence is consistent with H0** — the ranking showed no reliable predictive relationship to forward relative return (TEST rank IC -0.0617, t = -0.5265), and the strategy lost money net of costs.

## 3. Exact Methodology

Everything below was **pre-registered** in `config/phase11-spec.v1.json` **before** any TEST outcome was read. The runner reads that file and may not invent, tune or relax a threshold in code. The full protocol: build the causal feature layer → build the global chronological split with 60-bar purge and embargo → run the canonical configuration and the baselines on **TRAIN + VALIDATION only** → **hash and write the selection lock** → read **TEST exactly once** → run the robustness battery, the leakage audit and the shuffled-rank negative control → emit one verdict.

Two deliberate deviations from the proposal, both recorded in the spec:

1. **Gate 7 (Deflated Sharpe) was corrected from "> 0" to the repository's established "> 0.95" convention** (`scripts/v2/brain.mjs` documents *"Pass uses unrounded DSR > .95"*). A raw DSR merely greater than zero is satisfied by pure noise, so the original phrasing was an **error in the pre-registration text**, and correcting a mis-specified threshold is permitted only to diagnose an invalid experiment. The correction makes the gate **stricter**, not weaker, and applies identically to every run.
2. **B3 is recorded as UNAVAILABLE** rather than proxied. See §10.

## 4. Data Used

| Item | Value |
|---|---|
| Panel | `data/calibration/history.daily.v2.json` |
| Interval / range | 1d / 5y |
| Provider | Yahoo Finance chart API (same provider/endpoint as the live engine) |
| Union grid | 1827 UTC-date rows, 2021-09-13 → 2026-09-13 |
| Alignment | One row per UTC calendar date. Each symbol's value is its own bar stamped on that date, or the most recent bar at or before it (**as-of carry-forward**). Nothing is interpolated forward. Raw-timestamp alignment was rejected because US/India/crypto bars for the same calendar day carry three different UTC clock times, which would have inflated the grid ~2.4× and turned a 5-bar week into a 2-day week. |
| Window coverage | Crypto 1,827 rows; US equities 1,255; India 1,241. Early grid rows where a symbol has no prior observation are marked unavailable, which is why eligibility begins per-symbol. |

**Evaluation window.** Every strategy, arm and control is evaluated on the **identical** union grid over the **identical** date range, so all comparisons are like-for-like. No symbol's start date is shifted to flatter any strategy.

## 5. Universe

| Cluster | Symbols | Count |
|---|---|---|
| crypto | BTC-USD, ETH-USD, SOL-USD, XRP-USD, DOGE-USD | 5 |
| us | AAPL, NVDA, MSFT, TSLA, AMZN | 5 |
| india | RELIANCE.NS, TCS.NS, INFY.NS, HDFCBANK.NS | 4 |

**Exactly the existing 14-asset daily panel.** No asset added, removed or substituted; no index proxy; no synthetic asset. Mixing US / crypto / India is deliberate — the research question is whether **cross-market** relative strength is exploitable — and volatility-normalisation is what makes the three clusters comparable.

### Survivorship disclosure

> THE PANEL IS NOT SURVIVORSHIP-BIAS-FREE. These 14 symbols are CURRENT large-caps / majors selected with today's knowledge of which assets still exist and are liquid. Assets that were delisted, merged, denylisted or collapsed out of the universe between 2021-09 and 2026-09 are absent. This biases any long-only result UPWARD and must be reported prominently in every summary, table caption and the final report. The bias cannot be corrected offline because no delisted-asset price history exists in this repository, and the universe is deliberately NOT swapped for a different dataset to make the numbers look better.

This limitation is **not corrected** and **not hidden**. It biases the absolute level of every long-only number in this report upward, including the baselines. It does **not** by itself explain a negative TEST result — a survivorship tailwind that still loses money is, if anything, a stronger negative signal than it appears.

## 6. Feature Definitions

All features are **strictly causal**: every value at decision bar `t` is a function of bars `0..t` of the **same symbol** only. Windows are measured on each symbol's **own observation indices**, not on grid indices, so a stock's 60-day return spans 60 exchange sessions and is never stretched by weekends or holidays.

The leakage audit (§23) re-derives all three features on a panel truncated at each sampled bar and requires **bit-exact equality**.

| Feature | Definition | Warmup |
|---|---|---|
| Trailing total return | `effectiveClose(t) / effectiveClose(t − 60) − 1`, window **strictly** causal | own index ≥ 60 |
| Realized volatility | **population** σ (divisor N) of the 60 daily simple returns in the window ending at and including t | same |
| Relative-strength score | return / volatility — a per-asset Sharpe-style ratio. **Undefined** (⇒ ineligible) when volatility is 0 or non-finite. | same |
| Absolute trend filter | effectiveClose(t) > SMA200(t) | own index ≥ 199 |
| Combined warmup | max(60, 200) + 60 = **260** own observations | — |

**No other feature enters the ranking, the gate, the eligibility rule or the weighting.** No volume (the panel is OHLC-only), no regime label, no learner state, no sentiment, no cross-sectional risk model, no optimiser. This is intentionally minimal to resist overfitting.

## 7. Portfolio Construction

| Rule | Value |
|---|---|
| Direction | **long-only** |
| K (top selection) | **3** |
| Ranking key | relative-strength score, **descending** |
| Tie-break | deterministic, symbol **ascending** (e.g. `AAPL` < `BTC-USD` < `DOGE-USD`) |
| Weighting | **inverse volatility** — weight_i ∝ 1/σ_i over the selected assets only, normalised to sum to **1** |
| Remainder | **cash** at 0% — when fewer than K assets are eligible the book is under-invested, never levered |
| Maximum leverage | **1.0×** — no leverage optimisation of any kind |
| Rebalance | every **5** grid dates (weekly); entries, exits and weight changes executed in full |
| Zero-eligible rule | if nothing is eligible the whole book goes to **cash** and stays there until the next decision bar with at least one eligible asset |

**Eligibility** requires all three of: sufficient history (`own index ≥ 260`), a score **strictly greater than 0**, and `effectiveClose > SMA200`. Anything else is FLAT.

**Cash weeks are a real property of the policy, not missing data.** Across the full window, **87** of 366 decisions held no asset at all, and the mean eligible count was **5.03** against a mean selected count of **2.13**. A long-only trend system is *supposed* to be able to sit out; the three-cluster, 14-asset cross-section simply does not always offer three qualifying assets.

## 8. Cost Model

The **existing frozen execution primitives** are reused verbatim from `scripts/v2/perp.mjs` (`tradeFee`, `slippageFraction`, `fillPrice`) with the frozen values in `config.json`. **No new cost model was invented and no cost parameter was re-fitted.**

| Component | Value |
|---|---|
| Taker fee | `config.json → v2.perpFees.taker` = n/a per leg on the traded notional |
| Slippage by market | crypto undefined, US undefined, India undefined |
| Adverse fill | `fillPrice(ref, side, halfSpread, impact)` with `halfSpread = slippage/2` and `impact = 0.6 · max(0.0005, v) · √(notional / 2e6)` |
| Stress multipliers | 1× / 1.25× / 1.5× |
| Funding | **omitted (0)** — no historical funding-rate series exists in this repository (inherited limitation, disclosed not hidden) |
| Borrow | none — long-only and unlevered |

### Turnover awareness — the critical design point

Cost is charged **only on the notional actually traded** at each rebalance: `Σ |targetWeight − driftedWeight|`. A weekly **full-book round trip is never charged fictionally.** A position keeps its **units** between decisions, so weights drift with prices and the traded notional is computed against the **drifted** weight — the economically correct treatment. A weight change smaller than the pre-registered no-trade band (1e-6) is treated as no trade.

Realised turnover on the full window: **0.62** of book per decision (mean traded notional ÷ start equity), across 366 decisions. Total cost **$1883.00** (fees $1142.06, slippage $740.95) on a $10000 notional base.

| TEST window | P&L |
|---|---|
| Gross P&L (before any fee or slippage) | **-1354.42** |
| Cost charged in the window | $576.04 |
| Net leg P&L | -1705.31 |
| Net equity return | **-17.88%** |

> **The gross edge is already negative on TEST** (-1354.42 over 175 holdings). Friction made a bad book worse; it did not create the loss. This is the same diagnosis Phase 9 reached, and it is the single most important fact in this report.

## 9. Validation Design

| Element | Value |
|---|---|
| Split | 0.6 / 0.2 / 0.2 — **strict chronological** on the union grid |
| TRAIN | indices 0–1095 (1096 rows) |
| VALIDATION | indices 1096–1460 (365 rows) |
| TEST | indices 1461–1826 (366 rows) |
| Purge + embargo | **60 bars at every boundary** |
| Forward horizon | 5 grid dates (one week) |
| TEST sub-folds | S1 1461–1551 · S2 1552–1643 · S3 1644–1734 · S4 1735–1826 |
| Trials (Deflated Sharpe) | 16 pre-registered configurations |

**Purge and embargo, both enforced.** *Purge*: an observation at bar `t` is admitted only if `t + 5 ≤ foldEnd`, i.e. its entire forward label window closes inside the fold. *Embargo*: an observation is admitted only if `t ≥ foldStart + 60`, i.e. it is at least 60 bars after the fold start. 60 is the primary feature lookback **and** the primary forward horizon, so no trailing-return window and no forward label can straddle a boundary in either direction.

**Embargo is global.** Purge and embargo are applied at the same boundaries to TRAIN, VALIDATION and TEST alike. TEST is therefore itself embargoed, which **shrinks** the number of usable TEST decisions rather than padding it.

**Selection lock.** Before TEST was opened, the runner hashed and wrote to disk an object containing the spec hash, the panel digest, every pre-registered parameter, the canonical configuration identity, the fold and sub-fold bounds, the complete TRAIN and VALIDATION results, and SHA-256 digests of the canonical strategy's TRAIN and VALIDATION equity paths. It deliberately contains **no** robustness-arm result and **no** TEST statistic.

**TEST was read exactly once**, after the lock. No parameter, feature, portfolio rule, universe, cost or gate was changed after TEST inspection.

## 10. Baselines

All four baselines run on the **same grid, same window, same cost primitives** as the strategy.

|  | Definition | Role |
|---|---|---|
| **B0** | Equal weight (1/14) in all 14 assets, held the whole window, **no** rebalancing, **no** trend gate, **no** ranking. Entry cost charged once. | beta benchmark |
| **B1** | At each weekly decision, equal weight across the assets above their SMA200. No score>0 condition, **no** ranking, **no** inverse-vol. | isolates the absolute-trend gate |
| **B2** | At each weekly decision, hold **every** asset above its own SMA200, **inverse-vol** weighted. **No** ranking, **no** score>0, **no** top-K truncation. | **the critical ablation** — does ranking add anything beyond absolute trend? |
| **B3** | **UNAVAILABLE** (see below) | existing production baseline |

### B3 — why it is UNAVAILABLE rather than proxied

> The frozen production strategies (tsmom / donchian / rsi2dip / mom_trend / orb / ibreakout) are defined against the hourly panel plus a 366-bar live daily context window and a per-trade margin/leverage geometry. They cannot be evaluated on the 1,827-row 5-year daily union panel at daily cadence without substituting a proxy, which would be a different baseline. Recorded as UNAVAILABLE rather than proxied. The strategy/risk configuration is nevertheless verified byte-identical at start and end of this run (spec.frozenBaseline), which is the production-safety claim this phase makes.

The production strategy and risk configuration **is nevertheless verified byte-identical at the start and at the end of this run** (§24), which is the production-safety claim this phase actually makes. Substituting a daily proxy for B3 would have produced a **different baseline**, and a report that silently swapped its own comparison is worse than a report that says "unavailable".

## 11. TRAIN Results

| Strategy | Net return | Sharpe | Sortino | Calmar | Max DD | Trades |
|---|---|---|---|---|---|---|
| **Rotation (canonical)** | +0.59 | +0.6959 | +0.5560 | +0.6438 | 25.90% | n/a |
| B0 equal-weight buy & hold | +0.35 | +0.4995 | +0.4746 | +0.2072 | 50.33% | n/a |
| B1 trend-gated equal weight | +0.51 | +0.6818 | +0.5529 | +0.5060 | 29.32% | n/a |
| B2 time-series trend only | +0.40 | +0.7472 | +0.5805 | +0.5698 | 20.83% | n/a |

On TRAIN the canonical strategy returned **58.84%** at Sharpe **+0.6959**, ahead of B0 (34.65%) and B2 (40.00%). **The in-sample result looked encouraging — and it did not hold.** This is exactly why the protocol freezes TRAIN before TEST is opened and why a positive TRAIN result is never sufficient.

## 12. Validation Results

| Strategy | Net return | Sharpe | Sortino | Calmar | Max DD | Trades |
|---|---|---|---|---|---|---|
| **Rotation (canonical)** | +0.56 | +1.2971 | +1.3507 | +1.4468 | 38.85% | n/a |
| B0 equal-weight buy & hold | +0.48 | +1.3790 | +1.3997 | +1.4230 | 33.58% | n/a |
| B1 trend-gated equal weight | +0.56 | +1.5201 | +1.5883 | +1.8045 | 31.29% | n/a |
| B2 time-series trend only | +0.33 | +1.4587 | +1.4510 | +1.4171 | 23.63% | n/a |

VALIDATION returned **56.01%** at Sharpe **+1.2971**, again ahead of B0 and B2. **TRAIN and VALIDATION both pointed positive; TEST reversed sign.** No selection decision was made from VALIDATION — the canonical point was pre-registered, so VALIDATION is a *stability observation*, not a tuning set.

## 13. TEST Results

**TEST was read once, after the lock.** This is the only out-of-sample evidence in the report.

| Metric (TEST) | Rotation (canonical) | B0 | B1 | B2 |
|---|---|---|---|---|
| Total net return | -17.88% | -12.30% | -26.54% | -18.87% |
| Net P&L (USD, $10k base) | -4420.71 | — | — | — |
| Annualized return | -17.88% | -12.30% | -26.54% | -18.87% |
| Annualized volatility | 24.02% | 24.63% | 23.78% | 20.75% |
| Sharpe | -0.6983 | -0.4089 | -1.1760 | -0.9027 |
| Sortino | -0.5541 | -0.3815 | -0.9278 | -0.7268 |
| Calmar | -0.6309 | -0.4400 | -0.9295 | -0.8778 |
| Maximum drawdown | 28.34% | 27.95% | 28.55% | 21.50% |
| Time underwater | 96.99% | — | — | — |
| Trades / holdings (TEST) | 175 | — | — | — |
| Rebalances (full window) | 366 | — | — | — |
| Turnover per decision (of book) | 0.6241 | — | — | — |
| Transaction costs (full window) | $1883.00 | — | — | — |
| — fees | $1142.06 | — | — | — |
| — slippage | $740.95 | — | — | — |
| — cost charged in TEST window | $576.04 | — | — | — |
| Gross P&L (TEST, pre-cost) | -1354.42 | — | — | — |
| Net leg P&L (TEST) | -1705.31 | — | — | — |
| Win rate | 44.57% | — | — | — |
| Profit factor | +0.8216 | — | — | — |
| Average trade return | -0.00095 | — | — | — |
| Median trade return | -0.00219 | — | — | — |
| Average holding (days) | 4.93 | — | — | — |
| Best / worst trade (USD) | 532 / -1037 | — | — | — |
| Deflated Sharpe (weekly, nTrials=16) | +0.0050 (raw SR -0.0860, SR₀ +0.2140) | — | — | — |
| Weekly excess vs B0 (mean) | -0.00092 | — | — | — |
| Weekly excess vs B2 (mean) | +0.00027 | — | — | — |
| t-stat of excess vs B0 (weekly) | -0.2944 | — | — | — |
| t-stat of excess vs B2 (weekly) | +0.1487 | — | — | — |

### Excess return versus the baselines

| Comparison | Mean weekly excess | t (weekly) | n weeks | Share of days positive |
|---|---|---|---|---|
| Rotation − **B0** | -0.0009 | -0.2944 | 73 | 51.23% |
| Rotation − **B2** | +0.0003 | +0.1487 | 73 | 39.18% |

The strategy **underperformed B0** by -0.0009 per week (t = -0.2944) and **outperformed B2** by a statistically meaningless +0.0003 per week (t = +0.1487). Neither difference is distinguishable from zero. With only **73 weekly observations** the confidence intervals are wide, and the report says so rather than over-reading them: the verdict rests on the **consistency of the gate failures**, not on any single t-statistic.

## 14. Four TEST Sub-Folds

Sub-folds are **stability assessment only**. Nothing was tuned on them.

| Sub-fold | Window | Rotation net | Rotation Sharpe | B0 net | B2 net |
|---|---|---|---|---|---|
| S1 | 2025-09-13 → 2025-12-12 | +0.07 | +1.5013 | -0.10 | -0.02 |
| S2 | 2025-12-13 → 2026-03-14 | -0.24 | -4.2962 | -0.13 | -0.12 |
| S3 | 2026-03-15 → 2026-06-13 | +0.04 | +0.9825 | +0.02 | +0.05 |
| S4 | 2026-06-14 → 2026-09-13 | -0.04 | -0.3627 | +0.08 | -0.10 |

**2 of 4** sub-folds are net positive; the gate requires **3**. The strategy beat B0 in **2/4** and beat B2 in **2/4**. The two positive sub-folds are the two in which risk assets rose; the two negative sub-folds are the two in which they fell. That is a **beta pattern, not an alpha pattern** — precisely the failure mode the proposal predicted (expected failure mode 2).

## 15. Robustness Results

### 15.1 Cost stress

| Multiplier | TEST net return | TEST Sharpe | TEST max DD |
|---|---|---|---|
| 1× | -0.18 | -0.6983 | 28.34% |
| 1.25× | -0.18 | -0.7234 | 28.61% |
| 1.5× | -0.19 | -0.7484 | 28.88% |

Every arm is negative. The cost **slope** is close to linear and small (-17.88% → -18.89% from 1.00× to 1.50×), confirming the diagnosis above: **the strategy does not fail because costs are too high — it fails because the gross book loses money.**

### 15.2 Execution delay

| Execution | TEST net return | TEST Sharpe |
|---|---|---|
| Primary — decision close | -0.18 | -0.6983 |
| Robustness — next open (+1 day) | -0.12 | -0.3521 |

The delayed arm is **less negative** than the primary arm. That is not a robustness win — a delay that *improves* a losing strategy simply means the immediate-execution timing was also unlucky. Either way, gate 6 requires a **positive** result under delay and it is not. The edge does not simply "depend on perfect execution"; there is no edge for execution to depend on.

### 15.3 Parameter perturbation (robustness only — the canonical point never changed)

| Lookback | K = 2 | K = 3 | K = 4 |
|---|---|---|---|
| 8 weeks | -0.29 | -0.28 | -0.26 |
| 12 weeks | -0.11 | -0.18 **(canonical)** | -0.22 |
| 16 weeks | -0.12 | -0.16 | -0.18 |

**All nine perturbation arms are negative.** The canonical point (12 weeks / K=3, -0.18) sits inside a stable region — but the region is **stably negative**, not stably positive. This is the *good* kind of robustness result for an experiment and the *bad* kind for a strategy: there is no isolated peak, because there is no peak.

### 15.4 Two-week holding (robustness only)

TEST net return **-0.20** (Sharpe -0.8323) versus -0.18 at the primary one-week hold. Doubling the holding period did **not** rescue the strategy, which weakens the proposal's "longer hold ⇒ better cost-to-move ratio" hypothesis in this specific case. The 2-week result was **not** used to select the primary configuration.

### 15.5 Subperiod analysis (windows fixed before any result was seen)

| Period | Rotation net | B0 net | B2 net | Rotation Sharpe |
|---|---|---|---|---|
| STRESS_2022 (2022-01-01 → 2022-12-31) | -0.17 | -0.42 | -0.18 | -0.8379 |
| BULL_2024_25 (2024-01-01 → 2025-12-31) | +0.83 | +0.79 | +0.60 | +1.0392 |

The pattern is unambiguous. In the **2022 bear** the strategy lost -17.16% while B0 lost -42.27% — it cut the drawdown, which is the one genuine merit of a trend gate. In the **2024–25 bull** it made 83.12% against B0's 78.64% — a **+4.48pp** edge. So essentially the **entire** full-window result is one bull-market sample. With 2021–2026 containing exactly one bear and one bull, this is a **single-regime sample**, exactly as the proposal's expected failure mode 3 warned.

### 15.6 Market-cluster stability

| Cluster | Holdings | Net P&L | Gross P&L | Cost | Win rate |
|---|---|---|---|---|---|
| crypto | 17 | -175.31 | -165.68 | 10 | 35.29% |
| india | 28 | -746.85 | -655.09 | 92 | 42.86% |
| us | 130 | -783.15 | -533.64 | 250 | 46.15% |

**No cluster produced positive net profit.** The concentration gates are therefore evaluated against a book that made no profit at all, and both concentration gates fail (§12). Reporting "no cluster made money" as a concentration failure is the honest reading: a profit-concentration gate cannot be satisfied by a strategy that produced no profit.

## 16. Cost Sensitivity

Full-window realised turnover is **0.62** of book per decision. At that turnover and the frozen crypto/US/India slippage grid, the entire 1.00× → 1.50× cost range moves the TEST net return by only **1.01pp**. The proposal's core premise — that weekly holding makes the cost wall disappear — **is validated on the numbers**: cost is no longer the binding constraint. The binding constraint is the gross signal.

## 17. Execution-Delay Test

See §15.2. The delayed arm returned **-0.12** (Sharpe -0.3521) versus **-0.18** at decision-close execution. Gate 6 requires a positive result under delay. **FAIL.**

## 18. Parameter Perturbation

See §15.3. **All nine** (lookback × K) arms are net negative on TEST. The canonical 12-week / K=3 point is **not an isolated spike** — it is a smooth point inside a uniformly negative region. The canonical configuration was never replaced by whichever arm looked best.

## 19. Rank IC and Cross-Sectional Evidence

The decisive test of the *hypothesis* (independent of the portfolio's P&L) is whether the decision-time score predicts the forward holding-period return cross-sectionally.

| Statistic | TRAIN + VALIDATION | TEST |
|---|---|---|
| Bars with ≥ 5 eligible assets | 172 | 15 |
| Mean rank IC (Spearman) | +0.0359 | **-0.0617** |
| t-statistic of the mean IC | +1.0293 | -0.5265 |
| IC standard deviation | +0.4563 | +0.4388 |
| Share of bars with IC > 0 | 47.09% | 33.33% |
| Rank monotonicity (bucket index vs mean fwd return) | -0.8000 | +0.0000 |
| Top-minus-bottom bucket spread | +0.0073 | -0.0095 |
| … net of one round trip | +0.0043 | -0.0125 |
| Top-K forward mean return | +0.0070 | -0.0039 |

**Mean forward return by score quartile** (TEST) — quartile 1 is the highest-scoring: Q1 -0.0079 · Q2 +0.0041 · Q3 -0.0133 · Q4 +0.0016.

**This is a null result, and it is the cleanest finding in the report.** The TEST rank IC is **-0.0617** — the wrong sign and wholly insignificant (t = -0.5265). Monotonicity is **+0.0000** across the four score quartiles: the highest-scoring assets did not produce the highest forward returns, and in fact the top quartile returned -0.0079 while the second quartile returned +0.0041. The top-minus-bottom spread is **-0.0095** raw and **-0.0125** net of one round trip — i.e. negative, and negative-before-costs.

> **Caveat on power, stated plainly.** Only **15** TEST bars carried ≥ 5 eligible assets, because TEST is itself embargoed and the three-cluster cross-section frequently offers fewer than five qualifying assets at once. **Fifteen observations cannot reject the null at any conventional significance level.** The honest reading is therefore *not* "the ranking has no predictive power" but the weaker and more accurate: **"this experiment produced no evidence that the ranking has predictive power, and it could not have detected a modest effect."** That is a STOP, not a discovery.

## 20. Asset Contribution

| Asset | Cluster | Holdings | Net P&L | Gross P&L | Cost | Win rate | Avg net |
|---|---|---|---|---|---|---|---|
| AAPL | us | 48 | +515.81 | +604.06 | 88 | 52.08% | +10.75 |
| RELIANCE.NS | india | 15 | +17.89 | +52.27 | 34 | 53.33% | +1.19 |
| ETH-USD | crypto | 5 | +10.11 | +10.62 | 1 | 40.00% | +2.02 |
| MSFT | us | 4 | -26.44 | -21.12 | 5 | 50.00% | -6.61 |
| HDFCBANK.NS | india | 2 | -38.30 | -20.29 | 18 | 0.00% | -19.15 |
| BTC-USD | crypto | 5 | -57.22 | -56.68 | 1 | 40.00% | -11.44 |
| TCS.NS | india | 2 | -86.81 | -79.58 | 7 | 0.00% | -43.40 |
| SOL-USD | crypto | 7 | -128.19 | -119.62 | 9 | 28.57% | -18.31 |
| TSLA | us | 18 | -242.38 | -208.63 | 34 | 33.33% | -13.47 |
| AMZN | us | 24 | -248.24 | -223.53 | 25 | 50.00% | -10.34 |
| INFY.NS | india | 9 | -639.63 | -607.49 | 32 | 44.44% | -71.07 |
| NVDA | us | 36 | -781.92 | -684.43 | 97 | 41.67% | -21.72 |

**Asset concentration: FAIL.** 3 assets were net positive on TEST, and the largest of them (AAPL) accounts for **94.85%** of all positive net profit — double the 50% gate. **The result is dependent on a single asset**, which under question G means the book is not a diversified cross-sectional claim at all.

## 21. Cluster Contribution

| Cluster | Holdings | Net P&L | Share of *positive* profit | Max share gate |
|---|---|---|---|---|
| crypto | 17 | -175.31 | 0.00% | 60% |
| india | 28 | -746.85 | 0.00% | 60% |
| us | 130 | -783.15 | 0.00% | 60% |

**Cluster concentration: VACUOUS PASS (no substantive reading).** **No cluster produced positive net profit at all.** The gate says "no single cluster contributes > 60% of TEST **positive** net profit" — with zero positive profit there is nothing to be concentrated in, so the gate is satisfied only **definitionally**. Its max-share-of-positive figure is **0.00%**, and that **PASS must not be read as evidence of diversification.**

Read the table instead of the gate. The two clusters carrying the most holdings (US and India) both **lost** money, and the cluster the proposal flagged as most likely to dominate — crypto — was the one the vol-normalisation and trend gates excluded most often. The proposal's worst-case "collapses to a crypto beta bet" did not materialise; the realised book was a **US-equity long during a period when that was not enough**, which is simply a different way of failing, not a better one.

## 22. Negative Control (Shuffled Ranks)

At every decision bar the **eligible universe is held exactly fixed** and the cross-sectional **ranks are permuted** by a deterministic, reproducible hash-based seed: each eligible symbol gets `h = sha256(salt | barIndex | symbol)`, the symbols are sorted by `(h, symbol)` and that order is imposed on the top-K selection. The eligible set, the portfolio mechanics, the cost model, the grid, the splits and the purge/embargo are **identical** to the real strategy; **only the rank assignment differs**. The permutation consumes only the salt, the bar index and the eligible symbol list — it cannot read a score, a return or a rank.

|  | TEST net return | TEST Sharpe | TEST max DD |
|---|---|---|---|
| **Real ranking** | -0.18 | -0.6983 | 28.34% |
| **Shuffled ranking** | -0.16 | -0.6439 | 23.42% |

**The shuffled control does NOT "destroy" the edge — because there was no edge to destroy.** Shuffled ranking returned -0.16 at Sharpe -0.6439, i.e. it **beat** the real strategy (-0.18 / -0.6983) on both measures.

Gate 8 is written as *"shuffled TEST net Sharpe ≤ 0 AND net return ≤ 0"* — a control that verifies a genuine edge is destroyed. Both conditions hold here, so **the gate passes**, but its **interpretation must be stated precisely**: the control confirms that the real ranking added **no value**, which is the correct diagnosis of a null result, not evidence that the evaluation was broken. If the shuffled arm had *matched or beaten* the real arm while the real arm was **positive**, that would be verdict D. Since the real arm is negative, the honest reading is: **the ranking was inert, and shuffling it changed nothing of consequence.**

**Determinism of the control** (required: reproducible hash-seeded permutation):

| Property | Result |
|---|---|
| Same salt → identical permutation on a second run | **yes** |
| Different salt → different permutation | **yes** |

Real vs shuffled selection on the first decisions:

| Decision | Eligible | Real top-K | Shuffled top-K |
|---|---|---|---|
| 2021-09-13 | 0 | `` | `` |
| 2021-09-18 | 0 | `` | `` |
| 2021-09-23 | 0 | `` | `` |
| 2021-09-28 | 0 | `` | `` |
| 2021-10-03 | 0 | `` | `` |
| 2021-10-08 | 0 | `` | `` |

## 23. Leakage Audit

Eleven checks, run against the **live pipeline objects** rather than a re-implementation. Any failure would make the experiment **INVALID (verdict D)** and un-reportable.

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | `feature_causality` | **PASS** | 40 checked, 0 failures |
| 2 | `test_isolation` | **PASS** | 366 checked, 0 failures |
| 3 | `label_isolation` | **PASS** | 48 checked, 0 failures |
| 4 | `purge_embargo` | **PASS** | 366 checked, 0 failures |
| 5 | `feature_causality` | **PASS** | 24 checked, 0 failures |
| 6 | `no_robustness_feedback_into_selection` | **PASS** | 1 checked, 0 failures |
| 7 | `no_shuffled_feedback_into_strategy` | **PASS** | 1 checked, 0 failures |
| 8 | `no_baseline_feedback_into_strategy` | **PASS** | 2 checked, 0 failures |

**All checks pass.** The substantive ones:

- **Feature causality** — all three features are recomputed from a panel **truncated at the decision bar** and must match bit-for-bit. A forward peek would change at least one field.

- **Future prices / future volatility / future universe not in ranking or eligibility** — the 60-day return window and the 60-day volatility window are strictly causal, the SMA200 window ends at the decision bar itself, and eligibility reads only the symbol's own bars up to that bar. Verified by truncation.

- **Label isolation** — a holding's realised return is a pure function of its entry and exit bars: truncating **at** the exit reproduces it exactly, truncating **one bar earlier** changes it. Forward returns are therefore consumed for **labels only**.

- **TEST isolation** — every decision the rule admits satisfies the purge and embargo at its own fold, and decisions excluded by the rule are **gap bars** (the purge/embargo working), not violations. 327 decisions admitted, 39 legitimately gapped.

- **No robustness feedback into selection** — the lock object contains no robustness-arm result and no TEST statistic.

- **No baseline feedback into the strategy** — the pure core and the metrics module reference no baseline runner and perform no I/O; they are pure functions of their arguments.

- **No shuffled/control information leaks into the real strategy** — the shuffle function reads only the salt, the bar index and the symbol list, and the real and shuffled arms are separate invocations of the same pure engine.

## 24. Production-Isolation Verification

**Phase 11 is offline research. Production is untouched.** The runner may write **only** inside `data/calibration/` plus this report and the proposal; the guard in `scripts/v2/phase11-io.mjs` refuses any other path.

| Production input | SHA-256 at start | at end | Unchanged |
|---|---|---|---|
| `config.json` | `05c52fabe110639f…` | `05c52fabe110639f…` | **yes** |
| `config/final.control.json` | `30f5d8473affcfc5…` | `30f5d8473affcfc5…` | **yes** |
| `config/management.control.json` | `c18de8f560d16370…` | `c18de8f560d16370…` | **yes** |
| `config/final-experiment-spec.v1.json` | `4274e685b2e9db92…` | `4274e685b2e9db92…` | **yes** |
| `config/alpha-experiment-spec.v1.json` | `808296d1236d8e28…` | `808296d1236d8e28…` | **yes** |
| `config/strategies.control.json` | `8f3df1af5d878233…` | `8f3df1af5d878233…` | **yes** |
| `config/phase10-spec.v1.json` | `782a04f6e8033ab6…` | `782a04f6e8033ab6…` | **yes** |

**Gate 12: PASS** — all 7 frozen production inputs are byte-identical at the end of the run. Specifically, this phase did **not**: change any strategy, change any risk limit, change learner behaviour, change any production config, replace the production strategy, add Phase 11 signals to live trading, or change dashboard production semantics.

**Determinism/reproducibility.** Two independent runs produce a byte-identical summary object (excluding the generation timestamp and runtime), the same spec hash and the same selection-lock hash. **Verdict A is not a deployment authorisation** — deployment would require a separate phase.

## 25. Failure Analysis

Eleven failure modes were examined. Each is classified as **(a)** observed, **(b)** possible, or **(c)** eliminated.

| Mode | Status | Evidence |
|---|---|---|
| **Zero gross edge** (the Phase 9 disease, recurring) | **OBSERVED — primary cause** | TEST gross P&L -1354.42 over 175 holdings, **before any fee or slippage**. Costs then widened the loss to -17.88%. This is the **seventh consecutive** phase in which the gross signal was not positive. |
| **Ranking carries no information** | **OBSERVED** | TEST rank IC -0.0617 (t = -0.5265, n = 15 bars); monotonicity +0.0000; top-minus-bottom spread negative both raw and net. |
| **Single-regime sample** (one bear, one bull) | **OBSERVED** | 2022 bear -17.16% vs B0 -42.27%; 2024–25 bull 83.12% vs B0 78.64%. The full-window result is essentially the bull sample. |
| **Asset concentration** | **OBSERVED** | The largest net-positive asset is 94.85% of all positive net profit (gate 10 fails). |
| **Cluster concentration** | **VACUOUS PASS** | No cluster produced positive net profit. The concentration gate is satisfied only definitionally (max share 0.00% of a zero denominator) and carries **no evidence** — see §21. |
| **Turnover cost wall** | **ELIMINATED** | Realised turnover 0.62 of book per decision. Moving from 1.00× to 1.50× costs shifts the TEST net return by only 1.01pp. Cost is **not** the binding constraint at this turnover, exactly as the proposal argued. |
| **Collapse to a crypto beta bet** | **ELIMINATED** (differently bad) | Crypto was the cluster most often excluded by the trend gate and the vol-normalised score; the book was dominated by US equities. The predicted failure mode did not occur, but the realised failure was not better. |
| **Overfitting / parameter spike** | **ELIMINATED** | All nine perturbation arms are negative; the canonical point is not an isolated peak. The gross result was also negative on TRAIN's own forward labels for most holdings. |
| **Look-ahead leakage** | **ELIMINATED** | All eleven leakage checks pass, including bit-exact truncation tests on every feature. |
| **Execution fragility** | **ELIMINATED as a cause** | The one-day-delayed arm (-0.12) is less negative than immediate (-0.18). There is no fragile edge to be broken by delay. |
| **Survivorship bias inflating the result** | **PRESENT BUT NOT EXPLANATORY** | The universe is survivorship-biased **upward**, so it makes the strategy look *better* than a true point-in-time universe would. It **still** lost money. The bias therefore cannot be the cause of the loss. |

**Root cause.** The program has now tested, seven times, whether these assets can be predicted directionally from OHLC-derived trend, momentum, breakout, regime, portfolio or **cross-sectional** information at horizons from 4 hours to 2 weeks. The answer is consistently no at the gross level against retail taker costs. Phase 11 extends the negative result to the cross-sectional and low-turnover operating point, which the proposal identified as the most promising untested direction. **The negative result is therefore informative, not merely another failure.**

## 26. Limitations

| Limitation | Severity | Note |
|---|---|---|
| **Survivorship bias** | **HIGH — disclosed prominently** | The 14 assets are current large-caps, chosen with today's knowledge. Long-only results are biased upward. Not corrected (no delisted history exists) and the universe is deliberately not swapped. |
| **Thin TEST sample** | **HIGH** | TEST is embargoed, leaving **15** rank-IC bars and **73** weekly excess-return observations. The experiment **cannot** detect a modest effect. "No evidence of an edge" ≠ "evidence of no edge". |
| **Single-regime sample** | **HIGH** | 2021-09 → 2026-09 contains one bear (2022) and one bull (2024–25). A weekly trend/rotation result is dominated by which regime happens to sit in TEST. |
| **14 assets in 3 weakly-correlated clusters** | MEDIUM | A 14-asset cross-section in 3 clusters is small for cross-sectional ranking; the vol-normalised ranking may be measuring cluster beta as much as relative strength. |
| **No volume / liquidity data** | MEDIUM | The panel is OHLC-only, so no liquidity filter and no volume-based signal is possible. |
| **No funding history** | MEDIUM | Funding is set to zero, so the structural-carry direction (Candidate 2) cannot be evaluated. This is a **named data gap**, not a proxy. |
| **B3 unavailable** | LOW | The production baseline could not be evaluated on this panel without substituting a proxy (§10). Production was instead verified byte-identical. |
| **Long-only, 1× unlevered** | BY DESIGN | This is a return-source test, not a leverage test. A levered version would scale both the loss and the drawdown. |
| **Weekly grid on a union calendar** | LOW | Crypto trades daily while equities do not, so carry-forward weights and returns are non-trading for part of each week. This is realistic, not an artefact, but it dilutes the measured weekly volatility. |

## 27. Final Verdict

### VERDICT C

> **THE STRATEGY FAILS THE ECONOMIC/OUT-OF-SAMPLE GATES (7 OF 12 FAIL)**

**5 of 12 pre-registered acceptance gates pass.** A ROBUST result requires **all twelve**.

| # | Gate | Result | Detail |
|---|---|---|---|
| 1 | `test_net_return_positive` | **FAIL** | TEST net return -17.88% |
| 2 | `test_sharpe_beats_B0` | **FAIL** | canonical -0.6983 vs B0 -0.4089 |
| 3 | `test_sharpe_beats_B2` | **PASS** | canonical -0.6983 vs B2 -0.9027 |
| 4 | `subfold_majority` | **FAIL** | 2/4 TEST sub-folds net positive |
| 5 | `cost_stress_1_25x` | **FAIL** | TEST net return at 1.25x -18.39% |
| 6 | `execution_delay` | **FAIL** | TEST net return next-open-1d -12.20% |
| 7 | `deflated_sharpe_positive` | **FAIL** | DSR +0.0050 vs threshold 0.95 (nTrials=16); raw SR -0.0860, SR0 +0.2140 |
| 8 | `shuffled_control_destroys_edge` | **PASS** | shuffled TEST sharpe -0.6439 return -16.41% |
| 9 | `leakage_checks_pass` | **PASS** | all checks pass |
| 10 | `asset_concentration` | **FAIL** | max single-asset share of TEST positive net profit 94.85% |
| 11 | `cluster_concentration` | **PASS** | max single-cluster share 0.00% — VACUOUS: no cluster produced positive net profit at all, so the concentration gate is satisfied only definitionally and carries no evidence |
| 12 | `production_unchanged` | **PASS** | 7 frozen production inputs re-hashed, unchanged |

### What the evidence actually says

1. **The ranking carries no detectable information.** TEST rank IC -0.0617 (t = -0.5265); monotonicity +0.0000; top-minus-bottom spread -0.0095 raw and -0.0125 net. Question A: **NO** (and note the power caveat — 15 bars).
2. **The gross book was already losing money.** Gross TEST P&L -1354.42. Question B: **NO.** A high Sharpe with negative per-trade economics would not be a discovery; here even the Sharpe is negative.
3. **It did beat the absolute-trend-only baseline B2 on Sharpe** (-0.6983 vs -0.9027) — the single gate most favourable to the hypothesis. Question C: a weak, statistically meaningless **yes** (weekly excess +0.0003, t = +0.1487), on a comparison in which **both arms lost money**. Beating a worse loser is not an edge.
4. **Execution delay did not break it, because there was nothing to break.** Question D: **NO** (gate requires positive under delay; result -0.12).
5. **Higher costs made it slightly worse, not decisively so.** Question E: **NO** (-0.18 at 1.25×). This is the useful part of the result: **cost is no longer the binding constraint at weekly turnover**, so the next experiment should not spend its budget on cost engineering for *this* signal.
6. **Shuffled ranking made no negative difference.** Question F: the control **did not destroy an edge** because there was none; shuffled (-0.16) slightly *beat* real (-0.18). Gate 8 passes on its literal wording, and the honest interpretation is stated in §22: the ranking was **inert**.
7. **The result is asset-concentrated.** Question G: **YES** — one asset accounts for 94.85% of positive net profit, and no cluster was net positive.

### What must happen next

Per the pre-registered STOP conditions, this is a **stop, not an optimisation prompt.** Do **not** begin another directional parameter search. The proposal's own conclusion is that a seventh identical failure is the signal to change the **input**, not the model. The two rational next moves, in order:

1. **Acquire historical funding-rate data** and test the structural-carry direction (Candidate 2). Carry is a *yield*, not a directional bet, and does not depend on the prediction that has now failed seven times.
2. **Change the cost structure** — maker execution (0.0002 vs 0.0005) — but note that §16 shows cost is **not** the binding constraint at this turnover, so this is a general infrastructure improvement, **not** a rescue for this strategy.

**This result should not be reported as a discovery, a partial success, or a promising direction.** It is a clean, well-powered-enough negative on the specific hypothesis, obtained with a pre-registered protocol, a single locked TEST read, an intact negative control and a fully passing leakage audit.

---

*Artifacts: `config/phase11-spec.v1.json` (pre-registered spec) · `data/calibration/phase11-summary.v1.json` (frozen results) · `data/calibration/phase11-lock.v1.json` (selection lock) · `data/calibration/phase11-trades.v1.jsonl` · `data/calibration/phase11-equity.v1.json` · `scripts/v2/phase11-{rotation,metrics,run,report,io}.mjs` · `tests/phase11.test.mjs`*

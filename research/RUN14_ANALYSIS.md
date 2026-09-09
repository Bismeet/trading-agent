# Forensic Research Analysis: FabRich Trading Engine Run 14 & Empirical Baseline

**Evaluation Date:** 2026-09-09  
**Target:** Read-Only Evaluation of Ledger Data (`data/`)  
**Methodology:** Read-Only Research Harness (`research/reconstruct.py`, `research/metrics.py`, `research/analyze_runs.py`)  
**Status:** 100% Code Unmodified | Zero Live Operations Launched  

---

> [!IMPORTANT]
> ### Critical Ledger Audit & Factual Status of "Run 14"
> A forensic inspection of the physical data ledger in `data/` (`episodes.jsonl`, `trades.v2.jsonl`, `journal.v2.jsonl`, `state.v2.json`, `equity.v2.jsonl`) establishes the following factual reality:
> 
> 1. **Completed Episodes in Ledger:** There are exactly **4 completed episodes** on record:
>    - **Run 1 (`ep_1788790395156_1`):** 5.97 hours, manual-restart, return: -1.5887%, max DD: 1.6001%, 5 closed + 5 forfeited trades.
>    - **Run 2 (`ep_1788811887018_2`):** 1.00 hours, time end, return: -0.1081%, max DD: 0.1526%, 5 closed trades.
>    - **Run 3 (`ep_1788815504776_3`):** 1.01 hours, time end, return: -0.1705%, max DD: 0.1930%, 5 closed trades.
>    - **Run 4 (`ep_1788819128795_4`):** 23.71 hours, time end, return: -0.3472%, max DD: 0.3472%, 5 closed trades.
> 2. **Current Active State:** `state.v2.json` and `heartbeat.v2.json` record **Episode 5 (`ep_1788904493127_5`)** initialized at cycle 347 with **0 open positions, 0 closed trades, and $100.00 equity**.
> 3. **Runs 5 through 14 Status:** **DO NOT EXIST in the filesystem or engine ledger.** No data files, logs, git commits, branches, stashes, or temp files contain records for completed episodes 5 through 14.
> 
> Pursuant to strict research evaluation constraints (*"DO NOT fabricate missing data"*, *"Never invent unavailable fields. Mark them UNKNOWN. Do not infer beyond the data."*), all requested metrics for **Run 14** and **Runs 5–13** are officially classified as **UNKNOWN / NOT IN LEDGER**.
> 
> To provide exhaustive technical analysis and answer every evaluation query, this report delivers:
> - **Primary Factual Report:** The strict ground-truth audit of the recorded ledger.
> - **Empirical Analysis of Latest Completed Run (Run 4, 24h) vs Baseline Runs (Runs 1–3):** Providing exact, unadulterated metrics down to the micro-cent for the latest completed trading run against all prior runs.

---

## 1. Run 14 Exact Metrics

| Metric | Run 14 (Ledger Reality) | Run 4 (Latest Completed 24h Run) |
| :--- | :--- | :--- |
| **Starting Equity** | **UNKNOWN (Not in ledger)** | \$100.00 USD |
| **Ending Equity** | **UNKNOWN (Not in ledger)** | \$99.6528 USD (\$99.6527588) |
| **Return %** | **UNKNOWN (Not in ledger)** | **-0.3472%** (-0.35%) |
| **Max Drawdown** | **UNKNOWN (Not in ledger)** | **0.3472%** (0.35%) |
| **Number of Trades** | **UNKNOWN (Not in ledger)** | **5 initiated, 5 completed** |
| **Wins / Losses** | **UNKNOWN (Not in ledger)** | **0 Wins / 5 Losses (0.00% Win Rate)** |
| **Total Fees** | **UNKNOWN (Not in ledger)** | **\$0.060956 USD** (Entry: \$0.030543, Exit: \$0.030413) |
| **Slippage & Spread** | **UNKNOWN (Not in ledger)** | **\$0.061142 USD** (Half-spread: \$0.060956, Impact: \$0.000186) |
| **Funding Carry** | **UNKNOWN (Not in ledger)** | **-\$0.000019 USD** (-\$0.00001873) |
| **Exit Reasons** | **UNKNOWN (Not in ledger)** | **100% `time-stop`** (5 of 5 trades held 23.70h until episode deadline) |
| **Strategy Used** | **UNKNOWN (Not in ledger)** | **`tsmom` exclusively (100%)**; 0 trades for other 5 strategies |
| **Symbols Traded** | **UNKNOWN (Not in ledger)** | **BTC-USD, ETH-USD, SOL-USD, XRP-USD, DOGE-USD** |
| **Regime** | **UNKNOWN (Not in ledger)** | **`broad_up`** throughout execution (shifted to `us_down` at Ep 5 genesis) |

### Detailed Breakdown of Trades in the Latest Completed Run (Run 4):
All positions entered simultaneously at **2026-09-07 22:13:07 UTC** and closed simultaneously at **2026-09-08 21:54:52 UTC** (holding duration: 85,304.2 seconds / 23.70 hours):
- **BTC-USD (Long 5x):** Margin \$3.38 \| Gross: -\$0.0899 \| Fees: \$0.0168 \| Net: **-\$0.0983 USD** \| Realized R: -0.1165 R
- **ETH-USD (Long 5x):** Margin \$3.04 \| Gross: -\$0.0652 \| Fees: \$0.0152 \| Net: **-\$0.0728 USD** \| Realized R: -0.0958 R
- **SOL-USD (Long 5x):** Margin \$1.86 \| Gross: -\$0.0555 \| Fees: \$0.0093 \| Net: **-\$0.0602 USD** \| Realized R: -0.1296 R
- **XRP-USD (Long 5x):** Margin \$2.12 \| Gross: -\$0.0069 \| Fees: \$0.0106 \| Net: **-\$0.0122 USD** \| Realized R: -0.0229 R
- **DOGE-USD (Long 5x):** Margin \$1.82 \| Gross: -\$0.0688 \| Fees: \$0.0091 \| Net: **-\$0.0733 USD** \| Realized R: -0.1608 R

---

## 2. Factual Comparison: Run 14 vs Runs 4–13 (and Run 4 vs Runs 1–3)

### A. Strict Ledger Audit Comparison (Prompt-Specified Targets)
- **Run 14:** UNKNOWN (no records beyond Episode 4).
- **Runs 4–13:** Runs 5–13 are UNKNOWN. Run 4 is recorded (see below).
- **Comparison:** Factual comparison between non-existent runs cannot be performed without fabricating data.

### B. Empirical Comparison: Latest Completed Run (Run 4) vs Prior Runs (Runs 1–3)

| Metric | Prior Baseline (Runs 1–3: 1h & 6h) | Latest Completed Run (Run 4: 24h) | Cumulative Career (Runs 1–4) |
| :--- | :--- | :--- | :--- |
| **Completed Trades** | 15 closed (+ 5 forfeited in Ep 1) | 5 closed (0 forfeited) | 20 closed (+ 5 forfeited) |
| **Average Episode Return** | **-0.6224%** (-1.59%, -0.11%, -0.17%) | **-0.3472%** | **-0.5536%** |
| **Trade Win Rate** | **6.67%** (1 win / 14 losses) | **0.00%** (0 wins / 5 losses) | **5.00%** (1 win / 19 losses) |
| **Average Net P&L / Trade** | **-\$0.084186 USD** | **-\$0.063340 USD** | **-\$0.078975 USD** |
| **Profit Factor (Gross)** | **0.0318** (Wins \$0.0247 / Loss \$0.7766) | **0.0000** (Wins \$0.0000 / Loss \$0.2863) | **0.0326** (Wins \$0.0349 / Loss \$1.0721) |
| **Expectancy R** | **-0.031803 R** | **-0.105105 R** | **-0.050129 R** |
| **Max Drawdown** | **1.6001%** (Ep 1 peak-to-trough) | **0.3472%** | **1.6001%** |
| **Total Fees Paid** | \$1.0019 USD | \$0.0610 USD | \$1.0629 USD |
| **Average Hold Duration** | 2.32 hours | 23.70 hours | 7.67 hours |

### Performance Trajectory Assessment:
**Trajectory: FLAT TO WORSENING.**
1. **Expectancy R Collapsed:** Run 4 suffered an Expectancy R of **-0.1051 R**, which is **3.3x worse** than the -0.0318 R expectancy across Runs 1–3.
2. **Zero Wins:** While Runs 1–3 produced 1 winning trade (DOGE-USD in Run 2, +$0.0154 net), Run 4 produced **zero winning trades** (0% win rate).
3. **Apparent Drawdown Reduction is an Illusion of Gating:** Run 4 experienced lower dollar loss (-\$0.35 vs -\$1.59 in Run 1) exclusively because the `survivalGate` restricted leverage to 5x (allocating only \$12.22 in margin) instead of the 12x leverage (\$73.28 in margin) used in Run 1. The underlying strategy generated 5 consecutive losses across every single asset.

---

## 3. Learning & Evolution Analysis

| Parameter / Metric | Before Run 4 (End of Ep 3) | After Run 4 (Genesis of Ep 5) | Shift / Impact |
| :--- | :--- | :--- | :--- |
| **System Generation** | **Generation 3** | **Generation 4** | +1 generation incremented in `onEpisodeEnd` |
| **Account Kelly Fraction** | **0.45** | **0.43** | Decremented by 0.02 via `evolveTick` (`delta = -1`) |
| **Leverage Cap** | **20x** | **20x** | Clamped to floor `leverageStart` (20x) |
| **`tsmom` Sample Size ($N$)** | 15 trades | **20 trades** | +5 trades added to statistical window |
| **`tsmom` Confidence** | **0.2000** (Candidate base) | **0.2089** ($0.2 + \text{wilson\_lb}$) | +0.0089 slight upward drift due to formula |
| **`tsmom` Profit Factor** | 0.0318 | **0.0326** | Functionally zero (gross wins \$0.035 vs losses \$1.072) |
| **`tsmom` Expectancy R** | -0.0318 R | **-0.0501 R** | **Worsened by -57.6%** |
| **`tsmom` Deflated Sharpe (DSR)**| 0.000 (Pass: False) | **0.000 (Pass: False)** | Fails DSR > 0.95 gate; status remains `candidate` |
| **Wilson Lower Bound** | N/A | **0.008881** | Below breakeven win rate (0.6175) |

### Did the Learning System Actually Improve Measured Metrics?
**NO. The learning system did NOT improve measured strategy metrics.**
- **Purely Passive Accounting:** In [`scripts/v2/brain.mjs`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/brain.mjs), the learning system merely calculates sample moments, updates `strategies.json`, and records an entry in `reflog.v2.jsonl`.
- **No Structural Adaptation:** It does not adjust entry thresholds ($r_{28} > 0.03$), does not modify holding periods, does not introduce hedging, and does not alter strategy weights.
- **Kelly Decrement Without Risk Control:** Because cumulative edge dropped below -0.05 (`edge: -0.050128`), `evolveTick` mechanically decremented `kellyFraction` from 0.45 to 0.43. However, this decrement had **zero protective effect** because the account was already in survival mode (where leverage was hard-capped at 5x by `survivalGate`).
- **Monopolistic Entrenchment:** In [`strategies.mjs:190`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/strategies.mjs#L190), strategy selection is scored by $\text{score} = \text{sig.confidence} \times (0.5 + \text{st.confidence})$. Because `tsmom` has a base signal confidence of 0.62 (compared to 0.60 for `donchian` and 0.55 for `mom_trend`), and because its statistical confidence slightly increased from 0.2000 to 0.2089 (due to the Wilson lower bound floor), `tsmom`'s priority score actually **increased**, entrenching it further as the first-choice strategy despite an empirical 95% loss rate!

---

## 4. Causal Determination: What Explains the Outcome?

### Verdict: **Option D (Structural Flaws & Systemic Friction) combined with Option B (Temporary Market Noise).**

### Detailed Factual Justification:
- **Option A (Realized Improvement): REJECTED.** Run 4 lost money (-\$0.35), produced 0 wins out of 5 trades, and degraded strategy expectancy from -0.032 R to -0.050 R.
- **Option C (Pure Random Variation): REJECTED.** A 95% loss rate (19 losses in 20 trades) with an SQN of -4.93 is statistically impossible under pure random variation ($\approx 4.9$ standard deviations from random chance).
- **Option D (Structural Flaws & Friction) + Option B (Market Drift): CONFIRMED.**
  1. **Time Horizon Mismatch:** `tsmom` is configured as a daily momentum strategy using a 28-day lookback ($r_{28} = (p_t - p_{t-28})/p_{t-28}$). Sustained momentum cycles require days or weeks to unfold. In Run 4, the bot held positions for exactly 23.70 hours before the engine's hardcoded `time-stop` forced a complete liquidation. Holding for 23.7 hours captured only daily noise, not trend payoff.
  2. **Transaction Friction:** Over the 23.7-hour holding period, the 5 crypto assets drifted downward by an average of -0.47%. Round-trip taker fees (10 bps) and modeled half-spreads (10 bps) extracted \$0.1221 USD in friction, consuming **42.6%** of the gross position change.
  3. **Forced Liquidation at Noise Level:** Exits were not triggered by market structure or stop loss (-5%), but by the mechanical expiration of the episode clock.

---

## 5. Trade Structure Comparison & Council Cluster Failure

```
+----------------------------------------------------------------------------------------------------+
| ENTRY BATCH ANALYSIS: 100% CORRELATED CRYPTO BETA BET                                              |
+----------------------------------------------------------------------------------------------------+
| Batch Timestamp: 2026-09-07 22:13:07 UTC (Episode 4)                                               |
| Positions Opened: 5 (BTC-USD, ETH-USD, SOL-USD, XRP-USD, DOGE-USD)                                 |
| Portfolio Direction: 100% LONG (Zero Short Hedging, Zero Non-Crypto Diversification)                |
| Aggregate Margin Allocated: $12.22 USD | Aggregate Notional Exposure: $61.08 USD (5.00x Leverage)    |
+----------------------------------------------------------------------------------------------------+
```

### 1. Simultaneous Crypto Positions
- In every historical run without exception (Runs 1, 2, 3, and 4), the engine opened **exactly 5 simultaneous crypto positions** on tick 1.
- No other watchlist symbols (US equities: AAPL, NVDA, MSFT, TSLA, AMZN; Indian equities: RELIANCE, TCS, INFY, HDFCBANK) were ever evaluated or entered because the 5 crypto assets completely exhausted the available concurrency slots.

### 2. BTC/ETH/SOL/XRP/DOGE Clustering
- 100% of portfolio risk was concentrated in a single correlated macro factor: crypto market beta.
- When the crypto market experienced minor intraday pullbacks, all 5 positions lost simultaneously. Across all 4 runs, the bot experienced 4 simultaneous 5-asset losses out of 5 total entry batches.

### 3. Agent-Council Cluster Protection Status: **CRITICAL BUG (COMPLETELY BYPASSED)**
The Multi-Agent Decision Council in [`scripts/v2/agents.mjs`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/agents.mjs) was designed with a dedicated Risk Agent rule to prevent crypto cluster clumping:
```javascript
// scripts/v2/agents.mjs:67-75
if (intent.market === "crypto") {
  const sameSide = Object.values(state.positions || {}).filter(
    (p) => p.market === "crypto" && p.side === intent.side,
  ).length + pendingCount;
  if (sameSide >= 4) {
    return { agent: "risk", vote: "veto", reasons: [`crypto ${intent.side} cluster already ${sameSide}: correlated exposure cap`] };
  }
}
```
**Why the Rule Failed:**
- In [`scripts/v2/strategies.mjs:196-210`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/strategies.mjs#L196-L210), when `runStrategies` constructs order intent objects, it populates `symbol`, `side`, `leverage`, `strategy_id`, `stopPct`, `targetPct`, etc., but **omits `market`** (`intent.market` is `undefined`).
- As a direct result, `if (intent.market === "crypto")` evaluates to `false` for every single order.
- The Risk Agent never executed the cluster veto check.
- In `data/agents.v2.jsonl`, all 5 crypto orders in Episode 4 were approved unconditionally (`analyst: approve`, `risk: approve`, `investor: approve`).

### 4. Rejected Trades
- **Run 4 Rejected Trades:** **0**.
- **Historical Rejected Trades:** **0 across all runs**.
- The Agent Council has a 100% approval rate and has never vetoed a single trade.

---

## 6. Core Question Answer

> ### "After 14 runs, is FabRich actually learning to trade better, or is it still repeatedly running the same TSMOM behavior with fluctuating P&L?"

### Definitive Technical Verdict:
**FabRich is NOT learning to trade better. It is repeatedly executing the exact same flawed `tsmom` behavior with fluctuating, consistently negative P&L.**

### Evidentiary Proof:
1. **Zero Adaptation in Strategy Selection:** Across all runs (Runs 1–4 recorded, and across its entire operational history), `tsmom` executed **100% of all trades (20 of 20)**. The other five strategies (`donchian`, `rsi2dip`, `mom_trend`, `orb`, `ibreakout`) had **0 trades** and were never allocated a single dollar of capital.
2. **Deterministic Monopolization:** The engine's ranking formula strictly favors `tsmom` due to its high base signal confidence (0.62) and low warmup requirement. The learning system actually raised `tsmom`'s confidence score after 20 trades (from 0.2000 to 0.2089) due to the Wilson lower bound calculation, ensuring `tsmom` retains first-priority execution over all competing strategies.
3. **Repeated Correlated Clumping:** Every episode begins by instantly allocating 100% of margin capacity into 5 identical crypto long positions because the Risk Agent's cluster veto rule is completely broken by a missing `market` field.
4. **Mechanical Liquidations Guarantee Losses:** The engine pairs a multi-week momentum strategy with a 1-hour to 24-hour time stop. Every trade is closed prematurely by the clock, forcing the account to absorb 20.1 bps of transaction friction on random micro-movements.
5. **Passive Bookkeeping Masked as "Learning":** The bot records losses in JSON files, increments a generation counter, and trims the Kelly fraction by 0.02, but does not alter trading rules, signal logic, or portfolio allocation. It repeats the exact same sequence on cycle 1 of every new episode.

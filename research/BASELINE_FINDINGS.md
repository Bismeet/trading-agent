# Research & Evaluation Baseline: FabRich Trading Engine (v2)

**Evaluation Date:** 2026-09-09  
**Target:** Read-Only Evaluation of Existing Run Data (`data/`)  
**Objective:** Determine exactly why the FabRich trading engine has been losing across previous 1h, 2h, and 24h test runs, and establish an empirical baseline before any comparison with TauricResearch TradingAgents.

---

## Executive Summary of Findings

Across all previous runs (Episodes 1 through 4), the FabRich engine achieved a **5.00% win rate (1 win, 19 losses)** across 20 completed trades, generating a total journaled net loss of **-$1.5795 USD** (or **-$2.1111 USD** true net loss when entry taker fees are properly accounted for).

```
+--------------------------+-----------------------+
| Metric                   | Value                 |
+--------------------------+-----------------------+
| Total Trades Initiated   | 25                    |
| Completed Trades         | 20                    |
| Orphaned / Forfeited     | 5 (Ep 1 restart)      |
| Wins / Losses            | 1 Win / 19 Losses     |
| Win Rate                 | 5.00%                 |
| Gross Market P&L         | -$1.0372 USD          |
| Total Taker Fees Paid    | $1.0629 USD           |
| Modeled Slippage/Spread  | $1.0736 USD           |
| Funding Carry Accrued    | -$0.0110 USD          |
| Journaled Net P&L        | -$1.5795 USD          |
| True Net P&L (incl entry)| -$2.1111 USD          |
| System Quality (SQN)     | -4.93                 |
| Profit Factor            | 0.033                 |
| Liquidations             | 0                     |
+--------------------------+-----------------------+
```

### The Root Cause of Losses:
The losses are **not primarily caused by poor market forecasting**, but by a fatal architectural mismatch between:
1. **Strategy Time Horizon vs Exit Mechanism:** The bot exclusively traded `tsmom` (a 28-day daily momentum trend strategy), but forcibly liquidated every single position within 1 to 4 hours via hardcoded `time-stop` (4h) or episode termination (`episode-end` at 1h or 24h).
2. **Crushing Transaction Friction:** Round-trip taker fees (10 bps) plus spread crossing (10 bps) extracted **~$2.14 USD** in friction on micro-moves, exceeding the gross market price loss (-$1.04 USD).
3. **100% Correlated Cluster Clumping:** Every batch of entries opened all 5 crypto assets (BTC, ETH, SOL, XRP, DOGE) simultaneously in the exact same direction (Long), turning the account into an unhedged, concentrated crypto beta bet.
4. **Agent Council Bug:** The Risk Agent's 4-same-side crypto cluster veto rule was completely bypassed on every order because `runStrategies` failed to set the `market` property on order intents (`intent.market === undefined`).

---

## 1. Why is FabRich Losing?

A forensic analysis of the execution logs and price data reveals three compounding failure modes:

### A. Forced Premature Liquidation Before Trend Realization
- `tsmom` is designed to capture sustained multi-day and multi-week momentum.
- In 100% of historical trades (20 of 20), positions were closed exclusively by time triggers:
  - **10 trades closed by `time-stop`** (4-hour hold limit in `cfg.v2.aggression.maxHoldHours: 4`).
  - **10 trades closed by `episode-end`** (1-hour timeout in Runs 2 & 3, or manual restart in Run 1).
- **Zero trades reached take-profit (+10%), stop-loss (-5%), or trailing stop (+50% ROI / 25% giveback).**
- By forcibly liquidating a daily trend-following strategy after 1 to 4 hours, the engine forced the portfolio to absorb the guaranteed adverse spread and taker fees on both entry and exit, while closing during the random noise phase of the price action before any trend could overcome transaction costs.

### B. High Frictional Drag on Sub-Percent Moves
- Every round-trip trade incurs:
  - Entry taker fee: $0.05\%$ (5 bps)
  - Exit taker fee: $0.05\%$ (5 bps)
  - Entry half-spread: $0.05\%$ (5 bps)
  - Exit half-spread: $0.05\%$ (5 bps)
  - Square-root impact slippage: ~0.01 bps
  - **Total Frictional Drag: ~20.1 bps (0.201%) per trade.**
- Average trade hold duration was only **1.99 hours**. Over a 2-hour window, crypto assets experienced typical drift of only $\pm 0.1\%$ to $0.4\%$.
- Because positions were cut before trends could expand, the frictional cost ($0.20\%$) consumed or reversed the trade outcome. Total fees ($1.06) + modeled spread/slippage ($1.07) = **$2.1365 in friction**, which represents **206% of the gross market loss**!

### C. Unsettled Forfeiture on Manual Restart
- During Run 1, a manual restart command was issued.
- In [`scripts/v2/controls.mjs:60-63`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/controls.mjs#L60-L63), the restart handler called `finalizeEpisode` and `nextEpisode` without calling `closePosition`.
- This silently deleted 5 open positions (BTC, ETH, SOL, XRP, DOGE opened at 19:29:50 UTC) from `state.positions`, forfeiting $12.06 in margin and $0.072 in entry fees, leaving orphaned `pre` rows in `journal.v2.jsonl`.

---

## 2. Which Strategies are Actually Responsible?

```
+-------------+--------+------+--------+----------+---------------+----------------+
| Strategy ID | Trades | Wins | Losses | Win Rate | Net PnL (USD) | Capital Share  |
+-------------+--------+------+--------+----------+---------------+----------------+
| tsmom       | 20     | 1    | 19     | 5.00%    | -$1.5795      | 100.0%         |
| donchian    | 0      | 0    | 0      | N/A      | $0.0000       | 0.0%           |
| rsi2dip     | 0      | 0    | 0      | N/A      | $0.0000       | 0.0%           |
| mom_trend   | 0      | 0    | 0      | N/A      | $0.0000       | 0.0%           |
| orb         | 0      | 0    | 0      | N/A      | $0.0000       | 0.0%           |
| ibreakout   | 0      | 0    | 0      | N/A      | $0.0000       | 0.0%           |
+-------------+--------+------+--------+----------+---------------+----------------+
```

### Finding: `tsmom` is 100% responsible for all historical trades and losses.
The other five strategies (`donchian`, `rsi2dip`, `mom_trend`, `orb`, `ibreakout`) had **zero trades** and contributed $0.00 to profits or losses.

### Why Did `tsmom` Monopolize Execution?
1. **Confidence Scoring Bias:** In [`strategies.mjs:190`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/strategies.mjs#L190), strategies are ranked by $\text{score} = \text{sig.confidence} \times (0.5 + \text{strategy.confidence})$. `tsmom` has the highest base signal confidence (`0.62` for long) among all trend strategies (vs `0.60` for `donchian` and `0.55` for `mom_trend`).
2. **Lower Warmup Thresholds:** `tsmom` only requires 30 daily bars and $r_{28} > 0.03$. In contrast:
   - `rsi2dip` strictly requires 210 bars and an extreme oversold condition ($RSI_2 < 10$).
   - `orb` strictly requires US equities during the first 30 minutes of the New York session, observed within 5 minutes of open.
   - `ibreakout` strictly requires 48 15m bars and an active 12-hour high breakout.
3. **Watchlist Ordering & Position Capacity Exhaustion:** In [`strategies.mjs:174`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/strategies.mjs#L174), the engine iterates through the watchlist starting with the 5 crypto symbols. Because `tsmom` generated signals for all 5 crypto assets on tick 1, and the portfolio correlation limits failed to block them, `tsmom` consumed the entire available allocation, leaving zero capacity for subsequent symbols or strategies.

---

## 3. Loss Attribution: Signal vs Risk vs Cost vs Execution

```
+------------------------------------+---------------+---------------------+
| Loss Category                      | Impact (USD)  | % of Total Drag     |
+------------------------------------+---------------+---------------------+
| Gross Market Price Move            | -$1.0372      | 32.6%               |
| Exchange Taker Fees (Round-Trip)   | -$1.0629      | 33.4%               |
| Modeled Half-Spread (Adverse Fill) | -$0.9652      | 30.3%               |
| Modeled Square-Root Impact Slip    | -$0.0106      | 0.3%                |
| Funding Carry Outflow              | -$0.0110      | 0.3%                |
| Orphaned Margin (Restart Leakage)  | -$0.0724      | 2.3%                |
+------------------------------------+---------------+---------------------+
| Total Net Economic Drag            | -$3.1593      | 100.0%              |
+------------------------------------+---------------+---------------------+
```

### Detailed Attribution:
1. **Cost & Friction Drag (Primary Driver - 64% of total drag):**  
   Frictional costs (fees + half-spread + slippage) totaled **$2.0387 USD**. Even if market prices had remained completely flat, the engine would have lost over $2.00 simply from entering and exiting 20 positions.
2. **Risk & Sizing (Secondary Driver - Magnifier):**  
   In Episode 1, sizing used 12x leverage with $73.28 of margin committed across 5 positions, creating an effective portfolio leverage of **8.79x ($879 notional on a $100 account)**. This high leverage magnified a minor 0.2% price fluctuation into a -$1.05 loss (accounting for 66% of all closed trade losses).
3. **Signal (Tertiary Driver - Directional Noise):**  
   The gross market loss (-$1.04) reflects random chop around the 28-day moving average over short 1h-4h intervals, rather than a catastrophic directional collapse.

---

## 4. Correlated Crypto Exposure Analysis

### Finding: Correlated crypto clumping is a critical systemic defect.

```
+-----------+----------------------+--------------------+---------------------+------------------+
| Batch #   | Entry Time (UTC)     | Symbols Opened     | Direction           | Portfolio Lev    |
+-----------+----------------------+--------------------+---------------------+------------------+
| Batch 1   | 2026-09-07 14:23:11  | BTC, ETH, SOL, XRP, DOGE | 100% Long (5 of 5)  | 8.79x ($879.41)  |
| Batch 2   | 2026-09-07 19:29:50  | BTC, ETH, SOL, XRP, DOGE | 100% Long (5 of 5)  | 1.45x ($144.72)  |
| Batch 3   | 2026-09-07 20:11:57  | BTC, ETH, SOL, XRP, DOGE | 100% Long (5 of 5)  | 0.61x ($61.35)   |
| Batch 4   | 2026-09-07 21:12:43  | BTC, ETH, SOL, XRP, DOGE | 100% Long (5 of 5)  | 0.61x ($61.32)   |
| Batch 5   | 2026-09-07 22:13:07  | BTC, ETH, SOL, XRP, DOGE | 100% Long (5 of 5)  | 0.61x ($61.08)   |
+-----------+----------------------+--------------------+---------------------+------------------+
```

- **100% of all trade entries were 5-asset correlated long baskets.**
- In all 5 batches, the bot opened BTC-USD, ETH-USD, SOL-USD, XRP-USD, and DOGE-USD in the exact same minute in the exact same direction.
- In crypto markets, cross-asset correlation during broad trend regimes is typically $0.80$ to $0.95$.
- Holding 5 crypto longs simultaneously did not provide diversification; it created a single 5x-concentrated macro bet. When crypto pulled back slightly, all 5 positions suffered simultaneous losses.

---

## 5. Agent Council Analysis & Verification

### Finding: The Agent Council has two structural bugs that completely disabled its risk protections.

#### Bug 1: Correlated Crypto Cluster Protection is Completely Dead in Production
- In [`scripts/v2/agents.mjs:67-75`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/agents.mjs#L67-L75), the Risk Agent defines:
  ```javascript
  if (intent.market === "crypto") {
    const sameSide = Object.values(state.positions || {}).filter(
      (p) => p.market === "crypto" && p.side === intent.side,
    ).length + pendingCount;
    if (sameSide >= 4) {
      return { agent: "risk", vote: "veto", reasons: [`crypto ${intent.side} cluster already ${sameSide}: correlated exposure cap`] };
    }
  }
  ```
- **The Defect:** In [`scripts/v2/strategies.mjs:196-210`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/strategies.mjs#L196-L210), `runStrategies` constructs order intents with:
  `op, symbol, side, leverage, strategy_id, setup_tag, stopPct, targetPct, confidence, reason, trade_id, sizePct, createdAt`.
- **`runStrategies` does NOT include `market` on the intent object!**
- Because `intent.market` is `undefined`, the check `if (intent.market === "crypto")` evaluates to `false`.
- **Empirical Proof:** In `data/agents.v2.jsonl`, Batch 2 and Batch 3 contain deliberations for BTC, ETH, SOL, XRP, AND DOGE. For DOGE-USD (the 5th crypto long), the Risk Agent logged:
  `risk:approve(positions 0/10, dd 0.0%: within limits)`
  DOGE was approved without veto because the entire cluster check block was silently skipped!

#### Bug 2: Already-Queued Orders are Invisible to Council Deliberation
- `riskDecide` checks `openCount + pendingCount >= maxPos`.
- `openCount` reflects only currently filled positions in `state.positions`.
- `pendingCount` starts at `0` inside `agentCouncil` and only counts orders approved *within the current deliberation loop*.
- Any orders already serialized in `data/pending.v2.json` from a previous cycle that failed to fill (due to stale data or exchange delays) are completely omitted from both `openCount` and `pendingCount`.

---

## 6. Validity of 1h / 2h / 24h Experiments

### Finding: Short 1h and 2h experiments are structurally invalid for 5 out of the 6 strategies.

```
+-------------+----------------------+----------------------+------------------------------------------+
| Strategy    | Design Data Horizon  | Intended Hold Time   | Validity in 1h / 2h Tests                |
+-------------+----------------------+----------------------+------------------------------------------+
| tsmom       | 28 daily bars (1y)   | Days to weeks        | INVALID: Forcibly liquidated at noise    |
| donchian    | 20 daily bars (1y)   | Days to weeks        | INVALID: Channel breakouts take days     |
| rsi2dip     | 210 daily bars (1y)  | 2 to 5 days          | INVALID: 2-day RSI cannot revert in 1h   |
| mom_trend   | 28 daily bars (1y)   | Days to weeks        | INVALID: Trailing exit requires expansion|
| orb         | 30m session open     | 30m to 4 hours       | VALID: Designed for intraday session open|
| ibreakout   | 48 15m bars (12h)    | 2 to 12 hours        | MARGINAL: 8% target needs multiple hours |
+-------------+----------------------+----------------------+------------------------------------------+
```

### Analysis:
- Testing daily-close momentum and breakout strategies over 1-hour or 2-hour episodes guarantees failure.
- A 1-hour run forces an `episode-end` settlement after 3,600 seconds. A daily bar does not even close in that window!
- The only strategy structurally compatible with 1h-2h testing is `orb` (Opening-Range Breakout on US equities), but `orb` never traded due to market-open gating and watchlist prioritization.

---

## 7. Run-Level Performance Analysis (Episodes 1 to 4)

```
+-----+----------+-----------+----------+----------+----------+--------+---------+----------------+
| Run | Duration | Start Cap | End Eq   | Return % | Max DD % | Trades | Fees    | End Reason     |
+-----+----------+-----------+----------+----------+----------+--------+---------+----------------+
| Ep 1| 5.97h    | $100.00   | $98.4113 | -1.59%   | 1.60%    | 5      | $0.8793 | manual-restart |
| Ep 2| 1.00h    | $100.00   | $99.8919 | -0.11%   | 0.15%    | 5      | $0.0614 | time           |
| Ep 3| 1.01h    | $100.00   | $99.8295 | -0.17%   | 0.19%    | 5      | $0.0613 | time           |
| Ep 4| 23.71h   | $100.00   | $99.6528 | -0.35%   | 0.35%    | 5      | $0.0610 | time           |
+-----+----------+-----------+----------+----------+----------+--------+---------+----------------+
```

### Run Summaries:
- **Episode 1 (5.97h):** Aggressive mode (12x leverage, $73 margin). High fee drag ($0.88). Trades closed via 4h `time-stop`. Five new trades opened right before manual restart, forfeiting margin.
- **Episode 2 (1.00h - 1h test):** Survival mode active (5x leverage, $12 margin). All 5 trades forcibly liquidated at 1 hour by `episode-end`. Minimal loss (-$0.11), but 0 of 5 trades allowed to reach technical targets.
- **Episode 3 (1.01h - 1h test):** Identical behavior to Episode 2. 5 trades opened simultaneously, forcibly closed at 1 hour by `episode-end` (-$0.17).
- **Episode 4 (23.71h - 24h test):** 5 trades opened at 22:13 UTC on 2026-09-07. Held through the full 24-hour cycle and closed via `time-stop` at 21:54 UTC on 2026-09-08 (-$0.35). Paid 3 funding cycles (00:00, 08:00, 16:00 UTC).

---

## 8. Top 3 Highest-Impact Recommendations for Next Steps

To prepare for comparison with TauricResearch TradingAgents, these three non-invasive, high-impact fixes should be evaluated:

1. **Fix Intent Metadata to Activate the Correlated Crypto Cluster Veto:**  
   In `runStrategies` ([`scripts/v2/strategies.mjs`](file:///c:/Users/bisme/OneDrive/Desktop/trading%20bot/scripts/v2/strategies.mjs)), add `market: w.market` to the emitted order intent object. This will immediately enable the Risk Agent's `sameSide >= 4` cluster cap, preventing the bot from loading 5 simultaneous long positions across the entire crypto basket.
2. **Harmonize Evaluation Horizons with Strategy Timeframes:**  
   Do not evaluate daily strategies (`tsmom`, `donchian`, `rsi2dip`, `mom_trend`) on 1-hour or 2-hour forced episode clocks. If testing 1h-2h runs, isolate intraday strategies (`orb`, `ibreakout`). If testing daily trend strategies, allow episodes to run for their intended duration without premature time-stop liquidation.
3. **Eliminate Taker Fee Drag via Maker Orders or Profit Hurdles:**  
   Taker fees (10 bps round trip) and adverse spread crossing (10 bps round trip) are the single largest source of capital depletion ($2.14 drag vs $1.04 market loss). Introduce limit/maker order execution (saving 60% on fees and earning the spread) or require signal expected edge to exceed 3x round-trip friction before opening.

# Backtest Harness Validation & First Experiments — 2026-09-10

**Harness:** `research/backtest.mjs` (P0 measurement loop)
**Data:** 365 daily bars × 5 symbols (BTC, ETH, SOL, XRP, DOGE), 2025-09-10 → 2026-09-10, Coinbase Exchange daily candles (an engine-sanctioned provider — same fallback the live smoke test validates). Cached in `research/data-cache/`.
**Config:** `$100` capital, `5x` leverage cap, live `config.json` fees/slippage/funding/liquidation math via `perp.mjs`, engine `sizeOrder` sizing, analyst council veto enabled.

---

## 1. Why this exists

`BASELINE_FINDINGS.md` established from live runs that the engine loses to **friction + forced churn**, not (only) bad signals. But every hypothesis cost days of live paper trading to test. This harness replays cached daily bars through the engine's **own math** (indicators, signals, fills, fees, funding, liquidation, sizing, council) so hypotheses cost seconds. Walk-forward: signals at bar *i* only ever see `closes[0..i]`; fills happen at bar *i+1* (next-tick barrier preserved).

Run it yourself:

```bash
node research/backtest.mjs --selftest                 # 9 mechanics checks (synthetic)
node research/backtest.mjs                            # baseline (live config)
node research/backtest.mjs --hold tsmom=336,donchian=240,rsi2dip=72,mom_trend=336 --top-n 2 --gate
```

Documented daily-bar divergences: header of `research/backtest.mjs` (D-B01…D-B06). Notable: default `--mark-ema 1` (mark = close; the live 30s EMA tracks price within seconds, a daily EMA would not), flat `--funding-8h 0.0001` (~11%/yr typical perp average).

## 2. Results (same data, one variable at a time)

| Run | Change vs live config | Trades | Gross | Fees+Slip+Funding | **Net** | Return | MaxDD |
|---|---|---|---|---|---|---|---|
| **B0** | none (4h hold, take all) | 243 | +$4.06 | $43.65 | **-$10.87** | -6.3% | 38% |
| **E1** | per-strategy holds | 73 | -$20.62 | $23.75 | **-$16.85** | -6.4% | 55% |
| **E2** | top-N=2 crypto selection | 214 | -$0.98 | $34.46 | **-$12.85** | -9.3% | 35% |
| **E3** | holds + top-N | 70 | -$5.20 | $20.23 | **-$1.84** | **+7.1%** | 43% |
| **E4** | holds + top-N + walk-forward strategy gate | 70 | +$35.04 | $18.22 | **+$36.24** | **+43.1%** | 36% |
| E4-sens | E4 with funding rate 0 | 70 | +$32.46 | $10.53 | +$27.21 | +27.2% | 39% |

Note on equity-vs-net: B0/E1/E2/E3 returns differ from their net trade P&L because open-position marks float intra-run; final settled numbers are the authoritative ones.

## 3. Findings

1. **Baseline (B0) reproduces the live pathology from `BASELINE_FINDINGS.md`, independently.** 197 of 243 trades were tsmom, 95% exited by time-stop after ~1 bar (the 4h `maxHoldHours`), gross edge +$4 crushed by $43.6 of friction (>10× gross). The live losses are architectural, confirmed offline.
2. **Longer holds alone (E1) are not enough** — they cut friction 2× but expose the raw signal weakness (gross went negative; tsmom expectancy -0.028R). The fixed 5% stop + fixed 10% target on 5x leverage doesn't fit a 14-day hold; drawdown worsened to 55%.
3. **Top-N selection alone (E2) is not enough** either — but it composes with holds (E3 flips positive). Fewer, stronger, less-correlated concurrent bets.
4. **The walk-forward gate (E4) is the single biggest win:** entries only from strategies whose *trailing 30-trade net expectancy is positive* (needs n≥8 before gating, mirroring engine probation). It rotated capital into Donchian (PF 46, SQN 4.2, DSR pass — the only strategy with a genuine edge in this window) and away from tsmom's losing stretches. **Caveat:** n=70 total and Donchian n=14 — far too few trades for statistical confidence; treat +43% as "the mechanism works and deserves a live paper-trial," not as expected return.
5. **The analyst council never vetoed anything** in this window (0 vetoes across all runs) — with BTC setting the regime label, daily signals rarely fire against their own regime. Its live value is unproven by this data.
6. **mom_trend effectively never fires at daily cadence** (0 trades in B0–E3; 6 in E4 via gate-induced selection). Its conjunction of conditions (r28>5% + mom>1% + RSI<78) almost never holds at the daily bar. Worth re-examining thresholds or running it on intraday bars only.
7. **Funding direction matters:** in this drawdown-heavy year shorts *received* funding (+$6.9 in E4); a long-biased year would flip that. At 4h holds funding was negligible ($4.5 across 243 trades); at multi-day holds it is material.

## 4. Recommended engine changes (P1, now evidence-backed)

In priority order — each is small and config-gated:

1. **Per-strategy `maxHoldHours`** (`config.json → v2.strategies.holds`): tsmom/mom_trend ≈ 336h, donchian ≈ 240h, rsi2dip ≈ 72h. The global 4h is the single largest live loss driver.
2. **Cross-sectional top-N crypto entries** (`v2.strategies.topN = 2`): rank same-tick candidates by confidence, keep the best 2. Kills the 5-symbol same-side cluster the risk council only partially caps.
3. **Walk-forward strategy gate** (`v2.strategies.expectancyGate`): reuse `brain.mjs` trailing expectancy; strategies with negative trailing expectancy (n≥8) stop generating entries. This is the "learning layer actually steering" upgrade.
4. Longer-horizon holds need **volatility-scaled stops** (P2): fixed 5%/10% stop/target pairs underperform at multi-day horizons (E1 evidence).

## 5. Threats to validity

- Daily bars cannot see intrabar stop/target ordering (pessimistic: stop checked first) and fill at next close, not next 30s tick.
- One year, one market regime sequence (major drawdown mid-year), 5 correlated crypto symbols. **No US/IN equity legs** (need session-aware intraday data), so results speak for the crypto book only.
- Flat funding rate; real rates vary ±. Sensitivity shown above.
- The E4 gate is walk-forward (no lookahead) but strategy *selection across 4 candidates on one path* still carries multiple-comparisons risk — exactly what `deflatedSharpe` (nTrials=4) is for: Donchian passes, nothing else does.
- Coinbase daily closes ≈ Yahoo closes (engine's primary feed) to within a few bps; provider noted in each cache file.

## 6. Next steps

- Port P1 changes into `scripts/v2/strategies.mjs`/`config.json` with unit tests; re-run harness to confirm parity.
- Extend harness to 2y+ and add `^GSPC`/equities with proper session calendar.
- Per-regime strategy conditioning (P3): `brain.mjs` already tracks everything needed; harness can A/B it via `--gate regime=...`.
- Re-then: measure the Tauric AI gate counterfactually on the same replayed bars (log verdicts per candidate, compare approved vs rejected sets).

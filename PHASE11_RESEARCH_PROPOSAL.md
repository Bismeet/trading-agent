# PHASE 11 RESEARCH PROPOSAL (record)

This proposal was authored before implementation and is preserved here as the pre-registration record. The machine-readable pre-registration is `config/phase11-spec.v1.json`.

## Chosen direction

**Candidate 1 — a weekly-rebalanced, vol-normalised, long-only relative-strength rotation with an absolute-trend gate, on the 5-year daily panel**, with **Candidate 4** (pure time-series trend) as its mandated ablation (implemented as baseline **B2**).

## Why this candidate

It is the only candidate that is (a) testable with data already in the repository, (b) built directly on the strongest evidence the program had produced (donchian's positive gross; the long/short asymmetry; the horizon–cost relationship), and (c) genuinely different from every prior phase along two axes at once — the **information** (cross-asset, never used) and the **economic operating point** (low turnover, long-only, weekly).

## Falsifiable hypothesis

> **H1:** a weekly-rebalanced portfolio long the top-K assets ranked by volatility-normalised trailing return, conditioned on each asset being above its own long-run trend, produces positive net-of-cost out-of-sample return **and** a higher net Sharpe than both equal-weight buy-and-hold and a time-series-only trend overlay, surviving a 25% cost increase and a one-day execution delay.
>
> **H0:** the ranking carries no information beyond the absolute-trend gate and buy-and-hold beta.

## Pre-registered acceptance gates

Twelve gates, fixed before TEST; a ROBUST verdict requires all twelve. See `config/phase11-spec.v1.json § acceptanceGates` and the final report §27.

## Honest expected failure modes (recorded before results)

1. Thin TEST sample (~52 weekly periods) ⇒ the honest verdict may be "insufficient evidence".
2. Cross-section collapses to a crypto beta bet.
3. Single-regime sample (one bear, one bull).
4. Turnover cost still bites.
5. Survivorship bias inflates any long-only backtest.

## STOP conditions (recorded before results)

- Immediate STOP (verdict C) if any acceptance gate fails.
- STOP and pivot to **Candidate 6** (reduce execution cost, or acquire historical funding data and test structural carry) if Candidate 1 fails and the failure is again cost-dominated or gross-edge-absent — that would be the seventh identical failure and the signal to stop directional search on this cost structure.
- Verdict D if the negative control fails to destroy the edge or the leakage audit fails.

## Outcome of this experiment

See `PHASE11_RESEARCH_REPORT.md`. **Verdict C.** Failure modes 1, 2 (differently), 3 and 5 were realised; failure mode 4 (turnover cost) was **eliminated** — cost is not the binding constraint at weekly turnover.

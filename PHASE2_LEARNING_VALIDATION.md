# PHASE 2 — LEARNING VALIDATION REPORT

## Executive summary

The contextual learner (Phase 1 foundation) was **validated for mechanism** this
phase: planted strategy/context edges are discovered automatically, exploration is
deterministic (UCB, no RNG), abstention fires when everything is bad, side/regime
cells stay independent, blocked cells don't leak across contexts, tiny samples
cannot kill a strategy, recovery after regime change works (with optional decay),
and no future data reaches an earlier decision. Real data remains too thin to
demonstrate improvement — stated plainly below.

## Synthetic benchmark (DETERMINISTIC — not live evidence)

`node scripts/v2/learning-benchmark.mjs` → **12/12 PASS**

| # | Check | Result |
|---|---|---|
| 1-2 | planted winners per regime (tsmom in broad_up, donchian in crypto_down) | PASS |
| 3-4 | cold start: nothing blocked, UCB equal → fair deterministic rotation | PASS |
| 5 | four regimes each prefer their own planted winner (no global "tsmom best") | PASS |
| 6-7 | regime isolation: bad regime blocked (n=10 losses), good regime eligible | PASS |
| 8 | side awareness: long +0.203R vs short −0.173R diverge independently | PASS |
| 9 | all-bad context (4 strategies −0.2..−0.3R, n=10 each) → ABSTAIN, not least-bad | PASS |
| 10 | recovery: 10×−0.5R then +0.6R until adjExp>0 → 9 trades at decay 1.0 | PASS |
| 11 | decay 0.95 recovers in 6 trades (recency helps; measured, not profit-tuned) | PASS |
| 12 | chronological invariant: info ts (close) < decision ts; close-fed only | PASS |

## Real-data evaluation (existing journal only — 20 closed trades)

`node scripts/v2/evaluate-learning.mjs --walk 5` (learner sees ONLY trades < N):

```text
BASELINE-A (as history happened)  n=20 meanR=-0.0501 win= 5.0% sumR=-1.003
BASELINE-B (equal rotation)       n= 5 meanR=-0.0423 win= 0.0% sumR=-0.211
LEARNER                           n= 1 meanR=-0.0151 win= 0.0% sumR=-0.015
switches=19  abstains=0  matched=1  cells: total=1 (n>=5:1, n>=10:1, n>=20:1)
```

Interpretation: history contains ONE cell (`broad_up|long|tsmom`, all 20 trades,
5-coin correlated basket, single market week). The learner cannot rank between
strategies that never fired; 19 decisions would have picked a different strategy
than the one that actually fired → counted as `switches`, credited with NO P&L
(outcomes never fabricated). The one matched trade is the only honest datapoint.
`--report` flags: `singleRegime: true, sampleSufficient: false, outOfSample: false,
futureLeakage: false`.

## Learning behavior (what changed vs Phase 1)

- Strategy switching: **mechanism verified** in benchmark (winners flip per regime
  automatically); not yet observable in real data (no alternative ever fired).
- Abstention: all-bad context abstains (benchmark §7); 0% abstain rate in real
  data because the single historical cell is only mildly negative (adjExp −0.05
  > blockEdge −0.05 boundary, n=20 quality ≈ 0.93 < 0.70? no — quality 0.93 ≥ 0.70).
- Contextual adaptation: regime/side isolation proven; learner state stays
  contextual (no global conclusions).
- Concentration reduction: same-setup cap now counts cycle picks + existing
  positions + pending orders (`maxSameSetupPositions=2`, ordering cannot bypass).
- Calibration: confident bucket (n≥10, quality>1.1) empty in real data — the
  learner is correctly NOT confident with this history.

## Data quality

trades=20 · episodes=7 · strategies used=1 (tsmom) · regimes seen=1 (broad_up) ·
context cells=1 · chronological coverage=1 market week · decay=1.0 (stationary
default) · evaluator walk-forward verified · no synthetic leakage into real files.

## Statistical limitations (explicit)

n=20 trades, one strategy-regime cell, one correlated 5-coin basket, one week.
No control arm, no out-of-sample split, no significance test possible (DSR needs
n≥8 per arm; switches contribute no outcome). Any "improvement" number from this
history would be fabrication — so none is printed.

## Remaining problems

1. Real evidence accumulates at ~1 cell per regime-week; needs 100+ trades across
   regimes before block/abstain/preference can pay (no shortcut without leakage).
2. `switches` P&L is unknowable without a full simulator replay of alternative
   strategies (signals fired but were never queued — no filled outcomes exist).
3. decay default 1.0 (stationary); recency weighting exists but off by design.
4. Same-setup cap counts pending orders but pending is cleared per episode; the
   cap is per-cycle + live-positions, not a global open-trade cap.
5. Orphaned `ai_decisions.v2.jsonl`/`ai_pending.v2.json` still on disk (dead,
   documented; not reintroduced per spec).
6. Exit-quality stats (MAE/MFE) specified but not collected yet.

## Final verdict

```text
LEARNING MECHANISM VERIFIED — NOT YET PROFITABILITY VERIFIED
```

Supporting statement: experience → contextual statistics → changed ranking →
different decision is proven deterministically (12/12 benchmark + 16/16 learner
tests + 68/68 full suite). Profitability is NOT established: real history is one
cell, one strategy, one regime, one week, negative expectancy (−0.05R).

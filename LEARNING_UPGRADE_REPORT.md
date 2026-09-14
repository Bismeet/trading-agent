# LEARNING UPGRADE REPORT — genuine local online learning (no LLM, $0 API)

## 1. What changed

Added `scripts/v2/learning.mjs`: contextual bandit over the 6 frozen signals.
Every close updates a `(regime|side|strategy)` cell immediately; every cycle
ranks candidates by shrunk expectancy + UCB, abstains when all bad, caps
same-setup at 2/cycle, scales size 0.5–1.5×. Lessons now also write
machine-readable penalty/boost that multiply scores. Fixed stale-freeze exits.
Orphaned AI logs untouched (no producer; documented, not reintroduced).

## 2. Why

Audit: policy fixed, lessons display-only, tsmom filled the book 25/25,
"improvement" to 0% was silence not skill. Now outcomes change ranking,
sizing, abstention automatically and explainably.

## 3. Files modified

- NEW `scripts/v2/learning.mjs` (buckets, store, update, scoreCell, rank, memory bias)
- `scripts/v2/store.mjs`: +`contextLearning`, +`learnDecisions` paths
- `scripts/v2/strategies.mjs`: emits ALL passing signals as candidates (+baseScore/setupRegime/closes)
- `scripts/v2/engine.mjs`: per-trade learner update in `closePosition`; rank/abstain/cap + audit log in cycle; `setupRegime` frozen into journal; stale quotes now mark+exit
- `scripts/v2/sizing.mjs`: bounded `sizeMult` (5b), hard caps unchanged
- `scripts/v2/brain.mjs`: `groupPnL` carries strategy/regime; `causalBias()`; causal penalty/boost writes
- `config.json`: `v2.learning` thresholds
- NEW `scripts/v2/evaluate-learning.mjs` (chronological replay)
- NEW `tests/learning.test.mjs` (10 tests) · NEW `docs/21-contextual-learning.md`

## 4. Architecture

```text
market context → 6 fixed signals → contextual learner → ranking/abstain/cap
→ council/risk gates → sizing → trade → outcome → cell update → future changes
```

## 5. Formulas

`adjExp=(n·mean+10·0)/(n+10)` · `ucb=adjExp+0.15·sqrt(ln(tot+2)/(n+1))` ·
`q=clamp(1+1.5·adjExp,.25,1.6)` · `uncAdj=n≥5?1:0.85+0.03n` ·
`final=base·q·uncAdj` · `size=clamp(1+1.2·adjExp,.5,1.5)` ·
block `n≥8 & adjExp<−.05` · abstain `ucb<0 or q<.70` · setup cap 2 ·
memory ×0.7/×1.15. Details: `docs/21-contextual-learning.md`.

## 6-10. Learned / causal / cold / no-trade / risk

Learns per-cell `{n,wins,losses,meanR,varR,winRate}` + causal penalty/boost.
Affects ranking, block, abstain, sizeMult, memory multiplier — never signal
logic, SL/TP, lev caps, council, survival, stale-entry block. Cold: prior +
UCB explores unknowns first; 1×−1R never blocks. No-trade logged ABSTAIN
(learned) vs vetoes (risk). Risk always wins.

## 11. Tests added (10, all pass)

update± · separation · cold start · abstain · concentration ·
persistence · risk dominance · multi-episode causality · tiny-n · buckets ·
causal-memory flip. Full suite 62/62 (52 existing + 10 new).

## 12-13. Evaluation (chronological, no leakage)

`node scripts/v2/evaluate-learning.mjs --walk 5` replays 20 journal closes in
ts order; learner sees only trades < N.

```text
BASELINE n=20 meanR=-0.0501 win=5.0% sumR=-1.003
LEARNER  n=20 meanR=-0.0501 win=5.0% sumR=-1.003 abstain=0 cells=1
```

Identical because history has ONE cell (`broad_up|long|tsmom`, 20/20 trades):
no alternative ever fired, so ranker cannot diverge; disagreements count as
abstain (no fabricated fills). Honest result: mechanism proven by unit tests,
history too thin/single-regime to show improvement.

## 14-15. Weaknesses / cannot claim

No profitability claim (learner == baseline on history). Needs 100+ trades
across regimes before abstention/block show value. Memory bias 0.7/1.15
uncalibrated, MAE/MFE not yet collected, US/India perp fiction remains,
orphaned `ai_*.jsonl` still on disk (dead, documented).

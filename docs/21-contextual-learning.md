# 21 — Contextual online learning (LOCAL, no LLM, no APIs, no neural nets)

Learner answers: "given this market context, which existing strategy earned trust?"
Signals unchanged (P4). Learner sits ABOVE them:
`market context → 6 fixed signals → contextual learner → ranking/abstain/cap → council → sizing → trade → per-trade cell update`.

## State

`data/context-learning.v2.json` `{version:1, updatedAt, experiences, cells}`.
Cell key = `regime|side|strategy` (≤72 cells). Each cell: `{n,wins,losses,sumR,sumR2,lastTs,lastExit,lastSymbol}`.
Survives episode reset + restart (own file); `--force` init never touches it.
Decisions: `data/learn-decisions.v2.jsonl` (SELECT/ABSTAIN/CAPPED + per-candidate evidence).
Structured causal memory: `memory.jsonl` kinds `causal-penalty` (×0.7) / `causal-boost` (×1.15) + human text (display).

## Context (9 buckets, discrete)

`regime` (6 engine labels) · `side` · `strategy` · `vol` low<0.02/med≤0.05/high (15-close σ) · `trend` bullish/neutral/bearish · `rsi` oversold<30/neutral/overbought>70 · `mom` pos>1/neg<−1/neutral · `fng` fear≤44/neutral≤55/greed≤74/extreme · `funding` crowded±0.0003/balanced · `session` us/eu/asia/off (UTC).
Scoring uses the primary cell; full context persisted per experience for audit/extension.

## Equations

Shrunk expectancy: `adjExp = (n·meanR + priorN·priorMean)/(n+priorN)`, priorN=10, priorMean=0 → n<5 mostly prior, 20+ data dominates. Sibling fallback n<3: shrink toward strategy-global mean (labeled `strategy-global`/`prior`).
UCB (deterministic): `ucb = adjExp + 0.15·sqrt(ln(tot+2)/(n+1))`, tot = regime|side total.
Quality: `q = clamp(1+1.5·adjExp, 0.25, 1.60)`. Uncertainty: `1` if n≥5 else `0.85+0.03n`.
`finalScore = baseSig × q × uncAdj`. Size: `sizeMult = clamp(1+1.2·adjExp, 0.5, 1.5)`.
Block: `n≥8 AND adjExp<−0.05`. Abstain: best `ucb<0` OR `q<0.70` (learned, logged as ABSTAIN — distinct from risk veto).
Same-setup cap: ≤2 opens per `strategy|regime|side` per cycle (CAPPED). Causal memory multiplies finalScore ×0.7/×1.15.
Risk dominance: learner only reorders/filters/weights; council/survival/lev/wallet caps unchanged and always win.

## Cold start / tiny-n

n=0 → prior (q=1.0, UCB bonus highest → explored first). 1×−1R → adjExp≈−0.09, never blocked (needs n≥8). Promotion gates (n≥30 + DSR etc.) unchanged.

## Risk-dominance hierarchy (Phase 2 §21, documented)

```text
HARD RISK      liquidation · stop-loss · take-profit · trailing · time stop
               survival underwater-block · 5x survival cap · account leverageCap
               market maxLeverage (40/4/5) · wallet 98% clamp · 10-position cap
               stale-data entry block · dd>10% risk brake
    ↓
MARKET VALIDITY  fresh quote · min-notional $2 · market-open gate
    ↓
COUNCIL        analyst/risk/investor vetoes (rules, no LLM)
    ↓
LEARNER        ranking · abstention (ABSTAIN_LEARNER) · same-setup cap
    ↓
SIZING         Kelly/vol/goal × learner sizeMult (0.5–1.5, bounded)
```

The learner only reorders, filters (blocked cells, abstain) and weights (sizeMult,
memory ×0.7/×1.15). It cannot open, resize beyond bounds, or bypass any gate
above it. Proven by `tests/learning.test.mjs` ("risk caps dominate learner size").

## Learning lifecycle (§26)

```text
trade close (engine.mjs closePosition)
  → recordExperience: decayed-mass update of cell n/wins/losses/sumR/sumR2
  → saveLearning (atomic tmp→rename, survives episode reset + restart)
  → next cycle: scoreCell → rankCandidates (quality + UCB) → rank/block/abstain/cap
  → learn-decisions.v2.jsonl audit row (SELECT/ABSTAIN_LEARNER/CAPPED + WHY per candidate)
```

## Limitations (explicit, §26)

- **Sparse data:** real history = 1 cell (`broad_up|long|tsmom`, n=20); all other
  71 possible cells are prior-driven. Benchmark numbers are SYNTHETIC.
- **Non-stationarity:** default `decay: 1.0` never forgets. Recovery works
  (10×−0.5R + 14×+0.6R → adjExp>0, unblocked) but is slow; `decay: 0.95`
  recovers ~33% faster (measured, not tuned for profit). Enable only with evidence.
- **Contextual sparsity:** primary cell is regime|side|strategy only. vol/trend/
  rsi/mom/fng/funding/session are captured and logged but NOT scoring dimensions —
  deliberately, to avoid a 9×6×2×6 combinatorial cell explosion.
- **No symbol generalization:** BTC and ETH share a cell only via regime; no
  hierarchical symbol shrinkage yet (evaluate evidence first, per spec §20).
- **No adaptive exits:** SL/TP/trail/time-stop frozen; exit-quality stats
  (hold time, exit reason) stored per cell for a future phase, unused today.
- **No learned regime model:** regime labels come from fixed `lib.mjs:regime()`;
  the learner adapts to regimes, it does not predict them.
- **Evaluator honesty:** unmatched decisions (learner would have picked a
  different strategy than the one that fired) are counted as `switches` and
  contribute NO P&L — outcomes are never fabricated.

## Cold start, no-trade, risk (§26 recap)

- Cold start: n=0 → prior mean 0, quality 1.0, max UCB bonus → every strategy
  gets deterministic fair opportunity; nothing blocked; no RNG anywhere.
- No-trade: if the best eligible candidate has `ucb < noTradeUcb` or
  `quality < noTradeQuality` → `ABSTAIN_LEARNER` logged (distinct from
  VETO_COUNCIL / VETO_RISK / SURVIVAL_BLOCK / NO_SIGNAL).
- Risk dominance: see hierarchy above; test-enforced.


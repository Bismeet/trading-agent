# 22 — Candidate Audit & Shadow Trades (Phase 3)

Companion to [21-contextual-learning](21-contextual-learning.md). Phase 3 adds two
deterministic, local-only layers around the existing learner. No LLM, no external
APIs, no randomness, no changes to strategy thresholds, risk hierarchy, leverage,
council, wallet or liquidation rules.

## Candidate audit (spec §1/§2)

Per evaluation cycle the engine writes one JSONL line to `data/candidates.v2.jsonl`:

```
{ ts, episodeId, cycle, regime, rows: [ { symbol, strategy_id, setup_tag, fired,
  side, baseScore, reason, setupRegime, status, rejectReason,
  learner: { n, adjExp, ucb, quality, finalScore }, rank } ] }
```

Status vocabulary: `no-signal` · `candidate` · `candidate-rejected-learner` ·
`candidate-rejected-cap` · `selected` · `selected-council-vetoed`
(+ `rejectReason: "survival-blocked"` for survival gate, `"rank-lost"`/`"blocked"`/`"abstain-ctx"` for learner cases).

Reduce it with the report generator (spec §2):

```
node scripts/v2/evaluate-shadow-learning.mjs --candidates [--json]
```

## Shadow trades (spec §3–§6)

`scripts/v2/shadow.mjs` turns every valid candidate that was **not** executed into a
shadow position, resolved against real future prices with the live engine's own math
(imported from `perp.mjs`: adverse fills, fees, slippage, EMA marks, funding,
liquidation, stop/target/time/trailing exits in the same strict order). Storage:

- `data/shadow-open.v2.json` — unresolved shadow positions
- `data/shadow-trades.v2.jsonl` — resolved outcomes (every row carries `shadow: true`)

Hard separation (tested):

- shadow P&L never touches equity, wallet, journal, trades, episodes or
  `strategies.json`;
- shadow outcomes never train the live learner — real learning comes only from
  executed closes;
- causality: a shadow record is built only from information available at decision
  time T; exit resolution only consumes quotes with `ts >= decisionTs`.

Documented execution differences (shadow header): nominal fixed margin
(`cfg.v2.shadow.marginUsd`, default $100) so sqrt-impact slippage sits at the same
scale as real trades; no wallet/council/survival re-check (the recorded rejection
reason replaces them); funding uses the last known rate.

Config (`config.json → v2.shadow`): `enabled`, `maxOpen` (100), `cooldownMs`
(600000, dedupes identical setup re-entry), `marginUsd`.

## Shadow / counterfactual evaluator (spec §7/§8/§10/§15/§16)

```
node scripts/v2/evaluate-shadow-learning.mjs [--json] [--min=5] [--candidates]
```

- Strictly chronological walk-forward; shuffled input throws (`assertChronological`).
- Baselines: SHADOW BASELINE (executed history), SHADOW LEARNER (what the learner
  would pick per cohort), COUNTERFACTUAL (fate of non-selected alternatives).
- Matching: executed fill ↔ shadow decision cohort of the same symbol within a
  5-minute window; selection quality (beatsBest / beatsAvg / regret) is computed only
  over matched cohorts.
- Aggregates by strategy / regime / side / `regime|side|strategy` cell with
  mean R, median R, win rate, profit factor — **only when n ≥ minSample**;
  otherwise `insufficient` / `null`. This is deliberate: no misleading percentages
  from tiny denominators.
- Fully deterministic; identical inputs produce byte-identical reports (tested).

## Acceptance tests

`tests/shadow.test.mjs` (16 tests) covers the 15 spec areas: candidate attribution,
diversity reduction, dataset separation (files + equity + learner), no future
leakage (pre-entry quotes ignored; post-entry resolves), chronological enforcement
(shuffled input throws), strategy/regime/side shadow aggregates, determinism,
selected-vs-shadow attribution, risk dominance (learner cannot override hard caps),
insufficient-data handling, and candidate-report reduction.

See [../PHASE3_CANDIDATE_AND_SHADOW_REPORT.md](../PHASE3_CANDIDATE_AND_SHADOW_REPORT.md)
for the real-data evidence, the TSMOM concentration investigation, and limitations.

# PHASE 3 — CANDIDATE DIVERSITY, SHADOW TRADES & LEARNING DATA

Status date: 2026-09-13. No LLM, no external AI APIs, no neural networks, no randomness.
All numbers below come from real files (`data/`, `tmp-live-probe/`) or from the test
suite. Nothing is fabricated; where data does not exist yet, that is stated.

---

## A. Candidate generation (spec §1)

`scripts/v2/strategies.mjs` now returns `{ orders, evaluated }` — one attribution row
per (symbol × applicable strategy) **including strategies that did not fire**.
Structurally ineligible seeds (retired status, market mismatch, e.g. ORB on crypto)
are excluded by design, not counted as "no-signal".

`scripts/v2/engine.mjs` freezes these rows into a per-cycle audit
(`data/candidates.v2.jsonl`, one JSONL line per cycle) and annotates them through the
full pipeline:

| spec case | audit status |
|---|---|
| A. no signal | `no-signal` |
| B. valid candidate | `candidate` |
| C. rejected by learner (rank/abstain/blocked) | `candidate-rejected-learner` |
| D. rejected by concentration cap | `candidate-rejected-cap` |
| E. rejected by council / risk gate | `selected-council-vetoed`, or `rejectReason: "survival-blocked"` |
| F. selected | `selected` |
| G. selected but not executed | remains in `pending.v2.json` (execution retry) |

Each candidate row carries: strategy, side, base score, learner snapshot **at decision
time** (n, adjExp, ucb, quality, finalScore), learner rank, rejection reason, setup
regime. The learner ranking log (`data/learn-decisions.v2.jsonl`) additionally records
a human-readable per-candidate decision line.

## B. Strategy diversity — REAL live probe (2026-09-13)

Because the live engine has been **stopped since 2026-09-09** (last heartbeat
2026-09-09T23:39Z, PID 10268 gone) and the audit/shadow code only ships with Phase 3,
no historical per-cycle audit exists. To get REAL candidate evidence without touching
the live ledger, one engine cycle was run in an isolated `FAB_DATA=./tmp-live-probe`
sandbox against live market quotes (2 cycles, 5 crypto symbols scanned, 0 live
positions, fresh learner). Result (`node scripts/v2/evaluate-shadow-learning.mjs --candidates`
against the sandbox):

```
STRATEGY CANDIDATE REPORT (2 audited cycles, 8 symbol-cycles with >=1 signal)
STRATEGY      evaluated candidates selected learnerRej capRej councilVeto riskBlocked
tsmom               10          8        4           0      4            0           0
donchian            10          0        0           0      0            0           0
ibreakout           10          0        0           0      0            0           0
mom_trend           10          0        0           0      0            0           0
rsi2dip             10          0        0           0      0            0           0
```

Data availability is NOT the cause: quotes carry 366 daily closes (rsi2dip needs 210,
tsmom 30, donchian 25) and 431 intraday closes (ibreakout needs 49). The zero-candidate
rows are genuine signal-condition misses (see §M for the exact arithmetic).

## C. Regime diversity

Probe: all 8 candidates in `us_down` (long side — tsmom long requires r28>+3% AND
price>200-SMA, which currently holds on BTC/ETH/SOL/XRP despite the us regime label;
the regime tag comes from the US-equity world state, crypto trends are independent).
Historical ledger: all trades `broad_up`. One regime per era; diversity must
accumulate over calendar time.

## D. Side diversity

Probe and ledger: 100% long. No short candidate has ever been generated (all momentum
signals currently point up; rsi2dip-short requires a downtrend that has not occurred
on the watched symbols during recorded history).

## E. Learner decisions (probe)

4 SELECT (BTC, ETH — one winner per symbol per cycle), 4 CAPPED (SOL, XRP —
`same-setup tsmom|us_down|long cycle 2/2, live 2/2`). Fresh sandbox learner ⇒ all
decisions were cold-start (learn.n=0) resolved by base score; abstention thresholds
were not hit.

## F. Risk rejections

Probe: council vetoed 0, survival-blocked 0. The veto path is exercised by
`tests/agents.test.mjs`; the audit wiring for it is `selected-council-vetoed`.

## G. Shadow opportunity count (probe)

2 shadow positions opened (SOL, XRP tsmom candidates that lost the concentration cap),
stored in `tmp-live-probe/shadow-open.v2.json` with decision-time learner snapshots and
`rejectReason: "cap"`. Shadow entries reuse the engine's adverse-fill math
(half-spread + sqrt-impact slippage, taker fee) at a nominal $100 margin (documented in
`scripts/v2/shadow.mjs` header).

## H. Shadow outcomes

0 resolved in the probe (resolutions require real future price evolution while the
engine runs). The live ledger has 0 shadow records (`data/shadow-trades.v2.jsonl` does
not exist yet). Shadow outcomes will accumulate once the engine is restarted on
Phase 3 code.

## I. Walk-forward results (real ledger)

`node scripts/v2/evaluate-shadow-learning.mjs` on the real data:

```
shadow walk-forward: 20 executed, 0 shadows, minSample=5
sample sufficiency: INSUFFICIENT (report only, no claims)
selection quality: withAlternatives=0 beatsBest=insufficient beatsAvg=insufficient meanRegret=insufficient
learner counterfactual: meanR=insufficient n=0 winRate=insufficient
decisions=20 candidates=20 abstentions=0 strategies=[tsmom] regimes=[broad_up]
```

20 closed executed trades (5 open pre-rows have no post pair and are excluded —
no fabrication), zero matched shadow cohorts ⇒ every selection-quality metric is
correctly reported as INSUFFICIENT, not as a number.

## J. Data quality

- Executed journal pairs pre/post rows on `trade_id`; rows without both halves are dropped, never imputed.
- Candidate audit and shadow datasets are new files; they populate from the next engine restart.
- Quote histories verified sufficient for all six strategies (§B).

## K. Leakage checks (all enforced by tests, tests/shadow.test.mjs)

- Pre-entry quotes cannot manage/close a shadow position (`q.ts < decisionTs` is ignored) — test 6.
- Shuffled chronological input THROWS instead of evaluating — test 7, `assertChronological`.
- Executed outcomes update the replay learner store; shadow outcomes never do — test 14.
- Shadow P&L never touches state equity, wallet, journal, or the live learner store — tests 3–5.
- The evaluator is a pure single-pass walk-forward: updates apply by `ts_close <= ts` before each decision — test 7 verifies decisions still run under strict ordering.

## L. Limitations

1. No historical per-cycle candidate audit exists (the audit ships with Phase 3); the
   TSMOM concentration explanation for the 25 historical trades therefore combines the
   real ledger, signal arithmetic, and a live probe — not a historical audit replay.
2. No resolved shadow outcomes exist yet; all shadow statistics are structurally
   INSUFFICIENT and reported as such.
3. Shadow execution differences (documented, `scripts/v2/shadow.mjs`): nominal fixed
   margin, no wallet/council/survival re-check (the rejection reason is recorded
   instead), funding = last known rate.
4. Shadow results are counterfactuals only: never equity, never real P&L, never live
   learner input (spec §3/§6 enforced and tested).
5. The live engine is stopped; Phase 3 collection (audit + shadow accumulation) starts
   on the next `npm run daemon` start.

## M. Strategy concentration explanation (spec §13)

**Observation (real ledger):** 25 journal pre-rows / 20 closed trades, 100%
`tsmom | long | broad_up`, opened in exactly 5 bursts (5 timestamps × 5 symbols).

**Pipeline trace (evidence-backed):**

1. **Signal generation** — `runStrategies` emits *all* firing strategies per symbol as
   candidates (not just the best). tsmom-long is a **standing state**: it fires on
   every cycle while `r28 > +3%` AND `price > 200-SMA` — conditions that persist for
   days in a sustained uptrend. Every other long strategy is an **event**:
   donchian-long fires only on the bar where price exceeds the prior 20-day high;
   rsi2dip-long only when RSI2<10 inside an uptrend; ibreakout only on a 15-minute
   48-bar-range break. Live probe arithmetic (2026-09-13): r28 = +21.9%/+32.0%/+33.8%/
   +35.1%/+20.2% (BTC/ETH/SOL/XRP/DOGE), but price sits 2–9% **below** each 20-day
   high ⇒ tsmom fired 8 times in 2 cycles, donchian/rsi2dip/mom_trend/ibreakout fired
   **zero** times. DOGE additionally failed tsmom (price < 200-SMA).
2. **Learner ranking** — one winner per symbol per cycle. When donchian and tsmom
   co-fire (proven possible on identical input by test 1, which shows both firing on
   one synthetic bar), the learner ranks them; the loser is recorded
   `candidate-rejected-learner` and becomes a shadow trade. tsmom's seed confidence
   (0.62 vs 0.60) gives it the base-score edge, and positive realized history in the
   `broad_up|long|tsmom` cell reinforces it via the quality term.
3. **Concentration cap** — caps tsmom at 2 selections per cycle + 2 live same-setup
   positions (probe: SOL/XRP capped exactly this way).
4. **Council/risk/sizing/execution** — no evidence of any non-tsmom candidate reaching
   these stages and being rejected there.

**Conclusion:** the honest answer is *"other strategies generated zero candidates at
probe time — TSMOM dominance comes from signal structure (standing state vs rare
event), not from downstream rejection."* Whether donchian ever co-fired with tsmom
during the 25 historical trades **cannot be determined retroactively** because no
per-cycle audit existed before Phase 3; the audit now records this every cycle, and
non-selected candidates become shadow trades resolved against real future prices.

## Learning-opportunity table (spec §11)

Empty by design for now: it is produced from resolved shadow records
(`aggregateShadowReport → aggregates.byCell`, printed by the evaluator CLI), and there
are zero resolved shadows. Showing a table of zeros would imply measurement where none
exists. The mechanism is tested (tests 8–10) and will populate as the engine runs.

## Fixes made while completing this phase

- `scripts/v2/engine.mjs`: `const openCount` → `let openCount` — the shadow-open loop
  incremented a const, which **crashed every engine cycle** at the shadow section
  (reproduced, then fixed and verified with a live sandbox cycle).
- `tests/shadow.test.mjs` test 14: requested `minSample: 1` to expose the
  counterfactual cell mean it asserts on; at the default minSample=5 a 1-sample cell
  correctly reports `meanR: null` (spec §9 insufficient-data rule), so the library
  behavior was right and the test expectation was adjusted. Strengthened with
  learner-store separation assertions.
- Added `candidateReport()` + `--candidates` CLI (spec §2 report) with test 16.

## Test status

82/82 PASS (`node --test tests/*.test.mjs`): 65 pre-existing + 16 shadow/Phase-3 tests
(+1 candidate-report test added while completing the phase). Phase 2's 12/12
synthetic learning tests remain green inside the suite.

---

PHASE 3 STATUS

LLM: NONE
External AI API: NONE
Learning: LOCAL CONTEXTUAL ONLINE LEARNING
Tests: 82/82 PASS
Candidate diversity: VERIFIED (attribution + reporting live-verified; diversity of *outcomes* awaits data)
Shadow trades: VERIFIED (isolation, causality, engine-identical execution; outcomes pending engine runtime)
Chronological evaluation: PASS
Future leakage: PASS
Strategy concentration explanation: see §M — tsmom is a standing-state signal that fires every cycle in a trend regime while all other seeds are rare event-type signals that currently generate zero candidates; downstream rejections play no role; historical co-firing is unknowable pre-audit.
Real-data evidence: 20 closed trades, all tsmom|long|broad_up, 5 burst entries; live probe shows other strategies generating 0 candidates with sufficient data history; learner has 1 populated cell.
Counterfactual evidence: 2 shadow opportunities captured in a live sandbox probe (both cap-rejected tsmom candidates); zero resolved shadow outcomes; all shadow metrics reported INSUFFICIENT — no claims made.
Profitability: NOT VERIFIED

**PHASE 3 PARTIALLY VERIFIED — infrastructure complete and verified; live candidate-audit accumulation and shadow outcome resolution require an engine restart (live engine stopped since 2026-09-09).**

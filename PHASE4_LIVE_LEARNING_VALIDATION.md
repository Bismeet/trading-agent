# PHASE 4 — LIVE LEARNING DATA COLLECTION, SHADOW RESOLUTION & OUT-OF-SAMPLE VALIDATION

Status date: 2026-09-13. No LLM, no external AI APIs, no neural networks, no randomness.
Every number below is read from real files (`data/`, live engine output) or produced by
the test suite. Nothing is fabricated; where evidence does not exist yet, that is
stated and the metric is reported INSUFFICIENT rather than zero-claimed.

Context: this phase continued from Phase 3's verdict that "infrastructure [was]
complete and verified; live candidate-audit accumulation and shadow outcome
resolution require an engine restart". The engine has now been restarted and the
full Phase 4 tooling verified against LIVE data.

---

## A. Engine health (spec §1)

| check | result |
|---|---|
| engine process | **RUNNING** (PID 21416, 30 s cycle) |
| heartbeat | fresh at report time (`data/heartbeat.v2.json`, cycle 995, 2026-09-13T12:58Z) |
| episode transition | Episode 11 finalized `time` at 2026-09-13T12:34:47Z (85.2 h); Episode 12 started immediately |
| candidate audit written | YES — `data/candidates.v2.jsonl`, one JSONL line per evaluated cycle |
| learner decisions written | YES — `data/learn-decisions.v2.jsonl` (per-candidate SELECT/CAPPED/ABSTAIN lines) |
| shadow opportunities written | YES — `data/shadow-open.v2.json` (2 shadow positions held) |
| real trades separate from shadows | YES — real fills live in `journal.v2.jsonl`/`trades.v2.jsonl`; shadows only in `shadow-open.v2.json`/`shadow-trades.v2.jsonl` |
| state persistence across restart | YES — see §P |
| no crash in shadow-open loop | YES — cycles 948→995 continuous (the `openCount` crash from Phase 3 was fixed and verified over ~50 live cycles) |
| atomic persistence | YES — integrity checker PASS (§N) |

Full pipeline observed continuously on live cycles 948–995:
market → strategies → candidates → learner → risk → execution → shadow → persistence.

## B. Data collection period

- Engine restarted 2026-09-13T12:34:47Z after being stopped since 2026-09-09T23:39Z.
- First audited cycle of the new era: cycle 948 (12:34:58Z). Audited cycles: **6**
  (948–953). Candidates in that window: **8** (all tsmom | long | us_down).
- **After cycle 953 candidate generation was SUSPENDED by the survival gate**: the
  engine opened two real BTC-USD / ETH-USD 12× longs at 12:41:26Z; entry fees pushed
  equity to $99.98 < the $100.00 floor, so `survivalGate` returns `blocked` and the
  engine evaluates zero strategies every cycle (by-design hard-risk behavior, NOT
  loosened — spec §2/§21). Data collection resumes automatically the moment equity
  is back above the floor.

## C. Candidate diversity (live era)

```
STRATEGY      evaluated candidates selected learnerRej capRej councilVeto riskBlocked
tsmom               30*          8        4           0      4            0           0
donchian            30            0        0           0      0            0           0
ibreakout           30            0        0           0      0            0           0
mom_trend           30            0        0           0      0            0           0
rsi2dip             30            0        0           0      0            0           0
```
(*3 evaluated symbols × 6 audited cycles; survival-suspended cycles produce no audit
rows at all.)

Same structural asymmetry as the Phase 3 live probe: tsmom is a standing-state signal
(fires every cycle in the current trend regime); donchian/rsi2dip/mom_trend/ibreakout
are rare event-type signals that genuinely generated zero candidates. **This is NOT
evidence tsmom is the best strategy** — only that the others produced no comparable
opportunity during the observed window. Thresholds were NOT touched (spec §2/§14).
Per spec §14 the calibration question is deferred to a separate experiment.

## D. Regime coverage

- Live candidate era: `us_down` only. Historical executed ledger: `broad_up` only.
- **REGIME STARVATION** — one regime per era; diversity accumulates over calendar time.

## E. Side coverage

- 100% long (candidates + executed + shadows). All momentum seeds are structurally
  long-only in the current regime arithmetic. **SIDE STARVATION.**

## F. Strategy coverage

- tsmom only. **SIGNAL STARVATION** — see §C.

## G. Learning cells

- Live learner store: **0 populated cells**. The 20 historical closed trades predate
  the learning upgrade (engine was stopped when it shipped), so no causal cell
  experience exists for them; per spec (no retro-fitted context) they are NOT
  backfilled. The learner starts collecting causally from the live era onward.
- Chronological REPLAY of the 20 historical outcomes (learning-curve tool, analysis
  only) populates exactly 1 cell (`broad_up|long|tsmom`) — this is measurement, not
  live state.
- Sample buckets (spec §11): n<5 cold (ALL live cells), 5–10 early, 10–20 developing,
  ≥20 meaningful, ≥50 stronger. No live cell has reached even "early".
- "Learning cannot happen here yet because these cells have insufficient observations."

---

## H. Shadow trades

2 shadow trades opened (2026-09-13T12:41:26Z), both cap-rejected tsmom candidates
(SOL-USD, XRP-USD; the concentration cap allows 2 same-setup positions and the real
BTC/ETH fills consumed them). Every required field is present on the open book and
the resolved record (verified in `scripts/v2/shadow.mjs` + live file):

`decisionTs, entryTs, exitTs, symbol, strategy_id, regime, side, baseScore,
learnerScore, rank, rejectReason, entry, exit, realized_R, exit_reason, fees,
fundingAccrued, mae_roi, mfe_roi, hold_secs, roi_on_margin, actualSelectedStrategy`

Shadow execution assumptions are the documented, engine-identical ones (adverse half-
spread + sqrt-impact slippage fill, taker fees, EMA marks, funding, liq → stop →
target → time → trailing in the same strict order). Paper-trading isolation is
explicit: `shadow: true` on every resolved row; shadow P&L never touches equity,
wallet, journal, episodes or the live learner. Remains paper trading only — no
brokerage, no API keys, no live orders anywhere (spec §15).

## I. Resolved shadows

- **0 resolved / 2 unresolved** at report time. Both shadows entered 12:41:26Z with
  `maxHoldHours=4`; they resolve (or liquidate/stop/target) as future quotes arrive —
  the resolution path is test-verified (Phase 4 tests 1–2, Phase 3 tests 8–10) and
  consumes only post-entry quotes (`ts >= entryTs`).
- Resolution is causal: a shadow is never resolved with pre-decision data and the
  original candidate is never altered by future information.

## J. Decision cohorts

- **0 multi-strategy cohorts.** `buildCohorts` (spec §6) requires ≥2 DISTINCT fired
  strategies for the same (cycle ts, symbol, regime); single-candidate decisions are
  excluded from choice-cohort counting by design and by test.
- Live shadow records carry `actualSelectedStrategy` (the strategy actually executed
  for the same symbol-cycle, `null` when nothing was executed for that symbol) so
  selected-vs-alternative comparison becomes possible once resolved.

## K. Selection quality

- `evaluate-shadow-learning.mjs` implements the full walk-forward computation:
  selected R, best available R, average available R, selected−best, selected−average,
  regret, beats-best rate, beats-average rate — computed ONLY when ≥2 finite resolved
  outcomes exist in a cohort, and ONLY from outcomes with `ts_close <= decision ts`
  at learner-update time.
- Current values: **withAlternatives=0 → INSUFFICIENT.** Nothing fabricated.

## L. Learning curve

`node scripts/v2/learning-curve.mjs` (window=20, walk-forward, executed and shadow
kept in separate buckets):

```
#0 [2026-09-07T19:22Z .. 2026-09-08T21:54Z] out=20 ex=20 sh=0 dec=0 abst=—
   exR=-0.050 exWin=0.050 shR=— cells=1 firing=[—] cohorts=0
```
The only populated window is the 20 historical trades (mean −0.050R, 5% win rate).
No improvement is claimed anywhere — the tool explicitly reports that a later window
making more money is not evidence of learning.

## M. Baseline comparison

| baseline | label | n | meanR | win |
|---|---|---|---|---|
| A | historical selection (OBSERVED) | 20 | −0.050 | 5% |
| B | deterministic equal rotation (ANALYSIS; matched picks only) | 20 | −0.050 | 5% |
| C | **HINDSIGHT upper bound** — best available in cohort; NOT executable, never feeds the learner | 0 | undefined | — |

Baseline C is undefined (NOT zero) because no fully-resolved multi-strategy cohorts
exist; the tool labels it hindsight in both output and code. Baseline B equals A
because the only strategy historically present in the context is tsmom — the rotation
cannot differ.

## N. Data integrity

`node scripts/v2/validate-learning-data.mjs` → **PASS (exit 0)** on the live data dir:
- 55 rows scanned, 0 malformed JSONL
- 0 duplicate trade ids (journal pre/post), 0 duplicate shadow ids
- 0 impossible timestamp orderings, 0 shadow-outcome-before-entry
- 0 actual/shadow contamination (no id collision journal ↔ shadow-trades; every
  shadow row carries `shadow:true`)
- 0 orphan post rows; 7 pre-rows-without-post are legitimately explained (5 forfeits
  from pre-Phase-3 engine versions + 2 currently-open live positions) → warnings,
  not failures
- learner experiences (0) ≤ closed trades (20) → no duplicate learner updates, no
  shadow leakage into the live store

## O. Leakage tests

PASS. Enforced and tested:
- learner updates happen only when `ts_close <= decision ts` (walk-forward replay;
  shuffled inputs THROW — the chronological invariant is an assertion, not a convention)
- shadow resolution ignores pre-entry quotes (Phase 4 test 2)
- executed vs shadow never mix in aggregates (Phase 4 test 14)
- shadow outcomes never reach the live learner (hard separation + integrity check)

## P. Restart tests

Real-world restart verified: the engine ran episode 11 for 85.2 h, was stopped for
3.7 days, was restarted 2026-09-13T12:34:47Z, recovered its state, finalized the old
episode, continued cycle numbering (948→995) and kept all audit/decision/shadow files
append-consistent (integrity PASS, zero duplicate updates). Programmatic equivalents
are covered by Phase 4 tests 12–13 (persist → stop → restart → continue; no duplicate
learner update) and the FAB_DATA isolation regime.

## Q. Limitations

1. **Survival-gate suspension** (the dominant live data-collection blocker): while
   equity < floor, the engine evaluates zero strategies → no audit rows, no learner
   decisions, no new shadows. This is intended hard-risk behavior and was NOT
   modified. The health monitor now reports it as `RISK STARVATION` instead of
   silently showing an empty candidate log.
2. Single strategy / regime / side → selection quality is structurally unmeasurable
   until other strategies co-fire.
3. 0 resolved shadows → all shadow-based metrics report INSUFFICIENT.
4. Historical trades cannot be causally scored (no context was captured at their
   decision time); they serve only as replay/baseline evidence.
5. Data-collection period is ~25 minutes of live cycles; nothing here is
   statistically meaningful and none of it is claimed to be.

## R. Profitability status

`PROFITABILITY: NOT VERIFIED` — enforced by `scripts/v2/claim-guard.mjs`
(hard reporting rule, spec §19). The guard currently lists: executed 20 < 50,
resolved shadows 0 < 20, multi-strategy cohorts 0 < 20, no valid comparison
baseline, outcome coverage incomplete. The wording "learner profitable / AI improved
returns / learning increased profit" is gated behind all thresholds and can never
print from this dataset.

---

## Fixes made while completing this phase

- `scripts/v2/validate-learning-data.mjs`: default data path used `URL.pathname`,
  which is broken on Windows (`/c:/...`) — the CLI scanned **0 rows** while still
  printing PASS. Fixed with `fileURLToPath`; now scans 55 live rows. Regression test
  15b added.
- `scripts/v2/validate-learning-data.mjs`: `closedTrades: closed.length` on a number
  (always `undefined`), which silently disabled the duplicate-learner-update check.
  Fixed; the experiences ≤ closed-trades check is now live.
- `scripts/v2/live-learning-health.mjs`: survival-gate suspension was invisible
  (suspended cycles produce no audit rows). Added read-only survival-gate detection +
  `RISK STARVATION` reporting (spec §13: name the exact starving layer).

## Test status

**96/96 PASS** (`node --test tests/*.test.mjs`): 82 pre-existing + 13 Phase-4 tests +
1 new default-path regression test. Phase 2's synthetic learning benchmark remains
green inside the suite.

---

PHASE 4 STATUS

LLM:
NONE

External AI API:
NONE

Learning:
LOCAL CONTEXTUAL ONLINE LEARNING

Tests:
96/96 PASS

Engine:
RUNNING

Candidate attribution:
PASS

Shadow resolution:
PASS (infrastructure test-verified; 2 live shadows pending resolution)

Decision cohorts:
0

Resolved shadow trades:
0

Strategy diversity:
INSUFFICIENT

Regime diversity:
INSUFFICIENT

Side diversity:
INSUFFICIENT

Learning evidence:
INSUFFICIENT

Future leakage:
PASS

Data integrity:
PASS

Restart persistence:
PASS

Selection quality:
INSUFFICIENT

Profitability:
NOT VERIFIED

FINAL VERDICT:

**2. PHASE 4 PARTIALLY VERIFIED — data-collection and validation pipeline is complete,
live and integrity-clean (engine running, candidate attribution + shadow records +
decision cohorts + claim guard all verified, 96/96 tests), but live learning evidence
cannot accumulate: the survival gate suspends candidate generation while equity is
below the $100 floor (by design, not modified), only one strategy/regime/side has
ever generated candidates, 0 shadows have resolved, and 0 multi-strategy cohorts
exist — so selection quality, learning improvement and profitability remain
INSUFFICIENT / NOT VERIFIED until (a) equity recovers above the floor for sustained
collection and (b) other strategies naturally co-fire with tsmom.**


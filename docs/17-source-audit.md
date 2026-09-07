# SOURCE AUDIT

Audit scope: supplied source-article.md, all P1–P11 and trailing guidance, as of 2026-09-07. This is source/design analysis, not an executed application audit. Severity **required** means required for the recommended correctness baseline, not a newly discovered source requirement. Recommendations never silently overwrite A. SOURCE ARCHITECTURE.

## A. Strong design decisions

| Source decision | Why valuable | Recommendation / priority |
|---|---|---|
| Paper-only, no runtime LLM/order venue | Clear separation of deterministic rules from build assistant and real capital | Preserve; required |
| Explicit adverse fees/funding/slippage and liquidation | Makes costs visible instead of displaying gross-only paper profits | Preserve intent and test implementation; required |
| File-backed local architecture, pure math module | Small conceptual surface and testable formulas | Preserve architecture, complete contracts; strongly recommended |
| Persistent episode learning and honest missing-source display | Retains failures and exposes unavailable data | Keep run boundaries and provenance visible; required |
| Wilson/SQN/t/DSR and probation concepts | Acknowledges small samples and multiple testing | Preserve but qualify heuristic evidence; strongly recommended |
| Separate web process and read-only dashboard | UI can inspect engine without driving trades | Preserve; strongly recommended |

## B. Weak design decisions

| ID | What source does | Problem | RECOMMENDED IMPROVEMENT | Priority |
|---|---|---|---|---|
| A01 | Per-file atomic JSON plus multiple append streams | No atomic cycle across account/fills/journal/learning; crashes can double count | Single writer, event identity, committed snapshot/replay protocol within same filesystem | required |
| A02 | Last6k journal lines / last500 memory retrieval | “Lifetime” scoring becomes bounded-window scoring; long trade pre may be lost | Preserve joinable trade outcomes and document scoring windows; bounded indexes/compaction | strongly recommended |
| A03 | Same public snapshot polled for quote/mark | Smoothed stale ticks can imply stability and delay loss recognition | Timestamp actual observations; do not repeatedly update mark from unchanged stale data | required |
| A04 | Six-second API parses JSONL | Histories grow indefinitely even when response is bounded | Bounded tail/indexed reads and retention/compaction strategy | strongly recommended |

## C. Ambiguous requirements

| ID | Source behavior | Why problematic | Recommendation | Priority |
|---|---|---|---|---|
| A05 | P4/P8 next-tick promise vs step6 immediate execution | Cannot both hold for new strategies | Adopt explicit t→t+1 queue barrier; document deviation from step6 | required |
| A06 | RSI/SMA/momentum/regimes named, not fully defined | Different normal implementations emit different trades | Approve exact units, warmups, RSI convention and regime thresholds with fixtures | required |
| A07 | literal retN index last−1−n, nominal “28-day” | Potential 29-interval calculation | Retain literal source in reference; approve intended index explicitly | required |
| A08 | confidence, retirement, live evolution increments and prior blend unspecified | Coding agent must invent learning behavior to finish | Versioned deterministic decision register, no fabricated author defaults | required |
| A09 | goal deadline and episode timeout separately stored | UI can promise no deadline while engine ends at24h | Display actual operative timeout or explicitly separate goal timing | strongly recommended |
| A10 | Source schema conceptual, not executable contracts | UI keys/orderings/units can drift | Approve 15 contract and record field provenance | required |

## D. Potential bugs

| ID | Source behavior | Why problematic | Recommendation | Priority |
|---|---|---|---|---|
| A11 | Fee charged after 98% wallet margin cap | At the configured 40× and .0005 taker rate, one same-notional order uses 99.96% of wallet including fee, so the default reserve does cover that entry narrowly; higher effective costs or multiple pre-sized intents can still overspend | Fee-aware affordability and fill-time sequential sizing; do not falsely claim the default single-order arithmetic already exceeds cash | required |
| A12 | Pure openPosition entryPrice=entryMark; separate fillPrice | Easy to ignore impact or apply twice | Define executed entry vs mark reference; reconcile ledger | required |
| A13 | fillPrice side argument reused for close | Using long position tag on long close gives favorable rather than adverse direction | Explicit buy/sell execution direction mapping | required |
| A14 | Equity recomputed before steps5/6, end check afterward | Fees/closed positions can leave stale equity for terminal decisions | Reconcile after every execution batch and before final records | required |
| A15 | nextEpisode clears positions; pending reset absent | Survivors can disappear or old intents leak into new capital | Settle exactly once; cancel/tag old-run orders; transactional finalization | required |
| A16 | tierFor falls back to final tier; maintenance may be negative | Below-range/invalid tier input silently selects unsuitable parameters | Validate sorted contiguous tiers/ranges; explicit out-of-range behavior | required |
| A17 | total best return initializes0 | All losing history falsely displays zero as best run | Distinguish no finished run from max observed negative return | strongly recommended |
| A18 | Root scripts point to files never created | npm init/cycle/daemon commands fail | Approved aliases to v2 or documented wrapper files; no hidden path changes | required |
| A19 | FAB_SIGNALS exists only in engine path registry | Dashboard can silently read wrong/missing signal file | Shared path resolution with documented override semantics | strongly recommended |

## E. Potential unrealistic assumptions

| ID | What source does | Problem | Recommendation | Priority |
|---|---|---|---|---|
| A20 | Calls simplified liquidation mechanically exchange-correct | Formula ignores tier deduction, maintenance notional changes, fees/funding/margin changes | Name source model a simplified isolated simulator; optionally implement validated venue model as separate approved mode | required |
| A21 | EMA of spot/index substitutes for exchange mark | Can smooth away executable gaps and delay liquidation | Disclose proxy; compare raw/stale/mark behavior; do not claim exchange fidelity | required |
| A22 | Fixed depth proxy2m and default vol.02 | “Real slippage” actually a model without measured depth | Label modeled costs, record assumptions, sensitivity tests | strongly recommended |
| A23 | Crypto funding average applied at8h | Actual rate interval/asset mapping/history not given | Verify units, per-asset rates and observation times; label unavoidable approximations | required |
| A24 | Stocks treated as leveraged perpetual-like positions | Borrow/short availability, holidays, execution lots and venue liquidation differ | Keep educational model label; define market-specific costs/eligibility | strongly recommended |
| A25 | USD100→500 in24h,20× starting cap; “safety dial” prose | Extreme simulated target is not low-risk wealth growth | Preserve source settings but show risk honestly; alternative conservative profile optional and separate | strongly recommended |

## F. Security concerns — specialist review required

This subsection is deliberately **not a completed security audit**. Use the **Security Analyst Agent**, selected through the new Chat icon, for the security/vulnerability assessment of this proposed design and any eventual implementation. Do not infer a clean security result from the absence of findings here. Record that specialist's findings separately as recommendations without modifying the source-derived contracts. Priority: required before any security-readiness claim.

## G. Data-quality concerns

| ID | Source behavior | Problem | Recommendation | Priority |
|---|---|---|---|---|
| A26 | fetchFx fallback83.0 | Fabricated current FX conflicts with honesty; INR positions may misstate USD balances | Preserve source fact, recommend unavailable/stale metadata and block affected new exposure absent acceptable FX | required |
| A27 | Last-good caching plus dead-source dash | Old data may look current without provenance | Per-source timestamp, status, TTL, hard age expiry; never map missing to0 | required |
| A28 | Numeric-only histories | No complete-bar timestamp or causality proof; OHLC and session absent | Enrich provider boundary with source timestamps/completeness, retain closes for source signal API | required |
| A29 | Quote currencies returned but FX placement omitted | Notional/margin calculations can mix INR and USD | Normalize to accounting currency and record instrument units | required |
| A30 | Yahoo/Coinbase/provider fallback varies | Delays, marketState and prevClose availability differ | Provenance-aware normalized quotes, unavailable optional fields | strongly recommended |
| A31 | World collected after position funding | Current collection cannot govern earlier same-cycle accrual | Define known-at-time funding policy with historical samples | required |

## H. Statistical/quant concerns

| ID | Source behavior | Problem | Recommendation | Priority |
|---|---|---|---|---|
| A32 | DSR across six current strategy IDs | Ignores discarded variants and repeated peeking; dependent trades | Track all trials/versions, out-of-sample evidence and dependence limitations | strongly recommended |
| A33 | SQN/t both mean-over-sd statistics | Gates may be redundant rather than independent proof | Document dependence, do not multiply confidence claims | strongly recommended |
| A34 | “half-Kelly” multiplier.4, unspecified variance/prior | Terminology misleading and estimates unstable | Preserve literal.4, define variance/prior provenance and small-sample behavior | required |
| A35 | Candidate default Kelly.12; non-retired eligible | “Only after proof” claim not true at initialization | Explicit evaluation-stage exposure labeling; optional separate candidate limits | strongly recommended |
| A36 | Live cadence can reuse same≥4 trades | Unchanged sample can repeatedly unlock risk | Consume new-close cursor and require fresh evidence for each adjustment | required |
| A37 | Cap starts20 while seeds10–15; lower cap bounded20 | Level-ups often cannot change actual leverage; blowup cannot reduce below20 | Display cap vs actual, preserve facts; alternative per-strategy earned leverage is optional redesign | strongly recommended |
| A38 | Kelly max.7 configured but increment clamps omitted | Dial can leave intended bounds | Explicit approved clamps with tests; no hidden coefficient edits | required |
| A39 | Memory text described as “learns” | No implementation connecting text lessons to signal edits | Describe descriptive memory/statistical adaptation accurately | required |
| A40 | R denominator unspecified | All strategy statistics may compare incompatible returns | Freeze initial risk denominator and cost conventions per trade | required |

## I. Scalability concerns

Single-engine/local filesystem is appropriate for source scope; it is not a distributed multi-account service. Parallel quote reads plus cache collectors need bounded concurrency and cycle overlap protection. Full-file JSONL reads per poll grow with runtime; multiple web/engine writers multiply race risks. RECOMMENDED IMPROVEMENT: retain single-writer architecture, bounded history reads, metrics for loop latency, source timeout budgets and disk growth. Priority strongly recommended; database/distributed migration optional only after demonstrated need, never a source requirement.

## J. Outdated dependencies or APIs as of 2026

No registry or provider was probed in this session, so none is certified current, obsolete or available. Exact source pins are in 05. Node LTS is unpinned, Node typings ^20 may not match selected LTS, and caret ranges contradict the prose promise of “exact versions.” Yahoo public chart access, CNN data endpoints, Stocktwits streams, CBOE CSV URLs, RSS paths and GDELT query formats require live verification. Hyperliquid funding units require current schema confirmation. Recommendation: record package resolution/peer requirements and dated provider contract tests, preserve exact source declarations separately, propose replacements only after observed incompatibility. Priority required before claiming an executable blueprint environment; no invented deprecation dates.

## K. Improvements before implementation

Required correctness decisions: next-tick execution, full ledger/currency/cost rules, stale/missing observations, funding periods, realized_R/indicator conventions, persistent queue/event identity, episode recovery, schemas, learning thresholds and account-Kelly limits. These preserve the file-backed source architecture. Optional future work: richer measured execution costs, conservative profile, independent out-of-sample backtesting framework, or strategy-version experiments. These must not displace original rules unnoticed.

See [19](19-recommended-architecture.md) for proposed decisions and [18](18-implementation-checklist.md) for their execution tracker. “Perfect” is not a verifiable property; explicit assumptions, reproducible tests and honest outstanding-review status are the quality standard.

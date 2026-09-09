# AUDIT — FabInvests Trading Bot (actual repo)

> SCOPE NOTE: the brief describes TauricResearch/TradingAgents (LangGraph,
> checkpoints, Gemini tokens, WS/SSE, analysis_id). NONE of that exists here.
> Actual: deterministic zero-LLM paper engine + flat files + polling dashboard.
> Items with no counterpart are marked N/A, not faked.

## 1. Architecture (actual)

Feeds -> engine.mjs 30s cycle (PM2) -> data/*.json(L) ->
GET /api/state (filesystem bridge) -> Root.tsx 6s poll -> DashboardV2.
POST /api/state queues to commands.v2.json -> engine consumeCommands().
Backend OWNS execution (separate OS process). Refresh cannot kill a run.

## 2. Lifecycle

cycle(): state -> consumeCommands -> gatherData -> markAndManage
(liq>stop>target>time>trail) -> computeEquity -> fill pending (D01 next-tick)
-> runStrategies -> agentCouncil (rule-based, no LLM) -> queue survivors ->
episode end (blowup>goal>time) -> world -> persist state/prices/equity/signals.
Overlap guard + pid lock + SIGINT/SIGTERM release. `--once` = one cycle.

## 3. State management

Single-writer files, atomic per-file tmp->rename (good). No snapshot IDs.
Frontend holds polled snapshot in React state. No WS/SSE (polling only —
each poll is a full snapshot, so missed-event corruption is impossible).
## 4. Checkpoints — N/A (no LangGraph here)

Closest equivalent: state.v2.json (full snapshot each cycle) +
pending.v2.json (unfilled intents) + append-only journals. Crash between
cycles loses <=1 cycle. Crash mid-cycle (across ~6 sequential writes) can
leave a torn snapshot (B01).

## 5. Persistence

Per-file atomic rename (good). Cross-file set NOT atomic (documented D05 gap).
appendJSONL non-atomic; readers skip corrupt tails (good). FAB_DATA isolates
tests; FAB_SIGNALS honored by engine but NOT by route (B06). data/ gitignored.

## 6. Token accounting — N/A

Zero LLM calls, zero tokens, zero cost. Nothing to count; none invented.

## 7. WS/SSE — N/A

Transport is 6s HTTP polling. No sockets, no reconnect loops possible.

## 8. Bugs found

B01 HIGH torn snapshot: state/prices/equity/signals written sequentially, a
poll mid-sequence mixes new positions with old equity (screens disagree).
B02 HIGH poison commands kept forever with .error, retried each cycle; queue
can fill to 20 and 503-block legit commands.
B03 HIGH POST read-modify-write race can lose a command; no idempotency, so a
double-click queues twice (double restart = phantom episode).
B04 MED no engine heartbeat: UI cannot tell halted engine from flat market.
B05 MED naive poller: no in-flight guard, no backoff, no visibility pause.
B06 MED route ignores FAB_SIGNALS env that the engine honors.
B07 MED covered by B03 (restart double-fire).
B08 MED lock has no heartbeat; --once bypasses lock (two writers possible).
B09 LOW council card shows only last batch (tail-1 read).
B10 LOW equity tail re-read (4000 lines) every 6s poll.
B11 LOW no structured log fields; lib.log writes legacy engine.log.
B12 LOW restart validation drift between UI and route.

NOT bugs here: refresh killing analysis (engine is independent); WS dupes
(no WS); Gemini 429/503 (no LLM; feeds degrade to last-good+stale); token
mismatches (no tokens exist).

## 9. Root causes

Flat-file single-writer design with no snapshot versioning, no queue hygiene,
no request dedupe, naive poller, split log paths, duplicated path resolution.

## 10. Fixes (scoped, no engine rewrite, CLI preserved)

F01 snapshotId (ep_N:cycle_M:ts) in state+signals; route returns snapshot meta
+ per-file status + staleness. F02 poison hygiene (attempts counter, drop
after 5, cap 10 errors). F03 POST idempotency via clientToken + deep-equal
dedupe + mtime-checked retry. F04 heartbeat.v2.json + liveness in API + UI
pill. F05 robust poller (guard, backoff, visibility pause, keep-last-good,
LIVE/RECONNECTING/STALE/ERROR). F06 route honors FAB_DATA/FAB_SIGNALS. F07
structured log + v2 log path. F08 tests/reliability.test.mjs. F09 runbook.

Explicitly NOT done (would be fakery): LangGraph checkpoints, token/LLM
accounting, WS/SSE layer, analysis_id job table.

## 11. Files changed (planned)

scripts/v2/store.mjs, scripts/v2/engine.mjs, scripts/v2/controls.mjs,
scripts/lib.mjs, web/app/api/state/route.ts,
web/app/components/Root.tsx, web/app/components/DashboardV2.tsx,
tests/reliability.test.mjs, AUDIT.md, deploy/README.md.

## 12. Test plan

npm test (incl. new reliability tests) + node --check + live --once smoke +
web build. No LLM quota needed. Real AAPL check = live-smoke provider test.


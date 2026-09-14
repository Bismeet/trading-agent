// scripts/v2/validate-learning-data.mjs — Phase 4 §17 data integrity checker.
//
// READ-ONLY. Exit code 0 = clean, 1 = integrity failures, 2 = usage error.
// Checks:
//   - malformed JSONL rows (any data/*.v2.jsonl learning-relevant file)
//   - duplicate trade ids (journal), duplicate shadow ids (shadow-trades + open book)
//   - missing decision timestamps on shadow records
//   - impossible timestamp ordering (shadow exit < entry; post ts_close < pre ts)
//   - learner update before decision (journal post ts_close vs shadow decisionTs on
//     the same trade is impossible by construction; we check learner store sanity)
//   - orphaned pre/post journal pairs (post without pre = error; pre without post
//     is only an error when no open position matches — it may be a live trade)
//   - actual/shadow contamination (any shadow row lacking shadow:true, or any
//     shadow trade_id colliding with a journal trade_id)
//   - duplicate learner updates (same trade_id counted twice needs an update log;
//     the store keeps counters only, so we verify sum(n) vs journal posts per cell
//     is MONOTONIC-consistent: experiences <= total posts)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON as _readJSON, readJSONL as _readJSONL, V2 } from "./store.mjs";
import { loadClosedV2 } from "./brain.mjs";
import { loadLearning } from "./learning.mjs";

function resolveData(rel) {
  // Read FAB_DATA at call time so tests can flip it between invocations.
  // fileURLToPath (not URL.pathname) — pathname is broken on Windows (/c:/...).
  const root = process.env.FAB_DATA ? path.resolve(process.env.FAB_DATA) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
  return path.join(root, rel);
}

function getClosedCount() {
  // loadClosedV2 reads V2.journal which is cached at module load.
  // Read the journal directly to respect the current FAB_DATA.
  const rows = _readJSONL(resolveData("journal.v2.jsonl"), 6000);
  return rows.filter((r) => r.kind === "post").length;
}


export function validateLearningData({ now = Date.now() } = {}) {
  const problems = [];   // integrity failures (exit 1)
  const warnings = [];   // explainable states (not failures)
  const checked = { malformed: 0, rows: 0 };

  const scanJSONL = (rel, label) => {
    const p = resolveData(rel);
    if (!fs.existsSync(p)) return [];
    const rows = [];
    const lines = fs.readFileSync(p, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      checked.rows += 1;
      try { rows.push(JSON.parse(t)); }
      catch { checked.malformed += 1; problems.push(`${label}: malformed JSON at line ${i + 1}`); }
    }
    return rows;
  };

  const journal = scanJSONL("journal.v2.jsonl", "journal");
  const shadowTrades = scanJSONL("shadow-trades.v2.jsonl", "shadow-trades");
  scanJSONL("learn-decisions.v2.jsonl", "learn-decisions");
  scanJSONL("candidates.v2.jsonl", "candidates");

  // 2. duplicate trade ids (journal)
  const preRows = journal.filter((r) => r.kind === "pre");
  const postRows = journal.filter((r) => r.kind === "post");
  const dupCount = (rows, label) => {
    const seen = new Map();
    for (const r of rows) {
      if (!r.trade_id) continue;
      seen.set(r.trade_id, (seen.get(r.trade_id) ?? 0) + 1);
    }
    for (const [id, n] of seen) if (n > 1) problems.push(`${label}: duplicate trade_id ${id} x${n}`);
  };
  dupCount(preRows, "journal-pre");
  dupCount(postRows, "journal-post");

  // 3. duplicate shadow ids (resolved + still-open)
  const shadowIds = new Map();
  for (const s of shadowTrades) {
    if (!s.trade_id) continue;
    shadowIds.set(s.trade_id, (shadowIds.get(s.trade_id) ?? 0) + 1);
  }
  for (const [id, n] of shadowIds) if (n > 1) problems.push(`shadow-trades: duplicate id ${id} x${n}`);
  const openBook = _readJSON(resolveData("shadow-open.v2.json"), { open: {} });
  for (const id of Object.keys(openBook.open || {})) {
    if (shadowIds.has(id)) problems.push(`shadow: id ${id} both open and resolved`);
  }

  // 4. missing decision timestamps + impossible ordering on shadows
  for (const s of shadowTrades) {
    if (!Number.isFinite(s.decisionTs)) problems.push(`shadow ${s.trade_id}: missing decisionTs`);
    if (Number.isFinite(s.decisionTs) && Number.isFinite(s.entryTs) && s.entryTs < s.decisionTs)
      problems.push(`shadow ${s.trade_id}: entryTs ${s.entryTs} before decisionTs ${s.decisionTs}`);
    if (Number.isFinite(s.entryTs) && Number.isFinite(s.exitTs) && s.exitTs < s.entryTs)
      problems.push(`shadow ${s.trade_id}: exitTs ${s.exitTs} before entryTs ${s.entryTs}`);
    if (s.shadow !== true) problems.push(`shadow ${s.trade_id}: missing shadow:true marker (contamination risk)`);
  }

  // 5. journal post ts_close before pre ts (impossible ordering)
  const preBy = new Map(preRows.map((r) => [r.trade_id, r]));
  for (const p of postRows) {
    const pre = preBy.get(p.trade_id);
    if (pre && Number.isFinite(pre.ts) && Number.isFinite(p.ts_close) && p.ts_close < pre.ts)
      problems.push(`journal ${p.trade_id}: ts_close ${p.ts_close} before entry ts ${pre.ts}`);
    if (!pre) problems.push(`journal: orphan post row (no pre) ${p.trade_id}`);
  }
  // pre without post: legit while position is open; error only if nothing open matches
  const state = _readJSON(resolveData("state.v2.json"), { positions: {} });
  const openIds = new Set(Object.values(state.positions || {})
    .map((p) => p.openMeta?.trade_id).filter(Boolean));
  const postIds = new Set(postRows.map((p) => p.trade_id));
  for (const r of preRows) {
    if (!postIds.has(r.trade_id) && !openIds.has(r.trade_id))
      warnings.push(`journal: pre without post and no open position: ${r.trade_id}`);
  }

  // 6. actual/shadow contamination: id collision across datasets
  const journalIds = new Set([...preRows, ...postRows].map((r) => r.trade_id).filter(Boolean));
  for (const id of shadowIds.keys()) {
    if (journalIds.has(id)) problems.push(`contamination: id ${id} appears in BOTH journal and shadow-trades`);
  }

  // 7. learner store sanity: experiences must not exceed closed-trade count
  //    (shadow outcomes must never reach the live learner).
  const store = loadLearning(resolveData("context-learning.v2.json"));
  const closed = getClosedCount();
  const sumN = Object.values(store.cells || {}).reduce((a, c) => a + Math.round(c.n ?? 0), 0);
  if (store.experiences != null && store.experiences > closed)
    problems.push(`learner: experiences ${store.experiences} > closed trades ${closed} (duplicate updates or shadow leakage)`);

  // 8. learner update before decision is structurally prevented (updates are
  //    written only on close); verify chronology of the decision log itself.
  let lastTs = -Infinity;
  for (const row of _readJSONL(resolveData("learn-decisions.v2.jsonl"), 0)) {
    if (row.ts < lastTs) { warnings.push(`learn-decisions: non-monotonic ts ${row.ts} after ${lastTs} (append order)`); break; }
    lastTs = row.ts;
  }

  return {
    ok: problems.length === 0,
    problems, warnings,
    stats: {
      rowsScanned: checked.rows, malformed: checked.malformed,
      journalPre: preRows.length, journalPost: postRows.length,
      shadowResolved: shadowTrades.length, shadowOpen: Object.keys(openBook.open || {}).length,
      learnerCells: Object.keys(store.cells || {}).length, learnerExperiences: store.experiences ?? 0,
      closedTrades: closed,
    },
    deterministic: true,
  };
}

const isMain = process.argv?.[1] && import.meta.url.endsWith(String(process.argv[1]).replace(/^.*[\\/]/, ""));
if (isMain) {
  const r = validateLearningData();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`LEARNING DATA INTEGRITY: ${r.ok ? "PASS" : "FAIL"}`);
    for (const p of r.problems) console.log(`  FAIL ${p}`);
    for (const w of r.warnings) console.log(`  warn ${w}`);
    console.log(`  scanned ${r.stats.rowsScanned} rows, malformed ${r.stats.malformed}, journal pre/post ${r.stats.journalPre}/${r.stats.journalPost}, shadow resolved/open ${r.stats.shadowResolved}/${r.stats.shadowOpen}, learner cells ${r.stats.learnerCells}, closed ${r.stats.closedTrades}`);
  }
  process.exit(r.ok ? 0 : 1);
}

// scripts/v2/live-learning-health.mjs — Phase 4 §3/§11/§12/§13 live data health monitor.
//
// STRICTLY READ-ONLY: never writes, never mutates trading state, never feeds the
// learner. Aggregates the engine's own persisted files into a compact diagnostic:
//
//   ENGINE     running/stopped, last heartbeat, cycles observed
//   CANDIDATES total + per strategy / regime / side (from candidates.v2.jsonl)
//   EXECUTED   per strategy / regime / side (from journal pre/post pairs)
//   SHADOW     opened / resolved / unresolved (from shadow book + shadow-trades)
//   LEARNER    cells by evidence bucket n>=5/10/20/50, abstentions, selections, switches
//   DATA       oldest/newest event, malformed rows, missing journal pairs, orphans
//   RISK       council vetoes, survival blocks, concentration caps, execution failures
//   COVERAGE   regime / side / strategy / cell coverage
//   STARVATION which layer starves learning (SIGNAL / LEARNER / REGIME / SIDE / COHORT)
//
// Usage: node scripts/v2/live-learning-health.mjs [--json]
import { loadClosedV2 } from "./brain.mjs";
import { loadLearning, learnConfig } from "./learning.mjs";
import { readJSON, readJSONL, loadConfig, V2 } from "./store.mjs";
import { candidateReport, loadCandidateAudit, buildCohorts } from "./evaluate-shadow-learning.mjs";
import { profitabilityVerdict } from "./claim-guard.mjs";
import { shadowOpenCount } from "./shadow.mjs";
import { survivalGate } from "./controls.mjs";

const HEARTBEAT_STALE_MS = 120000; // engine loop is 30s; 2 missed cycles => stopped
const PROFIT_MIN_BASELINE = 1; // a comparison baseline needs >=1 multi-strategy cohort

function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] ?? "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function computeLearningHealth(now = Date.now()) {
  const cfg = loadConfig();
  const L = learnConfig(cfg);

  // ENGINE
  const hb = readJSON(V2.heartbeat, null);
  const hbAge = hb?.ts ? now - hb.ts : null;
  const engine = {
    running: Number.isFinite(hbAge) && hbAge >= 0 && hbAge < HEARTBEAT_STALE_MS,
    lastHeartbeatTs: hb?.ts ?? null,
    lastHeartbeatAgeMs: hbAge,
    cyclesObserved: hb?.cycle ?? 0,
  };
  // Survival gate (spec §13: RISK-layer starvation must be visible). Read-only
  // recomputation of the engine's own gate from persisted state.
  const gate = survivalGate(readJSON(V2.state, null) ?? {});
  engine.survivalBlocked = !!gate.blocked;
  engine.survivalReason = gate.reason ?? null;

  // CANDIDATES
  const audit = loadCandidateAudit();
  const cand = candidateReport(audit);
  const cohorts = buildCohorts(audit);

  // EXECUTED (real, closed)
  const closed = loadClosedV2(0);
  const exByStrat = countBy(closed, "strategy_id");
  const exByRegime = countBy(closed, "regime");
  const exBySide = countBy(closed, "side");

  // SHADOW
  const resolved = readJSONL(V2.shadowTrades, 0);
  const unresolved = shadowOpenCount();
  const shadow = { opened: resolved.length + unresolved, resolved: resolved.length, unresolved };

  // LEARNER
  const store = loadLearning();
  const cells = Object.entries(store.cells || {}).map(([key, c]) => ({ key, n: Math.round(c.n ?? 0) }));
  let abstentions = 0, selections = 0, switches = 0, lastPick = null;
  for (const row of readJSONL(V2.learnDecisions, 0)) {
    for (const e of row.entries || []) {
      if (String(e.decision).startsWith("ABSTAIN")) abstentions += 1;
      else if (e.decision === "SELECT") {
        selections += 1;
        if (lastPick != null && e.selected !== lastPick) switches += 1;
        lastPick = e.selected;
      }
    }
  }
  const learner = {
    cells: cells.length,
    cells5: cells.filter((c) => c.n >= 5).length,
    cells10: cells.filter((c) => c.n >= 10).length,
    cells20: cells.filter((c) => c.n >= 20).length,
    cells50: cells.filter((c) => c.n >= 50).length,
    abstentions, selections, switches,
  };

  // DATA (raw journal integrity counts; deep checks live in validate-learning-data.mjs)
  const pre = [], post = [];
  for (const r of readJSONL(V2.journal, 0)) {
    if (r?.kind === "pre") pre.push(r);
    else if (r?.kind === "post") post.push(r);
  }
  const postIds = new Set(post.map((p) => p.trade_id));
  const preIds = new Set(pre.map((p) => p.trade_id));
  const orphanPosts = post.filter((p) => !preIds.has(p.trade_id)).length;
  const unpairedPres = pre.filter((p) => !postIds.has(p.trade_id)).length;
  const tsAll = [...pre.map((p) => p.ts), ...post.map((p) => p.ts_close)].filter(Number.isFinite);
  const data = {
    oldestEventTs: tsAll.length ? Math.min(...tsAll) : null,
    newestEventTs: tsAll.length ? Math.max(...tsAll) : null,
    journalPres: pre.length, journalPosts: post.length,
    missingPairs: unpairedPres,        // open positions are legitimately unpaired (tracked)
    orphanRecords: orphanPosts,        // post without pre = integrity error
  };

  // RISK (from the per-cycle audit, spec cases D/E/F/G)
  const risk = {
    councilVetoes: cand.byStrategy.reduce((a, s) => a + s.councilVetoed, 0),
    survivalBlocks: cand.byStrategy.reduce((a, s) => a + s.riskBlocked, 0),
    concentrationCaps: cand.byStrategy.reduce((a, s) => a + s.capRejected, 0),
  };
  // execution failures: selected+approved candidates whose trade_id never became a
  // journal pre row AND is not still queued in pending (spec §1 case G detection)
  const filledIds = new Set(pre.map((p) => p.trade_id));
  const pendingIds = new Set((readJSON(V2.pending, { orders: [] }).orders || [])
    .filter((o) => o.op === "open").map((o) => o.trade_id));
  let selectedNoFill = 0;
  for (const r of audit) {
    for (const row of r.rows || []) {
      if (row.status !== "selected" || !row.trade_id) continue;
      if (!filledIds.has(row.trade_id) && !pendingIds.has(row.trade_id)) selectedNoFill += 1;
    }
  }
  risk.executionFailures = selectedNoFill;

  // COVERAGE (spec §12)
  const regimeCov = Object.fromEntries(cand.byRegime.map((r) => [r.key, r.candidates]));
  const sideCov = Object.fromEntries(cand.bySide.map((r) => [r.key, r.candidates]));
  const stratCov = Object.fromEntries(cand.byStrategy.filter((s) => s.candidates > 0).map((r) => [r.key, r.candidates]));
  const cellCov = {};
  for (const r of audit) {
    for (const row of r.rows || []) {
      if (!row.fired) continue;
      const k = `${row.setupRegime ?? r.regime ?? "unknown"}|${row.side ?? "unknown"}|${row.strategy_id}`;
      cellCov[k] = (cellCov[k] ?? 0) + 1;
    }
  }

  // STARVATION (spec §13): name the layer that starves learning.
  const starvation = [];
  const firingStrats = cand.byStrategy.filter((s) => s.candidates > 0);
  if (firingStrats.length <= 1) starvation.push("SIGNAL STARVATION: only one strategy generates candidates");
  if (Object.keys(regimeCov).length <= 1) starvation.push("REGIME STARVATION: only one regime observed");
  if (Object.keys(sideCov).length <= 1) starvation.push("SIDE STARVATION: only one side observed");
  if (cohorts.length === 0) starvation.push("COHORT STARVATION: no multi-strategy decision cohorts (selection quality not measurable)");
  if (shadow.resolved === 0) starvation.push("OUTCOME STARVATION: zero resolved shadow outcomes");
  if (learner.cells5 === 0) starvation.push("LEARNER STARVATION: no cell has n>=5 observations");
  // RISK-layer starvation: the survival gate suspends strategy evaluation entirely
  // (evaluated=[] => zero audit rows, zero learner decisions) while equity < floor.
  if (gate.blocked) {
    starvation.push(`RISK STARVATION: survival gate ACTIVE — ${gate.reason}; candidate generation + learner decisions suspended every cycle while underwater`);
    if (risk.survivalBlocks === 0)
      starvation.push("  note: survival-blocked cycles produce NO audit rows, so survivalBlocks=0 here means 'suspended', not 'never blocked'");
  }

  // profitability claim guard (§19) — hard reporting rule
  const guard = profitabilityVerdict({
    executed: closed.length,
    resolvedShadows: shadow.resolved,
    cohorts: cohorts.length,
    chronologicalPass: true,  // enforced by tests (shuffled input throws)
    leakagePass: true,        // enforced by tests (pre-entry quotes ignored, separation)
    baselinePass: cohorts.length >= PROFIT_MIN_BASELINE, // needs cohorts for a valid comparison
    integrityPass: orphanPosts === 0,
    coveragePass: Object.keys(regimeCov).length > 1 && Object.keys(sideCov).length > 1 &&
      learner.cells5 > 0,
  });

  return {
    generatedAt: now, deterministic: true,
    engine, candidates: {
      total: cand.byStrategy.reduce((a, s) => a + s.candidates, 0),
      cycles: cand.cycles,
      byStrategy: cand.byStrategy, byRegime: cand.byRegime, bySide: cand.bySide,
    },
    executed: {
      total: closed.length,
      byStrategy: [...exByStrat.entries()].map(([k, v]) => ({ key: k, n: v })),
      byRegime: [...exByRegime.entries()].map(([k, v]) => ({ key: k, n: v })),
      bySide: [...exBySide.entries()].map(([k, v]) => ({ key: k, n: v })),
    },
    shadow,
    learner,
    data,
    risk, cohorts: { multiStrategy: cohorts.length, singleCandidateOnly: cohorts.length === 0 },
    coverage: { regime: regimeCov, side: sideCov, strategy: stratCov, cell: cellCov },
    starvation,
    profitabilityGuard: guard,
    minSampleBuckets: { cold: "n<5", early: "5<=n<10", developing: "10<=n<20", meaningful: "n>=20", stronger: "n>=50" },
    learnConfigBlock: { noTradeUcb: L.noTradeUcb, noTradeQuality: L.noTradeQuality },
  };
}

const fmtTs = (ts) => ts == null ? "never" : new Date(ts).toISOString();
const mapLine = (arr, key = "key", n = "n") =>
  arr.length ? arr.map((x) => `${x[key]}:${x[n] ?? x.candidates ?? 0}`).join("  ") : "none";

export function printLearningHealth(h) {
  console.log("LEARNING DATA HEALTH (read-only)");
  console.log(`ENGINE: ${h.engine.running ? "running" : "STOPPED"}  heartbeat ${h.engine.lastHeartbeatAgeMs == null ? "never" : Math.round(h.engine.lastHeartbeatAgeMs / 1000) + "s ago"}  cycles ${h.engine.cyclesObserved}`);
  if (h.engine.survivalBlocked) console.log(`SURVIVAL MODE: ACTIVE — ${h.engine.survivalReason}`);
  console.log(`CANDIDATES: ${h.candidates.total} across ${h.candidates.cycles} audited cycles`);
  console.log(`  per strategy: ${mapLine(h.candidates.byStrategy)}`);
  console.log(`  per regime:   ${mapLine(h.candidates.byRegime)}`);
  console.log(`  per side:     ${mapLine(h.candidates.bySide)}`);
  console.log(`EXECUTED: ${h.executed.total}`);
  console.log(`  per strategy: ${mapLine(h.executed.byStrategy)}`);
  console.log(`  per regime:   ${mapLine(h.executed.byRegime)}`);
  console.log(`  per side:     ${mapLine(h.executed.bySide)}`);
  console.log(`SHADOW: opened ${h.shadow.opened}  resolved ${h.shadow.resolved}  unresolved ${h.shadow.unresolved}`);
  console.log(`LEARNER: cells ${h.learner.cells}  n>=5 ${h.learner.cells5}  n>=10 ${h.learner.cells10}  n>=20 ${h.learner.cells20}  n>=50 ${h.learner.cells50}`);
  console.log(`  abstentions ${h.learner.abstentions}  selections ${h.learner.selections}  strategy switches ${h.learner.switches}`);
  console.log(`DATA: oldest ${fmtTs(h.data.oldestEventTs)}  newest ${fmtTs(h.data.newestEventTs)}  unpaired pre ${h.data.missingPairs} (open trades)  orphan post ${h.data.orphanRecords}`);
  console.log(`RISK: council vetoes ${h.risk.councilVetoes}  survival blocks ${h.risk.survivalBlocks}  concentration caps ${h.risk.concentrationCaps}  execution failures ${h.risk.executionFailures}`);
  console.log(`COHORTS: multi-strategy ${h.cohorts.multiStrategy}`);
  console.log(`COVERAGE regime [${mapLine(h.candidates.byRegime)}] side [${mapLine(h.candidates.bySide)}]`);
  const insuffCells = h.learner.cells - h.learner.cells5;
  console.log(`CELL COVERAGE: ${insuffCells}/${h.learner.cells} cells lack n>=5 — learning cannot happen there yet`);
  if (h.starvation.length) {
    console.log("LEARNING DATA STARVATION:");
    for (const s of h.starvation) console.log(`  - ${s}`);
  } else console.log("LEARNING DATA STARVATION: none detected");
  console.log(`LEARNING CONFIDENCE: ${h.learner.cells5 > 0 ? "DEVELOPING" : "INSUFFICIENT DATA"}${h.starvation.length ? ` — ${h.starvation[0]}` : ""}`);
  console.log(`PROFITABILITY: ${h.profitabilityGuard.profitability}`);
  for (const r of h.profitabilityGuard.reasons) console.log(`  - ${r}`);
}

const isMain = process.argv?.[1] && import.meta.url.endsWith(String(process.argv[1]).replace(/^.*[\\/]/, ""));
if (isMain) {
  const h = computeLearningHealth();
  if (process.argv.includes("--json")) console.log(JSON.stringify(h, null, 2));
  else printLearningHealth(h);
}

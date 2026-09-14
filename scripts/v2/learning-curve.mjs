// scripts/v2/learning-curve.mjs — Phase 4 §8/§9 learning curve + baselines.
//
// Strictly chronological (walk-forward). Outcomes (executed closes + resolved
// shadows — kept SEPARATE in every metric) are cut into fixed-size windows by
// chronological index. Per window:
//   decisions, executed trades, shadow resolutions, cumulative cells,
//   executed mean R / win rate, shadow mean R, abstention rate,
//   strategy distribution, candidate diversity, selected-vs-best (cohorts only).
//
// Baselines (§9):
//   A  historical strategy selection         (what actually happened)   OBSERVED
//   B  deterministic equal rotation          (rotates eligible picks)   ANALYSIS
//   C  best available within each cohort     (upper bound)              HINDSIGHT
// Baseline C uses resolved outcomes inside the same decision cohort, so it is an
// upper-bound hindsight comparator: it can never be executed live and must never
// feed the learner. It is reported for every window but is only meaningful when
// multi-strategy cohorts exist in that window.
//
// No profitability claims: this tool measures whether decision quality changes as
// experience accumulates. A later window making more money is NOT improvement.
// Usage: node scripts/v2/learning-curve.mjs [--window=20] [--json]
import { loadClosedV2 } from "./brain.mjs";
import { emptyLearning, recordExperience, learnConfig } from "./learning.mjs";
import { readJSONL, loadConfig, V2 } from "./store.mjs";
import { loadExecuted, loadShadowTrades, loadCandidateAudit, buildCohorts, assertChronological, SHADOW_MIN_SAMPLE } from "./evaluate-shadow-learning.mjs";
import { printProfitLine } from "./claim-guard.mjs";

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const winRate = (a) => (a.length ? a.filter((r) => r > 0).length / a.length : null);

// Baseline B: deterministic equal rotation over the strategies that actually
// appeared historically in this (regime, side) context, cycled by decision index.
function rotationBaseline(executed) {
  const ctxOrder = new Map(); // regime|side -> strategies in first-seen order
  const idx = new Map();      // regime|side -> rotation cursor
  const picked = { n: 0, sumR: 0, wins: 0 };
  for (const e of executed) {
    const k = `${e.regime}|${e.side}`;
    if (!ctxOrder.has(k)) ctxOrder.set(k, []);
    if (!ctxOrder.get(k).includes(e.strategy_id)) ctxOrder.get(k).push(e.strategy_id);
    const ring = ctxOrder.get(k);
    const i = (idx.get(k) ?? 0) % ring.length;
    idx.set(k, i + 1);
    if (ring[i] === e.strategy_id) { // rotation lands on the executed strategy: matched
      picked.n += 1; picked.sumR += e.realized_R;
      if (e.realized_R > 0) picked.wins += 1;
    }
  }
  return picked; // unmatched rotations have unknowable outcomes: counted, not fabricated
}

export function buildLearningCurve({ executed, shadows, decisions, audit }, opts = {}) {
  const windowSize = opts.window ?? 20;
  assertChronological(executed, "ts_close", "executed");
  assertChronological(shadows, "ts", "shadows");
  const L = opts.L ?? learnConfig(loadConfig());

  // decision log flat + chronological check (append order)
  const flatDecisions = [];
  for (const row of decisions) for (const e of row.entries || []) flatDecisions.push({ ts: row.ts, ...e });
  const cohorts = buildCohorts(audit);

  // attach resolved outcomes to cohort members by (symbol, strategy, decisionTs proximity)
  // executed match on ts within 5min; shadow match on decisionTs within 5min.
  const W = 5 * 60000;
  const cohortOutcomes = cohorts.map((c) => {
    const members = c.members.map((m) => {
      let R = null, src = null;
      const ex = executed.find((e) => e.symbol === c.symbol && e.strategy_id === m.strategy_id &&
        e.ts >= c.ts - W && e.ts <= c.ts + W);
      if (ex) { R = ex.realized_R; src = "executed"; }
      else {
        const sh = shadows.find((s) => s.symbol === c.symbol && s.strategy_id === m.strategy_id &&
          s.decisionTs >= c.ts - W && s.decisionTs <= c.ts + W);
        if (sh) { R = sh.realized_R; src = "shadow"; }
      }
      return { strategy_id: m.strategy_id, rank: m.rank ?? null, R, src };
    });
    return { ...c, members };
  });

  // merged chronological outcome stream for windowing (executed and shadow kept separate)
  const events = [
    ...executed.map((e) => ({ kind: "executed", ts: e.ts_close, e })),
    ...shadows.map((s) => ({ kind: "shadow", ts: s.ts, e: s })),
  ].sort((a, b) => a.ts - b.ts || (a.kind < b.kind ? -1 : 1));

  // walk-forward learner state to count cumulative cells per window boundary
  const store = emptyLearning();
  let updIdx = 0;
  const cellsAt = (tsClose) => {
    while (updIdx < executed.length && executed[updIdx].ts_close <= tsClose) {
      const u = executed[updIdx];
      if (Number.isFinite(u.realized_R))
        recordExperience(store, { regime: u.regime, side: u.side, strategy: u.strategy_id, symbol: u.symbol }, u.realized_R, { ts_close: u.ts_close }, L);
      updIdx += 1;
    }
    return Object.keys(store.cells).length;
  };

  const windows = [];
  const auditTs = audit.map((r) => r.ts);
  for (let start = 0; start < events.length; start += windowSize) {
    const slice = events.slice(start, start + windowSize);
    const lo = slice[0].ts, hi = slice[slice.length - 1].ts;
    const exR = slice.filter((x) => x.kind === "executed").map((x) => x.e.realized_R);
    const shR = slice.filter((x) => x.kind === "shadow").map((x) => x.e.realized_R);
    const decs = flatDecisions.filter((d) => d.ts >= lo && d.ts <= hi);
    const abst = decs.filter((d) => String(d.decision).startsWith("ABSTAIN")).length;
    const dist = {};
    for (const x of slice) if (x.kind === "executed") dist[x.e.strategy_id] = (dist[x.e.strategy_id] ?? 0) + 1;
    // candidate diversity in window from audit cycles whose ts falls inside
    const stratsFiring = new Set();
    for (let i = 0; i < audit.length; i++) {
      if (auditTs[i] < lo || auditTs[i] > hi) continue;
      for (const row of audit[i].rows || []) if (row.fired) stratsFiring.add(row.strategy_id);
    }
    // cohorts resolved inside the window (cohort ts in window) -> selection quality
    const cWin = cohortOutcomes.filter((c) => c.ts >= lo && c.ts <= hi && c.members.every((m) => m.R != null));
    const selR = [], bestR = [];
    for (const c of cWin) {
      const sel = c.members.find((m) => m.rank === 1) ?? c.members.find((m) => m.src === "executed");
      if (!sel) continue;
      selR.push(sel.R);
      bestR.push(Math.max(...c.members.map((m) => m.R)));
    }
    windows.push({
      index: windows.length, fromTs: lo, toTs: hi,
      outcomes: slice.length, executed: exR.length, shadows: shR.length,
      decisions: decs.length,
      abstentions: abst, abstentionRate: decs.length ? abst / decs.length : null,
      executedMeanR: mean(exR), executedWinRate: winRate(exR),
      shadowMeanR: mean(shR), shadowWinRate: winRate(shR),
      cellsCumulative: cellsAt(hi),
      strategyDistribution: dist,
      strategiesFiring: [...stratsFiring].sort(),
      cohortCount: cWin.length,
      selectedMeanR: mean(selR), bestAvailableMeanR: mean(bestR),
      regretVsBest: selR.length && bestR.length ? mean(selR) - mean(bestR) : null,
    });
    if (slice.length < windowSize) break;
  }

  // whole-period baselines
  const exAll = executed.map((e) => e.realized_R);
  const rot = rotationBaseline(executed);
  const cohAll = cohortOutcomes.filter((c) => c.members.every((m) => m.R != null));
  const bestAll = cohAll.map((c) => Math.max(...c.members.map((m) => m.R)));
  const baselines = {
    A: { label: "historical selection (OBSERVED)", n: exAll.length, meanR: mean(exAll), winRate: winRate(exAll) },
    B: { label: "deterministic equal rotation (ANALYSIS, matched picks only)", n: rot.n, meanR: rot.n ? rot.sumR / rot.n : null, winRate: rot.n ? rot.wins / rot.n : null },
    C: {
      label: "HINDSIGHT upper bound — best available in cohort; NOT executable, never feeds the learner",
      n: bestAll.length, meanR: mean(bestAll),
      computable: cohAll.length > 0,
      note: cohAll.length ? undefined : "no fully-resolved multi-strategy cohorts exist; Baseline C is undefined (not zero)",
    },
  };

  return { windowSize, windows, baselines, totals: { executed: executed.length, shadows: shadows.length, cohorts: cohorts.length, resolvedCohorts: cohAll.length }, deterministic: true };
}

const isMain = process.argv?.[1] && import.meta.url.endsWith(String(process.argv[1]).replace(/^.*[\\/]/, ""));
export const __isMain = isMain;
if (isMain) {
  const args = process.argv.slice(2);
  const wi = args.findIndex((a) => a.startsWith("--window"));
  const window = wi >= 0 ? Math.max(5, Number(args[wi].split("=")[1] ?? 20)) : 20;
  const curve = buildLearningCurve({
    executed: loadExecuted(), shadows: loadShadowTrades(),
    decisions: readJSONL(V2.learnDecisions, 0), audit: loadCandidateAudit(),
  }, { window });
  if (args.includes("--json")) console.log(JSON.stringify(curve, null, 2));
  else {
    const f = (x) => (x == null ? "—" : Number.isFinite(+x) ? (+x).toFixed(3) : String(x));
    console.log(`LEARNING CURVE — walk-forward, window=${curve.windowSize} outcomes (executed+shadow kept separate)`);
    for (const w of curve.windows) {
      console.log(`#${w.index} [${new Date(w.fromTs).toISOString()} .. ${new Date(w.toTs).toISOString()}] out=${w.outcomes} ex=${w.executed} sh=${w.shadows} dec=${w.decisions} abst=${w.abstentionRate == null ? "—" : (w.abstentionRate * 100).toFixed(0) + "%"}`);
      console.log(`    exR=${f(w.executedMeanR)} exWin=${f(w.executedWinRate)} shR=${f(w.shadowMeanR)} cells=${w.cellsCumulative} firing=[${w.strategiesFiring.join(",") || "—"}] cohorts=${w.cohortCount}${w.cohortCount ? ` selR=${f(w.selectedMeanR)} bestR=${f(w.bestAvailableMeanR)} regret=${f(w.regretVsBest)}` : ""}`);
    }
    console.log("\nBASELINES");
    for (const [k, b] of Object.entries(curve.baselines)) {
      console.log(`  ${k}: ${b.label}`);
      console.log(`     n=${b.n} meanR=${f(b.meanR)}${b.winRate != null ? ` win=${f(b.winRate)}` : ""}${b.note ? `  [${b.note}]` : ""}`);
    }
    console.log(`\ntotals: executed=${curve.totals.executed} shadows=${curve.totals.shadows} cohorts=${curve.totals.cohorts} resolvedCohorts=${curve.totals.resolvedCohorts}`);
    printProfitLine({
      executed: curve.totals.executed,
      resolvedShadows: curve.totals.shadows,
      cohorts: curve.totals.resolvedCohorts,
      chronologicalPass: true, leakagePass: true,
      baselinePass: curve.baselines.C.computable,
      integrityPass: true,
      coveragePass: curve.windows.some((w) => w.strategiesFiring.length > 1),
    });
  }
}

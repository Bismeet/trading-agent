// scripts/v2/evaluate-shadow-learning.mjs — Phase 3 shadow/counterfactual evaluator.
//
// Strict WALK-FORWARD (spec §7/§8): executed updates apply by ts_close; every
// decision at T sees ONLY information with timestamp <= T. Inputs that are not
// chronological THROW (shuffled input never yields a valid-looking report).
// Fully deterministic (no RNG).
//
// Separation (spec §6/§10): executed = journal (ACTUAL). shadows = shadow-trades
// (COUNTERFACTUAL only, never trains). baseScore=0.5 for retroactive rows
// (the journal stores no baseScore — documented).
//
// Matching (spec §15): an executed fill is attributed to the shadow decision
// cohort of the same symbol within [ts-windowMs, ts]; alternatives are the
// cohort members; regret/beatsBest are "selection quality", not profitability.
import { emptyLearning, recordExperience, rankCandidates, learnConfig } from "./learning.mjs";
import { loadClosedV2 } from "./brain.mjs";
import { readJSONL, loadConfig, V2 } from "./store.mjs";

export const SHADOW_MIN_SAMPLE = 5;
const MATCH_WINDOW_MS = 5 * 60000;

function statsOf(Rs, minSample) {
  const a = (Rs || []).filter(Number.isFinite);
  if (a.length < minSample) {
    return {
      n: a.length, sufficient: false, meanR: null, medianR: null, winRate: null,
      profitFactor: null, sumR: a.length ? a.reduce((x, y) => x + y, 0) : 0,
    };
  }
  a.sort((x, y) => x - y);
  const mid = a.length / 2;
  const wins = a.filter((r) => r > 0).reduce((x, y) => x + y, 0);
  const losses = Math.abs(a.filter((r) => r < 0).reduce((x, y) => x + y, 0));
  return {
    n: a.length, sufficient: true,
    meanR: a.reduce((x, y) => x + y, 0) / a.length,
    medianR: a.length % 2 ? a[Math.floor(mid)] : (a[mid - 1] + a[mid]) / 2,
    winRate: a.filter((r) => r > 0).length / a.length,
    profitFactor: losses > 0 ? wins / losses : (wins > 0 ? null : 0),
    sumR: a.reduce((x, y) => x + y, 0),
  };
}

export function assertChronological(rows, key, label) {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][key] < rows[i - 1][key]) {
      throw new Error(`${label} input not chronological at index ${i}: ${rows[i - 1][key]} > ${rows[i][key]} (run sorted; shuffled input must not evaluate)`);
    }
  }
}

// Core walk-forward evaluation. L = learnConfig(cfg).
// executed: [{ts (entry), ts_close, symbol, strategy_id, regime, side, realized_R}]
// shadows:  [{ts (decision bucket), decisionTs, symbol, strategy_id, regime, side, realized_R}]
export function replayShadowTimeline({ executed, shadows }, L, opts = {}) {
  const minSample = opts.minSample || SHADOW_MIN_SAMPLE;
  if (opts.strict !== false) {
    assertChronological(executed, "ts_close", "executed");
    assertChronological(shadows, "ts", "shadows");
  }
  const store = emptyLearning();
  let updateIdx = 0;
  const shadowIndex = new Map();
  for (const s of shadows) {
    const k = `${s.symbol}|${s.ts}`;
    if (!shadowIndex.has(k)) shadowIndex.set(k, []);
    shadowIndex.get(k).push(s);
  }
  const perStr = new Map(), perRegime = new Map(), perSide = new Map(), perCell = new Map();
  const pushMap = (map, key, R) => {
    if (!Number.isFinite(R)) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(R);
  };
  const cellKey = (r) => `${r.regime}|${r.side}|${r.strategy_id}`;
  // aggregates cover EVERY shadow candidate (learning-opportunity table, §10/§11),
  // not only those matched to an executed fill (regret/beatsBest need the match).
  for (const s of shadows) {
    pushMap(perStr, s.strategy_id, s.realized_R);
    pushMap(perRegime, s.regime, s.realized_R);
    pushMap(perSide, s.side, s.realized_R);
    pushMap(perCell, cellKey(s), s.realized_R);
  }
  const sel = { decisions: 0, candidates: 0, abstentions: 0, strats: new Set(), regimes: new Set(), sides: new Set() };
  const sq = { n: 0, selectedR: [], altBest: [], altAvg: [], beatsBest: 0, beatsAvg: 0, regret: [] };
  const pickedR = [];
  for (const e of executed) {
    while (updateIdx < executed.length && executed[updateIdx].ts_close <= e.ts) {
      const u = executed[updateIdx];
      if (Number.isFinite(u.realized_R)) {
        recordExperience(store, { regime: u.regime, side: u.side, strategy: u.strategy_id, symbol: u.symbol },
          u.realized_R, { ts_close: u.ts_close }, L);
      }
      updateIdx += 1;
    }
    const cohort = [];
    for (const [k, rows] of shadowIndex) {
      if (k.startsWith(`${e.symbol}|`)) {
        for (const s of rows) {
          if (s.decisionTs >= e.ts - MATCH_WINDOW_MS && s.decisionTs <= e.ts) cohort.push(s);
        }
      }
    }
    const alternatives = cohort.filter((s) => s.strategy_id !== e.strategy_id);
    sel.decisions += 1;
    sel.candidates += 1 + alternatives.length;
    sel.strats.add(e.strategy_id); sel.regimes.add(e.regime); sel.sides.add(e.side);
    const available = [e.realized_R, ...alternatives.map((s) => s.realized_R)].filter(Number.isFinite);
    if (available.length >= 2) {
      const bestA = Math.max(...available), avgA = available.reduce((x, y) => x + y, 0) / available.length;
      sq.n += 1;
      sq.selectedR.push(e.realized_R);
      sq.altBest.push(bestA);
      sq.altAvg.push(avgA);
      sq.beatsBest += e.realized_R >= bestA ? 1 : 0;
      sq.beatsAvg += e.realized_R >= avgA ? 1 : 0;
      sq.regret.push(e.realized_R - bestA);
    }
    if (cohort.length) {
      const { best, abstain } = rankCandidates(
        cohort.map((s) => ({ order: { strategy_id: s.strategy_id }, ctx: { regime: s.regime, side: s.side, strategy: s.strategy_id, symbol: s.symbol }, baseScore: 0.5 })),
        store, L);
      if (abstain || !best) sel.abstentions += 1;
      else {
        const picked = cohort.find((s) => s.strategy_id === best.order.strategy_id);
        if (picked && Number.isFinite(picked.realized_R)) pickedR.push(picked.realized_R);
      }
    }
  }
  while (updateIdx < executed.length) {
    const u = executed[updateIdx];
    if (Number.isFinite(u.realized_R)) {
      recordExperience(store, { regime: u.regime, side: u.side, strategy: u.strategy_id, symbol: u.symbol },
        u.realized_R, { ts_close: u.ts_close }, L);
    }
    updateIdx += 1;
  }
  return { sel, sq: { ...sq, available: sq.selectedR }, pickedR, perStr, perRegime, perSide, perCell, shadowIndex, store, minSample };
}

// Aggregate a replay result into a deterministic report object.
export function aggregateShadowReport(r) {
  const agg = (map) => [...map.entries()].map(([key, Rs]) => ({ key, ...statsOf(Rs, r.minSample) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const sq = r.sq;
  return {
    sample: {
      minSample: r.minSample,
      sufficientShadowEvidence: Array.from(r.perCell.values()).reduce((a, v) => a + v.length, 0) >= r.minSample,
    },
    selectionQuality: { withAlternatives: sq.n, sufficient: sq.n >= Math.min(r.minSample, Math.max(1, sq.n)) },
    selectedVsBest: {
      n: sq.n,
      beatsBestRate: sq.n ? sq.beatsBest / sq.n : null,
      beatsAvgRate: sq.n ? sq.beatsAvg / sq.n : null,
      meanRegret: sq.regret.length ? sq.regret.reduce((a, b) => a + b, 0) / sq.regret.length : null,
      sufficient: sq.n >= r.minSample,
    },
    learnerCounterfactual: statsOf(r.pickedR, r.minSample),
    aggregates: {
      byStrategy: agg(r.perStr), byRegime: agg(r.perRegime), bySide: agg(r.perSide), byCell: agg(r.perCell),
    },
    decisionSpread: {
      decisions: r.sel.decisions,
      candidates: r.sel.candidates,
      abstentions: r.sel.abstentions,
      strategies: [...r.sel.strats].sort(),
      regimes: [...r.sel.regimes].sort(),
      sides: [...r.sel.sides].sort(),
    },
    deterministic: true,
  };
}

export function loadExecuted() {
  return loadClosedV2(0).filter((c) => Number.isFinite(c.realized_R)).map((c) => ({
    ts: c.ts ?? c.ts_close, ts_close: c.ts_close, symbol: c.symbol,
    strategy_id: c.strategy_id, regime: c.regime ?? "unknown", side: c.side ?? "long",
    realized_R: c.realized_R,
  }));
}
export function loadShadowTrades() {
  return readJSONL(V2.shadowTrades, 0).map((s) => ({
    ts: s.decisionTs, decisionTs: s.decisionTs, symbol: s.symbol,
    strategy_id: s.strategy_id, regime: s.regime ?? "unknown", side: s.side ?? "long",
    realized_R: s.realized_R, rejectReason: s.rejectReason,
    baseScore: s.baseScore ?? null, learnerScore: s.learnerScore ?? null,
    rank: s.rank ?? null, actualSelectedStrategy: s.actualSelectedStrategy ?? null,
  }));
}

// ---- Phase 3 candidate-attribution report (spec §1/§2/§11) ----
// Reads the per-cycle audit JSONL the engine writes (V2.candidates) and reduces
// it to per-strategy / per-regime / per-side counters. Pure aggregation: no
// fabrication, no thresholds changed. Audit status vocabulary (engine):
//   no-signal | candidate | candidate-rejected-learner | candidate-rejected-cap
//   | selected | selected-council-vetoed
// (survival-blocked arrives as rejectReason on candidate rows).
export function candidateReport(rows) {
  const perStr = new Map(), perRegime = new Map(), perSide = new Map();
  const blank = () => ({ evaluated: 0, noSignal: 0, candidates: 0, selected: 0,
    learnerRejected: 0, capRejected: 0, councilVetoed: 0, riskBlocked: 0, abstained: 0 });
  const bump = (map, key, field, v = 1) => {
    if (!map.has(key)) map.set(key, blank());
    map.get(key)[field] += v;
  };
  const noSignal = new Set(); // (cycle,symbol) pairs where at least one strategy fired
  for (const r of rows) {
    for (const row of r.rows || []) {
      const st = row.status ?? (row.fired ? "candidate" : "no-signal");
      bump(perStr, row.strategy_id, "evaluated");
      if (!row.fired || st === "no-signal") { bump(perStr, row.strategy_id, "noSignal"); continue; }
      bump(perStr, row.strategy_id, "candidates");
      if (row.rejectReason === "survival-blocked") bump(perStr, row.strategy_id, "riskBlocked");
      if (st === "candidate-rejected-learner") bump(perStr, row.strategy_id, "learnerRejected");
      else if (st === "candidate-rejected-cap") bump(perStr, row.strategy_id, "capRejected");
      else if (st === "selected") bump(perStr, row.strategy_id, "selected");
      else if (st === "selected-council-vetoed") bump(perStr, row.strategy_id, "councilVetoed");
      if (row.learner && row.learner.n < 3) bump(perStr, row.strategy_id, "abstained"); // cold-start decision (learn.n<3, engine's insufficient-data marker)
      bump(perRegime, row.setupRegime ?? "unknown", row.fired && st !== "no-signal" ? "candidates" : "evaluated");
      const side = row.side ?? (row.fired && st !== "no-signal" ? "unknown" : null);
      if (row.fired && st !== "no-signal") bump(perSide, side ?? "unknown", "candidates");
      if (row.fired) noSignal.add(`${r.ts}|${row.symbol}`);
    }
  }
  const toRows = (map) => [...map.entries()].map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.candidates - a.candidates || a.key.localeCompare(b.key));
  return {
    cycles: rows.length,
    byStrategy: toRows(perStr),
    byRegime: toRows(perRegime).filter((x) => x.candidates > 0),
    bySide: toRows(perSide).filter((x) => x.candidates > 0),
    cyclesWithSignal: noSignal.size,
    deterministic: true,
  };
}

export function loadCandidateAudit() {
  return readJSONL(V2.candidates, 0);
}

// ---- Phase 4 §6: decision cohorts from the per-cycle candidate audit ----
// A cohort = (cycle ts, symbol, regime) where >=2 DISTINCT strategies fired
// simultaneously. Single-candidate decisions are NOT cohorts: they are useful
// for learning but cannot compare strategy choice (spec §6).
export function buildCohorts(auditRows) {
  const cohorts = [];
  for (const r of auditRows) {
    const bySym = new Map();
    for (const row of r.rows || []) {
      if (!row.fired) continue;
      if (!bySym.has(row.symbol)) bySym.set(row.symbol, new Map());
      bySym.get(row.symbol).set(row.strategy_id, row);
    }
    for (const [symbol, strats] of bySym) {
      if (strats.size < 2) continue;
      const members = [...strats.values()];
      cohorts.push({
        ts: r.ts, symbol,
        regime: members[0].setupRegime ?? r.regime ?? "unknown",
        members,
      });
    }
  }
  return cohorts;
}

function printCandidateReport(rep) {
  const line = (n) => "-".repeat(n);
  console.log(`STRATEGY CANDIDATE REPORT (${rep.cycles} audited cycles, ${rep.cyclesWithSignal} symbol-cycles with >=1 signal)`);
  console.log(`${line(96)}\nSTRATEGY      evaluated candidates selected learnerRej capRej councilVeto riskBlocked\n${line(96)}`);
  for (const s of rep.byStrategy) {
    console.log(`${s.key.padEnd(12)} ${String(s.evaluated).padStart(9)} ${String(s.candidates).padStart(10)} ${String(s.selected).padStart(8)} ${String(s.learnerRejected).padStart(11)} ${String(s.capRejected).padStart(6)} ${String(s.councilVetoed).padStart(12)} ${String(s.riskBlocked).padStart(11)}`);
  }
  console.log(`\nCANDIDATES PER REGIME\n${line(40)}`);
  for (const s of rep.byRegime) console.log(`${s.key.padEnd(16)} candidates=${s.candidates}`);
  console.log(`\nCANDIDATES PER SIDE\n${line(40)}`);
  for (const s of rep.bySide) console.log(`${s.key.padEnd(10)} candidates=${s.candidates}`);
}

const isMain = typeof process !== "undefined" && process.argv?.[1] && import.meta.url.endsWith(
  String(process.argv[1]).replace(/^.*[\\/]/, ""));
export const __isMain = isMain;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--candidates")) {
    const rep = candidateReport(loadCandidateAudit());
    if (args.includes("--json")) console.log(JSON.stringify(rep, null, 2));
    else printCandidateReport(rep);
    process.exit(0);
  }
  const minSample = args.includes("--min") ? Number(args[args.indexOf("--min") + 1]) : SHADOW_MIN_SAMPLE;
  const out = aggregateShadowReport(
    replayShadowTimeline({ executed: loadExecuted(), shadows: loadShadowTrades() }, learnConfig(loadConfig()), { minSample }));
  if (args.includes("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    const fmt = (x) => x == null ? "insufficient" : Number.isFinite(+x) ? (+x).toFixed(4) : String(x);
    console.log(`shadow walk-forward: ${loadExecuted().length} executed, ${loadShadowTrades().length} shadows, minSample=${minSample}`);
    console.log(`sample sufficiency: ${out.sample.sufficientShadowEvidence ? "OK" : "INSUFFICIENT (report only, no claims)"}`);
    console.log(`selection quality: withAlternatives=${out.selectionQuality.withAlternatives} beatsBest=${out.selectedVsBest.beatsBestRate == null ? "insufficient" : (out.selectedVsBest.beatsBestRate * 100).toFixed(0) + "%"} beatsAvg=${out.selectedVsBest.beatsAvgRate == null ? "insufficient" : (out.selectedVsBest.beatsAvgRate * 100).toFixed(0) + "%"} meanRegret=${fmt(out.selectedVsBest.meanRegret)}`);
    console.log(`learner counterfactual: meanR=${fmt(out.learnerCounterfactual.meanR)} n=${out.learnerCounterfactual.n} winRate=${out.learnerCounterfactual.winRate == null ? "insufficient" : (out.learnerCounterfactual.winRate * 100).toFixed(0) + "%"}`);
    console.log("-- shadow aggregates (COUNTERFACTUAL only) --");
    for (const row of out.aggregates.byCell) {
      console.log(`   ${row.key}: n=${row.n} meanR=${fmt(row.meanR)} winRate=${row.winRate == null ? "insufficient" : (row.winRate * 100).toFixed(0) + "%"}`);
    }
    console.log(`decisions=${out.decisionSpread.decisions} candidates=${out.decisionSpread.candidates} abstentions=${out.decisionSpread.abstentions} strategies=[${out.decisionSpread.strategies.join(",")}] regimes=[${out.decisionSpread.regimes.join(",")}]`);
    console.log("deterministic=true; shuffled inputs THROW (chronological invariant).");
  }
}
// scripts/v2/evaluate-learning.mjs — Phase 2 chronological evaluator.
// WALK-FORWARD: at trade N the learner sees ONLY trades < N (single pass sorted
// by ts_close). No future data ever reaches an earlier decision (tested).
// Honest accounting: the learner only gets credit/blame for trades where it
// selected the strategy that ACTUALLY fired in history (matched). Switches are
// counted, never fabricated. --report prints real-data diagnostics (no claims).
// Usage: node scripts/v2/evaluate-learning.mjs [--json] [--walk=K] [--report]
import { loadClosedV2 } from "./brain.mjs";
import {
  emptyLearning, recordExperience, rankCandidates, learnConfig, decayOf,
} from "./learning.mjs";
import { readJSON, readJSONL, loadConfig, V2 } from "./store.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const STRATS = ["tsmom", "donchian", "rsi2dip", "mom_trend", "orb", "ibreakout"];
const peersOf = (id) => STRATS.filter((s) => s !== id).slice(0, 3);

// One chronological pass. closed = [{strategy_id, regime, side, realized_R, ts_close}]
export function replayLearning(closed, L, walk = 20) {
  const store = emptyLearning();
  const arm = () => ({ n: 0, wins: 0, sumR: 0, losses: 0 });
  const A = arm(), B = arm(), C = arm(); // baseline-current, baseline-rotation, learner
  let switches = 0, same = 0, abstains = 0, rotationIdx = 0;
  const hiCal = { n: 0, sumR: 0 }, loCal = { n: 0, sumR: 0 }; // calibration buckets
  const dist = {};
  const perWindow = [];
  for (const c of closed) {
    const R = Number(c.realized_R);
    if (!Number.isFinite(R)) continue;
    const regime = c.regime || "unknown", side = c.side || "long";
    const fired = c.strategy_id || "manual";
    const ctxOf = (st) => ({ regime, strategy: st, side, symbol: c.symbol });
    // Baseline A: history as it happened
    A.n += 1; A.sumR += R; if (R > 0) A.wins += 1; else if (R < 0) A.losses += 1;
    // Baseline B: deterministic equal rotation over fired+3 peers (matched only)
    const rotCands = [fired, ...peersOf(fired)];
    const rotPick = rotCands[rotationIdx % rotCands.length];
    rotationIdx += 1;
    if (rotPick === fired) {
      B.n += 1; B.sumR += R; if (R > 0) B.wins += 1; else if (R < 0) B.losses += 1;
    }
    // Learner decision on history < now only
    const cands = rotCands.map((st) => ({ order: { strategy_id: st }, ctx: ctxOf(st), baseScore: 0.5 }));
    const { best, abstain } = rankCandidates(cands, store, L);
    const pick = abstain || !best ? null : best.order.strategy_id;
    if (pick == null) abstains += 1;
    else if (pick === fired) {
      C.n += 1; C.sumR += R; if (R > 0) C.wins += 1; else if (R < 0) C.losses += 1;
      dist[fired] = (dist[fired] || 0) + 1; same += 1;
      if (best.learn.n >= 10 && best.quality > 1.1) { hiCal.n += 1; hiCal.sumR += R; }
      else if (best.learn.n >= 3) { loCal.n += 1; loCal.sumR += R; }
    } else {
      switches += 1; // outcome unknowable; counted, never fabricated
    }
    // learn from the ACTUAL outcome only
    recordExperience(store, ctxOf(fired), R, { ts_close: c.ts_close, exit_reason: c.exit_reason }, L);
    if (A.n % walk === 0) {
      perWindow.push({ at: A.n, baseMeanR: A.sumR / A.n, learnMeanR: C.n ? C.sumR / C.n : 0, learnN: C.n, abstains, switches });
    }
  }
  const cells = Object.values(store.cells);
  const metrics = (a) => ({
    n: a.n, meanR: a.n ? a.sumR / a.n : 0, winRate: a.n ? a.wins / a.n : 0, sumR: a.sumR,
  });
  return {
    trades: A.n,
    baselineA: metrics(A), // current system behavior
    baselineB: metrics(B), // equal rotation
    learner: { ...metrics(C), switches, abstains, abstainRate: A.n ? abstains / A.n : 0, same, dist },
    cells: {
      total: cells.length,
      n5: cells.filter((c) => c.n >= 5).length,
      n10: cells.filter((c) => c.n >= 10).length,
      n20: cells.filter((c) => c.n >= 20).length,
    },
    calibration: {
      confident: hiCal.n ? hiCal.sumR / hiCal.n : null, confidentN: hiCal.n,
      low: loCal.n ? loCal.sumR / loCal.n : null, lowN: loCal.n,
    },
    windows: perWindow,
    decay: decayOf(L),
  };
}

// --report: real-data diagnostics (what evidence exists; quality flags, no claims)
function report() {
  const closed = loadClosedV2(0).filter((c) => Number.isFinite(c.realized_R));
  const store = readJSON(V2.contextLearning, { cells: {}, experiences: 0 });
  const episodes = readJSONL(V2.episodes, 0);
  const cells = Object.entries(store.cells || {}).map(([key, c]) => ({
    key, n: Math.round(c.n ?? 0), expectancyR: c.n ? c.sumR / c.n : 0,
  }));
  const regimes = new Set(closed.map((c) => c.regime));
  const strats = new Set(closed.map((c) => c.strategy_id));
  const out = {
    episodes: episodes.length,
    trades: closed.length,
    strategiesUsed: [...strats],
    regimesSeen: [...regimes],
    contextCells: cells,
    cellsWithEvidence5: cells.filter((c) => c.n >= 5).length,
    singleRegime: regimes.size <= 1,
    sampleSufficient: closed.length >= 100,
    outOfSample: false, // no held-out split exists yet
    futureLeakage: false, // evaluator enforces info<N; verified by tests
  };
  console.log("=== real-data learning diagnostics (no claims) ===");
  console.log(JSON.stringify(out, null, 2));
}

const args = process.argv.slice(2);
const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain && args.includes("--report")) {
  report();
} else if (isMain) {
  const asJson = args.includes("--json");
  let walk = 20;
  const wi = args.indexOf("--walk");
  if (wi >= 0 && Number.isFinite(+args[wi + 1])) walk = Math.max(5, +args[wi + 1]);
  const cfg = loadConfig();
  const closed = loadClosedV2(0).filter((c) => Number.isFinite(c.realized_R));
  const r = replayLearning(closed, learnConfig(cfg), walk);
  const line = (name, m) => console.log(
    `${name.padEnd(10)} n=${String(m.n).padStart(3)} meanR=${(m.meanR ?? 0).toFixed(4)} win=${((m.winRate ?? 0) * 100).toFixed(1).padStart(5)}% sumR=${(m.sumR ?? 0).toFixed(3)}`);
  if (asJson) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`chronological walk-forward over ${r.trades} closed trades (walk=${walk}, decay=${r.decay}) — learner sees ONLY trades < N`);
    line("BASELINE-A", r.baselineA);
    line("BASELINE-B", r.baselineB);
    line("LEARNER", r.learner);
    console.log(`learner: switches=${r.learner.switches} abstains=${r.learner.abstains} (${(r.learner.abstainRate * 100).toFixed(1)}%) matched=${r.learner.same}`);
    console.log(`cells: total=${r.cells.total} n>=5:${r.cells.n5} n>=10:${r.cells.n10} n>=20:${r.cells.n20}`);
    console.log(`calibration: confident meanR=${r.calibration.confident?.toFixed(4) ?? "—"} (n=${r.calibration.confidentN}) · low-conf meanR=${r.calibration.low?.toFixed(4) ?? "—"} (n=${r.calibration.lowN})`);
    for (const w of r.windows) console.log(`  @${w.at}: base=${w.baseMeanR.toFixed(4)} learn=${w.learnMeanR.toFixed(4)} (n=${w.learnN}, abst=${w.abstains}, sw=${w.switches})`);
    console.log("SYNTHETIC BENCHMARK: node scripts/v2/learning-benchmark.mjs — real history alone cannot validate learning yet.");
  }
}


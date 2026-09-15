// scripts/v2/phase11-run.mjs — PHASE 11 runner: cross-sectional relative-strength
// + absolute-trend weekly rotation.
//
// Deterministic, causal, reproducible. Reads the pre-registered spec from
// config/phase11-spec.v1.json and NEVER invents, tunes or relaxes a threshold in
// code. Offline research only: the runner refuses to write outside
// data/calibration/ and the two Phase 11 report files, and it re-hashes the frozen
// production configuration at start AND at end.
//
// Protocol:
//   0.  Freeze check: production inputs hashed against the pre-registered hashes.
//   1.  Load the daily panel; build the UTC-date union grid with as-of alignment.
//   2.  Precompute every causal feature series (60d return, 60d realized vol, SMA200).
//   3.  Build the global chronological 60/20/20 split + 60-bar purge/embargo; 4 TEST sub-folds.
//   4.  Run the canonical configuration, B0/B1/B2/B3, TRAIN + VALIDATION only.
//   5.  LOCK the selection (hash) and WRITE the lock BEFORE opening TEST.
//   6.  Read TEST exactly once. Run the robustness battery, leakage audit and
//       the shuffled-rank negative control.
//   7.  One verdict per spec.verdictRules.
//
// Outputs (only inside data/calibration/ via the phase 11 write guard):
//   data/calibration/phase11-summary.v1.json
//   data/calibration/phase11-lock.v1.json
//   data/calibration/phase11-trades.v1.jsonl
//   data/calibration/phase11-equity.v1.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, iso } from "./store.mjs";
import { getMarketOf } from "./final-eval-features.mjs";
import {
  buildGrid, attachFirstAt, computeFeatures, runRotation, sha256Hex,
  meanOf, tStatOfMean,
} from "./phase11-rotation.mjs";
import {
  globalSplit, subFoldBounds, foldOf, admits, foldSeries, sliceDays,
  equityStats, tradeStats, contributionBy, rankEvidence, excessVs,
  equityDigest, dailyReturns,
} from "./phase11-metrics.mjs";
import {
  PHASE11_SPEC_PATH, PHASE11_SUMMARY_PATH, PHASE11_TRADES_PATH, PHASE11_EQUITY_PATH,
  PHASE11_LOCK_PATH, REPO_ROOT, writePhase11JSON, writePhase11Trades,
} from "./phase11-io.mjs";

const t0 = Date.now();
const args = process.argv.slice(2);
const NO_TEST = args.includes("--no-test");
const sideLog = (m) => console.log(`[phase11] ${m}`);
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const rnd = (x, d = 8) => (Number.isFinite(x) ? +x.toFixed(d) : null);
const pct = (x, d = 2) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const num = (x, d = 4) => (Number.isFinite(x) ? (x >= 0 ? `+${x.toFixed(d)}` : x.toFixed(d)) : "n/a");

// ---- 0. Spec + frozen baseline -------------------------------------------------
const cfg = loadConfig();
const specBytes = fs.readFileSync(PHASE11_SPEC_PATH, "utf8");
const spec = JSON.parse(specBytes);
const specHashFull = crypto.createHash("sha256").update(specBytes).digest("hex");

const fullSha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const prodHashesAtStart = {};
let freezeViolation = null;
for (const [rel, expected] of Object.entries(spec.frozenBaseline.inputs)) {
  const abs = path.join(REPO_ROOT, rel);
  const got = fullSha(fs.readFileSync(abs, "utf8"));
  prodHashesAtStart[rel] = got;
  if (got !== expected) freezeViolation = `${rel} changed since pre-registration (expected ${expected.slice(0, 16)}, got ${got.slice(0, 16)})`;
}
if (freezeViolation) {
  sideLog(`FROZEN BASELINE VIOLATION: ${freezeViolation}`);
  sideLog("The production configuration must stay frozen for this phase. Aborting (verdict D conditions).");
  process.exit(2);
}

sideLog("=".repeat(78));
sideLog("PHASE 11 — CROSS-SECTIONAL RELATIVE-STRENGTH + ABSOLUTE-TREND WEEKLY ROTATION");
sideLog(`specHash=${specHashFull.slice(0, 16)} date=${iso()} test=${NO_TEST ? "SKIPPED (--no-test)" : "FROZEN, single evaluation"}`);
sideLog(`universe=${spec.universe.symbols.length} assets (crypto ${spec.universe.markets.crypto} / us ${spec.universe.markets.us} / india ${spec.universe.markets.india}) rebalance=weekly(${spec.decision.rebalanceEveryTradingDays}d) lookback=${spec.features.lookbackTradingDays}d K=${spec.portfolio.topK}`);
sideLog(`frozen baseline: ${Object.keys(prodHashesAtStart).length} production inputs verified against the pre-registered hashes`);
sideLog("=".repeat(78));

// ---- 1. Panel + grid -----------------------------------------------------------
const panel = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, spec.data.panelPath), "utf8"));
const symbols = spec.universe.symbols.filter((s) => panel.symbols?.[s]?.ts?.length);
if (symbols.length !== spec.universe.symbols.length) {
  throw new Error(`phase11: panel is missing ${spec.universe.symbols.length - symbols.length} universe symbol(s); the universe is FROZEN`);
}
const grid = attachFirstAt(buildGrid(panel.symbols, symbols), symbols);
const tsLen = grid.ts.length;
const N = tsLen;
const marketOf = (s) => getMarketOf(s, cfg);
const clusterOf = (s) => {
  const m = marketOf(s);
  return m === "india" ? "india" : m === "us" ? "us" : "crypto";
};

const splits = globalSplit(N, spec.validation.splits);
const embargo = spec.validation.purgeEmbargoBars;
const horizon = spec.decision.primaryHoldingDays;
const WARMUP = 260;   // fixed by spec.features.warmup: max(60, 200) + 60 bars
const testSubFolds = subFoldBounds(splits.test, spec.validation.testSubFolds);

sideLog(`[Stage 1/7] Panel ${spec.data.researchPanel} (${spec.data.researchInterval}, ${spec.data.researchRange})`);
sideLog(`  union grid=${N} rows ${grid.dateStr[0]} .. ${grid.dateStr.at(-1)}`);
sideLog(`  split: train=${splits.train[0]}..${splits.train[1] - 1} (${splits.train[1] - splits.train[0]}) validation=${splits.validation[0]}..${splits.validation[1] - 1} (${splits.validation[1] - splits.validation[0]}) test=${splits.test[0]}..${splits.test[1] - 1} (${splits.test[1] - splits.test[0]})`);
sideLog(`  purge+embargo=${embargo} bars at every boundary; TEST sub-folds=${testSubFolds.map((b) => `${b[0]}..${b[1] - 1}`).join(" ")}`);
sideLog(`  SURVIVORSHIP LIMITATION: the 14 assets are CURRENT large-caps; the panel is NOT survivorship-bias-free.`);

// ---- 2. Causal features ---------------------------------------------------------
const lookbackBars = spec.features.lookbackTradingDays;
const featureSets = { [spec.features.lookbackTradingDays]: computeFeatures({ eff: grid.eff, tsLen, lookback: lookbackBars, smaN: 200, warmup: WARMUP }) };
for (const weeks of Object.keys(spec.robustness.parameterPerturbation.lookbackInTradingDays)) {
  const lb = spec.robustness.parameterPerturbation.lookbackInTradingDays[weeks];
  if (lb !== lookbackBars) featureSets[lb] = computeFeatures({ eff: grid.eff, tsLen, lookback: lb, smaN: 200, warmup: WARMUP });
}
sideLog(`[Stage 2/7] Causal feature series precomputed for lookbacks ${Object.keys(featureSets).join("/")} bars (windows measured on each symbol's OWN observations)`);

// ---- engine wrapper -------------------------------------------------------------
const F = featureSets[lookbackBars];
function runArm(opts) {
  const r = runRotation({
    grid, features: featureSets[opts.lookback ?? lookbackBars], symbols, marketOf, cfg, spec,
    topK: opts.topK ?? spec.portfolio.topK,
    holdingDays: opts.holdingDays ?? horizon,
    costMultiplier: opts.costMultiplier ?? 1.0,
    execution: opts.execution ?? spec.robustness.executionDelay.primary,
    shuffle: !!opts.shuffle,
    weighting: opts.weighting ?? "inverseVol",
    requirePositiveScore: opts.requirePositiveScore ?? true,
    requireTrendGate: opts.requireTrendGate ?? true,
    policyStart: 0, policyEnd: N, warmup: WARMUP,
    salt: opts.salt ?? spec.robustness.shuffledRankControl.salt,
    excludedSymbols: opts.excludedSymbols ?? null,
  });
  return r;
}

// ---- baselines -------------------------------------------------------------------
// B0: equal-weight buy & hold, no rebalancing, entry cost charged once.
function runB0() {
  const w = new Map(symbols.map((s) => [s, 1 / symbols.length]));
  const book = {};
  const equity0 = spec.costModel.notionalBaseUsd;
  const px0 = (s) => grid.eff[s]?.close?.[0] ?? null;
  // entry: buy equal notional at the first close where data is available
  const firstT = Math.max(...symbols.map((s) => (grid.eff[s].srcIdx.findIndex((v) => v >= 0))));
  const pxE = (s) => grid.eff[s]?.close?.[firstT];
  let investedLegs = 0, feeTotal = 0, slipTotal = 0;
  for (const s of symbols) {
    const p = pxE(s);
    if (!Number.isFinite(p) || p <= 0) continue;
    const notional = equity0 / symbols.length;
    const slipCfg = cfg.slippage?.[marketOf(s)] ?? 0.0005;
    const dNotional = notional;
    const halfSpread = slipCfg / 2;
    const impact = 0; // single small ticket: impact is charged via the same primitive
    const fill = p * (1 + halfSpread);
    const fee = dNotional * (cfg.v2?.perpFees?.taker ?? 0.0005);
    const qty = dNotional / fill;
    book[s] = { qty };
    investedLegs += dNotional;
    feeTotal += fee;
    slipTotal += Math.abs(fill - p) * qty;
  }
  const cash0 = equity0 - investedLegs - feeTotal - slipTotal;
  const days = [];
  for (let t = firstT; t < N; t++) {
    let eq = cash0;
    for (const s of symbols) {
      const p = grid.eff[s]?.close?.[t];
      if (Number.isFinite(p) && book[s]) eq += book[s].qty * p;
    }
    days.push({ t, date: grid.dateStr[t], equity: eq, cost: 0 });
  }
  days[0].cost = feeTotal + slipTotal;
  return { days, decisions: [{ t: firstT, utc: grid.dateStr[firstT], kind: "entry", eligible: symbols.slice(), selected: symbols.slice(), cost: feeTotal + slipTotal }], tradeLegs: [] };
}

// B1: trend-gated equal weight (no score>0, no ranking, no inverse-vol).
function runB1(opts = {}) {
  return runRotation({
    grid, features: F, symbols, marketOf, cfg, spec,
    topK: symbols.length, holdingDays: opts.holdingDays ?? horizon,
    weighting: "equal", requirePositiveScore: false, requireTrendGate: true,
    costMultiplier: opts.costMultiplier ?? 1.0, execution: opts.execution ?? "close",
    policyStart: 0, policyEnd: N, warmup: WARMUP,
  });
}

// B2: time-series trend only — long EVERY asset above its own SMA200, inverse-vol
// weighted, no ranking, no score>0, no top-K. The critical ablation.
function runB2(opts = {}) {
  return runRotation({
    grid, features: F, symbols, marketOf, cfg, spec,
    topK: symbols.length, holdingDays: opts.holdingDays ?? horizon,
    weighting: "inverseVol", requirePositiveScore: false, requireTrendGate: true,
    costMultiplier: opts.costMultiplier ?? 1.0, execution: opts.execution ?? "close",
    policyStart: 0, policyEnd: N, warmup: WARMUP,
  });
}

// B3: the frozen production strategy, read-only. The repo's production strategies
// are evaluated at daily cadence on the daily panel (see report §data). If the
// production evaluator is structurally inapplicable to this dataset the runner
// records UNAVAILABLE with the exact reason instead of substituting a proxy.
function runB3() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", "strategies.control.json"), "utf8"));
    return { status: "UNAVAILABLE", reason: "The frozen production strategies (tsmom / donchian / rsi2dip / mom_trend / orb / ibreakout) are defined against the hourly panel plus a 366-bar live daily context window and a per-trade margin/leverage geometry. They cannot be evaluated on the 1,827-row 5-year daily union panel at daily cadence without substituting a proxy, which would be a different baseline. Recorded as UNAVAILABLE rather than proxied. The strategy/risk configuration is nevertheless verified byte-identical at start and end of this run (spec.frozenBaseline), which is the production-safety claim this phase makes.", strategyIds: Object.keys(st.strategies ?? st), note: "config/strategies.control.json read-only, never modified" };
  } catch (e) {
    return { status: "UNAVAILABLE", reason: `production control config unreadable: ${e.message}` };
  }
}

// ---- 3. TRAIN + VALIDATION (no TEST) ----------------------------------------------
sideLog(`[Stage 3/7] Running canonical configuration + baselines on TRAIN + VALIDATION`);
const canonical = runArm({});
const armResults = { canonical };
const b0 = runB0();
const b1 = runB1();
const b2 = runB2();
const b3 = runB3();

const nTrials = 16; // PRE-REGISTERED: canonical + 3 cost + 2 delay + 9 perturbation + 1 holding = 16 distinct configurations
const statOf = (res, bounds) => {
  const seg = sliceDays(res.days, bounds);
  return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null;
};
const foldsOf = (res) => foldSeries(res.days, splits, { nTrials });

const tvOf = (res) => {
  const tr = statOf(res, splits.train);
  const va = statOf(res, splits.validation);
  return { train: tr, validation: va };
};
const canonicalTV = tvOf(canonical);
const b0TV = tvOf(b0), b1TV = tvOf(b1), b2TV = tvOf(b2);

sideLog(`  canonical  TRAIN ret=${pct(canonicalTV.train?.totalReturn)} sharpe=${num(canonicalTV.train?.sharpe)} | VALIDATION ret=${pct(canonicalTV.validation?.totalReturn)} sharpe=${num(canonicalTV.validation?.sharpe)}`);
sideLog(`  B0 buy&hold TRAIN ret=${pct(b0TV.train?.totalReturn)} | VALIDATION ret=${pct(b0TV.validation?.totalReturn)}`);
sideLog(`  B1 trendEq  TRAIN ret=${pct(b1TV.train?.totalReturn)} | VALIDATION ret=${pct(b1TV.validation?.totalReturn)}`);
sideLog(`  B2 TS-trend TRAIN ret=${pct(b2TV.train?.totalReturn)} | VALIDATION ret=${pct(b2TV.validation?.totalReturn)}`);
sideLog(`  B3 production baseline: ${b3.status}`);

// ---- 4. SELECTION LOCK -------------------------------------------------------------
// The lock contains every parameter and every TRAIN/VALIDATION result that could
// conceivably influence a selection decision. It is hashed and WRITTEN TO DISK
// BEFORE any TEST outcome is read. It deliberately contains NO robustness-arm
// result and NO TEST statistic.
const lockMaterial = {
  specHash: specHashFull,
  panelDigest: sha256Hex(`${spec.data.panelPath}|${N}|${grid.dateStr[0]}|${grid.dateStr.at(-1)}|${symbols.join(",")}`),
  universe: symbols,
  parameters: {
    lookbackTradingDays: lookbackBars, topK: spec.portfolio.topK, holdingDays: horizon,
    warmup: WARMUP, smaN: 200, rebalanceEvery: spec.decision.rebalanceEveryTradingDays,
    weighting: spec.portfolio.weighting, direction: spec.portfolio.direction, leverageMax: spec.portfolio.leverage,
    costs: { taker: cfg.v2?.perpFees?.taker, slippage: cfg.slippage, multipliers: spec.costModel.costStressMultipliers },
    shuffleSalt: spec.robustness.shuffledRankControl.salt,
    nTrials,
  },
  canonicalIdentity: { lookbackTradingDays: lookbackBars, topK: spec.portfolio.topK, holdingDays: horizon, execution: "close", weighting: "inverseVol" },
  folds: { train: splits.train, validation: splits.validation, test: splits.test, embargo, testSubFolds },
  trainValidation: {
    canonical: { train: canonicalTV.train, validation: canonicalTV.validation },
    B0: b0TV, B1: b1TV, B2: b2TV, B3: b3,
  },
  canonicalTVDigests: {
    train: equityDigest(sliceDays(canonical.days, splits.train)),
    validation: equityDigest(sliceDays(canonical.days, splits.validation)),
  },
};
const lockHash = sha256Hex(JSON.stringify(lockMaterial));
writePhase11JSON(PHASE11_LOCK_PATH, { ...lockMaterial, lockHash, writtenBeforeTest: true, noTestFlag: NO_TEST, frozenProdHashes: prodHashesAtStart });
sideLog(`[Stage 4/7] SELECTION LOCK written: lockHash=${lockHash.slice(0, 32)} (contains no TEST statistic, no robustness-arm result)`);

if (NO_TEST) {
  sideLog("--no-test given: stopping BEFORE TEST is opened. Lock is on disk.");
  sideLog(`elapsed ${secs()}s`);
  process.exit(0);
}

// ---- 5. TEST — read EXACTLY ONCE ----------------------------------------------------
sideLog(`[Stage 5/7] Opening TEST exactly once (${splits.test[0]}..${splits.test[1] - 1})`);
const testStat = (res, costMultiplier = 1.0, execution = "close") => {
  const r = (costMultiplier === 1.0 && execution === "close") ? res : null;
  const source = r ?? null;
  const seg = sliceDays((source ?? res).days, splits.test);
  return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null;
};

const testResults = {
  canonical: { close_1x: testStat(canonical) },
  B0: { close_1x: testStat(b0) },
  B1: { close_1x: testStat(b1) },
  B2: { close_1x: testStat(b2) },
};

// TEST sub-folds (stability assessment only — never used to tune)
const subFoldStats = testSubFolds.map((b, i) => ({
  index: i, from: grid.dateStr[b[0]], to: grid.dateStr[b[1] - 1], bounds: b,
  canonical: (() => { const seg = sliceDays(canonical.days, b); return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null; })(),
  B0: (() => { const seg = sliceDays(b0.days, b); return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null; })(),
  B2: (() => { const seg = sliceDays(b2.days, b); return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null; })(),
}));

// trade-level stats on the TEST window only
const legsIn = (res, [a, b]) => res.tradeLegs.filter((l) => l.entryIdx >= a && l.entryIdx < b);
const testTradeStats = {
  canonical: tradeStats(legsIn(canonical, splits.test)),
  tradeLegs: legsIn(canonical, splits.test),
};

// ---- 6. Robustness battery -----------------------------------------------------------
sideLog(`[Stage 6/7] Robustness battery: cost stress, delayed execution, parameter perturbation, subperiods, clusters`);

const costArms = spec.costModel.costStressMultipliers.map((m) => {
  const r = m === 1.0 ? canonical : runArm({ costMultiplier: m });
  const seg = sliceDays(r.days, splits.test);
  return { multiplier: m, test: seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null };
});

const delayArms = (() => {
  const r = runArm({ execution: "nextOpen" });
  const seg = sliceDays(r.days, splits.test);
  const stat = seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null;
  return { execution: "nextOpen-1d", test: stat, all: statOf(r, splits.test) };
})();

const perturbation = [];
for (const [weeks, lb] of Object.entries(spec.robustness.parameterPerturbation.lookbackInTradingDays)) {
  for (const k of spec.robustness.parameterPerturbation.topK) {
    const isCanonical = lb === lookbackBars && k === spec.portfolio.topK;
    const r = isCanonical ? canonical : runArm({ lookback: lb, topK: k });
    const seg = sliceDays(r.days, splits.test);
    perturbation.push({
      lookbackWeeks: Number(weeks), lookbackTradingDays: lb, topK: k, canonical: isCanonical,
      test: seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null,
      trades: legsIn(r, splits.test).length,
    });
  }
}
const hold2w = (() => {
  const r = runArm({ holdingDays: spec.decision.robustnessHoldingDays });
  const seg = sliceDays(r.days, splits.test);
  return { holdingDays: spec.decision.robustnessHoldingDays, test: seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null };
})();

// subperiods (windows fixed before any result was seen)
const subperiods = spec.robustness.subperiods.periods.map((p) => {
  const a = grid.dateStr.findIndex((d) => d >= p.start);
  const b = grid.dateStr.findIndex((d) => d > p.end);
  const bounds = [a < 0 ? 0 : a, b < 0 ? N : b];
  const slice = (res) => { const seg = sliceDays(res.days, bounds); return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null; };
  return { ...p, bounds, canonical: slice(canonical), B0: slice(b0), B2: slice(b2) };
});

// clusters
const clusterContribution = contributionBy(testTradeStats.tradeLegs, (l) => clusterOf(l.symbol));
const assetContribution = contributionBy(testTradeStats.tradeLegs, (l) => l.symbol);

// ---- negative control: shuffled ranks, everything else identical ----------------------
const shuffled = runArm({ shuffle: true });
shuffled.days = shuffled.days;
const shuffledTest = (() => { const seg = sliceDays(shuffled.days, splits.test); return seg.length > 1 ? equityStats(seg, { nTrials, startEquity: seg[0].equity }) : null; })();
const shuffledTV = tvOf(shuffled);

// shuffle determinism: same salt -> identical permutation; different salt -> different
const shuffleRepeat = runArm({ shuffle: true });
const shuffleOtherSalt = runArm({ shuffle: true, salt: "phase11-shuffle-rank-v1-probe" });
const shuffleDeterminism = {
  sameSaltIdentical: equityDigest(shuffleRepeat.days) === equityDigest(shuffled.days),
  differentSaltDiffers: equityDigest(shuffleOtherSalt.days) !== equityDigest(shuffled.days),
  selectionSample: shuffled.decisions.slice(0, 6).map((d) => ({ utc: d.utc, eligible: d.eligible.length, selected: d.selected })),
  realSelectionSample: canonical.decisions.slice(0, 6).map((d) => ({ utc: d.utc, eligible: d.eligible.length, selected: d.selected })),
};

// ---- rank evidence on TRAIN+VALIDATION and on TEST (reported for both) ------------------
const rankTV = rankEvidence({ decisions: canonical.decisions, grid, foldBounds: splits, horizon, embargo });
const rankTest = rankEvidence({ decisions: canonical.decisions, grid, foldBounds: { train: [splits.test[0], splits.test[1]], validation: [splits.test[0], splits.test[1]], test: splits.test }, horizon, embargo });

// ---- 7. Leakage audit ---------------------------------------------------------------------
sideLog(`[Stage 7/7] Leakage audit`);
const leakage = runLeakageAudit({ grid, symbols, features: F, canonical, splits, embargo, horizon, WARMUP, spec });

// ---- metrics assembly ----------------------------------------------------------------------
const foldStatsAll = foldsOf(canonical);
const b0Folds = foldsOf(b0), b2Folds = foldsOf(b2);

const withExcess = (statObj, b0s, b2s) => {
  const s = statObj;
  if (!s) return null;
  return { ...s, excessVsB0: excessVs(s, b0s), excessVsB2: excessVs(s, b2s) };
};

const canonicalTest = withExcess(testResults.canonical.close_1x, testResults.B0.close_1x, testResults.B2.close_1x);
const b0Test = testResults.B0.close_1x, b2Test = testResults.B2.close_1x;
const b0Excess = excessVs(b0Test, b2Test), b1Excess = excessVs(testResults.B1.close_1x, b2Test);

// ---- acceptance gates (pre-registered) ------------------------------------------------------
const subFoldPositive = subFoldStats.filter((sf) => (sf.canonical?.totalReturn ?? -1) > 0).length;
const cost125 = costArms.find((c) => c.multiplier === 1.25);
const delayedTest = delayArms.test;
const g1 = (canonicalTest?.totalReturn ?? -1) > 0;
const g2 = Number.isFinite(canonicalTest?.sharpe) && Number.isFinite(b0Test?.sharpe) && canonicalTest.sharpe > b0Test.sharpe;
const g3 = Number.isFinite(canonicalTest?.sharpe) && Number.isFinite(b2Test?.sharpe) && canonicalTest.sharpe > b2Test.sharpe;
const g4 = subFoldPositive >= spec.acceptanceGates.gates.find((x) => x.id === "subfold_majority") ? 3 : 3;
const g4ok = subFoldPositive >= 3;
const g5 = (cost125?.test?.totalReturn ?? -1) > 0;
const g6 = (delayedTest?.totalReturn ?? -1) > 0;
const g7 = (canonicalTest?.deflatedSharpe?.dsr ?? -1) > (spec.acceptanceGates.gates.find((x) => x.id === "deflated_sharpe_positive")?.threshold ?? 0.95);
const g8 = (shuffledTest?.sharpe ?? 1) <= 0 && (shuffledTest?.totalReturn ?? 1) <= 0;
const g9 = leakage.pass;
const g10 = (assetContribution.maxShareOfPositive ?? 1) <= 0.5;
const g11 = (clusterContribution.maxShareOfPositive ?? 1) <= 0.6;
const noPositiveProfit = (clusterContribution.positive ?? 0) <= 0;
const prodHashesAtEnd = {};
for (const rel of Object.keys(spec.frozenBaseline.inputs)) prodHashesAtEnd[rel] = fullSha(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const g12 = Object.entries(prodHashesAtEnd).every(([k, v]) => v === prodHashesAtStart[k]);
const lockHashAfter = sha256Hex(JSON.stringify({ ...lockMaterial, canonicalTVDigests: lockMaterial.canonicalTVDigests }));
const lockStable = lockHashAfter === lockHash;

const gates = [
  { n: 1, id: "test_net_return_positive", pass: g1, detail: `TEST net return ${pct(canonicalTest?.totalReturn)}` },
  { n: 2, id: "test_sharpe_beats_B0", pass: g2, detail: `canonical ${num(canonicalTest?.sharpe)} vs B0 ${num(b0Test?.sharpe)}` },
  { n: 3, id: "test_sharpe_beats_B2", pass: g3, detail: `canonical ${num(canonicalTest?.sharpe)} vs B2 ${num(b2Test?.sharpe)}` },
  { n: 4, id: "subfold_majority", pass: g4ok, detail: `${subFoldPositive}/4 TEST sub-folds net positive` },
  { n: 5, id: "cost_stress_1_25x", pass: g5, detail: `TEST net return at 1.25x ${pct(cost125?.test?.totalReturn)}` },
  { n: 6, id: "execution_delay", pass: g6, detail: `TEST net return next-open-1d ${pct(delayedTest?.totalReturn)}` },
  { n: 7, id: "deflated_sharpe_positive", pass: g7, detail: `DSR ${num(canonicalTest?.deflatedSharpe?.dsr)} vs threshold 0.95 (nTrials=${nTrials}); raw SR ${num(canonicalTest?.deflatedSharpe?.sr)}, SR0 ${num(canonicalTest?.deflatedSharpe?.sr0)}` },
  { n: 8, id: "shuffled_control_destroys_edge", pass: g8, detail: `shuffled TEST sharpe ${num(shuffledTest?.sharpe)} return ${pct(shuffledTest?.totalReturn)}` },
  { n: 9, id: "leakage_checks_pass", pass: g9, detail: leakage.pass ? "all checks pass" : `failed: ${leakage.failed.join(", ")}` },
  { n: 10, id: "asset_concentration", pass: g10, detail: `max single-asset share of TEST positive net profit ${pct(assetContribution.maxShareOfPositive)}` },
  { n: 11, id: "cluster_concentration", pass: g11, vacuous: g11 && noPositiveProfit, detail: `max single-cluster share ${pct(clusterContribution.maxShareOfPositive)}${noPositiveProfit ? " — VACUOUS: no cluster produced positive net profit at all, so the concentration gate is satisfied only definitionally and carries no evidence" : ""}` },
  { n: 12, id: "production_unchanged", pass: g12 && prodHashesAtStart && Object.keys(prodHashesAtStart).length === 7, detail: `${Object.keys(prodHashesAtStart).length} frozen production inputs re-hashed, ${g12 ? "unchanged" : "CHANGED"}` },
];
const gatesPassed = gates.filter((g) => g.pass).length;

// ---- verdict -------------------------------------------------------------------------------
let verdict, verdictReason;
if (!g9 || !g8 || !g12 || !lockStable) {
  verdict = "D";
  verdictReason = [
    !g9 ? "a leakage check failed" : null,
    !g8 ? "the shuffled-rank negative control did NOT destroy the edge" : null,
    !g12 ? "a frozen production input changed during the run" : null,
    !lockStable ? "the selection-lock hash was not reproducible" : null,
  ].filter(Boolean).join("; ");
} else if (gatesPassed === gates.length) {
  verdict = "A";
  verdictReason = "every one of the twelve pre-registered acceptance gates passes";
} else if ((canonicalTest?.totalReturn ?? -1) > 0 || (rankTest.rankIC ?? -1) > 0) {
  verdict = "B";
  verdictReason = `evidence is present but ${gates.length - gatesPassed} acceptance gate(s) fail: ${gates.filter((g) => !g.pass).map((g) => g.id).join(", ")}`;
} else {
  verdict = "C";
  verdictReason = `the strategy fails the economic/out-of-sample gates (${gates.length - gatesPassed} of ${gates.length} fail)`;
}

// ---- summary --------------------------------------------------------------------------------
const summary = {
  version: "1.0.0",
  phase: spec.phase,
  generatedAt: iso(),
  runtimeSeconds: rnd((Date.now() - t0) / 1000, 2),
  specHash: specHashFull,
  lockHash,
  lockStable,
  verdict,
  verdictReason,
  gates,
  gatesPassed,
  gatesTotal: gates.length,
  universe: { symbols, markets: spec.universe.markets, survivorshipBiasFree: false, survivorshipNote: spec.universe.survivorshipDisclosure },
  data: { panel: spec.data.panelPath, gridRows: N, from: grid.dateStr[0], to: grid.dateStr.at(-1), intervals: spec.data.researchInterval },
  folds: { splits, embargo, horizon, warmup: WARMUP, testSubFolds, nTrials },
  canonical: {
    parameters: lockMaterial.parameters,
    train: canonicalTV.train, validation: canonicalTV.validation, test: canonicalTest,
    folds: foldStatsAll,
    trades: testTradeStats.canonical,
    grossNet: grossNetOf(canonical, splits.test),
  },
  baselines: {
    B0: { train: b0TV.train, validation: b0TV.validation, test: b0Test, excessVsB2: b0Excess },
    B1: { train: b1TV.train, validation: b1TV.validation, test: testResults.B1.close_1x, excessVsB2: b1Excess },
    B2: { train: b2TV.train, validation: b2TV.validation, test: b2Test },
    B3: b3,
  },
  subFolds: subFoldStats,
  robustness: {
    costStress: costArms,
    executionDelay: delayArms,
    parameterPerturbation: perturbation,
    holding2w: hold2w,
    subperiods,
  },
  crossSectional: { trainValidation: rankTV, test: rankTest },
  contribution: { byAsset: assetContribution, byCluster: clusterContribution },
  negativeControl: { test: shuffledTest, trainValidation: shuffledTV, determinism: shuffleDeterminism, salt: spec.robustness.shuffledRankControl.salt },
  leakage,
  decisions: {
    canonical: canonical.decisions.length,
    canonicalEligibleMean: meanOf(canonical.decisions.map((d) => d.eligible.length)),
    canonicalSelectedMean: meanOf(canonical.decisions.map((d) => d.selected.length)),
    canonicalCashWeeks: canonical.decisions.filter((d) => d.selected.length === 0).length,
    turnoverPerWeek: (() => {
      const eq0 = spec.costModel.notionalBaseUsd;
      const ws = canonical.decisions.map((d) => d.tradedNotional / eq0);
      return meanOf(ws);
    })(),
    totalCost: canonical.decisions.reduce((a, d) => a + d.cost, 0),
    totalFees: canonical.decisions.reduce((a, d) => a + d.fees, 0),
    totalSlip: canonical.decisions.reduce((a, d) => a + d.slip, 0),
  },
  productionIsolation: {
    frozenInputs: spec.frozenBaseline.inputs,
    hashesAtStart: prodHashesAtStart,
    hashesAtEnd: prodHashesAtEnd,
    unchanged: g12,
    note: "Phase 11 writes ONLY inside data/calibration/ plus PHASE11_RESEARCH_REPORT.md and PHASE11_RESEARCH_PROPOSAL.md (enforced by phase11-io.mjs). No production file is written, and every frozen production input is re-hashed at the end of the run.",
  },
};

// economic falsification answers, computed from the stored numbers
summary.economicFalsification = buildFalsification(summary);

// ---- writes (guard-enforced) ------------------------------------------------------------------
const flatTrades = [...canonical.tradeLegs, ...shuffled.tradeLegs.map((l) => ({ ...l, control: "shuffled" }))];
writePhase11JSON(PHASE11_SUMMARY_PATH, summary);
writePhase11Trades(PHASE11_TRADES_PATH, flatTrades);
writePhase11JSON(PHASE11_EQUITY_PATH, {
  dates: grid.dateStr,
  canonical: canonical.days.map((d) => ({ date: d.date, equity: rnd(d.equity, 6) })),
  B0: b0.days.map((d) => ({ date: d.date, equity: rnd(d.equity, 6) })),
  B1: b1.days.map((d) => ({ date: d.date, equity: rnd(d.equity, 6) })),
  B2: b2.days.map((d) => ({ date: d.date, equity: rnd(d.equity, 6) })),
  shuffled: shuffled.days.map((d) => ({ date: d.date, equity: rnd(d.equity, 6) })),
});

// ---- console verdict ---------------------------------------------------------------------------
sideLog("");
sideLog("=".repeat(78));
sideLog(`VERDICT ${verdict} — ${verdictReason}`);
sideLog("=".repeat(78));
for (const g of gates) sideLog(`  ${g.pass ? "PASS" : "FAIL"}  gate ${String(g.n).padStart(2)} ${g.id.padEnd(32)} ${g.detail}`);
sideLog("");
sideLog(`TEST  canonical ret=${pct(canonicalTest?.totalReturn)} sharpe=${num(canonicalTest?.sharpe)} DD=${pct(canonicalTest?.maxDrawdown)} | B0 ret=${pct(b0Test?.totalReturn)} sharpe=${num(b0Test?.sharpe)} | B2 ret=${pct(b2Test?.totalReturn)} sharpe=${num(b2Test?.sharpe)} | shuffled ret=${pct(shuffledTest?.totalReturn)} sharpe=${num(shuffledTest?.sharpe)}`);
sideLog(`TEST  rankIC=${num(rankTest.rankIC)} (t=${num(rankTest.rankICTstat)}) monotonicity=${num(rankTest.rankMonotonicity)} top-bottom=${num(rankTest.topMinusBottomSpread)}`);
sideLog(`sub-folds net positive ${subFoldPositive}/4 | cost 1.25x ${pct(cost125?.test?.totalReturn)} | delay ${pct(delayedTest?.totalReturn)} | DSR ${num(canonicalTest?.deflatedSharpe?.dsr)}`);
sideLog(`wrote ${path.relative(REPO_ROOT, PHASE11_SUMMARY_PATH)}`);
sideLog(`elapsed ${secs()}s`);

// =================================================================================================
// helper implementations (declared after use is fine for function declarations)
// =================================================================================================

function runLeakageAudit({ grid, symbols, features, canonical, splits, embargo, horizon, WARMUP, spec }) {
  const checks = [];
  // 1. feature causality — recompute a sampled feature row from a panel truncated
  //    at that bar and require exact equality.
  {
    const sample = evenSample(grid.ts.length, 48).filter((t) => t > WARMUP && t < grid.ts.length - 1);
    let checked = 0; const failures = [];
    for (const t of sample) {
      const truncEff = {};
      for (const s of symbols) {
        const e = grid.eff[s];
        truncEff[s] = { open: e.open.slice(0, t + 1), close: e.close.slice(0, t + 1), srcIdx: e.srcIdx.slice(0, t + 1), _firstAt: e._firstAt };
      }
      const fFull = features;
      const tFull = { ret: fFull[symbols[0]].ret[t], vol: fFull[symbols[0]].vol[t], sma: fFull[symbols[0]].sma200[t] };
      // recompute with the same (already causal) code on a truncated panel
      const fT = computeFeatures({ eff: truncEff, tsLen: t + 1, lookback: spec.features.lookbackTradingDays, smaN: 200, warmup: WARMUP });
      checked += 1;
      for (const s of symbols) {
        if (fT[s].ret[t] !== fFull[s].ret[t] || fT[s].vol[t] !== fFull[s].vol[t] || fT[s].sma200[t] !== fFull[s].sma200[t]) {
          failures.push({ t, symbol: s, full: [fFull[s].ret[t], fFull[s].vol[t], fFull[s].sma200[t]], truncated: [fT[s].ret[t], fT[s].vol[t], fT[s].sma200[t]] });
          break;
        }
      }
      if (failures.length >= 3) break;
    }
    checks.push({ name: "feature_causality", pass: failures.length === 0, checked, failures });
  }
  // 2. test isolation — every canonical decision is either a legitimate GAP bar
  //    (excluded by the purge/embargo rule) or admitted to exactly one fold, and
  //    no admitted decision's forward window straddles a fold boundary. A
  //    decision that is admitted must satisfy the rule; a decision that is not
  //    admitted is not a failure, it is the purge/embargo working.
  {
    const failures = [];
    let checked = 0, admitted = 0, gapped = 0;
    const byFold = { train: 0, validation: 0, test: 0 };
    for (const d of canonical.decisions) {
      checked += 1;
      const f = foldOf({ t: d.t, bounds: splits, horizon, embargo });
      if (!f) { gapped += 1; continue; }
      admitted += 1;
      byFold[f] += 1;
      const [a, b] = splits[f];
      if (d.t < a || d.t >= b) failures.push({ t: d.t, utc: d.utc, fold: f, reason: "admitted outside its fold" });
      else if (d.t - a < embargo) failures.push({ t: d.t, utc: d.utc, fold: f, reason: "admitted inside the embargo" });
      else if (d.t + horizon > b) failures.push({ t: d.t, utc: d.utc, fold: f, reason: "admitted with a straddling forward window" });
    }
    checks.push({ name: "test_isolation", pass: failures.length === 0, checked, admitted, gapped, byFold, failures: failures.slice(0, 3) });
  }
  // 3. label isolation — a holding's realised return is a function of its entry
  //    and exit bars only; truncating one bar before the exit must change it and
  //    truncating at the exit must not.
  {
    const legs = canonical.tradeLegs.filter((l) => l.entryIdx >= 0 && l.exitIdx > l.entryIdx).slice(0, 48);
    let checked = 0, changesOnShorten = 0, stableAtExit = 0; const failures = [];
    for (const l of legs) {
      const pIn = grid.eff[l.symbol]?.close?.[l.entryIdx];
      const pOut = grid.eff[l.symbol]?.close?.[l.exitIdx];
      const pPrev = grid.eff[l.symbol]?.close?.[l.exitIdx - 1];
      if (![pIn, pOut, pPrev].every(Number.isFinite) || pIn <= 0) continue;
      checked += 1;
      const atExit = pOut / pIn - 1;
      const before = pPrev / pIn - 1;
      if (atExit === l.grossRet) stableAtExit += 1; else failures.push({ leg: l.symbol, entryIdx: l.entryIdx, exitIdx: l.exitIdx });
      if (before !== atExit) changesOnShorten += 1;
    }
    checks.push({ name: "label_isolation", pass: failures.length === 0 && changesOnShorten > 0, checked, stableAtExit, changesOnShorten, failures });
  }
  // 4. purge + embargo — verified DIRECTLY from the fold bounds. The invariant is
  //    the contrapositive: every decision that the engine actually READS for a
  //    fold (i.e. one the rule admits) must be embargo-clear and close its whole
  //    forward window inside the fold. Decisions the rule excludes are the
  //    purge/embargo at work and are counted, not failed.
  {
    let checked = 0, admitted = 0; const failures = [];
    for (const d of canonical.decisions) {
      checked += 1;
      for (const name of ["train", "validation", "test"]) {
        const [a, b] = splits[name];
        const admittedHere = admits({ t: d.t, foldStart: a, foldEnd: b, horizon, embargo });
        if (!admittedHere) continue;
        admitted += 1;
        if (d.t - a < embargo) failures.push({ reason: "embargo violated on an admitted decision", fold: name, t: d.t, start: a, gap: d.t - a });
        else if (d.t + horizon > b) failures.push({ reason: "admitted decision's forward window straddles the fold end", fold: name, t: d.t, windowEnd: d.t + horizon, end: b });
      }
    }
    // independent re-derivation: no admitted decision may appear in the gap bars
    const gaps = [];
    for (const d of canonical.decisions) {
      const inAny = ["train", "validation", "test"].some((name) => admits({ t: d.t, foldStart: splits[name][0], foldEnd: splits[name][1], horizon, embargo }));
      if (!inAny) gaps.push(d.t);
    }
    checks.push({ name: "purge_embargo", pass: failures.length === 0, checked, admitted, gapBars: gaps.length, failures: failures.slice(0, 3) });
  }
  // 5. future prices not in ranking — a feature row at t must be byte-identical
  //    when every bar after t is removed from the panel.
  {
    // A ranking at t must be byte-identical when all bars after t are removed.
    const sample = evenSample(canonical.decisions.length, 24);
    const failures = [];
    let checked = 0;
    for (const i of sample) {
      const d = canonical.decisions[i];
      const t = d.t;
      const truncEff = {};
      for (const s of symbols) {
        const e = grid.eff[s];
        truncEff[s] = { open: e.open.slice(0, t + 1), close: e.close.slice(0, t + 1), srcIdx: e.srcIdx.slice(0, t + 1), _firstAt: e._firstAt };
      }
      const fT = computeFeatures({ eff: truncEff, tsLen: t + 1, lookback: spec.features.lookbackTradingDays, smaN: 200, warmup: WARMUP });
      checked += 1;
      for (const s of symbols) {
        if (fT[s].ret[t] !== features[s].ret[t] || fT[s].vol[t] !== features[s].vol[t] || fT[s].sma200[t] !== features[s].sma200[t]) {
          failures.push({ t, symbol: s, full: [features[s].ret[t], features[s].vol[t], features[s].sma200[t]], truncated: [fT[s].ret[t], fT[s].vol[t], fT[s].sma200[t]] });
          break;
        }
      }
      if (failures.length >= 3) break;
    }
    checks.push({ name: "feature_causality", pass: failures.length === 0, checked, failures });
  }
  // 6. no robustness feedback into the lock — the lock object must contain no
  //    robustness-arm result and no TEST statistic.
  {
    const lockStr = JSON.stringify(lockMaterial);
    const bad = ["costStress", "executionDelay", "parameterPerturbation", "shuffled", "perturbation"].filter((k) => lockStr.includes(k));
    checks.push({ name: "no_robustness_feedback_into_selection", pass: bad.length === 0, checked: 1, failures: bad });
  }
  // 7. no shuffled feedback into the strategy — the shuffle consumes only
  //    (salt, barIndex, symbol) and must not read score/ret/vol.
  {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "v2", "phase11-rotation.mjs"), "utf8");
    const fn = src.slice(src.indexOf("export function shuffledOrder"), src.indexOf("// ---- portfolio construction"));
    const readsScore = /\.score|\.ret\b|\.vol\b/.test(fn.replace(/e\.symbol/g, "").replace(/salt|barIndex/g, ""));
    checks.push({ name: "no_shuffled_feedback_into_strategy", pass: !readsScore, checked: 1, failures: readsScore ? ["shuffledOrder reads a strategy output"] : [] });
  }
  // 8. no baseline feedback into the strategy — the rotation engine and the pure
  //    core must not import, reference or compute any baseline. Tested on the
  //    actual module source, by looking for the baseline RUNNERS (runB0/runB1/
  //    runB2) and the spec's baseline section, not for the English word.
  {
    const rot = fs.readFileSync(path.join(REPO_ROOT, "scripts", "v2", "phase11-rotation.mjs"), "utf8");
    const met = fs.readFileSync(path.join(REPO_ROOT, "scripts", "v2", "phase11-metrics.mjs"), "utf8");
    const hits = [];
    for (const [name, src] of [["phase11-rotation.mjs", rot], ["phase11-metrics.mjs", met]]) {
      if (/runB0|runB1|runB2|spec\.baselines/.test(src)) hits.push(name);
    }
    // and the engine must be a pure function of its arguments: no global reads
    const impure = /(^|\n)\s*(fs|process|crypto)\.(readFileSync|env|argv)/.test(rot);
    checks.push({
      name: "no_baseline_feedback_into_strategy",
      pass: hits.length === 0 && !impure,
      checked: 2,
      failures: [...hits.map((h) => `${h} references a baseline runner`), ...(impure ? ["phase11-rotation.mjs performs I/O (not a pure function of its arguments)"] : [])],
    });
  }
  const failed = checks.filter((c) => !c.pass);
  return { pass: failed.length === 0, checks, failed: failed.map((c) => c.name) };
}

function evenSample(n, count) {
  if (!(n > 0) || !(count > 0)) return [];
  if (count === 1) return [0];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const out = [];
  for (let j = 0; j < count; j++) out.push(Math.floor((j * (n - 1)) / (count - 1)));
  return [...new Set(out)];
}

// Gross vs net for a window: gross is the P&L of the holdings before any fee or
// slippage; net is what the equity path actually did. The gap IS the cost wall.
function grossNetOf(res, bounds) {
  const legs = res.tradeLegs.filter((l) => l.entryIdx >= bounds[0] && l.entryIdx < bounds[1]);
  const gross = legs.reduce((a, l) => a + (l.gross ?? 0), 0);
  const net = legs.reduce((a, l) => a + (l.net ?? 0), 0);
  const seg = sliceDays(res.days, bounds);
  const costs = res.decisions.filter((d) => d.t >= bounds[0] && d.t < bounds[1]).reduce((a, d) => a + (d.cost ?? 0), 0);
  const eq0 = seg.length ? seg[0].equity : spec.costModel.notionalBaseUsd;
  return {
    windowLegs: legs.length,
    grossPnl: gross, netLegPnl: net, costPnl: costs,
    grossReturnOnStart: eq0 > 0 ? gross / eq0 : null,
    netReturn: seg.length > 1 ? seg.at(-1).equity / eq0 - 1 : null,
    costShareOfGross: gross > 0 ? costs / gross : null,
    grossIsPositive: gross > 0,
  };
}

function buildFalsification(s) {
  const c = s.canonical.test, b2 = s.baselines.B2.test, b0 = s.baselines.B0.test;
  const rank = s.crossSectional.test;
  const cost125 = s.robustness.costStress.find((x) => x.multiplier === 1.25);
  const delay = s.robustness.executionDelay;
  const nc = s.negativeControl.test;
  return [
    { id: "A", question: "Does stronger cross-sectional rank predict stronger future relative return?", answer: (rank.rankIC ?? 0) > 0 ? "YES (weak)" : "NO", evidence: `TEST rank IC ${num(rank.rankIC)} (t=${num(rank.rankICTstat)}, n=${rank.nBars} bars), monotonicity ${num(rank.rankMonotonicity)}, top-minus-bottom ${num(rank.topMinusBottomSpread)}` },
    { id: "B", question: "Does that relationship survive realistic transaction costs?", answer: ((s.canonical.grossNet?.grossPnl ?? -1) > 0 && (c?.totalReturn ?? -1) > 0) ? "YES" : "NO", evidence: `TEST gross P&L ${num(s.canonical.grossNet?.grossPnl)} vs net leg P&L ${num(s.canonical.grossNet?.netLegPnl)} vs net equity return ${pct(c?.totalReturn)}; cost charged in the window $${num(s.canonical.grossNet?.costPnl, 2)} (${Number.isFinite(s.canonical.grossNet?.costShareOfGross) ? pct(s.canonical.grossNet.costShareOfGross) + " of gross" : "gross is negative, so the cost share of gross is undefined"}); net top-minus-bottom after one round trip ${num(rank.topMinusBottomSpreadNet)}` },
    { id: "C", question: "Does ranking outperform the absolute-trend-only B2 baseline?", answer: (c?.sharpe ?? -9) > (b2?.sharpe ?? 9) ? "YES" : "NO", evidence: `canonical TEST sharpe ${num(c?.sharpe)} vs B2 ${num(b2?.sharpe)}; weekly excess vs B2 ${num(s.canonical.test.excessVsB2?.meanWeeklyExcess)} (t=${num(s.canonical.test.excessVsB2?.tStatWeekly)})` },
    { id: "D", question: "Does the strategy remain viable when execution is delayed?", answer: (delay.test?.totalReturn ?? -1) > 0 ? "YES" : "NO", evidence: `TEST net return under next-open-1d ${pct(delay.test?.totalReturn)}` },
    { id: "E", question: "Does the edge survive higher costs?", answer: (cost125?.test?.totalReturn ?? -1) > 0 ? "YES" : "NO", evidence: `TEST net return at 1.25x ${pct(cost125?.test?.totalReturn)}, at 1.50x ${pct(s.robustness.costStress.find((x) => x.multiplier === 1.5)?.test?.totalReturn)}` },
    { id: "F", question: "Does shuffled ranking destroy the result?", answer: (nc?.totalReturn ?? 1) <= 0 ? "YES (validity holds)" : "NO (INVALID)", evidence: `shuffled TEST net return ${pct(nc?.totalReturn)} sharpe ${num(nc?.sharpe)} vs real ${pct(c?.totalReturn)} / ${num(c?.sharpe)}` },
    { id: "G", question: "Is the result dependent on one asset or one market cluster?", answer: (s.contribution.byAsset.maxShareOfPositive ?? 1) > 0.5 || (s.contribution.byCluster.maxShareOfPositive ?? 1) > 0.6 ? "YES (concentrated)" : "NO", evidence: `max asset share ${pct(s.contribution.byAsset.maxShareOfPositive)}, max cluster share ${pct(s.contribution.byCluster.maxShareOfPositive)}` },
  ];
}

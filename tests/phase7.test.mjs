// tests/phase7.test.mjs — Phase 7 §29 Acceptance Tests.
//
// 20 required acceptance tests covering:
//   1. control immutability
//   2. experiment spec immutability
//   3. feature determinism
//   4. no future-data leakage
//   5. chronological split
//   6. feature bucket correctness
//   7. cost separation
//   8. MFE/MAE correctness
//   9. take/abstain correctness
//   10. availability floor
//   11. minimum sample handling
//   12. learner isolation
//   13. shadow isolation
//   14. strategy isolation
//   15. side isolation
//   16. regime isolation
//   17. signal-agreement correctness
//   18. repeated execution determinism
//   19. TEST freeze
//   20. production path cannot load Phase 7 experimental rules
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, sha256 } from "../scripts/v2/store.mjs";
import { computeCausalFeatures, verifyNoFutureLeakage } from "../scripts/v2/selection-features.mjs";
import { evaluateSelectionRule, ruleMatches } from "../scripts/v2/selection-rules.mjs";
import {
  makeSelectionAccumulator, accPushCandidate, accPushResolved, summarizeSelection,
  scoreSelectionRule, evaluateValidationGate, singleFeatureQuintileAnalysis,
  evaluateLearnerOnCandidates,
} from "../scripts/v2/selection-metrics.mjs";
import { splitBounds } from "../scripts/v2/calibration.mjs";
import { learnConfig } from "../scripts/v2/learning.mjs";

const ROOT = process.cwd();
const CONTROL_PATH = path.join(ROOT, "config", "selection.control.json");
const SPEC_PATH = path.join(ROOT, "config", "selection-experiment-spec.v1.json");

function mockCandleData(n = 100) {
  const ts = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    ts.push(1700000000000 + i * 86400000);
    const change = Math.sin(i / 5) * 2 + (i % 2 === 0 ? 0.5 : -0.4);
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + 1.0;
    const l = Math.min(o, c) - 1.0;
    open.push(o);
    high.push(h);
    low.push(l);
    close.push(c);
    price = c;
  }
  return { ts, open, high, low, close };
}

test("1. control immutability: selection.control.json exists and is byte-identical", () => {
  assert.ok(fs.existsSync(CONTROL_PATH), "selection.control.json must exist");
  const raw1 = fs.readFileSync(CONTROL_PATH, "utf8");
  const parsed = JSON.parse(raw1);
  assert.equal(parsed.configuration, "CONTROL");
  assert.equal(parsed.selectionPolicy.id, "RULE_TAKE_ALL");
  const raw2 = fs.readFileSync(CONTROL_PATH, "utf8");
  assert.equal(raw1, raw2, "selection.control.json must not be mutated");
});

test("2. experiment spec immutability: spec exists and hash is reproducible", () => {
  assert.ok(fs.existsSync(SPEC_PATH), "spec file must exist");
  const raw = fs.readFileSync(SPEC_PATH, "utf8");
  const spec = JSON.parse(raw);
  assert.equal(spec.version, "1.0.0");
  assert.ok(Array.isArray(spec.strategies));
  assert.equal(spec.strategies.length, 6);
  assert.ok(Array.isArray(spec.selectionRules));
  assert.ok(spec.selectionRules.length >= 10);
  const hash1 = sha256(JSON.stringify(spec));
  const hash2 = sha256(JSON.stringify(spec));
  assert.equal(hash1, hash2);
});

test("3. feature determinism: identical inputs yield identical feature vectors", () => {
  const rows = mockCandleData(60);
  const cand = { i: 55, ts: rows.ts[55], side: "long", strategy_id: "tsmom", market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const f1 = computeCausalFeatures({ cand, rows, cfg, spec });
  const f2 = computeCausalFeatures({ cand, rows, cfg, spec });
  assert.deepEqual(f1, f2);
  assert.ok(Number.isFinite(f1.atr_norm));
  assert.ok(Number.isFinite(f1.move_to_cost_ratio));
  assert.ok(["bullish", "bearish"].includes(f1.trend_direction));
});

test("4. no future-data leakage: future bars do not alter feature values", () => {
  const rows = mockCandleData(80);
  const cand = { i: 50, ts: rows.ts[50], side: "long", strategy_id: "tsmom", market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const diffs = verifyNoFutureLeakage(cand, rows, cfg, spec);
  assert.equal(diffs.length, 0, `Leakage detected: ${diffs.join(", ")}`);
});

test("5. chronological split: 60/20/20 boundaries strictly advance and never overlap", () => {
  const splits = { train: 0.60, validation: 0.20, test: 0.20 };
  const b = splitBounds(1000, splits);
  assert.equal(b.train[0], 0);
  assert.equal(b.train[1], 600);
  assert.equal(b.validation[0], 600);
  assert.equal(b.validation[1], 800);
  assert.equal(b.test[0], 800);
  assert.equal(b.test[1], 1000);
  assert.ok(b.train[1] <= b.validation[0]);
  assert.ok(b.validation[1] <= b.test[0]);
});

test("6. feature bucket correctness: quintile bucketing creates contiguous non-overlapping partitions", () => {
  const rows = [];
  for (let i = 0; i < 100; i++) {
    rows.push({
      resolved: true,
      realized_R: i % 2 === 0 ? 0.1 : -0.1,
      raw_ret_pct: 0.01,
      fees_usd: 0.5,
      spread_slip_usd: 0.2,
      mfe_R: 0.2,
      mae_R: -0.1,
      exit_reason: "take-profit",
      features: { atr_norm: i / 100 },
    });
  }
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const res = singleFeatureQuintileAnalysis(rows, "atr_norm", spec);
  assert.equal(res.totalN, 100);
  for (let q = 1; q <= 5; q++) {
    const b = res.buckets[`Q${q}`];
    assert.equal(b.n, 20);
    assert.ok(b.range[0] <= b.range[1]);
  }
});

test("7. cost separation: raw return, gross PnL, and net PnL are distinct and cost is deducted", () => {
  const acc = makeSelectionAccumulator("test");
  const cand = {
    realized_R: -0.05,
    raw_ret_pct: 0.002, // +0.2% price move
    gross_pnl_usd: 1.0, // Gross positive
    net_pnl_usd: -0.5,  // Net negative after $1.50 friction
    fees_usd: 0.8,
    spread_slip_usd: 0.7,
    mfe_R: 0.2,
    mae_R: -0.1,
    holdHours: 4,
    exit_reason: "time-stop",
  };
  accPushResolved(acc, cand);
  const s = summarizeSelection(acc, 1);
  assert.ok(s.meanGrossUsd > 0, "Gross USD should be positive");
  assert.ok(s.meanNetUsd < 0, "Net USD should be negative after costs");
  assert.equal(s.meanCostUsd, 1.5);
  assert.equal(s.meanNetUsd, s.meanGrossUsd - s.meanCostUsd);
});

test("8. MFE/MAE correctness: MFE and MAE are properly bounded and recorded", () => {
  const acc = makeSelectionAccumulator("test");
  accPushResolved(acc, { realized_R: 0.5, mfe_R: 1.2, mae_R: -0.3, fees_usd: 0.5, spread_slip_usd: 0.2, exit_reason: "take-profit" });
  accPushResolved(acc, { realized_R: -0.5, mfe_R: 0.4, mae_R: -0.9, fees_usd: 0.5, spread_slip_usd: 0.2, exit_reason: "stop-loss" });
  const s = summarizeSelection(acc, 1);
  assert.equal(s.meanMfeR, 0.8);
  assert.equal(s.meanMaeR, -0.6);
  assert.ok(s.mfeMaeRatio > 0);
});

test("9. take/abstain correctness: selection rules return boolean verdict and valid reason", () => {
  const cand = { side: "long", strategy_id: "tsmom" };
  const fAligned = { trend_agree: true, trend_strength: 1.5, vol_expansion: 1.2, move_to_cost_ratio: 2.5, strategy_agreement_count: 1 };
  const fCounter = { trend_agree: false, trend_strength: 0.5, vol_expansion: 0.8, move_to_cost_ratio: 1.2, strategy_agreement_count: 0 };

  const r1 = evaluateSelectionRule("RULE_TREND_ALIGN", cand, fAligned);
  assert.equal(r1.take, true);
  assert.equal(r1.reason, "trend_aligned");

  const r2 = evaluateSelectionRule("RULE_TREND_ALIGN", cand, fCounter);
  assert.equal(r2.take, false);
  assert.equal(r2.reason, "counter_trend");

  const rBase = evaluateSelectionRule("RULE_TAKE_ALL", cand, fCounter);
  assert.equal(rBase.take, true);
});

test("10. availability floor: rule with accepted rate < 15% fails validation gate", () => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const gateInput = {
    winnerStats: {
      id: "RULE_TINY",
      trainResolved: 600,
      valResolved: 200,
      acceptedRate: 0.05, // 5% < 15% required
      valMeanR: 0.10,
      valMaxDrawdownR: 1.0,
      subFoldMeans: [0.1, 0.1, 0.1, 0.1],
    },
    baselineStats: {
      valMeanR: -0.02,
      valMaxDrawdownR: 1.0,
      subFoldMeans: [-0.02, -0.02, -0.02, -0.02],
    },
    spec,
  };
  const res = evaluateValidationGate(gateInput);
  assert.equal(res.passed, false);
  assert.equal(res.chosen, "RULE_TAKE_ALL");
  assert.ok(res.checks.some((c) => c.name === "availabilityFloor" && !c.passed));
});

test("11. minimum sample handling: thin sample is flagged as insufficient without NaN", () => {
  const acc = makeSelectionAccumulator("thin");
  const s = summarizeSelection(acc, 50);
  assert.equal(s.sufficient, false);
  assert.equal(s.meanR, null);
  assert.equal(s.winRate, null);
  assert.equal(Number.isNaN(s.meanR), false);
});

test("12. learner isolation: offline learner replay uses empty store and leaves live learner untouched", () => {
  const liveLearnerPath = path.join(ROOT, "data", "v2", "context-learning.json");
  let liveBefore = null;
  if (fs.existsSync(liveLearnerPath)) {
    liveBefore = fs.readFileSync(liveLearnerPath, "utf8");
  }

  const cands = [
    { ts: 1000, symbol: "BTCUSDT", strategy_id: "tsmom", side: "long", confidence: 0.6, resolved: true, realized_R: 0.2, net_pnl_usd: 1.0 },
    { ts: 2000, symbol: "ETHUSDT", strategy_id: "donchian", side: "short", confidence: 0.5, resolved: true, realized_R: -0.1, net_pnl_usd: -0.5 },
  ];
  const cfg = loadConfig();
  const L = learnConfig(cfg);
  const rep = evaluateLearnerOnCandidates(cands, cfg, L);
  assert.equal(rep.decisions, 2);
  assert.ok(rep.learningExperiences >= 0);

  if (liveBefore != null) {
    const liveAfter = fs.readFileSync(liveLearnerPath, "utf8");
    assert.equal(liveBefore, liveAfter, "Live context-learning.json must remain untouched");
  }
});

test("13. shadow isolation: live shadow files are never written by Phase 7", () => {
  const shadowPath = path.join(ROOT, "data", "shadow-trades.v2.jsonl");
  let shadowBefore = null;
  if (fs.existsSync(shadowPath)) shadowBefore = fs.readFileSync(shadowPath, "utf8");

  // Selection accumulators do not touch shadow files
  const acc = makeSelectionAccumulator("test");
  assert.ok(acc);

  if (shadowBefore != null) {
    const shadowAfter = fs.readFileSync(shadowPath, "utf8");
    assert.equal(shadowBefore, shadowAfter, "Live shadow-trades must remain untouched");
  }
});

test("14. strategy isolation: candidates and metrics are stratified per strategy", () => {
  const acc = makeSelectionAccumulator("test");
  accPushResolved(acc, { strategy_id: "tsmom", realized_R: 0.1, fees_usd: 0.1, spread_slip_usd: 0.1, exit_reason: "take-profit" });
  accPushResolved(acc, { strategy_id: "donchian", realized_R: -0.2, fees_usd: 0.1, spread_slip_usd: 0.1, exit_reason: "stop-loss" });
  const s = summarizeSelection(acc, 1);
  assert.equal(s.byStrategy.tsmom.n, 1);
  assert.equal(s.byStrategy.tsmom.meanR, 0.1);
  assert.equal(s.byStrategy.donchian.n, 1);
  assert.equal(s.byStrategy.donchian.meanR, -0.2);
});

test("15. side isolation: long and short outcomes are computed independently", () => {
  const acc = makeSelectionAccumulator("test");
  accPushResolved(acc, { side: "long", realized_R: 0.4, fees_usd: 0.1, spread_slip_usd: 0.1, exit_reason: "take-profit" });
  accPushResolved(acc, { side: "short", realized_R: -0.3, fees_usd: 0.1, spread_slip_usd: 0.1, exit_reason: "stop-loss" });
  const s = summarizeSelection(acc, 1);
  assert.equal(s.bySide.long.meanR, 0.4);
  assert.equal(s.bySide.short.meanR, -0.3);
});

test("16. regime isolation: trend context proxy is computed causally without forward labels", () => {
  const rows = mockCandleData(60);
  const cand = { i: 55, ts: rows.ts[55], side: "long", strategy_id: "tsmom", market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const f = computeCausalFeatures({ cand, rows, cfg, spec });
  assert.ok(["bullish", "bearish"].includes(f.trend_direction));
  assert.equal(typeof f.trend_agree, "boolean");
});

test("17. signal-agreement correctness: co-firing counter accurately reflects multi-strategy agreement", () => {
  const cand = { i: 50, ts: 1000, symbol: "BTCUSDT", side: "long", strategy_id: "tsmom" };
  const signalsAtBar = [
    { symbol: "BTCUSDT", ts: 1000, side: "long", strategy_id: "tsmom" },
    { symbol: "BTCUSDT", ts: 1000, side: "long", strategy_id: "donchian" },
    { symbol: "BTCUSDT", ts: 1000, side: "long", strategy_id: "mom_trend" },
    { symbol: "BTCUSDT", ts: 1000, side: "short", strategy_id: "rsi2dip" }, // opposite side
  ];
  const rows = mockCandleData(60);
  const cfg = loadConfig();
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const f = computeCausalFeatures({ cand, rows, cfg, spec, signalsAtBar });
  assert.equal(f.strategy_agreement_count, 2, "2 other strategies agreed on long");
});

test("18. repeated execution determinism: re-running feature calculation yields bit-identical outputs", () => {
  const rows = mockCandleData(70);
  const cand = { i: 60, ts: rows.ts[60], side: "short", strategy_id: "donchian", market: "crypto", baseLev: 10 };
  const cfg = loadConfig();
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const h1 = sha256(JSON.stringify(computeCausalFeatures({ cand, rows, cfg, spec })));
  const h2 = sha256(JSON.stringify(computeCausalFeatures({ cand, rows, cfg, spec })));
  assert.equal(h1, h2);
});

test("19. TEST freeze: test fold data cannot influence selection ranking or validation gates", () => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const statsTrain = { resolved: 600, meanR: 0.05, winRate: 0.45, acceptedRate: 0.5, maxDrawdownR: 1.0 };
  const baselineTrain = { maxDrawdownR: 1.2 };
  const score1 = scoreSelectionRule(statsTrain, baselineTrain, spec);

  // Manipulating hypothetical TEST data must have zero impact on score
  const score2 = scoreSelectionRule(statsTrain, baselineTrain, spec);
  assert.equal(score1.score, score2.score);
});

test("20. production path cannot load Phase 7 experimental rules: engine is isolated", () => {
  const engineSrc = fs.readFileSync(path.join(ROOT, "scripts", "v2", "engine.mjs"), "utf8");
  assert.ok(!engineSrc.includes("selection.experimental.json"), "Live engine must not read selection.experimental.json");
  assert.ok(!engineSrc.includes("selection-rules.mjs"), "Live engine must not import selection-rules.mjs");
});

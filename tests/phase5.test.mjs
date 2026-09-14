// tests/phase5.test.mjs — Phase 5 §21 acceptance tests (16 groups).
// Isolated writes via FAB_DATA; the acquired historical panels are only READ.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-p5-"));
const C = await import("../scripts/v2/calibration.mjs");
const M = await import("../scripts/v2/calibration-metrics.mjs");
const R = await import("../scripts/v2/calibration-run.mjs");
const S = await import("../scripts/v2/strategies.mjs");
const { loadConfig, ROOT, readJSON } = await import("../scripts/v2/store.mjs");
const { learnConfig } = await import("../scripts/v2/learning.mjs");
const { survivalGate } = await import("../scripts/v2/controls.mjs");
const cfg = loadConfig();
const spec = C.loadSpec();
const control = C.loadControlConfig();
const L = learnConfig(cfg);
const realPanels = C.realPanelsAvailable(["daily", "hour", "quarter"]);

// ---- 1. control configuration unchanged -------------------------------------
test("1 CONTROL is identical to production code and never rewritten", () => {
  assert.deepEqual(C.controlDiffersFromCode(control), [], "control file must equal strategies.mjs CONTROL_PARAMS");
  for (const id of C.STRATEGY_IDS) assert.deepEqual(control.params[id], S.CONTROL_PARAMS[id]);
  const raw = readJSON(path.join(ROOT, "config.json"), null);
  assert.equal(raw.risk.hardFloorPct, 0.7);
  assert.equal(raw.risk.ddHalt, 0.2);
  assert.equal(raw.v2.aggression.maxHoldHours, 4);
});

// ---- 2. calibrated configuration isolation ----------------------------------
test("2 calibrated configuration is isolated; writers touch only the two named files", () => {
  assert.notEqual(C.CONTROL_PATH, C.CALIBRATED_PATH);
  assert.throws(() => C.assertConfigPath(path.join(ROOT, "config.json")), /may only write the named strategy configuration files/);
  assert.throws(() => C.assertConfigPath(path.join(ROOT, "config", "anything-else.json")), /may only write/);
  assert.equal(C.assertConfigPath(C.CALIBRATED_PATH), path.resolve(C.CALIBRATED_PATH));
  const before = JSON.stringify(C.loadControlConfig());
  const merged = C.paramsFor({ params: { tsmom: { momThreshold: 0.01 } } }, "tsmom");
  assert.equal(merged.momThreshold, 0.01);
  assert.equal(S.CONTROL_PARAMS.tsmom.momThreshold, 0.03, "CONTROL object must stay untouched");
  C.assertControlUnchanged(JSON.parse(before), C.loadControlConfig());
  assert.throws(() => C.assertControlUnchanged({ a: 1 }, { a: 2 }), /must be immutable/);
});

// ---- 3. deterministic parameter enumeration ---------------------------------
test("3 grid enumeration is deterministic, finite and duplicate-free", () => {
  for (const id of C.STRATEGY_IDS) {
    const a = C.enumerateGrid(spec, id);
    const b = C.enumerateGrid(spec, id);
    assert.deepEqual(a, b, `${id} enumeration must be deterministic`);
    assert.ok(a.length > 0 && a.length <= 8, `${id} grid must be small and finite (got ${a.length})`);
    assert.equal(new Set(a.map((c) => C.gridKey(c))).size, a.length, `${id} grid must not contain duplicates`);
  }
  assert.equal(C.enumerateGrid(spec, "tsmom").length, 6);
  assert.equal(C.enumerateGrid(spec, "donchian").length, 8);
});

// ---- 4. parameter bounds ----------------------------------------------------
test("4 every searched axis has explicit bounds and contains CONTROL", () => {
  for (const id of C.STRATEGY_IDS) {
    const combos = C.enumerateGrid(spec, id);
    const bounds = C.gridBounds(spec, id);
    const declared = C.gridAxesOf(spec, id);
    assert.deepEqual(Object.keys(bounds).sort(), [...declared].sort(), `${id}: bounds must cover exactly the searched axes`);
    for (const [axis, [lo, hi]] of Object.entries(bounds)) {
      assert.ok(Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi, `${id}.${axis} bounds invalid`);
      const values = new Set(combos.map((c) => c[axis]));
      assert.ok(values.size <= 5, `${id}.${axis} must be a small bounded set (got ${values.size})`);
      for (const c of combos) assert.ok(c[axis] >= lo && c[axis] <= hi, `${id}.${axis} value out of bounds`);
    }
    assert.ok(C.gridContainsControl(spec, id), `${id} grid must contain CONTROL`);
    assert.equal(C.gridAxesKey(spec, id, C.CONTROL_PARAMS[id]), C.gridAxesKey(spec, id, control.params[id]));
  }
});

// ---- 5. strategy semantic preservation --------------------------------------
test("5 calibration never changes a strategy's kind or its risk geometry", () => {
  const bearish = { closes: Array.from({ length: 400 }, (_, i) => 300 - i * 0.5), price: 100, rsi: 30, mom: -5 };
  const bullish = { closes: Array.from({ length: 400 }, (_, i) => 100 + i * 0.5), price: 300, rsi: 40, mom: 5 };
  for (const id of C.STRATEGY_IDS) {
    for (const gridParams of C.enumerateGrid(spec, id)) {
      const params = C.mergeWithControl(id, gridParams);
      for (const frozen of ["baseLev", "stopPct", "targetPct", "confLong", "confShort", "conf"]) {
        if (S.CONTROL_PARAMS[id][frozen] !== undefined) {
          assert.equal(params[frozen], S.CONTROL_PARAMS[id][frozen], `${id}.${frozen} must stay frozen`);
        }
      }
      if (id === "mom_trend") {
        const s = S.sigMomTrend(bullish, null, 0, params);
        assert.notEqual(s?.side, "short", "mom_trend must never go short (docs/09)");
        assert.ok(s === null || s.side === "long");
      }
      if (id === "donchian") {
        const c = Array.from({ length: 60 }, (_, i) => (i === 59 ? 100 : 200));
        const s = S.sigDonchian({ closes: c, price: 100 }, null, 0, params);
        assert.equal(s?.side, "short", "donchian must stay a breakout strategy (short on breakdown)");
        assert.match(s.reason, /low breakdown/);
      }
      if (id === "tsmom") {
        const s = S.sigTsmom(bearish, null, 0, params);
        assert.equal(s?.side, "short", "tsmom must stay trend-following (short when the trend is down)");
      }
      if (id === "rsi2dip") {
        const c = Array.from({ length: 300 }, (_, i) => (i === 299 ? 90 : 200));
        const s = S.sigRsi2dip({ closes: c, price: 300, rsi: 50 }, null, 0, params);
        assert.ok(s === null || s.side === "long", "rsi2dip stays short-horizon mean reversion");
      }
    }
  }
  assert.deepEqual(S.SEEDS.find((x) => x.id === "orb").markets, ["us"]);
  assert.deepEqual(S.SEEDS.find((x) => x.id === "ibreakout").markets, ["crypto"]);
});

// ---- 6. no future leakage ---------------------------------------------------
test("6 decisions never see future bars, same-day daily closes or future outcomes", { skip: !realPanels }, () => {
  const panel = C.loadRealPanel("hour");
  const daily = C.loadRealPanel("daily");
  const symbol = "BTC-USD";
  const rows = panel.symbols[symbol];
  const K = Math.floor(rows.ts.length * 0.5);
  const params = C.paramsFor(control, "tsmom");
  const runA = C.evaluateStrategy({ id: "tsmom", params, symbol, market: "crypto", rows, daily, panelName: "hour" });
  const mutated = {
    ...rows,
    open: rows.open.map((v, i) => (i > K ? v * 1.2 : v)),
    high: rows.high.map((v, i) => (i > K ? v * 1.4 : v)),
    low: rows.low.map((v, i) => (i > K ? v * 0.6 : v)),
    close: rows.close.map((v, i) => (i > K ? v * 3 : v)),
  };
  const runB = C.evaluateStrategy({ id: "tsmom", params, symbol, market: "crypto", rows: mutated, daily, panelName: "hour" });
  const upToK = (r) => r.signals.filter((s) => s.i <= K).map((s) => [s.i, s.side, s.ts, s.confidence]);
  assert.deepEqual(upToK(runB), upToK(runA), "mutating future bars must not change past decisions");
  const day = C.utcDate(rows.ts[K]);
  const dailyRows = { ts: [Date.parse(`${day}T00:00:00Z`) - 86400000, Date.parse(`${day}T00:00:00Z`)], close: [50, 9999] };
  assert.deepEqual(C.dailyContextAt(dailyRows, rows.ts[K], 123), [50, 123], "same-day daily close must never appear in the context");
  const cand = { ...runA.signals[10], config: "control", panel: "hour", tradeId: "t", market: "crypto", trendContext: "trend_up" };
  const resolved = C.resolveCandidate({ cand, rows: mutated, cfg, spec });
  assert.ok(resolved.exitTs == null || resolved.exitTs > cand.ts, "resolution may only consume post-decision bars");
});

// ---- 7. chronological train/validation/test ---------------------------------
test("7 folds are chronological and never overlap", () => {
  const b = C.splitBounds(100, spec.splits.hour);
  assert.deepEqual(b.train, [0, 60]);
  assert.deepEqual(b.validation, [60, 80]);
  assert.deepEqual(b.test, [80, 100]);
  assert.ok(b.train[1] === b.validation[0] && b.validation[1] === b.test[0], "folds must be contiguous");
  if (realPanels) {
    const panel = C.loadRealPanel("hour");
    const symbols = C.panelSymbols(panel);
    const bounds = C.foldBoundsBySymbol(symbols, panel, spec.splits.hour);
    for (const sym of symbols) {
      const ts = panel.symbols[sym].ts;
      const bb = bounds[sym];
      const lastTrain = ts[bb.train[1] - 1], firstVal = ts[bb.validation[0]];
      const lastVal = ts[bb.validation[1] - 1], firstTest = ts[bb.test[0]];
      assert.ok(lastTrain < firstVal, `${sym}: train must precede validation`);
      assert.ok(lastVal < firstTest, `${sym}: validation must precede test`);
    }
  }
});

// ---- 8. no test contamination ------------------------------------------------
test("8 selection reads TRAIN + VALIDATION only; TEST can never influence it", () => {
  const val = (sig, resolved, meanR) => ({ signals: new Array(sig).fill(0), outcomes: { resolved, meanR } });
  const mk = (key, trainSignals, trainScoreVal, valSig, valRes, valMeanR, testSignals) => ({
    key, params: { axis: key }, minTrainCandidates: 10, trainSignals,
    train: { signals: new Array(trainSignals).fill(0) },
    validation: val(valSig, valRes, valMeanR),
    test: { signals: new Array(testSignals).fill(0) },
    score: { score: trainScoreVal },
  });
  const candidates = [
    mk("a", 100, 0.90, 50, 30, 0.10, 1),
    mk("b", 100, 0.50, 50, 30, 0.10, 999999), // huge TEST count must not promote it
    mk("control", 100, 0.40, 50, 30, 0.10, 999999),
  ];
  const controlKey = "control";
  const first = R.rankConfigs(candidates, controlKey);
  assert.equal(first.winner.key, "a");
  // poisoning TEST does not change the winner
  const poisoned = candidates.map((c) => ({ ...c, test: { signals: new Array(0).fill(0) } }));
  const second = R.rankConfigs(poisoned, controlKey);
  assert.equal(second.winner.key, "a");
  const gate = R.validationGate({
    winnerKey: "a", controlKey, winner: first.winner, winnerVal: first.winner.validation,
    winnerScore: first.winner.score, ctlVal: candidates[2].validation, ctlScore: { score: 0.40 },
    controlParams: { axis: "control" }, spec,
  });
  assert.equal(gate.chosen, "CALIBRATED");
  // a winner that halves validation availability is rejected
  const weak = R.validationGate({
    winnerKey: "a", controlKey,
    winner: { ...first.winner, validation: val(10, 30, 0.10) },
    winnerVal: val(10, 30, 0.10), winnerScore: { score: 0.99 },
    ctlVal: val(50, 30, 0.10), ctlScore: { score: 0.40 },
    controlParams: { axis: "control" }, spec,
  });
  assert.equal(weak.chosen, "CONTROL");
  assert.match(weak.reason, /validation gate rejected/);
  // the persisted selection records must not carry TEST-derived evidence
  const resultsPath = path.join(C.REAL_CAL_DIR, "calibration-results.v2.jsonl");
  if (fs.existsSync(resultsPath)) {
    for (const line of fs.readFileSync(resultsPath, "utf8").split("\n").filter(Boolean)) {
      const rec = JSON.parse(line);
      if (rec.kind !== "selection") continue;
      assert.doesNotMatch(rec.reason, /\btest\b/i, "selection reason must not cite TEST");
      for (const g of rec.gateDetail || []) assert.doesNotMatch(g, /\btest\b/i);
    }
  }
});

// ---- 9. candidate frequency calculation -------------------------------------
test("9 frequency metrics are computed from observations only", () => {
  const sig = (symbol, i, side = "long") => ({ symbol, i, side, ts: i * 1000, trendContext: "trend_up", strategy_id: "s" });
  const signals = [sig("A", 1), sig("A", 2), sig("A", 3), sig("A", 7), sig("B", 1, "short")];
  const f = M.frequencyStats({ signals, evaluations: 100, symbols: 2 });
  assert.equal(f.signals, 5);
  assert.equal(f.candidateRate, 0.05);
  assert.deepEqual(f.perSymbol, { A: 4, B: 1 });
  assert.deepEqual(f.perSide, { long: 4, short: 1 });
  assert.equal(f.symbolsCovered, 2);
  assert.equal(f.maxConsecutiveFiring, 3, "A fires at 1,2,3 => run of 3");
  assert.ok(f.meanBarsBetweenSignals > 0);
  // no observations => null rate, never invented
  const empty = M.frequencyStats({ signals: [], evaluations: 0, symbols: 3 });
  assert.equal(empty.candidateRate, null);
  assert.equal(empty.signals, 0);
});

// ---- 10. cohort calculation --------------------------------------------------
test("10 cohorts require the same symbol, same bar and >=2 distinct strategies", () => {
  const s = (symbol, ts, strategy_id, side = "long") => ({ symbol, ts, i: 1, strategy_id, side, confidence: 0.5, trendContext: "trend_up" });
  const byStrategy = {
    tsmom: { signals: [s("BTC-USD", 100, "tsmom"), s("ETH-USD", 100, "tsmom")] },
    donchian: { signals: [s("BTC-USD", 100, "donchian"), s("BTC-USD", 200, "donchian")] },
    rsi2dip: { signals: [s("BTC-USD", 100, "rsi2dip"), s("BTC-USD", 100, "rsi2dip")] }, // same strategy twice = still 1 distinct
  };
  const cohorts = M.buildCohorts(byStrategy);
  assert.equal(cohorts.length, 1, "only the BTC-USD/ts=100 bar has >=2 distinct strategies");
  assert.equal(new Set(cohorts[0].members.map((m) => m.strategy_id)).size, 3);
  const summary = M.summarizeCohorts(cohorts, 3);
  assert.equal(summary.cohorts, 1);
  assert.equal(summary.threeWay, 1);
  assert.equal(summary.maxWidth, 3);
  assert.equal(summary.coFireRate, 1 / 3);
  assert.equal(M.summarizeCohorts([], 0).coFireRate, null, "no bars => INSUFFICIENT, not zero");
});

// ---- 11. control/calibrated dataset separation -------------------------------
test("11 CONTROL and CALIBRATED datasets are separate; live paths are unreachable", async () => {
  assert.notEqual(C.datasetPath("control"), C.datasetPath("calibrated"));
  const { V2 } = await import("../scripts/v2/store.mjs");
  for (const livePath of [V2.shadowTrades, V2.shadowOpen, V2.contextLearning, V2.learnDecisions, V2.candidates, V2.journal, V2.trades]) {
    assert.throws(() => C.assertCalibrationPath(livePath), /escapes/, `${livePath} must not be writable by calibration`);
  }
  assert.equal(C.assertCalibrationPath(C.datasetPath("control")), path.resolve(C.datasetPath("control")));
  if (realPanels) {
    const panel = C.loadRealPanel("quarter");
    const run = C.runStrategyOverPanel({
      id: "ibreakout", params: C.paramsFor(control, "ibreakout"), cfg,
      panel, dailyPanel: C.loadRealPanel("daily"), panelName: "quarter", symbols: ["BTC-USD"],
    });
    const rows = C.resolveAll(C.candidatesFrom(run.signals.slice(0, 3), { configName: "control", panelName: "quarter" }), run, cfg, spec, {});
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.config === "control" && r.offline === true));
    for (const livePath of [V2.shadowTrades, V2.shadowOpen, V2.contextLearning, V2.learnDecisions, V2.journal, V2.state]) {
      assert.equal(fs.existsSync(livePath), false, `${livePath} must not be created by calibration`);
    }
  }
});

// ---- 12. shadow separation + determinism -------------------------------------
test("12 offline shadow resolution is deterministic, causal and cost-inclusive", () => {
  const cand = {
    symbol: "X", market: "crypto", side: "long", price: 100, i: 0, ts: 1_000_000,
    confidence: 0.6, baseLev: 2, stopPct: 0.05, targetPct: 0.1, strategy_id: "tsmom",
    config: "control", panel: "test", tradeId: "t1", trendContext: "trend_up",
  };
  const rows = {
    ts: [1_000_000, 1_360_000, 1_720_000], open: [100, 100, 100],
    high: [100, 100, 100], low: [100, 100, 100], close: [100, 99, 105],
  };
  const a = C.resolveCandidate({ cand, rows, cfg, spec });
  const b = C.resolveCandidate({ cand, rows, cfg, spec });
  assert.deepEqual(a, b, "identical input must give identical output");
  assert.equal(a.offline, true);
  assert.equal(a.funding, "OMITTED_NO_HISTORICAL_RATE");
  assert.ok(a.fees > 0, "costs are included in net R");
  const both = { ts: [1_000_000, 1_360_000], open: [100, 100], high: [100, 130], low: [100, 80], close: [100, 100] };
  const r = C.resolveCandidate({ cand, rows: both, cfg, spec });
  assert.equal(r.exit_reason, "stop-loss", "stop must win when both levels are touched in one bar");
  assert.ok(r.realized_R < 0);
  const tgt = { ts: [1_000_000, 1_360_000], open: [100, 100], high: [100, 200], low: [100, 100], close: [100, 100] };
  const rt = C.resolveCandidate({ cand, rows: tgt, cfg, spec });
  assert.equal(rt.exit_reason, "take-profit");
  assert.ok(rt.exit <= 110 + 1e-9, "target fill must not exceed the target level");
  // live exit ORDER is preserved: at high leverage the liquidation price sits
  // ABOVE the 5% price stop, so liquidation must win (docs/10 known issue)
  const hi = C.resolveCandidate({ cand: { ...cand, baseLev: 20 }, rows: both, cfg, spec });
  assert.equal(hi.exit_reason, "liquidation", "liquidation precedes the stop, exactly as in the engine");
  assert.equal(fs.existsSync(path.join(process.env.FAB_DATA, "shadow-trades.v2.jsonl")), false);
});

// ---- 13. no learner contamination --------------------------------------------
test("13 learner A/B uses an empty store and never writes the live learner", async () => {
  const { emptyLearning, saveLearning, loadLearning } = await import("../scripts/v2/learning.mjs");
  const live = emptyLearning();
  live.cells["broad_up|long|tsmom"] = { n: 7, wins: 4, losses: 3, sumR: 1.2, sumR2: 0.9 };
  saveLearning(live);
  const before = JSON.stringify(loadLearning());
  const MK = (ts, strategy_id, R) => ({ strategy_id, side: "long", trendContext: "trend_up", confidence: 0.5, realized_R: R, exitTs: ts + 60_000, symbol: "S" });
  const cohorts = Array.from({ length: 6 }, (_, k) => ({
    ts: 1_000_000 + k * 600_000, symbol: "S",
    members: [MK(1_000_000 + k * 600_000, "tsmom", 0.5), MK(1_000_000 + k * 600_000, "donchian", -0.5)],
  }));
  const ab = M.learnerAB({ cohorts, L, minCohorts: 3 });
  assert.equal(ab.ran, true);
  assert.equal(ab.cohorts, 6);
  assert.ok(ab.learningCells > 0, "the A/B learner keeps its own in-memory cells");
  assert.equal(JSON.stringify(loadLearning()), before, "the live learner store must be untouched");
  const small = M.learnerAB({ cohorts: cohorts.slice(0, 1), L, minCohorts: 20 });
  assert.equal(small.ran, false, "insufficient cohorts => NOT RUN");
  assert.match(small.reason, /< required/);
});

// ---- 14. deterministic repeated calibration ----------------------------------
test("14 repeated calibration on identical panels is bit-identical", { skip: !realPanels }, () => {
  const panel = C.loadRealPanel("quarter");
  const daily = C.loadRealPanel("daily");
  const foldBySymbol = C.foldBoundsBySymbol(C.panelSymbols(panel), panel, spec.splits.quarter);
  const once = () => {
    const run = C.runStrategyOverPanel({
      id: "ibreakout", params: C.paramsFor(control, "ibreakout"), cfg,
      panel, dailyPanel: daily, panelName: "quarter", symbols: ["BTC-USD", "ETH-USD"], foldBySymbol,
    });
    const rows = C.resolveAll(C.candidatesFrom(run.signals, { configName: "control", panelName: "quarter" }), run, cfg, spec, foldBySymbol);
    return { signals: run.signals, rows, outcomes: M.outcomeStats(rows, 8) };
  };
  const a = once(), b = once();
  assert.equal(JSON.stringify(a.signals), JSON.stringify(b.signals));
  assert.equal(JSON.stringify(a.rows), JSON.stringify(b.rows));
  assert.equal(JSON.stringify(a.outcomes), JSON.stringify(b.outcomes));
});

// ---- 15. survival gate unchanged ---------------------------------------------
test("15 risk controls and the survival gate are untouched by calibration", () => {
  // the survival gate still blocks entries when the account is underwater
  assert.deepEqual(survivalGate({ survival: { enabled: true }, goal: { startEquity: 100 }, equity: 99 }),
    { blocked: true, reason: "survival: underwater — no new risk until back above start", maxLev: 0 });
  assert.equal(survivalGate({ survival: { enabled: true }, goal: { startEquity: 100 }, equity: 100 }).maxLev, 5);
  assert.deepEqual(survivalGate({ survival: { enabled: false }, equity: 1 }), { blocked: false, maxLev: Infinity });
  // no calibration module may reference or call the risk layer
  const dir = path.join(ROOT, "scripts", "v2");
  for (const f of ["calibration.mjs", "calibration-run.mjs", "calibration-metrics.mjs", "calibration-probes.mjs", "calibration-search.mjs", "calibration-shadow.mjs", "calibration-compare.mjs", "strategy-frequency-analysis.mjs"]) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /from "\.\/controls\.mjs"/, `${f} must not import the risk layer`);
    assert.doesNotMatch(src, /survivalGate|consumeCommands/, `${f} must not call survival/command controls`);
    assert.doesNotMatch(src, /state\.equity|walletBalance/, `${f} must not touch live account state`);
    assert.doesNotMatch(src, /V2\.shadowOpen|V2\.shadowTrades|V2\.contextLearning|V2\.learnDecisions/, `${f} must not reference live shadow/learner files`);
  }
  // the risk configuration in config.json is unchanged by this phase
  const cfgFile = readJSON(path.join(ROOT, "config.json"), null);
  assert.deepEqual(cfgFile.risk.stopLoss, { crypto: 0.09, us: 0.06, india: 0.06 });
  assert.deepEqual(cfgFile.risk.takeProfit, { crypto: 0.25, us: 0.16, india: 0.16 });
  assert.equal(cfgFile.v2.leverage.crypto.maxLeverage, 40);
});

// ---- 16. insufficient-data handling ------------------------------------------
test("16 missing evidence is INSUFFICIENT, never zero", async () => {
  const empty = M.outcomeStats([], 8);
  assert.equal(empty.resolved, 0);
  assert.equal(empty.sufficient, false);
  assert.equal(empty.meanR, null, "no resolved trades => null mean, not 0");
  assert.equal(empty.winRate, null);
  const thin = M.outcomeStats([
    { resolved: true, realized_R: 1, decisionTs: 1, exitTs: 2, mae_roi: -0.1, mfe_roi: 0.2, fees: 0.5, exit_reason: "take-profit", side: "long", trendContext: "trend_up", strategy_id: "s", symbol: "X" },
  ], 8);
  assert.equal(thin.sufficient, false);
  const scored = M.selectionScore({
    frequency: { candidateRate: 0.05, symbolsCovered: 3, perSide: { long: 1 }, perTrend: { trend_up: 1 } },
    outcomes: thin, symbolsAvailable: 3, coFireRate: 0.5, controlCoFireRate: 0.5, stability: 1,
  }, spec);
  assert.equal(scored.components.qualitySource, "neutral-thin-sample", "thin samples must not be rewarded");
  assert.equal(scored.components.quality, spec.objective.qualityNeutral);
  // probes never fabricate a signal; a zero-evaluation strategy is reported as C
  const cls = (await import("../scripts/v2/calibration-probes.mjs"));
  const c = cls.classifyStarvation({
    id: "rsi2dip", signalCount: 0, evaluations: 0, notApplicable: 500,
    probe: cls.newProbe(), perSide: {}, applicableSymbols: 3, symbolsFired: 0,
    panelName: "hour", expectedPanel: "hour", acceptedPanels: ["hour"],
  });
  assert.equal(c.code, "C");
  assert.match(c.evidence, /warmup/);
});

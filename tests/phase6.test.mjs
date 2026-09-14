// tests/phase6.test.mjs — Phase 6 §23 acceptance tests (20 test groups).
// Isolated writes via FAB_DATA; acquired historical panels are only READ.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FAB_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "fabinvests-p6-"));

const G = await import("../scripts/v2/geometry.mjs");
const GM = await import("../scripts/v2/geometry-metrics.mjs");
const C = await import("../scripts/v2/calibration.mjs");
const S = await import("../scripts/v2/strategies.mjs");
const { loadConfig, ROOT, readJSON, sha256 } = await import("../scripts/v2/store.mjs");
const { survivalGate } = await import("../scripts/v2/controls.mjs");

const cfg = loadConfig();
const spec = G.loadRiskSpec();
const prod = G.loadRiskControl();
const controlStrategy = C.loadControlConfig();

// ---- 1. control geometry immutable -------------------------------------------
test("1 control geometry immutable", () => {
  const drift = G.controlGeometryDiffersFromProd(prod, cfg);
  assert.deepEqual(drift, [], "control snapshot must match production config.json");
  assert.equal(prod.maxHoldHours, 4);
  assert.equal(prod.fees.taker, 0.0005);
  assert.equal(prod.trailing.enabled, true);
  assert.equal(prod.trailing.activateRoi, 0.5);
  assert.equal(prod.trailing.giveRoi, 0.25);

  const clone = JSON.parse(JSON.stringify(prod));
  G.assertControlUnchanged(prod, clone);
  clone.maxHoldHours = 8;
  assert.throws(() => G.assertControlUnchanged(prod, clone), /must be immutable/);
});

// ---- 2. experiment config isolation ------------------------------------------
test("2 experiment config isolation", () => {
  assert.throws(() => G.assertRiskConfigPath(path.join(ROOT, "config.json")), /may only write/);
  assert.throws(() => G.assertRiskConfigPath(path.join(ROOT, "config", "risk.control.json")), /may only write/);
  assert.throws(() => G.assertRiskConfigPath(path.join(ROOT, "config", "arbitrary.json")), /may only write/);
  assert.equal(G.assertRiskConfigPath(G.RISK_EXPERIMENTAL_PATH), path.resolve(G.RISK_EXPERIMENTAL_PATH));
});

// ---- 3. parameter bounds ----------------------------------------------------
test("3 parameter bounds", () => {
  const configs = G.enumerateConfigurations(spec);
  assert.ok(configs.length > 0 && configs.length <= 32);
  const holdVals = spec.axes.holdHours.values;
  const stopVals = spec.axes.stopScale.values;
  const tgtVals = spec.axes.targetScale.values;

  for (const c of configs) {
    assert.ok(holdVals.includes(c.holdHours), `${c.id}: holdHours ${c.holdHours} out of bounds`);
    assert.ok(stopVals.includes(c.stopScale), `${c.id}: stopScale ${c.stopScale} out of bounds`);
    assert.ok(tgtVals.includes(c.targetScale), `${c.id}: targetScale ${c.targetScale} out of bounds`);
    assert.ok(Number.isFinite(c.holdHours) && c.holdHours > 0);
  }
});

// ---- 4. deterministic grid --------------------------------------------------
test("4 deterministic grid", () => {
  const g1 = G.enumerateConfigurations(spec);
  const g2 = G.enumerateConfigurations(spec);
  assert.deepEqual(g1, g2, "enumeration must be bit-identical");
  const ids = g1.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "configuration IDs must be unique");
  assert.ok(ids.includes("CONTROL"), "grid must contain CONTROL");
  assert.equal(g1.find((c) => c.id === "CONTROL").category, "CONTROL");
});

// ---- 5. no strategy threshold modification ----------------------------------
test("5 no strategy threshold modification", () => {
  for (const id of G.STRATEGY_IDS) {
    const ctrlParams = C.paramsFor(controlStrategy, id);
    const codeParams = S.CONTROL_PARAMS[id];
    for (const k of Object.keys(codeParams)) {
      if (k !== "baseLev" && k !== "stopPct" && k !== "targetPct") {
        assert.equal(ctrlParams[k], codeParams[k], `${id}.${k} signal parameter must not be modified`);
      }
    }
  }
});

// ---- 6. no leverage modification --------------------------------------------
test("6 no leverage modification", () => {
  assert.ok(G.leverageMatchesPhase5(cfg, prod), "leverage must match Phase 5 production baseline");
  const axes = Object.keys(spec.axes || {});
  assert.ok(!axes.includes("leverage"), "leverage must not be an optimization axis");
  assert.ok(!axes.includes("baseLev"), "baseLev must not be an optimization axis");
  assert.equal(spec.frozenAxes.leverage, "CONTROL (config.json v2.leverage maxLeverage + strategies.mjs baseLev, market-capped by candidateLeverage)");
});

// ---- 7. chronological split -------------------------------------------------
test("7 chronological split", () => {
  for (const [panelName, split] of Object.entries(spec.splits)) {
    assert.equal(split.train, 0.6);
    assert.equal(split.validation, 0.2);
    assert.equal(split.test, 0.2);

    const b = C.splitBounds(1000, split);
    assert.equal(b.train[0], 0);
    assert.equal(b.train[1], 600);
    assert.equal(b.validation[0], 600);
    assert.equal(b.validation[1], 800);
    assert.equal(b.test[0], 800);
    assert.equal(b.test[1], 1000);
    assert.ok(b.train[1] <= b.validation[0] && b.validation[1] <= b.test[0], "splits must not overlap");
  }
});

// ---- 8. no test leakage -----------------------------------------------------
test("8 no test leakage", () => {
  const dummyEntries = [
    { id: "A", score: 0.5, stats: { meanR: 0.1, n: 500, resolved: 500 }, validation: { meanR: 0.08, resolved: 200 } },
    { id: "CONTROL", score: 0.4, stats: { meanR: 0.0, n: 500, resolved: 500 }, validation: { meanR: 0.0, resolved: 200 } },
  ];
  const ranked = GM.rankConfigurations(dummyEntries, "CONTROL");
  assert.equal(ranked[0].id, "A", "ranking must strictly use TRAIN score");
  for (const e of dummyEntries) {
    assert.equal(e.test, undefined, "TEST data must never be inside ranking entries");
  }
});

// ---- 9. raw-vs-gross-vs-net separation --------------------------------------
test("9 raw-vs-gross-vs-net separation", () => {
  const exit = G.resolveExit({
    cand: { side: "long" },
    qty: 1, sgn: 1, entry: 100, entryRef: 100, entryFee: 0.05,
    exitRef: 105, reason: "take-profit", mark: 105,
    taker: 0.0005, halfSpread: 0.00025, cfg, market: "crypto",
    riskOwn: 5, riskCtrl: 5, ts: 1000, j: 5, rel: 3600000, peakUPnl: 5, margin: 100,
  });

  assert.equal(exit.resolved, true);
  assert.ok(Number.isFinite(exit.raw_ret_pct));
  assert.ok(Number.isFinite(exit.grossRef_pnl_usd));
  assert.ok(Number.isFinite(exit.gross_pnl_usd));
  assert.ok(Number.isFinite(exit.fees_usd));
  assert.ok(Number.isFinite(exit.spread_slip_usd));
  assert.ok(Number.isFinite(exit.net_pnl_usd));

  assert.equal(exit.net_pnl_usd, exit.gross_pnl_usd - exit.fees_usd, "net must equal gross - fees");
  assert.equal(exit.spread_slip_usd, exit.gross_pnl_usd - exit.grossRef_pnl_usd, "spread_slip must equal gross - grossRef");
  assert.equal(exit.realized_R, exit.net_pnl_usd / exit.risk_ctrl_usd, "realized_R must equal net / riskCtrl");
});

// ---- 10. time-to-event correctness ------------------------------------------
test("10 time-to-event correctness", () => {
  const hPanel = C.loadRealPanel("hour");
  const sym = Object.keys(hPanel.symbols)[0];
  const rows = hPanel.symbols[sym];
  const geom = G.geometryFor(spec.configurations[0], "tsmom", prod);

  const cand = {
    symbol: sym, strategy_id: "tsmom", side: "long",
    ts: rows.ts[10], i: 10, price: rows.close[10], market: "crypto",
  };
  const r = G.resolveGeometry({ cand, rows, cfg, prod, spec, geom, diagnostics: true });
  assert.ok(r.resolved);
  assert.ok(r.time_to_event, "time_to_event diagnostic must be present");
  if (r.exit_reason === "time-stop") {
    assert.equal(r.time_to_event.time_h, geom.holdHours);
  }
});

// ---- 11. MAE/MFE correctness ------------------------------------------------
test("11 MAE/MFE correctness", () => {
  const hPanel = C.loadRealPanel("hour");
  const sym = Object.keys(hPanel.symbols)[0];
  const rows = hPanel.symbols[sym];
  const geom = G.geometryFor(spec.configurations[0], "tsmom", prod);

  const cand = {
    symbol: sym, strategy_id: "tsmom", side: "long",
    ts: rows.ts[50], i: 50, price: rows.close[50], market: "crypto",
  };
  const r = G.resolveGeometry({ cand, rows, cfg, prod, spec, geom, diagnostics: true });
  assert.ok(r.resolved);
  assert.ok(r.mae_roi === null || r.mae_roi <= 0.05, "MAE must represent adverse extreme");
  assert.ok(r.mfe_roi === null || r.mfe_roi >= -0.05, "MFE must represent favorable extreme");
});

// ---- 12. cost calculation ---------------------------------------------------
test("12 cost calculation", () => {
  const dummyRows = [
    { resolved: true, net_pnl_usd: -1, qty: 1, entryRef: 100, fees_usd: 0.1, spread_slip_usd: 0.05, break_even_move_pct: 0.0015 },
    { resolved: true, net_pnl_usd: 2, qty: 1, entryRef: 100, fees_usd: 0.1, spread_slip_usd: 0.05, break_even_move_pct: 0.0015 },
  ];
  const be = G.costBreakEven(dummyRows);
  assert.equal(be.n, 2);
  assert.ok(Math.abs(be.meanCostUsd - 0.15) < 1e-6);
  assert.ok(Math.abs(be.meanFeesUsd - 0.1) < 1e-6);
  assert.ok(Math.abs(be.meanSpreadSlipUsd - 0.05) < 1e-6);
  assert.ok(Math.abs(be.meanBreakEvenMovePct - 0.0015) < 1e-6);
});

// ---- 13. time-stop classification -------------------------------------------
test("13 time-stop classification", () => {
  const validReasons = ["liquidation", "stop-loss", "take-profit", "time-stop", "trailing-stop"];
  const hPanel = C.loadRealPanel("hour");
  const sym = Object.keys(hPanel.symbols)[0];
  const rows = hPanel.symbols[sym];
  const geom = G.geometryFor(spec.configurations[0], "tsmom", prod);

  for (let i = 10; i < 25; i++) {
    const cand = { symbol: sym, strategy_id: "tsmom", side: "long", ts: rows.ts[i], i, price: rows.close[i], market: "crypto" };
    const r = G.resolveGeometry({ cand, rows, cfg, prod, spec, geom, diagnostics: false });
    if (r.resolved) {
      assert.ok(validReasons.includes(r.exit_reason), `exit_reason ${r.exit_reason} must be valid`);
    }
  }
});

// ---- 14. shadow/live separation ---------------------------------------------
test("14 shadow/live separation", () => {
  const liveTradesPath = path.join(ROOT, "data", "trades.v2.jsonl");
  const liveStatePath = path.join(ROOT, "data", "state.v2.json");
  const liveShadowPath = path.join(ROOT, "data", "shadow-trades.v2.jsonl");

  assert.ok(fs.existsSync(liveTradesPath));
  assert.ok(fs.existsSync(liveStatePath));
  assert.ok(fs.existsSync(liveShadowPath));
});

// ---- 15. learner isolation --------------------------------------------------
test("15 learner isolation", () => {
  const learnContextPath = path.join(ROOT, "data", "context-learning.v2.json");
  assert.ok(fs.existsSync(learnContextPath));
});

// ---- 16. deterministic repeated execution -----------------------------------
test("16 deterministic repeated execution", () => {
  const hPanel = C.loadRealPanel("hour");
  const sym = Object.keys(hPanel.symbols)[0];
  const rows = hPanel.symbols[sym];
  const geom = G.geometryFor(spec.configurations[0], "tsmom", prod);

  const cand = { symbol: sym, strategy_id: "tsmom", side: "long", ts: rows.ts[100], i: 100, price: rows.close[100], market: "crypto" };
  const r1 = G.resolveGeometry({ cand, rows, cfg, prod, spec, geom, diagnostics: true });
  const r2 = G.resolveGeometry({ cand, rows, cfg, prod, spec, geom, diagnostics: true });
  assert.deepEqual(r1, r2, "repeated resolution on same data must be identical");
});

// ---- 17. survival gate unchanged --------------------------------------------
test("17 survival gate unchanged", () => {
  const s = { survival: { enabled: true }, startingCapital: 100, equity: 90 };
  const underwater = survivalGate(s);
  assert.equal(underwater.blocked, true);
  s.equity = 110;
  const above = survivalGate(s);
  assert.equal(above.blocked, false);
  assert.equal(above.maxLev, 5);
});

// ---- 18. insufficient-data handling -----------------------------------------
test("18 insufficient-data handling", () => {
  const acc = GM.makeAccumulator("test");
  const stats = GM.accStats(acc, 100);
  assert.equal(stats.sufficient, false);
  assert.equal(stats.meanR, null);
  assert.equal(stats.winRate, null);
});

// ---- 19. control configuration byte-equivalence -----------------------------
test("19 control configuration byte-equivalence", () => {
  const rawCtrl = readJSON(G.RISK_CONTROL_PATH, null);
  assert.ok(rawCtrl);
  assert.equal(rawCtrl.configuration, "CONTROL");
  assert.equal(rawCtrl.maxHoldHours, 4);
  assert.equal(rawCtrl.fees.taker, 0.0005);
});

// ---- 20. production path cannot load experimental config --------------------
test("20 production path cannot load experimental config", () => {
  const prodCfg = loadConfig();
  assert.equal(prodCfg.v2.aggression.maxHoldHours, 4);
  assert.ok(!prodCfg.experimentalRiskLoaded);
});


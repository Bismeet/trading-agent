// scripts/v2/geometry.mjs — Phase 6 §1..§11: risk/reward geometry experiment core.
//
// This module is the OFFLINE half of Phase 6. It never touches the live engine,
// config.json, the survival gate, the learner or any live shadow file. It reads:
//   config/risk-experiment-spec.v1.json   (pre-registered axis list, gates, objective)
//   config/risk.control.json              (frozen production geometry snapshot)
// The ONLY file it may write is config/risk.experimental.json (guarded).
//
// Core responsibilities:
//   1. load + validate the pre-registered spec (no ranges/weights live in JS)
//   2. enumerate the finite, explicitly listed geometry list deterministically
//   3. scale each strategy's OWN CONTROL stop/target (strategy semantics preserved)
//   4. resolve a candidate under a geometry with RAW / GROSS / NET separation,
//      reusing perp.mjs for every cost and liquidation primitive
//   5. measure MAE/MFE, time-to-event and fixed-horizon excursions (diagnostics)
import fs from "node:fs";
import path from "node:path";
import { ROOT, DATA, readJSON, writeJSON, iso, sha256, mean, stdev, profitFactor } from "./store.mjs";
import {
  sideSign, sizeFromMargin, tierFor, liqPrice, isLiquidated, markPosition, emaUpdate,
  tradeFee, slippageFraction, fillPrice, openPosition,
} from "./perp.mjs";
import { CONTROL_PARAMS } from "./strategies.mjs";
import { CAL_DIR, ensureCalDir, readCalJSONL, appendCalJSONL, writeCalJSON, loadControlConfig } from "./calibration.mjs";

export const RISK_SPEC_PATH = path.join(ROOT, "config", "risk-experiment-spec.v1.json");
export const RISK_CONTROL_PATH = path.join(ROOT, "config", "risk.control.json");
export const RISK_EXPERIMENTAL_PATH = path.join(ROOT, "config", "risk.experimental.json");
export const GEOM_RESULTS_PATH = path.join(CAL_DIR, "geometry-results.v2.jsonl");
export const GEOM_DATASET_PATH = path.join(CAL_DIR, "geometry-dataset.v2.jsonl");
export const GEOM_DIAG_PATH = path.join(CAL_DIR, "geometry-diagnostics.v2.json");
export const GEOM_SUMMARY_PATH = path.join(CAL_DIR, "geometry-summary.v2.json");
export const STRATEGY_IDS = ["tsmom", "donchian", "rsi2dip", "mom_trend", "orb", "ibreakout"];

// ---- spec / control IO -------------------------------------------------------
export function loadRiskSpec(p = RISK_SPEC_PATH) {
  const spec = readJSON(p, null);
  if (!spec) throw new Error(`risk experiment spec missing or unreadable at ${p}`);
  return spec;
}
export function loadRiskControl(p = RISK_CONTROL_PATH) {
  const c = readJSON(p, null);
  if (!c) throw new Error(`CONTROL risk snapshot missing or unreadable at ${p}`);
  return c;
}
export const riskSpecHash = (spec) => sha256(JSON.stringify(spec));

export function assertRiskConfigPath(p) {
  const abs = path.resolve(p);
  if (abs !== path.resolve(RISK_EXPERIMENTAL_PATH))
    throw new Error("geometry module may only write config/risk.experimental.json (CONTROL and production files are read-only)");
  return abs;
}
export function writeRiskConfigJSON(p, obj) {
  fs.mkdirSync(path.dirname(assertRiskConfigPath(p)), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}
// The CONTROL snapshot must always describe the same geometry as production code
// + config.json. Any drift is a hard error (Phase 6 §1).
export function controlGeometryDiffersFromProd(prod = loadRiskControl(), cfg = null, code = CONTROL_PARAMS) {
  const out = [];
  for (const id of STRATEGY_IDS) {
    const p = prod.perStrategyGeometry?.[id];
    const c = code[id];
    if (!p) { out.push(`${id}: missing from risk.control.json`); continue; }
    for (const k of ["baseLev", "stopPct", "targetPct"]) {
      if (p[k] !== c[k]) out.push(`${id}.${k}: control=${p[k]} code=${c[k]}`);
    }
  }
  return out;
}
export function assertControlUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("CONTROL risk geometry must be immutable");
  return true;
}

// ---- pre-registered spec validation (Phase 6 §2, §3, §4, §19) ---------------
// A spec that could not be reproduced, that hides CONTROL, that searches leverage
// or that lists an axis without bounds is rejected before any measurement runs.
export function validateRiskSpec(spec, code = CONTROL_PARAMS) {
  const errs = [];
  if (!spec?.axes?.holdHours?.values?.length) errs.push("axes.holdHours.values missing");
  if (!spec?.axes?.stopScale?.values?.length) errs.push("axes.stopScale.values missing");
  if (!spec?.axes?.targetScale?.values?.length) errs.push("axes.targetScale.values missing");
  if (!Array.isArray(spec?.configurations) || !spec.configurations.length) errs.push("configurations missing");
  for (const key of ["leverage", "strategyParams", "exitOrder", "costModel", "funding"]) {
    if (!spec?.frozenAxes?.[key]) errs.push(`frozenAxes.${key} must be declared frozen`);
  }
  const axes = Object.keys(spec.axes || {});
  for (const bad of ["leverage", "baseLev"]) if (axes.includes(bad)) errs.push(`axis ${bad} must not be searched (risk parameter)`);
  const hold = spec.axes?.holdHours || {};
  const stopScale = spec.axes?.stopScale || {};
  const tgtScale = spec.axes?.targetScale || {};
  if (!hold.values?.includes(hold.control)) errs.push("holdHours must contain CONTROL");
  if (!stopScale.values?.includes(stopScale.control)) errs.push("stopScale must contain CONTROL");
  if (!tgtScale.values?.includes(tgtScale.control)) errs.push("targetScale must contain CONTROL");
  if (!stopScale.bounds?.minPct || !stopScale.bounds?.maxPct) errs.push("stopScale.bounds must be declared");
  if (!tgtScale.bounds?.minPct || !tgtScale.bounds?.maxPct) errs.push("targetScale.bounds must be declared");
  if (!spec.configurations.some((c) => c.category === "CONTROL")) errs.push("configurations must include a CONTROL entry");
  const control = spec.configurations.find((c) => c.category === "CONTROL");
  if (control && control.id !== "CONTROL") errs.push("the CONTROL configuration must be named CONTROL");
  if (spec.configurations.length > 32) errs.push("configuration list must stay small (pre-registered, <=32)");
  for (const c of spec.configurations || []) {
    if (!hold.values?.includes(c.holdHours)) errs.push(`${c.id}: holdHours ${c.holdHours} outside the pre-registered axis`);
    if (!stopScale.values?.includes(c.stopScale)) errs.push(`${c.id}: stopScale ${c.stopScale} outside the pre-registered axis`);
    if (!tgtScale.values?.includes(c.targetScale)) errs.push(`${c.id}: targetScale ${c.targetScale} outside the pre-registered axis`);
    if (!(spec.axes.trailing.values || []).some((t) => t.id === c.trailing)) errs.push(`${c.id}: trailing ${c.trailing} outside the pre-registered axis`);
    if (!Number.isFinite(c.holdHours) || c.holdHours <= 0) errs.push(`${c.id}: invalid holdHours`);
  }
  for (const id of STRATEGY_IDS) {
    const g = spec.axes.stopScale;
    const sLo = code[id].stopPct * Math.min(...g.values);
    const sHi = code[id].stopPct * Math.max(...g.values);
    const tLo = code[id].targetPct * Math.min(...spec.axes.targetScale.values);
    const tHi = code[id].targetPct * Math.max(...spec.axes.targetScale.values);
    if (sLo < g.bounds.minPct || sHi > g.bounds.maxPct) errs.push(`${id}: scaled stop range ${sLo}..${sHi} exceeds declared bounds`);
    if (tLo < spec.axes.targetScale.bounds.minPct || tHi > spec.axes.targetScale.bounds.maxPct)
      errs.push(`${id}: scaled target range ${tLo}..${tHi} exceeds declared bounds`);
    if (!code[id]?.stopPct || !code[id]?.targetPct) errs.push(`${id}: CONTROL geometry missing from code`);
  }
  for (const key of ["weights", "qualityWindowR", "costCapUsd", "maxDrawdownR", "stabilityFolds"]) {
    if (spec?.objective?.[key] == null) errs.push(`objective.${key} missing`);
  }
  for (const key of ["minTrainResolved", "minValidationResolved", "minAvailabilityRatioVsControl", "qualityToleranceR"]) {
    if (spec?.validationGate?.[key] == null) errs.push(`validationGate.${key} missing`);
  }
  if (!spec?.diagnostics?.excursionHours?.length) errs.push("diagnostics.excursionHours missing");
  if (!spec?.costSeparation?.raw_ret_pct) errs.push("costSeparation must document raw/gross/net layers");
  if (!spec?.profitabilityGuard) errs.push("profitabilityGuard must be declared");
  return errs;
}
export function assertRiskSpec(spec, code = CONTROL_PARAMS) {
  const errs = validateRiskSpec(spec, code);
  if (errs.length) throw new Error(`risk experiment spec invalid:\n - ${errs.join("\n - ")}`);
  return spec;
}

// ---- deterministic enumeration ----------------------------------------------
// Order is the spec's `configurations` array order; no sorting, no shuffling, no
// generated cartesian product (the grid is a pre-registered explicit list).
export function trailingAxis(spec, id) {
  const t = (spec.axes.trailing.values || []).find((x) => x.id === id);
  if (!t) throw new Error(`unknown trailing id ${id}`);
  return { ...t, id: t.id };
}
export function enumerateConfigurations(spec) {
  return spec.configurations.map((c) => {
    const tr = trailingAxis(spec, c.trailing);
    return {
      id: c.id, category: c.category, rationale: c.rationale ?? null,
      holdHours: c.holdHours, stopScale: c.stopScale, targetScale: c.targetScale,
      trailingId: tr.id, trailing: { enabled: tr.enabled !== false, activateRoi: tr.activateRoi ?? null, giveRoi: tr.giveRoi ?? null },
    };
  });
}
export function configById(spec, id) {
  const found = enumerateConfigurations(spec).find((c) => c.id === id);
  if (!found) throw new Error(`configuration ${id} is not pre-registered`);
  return found;
}
// Identity of a geometry restricted to the searched axes.
export const geometryKey = (cfgLike) =>
  JSON.stringify([cfgLike.holdHours, cfgLike.stopScale, cfgLike.targetScale, cfgLike.trailingId ?? cfgLike.trailing?.id]);

// Per-strategy geometry = CONTROL geometry scaled, so each strategy keeps its OWN
// risk unit (ibreakout stays a 1.5%-stop intraday strategy, orb stays a 1.6%-stop
// opening-range strategy) and no strategy's KIND can change (Phase 6 §9).
export function geometryFor(config, id, prod = loadRiskControl()) {
  const g = prod.perStrategyGeometry[id];
  if (!g) throw new Error(`risk.control.json has no geometry for ${id}`);
  const stopPct = g.stopPct * config.stopScale;
  const targetPct = g.targetPct * config.targetScale;
  return {
    configId: config.id, category: config.category,
    holdHours: config.holdHours, holdMs: config.holdHours * 3600000,
    stopScale: config.stopScale, targetScale: config.targetScale,
    trailingId: config.trailingId, trailing: config.trailing,
    stopPct, targetPct, stopPctControl: g.stopPct, targetPctControl: g.targetPct,
    rMultiple: targetPct / stopPct, baseLev: g.baseLev,
  };
}
export function isValidStop(pct, spec) {
  return Number.isFinite(pct) && pct >= spec.axes.stopScale.bounds.minPct && pct <= spec.axes.stopScale.bounds.maxPct;
}
export function isValidTarget(pct, spec) {
  return Number.isFinite(pct) && pct >= spec.axes.targetScale.bounds.minPct && pct <= spec.axes.targetScale.bounds.maxPct;
}
// The CONTROL configuration must reproduce the production geometry exactly for
// every strategy (stop/target unscaled, hold/trailing from config.json).
export function controlGeometryIsProduction(spec, prod = loadRiskControl(), cfg = null) {
  const ctl = configById(spec, "CONTROL");
  const out = [];
  for (const id of STRATEGY_IDS) {
    const g = geometryFor(ctl, id, prod);
    if (g.stopPct !== g.stopPctControl) out.push(`${id}: CONTROL config must not scale the stop`);
    if (g.targetPct !== g.targetPctControl) out.push(`${id}: CONTROL config must not scale the target`);
  }
  if (cfg && ctl.holdHours !== cfg.v2.aggression.maxHoldHours) out.push("CONTROL holdHours must equal config.json maxHoldHours");
  if (cfg && ctl.trailing.activateRoi !== cfg.v2.aggression.trailActivateRoi)
    out.push("CONTROL trailing.activateRoi must equal config.json trailActivateRoi");
  if (cfg && ctl.trailing.giveRoi !== cfg.v2.aggression.trailGiveRoi)
    out.push("CONTROL trailing.giveRoi must equal config.json trailGiveRoi");
  return out;
}
// ---- leverage (FROZEN axis: never searched, Phase 6 §3) ----------------------
// Mirrors calibration.mjs candidateLeverage exactly: the strategy's CONTROL base
// leverage, capped by the market maximum (and by aggression.leverageCap if set).
export function geometryLeverage(baseLev, market, cfg) {
  const maxLev = cfg.v2.leverage?.[market]?.maxLeverage ?? 1;
  const cap = cfg.v2.aggression?.leverageCap ?? maxLev;
  return Math.max(1, Math.min(baseLev, maxLev, cap));
}
// CONTROL leverage must be identical to the Phase 5 offline resolver's leverage
// for every strategy x market, i.e. geometry changes can never move leverage.
export function leverageMatchesPhase5(cfg, prod = loadRiskControl()) {
  const out = [];
  for (const id of STRATEGY_IDS) {
    const g = prod.leverage?.effectiveByStrategyMarket?.[id] || {};
    for (const [market, lev] of Object.entries(g)) {
      const mine = geometryLeverage(prod.perStrategyGeometry[id].baseLev, market, cfg);
      if (mine !== lev) out.push(`${id}/${market}: geometryLeverage=${mine} snapshot=${lev}`);
    }
  }
  return out;
}

// ---- diagnostic horizons ----------------------------------------------------
export function horizonSnapshots(spec) {
  return (spec.diagnostics.excursionHours || []).slice().sort((a, b) => a - b)
    .map((h) => ({ h, ms: h * 3600000 }));
}

// ---- §11 unconditional excursion snapshots ----------------------------------
// Measured over the fixed diagnostic horizon REGARDLESS of the trade's own
// geometry (diagnostic measurement only; the trade itself is never changed).
// This is a diagnostic pass: it is only computed for the persisted diagnostic
// dataset, never during the parameter search (§19 keeps the search small/fast).
// The stop/target used for the excursion normalisation is the strategy's CONTROL
// unit, so excursions stay comparable across geometries.
export function excursionSnapshots({ cand, rows, spec, unitPct, alpha }) {
  const snaps = horizonSnapshots(spec).map((d) => ({ h: d.h, ts: null, retPct: null, mfeR: null, maeR: null, censored: true }));
  const n = rows.ts.length;
  const horizonMs = spec.diagnostics.diagnosticHorizonHours * 3600000;
  const sgn = sideSign(cand.side);
  let fav = cand.price, adv = cand.price, mark = null, idx = 0;
  for (let j = cand.i + 1; j < n && idx < snaps.length; j++) {
    const rel = rows.ts[j] - cand.ts;
    if (rel > horizonMs) break;
    const h = rows.high[j], l = rows.low[j];
    const best = cand.side === "long" ? h : l;
    const worst = cand.side === "long" ? l : h;
    fav = Math.max(fav, best); adv = Math.min(adv, worst);
    mark = emaUpdate(mark ?? null, rows.close[j], alpha);
    while (idx < snaps.length && rel >= snaps[idx].h * 3600000) {
      const s = snaps[idx];
      s.censored = false; s.ts = rows.ts[j]; s.close = rows.close[j];
      s.retPct = sgn * (rows.close[j] / cand.price - 1);
      s.mfeR = (sgn * (fav - cand.price)) / (cand.price * unitPct);
      s.maeR = (sgn * (adv - cand.price)) / (cand.price * unitPct);
      s.mark = mark;
      idx += 1;
    }
  }
  return snaps;
}


// ---- §15 holding-period curve: conditional outcome at a fixed horizon --------
// Measures what the SAME signal would have returned had it been closed at each
// pre-registered horizon instead of the geometry's own time-stop. A stop, target
// or liquidation touched before the horizon is honoured (the trade really would
// have ended there); the horizon only replaces the TIME exit, so this isolates
// HOLD TIME without touching the strategy or the stop/target distances.
export function horizonOutcomes({ cand, rows, cfg, spec, geom }) {
  const out = {};
  const margin = spec.resolutionModel.marginUsd;
  const leverage = geometryLeverage(cand.baseLev ?? geom.baseLev, cand.market, cfg);
  const halfSpread = (cfg.slippage[cand.market] ?? 0.0005) / 2;
  const entryRef = cand.price;
  const entrySlip = slippageFraction(margin * leverage, cfg.slippage[cand.market] ?? 0.02);
  const entry = fillPrice(entryRef, cand.side, halfSpread, entrySlip);
  const pos = openPosition({
    symbol: cand.symbol, market: cand.market, side: cand.side, entryMark: entry,
    margin, leverage, tiers: cfg.v2.maintenanceTiers?.[cand.market],
    meta: { strategy_id: cand.strategy_id, config: geom.configId },
  });
  const qty = pos.qty;
  const sgn = sideSign(cand.side);
  const taker = cfg.v2.perpFees.taker;
  const entryFee = tradeFee(qty * entry, taker);
  const riskOwn = qty * entry * geom.stopPct;
  const riskCtrl = qty * entry * geom.stopPctControl;
  const stopLevel = entry * (1 - sgn * geom.stopPct);
  const targetLevel = entry * (1 + sgn * geom.targetPct);
  const horizons = (spec.diagnostics.timeToEventHours || []).slice().sort((a, b) => a - b);
  if (!horizons.length) return out;
  const marks = horizons.map(() => null), closes = horizons.map(() => null);
  const favs = horizons.map(() => null), advs = horizons.map(() => null);
  const maxMs = horizons[horizons.length - 1] * 3600000;
  const n = rows.ts.length;
  let fav = entry, adv = entry, mark = pos.mark, peakUPnl = 0, cursor = 0, first = null;
  for (let j = cand.i + 1; j < n; j++) {
    const rel = rows.ts[j] - cand.ts;
    if (rel > maxMs) break;
    const o = rows.open[j], h = rows.high[j], l = rows.low[j], c = rows.close[j];
    const worst = cand.side === "long" ? l : h, best = cand.side === "long" ? h : l;
    mark = emaUpdate(mark ?? null, c, cfg.v2.markEmaAlpha ?? 0.25);
    fav = Math.max(fav, best); adv = Math.min(adv, worst);
    const uPnlMark = (mark - entry) * qty * sgn;
    peakUPnl = Math.max(peakUPnl, uPnlMark);
    if (!first) {
      const trailHit = geom.trailing.enabled && margin > 0
        && peakUPnl / margin >= geom.trailing.activateRoi
        && (peakUPnl - uPnlMark) / margin >= geom.trailing.giveRoi;
      if (markPosition(pos, mark).liquidated || isLiquidated(cand.side, worst, pos.liqPrice))
        first = { rel, reason: "liquidation", exitRef: mark };
      else if (cand.side === "long" ? worst <= stopLevel : worst >= stopLevel)
        first = { rel, reason: "stop-loss", exitRef: cand.side === "long" ? Math.min(stopLevel, o) : Math.max(stopLevel, o) };
      else if (cand.side === "long" ? best >= targetLevel : best <= targetLevel)
        first = { rel, reason: "take-profit", exitRef: targetLevel };
      else if (trailHit) first = { rel, reason: "trailing-stop", exitRef: mark };
    }
    while (cursor < horizons.length && rel >= horizons[cursor] * 3600000) {
      marks[cursor] = mark; closes[cursor] = c; favs[cursor] = fav; advs[cursor] = adv;
      cursor += 1;
    }
  }
  for (let k = 0; k < horizons.length; k++) {
    const key = `h${horizons[k]}`;
    const hMs = horizons[k] * 3600000;
    const capped = first && first.rel <= hMs ? first : null;
    if (!capped && marks[k] == null) { out[key] = { horizonHours: horizons[k], censored: true, net_pnl_usd: null }; continue; }
    const r = resolveExit({
      cand, qty, sgn, entry, entryRef, entryFee, exitRef: capped ? capped.exitRef : marks[k],
      reason: capped ? capped.reason : "horizon-stop", mark, taker, halfSpread, cfg, market: cand.market,
      riskOwn, riskCtrl, ts: null, j: null, rel: hMs, peakUPnl, margin,
    });
    out[key] = {
      horizonHours: horizons[k], censored: false, exit_reason: r.exit_reason,
      net_pnl_usd: r.net_pnl_usd, gross_pnl_usd: r.gross_pnl_usd, raw_ret_pct: r.raw_ret_pct,
      fees_usd: r.fees_usd, spread_slip_usd: r.spread_slip_usd, realized_R: r.realized_R,
      mfe_R: riskCtrl > 0 && favs[k] != null ? (sgn * (favs[k] - entryRef)) / (entryRef * geom.stopPctControl) : null,
      mae_R: riskCtrl > 0 && advs[k] != null ? (sgn * (advs[k] - entryRef)) / (entryRef * geom.stopPctControl) : null,
      close: closes[k],
    };
  }
  return out;
}

// One candidate x one geometry -> one counterfactual outcome with three explicit
// reward layers (raw price return / gross fill-to-fill / net after fees), the
// excursion diagnostics and the time-to-event record.
//
// Causal guarantees: iteration starts at cand.i + 1 (strictly after the decision
// bar) and never reads a bar beyond the diagnostic horizon; no outcome of any
// kind is read before it happens.
export function resolveGeometry({ cand, rows, cfg, prod, spec, geom, diagnostics = false }) {
  const market = cand.market;
  const margin = spec.resolutionModel.marginUsd;
  const leverage = geometryLeverage(cand.baseLev ?? geom.baseLev, market, cfg);
  const tiers = cfg.v2.maintenanceTiers?.[market];
  const halfSpread = (cfg.slippage[market] ?? 0.0005) / 2;
  const entrySlip = slippageFraction(margin * leverage, cfg.slippage[market] ?? 0.02);
  const entryRef = cand.price;
  const entry = fillPrice(entryRef, cand.side, halfSpread, entrySlip);
  const pos = openPosition({
    symbol: cand.symbol, market, side: cand.side, entryMark: entry,
    margin, leverage, tiers, meta: { strategy_id: cand.strategy_id, config: geom.configId },
  });
  const qty = pos.qty;
  const sgn = sideSign(cand.side);
  const entryFee = tradeFee(qty * entry, cfg.v2.perpFees.taker);
  const riskOwn = qty * entry * geom.stopPct;
  const riskCtrl = qty * entry * geom.stopPctControl;
  const taker = cfg.v2.perpFees.taker;

  const identity = {
    symbol: cand.symbol, strategy_id: cand.strategy_id, side: cand.side,
    ts: cand.ts, i: cand.i, entryRef, market, panel: cand.panel, fold: cand.fold ?? null,
    trendContext: cand.trendContext ?? null, config: geom.configId, category: geom.category,
  };
  const geoOut = {
    holdHours: geom.holdHours, stopScale: geom.stopScale, targetScale: geom.targetScale,
    stopPct: geom.stopPct, targetPct: geom.targetPct,
    stopPctControl: geom.stopPctControl, targetPctControl: geom.targetPctControl,
    trailingId: geom.trailingId, leverage, margin, qty, entry,
  };
  const noTrade = { ...identity, ...geoOut, resolved: false, exit_reason: "unresolved-end-of-panel" };

  const n = rows.ts.length;
  const stopLevel = entry * (1 - sgn * geom.stopPct);
  const targetLevel = entry * (1 + sgn * geom.targetPct);

  let favMax = entry, advMin = entry;              // unconditional excursions over the window
  let maeRoi = null, mfeRoi = null, peakUPnl = 0;  // excursions inside the actual hold
  let tTarget = null, tStop = null, tTrail = null, tTime = null, tLiq = null, firstEvent = null;
  let exit = null;
  const horizonMs = spec.diagnostics.diagnosticHorizonHours * 3600000;

  for (let j = cand.i + 1; j < n; j++) {
    const ts = rows.ts[j];
    const rel = ts - cand.ts;
    if (rel > horizonMs) break;                    // diagnostic horizon reached
    const o = rows.open[j], h = rows.high[j], l = rows.low[j], c = rows.close[j];
    const worst = cand.side === "long" ? l : h;    // adverse extreme
    const best = cand.side === "long" ? h : l;     // favourable extreme
    const mark = emaUpdate(pos.mark ?? null, c, cfg.v2.markEmaAlpha ?? 0.25);
    const uPnlMark = (mark - entry) * qty * sgn;
    const roiWorst = margin > 0 ? ((worst - entry) * qty * sgn) / margin : null;
    const roiBest = margin > 0 ? ((best - entry) * qty * sgn) / margin : null;

    favMax = Math.max(favMax, best); advMin = Math.min(advMin, worst);
    if (roiWorst != null) maeRoi = maeRoi == null ? roiWorst : Math.min(maeRoi, roiWorst);
    if (roiBest != null) mfeRoi = mfeRoi == null ? roiBest : Math.max(mfeRoi, roiBest);
    peakUPnl = Math.max(peakUPnl, uPnlMark);

    const stopHit = cand.side === "long" ? worst <= stopLevel : worst >= stopLevel;
    const targetHit = cand.side === "long" ? best >= targetLevel : best <= targetLevel;
    const liqHit = markPosition(pos, mark).liquidated || isLiquidated(cand.side, worst, pos.liqPrice);
    const timeHit = rel >= geom.holdMs;
    const trailHit = geom.trailing.enabled && margin > 0
      && peakUPnl / margin >= geom.trailing.activateRoi
      && (peakUPnl - uPnlMark) / margin >= geom.trailing.giveRoi;

    // time-to-event (measured along this geometry's OWN resolution path)
    if (tLiq == null && liqHit) tLiq = rel;
    if (tStop == null && stopHit) tStop = rel;
    if (tTarget == null && targetHit) tTarget = rel;
    if (tTime == null && timeHit) tTime = rel;
    if (tTrail == null && trailHit) tTrail = rel;

    // live-engine exit ORDER: liquidation -> stop -> target -> time -> trailing
    let reason = null, exitRef = null;
    if (liqHit) { reason = "liquidation"; exitRef = mark; }
    else if (stopHit) { reason = "stop-loss"; exitRef = cand.side === "long" ? Math.min(stopLevel, o) : Math.max(stopLevel, o); }
    else if (targetHit) { reason = "take-profit"; exitRef = targetLevel; }
    else if (timeHit) { reason = "time-stop"; exitRef = mark; }
    else if (trailHit) { reason = "trailing-stop"; exitRef = mark; }
    if (!reason) { pos.mark = mark; continue; }
    firstEvent = reason;
    exit = resolveExit({ cand, qty, sgn, entry, entryRef, entryFee, exitRef, reason, mark, taker, halfSpread, cfg, market, riskOwn, riskCtrl, ts, j, rel, peakUPnl, margin });
    break;
  }

  // §11/§12 excursion diagnostics. `mae_roi` / `mfe_roi` are ALWAYS measured
  // inside the actual hold (cheap, in-loop). The unconditional fixed-horizon
  // snapshots need a second pass over the diagnostic window, so they are only
  // produced for the persisted diagnostic dataset (`diagnostics: true`), never
  // during the parameter search. Search rows carry null (not 0) for those fields.
  const snaps = diagnostics
    ? excursionSnapshots({ cand, rows, spec, unitPct: geom.stopPctControl, alpha: cfg.v2.markEmaAlpha ?? 0.25 })
    : null;
  const horizons = diagnostics
    ? horizonOutcomes({ cand, rows, cfg, spec, geom })
    : null;
  const lastSnap = snaps ? snaps.filter((s) => !s.censored).pop() : null;
  const diag = {
    mae_roi: maeRoi, mfe_roi: mfeRoi,
    horizon_mfe_R: lastSnap ? lastSnap.mfeR : null,
    horizon_mae_R: lastSnap ? lastSnap.maeR : null,
    horizon_snapshots: snaps,
    horizons,
    time_to_event: {
      target_h: tTarget != null ? tTarget / 3600000 : null,
      stop_h: tStop != null ? tStop / 3600000 : null,
      trail_h: tTrail != null ? tTrail / 3600000 : null,
      time_h: tTime != null ? tTime / 3600000 : null,
      liq_h: tLiq != null ? tLiq / 3600000 : null,
      first_event: firstEvent,
    },
  };
  if (!exit) return { ...noTrade, ...diag, barsHeld: n - cand.i - 1, hold_secs: null };
  return { ...identity, ...geoOut, ...exit, ...diag };
}

// ---- exit accounting with an explicit three-layer reward split ---------------
// Phase 6 §10: the R metric alone cannot distinguish "no directional edge" from
// "edge destroyed by costs", so every outcome carries:
//   realRetPct   raw price return (reference bar close -> reference exit price)
//   grossRef     P&L at the un-adjusted reference prices (pure market movement)
//   gross        P&L at the two ADVERSE fills (spread + impact already inside)
//   spread_slip  gross - grossRef  (what the adverse fills cost)
//   fees         taker fee on entry + taker fee on exit
//   net          gross - fees      (funding omitted — documented)
// realized_R is normalised by the strategy's CONTROL risk unit so outcomes stay
// comparable ACROSS geometries (net P&L and margin are geometry-independent).
export function resolveExit({
  cand, qty, sgn, entry, entryRef, entryFee, exitRef, reason, mark,
  taker, halfSpread, cfg, market, riskOwn, riskCtrl, ts, j, rel, peakUPnl, margin,
}) {
  const exitSide = cand.side === "long" ? "sell" : "buy";       // closing action
  const exitNotionalRef = qty * exitRef;
  const exitSlip = slippageFraction(exitNotionalRef, cfg.slippage[market] ?? 0.02);
  const exit = fillPrice(exitRef, exitSide, halfSpread, exitSlip); // adverse exit (same as live)
  const exitFee = tradeFee(exitNotionalRef, taker);
  const fees = entryFee + exitFee;
  const grossRef = (exitRef - entryRef) * qty * sgn;             // reference prices, no fees
  const gross = (exit - entry) * qty * sgn;                      // fill-to-fill, no fees
  const net = gross - fees;
  return {
    resolved: true,
    exit_reason: reason,
    exitTs: ts,
    exitBar: j,
    exitRef,
    exitFill: exit,
    hold_secs: rel / 1000,
    raw_ret_pct: sgn * (exitRef / entryRef - 1),
    grossRef_pnl_usd: grossRef,
    gross_pnl_usd: gross,
    spread_slip_usd: gross - grossRef,
    entry_fee_usd: entryFee,
    exit_fee_usd: exitFee,
    fees_usd: fees,
    fees: fees,                                                  // Phase 5 field name
    net_pnl_usd: net,
    net_pnl: net,                                                // Phase 5 field name
    risk_own_usd: riskOwn,
    risk_ctrl_usd: riskCtrl,
    realized_R_own: riskOwn > 0 ? net / riskOwn : null,
    realized_R: riskCtrl > 0 ? net / riskCtrl : null,
    roi_on_margin: margin > 0 ? net / margin : null,
    break_even_move_pct: entryRef > 0 ? (fees + (gross - grossRef)) / (qty * entryRef) : null,
    peak_uPnl_roi: margin > 0 ? peakUPnl / margin : null,
  };
}

// ---- cost / break-even helpers (Phase 6 §14) --------------------------------
// Average round-trip cost per trade in USD and as a fraction of the entry
// notional: the favourable price move required before the trade is not losing
// money purely because it was opened.
export function costBreakEven(rows) {
  const res = rows.filter((r) => r.resolved && Number.isFinite(r.net_pnl_usd));
  if (!res.length) return { n: 0, meanCostUsd: null, meanFeesUsd: null, meanSpreadSlipUsd: null, meanBreakEvenMovePct: null, meanNotionalUsd: null };
  const notional = res.map((r) => (r.qty ?? 0) * (r.entryRef ?? r.entry ?? 0)).filter((x) => x > 0);
  return {
    n: res.length,
    meanCostUsd: mean(res.map((r) => (r.fees_usd ?? 0) + (r.spread_slip_usd ?? 0))),
    meanFeesUsd: mean(res.map((r) => r.fees_usd)),
    meanSpreadSlipUsd: mean(res.map((r) => r.spread_slip_usd)),
    meanBreakEvenMovePct: mean(res.map((r) => r.break_even_move_pct)),
    meanNotionalUsd: mean(notional),
  };
}




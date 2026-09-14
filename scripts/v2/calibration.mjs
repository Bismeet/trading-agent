// scripts/v2/calibration.mjs — Phase 5 strategy-calibration core (LOCAL, offline).
//
// Chosen scope (spec §1/§2/§5/§6/§8/§9/§19):
//   * parameterizes ONLY signal-detection thresholds; risk geometry
//     (baseLev/stopPct/targetPct) and every strategy's KIND are frozen;
//   * the permitted ranges live in config/calibration-spec.v1.json (written
//     BEFORE any measurement) and are READ here — never hardcoded;
//   * everything is causal: a decision bar sees only bars/values timestamped
//     <= that bar (the decision day's FINAL daily close is never visible);
//   * OFF-PRODUCTION: this module never reads or writes live state, live shadow
//     files, live learner files or real P&L. Outputs live under data/calibration.
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, DATA, readJSON, indicators, sma, sha256, YH, getJSON,
} from "./store.mjs";
import { CONTROL_PARAMS, SIGNALS, SEEDS } from "./strategies.mjs";
import {
  openPosition, markPosition, isLiquidated, sideSign, emaUpdate,
  tradeFee, slippageFraction, fillPrice,
} from "./perp.mjs";

export const CAL_DIR = path.join(DATA, "calibration");
export const SPEC_PATH = path.join(ROOT, "config", "calibration-spec.v1.json");
export const CONTROL_PATH = path.join(ROOT, "config", "strategies.control.json");
export const CALIBRATED_PATH = path.join(ROOT, "config", "strategies.calibrated.json");
export const RESULTS_PATH = path.join(CAL_DIR, "calibration-results.v2.jsonl");
export const FREQUENCY_PATH = path.join(CAL_DIR, "frequency.v2.json");
export const COMPARE_PATH = path.join(CAL_DIR, "compare.v2.json");
export const STRATEGY_IDS = ["tsmom", "donchian", "rsi2dip", "mom_trend", "orb", "ibreakout"];
export const panelPath = (name) => path.join(CAL_DIR, `history.${name}.v2.json`);
export const datasetPath = (configName) => path.join(CAL_DIR, `shadow-${configName}.v2.jsonl`);

export function ensureCalDir() {
  fs.mkdirSync(CAL_DIR, { recursive: true });
}
// Guard (spec §17): calibration may only ever write inside data/calibration.
export function assertCalibrationPath(p) {
  const rel = path.relative(CAL_DIR, path.resolve(p));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`calibration path escapes ${CAL_DIR}: ${p}`);
  }
  return path.resolve(p);
}
export function writeCalJSON(p, obj) {
  assertCalibrationPath(p);
  ensureCalDir();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
  return p;
}
export function appendCalJSONL(p, rec) {
  assertCalibrationPath(p);
  ensureCalDir();
  fs.appendFileSync(p, JSON.stringify(rec) + "\n");
}
export function readCalJSONL(p) {
  try {
    return fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
// Strategy CONFIGURATION files live in config/ (spec §1) and are written atomically.
// The guard is deliberately narrow: calibration may only ever rewrite the two
// named configuration files, never config.json and never the control snapshot.
export function assertConfigPath(p) {
  const abs = path.resolve(p);
  if (abs !== path.resolve(CONTROL_PATH) && abs !== path.resolve(CALIBRATED_PATH)) {
    throw new Error(`calibration may only write the named strategy configuration files, not ${p}`);
  }
  return abs;
}
export function writeConfigJSON(p, obj) {
  assertConfigPath(p);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
  fs.renameSync(tmp, p);
  return p;
}
// CONTROL is immutable for the experiment: calibration must never rewrite it.
export function assertControlUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("CONTROL configuration changed during a calibration run (must be immutable)");
  }
}

// ---- spec + configurations --------------------------------------------------

export function loadSpec(p = SPEC_PATH) {
  const spec = readJSON(p, null);
  if (!spec) throw new Error(`calibration spec missing at ${p}`);
  validateSpec(spec);
  return spec;
}
export function specHash(spec) {
  return sha256(JSON.stringify(spec));
}
// Structural validation: a spec that cannot be executed deterministically must
// fail loudly rather than silently produce an experiment with missing ranges.
export function validateSpec(spec) {
  const errs = [];
  for (const id of STRATEGY_IDS) {
    const g = spec.parameterGrids?.[id];
    if (!g) { errs.push(`spec: no parameterGrids entry for ${id}`); continue; }
    if (!spec.panels?.[g.panel]) errs.push(`spec: ${id} references unknown panel ${g.panel}`);
    const combos = enumerateGrid(spec, id);
    if (!combos.length) errs.push(`spec: ${id} grid is empty`);
    for (const c of combos) {
      for (const k of Object.keys(c)) {
        if (!(k in (CONTROL_PARAMS[id] || {}))) errs.push(`spec: ${id} grid key "${k}" is not a control parameter`);
      }
    }
  }
  for (const [pname, panel] of Object.entries(spec.panels || {})) {
    if (!spec.splits?.[pname]) errs.push(`spec: no split for panel ${pname}`);
    if (!panel.range || !panel.interval) errs.push(`spec: panel ${pname} missing range/interval`);
  }
  if (errs.length) throw new Error(`invalid calibration spec:\n - ${errs.join("\n - ")}`);
  return true;
}
// Deterministic grid enumeration. `configs` (explicit list) is used when a
// cartesian product would create semantically meaningless combinations (e.g.
// RSI2 low/high pairs). Otherwise: cartesian product in declared key order --
// no randomness, no shuffling, identical input => identical output.
export function enumerateGrid(spec, id) {
  const g = spec.parameterGrids?.[id];
  if (!g) return [];
  if (Array.isArray(g.configs)) return g.configs.map((c) => sortKeys(c));
  const keys = Object.keys(g.grid || {});
  let out = [{}];
  for (const k of keys) {
    const vals = g.grid[k];
    if (!Array.isArray(vals) || !vals.length) throw new Error(`spec: empty grid axis ${id}.${k}`);
    const next = [];
    for (const base of out) for (const v of vals) next.push({ ...base, [k]: v });
    out = next;
  }
  return out.map((c) => sortKeys(c));
}
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
export const gridKey = (params) => JSON.stringify(sortKeys(params));
export function gridBounds(spec, id) {
  const combos = enumerateGrid(spec, id);
  const out = {};
  for (const c of combos) {
    for (const [k, v] of Object.entries(c)) {
      if (!(k in out)) out[k] = [v, v];
      out[k] = [Math.min(out[k][0], v), Math.max(out[k][1], v)];
    }
  }
  return out;
}
// CONTROL = production thresholds (frozen file, must equal code defaults).
export function loadControlConfig(p = CONTROL_PATH) {
  const f = readJSON(p, null);
  if (!f?.params) throw new Error(`control configuration missing at ${p}`);
  return f;
}
export const controlParams = () => CONTROL_PARAMS;
// Convenience re-export so tooling/tests share the single source of truth.
export { CONTROL_PARAMS };
export function controlDiffersFromCode(cfgFile = loadControlConfig()) {
  const diffs = [];
  for (const id of STRATEGY_IDS) {
    const a = sortKeys(cfgFile.params[id] || {});
    const b = sortKeys(CONTROL_PARAMS[id] || {});
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] !== b[k]) diffs.push(`${id}.${k}: file=${a[k]} code=${b[k]}`);
    }
  }
  return diffs;
}
// The frozen calibrated configuration (written by the search AFTER the
// validation gate; absent => every strategy still runs CONTROL).
export function loadCalibratedConfig(p = CALIBRATED_PATH) {
  const f = readJSON(p, null);
  if (!f?.params) return null;
  return f;
}
// Effective params for a strategy in a named configuration.
export function paramsFor(config, id) {
  if (!config) return { ...CONTROL_PARAMS[id] };
  const p = config.params?.[id] ?? config[id];
  if (!p) return { ...CONTROL_PARAMS[id] };
  return { ...CONTROL_PARAMS[id], ...p }; // unspecified axes stay at CONTROL
}

// ---- panels (real provider data, cached; never fabricated) -------------------
export async function acquirePanel(spec, name, symbols, { force = false, log = () => {} } = {}) {
  const panel = spec.panels[name];
  if (!panel) throw new Error(`unknown panel ${name}`);
  const p = panelPath(name);
  const existing = readJSON(p, null);
  if (existing && !force) return existing;
  const out = {
    name, interval: panel.interval, range: panel.range,
    source: "Yahoo Finance chart API (same provider/endpoint as the live engine)",
    urlTemplate: YH("<symbol>", panel.range, panel.interval),
    fetchedAt: Date.now(), symbols: {}, failures: [],
  };
  for (const s of symbols) {
    try {
      const j = await getJSON(YH(s, panel.range, panel.interval));
      const res = j?.chart?.result?.[0];
      const raw = res?.indicators?.quote?.[0] || {};
      const ts = res?.timestamp || [];
      const rows = { ts: [], open: [], high: [], low: [], close: [] };
      for (let i = 0; i < ts.length; i++) {
        const c = raw.close?.[i];
        if (!Number.isFinite(c) || c <= 0) continue; // provider gaps are dropped, never filled
        rows.ts.push(ts[i] * 1000);
        rows.open.push(Number.isFinite(raw.open?.[i]) ? raw.open[i] : c);
        rows.high.push(Number.isFinite(raw.high?.[i]) ? raw.high[i] : c);
        rows.low.push(Number.isFinite(raw.low?.[i]) ? raw.low[i] : c);
        rows.close.push(c);
      }
      if (!rows.ts.length) { out.failures.push({ symbol: s, reason: "no bars" }); continue; }
      out.symbols[s] = rows;
      log(`panel ${name}: ${s} ${rows.ts.length} bars (${new Date(rows.ts[0]).toISOString().slice(0, 10)} .. ${new Date(rows.ts.at(-1)).toISOString().slice(0, 10)})`);
    } catch (e) {
      out.failures.push({ symbol: s, reason: String(e?.message || e) }); // recorded, not invented
      log(`panel ${name}: ${s} FAILED (${e?.message || e})`);
    }
  }
  writeCalJSON(p, out);
  return out;
}
export function loadPanel(name) {
  const p = readJSON(panelPath(name), null);
  if (!p) throw new Error(`panel ${name} not acquired yet (run the fetch step first): ${panelPath(name)}`);
  return p;
}
// READ-ONLY access to the real acquired panels. Tests run with FAB_DATA pointed
// at a temp directory (so every WRITE stays isolated) but still need the real
// historical panels for causality/determinism checks.
export const REAL_CAL_DIR = path.join(ROOT, "data", "calibration");
export const realPanelPath = (name) => path.join(REAL_CAL_DIR, `history.${name}.v2.json`);
export function loadRealPanel(name) {
  const p = readJSON(realPanelPath(name), null);
  if (!p) throw new Error(`real panel ${name} not acquired: ${realPanelPath(name)}`);
  return p;
}
export function realPanelsAvailable(names) {
  return names.every((n) => fs.existsSync(realPanelPath(n)));
}
export function panelSymbols(panel) {
  return Object.keys(panel.symbols || {}).sort();
}
export function panelSpan(panel) {
  let a = null, b = null;
  for (const rows of Object.values(panel.symbols || {})) {
    if (!rows?.ts?.length) continue;
    if (a == null || rows.ts[0] < a) a = rows.ts[0];
    if (b == null || rows.ts.at(-1) > b) b = rows.ts.at(-1);
  }
  return { firstTs: a, lastTs: b };
}

// `gridContainsControl` is a hard pre-registration requirement: a strategy must
// always be allowed to keep its production thresholds.
export function gridContainsControl(spec, id) {
  const control = CONTROL_PARAMS[id];
  return enumerateGrid(spec, id).some((c) =>
    Object.entries(c).every(([k, v]) => control[k] === v));
}
// Grid configurations carry ONLY the searched axes. They must be merged with
// CONTROL before evaluation so the frozen risk geometry (baseLev/stopPct/
// targetPct/confidence) is always present -- a grid config can never silently
// lose its stop-loss.
export const mergeWithControl = (id, partial) => ({ ...CONTROL_PARAMS[id], ...partial });
export function gridAxesOf(spec, id) {
  const g = spec.parameterGrids?.[id];
  if (!g) return [];
  return Array.isArray(g.configs) ? Object.keys(g.configs[0] || {}) : Object.keys(g.grid || {});
}
// Identity of a configuration restricted to the searched axes: this is how a
// grid config is recognized as "the same as CONTROL".
export function gridAxesKey(spec, id, params) {
  return gridKey(Object.fromEntries(gridAxesOf(spec, id).map((k) => [k, params?.[k]])));
}

// ---- causal context ---------------------------------------------------------
export const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// Daily context at decision bar ts: strictly earlier UTC dates, then the
// decision bar's own price as the current (partial) daily value. The decision
// day's FINAL daily close can never be observed here (no look-ahead).
// The window is capped at 366 daily bars because that is exactly what the live
// engine holds (historyRefresh uses range=1y), so offline context == live context.
export const DAILY_CONTEXT_CAP = 366;
export function dailyContextAt(dailyRows, ts, currentPrice) {
  if (!dailyRows?.ts?.length) return Number.isFinite(currentPrice) ? [currentPrice] : [];
  const day = utcDate(ts);
  // binary search: first daily bar whose date is not strictly earlier than `day`
  let lo = 0, hi = dailyRows.ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (utcDate(dailyRows.ts[mid]) < day) lo = mid + 1;
    else hi = mid;
  }
  const out = [];
  for (let i = Math.max(0, lo - DAILY_CONTEXT_CAP); i < lo; i++) out.push(dailyRows.close[i]);
  if (Number.isFinite(currentPrice)) out.push(currentPrice);
  return out;
}
// Offline PROXY for the engine regime: the symbol's own causal trend state.
// Labeled a PROXY everywhere it is reported -- it is NOT the engine's regime
// label (historical world-state labels do not exist offline).
export function trendContextProxy(dailyCloses, price) {
  const s200 = sma(dailyCloses, 200);
  if (s200 == null || !Number.isFinite(price)) return "trend_unknown";
  return price > s200 ? "trend_up" : "trend_down";
}
// Session start (regular-hours open) of the bar's UTC date: the first bar of
// that date in the panel. Stock panels contain regular-hours bars only, which
// is the offline equivalent of the live market-open gate.
export function sessionStartOf(rows, i) {
  const day = utcDate(rows.ts[i]);
  for (let j = i; j >= 0; j--) {
    if (utcDate(rows.ts[j]) !== day) return rows.ts[j + 1];
  }
  return rows.ts[0];
}
export const marketOfSymbol = (cfg, symbol) =>
  cfg.watchlist.find((w) => w.symbol === symbol)?.market || "crypto";
export const seedMarkets = (id) => SEEDS.find((s) => s.id === id)?.markets || [];

// Causal quote object, shaped exactly like the engine's enriched quote.
export function contextQuote({ symbol, market, rows, i, dailyRows, intradayFrom }) {
  const price = rows.close[i];
  const ts = rows.ts[i];
  const closes = dailyContextAt(dailyRows, ts, price);
  const q = { symbol, ok: true, price, priceUsd: price, ts, market, closes, ...indicators(closes) };
  if (intradayFrom) q.closesIntraday = intradayFrom.close.slice(0, i + 1);
  if (market === "us") q.sessionStart = sessionStartOf(rows, i);
  return q;
}

// Evaluate ONE strategy over ONE symbol's panel with explicit parameters.
// Returns per-bar attribution (fired or not), so frequency / diversity /
// co-firing mean the same thing offline as they do in the live audit.
export function evaluateStrategy({ id, params, symbol, market, rows, daily, intradayFrom, panelName, onBar }) {
  const sigFn = SIGNALS[id];
  const cache = {}; // strategy state (ORB range per symbol) -- deterministic
  const signals = [];
  let evaluations = 0,
    notApplicable = 0,
    firstReady = null;
  for (let i = 0; i < rows.ts.length; i++) {
    const q = contextQuote({ symbol, market, rows, i, dailyRows: daily, intradayFrom });
    // warmup: a strategy that cannot compute yet is NOT an evaluation (the same
    // rule Phase 3 uses for structurally inapplicable strategy x symbol rows).
    let ready = true;
    if (id === "rsi2dip") ready = q.closes.length >= Math.max(210, params.smaN + 10);
    else if (id === "tsmom" || id === "mom_trend") ready = q.closes.length >= Math.max(30, params.retN + 2);
    else if (id === "donchian") ready = q.closes.length >= Math.max(25, params.lookback + 5);
    else if (id === "ibreakout") ready = (q.closesIntraday?.length || 0) >= Math.max(49, params.bars + 1);
    else if (id === "orb") ready = Number.isFinite(q.sessionStart);
    if (!ready) { notApplicable += 1; continue; }
    if (firstReady == null) firstReady = i;
    evaluations += 1;
    const sig = sigFn(q, cache, q.ts, params);
    if (onBar) onBar(q, sig, i, cache); // structural near-miss probe (no candidates made)
    if (!sig) continue;
    signals.push({
      symbol, strategy_id: id, side: sig.side, ts: q.ts, i,
      price: q.price, confidence: sig.confidence, reason: sig.reason,
      baseLev: sig.baseLev, stopPct: sig.stopPct, targetPct: sig.targetPct,
      trendContext: trendContextProxy(q.closes, q.price),
      panel: panelName, market,
    });
  }
  return { symbol, strategy_id: id, panel: panelName, evaluations, notApplicable, firstReady, signals };
}

// ---- deterministic chronological splits -------------------------------------
export function splitBounds(n, splits) {
  const train = Math.floor(n * splits.train);
  const validation = Math.floor(n * splits.validation);
  return {
    train: [0, train],
    validation: [train, train + validation],
    test: [train + validation, n],
    sizes: { train, validation, test: n - train - validation },
  };
}
export const inBounds = (b, i) => i >= b[0] && i < b[1];

// ---- run a configuration over a panel --------------------------------------
// Evaluate every applicable strategy of a configuration over every available
// symbol of a panel. Results are per (strategy, symbol) with per-bar indices so
// folds, cohorts and resolution can all be derived causally and offline.
export function runStrategyOverPanel({ id, params, cfg, panel, dailyPanel, panelName, symbols, onBar, foldBySymbol }) {
  const out = { strategy_id: id, panel: panelName, params, perSymbol: {}, evaluations: 0, signals: [] };
  for (const symbol of symbols) {
    const rows = panel.symbols?.[symbol];
    const market = marketOfSymbol(cfg, symbol);
    if (!seedMarkets(id).includes(market)) continue; // structural eligibility (mirrors runStrategies)
    if (!rows?.ts?.length) continue;
    const daily = dailyPanel?.symbols?.[symbol] || null;
    const res = evaluateStrategy({
      id, params, symbol, market, rows, daily,
      intradayFrom: panelName === "quarter" ? rows : null, panelName, onBar,
    });
    const b = foldBySymbol?.[symbol];
    if (b) for (const s of res.signals) s.fold = foldName(b, s.i); // chronological fold tag
    out.perSymbol[symbol] = { ...res, market, rows, foldBounds: b ?? null };
    out.evaluations += res.evaluations;
    out.signals.push(...res.signals);
  }
  return out;
}
// Candidate records ready for offline resolution (counterfactual dataset).
export function candidatesFrom(signals, { configName, panelName }) {
  return signals.map((s) => ({
    ...s, config: configName, panel: panelName,
    tradeId: `off_${configName}_${panelName}_${s.symbol}_${s.strategy_id}_${s.ts}`,
  }));
}
export function resolveAll(candidates, run, cfg, spec, foldBySymbol) {
  const rows = [];
  for (const cand of candidates) {
    const sym = run.perSymbol[cand.symbol];
    if (!sym) continue;
    const row = resolveCandidate({ cand, rows: sym.rows, cfg, spec });
    const b = foldBySymbol[cand.symbol];
    row.fold = b ? foldName(b, cand.i) : "unknown";
    rows.push(row);
  }
  return rows;
}
export function foldName(bounds, i) {
  if (inBounds(bounds.train, i)) return "train";
  if (inBounds(bounds.validation, i)) return "validation";
  if (inBounds(bounds.test, i)) return "test";
  return "out-of-range";
}
export function foldBoundsBySymbol(symbols, panel, splits) {
  const out = {};
  for (const s of symbols) out[s] = splitBounds(panel.symbols[s]?.ts?.length || 0, splits);
  return out;
}

// ---- offline counterfactual resolution (spec §15, resolutionModel) -----------
// Same cost model as the live engine / shadow layer (perp.mjs): adverse fills
// (half spread + sqrt impact), taker fees on entry and exit, EMA marks,
// liquidation/stop/target/time/trailing in the live ORDER. Deliberate,
// documented differences: bars instead of quotes, CONSERVATIVE intra-bar
// ordering (liquidation, then stop before target when both are touched in the
// same bar), NO funding accrual (historical rates unavailable), no wallet /
// concurrency / council gates (counterfactual dataset).
export function candidateLeverage(cand, cfg) {
  const maxLev = cfg.v2.leverage[cand.market]?.maxLeverage ?? 1;
  const cap = cfg.v2.aggression?.leverageCap ?? maxLev;
  return Math.max(1, Math.min(cand.baseLev, maxLev, cap));
}

export function resolveCandidate({ cand, rows, cfg, spec }) {
  const market = cand.market;
  const margin = spec?.resolutionModel?.marginUsd ?? cfg.v2.shadow?.marginUsd ?? 100;
  const leverage = candidateLeverage(cand, cfg);
  const notionalEst = margin * leverage;
  const halfSpread = (cfg.slippage[market] ?? 0.0005) / 2;
  const slip = slippageFraction(notionalEst, cfg.slippage[market] ?? 0.02);
  const entry = fillPrice(cand.price, cand.side, halfSpread, slip); // adverse entry (same as live)
  const pos = openPosition({
    symbol: cand.symbol, market, side: cand.side, entryMark: entry,
    margin, leverage, tiers: cfg.v2.maintenanceTiers[market],
    meta: { trade_id: cand.tradeId, strategy_id: cand.strategy_id, stopPct: cand.stopPct, targetPct: cand.targetPct },
  }, cand.ts);
  const entryFee = tradeFee(pos.notional, cfg.v2.perpFees.taker);
  pos.entryFeePaid = entryFee;
  pos.feesPaid = entryFee;
  pos.mark = entry;
  const maxHoldMs = (cfg.v2.aggression.maxHoldHours ?? 4) * 3600e3;
  const alpha = cfg.v2.markEmaAlpha;
  const base = {
    offline: true, config: cand.config, panel: cand.panel,
    trade_id: cand.tradeId, strategy_id: cand.strategy_id, setup_tag: cand.setup_tag ?? null,
    symbol: cand.symbol, market, side: cand.side,
    trendContext: cand.trendContext, confidence: cand.confidence, baseScore: cand.confidence,
    decisionTs: cand.ts, entryTs: cand.ts, entry,
    leverage, margin, stopPct: cand.stopPct, targetPct: cand.targetPct, reason: cand.reason ?? null,
    funding: "OMITTED_NO_HISTORICAL_RATE",
  };
  let maeRoi = null, mfeRoi = null, peakUPnl = 0;
  for (let j = cand.i + 1; j < rows.ts.length; j++) {
    const ts = rows.ts[j];
    const o = rows.open[j], h = rows.high[j], l = rows.low[j], c = rows.close[j];
    const worst = cand.side === "long" ? l : h;   // adverse extreme
    const best = cand.side === "long" ? h : l;    // favourable extreme
    const mark = emaUpdate(pos.mark ?? null, c, alpha);
    const uPnlMark = (mark - entry) * pos.qty * sideSign(cand.side);
    const roiMark = pos.isolatedMargin > 0 ? uPnlMark / pos.isolatedMargin : null;
    const roiWorst = pos.isolatedMargin > 0 ? ((worst - entry) * pos.qty * sideSign(cand.side)) / pos.isolatedMargin : null;
    const roiBest = pos.isolatedMargin > 0 ? ((best - entry) * pos.qty * sideSign(cand.side)) / pos.isolatedMargin : null;
    if (roiWorst != null) maeRoi = maeRoi == null ? roiWorst : Math.min(maeRoi, roiWorst);
    if (roiBest != null) mfeRoi = mfeRoi == null ? roiBest : Math.max(mfeRoi, roiBest);
    peakUPnl = Math.max(peakUPnl, uPnlMark);
    const stopLevel = cand.stopPct != null ? entry * (1 - sideSign(cand.side) * cand.stopPct) : null;
    const tgtLevel = cand.targetPct != null ? entry * (1 + sideSign(cand.side) * cand.targetPct) : null;
    const stopHit = stopLevel != null && (cand.side === "long" ? worst <= stopLevel : worst >= stopLevel);
    const targetHit = tgtLevel != null && (cand.side === "long" ? best >= tgtLevel : best <= tgtLevel);
    const liqHit = markPosition(pos, mark).liquidated || isLiquidated(cand.side, worst, pos.liqPrice);
    let reason = null, exitRef = null;
    if (liqHit) { reason = "liquidation"; exitRef = mark; }
    else if (stopHit) {
      reason = "stop-loss";
      exitRef = cand.side === "long" ? Math.min(stopLevel, o) : Math.max(stopLevel, o); // never better than the stop
    } else if (targetHit) { reason = "take-profit"; exitRef = tgtLevel; }              // never better than the target
    else if (ts - cand.ts >= maxHoldMs) { reason = "time-stop"; exitRef = mark; }
    else if (pos.isolatedMargin > 0 && peakUPnl / pos.isolatedMargin >= cfg.v2.aggression.trailActivateRoi
      && (peakUPnl - uPnlMark) / pos.isolatedMargin >= cfg.v2.aggression.trailGiveRoi) { reason = "trailing-stop"; exitRef = mark; }
    if (!reason) { pos.mark = mark; continue; }
    const exitAction = cand.side === "long" ? "sell" : "buy";
    const notionalExit = Math.abs(pos.qty * exitRef);
    const slipExit = slippageFraction(notionalExit, cfg.slippage[market] ?? 0.02);
    const xPrice = fillPrice(exitRef, exitAction, halfSpread, slipExit);
    const gross = (xPrice - entry) * pos.qty * sideSign(cand.side);
    const exitFee = tradeFee(notionalExit, cfg.v2.perpFees.taker);
    const net = gross - exitFee; // funding omitted (see header)
    const risk = Math.abs(pos.qty * entry * (cand.stopPct ?? 0.05)) || pos.isolatedMargin;
    return {
      ...base, resolved: true, exitTs: ts, exit: xPrice, mark,
      exit_reason: reason, net_pnl: net, realized_R: net / risk,
      roi_on_margin: pos.isolatedMargin > 0 ? net / pos.isolatedMargin : null,
      hold_secs: (ts - cand.ts) / 1000,
      mae_roi: maeRoi, mfe_roi: mfeRoi, fees: entryFee + exitFee,
      barsHeld: j - cand.i,
    };
  }
  return { ...base, resolved: false, exitTs: null, exit: null, mark: pos.mark, exit_reason: "unresolved-end-of-panel", net_pnl: null, realized_R: null, roi_on_margin: null, hold_secs: null, mae_roi: maeRoi, mfe_roi: mfeRoi, fees: entryFee, barsHeld: rows.ts.length - cand.i - 1 };
}

// scripts/v2/phase11-rotation.mjs — PHASE 11: cross-sectional relative-strength
// weekly rotation. Pure, deterministic, causal, offline.
//
// This module contains NO I/O and NO randomness. Every function is a pure
// function of its arguments, so every property the pre-registered spec claims
// can be tested directly on the live objects (tests/phase11.test.mjs) rather
// than on a re-implementation.
//
// STRICT CAUSALITY. Every value computed for decision bar t is a function of
// bars 0..t of the SAME symbol only. Nothing in this module can see a future
// bar, and nothing in the ranking can see another asset's future. The leakage
// audit re-derives every feature on a truncated panel and requires bit-equality.
//
// All thresholds come from config/phase11-spec.v1.json. Nothing is invented here.
import crypto from "node:crypto";
import { tradeFee, slippageFraction, fillPrice } from "./perp.mjs";

const DAY_MS = 86400000;
const CG = { LIQUIDATION: 0, STOP: 1, TARGET: 2, TIME: 3 }; // conservative intra-bar order

// ---- deterministic primitives ------------------------------------------------

// Population standard deviation (divisor N). Returns null when undefined.
export function populationStd(xs) {
  const a = (xs || []).filter(Number.isFinite);
  if (a.length < 1) return null;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length;
  return Math.sqrt(v);
}

export function meanOf(xs) {
  const a = (xs || []).filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

export function medianOf(xs) {
  const a = (xs || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

// Simple mean of the last n values of arr ending at AND INCLUDING index k.
// Undefined (null) until the window is fully available — no partial averages.
export function smaEndingAt(arr, k, n) {
  if (!(k >= n - 1) || k >= arr.length) return null;
  let s = 0;
  for (let j = k - n + 1; j <= k; j++) {
    const v = arr[j];
    if (!Number.isFinite(v)) return null;
    s += v;
  }
  return s / n;
}

export function smaSeries(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0, ok = 0;
  for (let k = 0; k < arr.length; k++) {
    const v = arr[k];
    if (Number.isFinite(v)) { sum += v; ok += 1; }
    if (k >= n) {
      const drop = arr[k - n];
      if (Number.isFinite(drop)) { sum -= drop; ok -= 1; }
    }
    if (k >= n - 1 && ok === n) out[k] = sum / n;
  }
  return out;
}

// Spearman rank correlation. Ranks are average ranks (ties share the mean rank),
// which makes the statistic well defined when scores tie.
export function spearman(xs, ys) {
  const n = Math.min(xs?.length ?? 0, ys?.length ?? 0);
  if (n < 3) return null;
  const pairs = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  if (pairs.length < 3) return null;
  const rankOf = (idx) => {
    const sorted = pairs.map((p, i) => [p[idx], i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(pairs.length).fill(0);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let q = i; q <= j; q++) r[sorted[q][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rankOf(0), ry = rankOf(1);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < rx.length; i++) {
    cov += (rx[i] - mx) * (ry[i] - my);
    vx += (rx[i] - mx) ** 2;
    vy += (ry[i] - my) ** 2;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

// t-statistic of the mean of a series (H0: mean = 0). Uses the sample standard
// deviation as the standard error of the mean.
export function tStatOfMean(xs) {
  const a = (xs || []).filter(Number.isFinite);
  const n = a.length;
  if (n < 3) return null;
  const m = a.reduce((s, x) => s + x, 0) / n;
  const ss = a.reduce((s, x) => s + (x - m) * (x - m), 0);
  if (ss <= 0) return null;
  const s = Math.sqrt(ss / (n - 1));
  if (s === 0) return null;
  return m / (s / Math.sqrt(n));
}

export const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// ---- panel ⇄ union grid -------------------------------------------------------
// The panel is a UNION of every symbol's DAILY bars. Aligning on raw timestamps
// would be wrong: US, India and crypto bars for the SAME calendar day carry
// three different UTC clock times, which would inflate the grid ~2.4x and turn a
// 5-bar week into a 2-day week. The union grid is therefore ONE ROW PER UTC
// CALENDAR DATE, and each symbol's bar for that date is its own bar stamped on
// that date (or, when it has no bar, the most recent bar at or before it).
//
// Alignment at a grid date d uses an AS-OF (carry-forward) lookup: the symbol's
// most recent observation whose UTC date is <= d. Nothing is ever interpolated
// forward in time and a symbol with no such observation is UNAVAILABLE.
export function buildGrid(symbolsMap, order) {
  const dateOf = (ts) => new Date(ts).toISOString().slice(0, 10);
  const set = new Set();
  for (const s of order) for (const ts of symbolsMap[s]?.ts ?? []) set.add(dateOf(ts));
  const dateStr = [...set].sort();
  const dayMs = Date.UTC(...dateStr[0].split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  const ts = dateStr.map((d) => Date.parse(d + "T00:00:00Z"));
  const eff = {};        // symbol -> { open, close, srcIdx, sTs } each of length = grid length
  for (const s of order) {
    const rows = symbolsMap[s] ?? { ts: [], open: [], close: [] };
    const byDate = new Map();
    for (let i = 0; i < rows.ts.length; i++) {
      const d = dateOf(rows.ts[i]);
      byDate.set(d, i);                                  // last bar stamped on that UTC date
    }
    const open = new Array(ts.length).fill(null);
    const close = new Array(ts.length).fill(null);
    const srcIdx = new Array(ts.length).fill(-1);
    const sTs = new Array(ts.length).fill(null);
    let j = -1;
    for (let t = 0; t < ts.length; t++) {
      const here = byDate.get(dateStr[t]);
      if (here != null) j = here;
      if (j < 0) continue;
      open[t] = rows.open?.[j] ?? null;
      close[t] = rows.close?.[j] ?? null;
      srcIdx[t] = j;
      sTs[t] = rows.ts[j];
    }
    eff[s] = { open, close, srcIdx, sTs };
  }
  return { ts, dateStr, eff };
}

// ---- causal feature series -----------------------------------------------------
// For each symbol and each grid index t we precompute the three pre-registered
// features. The windows are measured on the symbol's OWN observation indices
// (NOT on grid indices), so a stock's 60-day return spans 60 exchange sessions
// and is never stretched by weekends or holidays. Only the FINAL mapping to the
// decision grid uses carry-forward, which is causal by construction.
//
// localIndex[t] = number of the symbol's own observations up to and including the
// observation effective at t. This is exactly the "sufficient history" counter
// the eligibility rule uses.
export function computeFeatures({ eff, tsLen, lookback, smaN = 200, warmup }) {
  const out = {};                        // symbol -> { ret, vol, sma200, above, localIndex }
  for (const s of Object.keys(eff)) {
    const { close, srcIdx } = eff[s];
    const ret = new Array(tsLen).fill(null);
    const vol = new Array(tsLen).fill(null);
    const sma200 = new Array(tsLen).fill(null);
    const localIndex = new Array(tsLen).fill(0);
    const firstAt = eff[s]._firstAt;

    // per-own-observation simple returns r(j) = c(j) / c(j-1) - 1
    const maxOwn = (srcIdx || []).reduce((a, v) => Math.max(a, v), -1) + 1;
    const ownRet = new Array(Math.max(1, maxOwn)).fill(null);
    for (let j = 1; j < maxOwn; j++) {
      const g = firstAt?.[j], gPrev = firstAt?.[j - 1];
      const a = g == null || g < 0 ? null : close[g];
      const b = gPrev == null || gPrev < 0 ? null : close[gPrev];
      if (Number.isFinite(a) && Number.isFinite(b) && b > 0) ownRet[j] = a / b - 1;
    }

    for (let t = 0; t < tsLen; t++) {
      const li = (srcIdx[t] ?? -1) + 1;                   // # of own observations up to and incl. t
      localIndex[t] = Math.max(0, li);
      if (li <= 0) continue;
      if (li - 1 >= lookback) {
        const cNow = close[t];
        const gThen = firstAt?.[li - 1 - lookback];
        const cThen = gThen == null || gThen < 0 ? null : close[gThen];
        if (Number.isFinite(cNow) && Number.isFinite(cThen) && cThen > 0) ret[t] = cNow / cThen - 1;
        const win = [];
        for (let q = li - lookback; q <= li - 1; q++) if (ownRet[q] != null) win.push(ownRet[q]);
        if (win.length === lookback) vol[t] = populationStd(win);
      }
      const s200 = smaOwn(eff[s], li - 1, smaN);
      if (s200 != null) sma200[t] = s200;
    }
    const above = new Array(tsLen).fill(false);
    for (let t = 0; t < tsLen; t++) {
      above[t] = Number.isFinite(sma200[t]) && Number.isFinite(close[t]) && close[t] > sma200[t];
    }
    out[s] = { ret, vol, sma200, above, localIndex };
  }
  return out;
}

function smaOwn(effSym, ownIndex, n) {
  if (ownIndex < n - 1) return null;
  const firstAt = effSym._firstAt;
  let s = 0;
  for (let q = ownIndex - n + 1; q <= ownIndex; q++) {
    const g = firstAt?.[q];
    const v = g == null || g < 0 ? null : effSym.close[g];
    if (!Number.isFinite(v)) return null;
    s += v;
  }
  return s / n;
}

// attach the first-grid-index-at-each-own-index lookup to a grid's effective rows
export function attachFirstAt(grid, order) {
  for (const s of order) {
    const e = grid.eff[s];
    const maxOwn = (e.srcIdx || []).reduce((a, v) => Math.max(a, v), -1) + 1;
    const firstAt = new Int32Array(Math.max(1, maxOwn)).fill(-1);
    for (let t = 0; t < e.srcIdx.length; t++) {
      const li = e.srcIdx[t];
      if (li >= 0 && firstAt[li] === -1) firstAt[li] = t;
    }
    e._firstAt = firstAt;
  }
  return grid;
}

// ---- eligibility + cross-sectional rank ---------------------------------------
// Pure function of the decision bar. `features` = computeFeatures output.
// Returns the eligible set with scores, plus the deterministic real ranking.
export function eligibleAt({ symbols, features, t, warmup }) {
  const rows = [];
  for (const s of symbols) {
    const f = features[s];
    if (!f) continue;
    if (!(f.localIndex[t] >= warmup)) continue;          // sufficient history
    const vol = f.vol[t];
    const ret = f.ret[t];
    if (!Number.isFinite(vol) || vol <= 0) continue;      // score undefined
    if (!Number.isFinite(ret)) continue;
    const score = ret / vol;
    if (!(score > 0)) continue;                          // positive score required
    if (!f.above[t]) continue;                           // absolute trend gate
    rows.push({ symbol: s, score, ret, vol });
  }
  // deterministic real ranking: score DESC, then symbol ASC
  rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  return rows;
}

// ---- deterministic shuffled-rank control --------------------------------------
// The eligible universe is held EXACTLY FIXED. Each eligible symbol gets a tag
// h = sha256(salt | barIndex | symbol); the symbols are sorted by (h ASC, symbol
// ASC) and that order is imposed on the original top-K SELECTION. The permutation
// consumes ONLY the salt, the bar index and the eligible symbol list — it cannot
// read a score, a return or a rank, so no strategy output can leak into it.
export function shuffledOrder(eligible, { salt, barIndex }) {
  return eligible
    .map((e, i) => ({ e, i, h: sha256Hex(`${salt}|${barIndex}|${e.symbol}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i))
    .map((x) => x.e);
}

// ---- portfolio construction ---------------------------------------------------
// Long-only, top-K, inverse-volatility, normalized to 1, remainder in CASH.
// `eligible` is the ordered candidate list (real ranking or shuffled ranking).
// The function is defensive about ordering: it re-applies the pre-registered
// deterministic order (score DESC, then symbol ASC) so that a caller cannot
// accidentally depend on an unordered input. For a shuffled call the caller has
// already imposed the permutation, so `preserveOrder` is used to keep it.
export function selectBook({ eligible, topK, cashRemainder = true, preserveOrder = false }) {
  const ordered = preserveOrder
    ? eligible
    : eligible.slice().sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const selected = ordered.slice(0, Math.min(topK, ordered.length));
  const weights = new Map();
  if (!selected.length) return { selected: [], weights, invested: 0 };
  const inv = selected.map((e) => (Number.isFinite(e.vol) && e.vol > 0 ? 1 / e.vol : 0));
  const sum = inv.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return { selected: [], weights, invested: 0 };
  for (let i = 0; i < selected.length; i++) weights.set(selected[i].symbol, inv[i] / sum);
  const invested = cashRemainder ? 1 : weights.size / Math.max(1, topK);
  return { selected: selected.map((e) => e.symbol), weights, invested };
}

// ---- position book + turnover-aware costs -------------------------------------
// A position keeps its UNITS unless it is traded, so weights drift with prices.
// The traded notional at a rebalance is the sum of |targetWeight - driftedWeight|,
// charged with the frozen adverse-fill cost primitives on each traded leg.
export function applyRebalance({ book, targetWeights, priceOf, marketOf, equity, cfg, costMultiplier = 1.0, band = 1e-6, bandRelative = true, tradeUsd = true }) {
  // `band` is an absolute notional below which a fill is treated as a
  // floating-point artefact rather than an order. `bandRelative` (the production
  // convention, used by every arm of the experiment) scales that floor by
  // max(1, equity) so the no-trade zone is a fraction OF THE BOOK. Setting
  // `bandRelative` to false uses the floor as an absolute notional and exists so
  // the band can be tested at a scale where it is actually observable.
  const openSymbols = Object.keys(book).sort();
  const targetSymbols = [...targetWeights.keys()].sort();
  const all = [...new Set([...openSymbols, ...targetSymbols])].sort();

  const feeRate = (cfg?.v2?.perpFees?.taker ?? 0.0005) * costMultiplier;
  const legs = [];
  let tradedNotional = 0, fees = 0, slip = 0, entryNotional = 0, exitNotional = 0;

  // legs are priced against the current mark so the traded notional is real
  const currentNotionalOf = (s) => {
    const p = Number.isFinite(priceOf(s)) ? priceOf(s) : null;
    const cur = book[s];
    if (!cur || p == null) return 0;
    return cur.qty * p;
  };
  const totalCurrentNotional = all.reduce((a, s) => a + currentNotionalOf(s), 0);

  for (const s of all) {
    const market = marketOf(s);
    const p = Number.isFinite(priceOf(s)) ? priceOf(s) : null;
    const cur = book[s] ?? null;
    const curNotional = cur && p != null ? cur.qty * p : 0;
    const tgtW = targetWeights.get(s) ?? 0;
    const tgtNotional = equity * tgtW;
    const targetQty = p != null && p > 0 ? tgtNotional / p : 0;
    const curQty = cur?.qty ?? 0;
    const dQty = targetQty - curQty;
    const dNotional = Math.abs(dQty * (p ?? 0));
    const bandFloor = bandRelative ? band * Math.max(1, equity) : band;
    if (dNotional <= 0 || (p != null && dNotional < bandFloor)) {
      if (cur) book[s] = { qty: curQty, entryPrice: cur.entryPrice };
      continue;
    }
    const side = dQty > 0 ? "buy" : "sell";
    const slipCfg = cfg?.slippage?.[market] ?? 0.0005;
    const halfSpread = (slipCfg / 2) * costMultiplier;
    const impact = slippageFraction(dNotional === 0 ? 1 : dNotional, slipCfg) * costMultiplier;
    const fill = fillPrice(p, side, halfSpread, impact);
    const legFee = tradeFee(dNotional, feeRate);
    const legSlip = Math.abs(fill - p) * Math.abs(dQty);
    if (side === "buy") entryNotional += dNotional; else exitNotional += dNotional;
    tradedNotional += dNotional;
    fees += legFee;
    slip += legSlip;
    const newQty = targetQty;
    if (newQty <= 0) delete book[s];
    else book[s] = { qty: newQty, entryPrice: side === "buy" ? fill : (cur?.entryPrice ?? fill) };
    legs.push({ symbol: s, market, side, notional: dNotional, fee: legFee, slip: legSlip, fill });
  }
  const cost = fees + slip;
  let cashDragNote = null;
  if (legs.length) {
    const investedAfter = all.reduce((a, s) => {
      const tgtW = targetWeights.get(s) ?? 0;
      return a + tgtW;
    }, 0);
    if (investedAfter < 1 - 1e-9) cashDragNote = 1 - investedAfter;
  }
  return { legs, tradedNotional, fees, slip, cost, entryNotional, exitNotional, cashDragNote, totalCurrentNotional, band, tradeUsd };
}

// Mark-to-market equity of a book at one grid index.
export function equityAt(book, cash, priceOf) {
  let v = cash;
  for (const s of Object.keys(book)) {
    const p = priceOf(s);
    if (Number.isFinite(p)) v += book[s].qty * p;
  }
  return v;
}

// ---- the rotation engine -------------------------------------------------------
// One generic, parameterised weekly-rotation backtest. Every arm in the
// experiment (canonical, perturbations, cost stress, delayed execution, shuffled
// control, holding-period variant, baselines B1/B2) is a parameterisation of
// this single function, which is what makes the comparisons like-for-like.
//
// Selection is computed at DECISION bar t from features at t (causal). Execution
// happens either at t's own close (primary) or at the next grid date's open
// (1-day-delayed robustness arm). The book keeps its UNITS between decisions, so
// weights drift with prices and the traded notional is the genuine delta.
export function runRotation({
  grid, features, symbols, marketOf, cfg, spec,
  topK, holdingDays, costMultiplier = 1.0,
  execution = "close",            // "close" | "nextOpen"
  shuffle = false,
  excludedSymbols = null,         // per-asset leave-one-out contribution
  weighting = "inverseVol",       // "inverseVol" | "equal"
  requirePositiveScore = true,
  requireTrendGate = true,
  policyStart = 0,
  policyEnd = null,
  warmup,
  salt = null,
}) {
  const tsLen = grid.ts.length;
  const end = policyEnd == null ? tsLen : Math.min(tsLen, policyEnd);
  const every = Math.max(1, Math.round(holdingDays));
  const band = spec?.costModel?.turnoverNoTradeBand ?? 1e-6;
  const startEquity = spec?.costModel?.notionalBaseUsd ?? 10000;
  const executionSide = (side) => side;

  const exIdxOf = (t) => (execution === "nextOpen" ? Math.min(tsLen - 1, t + 1) : t);
  const priceOfAt = (t) => (s) => {
    const e = grid.eff[s];
    if (!e) return null;
    const v = execution === "nextOpen" ? e.open?.[t] : e.close?.[t];
    const v2 = Number.isFinite(v) ? v : e.close?.[t];
    return Number.isFinite(v2) ? v2 : null;
  };

  const computeEligible = (t) => {
    let rows = [];
    for (const s of symbols) {
      if (excludedSymbols && excludedSymbols.includes(s)) continue;
      const f = features[s];
      if (!f) continue;
      if (!(f.localIndex[t] >= warmup)) continue;
      const vol = f.vol[t], ret = f.ret[t];
      if (!Number.isFinite(vol) || vol <= 0) continue;
      if (!Number.isFinite(ret)) continue;
      const score = ret / vol;
      if (requirePositiveScore && !(score > 0)) continue;
      if (requireTrendGate && !f.above[t]) continue;
      rows.push({ symbol: s, score, ret, vol });
    }
    rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    return rows;
  };

  const computeBook = (t, eligible) => {
    const base = shuffle ? shuffledOrder(eligible, { salt, barIndex: t }) : eligible;
    const selected = base.slice(0, Math.min(topK, base.length));
    const weights = new Map();
    if (!selected.length) return { base, selected: [], weights, invested: 0 };
    const k = (e) => (weighting === "equal" ? 1 : (Number.isFinite(e.vol) && e.vol > 0 ? 1 / e.vol : 0));
    const vals = selected.map(k);
    const sum = vals.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return { base, selected: [], weights, invested: 0 };
    for (let i = 0; i < selected.length; i++) weights.set(selected[i].symbol, vals[i] / sum);
    return { base, selected: selected.map((e) => e.symbol), weights, invested: 1 };
  };

  const book = {};
  let cash = startEquity;
  const days = [];
  const decisions = [];

  // ---- week 0: build the initial book at policyStart's execution price
  const initT = policyStart;
  const initPx = priceOfAt(exIdxOf(initT));
  const initEligible = computeEligible(initT);
  const initSel = computeBook(initT, initEligible);
  {
    const rb = applyRebalance({
      book, targetWeights: initSel.weights, priceOf: initPx, marketOf,
      equity: startEquity, cfg, costMultiplier, band,
    });
    cash = startEquity - initSel.invested * startEquity - rb.cost;
    decisions.push({
      t: initT, exIdx: exIdxOf(initT), utc: new Date(grid.ts[initT]).toISOString().slice(0, 10),
      kind: "entry", eligible: initEligible.map((e) => e.symbol), eligibleRows: initEligible,
      selected: initSel.selected, weights: initSel.weights, invested: initSel.invested,
      tradedNotional: rb.tradedNotional, cost: rb.cost, fees: rb.fees, slip: rb.slip, legs: rb.legs.length,
    });
  }

  for (let t = initT; t < end; t++) {
    if ((t - initT) % every === 0 && t !== initT) {
      const ex = exIdxOf(t);
      const px = priceOfAt(ex);
      const equity = equityAt(book, cash, px);
      const eligible = computeEligible(t);
      const sel = computeBook(t, eligible);
      const rb = applyRebalance({
        book, targetWeights: sel.weights, priceOf: px, marketOf, equity, cfg, costMultiplier, band,
      });
      cash = equity - sel.invested * equity - rb.cost;
      decisions.push({
        t, exIdx: ex, utc: new Date(grid.ts[t]).toISOString().slice(0, 10), kind: "rebalance",
        eligible: eligible.map((e) => e.symbol), eligibleRows: eligible,
        selected: sel.selected, weights: sel.weights, invested: sel.invested,
        tradedNotional: rb.tradedNotional, cost: rb.cost, fees: rb.fees, slip: rb.slip, legs: rb.legs.length,
      });
    }
    const px = priceOfAt(t);
    days.push({ t, date: new Date(grid.ts[t]).toISOString().slice(0, 10), equity: equityAt(book, cash, px), cost: 0, invested: bookInvested(book, cash, px) });
  }

  // ---- realised holdings between consecutive rebalances (for per-trade stats)
  const tradeLegs = [];
  for (let d = 0; d < decisions.length - 1; d++) {
    const cur = decisions[d], nxt = decisions[d + 1];
    const entryIdx = cur.exIdx, exitIdx = nxt.exIdx;
    for (const s of cur.selected) {
      const pIn = grid.eff[s]?.close?.[entryIdx];
      const pOut = grid.eff[s]?.close?.[exitIdx];
      if (!Number.isFinite(pIn) || !Number.isFinite(pOut) || pIn <= 0) continue;
      const w = cur.weights.get(s);
      const notional = w * startEquity;
      const grossRet = pOut / pIn - 1;
      tradeLegs.push({
        symbol: s, market: marketOf(s), decisionT: cur.t, entryIdx, exitIdx,
        entryUtc: cur.utc, exitUtc: nxt.utc, weight: w, notional,
        grossRet, gross: notional * grossRet, cost: 0, net: notional * grossRet,
      });
    }
    // charge each rebalance's cost pro-rata on the exiting/entering weights so
    // per-trade economics include their share of friction
    const shares = [];
    for (const s of new Set([...cur.selected, ...nxt.selected])) {
      const wIn = cur.weights.get(s) ?? 0;
      const wOut = nxt.weights.get(s) ?? 0;
      const traded = Math.abs(wOut - wIn) || 0;
      shares.push([s, traded]);
    }
    const totTraded = shares.reduce((a, [, v]) => a + v, 0);
    if (totTraded > 0) {
      const costPerW = nxt.cost / totTraded;
      for (const leg of tradeLegs) {
        if (leg.decisionT !== cur.t) continue;
        const traded = shares.find(([s]) => s === leg.symbol)?.[1] ?? 0;
        leg.cost = traded * costPerW * (startEquity / Math.max(1e-9, leg.notional)) * leg.notional / startEquity;
        leg.cost = traded * costPerW;
        leg.net = leg.gross - leg.cost;
      }
    }
  }
  // the final holding is exited at the last available close (mark-to-market)
  const lastD = decisions.at(-1);
  if (lastD) {
    const exitIdx = Math.min(tsLen - 1, end - 1);
    for (const s of lastD.selected) {
      const pIn = grid.eff[s]?.close?.[lastD.exIdx];
      const pOut = grid.eff[s]?.close?.[exitIdx];
      if (!Number.isFinite(pIn) || !Number.isFinite(pOut) || pIn <= 0) continue;
      const w = lastD.weights.get(s);
      const notional = w * startEquity;
      const grossRet = pOut / pIn - 1;
      tradeLegs.push({
        symbol: s, market: marketOf(s), decisionT: lastD.t, entryIdx: lastD.exIdx, exitIdx,
        entryUtc: lastD.utc, exitUtc: new Date(grid.ts[exitIdx]).toISOString().slice(0, 10),
        weight: w, notional, grossRet, gross: notional * grossRet, cost: 0, net: notional * grossRet,
      });
    }
  }

  return { days, decisions, tradeLegs };
}

function bookInvested(book, cash, priceOf) {
  let v = 0;
  for (const s of Object.keys(book)) {
    const p = priceOf(s);
    if (Number.isFinite(p)) v += book[s].qty * p;
  }
  return v;
}

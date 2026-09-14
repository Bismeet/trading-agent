// scripts/v2/alpha-features.mjs — ALPHA RESEARCH: causal feature layer.
//
// STRICT CAUSALITY: every value returned for bar k is a function of bars 0..k
// only (the decision bar is the last *completed* hourly bar). Nothing in this
// module can see a future bar; tests/alpha.test.mjs verifies this by recomputing
// features on a rows slice truncated at bar k and asserting bit-equality.
//
// Everything is deterministic and closed-form: no randomness, no training, no
// fitted parameters. All thresholds come from config/alpha-experiment-spec.v1.json.
import { slippageFraction } from "./perp.mjs";

export const HOURLY_MS = 3600000;
export const utcDateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---- rolling window primitives (O(n) monotonic deque) ------------------------
// Returns the maximum of arr over [k - w, k - 1] (strictly PRIOR window).
// NaN while the window is not yet fully available. This is what makes
// "breakout of the prior N bars" causal and free of self-inclusion.
export function rollingPriorMax(arr, w) {
  const n = arr.length;
  const out = new Float64Array(n).fill(NaN);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let k = 0; k < n; k++) {
    const add = k - 1;
    if (add >= 0) {
      while (tail > head && arr[dq[tail - 1]] <= arr[add]) tail--;
      dq[tail++] = add;
    }
    const lo = k - w;
    while (tail > head && dq[head] < lo) head++;
    if (k >= w && tail > head) out[k] = arr[dq[head]];
  }
  return out;
}

export function rollingPriorMin(arr, w) {
  const n = arr.length;
  const out = new Float64Array(n).fill(NaN);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let k = 0; k < n; k++) {
    const add = k - 1;
    if (add >= 0) {
      while (tail > head && arr[dq[tail - 1]] >= arr[add]) tail--;
      dq[tail++] = add;
    }
    const lo = k - w;
    while (tail > head && dq[head] < lo) head++;
    if (k >= w && tail > head) out[k] = arr[dq[head]];
  }
  return out;
}

// Mean of arr over the strictly prior window [k - w, k - 1].
export function rollingPriorMean(arr, w) {
  const n = arr.length;
  const out = new Float64Array(n).fill(NaN);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const add = k - 1;
    if (add >= 0) sum += arr[add];
    const drop = k - 1 - w;
    if (drop >= 0) sum -= arr[drop];
    if (k >= w) out[k] = sum / w;
  }
  return out;
}

// Rolling simple moving average over a window ending AT index k (inclusive).
export function rollingSma(arr, w) {
  const n = arr.length;
  const out = new Float64Array(n).fill(NaN);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    sum += arr[k];
    if (k >= w) sum -= arr[k - w];
    if (k >= w - 1) out[k] = sum / w;
  }
  return out;
}

// ---- cost model (identical primitives to production) -------------------------
// Round-trip cost as a FRACTION OF NOTIONAL: taker fee on both legs plus two
// adverse fills (half spread + square-root market impact). This is the single
// number a favourable move must beat before a signal has any economic value.
export function roundTripCostFraction({ cfg, market, marginUsd, leverage, spec, costMultiplier = 1.0 }) {
  const slipCfg = cfg?.slippage?.[market] ?? (spec?.costModel?.slippageByMarket?.[market] ?? 0.0005);
  const notional = Math.max(0, marginUsd) * Math.max(1, leverage);
  const impact = slippageFraction(notional, slipCfg);
  const halfSpread = slipCfg / 2;
  const adverse = 2 * (halfSpread + impact) * costMultiplier;
  const taker = (spec?.costModel?.takerFee ?? cfg?.v2?.perpFees?.taker ?? 0.0005) * costMultiplier;
  return taker * 2 + adverse;
}

export function expectedMoveFraction({ atrNorm, horizonHours, spec }) {
  if (!Number.isFinite(atrNorm) || atrNorm <= 0) return 0;
  const mult = spec?.expectedMoveModel?.multiplier ?? 1.0;
  return mult * atrNorm * Math.sqrt(Math.max(0, horizonHours));
}

// ---- daily context (causal, O(1) per bar via monotone pointer) ---------------
// For an hourly bar, the daily context is the LAST COMPLETED daily bar strictly
// before the bar's UTC date. The current (incomplete) daily bar is never used.
export function buildDailyContext(dailyRows, hourTs, spec) {
  const fastN = spec?.featureThresholds?.dailySmaFastN ?? 50;
  const slowN = spec?.featureThresholds?.dailySmaSlowN ?? 200;
  const n = hourTs.length;
  const dClose = dailyRows?.close ?? [];
  const dTs = dailyRows?.ts ?? [];
  const smaFast = rollingSma(dClose, fastN);
  const smaSlow = rollingSma(dClose, slowN);
  const map = new Int32Array(n).fill(-1);   // index of last completed daily bar, or -1
  const above50 = new Uint8Array(n);
  const above200 = new Uint8Array(n);
  const dir = new Int8Array(n);             // +1 above fast SMA, -1 below, 0 unknown
  const prevDate = new Uint8Array(n);       // 1 = first hourly bar of a new UTC date
  let ptr = 0;
  let lastDate = null;
  for (let k = 0; k < n; k++) {
    const day = utcDateOf(hourTs[k]);
    if (day !== lastDate) { prevDate[k] = 1; lastDate = day; }
    while (ptr < dTs.length && utcDateOf(dTs[ptr]) < day) ptr++;
    if (ptr <= 0) { map[k] = -1; continue; }
    map[k] = ptr - 1;
    const f = smaFast[ptr - 1];
    if (Number.isFinite(f)) {
      dir[k] = dClose[ptr - 1] > f ? 1 : -1;
      above50[k] = 1;
    }
    const s = smaSlow[ptr - 1];
    if (Number.isFinite(s)) {
      above200[k] = dClose[ptr - 1] > s ? 1 : 0;
    }
  }
  return { map, above50, above200, dir };
}

// ---- per-symbol causal series precomputation ---------------------------------
export function precomputeAlphaSeries({ rows, dailyRows, spec }) {
  const n = rows.close.length;
  const lb = [...(spec?.featureThresholds?.breakoutLookbacks ?? [4, 24, 48])];
  if (spec?.benchmarkDonchian?.lookbackHours && !lb.includes(spec.benchmarkDonchian.lookbackHours)) {
    lb.push(spec.benchmarkDonchian.lookbackHours);   // benchmark channel (hourly-scale production donchian)
  }
  const atrFastN = spec?.featureThresholds?.atrFastN ?? 14;
  const atrSlowN = spec?.featureThresholds?.atrSlowN ?? 50;
  const wShort = spec?.featureThresholds?.compressionShortWindow ?? 48;
  const wLong = spec?.featureThresholds?.compressionLongWindow ?? 240;
  const wVol = spec?.featureThresholds?.volRatioWindow ?? 240;

  // True range and ATR (simple average of TR over the PRIOR window, causal).
  const tr = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    if (k === 0) { tr[k] = rows.high[k] - rows.low[k]; continue; }
    const pc = rows.close[k - 1];
    tr[k] = Math.max(rows.high[k] - rows.low[k], Math.abs(rows.high[k] - pc), Math.abs(rows.low[k] - pc));
  }
  const atr14 = rollingPriorMean(tr, atrFastN);
  const atr50 = rollingPriorMean(tr, atrSlowN);

  const rets = {};
  for (const h of [4, 24, 72]) {
    const r = new Float64Array(n).fill(NaN);
    for (let k = h; k < n; k++) {
      const base = rows.close[k - h];
      if (base > 0) r[k] = rows.close[k] / base - 1;
    }
    rets[h] = r;
  }

  const priorMax = {};
  const priorMin = {};
  for (const L of lb) {
    priorMax[L] = rollingPriorMax(rows.high, L);
    priorMin[L] = rollingPriorMin(rows.low, L);
  }

  // Structure: prior short-window channel width vs prior long-window width.
  const hShort = rollingPriorMax(rows.high, wShort);
  const lShort = rollingPriorMin(rows.low, wShort);
  const hLong = rollingPriorMax(rows.high, wLong);
  const lLong = rollingPriorMin(rows.low, wLong);
  const rangeCompression = new Float64Array(n).fill(NaN);
  const rangeShort = new Float64Array(n).fill(NaN);
  const rangeLong = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(hShort[k]) || !Number.isFinite(hLong[k])) continue;
    const s = hShort[k] - lShort[k];
    const l = hLong[k] - lLong[k];
    rangeShort[k] = s;
    rangeLong[k] = l;
    if (l > 0) rangeCompression[k] = s / l;
  }

  // Candle quality of the decision bar itself.
  const bodyRatio = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    const rng = rows.high[k] - rows.low[k];
    bodyRatio[k] = rng > 0 ? Math.abs(rows.close[k] - rows.open[k]) / rng : 0;
  }

  // atrNorm = hourly ATR as a fraction of price; volExpansion = fast/slow ATR.
  const atrNorm = new Float64Array(n).fill(NaN);
  const volExpansion = new Float64Array(n).fill(NaN);
  const volRatio = new Float64Array(n).fill(NaN);
  for (let k = 0; k < n; k++) {
    if (rows.close[k] > 0 && Number.isFinite(atr14[k])) atrNorm[k] = atr14[k] / rows.close[k];
    if (Number.isFinite(atr14[k]) && Number.isFinite(atr50[k]) && atr50[k] > 0) volExpansion[k] = atr14[k] / atr50[k];
  }
  const volNormMean = rollingPriorMean(atrNorm, wVol);
  for (let k = 0; k < n; k++) {
    if (Number.isFinite(atrNorm[k]) && Number.isFinite(volNormMean[k]) && volNormMean[k] > 0) {
      volRatio[k] = atrNorm[k] / volNormMean[k];
    }
  }

  const daily = buildDailyContext(dailyRows, rows.ts, spec);

  return { n, tr, atr14, atr50, atrNorm, volExpansion, volRatio, rets, priorMax, priorMin, rangeCompression, rangeShort, rangeLong, bodyRatio, daily };
}

// ---- causal feature snapshot for one bar ------------------------------------
// Side-relative features (alignment, breakout distance, quality) are computed
// for the side being contemplated. Reference for entries is rows.close[k].
export function alphaFeaturesAt(series, rows, k, { side = "long", horizonHours = 48, cfg, market, spec } = {}) {
  const sgn = side === "long" ? 1 : -1;
  const f = spec?.featureThresholds ?? {};
  const close = rows.close[k];
  const atrN = series.atrNorm[k];
  const r4 = series.rets[4][k], r24 = series.rets[24][k], r72 = series.rets[72][k];

  // Volatility-normalised 24h displacement (dimensionless, market-agnostic).
  const z24 = Number.isFinite(r24) && Number.isFinite(atrN) && atrN > 0 ? r24 / (atrN * Math.sqrt(24)) : NaN;

  const bd = {};       // breakout flag per lookback (close beyond prior channel)
  const bdAtr = {};    // breakout distance beyond the prior channel, in ATR units
  for (const L of (f.breakoutLookbacks ?? [4, 24, 48])) {
    const lvl = side === "long" ? series.priorMax[L][k] : series.priorMin[L][k];
    const ok = Number.isFinite(lvl) && Number.isFinite(atrN) && atrN > 0;
    const beyond = ok ? sgn * (close - lvl) : NaN;
    bd[L] = ok ? beyond > 0 : false;
    bdAtr[L] = ok ? beyond / series.atr14[k] : NaN;
  }
  const anyBreakout = Object.values(bd).some(Boolean);
  const breakoutDistAtr = Number.isFinite(bdAtr[48]) ? bdAtr[48] : NaN;

  const mid48 = Number.isFinite(series.priorMax[48][k]) && Number.isFinite(series.priorMin[48][k])
    ? (series.priorMax[48][k] + series.priorMin[48][k]) / 2
    : NaN;
  const distFromMidAtr = Number.isFinite(mid48) && Number.isFinite(series.atr14[k]) && series.atr14[k] > 0
    ? (sgn * (close - mid48)) / series.atr14[k]
    : NaN;

  const trendDir = series.daily.dir[k];                 // daily trend state: +1 / -1 / 0 unknown
  const dailyTrendAgree = trendDir === 0 ? NaN : (trendDir === sgn ? 1 : 0);
  const above200 = series.daily.above200[k] === 1;

  const finiteRets = [r4, r24, r72].filter((r) => Number.isFinite(r));
  const agree = finiteRets.filter((r) => Math.sign(r) === sgn).length;
  const trendAlignment = finiteRets.length > 0 ? agree / finiteRets.length : 0;

  // Regimes — every label is a closed-form function of this bar's causal features.
  const absZ = Number.isFinite(z24) ? Math.abs(z24) : 0;
  const trendRegime = absZ >= (f.strongTrendZ ?? 1.5) ? "strong_trend" : absZ >= (f.weakTrendZ ?? 0.5) ? "weak_trend" : "range";
  const regimeDirection = !Number.isFinite(r24) ? 0 : Math.sign(r24);
  const vr = series.volRatio[k];
  const volRegime = !Number.isFinite(vr) ? "unknown_vol" : vr >= (f.volRegimeHighRatio ?? 1.5) ? "high_vol" : vr <= (f.volRegimeLowRatio ?? 0.7) ? "low_vol" : "normal_vol";
  const ve = series.volExpansion[k];
  const rc = series.rangeCompression[k];
  const structureRegime = Number.isFinite(ve) && ve >= (f.expansionVolRatio ?? 1.3)
    ? "expansion"
    : Number.isFinite(rc) && rc <= (f.compressionRegimeMax ?? 0.65) && Number.isFinite(ve) && ve < (f.contractionVolRatio ?? 1.0)
      ? "contraction"
      : "neutral";
  const regime = structureRegime === "neutral" ? trendRegime : structureRegime;

  // Cost awareness (§4 / §14): can the expected favourable move pay for the trade?
  const costFrac = roundTripCostFraction({ cfg, market, marginUsd: spec?.costModel?.marginUsd ?? 100, leverage: spec?.strategyGeometry?.alpha_breakout?.baseLev ?? 12, spec });
  const expMoveFrac = expectedMoveFraction({ atrNorm: atrN, horizonHours, spec });
  const moveCostRatio = costFrac > 0 ? expMoveFrac / costFrac : 0;

  // Quality score components (§12) — each bounded in [0, 1].
  const breakoutQuality = !Number.isFinite(breakoutDistAtr) ? 0 : breakoutDistAtr >= 0.5 ? 1 : breakoutDistAtr > 0 ? 0.5 : 0;
  const volExpansionComp = Number.isFinite(ve) ? Math.min(1, Math.max(0, (ve - 1.0) / 0.5)) : 0;
  const mtfAgreement = (Number.isFinite(dailyTrendAgree) ? dailyTrendAgree * 0.5 : 0) + (Number.isFinite(r24) && Math.sign(r24) === sgn ? 0.5 : 0);
  const costCoverage = Math.min(1, Math.max(0, moveCostRatio / 10));

  return {
    k, ts: rows.ts[k], side, close, atrNorm: atrN, atr14: series.atr14[k],
    r4, r24, r72, z24, absZ,
    bd4: bd[4] === true, bd24: bd[24] === true, bd48: bd[48] === true,
    bdAtr4: bdAtr[4], bdAtr24: bdAtr[24], bdAtr48: bdAtr[48],
    anyBreakout, breakoutDistAtr, distFromMidAtr,
    bodyRatio: series.bodyRatio[k], volExpansion: ve, volRatio: vr,
    rangeCompression: rc, rangeShort: series.rangeShort[k], rangeLong: series.rangeLong[k],
    dailyTrendDir: trendDir, dailyTrendAgree, above200,
    trendAlignment, agreeCount: agree,
    trendRegime, volRegime, structureRegime, regime, regimeDirection,
    costFrac, expMoveFrac, moveCostRatio,
    comp: { trendAlignment, breakoutQuality, volExpansion: volExpansionComp, mtfAgreement, costCoverage },
  };
}

// Deterministic, untrained weighted quality score (spec.qualityScore).
export function qualityScore(f, spec) {
  const w = spec?.qualityScore?.weights ?? {};
  const c = f.comp ?? {};
  return (c.trendAlignment ?? 0) * (w.trendAlignment ?? 0)
    + (c.breakoutQuality ?? 0) * (w.breakoutQuality ?? 0)
    + (c.volExpansion ?? 0) * (w.volExpansion ?? 0)
    + (c.mtfAgreement ?? 0) * (w.mtfAgreement ?? 0)
    + (c.costCoverage ?? 0) * (w.costCoverage ?? 0);
}
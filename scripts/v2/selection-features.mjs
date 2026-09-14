// scripts/v2/selection-features.mjs — Phase 7 §5, §6, §7.
//
// Strictly CAUSAL pre-trade feature extraction layer.
// Computes deterministic setup-quality context features using ONLY information
// available at or before candidate entry (bar cand.i).
//
// Feature Families:
//   A. TREND: trend_direction, ma_slope, dist_from_ma, trend_strength, price_range_pos
//   B. MOMENTUM: recent_return, momentum_accel, multi_horizon_agree, breakout_dist
//   C. VOLATILITY: atr_norm, realized_vol, vol_expansion, vol_percentile
//   D. MARKET STRUCTURE: range_compression, range_expansion, breakout_quality, dist_to_recent_extrema, recent_reversal_count
//   E. LIQUIDITY / COST: expected_move, est_cost, move_to_cost_ratio
//   F. CONFIRMATION: strategy_agreement_count, trend_agree
//
// Critical Rule (§6): zero future leakage. Any feature computed at bar i
// depends strictly on bars 0..i.
import { sma } from "./store.mjs";
import { slippageFraction } from "./perp.mjs";

// ---- Single bar causal helpers ----------------------------------------------

export function trueRangeAt(rows, k) {
  const h = rows.high[k];
  const l = rows.low[k];
  if (k === 0) return h - l;
  const prevC = rows.close[k - 1];
  return Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
}

export function rollingMin(arr, start, end) {
  let m = Infinity;
  for (let k = Math.max(0, start); k <= end; k++) {
    if (arr[k] < m) m = arr[k];
  }
  return m === Infinity ? null : m;
}

export function rollingMax(arr, start, end) {
  let m = -Infinity;
  for (let k = Math.max(0, start); k <= end; k++) {
    if (arr[k] > m) m = arr[k];
  }
  return m === -Infinity ? null : m;
}

// Compute pre-trade features strictly from rows up to index i.
export function computeCausalFeatures({ cand, rows, cfg, spec, signalsAtBar = [] }) {
  const i = cand.i;
  if (i < 0 || i >= rows.ts.length) {
    throw new Error(`computeCausalFeatures: invalid index i=${i} for length=${rows.ts.length}`);
  }

  const price = rows.close[i];
  const open = rows.open[i];
  const high = rows.high[i];
  const low = rows.low[i];

  // 1. Moving averages & Trend
  const sma20 = i >= 19 ? sma(rows.close.slice(0, i + 1), 20) : price;
  const sma50 = i >= 49 ? sma(rows.close.slice(0, i + 1), 50) : sma20;
  const sma20Prev = i >= 24 ? sma(rows.close.slice(0, i - 4), 20) : sma20;
  const maSlope = sma20Prev > 0 ? (sma20 - sma20Prev) / sma20Prev : 0;
  const distFromMa = sma20 > 0 ? (price - sma20) / sma20 : 0;
  const trendDirection = price >= sma50 ? "bullish" : "bearish";

  // 2. ATR & Volatility
  const trWindow = Math.min(i + 1, 14);
  let trSum14 = 0;
  for (let k = i - trWindow + 1; k <= i; k++) {
    trSum14 += trueRangeAt(rows, k);
  }
  const atr14 = trWindow > 0 ? trSum14 / trWindow : (high - low);

  const trWindow50 = Math.min(i + 1, 50);
  let trSum50 = 0;
  for (let k = i - trWindow50 + 1; k <= i; k++) {
    trSum50 += trueRangeAt(rows, k);
  }
  const atr50 = trWindow50 > 0 ? trSum50 / trWindow50 : atr14;

  const atrNorm = price > 0 ? atr14 / price : 0;
  const volExpansion = atr50 > 0 ? atr14 / atr50 : 1.0;
  const trendStrength = atr14 > 0 ? Math.abs(price - sma50) / atr14 : 0;

  // Realized volatility (standard deviation of last 20 log returns)
  const volWindow = Math.min(i, 20);
  let realizedVol = 0;
  if (volWindow >= 2) {
    const returns = [];
    for (let k = i - volWindow + 1; k <= i; k++) {
      if (rows.close[k - 1] > 0) {
        returns.push(Math.log(rows.close[k] / rows.close[k - 1]));
      }
    }
    if (returns.length >= 2) {
      const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / (returns.length - 1);
      realizedVol = Math.sqrt(Math.max(0, variance));
    }
  }

  // Volatility percentile (quintile 1..5 over prior 100 bars)
  let volPercentile = 3;
  const histWindow = Math.min(i + 1, 100);
  if (histWindow >= 20) {
    const atrs = [];
    for (let k = i - histWindow + 1; k <= i; k++) {
      const subWindow = Math.min(k + 1, 14);
      let s = 0;
      for (let m = k - subWindow + 1; m <= k; m++) s += trueRangeAt(rows, m);
      atrs.push(s / subWindow);
    }
    const sorted = atrs.slice().sort((a, b) => a - b);
    const rank = sorted.filter((v) => v < atr14).length / sorted.length;
    volPercentile = Math.min(5, Math.max(1, Math.floor(rank * 5) + 1));
  }

  // 3. Range extrema & Market Structure
  const minLow10 = rollingMin(rows.low, i - 9, i);
  const maxHigh10 = rollingMax(rows.high, i - 9, i);
  const minLow20 = rollingMin(rows.low, i - 19, i);
  const maxHigh20 = rollingMax(rows.high, i - 19, i);
  const minLow50 = rollingMin(rows.low, i - 49, i);
  const maxHigh50 = rollingMax(rows.high, i - 49, i);

  const range20 = (maxHigh20 ?? high) - (minLow20 ?? low);
  const priceRangePos = range20 > 0 ? Math.min(1, Math.max(0, (price - (minLow20 ?? low)) / range20)) : 0.5;

  const range10 = (maxHigh10 ?? high) - (minLow10 ?? low);
  const range50 = (maxHigh50 ?? high) - (minLow50 ?? low);
  const rangeCompression = range50 > 0 ? range10 / range50 : 1.0;
  const rangeExpansion = atr14 > 0 ? (high - low) / atr14 : 1.0;
  const breakoutQuality = (high - low) > 0 ? Math.abs(price - open) / (high - low) : 0.5;

  const distToExtrema = price > 0
    ? Math.min(Math.abs(price - (maxHigh20 ?? price)), Math.abs(price - (minLow20 ?? price))) / price
    : 0;

  // Recent reversals (sign changes in consecutive returns over last 10 bars)
  let reversalCount = 0;
  let lastSign = 0;
  for (let k = Math.max(1, i - 9); k <= i; k++) {
    const diff = rows.close[k] - rows.close[k - 1];
    const sgn = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sgn !== 0 && lastSign !== 0 && sgn !== lastSign) {
      reversalCount += 1;
    }
    if (sgn !== 0) lastSign = sgn;
  }

  // 4. Momentum
  const close5 = i >= 5 ? rows.close[i - 5] : price;
  const close10 = i >= 10 ? rows.close[i - 10] : close5;
  const close20 = i >= 20 ? rows.close[i - 20] : close10;

  const recentReturn = close5 > 0 ? (price - close5) / close5 : 0;
  const priorReturn = close10 > 0 ? (close5 - close10) / close10 : 0;
  const momentumAccel = recentReturn - priorReturn;
  const ret20 = close20 > 0 ? (price - close20) / close20 : 0;
  const multiHorizonAgree = (recentReturn >= 0 && ret20 >= 0) || (recentReturn <= 0 && ret20 <= 0);

  const priorHigh20 = rollingMax(rows.high, i - 20, i - 1) ?? high;
  const priorLow20 = rollingMin(rows.low, i - 20, i - 1) ?? low;
  const breakoutDist = cand.side === "long"
    ? (price > 0 ? (price - priorHigh20) / price : 0)
    : (price > 0 ? (priorLow20 - price) / price : 0);

  // 5. Liquidity & Estimated Transaction Cost
  const market = cand.market || "crypto";
  const takerFee = cfg?.v2?.perpFees?.taker ?? 0.0005;
  const spread = cfg?.slippage?.[market] ?? 0.001;
  const marginUsd = 100;
  const baseLev = cand.baseLev || 10;
  const notional = marginUsd * baseLev;
  const adverseSlip = slippageFraction(notional, spread);
  // Round trip friction as percentage of price
  const roundTripCostPct = (2 * takerFee) + spread + (2 * adverseSlip);
  const expectedMove = atrNorm;
  const moveToCostRatio = roundTripCostPct > 0 ? expectedMove / roundTripCostPct : 0;

  // 6. Cross-strategy confirmation & Trend alignment
  const trendAgree = (cand.side === "long" && trendDirection === "bullish")
    || (cand.side === "short" && trendDirection === "bearish");

  // Other strategies signaling matching side at this exact bar
  let agreementCount = 0;
  if (Array.isArray(signalsAtBar)) {
    for (const other of signalsAtBar) {
      if (other.strategy_id !== cand.strategy_id && other.side === cand.side) {
        agreementCount += 1;
      }
    }
  }

  return {
    // Trend
    trend_direction: trendDirection,
    ma_slope: maSlope,
    dist_from_ma: distFromMa,
    trend_strength: trendStrength,
    price_range_pos: priceRangePos,
    // Momentum
    recent_return: recentReturn,
    momentum_accel: momentumAccel,
    multi_horizon_agree: multiHorizonAgree,
    breakout_dist: breakoutDist,
    // Volatility
    atr_norm: atrNorm,
    realized_vol: realizedVol,
    vol_expansion: volExpansion,
    vol_percentile: volPercentile,
    // Market Structure
    range_compression: rangeCompression,
    range_expansion: rangeExpansion,
    breakout_quality: breakoutQuality,
    dist_to_recent_extrema: distToExtrema,
    recent_reversal_count: reversalCount,
    // Liquidity & Cost
    expected_move: expectedMove,
    est_cost: roundTripCostPct,
    move_to_cost_ratio: moveToCostRatio,
    // Confirmation
    strategy_agreement_count: agreementCount,
    trend_agree: trendAgree,
  };
}

// ---- Fast pre-computed series for bulk panel processing ----------------------
export function precomputePanelFeatures(rows, cfg) {
  const n = rows.ts.length;
  const tr = new Float64Array(n);
  for (let k = 0; k < n; k++) tr[k] = trueRangeAt(rows, k);

  const atr14 = new Float64Array(n);
  let sum14 = 0;
  for (let k = 0; k < n; k++) {
    sum14 += tr[k];
    if (k >= 14) sum14 -= tr[k - 14];
    atr14[k] = sum14 / Math.min(k + 1, 14);
  }

  const atr50 = new Float64Array(n);
  let sum50 = 0;
  for (let k = 0; k < n; k++) {
    sum50 += tr[k];
    if (k >= 50) sum50 -= tr[k - 50];
    atr50[k] = sum50 / Math.min(k + 1, 50);
  }

  const sma20 = new Float64Array(n);
  let sumSma20 = 0;
  for (let k = 0; k < n; k++) {
    sumSma20 += rows.close[k];
    if (k >= 20) sumSma20 -= rows.close[k - 20];
    sma20[k] = sumSma20 / Math.min(k + 1, 20);
  }

  const sma50 = new Float64Array(n);
  let sumSma50 = 0;
  for (let k = 0; k < n; k++) {
    sumSma50 += rows.close[k];
    if (k >= 50) sumSma50 -= rows.close[k - 50];
    sma50[k] = sumSma50 / Math.min(k + 1, 50);
  }

  return { tr, atr14, atr50, sma20, sma50 };
}

// ---- Leakage verification helper (§6) ---------------------------------------
export function verifyNoFutureLeakage(cand, rows, cfg, spec) {
  const i = cand.i;
  // Compute features with full dataset
  const featFull = computeCausalFeatures({ cand, rows, cfg, spec });

  // Sliced rows strictly to bar i (future bars completely removed)
  const slicedRows = {
    ts: rows.ts.slice(0, i + 1),
    open: rows.open.slice(0, i + 1),
    high: rows.high.slice(0, i + 1),
    low: rows.low.slice(0, i + 1),
    close: rows.close.slice(0, i + 1),
  };
  const featSliced = computeCausalFeatures({ cand, rows: slicedRows, cfg, spec });

  // Compare every numeric and string feature
  const diffs = [];
  for (const k of Object.keys(featFull)) {
    const v1 = featFull[k];
    const v2 = featSliced[k];
    if (typeof v1 === "number") {
      if (Math.abs(v1 - v2) > 1e-12) {
        diffs.push(`leakage in ${k}: full=${v1} sliced=${v2}`);
      }
    } else if (v1 !== v2) {
      diffs.push(`leakage in ${k}: full=${v1} sliced=${v2}`);
    }
  }
  return diffs;
}

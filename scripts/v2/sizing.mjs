// scripts/v2/sizing.mjs — P5 exact sizeOrder sequence (docs/10).
import { V2, readJSON, clamp } from "./store.mjs";

// P5 dailyVol: <15 closes -> .03; else last 15 closes -> 14 log returns,
// population variance (denominator 14), clamp [.005,.15]. (docs/08)
export function dailyVol(closes) {
  if (!Array.isArray(closes) || closes.length < 15) return 0.03;
  const win = closes.slice(closes.length - 15);
  if (win.some((c) => !Number.isFinite(c) || c <= 0)) return 0.03;
  const lr = [];
  for (let i = 1; i < win.length; i++) lr.push(Math.log(win[i] / win[i - 1]));
  const m = lr.reduce((a, b) => a + b, 0) / lr.length;
  const v = lr.reduce((a, b) => a + (b - m) ** 2, 0) / lr.length; // population
  return clamp(Math.sqrt(v), 0.005, 0.15);
}

export function sizeOrder(state, o, eq, cfg, histCache) {
  if (!o || o.op !== "open") return o;
  const V = cfg.v2;
  const market = cfg.watchlist.find((w) => w.symbol === o.symbol)?.market || "crypto";
  const marketMax = V.leverage[market]?.maxLeverage || 1;

  // 2. leverage clamp
  const proposed = o.leverage || state.aggression.leverageCap;
  const lev = clamp(proposed, 1, Math.min(state.aggression.leverageCap, state.aggression.leverageCeiling, marketMax));

  // 3. explicit margin bypass
  const explicit = o.marginUsd != null;
  let margin;
  if (explicit) {
    margin = o.marginUsd;
  } else {
    // 4. base
    let base;
    if (o.strategy_id) {
      const lib = readJSON(V2.strategies, { strategies: [] });
      const s = lib.strategies.find((x) => x.id === o.strategy_id);
      const acctMult = clamp(state.aggression.kellyFraction / V.aggression.kellyFractionStart, 0.4, 1.6);
      base = clamp((Number.isFinite(s?.kelly) ? s.kelly : 0.1) * acctMult, 0.02, 0.40);
    } else {
      base = o.sizePct != null ? o.sizePct : (state.aggression.kellyFraction ?? 0.25) * 0.5;
    }
    // 5. margin from equity
    margin = base * state.equity;
    // 6. volatility multiplier
    const targetDaily = (V.aggression.volTargetAnnual ?? 0.8) / Math.sqrt(365);
    const observed = dailyVol(histCache?.quotes?.[o.symbol]?.closes);
    margin *= clamp(targetDaily / observed, 0.25, 1.7);
    // 7. positive-progress goal multiplier only
    const g = state.goal;
    if (g && g.target > g.startEquity) {
      const progress = (eq - g.startEquity) / (g.target - g.startEquity);
      if (progress > 0 && progress < 1) margin *= 1 + clamp(0.55 * (1 - progress), 0, 0.55);
    }
  }
  // 8. wallet clamp
  margin = clamp(margin, 0, Math.max(0, state.walletBalance * 0.98));
  return { ...o, leverage: lev, marginUsd: margin };
}

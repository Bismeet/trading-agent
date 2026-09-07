// scripts/v2/perp.mjs — P2 pure leverage/funding/fee/mark/fill math. No file access.
// Formulas are exact P2 per docs/08. Golden vectors (E=100000, mmr=.004):
// long 5x -> 80400, short 5x -> 119600, long 25x -> 96400.

export const sideSign = (side) => (side === "short" ? -1 : 1);
export const imr = (L) => 1 / L;

export function tierFor(N, tiers) {
  const a = Math.abs(N);
  let last = null;
  for (const t of tiers || []) {
    last = t;
    if (a >= t.floor && a < t.cap) return t;
  }
  return last; // literal source behavior: fall through to final tier
}

export const maintenanceMargin = (N, tier) => Math.abs(N) * (tier?.mmr ?? 0) - (tier?.deduction ?? 0);
export const maxLeverageAt = (N, tiers) => tierFor(N, tiers)?.maxLev ?? 1;

export function liqPrice(side, E, L, mmr) {
  const s = sideSign(side);
  return E * (1 - s / L + s * mmr);
}
export function bankruptcyPrice(side, E, L) {
  const s = sideSign(side);
  return E * (1 - s / L);
}

export const unrealizedPnl = (side, E, P, Q) => (P - E) * Q * sideSign(side);
export const positionEquity = (M, U) => M + U;

export function isLiquidated(side, mark, liq) {
  return side === "short" ? mark >= liq : mark <= liq; // inclusive trigger
}

export function sizeFromMargin(M, L, E) {
  const notional = M * L;
  return { notional, qty: notional / E };
}
export const marginForNotional = (N, L) => Math.abs(N) / L;

export function emaUpdate(prev, price, alpha) {
  if (!Number.isFinite(prev)) return price;
  return alpha * price + (1 - alpha) * prev;
}

export const tradeFee = (N, rate) => Math.abs(N) * rate;
export const fundingPayment = (N, rate, side) => -sideSign(side) * Math.abs(N) * rate;

// Exact P2: (lastTs, nowTs], hourly walk from hour-rounded lastTs, UTC hours in set.
export function crossedFundingTimestamps(lastTs, nowTs, hours = [0, 8, 16]) {
  if (!lastTs || nowTs <= lastTs) return [];
  const out = [];
  const start = new Date(lastTs);
  start.setUTCMinutes(0, 0, 0);
  let t = start.getTime();
  while (t <= nowTs) {
    if (t > lastTs && hours.includes(new Date(t).getUTCHours())) out.push(t);
    t += 3600000;
  }
  return out;
}

export function slippageFraction(N, v = 0.02, D = 2000000, k = 0.6) {
  return k * Math.max(0.0005, v) * Math.sqrt(Math.max(0, N) / Math.max(1, D));
}

// side = action side: buy worsens up, sell worsens down. Closing a long passes "sell".
export function fillPrice(ref, side, h = 0, f = 0) {
  return ref * (1 + sideSign(side === "sell" ? "short" : side) * (h + f));
}

// Position builder. [DECISION C10] ts injected by caller; defaults to Date.now().
export function openPosition({ symbol, market, side, entryMark, margin, leverage, tiers, meta }, ts = Date.now()) {
  const { notional, qty } = sizeFromMargin(margin, leverage, entryMark);
  const tier = tierFor(notional, tiers);
  const mmr = tier?.mmr ?? 0;
  return {
    symbol,
    market,
    side,
    entryPrice: entryMark,
    qty,
    notional,
    isolatedMargin: margin,
    leverage,
    mmr,
    maintDeduction: tier?.deduction ?? 0,
    liqPrice: liqPrice(side, entryMark, leverage, mmr),
    bankruptcyPrice: bankruptcyPrice(side, entryMark, leverage),
    fundingAccrued: 0,
    feesPaid: 0,
    realizedPnl: 0,
    peakUPnl: 0,
    openedAt: ts,
    lastFundingTs: ts,
    openMeta: meta || {},
  };
}

export function markPosition(pos, mark) {
  const uPnl = unrealizedPnl(pos.side, pos.entryPrice, mark, pos.qty);
  const notional = Math.abs(pos.qty * mark);
  const maintMargin = maintenanceMargin(notional, { mmr: pos.mmr, deduction: pos.maintDeduction });
  return {
    mark,
    uPnl,
    equity: positionEquity(pos.isolatedMargin, uPnl),
    maintMargin,
    liquidated: isLiquidated(pos.side, mark, pos.liqPrice),
  };
}

// tests/math.test.mjs — golden vectors for lib + perp (docs/16 U01–U16 subset).
import test from "node:test";
import assert from "node:assert/strict";
import { sma, rsi, momentum, indicators, mean, stdev, wilsonLB, sqnOf, profitFactor, expectancyStats, regime } from "../scripts/lib.mjs";
import {
  sideSign, imr, tierFor, maintenanceMargin, maxLeverageAt, liqPrice, bankruptcyPrice,
  unrealizedPnl, positionEquity, isLiquidated, sizeFromMargin, marginForNotional,
  emaUpdate, tradeFee, fundingPayment, crossedFundingTimestamps, slippageFraction, fillPrice,
  openPosition, markPosition,
} from "../scripts/v2/perp.mjs";

test("U01 sma exact last-N average", () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1, 2, 3], 3), 2);
  assert.equal(sma([1, 2], 3), null);
  assert.equal(sma([], 1), null);
  assert.equal(sma([1, NaN, 3], 3), null);
});

test("U02 rsi Wilder edge behaviors", () => {
  assert.equal(rsi([1, 1, 1, 1], 2), 50);
  assert.equal(rsi([1, 2, 3, 4, 5], 2), 100);
  assert.equal(rsi([5, 4, 3, 2, 1], 2), 0);
  assert.equal(rsi([1, 2], 14), null);
  const v = rsi([44, 45, 44, 46, 45, 47, 46, 48, 47, 49, 48, 50, 49, 51, 50], 14);
  assert.ok(v > 50 && v < 100);
});

test("U03 momentum percent; exactly 1 must not pass >1", () => {
  assert.ok(Math.abs(momentum([100, 110], 1) - 10) < 1e-9);
  assert.ok(Math.abs(momentum([100, 101], 1) - 1) < 1e-12);
  assert.equal(momentum([100], 1), null);
});

test("U05 indicators trend/bias", () => {
  const up = Array.from({ length: 60 }, (_, i) => i + 1);
  const down = Array.from({ length: 60 }, (_, i) => 60 - i);
  assert.equal(indicators(up).trend, "up");
  assert.equal(indicators(down).trend, "down");
  assert.equal(indicators(up).bias, "bullish");
  assert.equal(indicators([5, 5, 5]).trend, "flat");
});

test("U06 mean/stdev sample variance", () => {
  assert.equal(mean([]), null);
  assert.equal(mean([2, 4]), 3);
  assert.equal(stdev([1]), null);
  assert.ok(Math.abs(stdev([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138089935299395) < 1e-9); // sample sd
});

test("U07 expectancy/PF/SQN/Wilson", () => {
  const s = expectancyStats([1, -0.5, 1, -0.5, 0.5]);
  assert.equal(s.n, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 2);
  assert.ok(Math.abs(s.expectancyR - 0.3) < 1e-12);
  assert.ok(Number.isFinite(s.profitFactor));
  assert.ok(s.wilsonLb != null && s.wilsonLb >= 0 && s.wilsonLb <= 1);
  assert.equal(expectancyStats([]).n, 0);
  assert.equal(profitFactor([1, 2]), null); // never Infinity in JSON
  assert.equal(profitFactor([]), 0);
  assert.equal(sqnOf([1, 1, 1]), 0); // zero variance -> 0
  assert.equal(wilsonLB(0, 0), null);
});
test("U09 tierFor half-open boundaries", () => {
  const tiers = [
    { floor: 0, cap: 50000, maxLev: 125, mmr: 0.004, deduction: 0 },
    { floor: 50000, cap: 600000, maxLev: 100, mmr: 0.005, deduction: 50 },
    { floor: 600000, cap: 3000000, maxLev: 75, mmr: 0.01, deduction: 3050 },
  ];
  assert.equal(tierFor(49999, tiers).maxLev, 125);
  assert.equal(tierFor(50000, tiers).maxLev, 100);
  assert.equal(tierFor(-50000, tiers).maxLev, 100); // abs()
  assert.equal(tierFor(99999999, tiers).maxLev, 75); // falls through to last
  assert.equal(maintenanceMargin(100000, tiers[1]), 450);
  assert.equal(maxLeverageAt(0, tiers), 125);
});

test("U10 leverage/margin identities", () => {
  const { notional, qty } = sizeFromMargin(100, 12, 50000);
  assert.equal(notional, 1200);
  assert.ok(Math.abs(qty - 0.024) < 1e-12);
  assert.equal(marginForNotional(1200, 12), 100);
  assert.equal(imr(12), 1 / 12);
  assert.equal(sideSign("short"), -1);
  assert.equal(sideSign("anything"), 1); // literal source behavior
});

test("U11 liquidation golden vectors + inclusive trigger", () => {
  assert.equal(liqPrice("long", 100000, 5, 0.004), 80400);
  assert.equal(liqPrice("short", 100000, 5, 0.004), 119600);
  assert.equal(liqPrice("long", 100000, 25, 0.004), 96400);
  assert.equal(bankruptcyPrice("long", 100000, 5), 80000);
  assert.equal(bankruptcyPrice("short", 100000, 5), 120000);
  assert.ok(isLiquidated("long", 80400, 80400)); // inclusive
  assert.ok(isLiquidated("short", 119600, 119600));
  assert.ok(!isLiquidated("long", 80401, 80400));
});

test("U12 emaUpdate seed/update", () => {
  assert.equal(emaUpdate(null, 100, 0.25), 100);
  assert.equal(emaUpdate(NaN, 100, 0.25), 100);
  assert.equal(emaUpdate(100, 120, 0.25), 105);
});

test("U13 tradeFee notional basis", () => {
  assert.equal(tradeFee(1000, 0.0005), 0.5);
  assert.equal(tradeFee(-1000, 0.0005), 0.5);
  assert.equal(tradeFee(0, 0.0005), 0);
});

test("U14 funding signs + crossed timestamps", () => {
  assert.equal(fundingPayment(10000, 0.0001, "long"), -1);
  assert.equal(fundingPayment(10000, 0.0001, "short"), 1);
  assert.equal(fundingPayment(10000, -0.0001, "long"), 1);
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.deepEqual(crossedFundingTimestamps(t0, t0 + 9 * 3600000, [0, 8, 16]), [t0 + 8 * 3600000]);
  assert.deepEqual(crossedFundingTimestamps(0, t0, [0]), []);
  assert.deepEqual(crossedFundingTimestamps(t0, t0, [0]), []);
});

test("U15 slippage + adverse fills", () => {
  assert.equal(slippageFraction(0), 0);
  assert.ok(Math.abs(slippageFraction(4000) / slippageFraction(1000) - 2) < 1e-9); // sqrt relation
  assert.ok(fillPrice(100, "buy", 0.001, 0) > 100);
  assert.ok(fillPrice(100, "sell", 0.001, 0) < 100);
  assert.ok(fillPrice(100, "long", 0.001, 0) > 100);
});

test("U16 openPosition/markPosition contract", () => {
  const tiers = [{ floor: 0, cap: 1e9, maxLev: 40, mmr: 0.004, deduction: 0 }];
  const pos = openPosition({ symbol: "BTC-USD", market: "crypto", side: "long", entryMark: 100000, margin: 100, leverage: 10, tiers, meta: { trade_id: "t1" } }, 1234567890);
  assert.equal(pos.entryPrice, 100000);
  assert.equal(pos.openedAt, 1234567890);
  assert.equal(pos.openMeta.trade_id, "t1");
  assert.equal(pos.fundingAccrued, 0);
  const mk = markPosition(pos, 110000);
  assert.ok(mk.uPnl > 0);
  assert.ok(!mk.liquidated);
  assert.equal(mk.equity, positionEquity(pos.isolatedMargin, mk.uPnl));
});

test("regime labels + halt priority", () => {
  assert.equal(regime({}, "halt"), "risk_off");
  assert.equal(regime([{ symbol: "BTC-USD", trend: "up" }, { symbol: "^GSPC", trend: "up" }]), "broad_up");
  assert.equal(regime([{ symbol: "BTC-USD", trend: "down", mom: 10 }]), "crypto_down_highvol");
  assert.equal(regime([{ symbol: "BTC-USD", trend: "down", mom: 2 }]), "crypto_down");
  assert.equal(regime([{ symbol: "BTC-USD", trend: "flat" }, { symbol: "^GSPC", trend: "down" }]), "us_down");
  assert.equal(regime([{ symbol: "BTC-USD", trend: "flat" }]), "mixed_chop");
});

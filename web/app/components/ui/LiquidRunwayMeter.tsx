"use client";

import React from "react";

interface LiquidRunwayMeterProps {
  mark: number | null | undefined;
  liqPrice: number | null | undefined;
  side: "long" | "short" | string;
  compact?: boolean;
}

export function LiquidRunwayMeter({
  mark,
  liqPrice,
  side,
  compact = false,
}: LiquidRunwayMeterProps) {
  if (!Number.isFinite(mark) || !Number.isFinite(liqPrice) || (mark ?? 0) <= 0) {
    return <span className="text-inksoft text-xs tnum">—</span>;
  }

  const m = mark as number;
  const lp = liqPrice as number;
  const isShort = String(side).toLowerCase() === "short";
  const distancePct = (100 * (isShort ? -1 : 1) * (m - lp)) / m;

  const isDanger = distancePct < 4;
  const isWatch = distancePct >= 4 && distancePct < 12;

  const statusLabel = isDanger ? "Danger" : isWatch ? "Watch" : "Safe";
  const badgeClass = isDanger
    ? "bg-rose-500/20 text-rose-800 border-rose-500/40 font-bold"
    : isWatch
    ? "bg-amber-500/20 text-amber-900 border-amber-500/40 font-bold"
    : "bg-emerald-500/15 text-emerald-800 border-emerald-500/30";

  const barColor = isDanger
    ? "bg-gradient-to-r from-rose-500 to-rose-600"
    : isWatch
    ? "bg-gradient-to-r from-amber-400 to-amber-500"
    : "bg-gradient-to-r from-emerald-400 to-emerald-600";

  const clampedBarWidth = Math.max(2, Math.min(100, (distancePct / 25) * 100));

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-1.5 rounded-full bg-black/10 overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${clampedBarWidth}%` }} />
        </div>
        <span className={`text-[11px] font-semibold tnum ${isDanger ? "text-rose-700" : isWatch ? "text-amber-800" : "text-emerald-700"}`}>
          {distancePct.toFixed(1)}%
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2.5 pt-2 border-t border-black/5">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-inksoft font-medium">Liquidation Buffer</span>
        <div className="flex items-center gap-1.5">
          <span className="font-bold tnum text-ink">{distancePct.toFixed(1)}%</span>
          <span className={`px-1.5 py-0.2 rounded text-[10px] uppercase tracking-wider border ${badgeClass}`}>
            {statusLabel}
          </span>
        </div>
      </div>
      <div className="h-2 rounded-full bg-black/5 overflow-hidden p-0.5 border border-white/60">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clampedBarWidth}%` }}
        />
      </div>
    </div>
  );
}

export default LiquidRunwayMeter;

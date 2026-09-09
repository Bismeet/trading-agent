"use client";

import React from "react";
import { usd, pct, signed, tone, price } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";
import { LiquidRunwayMeter } from "../ui/LiquidRunwayMeter";
import { Mascot } from "../visuals";

interface PositionsTabProps {
  s: any;
  onSelectCandidate?: (candidate: any) => void;
  onNavigateToAI?: () => void;
}

export function PositionsTab({
  s,
  onSelectCandidate,
  onNavigateToAI,
}: PositionsTabProps) {
  const positions: any[] = s?.positions ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header Banner */}
      <div className="card-fintech p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
              Open Portfolio Positions ({positions.length})
            </h1>
            <p className="text-xs text-inksoft mt-0.5">
              Live smoothed mark price accounting with realized slippage, exchange taker fees, and 8-hour funding carry.
            </p>
          </div>
          <div className="text-xs text-inksoft">
            Gross Leverage: <b className="text-ink tnum">{s?.grossLeverage != null ? `${s.grossLeverage.toFixed(1)}x` : "—"}</b>
          </div>
        </div>
      </div>

      {/* Positions Grid */}
      {positions.length === 0 ? (
        <div className="card-fintech p-12 text-center flex flex-col items-center justify-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="font-display font-semibold text-lg text-ink">No Open Positions</p>
          <p className="text-xs text-inksoft max-w-md">
            The trading engine has no active market exposure. When strategies generate intents that pass both the Tauric AI gate and the FabRich Risk Council, positions will open here.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {positions.map((p: any) => {
            const hasAi = !!p.openMeta?.ai;
            const aiData = p.openMeta?.ai;

            return (
              <div
                key={p.symbol}
                className="card-fintech p-5 flex flex-col justify-between"
              >
                <div>
                  {/* Position Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={p.side || "long"} size="sm" />
                      <span className="font-display font-bold text-lg text-ink">
                        {String(p.symbol).replace("-USD", "")}
                      </span>
                      <span className="text-xs text-inksoft tnum font-semibold">
                        {p.leverage}x
                      </span>
                    </div>

                    <div className="text-right">
                      <div className={`font-display text-base font-bold tnum ${tone(p.uPnl)}`}>
                        {signed(p.uPnl)}
                      </div>
                      <div className={`text-xs tnum font-semibold ${tone(p.uPnl)}`}>
                        {pct(p.roiPct)} ROI
                      </div>
                    </div>
                  </div>

                  {/* Price Levels Grid */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-black/2 border border-white/80 text-xs tnum mb-3">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-inksoft">Entry Price</span>
                      <div className="font-bold text-ink">{price(p.entry)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-inksoft">Mark Price</span>
                      <div className="font-bold text-ink">{price(p.mark)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-inksoft">Notional Size</span>
                      <div className="font-bold text-ink">{usd(p.notional, 0)}</div>
                    </div>
                  </div>

                  {/* Liquidation Buffer */}
                  <LiquidRunwayMeter
                    mark={p.mark}
                    liqPrice={p.liqPrice}
                    side={p.side}
                  />
                </div>

                {/* AI & Strategy Attribution Footer */}
                <div className="mt-4 pt-3 border-t border-black/5 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-inksoft">
                    <span>
                      Strategy: <b className="text-ink uppercase">{p.strategy_id || "TSMOM"}</b>
                    </span>
                    <span>
                      Margin: <b className="text-ink tnum">{usd(p.margin, 2)}</b>
                    </span>
                  </div>

                  {hasAi && (
                    <div
                      onClick={() => {
                        if (onSelectCandidate) onSelectCandidate(aiData);
                        if (onNavigateToAI) onNavigateToAI();
                      }}
                      className="p-2.5 rounded-lg bg-white/80 border border-white/90 text-xs flex items-center justify-between gap-2 hover:bg-white cursor-pointer transition shadow-2xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <StatusBadge
                          status={aiData.approved ? "approved" : "rejected"}
                          label={aiData.approved ? "AI Approved" : "AI Rejected"}
                          size="sm"
                        />
                        <span className="text-inksoft truncate max-w-[200px]">
                          {aiData.thesis || `Rating: ${aiData.rating}`}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-ink shrink-0">
                        Inspect AI ➔
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PositionsTab;

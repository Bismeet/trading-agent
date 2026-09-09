"use client";

import React from "react";
import { tone } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";
import { Mascot } from "../visuals";
import { SectionExplainer } from "../ui/SectionExplainer";

interface StrategiesTabProps {
  v2: any;
}

export function StrategiesTab({ v2 }: StrategiesTabProps) {
  const list: any[] = v2.strategies ?? [];
  const allCandidates = list.length > 0 && list.every((s) => s.status === "candidate");

  return (
    <div className="flex flex-col gap-6">
      <SectionExplainer
        title="Strategies"
        definition="deterministic rule-based trading strategies generating trade candidates."
        details="Displays the six core mathematical strategies (EMA Trend, Bollinger Mean Reversion, Funding Arbitrage, RSI Momentum, VWAP Breakout, Volatility Squeeze), tracking their edge metrics, Deflated Sharpe Ratio (DSR), win rates, and promotion lifecycle."
      />

      {/* Header Banner */}
      <div className="card-fintech p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
              Strategy Library &amp; Edge Evaluation ({list.length})
            </h1>
            <p className="text-xs text-inksoft mt-0.5">
              Strategies earn active promotion only upon proving statistical edge through Deflated Sharpe Ratio (DSR) and minimum trade counts.
            </p>
          </div>
        </div>

        {allCandidates && (
          <div className="mt-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-950 font-medium">
            All strategies are currently in early candidate evaluation on live trades.
          </div>
        )}
      </div>

      {/* Strategy Cards Grid */}
      {list.length === 0 ? (
        <div className="card-fintech p-12 text-center flex flex-col items-center justify-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="font-display font-semibold text-lg text-ink">No Strategies Loaded</p>
          <p className="text-xs text-inksoft">
            Check <code className="font-mono text-[10px]">data/strategies.json</code> in your project.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {list.map((s: any) => {
            const expR = s.expectancy_R;
            const pf = s.profit_factor;
            const dsr = s.dsr;
            const conf = s.confidence;

            return (
              <div key={s.id} className="card-fintech p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display font-bold text-base text-ink">
                      {s.name ?? s.id}
                    </span>
                    <StatusBadge status={s.status || "candidate"} size="sm" />
                  </div>

                  <div className="text-xs text-inksoft tnum font-medium mb-3">
                    Sample: <b>{s.n ?? 0}</b> closed trades · Kelly: <b>{((s.kelly ?? 0) * 100).toFixed(0)}%</b>
                  </div>

                  {/* 4 Statistical Metrics Grid */}
                  <div className="grid grid-cols-4 gap-2 text-center text-xs tnum">
                    <div className="p-2.5 rounded-xl bg-black/2 border border-white/80">
                      <div className={`font-bold text-sm ${tone(expR)}`}>
                        {expR != null ? expR.toFixed(2) : "—"}
                      </div>
                      <div className="text-[10px] text-inksoft font-semibold uppercase mt-0.5">
                        Exp R
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-black/2 border border-white/80">
                      <div className="font-bold text-sm text-ink">
                        {pf != null ? pf.toFixed(2) : "—"}
                      </div>
                      <div className="text-[10px] text-inksoft font-semibold uppercase mt-0.5">
                        PF
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-black/2 border border-white/80">
                      <div className="font-bold text-sm text-ink">
                        {dsr != null ? dsr.toFixed(2) : "—"}
                      </div>
                      <div className="text-[10px] text-inksoft font-semibold uppercase mt-0.5">
                        DSR
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-black/2 border border-white/80">
                      <div className="font-bold text-sm text-ink">
                        {conf != null ? `${((conf ?? 0) * 100).toFixed(0)}%` : "—"}
                      </div>
                      <div className="text-[10px] text-inksoft font-semibold uppercase mt-0.5">
                        Conf
                      </div>
                    </div>
                  </div>
                </div>

                {s.description && (
                  <p className="mt-3 pt-2.5 border-t border-black/5 text-[11px] text-inksoft leading-relaxed">
                    {s.description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StrategiesTab;

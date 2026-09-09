"use client";

import React, { useState } from "react";
import { price, usd } from "../../lib/format";

interface FabRichContextCardProps {
  context: any;
  defaultExpanded?: boolean;
  className?: string;
}

export function FabRichContextCard({
  context,
  defaultExpanded = false,
  className = "",
}: FabRichContextCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showFullJson, setShowFullJson] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!context) {
    return (
      <div className={`p-3 rounded-xl bg-black/2 border border-black/5 text-xs text-inksoft ${className}`}>
        <span className="font-semibold text-ink">FabRich Context:</span> Pre-migration record (no context payload saved).
      </div>
    );
  }

  const strat = context.strategy || {};
  const lessons: any[] = Array.isArray(context.lessons) ? context.lessons : [];
  const trades = context.recent_trades || {};
  const recentFills: any[] = Array.isArray(trades.recent_fills) ? trades.recent_fills : [];
  const port = context.portfolio || {};
  const world = context.world || {};
  const recentAi = context.recent_ai || {};

  const copyContextJson = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(context, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`rounded-xl bg-white/70 border border-white/90 shadow-2xs overflow-hidden transition-all duration-200 ${className}`}>
      {/* Header bar / accordion toggle */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-4 py-3 bg-gradient-to-r from-sakura/15 via-white/40 to-transparent flex items-center justify-between cursor-pointer hover:bg-sakura/20 transition-colors select-none"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">🧬</span>
          <span className="font-display font-bold text-xs sm:text-sm text-ink tracking-tight">
            FabRich Context Used
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/90 border border-black/5 text-inksoft">
            Internal Intelligence
          </span>
          {lessons.length > 0 && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-900 border border-amber-500/30">
              {lessons.length} {lessons.length === 1 ? "Lesson" : "Lessons"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-inksoft font-medium">
            {isExpanded ? "Collapse" : "Expand"}
          </span>
          <span className="text-xs text-inksoft">{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="p-4 flex flex-col gap-4 text-xs border-t border-black/5 animate-in fade-in duration-150">
          <div className="text-[11px] text-inksoft leading-relaxed italic bg-black/2 p-2.5 rounded-lg border border-black/5">
            Historical &amp; real-time system context injected into Tauric multi-agent research prompts. AI evaluates relevance critically without blind obedience.
          </div>

          {/* Grid: Strategy & World/Macro */}
          <div className="grid sm:grid-cols-2 gap-3">
            {/* 1. Strategy Context */}
            <div className="p-3 rounded-xl bg-white/80 border border-white/90 flex flex-col justify-between gap-2 shadow-2xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-ink uppercase tracking-wider text-[11px]">
                    Strategy: {strat.strategy_id || "N/A"}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 text-inksoft">
                    {strat.n != null ? `${strat.n} trades` : "No trades"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] tnum">
                  <div>
                    <span className="text-inksoft block">Win Rate</span>
                    <span className="font-bold text-ink">
                      {strat.win_rate != null ? `${(strat.win_rate * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Profit Factor</span>
                    <span className="font-bold text-ink">
                      {strat.profit_factor != null ? strat.profit_factor.toFixed(2) : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Expectancy (R)</span>
                    <span className="font-bold text-ink">
                      {strat.expectancy_r != null ? `${strat.expectancy_r > 0 ? "+" : ""}${strat.expectancy_r.toFixed(2)}R` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Kelly Fraction</span>
                    <span className="font-bold text-ink">
                      {strat.kelly != null ? `${(strat.kelly * 100).toFixed(1)}%` : "—"}
                    </span>
                  </div>
                </div>
              </div>
              {strat.confidence && (
                <div className="text-[10px] text-inksoft border-t border-black/5 pt-1.5 flex justify-between">
                  <span>Confidence: <b className="capitalize text-ink">{strat.confidence}</b></span>
                  {strat.sqn != null && <span>SQN: <b className="text-ink">{strat.sqn.toFixed(2)}</b></span>}
                </div>
              )}
            </div>

            {/* 2. World & Macro Snapshot */}
            <div className="p-3 rounded-xl bg-white/80 border border-white/90 flex flex-col justify-between gap-2 shadow-2xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-ink uppercase tracking-wider text-[11px]">
                    World &amp; Macro Regime
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sakura/25 text-ink uppercase">
                    {world.regime || "Normal"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] tnum">
                  <div>
                    <span className="text-inksoft block">Risk Posture</span>
                    <span className="font-bold text-ink capitalize">
                      {world.risk_posture || "Neutral"}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Crypto Fear/Greed</span>
                    <span className="font-bold text-ink">
                      {world.fear_greed_crypto != null ? world.fear_greed_crypto : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">8h Funding Rate</span>
                    <span className={`font-bold ${world.funding_rate != null && world.funding_rate > 0 ? "text-emerald-700" : world.funding_rate != null && world.funding_rate < 0 ? "text-rose-700" : "text-ink"}`}>
                      {world.funding_rate != null ? `${(world.funding_rate * 100).toFixed(4)}%` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">VIX Volatility</span>
                    <span className="font-bold text-ink">
                      {world.vix != null ? Number(world.vix).toFixed(1) : "—"}
                    </span>
                  </div>
                </div>
              </div>
              {Array.isArray(world.macro_drivers) && world.macro_drivers.length > 0 && (
                <div className="text-[10px] text-inksoft border-t border-black/5 pt-1.5 truncate">
                  Drivers: {world.macro_drivers.slice(0, 2).join(", ")}
                </div>
              )}
            </div>
          </div>

          {/* 3. FabRich Lessons Bank */}
          <div className="p-3 rounded-xl bg-white/80 border border-white/90 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-ink uppercase tracking-wider text-[11px]">
                  Relevant Lessons Bank
                </span>
                <span className="text-[10px] text-inksoft">
                  (Prioritized by strategy, symbol &amp; regime)
                </span>
              </div>
              <span className="text-[10px] font-mono text-inksoft">
                {lessons.length} active
              </span>
            </div>

            {lessons.length === 0 ? (
              <p className="text-xs text-inksoft italic py-2">
                No relevant FabRich lessons available.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {lessons.map((lesson, idx) => {
                  const isBlowup = lesson.kind === "blowup" || lesson.kind === "loss";
                  return (
                    <div
                      key={lesson.id || idx}
                      className={`p-2.5 rounded-lg border text-xs ${
                        isBlowup
                          ? "bg-rose-500/5 border-rose-500/20 text-rose-950"
                          : "bg-black/2 border-black/5 text-ink"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              isBlowup
                                ? "bg-rose-500/20 text-rose-800"
                                : "bg-emerald-500/20 text-emerald-800"
                            }`}
                          >
                            {lesson.kind || "lesson"}
                          </span>
                          <span className="font-bold text-[11px]">
                            {lesson.title || "Historical Observation"}
                          </span>
                        </div>
                        {lesson.importance != null && (
                          <span className="text-[9px] font-mono text-inksoft shrink-0">
                            Imp: {lesson.importance}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] leading-relaxed text-ink/80">
                        {lesson.text || "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Grid: Recent Trades & Portfolio Exposure */}
          <div className="grid sm:grid-cols-2 gap-3">
            {/* 4. Recent Relevant Trades */}
            <div className="p-3 rounded-xl bg-white/80 border border-white/90 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-ink uppercase tracking-wider text-[11px]">
                  Recent Fills ({trades.matching_count ?? 0} matches)
                </span>
                {trades.total_pnl != null && (
                  <span className={`text-[11px] font-bold tnum ${trades.total_pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    PnL: {usd(trades.total_pnl)}
                  </span>
                )}
              </div>

              {recentFills.length === 0 ? (
                <p className="text-xs text-inksoft italic py-2">
                  No recent matching fills recorded.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {recentFills.slice(0, 3).map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-1.5 rounded bg-black/2 border border-black/5 text-[11px] tnum"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`uppercase font-bold text-[9px] px-1 py-0.5 rounded ${f.side === "long" ? "bg-emerald-500/15 text-emerald-800" : "bg-rose-500/15 text-rose-800"}`}>
                          {f.side}
                        </span>
                        <span>{price(f.price)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {f.reason && <span className="text-inksoft text-[10px]">{f.reason}</span>}
                        {f.pnl != null && (
                          <span className={`font-bold ${f.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {usd(f.pnl)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 5. Current Portfolio Context */}
            <div className="p-3 rounded-xl bg-white/80 border border-white/90 shadow-2xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-ink uppercase tracking-wider text-[11px]">
                    Portfolio Exposure
                  </span>
                  <span className="text-[10px] font-mono text-inksoft">
                    {port.open_positions_count ?? 0} open positions
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] tnum">
                  <div>
                    <span className="text-inksoft block">Equity</span>
                    <span className="font-bold text-ink">{usd(port.equity ?? 0)}</span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Gross Leverage</span>
                    <span className="font-bold text-ink">
                      {port.gross_leverage != null ? `${port.gross_leverage.toFixed(2)}x` : "0.00x"}
                      {port.leverage_cap != null && (
                        <span className="text-[10px] font-normal text-inksoft"> / {port.leverage_cap.toFixed(1)}x</span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Correlated Crypto</span>
                    <span className="font-bold text-ink">{port.correlated_crypto_count ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-inksoft block">Recent AI Ratio</span>
                    <span className="font-bold text-ink">
                      {recentAi.approved_count != null ? `${recentAi.approved_count}A / ${recentAi.rejected_count ?? 0}R` : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {Array.isArray(port.positions) && port.positions.length > 0 && (
                <div className="text-[10px] text-inksoft border-t border-black/5 pt-1.5 mt-2 truncate">
                  Holding: {port.positions.map((p: any) => `${p.symbol} (${p.side})`).join(", ")}
                </div>
              )}
            </div>
          </div>

          {/* 6. Raw Context Inspector Toggle */}
          <div className="pt-2 border-t border-black/5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowFullJson(!showFullJson)}
                className="text-[11px] font-semibold text-sakura hover:text-ink transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span>{showFullJson ? "Hide full JSON context" : "View full context payload"}</span>
                <span>{showFullJson ? "▲" : "▼"}</span>
              </button>

              {showFullJson && (
                <button
                  type="button"
                  onClick={copyContextJson}
                  className="glass-btn px-2.5 py-0.5 text-[10px] text-ink cursor-pointer"
                >
                  {copied ? "Copied!" : "Copy Context JSON"}
                </button>
              )}
            </div>

            {showFullJson && (
              <pre className="p-3 rounded-xl bg-ink/95 text-[#e7f2f2] text-[10px] font-mono overflow-x-auto max-h-56 scrollbar-thin border border-white/10 animate-in fade-in duration-150">
                {JSON.stringify(context, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FabRichContextCard;

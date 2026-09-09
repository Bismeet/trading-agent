"use client";

import React, { useState } from "react";
import { usd, signed, tone, timeAgo } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";
import { Mascot } from "../visuals";
import { SectionExplainer } from "../ui/SectionExplainer";
import { usePersistedState } from "../../lib/usePersistedState";

const SIDE_FILTERS = ["all", "long", "short"] as const;
const OP_FILTERS = ["all", "close"] as const;

function isSideFilter(value: unknown): value is string {
  return typeof value === "string" && (SIDE_FILTERS as readonly string[]).includes(value);
}

function isOpFilter(value: unknown): value is string {
  return typeof value === "string" && (OP_FILTERS as readonly string[]).includes(value);
}

interface TradesTabProps {
  v2: any;
  onSelectCandidate?: (candidate: any) => void;
  onNavigateToAI?: () => void;
}

export function TradesTab({
  v2,
  onSelectCandidate,
  onNavigateToAI,
}: TradesTabProps) {
  const trades: any[] = v2.trades ?? [];
  const [search, setSearch] = useState("");
  // UI-state persistence: keep the user's filter choices across reloads.
  const [sideFilter, setSideFilter] = usePersistedState<string>(
    "trades.sideFilter",
    "all",
    isSideFilter,
  );
  const [opFilter, setOpFilter] = usePersistedState<string>(
    "trades.opFilter",
    "all",
    isOpFilter,
  );

  const filtered = trades.filter((t) => {
    const sym = String(t.symbol || "").toLowerCase();
    const matchesSearch = !search || sym.includes(search.toLowerCase());

    const matchesSide =
      sideFilter === "all" ||
      String(t.side || "").toLowerCase() === sideFilter.toLowerCase();

    const matchesOp =
      opFilter === "all" ||
      String(t.op || "").toLowerCase() === opFilter.toLowerCase();

    return matchesSearch && matchesSide && matchesOp;
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionExplainer
        title="Trades / Fills"
        definition="history of executed orders and trades."
        details="Complete audit trail of all filled orders, realized P&L, trading fees, executed sizes, exit reasons, and corresponding AI decisions."
      />

      {/* Header Banner with Filters */}
      <div className="card-fintech p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
            Execution Log &amp; Fills ({filtered.length})
          </h1>
          <p className="text-xs text-inksoft mt-0.5">
            Realized trade executions recorded from <code className="font-mono text-[10px]">data/trades.v2.jsonl</code>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {/* Search box */}
          <input
            type="text"
            placeholder="Search symbol..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 rounded-full text-xs bg-white/70 border border-white/90 text-ink placeholder:text-inksoft/60 outline-none w-32 sm:w-44 focus:bg-white focus:ring-1 focus:ring-sakura"
          />

          {/* Side filter pills */}
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setSideFilter("all")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                sideFilter === "all" ? "bg-white text-ink shadow-2xs font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSideFilter("long")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                sideFilter === "long" ? "bg-emerald-500/20 text-emerald-900 font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              Long
            </button>
            <button
              onClick={() => setSideFilter("short")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                sideFilter === "short" ? "bg-rose-500/20 text-rose-900 font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              Short
            </button>
          </div>

          {/* Op filter */}
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setOpFilter(opFilter === "close" ? "all" : "close")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                opFilter === "close" ? "bg-sakura/30 text-ink font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              Closed Only
            </button>
          </div>
        </div>
      </div>

      {/* Trades List */}
      {filtered.length === 0 ? (
        <div className="card-fintech p-12 text-center flex flex-col items-center justify-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="font-display font-semibold text-lg text-ink">No Fills Found</p>
          <p className="text-xs text-inksoft max-w-sm">
            {trades.length === 0
              ? "No trades have executed yet this episode. When the engine fills orders, they appear in this ledger."
              : "No fills match the selected filter criteria."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((f: any, i: number) => {
            const isClose = f.op === "close";
            const netPnl = f.net_pnl;
            const hasAi = !!f.ai;

            return (
              <div
                key={f.eventId || i}
                className="card-fintech p-4 flex flex-col gap-2 hover:bg-white transition"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                      isClose ? "bg-purple-500/15 text-purple-900 border border-purple-500/25" : "bg-blue-500/15 text-blue-900 border border-blue-500/25"
                    }`}>
                      {f.op}
                    </span>
                    <StatusBadge status={f.side || "long"} size="sm" />
                    <span className="font-display font-bold text-base text-ink">
                      {String(f.symbol).replace("-USD", "")}
                    </span>
                    <span className="text-xs text-inksoft tnum font-semibold">
                      {f.leverage}x
                    </span>
                    {f.reason && (
                      <span className="text-xs text-inksoft">
                        · {f.reason}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={`font-display text-sm sm:text-base font-bold tnum ${isClose ? tone(netPnl) : "text-ink"}`}>
                        {isClose ? signed(netPnl) : usd(f.margin)}
                      </div>
                      <div className="text-[10px] text-inksoft">
                        {isClose ? "Realized Net P&L" : "Position Margin"}
                      </div>
                    </div>
                    <span className="text-xs text-inksoft tnum font-medium min-w-[55px] text-right">
                      {timeAgo(f.ts)}
                    </span>
                  </div>
                </div>

                {/* AI Attribution Box if Available */}
                {hasAi && (
                  <div
                    onClick={() => {
                      if (onSelectCandidate) onSelectCandidate(f.ai);
                      if (onNavigateToAI) onNavigateToAI();
                    }}
                    className="mt-1 p-2 rounded-lg bg-white/70 border border-white/80 text-xs flex items-center justify-between gap-2 hover:bg-white cursor-pointer transition shadow-2xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <StatusBadge
                        status={f.ai.approved ? "approved" : "rejected"}
                        label={f.ai.approved ? "AI Approved" : "AI Rejected"}
                        size="sm"
                      />
                      <span className="font-semibold text-ink">
                        Rating: {f.ai.rating || "Hold"}
                      </span>
                      {f.ai.thesis && (
                        <span className="text-inksoft truncate max-w-md hidden sm:inline">
                          — {f.ai.thesis}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-ink shrink-0">
                      View AI Debate ➔
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TradesTab;

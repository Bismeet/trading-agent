"use client";

import React from "react";
import { usd, pct, signed, tone } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";

interface TopHeaderProps {
  signals: any;
  liveness: any;
  conn: string;
  fails?: number;
  err?: string | null;
  aiConfig?: any;
  aiConnected?: boolean;
  onRefresh?: () => void;
  mobileNavOpen?: boolean;
  setMobileNavOpen?: (open: boolean) => void;
}

export function TopHeader({
  signals,
  liveness,
  conn,
  fails,
  err,
  aiConfig,
  aiConnected = true,
  mobileNavOpen,
  setMobileNavOpen,
}: TopHeaderProps) {
  const alive = liveness?.alive !== false;
  const cycle = liveness?.heartbeat?.cycle ?? signals?.cycle ?? null;
  const hbAgeSec = liveness?.ageMs != null ? Math.round(liveness.ageMs / 1000) : null;

  const engineStatus =
    conn === "error"
      ? "error"
      : conn === "reconnecting"
      ? "reconnecting"
      : !alive
      ? "stale"
      : "live";

  const engineLabel =
    engineStatus === "error"
      ? `Offline (${err ?? "failed"})`
      : engineStatus === "reconnecting"
      ? `Reconnecting${fails ? ` (${fails})` : ""}`
      : engineStatus === "stale"
      ? `Stale (${hbAgeSec ? `${hbAgeSec}s` : "no hb"})`
      : `Engine Live${cycle ? ` · c${cycle}` : ""}`;

  const aiGateActive = aiConfig?.enabled !== false;
  const aiStatus = !aiConnected
    ? "error"
    : "live";
  const aiLabel = !aiConnected
    ? "AI Unreachable"
    : aiGateActive
    ? "AI Gate Active"
    : "AI Bypass";

  const equity = signals?.equity;
  const totalPnl = signals?.totalPnl;
  const totalPnlPct = signals?.totalPnlPct;

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-cream/75 border-b border-white/80 shadow-xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-sakura via-lavsoft to-gold p-0.5 shadow-sm shrink-0 flex items-center justify-center">
            <div className="w-full h-full rounded-[10px] bg-white/85 backdrop-blur-sm flex items-center justify-center">
              <span className="font-display font-black text-lg sm:text-xl text-ink">F</span>
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base sm:text-lg tracking-tight text-ink">
                FabRich
              </span>
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-sakura/20 text-ink border border-sakura/30">
                v2 Apex
              </span>
            </div>
            <p className="hidden sm:block text-[11px] text-inksoft leading-none font-medium">
              Autonomous Multimodal &amp; Multi-Agent Trading
            </p>
          </div>
        </div>

        {/* Center: System Status Cluster (Glanceability Rule #1) */}
        <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-white/60 border border-white/80 shadow-xs">
          {/* Engine Status */}
          <StatusBadge
            status={engineStatus}
            label={engineLabel}
            size="sm"
          />

          <span className="text-black/20 text-xs">|</span>

          {/* AI Status */}
          <StatusBadge
            status={aiStatus}
            label={aiLabel}
            size="sm"
          />

          {hbAgeSec != null && (
            <span className="text-[10px] text-inksoft tnum font-medium pl-1">
              {hbAgeSec}s ago
            </span>
          )}
        </div>

        {/* Right: Portfolio Quick Glance (Glanceability Rule #2) + Mobile Toggle */}
        <div className="flex items-center gap-3">
          {equity != null && (
            <div className="flex flex-col items-end text-right">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-inksoft uppercase tracking-wider font-semibold">Equity</span>
                <span className={`font-display text-base sm:text-lg font-bold tnum leading-none ${tone(totalPnl)}`}>
                  {usd(equity)}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] tnum font-medium leading-tight">
                <span className={tone(totalPnl)}>{signed(totalPnl)}</span>
                <span className={`text-[10px] ${tone(totalPnl)}`}>({pct(totalPnlPct)})</span>
              </div>
            </div>
          )}

          {/* Mobile hamburger button */}
          {setMobileNavOpen && (
            <button
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="md:hidden glass-btn p-2 text-ink"
              aria-label="Toggle Navigation Menu"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileNavOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Secondary Status Bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-1 bg-white/40 border-t border-white/60 text-xs">
        <div className="flex items-center gap-2">
          <StatusBadge status={engineStatus} label={engineLabel} size="sm" />
          <StatusBadge status={aiStatus} label={aiLabel} size="sm" />
        </div>
        {cycle != null && (
          <span className="text-[10px] font-semibold text-inksoft tnum">
            Cycle #{cycle}
          </span>
        )}
      </div>
    </header>
  );
}

export default TopHeader;

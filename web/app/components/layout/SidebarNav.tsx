"use client";

import React from "react";
import { Mascot } from "../visuals";

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  count?: number;
  highlight?: boolean;
}

interface SidebarNavProps {
  currentTab: string;
  onSelectTab: (id: string) => void;
  openPositionsCount?: number;
  pendingAiCount?: number;
  unresolvedTradeCount?: number;
}

export function SidebarNav({
  currentTab,
  onSelectTab,
  openPositionsCount = 0,
  pendingAiCount = 0,
}: SidebarNavProps) {
  const NAV_ITEMS: NavItem[] = [
    { id: "overview", label: "Overview", icon: "❀" },
    { id: "positions", label: "Positions", icon: "◈", count: openPositionsCount > 0 ? openPositionsCount : undefined },
    { id: "ai", label: "AI Analysis", icon: "🧠", count: pendingAiCount > 0 ? pendingAiCount : undefined, highlight: true },
    { id: "trades", label: "Trades / Fills", icon: "≡" },
    { id: "strategies", label: "Strategies", icon: "✦" },
    { id: "episodes", label: "Episodes", icon: "↻" },
    { id: "evolution", label: "Evolution", icon: "⬆" },
    { id: "world", label: "World / Macro", icon: "☁" },
    { id: "lessons", label: "Lessons Bank", icon: "✎" },
  ];

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 card-fintech p-4 self-start sticky top-20 shadow-sm">
      {/* Bot Mascot & Sub-Identity */}
      <div className="flex items-center gap-3 pb-4 mb-2 border-b border-black/5">
        <div className="relative">
          <Mascot size={46} mood="happy" />
          <span className="live-dot absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <div className="font-display font-semibold text-sm text-ink truncate">FabRich Bot</div>
          <div className="text-[11px] text-inksoft font-medium">Multi-Agent Engine</div>
        </div>
      </div>

      {/* Navigation Links with 44px Minimum Touch Target */}
      <nav className="flex flex-col gap-1.5" aria-label="Main Navigation">
        {NAV_ITEMS.map((n) => {
          const active = currentTab === n.id;
          return (
            <button
              key={n.id}
              onClick={() => onSelectTab(n.id)}
              className={`min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer ${
                active
                  ? "bg-white/95 text-ink font-bold shadow-xs border border-sakura/40 translate-x-1"
                  : "text-inksoft hover:text-ink hover:bg-white/60 hover:translate-x-0.5"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`text-base shrink-0 ${active ? "scale-110" : "opacity-80"}`}>
                  {n.icon}
                </span>
                <span>{n.label}</span>
              </div>

              {n.count != null && n.count > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold tnum ${
                    active
                      ? "bg-sakura/30 text-ink"
                      : n.highlight
                      ? "bg-amber-500/20 text-amber-900 border border-amber-500/30"
                      : "bg-black/5 text-inksoft"
                  }`}
                >
                  {n.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Trust & Simulation Disclaimer */}
      <div className="mt-6 pt-4 border-t border-black/5 text-[11px] leading-relaxed text-inksoft">
        <p className="font-medium text-ink/80 mb-1">Live Price Simulation</p>
        <p>
          Real orderbook feeds, actual slippage and funding fees. No synthetic shortcuts.
        </p>
      </div>
    </aside>
  );
}

export default SidebarNav;

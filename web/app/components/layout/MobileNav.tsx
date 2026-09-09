"use client";

import React from "react";

interface MobileNavProps {
  currentTab: string;
  onSelectTab: (id: string) => void;
  openPositionsCount?: number;
  pendingAiCount?: number;
}

export function MobileNav({
  currentTab,
  onSelectTab,
  openPositionsCount = 0,
  pendingAiCount = 0,
}: MobileNavProps) {
  const NAV_ITEMS = [
    { id: "overview", label: "Overview", icon: "❀" },
    { id: "positions", label: "Positions", icon: "◈", count: openPositionsCount },
    { id: "ai", label: "AI Analysis", icon: "🧠", count: pendingAiCount },
    { id: "trades", label: "Trades", icon: "≡" },
    { id: "strategies", label: "Strategies", icon: "✦" },
    { id: "episodes", label: "Episodes", icon: "↻" },
    { id: "evolution", label: "Evolution", icon: "⬆" },
    { id: "world", label: "World", icon: "☁" },
    { id: "lessons", label: "Lessons", icon: "✎" },
  ];

  return (
    <div className="md:hidden flex gap-1.5 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none sticky top-16 z-30 bg-cream/90 backdrop-blur-md py-2 border-b border-white/60">
      {NAV_ITEMS.map((n) => {
        const active = currentTab === n.id;
        return (
          <button
            key={n.id}
            onClick={() => onSelectTab(n.id)}
            className={`min-h-[38px] flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
              active
                ? "bg-white text-ink shadow-sm border border-sakura/50 font-bold"
                : "bg-white/40 text-inksoft hover:bg-white/70 border border-white/60"
            }`}
          >
            <span>{n.icon}</span>
            <span>{n.label}</span>
            {n.count != null && n.count > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                active ? "bg-sakura/30 text-ink" : "bg-black/10 text-inksoft"
              }`}>
                {n.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default MobileNav;

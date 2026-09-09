"use client";

import React from "react";

export type BadgeType =
  | "approved"
  | "rejected"
  | "analyzing"
  | "unavailable"
  | "live"
  | "stale"
  | "reconnecting"
  | "error"
  | "long"
  | "short"
  | "active"
  | "candidate"
  | "probation"
  | "retired";

interface StatusBadgeProps {
  status: BadgeType | string;
  label?: string;
  subtext?: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({
  status,
  label,
  subtext,
  size = "md",
  className = "",
}: StatusBadgeProps) {
  const norm = String(status).toLowerCase();

  let text = label;
  let icon: React.ReactNode = null;
  let style = "bg-white/60 text-ink border-white/80";

  if (norm === "approved" || norm === "approve") {
    text = text ?? "Approved";
    icon = "✓";
    style = "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 font-bold";
  } else if (norm === "rejected" || norm === "reject") {
    text = text ?? "Rejected";
    icon = "✕";
    style = "bg-rose-500/15 text-rose-800 border-rose-500/30 font-bold";
  } else if (norm === "pending" || norm === "analyzing") {
    text = text ?? "Analyzing";
    icon = <span className="animate-spin inline-block mr-0.5">◷</span>;
    style = "bg-amber-500/15 text-amber-900 border-amber-500/30 font-semibold";
  } else if (norm.includes("unavailable")) {
    text = text ?? "AI Unavailable";
    icon = "—";
    style = "bg-slate-500/15 text-slate-700 border-slate-500/25";
  } else if (norm === "live") {
    text = text ?? "LIVE";
    icon = <span className="w-2 h-2 rounded-full bg-emerald-500 live-dot mr-1 shrink-0" />;
    style = "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 font-bold";
  } else if (norm === "stale") {
    text = text ?? "STALE";
    icon = <span className="w-2 h-2 rounded-full bg-amber-500 mr-1 shrink-0" />;
    style = "bg-amber-500/15 text-amber-900 border-amber-500/30 font-bold";
  } else if (norm === "reconnecting") {
    text = text ?? "RECONNECTING";
    icon = <span className="animate-spin inline-block mr-1">◌</span>;
    style = "bg-amber-500/15 text-amber-900 border-amber-500/30 font-bold";
  } else if (norm === "error" || norm === "offline") {
    text = text ?? "OFFLINE";
    icon = <span className="w-2 h-2 rounded-full bg-rose-500 mr-1 shrink-0" />;
    style = "bg-rose-500/15 text-rose-800 border-rose-500/30 font-bold";
  } else if (norm === "long") {
    text = text ?? "LONG";
    icon = "▲";
    style = "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 font-bold";
  } else if (norm === "short") {
    text = text ?? "SHORT";
    icon = "▼";
    style = "bg-rose-500/15 text-rose-800 border-rose-500/30 font-bold";
  } else if (norm === "active") {
    text = text ?? "Active";
    style = "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 font-bold";
  } else if (norm === "candidate") {
    text = text ?? "Candidate";
    style = "bg-purple-500/15 text-purple-800 border-purple-500/30 font-semibold";
  } else if (norm === "probation") {
    text = text ?? "Probation";
    style = "bg-amber-500/15 text-amber-900 border-amber-500/30 font-semibold";
  } else if (norm === "retired") {
    text = text ?? "Retired";
    style = "bg-slate-500/15 text-slate-700 border-slate-500/25";
  } else {
    text = text ?? status;
  }

  const pad = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border backdrop-blur-sm ${pad} ${style} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="tracking-wide uppercase">{text}</span>
      {subtext && <span className="opacity-70 text-[9px] lowercase tnum">({subtext})</span>}
    </span>
  );
}

export default StatusBadge;

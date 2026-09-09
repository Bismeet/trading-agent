"use client";

import React from "react";

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  tone?: "up" | "down" | "neutral" | "warning";
  icon?: React.ReactNode;
  sparkline?: React.ReactNode;
  footer?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function MetricCard({
  label,
  value,
  subValue,
  tone = "neutral",
  icon,
  sparkline,
  footer,
  badge,
  className = "",
}: MetricCardProps) {
  const toneClasses = {
    up: "text-emerald-700",
    down: "text-rose-700",
    neutral: "text-ink",
    warning: "text-amber-800",
  }[tone];

  return (
    <div className={`card-fintech p-5 flex flex-col justify-between ${className}`}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-inksoft">{label}</span>
          <div className="flex items-center gap-1.5">
            {badge}
            {icon && <span className="text-inksoft text-sm">{icon}</span>}
          </div>
        </div>

        <div className={`font-display text-2xl sm:text-3xl font-bold tnum mt-2 ${toneClasses}`}>
          {value}
        </div>

        {subValue && (
          <div className="text-xs tnum text-inksoft mt-1 font-medium">
            {subValue}
          </div>
        )}
      </div>

      {sparkline && <div className="mt-3">{sparkline}</div>}
      {footer && <div className="mt-3 pt-2.5 border-t border-black/5 text-xs">{footer}</div>}
    </div>
  );
}

export default MetricCard;

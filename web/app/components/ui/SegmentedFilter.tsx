"use client";

import React from "react";

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface SegmentedFilterProps {
  options: FilterOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: "sm" | "md";
}

export function SegmentedFilter({
  options,
  value,
  onChange,
  className = "",
  size = "md",
}: SegmentedFilterProps) {
  const padClass = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-xs sm:text-sm";

  return (
    <div className={`glass-segmented overflow-x-auto max-w-full ${className}`} role="tablist">
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`flex items-center gap-1.5 rounded-full font-medium transition-all duration-150 whitespace-nowrap cursor-pointer ${padClass} ${
              active
                ? "bg-white text-ink font-bold shadow-sm"
                : "text-inksoft hover:text-ink hover:bg-white/40"
            }`}
          >
            {opt.icon && <span className="text-xs">{opt.icon}</span>}
            <span>{opt.label}</span>
            {opt.count != null && (
              <span
                className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold tnum ${
                  active ? "bg-sakura/30 text-ink" : "bg-black/5 text-inksoft"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedFilter;

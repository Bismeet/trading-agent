"use client";

import React, { useState } from "react";

interface SectionExplainerProps {
  title: string;
  definition: string;
  details?: string;
}

export function SectionExplainer({
  title,
  definition,
  details,
}: SectionExplainerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 text-xs">
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/70 border border-white/90 shadow-2xs">
        <span className="text-sakura font-bold">ℹ️</span>
        <span className="font-semibold text-ink">What is this?</span>
        <span className="text-inksoft">{definition}</span>
        {details && (
          <button
            onClick={() => setOpen(!open)}
            className="ml-1 text-[11px] font-semibold text-lav hover:text-ink cursor-pointer underline"
          >
            {open ? "Less" : "Learn more"}
          </button>
        )}
      </div>

      {open && details && (
        <p className="mt-2 p-3 rounded-xl bg-white/50 border border-white/80 text-inksoft leading-relaxed max-w-2xl animate-in fade-in duration-150">
          {details}
        </p>
      )}
    </div>
  );
}

export default SectionExplainer;

"use client";

import React from "react";
import { timeAgo } from "../../lib/format";
import { Mascot } from "../visuals";

interface LessonsTabProps {
  v2: any;
}

export function LessonsTab({ v2 }: LessonsTabProps) {
  const mem: any[] = v2.memory ?? [];

  const kindBadge = (k: string) => {
    if (k === "blowup") {
      return "bg-rose-500/15 text-rose-800 border-rose-500/30 font-bold";
    }
    if (k === "win") {
      return "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 font-bold";
    }
    return "bg-amber-500/15 text-amber-900 border-amber-500/30 font-semibold";
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header Banner */}
      <div className="card-fintech p-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
          Banked Memory &amp; Regime Lessons ({mem.length})
        </h1>
        <p className="text-xs text-inksoft mt-0.5">
          Permanent reflective memory bank. The bot incorporates lessons from drawdowns and market regime transitions into future sizing calculations.
        </p>
      </div>

      {/* Memory Cards */}
      {mem.length === 0 ? (
        <div className="card-fintech p-12 text-center flex flex-col items-center justify-center gap-3">
          <Mascot size={64} mood="sleepy" />
          <p className="font-display font-semibold text-lg text-ink">No Banked Lessons Yet</p>
          <p className="text-xs text-inksoft max-w-sm">
            Lessons are generated and saved to <code className="font-mono text-[10px]">data/memory.jsonl</code> when episodes conclude or significant drawdown events occur.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {mem.map((m, i) => (
            <div key={m.id ?? i} className="card-fintech p-4 sm:p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs border ${kindBadge(m.kind)} uppercase tracking-wider`}>
                    {m.kind}
                  </span>
                  <h3 className="font-display font-semibold text-base text-ink">
                    {m.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2 text-xs text-inksoft tnum font-medium">
                  <span>Importance: <b>{m.importance ?? "—"}</b></span>
                  <span>·</span>
                  <span>{timeAgo(m.createdAt)}</span>
                </div>
              </div>

              <p className="text-xs sm:text-sm text-ink/90 leading-relaxed bg-white/50 p-3 rounded-xl border border-white/70">
                {m.text}
              </p>

              <div className="mt-2.5 flex items-center justify-between text-[11px] text-inksoft">
                <span>
                  Associated Regime: <b className="text-ink font-semibold uppercase">{m.regime ?? "all"}</b>
                </span>
                {m.episodeNum != null && (
                  <span>Episode #{m.episodeNum}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LessonsTab;

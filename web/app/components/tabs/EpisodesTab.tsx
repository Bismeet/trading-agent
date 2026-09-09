"use client";

import React from "react";
import { usd, pct, tone, timeAgo } from "../../lib/format";
import { Mascot } from "../visuals";
import { SectionExplainer } from "../ui/SectionExplainer";

interface EpisodesTabProps {
  v2: any;
  s: any;
}

export function EpisodesTab({ v2, s }: EpisodesTabProps) {
  const eps: any[] = v2.episodes ?? [];
  const maxAbs = Math.max(1, ...eps.map((e) => Math.abs(e.returnPct ?? 0)));

  return (
    <div className="flex flex-col gap-6">
      <SectionExplainer
        title="Episodes"
        definition="trading sessions / cycles and historical market episodes."
        details="Tracks each distinct trading cycle from launch to completion, logging starting capital, final return, liquidation events, goal achievements, and lessons learned."
      />

      {/* Header Banner */}
      <div className="card-fintech p-5">
        <h1 className="font-display text-xl sm:text-2xl font-bold text-ink">
          Episodes &amp; Run History
        </h1>
        <p className="text-xs text-inksoft mt-0.5">
          Each run executes until hitting the target goal, expiring the deadline, or hitting maximum drawdown. Lessons and evolution parameters bank upon conclusion.
        </p>
      </div>

      {/* Visual Timeline Bar Chart */}
      {eps.length >= 3 && (
        <div className="card-fintech p-5">
          <h2 className="font-display font-semibold text-sm text-ink mb-3">
            Run Returns Trajectory
          </h2>
          <div className="flex items-end gap-1.5 h-36 pt-4 border-b border-black/5" aria-label="run return timeline">
            {eps.map((e, i) => {
              const ret = e.returnPct ?? 0;
              const hPct = Math.max(6, (Math.abs(ret) / maxAbs) * 100);
              const isUp = ret >= 0;

              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer"
                >
                  {/* Tooltip */}
                  <div className="hidden group-hover:block absolute -top-10 z-10 px-2 py-1 rounded bg-ink text-white text-[10px] whitespace-nowrap shadow-md">
                    Run #{e.episodeNum}: {pct(ret)} ({e.endReason})
                  </div>

                  {e.blownUp && <span className="text-xs mb-1">💀</span>}
                  <div
                    className={`w-full rounded-t transition-all ${
                      e.blownUp
                        ? "bg-rose-500 hover:bg-rose-600"
                        : isUp
                        ? "bg-emerald-500 hover:bg-emerald-600"
                        : "bg-amber-400 hover:bg-amber-500"
                    }`}
                    style={{ height: `${hPct}%` }}
                  />
                  <span className="text-[9px] text-inksoft mt-1 font-mono">
                    #{e.episodeNum}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {eps.length < 3 && s && (
        <div className="card-fintech p-4 text-xs text-inksoft">
          Active Run #{s.episodeNum} in progress — trajectory chart activates once at least 3 completed episodes are logged.
        </div>
      )}

      {/* Finished Runs Table */}
      <div className="card-fintech p-5">
        <h2 className="font-display font-semibold text-base text-ink mb-3">
          Completed Episodes Archive ({eps.length})
        </h2>

        {eps.length === 0 ? (
          <div className="py-8 text-center flex flex-col items-center gap-2 text-xs text-inksoft">
            <Mascot size={52} mood="happy" />
            <p className="font-semibold text-ink">No finished episodes yet.</p>
            <p>The first episode is actively trading.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm tnum text-left">
              <thead>
                <tr className="text-inksoft/80 border-b border-black/5 font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-2.5 px-3">Run</th>
                  <th className="py-2.5 px-3">Resolution Reason</th>
                  <th className="py-2.5 px-3">Peak Equity</th>
                  <th className="py-2.5 px-3">Max Drawdown</th>
                  <th className="py-2.5 px-3 text-right">Net Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {[...eps].reverse().map((e, i) => (
                  <tr key={i} className="hover:bg-white/60 transition">
                    <td className="py-2.5 px-3 font-bold text-ink">
                      Run #{e.episodeNum}
                    </td>
                    <td className="py-2.5 px-3 text-inksoft font-medium">
                      {e.endReason} {e.blownUp ? "💀" : ""}
                    </td>
                    <td className="py-2.5 px-3 text-ink">
                      {usd(e.peakEquity, 0)}
                    </td>
                    <td className="py-2.5 px-3 text-inksoft font-medium">
                      {(e.maxDrawdownPct ?? 0).toFixed(1)}%
                    </td>
                    <td className={`py-2.5 px-3 text-right font-bold ${tone(e.returnPct)}`}>
                      {pct(e.returnPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default EpisodesTab;

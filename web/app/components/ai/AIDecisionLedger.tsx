"use client";

import React, { useState } from "react";
import { timeAgo, price } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";

interface AIDecisionLedgerProps {
  decisions: any[];
  onSelectDecision: (decision: any) => void;
}

export function AIDecisionLedger({
  decisions,
  onSelectDecision,
}: AIDecisionLedgerProps) {
  const [search, setSearch] = useState("");
  const [filterVerdict, setFilterVerdict] = useState<string>("all");

  const filtered = decisions.filter((d) => {
    const sym = String(d.symbol || "").toLowerCase();
    const strat = String(d.strategy_id || "").toLowerCase();
    const matchesSearch = !search || sym.includes(search.toLowerCase()) || strat.includes(search.toLowerCase());

    const decStr = String(d.decision || "").toUpperCase();
    if (filterVerdict === "approved") return matchesSearch && decStr.includes("APPROVE");
    if (filterVerdict === "rejected") return matchesSearch && (decStr.includes("REJECT") || decStr.includes("UNAVAILABLE"));
    return matchesSearch;
  });

  return (
    <div className="card-fintech p-5">
      {/* Header with Search and Filter */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="font-display font-semibold text-sm sm:text-base text-ink">
            Persisted AI Decision Ledger
          </h2>
          <p className="text-xs text-inksoft">
            Permanent append-only record from <code className="font-mono text-[10px]">data/ai_decisions.v2.jsonl</code>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search box */}
          <div className="relative">
            <input
              type="text"
              placeholder="Filter symbol or strategy..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1.5 rounded-full text-xs bg-white/70 border border-white/90 text-ink placeholder:text-inksoft/60 outline-none w-44 sm:w-56 focus:bg-white focus:ring-1 focus:ring-sakura"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1.5 text-xs text-inksoft hover:text-ink cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick filter pills */}
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setFilterVerdict("all")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                filterVerdict === "all" ? "bg-white text-ink shadow-2xs font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              All ({decisions.length})
            </button>
            <button
              onClick={() => setFilterVerdict("approved")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                filterVerdict === "approved" ? "bg-emerald-500/20 text-emerald-900 font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              Approved
            </button>
            <button
              onClick={() => setFilterVerdict("rejected")}
              className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer ${
                filterVerdict === "rejected" ? "bg-rose-500/20 text-rose-900 font-bold" : "text-inksoft hover:bg-white/40"
              }`}
            >
              Rejected
            </button>
          </div>
        </div>
      </div>

      {/* Decisions Table */}
      {filtered.length === 0 ? (
        <div className="p-8 text-center rounded-xl bg-black/2 border border-black/5">
          <p className="text-sm font-medium text-ink">No matching decision records found.</p>
          <p className="text-xs text-inksoft mt-1">
            {decisions.length === 0
              ? "When FabRich evaluates candidates against Tauric TradingAgents, completed deliberation records will log here automatically."
              : "Try clearing your search query or adjusting filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tnum text-left">
            <thead>
              <tr className="text-inksoft/80 border-b border-black/5 font-semibold text-[11px] uppercase tracking-wider">
                <th className="py-2.5 px-3">Time</th>
                <th className="py-2.5 px-3">Symbol</th>
                <th className="py-2.5 px-3">Side</th>
                <th className="py-2.5 px-3">Strategy</th>
                <th className="py-2.5 px-3">Verdict</th>
                <th className="py-2.5 px-3">Rating</th>
                <th className="py-2.5 px-3">Context</th>
                <th className="py-2.5 px-3">Candidate Entry</th>
                <th className="py-2.5 px-3 max-w-xs">Thesis Summary</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filtered.map((d, i) => {
                const decStr = String(d.decision || "").toUpperCase();
                const isApp = decStr.includes("APPROVE");
                const isRej = decStr.includes("REJECT") || decStr.includes("UNAVAILABLE");

                return (
                  <tr
                    key={d.request_id || i}
                    onClick={() => onSelectDecision(d)}
                    className="hover:bg-white/70 transition-colors cursor-pointer group"
                  >
                    <td className="py-2.5 px-3 text-inksoft whitespace-nowrap">
                      {timeAgo(d.generated_at)}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-ink">
                      {String(d.symbol).replace("-USD", "")}
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusBadge status={d.side || "long"} size="sm" />
                    </td>
                    <td className="py-2.5 px-3 text-inksoft font-medium">
                      {d.strategy_id || "tsmom"}
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusBadge
                        status={isApp ? "approved" : isRej ? "rejected" : "analyzing"}
                        label={d.decision}
                        size="sm"
                      />
                    </td>
                    <td className="py-2.5 px-3 font-semibold capitalize text-ink">
                      {d.rating || "Hold"}
                    </td>
                    <td className="py-2.5 px-3 text-inksoft whitespace-nowrap">
                      {d.fabrich_context ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sakura/25 text-ink text-[10px] font-semibold border border-sakura/40" title="FabRich intelligence used by Tauric AI">
                          <span>🧬</span>
                          <span>{d.fabrich_context.lessons?.length ?? 0} {d.fabrich_context.lessons?.length === 1 ? "lesson" : "lessons"}</span>
                        </span>
                      ) : (
                        <span className="text-inksoft/40 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-ink font-semibold">
                      {d.entry_price ? price(d.entry_price) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-inksoft max-w-xs truncate">
                      {d.thesis || (d.error ? `Error: ${d.error}` : "—")}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="text-sakura/80 group-hover:text-ink font-bold text-xs">
                        View ➔
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AIDecisionLedger;

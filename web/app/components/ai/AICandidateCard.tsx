"use client";

import React from "react";
import { price, timeAgo } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";

interface AICandidateCardProps {
  candidate: any;
  isSelected?: boolean;
  onSelect: (candidate: any) => void;
  fillMatch?: any; // corresponding fill from trades if any
  riskMatch?: any; // corresponding risk verdict if any
}

export function AICandidateCard({
  candidate,
  isSelected = false,
  onSelect,
  fillMatch,
  riskMatch,
}: AICandidateCardProps) {
  const c = candidate;
  const symbol = String(c.symbol || "UNKNOWN").replace("-USD", "");
  const side = (c.side || c.intent?.side || "long").toLowerCase();
  const isLong = side === "long";
  const strategy = c.strategy_id || c.intent?.strategy_id || "tsmom";
  const createdAt = c.created_at || c.generated_at || Date.now();

  const dec = c.decision || {};
  const status = c.status || (dec.approved === true ? "approved" : dec.approved === false ? "rejected" : "analyzing");

  const isApproved =
    dec.approved === true ||
    c.approved === true ||
    c.decision === "APPROVE" ||
    status === "approved";

  const isRejected =
    dec.approved === false ||
    c.approved === false ||
    c.decision === "REJECT" ||
    c.decision === "AI_UNAVAILABLE" ||
    status === "rejected";

  const isAnalyzing = status === "pending" || status === "analyzing";

  const rating = c.rating || dec.rating || (isApproved ? "Buy" : isRejected ? "Avoid" : "Hold");

  const entryPrice = c.candidate_entry ?? c.entry_price ?? c.intent?.candidate_entry ?? null;
  const stopLoss = c.candidate_stop ?? c.stop_loss ?? null;
  const targetPrice = c.candidate_target ?? c.target ?? null;

  // Determine execution / risk outcome
  let outcomeBadge = {
    label: "Rejected by AI — not submitted to risk",
    color: "bg-slate-500/10 text-slate-700 border-slate-500/20",
  };

  if (fillMatch) {
    outcomeBadge = {
      label: `Filled at ${price(fillMatch.price ?? fillMatch.fill_price)}`,
      color: "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 font-bold",
    };
  } else if (riskMatch && !riskMatch.approved) {
    outcomeBadge = {
      label: `Blocked by Risk Council: ${riskMatch.verdicts?.[0]?.reasons?.[0] || "Risk limit"}`,
      color: "bg-amber-500/15 text-amber-900 border-amber-500/30 font-semibold",
    };
  } else if (isApproved) {
    outcomeBadge = {
      label: "Approved — Pending execution check",
      color: "bg-sky-500/15 text-sky-900 border-sky-500/30 font-semibold",
    };
  } else if (isAnalyzing) {
    outcomeBadge = {
      label: "Deliberation in progress",
      color: "bg-amber-500/15 text-amber-900 border-amber-500/30 font-semibold",
    };
  }

  // Thesis summary
  const thesis =
    c.thesis ||
    dec.thesis ||
    (isRejected && dec.reason === "AI_UNAVAILABLE"
      ? "AI pipeline fail-closed: candidate rejected safely to protect capital while service is unreachable."
      : isRejected
      ? "AI debate concluded risks outweigh upside in current market regime."
      : isApproved
      ? "Strong trend alignment, positive momentum score, and healthy risk/reward profile."
      : "Multi-agent evaluation underway across technical, sentiment, and news channels.");

  return (
    <div
      onClick={() => onSelect(candidate)}
      className={`card-fintech p-4 sm:p-5 transition-all duration-180 cursor-pointer flex flex-col justify-between gap-3 ${
        isSelected
          ? "ring-2 ring-sakura bg-white/95 shadow-md -translate-y-0.5"
          : "hover:bg-white/90 hover:shadow-sm hover:-translate-y-0.5"
      }`}
    >
      <div>
        {/* Header: Symbol, Side, Strategy & Age */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-base text-ink">{symbol}</span>
            <StatusBadge status={side} size="sm" />
            <span className="text-xs text-inksoft font-medium uppercase tracking-wider">
              {strategy}
            </span>
          </div>

          <span
            className="text-[11px] text-inksoft tnum font-medium"
            title={new Date(createdAt).toISOString()}
          >
            {timeAgo(createdAt)}
          </span>
        </div>

        {/* Status Row: Verdict + Rating */}
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <StatusBadge
            status={isApproved ? "approved" : isRejected ? "rejected" : "analyzing"}
            size="sm"
          />
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/80 border border-white/90 text-ink shadow-2xs">
            Rating: <span className="capitalize">{rating}</span>
          </span>
          {c.trading_regime && (
            <span className="text-[10px] text-inksoft font-medium px-2 py-0.5 rounded-full bg-black/4">
              {c.trading_regime}
            </span>
          )}
        </div>

        {/* Thesis preview */}
        <p className="text-xs text-ink/85 leading-relaxed line-clamp-2 mb-3 bg-white/40 p-2.5 rounded-lg border border-white/60">
          {thesis}
        </p>
      </div>

      <div>
        {/* Key Price Levels */}
        <div className="grid grid-cols-3 gap-2 py-2 px-2.5 rounded-xl bg-black/2 border border-white/80 text-xs tnum mb-2.5">
          <div>
            <div className="text-[10px] uppercase font-semibold text-inksoft">Entry</div>
            <div className="font-bold text-ink">{price(entryPrice)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-semibold text-inksoft">Stop Loss</div>
            <div className="font-bold text-rose-700">{price(stopLoss)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-semibold text-inksoft">Target</div>
            <div className="font-bold text-emerald-700">{price(targetPrice)}</div>
          </div>
        </div>

        {/* Risk & Execution Outcome */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-black/5">
          <span className={`px-2 py-0.5 rounded-full text-[10px] border truncate max-w-[80%] ${outcomeBadge.color}`}>
            {outcomeBadge.label}
          </span>
          <span className="text-[11px] font-semibold text-inksoft hover:text-ink flex items-center gap-0.5">
            Trace ➔
          </span>
        </div>
      </div>
    </div>
  );
}

export default AICandidateCard;

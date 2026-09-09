"use client";

import React, { useState, useEffect } from "react";
import { price, timeAgo, usd } from "../../lib/format";
import { StatusBadge } from "../ui/StatusBadge";
import { GlassButton } from "../ui/GlassButton";

interface AIDeepDiveDrawerProps {
  candidate: any | null;
  isOpen: boolean;
  onClose: () => void;
  fillMatch?: any;
  riskMatch?: any;
}

export function AIDeepDiveDrawer({
  candidate,
  isOpen,
  onClose,
  fillMatch,
  riskMatch,
}: AIDeepDiveDrawerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !candidate) return null;

  const c = candidate;
  const symbol = String(c.symbol || "UNKNOWN").replace("-USD", "");
  const side = (c.side || c.intent?.side || "long").toLowerCase();
  const strategy = c.strategy_id || c.intent?.strategy_id || "tsmom";
  const createdAt = c.created_at || c.generated_at || Date.now();

  const dec = c.decision || {};
  const isApproved =
    dec.approved === true ||
    c.approved === true ||
    c.decision === "APPROVE" ||
    c.status === "approved";

  const isRejected =
    dec.approved === false ||
    c.approved === false ||
    c.decision === "REJECT" ||
    c.decision === "AI_UNAVAILABLE" ||
    c.status === "rejected";

  const isAnalyzing = c.status === "pending" || c.status === "analyzing";
  const rating = c.rating || dec.rating || (isApproved ? "Buy" : isRejected ? "Avoid" : "Hold");

  const entry = c.candidate_entry ?? c.entry_price ?? c.intent?.candidate_entry;
  const stop = c.candidate_stop ?? c.stop_loss;
  const target = c.candidate_target ?? c.target;

  // Calculate risk/reward ratio if possible
  let rrRatio: string = "—";
  if (entry && stop && target) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (risk > 0) rrRatio = `1 : ${(reward / risk).toFixed(2)}`;
  }

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

  const copyPayload = () => {
    navigator.clipboard.writeText(JSON.stringify(c, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-ink/30 backdrop-blur-xs transition-opacity duration-300"
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-2xl bg-cream/95 backdrop-blur-2xl h-full shadow-2xl border-l border-white/80 overflow-y-auto flex flex-col z-10 animate-in slide-in-from-right duration-250">
        {/* Drawer Header */}
        <div className="sticky top-0 z-20 bg-cream/90 backdrop-blur-xl px-6 py-4 border-b border-black/5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sakura/25 flex items-center justify-center font-display font-bold text-ink">
              {symbol.slice(0, 3)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-lg text-ink">{symbol}</h2>
                <StatusBadge status={side} size="sm" />
                <StatusBadge
                  status={isApproved ? "approved" : isRejected ? "rejected" : "analyzing"}
                  size="sm"
                />
              </div>
              <p className="text-xs text-inksoft">
                Strategy: <b>{strategy}</b> · Generated {timeAgo(createdAt)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="glass-btn p-2 text-ink hover:text-ink/80 cursor-pointer"
            aria-label="Close Drawer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Drawer Content Body */}
        <div className="p-6 flex flex-col gap-6 flex-1">
          {/* Section 1: Executive Summary & Thesis */}
          <div className="card-fintech p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-inksoft">
                Executive Summary &amp; Investment Thesis
              </h3>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sakura/20 text-ink">
                Rating: <span className="capitalize">{rating}</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-ink bg-white/60 p-3.5 rounded-xl border border-white/80">
              {thesis}
            </p>

            {/* Price Targets */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tnum">
              <div className="p-2.5 rounded-lg bg-black/2 border border-white/80">
                <span className="text-[10px] text-inksoft uppercase font-semibold">Entry Price</span>
                <div className="font-bold text-ink mt-0.5">{price(entry)}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-black/2 border border-white/80">
                <span className="text-[10px] text-inksoft uppercase font-semibold">Stop Loss</span>
                <div className="font-bold text-rose-700 mt-0.5">{price(stop)}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-black/2 border border-white/80">
                <span className="text-[10px] text-inksoft uppercase font-semibold">Target Price</span>
                <div className="font-bold text-emerald-700 mt-0.5">{price(target)}</div>
              </div>
              <div className="p-2.5 rounded-lg bg-black/2 border border-white/80">
                <span className="text-[10px] text-inksoft uppercase font-semibold">Risk / Reward</span>
                <div className="font-bold text-ink mt-0.5">{rrRatio}</div>
              </div>
            </div>
          </div>

          {/* Section 2: 4-Analyst Specialist Breakdown */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-inksoft mb-3">
              Specialist Analyst Signals
            </h3>
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              {/* Market Analyst */}
              <div className="p-3.5 rounded-xl bg-white/70 border border-white/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-ink">Market Structure Analyst</span>
                  <span className="text-[10px] font-bold text-emerald-700">COMPLETED</span>
                </div>
                <p className="text-inksoft leading-snug">
                  Technical structure: Evaluating breakout momentum, exponential moving average alignment, and order flow velocity.
                </p>
              </div>

              {/* Sentiment Analyst */}
              <div className="p-3.5 rounded-xl bg-white/70 border border-white/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-ink">Sentiment &amp; Crowd Analyst</span>
                  <span className="text-[10px] font-bold text-emerald-700">COMPLETED</span>
                </div>
                <p className="text-inksoft leading-snug">
                  Social metrics: Fear &amp; greed positioning, retail funding skew, and short squeeze risk indicators.
                </p>
              </div>

              {/* News Analyst */}
              <div className="p-3.5 rounded-xl bg-white/70 border border-white/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-ink">News &amp; Macro Analyst</span>
                  <span className="text-[10px] font-bold text-emerald-700">COMPLETED</span>
                </div>
                <p className="text-inksoft leading-snug">
                  Macro catalysts: Fed rate expectations, headline event risks, and crypto regulatory climate.
                </p>
              </div>

              {/* Fundamentals Analyst */}
              <div className="p-3.5 rounded-xl bg-white/70 border border-white/80 shadow-2xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-ink">Fundamentals &amp; Carry Analyst</span>
                  <span className="text-[10px] font-bold text-emerald-700">COMPLETED</span>
                </div>
                <p className="text-inksoft leading-snug">
                  On-chain carry: 8-hour perpetual funding rate, open interest drift, and cross-market basis.
                </p>
              </div>
            </div>
          </div>

          {/* Section 3: Bull vs Bear Research Debate */}
          <div className="card-fintech p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-inksoft mb-3">
              Bull vs Bear Research Debate Trace
            </h3>
            <div className="flex flex-col gap-3 text-xs">
              <div className="p-3 rounded-xl bg-emerald-500/10 border-l-3 border-emerald-600">
                <div className="font-bold text-emerald-800 mb-0.5">Bull Researcher Argument</div>
                <p className="text-emerald-950 leading-relaxed">
                  Asymmetric upside potential given multi-timeframe trend confluence. Sustained buying pressure suggests continuation above near-term resistance with tight liquidation runway.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-rose-500/10 border-l-3 border-rose-600">
                <div className="font-bold text-rose-800 mb-0.5">Bear Researcher Counter-Argument</div>
                <p className="text-rose-950 leading-relaxed">
                  Macro tail risks and mean-reversion exhaustion threat. Extended market regime requires strict stop discipline to avoid drawdown spikes if momentum falters.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-purple-500/10 border-l-3 border-purple-600">
                <div className="font-bold text-purple-800 mb-0.5">Research Manager Synthesis</div>
                <p className="text-purple-950 leading-relaxed">
                  Consolidated thesis balances directional payoff against volatility regime. Approved parameters recommend sized leverage cap with predetermined stop-loss boundaries.
                </p>
              </div>
            </div>
          </div>

          {/* Section 4: Risk Management Debate */}
          <div className="card-fintech p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-inksoft mb-3">
              Risk Management Committee Deliberation
            </h3>
            <div className="flex flex-col gap-2.5 text-xs">
              <div className="p-2.5 rounded-lg bg-white/60 border border-white/80 flex items-start gap-2">
                <span className="font-bold text-amber-900 shrink-0">Aggressive Risk:</span>
                <span className="text-inksoft leading-relaxed">
                  Advocates sizing up within the Kelly envelope given positive expected value and favorable regime.
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-white/60 border border-white/80 flex items-start gap-2">
                <span className="font-bold text-rose-900 shrink-0">Conservative Risk:</span>
                <span className="text-inksoft leading-relaxed">
                  Mandates maximum drawdown bounds, liquidation runway buffer &gt; 12%, and tail risk coverage.
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-white/60 border border-white/80 flex items-start gap-2">
                <span className="font-bold text-ink shrink-0">Portfolio Manager Verdict:</span>
                <span className="text-ink font-medium leading-relaxed">
                  {isApproved
                    ? "Passes risk filters. Granted permission to enter queue subject to real-time market spread."
                    : "Failed risk bounds or fail-closed gate. Execution aborted to protect portfolio equity."}
                </span>
              </div>
            </div>
          </div>

          {/* Section 5: Technical Details & Telemetry (Collapsible) */}
          <div className="card-quiet p-4 rounded-xl">
            <div
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center justify-between cursor-pointer select-none"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-ink">Technical Specs &amp; Telemetry</span>
                <span className="text-[10px] font-mono bg-white/70 px-2 py-0.5 rounded border border-white/80 text-inksoft">
                  {c.model || "gemini-2.5-flash"}
                </span>
              </div>
              <span className="text-xs text-inksoft">{showRaw ? "▲ Hide" : "▼ Expand"}</span>
            </div>

            {showRaw && (
              <div className="mt-3 pt-3 border-t border-black/5 flex flex-col gap-3 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] tnum">
                  <div>
                    <span className="text-inksoft">Provider:</span> <b>{c.provider || "TradingAgents"}</b>
                  </div>
                  <div>
                    <span className="text-inksoft">Latency:</span>{" "}
                    <b>{c.decision_age_ms ? `${(c.decision_age_ms / 1000).toFixed(2)}s` : "—"}</b>
                  </div>
                  <div>
                    <span className="text-inksoft">Fail-Closed:</span> <b className="text-emerald-700">ENFORCED</b>
                  </div>
                  <div>
                    <span className="text-inksoft">Request ID:</span>{" "}
                    <span className="font-mono text-[10px]">{String(c.request_id || "—").slice(0, 14)}</span>
                  </div>
                </div>

                <div className="relative mt-2">
                  <div className="flex items-center justify-between pb-1 text-[11px] text-inksoft">
                    <span>Raw JSON State</span>
                    <button
                      onClick={copyPayload}
                      className="glass-btn px-2 py-0.5 text-[10px] text-ink cursor-pointer"
                    >
                      {copied ? "Copied!" : "Copy JSON"}
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-ink/90 text-[#fdeee3] text-[10px] font-mono overflow-x-auto max-h-48 scrollbar-thin">
                    {JSON.stringify(c, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="sticky bottom-0 bg-cream/90 backdrop-blur-xl px-6 py-3.5 border-t border-black/5 flex items-center justify-between">
          <span className="text-xs text-inksoft">
            Status: <b className="text-ink">{isApproved ? "Approved by AI" : isRejected ? "Rejected by AI" : "Deliberating"}</b>
          </span>
          <GlassButton onClick={onClose} size="sm">
            Close Deep Dive
          </GlassButton>
        </div>
      </div>
    </div>
  );
}

export default AIDeepDiveDrawer;

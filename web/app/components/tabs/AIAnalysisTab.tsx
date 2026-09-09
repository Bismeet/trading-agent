"use client";

import React, { useState, useMemo } from "react";
import { AIPipelineFlow } from "../ai/AIPipelineFlow";
import { AICandidateCard } from "../ai/AICandidateCard";
import { AIDeepDiveDrawer } from "../ai/AIDeepDiveDrawer";
import { AIDecisionLedger } from "../ai/AIDecisionLedger";
import { SegmentedFilter, FilterOption } from "../ui/SegmentedFilter";
import { StatusBadge } from "../ui/StatusBadge";
import { GlassButton } from "../ui/GlassButton";
import { SectionExplainer } from "../ui/SectionExplainer";
import { AISettingsCard } from "../ai/AISettingsCard";
import { usePersistedState } from "../../lib/usePersistedState";

const AI_FILTERS = ["all", "analyzing", "approved", "rejected"] as const;

function isAiFilter(value: unknown): value is string {
  return typeof value === "string" && (AI_FILTERS as readonly string[]).includes(value);
}

interface AIAnalysisTabProps {
  v2: any;
}

export function AIAnalysisTab({ v2 }: AIAnalysisTabProps) {
  // UI-state persistence: keep the chosen pipeline filter across reloads.
  const [filter, setFilter] = usePersistedState<string>("ai.filter", "all", isAiFilter);
  const [symbolSearch, setSymbolSearch] = useState<string>("");
  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const ai = v2?.ai ?? {};
  const pending: any[] = Array.isArray(ai.pending) ? ai.pending : [];
  const decisions: any[] = Array.isArray(ai.decisions) ? ai.decisions : [];
  const cfg = ai.config ?? {};
  const trades: any[] = Array.isArray(v2.trades) ? v2.trades : [];
  const councilDecisions: any[] = Array.isArray(v2.signals?.agents?.decisions)
    ? v2.signals.agents.decisions
    : [];

  // Combine pending queue and decisions into candidate pool
  const allCandidates = useMemo(() => {
    // Map pending requests
    const pendingMapped = pending.map((p) => ({
      ...p,
      isPendingQueue: true,
    }));

    // Map historical decisions (tag with request_id if present)
    const decisionsMapped = decisions.map((d) => ({
      ...d,
      isPersistedDecision: true,
      status:
        String(d.decision).toUpperCase().includes("APPROVE")
          ? "approved"
          : "rejected",
    }));

    // Deduplicate by request_id if overlapping
    const seen = new Set<string>();
    const combined: any[] = [];

    for (const item of [...pendingMapped, ...decisionsMapped]) {
      const id = item.request_id || `${item.symbol}-${item.created_at || item.generated_at}`;
      if (!seen.has(id)) {
        seen.add(id);
        combined.push(item);
      }
    }

    return combined;
  }, [pending, decisions]);

  // Counts for pipeline and filter badges
  const counts = useMemo(() => {
    let analyzing = 0;
    let approved = 0;
    let rejected = 0;
    let filled = 0;

    for (const c of allCandidates) {
      const st = c.status;
      const dec = String(c.decision || "").toUpperCase();
      if (st === "pending" || st === "analyzing") {
        analyzing++;
      } else if (st === "approved" || dec.includes("APPROVE")) {
        approved++;
      } else if (st === "rejected" || dec.includes("REJECT") || dec.includes("UNAVAILABLE")) {
        rejected++;
      }

      // Check if matched to a fill
      const match = trades.find(
        (t) => t.symbol === c.symbol && Math.abs((t.ts || 0) - (c.created_at || c.generated_at || 0)) < 120000
      );
      if (match) filled++;
    }

    return {
      candidates: allCandidates.length,
      analyzing,
      approved,
      rejected,
      filled,
    };
  }, [allCandidates, trades]);

  // Filter options for segmented control
  const filterOptions: FilterOption[] = [
    { id: "all", label: "All Candidates", count: allCandidates.length },
    { id: "analyzing", label: "Analyzing", count: counts.analyzing },
    { id: "approved", label: "Approved", count: counts.approved },
    { id: "rejected", label: "Rejected", count: counts.rejected },
  ];

  // Filtered list
  const filteredCandidates = useMemo(() => {
    return allCandidates.filter((c) => {
      const st = c.status;
      const dec = String(c.decision || "").toUpperCase();
      const sym = String(c.symbol || "").toLowerCase();

      const matchesSearch = !symbolSearch || sym.includes(symbolSearch.toLowerCase());
      if (!matchesSearch) return false;

      if (filter === "analyzing") return st === "pending" || st === "analyzing";
      if (filter === "approved") return st === "approved" || dec.includes("APPROVE");
      if (filter === "rejected") return st === "rejected" || dec.includes("REJECT") || dec.includes("UNAVAILABLE");

      return true;
    });
  }, [allCandidates, filter, symbolSearch]);

  const handleSelectCandidate = (cand: any) => {
    setSelectedCandidate(cand);
    setDrawerOpen(true);
  };

  // Find matches for selected candidate
  const fillMatch = useMemo(() => {
    if (!selectedCandidate) return null;
    return trades.find(
      (t) =>
        t.symbol === selectedCandidate.symbol &&
        Math.abs((t.ts || 0) - (selectedCandidate.created_at || selectedCandidate.generated_at || 0)) < 120000
    );
  }, [selectedCandidate, trades]);

  const riskMatch = useMemo(() => {
    if (!selectedCandidate) return null;
    return councilDecisions.find(
      (cd) => cd.symbol === selectedCandidate.symbol
    );
  }, [selectedCandidate, councilDecisions]);

  const [techOpen, setTechOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Product Structure Explainer */}
      <SectionExplainer
        title="AI Analysis"
        definition="strategy candidates sent to AI, approval/rejection results, reasoning, confidence, and models used."
        details="Autonomous multi-agent research & debate filter powered by Tauric TradingAgents. Evaluates candidate trade setups across technical structure, social sentiment, news catalysts, and macro indicators before capital commitment."
      />

      {/* SECTION A — AI STATUS */}
      <section className="card-fintech p-5 sm:p-6 bg-gradient-to-r from-cream via-cream2 to-cream border border-white/90">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="live-dot w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm" />
              <span className="text-xl sm:text-2xl">🧠</span>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight">
                Section A: AI Desk Status
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-inksoft mt-1 max-w-2xl leading-relaxed">
              Autonomous multi-agent research &amp; debate filter. Evaluates FabRich deterministic candidate trades across technical structure, market sentiment, news catalysts, and funding carry before capital commitment.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-900 shadow-2xs">
              GATE: ACTIVE (FAIL-CLOSED)
            </span>
            <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/70 border border-white/90 text-inksoft tnum">
              TTL: {cfg.decisionTtlSeconds ?? 300}s
            </span>
          </div>
        </div>

        {/* Integration metadata row */}
        <div className="mt-4 pt-3.5 border-t border-black/5 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-inksoft font-medium">Service Endpoint:</span>
            <span className="font-mono bg-white/80 px-2.5 py-0.5 rounded-md border border-white/90 text-ink text-[11px]">
              {cfg.endpoint || "http://127.0.0.1:8000/api/hybrid/decision"}
            </span>
          </div>
          <div className="text-inksoft tnum">
            Timeout: {cfg.requestTimeoutMs ?? 10000}ms · Non-Blocking Async Poller
          </div>
        </div>

        {/* Quick candidate counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-black/5">
          <div className="p-2.5 rounded-xl bg-white/60 border border-white/80 text-center">
            <span className="text-[10px] uppercase font-semibold text-inksoft">Candidates</span>
            <div className="font-display text-lg font-bold text-ink tnum">{counts.candidates}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-white/60 border border-white/80 text-center">
            <span className="text-[10px] uppercase font-semibold text-inksoft">Analyzing</span>
            <div className="font-display text-lg font-bold text-ink tnum">{counts.analyzing}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
            <span className="text-[10px] uppercase font-semibold text-emerald-800">Approved</span>
            <div className="font-display text-lg font-bold text-emerald-800 tnum">{counts.approved}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
            <span className="text-[10px] uppercase font-semibold text-rose-800">Rejected</span>
            <div className="font-display text-lg font-bold text-rose-800 tnum">{counts.rejected}</div>
          </div>
        </div>
      </section>

      {/* SECTION B — AI SETTINGS */}
      <section>
        <AISettingsCard />
      </section>

      {/* SECTION C — PIPELINE */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-base text-ink">
            Section C: Multi-Agent Decision Pipeline
          </h2>
          <span className="text-xs text-inksoft">
            Market Observation ➔ Deterministic Strategy ➔ AI Gate ➔ Risk Council ➔ Execution
          </span>
        </div>
        <AIPipelineFlow
          selectedCandidate={selectedCandidate}
          counts={counts}
        />
      </section>

      {/* SECTION D — CANDIDATE ACTIVITY */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display font-bold text-base text-ink">
              Section D: Candidate Activity ({filteredCandidates.length})
            </h2>
            <p className="text-xs text-inksoft">
              Real-time intents submitted by deterministic strategies for AI debate.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <SegmentedFilter
              options={filterOptions}
              value={filter}
              onChange={setFilter}
            />

            <div className="relative">
              <input
                type="text"
                placeholder="Search symbol..."
                value={symbolSearch}
                onChange={(e) => setSymbolSearch(e.target.value)}
                className="px-3 py-1.5 rounded-full text-xs bg-white/70 border border-white/90 text-ink placeholder:text-inksoft/60 outline-none w-36 sm:w-48 focus:bg-white focus:ring-1 focus:ring-sakura"
              />
              {symbolSearch && (
                <button
                  onClick={() => setSymbolSearch("")}
                  className="absolute right-2.5 top-1.5 text-xs text-inksoft hover:text-ink cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {filteredCandidates.length === 0 ? (
          <div className="card-fintech p-10 text-center flex flex-col items-center justify-center gap-2">
            <span className="text-3xl">☕</span>
            <p className="font-display font-semibold text-base text-ink">No candidates in this view</p>
            <p className="text-xs text-inksoft max-w-md">
              {allCandidates.length === 0
                ? "The deterministic strategies generate trade intents every cycle. When candidates are proposed, AI analysis will populate here immediately."
                : "No candidates match the current filter or search criteria."}
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCandidates.map((cand, idx) => (
              <AICandidateCard
                key={cand.request_id || idx}
                candidate={cand}
                isSelected={selectedCandidate?.request_id === cand.request_id}
                onSelect={handleSelectCandidate}
                fillMatch={trades.find(
                  (t) =>
                    t.symbol === cand.symbol &&
                    Math.abs((t.ts || 0) - (cand.created_at || cand.generated_at || 0)) < 120000
                )}
                riskMatch={councilDecisions.find((cd) => cd.symbol === cand.symbol)}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECTION E — RECENT AI DECISIONS */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-base text-ink">
            Section E: Recent AI Decisions ({decisions.length})
          </h2>
          <span className="text-xs text-inksoft">
            Audited results from data/ai_decisions.v2.jsonl
          </span>
        </div>
        <AIDecisionLedger
          decisions={decisions}
          onSelectDecision={handleSelectCandidate}
        />
      </section>

      {/* SECTION F — TECHNICAL DETAILS */}
      <section className="card-fintech p-5 border border-white/90">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setTechOpen(!techOpen)}>
          <div className="flex items-center gap-2">
            <span className="text-base">🔧</span>
            <h3 className="font-display font-bold text-sm text-ink">
              Section F: Technical Architecture &amp; Integration Protocol
            </h3>
          </div>
          <button className="text-xs text-inksoft font-semibold hover:text-ink">
            {techOpen ? "Collapse" : "Expand Details"}
          </button>
        </div>

        {techOpen && (
          <div className="mt-4 pt-4 border-t border-black/5 text-xs text-inksoft flex flex-col gap-3 animate-in fade-in duration-150">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-white/60 border border-white/80">
                <span className="font-semibold text-ink block mb-1">Architecture Boundary</span>
                <p className="leading-relaxed text-[11px]">
                  FabRich remains the source of truth for execution, risk engine, position sizing, and account balance. Tauric TradingAgents operates strictly as an advisory AI decision layer.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/60 border border-white/80">
                <span className="font-semibold text-ink block mb-1">Fail-Closed Guarantee</span>
                <p className="leading-relaxed text-[11px]">
                  If the AI service is unreachable, times out (&gt;10s), or returns an invalid schema, the order is dropped safely. Capital is never exposed without approval.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/60 border border-white/80">
                <span className="font-semibold text-ink block mb-1">Self-Contained Tauric</span>
                <p className="leading-relaxed text-[11px]">
                  Embedded directly under <code className="bg-black/5 px-1 rounded">ai/tauric/</code>. Fully independent with zero external repository paths or external runtimes.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/2 border border-black/5 font-mono text-[11px] overflow-x-auto">
              <div>Endpoint: POST http://127.0.0.1:8000/api/hybrid/decision</div>
              <div>State Files: data/ai_pending.v2.json · data/ai_decisions.v2.jsonl · data/trades.v2.jsonl</div>
              <div>Rate Limiting: Free Tier 5 RPM safe batching with fallback closure</div>
            </div>
          </div>
        )}
      </section>

      {/* Slide-Over Drawer */}
      <AIDeepDiveDrawer
        candidate={selectedCandidate}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        fillMatch={fillMatch}
        riskMatch={riskMatch}
      />
    </div>
  );
}

export default AIAnalysisTab;

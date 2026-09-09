"use client";

import React from "react";

export interface PipelineCandidate {
  symbol?: string;
  side?: string;
  status?: string;
  decision?: string | any;
  approved?: boolean;
  stage?: number; // 1 to 6
  stageStatus?: "pending" | "success" | "failure" | "skipped";
  stageNotes?: string;
  fillPrice?: number;
  riskReason?: string;
}

interface AIPipelineFlowProps {
  selectedCandidate?: PipelineCandidate | null;
  counts?: {
    candidates: number;
    analyzing: number;
    approved: number;
    rejected: number;
    filled: number;
  };
}

export function AIPipelineFlow({
  selectedCandidate,
  counts = { candidates: 0, analyzing: 0, approved: 0, rejected: 0, filled: 0 },
}: AIPipelineFlowProps) {
  // Determine current candidate's stage
  let activeStage = 0;
  let stageStatuses: ("idle" | "active" | "success" | "failed" | "skipped")[] = [
    "idle",
    "idle",
    "idle",
    "idle",
    "idle",
    "idle",
  ];

  if (selectedCandidate) {
    const dec = selectedCandidate.decision;
    const isApproved =
      dec?.approved === true ||
      selectedCandidate.approved === true ||
      selectedCandidate.decision === "APPROVE" ||
      selectedCandidate.status === "approved";

    const isRejected =
      dec?.approved === false ||
      selectedCandidate.approved === false ||
      selectedCandidate.decision === "REJECT" ||
      selectedCandidate.decision === "AI_UNAVAILABLE" ||
      selectedCandidate.status === "rejected";

    const isAnalyzing =
      selectedCandidate.status === "pending" ||
      selectedCandidate.status === "analyzing";

    if (isAnalyzing) {
      activeStage = 2;
      stageStatuses = ["success", "active", "idle", "idle", "idle", "idle"];
    } else if (isRejected) {
      activeStage = 3;
      stageStatuses = ["success", "success", "failed", "skipped", "skipped", "skipped"];
    } else if (isApproved) {
      if (selectedCandidate.fillPrice != null) {
        activeStage = 6;
        stageStatuses = ["success", "success", "success", "success", "success", "success"];
      } else if (selectedCandidate.riskReason) {
        activeStage = 4;
        stageStatuses = ["success", "success", "success", "failed", "skipped", "skipped"];
      } else {
        activeStage = 5;
        stageStatuses = ["success", "success", "success", "success", "active", "idle"];
      }
    } else {
      activeStage = 1;
      stageStatuses = ["success", "idle", "idle", "idle", "idle", "idle"];
    }
  }

  const STAGES = [
    { num: 1, name: "Candidate Created", desc: "Strategy Intent" },
    { num: 2, name: "AI Analysis", desc: "4-Agent + Debate" },
    { num: 3, name: "AI Decision", desc: "Rating & Verdict" },
    { num: 4, name: "Risk Check", desc: "Multimodal Council" },
    { num: 5, name: "Pending Fill", desc: "Order Lifecycle" },
    { num: 6, name: "Filled", desc: "Position Open" },
  ];

  return (
    <div className="card-fintech p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="font-display font-semibold text-sm sm:text-base text-ink flex items-center gap-2">
            <span>Decision-to-Execution Pipeline</span>
            {selectedCandidate && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-sakura/20 text-ink border border-sakura/40">
                Tracking {selectedCandidate.symbol} ({selectedCandidate.side?.toUpperCase()})
              </span>
            )}
          </h2>
          <p className="text-xs text-inksoft">
            Strict fail-closed architecture: AI filters candidates before FabRich risk controls evaluate execution.
          </p>
        </div>

        {/* Aggregate pipeline metrics */}
        <div className="flex items-center gap-2 text-xs tnum flex-wrap">
          <span className="px-2 py-1 rounded-md bg-white/70 border border-white/80 font-medium">
            Candidates: <b className="text-ink">{counts.candidates}</b>
          </span>
          <span className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/25 font-medium text-amber-900">
            Analyzing: <b>{counts.analyzing}</b>
          </span>
          <span className="px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/25 font-medium text-emerald-800">
            Approved: <b>{counts.approved}</b>
          </span>
          <span className="px-2 py-1 rounded-md bg-rose-500/15 border border-rose-500/25 font-medium text-rose-800">
            Rejected: <b>{counts.rejected}</b>
          </span>
        </div>
      </div>

      {/* Visual Pipeline Stages */}
      <div className="relative mt-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {STAGES.map((s, idx) => {
            const st = stageStatuses[idx];
            let borderClass = "border-black/5 bg-white/40";
            let badgeClass = "bg-black/5 text-inksoft";
            let icon = s.num;

            if (st === "success") {
              borderClass = "border-emerald-500/40 bg-emerald-500/10 shadow-xs";
              badgeClass = "bg-emerald-600 text-white";
              icon = "✓" as any;
            } else if (st === "active") {
              borderClass = "border-amber-500/50 bg-amber-500/15 ring-2 ring-amber-400/20";
              badgeClass = "bg-amber-500 text-white animate-pulse";
              icon = "◷" as any;
            } else if (st === "failed") {
              borderClass = "border-rose-500/40 bg-rose-500/10";
              badgeClass = "bg-rose-600 text-white";
              icon = "✕" as any;
            } else if (st === "skipped") {
              borderClass = "border-black/5 bg-black/2 opacity-50";
              badgeClass = "bg-black/10 text-inksoft";
              icon = "—" as any;
            }

            return (
              <div
                key={s.num}
                className={`p-3 rounded-xl border transition-all duration-200 flex flex-col justify-between min-h-[78px] ${borderClass}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${badgeClass}`}
                  >
                    {icon}
                  </span>
                  <span className="text-[10px] text-inksoft font-bold uppercase tracking-wider">
                    Stage 0{s.num}
                  </span>
                </div>
                <div>
                  <div className="font-semibold text-xs text-ink tracking-tight leading-snug">
                    {s.name}
                  </div>
                  <div className="text-[10px] text-inksoft leading-tight mt-0.5">
                    {s.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AIPipelineFlow;

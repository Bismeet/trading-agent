"use client";

import React, { useState, useMemo, useEffect } from "react";
import { ModelMetadata } from "../../api/ai/route";

interface ModelSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  models: ModelMetadata[];
  providerName: string;
  currentModelId: string;
  title?: string;
}

type FilterCategory = "all" | "recommended" | "reasoning" | "fast" | "context" | "free";

function formatContext(ctx?: number): string {
  if (!ctx || ctx <= 0) return "N/A";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 === 0 ? 0 : 1)}M ctx`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K ctx`;
  return `${ctx} ctx`;
}

export function ModelSearchModal({
  isOpen,
  onClose,
  onSelect,
  models = [],
  providerName,
  currentModelId,
  title = "Select Model",
}: ModelSearchModalProps) {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterCategory>("all");
  const [showLegacy, setShowLegacy] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Reset search on modal open
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setActiveFilter("all");
      setIsCustomMode(false);
      setCustomInput("");
    }
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      // 1. Lifecycle filter
      const lifecycle = (m.lifecycle || "ACTIVE").toUpperCase();
      if (!showLegacy && (lifecycle === "LEGACY" || lifecycle === "DEPRECATED")) {
        // If current model is legacy, still show it
        if (m.id !== currentModelId) return false;
      }

      // 2. Category filter
      if (activeFilter === "recommended") {
        if (!m.recommended && m.category?.toLowerCase() !== "recommended") return false;
      } else if (activeFilter === "reasoning") {
        const isReasoning =
          m.category?.toLowerCase().includes("reasoning") ||
          m.capabilities?.reasoning ||
          m.speed?.toLowerCase().includes("reasoning");
        if (!isReasoning) return false;
      } else if (activeFilter === "fast") {
        const isFast =
          m.category?.toLowerCase().includes("fast") ||
          m.speed?.toLowerCase().includes("fast") ||
          m.speed?.toLowerCase().includes("ultra");
        if (!isFast) return false;
      } else if (activeFilter === "context") {
        if (!m.context_window || m.context_window < 1_000_000) return false;
      } else if (activeFilter === "free") {
        const isFree =
          m.is_free ||
          m.cost_class?.toLowerCase() === "free" ||
          m.id.toLowerCase().includes(":free");
        if (!isFree) return false;
      }

      // 3. Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchesId = m.id.toLowerCase().includes(q);
        const matchesName = (m.name || "").toLowerCase().includes(q);
        const matchesDesc = (m.description || "").toLowerCase().includes(q);
        const matchesCat = (m.category || "").toLowerCase().includes(q);
        return matchesId || matchesName || matchesDesc || matchesCat;
      }

      return true;
    });
  }, [models, activeFilter, showLegacy, search, currentModelId]);

  if (!isOpen) return null;

  const handleApplyCustom = () => {
    const trimmed = customInput.trim();
    if (trimmed) {
      onSelect(trimmed);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="card-fintech w-full max-w-2xl max-h-[85vh] flex flex-col bg-white/95 border border-white/80 shadow-2xl rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-black/5 bg-gradient-to-r from-cream/60 via-white/80 to-cream/40 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <h3 className="font-display font-bold text-base text-ink">{title}</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sakura/20 text-ink border border-sakura/30">
                {providerName}
              </span>
            </div>
            <p className="text-xs text-inksoft mt-0.5">
              Browse verified models, filter by capability, or specify a custom identifier.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-inksoft hover:text-ink hover:bg-black/5 text-lg transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Search Bar & Filter Pills */}
        <div className="p-4 border-b border-black/5 bg-white/80 flex flex-col gap-3 shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-xs text-inksoft">🔍</span>
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${models.length} ${providerName} models (name, id, category)...`}
              className="w-full pl-8 pr-8 py-2 text-xs rounded-xl bg-white border border-black/10 text-ink outline-none focus:ring-2 focus:ring-sakura/50 shadow-2xs"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-2 text-xs text-inksoft hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: "all", label: "All" },
                { id: "recommended", label: "⭐ Recommended" },
                { id: "reasoning", label: "🧠 Reasoning" },
                { id: "fast", label: "⚡ Fast" },
                { id: "context", label: "📚 1M+ Context" },
                { id: "free", label: "🎁 Free Tier" },
              ].map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setActiveFilter(pill.id as FilterCategory)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer ${
                    activeFilter === pill.id
                      ? "bg-sakura/30 text-ink border border-sakura/40 shadow-2xs"
                      : "bg-white/60 text-inksoft hover:text-ink border border-black/5 hover:bg-white"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Legacy Toggle */}
            <label className="flex items-center gap-1.5 text-[11px] text-inksoft cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showLegacy}
                onChange={(e) => setShowLegacy(e.target.checked)}
                className="rounded border-black/20 text-sakura focus:ring-sakura cursor-pointer"
              />
              <span>Show Legacy/Deprecated</span>
            </label>
          </div>
        </div>

        {/* Model List */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2.5 max-h-[460px]">
          {filteredModels.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-inksoft font-medium">
                No models matched your search or filters.
              </p>
              <button
                onClick={() => setIsCustomMode(true)}
                className="mt-3 text-xs font-semibold text-sakura hover:underline cursor-pointer"
              >
                Enter custom model ID manually →
              </button>
            </div>
          ) : (
            filteredModels.map((m) => {
              const isSelected = m.id === currentModelId;
              const lifecycle = (m.lifecycle || "ACTIVE").toUpperCase();
              const isRecommended = Boolean(m.recommended || m.category?.toLowerCase() === "recommended");

              return (
                <div
                  key={m.id}
                  onClick={() => {
                    onSelect(m.id);
                    onClose();
                  }}
                  className={`group p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                    isSelected
                      ? "bg-sakura/15 border-sakura/50 shadow-xs ring-1 ring-sakura/30"
                      : "bg-white/70 hover:bg-white border-black/5 hover:border-black/15 hover:shadow-2xs"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-ink group-hover:text-black">
                        {m.name || m.id}
                      </span>
                      <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 text-inksoft border border-black/5">
                        {m.id}
                      </code>

                      {isRecommended && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-900 border border-amber-500/30">
                          ⭐ Recommended
                        </span>
                      )}

                      {lifecycle !== "ACTIVE" && (
                        <span
                          className={`px-1.5 py-0.5 rounded-md text-[9px] font-semibold border ${
                            lifecycle === "PREVIEW"
                              ? "bg-sky-500/10 text-sky-800 border-sky-500/25"
                              : lifecycle === "LEGACY"
                              ? "bg-amber-500/10 text-amber-800 border-amber-500/25"
                              : "bg-rose-500/10 text-rose-800 border-rose-500/25"
                          }`}
                        >
                          {lifecycle}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-500/30">
                          ✓ Active
                        </span>
                      )}
                    </div>
                  </div>

                  {m.description && (
                    <p className="text-[11px] text-inksoft line-clamp-2 leading-relaxed">
                      {m.description}
                    </p>
                  )}

                  {/* Badges footer */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-black/5 text-[10px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Context Window */}
                      {m.context_window && (
                        <span className="px-2 py-0.5 rounded-md bg-white border border-black/5 text-ink font-medium shadow-2xs">
                          📚 {formatContext(m.context_window)}
                        </span>
                      )}

                      {/* Speed */}
                      {m.speed && (
                        <span className="px-2 py-0.5 rounded-md bg-white border border-black/5 text-ink font-medium shadow-2xs">
                          {m.speed.toLowerCase().includes("fast") ? "⚡" : "⚖️"} {m.speed}
                        </span>
                      )}

                      {/* Cost */}
                      {(m.cost_class || m.is_free) && (
                        <span
                          className={`px-2 py-0.5 rounded-md font-medium border ${
                            m.is_free || m.cost_class === "Free"
                              ? "bg-emerald-500/10 text-emerald-800 border-emerald-500/20"
                              : "bg-white text-ink border-black/5"
                          }`}
                        >
                          {m.input_price ? `${m.input_price} in` : m.cost_class}
                        </span>
                      )}
                    </div>

                    {/* Capabilities */}
                    <div className="flex items-center gap-1 text-[9px] text-inksoft">
                      {m.capabilities?.tools && (
                        <span className="px-1.5 py-0.5 rounded bg-black/5" title="Supports Function/Tool Calling">
                          🛠️ Tools
                        </span>
                      )}
                      {m.capabilities?.reasoning && (
                        <span className="px-1.5 py-0.5 rounded bg-black/5" title="Extended Reasoning / Thinking">
                          🧠 Reasoning
                        </span>
                      )}
                      {m.capabilities?.vision && (
                        <span className="px-1.5 py-0.5 rounded bg-black/5" title="Multimodal / Vision">
                          👁️ Vision
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Custom Model Fallback Footer */}
        <div className="p-3.5 border-t border-black/5 bg-cream/30 flex items-center justify-between flex-wrap gap-2 shrink-0">
          {!isCustomMode ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-inksoft">
                Need an unlisted or fine-tuned model?
              </span>
              <button
                type="button"
                onClick={() => setIsCustomMode(true)}
                className="text-[11px] font-semibold text-sakura hover:underline cursor-pointer"
              >
                + Enter Custom Model ID
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 w-full">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="e.g. gpt-4.5-preview or custom/model-name..."
                className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-white border border-black/10 text-ink font-mono outline-none focus:ring-1 focus:ring-sakura"
              />
              <button
                type="button"
                onClick={handleApplyCustom}
                disabled={!customInput.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-sakura/30 text-ink hover:bg-sakura/40 disabled:opacity-50 cursor-pointer"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setIsCustomMode(false)}
                className="text-xs text-inksoft hover:text-ink px-2 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModelSearchModal;

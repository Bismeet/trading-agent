"use client";

import React, { useState, useEffect, useMemo } from "react";
import { GlassButton } from "../ui/GlassButton";
import { ModelSearchModal } from "./ModelSearchModal";
import { ModelMetadata, ProviderInfo } from "../../api/ai/route";

interface AISettingsCardProps {
  onConfigChanged?: () => void;
}

export function AISettingsCard({ onConfigChanged }: AISettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("google");
  const [deepModel, setDeepModel] = useState("gemini-2.5-flash");
  const [quickModel, setQuickModel] = useState("gemini-2.5-flash-lite");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isKeyConfigured, setIsKeyConfigured] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<Record<string, ProviderInfo>>({});
  const [catalog, setCatalog] = useState<Record<string, ModelMetadata[]>>({});

  // Modal State
  const [modalTarget, setModalTarget] = useState<"deep" | "quick" | null>(null);

  const [testStatus, setTestStatus] = useState<{
    running: boolean;
    ok?: boolean;
    msg?: string;
  }>({ running: false });

  const [saveStatus, setSaveStatus] = useState<{
    saving: boolean;
    ok?: boolean;
    msg?: string;
  }>({ saving: false });

  // Load active configuration from Next.js server route
  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/ai", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.supportedProviders) {
          setSupportedProviders(data.supportedProviders);
        }
        if (data.catalog) {
          setCatalog(data.catalog);
        }
        if (data.config) {
          const prov = data.config.provider || "google";
          setProvider(prov);
          setDeepModel(data.config.deep_think_llm || data.config.model || "gemini-2.5-flash");
          setQuickModel(data.config.quick_think_llm || "gemini-2.5-flash-lite");
          setIsKeyConfigured(Boolean(data.config.isKeyConfigured));
          if (Array.isArray(data.config.configuredProviders)) {
            setConfiguredProviders(data.config.configuredProviders);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load AI config:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const currentProviderModels = useMemo(() => {
    const provModels = catalog[provider];
    if (provModels && provModels.length > 0) return provModels;

    // Fallback if catalog not yet loaded
    const fallbackList: ModelMetadata[] = [
      {
        id: deepModel,
        name: deepModel,
        provider,
        description: "Active model selection",
        context_window: 128000,
        category: "Active",
        lifecycle: "ACTIVE",
        speed: "Fast",
        cost_class: "Standard",
        recommended: true,
      },
    ];
    if (quickModel !== deepModel) {
      fallbackList.push({
        id: quickModel,
        name: quickModel,
        provider,
        description: "Active quick model selection",
        context_window: 128000,
        category: "Active",
        lifecycle: "ACTIVE",
        speed: "Fast",
        cost_class: "Standard",
      });
    }
    return fallbackList;
  }, [catalog, provider, deepModel, quickModel]);

  const activeDeepMetadata = useMemo(() => {
    return currentProviderModels.find((m) => m.id === deepModel) || {
      id: deepModel,
      name: deepModel,
      provider,
      description: "",
      context_window: 0,
      category: "",
      lifecycle: "ACTIVE",
      speed: "Balanced",
      cost_class: "Standard",
    };
  }, [currentProviderModels, deepModel, provider]);

  const activeQuickMetadata = useMemo(() => {
    return currentProviderModels.find((m) => m.id === quickModel) || {
      id: quickModel,
      name: quickModel,
      provider,
      description: "",
      context_window: 0,
      category: "",
      lifecycle: "ACTIVE",
      speed: "Ultra Fast",
      cost_class: "Low",
    };
  }, [currentProviderModels, quickModel, provider]);

  const handleProviderChange = (newProv: string) => {
    setProvider(newProv);
    const provInfo = supportedProviders[newProv];
    const provModels = catalog[newProv];

    if (provModels && provModels.length > 0) {
      const defaultDeep = provModels.find((m) => m.default_deep)?.id || provModels[0].id;
      const defaultQuick =
        provModels.find((m) => m.default_quick)?.id || provModels.find((m) => m.category === "Fast")?.id || defaultDeep;
      setDeepModel(defaultDeep);
      setQuickModel(defaultQuick);
    } else if (provInfo) {
      setDeepModel(provInfo.defaultDeep || "default");
      setQuickModel(provInfo.defaultQuick || "default");
    }

    setIsKeyConfigured(configuredProviders.includes(newProv));
    setTestStatus({ running: false });
    setSaveStatus({ saving: false });
    setApiKey("");
  };

  const handleTestConnection = async () => {
    setTestStatus({ running: true });
    setSaveStatus({ saving: false });

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_connection",
          provider,
          model: deepModel,
          apiKey: apiKey.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setTestStatus({
          running: false,
          ok: true,
          msg: data.message || "Connection verified successfully!",
        });
      } else {
        setTestStatus({
          running: false,
          ok: false,
          msg: data.error || "Connection test failed",
        });
      }
    } catch (err: any) {
      setTestStatus({
        running: false,
        ok: false,
        msg: err?.message || "Network error while testing connection",
      });
    }
  };

  const handleSaveSettings = async () => {
    setSaveStatus({ saving: true });
    setTestStatus({ running: false });

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_settings",
          provider,
          model: deepModel,
          deep_think_llm: deepModel,
          quick_think_llm: quickModel,
          apiKey: apiKey.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setSaveStatus({
          saving: false,
          ok: true,
          msg: data.message || "Settings saved and loaded into Tauric runtime.",
        });
        setIsKeyConfigured(true);
        if (!configuredProviders.includes(provider)) {
          setConfiguredProviders([...configuredProviders, provider]);
        }
        setApiKey(""); // Clear uncommitted input
        if (onConfigChanged) onConfigChanged();
      } else {
        setSaveStatus({
          saving: false,
          ok: false,
          msg: data.error || "Failed to save settings",
        });
      }
    } catch (err: any) {
      setSaveStatus({
        saving: false,
        ok: false,
        msg: err?.message || "Error saving settings",
      });
    }
  };

  const currentProvLabel = supportedProviders[provider]?.label || provider.toUpperCase();

  return (
    <div className="card-fintech p-5 sm:p-6 border border-white/90 shadow-sm bg-gradient-to-br from-white/90 via-cream/40 to-white/90">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-4 border-b border-black/5">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">⚙️</span>
          <div>
            <h3 className="font-display font-bold text-base text-ink">
              AI Model &amp; Provider Registry
            </h3>
            <p className="text-xs text-inksoft">
              Select dual-tier reasoning models with live provider discovery. Changes persist server-side.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white border border-white/90 text-inksoft shadow-2xs">
            🔒 Server-Side Credential Isolation
          </span>
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
              isKeyConfigured
                ? "bg-emerald-500/10 text-emerald-800 border-emerald-500/25"
                : "bg-amber-500/10 text-amber-800 border-amber-500/25"
            }`}
          >
            {isKeyConfigured ? "Key Configured" : "Key Needed"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-inksoft py-4">Loading active configuration and model catalog...</div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Provider Selection & API Key Row */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Provider Selector */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center justify-between">
                <span>LLM Provider</span>
                <span className="text-[10px] text-inksoft">
                  {Object.keys(supportedProviders).length} Providers Supported
                </span>
              </label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-black/10 text-ink font-medium outline-none focus:ring-1 focus:ring-sakura shadow-2xs"
              >
                {Object.entries(supportedProviders).map(([k, v]) => {
                  const hasKey = configuredProviders.includes(k);
                  return (
                    <option key={k} value={k}>
                      {v.label} {hasKey ? "✓" : ""}
                    </option>
                  );
                })}
              </select>
              {supportedProviders[provider]?.description && (
                <p className="text-[11px] text-inksoft mt-1 line-clamp-1">
                  {supportedProviders[provider].description}
                </p>
              )}
            </div>

            {/* API Key Input */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center justify-between">
                <span>API Key ({currentProvLabel})</span>
                <span className="text-[10px] text-inksoft font-normal">
                  {isKeyConfigured && !apiKey ? "Stored securely on server" : ""}
                </span>
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    isKeyConfigured
                      ? "•••••••••••••••• (Leave blank to keep stored key)"
                      : `Enter ${currentProvLabel} API key...`
                  }
                  className="w-full px-3 py-2 pr-8 text-xs rounded-xl bg-white border border-black/10 text-ink font-mono outline-none focus:ring-1 focus:ring-sakura shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-2.5 text-inksoft hover:text-ink text-xs cursor-pointer"
                  title={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? "🙈" : "👁️"}
                </button>
              </div>
              <p className="text-[10px] text-inksoft mt-1">
                Keys are held in server memory and synced to .env. Never sent to browser client.
              </p>
            </div>
          </div>

          {/* Model Pickers: Deep Reasoning & Quick Analysis */}
          <div className="grid sm:grid-cols-2 gap-4 pt-2">
            {/* 1. Deep Reasoning Model Card */}
            <div className="p-3.5 rounded-xl border border-black/10 bg-white/80 flex flex-col justify-between gap-2 shadow-2xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                    <span>🧠</span> Deep Reasoning Engine
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-900 border border-purple-500/20">
                    Analyst Debate &amp; Risk
                  </span>
                </div>
                <p className="text-[11px] text-inksoft mb-2">
                  Powers multi-agent research debate, technical valuation, and risk council.
                </p>

                <div className="p-2.5 rounded-lg bg-cream/40 border border-black/5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-ink truncate">
                      {activeDeepMetadata.name || deepModel}
                    </div>
                    <code className="text-[10px] font-mono text-inksoft">
                      {deepModel}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activeDeepMetadata.speed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-black/5 text-inksoft">
                        {activeDeepMetadata.speed}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[10px] text-inksoft">
                  {currentProviderModels.length} models available
                </span>
                <GlassButton
                  size="sm"
                  variant="subtle"
                  onClick={() => setModalTarget("deep")}
                >
                  Browse &amp; Change ➔
                </GlassButton>
              </div>
            </div>

            {/* 2. Quick Analysis Model Card */}
            <div className="p-3.5 rounded-xl border border-black/10 bg-white/80 flex flex-col justify-between gap-2 shadow-2xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                    <span>⚡</span> Fast / High-Throughput Engine
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-900 border border-sky-500/20">
                    Triage &amp; Quick Checks
                  </span>
                </div>
                <p className="text-[11px] text-inksoft mb-2">
                  Powers rapid signal triage, quick thesis generation, and live summaries.
                </p>

                <div className="p-2.5 rounded-lg bg-cream/40 border border-black/5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-ink truncate">
                      {activeQuickMetadata.name || quickModel}
                    </div>
                    <code className="text-[10px] font-mono text-inksoft">
                      {quickModel}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activeQuickMetadata.speed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-black/5 text-inksoft">
                        {activeQuickMetadata.speed}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[10px] text-inksoft">
                  {currentProviderModels.length} models available
                </span>
                <GlassButton
                  size="sm"
                  variant="subtle"
                  onClick={() => setModalTarget("quick")}
                >
                  Browse &amp; Change ➔
                </GlassButton>
              </div>
            </div>
          </div>

          {/* Action Buttons & Status Feedback */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-black/5">
            <div className="flex items-center gap-2 flex-wrap">
              <GlassButton
                size="sm"
                variant="primary"
                busy={saveStatus.saving}
                disabled={saveStatus.saving || testStatus.running}
                onClick={handleSaveSettings}
              >
                Save Settings
              </GlassButton>

              <GlassButton
                size="sm"
                variant="subtle"
                busy={testStatus.running}
                disabled={saveStatus.saving || testStatus.running}
                onClick={handleTestConnection}
              >
                Test Connection
              </GlassButton>
            </div>

            <div className="text-xs">
              {testStatus.running && (
                <span className="text-inksoft font-medium animate-pulse">
                  Testing server-side connection to {provider.toUpperCase()}...
                </span>
              )}
              {testStatus.msg && !testStatus.running && (
                <span
                  className={`font-semibold ${
                    testStatus.ok ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {testStatus.ok ? "✓ " : "✕ "}
                  {testStatus.msg}
                </span>
              )}
              {saveStatus.msg && !saveStatus.saving && (
                <span
                  className={`font-semibold ${
                    saveStatus.ok ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {saveStatus.ok ? "✓ " : "✕ "}
                  {saveStatus.msg}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Command-Palette Model Picker Modal */}
      <ModelSearchModal
        isOpen={modalTarget !== null}
        onClose={() => setModalTarget(null)}
        onSelect={(selectedId) => {
          if (modalTarget === "deep") {
            setDeepModel(selectedId);
          } else if (modalTarget === "quick") {
            setQuickModel(selectedId);
          }
          setModalTarget(null);
        }}
        models={currentProviderModels}
        providerName={currentProvLabel}
        currentModelId={modalTarget === "deep" ? deepModel : quickModel}
        title={
          modalTarget === "deep"
            ? "Select Deep Reasoning Model"
            : "Select Fast / High-Throughput Model"
        }
      />
    </div>
  );
}

export default AISettingsCard;

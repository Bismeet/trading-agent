"use client";

import React, { useState, useEffect, useMemo } from "react";
import { GlassButton } from "../ui/GlassButton";
import { ProviderInfo, ModelMetadata } from "../../api/ai/route";

interface AISettingsCardProps {
  onConfigChanged?: () => void;
}

const DEFAULT_POPULAR_MODELS: Record<string, string[]> = {
  meta: ["muse-spark-1.3-contributor", "muse-spark-1.3"],
  google: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.1-pro-preview"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3-mini", "o1"],
  anthropic: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-7-sonnet-latest"],
  groq: ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b", "mixtral-8x7b-32768"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  openrouter: ["nvidia/nemotron-3-super-120b-a12b:free", "deepseek/deepseek-r1", "google/gemini-2.5-flash", "openai/gpt-4o-mini"],
  kimi: ["moonshot-v1-32k", "moonshot-v1-128k", "moonshot-v1-auto"],
  nvidia: ["nvidia/llama-3.1-nemotron-70b-instruct", "moonshotai/kimi-k3", "meta/llama-3.3-70b-instruct"],
  mistral: ["mistral-small-latest", "mistral-large-latest", "codestral-latest"],
  qwen: ["qwen-plus", "qwen-max", "qwen-turbo"],
  xai: ["grok-2", "grok-2-mini"],
};

export function AISettingsCard({ onConfigChanged }: AISettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("meta");
  const [model, setModel] = useState("muse-spark-1.3-contributor");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isKeyConfigured, setIsKeyConfigured] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<Record<string, ProviderInfo>>({});
  const [catalog, setCatalog] = useState<Record<string, ModelMetadata[]>>({});

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
          const prov = data.config.provider || "meta";
          setProvider(prov);
          setModel(data.config.model || data.config.deep_think_llm || "muse-spark-1.3-contributor");
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

  // Suggested model options for datalist
  const suggestedModels = useMemo(() => {
    const fromCat = (catalog[provider] || []).map((m) => m.id);
    const fromDefaults = DEFAULT_POPULAR_MODELS[provider] || [];
    return Array.from(new Set([...fromDefaults, ...fromCat]));
  }, [catalog, provider]);

  const handleProviderChange = (newProv: string) => {
    setProvider(newProv);
    const defaults = DEFAULT_POPULAR_MODELS[newProv] || [];
    const catModels = (catalog[newProv] || []).map((m) => m.id);
    const firstModel = catModels[0] || defaults[0] || "default";
    setModel(firstModel);

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
          model: model.trim(),
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
          model: model.trim(),
          deep_think_llm: model.trim(),
          quick_think_llm: model.trim(),
          apiKey: apiKey.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setSaveStatus({
          saving: false,
          ok: true,
          msg: `Saved & active: ${provider.toUpperCase()} (${model.trim()})`,
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
              AI Model &amp; Provider Settings
            </h3>
            <p className="text-xs text-inksoft">
              Configure your provider, model name, and API key. Everything auto-persists to server storage.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-sakura/20 border border-sakura/30 text-ink">
            Active: {currentProvLabel} · {model}
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
        <div className="text-xs text-inksoft py-4">Loading active configuration...</div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Simple 3-Field Grid: Provider | Model Name | API Key */}
          <div className="grid sm:grid-cols-3 gap-4">
            {/* 1. LLM Provider */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                LLM Provider
              </label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-black/10 text-ink font-medium outline-none focus:ring-1 focus:ring-sakura shadow-2xs cursor-pointer"
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
                <p className="text-[10px] text-inksoft mt-1 line-clamp-1">
                  {supportedProviders[provider].description}
                </p>
              )}
            </div>

            {/* 2. Model Name (Editable + Suggestions) */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center justify-between">
                <span>Model Name</span>
                <span className="text-[10px] text-inksoft">Select or type custom</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="model-options"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. muse-spark-1.3-contributor"
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-black/10 text-ink font-mono outline-none focus:ring-1 focus:ring-sakura shadow-2xs"
                />
                <datalist id="model-options">
                  {suggestedModels.map((mId) => (
                    <option key={mId} value={mId} />
                  ))}
                </datalist>
              </div>

              {/* Quick suggestions pills */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {suggestedModels.slice(0, 3).map((mId) => (
                  <button
                    key={mId}
                    type="button"
                    onClick={() => setModel(mId)}
                    className={`text-[10px] px-2 py-0.5 rounded-md font-mono transition-colors cursor-pointer ${
                      model === mId
                        ? "bg-sakura/30 text-ink font-bold border border-sakura/40"
                        : "bg-white/80 text-inksoft hover:text-ink border border-black/5"
                    }`}
                  >
                    {mId.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. API Key */}
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
                      ? "•••••••••••••••• (Leave blank to keep current)"
                      : `Enter ${currentProvLabel} key...`
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
                Keys persist server-side in .env and runtime memory.
              </p>
            </div>
          </div>

          {/* Action Row */}
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
                  Testing server connection to {currentProvLabel}...
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

          {/* Persistence & Crash Recovery Guarantee Callout */}
          <div className="p-3 rounded-xl bg-white/60 border border-black/5 flex items-center justify-between flex-wrap gap-2 text-[11px] text-inksoft">
            <div className="flex items-center gap-2">
              <span className="text-base">💾</span>
              <span>
                <strong className="text-ink font-semibold">Continuous State &amp; Progress Persistence:</strong> All episode cycles, open trades, portfolio equity, and learned rules are saved after every tick. If a run or process is interrupted, it resumes automatically from the exact same point.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AISettingsCard;

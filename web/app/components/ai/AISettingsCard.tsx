"use client";

import React, { useState, useEffect } from "react";
import { GlassButton } from "../ui/GlassButton";

interface ProviderModel {
  id: string;
  name: string;
}

interface ProviderData {
  label: string;
  models: ProviderModel[];
}

interface AISettingsCardProps {
  onConfigChanged?: () => void;
}

export function AISettingsCard({ onConfigChanged }: AISettingsCardProps) {
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("google");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isKeyConfigured, setIsKeyConfigured] = useState(false);
  const [supportedProviders, setSupportedProviders] = useState<Record<string, ProviderData>>({});

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
        if (data.config) {
          setProvider(data.config.provider || "google");
          setModel(data.config.model || "gemini-2.5-flash");
          setIsKeyConfigured(Boolean(data.config.isKeyConfigured));
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

  const handleProviderChange = (newProv: string) => {
    setProvider(newProv);
    const available = supportedProviders[newProv]?.models;
    if (available && available.length > 0) {
      setModel(available[0].id);
    }
    setTestStatus({ running: false });
    setSaveStatus({ saving: false });
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
          model,
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
          model,
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

  const currentModels = supportedProviders[provider]?.models || [
    { id: model, name: model },
  ];

  return (
    <div className="card-fintech p-5 sm:p-6 border border-white/90 shadow-sm bg-gradient-to-br from-white/90 via-cream/40 to-white/90">
      <div className="flex items-center justify-between flex-wrap gap-2 pb-4 mb-4 border-b border-black/5">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">⚙️</span>
          <div>
            <h3 className="font-display font-bold text-base text-ink">
              AI Model &amp; Provider Settings
            </h3>
            <p className="text-xs text-inksoft">
              Switch reasoning models or update API keys with zero restarts. Changes persist server-side.
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
        <div className="text-xs text-inksoft py-4">Loading active configuration...</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Provider Selector */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                LLM Provider
              </label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-black/10 text-ink font-medium outline-none focus:ring-1 focus:ring-sakura"
              >
                {Object.entries(supportedProviders).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Model Selector */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1">
                Active Reasoning Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-white border border-black/10 text-ink font-medium outline-none focus:ring-1 focus:ring-sakura"
              >
                {currentModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key Input */}
            <div>
              <label className="block text-xs font-semibold text-ink mb-1 flex items-center justify-between">
                <span>API Key</span>
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
                      : "Enter API key..."
                  }
                  className="w-full px-3 py-2 pr-8 text-xs rounded-xl bg-white border border-black/10 text-ink font-mono outline-none focus:ring-1 focus:ring-sakura"
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
            </div>
          </div>

          {/* Action Buttons & Status feedback */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
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
                  Testing live model response...
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
    </div>
  );
}

export default AISettingsCard;

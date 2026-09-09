import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOTDIR = path.resolve(process.cwd(), "..");

const SUPPORTED_PROVIDERS: Record<string, { label: string; models: { id: string; name: string }[] }> = {
  google: {
    label: "Google Gemini (Active)",
    models: [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Fast & Balanced - Recommended)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Deep Reasoning)" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "o3-mini", name: "o3-mini" },
    ],
  },
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    ],
  },
  groq: {
    label: "Groq",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    models: [
      { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash Exp (Free)" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B Instruct" },
    ],
  },
};

function getTauricBaseUrl(): string {
  try {
    const configPath = path.join(ROOTDIR, "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config?.v2?.ai?.tradingAgentsBaseUrl) {
        return config.v2.ai.tradingAgentsBaseUrl;
      }
    }
  } catch {
    /* fallback */
  }
  return "http://127.0.0.1:8000";
}

function updateEnvFile(key: string, value: string) {
  try {
    const envPath = path.join(ROOTDIR, ".env");
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    let found = false;
    const newLines = lines.map((line) => {
      if (line.startsWith(`${key}=`) || line.startsWith(`#${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) {
      newLines.push(`${key}=${value}`);
    }
    fs.writeFileSync(envPath, newLines.join("\n"), "utf8");
  } catch (err) {
    console.error("Failed to update .env:", err);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");
  const baseUrl = getTauricBaseUrl();

  // If runId provided, fetch specific analysis snapshot
  if (runId) {
    try {
      const res = await fetch(`${baseUrl}/api/analysis/${encodeURIComponent(runId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return NextResponse.json({ ok: false, status: res.status, error: res.statusText }, { status: 200 });
      }
      const data = await res.json();
      return NextResponse.json({ ok: true, data }, { status: 200 });
    } catch (err: any) {
      return NextResponse.json({ ok: false, available: false, error: err?.message || "TradingAgents unreachable" }, { status: 200 });
    }
  }

  // Fetch active config and health from Tauric
  try {
    const [healthRes, configRes] = await Promise.all([
      fetch(`${baseUrl}/api/health`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(2500) }).catch(() => null),
      fetch(`${baseUrl}/api/config/active`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(2500) }).catch(() => null),
    ]);

    const isHealthy = healthRes?.ok ?? false;
    let activeConfig: any = {
      provider: "google",
      model: "gemini-2.5-flash",
      isKeyConfigured: false,
      status: isHealthy ? "online" : "offline",
    };

    if (configRes?.ok) {
      const cData = await configRes.json();
      activeConfig = {
        provider: cData.provider || "google",
        model: cData.model || "gemini-2.5-flash",
        isKeyConfigured: Boolean(cData.isKeyConfigured),
        status: isHealthy ? "online" : "offline",
      };
    }

    return NextResponse.json(
      {
        ok: true,
        available: isHealthy,
        baseUrl,
        config: activeConfig,
        supportedProviders: SUPPORTED_PROVIDERS,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        available: false,
        baseUrl,
        config: { provider: "google", model: "gemini-2.5-flash", isKeyConfigured: false, status: "offline" },
        supportedProviders: SUPPORTED_PROVIDERS,
        error: err?.message || "Tauric unreachable",
      },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action || "save_settings";
    const baseUrl = getTauricBaseUrl();

    if (action === "test_connection") {
      const { provider, model, apiKey } = body;
      if (!provider || !model) {
        return NextResponse.json({ ok: false, error: "Provider and model are required" }, { status: 400 });
      }

      const res = await fetch(`${baseUrl}/api/config/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: String(provider).toLowerCase().trim(),
          model: String(model).trim(),
          api_key: apiKey ? String(apiKey).trim() : null,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return NextResponse.json({ ok: false, error: `Tauric test failed with HTTP ${res.status}` }, { status: 200 });
      }

      const testResult = await res.json();
      return NextResponse.json(testResult, { status: 200 });
    }

    if (action === "save_settings") {
      const { provider, model, apiKey } = body;
      const prov = String(provider || "google").toLowerCase().trim();
      const mdl = String(model || "gemini-2.5-flash").trim();

      // 1. If an API key is provided, persist it server-side to Tauric and .env
      if (apiKey && String(apiKey).trim().length > 0) {
        const cleanKey = String(apiKey).trim();
        await fetch(`${baseUrl}/api/config/keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: prov, api_key: cleanKey }),
        }).catch((e) => console.warn("Tauric /api/config/keys error:", e));

        const envVarName = prov === "google" ? "GOOGLE_API_KEY" : `${prov.toUpperCase()}_API_KEY`;
        updateEnvFile(envVarName, cleanKey);
        if (prov === "google") {
          updateEnvFile("GEMINI_API_KEY", cleanKey);
        }
      }

      // 2. Save preferences in Tauric
      await fetch(`${baseUrl}/api/config/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: prov,
          deep_think_llm: mdl,
          quick_think_llm: mdl,
          thinking_mode: "low",
        }),
      }).catch((e) => console.warn("Tauric /api/config/preferences error:", e));

      // 3. Update TRADINGAGENTS_LLM_PROVIDER and TRADINGAGENTS_DEEP_THINK_LLM in .env
      updateEnvFile("TRADINGAGENTS_LLM_PROVIDER", prov);
      updateEnvFile("TRADINGAGENTS_DEEP_THINK_LLM", mdl);
      updateEnvFile("TRADINGAGENTS_QUICK_THINK_LLM", mdl);

      return NextResponse.json(
        {
          ok: true,
          message: `AI settings updated: ${prov.toUpperCase()} (${mdl})`,
          provider: prov,
          model: mdl,
          isKeyConfigured: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Internal server error" }, { status: 500 });
  }
}

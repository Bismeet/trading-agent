import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ROOTDIR = path.resolve(process.cwd(), "..");

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  description: string;
  context_window: number;
  category: string;
  lifecycle: string;
  speed: string;
  cost_class: string;
  input_price?: string;
  output_price?: string;
  capabilities?: Record<string, boolean>;
  recommended?: boolean;
  default_quick?: boolean;
  default_deep?: boolean;
  is_free?: boolean;
}

export interface ProviderInfo {
  label: string;
  description: string;
  defaultQuick: string;
  defaultDeep: string;
  isHostedGateway?: boolean;
}

export const SUPPORTED_PROVIDERS: Record<string, ProviderInfo> = {
  google: {
    label: "Google Gemini",
    description: "1M-2M context, native multi-modal & fast hybrid thinking",
    defaultQuick: "gemini-2.5-flash-lite",
    defaultDeep: "gemini-2.5-flash",
  },
  openai: {
    label: "OpenAI",
    description: "Industry-standard GPT-4o and frontier reasoning o1/o3-mini models",
    defaultQuick: "gpt-4o-mini",
    defaultDeep: "gpt-4o",
  },
  anthropic: {
    label: "Anthropic Claude",
    description: "Claude 3.7 / 3.5 Sonnet & Haiku with extended thinking mode",
    defaultQuick: "claude-3-5-haiku-latest",
    defaultDeep: "claude-3-7-sonnet-latest",
  },
  groq: {
    label: "Groq",
    description: "Ultra-low latency LPU inference for Llama 3.3 and DeepSeek R1 Distill",
    defaultQuick: "llama-3.3-70b-versatile",
    defaultDeep: "deepseek-r1-distill-llama-70b",
  },
  deepseek: {
    label: "DeepSeek",
    description: "Direct DeepSeek API for V3 Chat and R1 Frontier Reasoner",
    defaultQuick: "deepseek-chat",
    defaultDeep: "deepseek-reasoner",
  },
  openrouter: {
    label: "OpenRouter",
    description: "Universal model aggregator with hundreds of hosted models & free tiers",
    defaultQuick: "nvidia/nemotron-3-super-120b-a12b:free",
    defaultDeep: "deepseek/deepseek-r1",
    isHostedGateway: true,
  },
  kimi: {
    label: "Moonshot AI / Kimi",
    description: "Moonshot Kimi long-context reasoning with up to 1M-2M tokens",
    defaultQuick: "moonshot-v1-32k",
    defaultDeep: "moonshot-v1-128k",
  },
  nvidia: {
    label: "NVIDIA NIM",
    description: "Accelerated enterprise inference microservices for Nemotron & Llama",
    defaultQuick: "nvidia/llama-3.1-nemotron-70b-instruct",
    defaultDeep: "moonshotai/kimi-k3",
  },
  meta: {
    label: "Meta",
    description: "Meta Muse Spark agentic foundation models",
    defaultQuick: "muse-spark-1.3-contributor",
    defaultDeep: "muse-spark-1.3",
  },
  mistral: {
    label: "Mistral AI",
    description: "European frontier models: Mistral Large 2, Pixtral & Codestral",
    defaultQuick: "mistral-small-latest",
    defaultDeep: "mistral-large-latest",
  },
  qwen: {
    label: "Qwen / DashScope",
    description: "Alibaba Cloud frontier multilingual & reasoning models (Qwen 2.5)",
    defaultQuick: "qwen-plus",
    defaultDeep: "qwen-max",
  },
  xai: {
    label: "xAI (Grok)",
    description: "Grok 2 and Grok 2 Vision frontier reasoning models by xAI",
    defaultQuick: "grok-2-mini",
    defaultDeep: "grok-2",
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

function getEnvVarsForProvider(provider: string): string[] {
  switch (provider.toLowerCase().trim()) {
    case "google":
      return ["GOOGLE_API_KEY", "GEMINI_API_KEY"];
    case "openai":
      return ["OPENAI_API_KEY"];
    case "anthropic":
      return ["ANTHROPIC_API_KEY"];
    case "groq":
      return ["GROQ_API_KEY"];
    case "deepseek":
      return ["DEEPSEEK_API_KEY"];
    case "openrouter":
      return ["OPENROUTER_API_KEY"];
    case "kimi":
      return ["MOONSHOT_API_KEY"];
    case "nvidia":
      return ["NVIDIA_API_KEY"];
    case "meta":
      return ["META_API_KEY", "META_MUSE_API_KEY"];
    case "mistral":
      return ["MISTRAL_API_KEY"];
    case "qwen":
      return ["DASHSCOPE_API_KEY"];
    case "xai":
      return ["XAI_API_KEY"];
    default:
      return [`${provider.toUpperCase()}_API_KEY`];
  }
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

function getStoredFallbackConfig() {
  let provider = process.env.TRADINGAGENTS_LLM_PROVIDER || "meta";
  let deep_think = process.env.TRADINGAGENTS_DEEP_THINK_LLM || "muse-spark-1.3-contributor";
  let quick_think = process.env.TRADINGAGENTS_QUICK_THINK_LLM || deep_think;
  try {
    const envPath = path.join(ROOTDIR, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith("TRADINGAGENTS_LLM_PROVIDER=")) {
          provider = trimmed.split("=")[1].trim();
        } else if (trimmed.startsWith("TRADINGAGENTS_DEEP_THINK_LLM=")) {
          deep_think = trimmed.split("=")[1].trim();
        } else if (trimmed.startsWith("TRADINGAGENTS_QUICK_THINK_LLM=")) {
          quick_think = trimmed.split("=")[1].trim();
        }
      }
    }
  } catch {}
  return { provider, deep_think, quick_think };
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
        signal: AbortSignal.timeout(5000),
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

  // Fetch active config, catalog, and health from Tauric
  const fallback = getStoredFallbackConfig();
  try {
    const [healthRes, configRes, catalogRes] = await Promise.all([
      fetch(`${baseUrl}/api/health`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }).catch(() => null),
      fetch(`${baseUrl}/api/config/active`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }).catch(() => null),
      fetch(`${baseUrl}/api/config/models-catalog`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }).catch(() => null),
    ]);

    const isHealthy = healthRes?.ok ?? false;
    let activeConfig: any = {
      provider: fallback.provider,
      model: fallback.deep_think,
      deep_think_llm: fallback.deep_think,
      quick_think_llm: fallback.quick_think,
      isKeyConfigured: true,
      configuredProviders: ["meta", "google", "openai", "nvidia", "openrouter"],
      status: isHealthy ? "online" : "offline",
    };

    if (configRes?.ok) {
      try {
        const cData = await configRes.json();
        activeConfig = {
          provider: cData.provider || fallback.provider,
          model: cData.model || cData.deep_think_llm || fallback.deep_think,
          deep_think_llm: cData.deep_think_llm || cData.model || fallback.deep_think,
          quick_think_llm: cData.quick_think_llm || fallback.quick_think,
          isKeyConfigured: Boolean(cData.isKeyConfigured),
          configuredProviders: cData.configuredProviders || [],
          status: isHealthy ? "online" : "offline",
        };
      } catch (err) {
        console.warn("Could not parse configRes JSON:", err);
      }
    }

    let catalog: Record<string, ModelMetadata[]> = {};
    if (catalogRes?.ok) {
      try {
        const catData = await catalogRes.json();
        if (catData?.catalog) {
          catalog = catData.catalog;
        }
      } catch (err) {
        console.warn("Could not parse catalogRes JSON:", err);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        available: isHealthy,
        baseUrl,
        config: activeConfig,
        supportedProviders: SUPPORTED_PROVIDERS,
        catalog,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        available: false,
        baseUrl,
        config: {
          provider: fallback.provider,
          model: fallback.deep_think,
          deep_think_llm: fallback.deep_think,
          quick_think_llm: fallback.quick_think,
          isKeyConfigured: true,
          configuredProviders: ["meta"],
          status: "offline",
        },
        supportedProviders: SUPPORTED_PROVIDERS,
        catalog: {},
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

      try {
        const res = await fetch(`${baseUrl}/api/config/test-connection`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: String(provider).toLowerCase().trim(),
            model: String(model).trim(),
            api_key: apiKey ? String(apiKey).trim() : null,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
          return NextResponse.json({ ok: false, error: `Tauric test failed with HTTP ${res.status}` }, { status: 200 });
        }

        const testResult = await res.json();
        return NextResponse.json(testResult, { status: 200 });
      } catch (err: any) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          return NextResponse.json({ ok: false, error: "Connection test timed out after 30s. The provider may be experiencing high latency." }, { status: 200 });
        }
        return NextResponse.json({ ok: false, error: err?.message || "Error connecting to Tauric service" }, { status: 200 });
      }
    }

    if (action === "save_settings") {
      const { provider, model, deep_think_llm, quick_think_llm, apiKey } = body;
      const prov = String(provider || "google").toLowerCase().trim();
      const deepMdl = String(deep_think_llm || model || "gemini-2.5-flash").trim();
      const quickMdl = String(quick_think_llm || deepMdl).trim();

      // 1. If an API key is provided, persist it server-side to Tauric and .env
      if (apiKey && String(apiKey).trim().length > 0) {
        const cleanKey = String(apiKey).trim();
        await fetch(`${baseUrl}/api/config/keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: prov, api_key: cleanKey }),
        }).catch((e) => console.warn("Tauric /api/config/keys error:", e));

        const envVars = getEnvVarsForProvider(prov);
        for (const envVar of envVars) {
          updateEnvFile(envVar, cleanKey);
        }
      }

      // 2. Save preferences in Tauric
      await fetch(`${baseUrl}/api/config/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_provider: prov,
          deep_think_llm: deepMdl,
          quick_think_llm: quickMdl,
          thinking_mode: "medium",
        }),
      }).catch((e) => console.warn("Tauric /api/config/preferences error:", e));

      // 3. Update TRADINGAGENTS_LLM_PROVIDER, TRADINGAGENTS_DEEP_THINK_LLM, and TRADINGAGENTS_QUICK_THINK_LLM in .env
      updateEnvFile("TRADINGAGENTS_LLM_PROVIDER", prov);
      updateEnvFile("TRADINGAGENTS_DEEP_THINK_LLM", deepMdl);
      updateEnvFile("TRADINGAGENTS_QUICK_THINK_LLM", quickMdl);

      return NextResponse.json(
        {
          ok: true,
          message: `AI settings updated: ${prov.toUpperCase()} (Deep: ${deepMdl}, Quick: ${quickMdl})`,
          provider: prov,
          model: deepMdl,
          deep_think_llm: deepMdl,
          quick_think_llm: quickMdl,
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

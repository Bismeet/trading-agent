from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel


from cli.utils import _llm_provider_table
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.llm_clients.api_key_env import get_api_key_env
from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS
from web.backend.schemas import (
    AnalysisRequest,
    AnalysisRunSnapshot,
    ApiKeyStatus,
    ConfigOptionsResponse,
    MarketInfoResponse,
    ProviderOption,
    SetApiKeyRequest,
)
from web.backend.services.history import (
    delete_run_from_history,
    get_run_from_history,
    list_history,
)
from web.backend.services.market import get_market_info
from web.backend.services.runner import runner_manager
from web.backend.services import store as job_store

logger = logging.getLogger("web.backend.routes")

router = APIRouter(prefix="/api")

_PREFS_FILE = Path(os.path.expanduser("~")) / ".tradingagents" / "web_preferences.json"


def _load_preferences() -> dict[str, Any]:
    if _PREFS_FILE.exists():
        try:
            with open(_PREFS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_preferences(updates: dict[str, Any]) -> None:
    try:
        _PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
        prefs = _load_preferences()
        prefs.update(updates)
        with open(_PREFS_FILE, "w", encoding="utf-8") as f:
            json.dump(prefs, f, indent=2)
    except Exception:
        pass


def _persist_key_to_env(env_var: str, key_val: str) -> None:
    try:
        repo_root = Path(__file__).resolve().parent.parent.parent.parent
        env_path = repo_root / ".env"
        if not env_path.exists():
            env_path = Path.cwd() / ".env"
        if env_path.exists():
            lines = env_path.read_text(encoding="utf-8").splitlines()
            found = False
            new_lines = []
            for line in lines:
                if line.startswith(f"{env_var}=") or line.startswith(f"#{env_var}="):
                    new_lines.append(f"{env_var}={key_val}")
                    found = True
                else:
                    new_lines.append(line)
            if not found:
                new_lines.append(f"{env_var}={key_val}")
            env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    except Exception as e:
        logger.warning("Could not persist key to .env: %s", e)



@router.get("/config/options", response_model=ConfigOptionsResponse)
async def get_config_options() -> ConfigOptionsResponse:
    """Return available providers, model catalog, languages, and depths."""
    providers_table = _llm_provider_table()
    providers: list[ProviderOption] = []

    has_google_key = bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))

    for display_name, provider_key, base_url in providers_table:
        env_var = get_api_key_env(provider_key)
        has_key = bool(os.getenv(env_var)) if env_var else True
        if provider_key == "google" and has_google_key:
            has_key = True

        requires_key = env_var is not None
        providers.append(
            ProviderOption(
                key=provider_key,
                name=display_name,
                has_key=has_key,
                requires_key=requires_key,
                default_url=base_url,
            )
        )

    # Format MODEL_OPTIONS
    formatted_models: dict[str, dict[str, list[dict[str, str]]]] = {}
    for prov_key, modes in MODEL_OPTIONS.items():
        formatted_models[prov_key] = {}
        for mode, opts in modes.items():
            formatted_models[prov_key][mode] = [
                {"label": display, "value": val} for display, val in opts
            ]

    # Populate curated OpenRouter models with popular & active free tier models
    openrouter_models = [
        {"label": "NVIDIA Nemotron 3 Super 120B (Free) - Fast & intelligent reasoning", "value": "nvidia/nemotron-3-super-120b-a12b:free"},
        {"label": "NEX AGI Mini (Free) - Ultra-fast agentic analysis", "value": "nex-agi/nex-n2.5-mini:free"},
        {"label": "NVIDIA Nemotron 3.5 Lightning (Free) - High-speed reasoning", "value": "nvidia/nemotron-3.5-lightning:free"},
        {"label": "InclusionAI Ling 3.0 Flash Fin (Free) - Financial analysis specialist", "value": "inclusionai/ling-3.0-flash-fin:free"},
        {"label": "NEX AGI Pro (Free) - Advanced free reasoning", "value": "nex-agi/nex-n2.5-pro:free"},
        {"label": "DeepSeek Chat (V3) - Powerful, fast & cost-efficient", "value": "deepseek/deepseek-chat"},
        {"label": "DeepSeek R1 - Advanced reasoning", "value": "deepseek/deepseek-r1"},
        {"label": "Google Gemini 2.5 Flash - Fast, intelligent, high-context", "value": "google/gemini-2.5-flash"},
        {"label": "OpenAI GPT-4o Mini - Fast & cost-effective", "value": "openai/gpt-4o-mini"},
        {"label": "OpenAI GPT-4o - Flagship multimodal intelligence", "value": "openai/gpt-4o"},
        {"label": "Anthropic Claude 3.5 Sonnet - Advanced agentic analysis", "value": "anthropic/claude-3.5-sonnet"},
        {"label": "Custom Model ID...", "value": "custom"},
    ]
    formatted_models["openrouter"] = {
        "quick": openrouter_models,
        "deep": openrouter_models,
    }

    # Populate curated NVIDIA NIM models with Kimi K3 and top hosted models
    nvidia_models = [
        {"label": "Moonshot Kimi K3 - Flagship 1M ctx, reasoning & analysis", "value": "moonshotai/kimi-k3"},
        {"label": "Moonshot Kimi K2.6 - Fast agentic analysis, 256K ctx", "value": "moonshotai/kimi-k2.6"},
        {"label": "DeepSeek V4 Pro - Frontier reasoning & intelligence", "value": "deepseek-ai/deepseek-v4-pro-0813"},
        {"label": "DeepSeek V4 Flash - High-speed reasoning", "value": "deepseek-ai/deepseek-v4-flash-0731"},
        {"label": "Llama 3.1 Nemotron 70B - High performance NVIDIA model", "value": "nvidia/llama-3.1-nemotron-70b-instruct"},
        {"label": "Meta Llama 3.3 70B Instruct - Frontier open model", "value": "meta/llama-3.3-70b-instruct"},
        {"label": "Custom Model ID...", "value": "custom"},
    ]
    formatted_models["nvidia"] = {
        "quick": nvidia_models,
        "deep": nvidia_models,
    }

    # Populate curated Meta Muse models
    meta_models = [
        {"label": "Meta Muse Spark 1.3 (Contributor Tier) - 1M ctx agentic", "value": "muse-spark-1.3-contributor"},
        {"label": "Meta Muse Spark 1.3 (Standard Tier) - 1M ctx multimodal", "value": "muse-spark-1.3"},
        {"label": "Custom Model ID...", "value": "custom"},
    ]
    formatted_models["meta"] = {
        "quick": meta_models,
        "deep": meta_models,
    }

    # Ensure other custom-only providers have a valid custom fallback
    for key in ["azure", "openai_compatible", "mistral", "groq", "bedrock"]:
        if key not in formatted_models:
            formatted_models[key] = {
                "quick": [{"label": "Custom Model ID...", "value": "custom"}],
                "deep": [{"label": "Custom Model ID...", "value": "custom"}],
            }

    # Ensure gemini-2.5-flash and gemini-2.5-flash-lite are available for google quick and deep
    if "google" in formatted_models:
        google_quick = formatted_models["google"].get("quick", [])
        if not any(m["value"] == "gemini-2.5-flash-lite" for m in google_quick):
            google_quick.insert(0, {"label": "Gemini 2.5 Flash Lite - Lightweight, fast, high quota", "value": "gemini-2.5-flash-lite"})
        if not any(m["value"] == "gemini-2.5-flash" for m in google_quick):
            google_quick.insert(0, {"label": "Gemini 2.5 Flash - Fast, intelligent, reliable", "value": "gemini-2.5-flash"})

        google_deep = formatted_models["google"].get("deep", [])
        if not any(m["value"] == "gemini-2.5-flash-lite" for m in google_deep):
            google_deep.insert(0, {"label": "Gemini 2.5 Flash Lite - Lightweight, fast, high quota", "value": "gemini-2.5-flash-lite"})
        if not any(m["value"] == "gemini-2.5-flash" for m in google_deep):
            google_deep.insert(0, {"label": "Gemini 2.5 Flash - Fast, intelligent, reliable", "value": "gemini-2.5-flash"})

    languages = [
        "English",
        "Chinese",
        "Japanese",
        "Korean",
        "Hindi",
        "Spanish",
        "Portuguese",
        "French",
        "German",
        "Arabic",
        "Russian",
    ]

    depth_options = [
        {"value": 1, "label": "Shallow", "description": "Quick research, few debate rounds (Fast)"},
        {"value": 3, "label": "Medium", "description": "Balanced debate & strategy discussion"},
        {"value": 5, "label": "Deep", "description": "Comprehensive debate and deep risk analysis"},
    ]

    analyst_options = [
        {"key": "market", "name": "Market Analyst", "description": "Technical analysis & price action"},
        {"key": "social", "name": "Sentiment Analyst", "description": "Social media & sentiment trends"},
        {"key": "news", "name": "News Analyst", "description": "News catalysts, macro & insider events"},
        {"key": "fundamentals", "name": "Fundamentals Analyst", "description": "Financial statements & valuation"},
    ]

    # Load saved preferences to restore last-used provider and model
    prefs = _load_preferences()
    last_provider = prefs.get("llm_provider")
    last_deep = prefs.get("deep_think_llm")
    last_quick = prefs.get("quick_think_llm")
    last_thinking = prefs.get("thinking_mode")
    last_api_key = prefs.get("api_key")

    if last_provider == "meta":
        if last_deep and last_deep.startswith("meta/"):
            last_deep = last_deep[len("meta/"):]
        if last_quick and last_quick.startswith("meta/"):
            last_quick = last_quick[len("meta/"):]

    if last_provider and any(p.key == last_provider for p in providers):
        default_provider = last_provider
        default_deep = last_deep or (formatted_models.get(last_provider, {}).get("deep", [{}])[0].get("value", "custom"))
        default_quick = last_quick or (formatted_models.get(last_provider, {}).get("quick", [{}])[0].get("value", "custom"))
        default_thinking = last_thinking or ("high" if default_provider == "google" else "medium")
    else:
        # Check providers with active keys
        has_openrouter_key = bool(os.getenv("OPENROUTER_API_KEY"))
        has_meta_key = bool(os.getenv("META_API_KEY") or os.getenv("META_MUSE_API_KEY"))

        if has_openrouter_key:
            default_provider = "openrouter"
            default_deep = "nvidia/nemotron-3-super-120b-a12b:free"
            default_quick = "nvidia/nemotron-3-super-120b-a12b:free"
            default_thinking = "high"
        elif has_google_key:
            default_provider = "google"
            default_deep = "gemini-2.5-flash-lite"
            default_quick = "gemini-2.5-flash-lite"
            default_thinking = "high"
        elif has_meta_key:
            default_provider = "meta"
            default_deep = "muse-spark-1.3-contributor"
            default_quick = "muse-spark-1.3-contributor"
            default_thinking = "high"
        else:
            default_provider = DEFAULT_CONFIG.get("llm_provider", "openai")
            default_deep = DEFAULT_CONFIG.get("deep_think_llm", "gpt-5.6")
            default_quick = DEFAULT_CONFIG.get("quick_think_llm", "gpt-5.6-luna")
            default_thinking = "medium"

    defaults = {
        "ticker": "AAPL",
        "analysis_date": datetime.date.today().strftime("%Y-%m-%d"),
        "selected_analysts": prefs.get("selected_analysts", ["market", "social", "news", "fundamentals"]),
        "research_depth": prefs.get("research_depth", 1),
        "llm_provider": default_provider,
        "deep_think_llm": default_deep,
        "quick_think_llm": default_quick,
        "thinking_mode": default_thinking,
        "output_language": prefs.get("output_language", "English"),
        "checkpoint_enabled": True,
        "api_key": last_api_key or "",
    }

    return ConfigOptionsResponse(
        providers=providers,
        models=formatted_models,
        languages=languages,
        depth_options=depth_options,
        analyst_options=analyst_options,
        defaults=defaults,
    )


@router.get("/market/lookup", response_model=MarketInfoResponse)
async def market_lookup(
    ticker: str = Query(..., min_length=1, max_length=32),
    date: str | None = Query(None),
) -> MarketInfoResponse:
    """Fetch live ticker identity and verified market snapshot."""
    return get_market_info(ticker, date)


@router.post("/analysis/start")
async def start_analysis(request: AnalysisRequest) -> dict[str, str]:
    """Start a real TradingAgents analysis run (idempotent)."""
    pref_data = {
        "llm_provider": request.llm_provider,
        "deep_think_llm": request.deep_think_llm,
        "quick_think_llm": request.quick_think_llm,
        "thinking_mode": request.thinking_mode,
        "research_depth": request.research_depth,
        "output_language": request.output_language,
        "selected_analysts": request.selected_analysts,
    }
    _save_preferences(pref_data)

    snapshot = runner_manager.start(request)
    return {"run_id": snapshot.run_id}


@router.get("/analysis/{run_id}")
async def get_analysis_snapshot(run_id: str) -> dict[str, Any]:
    """Get the authoritative persisted snapshot for a run (refresh-safe)."""
    snapshot = runner_manager.get_snapshot(run_id)
    if snapshot:
        return snapshot.model_dump()

    historical = get_run_from_history(run_id)
    if historical:
        return historical.get("snapshot", {})

    raise HTTPException(status_code=404, detail="Run not found")


@router.get("/analysis/{run_id}/trace")
async def get_analysis_trace(run_id: str, after_seq: int = Query(-1, ge=-1)) -> list[dict[str, Any]]:
    """Get persisted trace events for a run (supports incremental sync)."""
    trace = runner_manager.get_trace(run_id, after_seq=after_seq)
    if trace:
        return trace

    historical = get_run_from_history(run_id)
    if historical:
        return historical.get("trace", [])

    return []


@router.post("/analysis/{run_id}/cancel")
async def cancel_analysis(run_id: str) -> dict[str, Any]:
    """Cancel an active analysis run immediately."""
    success = runner_manager.cancel(run_id)
    if not success:
        raise HTTPException(status_code=404, detail="Active run not found or already finished")
    return {"status": "success", "message": f"Run {run_id} has been cancelled"}


@router.post("/analysis/{run_id}/resume")
async def resume_analysis(run_id: str) -> dict[str, Any]:
    """Resume a failed/cancelled run from its latest valid checkpoint."""
    try:
        snapshot = runner_manager.resume(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"status": "success", "run_id": snapshot.run_id, "job_status": snapshot.status}


@router.get("/history")
async def get_history(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
    """Get run history: persistent job store first, legacy files as fallback."""
    jobs = job_store.list_jobs(limit)
    if jobs:
        out: list[dict[str, Any]] = []
        for job in jobs:
            out.append({
                "run_id": job["run_id"],
                "ticker": job.get("ticker"),
                "analysis_date": job.get("analysis_date"),
                "status": job.get("status"),
                "created_at": job.get("created_at"),
                "completed_at": job.get("completed_at"),
                "trade_signal": job.get("trade_signal"),
                "usage": job.get("usage"),
            })
        return out
    return list_history(limit)


@router.get("/history/{run_id}")
async def get_history_detail(run_id: str) -> dict[str, Any]:
    """Get full details of a past run."""
    snapshot = runner_manager.get_snapshot(run_id)
    if snapshot:
        return {"snapshot": snapshot.model_dump(), "trace": runner_manager.get_trace(run_id)}
    historical = get_run_from_history(run_id)
    if not historical:
        raise HTTPException(status_code=404, detail="History run not found")
    return historical


@router.delete("/history/{run_id}")
async def delete_history_item(run_id: str) -> dict[str, bool]:
    """Delete a run from history."""
    snapshot = runner_manager.get_snapshot(run_id)
    if snapshot and snapshot.status not in ("completed", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail="Cannot delete a running analysis")
    deleted = job_store.delete_job(run_id)
    deleted_file = delete_run_from_history(run_id)
    if not deleted and not deleted_file:
        raise HTTPException(status_code=404, detail="History item not found")
    return {"deleted": True}


@router.get("/config/keys", response_model=list[ApiKeyStatus])
async def get_api_keys() -> list[ApiKeyStatus]:
    """Return status and masked previews of configured API keys."""
    tracked_providers = [
        ("google", "Google Gemini"),
        ("openrouter", "OpenRouter"),
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic Claude"),
        ("deepseek", "DeepSeek"),
        ("groq", "Groq"),
        ("xai", "xAI (Grok)"),
        ("nvidia", "NVIDIA NIM"),
    ]

    results: list[ApiKeyStatus] = []
    for prov_key, prov_name in tracked_providers:
        env_var = get_api_key_env(prov_key)
        if not env_var:
            continue
        
        val = os.getenv(env_var)
        if prov_key == "google" and not val:
            val = os.getenv("GEMINI_API_KEY")

        is_set = bool(val and val.strip())
        preview = None
        if is_set and val:
            cleaned = val.strip()
            if len(cleaned) > 8:
                preview = f"{cleaned[:4]}...{cleaned[-4:]}"
            else:
                preview = "••••••••"

        results.append(
            ApiKeyStatus(
                provider=prov_key,
                provider_name=prov_name,
                env_var=env_var,
                is_set=is_set,
                preview=preview,
            )
        )

    return results


@router.post("/config/keys")
async def set_api_key(request: SetApiKeyRequest) -> dict[str, Any]:
    """Dynamically set or switch an API key for a provider at runtime."""
    prov_key = request.provider.lower().strip()
    key_val = request.api_key.strip()
    if not key_val:
        raise HTTPException(status_code=400, detail="API key cannot be empty")

    env_var = get_api_key_env(prov_key)
    if not env_var:
        env_var = f"{prov_key.upper()}_API_KEY"

    os.environ[env_var] = key_val

    if prov_key == "google":
        os.environ["GOOGLE_API_KEY"] = key_val
        os.environ["GEMINI_API_KEY"] = key_val
    elif prov_key == "openrouter":
        os.environ["OPENROUTER_API_KEY"] = key_val
    elif prov_key == "openai":
        os.environ["OPENAI_API_KEY"] = key_val
    elif prov_key == "anthropic":
        os.environ["ANTHROPIC_API_KEY"] = key_val
    elif prov_key == "deepseek":
        os.environ["DEEPSEEK_API_KEY"] = key_val
    elif prov_key == "groq":
        os.environ["GROQ_API_KEY"] = key_val
    elif prov_key == "xai":
        os.environ["XAI_API_KEY"] = key_val
    elif prov_key == "nvidia":
        os.environ["NVIDIA_API_KEY"] = key_val
    elif prov_key == "meta":
        os.environ["META_API_KEY"] = key_val
        os.environ["META_MUSE_API_KEY"] = key_val

    # Persist key to disk (.env) and update last used provider/key preference
    _persist_key_to_env(env_var, key_val)
    _save_preferences({"llm_provider": prov_key, "api_key": key_val})

    masked = f"{key_val[:4]}...{key_val[-4:]}" if len(key_val) > 8 else "••••••••"
    return {
        "status": "success",
        "provider": prov_key,
        "env_var": env_var,
        "preview": masked,
        "message": f"Successfully activated API key for {prov_key.title()}",
    }


@router.delete("/config/keys/{provider}")
async def delete_api_key(provider: str) -> dict[str, Any]:
    """Clear an API key from the runtime environment."""
    prov_key = provider.lower().strip()
    env_var = get_api_key_env(prov_key)
    if env_var and env_var in os.environ:
        del os.environ[env_var]
    if prov_key == "google":
        if "GEMINI_API_KEY" in os.environ:
            del os.environ["GEMINI_API_KEY"]
        if "GOOGLE_API_KEY" in os.environ:
            del os.environ["GOOGLE_API_KEY"]
    return {
        "status": "success",
        "provider": prov_key,
        "message": f"API key for {prov_key} cleared from runtime",
    }


@router.post("/config/preferences")
async def save_preferences_endpoint(payload: dict[str, Any]) -> dict[str, str]:
    """Save user UI preferences to ~/.tradingagents/web_preferences.json."""
    _save_preferences(payload)
    return {"status": "ok"}


class TestConnectionRequest(BaseModel):
    provider: str
    model: str
    api_key: str | None = None


@router.post("/config/test-connection")
async def test_connection_endpoint(payload: TestConnectionRequest) -> dict[str, Any]:
    """Perform a real server-side validation of provider, model, and credentials."""
    from tradingagents.llm_clients.factory import create_llm_client
    from dotenv import load_dotenv

    prov = payload.provider.lower().strip()
    model = payload.model.strip()
    kwargs: dict[str, Any] = {}

    key = (payload.api_key or "").strip()
    if key:
        kwargs["api_key"] = key
    else:
        repo_root = Path(__file__).resolve().parent.parent.parent.parent
        load_dotenv(repo_root / ".env", override=True)
        env_var = get_api_key_env(prov)
        existing_key = os.getenv(env_var) if env_var else None
        if prov == "google" and not existing_key:
            existing_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        if existing_key:
            kwargs["api_key"] = existing_key

    try:
        client = create_llm_client(provider=prov, model=model, **kwargs)
        llm = client.get_llm()
        await asyncio.to_thread(llm.invoke, "Ping")
        return {"ok": True, "message": "Connection successful"}
    except Exception as exc:
        err_str = str(exc).lower()
        if "401" in err_str or "unauthorized" in err_str or "api_key_invalid" in err_str or "invalid api key" in err_str:
            return {"ok": False, "error": "Invalid API key"}
        if "404" in err_str or "not_found" in err_str or "model not found" in err_str:
            return {"ok": False, "error": "Model unavailable"}
        if "429" in err_str or "resource_exhausted" in err_str or "quota" in err_str:
            return {"ok": True, "message": "Connection successful (API rate limit warning: free tier has 5 RPM)"}
        return {"ok": False, "error": f"Provider unavailable: {str(exc)[:60]}"}


@router.get("/config/active")
async def get_active_config() -> dict[str, Any]:
    """Return active provider, model, and whether API key is configured (NEVER exposing key)."""
    prefs = _load_preferences()
    prov = prefs.get("llm_provider") or os.getenv("TRADINGAGENTS_LLM_PROVIDER") or "google"
    model = prefs.get("deep_think_llm") or os.getenv("TRADINGAGENTS_DEEP_THINK_LLM") or "gemini-2.5-flash"
    env_var = get_api_key_env(prov)
    has_key = bool(os.getenv(env_var)) if env_var else True
    if prov == "google" and (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")):
        has_key = True
    return {
        "ok": True,
        "provider": prov,
        "model": model,
        "isKeyConfigured": has_key,
        "status": "online",
    }


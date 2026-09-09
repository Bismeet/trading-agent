import pytest
from tradingagents.llm_clients.model_catalog import (
    PROVIDER_CATALOG,
    MODEL_OPTIONS,
    get_known_models,
    get_model_metadata,
)

def test_catalog_contains_twelve_providers():
    expected = [
        "google", "openai", "anthropic", "groq", "deepseek",
        "openrouter", "kimi", "nvidia", "meta", "mistral", "qwen", "xai"
    ]
    for prov in expected:
        assert prov in PROVIDER_CATALOG, f"Missing provider: {prov}"
        assert len(PROVIDER_CATALOG[prov]) > 0, f"No models for provider: {prov}"

def test_google_catalog_has_gemini_models():
    models = PROVIDER_CATALOG["google"]
    ids = [m["id"] for m in models]
    assert "gemini-2.5-flash" in ids
    assert "gemini-2.5-flash-lite" in ids
    assert "gemini-3.5-flash" in ids

def test_model_metadata_required_fields():
    for prov, models in PROVIDER_CATALOG.items():
        for m in models:
            assert "id" in m
            assert "name" in m
            assert "provider" in m
            assert "context_window" in m
            assert "category" in m
            assert "lifecycle" in m
            assert "speed" in m
            assert "cost_class" in m

def test_get_known_models_helper():
    known = get_known_models()
    assert "google" in known
    assert "gemini-2.5-flash" in known["google"]
    assert "gemini-2.5-pro" in known["google"]

def test_get_model_metadata_helper():
    meta = get_model_metadata("google", "gemini-2.5-flash")
    assert meta is not None
    assert meta["id"] == "gemini-2.5-flash"
    assert meta["context_window"] >= 1_000_000

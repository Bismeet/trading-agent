from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class AnalysisRequest(BaseModel):
    ticker: str = Field(..., description="Stock ticker symbol (e.g., AAPL, NVDA, SPY)")
    analysis_date: str = Field(..., description="Analysis date in YYYY-MM-DD format")
    selected_analysts: list[str] = Field(
        default=["market", "social", "news", "fundamentals"],
        description="Selected analysts: market, social, news, fundamentals",
    )
    research_depth: int = Field(default=1, description="Research depth: 1 (shallow), 3 (medium), 5 (deep)")
    llm_provider: str = Field(default="google", description="LLM provider (e.g. google, openai, anthropic)")
    deep_think_llm: str = Field(default="gemini-3.5-flash", description="Model ID for deep thinking")
    quick_think_llm: str = Field(default="gemini-3.5-flash", description="Model ID for quick thinking")
    thinking_mode: str | None = Field(default="high", description="Thinking mode or level (e.g., 'high', 'minimal')")
    output_language: str = Field(default="English", description="Report language")
    checkpoint_enabled: bool = Field(default=True, description="Whether checkpoint/resume is enabled")
    api_key: str | None = Field(default=None, description="Optional custom API key for this run and provider")
    resume_from_run_id: str | None = Field(default=None, description="Run ID to resume from, preserving stats and traces")


class SetApiKeyRequest(BaseModel):
    provider: str = Field(..., description="LLM provider key, e.g. google, openrouter, openai")
    api_key: str = Field(..., description="API key value")


class ApiKeyStatus(BaseModel):
    provider: str
    provider_name: str
    env_var: str
    is_set: bool
    preview: str | None = None


class AgentActivityEvent(BaseModel):
    timestamp: str
    agent: str | None = None
    activity_type: str  # "status_change", "tool_call", "message", "report_update", "error", "complete"
    title: str
    details: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCallDetail(BaseModel):
    timestamp: str
    tool_name: str
    args: dict[str, Any]


class RunStats(BaseModel):
    llm_calls: int = 0
    tool_calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    elapsed_seconds: float = 0.0


class AnalysisRunSnapshot(BaseModel):
    run_id: str
    ticker: str
    analysis_date: str
    status: str  # "pending", "running", "completed", "failed"
    progress_percent: int = 0
    current_agent: str | None = None
    current_activity: str | None = None
    agent_statuses: dict[str, str] = Field(default_factory=dict)
    selected_analysts: list[str] = Field(default_factory=list)
    stats: RunStats = Field(default_factory=RunStats)
    reports: dict[str, str | None] = Field(default_factory=dict)
    final_report: str | None = None
    trade_signal: str | None = None
    error_summary: str | None = None
    error_details: str | None = None
    failing_agent: str | None = None
    wall_time_summary: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    request_params: dict[str, Any] = Field(default_factory=dict)
    usage_estimated: bool = False
    usage_provider: str | None = None


class MarketInfoResponse(BaseModel):
    symbol: str
    company_name: str | None = None
    sector: str | None = None
    industry: str | None = None
    exchange: str | None = None
    quote_type: str | None = None
    snapshot: str | None = None
    error: str | None = None


class ProviderOption(BaseModel):
    key: str
    name: str
    has_key: bool
    requires_key: bool
    default_url: str | None = None


class ConfigOptionsResponse(BaseModel):
    providers: list[ProviderOption]
    models: dict[str, dict[str, list[dict[str, str]]]]
    languages: list[str]
    depth_options: list[dict[str, Any]]
    analyst_options: list[dict[str, str]]
    defaults: dict[str, Any]

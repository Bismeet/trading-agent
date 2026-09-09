"""FabRich integration endpoint for TradingAgents.

Exposes ``POST /api/hybrid/decision`` which runs the **existing**
TradingAgents graph (analysts -> Bull/Bear debate -> Research Manager ->
Trader -> Risk debate -> Portfolio Manager) unchanged and converts the final
state into a machine-readable :class:`HybridDecision` for the FabRich
paper-trading engine.

TradingAgents only answers: *"does TradingAgents support the proposed side?"*
It never overrides FabRich max-leverage, max-positions, stale-data, liquidation,
or account risk controls -- those remain the consumer's responsibility.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.services.decision_extractor import build_hybrid_decision, rejection
from tradingagents.services.hybrid_decision import HybridDecision
from tradingagents.graph.trading_graph import TradingAgentsGraph

logger = logging.getLogger("tradingagents.services.hybrid_router")

router = APIRouter(prefix="/api")

# Per-request hard timeout. TradingAgents is a multi-agent LLM pipeline, so a
# single decision takes minutes; the consumer enforces its own order deadline.
_HYBRID_TIMEOUT_SECONDS = float(os.getenv("TRADINGAGENTS_HYBRID_TIMEOUT_S", "600"))

# Analysts executed by the graph (matches default CLI/web behaviour).
_SELECTED_ANALYSTS = ("market", "social", "news", "fundamentals")

_VALID_ASSET_TYPES = {"stock", "crypto"}
_VALID_SIDES = {"long", "short"}


class HybridDecisionRequest(BaseModel):
    """FabRich decision-request payload.

    ``proposed_side`` is the only field that drives TradingAgents' ``approved``
    boolean. Optional price fields (``entry_price`` / ``stop_price`` /
    ``target_price``) are **not** sent to the model; they are forwarded back on
    the response purely as context for FabRich. TradingAgents' own price levels
    (if any) come from the Trader/ResearchManager report, not from these inputs.
    """

    ticker: str = Field(..., description="Instrument ticker (e.g. NVDA, BTC-USD)")
    trade_date: str = Field(..., description="Decision date in YYYY-MM-DD format")
    asset_type: str = Field(default="stock", description="stock | crypto")
    proposed_side: str = Field(..., description="long | short")
    strategy_id: str | None = Field(default=None, description="FabRich strategy id (passthrough)")
    setup_tag: str | None = Field(default=None, description="FabRich setup tag (passthrough)")
    entry_price: float | None = Field(default=None, description="FabRich entry (passthrough, not used by model)")
    stop_price: float | None = Field(default=None, description="FabRich stop (passthrough, not used by model)")
    target_price: float | None = Field(default=None, description="FabRich target (passthrough, not used by model)")
    trading_regime: str | None = Field(default=None, description="FabRich regime label (passthrough)")
    instrument_context: str | None = Field(default=None, description="Optional override for the instrument context string")

    def normalized(self) -> "HybridDecisionRequest":
        asset = (self.asset_type or "stock").lower().strip()
        side = (self.proposed_side or "long").lower().strip()
        if asset not in _VALID_ASSET_TYPES:
            asset = "stock"
        if side not in _VALID_SIDES:
            side = "long"
        self.asset_type = asset
        self.proposed_side = side
        return self


def _build_config(request: HybridDecisionRequest) -> dict[str, Any]:
    """Build an isolated TradingAgents config from a FabRich request.

    Mirrors the runtime config assembly done by ``web.backend.services.runner``
    but is self-contained so the endpoint can run without the web job store.
    """
    config = copy.deepcopy(DEFAULT_CONFIG)
    config["llm_max_retries"] = 4
    config["max_debate_rounds"] = 1
    config["max_risk_discuss_rounds"] = 1
    config["output_language"] = "English"
    # Checkpoint is intentionally left at its default; the endpoint is stateless
    # per request and does not resume prior runs.
    config["checkpoint_enabled"] = False
    config["backend_url"] = os.getenv("TRADINGAGENTS_BACKEND_URL") or config.get("backend_url")
    return config


def run_graph_sync(
    ticker: str,
    trade_date: str,
    asset_type: str,
    request: HybridDecisionRequest,
) -> dict[str, Any]:
    """Execute the real TradingAgents graph and return its final state dict.

    This is the integration seam: tests monkeypatch this function to return a
    canned state, so the endpoint can be tested for its extraction / approval
    logic without consuming LLM quota or network data.
    """
    config = _build_config(request)
    graph = TradingAgentsGraph(
        selected_analysts=_SELECTED_ANALYSTS,
        config=config,
        debug=False,
        callbacks=None,
    )
    final_state, _signal = graph.propagate(ticker, trade_date, asset_type=asset_type)

    # Surface provider metadata so the consumer knows which model produced the
    # decision; the graph does not already store it on the state.
    

@router.post(
    "/hybrid/decision",
    response_model=HybridDecision,
    response_model_exclude_none=False,
)
async def hybrid_decision(request: HybridDecisionRequest) -> HybridDecision:
    """Run TradingAgents for ``ticker``/``trade_date`` and return a hybrid decision.

    The full analyst -> debate -> trader -> risk -> portfolio pipeline executes
    unmodified. Only ``approved`` (relative to ``proposed_side``) and the
    extracted price levels are surfaced; FabRich owns all downstream risk
    controls (leverage limits, position caps, liquidation, account guards).

    On any failure -- including timeouts, missing API keys, or malformed model
    output that the graph itself cannot resolve -- the endpoint returns a
    deterministic rejection with ``approved=false`` and
    ``reason="AI_UNAVAILABLE"``. It never returns an automatic approval when the
    AI pipeline is unavailable.
    """
    req = request.normalized()
    ticker = req.ticker.strip()
    trade_date = req.trade_date.strip()

    # Validate the date up front so a malformed request fails fast rather than
    # consuming a partial pipeline run.
    try:
        datetime.strptime(trade_date, "%Y-%m-%d")
    except Exception:
        return rejection("AI_UNAVAILABLE", ticker, trade_date)

    try:
        final_state = await asyncio.wait_for(
            asyncio.to_thread(run_graph_sync, ticker, trade_date, req.asset_type, req),
            timeout=_HYBRID_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("TradingAgents hybrid decision timed out for %s", ticker)
        return rejection("AI_UNAVAILABLE", ticker, trade_date)
    except Exception as exc:  # noqa: BLE001 - any AI/runtime failure is non-approving
        logger.warning("TradingAgents hybrid decision failed for %s: %s", ticker, exc)
        return rejection("AI_UNAVAILABLE", ticker, trade_date)

    # Build the deterministic decision from the finished graph state.
    try:
        decision = build_hybrid_decision(
            state=final_state,
            proposed_side=req.proposed_side,
            strategy_id=req.strategy_id,
            setup_tag=req.setup_tag,
            ticker=ticker,
            trade_date=trade_date,
        )
    except Exception as exc:  # noqa: BLE001 - malformed state must not approve
        logger.warning("Hybrid decision extraction failed for %s: %s", ticker, exc)
        return rejection("AI_UNAVAILABLE", ticker, trade_date)

    # Malformed/unparseable decision surfaces as Hold -> rejected for both sides.
    if not decision.rating or decision.rating not in {
        "Buy", "Overweight", "Hold", "Underweight", "Sell",
    }:
        return rejection("AI_UNAVAILABLE", ticker, trade_date)

    return decision


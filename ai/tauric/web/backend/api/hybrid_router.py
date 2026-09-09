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
    fabrich_context: dict[str, Any] | None = Field(default=None, description="FabRich internal context payload")

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
    from tradingagents.default_config import _apply_env_overrides
    _apply_env_overrides(config)

    # Apply runtime preferences saved from web UI or settings
    try:
        from web.backend.api.routes import _load_preferences
        prefs = _load_preferences()
        if prefs.get("llm_provider"):
            config["llm_provider"] = prefs["llm_provider"]
        if prefs.get("deep_think_llm"):
            config["deep_think_llm"] = prefs["deep_think_llm"]
        if prefs.get("quick_think_llm"):
            config["quick_think_llm"] = prefs["quick_think_llm"]
    except Exception:
        pass

    # Ensure google provider defaults to gemini-2.5-flash if not specified
    if config.get("llm_provider") == "google":
        if not config.get("deep_think_llm") or "gpt" in str(config.get("deep_think_llm")).lower():
            config["deep_think_llm"] = "gemini-2.5-flash"
        if not config.get("quick_think_llm") or "gpt" in str(config.get("quick_think_llm")).lower():
            config["quick_think_llm"] = "gemini-2.5-flash"

    config["llm_max_retries"] = 4
    config["max_debate_rounds"] = 1
    config["max_risk_discuss_rounds"] = 1
    config["output_language"] = "English"
    config["checkpoint_enabled"] = False
    config["backend_url"] = os.getenv("TRADINGAGENTS_BACKEND_URL") or config.get("backend_url")
    return config


def format_fabrich_context_prompt(context: dict[str, Any] | None, req: HybridDecisionRequest) -> str:
    """Format FabRich internal intelligence into a structured section for TradingAgents."""
    lines = [
        "=== FABRICH SYSTEM CONTEXT & HISTORICAL EVIDENCE ===",
        "",
        "CURRENT CANDIDATE",
        f"- Instrument: {req.ticker}",
        f"- Proposed Side: {req.proposed_side.upper()}",
        f"- Strategy ID: {req.strategy_id or 'unknown'}",
        f"- Setup Tag: {req.setup_tag or 'unknown'}",
        f"- Entry Price: {req.entry_price if req.entry_price is not None else 'market'}",
        f"- Stop Loss: {req.stop_price if req.stop_price is not None else 'N/A'}",
        f"- Price Target: {req.target_price if req.target_price is not None else 'N/A'}",
        f"- Trading Regime: {req.trading_regime or 'unknown'}",
        "",
    ]

    if not context or not isinstance(context, dict):
        lines.append("No additional FabRich context provided.")
        return "\n".join(lines)

    # 1. Strategy Context
    strat = context.get("strategy")
    lines.append("FABRICH STRATEGY CONTEXT")
    if strat and isinstance(strat, dict):
        lines.append(f"- Name: {strat.get('name', strat.get('id', 'unknown'))}")
        lines.append(f"- Status: {strat.get('status', 'candidate')}")
        lines.append(f"- Historical Trades (n): {strat.get('total_trades', 0)}")
        lines.append(f"- Win Rate: {strat.get('win_rate', 'N/A')}")
        lines.append(f"- Profit Factor: {strat.get('profit_factor', 'N/A')}")
        lines.append(f"- Expectancy (R): {strat.get('expectancy_r', 'N/A')}")
        lines.append(f"- Kelly Sizing: {strat.get('kelly', 'N/A')}")
        lines.append(f"- Confidence Score: {strat.get('confidence', 'N/A')}")
        lines.append(f"- Deflated Sharpe Ratio (DSR): {strat.get('dsr', 'N/A')}")
    else:
        lines.append("No specific strategy performance history available.")
    lines.append("")

    # 2. Lessons Bank
    lessons = context.get("lessons")
    lines.append("FABRICH LESSONS")
    if isinstance(lessons, list) and len(lessons) > 0:
        for idx, l in enumerate(lessons, 1):
            lines.append(f"{idx}. [{l.get('kind', 'lesson').upper()}] {l.get('title', '')}: {l.get('text', '')} (Importance: {l.get('importance', 1)}/10, Regime: {l.get('regime', 'any')})")
    elif isinstance(lessons, str):
        lines.append(lessons)
    else:
        lines.append("No relevant FabRich lessons available.")
    lines.append("")

    # 3. Recent Trades
    recent_trades = context.get("recent_trades")
    lines.append("RECENT RELEVANT TRADES")
    if recent_trades and isinstance(recent_trades, dict):
        lines.append(f"- Matching Executions: {recent_trades.get('matching_count', 0)}")
        lines.append(f"- Record: {recent_trades.get('wins', 0)} wins / {recent_trades.get('losses', 0)} losses (Win Rate: {recent_trades.get('win_rate', 'N/A')})")
        lines.append(f"- Total Realized PnL: {recent_trades.get('total_pnl', 0)} USD (Avg: {recent_trades.get('avg_pnl', 0)} USD)")
        rec_execs = recent_trades.get("recent_executions", [])
        if rec_execs:
            lines.append("- Recent Fills:")
            for ex in rec_execs[:3]:
                lines.append(f"  * {ex.get('op', '').upper()} {ex.get('side', '')} @ {ex.get('price', '—')} | PnL: {ex.get('net_pnl', '—')} | Reason: {ex.get('reason', '—')}")
    else:
        lines.append("No recent matching executions recorded.")
    lines.append("")

    # 4. Current Portfolio Context
    pos = context.get("positions")
    lines.append("CURRENT PORTFOLIO CONTEXT")
    if pos and isinstance(pos, dict):
        lines.append(f"- Open Positions Count: {pos.get('open_count', 0)}")
        lines.append(f"- Gross Leverage: {pos.get('gross_leverage', '1.0')}x (Cap: {pos.get('leverage_cap', '—')}x)")
        lines.append(f"- Correlated Crypto Positions: {pos.get('correlated_crypto_count', 0)}")
        active_pos = pos.get("open_positions", [])
        if active_pos:
            lines.append("- Active Positions: " + ", ".join([f"{p.get('symbol')} ({p.get('side')} {p.get('leverage', 1)}x)" for p in active_pos]))
    else:
        lines.append("Portfolio is currently all cash (0 open positions).")
    lines.append("")

    # 5. World / Macro Context
    world = context.get("world")
    lines.append("WORLD / MACRO CONTEXT")
    if world and isinstance(world, dict):
        lines.append(f"- Market Regime: {world.get('regime', 'unknown')} | Risk Posture: {world.get('risk_posture', 'unknown')}")
        fg_crypto = world.get("fear_greed_crypto")
        if fg_crypto:
            lines.append(f"- Crypto Fear & Greed: {fg_crypto.get('value')} ({fg_crypto.get('band')})")
        fg_stocks = world.get("fear_greed_stocks")
        if fg_stocks:
            lines.append(f"- Stock Market Fear & Greed: {fg_stocks.get('value')} ({fg_stocks.get('band')})")
        if world.get("funding_rate") is not None:
            lines.append(f"- Crypto 8h Funding Rate: {world.get('funding_rate')}")
        drivers = world.get("macro_drivers", [])
        if drivers:
            lines.append(f"- Macro Drivers: {', '.join(drivers)}")
        if world.get("macro_vix") is not None:
            lines.append(f"- VIX Volatility Index: {world.get('macro_vix')}")
    else:
        lines.append("Macro / World feed is neutral or in default state.")
    lines.append("")

    # 6. Recent AI Context
    recent_ai = context.get("recent_ai")
    lines.append("RECENT AI CONTEXT")
    if recent_ai and isinstance(recent_ai, dict):
        lines.append(f"- Similar Candidate Decisions: {recent_ai.get('evaluated_count', 0)} ({recent_ai.get('approvals', 0)} approved, {recent_ai.get('rejections', 0)} rejected)")
        last_d = recent_ai.get("last_decision")
        if last_d:
            lines.append(f"- Last AI Decision for this instrument: {last_d.get('decision')} ({last_d.get('rating')}) - \"{last_d.get('thesis', '')}\"")
    else:
        lines.append("No prior AI decisions recorded for this setup.")
    lines.append("")

    # 7. Critical Evaluation Instruction
    lines.append("TAURIC EXTERNAL RESEARCH & CRITICAL EVALUATION")
    lines.append("IMPORTANT: FabRich context is historical and system-generated evidence. Do not blindly follow it. Critically evaluate whether it is relevant to the current market situation and combine it with independent external analysis.")
    lines.append("=== END FABRICH CONTEXT ===")
    lines.append("")

    return "\n".join(lines)


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

    # Format the rich FabRich context and inject into the instrument context resolver
    fabrich_text = format_fabrich_context_prompt(request.fabrich_context, request)
    base_resolve = graph.resolve_instrument_context
    graph.resolve_instrument_context = lambda t, a="stock": f"{base_resolve(t, a)}\n\n{fabrich_text}"

    final_state, _signal = graph.propagate(ticker, trade_date, asset_type=asset_type)
    return final_state


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
        return rejection("AI_UNAVAILABLE", ticker, trade_date, fabrich_context=req.fabrich_context)

    try:
        final_state = await asyncio.wait_for(
            asyncio.to_thread(run_graph_sync, ticker, trade_date, req.asset_type, req),
            timeout=_HYBRID_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("TradingAgents hybrid decision timed out for %s", ticker)
        return rejection("AI_UNAVAILABLE", ticker, trade_date, fabrich_context=req.fabrich_context)
    except Exception as exc:  # noqa: BLE001 - any AI/runtime failure is non-approving
        logger.warning("TradingAgents hybrid decision failed for %s: %s", ticker, exc)
        return rejection("AI_UNAVAILABLE", ticker, trade_date, fabrich_context=req.fabrich_context)

    # Build the deterministic decision from the finished graph state.
    try:
        decision = build_hybrid_decision(
            state=final_state,
            proposed_side=req.proposed_side,
            strategy_id=req.strategy_id,
            setup_tag=req.setup_tag,
            ticker=ticker,
            trade_date=trade_date,
            fabrich_context=req.fabrich_context,
        )
    except Exception as exc:  # noqa: BLE001 - malformed state must not approve
        logger.warning("Hybrid decision extraction failed for %s: %s", ticker, exc)
        return rejection("AI_UNAVAILABLE", ticker, trade_date, fabrich_context=req.fabrich_context)

    # Malformed/unparseable decision surfaces as Hold -> rejected for both sides.
    if not decision.rating or decision.rating not in {
        "Buy", "Overweight", "Hold", "Underweight", "Sell",
    }:
        return rejection("AI_UNAVAILABLE", ticker, trade_date, fabrich_context=req.fabrich_context)

    return decision


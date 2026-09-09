"""Integration helpers that turn a finished TradingAgents graph state into a
:class:`~tradingagents.services.hybrid_decision.HybridDecision`.

Design rules
------------
* Reuse the **existing** graph verbatim -- no second reasoning system.
* The finished graph state stores only the *rendered markdown* of the final
  decision (see ``AgentState`` in ``agent_states.py``); the Pydantic objects
  ``PortfolioDecision`` / ``TraderProposal`` are created inside the agent nodes
  via ``bind_structured`` but are **not** retained on the state. That means
  there is no structured object to read, so we read the canonical headers the
  system itself writes (``render_pm_decision`` / ``render_trader_proposal``).
  For the rating we reuse the library deterministic ``extract_rating``; the
  price-level headers are parsed with the same header patterns the renderers
  emit. We never invent values: absent fields stay ``None``.
* ``approved`` is the *only* field TradingAgents computes; FabRich still
  enforces its own max-leverage, max-positions, stale-data, liquidation, and
  account risk controls -- those are out of scope here.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from tradingagents.agents.utils.rating import extract_rating as _extract_rating
from tradingagents.services.hybrid_decision import HybridAction, HybridDecision

logger = logging.getLogger("tradingagents.services.hybrid")

# Map the canonical 5-tier rating onto a coarse action.
_ACTION_FROM_RATING: dict[str, HybridAction] = {
    "Buy": HybridAction.BUY,
    "Overweight": HybridAction.BUY,
    "Hold": HybridAction.HOLD,
    "Underweight": HybridAction.SELL,
    "Sell": HybridAction.SELL,
}

# Direction approval matrix for a *proposed* trade side.
# TradingAgents only says whether the side is supported; it never overrides
# FabRich leverage/position/account controls.
_APPROVE: dict[str, set[str]] = {
    "long": {"Buy", "Overweight"},
    "short": {"Sell", "Underweight"},
}


def _to_float(value: Any) -> float | None:
    """Best-effort float coercion; leaves None untouched."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN guard
        return None
    return f


def _first_present(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None



def _extract_price_targets(state: dict[str, Any]) -> tuple[float | None, float | None, float | None, str | None]:
    """Pull entry/stop/target/position_sizing from the rendered state only.

    Search order -- first source that carries a non-null value wins:
        trader_investment_plan (TraderProposal markdown)
        final_trade_decision   (PortfolioDecision markdown)
    These are the canonical headers produced by the existing renderers.
    """
    trader_plan = state.get("trader_investment_plan") or ""
    final_decision = state.get("final_trade_decision") or ""

    entry = _first_present(_extract_header(trader_plan, "Entry Price"))
    stop = _first_present(_extract_header(trader_plan, "Stop Loss"))
    target = _first_present(
        _extract_header(final_decision, "Price Target"),
        _extract_header(trader_plan, "Price Target"),
    )
    sizing = _first_present(
        _extract_header(trader_plan, "Position Sizing"),
        _extract_header(final_decision, "Position Sizing"),
    )

    return (
        _to_float(entry),
        _to_float(stop),
        _to_float(target),
        sizing,
    )


def build_hybrid_decision(
    state: dict[str, Any],
    proposed_side: str,
    strategy_id: str | None = None,
    setup_tag: str | None = None,
    ticker: str = "",
    trade_date: str = "",
) -> HybridDecision:
    """Convert a finished graph state into a :class:`HybridDecision`.

    Pure function -- performs no I/O and consumes no LLM tokens. Reads the
    rendered markdown on the state (``final_trade_decision`` for the PM
    decision, ``trader_investment_plan`` for the Trader proposal) and parses
    the canonical headers those renderers emit. The rating reuses the library
    deterministic ``extract_rating``; price levels are parsed only when the
    header is present, otherwise they remain ``None``.
    """
    final_decision = state.get("final_trade_decision") or ""

    # 1) Rating -- reuse the library deterministic parser (no scraping).
    rating = _extract_rating(final_decision) if final_decision else None
    if rating not in _ACTION_FROM_RATING:
        rating = "Hold"

    # 2) Thesis -- Investment Thesis header; fall back to Executive Summary;
    #    missing header -> empty string (never fabricated).
    thesis = _first_present(
        _extract_header(final_decision, "Investment Thesis"),
        _extract_header(final_decision, "Executive Summary"),
    ) or ""

    # 3) Price targets (entry/stop/target/position_sizing) from rendered state.
    entry, stop, target, sizing = _extract_price_targets(state)

    # 4) Approval for *this* proposed side (TradingAnimals-only view).
    proposed_side_lc = (proposed_side or "long").lower()
    approved = rating in _APPROVE.get(proposed_side_lc, set())
    action = _ACTION_FROM_RATING[rating]

    # 5) Model/provider metadata (if present in final_state).
    model_provider = _first_present(state.get("model_provider"))
    model_name = _first_present(state.get("model_name"))

    return HybridDecision(
        ticker=ticker or (state.get("config", {}).get("ticker", "")) or "",
        trade_date=trade_date,
        action=action,
        rating=rating,
        approved=approved,
        thesis=str(thesis).strip() or "No structured thesis available.",
        entry_price=entry,
        stop_loss=stop,
        price_target=target,
        position_sizing=sizing,
        generated_at=HybridDecision.now_iso(),
        model_provider=str(model_provider) if model_provider else None,
        model_name=str(model_name) if model_name else None,
        fabrich_setup_tag=setup_tag,
        fabrich_strategy_id=strategy_id,
        reason=None,
    )


def rejection(reason: str, ticker: str, trade_date: str) -> HybridDecision:
    """Deterministic fallback used when the AI pipeline cannot produce a signal."""
    logger.warning("Hybrid decision rejected: %s", reason)
    return HybridDecision(
        ticker=ticker,
        trade_date=trade_date,
        action=HybridAction.HOLD,
        rating="Hold",
        approved=False,
        thesis="",
        entry_price=None,
        stop_loss=None,
        price_target=None,
        position_sizing=None,
        generated_at=HybridDecision.now_iso(),
        model_provider=None,
        model_name=None,
        fabrich_setup_tag=None,
        fabrich_strategy_id=None,
        reason=reason,
    )


# Canonical markdown header pattern emitted by render_trader_proposal /
# render_pm_decision: a bold label followed by a colon and a value.
_HEADER_VALUE_RE = re.compile(
    r"^\*\*(?P<header>[^:\n]+?)\*\*:\s*(?P<value>.+?)\s*$", re.MULTILINE
)


def _extract_header(text: str, header: str) -> str | None:
    """Return the value following ``**header**:`` in ``text``, or ``None``."""
    if not text:
        return None
    target = header.lower()
    for m in _HEADER_VALUE_RE.finditer(text or ""):
        if m.group("header").strip().lower() == target:
            val = m.group("value").strip()
            return val.strip("*").strip()
    return None

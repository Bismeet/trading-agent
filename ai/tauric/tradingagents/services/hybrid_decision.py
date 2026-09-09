"""TradingAgents -> FabRich hybrid decision contract.

This module is the *integration only* layer: it converts the existing
TradingAgents graph decision into a machine-readable payload that the
FabRich paper-trading engine can consume as an AI decision *signal*.

It deliberately does **not** alter any analyst, researcher, trader, risk,
or portfolio-manager logic. It also does **not** add brokerage; it only
answers: "does TradingAgents support the proposed trade side?".
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator


class HybridAction(str, Enum):
    """Coarse action derived from the 5-tier rating for FabRich's proposed_side."""

    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class HybridDecision(BaseModel):
    """Machine-readable TradingAgents decision returned to FabRich.

    Mirrors the final portfolio-manager / trader decision **without inventing
    fields**. ``confidence`` and ``risk`` are intentionally omitted because the
    existing final schemas do not provide them as structured values.
    """

    ticker: str
    trade_date: str
    action: HybridAction
    rating: str  # canonical 5-tier: Buy|Overweight|Hold|Underweight|Sell
    approved: bool
    thesis: str
    entry_price: Optional[float] = Field(default=None)
    stop_loss: Optional[float] = Field(default=None)
    price_target: Optional[float] = Field(default=None)
    position_sizing: Optional[str] = Field(default=None)
    source: str = "TradingAgents"
    generated_at: str
    model_provider: Optional[str] = Field(default=None)
    model_name: Optional[str] = Field(default=None)
    # Opaque passthrough of FabRich context (never acted on by TradingAgents).
    fabrich_setup_tag: Optional[str] = Field(default=None)
    fabrich_strategy_id: Optional[str] = Field(default=None)
    fabrich_context: Optional[dict[str, Any]] = Field(default=None)
    # Error path: when the AI pipeline is unavailable or output is malformed.
    reason: Optional[str] = Field(default=None)

    @field_validator("rating")
    @classmethod
    def _validate_rating(cls, v: str) -> str:
        allowed = {"Buy", "Overweight", "Hold", "Underweight", "Sell"}
        if v not in allowed:
            raise ValueError(f"rating must be one of {sorted(allowed)}, got {v!r}")
        return v

    @classmethod
    def now_iso(cls) -> str:
        return datetime.now(timezone.utc).isoformat()

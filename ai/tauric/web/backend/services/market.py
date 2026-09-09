from __future__ import annotations

import datetime
from typing import Any

from tradingagents.agents.utils.agent_utils import resolve_instrument_identity
from tradingagents.dataflows.market_data_validator import build_verified_market_snapshot
from tradingagents.dataflows.symbol_utils import normalize_symbol
from web.backend.schemas import MarketInfoResponse


def get_market_info(ticker: str, curr_date: str | None = None) -> MarketInfoResponse:
    """Fetch real instrument identity and verified market snapshot."""
    canonical = normalize_symbol(ticker) if ticker else "SPY"
    if not curr_date:
        curr_date = datetime.date.today().strftime("%Y-%m-%d")

    identity = resolve_instrument_identity(canonical) or {}

    snapshot_text = None
    error_msg = None
    try:
        snapshot_text = build_verified_market_snapshot(canonical, curr_date)
    except Exception as exc:
        error_msg = str(exc)

    return MarketInfoResponse(
        symbol=canonical,
        company_name=identity.get("company_name"),
        sector=identity.get("sector"),
        industry=identity.get("industry"),
        exchange=identity.get("exchange"),
        quote_type=identity.get("quote_type"),
        snapshot=snapshot_text,
        error=error_msg,
    )

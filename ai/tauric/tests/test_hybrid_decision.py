"""Tests for the TradingAgents -> FabRich hybrid decision integration.

These tests exercise only the integration layer (request handling, direction
mapping, timeout/failure handling, and deterministic rejection). They stub the
graph execution seam ``web.backend.api.hybrid_router.run_graph_sync`` so no LLM
quota or network data is consumed.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from web.backend.main import app
import web.backend.api.hybrid_router as hybrid_router


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def stub_graph(monkeypatch):
    """Replace the graph execution seam with an injector for a canned state.

    Usage:
        _set = stub_graph
        _set(state={"final_trade_decision": ...})   # success
        _set(exc=RuntimeError("boom"))              # simulate AI failure
    """
    holder: dict = {}

    def _set(state: dict | None = None, exc: Exception | None = None) -> None:
        holder.clear()
        holder["state"] = state if state is not None else {}
        holder["exc"] = exc

    def fake(ticker, trade_date, asset_type, request):
        if holder.get("exc") is not None:
            raise holder["exc"]
        return holder.get("state", {})

    monkeypatch.setattr(hybrid_router, "run_graph_sync", fake)
    return _set


def _pm_decision(rating: str, thesis: str = "bullish evidence", extra: str = "") -> str:
    """Render a canonical PortfolioManager markdown block at the given rating."""
    parts = [
        f"**Rating**: {rating}",
        "",
        f"**Executive Summary**: {thesis}",
        "",
        f"**Investment Thesis**: {extra or thesis}",
    ]
    return "\n".join(parts)


def _trader_proposal(
    action: str = "BUY",
    entry: float | None = None,
    stop: float | None = None,
    sizing: str | None = None,
) -> str:
    parts = [f"**Action**: {action}", "", "**Reasoning**: justified by reports"]
    if entry is not None:
        parts += ["", f"**Entry Price**: {entry}"]
    if stop is not None:
        parts += ["", f"**Stop Loss**: {stop}"]
    if sizing is not None:
        parts += ["", f"**Position Sizing**: {sizing}"]
    parts += ["", f"FINAL TRANSACTION PROPOSAL: **{action}**"]
    return "\n".join(parts)


def _state(rating: str = "Buy", trader: str | None = None, entry=None, stop=None, sizing=None, target=None) -> dict:
    pm = _pm_decision(rating)
    if target is not None:
        pm += f"\n\n**Price Target**: {target}"
    return {
        "final_trade_decision": pm,
        "trader_investment_plan": trader if trader is not None else _trader_proposal("BUY", entry, stop, sizing),
    }




def _post(client, payload):
    return client.post("/api/hybrid/decision", json=payload)


# --- Direction mapping tests -------------------------------------------------

@pytest.mark.parametrize("rating", ["Buy", "Overweight"])
def test_long_with_bullish_rating_is_approved(client, stub_graph, rating):
    stub_graph(state=_state(rating))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] == "BUY"
    assert body["rating"] == rating
    assert body["approved"] is True
    assert body["source"] == "TradingAgents"
    assert body["reason"] is None


def test_long_with_bearish_rating_is_rejected(client, stub_graph):
    stub_graph(state=_state("Sell"))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == "Sell"
    assert body["approved"] is False


def test_long_with_hold_is_rejected(client, stub_graph):
    stub_graph(state=_state("Hold"))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == "Hold"
    assert body["action"] == "HOLD"
    assert body["approved"] is False


@pytest.mark.parametrize("rating", ["Sell", "Underweight"])
def test_short_with_bearish_rating_is_approved(client, stub_graph, rating):
    stub_graph(state=_state(rating, trader=_trader_proposal("SELL")))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "short"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == rating
    assert body["approved"] is True


def test_short_with_bullish_rating_is_rejected(client, stub_graph):
    stub_graph(state=_state("Buy"))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "short"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == "Buy"
    assert body["approved"] is False


def test_short_with_hold_is_rejected(client, stub_graph):
    stub_graph(state=_state("Hold"))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "short"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["rating"] == "Hold"
    assert body["approved"] is False


# --- Omitted optional price fields stay null --------------------------------

def test_missing_optional_price_fields_stay_null(client, stub_graph):
    # PM decision with no Price Target; trader proposal with no entry/stop/sizing.
    state = {
        "final_trade_decision": _pm_decision("Buy"),
        "trader_investment_plan": _trader_proposal("BUY"),  # no entry/stop/sizing
    }
    stub_graph(state=state)
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["entry_price"] is None
    assert body["stop_loss"] is None
    assert body["price_target"] is None
    assert body["position_sizing"] is None
    # ...while a bullish long is still approved.
    assert body["approved"] is True


def test_price_levels_extracted_when_present(client, stub_graph):
    state = _state("Buy", entry=195.25, stop=180.0, sizing="5% of portfolio", target=210.5)
    stub_graph(state=state)
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["entry_price"] == 195.25
    assert body["stop_loss"] == 180.0
    assert body["price_target"] == 210.5
    assert body["position_sizing"] == "5% of portfolio"


# --- Failure handling --------------------------------------------------------

def test_ai_failure_returns_rejection(client, stub_graph):
    stub_graph(exc=RuntimeError("provider unavailable"))
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    # A failed AI request must never become an automatic trade approval.
    assert resp.status_code == 200
    body = resp.json()
    assert body["approved"] is False
    assert body["reason"] == "AI_UNAVAILABLE"
    assert body["action"] == "HOLD"
    assert body["rating"] == "Hold"


def test_malformed_output_returns_rejection(client, stub_graph):
    # No recognizable rating header -> surfaces as Hold -> rejected for long.
    state = {
        "final_trade_decision": "Some unstructured output with no rating here.",
        "trader_investment_plan": "**Action**: BUY\n\n**Reasoning**: unclear",
    }
    stub_graph(state=state)
    resp = _post(client, {"ticker": "NVDA", "trade_date": "2024-05-10", "proposed_side": "long"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["approved"] is False
    assert body["rating"] == "Hold"


def test_passthrough_fabrich_fields(client, stub_graph):
    stub_graph(state=_state("Buy"))
    resp = _post(
        client,
        {
            "ticker": "NVDA",
            "trade_date": "2024-05-10",
            "proposed_side": "long",
            "strategy_id": "strat-1",
            "setup_tag": "earnings-beat",
        },
    )
    body = resp.json()
    assert body["fabrich_strategy_id"] == "strat-1"
    assert body["fabrich_setup_tag"] == "earnings-beat"


@pytest.mark.parametrize("bad_date", ["not-a-date", "2024/05/10", ""])
def test_invalid_date_is_deterministic_rejection(client, stub_graph, bad_date):
    # A malformed date must fail fast to a non-approving rejection, never 500.
    stub_graph(state=_state("Buy"))
    resp = _post(
        client,
        {"ticker": "NVDA", "trade_date": bad_date, "proposed_side": "long"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["approved"] is False
    assert body["source"] == "TradingAgents"


def test_fabrich_context_passthrough_in_decision(client, stub_graph):
    sample_context = {
        "strategy": {"id": "tsmom", "win_rate": 0.65, "profit_factor": 2.1},
        "lessons": [{"id": "l1", "title": "BTC lesson", "text": "Caution on funding"}],
        "recent_trades": {"matching_count": 3, "total_pnl": 250},
        "positions": {"open_count": 1, "equity": 1000},
        "world": {"regime": "bull", "risk_posture": "aggressive"},
    }
    stub_graph(state=_state("Buy"))
    resp = _post(
        client,
        {
            "ticker": "BTC-USD",
            "trade_date": "2024-05-10",
            "proposed_side": "long",
            "strategy_id": "tsmom",
            "fabrich_context": sample_context,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["approved"] is True
    assert body["fabrich_context"] is not None
    assert body["fabrich_context"]["strategy"]["id"] == "tsmom"
    assert len(body["fabrich_context"]["lessons"]) == 1


def test_format_fabrich_context_prompt():
    from web.backend.api.hybrid_router import format_fabrich_context_prompt, HybridDecisionRequest

    req = HybridDecisionRequest(
        ticker="BTC-USD",
        trade_date="2024-05-10",
        proposed_side="long",
        strategy_id="tsmom",
        candidate_entry=65000.0,
        candidate_stop=62000.0,
        candidate_target=71000.0,
    )
    ctx = {
        "strategy": {"id": "tsmom", "total_trades": 15, "win_rate": 0.6, "profit_factor": 1.9, "expectancy_r": 0.4},
        "lessons": [{"title": "Watch 4h EMA", "text": "TSMOM false breaks in low vol", "importance": 8}],
        "recent_trades": {"matching_count": 2, "win_rate": 0.5, "total_pnl": 120.0},
        "positions": {"equity": 1000.0, "gross_leverage": 1.2, "leverage_cap": 3.0, "open_count": 1},
        "world": {"regime": "momentum", "risk_posture": "aggressive", "funding_rate": 0.0001},
    }

    formatted = format_fabrich_context_prompt(ctx, req)
    assert "=== FABRICH SYSTEM CONTEXT & HISTORICAL EVIDENCE ===" in formatted
    assert "CURRENT CANDIDATE" in formatted
    assert "FABRICH STRATEGY CONTEXT" in formatted
    assert "FABRICH LESSONS" in formatted
    assert "Watch 4h EMA" in formatted
    assert "RECENT RELEVANT TRADES" in formatted
    assert "CURRENT PORTFOLIO CONTEXT" in formatted
    assert "WORLD / MACRO CONTEXT" in formatted
    assert "TAURIC EXTERNAL RESEARCH & CRITICAL EVALUATION" in formatted
    assert "Do not blindly follow it" in formatted



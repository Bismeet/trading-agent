"""
research/metrics.py
Calculates all analytical, financial, statistical, and attribution metrics
from reconstructed trades and raw data.
"""

import math
from collections import defaultdict

def safe_mean(xs):
    valid = [x for x in xs if x is not None and isinstance(x, (int, float)) and not math.isnan(x)]
    return sum(valid) / len(valid) if valid else 0.0

def safe_stdev(xs):
    valid = [x for x in xs if x is not None and isinstance(x, (int, float)) and not math.isnan(x)]
    if len(valid) < 2:
        return 0.0
    m = sum(valid) / len(valid)
    var = sum((x - m) ** 2 for x in valid) / (len(valid) - 1)
    return math.sqrt(var)

def compute_overall_metrics(trades):
    """
    Computes overall summary metrics across all trades.
    """
    closed = [t for t in trades if t["status"] == "CLOSED"]
    open_forfeited = [t for t in trades if t["status"] != "CLOSED"]

    wins = [t for t in closed if t["net_pnl"] > 0]
    losses = [t for t in closed if t["net_pnl"] <= 0]

    n_closed = len(closed)
    win_rate = (len(wins) / n_closed * 100.0) if n_closed else 0.0

    gross_pnl = sum(t["gross_pnl"] for t in closed if t["gross_pnl"] is not None)
    net_pnl = sum(t["net_pnl"] for t in closed if t["net_pnl"] is not None)
    true_net_pnl = sum(t["true_net_pnl"] for t in closed if t["true_net_pnl"] is not None)

    entry_fees_closed = sum(t["entry_fee"] for t in closed if t["entry_fee"] is not None)
    exit_fees_closed = sum(t["exit_fee"] for t in closed if t["exit_fee"] is not None)
    total_fees_closed = entry_fees_closed + exit_fees_closed

    entry_fees_all = sum(t["entry_fee"] for t in trades if t["entry_fee"] is not None)

    funding_accrued = sum(t["funding_accrued"] for t in closed if t["funding_accrued"] is not None)
    slip_usd = sum(t["total_slippage_spread_usd"] for t in closed if t["total_slippage_spread_usd"] is not None)

    liquidations = sum(1 for t in closed if t["exit_reason"] == "liquidation")

    r_vals = [t["realized_R"] for t in closed if t["realized_R"] is not None]
    expectancy_r = safe_mean(r_vals)
    stdev_r = safe_stdev(r_vals)
    sqn = (math.sqrt(len(r_vals)) * (expectancy_r / stdev_r)) if (len(r_vals) and stdev_r > 0) else 0.0

    pos_r = sum(r for r in r_vals if r > 0)
    neg_r = abs(sum(r for r in r_vals if r < 0))
    profit_factor = (pos_r / neg_r) if neg_r > 0 else (None if pos_r > 0 else 0.0)

    avg_win_usd = safe_mean([t["net_pnl"] for t in wins]) if wins else 0.0
    avg_loss_usd = safe_mean([t["net_pnl"] for t in losses]) if losses else 0.0

    return {
        "total_trades_initiated": len(trades),
        "closed_trades_count": n_closed,
        "open_forfeited_count": len(open_forfeited),
        "wins_count": len(wins),
        "losses_count": len(losses),
        "win_rate_pct": win_rate,
        "gross_pnl_usd": gross_pnl,
        "journaled_net_pnl_usd": net_pnl,
        "true_net_pnl_usd": true_net_pnl,
        "entry_fees_closed_usd": entry_fees_closed,
        "exit_fees_closed_usd": exit_fees_closed,
        "total_fees_closed_usd": total_fees_closed,
        "entry_fees_all_usd": entry_fees_all,
        "funding_accrued_usd": funding_accrued,
        "total_slippage_spread_usd": slip_usd,
        "liquidations_count": liquidations,
        "expectancy_r": expectancy_r,
        "sqn": sqn,
        "profit_factor": profit_factor,
        "avg_win_usd": avg_win_usd,
        "avg_loss_usd": avg_loss_usd,
    }

def compute_strategy_breakdown(trades, all_seed_ids=None):
    """
    Computes performance breakdown per strategy.
    Includes all 6 seed strategies even if trades == 0.
    """
    if all_seed_ids is None:
        all_seed_ids = ["tsmom", "donchian", "rsi2dip", "mom_trend", "orb", "ibreakout"]

    grouped = defaultdict(list)
    for t in trades:
        if t["status"] == "CLOSED":
            grouped[t["strategy_id"]].append(t)

    results = []
    for sid in all_seed_ids:
        t_list = grouped.get(sid, [])
        wins = [t for t in t_list if t["net_pnl"] > 0]
        losses = [t for t in t_list if t["net_pnl"] <= 0]
        n = len(t_list)
        win_rate = (len(wins) / n * 100.0) if n else 0.0
        net_pnl = sum(t["net_pnl"] for t in t_list)
        gross_pnl = sum(t["gross_pnl"] for t in t_list)

        r_vals = [t["realized_R"] for t in t_list if t["realized_R"] is not None]
        expectancy_r = safe_mean(r_vals)
        stdev_r = safe_stdev(r_vals)
        sqn = (math.sqrt(len(r_vals)) * (expectancy_r / stdev_r)) if (len(r_vals) and stdev_r > 0) else 0.0

        pos_r = sum(r for r in r_vals if r > 0)
        neg_r = abs(sum(r for r in r_vals if r < 0))
        pf = (pos_r / neg_r) if neg_r > 0 else (None if pos_r > 0 else 0.0)

        avg_win = safe_mean([t["net_pnl"] for t in wins]) if wins else 0.0
        avg_loss = safe_mean([t["net_pnl"] for t in losses]) if losses else 0.0
        liqs = sum(1 for t in t_list if t["exit_reason"] == "liquidation")

        results.append({
            "strategy_id": sid,
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": win_rate,
            "net_pnl_usd": net_pnl,
            "gross_pnl_usd": gross_pnl,
            "expectancy_r": expectancy_r,
            "profit_factor": pf,
            "avg_win_usd": avg_win,
            "avg_loss_usd": avg_loss,
            "sqn": sqn,
            "liquidation_count": liqs,
        })
    return results

def compute_regime_breakdown(trades):
    """
    Computes performance breakdown by market regime.
    """
    grouped = defaultdict(list)
    for t in trades:
        if t["status"] == "CLOSED":
            grouped[t["regime"]].append(t)

    results = []
    for reg, t_list in grouped.items():
        wins = [t for t in t_list if t["net_pnl"] > 0]
        losses = [t for t in t_list if t["net_pnl"] <= 0]
        n = len(t_list)
        results.append({
            "regime": reg,
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": (len(wins) / n * 100.0) if n else 0.0,
            "net_pnl_usd": sum(t["net_pnl"] for t in t_list),
            "gross_pnl_usd": sum(t["gross_pnl"] for t in t_list),
            "avg_pnl_usd": safe_mean([t["net_pnl"] for t in t_list]),
        })
    return results

def compute_strategy_regime_matrix(trades):
    """
    Computes Strategy x Regime matrix.
    """
    grouped = defaultdict(list)
    for t in trades:
        if t["status"] == "CLOSED":
            grouped[(t["strategy_id"], t["regime"])].append(t)

    results = []
    for (sid, reg), t_list in grouped.items():
        wins = [t for t in t_list if t["net_pnl"] > 0]
        losses = [t for t in t_list if t["net_pnl"] <= 0]
        n = len(t_list)
        results.append({
            "strategy_id": sid,
            "regime": reg,
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": (len(wins) / n * 100.0) if n else 0.0,
            "net_pnl_usd": sum(t["net_pnl"] for t in t_list),
            "avg_pnl_usd": safe_mean([t["net_pnl"] for t in t_list]),
        })
    return results

def compute_symbol_breakdown(trades):
    """
    Computes performance breakdown by symbol.
    """
    grouped = defaultdict(list)
    for t in trades:
        if t["status"] == "CLOSED":
            grouped[t["symbol"]].append(t)

    results = []
    for sym, t_list in grouped.items():
        wins = [t for t in t_list if t["net_pnl"] > 0]
        losses = [t for t in t_list if t["net_pnl"] <= 0]
        n = len(t_list)
        results.append({
            "symbol": sym,
            "market": t_list[0]["market"],
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": (len(wins) / n * 100.0) if n else 0.0,
            "net_pnl_usd": sum(t["net_pnl"] for t in t_list),
            "gross_pnl_usd": sum(t["gross_pnl"] for t in t_list),
            "avg_pnl_usd": safe_mean([t["net_pnl"] for t in t_list]),
            "total_notional_usd": sum(t["notional_entry"] for t in t_list),
            "fees_usd": sum(t["total_fees"] for t in t_list),
            "funding_usd": sum(t["funding_accrued"] for t in t_list),
        })
    return sorted(results, key=lambda x: x["net_pnl_usd"])

def compute_exit_reason_breakdown(trades):
    """
    Computes performance breakdown by exit reason.
    """
    grouped = defaultdict(list)
    for t in trades:
        if t["status"] == "CLOSED":
            grouped[t["exit_reason"]].append(t)

    results = []
    for reason, t_list in grouped.items():
        wins = [t for t in t_list if t["net_pnl"] > 0]
        losses = [t for t in t_list if t["net_pnl"] <= 0]
        n = len(t_list)
        results.append({
            "exit_reason": reason,
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": (len(wins) / n * 100.0) if n else 0.0,
            "net_pnl_usd": sum(t["net_pnl"] for t in t_list),
            "avg_pnl_usd": safe_mean([t["net_pnl"] for t in t_list]),
            "avg_hold_hours": safe_mean([t["hold_hours"] for t in t_list if t["hold_hours"] is not None]),
        })
    return results

def compute_run_performance(episodes, trades):
    """
    Computes episode-level performance by joining episodes.jsonl with reconstructed trades.
    """
    trades_by_ep = defaultdict(list)
    for t in trades:
        ep_id = t["episode_id"]
        trades_by_ep[ep_id].append(t)

    results = []
    for ep in episodes:
        ep_id = ep["episodeId"]
        ep_trades = trades_by_ep.get(ep_id, [])
        closed = [t for t in ep_trades if t["status"] == "CLOSED"]

        fees = sum(t["total_fees"] for t in closed if t["total_fees"] is not None)
        funding = sum(t["funding_accrued"] for t in closed if t["funding_accrued"] is not None)
        liqs = sum(1 for t in closed if t["exit_reason"] == "liquidation")

        # dominant regime
        regimes = [t["regime"] for t in ep_trades if t.get("regime")]
        dom_regime = max(set(regimes), key=regimes.count) if regimes else "unknown"

        # best and worst strategy
        strat_pnl = defaultdict(float)
        for t in closed:
            strat_pnl[t["strategy_id"]] += t["net_pnl"]

        if strat_pnl:
            best_strat = max(strat_pnl.items(), key=lambda x: x[1])[0]
            worst_strat = min(strat_pnl.items(), key=lambda x: x[1])[0]
        else:
            best_strat = "none"
            worst_strat = "none"

        results.append({
            "episode_num": ep["episodeNum"],
            "episode_id": ep_id,
            "duration_hours": ep.get("durationHours", 0.0),
            "starting_capital_usd": ep.get("startingCapital", 100.0),
            "final_equity_usd": ep.get("finalEquity", 0.0),
            "return_pct": ep.get("returnPct", 0.0),
            "max_drawdown_pct": ep.get("maxDrawdownPct", 0.0),
            "trades_count": len(closed),
            "open_forfeited_count": len(ep_trades) - len(closed),
            "fees_usd": fees,
            "funding_usd": funding,
            "liquidations_count": liqs,
            "best_strategy": best_strat,
            "worst_strategy": worst_strat,
            "dominant_regime": dom_regime,
            "end_reason": ep.get("endReason", "unknown"),
            "generation": ep.get("generation", 1),
        })
    return results

def compute_cost_attribution(trades):
    """
    Computes comprehensive cost attribution breakdown across all closed trades.
    """
    closed = [t for t in trades if t["status"] == "CLOSED"]
    gross = sum(t["gross_pnl"] for t in closed if t["gross_pnl"] is not None)
    entry_fees = sum(t["entry_fee"] for t in closed if t["entry_fee"] is not None)
    exit_fees = sum(t["exit_fee"] for t in closed if t["exit_fee"] is not None)
    round_trip_fees = entry_fees + exit_fees
    funding = sum(t["funding_accrued"] for t in closed if t["funding_accrued"] is not None)
    half_spread = sum((t["half_spread_entry_usd"] + (t["half_spread_exit_usd"] or 0.0)) for t in closed)
    slip_impact = sum((t["slip_entry_usd"] + (t["slip_exit_usd"] or 0.0)) for t in closed)
    total_execution_friction = half_spread + slip_impact
    net_pnl = sum(t["net_pnl"] for t in closed if t["net_pnl"] is not None)
    true_net_pnl = sum(t["true_net_pnl"] for t in closed if t["true_net_pnl"] is not None)

    return [
        {"cost_component": "Gross Price Return P&L", "amount_usd": gross, "pct_of_gross": 100.0, "notes": "Price change from entry fill to exit fill"},
        {"cost_component": "Entry Taker Fees (5 bps)", "amount_usd": -entry_fees, "pct_of_gross": (-entry_fees / gross * 100.0) if gross else 0.0, "notes": "Deducted from wallet on fill (omitted from journal net_pnl)"},
        {"cost_component": "Exit Taker Fees (5 bps)", "amount_usd": -exit_fees, "pct_of_gross": (-exit_fees / gross * 100.0) if gross else 0.0, "notes": "Deducted at closePosition"},
        {"cost_component": "Total Exchange Taker Fees", "amount_usd": -round_trip_fees, "pct_of_gross": (-round_trip_fees / gross * 100.0) if gross else 0.0, "notes": "10 bps total round-trip taker fees"},
        {"cost_component": "Modeled Half-Spread Friction", "amount_usd": -half_spread, "pct_of_gross": (-half_spread / gross * 100.0) if gross else 0.0, "notes": "Built into adverse fill price (5 bps entry + 5 bps exit)"},
        {"cost_component": "Modeled Market Impact Slippage", "amount_usd": -slip_impact, "pct_of_gross": (-slip_impact / gross * 100.0) if gross else 0.0, "notes": "Square-root impact model (D=$2M depth)"},
        {"cost_component": "Total Execution Friction (Spread + Impact)", "amount_usd": -total_execution_friction, "pct_of_gross": (-total_execution_friction / gross * 100.0) if gross else 0.0, "notes": "Shift in executed price vs unperturbed mark"},
        {"cost_component": "Funding Carry Cost", "amount_usd": funding, "pct_of_gross": (funding / gross * 100.0) if gross else 0.0, "notes": "8h UTC funding payments across holding period"},
        {"cost_component": "Journaled Net Realized Outcome", "amount_usd": net_pnl, "pct_of_gross": (net_pnl / gross * 100.0) if gross else 0.0, "notes": "gross - exit_fee + funding (engine ledger calculation)"},
        {"cost_component": "True Full Net Outcome", "amount_usd": true_net_pnl, "pct_of_gross": (true_net_pnl / gross * 100.0) if gross else 0.0, "notes": "gross - entry_fee - exit_fee + funding"},
    ]

def compute_concurrency_and_correlation(trades):
    """
    Analyzes simultaneous positions, correlated cluster exposure, and portfolio concentration.
    """
    # Group open times by minute
    open_batches = defaultdict(list)
    for t in trades:
        ts_min = t["entry_ts"] // 60000
        open_batches[ts_min].append(t)

    batch_summaries = []
    for ts_min, t_list in sorted(open_batches.items()):
        total_margin = sum(t["margin_usd"] for t in t_list)
        total_notional = sum(t["notional_entry"] for t in t_list)
        symbols = [t["symbol"] for t in t_list]
        sides = [t["side"] for t in t_list]
        batch_summaries.append({
            "timestamp_utc": t_list[0]["entry_time_utc"],
            "episode_id": t_list[0]["episode_id"],
            "positions_opened": len(t_list),
            "symbols": ", ".join(symbols),
            "all_same_side": len(set(sides)) == 1,
            "side": sides[0] if len(set(sides)) == 1 else "mixed",
            "total_margin_usd": total_margin,
            "total_notional_usd": total_notional,
            "effective_portfolio_leverage": total_notional / 100.0,  # relative to $100 starting capital
        })

    return {
        "total_entry_batches": len(batch_summaries),
        "avg_positions_per_batch": safe_mean([b["positions_opened"] for b in batch_summaries]),
        "max_simultaneous_open": max((b["positions_opened"] for b in batch_summaries), default=0),
        "correlated_crypto_batches": sum(1 for b in batch_summaries if b["positions_opened"] >= 4 and b["all_same_side"]),
        "batch_details": batch_summaries,
    }

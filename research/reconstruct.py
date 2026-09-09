"""
research/reconstruct.py
Reconstructs every trade from FabRich flat-file logs (journal.v2.jsonl, trades.v2.jsonl, etc.)
strictly without modifying any production data.
"""

import json
import math
import os
from datetime import datetime, timezone

def iso_format(ts):
    if not ts:
        return "UNKNOWN"
    return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def load_jsonl(file_path):
    if not os.path.exists(file_path):
        return []
    rows = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except Exception:
                    pass
    return rows

def load_json(file_path, fallback=None):
    if not os.path.exists(file_path):
        return fallback
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return fallback

def reconstruct_trades(data_dir="data", config_path="config.json"):
    """
    Reconstructs all completed and open trades by joining journal.v2.jsonl,
    trades.v2.jsonl, episodes.jsonl, and agents.v2.jsonl.
    """
    journal_rows = load_jsonl(os.path.join(data_dir, "journal.v2.jsonl"))
    trade_rows = load_jsonl(os.path.join(data_dir, "trades.v2.jsonl"))
    episodes = load_jsonl(os.path.join(data_dir, "episodes.jsonl"))
    agent_batches = load_jsonl(os.path.join(data_dir, "agents.v2.jsonl"))
    cfg = load_json(config_path, {})

    pre_by_id = {r["trade_id"]: r for r in journal_rows if r.get("kind") == "pre"}
    post_by_id = {r["trade_id"]: r for r in journal_rows if r.get("kind") == "post"}

    open_by_id = {t["trade_id"]: t for t in trade_rows if t.get("op") == "open"}
    close_by_id = {t["trade_id"]: t for t in trade_rows if t.get("op") == "close"}

    # Map agent decisions by matching timestamp, symbol, and episodeId
    council_by_trade = {}
    for batch in agent_batches:
        b_ts = batch.get("ts", 0)
        b_ep = batch.get("episodeId", "")
        for d in batch.get("decisions", []):
            sym = d.get("symbol")
            # find corresponding pre trade
            for tid, pre in pre_by_id.items():
                op = open_by_id.get(tid)
                if pre.get("symbol") == sym and op and op.get("episodeId") == b_ep:
                    if abs(pre.get("ts", 0) - b_ts) < 120000:
                        council_by_trade[tid] = d

    taker_rate = cfg.get("v2", {}).get("perpFees", {}).get("taker", 0.0005)
    slippage_cfg = cfg.get("slippage", {"crypto": 0.0010, "us": 0.0005, "india": 0.0005})

    reconstructed = []

    for tid, pre in pre_by_id.items():
        post = post_by_id.get(tid)
        op = open_by_id.get(tid)
        cl = close_by_id.get(tid)

        symbol = pre.get("symbol", "UNKNOWN")
        market = pre.get("market", "crypto")
        strategy_id = pre.get("strategy_id", "unknown")
        setup_tag = pre.get("setup_tag", "unknown")
        side = pre.get("side", "long")
        side_sign = 1 if side == "long" else -1
        leverage = pre.get("leverage", 1)
        margin = pre.get("margin", 0.0)
        entry_price = pre.get("entry", 0.0)
        entry_ts = pre.get("ts", 0)

        notional_entry = margin * leverage
        qty = notional_entry / entry_price if entry_price > 0 else 0.0
        entry_fee = notional_entry * taker_rate

        episode_id = op.get("episodeId") if op else (pre.get("episodeId") or "UNKNOWN")
        ep_num = "UNKNOWN"
        for e in episodes:
            if e.get("episodeId") == episode_id:
                ep_num = e.get("episodeNum")
                break
        if ep_num == "UNKNOWN" and "ep_" in str(episode_id):
            try:
                ep_num = int(str(episode_id).split("_")[-1])
            except Exception:
                pass

        # Slippage and half-spread modeling
        spread_val = slippage_cfg.get(market, 0.0010)
        half_spread_pct = spread_val / 2.0
        slip_entry_frac = 0.6 * max(0.0005, spread_val) * math.sqrt(max(0, notional_entry) / 2000000.0)
        slip_entry_usd = notional_entry * slip_entry_frac
        half_spread_entry_usd = notional_entry * half_spread_pct

        if post:
            exit_ts = post.get("ts_close", 0)
            exit_price = cl.get("price") if cl else post.get("price")
            net_pnl = post.get("net_pnl", 0.0)
            realized_R = post.get("realized_R", 0.0)
            roi_on_margin = post.get("roi_on_margin", 0.0)
            exit_reason = post.get("exit_reason", "unknown")
            hold_secs = post.get("hold_secs", 0.0)

            # Reconstruct gross PnL from fill prices
            if exit_price is not None:
                gross_pnl = (exit_price - entry_price) * qty * side_sign
            else:
                gross_pnl = net_pnl

            # Solve for exit mark and exit slippage
            mark = exit_price if exit_price else entry_price
            for _ in range(5):
                notional_close = qty * mark
                slip_exit_frac = 0.6 * max(0.0005, spread_val) * math.sqrt(max(0, notional_close) / 2000000.0)
                mark = exit_price / (1.0 - (half_spread_pct + slip_exit_frac)) if (1.0 - (half_spread_pct + slip_exit_frac)) > 0 else exit_price

            close_notional = qty * mark
            exit_fee = close_notional * taker_rate
            slip_exit_frac = 0.6 * max(0.0005, spread_val) * math.sqrt(max(0, close_notional) / 2000000.0)
            slip_exit_usd = close_notional * slip_exit_frac
            half_spread_exit_usd = close_notional * half_spread_pct

            funding_accrued = net_pnl - gross_pnl + exit_fee
            total_fees = entry_fee + exit_fee
            true_net_pnl = gross_pnl - total_fees + funding_accrued
            is_closed = True
        else:
            exit_ts = None
            exit_price = None
            gross_pnl = None
            net_pnl = None
            true_net_pnl = None
            realized_R = None
            roi_on_margin = None
            exit_reason = "FORFEITED_ON_MANUAL_RESTART"
            hold_secs = None
            exit_fee = None
            funding_accrued = None
            slip_exit_usd = None
            half_spread_exit_usd = None
            total_fees = entry_fee
            is_closed = False

        council = council_by_trade.get(tid)
        if council:
            council_decision = "APPROVED" if council.get("approved") else "VETOED"
            analyst_vote = "UNKNOWN"
            risk_vote = "UNKNOWN"
            investor_vote = "UNKNOWN"
            analyst_reasons = []
            risk_reasons = []
            investor_reasons = []
            for v in council.get("verdicts", []):
                agent_name = v.get("agent")
                vote_val = v.get("vote", "UNKNOWN")
                reasons = v.get("reasons", [])
                if agent_name == "analyst":
                    analyst_vote = vote_val
                    analyst_reasons = reasons
                elif agent_name == "risk":
                    risk_vote = vote_val
                    risk_reasons = reasons
                elif agent_name == "investor":
                    investor_vote = vote_val
                    investor_reasons = reasons
        else:
            council_decision = "NOT_RECORDED"
            analyst_vote = "NOT_RECORDED"
            risk_vote = "NOT_RECORDED"
            investor_vote = "NOT_RECORDED"
            analyst_reasons = []
            risk_reasons = []
            investor_reasons = []

        reconstructed.append({
            "trade_id": tid,
            "episode_num": ep_num,
            "episode_id": episode_id,
            "symbol": symbol,
            "market": market,
            "strategy_id": strategy_id,
            "setup_tag": setup_tag,
            "side": side,
            "leverage": leverage,
            "margin_usd": margin,
            "notional_entry": notional_entry,
            "qty": qty,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "entry_ts": entry_ts,
            "entry_time_utc": iso_format(entry_ts),
            "exit_ts": exit_ts,
            "exit_time_utc": iso_format(exit_ts) if exit_ts else "OPEN",
            "gross_pnl": gross_pnl,
            "entry_fee": entry_fee,
            "exit_fee": exit_fee,
            "total_fees": total_fees,
            "funding_accrued": funding_accrued,
            "slip_entry_usd": slip_entry_usd,
            "slip_exit_usd": slip_exit_usd,
            "half_spread_entry_usd": half_spread_entry_usd,
            "half_spread_exit_usd": half_spread_exit_usd,
            "total_slippage_spread_usd": (slip_entry_usd + half_spread_entry_usd + (slip_exit_usd or 0.0) + (half_spread_exit_usd or 0.0)),
            "net_pnl": net_pnl,
            "true_net_pnl": true_net_pnl,
            "realized_R": realized_R,
            "roi_on_margin": roi_on_margin,
            "hold_secs": hold_secs,
            "hold_hours": (hold_secs / 3600.0) if hold_secs else None,
            "exit_reason": exit_reason,
            "regime": pre.get("regime", "unknown"),
            "status": "CLOSED" if is_closed else "OPEN_FORFEITED",
            "council_decision": council_decision,
            "analyst_vote": analyst_vote,
            "risk_vote": risk_vote,
            "investor_vote": investor_vote,
            "analyst_reasons": "; ".join(analyst_reasons) if analyst_reasons else "NONE",
            "risk_reasons": "; ".join(risk_reasons) if risk_reasons else "NONE",
            "investor_reasons": "; ".join(investor_reasons) if investor_reasons else "NONE",
        })

    return reconstructed

if __name__ == "__main__":
    trades = reconstruct_trades()
    print(f"Reconstructed {len(trades)} trades.")

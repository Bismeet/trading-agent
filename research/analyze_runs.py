"""
research/analyze_runs.py
Main entry point for the FabRich evaluation harness.
Loads existing production data in read-only mode, reconstructs trades,
computes metrics, writes results to research/results/, and displays findings.
"""

import os
import sys
from reconstruct import reconstruct_trades, load_jsonl
from metrics import (
    compute_overall_metrics,
    compute_strategy_breakdown,
    compute_regime_breakdown,
    compute_strategy_regime_matrix,
    compute_symbol_breakdown,
    compute_exit_reason_breakdown,
    compute_run_performance,
    compute_cost_attribution,
    compute_concurrency_and_correlation,
)
from report import export_csv, export_json, generate_svg_chart, generate_drawdown_chart

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(root_dir, "data")
    config_path = os.path.join(root_dir, "config.json")
    results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")

    print(f"[*] FabRich Baseline Evaluation Harness")
    print(f"[*] Reading data from: {data_dir} (READ-ONLY)")
    print(f"[*] Output directory: {results_dir}\n")

    # Step 1 & 2: Reconstruct trades
    trades = reconstruct_trades(data_dir=data_dir, config_path=config_path)
    episodes = load_jsonl(os.path.join(data_dir, "episodes.jsonl"))
    equity_points = load_jsonl(os.path.join(data_dir, "equity.v2.jsonl"))

    # Step 3 to 7: Compute metrics
    overall = compute_overall_metrics(trades)
    strategy_perf = compute_strategy_breakdown(trades)
    regime_perf = compute_regime_breakdown(trades)
    strat_reg_matrix = compute_strategy_regime_matrix(trades)
    symbol_perf = compute_symbol_breakdown(trades)
    exit_perf = compute_exit_reason_breakdown(trades)
    run_perf = compute_run_performance(episodes, trades)
    cost_breakdown = compute_cost_attribution(trades)
    concurrency = compute_concurrency_and_correlation(trades)

    # Step 8: Export results
    export_csv(os.path.join(results_dir, "trades.csv"), trades)
    export_csv(os.path.join(results_dir, "strategy_performance.csv"), strategy_perf)
    export_csv(os.path.join(results_dir, "regime_performance.csv"), regime_perf)
    export_csv(os.path.join(results_dir, "run_performance.csv"), run_perf)
    export_csv(os.path.join(results_dir, "cost_breakdown.csv"), cost_breakdown)

    baseline_report = {
        "overall_metrics": overall,
        "strategy_performance": strategy_perf,
        "regime_performance": regime_perf,
        "strategy_regime_matrix": strat_reg_matrix,
        "symbol_performance": symbol_perf,
        "exit_reason_performance": exit_perf,
        "run_performance": run_perf,
        "cost_attribution": cost_breakdown,
        "concurrency_and_correlation": concurrency,
        "reconstructed_trades_count": len(trades),
    }
    export_json(os.path.join(results_dir, "baseline_report.json"), baseline_report)

    # Charts
    generate_svg_chart(equity_points, os.path.join(results_dir, "equity_curve.svg"))
    generate_drawdown_chart(equity_points, os.path.join(results_dir, "drawdown.svg"))

    # Display Console Summary
    print("=" * 80)
    print("FABRICH BASELINE EVALUATION SUMMARY")
    print("=" * 80)
    print(f"Total Trades Initiated:   {overall['total_trades_initiated']}")
    print(f"Completed Closed Trades:  {overall['closed_trades_count']}")
    print(f"Forfeited / Open Trades:  {overall['open_forfeited_count']} (Episode 1 manual restart)")
    print(f"Wins / Losses:            {overall['wins_count']} wins / {overall['losses_count']} losses (Win Rate: {overall['win_rate_pct']:.2f}%)")
    print(f"Gross P&L (executed):     ${overall['gross_pnl_usd']:.4f} USD")
    print(f"Total Fees Paid:          ${overall['total_fees_closed_usd']:.4f} USD (Entry: ${overall['entry_fees_closed_usd']:.4f}, Exit: ${overall['exit_fees_closed_usd']:.4f})")
    print(f"Funding Carry Accrued:    ${overall['funding_accrued_usd']:.6f} USD")
    print(f"Execution Drag (Slip):    ${overall['total_slippage_spread_usd']:.4f} USD")
    print(f"Journaled Net P&L:        ${overall['journaled_net_pnl_usd']:.4f} USD")
    print(f"True Full Net P&L:        ${overall['true_net_pnl_usd']:.4f} USD (including entry fees)")
    print(f"Liquidations Count:       {overall['liquidations_count']}")
    print(f"Expectancy R:             {overall['expectancy_r']:.4f} R")
    print(f"Profit Factor:            {overall['profit_factor'] if overall['profit_factor'] is not None else 'N/A'}")
    print(f"System Quality (SQN):     {overall['sqn']:.2f}")

    print("\n" + "=" * 80)
    print("EPISODE RUN PERFORMANCE (1h, 2h sequence, and 24h tests)")
    print("=" * 80)
    print(f"{'Run':<5} {'Duration':<10} {'Start':<8} {'End Eq':<10} {'Return %':<10} {'Max DD %':<10} {'Trades':<8} {'Fees':<8} {'Reason':<15}")
    print("-" * 80)
    for r in run_perf:
        print(f"Ep {r['episode_num']:<2} {r['duration_hours']:<10.2f} ${r['starting_capital_usd']:<7.2f} ${r['final_equity_usd']:<9.4f} {r['return_pct']:<9.2f}% {r['max_drawdown_pct']:<9.2f}% {r['trades_count']:<8} ${r['fees_usd']:<7.4f} {r['end_reason']:<15}")

    print("\n" + "=" * 80)
    print("STRATEGY PERFORMANCE BREAKDOWN")
    print("=" * 80)
    print(f"{'Strategy':<12} {'Trades':<8} {'Wins':<6} {'Losses':<8} {'Win Rate':<10} {'Net PnL ($)':<12} {'Exp R':<10} {'PF':<8}")
    print("-" * 80)
    for s in strategy_perf:
        pf_str = f"{s['profit_factor']:.3f}" if s['profit_factor'] is not None else "N/A"
        print(f"{s['strategy_id']:<12} {s['trades']:<8} {s['wins']:<6} {s['losses']:<8} {s['win_rate_pct']:<9.1f}% ${s['net_pnl_usd']:<11.4f} {s['expectancy_r']:<9.4f} {pf_str:<8}")

    print("\n" + "=" * 80)
    print("PORTFOLIO CORRELATION & CONCURRENCY")
    print("=" * 80)
    print(f"Total simultaneous entry batches: {concurrency['total_entry_batches']}")
    print(f"Average positions per batch:      {concurrency['avg_positions_per_batch']:.1f}")
    print(f"Correlated crypto batches (>=4):  {concurrency['correlated_crypto_batches']} / {concurrency['total_entry_batches']}")
    for b in concurrency['batch_details']:
        print(f"  {b['timestamp_utc']} | {b['positions_opened']} assets ({b['side']}) | {b['symbols']} | Total Margin: ${b['total_margin_usd']:.2f} | Leverage: {b['effective_portfolio_leverage']:.2f}x")

    print("\n[+] Analysis complete. CSVs, JSON, and SVG charts written to:")
    print(f"    {results_dir}")

if __name__ == "__main__":
    main()

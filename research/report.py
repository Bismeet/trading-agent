"""
research/report.py
Generates CSVs, JSON report, and SVG visualizations for the research harness.
Strictly non-invasive and read-only against existing data.
"""

import csv
import json
import math
import os
from datetime import datetime, timezone

def ensure_dir(d):
    os.makedirs(d, exist_ok=True)

def export_csv(filepath, rows, fieldnames=None):
    if not rows:
        return
    ensure_dir(os.path.dirname(filepath))
    if fieldnames is None:
        fieldnames = list(rows[0].keys())
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            # Clean values
            cleaned = {}
            for k in fieldnames:
                v = r.get(k)
                if isinstance(v, float):
                    cleaned[k] = f"{v:.6f}".rstrip("0").rstrip(".") if "." in f"{v:.6f}" else f"{v:.2f}"
                elif v is None:
                    cleaned[k] = ""
                else:
                    cleaned[k] = str(v)
            writer.writerow(cleaned)

def export_json(filepath, data):
    ensure_dir(os.path.dirname(filepath))
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def generate_svg_chart(equity_points, filepath="research/results/equity_curve.svg"):
    """
    Generates a clean vector SVG showing the equity curve across all cycles and episodes.
    """
    if not equity_points:
        return
    ensure_dir(os.path.dirname(filepath))

    eqs = [p.get("equity", 100.0) for p in equity_points]
    min_eq = min(eqs)
    max_eq = max(eqs)

    # Margins & dimensions
    w, h = 900, 420
    pad_l, pad_r, pad_t, pad_b = 70, 40, 50, 60
    plot_w = w - pad_l - pad_r
    plot_h = h - pad_t - pad_b

    # Y-scale padding
    y_min = math.floor((min_eq - 0.2) * 2) / 2.0
    y_max = math.ceil((max_eq + 0.2) * 2) / 2.0
    if y_max <= y_min:
        y_max = y_min + 1.0

    def get_x(i):
        return pad_l + (i / (len(eqs) - 1)) * plot_w if len(eqs) > 1 else pad_l

    def get_y(val):
        return pad_t + plot_h - ((val - y_min) / (y_max - y_min)) * plot_h

    # Path points
    pts = [f"{get_x(i):.1f},{get_y(v):.1f}" for i, v in enumerate(eqs)]
    polyline_d = " ".join(pts)

    # Area path
    area_d = f"{get_x(0):.1f},{pad_t + plot_h:.1f} " + polyline_d + f" {get_x(len(eqs)-1):.1f},{pad_t + plot_h:.1f}"

    # Draw gridlines & labels
    y_ticks = 6
    grid_lines = []
    for i in range(y_ticks + 1):
        y_val = y_min + (i / y_ticks) * (y_max - y_min)
        y_pos = get_y(y_val)
        grid_lines.append(f'<line x1="{pad_l}" y1="{y_pos:.1f}" x2="{w - pad_r}" y2="{y_pos:.1f}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4,4"/>')
        grid_lines.append(f'<text x="{pad_l - 10}" y="{y_pos + 4:.1f}" fill="#64748b" font-family="sans-serif" font-size="11" text-anchor="end">${y_val:.2f}</text>')

    # Detect episode boundaries
    ep_markers = []
    cur_ep = None
    for i, p in enumerate(equity_points):
        ep_num = p.get("episodeNum")
        if ep_num != cur_ep:
            cur_ep = ep_num
            x_pos = get_x(i)
            ep_markers.append(f'<line x1="{x_pos:.1f}" y1="{pad_t}" x2="{x_pos:.1f}" y2="{pad_t + plot_h}" stroke="#cbd5e1" stroke-width="1.5"/>')
            ep_markers.append(f'<text x="{x_pos + 4:.1f}" y="{pad_t + 16}" fill="#475569" font-family="sans-serif" font-weight="bold" font-size="11">Run {ep_num}</text>')

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="100%" height="100%">
  <rect width="{w}" height="{h}" fill="#ffffff" rx="8"/>
  <text x="{pad_l}" y="30" fill="#0f172a" font-family="sans-serif" font-size="16" font-weight="bold">FabRich Portfolio Equity Curve (Cycles 1 - {len(eqs)})</text>
  <text x="{pad_l}" y="45" fill="#64748b" font-family="sans-serif" font-size="11">Simulated $100 starting collateral across 1h, 2h, and 24h runs</text>
  
  <!-- Grid -->
  {''.join(grid_lines)}
  
  <!-- Episode Boundaries -->
  {''.join(ep_markers)}
  
  <!-- Area fill -->
  <polygon points="{area_d}" fill="url(#grad)" opacity="0.15"/>
  
  <!-- Line -->
  <polyline points="{polyline_d}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round"/>
  
  <!-- Axes -->
  <line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{w - pad_r}" y2="{pad_t + plot_h}" stroke="#94a3b8" stroke-width="1.5"/>
  <line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" stroke="#94a3b8" stroke-width="1.5"/>
  
  <text x="{w / 2}" y="{h - 15}" fill="#64748b" font-family="sans-serif" font-size="12" text-anchor="middle">Execution Cycle Index (30s Cadence)</text>
  
  <!-- Gradient -->
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
</svg>"""

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(svg_content)

def generate_drawdown_chart(equity_points, filepath="research/results/drawdown.svg"):
    """
    Generates an underwater drawdown chart across all cycles.
    """
    if not equity_points:
        return
    ensure_dir(os.path.dirname(filepath))

    eqs = [p.get("equity", 100.0) for p in equity_points]
    peak = eqs[0]
    dds = []
    for val in eqs:
        if val > peak:
            peak = val
        dd = (peak - val) / peak * 100.0 if peak > 0 else 0.0
        dds.append(-dd)

    w, h = 900, 300
    pad_l, pad_r, pad_t, pad_b = 70, 40, 40, 50
    plot_w = w - pad_l - pad_r
    plot_h = h - pad_t - pad_b

    min_dd = min(dds) if dds else 0.0
    y_min = math.floor(min_dd - 0.2)
    y_max = 0.0

    def get_x(i):
        return pad_l + (i / (len(dds) - 1)) * plot_w if len(dds) > 1 else pad_l

    def get_y(val):
        return pad_t + ((val - y_max) / (y_min - y_max)) * plot_h if (y_min - y_max) != 0 else pad_t

    pts = [f"{get_x(i):.1f},{get_y(v):.1f}" for i, v in enumerate(dds)]
    polyline_d = " ".join(pts)
    area_d = f"{get_x(0):.1f},{get_y(0.0):.1f} " + polyline_d + f" {get_x(len(dds)-1):.1f},{get_y(0.0):.1f}"

    grid_lines = []
    for step in range(5):
        y_val = (step / 4.0) * y_min
        y_pos = get_y(y_val)
        grid_lines.append(f'<line x1="{pad_l}" y1="{y_pos:.1f}" x2="{w - pad_r}" y2="{y_pos:.1f}" stroke="#fee2e2" stroke-width="1" stroke-dasharray="4,4"/>')
        grid_lines.append(f'<text x="{pad_l - 10}" y="{y_pos + 4:.1f}" fill="#991b1b" font-family="sans-serif" font-size="11" text-anchor="end">{y_val:.1f}%</text>')

    svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="100%" height="100%">
  <rect width="{w}" height="{h}" fill="#ffffff" rx="8"/>
  <text x="{pad_l}" y="25" fill="#991b1b" font-family="sans-serif" font-size="14" font-weight="bold">Underwater Drawdown Profile (%)</text>
  
  {''.join(grid_lines)}
  <polygon points="{area_d}" fill="#ef4444" opacity="0.25"/>
  <polyline points="{polyline_d}" fill="none" stroke="#dc2626" stroke-width="2"/>
  <line x1="{pad_l}" y1="{get_y(0.0):.1f}" x2="{w - pad_r}" y2="{get_y(0.0):.1f}" stroke="#64748b" stroke-width="1.5"/>
  <text x="{w / 2}" y="{h - 10}" fill="#64748b" font-family="sans-serif" font-size="11" text-anchor="middle">Cycles</text>
</svg>"""

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(svg_content)

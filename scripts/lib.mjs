// scripts/lib.mjs — P2 shared toolbox. Built-in Node only, no third-party deps.
// Conventions where the source is silent are marked [DECISION] and follow the
// RECOMMENDED conventions in docs/08 (Wilder RSI, percent momentum, literal retN index).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// FAB_DATA lets tests/isolated runs point at a different data directory.
export const DATA = process.env.FAB_DATA ? path.resolve(process.env.FAB_DATA) : path.join(ROOT, "data");

export const PATHS = {
  config: path.join(ROOT, "config.json"),
  state: path.join(DATA, "state.json"),
  signals: path.join(DATA, "signals.json"),
  prices: path.join(DATA, "prices.json"),
  trades: path.join(DATA, "trades.jsonl"),
  equity: path.join(DATA, "equity.jsonl"),
  journal: path.join(DATA, "journal.jsonl"),
  playbook: path.join(DATA, "playbook.json"),
  log: path.join(DATA, "engine.log"),
};

export function ensureData() {
  fs.mkdirSync(DATA, { recursive: true });
}

export function readJSON(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJSON(p, obj) {
  ensureData();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p); // atomic per-file publish
}

export function appendJSONL(p, rec) {
  ensureData();
  fs.appendFileSync(p, JSON.stringify(rec) + "\n");
}

export function readJSONL(p, limit = 0) {
  let rows = [];
  try {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { /* skip truncated/corrupt tail lines */ }
    }
  } catch { /* missing file -> empty */ }
  if (limit > 0 && rows.length > limit) rows = rows.slice(rows.length - limit);
  return rows;
}

export function log(msg) {
  const line = `${iso(now())} ${msg}`;
  console.log(line);
  try { ensureData(); fs.appendFileSync(PATHS.log, line + "\n"); } catch { /* non-fatal */ }
}

export function loadConfig() {
  const cfg = readJSON(PATHS.config, null);
  if (!cfg) throw new Error(`config.json missing or unreadable at ${PATHS.config}`);
  return cfg;
}

export const now = () => Date.now();
export const iso = (ts = now()) => new Date(ts).toISOString();

// ---- Network helpers: desktop UA, 12s AbortController timeout (P2/P7) ----
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url) {
  const res = await fetchWithTimeout(url);
  return res.json();
}

export async function getText(url) {
  const res = await fetchWithTimeout(url);
  return res.text();
}

// POST helper: [DECISION] completes transport for Hyperliquid per docs/13 gap note.
export async function postJSON(url, body) {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export const YH = (sym, range = "6mo", interval = "1d") =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;

// P2: Yahoo quote, Coinbase spot fallback for *-USD crypto symbols only on failure.
export async function fetchQuote(symbol) {
  try {
    const j = await getJSON(YH(symbol, "1d", "1m"));
    const meta = j?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (!Number.isFinite(price) || price <= 0) throw new Error("no price");
    const prevClose = Number.isFinite(meta?.chartPreviousClose) ? meta.chartPreviousClose
      : (Number.isFinite(meta?.previousClose) ? meta.previousClose : null);
    return {
      symbol,
      price,
      prevClose: prevClose ?? null,
      changePct: Number.isFinite(prevClose) && prevClose > 0 ? (price / prevClose - 1) * 100 : null,
      marketState: meta?.marketState ?? null,
      currency: meta?.currency ?? null,
      sessionStart: Number.isFinite(meta?.currentTradingPeriod?.regular?.start)
        ? meta.currentTradingPeriod.regular.start * 1000 : null,
      ok: true,
    };
  } catch {
    if (symbol.endsWith("-USD")) {
      try {
        const pair = symbol.replace("-USD", "");
        const j = await getJSON(`https://api.coinbase.com/v2/prices/${pair}-USD/spot`);
        const price = parseFloat(j?.data?.amount);
        if (Number.isFinite(price) && price > 0) {
          return { symbol, price, prevClose: null, changePct: null, marketState: null, currency: "USD", sessionStart: null, ok: true, fallback: "coinbase" };
        }
      } catch { /* fall through */ }
    }
    return { symbol, ok: false };
  }
}

// P2: numeric close array, daily by default; engine overrides range/interval.
export async function fetchHistory(symbol, range = "6mo", interval = "1d") {
  const j = await getJSON(YH(symbol, range, interval));
  const closes = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error(`no history for ${symbol}`);
  return closes.filter((c) => Number.isFinite(c) && c > 0);
}

// P2: INR per USD, literal source fallback 83.0 (documented deviation risk in docs/13).
export async function fetchFx() {
  try {
    const q = await fetchQuote("USDINR=X");
    if (q.ok && Number.isFinite(q.price) && q.price > 0) return { rate: q.price, live: true };
  } catch { /* fall through */ }
  return { rate: 83.0, live: false, note: "source fallback 83.0 (not a live observation)" };
}

// ---- Indicators (docs/08 conventions) ----
export function sma(arr, n) {
  if (!Array.isArray(arr) || arr.length < n) return null;
  const win = arr.slice(arr.length - n);
  if (win.some((v) => !Number.isFinite(v))) return null;
  return win.reduce((a, b) => a + b, 0) / n;
}

// [DECISION D03] Wilder RSI; flat series = 50, gain-only = 100, loss-only = 0; insufficient -> null.
export function rsi(closes, n = 14) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss += -d;
  }
  let avgG = gain / n, avgL = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (n - 1) + Math.max(d, 0)) / n;
    avgL = (avgL * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgG / avgL);
}

// [DECISION D03] momentum in percent: 100*(c_t/c_(t-n) - 1)
export function momentum(closes, n = 10) {
  if (!Array.isArray(closes) || closes.length < n + 1) return null;
  const prev = closes[closes.length - 1 - n];
  if (!Number.isFinite(prev) || prev <= 0) return null;
  return (closes[closes.length - 1] / prev - 1) * 100;
}

// [DECISION D03] trend: price>SMA20>SMA50 up, price<SMA20<SMA50 down, else flat.
export function indicators(closes) {
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const price = Array.isArray(closes) && closes.length ? closes[closes.length - 1] : null;
  let trend = "flat";
  if (Number.isFinite(price) && sma20 != null && sma50 != null) {
    if (price > sma20 && sma20 > sma50) trend = "up";
    else if (price < sma20 && sma20 < sma50) trend = "down";
  }
  const bias = trend === "up" ? "bullish" : trend === "down" ? "bearish" : "neutral";
  return { sma20, sma50, rsi: rsi(closes, 14), mom: momentum(closes, 10), trend, bias };
}

export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

// ---- Statistics (docs/08) ----
export function mean(xs) {
  const a = (xs || []).filter(Number.isFinite);
  if (!a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

// sample stdev (n-1 denominator)
export function stdev(xs) {
  const a = (xs || []).filter(Number.isFinite);
  if (a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}

export function wilsonLB(wins, n, z = 1.96) {
  if (!Number.isFinite(n) || n <= 0 || wins < 0 || wins > n) return null;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (center - spread) / denom;
}

export function sqnOf(rs) {
  const a = (rs || []).filter(Number.isFinite);
  const s = stdev(a);
  const m = mean(a);
  if (!a.length || s == null || s === 0 || m == null) return 0;
  return Math.sqrt(a.length) * (m / s);
}

export function profitFactor(rs) {
  const a = (rs || []).filter(Number.isFinite);
  const wins = a.filter((r) => r > 0).reduce((x, y) => x + y, 0);
  const losses = Math.abs(a.filter((r) => r < 0).reduce((x, y) => x + y, 0));
  if (losses === 0) return wins > 0 ? null : 0; // [DECISION] null = unavailable, never Infinity in JSON
  return wins / losses;
}

// exact output keys per docs/08
export function expectancyStats(rs) {
  const a = (rs || []).filter(Number.isFinite);
  const n = a.length;
  const wins = a.filter((r) => r > 0);
  const losses = a.filter((r) => r < 0);
  const winRate = n ? wins.length / n : 0;
  const avgWinR = wins.length ? wins.reduce((x, y) => x + y, 0) / wins.length : 0;
  const avgLossR = losses.length ? Math.abs(losses.reduce((x, y) => x + y, 0)) / losses.length : 0;
  const expectancyR = n ? a.reduce((x, y) => x + y, 0) / n : 0;
  const s = stdev(a);
  const sqn = n && s && s !== 0 ? Math.sqrt(n) * (expectancyR / s) : 0;
  const breakevenWr = avgWinR + avgLossR > 0 ? avgLossR / (avgWinR + avgLossR) : null;
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinR,
    avgLossR,
    expectancyR,
    profitFactor: profitFactor(a),
    sqn,
    wilsonLb: wilsonLB(wins.length, n),
    breakevenWr,
    tStat: sqn, // [DECISION] same one-sample t statistic against zero
  };
}

// P2 trading regime (docs/08): halt -> risk_off, else labels from BTC/^GSPC/^NSEI trends.
// [DECISION] high-vol gate: BTC |mom| (percent, 10-bar) > 8.
export function regime(quotes, riskState = "normal") {
  if (riskState === "halt") return "risk_off";
  const get = (sym) => (Array.isArray(quotes) ? quotes.find((q) => q.symbol === sym) : quotes?.[sym]);
  const btc = get("BTC-USD"), gspc = get("^GSPC"), nsei = get("^NSEI");
  const btcTrend = btc?.trend, usTrend = gspc?.trend, inTrend = nsei?.trend;
  const btcHighVol = Number.isFinite(btc?.mom) && Math.abs(btc.mom) > 8;
  if (btcTrend === "up" && usTrend !== "down") return "broad_up";
  if (btcTrend === "down") return btcHighVol ? "crypto_down_highvol" : "crypto_down";
  if (usTrend === "down" || inTrend === "down") return "us_down";
  return "mixed_chop";
}


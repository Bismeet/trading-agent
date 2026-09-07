// scripts/v2/world.mjs — P7/P8 world collector. Keyless providers, per-source
// last-good TTL cache (V2.worldCache), no fabricated readings (docs/13).
// [DECISION] exact TTLs within the source's 5-60m range are chosen here.
import fs from "node:fs";
import path from "node:path";
import { V2, readJSON, writeJSON, getJSON, getText, postJSON, fetchQuote, now } from "./store.mjs";
import { fngBand, regimeScore, aggregateNews } from "../world/score.mjs";

const TTL = {
  macro: 15 * 60000, cryptoFng: 30 * 60000, cnnFng: 30 * 60000, cboePutCall: 30 * 60000,
  hyperliquid: 10 * 60000, stocktwits: 20 * 60000, fedHeadlines: 60 * 60000,
  cryptoNews: 30 * 60000, gdeltTone: 60 * 60000,
};

function cachePath(key) {
  fs.mkdirSync(V2.worldCache, { recursive: true });
  return path.join(V2.worldCache, `${key}.json`);
}

// Last-good cache: fresh cached value may be served; failures keep old value marked stale.
async function cached(key, fetcher) {
  const p = cachePath(key);
  const c = readJSON(p, null);
  if (c && now() - c.fetchedAt < TTL[key]) return { ...c.data, _stale: false };
  try {
    const data = await fetcher();
    if (data == null) throw new Error("empty");
    writeJSON(p, { fetchedAt: now(), data });
    return { ...data, _stale: false };
  } catch {
    if (c) return { ...c.data, _stale: true };
    return null; // dash downstream; never fake a reading
  }
}

const rssTitles = (xml, n = 8) =>
  [...String(xml).matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gs)]
    .map((m) => m[1].trim())
    .filter((t) => t && !/^(rss|feed|channel)/i.test(t))
    .slice(1, n + 1);

const providers = {
  macro: async () => {
    const syms = ["^TNX", "^VIX", "DX-Y.NYB", "CL=F", "GC=F"];
    const quotes = await Promise.all(syms.map((s) => fetchQuote(s)));
    const m = {};
    syms.forEach((s, i) => {
      if (quotes[i].ok) m[s] = { price: quotes[i].price, changePct: quotes[i].changePct };
    });
    if (!Object.keys(m).length) return null;
    return { quotes: m };
  },
  cryptoFng: async () => {
    const j = await getJSON("https://api.alternative.me/fng/?limit=1");
    const v = parseInt(j?.data?.[0]?.value, 10);
    return Number.isFinite(v) ? { value: v } : null;
  },
  cnnFng: async () => {
    const j = await getJSON("https://production.dataviz.cnn.io/index/fearandgreed/graphdata");
    const v = j?.fear_and_greed?.score;
    return Number.isFinite(v) ? { value: Math.round(v) } : null;
  },
  cboePutCall: async () => {
    // [DECISION] CBOE daily total put/call CSV; reject observations older than ~6 days.
    const txt = await getText("https://cdn.cboe.com/api/global/us_indices/daily_prices/PCR.csv");
    const lines = String(txt).trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1]?.split(",");
    const date = Date.parse(last?.[0]);
    const ratio = parseFloat(last?.[1] ?? last?.[3]);
    if (!Number.isFinite(ratio) || !Number.isFinite(date)) return null;
    if (now() - date > 6 * 86400000) return null; // hard-expire old rows
    return { ratio, date: new Date(date).toISOString().slice(0, 10) };
  },
  hyperliquid: async () => {
    const j = await postJSON("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" });
    const names = j?.[0]?.universe?.map((u) => u.name);
    const ctxs = j?.[1];
    if (!Array.isArray(names) || !Array.isArray(ctxs)) return null;
    const out = {};
    for (const coin of ["BTC", "ETH", "SOL"]) {
      const i = names.indexOf(coin);
      if (i < 0 || !ctxs[i]) continue;
      const funding = parseFloat(ctxs[i].funding);
      const oi = parseFloat(ctxs[i].openInterest);
      const mark = parseFloat(ctxs[i].markPx);
      if (Number.isFinite(funding)) out[coin] = { funding, oiUsd: Number.isFinite(oi) && Number.isFinite(mark) ? oi * mark : null, mark };
    }
    return Object.keys(out).length ? out : null;
  },
  stocktwits: async () => {
    const out = {};
    for (const sym of ["AAPL", "NVDA", "TSLA"]) {
      try {
        const j = await getJSON(`https://api.stocktwits.com/api/2/streams/symbol/${sym}.json`);
        let bull = 0, bear = 0;
        for (const msg of j?.messages || []) {
          const s = msg?.entities?.sentiment?.basic;
          if (s === "Bullish") bull++;
          else if (s === "Bearish") bear++;
        }
        out[sym] = { bull, bear };
      } catch { /* per-symbol failure tolerated */ }
    }
    return Object.keys(out).length ? out : null;
  },
  fedHeadlines: async () => {
    const xml = await getText("https://www.federalreserve.gov/feeds/press_all.xml");
    return { titles: rssTitles(xml) };
  },
  cryptoNews: async () => {
    const titles = [];
    for (const url of ["https://cointelegraph.com/rss", "https://decrypt.co/feed"]) {
      try { titles.push(...rssTitles(await getText(url), 5)); } catch { /* per-feed failure tolerated */ }
    }
    return titles.length ? { titles } : null;
  },
  gdeltTone: async () => {
    const j = await getJSON("https://api.gdeltproject.org/api/v2/summary/summary?d=web&t=summary&k=stock%20market&m=json");
    return j ? { tone: j } : null;
  },
};

// collectWorld: aggregate providers, score, write world.v2.json, set funding rate.
export async function collectWorld(cfg, state) {
  const keys = Object.keys(providers);
  const results = await Promise.all(keys.map((k) => cached(k, providers[k])));
  const [macro, cryptoFng, cnnFng, cboe, hl, st, fed, news, gdelt] = results;

  const regime = macro ? regimeScore(macro.quotes) : { label: "neutral", score: 0, posture: "normal", drivers: [] };
  const newsAgg = news ? aggregateNews(news.titles.map((title) => ({ title }))) : null;

  // Hyperliquid: average 8h funding across BTC/ETH/SOL; OI total; crowd read.
  let fundingRate = null, oiUsd = null, whaleCrowd = "unknown";
  if (hl) {
    const rates = Object.values(hl).map((x) => x.funding).filter(Number.isFinite);
    if (rates.length) fundingRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const ois = Object.values(hl).map((x) => x.oiUsd).filter(Number.isFinite);
    if (ois.length) oiUsd = ois.reduce((a, b) => a + b, 0);
    if (fundingRate != null) whaleCrowd = fundingRate > 0.0003 ? "crowded long" : fundingRate < -0.0003 ? "crowded short" : "balanced";
  }
  if (fundingRate != null) state.fundingRate = fundingRate;

  const digest = {
    regime: regime.label,
    risk_posture: regime.posture,
    macro: macro ? { ...macro.quotes, drivers: regime.drivers, score: regime.score, _stale: macro._stale } : null,
    crypto: hl ? { fundingRate, oiUsd, assets: hl, _stale: hl._stale } : null,
    fearGreedCrypto: cryptoFng ? { value: cryptoFng.value, band: fngBand(cryptoFng.value), _stale: cryptoFng._stale } : null,
    fearGreedStocks: cnnFng ? { value: cnnFng.value, band: fngBand(cnnFng.value), _stale: cnnFng._stale } : null,
    putCall: cboe ? { ...cboe, _stale: cboe._stale } : null,
    fundingRate,
    whaleCrowd,
    oiUsd,
    fed: fed ? { titles: fed.titles, _stale: fed._stale } : null,
    headlines: news ? news.titles : [],
    newsMood: newsAgg ? { mean: newsAgg.mean_s, mixed: newsAgg.mixed, n: newsAgg.n } : null,
    social: st ? { ...st, _stale: st._stale } : null,
    thesis: null, // world_thesis generator not specified by source; no LLM calls
    deep_due: false,
    gdelt: gdelt ? { _stale: gdelt._stale } : null,
    ts: now(),
  };
  writeJSON(V2.world, digest);
  return digest;
}

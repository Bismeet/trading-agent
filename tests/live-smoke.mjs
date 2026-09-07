// tests/live-smoke.mjs — OPTIONAL live provider smoke (not part of npm test).
// Run manually: node tests/live-smoke.mjs. Records actual status; never blocks unit tests.
import { fetchQuote, fetchHistory, fetchFx, getJSON, postJSON } from "../scripts/lib.mjs";

const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    const v = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, sample: v });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
  }
};

await check("yahoo BTC-USD quote", async () => (await fetchQuote("BTC-USD")).price);
await check("yahoo AAPL quote", async () => (await fetchQuote("AAPL")).price);
await check("yahoo RELIANCE.NS quote", async () => (await fetchQuote("RELIANCE.NS")).price);
await check("yahoo 1y daily history (SMA200 warmup needs >=200 bars)", async () => (await fetchHistory("BTC-USD", "1y", "1d")).length);
await check("yahoo 5d/15m crypto bars", async () => (await fetchHistory("BTC-USD", "5d", "15m")).length);
await check("FX USDINR", async () => (await fetchFx()).rate);
await check("coinbase fallback endpoint", async () => (await getJSON("https://api.coinbase.com/v2/prices/BTC-USD/spot"))?.data?.amount);
await check("alternative.me crypto FNG", async () => (await getJSON("https://api.alternative.me/fng/?limit=1"))?.data?.[0]?.value);
await check("hyperliquid metaAndAssetCtxs", async () => (await postJSON("https://api.hyperliquid.xyz/info", { type: "metaAndAssetCtxs" }))?.[0]?.universe?.length);

console.log(`\n=== live provider smoke — ${new Date().toISOString()} ===`);
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name} (${r.ms}ms)${r.ok ? " -> " + JSON.stringify(r.sample)?.slice(0, 80) : " -> " + r.error}`);
}
const fails = results.filter((r) => !r.ok);
if (fails.length) { console.log(`\n${fails.length} provider(s) unavailable right now.`); process.exitCode = 1; }

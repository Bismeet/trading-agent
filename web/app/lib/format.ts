// Formatting helpers (docs/14). Display only — never feed back into decisions.

/** Honest placeholder for a value the backend simply does not have. */
export const NO_DATA = "NO DATA";
/** Honest placeholder for a value that exists but is unverified by research. */
export const NOT_VERIFIED = "NOT VERIFIED";
/** Honest placeholder for something that cannot be measured yet. */
export const INSUFFICIENT = "INSUFFICIENT";

export function usd(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

export function signed(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toFixed(2);
}

export function tone(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-inksoft";
  return n >= 0 ? "text-upink" : "text-downink";
}

export function price(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n < 1 ? n.toFixed(4) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function timeAgo(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Age in seconds, or null when the timestamp is unusable. */
export function ageSeconds(ts: number | null | undefined): number | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

/** Zero-padded integer, terminal style. */
export function pad(n: number | null | undefined, width = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.trunc(n)).padStart(width, "0");
}

/**
 * Comical-but-honest verdict word for a signed number.
 * Never fabricates a value; only labels what is already there.
 */
export function moodWord(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NO_DATA;
  if (n > 0.05) return "PLEASED";
  if (n > 0) return "MILDLY PLEASED";
  if (n === 0) return "NEUTRAL";
  if (n > -0.05) return "CONCERNED";
  return "OH NO";
}

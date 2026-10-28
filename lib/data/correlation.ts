// Correlation of daily returns between the configured FX pairs and gold, from Yahoo Finance daily bars (free, no key).
// Pearson correlation of close-to-close % returns on the dates both series traded, over the last 20 and 60 of them.
import { CONFIG } from "../config.ts";
import { bars } from "./yahoo.ts";

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n, mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : null;
}

/** Daily returns keyed by UTC date, from consecutive closes. */
export function returnsByDate(closes: { t: number; close: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < closes.length; i++) m.set(new Date(closes[i].t).toISOString().slice(0, 10), closes[i].close / closes[i - 1].close - 1);
  return m;
}

/** Correlation over the last `n` dates both series have a return for. */
export function correlate(a: Map<string, number>, b: Map<string, number>, n: number): { r: number | null; n: number } {
  const dates = [...a.keys()].filter((d) => b.has(d)).sort().slice(-n);
  return { r: pearson(dates.map((d) => a.get(d)!), dates.map((d) => b.get(d)!)), n: dates.length };
}

export interface CorrelationView { as_of: number; labels: { code: string; display: string }[]; m20: (number | null)[][]; m60: (number | null)[][]; last_date: string | null; errors: string[]; note: string }

let cache: { at: number; v: CorrelationView } | null = null;

export async function correlations(now = Date.now()): Promise<CorrelationView> {
  if (cache && now - cache.at < 3600_000) return cache.v;
  const codes = Object.entries(CONFIG.instruments).filter(([, i]) => i.kind === "fx_spot" || i.kind === "metal");
  const errors: string[] = [];
  const series = await Promise.all(codes.map(async ([code, i]) => {
    try {
      const b = await bars(i.yahoo, "1d", "6mo");
      return { code, display: i.display, r: returnsByDate(b.bars.filter((x) => x.t + 86400_000 <= now)) }; // completed days only
    } catch (e) { errors.push(`${i.yahoo}: ${(e as Error).message}`); return null; }
  }));
  const ok = series.filter((s): s is NonNullable<typeof s> => !!s);
  if (!ok.length) throw new Error(`Yahoo Finance unavailable: ${errors[0]}`);
  const grid = (n: number) => ok.map((a) => ok.map((b) => (a === b ? 1 : correlate(a.r, b.r, n).r)));
  const last = ok.flatMap((s) => [...s.r.keys()]).sort().at(-1) ?? null;
  const v: CorrelationView = { as_of: now, labels: ok.map((s) => ({ code: s.code, display: s.display })), m20: grid(20), m60: grid(60), last_date: last, errors,
    note: "Gold is COMEX gold futures (GC=F), the closest free gold series." };
  if (!errors.length) cache = { at: now, v };
  return v;
}

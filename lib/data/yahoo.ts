// Yahoo Finance chart endpoint (free, no key; unofficial, personal use). Bars are used exactly as Yahoo
// publishes them: daily (1d), weekly (1wk) and hourly (1h). Nothing is aggregated or rebuilt here; each bar
// is only labelled with its session window and whether that window has closed.
//   - rows with null prices are skipped
//   - the trailing "live" point Yahoo appends off the bar grid is dropped from hourly data
//   - a daily/weekly bar is complete only once its session window (lib/core/sessions.ts) has ended
import { CONFIG, env, instrument, type InstrumentConfig } from "../config.ts";
import { dateIn, isWeekday, monday } from "../dates.ts";
import { dayWindow, weekWindow } from "../core/sessions.ts";
import type { Bar } from "../core/technical.ts";
import { fixtureSeries } from "./fixtures.ts";

export type TF = "H1" | "D1" | "W1";
export interface SeriesBar extends Bar { date?: string } // date: session date (D1) or week Monday (W1)
export interface Series {
  instrument: string; symbol: string; provider: string; fixture: boolean; fetchedAt: number;
  H1: SeriesBar[]; D1: SeriesBar[]; W1: SeriesBar[];
  quote: { price: number; time: number } | null; // Yahoo's latest market price (a quote, not a close)
}

const PARAMS: Record<TF, string> = { H1: "interval=1h&range=1mo", D1: "interval=1d&range=1y", W1: "interval=1wk&range=2y" };

interface Chart { meta: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Record<string, (number | null)[]>[] } }

async function chart(symbol: string, params: string): Promise<Chart> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}&includePrePost=false`;
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; fx-analysis-desk/1.0)" }, cache: "no-store" });
    const body = await r.json().catch(() => null) as { chart?: { result?: Chart[]; error?: { code?: string; description?: string } } } | null;
    const res = body?.chart?.result?.[0];
    if (r.ok && res) return res;
    last = `Yahoo ${symbol}: HTTP ${r.status} ${body?.chart?.error?.description ?? ""}`.trim();
    if (r.status < 500 && r.status !== 429) break;
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  throw new Error(last);
}

export function parseChart(code: string, tf: TF, c: Chart, now: number): SeriesBar[] {
  const inst = instrument(code);
  const ts = c.timestamp ?? [];
  const q = c.indicators?.quote?.[0] ?? {};
  const rows: SeriesBar[] = [];
  // Hourly bars sit on a fixed grid (:00 for FX, :30 for the cash index); drop off-grid live points.
  const grid = tf === "H1" && ts.length ? mode(ts.map((t) => t % 3600)) : null;
  const seen = new Set<string>();
  ts.forEach((t, i) => {
    const [o, h, l, cl] = (["open", "high", "low", "close"] as const).map((k) => q[k]?.[i] ?? null);
    if (o == null || h == null || l == null || cl == null) return;
    if (grid != null && t % 3600 !== grid) return;
    const start = t * 1000;
    let bar: SeriesBar;
    if (tf === "H1") {
      bar = { start, end: start + 3600_000, open: o, high: Math.max(h, o, cl), low: Math.min(l, o, cl), close: cl, complete: start + 3600_000 <= now };
    } else {
      const local = dateIn(start, inst.session.tz);
      if (tf === "D1" && !isWeekday(local)) return; // weekend-dated bars (futures' Sunday evening) are not sessions
      const key = tf === "D1" ? local : monday(local);
      if (seen.has(key)) return; // keep the bar on the grid, not a later live point for the same period
      seen.add(key);
      const w = tf === "D1" ? dayWindow(inst.session, key) : weekWindow(inst.session, key);
      bar = { date: key, start: w.start, end: w.end, open: o, high: Math.max(h, o, cl), low: Math.min(l, o, cl), close: cl, complete: w.end <= now };
    }
    rows.push(bar);
  });
  return rows.sort((a, b) => a.start - b.start);
}

function mode(xs: number[]): number {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export async function fetchSeries(code: string, now = Date.now()): Promise<Series> {
  const inst: InstrumentConfig = instrument(code);
  if (env.dataSource === "fixture") return fixtureSeries(code, now);
  const [h1, d1, w1] = await Promise.all((["H1", "D1", "W1"] as TF[]).map((tf) => chart(inst.yahoo, PARAMS[tf])));
  const m = d1.meta as { regularMarketPrice?: number; regularMarketTime?: number };
  return {
    instrument: code, symbol: inst.yahoo, provider: "Yahoo Finance", fixture: false, fetchedAt: now,
    H1: parseChart(code, "H1", h1, now), D1: parseChart(code, "D1", d1, now), W1: parseChart(code, "W1", w1, now),
    quote: m.regularMarketPrice != null && m.regularMarketTime != null ? { price: m.regularMarketPrice, time: m.regularMarketTime * 1000 } : null,
  };
}

export const instrumentCodes = () => Object.keys(CONFIG.instruments);

/** Latest market price for a Yahoo symbol (a quote, not a close), for the calculators' conversion rates. */
export async function latestQuote(symbol: string): Promise<{ price: number; time: number }> {
  const m = (await chart(symbol, "interval=1d&range=5d")).meta as { regularMarketPrice?: number; regularMarketTime?: number };
  if (m.regularMarketPrice == null || m.regularMarketTime == null) throw new Error(`Yahoo ${symbol}: no market price`);
  return { price: m.regularMarketPrice, time: m.regularMarketTime * 1000 };
}

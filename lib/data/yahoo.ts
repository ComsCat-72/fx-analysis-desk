// Yahoo Finance chart endpoint (free, no key; unofficial, personal use). Bars are used exactly as Yahoo publishes them.
//   - rows with null prices are skipped
//   - the latest market price is Yahoo's quote (regularMarketPrice), not a close
const YAHOO_URL = process.env.YAHOO_URL || "https://query1.finance.yahoo.com/v8/finance/chart"; // overridable for local testing

export interface YBar { t: number; open: number; high: number; low: number; close: number } // t: bar start, epoch ms

interface Chart { meta: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Record<string, (number | null)[]>[] } }

async function chart(symbol: string, params: string): Promise<Chart> {
  const url = `${YAHOO_URL}/${encodeURIComponent(symbol)}?${params}&includePrePost=false`;
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

/** Bars for a Yahoo symbol, oldest first, plus the latest market price. interval: 1h, 1d, 1wk; range: 5d, 1mo, 6mo, 1y... */
export async function bars(symbol: string, interval: string, range: string): Promise<{ bars: YBar[]; price: number | null; time: number | null }> {
  const c = await chart(symbol, `interval=${interval}&range=${range}`);
  const ts = c.timestamp ?? [], q = c.indicators?.quote?.[0] ?? {};
  const out: YBar[] = [];
  ts.forEach((t, i) => {
    const [o, h, l, cl] = (["open", "high", "low", "close"] as const).map((k) => q[k]?.[i] ?? null);
    if (o != null && h != null && l != null && cl != null) out.push({ t: t * 1000, open: o, high: h, low: l, close: cl });
  });
  const m = c.meta as { regularMarketPrice?: number; regularMarketTime?: number };
  return { bars: out.sort((a, b) => a.t - b.t), price: m.regularMarketPrice ?? null, time: m.regularMarketTime != null ? m.regularMarketTime * 1000 : null };
}

/** Latest market price for a Yahoo symbol (a quote, not a close), for the calculators' conversion rates. */
export async function latestQuote(symbol: string): Promise<{ price: number; time: number }> {
  const m = (await chart(symbol, "interval=1d&range=5d")).meta as { regularMarketPrice?: number; regularMarketTime?: number };
  if (m.regularMarketPrice == null || m.regularMarketTime == null) throw new Error(`Yahoo ${symbol}: no market price`);
  return { price: m.regularMarketPrice, time: m.regularMarketTime * 1000 };
}

/** The last completed daily, weekly or monthly bar for a Yahoo symbol (a bar still forming is dropped). */
export async function lastCompletedBar(symbol: string, period: "daily" | "weekly" | "monthly", now = Date.now()) {
  const [interval, range] = ({ daily: ["1d", "1mo"], weekly: ["1wk", "6mo"], monthly: ["1mo", "2y"] } as const)[period];
  const c = await chart(symbol, `interval=${interval}&range=${range}`);
  const ts = c.timestamp ?? [], q = c.indicators?.quote?.[0] ?? {};
  const end = (t: number) => {
    const d = new Date(t * 1000);
    if (period === "daily") return t * 1000 + 86400_000;
    if (period === "weekly") return t * 1000 + 7 * 86400_000;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  };
  for (let i = ts.length - 1; i >= 0; i--) {
    const [o, h, l, cl] = (["open", "high", "low", "close"] as const).map((k) => q[k]?.[i] ?? null);
    if (o == null || h == null || l == null || cl == null || end(ts[i]) > now) continue;
    return { start: new Date(ts[i] * 1000).toISOString(), open: o, high: h, low: l, close: cl };
  }
  throw new Error(`Yahoo ${symbol}: no completed ${period} bar`);
}

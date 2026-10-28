// Conversion rates for the Calculators page: Yahoo Finance quotes (free), cached for a minute per symbol.
// Gold has no free spot quote on Yahoo, so XAU uses COMEX gold futures (GC=F), and the result says so.
import { env } from "../config.ts";
import { latestQuote } from "./yahoo.ts";

export interface Rate { from: string; to: string; rate: number; time: string | null; sources: string[]; fixture: boolean }

const cache = new Map<string, { at: number; q: { price: number; time: number } }>();
async function quote(symbol: string) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 60_000) return hit.q;
  const q = await latestQuote(symbol);
  cache.set(symbol, { at: Date.now(), q });
  return q;
}

// DEVELOPMENT FIXTURE rates (USD per unit), used only with DATA_SOURCE=fixture; labelled as fixtures.
const FIXTURE_USD: Record<string, number> = { USD: 1, EUR: 1.16, GBP: 1.3, AUD: 0.66, NZD: 0.59, CHF: 1.25, CAD: 0.72, JPY: 1 / 150, XAU: 4100 };

export async function rate(from: string, to: string): Promise<Rate> {
  if (from === to) return { from, to, rate: 1, time: null, sources: [], fixture: false };
  if (env.dataSource === "fixture") {
    if (!FIXTURE_USD[from] || !FIXTURE_USD[to]) throw new Error(`no fixture rate for ${from}/${to}`);
    return { from, to, rate: FIXTURE_USD[from] / FIXTURE_USD[to], time: new Date().toISOString(), sources: ["DEVELOPMENT FIXTURE"], fixture: true };
  }
  if (from === "XAU" || to === "XAU") {
    const g = await quote("GC=F");
    const usd = from === "XAU" ? await rate("USD", to) : await rate(from, "USD");
    const r = from === "XAU" ? g.price * usd.rate : usd.rate / g.price;
    return { from, to, rate: r, time: new Date(g.time).toISOString(), sources: ["Yahoo Finance GC=F (COMEX gold futures, not spot)", ...usd.sources], fixture: false };
  }
  const q = await quote(`${from}${to}=X`);
  return { from, to, rate: q.price, time: new Date(q.time).toISOString(), sources: [`Yahoo Finance ${from}${to}=X`], fixture: false };
}

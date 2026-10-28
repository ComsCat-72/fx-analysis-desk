// Currency strength from Yahoo Finance (free, no key). The seven USD pairs give every currency's value in USD; the
// 28 crosses follow from them, so a currency's strength is its average % change against the other seven:
//   s(c) = mean over d != c of (ln P_c - ln P_d), where P is the value in USD and ln P is the change since the start.
// Today = since the latest 17:00 New York open (Sunday to Thursday); week = since Sunday 17:00 New York.
import { addDays, dateIn, weekday, zoned } from "../dates.ts";
import { bars } from "./yahoo.ts";

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"] as const;
// Yahoo symbol and whether it quotes USD per unit (EURUSD=X) or units per USD (JPY=X is USD/JPY).
const PAIRS: Record<string, { symbol: string; usdPer: boolean }> = {
  EUR: { symbol: "EURUSD=X", usdPer: true }, GBP: { symbol: "GBPUSD=X", usdPer: true }, AUD: { symbol: "AUDUSD=X", usdPer: true },
  NZD: { symbol: "NZDUSD=X", usdPer: true }, JPY: { symbol: "JPY=X", usdPer: false }, CAD: { symbol: "CAD=X", usdPer: false }, CHF: { symbol: "CHF=X", usdPer: false },
};

/** Start of today's session and of the week: the latest 17:00 New York open at or before `now`. */
export function periodStarts(now: number): { today: number; week: number } {
  const ny = "America/New_York";
  let d = dateIn(now, ny);
  if (zoned(d, "17:00", ny) > now) d = addDays(d, -1);
  while (weekday(d) === 5 || weekday(d) === 6) d = addDays(d, -1); // sessions open Sunday to Thursday
  let w = dateIn(now, ny);
  while (weekday(w) !== 0 || zoned(w, "17:00", ny) > now) w = addDays(w, -1);
  return { today: zoned(d, "17:00", ny), week: zoned(w, "17:00", ny) };
}

/** Strength in % from each currency's log change in USD value (USD itself 0). The values sum to zero. */
export function strengthFrom(change: Record<string, number>): { currency: string; pct: number }[] {
  const all = CURRENCIES.map((c) => change[c] ?? 0), sum = all.reduce((a, b) => a + b, 0), n = CURRENCIES.length;
  return CURRENCIES.map((c, i) => ({ currency: c, pct: 100 * (all[i] - (sum - all[i]) / (n - 1)) })).sort((a, b) => b.pct - a.pct);
}

/** All 28 crosses' % change, from the same USD values: cross c/d = ln P_c - ln P_d. */
export function crossesFrom(change: Record<string, number>): { pair: string; pct: number }[] {
  const out: { pair: string; pct: number }[] = [];
  CURRENCIES.forEach((c, i) => CURRENCIES.slice(i + 1).forEach((d) => out.push({ pair: `${c}/${d}`, pct: 100 * (Math.expm1((change[c] ?? 0) - (change[d] ?? 0))) })));
  return out;
}

export interface StrengthView {
  as_of: number; today_start: number; week_start: number;
  today: { currency: string; pct: number }[]; week: { currency: string; pct: number }[];
  crosses_today: { pair: string; pct: number }[];
  quotes: { currency: string; symbol: string; price: number; time: number | null }[]; errors: string[];
}

let cache: { at: number; v: StrengthView } | null = null;

export async function strength(now = Date.now()): Promise<StrengthView> {
  if (cache && now - cache.at < 60_000) return cache.v;
  const { today, week } = periodStarts(now);
  const errors: string[] = [], quotes: StrengthView["quotes"] = [];
  const dToday: Record<string, number> = { USD: 0 }, dWeek: Record<string, number> = { USD: 0 };
  await Promise.all(Object.entries(PAIRS).map(async ([cur, p]) => {
    try {
      const b = await bars(p.symbol, "1h", "10d");
      const price = b.price ?? b.bars.at(-1)?.close;
      if (price == null) throw new Error("no price");
      const openAt = (t: number) => b.bars.find((x) => x.t >= t)?.open ?? price; // first hourly bar of the period
      const usd = (x: number) => Math.log(p.usdPer ? x : 1 / x);
      dToday[cur] = usd(price) - usd(openAt(today));
      dWeek[cur] = usd(price) - usd(openAt(week));
      quotes.push({ currency: cur, symbol: p.symbol, price, time: b.time });
    } catch (e) { errors.push(`${p.symbol}: ${(e as Error).message}`); }
  }));
  if (errors.length === Object.keys(PAIRS).length) throw new Error(`Yahoo Finance unavailable: ${errors[0]}`);
  const v: StrengthView = { as_of: now, today_start: today, week_start: week, today: strengthFrom(dToday), week: strengthFrom(dWeek),
    crosses_today: crossesFrom(dToday), quotes: quotes.sort((a, b) => a.currency.localeCompare(b.currency)), errors };
  if (!errors.length) cache = { at: now, v };
  return v;
}

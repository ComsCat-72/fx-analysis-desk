// Inputs given to Claude: Yahoo Finance daily bars (used exactly as published) and the weekly
// Forex Factory calendar feed. Nothing here builds candles; a few highs/lows are read off the bars.
import { CONFIG, type InstrumentConfig, type Kind } from "./config.ts";
import { addDays, monday, stamp, todayLocal } from "./dates.ts";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; fx-analysis-desk/1.0)" };

interface Bar { date: string; open: number; high: number; low: number; close: number }
export interface Daily { bars: Bar[]; price: number | null; priceTime: Date | null; exchangeTz: string }

export async function yahooDaily(symbol: string): Promise<Daily> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
  const res = await fetch(url, { headers: UA, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const result = (await res.json())?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: empty response`);
  const tz: string = result.meta?.exchangeTimezoneName ?? "UTC";
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  (result.timestamp ?? []).forEach((t: number, i: number) => {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if ([o, h, l, c].some((x) => x == null)) return;
    bars.push({ date: new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: tz }), open: o, high: h, low: l, close: c });
  });
  const pt = result.meta?.regularMarketTime;
  return { bars, price: result.meta?.regularMarketPrice ?? null, priceTime: pt ? new Date(pt * 1000) : null, exchangeTz: tz };
}

export function marketBlock(inst: InstrumentConfig, data: Daily, kind: Kind, period: string): string {
  const f = (x: number) => x.toFixed(inst.decimals);
  const today = todayLocal();
  let bars = data.bars;
  if (kind === "daily_review") bars = bars.filter((b) => b.date <= period);
  else if (kind === "weekly_review") bars = bars.filter((b) => b.date <= addDays(period, 4));
  else bars = bars.filter((b) => b.date < today); // today's bar is still forming: not a completed session

  const lines = [`Source: Yahoo Finance \`${inst.yahoo}\` daily bars (dates in ${data.exchangeTz}); prices exactly as published.`];
  if (inst.note) lines.push(inst.note);
  if (data.price != null && data.priceTime && (kind === "daily_analysis" || kind === "weekly_analysis")) {
    lines.push(`Latest price: ${f(data.price)} at ${stamp(data.priceTime)} (a live quote, not a closing price).`);
  }
  lines.push("", "| Date | Open | High | Low | Close |", "|---|---|---|---|---|");
  for (const b of bars.slice(-25)) lines.push(`| ${b.date} | ${f(b.open)} | ${f(b.high)} | ${f(b.low)} | ${f(b.close)} |`);
  if (bars.length) {
    const wk = monday(bars[bars.length - 1].date);
    const prev = bars.filter((b) => b.date >= addDays(wk, -7) && b.date < wk);
    const cur = bars.filter((b) => b.date >= wk);
    const hi = (xs: Bar[]) => f(Math.max(...xs.map((b) => b.high)));
    const lo = (xs: Bar[]) => f(Math.min(...xs.map((b) => b.low)));
    lines.push("");
    if (prev.length) lines.push(`Previous week high / low: ${hi(prev)} / ${lo(prev)}`);
    if (cur.length) lines.push(`Week-to-date high / low: ${hi(cur)} / ${lo(cur)}`);
    const last20 = bars.slice(-20);
    lines.push(`20-session high / low: ${hi(last20)} / ${lo(last20)}`);
  } else {
    lines.push("No completed daily bars are available for this period.");
  }
  return lines.join("\n");
}

export async function calendarBlock(currencies: string[]): Promise<string> {
  let rows: { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }[];
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: UA, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (e) {
    return `Economic calendar unavailable this run (${(e as Error).message}). Use web search and say the calendar feed was unavailable.`;
  }
  const out = [
    "Source: Forex Factory weekly calendar feed (schedule, consensus = forecast, previous; no actual results).",
    `| Time (${CONFIG.timezoneLabel}) | Currency | Impact | Event | Consensus | Previous |`, "|---|---|---|---|---|---|",
  ];
  for (const e of rows) {
    if (!currencies.includes(e.country) || !["High", "Medium"].includes(e.impact)) continue;
    const t = stamp(new Date(e.date)).replace(/ \d{4} /, " ").replace(` ${CONFIG.timezoneLabel}`, "");
    out.push(`| ${t} | ${e.country} | ${e.impact} | ${e.title} | ${e.forecast || "—"} | ${e.previous || "—"} |`);
  }
  return out.length > 3 ? out.join("\n") : "No high- or medium-impact events listed this week for these currencies.";
}

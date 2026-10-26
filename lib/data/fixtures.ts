// DEVELOPMENT FIXTURE data: a deterministic synthetic price series for offline development and tests.
// Every report built from it carries a banner, and it can never be published in production.
import { instrument } from "../config.ts";
import { addDays, dateIn, isWeekday, monday } from "../dates.ts";
import { dayWindow, weekWindow } from "../core/sessions.ts";
import type { Series, SeriesBar } from "./yahoo.ts";

const BASE: Record<string, number> = { GBP_USD: 1.3, EUR_USD: 1.16, AUD_USD: 0.66, NZD_USD: 0.59, USD_CHF: 0.8, XAU_USD: 4100, DXY: 98.5, NAS100: 25000 };

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

/** Hourly random walk over the session windows of the last `days` days, with daily and weekly bars built
 *  from it, so fixture D1/W1 bars are internally consistent with the H1 bars (real data needs no such step). */
export function fixtureSeries(code: string, now: number, days = 400): Series {
  const inst = instrument(code);
  const seedBase = [...code].reduce((s, c) => s + c.charCodeAt(0), 0);
  const r = rng(seedBase * 7919);
  const vol = (BASE[code] ?? 1) * 0.0012;
  let price = BASE[code] ?? 1;
  const H1: SeriesBar[] = [], D1: SeriesBar[] = [];
  const today = dateIn(now, inst.session.tz);
  for (let d = addDays(today, -days); d <= today; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    const w = dayWindow(inst.session, d);
    const day: SeriesBar[] = [];
    for (let t = w.start; t < w.end && t + 3600_000 <= now; t += 3600_000) {
      const o = price;
      const c = o + (r() - 0.5) * vol + Math.sin((t / 3600_000) / 37) * vol * 0.05;
      const h = Math.max(o, c) + r() * vol * 0.4, l = Math.min(o, c) - r() * vol * 0.4;
      price = c;
      day.push({ start: t, end: t + 3600_000, open: o, high: h, low: l, close: c, complete: true });
    }
    if (!day.length) continue;
    H1.push(...day);
    D1.push({ date: d, start: w.start, end: w.end, open: day[0].open, high: Math.max(...day.map((b) => b.high)),
      low: Math.min(...day.map((b) => b.low)), close: day[day.length - 1].close, complete: w.end <= now });
  }
  const W1: SeriesBar[] = [];
  for (const b of D1) {
    const mon = monday(b.date!);
    const last = W1[W1.length - 1];
    if (last && last.date === mon) {
      last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close;
    } else {
      const w = weekWindow(inst.session, mon);
      W1.push({ date: mon, start: w.start, end: w.end, open: b.open, high: b.high, low: b.low, close: b.close, complete: w.end <= now });
    }
  }
  const h1Since = now - 35 * 86400_000;
  return {
    instrument: code, symbol: `${inst.yahoo} (fixture)`, provider: "DEVELOPMENT FIXTURE", fixture: true, fetchedAt: now,
    H1: H1.filter((b) => b.start >= h1Since), D1, W1, quote: null,
  };
}

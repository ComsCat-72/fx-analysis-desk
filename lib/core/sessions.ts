// Session windows for each instrument, taken from how its data source publishes daily bars.
// Day D: [close of the previous calendar day, close of D), or [open, close) for a cash session.
// Monday starts at Sunday's close. A week (keyed by its Monday) runs from Monday's start to Friday's close.
import type { SessionRule } from "../config.ts";
import { addDays, dateIn, isWeekday, monday, weekDays, zoned } from "../dates.ts";

export interface Window { start: number; end: number }

export function dayWindow(rule: SessionRule, d: string): Window {
  const end = zoned(d, rule.close, rule.tz);
  const start = rule.open ? zoned(d, rule.open, rule.tz) : zoned(addDays(d, -1), rule.close, rule.tz);
  return { start, end };
}

export function weekWindow(rule: SessionRule, mon: string): Window {
  return { start: dayWindow(rule, mon).start, end: dayWindow(rule, addDays(mon, 4)).end };
}

/** Session date whose window contains t, or null outside sessions (weekend, overnight for cash sessions). */
export function sessionOf(rule: SessionRule, t: number): string | null {
  const local = dateIn(t, rule.tz);
  for (const d of [local, addDays(local, 1)]) {
    if (!isWeekday(d)) continue;
    const w = dayWindow(rule, d);
    if (w.start <= t && t < w.end) return d;
  }
  return null;
}

export const marketOpen = (rule: SessionRule, t: number) => sessionOf(rule, t) !== null;

/** Latest weekday session that has fully closed by `t`, looking back at most `maxDays`. */
export function lastClosedSession(rule: SessionRule, t: number, maxDays = 7): string | null {
  let d = dateIn(t, rule.tz);
  for (let i = 0; i <= maxDays; i++, d = addDays(d, -1)) {
    if (isWeekday(d) && dayWindow(rule, d).end <= t) return d;
  }
  return null;
}

export { monday, weekDays };

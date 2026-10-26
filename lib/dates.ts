// Calendar helpers. Dates are plain "YYYY-MM-DD" strings in the display timezone (EAT).
import { CONFIG } from "./config.ts";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Today's date in the display timezone. */
export function todayLocal(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: CONFIG.timezone });
}

/** Day of week 0=Sunday..6=Saturday for a YYYY-MM-DD date. */
export function weekday(d: string): number {
  return new Date(`${d}T12:00:00Z`).getUTCDay();
}

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Monday of the week containing d. */
export function monday(d: string): string {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

export function longDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function shortDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

/** "Mon 16 Nov 2026 07:31 EAT" */
export function stamp(at: Date | string, tz = CONFIG.timezone, label = CONFIG.timezoneLabel): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const s = d.toLocaleString("en-GB", {
    timeZone: tz, weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${s.replace(",", "")} ${label}`;
}

export const dayName = (d: string) => DOW[weekday(d)];

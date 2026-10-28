// Calendar and timezone helpers. Calendar dates are "YYYY-MM-DD" strings; instants are epoch ms (UTC).
import { CONFIG } from "./config.ts";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Display timezone: CONFIG default (Africa/Kampala), replaced by the dashboard setting whenever settings load.
// Only the display changes; stored instants and source timestamps are untouched.
let DISPLAY_TZ = CONFIG.display.timezone, DISPLAY_LABEL = CONFIG.display.timezone_label;

export const isTimeZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

/** Short label for a zone: the configured names (EAT, CAT, ...) first, else Intl's short name (e.g. "GMT+3"). */
export function zoneLabel(tz: string, t = Date.now()): string {
  const known = (CONFIG.display.labels as Record<string, string>)[tz];
  if (known) return known;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(t)).find((x) => x.type === "timeZoneName")?.value ?? tz;
}

export function setDisplayZone(tz: string | null | undefined) {
  const z = tz && isTimeZone(tz) ? tz : CONFIG.display.timezone;
  DISPLAY_TZ = z;
  DISPLAY_LABEL = zoneLabel(z);
}
export const displayZone = () => ({ timezone: DISPLAY_TZ, timezone_label: DISPLAY_LABEL });

/** Calendar date of an instant in a timezone (default: the display timezone). */
export function dateIn(t: number | Date = Date.now(), tz = DISPLAY_TZ): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const todayLocal = (now = Date.now()) => dateIn(now);

/** Day of week 0=Sunday..6=Saturday for a YYYY-MM-DD date. */
export const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Monday of the week containing d (Sunday belongs to the week before). */
export function monday(d: string): string {
  const wd = weekday(d);
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
export const isWeekday = (d: string) => weekday(d) >= 1 && weekday(d) <= 5;
export const weekDays = (mon: string) => [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
export const dayName = (d: string) => DOW[weekday(d)];

function offsetMs(t: number, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** The instant at local wall time `hhmm` on date `d` in `tz` ("24:00" = midnight ending d). DST-safe. */
export function zoned(d: string, hhmm: string, tz: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === 24) return zoned(addDays(d, 1), "00:00", tz);
  const guess = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h, m);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}

/** "HH:MM" of an instant in a timezone. */
export function hhmm(t: number, tz = DISPLAY_TZ): string {
  return new Date(t).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "Mon 16 Nov 2026 07:31 EAT" (label of the display timezone) */
export function stamp(t: number | string | Date, opts: { date?: boolean } = {}): string {
  const d = new Date(t);
  if (opts.date === false) return `${hhmm(d.getTime())} ${DISPLAY_LABEL}`;
  const s = d.toLocaleString("en-GB", {
    timeZone: DISPLAY_TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return `${s.replace(/,/g, "")} ${DISPLAY_LABEL}`;
}

/** "Tue 27 Oct 14:30" in the display timezone (calendar tables). */
export function shortStamp(t: number): string {
  return new Date(t).toLocaleString("en-GB", {
    timeZone: DISPLAY_TZ, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).replace(/,/g, "");
}

const fmtDate = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
export const longDate = (d: string) => fmtDate(d, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).replace(",", "");
export const shortDate = (d: string) => fmtDate(d, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(",", "");
export const dayMonth = (d: string) => fmtDate(d, { day: "2-digit", month: "short" });
export const dayMonthYear = (d: string) => fmtDate(d, { day: "2-digit", month: "short", year: "numeric" });

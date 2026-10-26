// Economic calendar. Schedule, consensus (forecast) and previous come from the free weekly JSON export
// published by Forex Factory's operator; that export has no actual results. Actuals are added by you
// (dashboard) or found by the research step with a cited source URL. Every value ever recorded is kept in an
// append-only history per event, so a report can be rebuilt exactly as of its data cutoff.
import { createHash } from "node:crypto";
import { CONFIG } from "../config.ts";
import { monday, dateIn } from "../dates.ts";
import { reconcileActuals, revisionDirection, type EventState } from "../core/events.ts";
import { getJSON, update } from "../store.ts";

export interface HistoryEntry { field: "actual" | "consensus" | "previous" | "revised_previous" | "rescheduled_to"; value: string | null; source: string; url?: string | null; at: number }
export interface CalendarEvent {
  id: string; source: string; currency: string; title: string; impact: string | null;
  scheduledAt: number; sourceTime: string; consensus: string | null; previous: string | null;
  history: HistoryEntry[]; fixture?: boolean;
}
export interface CalendarDoc { week: string; refreshedAt: number | null; events: Record<string, CalendarEvent> }

export const calendarPath = (week: string) => `calendar/${week}.json`;
const emptyDoc = (week: string): CalendarDoc => ({ week, refreshedAt: null, events: {} });

export const eventId = (currency: string, title: string, sourceTime: string) =>
  createHash("sha256").update(`ff|${currency}|${title}|${sourceTime.slice(0, 10)}`).digest("hex").slice(0, 24);

interface FeedRow { title: string; country: string; date: string; impact?: string; forecast?: string; previous?: string; actual?: string }

export function parseFeed(rows: FeedRow[]): Omit<CalendarEvent, "history">[] {
  return rows.flatMap((r) => {
    const t = Date.parse(r.date);
    if (!/[+-]\d\d:?\d\d$|Z$/.test(r.date) || Number.isNaN(t)) return []; // a time without an offset is never guessed
    const currency = (r.country ?? "").toUpperCase(), title = (r.title ?? "").trim();
    const blank = (v?: string) => (v && v.trim() ? v.trim() : null);
    return [{ id: eventId(currency, title, r.date), source: "Forex Factory weekly export", currency, title,
      impact: (r.impact ?? "").toLowerCase() === "holiday" ? "Holiday" : r.impact ?? null, scheduledAt: t, sourceTime: r.date,
      consensus: blank(r.forecast), previous: blank(r.previous) }];
  });
}

/** Fetch this week's feed and merge it into the store. Changed consensus/previous/times are appended to history. */
export async function refreshCalendar(now = Date.now()): Promise<{ stored: number; week: string }> {
  const r = await fetch(CONFIG.calendar.feed, { headers: { "User-Agent": "fx-analysis-desk/1.0 (calendar widget feed)" }, cache: "no-store" });
  if (!r.ok) throw new Error(`calendar feed HTTP ${r.status}`);
  const rows = parseFeed(await r.json() as FeedRow[]);
  return mergeEvents(rows, now);
}

export async function mergeEvents(rows: Omit<CalendarEvent, "history">[], now = Date.now()) {
  const byWeek = new Map<string, typeof rows>();
  for (const e of rows) {
    const wk = monday(dateIn(e.scheduledAt, "America/New_York"));
    byWeek.set(wk, [...(byWeek.get(wk) ?? []), e]);
  }
  let stored = 0, week = monday(dateIn(now));
  for (const [wk, evs] of byWeek) {
    week = wk;
    await update<CalendarDoc>(calendarPath(wk), () => emptyDoc(wk), (doc) => {
      doc.refreshedAt = now;
      for (const e of evs) {
        const cur = doc.events[e.id];
        if (!cur) {
          doc.events[e.id] = { ...e, history: [
            { field: "consensus", value: e.consensus, source: e.source, at: now },
            { field: "previous", value: e.previous, source: e.source, at: now },
          ] };
          stored++;
          continue;
        }
        if (cur.consensus !== e.consensus) cur.history.push({ field: "consensus", value: e.consensus, source: e.source, at: now });
        if (cur.previous !== e.previous) {
          // A changed "previous" after the release is a revision of the prior figure.
          cur.history.push({ field: cur.previous && e.previous && now > cur.scheduledAt ? "revised_previous" : "previous", value: e.previous, source: e.source, at: now });
        }
        if (cur.scheduledAt !== e.scheduledAt) cur.history.push({ field: "rescheduled_to", value: new Date(e.scheduledAt).toISOString(), source: e.source, at: now });
        Object.assign(cur, { consensus: e.consensus, previous: e.previous, scheduledAt: e.scheduledAt, sourceTime: e.sourceTime, impact: e.impact });
        stored++;
      }
    });
  }
  return { stored, week };
}

export async function recordValue(week: string, id: string, field: "actual" | "revised_previous", value: string, source: string, url?: string | null, now = Date.now()) {
  let found = false;
  await update<CalendarDoc>(calendarPath(week), () => emptyDoc(week), (doc) => {
    const e = doc.events[id];
    if (!e) return;
    found = true;
    e.history.push({ field, value: value.trim(), source, url: url ?? null, at: now });
  });
  if (!found) throw new Error("no such event");
}

export interface EventAsOf {
  state: EventState; actual: string | null; actualSources: string[]; consensus: string | null; previous: string | null;
  revisedPrevious: string | null; rescheduledTo: string | null; conflicting: Record<string, string> | null;
}

/** Reconstruct the event exactly as it was known at `cutoff`, from the append-only history. */
export function eventAsOf(e: CalendarEvent, cutoff: number): EventAsOf {
  const latest: Record<string, Map<string, string | null>> = {};
  let resched: string | null = null;
  for (const h of [...e.history].filter((x) => x.at <= cutoff).sort((a, b) => a.at - b.at)) {
    if (h.field === "rescheduled_to") resched = h.value;
    (latest[h.field] ??= new Map()).set(h.url ? `${h.source} (${h.url})` : h.source, h.value);
  }
  const actuals = Object.fromEntries([...(latest.actual ?? new Map())].filter(([, v]) => v)) as Record<string, string>;
  const rec = reconcileActuals(actuals);
  const last = (f: string, dflt: string | null) => { const m = latest[f]; return m && m.size ? [...m.values()].pop() ?? null : dflt; };
  const consensus = last("consensus", null), previous = last("previous", null), revised = last("revised_previous", null);
  let state: EventState = rec.state;
  if (state === "unavailable") state = resched ? "delayed" : e.scheduledAt > cutoff ? "scheduled" : "unavailable";
  if (state === "released" && revised && revisionDirection(previous, revised)) state = "revised";
  return { state, actual: rec.actual, actualSources: rec.actual ? Object.keys(actuals) : [], consensus, previous,
    revisedPrevious: revised, rescheduledTo: resched, conflicting: rec.state === "conflicting" ? actuals : null };
}

export async function eventsBetween(from: number, to: number): Promise<CalendarEvent[]> {
  const weeks = new Set<string>();
  for (let t = from - 7 * 86400_000; t <= to + 7 * 86400_000; t += 86400_000) weeks.add(monday(dateIn(t, "America/New_York")));
  const docs = await Promise.all([...weeks].map((w) => getJSON<CalendarDoc>(calendarPath(w))));
  return docs.flatMap((d) => Object.values(d?.events ?? {}))
    .filter((e) => e.scheduledAt >= from && e.scheduledAt < to).sort((a, b) => a.scheduledAt - b.scheduledAt);
}

/** Currencies whose releases matter for each instrument. */
const DXY_BASKET = ["USD", "EUR", "JPY", "GBP", "CAD", "SEK", "CHF"];
export function eventCurrencies(code: string): string[] {
  const i = CONFIG.instruments[code];
  if (i.kind === "fx_spot") return [i.base, i.quote];
  return i.kind === "index" ? DXY_BASKET : ["USD"];
}

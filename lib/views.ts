// What the API returns to the dashboard's calendar, assembled from the stored documents.
import { addDays, dateIn, displayZone, hhmm, monday, stamp, zoned } from "./dates.ts";
import { calendarPath, eventAsOf, eventsBetween, type CalendarDoc } from "./data/calendar.ts";
import { resultTone, revisionDirection } from "./core/events.ts";
import { getJSON } from "./store.ts";
import { HttpError } from "./http.ts";

/** The full economic calendar for a date range in the display timezone (Forex Factory layout). Values as known now. */
/** One event's value history (shown when a calendar row is opened). Id as in calendar rows: "{week}:{event}". */
export async function eventDetail(id: string) {
  const [week, eid] = id.split(":");
  const e = Object.values((await getJSON<CalendarDoc>(calendarPath(week)))?.events ?? {}).find((x) => x.id === eid);
  if (!e) throw new HttpError(404, "no such event");
  return { id, history: e.history.map((h) => ({ field: h.field, value: h.value, source: h.source, url: h.url ?? null, at_display: stamp(h.at) })) };
}

export async function calendarRange(from: string, to: string, o: { currencies?: string[]; impacts?: string[] } = {}) {
  const tz = displayZone().timezone, now = Date.now();
  const start = zoned(from, "00:00", tz), end = zoned(addDays(to, 1), "00:00", tz);
  const all = await eventsBetween(start, end);
  const rows = all.filter((e) => (!o.currencies?.length || o.currencies.includes(e.currency)) && (!o.impacts?.length || o.impacts.includes(e.impact ?? "Low")))
    .map((e) => {
      const st = eventAsOf(e, now);
      return {
        id: `${monday(dateIn(e.scheduledAt, "America/New_York"))}:${e.id}`, date: dateIn(e.scheduledAt), time: hhmm(e.scheduledAt), at: new Date(e.scheduledAt).toISOString(),
        all_day: e.impact === "Holiday", source_time: e.sourceTime, currency: e.currency, impact: e.impact ?? "Low", title: e.title,
        actual: st.actual, forecast: st.consensus, previous: st.previous, revised_previous: st.revisedPrevious,
        revision: ({ "revised up": "up", "revised down": "down" } as Record<string, string>)[revisionDirection(st.previous, st.revisedPrevious) ?? ""] ?? null,
        state: st.state, tone: st.actual ? resultTone(e.title, st.actual, st.consensus) : null, actual_sources: st.actualSources, conflicting: st.conflicting,
        source: e.source, is_fixture: !!e.fixture, is_next: false,
      };
    });
  const next = rows.find((r) => Date.parse(r.at) > now && r.impact !== "Holiday");
  if (next) next.is_next = true;
  const weeks = new Set<string>();
  for (let d = monday(from); d <= to; d = addDays(d, 7)) weeks.add(monday(d));
  const docs = await Promise.all([...weeks].map(async (w) => [w, await getJSON<CalendarDoc>(calendarPath(w))] as const));
  return {
    from, to, timezone: tz, timezone_label: displayZone().timezone_label, now: new Date(now).toISOString(),
    currencies: [...new Set(all.map((e) => e.currency))].sort(),
    coverage: docs.map(([w, d]) => ({ week: w, stored: !!d, refreshed_display: d?.refreshedAt ? stamp(d.refreshedAt) : null })),
    rows,
  };
}

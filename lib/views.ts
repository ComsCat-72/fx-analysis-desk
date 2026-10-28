// What the API returns to the dashboard, assembled from the stored documents.
import { CONFIG, instrument } from "./config.ts";
import { addDays, dateIn, dayName, displayZone, hhmm, monday, shortStamp, stamp, weekDays, zoned } from "./dates.ts";
import { lastClosedSession, marketOpen, weekWindow } from "./core/sessions.ts";
import { calendarPath, eventAsOf, eventCurrencies, eventsBetween, type CalendarDoc } from "./data/calendar.ts";
import { resultTone, revisionDirection } from "./core/events.ts";
import { getJSON } from "./store.ts";
import { fetchSeries } from "./data/yahoo.ts";
import { HttpError } from "./http.ts";
import { getVersion, loadIndex, parseId, slotAvailability } from "./reports/service.ts";

/** Index entries carry the stored outlook for continuity; the dashboard lists only the summary fields. */
const strip = ({ outlook: _o, conclusion: _c, lesson: _l, ...s }: Record<string, unknown>) => s;

export async function reportDetail(id: string) {
  const v = await getVersion(id);
  if (!v) throw new HttpError(404, "no such report version");
  const ix = await loadIndex(v.instrument);
  const versions = ix.versions.filter((x) => x.kind === v.kind && x.period_key === v.period_key && x.status !== "discarded").sort((a, b) => a.version - b.version)
    .map((x) => strip(x as unknown as Record<string, unknown>));
  const summary = strip(ix.versions.find((x) => x.id === id) as unknown as Record<string, unknown>);
  return { ...summary, body_md: v.body_md, checks: v.checks, sections: v.sections, facts: v.facts, content_hash: v.content_hash,
    research: v.research, model: v.model, outlook: v.outlook, versions };
}

export async function weekView(inst: string, week: string) {
  instrument(inst);
  const mon = monday(week);
  const ix = await loadIndex(inst);
  const pick = (kind: string, period: string) => ix.versions.filter((v) => v.kind === kind && v.period_key === period && v.status !== "discarded")
    .sort((a, b) => a.version - b.version).map((v) => strip(v as unknown as Record<string, unknown>));
  return {
    week_key: mon, instrument: inst,
    weekly_analysis: pick("weekly_analysis", mon), weekly_review: pick("weekly_review", mon),
    slots: { weekly_analysis: slotAvailability("weekly_analysis", inst, mon), weekly_review: slotAvailability("weekly_review", inst, mon) },
    days: weekDays(mon).map((d) => ({ date: d, day: dayName(d), daily_analysis: pick("daily_analysis", d), daily_review: pick("daily_review", d),
      slots: { daily_analysis: slotAvailability("daily_analysis", inst, d), daily_review: slotAvailability("daily_review", inst, d) } })),
    change_log: ix.changes.filter((c) => c.week_key === mon).map((c) => ({ at: c.at_display, from: c.from, to: c.to, evidence: c.evidence })),
  };
}

export async function calendarRows(inst: string, week: string) {
  const w = weekWindow(instrument(inst).session, monday(week));
  const curs = eventCurrencies(inst), now = Date.now();
  return (await eventsBetween(w.start - 2 * 86400_000, w.end + 86400_000)).filter((e) => curs.includes(e.currency)).map((e) => {
    const st = eventAsOf(e, now);
    return { id: `${monday(dateIn(e.scheduledAt, "America/New_York"))}:${e.id}`, currency: e.currency, title: e.title, impact: e.impact,
      time_eat: shortStamp(e.scheduledAt), time_label: displayZone().timezone_label, source_time: e.sourceTime, consensus: st.consensus, previous: st.previous,
      revised_previous: st.revisedPrevious, actual: st.actual, state: st.state, actual_sources: st.actualSources, source: e.source, is_fixture: !!e.fixture };
  });
}

export async function freshness(inst: string) {
  const rule = instrument(inst).session, now = Date.now();
  const open = marketOpen(rule, now);
  try {
    const s = await fetchSeries(inst, now);
    const last = s.H1.filter((b) => b.complete).pop();
    if (!last) return { status: "missing", message: "The source returned no hourly bars.", market_open: open, last_h1_close: null, provider: s.provider, is_fixture: s.fixture };
    const age = (now - last.end) / 3600_000;
    const stale = open && age > 2;
    const lastSession = lastClosedSession(rule, now);
    return { status: stale ? "stale" : "ok", market_open: open, last_h1_close: stamp(last.end), provider: `${s.provider} ${s.symbol}`, is_fixture: s.fixture,
      age_hours: Math.round(age * 10) / 10, last_closed_session: lastSession,
      message: stale ? `Latest complete 1H bar is ${age.toFixed(1)} hours old.` : open ? "Fresh" : "Market closed; latest data is from the last session." };
  } catch (e) {
    return { status: "missing", message: `Price source unreachable: ${(e as Error).message}`, market_open: open, last_h1_close: null, provider: "Yahoo Finance", is_fixture: false };
  }
}

export async function evaluationsFor(inst: string) {
  const ix = await loadIndex(inst);
  return [...ix.evaluations].sort((a, b) => b.period_key.localeCompare(a.period_key)).slice(0, 60).map((e) => ({
    period_key: e.period_key, kind: e.kind, direction: e.direction, qualification: e.qualification, version: e.version, directional: e.directional,
    detail: e.detail, conditional: e.conditional, evaluated_display: stamp(e.evaluated_at), outlook_version_id: e.outlook_version_id,
  }));
}

export const instOf = (id: string) => parseId(id).inst;
export const recentWeeks = (n = 4) => Array.from({ length: n }, (_, i) => addDays(monday(dateIn(Date.now())), -7 * i));

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

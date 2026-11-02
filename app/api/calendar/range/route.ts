import { after } from "next/server";
import { HttpError, json, param, read } from "@/lib/http.ts";
import { lastSync, syncActuals } from "@/lib/data/actuals.ts";
import { stamp } from "@/lib/dates.ts";
import { calendarRange } from "@/lib/views.ts";
import { FEED_MAX_AGE_MS, currentWeekFetchedAt, ensureCalendarFresh } from "@/lib/data/calendar.ts";
import { dateIn, monday } from "@/lib/dates.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // room for the background actuals sync

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const list = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** All calendar events between two dates (display timezone), optionally filtered by currency and impact.
 *  Answers from stored data at once; recent actual results are fetched after the response (throttled), so they
 *  appear on the next refresh. */
export const GET = read(async (req) => {
  const t0 = Date.now();
  // Timing in the response (Server-Timing) and in the Vercel logs when slow, to show where any delay comes from.
  const timed = (res: Response) => {
    const ms = Date.now() - t0;
    res.headers.set("Server-Timing", `calendar;dur=${ms}`);
    if (ms > 3000) console.log(`calendar range ${req.url.split("?")[1] ?? ""} took ${ms} ms`);
    return res;
  };
  const from = param(req, "from") ?? "", to = param(req, "to") ?? from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new HttpError(400, "from and to (YYYY-MM-DD) are required");
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 45) throw new HttpError(400, "ranges are limited to 45 days");
  // Forex Factory's weekly feed is fetched automatically: before answering when the current week is not stored yet
  // (a new week shows on the first visit), otherwise after the response when it is more than an hour old.
  const now = Date.now(), fetchedAt = await currentWeekFetchedAt(now);
  const thisWeek = monday(dateIn(now, "America/New_York")), touchesThisWeek = from <= addDaysIso(thisWeek, 6) && to >= addDaysIso(thisWeek, -1);
  let refreshing = false;
  if (fetchedAt == null && touchesThisWeek) {
    await Promise.race([ensureCalendarFresh(now), new Promise((r) => setTimeout(r, 10_000))]);
  } else if (fetchedAt == null || now - fetchedAt > FEED_MAX_AGE_MS) {
    refreshing = true;
    after(() => ensureCalendarFresh().then(() => undefined));
  }
  after(() => syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000).then(() => undefined, () => undefined));
  if (param(req, "shape") === "dates") { // the month grid only needs which days have events
    const cal = await calendarRange(from, to, { currencies: list(param(req, "currencies")).map((c) => c.toUpperCase()), impacts: list(param(req, "impacts")) });
    return timed(json({ dates: [...new Set(cal.rows.map((r) => r.date))], currencies: cal.currencies }));
  }
  const [cal, sync] = await Promise.all([
    calendarRange(from, to, { currencies: list(param(req, "currencies")).map((c) => c.toUpperCase()), impacts: list(param(req, "impacts")) }),
    lastSync(),
  ]);
  const feedAt = await currentWeekFetchedAt(now);
  return timed(json({ ...cal, refreshing, feed_fetched_display: feedAt ? stamp(feedAt) : null, actuals_sync: sync?.result ?? null, actuals_synced_display: sync?.at ? stamp(sync.at) : null }));
});

import { after } from "next/server";
import { HttpError, json, param, read } from "@/lib/http.ts";
import { lastSync, syncActuals } from "@/lib/data/actuals.ts";
import { stamp } from "@/lib/dates.ts";
import { calendarRange } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // room for the background actuals sync

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
  after(() => syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000).then(() => undefined, () => undefined));
  if (param(req, "shape") === "dates") { // the month grid only needs which days have events
    const cal = await calendarRange(from, to, { currencies: list(param(req, "currencies")).map((c) => c.toUpperCase()), impacts: list(param(req, "impacts")) });
    return timed(json({ dates: [...new Set(cal.rows.map((r) => r.date))], currencies: cal.currencies }));
  }
  const [cal, sync] = await Promise.all([
    calendarRange(from, to, { currencies: list(param(req, "currencies")).map((c) => c.toUpperCase()), impacts: list(param(req, "impacts")) }),
    lastSync(),
  ]);
  return timed(json({ ...cal, actuals_sync: sync?.result ?? null, actuals_synced_display: sync?.at ? stamp(sync.at) : null }));
});

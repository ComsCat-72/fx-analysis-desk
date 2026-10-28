import { stamp } from "@/lib/dates.ts";
import { strength } from "@/lib/data/strength.ts";
import { HttpError, json, read } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

/** Currency strength today and this week, from Yahoo Finance quotes (cached for a minute). */
export const GET = read(async () => {
  try {
    const v = await strength();
    return json({ ...v, as_of_display: stamp(v.as_of), today_start_display: stamp(v.today_start), week_start_display: stamp(v.week_start),
      quotes: v.quotes.map((q) => ({ ...q, time_display: q.time ? stamp(q.time) : null })) });
  } catch (e) { throw new HttpError(502, (e as Error).message); }
});

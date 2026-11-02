import { HttpError, json, read } from "@/lib/http.ts";
import { ensureCalendarFresh } from "@/lib/data/calendar.ts";

export const dynamic = "force-dynamic";

/** Fetch Forex Factory's feed now unless it was fetched in the last 15 minutes. Public data and throttled, so no
 *  admin token is needed. */
export const POST = read(async () => {
  const r = await ensureCalendarFresh(Date.now(), { maxAgeMs: 15 * 60_000 });
  if (r.error) throw new HttpError(502, `calendar provider failed: ${r.error}`);
  return json(r);
});

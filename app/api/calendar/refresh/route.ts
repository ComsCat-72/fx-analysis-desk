import { HttpError, json, write } from "@/lib/http.ts";
import { refreshCalendar } from "@/lib/data/calendar.ts";

export const dynamic = "force-dynamic";

export const POST = write(async () => {
  try { return json(await refreshCalendar()); } catch (e) { throw new HttpError(502, `calendar provider failed: ${(e as Error).message}`); }
});

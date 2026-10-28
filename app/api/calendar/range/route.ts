import { HttpError, json, param, read } from "@/lib/http.ts";
import { calendarRange } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

const list = (v: string | null) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** All calendar events between two dates (display timezone), optionally filtered by currency and impact. */
export const GET = read(async (req) => {
  const from = param(req, "from") ?? "", to = param(req, "to") ?? from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new HttpError(400, "from and to (YYYY-MM-DD) are required");
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 45) throw new HttpError(400, "ranges are limited to 45 days");
  return json(await calendarRange(from, to, { currencies: list(param(req, "currencies")).map((c) => c.toUpperCase()), impacts: list(param(req, "impacts")) }));
});

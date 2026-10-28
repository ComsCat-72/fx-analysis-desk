import { HttpError, json, param, read } from "@/lib/http.ts";
import { syncActuals } from "@/lib/data/actuals.ts";
import { calendarRows } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

export const GET = read(async (req) => {
  const inst = param(req, "instrument"), week = param(req, "week_key");
  if (!inst || !week) throw new HttpError(400, "instrument and week_key are required");
  const start = Date.parse(`${week}T00:00:00Z`);
  await syncActuals(start - 2 * 86400_000, start + 7 * 86400_000);
  return json(await calendarRows(inst, week));
});

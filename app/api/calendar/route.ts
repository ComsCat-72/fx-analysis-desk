import { HttpError, json, param, read } from "@/lib/http.ts";
import { calendarRows } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

export const GET = read(async (req) => {
  const inst = param(req, "instrument"), week = param(req, "week_key");
  if (!inst || !week) throw new HttpError(400, "instrument and week_key are required");
  return json(await calendarRows(inst, week));
});

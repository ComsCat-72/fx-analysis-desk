import { after } from "next/server";
import { HttpError, json, param, read } from "@/lib/http.ts";
import { syncActuals } from "@/lib/data/actuals.ts";
import { calendarRows } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // room for the background actuals sync

export const GET = read(async (req) => {
  const inst = param(req, "instrument"), week = param(req, "week_key");
  if (!inst || !week) throw new HttpError(400, "instrument and week_key are required");
  after(() => syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000).then(() => undefined, () => undefined));
  return json(await calendarRows(inst, week));
});

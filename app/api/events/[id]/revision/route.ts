import { HttpError, body, json, write, type Ctx } from "@/lib/http.ts";
import { recordValue } from "@/lib/data/calendar.ts";

export const dynamic = "force-dynamic";

/** Event ids from /api/calendar are "{week}:{event}". Values are appended to the event history, never overwritten. */
export const POST = write<Ctx<{ id: string }>>(async (req, { params }) => {
  const [week, id] = decodeURIComponent((await params).id).split(":");
  const b = await body<{ value: string; source: string; url?: string }>(req);
  if (!b.value?.trim() || !b.source?.trim()) throw new HttpError(400, "value and source are required");
  try { await recordValue(week, id, "revised_previous", b.value, b.source.trim(), b.url || null); } catch { throw new HttpError(404, "no such event"); }
  return json({ ok: true });
});

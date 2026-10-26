import { addLevels } from "@/lib/data/levels.ts";
import { HttpError, body, json, write, type Ctx } from "@/lib/http.ts";
import { update } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

interface LevelIn { lower: number; upper: number; timeframe?: string; role: "support" | "resistance"; reason: string; approximate?: boolean }

export const POST = write<Ctx<{ id: string }>>(async (req, { params }) => {
  const id = decodeURIComponent((await params).id), inst = id.split("-")[0];
  const b = await body<{ levels: LevelIn[]; chart_timestamp?: string }>(req);
  const at = b.chart_timestamp ? Date.parse(b.chart_timestamp) : Date.now();
  if (Number.isNaN(at)) throw new HttpError(400, "chart_timestamp is not a valid time");
  for (const l of b.levels ?? []) if ((l.role !== "support" && l.role !== "resistance") || !(+l.lower <= +l.upper)) throw new HttpError(400, "each level needs a role and lower <= upper");
  let found = false;
  await update<{ items: { id: string; status: string }[] }>(`screenshots/${inst}.json`, () => ({ items: [] }), (d) => {
    const s = d.items.find((x) => x.id === id);
    if (s) { s.status = "confirmed"; found = true; }
  });
  if (!found) throw new HttpError(404, "no such screenshot");
  const ids = await addLevels(inst, (b.levels ?? []).map((l) => ({ lower: +l.lower, upper: +l.upper, timeframe: l.timeframe ?? "H1", role: l.role, origin: "screenshot" as const,
    reason: l.reason || "screenshot reading", approximate: l.approximate ?? true, sourceRef: `screenshot:${id}`, createdAt: at })));
  return json({ level_ids: ids });
});

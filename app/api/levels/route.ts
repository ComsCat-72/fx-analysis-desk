import { CONFIG } from "@/lib/config.ts";
import { addLevels, levelsFor } from "@/lib/data/levels.ts";
import { stamp } from "@/lib/dates.ts";
import { HttpError, body, json, param, read, write } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export const GET = read(async (req) => {
  const inst = param(req, "instrument") ?? "";
  if (!CONFIG.instruments[inst]) throw new HttpError(400, "unknown instrument");
  return json((await levelsFor(inst)).slice(0, 100).map((l) => ({ id: l.id, lower: l.lower, upper: l.upper, timeframe: l.timeframe, role: l.role, origin: l.origin,
    reason: l.reason, status: l.status, approximate: l.approximate, created_display: stamp(l.createdAt), is_fixture: false })));
});

export const POST = write(async (req) => {
  const b = await body<{ instrument: string; lower: number; upper: number; timeframe?: string; role: string; reason: string; approximate?: boolean }>(req);
  if (!CONFIG.instruments[b.instrument]) throw new HttpError(400, "unknown instrument");
  if ((b.role !== "support" && b.role !== "resistance") || !(Number(b.lower) <= Number(b.upper)) || !b.reason?.trim())
    throw new HttpError(400, "role must be support/resistance, lower <= upper, and a reason is required");
  const [id] = await addLevels(b.instrument, [{ lower: +b.lower, upper: +b.upper, timeframe: b.timeframe ?? "H1", role: b.role, origin: "user", reason: b.reason.trim(),
    approximate: !!b.approximate, sourceRef: null, createdAt: Date.now() }]);
  return json({ id });
});

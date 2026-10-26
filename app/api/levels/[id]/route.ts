import { setLevelStatus } from "@/lib/data/levels.ts";
import { HttpError, body, json, write, type Ctx } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export const PATCH = write<Ctx<{ id: string }>>(async (req, { params }) => {
  const id = decodeURIComponent((await params).id);
  const b = await body<{ status: string; reason: string }>(req);
  if (!["invalidated", "archived", "active"].includes(b.status)) throw new HttpError(400, "manual status changes: invalidated, archived or active");
  const inst = id.split("-")[0];
  try {
    const l = await setLevelStatus(inst, id, b.status as "active", b.reason ?? "");
    return json({ id: l.id, status: l.status });
  } catch { throw new HttpError(404, "no such level"); }
});

import { HttpError, body, json, write, type Ctx } from "@/lib/http.ts";
import { correct } from "@/lib/reports/service.ts";
import { reportDetail } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = write<Ctx<{ id: string }>>(async (req, { params }) => {
  const b = await body<{ version_type?: string; writer?: string }>(req);
  const t = b.version_type ?? "correction";
  if (t !== "correction" && t !== "update") throw new HttpError(400, "version_type must be correction or update");
  const v = await correct((await params).id, t, b.writer || null);
  return json(await reportDetail(v.id));
});

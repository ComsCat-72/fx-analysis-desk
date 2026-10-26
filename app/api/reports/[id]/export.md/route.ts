import { HttpError, read, type Ctx } from "@/lib/http.ts";
import { getVersion } from "@/lib/reports/service.ts";

export const dynamic = "force-dynamic";

export const GET = read<Ctx<{ id: string }>>(async (_req, { params }) => {
  const v = await getVersion((await params).id);
  if (!v) throw new HttpError(404, "no such report version");
  return new Response(v.body_md, { headers: { "content-type": "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${v.instrument}_${v.kind}_${v.period_key}_v${v.version}.md"` } });
});

import { body, json, write, type Ctx } from "@/lib/http.ts";
import { publish } from "@/lib/reports/service.ts";
import { reportDetail } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

export const POST = write<Ctx<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const b = await body<{ change_note?: string; allow_partial?: boolean }>(req);
  await publish(id, b.change_note || null, !!b.allow_partial);
  return json(await reportDetail(id));
});

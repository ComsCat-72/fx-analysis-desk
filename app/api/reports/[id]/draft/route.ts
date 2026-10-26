import { body, json, write, type Ctx } from "@/lib/http.ts";
import { updateDraft } from "@/lib/reports/service.ts";
import type { OutlookIn } from "@/lib/reports/types.ts";
import { reportDetail } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const PUT = write<Ctx<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const b = await body<{ sections: Record<string, string>; outlook?: OutlookIn | null }>(req);
  await updateDraft(id, b.sections, b.outlook);
  return json(await reportDetail(id));
});

import { CONFIG, KINDS, type Kind } from "@/lib/config.ts";
import { HttpError, body, json, write } from "@/lib/http.ts";
import { generateDraft } from "@/lib/reports/service.ts";
import { reportDetail } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = write(async (req) => {
  const b = await body<{ instrument: string; kind: Kind; period: string; writer?: string }>(req);
  if (!CONFIG.instruments[b.instrument]) throw new HttpError(400, "unknown instrument");
  if (!KINDS.includes(b.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(b.period ?? "")) throw new HttpError(400, "kind and period (YYYY-MM-DD) are required");
  const v = await generateDraft(b.instrument, b.kind, b.period, { writer: b.writer || null });
  return json({ ...(await reportDetail(v.id)), refresh_problems: [] });
});

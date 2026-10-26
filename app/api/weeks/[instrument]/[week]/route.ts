import { json, read, type Ctx } from "@/lib/http.ts";
import { weekView } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

export const GET = read<Ctx<{ instrument: string; week: string }>>(async (_req, { params }) => {
  const p = await params;
  return json(await weekView(p.instrument, p.week));
});

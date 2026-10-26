import { json, read, type Ctx } from "@/lib/http.ts";
import { reportDetail } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

export const GET = read<Ctx<{ id: string }>>(async (_req, { params }) => json(await reportDetail((await params).id)));

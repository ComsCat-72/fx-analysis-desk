import { json, read, type Ctx } from "@/lib/http.ts";
import { eventDetail } from "@/lib/views.ts";

export const dynamic = "force-dynamic";

/** Value history for one calendar event (loaded when its row is opened). */
export const GET = read<Ctx<{ id: string }>>(async (_req, { params }) => json(await eventDetail(decodeURIComponent((await params).id))));

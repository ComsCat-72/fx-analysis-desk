import { authorized, protectReads, tokenRequired } from "@/lib/auth.ts";
import { json } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return json({ token_required: tokenRequired(), protect_reads: protectReads(), valid: authorized(req) });
}

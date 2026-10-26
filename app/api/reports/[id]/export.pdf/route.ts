import type { Ctx } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

/** PDF export is the browser's "Save as PDF" on a print-styled page (no server-side PDF engine needed). */
export async function GET(req: Request, { params }: Ctx<{ id: string }>) {
  const u = new URL(req.url);
  const token = u.searchParams.get("token");
  return Response.redirect(new URL(`/print/${encodeURIComponent((await params).id)}${token ? `?token=${encodeURIComponent(token)}` : ""}`, u.origin), 302);
}

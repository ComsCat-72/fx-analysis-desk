import { HttpError, read, type Ctx } from "@/lib/http.ts";
import { readFile } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

/** Local development only: serves files from the .data/ store (deployments use Vercel Blob URLs). */
export const GET = read<Ctx<{ path: string[] }>>(async (_req, { params }) => {
  if (process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(404, "not found");
  const p = (await params).path.join("/");
  if (p.includes("..")) throw new HttpError(400, "bad path");
  const data = await readFile(p);
  if (!data) throw new HttpError(404, "not found");
  const type = p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") ? "image/jpeg" : p.endsWith(".webp") ? "image/webp" : "application/json";
  return new Response(new Uint8Array(data), { headers: { "content-type": type } });
});

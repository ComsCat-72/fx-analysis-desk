import { env } from "@/lib/config.ts";
import { json } from "@/lib/http.ts";
import { probeRead, storageMode } from "@/lib/store.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Liveness plus storage mode and which credentials are present (never their values).
 *  ?probe=<document>.json times each step of reading that stored document (diagnostics; reads only). */
export async function GET(req: Request) {
  const probe = new URL(req.url).searchParams.get("probe");
  if (probe && /^[a-z0-9_-]+(\/[a-z0-9_.-]+)*\.json$/i.test(probe) && !probe.includes("..")) return json(await probeRead(probe));
  return json({ ok: true, app_env: env.appEnv, storage: storageMode(), persistent_storage: storageMode() === "vercel-blob" || !process.env.VERCEL,
    data_source: env.dataSource, admin_token: !!process.env.ADMIN_TOKEN, cron_secret: !!process.env.CRON_SECRET });
}

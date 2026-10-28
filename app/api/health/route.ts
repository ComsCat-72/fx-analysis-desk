import { env } from "@/lib/config.ts";
import { json } from "@/lib/http.ts";
import { storageMode } from "@/lib/store.ts";

export const dynamic = "force-dynamic";

/** Liveness plus storage mode and which credentials are present (never their values). */
export async function GET() {
  return json({ ok: true, app_env: env.appEnv, storage: storageMode(), persistent_storage: storageMode() === "vercel-blob" || !process.env.VERCEL,
    data_source: env.dataSource, admin_token: !!process.env.ADMIN_TOKEN, cron_secret: !!process.env.CRON_SECRET });
}

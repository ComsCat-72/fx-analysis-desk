// Daily Vercel Cron (07:00 EAT, see vercel.json). Fans out one /api/generate call per instrument so
// each instrument gets its own time budget; the weekday decides which reports are written.
import { authorized } from "@/lib/auth.ts";
import { CONFIG } from "@/lib/config.ts";
import { todayLocal } from "@/lib/dates.ts";
import { dueJobs } from "@/lib/generate.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "not authorised" }, { status: 401 });
  const today = todayLocal();
  const origin = new URL(req.url).origin;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  const calls = CONFIG.scheduled.map(async (instrument) => {
    const res = await fetch(`${origin}/api/generate`, { method: "POST", headers, body: JSON.stringify({ instrument }) });
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    return { instrument, status: res.status, ...body };
  });
  const settled = await Promise.allSettled(calls);
  return Response.json({
    today, due: dueJobs(today),
    results: settled.map((s, i) => (s.status === "fulfilled" ? s.value : { instrument: CONFIG.scheduled[i], error: String(s.reason) })),
  });
}

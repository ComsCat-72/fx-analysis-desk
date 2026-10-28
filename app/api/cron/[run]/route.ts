// Vercel Cron (vercel.json): /api/cron/reviews at 03:00 UTC Tue–Sat, /api/cron/analyses at 05:00 UTC daily.
// Refreshes the calendar, central-bank and headline feeds once, then fans out one /api/jobs/run call per instrument so each
// instrument's report runs in its own function invocation with its own time budget.
import { authorized } from "@/lib/auth.ts";
import { CONFIG } from "@/lib/config.ts";
import { refreshCalendar } from "@/lib/data/calendar.ts";
import { refreshHeadlines } from "@/lib/data/headlines.ts";
import { syncActuals } from "@/lib/data/actuals.ts";
import { refreshPolicy } from "@/lib/data/policy.ts";
import { getSettings } from "@/lib/settings.ts";
import { json, type Ctx } from "@/lib/http.ts";
import { dueJobs } from "@/lib/reports/service.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: Ctx<{ run: string }>) {
  if (!authorized(req)) return json({ detail: "not authorised" }, 401);
  const run = (await params).run;
  if (run !== "reviews" && run !== "analyses") return json({ detail: "unknown run" }, 404);
  await getSettings(); // display timezone decides which weekday it is
  const jobs = dueJobs(run);
  if (!jobs.length) return json({ run, jobs, results: [] });
  const inputs: PromiseSettledResult<unknown>[] = await Promise.allSettled([refreshCalendar(), refreshPolicy(), refreshHeadlines()]);
  inputs.push(...await Promise.allSettled([syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000, { minGapMs: 0 })])); // actuals before the reports read them
  const origin = new URL(req.url).origin;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  const calls = CONFIG.scheduled.flatMap((instrument) => jobs.map(async (job) => {
    try {
      const r = await fetch(`${origin}/api/jobs/run`, { method: "POST", headers, body: JSON.stringify({ job, instrument }), signal: AbortSignal.timeout(285_000) });
      return { instrument, job, http: r.status, ...(await r.json().catch(() => ({}))) };
    } catch (e) {
      return { instrument, job, status: "unknown", detail: `no reply before the cron timed out (the job keeps running): ${(e as Error).message}` };
    }
  }));
  return json({ run, jobs, inputs: inputs.map((x) => (x.status === "fulfilled" ? x.value : String(x.reason))), results: await Promise.all(calls) });
}

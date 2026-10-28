// Vercel Cron (vercel.json), once a day: refreshes the calendar, actual results, central-bank and headline feeds,
// central-bank rate decisions and the COT report. Pages also refresh what they show when it is stale.
import { authorized } from "@/lib/auth.ts";
import { syncActuals } from "@/lib/data/actuals.ts";
import { refreshBanks } from "@/lib/data/banks.ts";
import { refreshCalendar } from "@/lib/data/calendar.ts";
import { refreshCot } from "@/lib/data/cot.ts";
import { refreshHeadlines } from "@/lib/data/headlines.ts";
import { refreshPolicy } from "@/lib/data/policy.ts";
import { json } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!authorized(req)) return json({ detail: "not authorised" }, 401);
  const names = ["calendar", "policy", "headlines", "banks", "cot"];
  const r = await Promise.allSettled([refreshCalendar(), refreshPolicy(), refreshHeadlines(), refreshBanks(), refreshCot()]);
  const a = await syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000, { minGapMs: 0 }).catch((e) => ({ error: String(e) }));
  return json({ ...Object.fromEntries(names.map((n, i) => [n, r[i].status === "fulfilled" ? "ok" : String((r[i] as PromiseRejectedResult).reason)])), actuals: a });
}

// Vercel Cron (vercel.json), once a day, and the keep-fresh GitHub workflow's safety net: refreshes the calendar,
// actual results, central-bank and headline feeds, rate decisions and the COT report. Each source runs on its own
// with a time limit, so one failing or slow source never stops the others. Pages also refresh what they show.
import { authorized } from "@/lib/auth.ts";
import { syncActuals } from "@/lib/data/actuals.ts";
import { refreshBanks } from "@/lib/data/banks.ts";
import { ensureCalendarFresh } from "@/lib/data/calendar.ts";
import { refreshCot } from "@/lib/data/cot.ts";
import { refreshHeadlines } from "@/lib/data/headlines.ts";
import { refreshPolicy } from "@/lib/data/policy.ts";
import { json } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const within = <T,>(ms: number, p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`no answer within ${ms / 1000} s`)), ms))]);
const outcome = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return `failed: ${(e as Error).message}`; } };

export async function GET(req: Request) {
  if (!authorized(req)) return json({ detail: "not authorised" }, 401);
  const calendar = await within(20_000, ensureCalendarFresh()).catch((e) => ({ error: String(e) })); // first: the others read it
  const [policy, headlines, banks, cot] = await Promise.all([
    outcome(within(30_000, refreshPolicy())), outcome(within(30_000, refreshHeadlines())), outcome(within(45_000, refreshBanks())), outcome(within(20_000, refreshCot())),
  ]);
  const actuals = await within(30_000, syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000, { minGapMs: 0 })).catch((e) => ({ error: String(e) }));
  return json({ calendar, policy, headlines, banks, cot, actuals });
}

import { CONFIG } from "@/lib/config.ts";
import { refreshCalendar } from "@/lib/data/calendar.ts";
import { refreshHeadlines } from "@/lib/data/headlines.ts";
import { syncActuals } from "@/lib/data/actuals.ts";
import { refreshPolicy } from "@/lib/data/policy.ts";
import { HttpError, body, json, write } from "@/lib/http.ts";
import { freshness } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fetch the economic calendar, central-bank and headline feeds now, and check the price source for one instrument. */
export const POST = write(async (req) => {
  const b = await body<{ instrument: string }>(req);
  if (!CONFIG.instruments[b.instrument]) throw new HttpError(400, "unknown instrument");
  const problems: string[] = [];
  await refreshCalendar().catch((e) => problems.push(`calendar: ${(e as Error).message}`));
  const p = await refreshPolicy().catch((e) => ({ errors: [`central banks: ${(e as Error).message}`] }));
  problems.push(...p.errors);
  const h = await refreshHeadlines().catch((e) => ({ errors: [`headlines: ${(e as Error).message}`] }));
  problems.push(...h.errors);
  const a = await syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000, { minGapMs: 0 });
  if (a.error) problems.push(`actual results: ${a.error}`);
  const f = await freshness(b.instrument);
  if (f.status === "missing") problems.push(`prices: ${f.message}`);
  return json({ problems, freshness: f });
});

import { CONFIG } from "@/lib/config.ts";
import { refreshCalendar } from "@/lib/data/calendar.ts";
import { refreshPolicy } from "@/lib/data/policy.ts";
import { HttpError, body, json, write } from "@/lib/http.ts";
import { freshness } from "@/lib/views.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fetch the economic calendar and central-bank feeds now, and check the price source for one instrument. */
export const POST = write(async (req) => {
  const b = await body<{ instrument: string }>(req);
  if (!CONFIG.instruments[b.instrument]) throw new HttpError(400, "unknown instrument");
  const problems: string[] = [];
  await refreshCalendar().catch((e) => problems.push(`calendar: ${(e as Error).message}`));
  const p = await refreshPolicy().catch((e) => ({ errors: [`central banks: ${(e as Error).message}`] }));
  problems.push(...p.errors);
  const f = await freshness(b.instrument);
  if (f.status === "missing") problems.push(`prices: ${f.message}`);
  return json({ problems, freshness: f });
});

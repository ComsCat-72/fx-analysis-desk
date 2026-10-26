import { CONFIG, KINDS, type Kind } from "@/lib/config.ts";
import { HttpError, body, json, write } from "@/lib/http.ts";
import { runJob } from "@/lib/reports/service.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One job for one instrument (the cron fans out to this so each instrument gets its own time budget). */
export const POST = write(async (req) => {
  const started = Date.now();
  const b = await body<{ job: Kind; instrument: string; force?: boolean; writer?: string }>(req);
  if (!KINDS.includes(b.job) || !CONFIG.instruments[b.instrument]) throw new HttpError(400, "unknown job or instrument");
  return json(await runJob(b.job, b.instrument, { force: !!b.force, writer: b.writer || null, deadline: started + 285_000 }));
});

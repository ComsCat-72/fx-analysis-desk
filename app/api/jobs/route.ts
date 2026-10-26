import { CONFIG } from "@/lib/config.ts";
import { json, read } from "@/lib/http.ts";
import { loadIndex } from "@/lib/reports/service.ts";

export const dynamic = "force-dynamic";

export const GET = read(async () => {
  const all = (await Promise.all(Object.keys(CONFIG.instruments).map(loadIndex))).flatMap((ix) => ix.jobs);
  return json(all.sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 50).map((j) => ({ job: j.job, slot: j.slot, instrument: j.instrument, status: j.status,
    attempts: j.attempts, error: j.error, started_display: j.started_display, version_id: j.version_id, detail: j.detail ?? null })));
});

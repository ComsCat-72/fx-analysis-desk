import { stamp } from "@/lib/dates.ts";
import { HttpError, json, param, read } from "@/lib/http.ts";
import { loadIndex } from "@/lib/reports/service.ts";
import { CONFIG } from "@/lib/config.ts";

export const dynamic = "force-dynamic";

/** Data-quality warnings from the latest report built for the instrument, plus failed jobs. */
export const GET = read(async (req) => {
  const inst = param(req, "instrument") ?? "";
  if (!CONFIG.instruments[inst]) throw new HttpError(400, "unknown instrument");
  const ix = await loadIndex(inst);
  const ws = ix.warnings.filter((w) => w.code !== "fixture_data").map((w, i) => ({ id: i, code: w.code, severity: w.severity, message: w.message, created_display: stamp(w.at) }));
  const failed = ix.jobs.filter((j) => j.status === "failed").slice(-3).map((j, i) => ({ id: 1000 + i, code: "job_failed", severity: "warning",
    message: `${j.job} for ${j.slot} failed: ${j.error}`, created_display: j.started_display }));
  return json([...failed, ...ws]);
});

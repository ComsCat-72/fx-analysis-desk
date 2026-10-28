import { stamp } from "@/lib/dates.ts";
import { HttpError, json, param, read } from "@/lib/http.ts";
import { loadIndex } from "@/lib/reports/service.ts";
import { CONFIG } from "@/lib/config.ts";
import { headlinesDoc } from "@/lib/data/headlines.ts";
import { lastSync } from "@/lib/data/actuals.ts";
import { getJSON } from "@/lib/store.ts";
import type { PolicyDoc } from "@/lib/data/policy.ts";

export const dynamic = "force-dynamic";

/** Data-quality warnings from the latest report built for the instrument, failed jobs, and feed (provider) errors. */
export const GET = read(async (req) => {
  const inst = param(req, "instrument") ?? "";
  if (!CONFIG.instruments[inst]) throw new HttpError(400, "unknown instrument");
  const ix = await loadIndex(inst);
  const ws = ix.warnings.filter((w) => w.code !== "fixture_data").map((w, i) => ({ id: i, code: w.code, severity: w.severity, message: w.message, created_display: stamp(w.at) }));
  const failed = ix.jobs.filter((j) => j.status === "failed").slice(-3).map((j, i) => ({ id: 1000 + i, code: "job_failed", severity: "warning",
    message: `${j.job} for ${j.slot} failed: ${j.error}`, created_display: j.started_display }));
  const [policy, heads] = await Promise.all([getJSON<PolicyDoc>("policy.json"), headlinesDoc()]);
  const feeds = [["Central-bank feed", policy], ["Headline feed", heads]] as const;
  const provider = feeds.flatMap(([what, doc], k) => (doc?.errors ?? []).slice(0, 4).map((e, i) => ({ id: 2000 + k * 100 + i, code: "provider_error", severity: "info",
    message: `${what} unavailable at the last refresh: ${e}`, created_display: doc?.refreshedAt ? stamp(doc.refreshedAt) : "" })));
  const sync = await lastSync();
  if (sync?.result.error) provider.push({ id: 2999, code: "provider_error", severity: "info", message: `Actual results: ${sync.result.error}`, created_display: stamp(sync.at) });
  return json([...failed, ...ws, ...provider]);
});

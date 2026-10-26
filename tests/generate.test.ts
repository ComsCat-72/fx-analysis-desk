import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Use a throwaway local store (no Blob token) so tests never touch the network.
delete process.env.BLOB_READ_WRITE_TOKEN;
process.chdir(mkdtempSync(path.join(tmpdir(), "fxdesk-")));
const { dueJobs, normalisePeriod, earlierReports } = await import("../lib/generate.ts");
const { saveReport } = await import("../lib/storage.ts");

test("what the daily cron writes on each weekday", () => {
  assert.deepEqual(dueJobs("2026-11-15"), [{ kind: "weekly_analysis", period: "2026-11-16" }]);                // Sunday
  assert.deepEqual(dueJobs("2026-11-16"), [{ kind: "daily_analysis", period: "2026-11-16" }]);                 // Monday
  assert.deepEqual(dueJobs("2026-11-17"), [{ kind: "daily_review", period: "2026-11-16" },
                                           { kind: "daily_analysis", period: "2026-11-17" }]);                 // Tuesday
  assert.deepEqual(dueJobs("2026-11-21"), [{ kind: "daily_review", period: "2026-11-20" },
                                           { kind: "weekly_review", period: "2026-11-16" }]);                  // Saturday
});

test("weekly reports are keyed by the Monday of their week", () => {
  assert.equal(normalisePeriod("weekly_analysis", "2026-11-15"), "2026-11-16"); // Sunday -> coming week
  assert.equal(normalisePeriod("weekly_analysis", "2026-11-18"), "2026-11-16");
  assert.equal(normalisePeriod("weekly_review", "2026-11-21"), "2026-11-16");
  assert.equal(normalisePeriod("daily_review", "2026-11-17"), "2026-11-17");
});

test("continuity: each report sees exactly the reports it must stay consistent with", async () => {
  const meta = (kind: string, period: string) => ({ instrument: "GBP_USD", kind, period, published: "2026-11-16T04:00:00Z", model: "m", check: "ok" }) as never;
  for (const [kind, period] of [["weekly_review", "2026-11-09"], ["weekly_analysis", "2026-11-16"], ["daily_analysis", "2026-11-16"],
                                ["daily_review", "2026-11-16"], ["daily_analysis", "2026-11-17"]]) {
    await saveReport({ slug: `${period}_${kind}`, markdown: `# ${kind} ${period}`, meta: meta(kind, period) });
  }
  const slugs = async (kind: never, p: string) => (await earlierReports("GBP_USD", kind, p)).map((r) => r.slug);
  assert.deepEqual(await slugs("daily_analysis" as never, "2026-11-17"),
    ["2026-11-16_daily_analysis", "2026-11-16_daily_review", "2026-11-16_weekly_analysis"]);
  assert.deepEqual(await slugs("daily_review" as never, "2026-11-17"),
    ["2026-11-16_daily_analysis", "2026-11-16_daily_review", "2026-11-16_weekly_analysis", "2026-11-17_daily_analysis"]);
  assert.deepEqual(await slugs("weekly_analysis" as never, "2026-11-16"), ["2026-11-09_weekly_review"]);
});

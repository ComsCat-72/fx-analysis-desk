// End-to-end on DEVELOPMENT FIXTURE data, the offline template writer and a local temporary store.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_SOURCE = "fixture";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.BLOB_READ_WRITE_TOKEN;

const { useLocalStore, putImmutable, ImmutableError } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "fxdesk-")));
const svc = await import("../lib/reports/service.ts");
const { dayWindow } = await import("../lib/core/sessions.ts");
const { CONFIG } = await import("../lib/config.ts");
const { addDays, isWeekday, monday, todayLocal } = await import("../lib/dates.ts");

// A completed weekday in last week, so its whole session exists in the fixture series.
let day = addDays(monday(todayLocal()), -5); // Wednesday of last week
while (!isWeekday(day)) day = addDays(day, 1);
const inst = "GBP_USD";
const win = dayWindow(CONFIG.instruments[inst].session, day);

test("weekly analysis -> daily analysis -> review, with continuity and immutability", async () => {
  const wa = await svc.generateDraft(inst, "weekly_analysis", monday(day), { cutoff: win.start - 48 * 3600_000, writer: "template" });
  assert.equal(wa.status, "draft");
  assert.match(wa.body_md, /DEVELOPMENT FIXTURE/);
  assert.equal(wa.checks.blocking, 0, JSON.stringify(wa.checks.findings.filter((f) => f.severity === "blocking"), null, 1));
  const waPub = await svc.publish(wa.id, null, false, Date.parse(wa.data_cutoff) + 60_000); // published before the daily cutoff
  assert.equal(waPub.status, "published");
  assert.ok(waPub.outlook);

  const da = await svc.generateDraft(inst, "daily_analysis", day, { cutoff: win.start + 3 * 3600_000, writer: "template" });
  assert.equal(da.facts.continuity.weekly.version_id, wa.id, "daily analysis cites the stored weekly outlook");
  assert.equal(da.checks.blocking, 0, JSON.stringify(da.checks.findings.filter((f) => f.severity === "blocking"), null, 1));
  const daPub = await svc.publish(da.id, null, false, Date.parse(da.data_cutoff) + 60_000);

  // Published versions are write-once: the store refuses an overwrite and the service refuses a re-publish.
  await assert.rejects(putImmutable(`reports/${inst}/daily_analysis/${day}/v1.json`, { tampered: true }), ImmutableError);
  await assert.rejects(svc.publish(da.id), /not a draft/);
  assert.equal((await svc.getVersion(da.id))!.body_md, daPub.body_md);

  const rv = await svc.generateDraft(inst, "daily_review", day, { cutoff: win.end + 3600_000, writer: "template" });
  const ev = rv.facts.evaluation!;
  assert.equal(ev.original.version_id, da.id, "the review is assessed against the original published outlook");
  assert.ok(["Supported", "Not supported", "Mixed", "Inconclusive"].includes(ev.directional.outcome));
  assert.match(rv.body_md, /Directional assessment/);
  const rvPub = await svc.publish(rv.id);
  assert.ok(rvPub.evaluation);
  const ix = await svc.loadIndex(inst);
  assert.equal(ix.evaluations.length, 1);

  // A correction is a new version that needs a change note; the original stays untouched.
  const corr = await svc.correct(da.id, "correction");
  assert.equal(corr.version, 2);
  assert.equal(corr.data_cutoff, da.data_cutoff);
  await assert.rejects(svc.publish(corr.id), /change note/);
  await svc.publish(corr.id, "Wording fix");
  assert.equal((await svc.getVersion(da.id))!.content_hash, daPub.content_hash);
});

test("schedule slots", () => {
  const sat = Date.parse("2026-10-31T05:00:00Z"), tue = Date.parse("2026-10-27T03:00:00Z"), sun = Date.parse("2026-11-01T05:00:00Z");
  assert.deepEqual(svc.dueJobs("reviews", tue), ["daily_review"]);
  assert.deepEqual(svc.dueJobs("analyses", sat), ["weekly_review"]);
  assert.deepEqual(svc.dueJobs("analyses", sun), ["weekly_analysis"]);
  assert.equal(svc.slotFor("daily_review", "DXY", tue), "2026-10-26");
  assert.equal(svc.slotFor("daily_review", "NAS100", tue), "2026-10-26");
  assert.equal(svc.slotFor("weekly_review", "GBP_USD", sat), "2026-10-26");
  assert.equal(svc.slotFor("weekly_analysis", "GBP_USD", sun), "2026-11-02");
  assert.equal(svc.slotFor("daily_analysis", "GBP_USD", sun), null);
});

test("when a report can be written: analyses never with hindsight, reviews only after the close", () => {
  const wed = Date.parse("2026-10-28T09:00:00Z"); // Wednesday 12:00 EAT, London session open
  const at = (kind: Parameters<typeof svc.slotAvailability>[0], period: string, now = wed) => svc.slotAvailability(kind, "GBP_USD", period, now);
  assert.equal(at("daily_analysis", "2026-10-28").state, "open");
  assert.equal(at("daily_analysis", "2026-10-27").state, "closed", "a past day cannot get an analysis");
  assert.equal(at("daily_analysis", "2026-09-28").state, "closed");
  assert.equal(at("daily_analysis", "2026-10-30").state, "not_yet");
  assert.equal(at("daily_review", "2026-10-28").state, "not_yet", "the session has not closed");
  assert.equal(at("daily_review", "2026-10-27").state, "open");
  assert.equal(at("weekly_analysis", "2026-10-26").state, "open");
  assert.equal(at("weekly_analysis", "2026-10-19").state, "closed");
  assert.equal(at("weekly_review", "2026-10-26").state, "not_yet");
  assert.equal(at("weekly_review", "2026-10-19").state, "open");
  assert.match(at("daily_analysis", "2026-10-27").reason, /hindsight/);
});

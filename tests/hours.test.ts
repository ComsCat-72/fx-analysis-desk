// Market hours board: activity estimate and session windows in a chosen time zone.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../lib/calc/forex.ts";

test("activity is highest in the London–New York overlap and low in the gap after New York closes", () => {
  const overlap = C.activityAt(Date.parse("2026-10-28T14:00:00Z")); // Wed: London (GMT) and New York (EDT) both open
  const gap = C.activityAt(Date.parse("2026-10-28T21:30:00Z"));     // after New York 17:00, before Sydney opens
  const tokyo = C.activityAt(Date.parse("2026-10-28T02:00:00Z"));   // Tokyo (+ Sydney)
  assert.equal(overlap.level, "High"); assert.equal(overlap.score, 5.5);
  assert.equal(gap.level, "Low");
  assert.ok(tokyo.score > gap.score && tokyo.score < overlap.score);
  assert.equal(C.activityAt(Date.parse("2026-10-31T12:00:00Z")).score, 0, "weekend");
});

test("session windows follow the chosen zone's day", () => {
  const t = Date.parse("2026-10-28T12:00:00Z");
  const kla = C.dayIn(t, "Africa/Kampala"), ny = C.dayIn(t, "America/New_York");
  assert.equal(kla.date, "2026-10-28"); assert.equal(kla.end - kla.start, 86400_000);
  assert.equal(new Date(kla.start).toISOString(), "2026-10-27T21:00:00.000Z");
  assert.equal(new Date(ny.start).toISOString(), "2026-10-28T04:00:00.000Z");
  const lonK = C.sessionsInDay(kla.start, kla.end).find((s) => s.name === "London")!;
  assert.deepEqual(lonK.windows.map((w) => new Date(w.start).toISOString()), ["2026-10-28T08:00:00.000Z"]); // 11:00 in Kampala
  const sydK = C.sessionsInDay(kla.start, kla.end).find((s) => s.name === "Sydney")!;
  assert.ok(sydK.windows.every((w) => w.start >= kla.start && w.end <= kla.end), "clipped to the day");
  assert.equal(sydK.windows.length, 2, "the overnight session appears at both ends of the day");
  assert.equal(C.dayIn(Date.parse("2026-11-01T12:00:00Z"), "America/New_York").end - C.dayIn(Date.parse("2026-11-01T12:00:00Z"), "America/New_York").start, 25 * 3600_000);
});

// The calendar fetches Forex Factory's weekly feed by itself: when the week is missing or more than an hour old.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

delete process.env.BLOB_READ_WRITE_TOKEN;
process.env.CALENDAR_FEED_URL = "https://feed.test/ff_calendar_thisweek.json";
const { useLocalStore } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "fxdesk-fresh-")));
const C = await import("../lib/data/calendar.ts");

let calls = 0, fail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string | URL) => {
  if (!String(u).startsWith("https://feed.test/")) return realFetch(u);
  calls++;
  await new Promise((r) => setTimeout(r, 20));
  if (fail) return new Response("rate limited", { status: 429 });
  return new Response(JSON.stringify([{ title: "ISM Manufacturing PMI", country: "USD", date: "2026-11-02T10:00:00-05:00", impact: "High", forecast: "49.5", previous: "49.1" }]));
}) as typeof fetch;

const MON = Date.parse("2026-11-02T08:00:00Z"); // Monday 2 Nov 2026, week not stored yet

test("a missing week is fetched; a fresh one is not; an hour later it is fetched again", async () => {
  C.resetCalendarFreshness();
  const a = await C.ensureCalendarFresh(MON);
  assert.equal(a.fetched, true); assert.equal(calls, 1);
  assert.equal(await C.currentWeekFetchedAt(MON), MON);
  assert.equal((await C.eventsBetween(MON, MON + 86400_000)).length, 1);
  const b = await C.ensureCalendarFresh(MON + 30 * 60_000);
  assert.equal(b.reason, "fresh"); assert.equal(calls, 1);
  const c = await C.ensureCalendarFresh(MON + 61 * 60_000);
  assert.equal(c.fetched, true); assert.equal(calls, 2);
});

test("one fetch at a time; a failing feed is reported, not thrown, and not retried for two minutes", async () => {
  C.resetCalendarFreshness();
  const t = MON + 3 * 3600_000;
  calls = 0;
  const [x, y] = await Promise.all([C.ensureCalendarFresh(t), C.ensureCalendarFresh(t)]);
  assert.equal(calls, 1, "concurrent callers share one fetch"); assert.deepEqual(x, y);
  fail = true; C.resetCalendarFreshness();
  const bad = await C.ensureCalendarFresh(t + 2 * 3600_000);
  assert.equal(bad.fetched, false); assert.match(String(bad.error), /HTTP 429/);
  const again = await C.ensureCalendarFresh(t + 2 * 3600_000 + 60_000);
  assert.equal(again.reason, "tried recently"); assert.equal(calls, 2);
  fail = false;
});

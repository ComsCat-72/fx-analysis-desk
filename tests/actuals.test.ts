// Actual results from biquote.io attached to the Forex Factory schedule: parsing, matching, formatting, throttling.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

delete process.env.BLOB_READ_WRITE_TOKEN;
const { useLocalStore } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "fxdesk-act-")));
const A = await import("../lib/data/actuals.ts");
const { mergeEvents, eventsBetween, eventAsOf, eventId } = await import("../lib/data/calendar.ts");

const T = Date.parse("2026-10-28T00:30:00Z");
const ff = (currency: string, title: string, at: number, consensus: string | null, previous: string | null) =>
  ({ id: eventId(currency, title, new Date(at).toISOString()), source: "Forex Factory weekly export", currency, title, impact: "High", scheduledAt: at, sourceTime: new Date(at).toISOString(), consensus, previous });

test("parses array and wrapped responses with differing field names", () => {
  const fields: Record<string, string> = {};
  const a = A.parseReleases([{ title: "CPI m/m", country: "AU", date: "2026-10-28T00:30:00Z", actual: 0.8, forecast: 0.7, previous: 0.4 }], fields);
  assert.equal(a[0].currency, "AUD"); assert.equal(a[0].at, T); assert.equal(a[0].actual, "0.8");
  assert.equal(fields.title, "title"); assert.equal(fields.time, "date");
  const b = A.parseReleases({ data: [{ event: "Unemployment Claims", currency: "usd", datetime: "2026-10-29 12:30:00", actual: "219K", consensus: "225K", prior: "231K" }] });
  assert.equal(b[0].currency, "USD"); assert.equal(b[0].forecast, "225K"); assert.equal(b[0].previous, "231K"); assert.equal(b[0].at, Date.parse("2026-10-29T12:30:00Z"));
  assert.deepEqual(A.parseReleases({ nothing: true }), []);
});

test("matches on currency, time and figures; ambiguous candidates are skipped", () => {
  const evs = [ff("AUD", "CPI m/m", T, "0.7%", "0.4%"), ff("AUD", "CPI y/y", T, "4.2%", "4.0%"), ff("AUD", "Trimmed Mean CPI m/m", T, "0.3%", "0.2%")].map((e) => ({ ...e, history: [] }));
  const m = A.matchEvent({ title: "Consumer Price Index (YoY)", currency: "AUD", at: T + 60_000, actual: "4.3", forecast: "4.2", previous: "4.0", revised: null, unit: "%" }, evs);
  assert.equal(m?.title, "CPI y/y");
  assert.equal(A.matchEvent({ title: "CPI", currency: "AUD", at: T, actual: "1", forecast: null, previous: null, revised: null, unit: null }, evs), null, "ambiguous");
  assert.equal(A.matchEvent({ title: "CPI m/m", currency: "AUD", at: T + 3 * 3600_000, actual: "1", forecast: "0.7", previous: "0.4", revised: null, unit: null }, evs), null, "wrong time");
  assert.equal(A.matchEvent({ title: "CPI m/m", currency: "NZD", at: T, actual: "1", forecast: "0.7", previous: "0.4", revised: null, unit: null }, evs), null, "wrong currency");
});

test("figures are written the way Forex Factory writes the event's own figures", () => {
  assert.equal(A.formatLike("0.8", ["0.7%", "0.4%"]), "0.8%");
  assert.equal(A.formatLike("4.25", ["4.2%"]), "4.3%"); // FF's precision
  assert.equal(A.formatLike("219000", ["225K"]), "219K");
  assert.equal(A.formatLike("219", ["225K"]), "219K");
  assert.equal(A.formatLike("-134.9", ["-130.4B"]), "-134.9B");
  assert.equal(A.formatLike("2.75%", ["3.00%"]), "2.75%");
  assert.equal(A.formatLike("-30.8", ["-30.1"]), "-30.8");
});

test("sync records actuals once, fills missing figures, throttles, and never throws", async () => {
  await mergeEvents([ff("AUD", "CPI m/m", T, "0.7%", "0.4%"), ff("USD", "FOMC Member Speaks", T, null, null), ff("NZD", "Official Cash Rate", T + 1800_000, null, "2.75%")], T - 86400_000);
  const body = [{ title: "CPI MoM", country: "AU", date: new Date(T).toISOString(), actual: 0.8, forecast: 0.7, previous: 0.4 },
    { title: "RBNZ Interest Rate Decision", country: "NZ", date: new Date(T + 1800_000).toISOString(), actual: "2.75%", forecast: "3.00%", previous: "2.75%" },
    { title: "Retail Sales", country: "US", date: new Date(T).toISOString(), actual: 0.2, forecast: 0.3, previous: 0.1 }];
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(JSON.stringify(body), { status: 200 }); }) as typeof fetch;
  const now = T + 3600_000;
  const r = await A.syncActuals(T - 3600_000, T + 7200_000, { now, fetcher });
  const firstRun = calls; // one request per UTC day in the window
  assert.equal(r.error, null); assert.equal(r.fetched, 3); assert.equal(r.matched, 2);
  const evs = await eventsBetween(T - 3600_000, T + 7200_000);
  const cpi = eventAsOf(evs.find((e) => e.title === "CPI m/m")!, now), ocr = eventAsOf(evs.find((e) => e.title === "Official Cash Rate")!, now);
  assert.equal(cpi.actual, "0.8%"); assert.equal(cpi.state, "released"); assert.deepEqual(cpi.actualSources, [`${A.SOURCE} (${A.BIQUOTE_URL})`]);
  assert.equal(ocr.actual, "2.75%"); assert.equal(ocr.consensus, "3.00%", "missing forecast filled");
  assert.equal(eventAsOf(evs.find((e) => e.title === "FOMC Member Speaks")!, now).actual, null);
  const again = await A.syncActuals(T - 3600_000, T + 7200_000, { now: now + 60_000, fetcher });
  assert.equal(again.skipped, "synced recently"); assert.equal(calls, firstRun);
  const third = await A.syncActuals(T - 3600_000, T + 7200_000, { now: now + 300_000, fetcher });
  assert.equal(third.recorded, 0, "nothing recorded twice");
  const fail = await A.syncActuals(T, T, { now: now + 900_000, fetcher: (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as typeof fetch });
  assert.match(fail.error ?? "", /biquote.io unavailable/);
});

test("real biquote.io response shape (captured by the live-check workflow)", () => {
  const sample = [
    { id: "mql5:248898", eventId: "mql5:554021008", time: "2026-10-26T00:00:00Z", period: null, countryCode: "NZ", currency: "NZD", name: "Labor Day", importance: "none", type: "holiday",
      unit: "none", multiplier: "none", digits: 0, actual: null, forecast: null, previous: null, revisedPrevious: null, revision: 0, timeMode: "date", source: "mql5" },
    { id: "fxempire:406285", eventId: "fxempire:th:imports-yoy", time: "2026-10-26T03:30:00Z", countryCode: "TH", currency: "THB", name: "Imports YoY", importance: "low",
      type: "indicator", unit: "percent", multiplier: null, digits: 1, actual: 50.4, forecast: 31.3, previous: 25.1, revisedPrevious: null, source: "fxempire" },
    { id: "fxempire:413129", time: "2026-10-26T03:30:00Z", countryCode: "TH", currency: "THB", name: "Balance of Trade", unit: "currency", multiplier: "billions", digits: 2,
      actual: -5.86, forecast: -1.8, previous: -2.48, revisedPrevious: null },
  ];
  const fields: Record<string, string> = {};
  const r = A.parseReleases(sample, fields);
  assert.deepEqual(fields, { title: "name", currency: "currency", country: "countryCode", time: "time", unit: "unit", actual: "actual", forecast: "forecast", previous: "previous" }); // revisedPrevious registers once a sample has one
  assert.equal(r[1].title, "Imports YoY"); assert.equal(r[1].at, Date.parse("2026-10-26T03:30:00Z")); assert.equal(r[1].digits, 1);
  assert.equal(A.formatLike(r[1].actual!, [], r[1].unit, r[1].digits, r[1].multiplier), "50.4%");
  assert.equal(A.formatLike(r[2].actual!, [], r[2].unit, r[2].digits, r[2].multiplier), "-5.86B");
  assert.equal(A.formatLike("-134.9", ["-130.4B"], "currency", 1, "billions"), "-134.9B");
});

test("recordValues writes many entries in one update; a running sync is not started twice", async () => {
  const { recordValues } = await import("../lib/data/calendar.ts");
  const { putJSON } = await import("../lib/store.ts");
  const at = Date.parse("2026-10-20T08:00:00Z");
  const a = ff("GBP", "CPI y/y", at, "3.6%", "3.8%"), b = ff("GBP", "Core CPI y/y", at, "3.1%", "3.2%");
  await mergeEvents([a, b], at - 86400_000);
  const n = await recordValues("2026-10-19", [
    { id: a.id, field: "actual", value: "3.6%", source: "test", at }, { id: b.id, field: "actual", value: "3.0%", source: "test", at },
    { id: a.id, field: "actual", value: "3.6%", source: "test", at }, { id: "missing", field: "actual", value: "1", source: "test", at }]);
  assert.equal(n, 2, "duplicates and unknown events are skipped");
  const evs = await eventsBetween(at - 1, at + 1);
  assert.equal(eventAsOf(evs.find((e) => e.id === b.id)!, at + 1).actual, "3.0%");
  const now = Date.parse("2026-10-30T10:00:00Z");
  await putJSON("actuals-sync.json", { at: 0, result: { fetched: 0, matched: 0, recorded: 0, fields: {}, error: null }, running: now - 10_000 });
  let calls = 0;
  const r = await A.syncActuals(now - 86400_000, now, { now, fetcher: (async () => { calls++; return new Response("[]"); }) as typeof fetch });
  assert.equal(r.skipped, "sync already running"); assert.equal(calls, 0);
  const later = await A.syncActuals(now - 86400_000, now, { now: now + 120_000, fetcher: (async () => { calls++; return new Response("[]"); }) as typeof fetch });
  assert.equal(later.skipped, undefined, "a stale running claim does not block forever"); assert.equal(calls > 0, true);
});

test("right after a release without an actual, sync runs every 20 s instead of every 2 minutes", async () => {
  const { putJSON } = await import("../lib/store.ts");
  const rel = Date.parse("2026-11-03T13:30:00Z");
  await mergeEvents([ff("CAD", "Trade Balance", rel, "-6.3B", "-6.0B")], rel - 86400_000);
  let calls = 0;
  const fetcher = (async (u: string) => { if (!u.includes("eventDates")) calls++; return new Response("[]"); }) as unknown as typeof fetch;
  const doc = (at: number) => putJSON("actuals-sync.json", { at, result: { fetched: 0, matched: 0, recorded: 0, fields: {}, error: null }, running: null });
  await doc(rel + 5 * 60_000);
  const hot = await A.syncActuals(rel - 3600_000, rel + 3600_000, { now: rel + 5 * 60_000 + 25_000, fetcher });
  assert.equal(hot.skipped, undefined, "hot: synced 25 s after the last run"); assert.equal(calls, 1);
  await doc(rel + 5 * 60_000 + 25_000);
  const tooSoon = await A.syncActuals(rel - 3600_000, rel + 3600_000, { now: rel + 5 * 60_000 + 35_000, fetcher });
  assert.equal(tooSoon.skipped, "synced recently", "never more often than every 20 s"); assert.equal(calls, 1);
  await doc(rel + 45 * 60_000);
  const cold = await A.syncActuals(rel - 3600_000, rel + 3600_000, { now: rel + 46 * 60_000, fetcher });
  assert.equal(cold.skipped, "synced recently", "after 30 minutes the normal 2-minute gap applies"); assert.equal(calls, 1);
});

test("releases are fetched one UTC day at a time, so a capped multi-day reply cannot hide today's actuals", async () => {
  const rel = Date.parse("2026-11-05T13:30:00Z");
  await mergeEvents([ff("CAD", "Building Permits m/m", rel, "1.2%", "-0.4%")], rel - 86400_000);
  const asked: string[] = [];
  const fetcher = (async (u: string) => {
    if (u.includes("eventDates")) return new Response("[]");
    const q = new URL(u).searchParams; asked.push(`${q.get("from")}>${q.get("to")}`);
    const rows = q.get("from") === "2026-11-05" ? [{ time: "2026-11-05T13:30:00Z", currency: "CAD", name: "Building Permits MoM", unit: "percent", digits: 1, actual: 2.1, forecast: 1.2, previous: -0.4 }] : [];
    return new Response(JSON.stringify(rows));
  }) as unknown as typeof fetch;
  const res = await A.syncActuals(rel - 86400_000, rel + 3600_000, { now: rel + 60_000, fetcher, minGapMs: 0 });
  assert.deepEqual(asked.sort(), ["2026-11-04>2026-11-05", "2026-11-05>2026-11-06"]);
  assert.equal(res.recorded >= 1, true, JSON.stringify(res));
});

test("FXStreet fills an actual biquote lacks; the same figure from both sources is recorded once", async () => {
  const { parseFxstreet } = await import("../lib/data/fxstreet.ts");
  const rel = Date.parse("2026-11-06T13:30:00Z");
  const a = ff("USD", "New Home Sales", rel, "651K", "680K"), b = ff("USD", "Goods Trade Balance", rel, "-130.4B", "-132.1B");
  await mergeEvents([a, b], rel - 86400_000);
  const fx = [{ dateUtc: "2026-11-06T13:30:00Z", name: "New Home Sales (MoM)", currencyCode: "USD", actual: 0.676, consensus: 0.651, previous: 0.68, revised: null, unit: null, potency: "M" },
    { dateUtc: "2026-11-06T13:30:00Z", name: "Goods Trade Balance", currencyCode: "USD", actual: -134.9, consensus: -130.4, previous: -132.1, revised: null, unit: null, potency: "B" },
    { dateUtc: "2026-11-06T13:30:00Z", name: "Fed's Powell speech", currencyCode: "USD", actual: null, isSpeech: true }];
  assert.equal(parseFxstreet(fx).length, 2, "speeches skipped");
  const bq = [{ time: "2026-11-06T13:30:00Z", currency: "USD", name: "Goods Trade Balance", unit: "currency", multiplier: "billions", digits: 1, actual: -134.9, forecast: -130.4, previous: -132.1 },
    { time: "2026-11-06T13:30:00Z", currency: "USD", name: "New Home Sales", actual: null, forecast: 651, previous: 680 }];
  const fetcher = (async (u: string) => new Response(JSON.stringify(u.includes("eventDates") ? fx : bq))) as unknown as typeof fetch;
  const res = await A.syncActuals(rel - 3600_000, rel + 3600_000, { now: rel + 120_000, fetcher, minGapMs: 0 });
  assert.equal(res.error, null);
  const evs = await eventsBetween(rel - 1, rel + 1);
  const nhs = evs.find((e) => e.id === a.id)!, gtb = evs.find((e) => e.id === b.id)!;
  assert.equal(eventAsOf(nhs, rel + 120_000).actual, "676K", "0.676M rescaled to the Forex Factory unit");
  assert.equal(eventAsOf(gtb, rel + 120_000).actual, "-134.9B");
  assert.equal(gtb.history.filter((h) => h.field === "actual").length, 1, "one entry for the same figure");
  const down = await A.syncActuals(rel - 3600_000, rel + 3600_000, { now: rel + 600_000, minGapMs: 0,
    fetcher: (async (u: string) => (u.includes("eventDates") ? new Response("no", { status: 503 }) : new Response("[]"))) as unknown as typeof fetch });
  assert.match(String(down.error), /FXStreet unavailable: HTTP 503/, "one source down is reported, the other still runs");
});

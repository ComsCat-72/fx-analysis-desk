// Currency strength, correlation, COT and central-bank rates.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

delete process.env.BLOB_READ_WRITE_TOKEN;
const { useLocalStore } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "fxdesk-mkt-")));
const S = await import("../lib/data/strength.ts");
const R = await import("../lib/data/correlation.ts");
const C = await import("../lib/data/cot.ts");
const B = await import("../lib/data/banks.ts");

test("currency strength: averages against the other seven, sums to zero, crosses follow from the USD values", () => {
  const ch = { USD: 0, EUR: Math.log(1.01), GBP: 0, JPY: Math.log(0.99), AUD: 0, NZD: 0, CAD: 0, CHF: 0 }; // EUR +1% and JPY −1% in USD
  const s = S.strengthFrom(ch);
  assert.equal(s[0].currency, "EUR"); assert.equal(s.at(-1)!.currency, "JPY");
  assert.ok(Math.abs(s.reduce((a, x) => a + x.pct, 0)) < 1e-9, "strengths sum to zero");
  const usd = s.find((x) => x.currency === "USD")!.pct;
  assert.ok(Math.abs(usd - 100 * (0 - (Math.log(1.01) + Math.log(0.99)) / 7)) < 1e-9);
  const x = S.crossesFrom(ch);
  assert.equal(x.length, 28);
  assert.ok(Math.abs(x.find((p) => p.pair === "EUR/JPY")!.pct - (1.01 / 0.99 - 1) * 100) < 1e-9);
});

test("strength periods start at the latest 17:00 New York open, Sunday to Thursday, across the US clock change", () => {
  const wed = S.periodStarts(Date.parse("2026-10-28T19:00:00Z")); // Wed 15:00 EDT
  assert.equal(new Date(wed.today).toISOString(), "2026-10-27T21:00:00.000Z"); // Tue 17:00 EDT
  assert.equal(new Date(wed.week).toISOString(), "2026-10-25T21:00:00.000Z");  // Sun 17:00 EDT
  const sat = S.periodStarts(Date.parse("2026-10-31T12:00:00Z"));
  assert.equal(new Date(sat.today).toISOString(), "2026-10-29T21:00:00.000Z", "weekend: Friday's session (opened Thursday 17:00)");
  const mon = S.periodStarts(Date.parse("2026-11-02T15:00:00Z")); // after the US clock change
  assert.equal(new Date(mon.today).toISOString(), "2026-11-01T22:00:00.000Z"); // Sun 17:00 EST
  assert.equal(mon.week, mon.today);
});

test("correlation: +1, −1, only shared dates, and too little data gives none", () => {
  const day = (i: number) => Date.UTC(2026, 8, 1 + i);
  const up = Array.from({ length: 30 }, (_, i) => ({ t: day(i), close: 1 + 0.01 * Math.sin(i) + i * 0.001 }));
  const same = up.map((b) => ({ ...b, close: b.close * 2 }));
  const inverse = up.map((b) => ({ ...b, close: 1 / b.close }));
  const a = R.returnsByDate(up);
  assert.ok(Math.abs(R.correlate(a, R.returnsByDate(same), 20).r! - 1) < 1e-9);
  assert.ok(R.correlate(a, R.returnsByDate(inverse), 20).r! < -0.99);
  const gappy = R.returnsByDate(up.filter((_, i) => i % 2 === 0));
  assert.ok(R.correlate(a, gappy, 60).n < 20, "only dates both series have");
  assert.equal(R.pearson([1, 2], [2, 1]), null);
  assert.equal(R.pearson([1, 1, 1], [1, 2, 3]), null, "no variation, no correlation");
});

// A real CFTC row (Australian dollar, report of 2026-10-20) captured by the live-check workflow, plus the week before.
const AUD = { cftc_contract_market_code: "232741", report_date_as_yyyy_mm_dd: "2026-10-20T00:00:00.000", open_interest_all: "333010",
  noncomm_positions_long_all: "98419", noncomm_positions_short_all: "225711", comm_positions_long_all: "201947", comm_positions_short_all: "87022" };
const AUD_PREV = { ...AUD, report_date_as_yyyy_mm_dd: "2026-10-13T00:00:00.000", noncomm_positions_long_all: "98389", noncomm_positions_short_all: "215688",
  comm_positions_long_all: "207131", comm_positions_short_all: "100761" };

test("COT: net positions, weekly change from the week before, long share, unknown contracts ignored", () => {
  const rows = C.parseCot([AUD_PREV, AUD, { ...AUD, cftc_contract_market_code: "999999" }]);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.label, "Australian dollar"); assert.equal(r.date, "2026-10-20");
  assert.equal(r.spec_net, 98419 - 225711);
  assert.equal(r.spec_net_change, (98419 - 225711) - (98389 - 215688)); // matches the CFTC's own changes: +30 long, +10023 short
  assert.equal(r.comm_net_change, (201947 - 87022) - (207131 - 100761));
  assert.ok(Math.abs(r.spec_long_pct - (100 * 98419) / (98419 + 225711)) < 1e-9);
  assert.equal(C.parseCot([AUD])[0].spec_net_change, null, "no previous week, no change");
});

test("COT: a failed fetch keeps the last stored report and says so", async () => {
  const ok = (async () => new Response(JSON.stringify([AUD, AUD_PREV]))) as unknown as typeof fetch;
  const first = await C.refreshCot(Date.parse("2026-10-24T12:00:00Z"), ok);
  assert.equal(first.error, null); assert.equal(first.report_date, "2026-10-20");
  const down = await C.refreshCot(Date.parse("2026-10-25T12:00:00Z"), (async () => new Response("no", { status: 503 })) as unknown as typeof fetch);
  assert.match(String(down.error), /CFTC unavailable: HTTP 503/); assert.equal(down.rows.length, 1);
});

test("central banks: current rate, last change, awaiting decision, next meeting; nothing guessed", () => {
  const now = Date.parse("2026-10-28T20:00:00Z");
  const dec = B.parseDecisions([
    { time: "2026-07-29T18:00:00Z", countryCode: "US", name: "Fed Interest Rate Decision", actual: 3.75, previous: 3.75 },
    { time: "2026-09-16T18:00:00Z", countryCode: "US", name: "Fed Interest Rate Decision", actual: 4, previous: 3.75 },
    { time: "2026-10-28T18:00:00Z", countryCode: "US", name: "Fed Interest Rate Decision", actual: null, previous: 4 },
    { time: "2026-12-09T19:00:00Z", countryCode: "US", name: "Fed Interest Rate Decision", actual: null, previous: null },
    { time: "2026-09-17T11:00:00Z", countryCode: "GB", name: "BoE Interest Rate Decision", actual: 4, previous: 4 },
    { time: "2026-09-17T11:00:00Z", countryCode: "GB", name: "BoE MPC Vote Cut", actual: 2, previous: 3 },
    { time: "2026-09-10T12:15:00Z", countryCode: "EU", name: "ECB Deposit Facility Rate Decision", actual: 2.5, previous: 2.25 },
  ]);
  assert.equal(dec.length, 5, "only the eight banks' headline decisions");
  let rows = B.bankRows(dec, [], now);
  const fed = rows.find((r) => r.id === "fed")!;
  assert.equal(fed.rate, 4); assert.equal(fed.rate_at, Date.parse("2026-09-16T18:00:00Z"));
  assert.deepEqual(fed.last_change, { at: Date.parse("2026-09-16T18:00:00Z"), bp: 25 });
  assert.equal(fed.awaiting_at, Date.parse("2026-10-28T18:00:00Z"), "today's decision not filled by the source yet");
  assert.equal(fed.next_at, Date.parse("2026-12-09T19:00:00Z"));
  assert.equal(rows.find((r) => r.id === "ecb")!.rate, null, "the deposit rate is not the main refinancing rate");
  assert.equal(rows.find((r) => r.id === "boj")!.rate, null);
  // The calendar's actual (FXStreet) fills today's decision.
  rows = B.bankRows(dec, [{ currency: "USD", title: "Federal Funds Rate", at: Date.parse("2026-10-28T18:00:00Z"), actual: "3.75%", previous: "4.00%" }], now);
  const fed2 = rows.find((r) => r.id === "fed")!;
  assert.equal(fed2.rate, 3.75); assert.equal(fed2.rate_source, "calendar"); assert.equal(fed2.awaiting_at, null);
  assert.deepEqual(fed2.last_change, { at: Date.parse("2026-10-28T18:00:00Z"), bp: -25 });
  const diff = B.differentials(rows).find((d) => d.pair === "GBP/USD")!;
  assert.equal(diff.diff, 4 - 3.75);
  assert.equal(B.differentials(rows).find((d) => d.pair === "EUR/USD")!.diff, null);
});

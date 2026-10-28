// Display timezone, headline feeds and the calendar range.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_SOURCE = "fixture";
delete process.env.BLOB_READ_WRITE_TOKEN;
const { useLocalStore } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "fxdesk-src-")));
const { setDisplayZone, stamp, zoned, zoneLabel, displayZone, dateIn } = await import("../lib/dates.ts");
const { parseHeadlines, tagCurrencies } = await import("../lib/data/headlines.ts");
const { changeSettings, getSettings } = await import("../lib/settings.ts");

test("display timezone: Kampala (EAT) by default, Kigali (CAT) selectable, source instants unchanged", () => {
  const t = Date.parse("2026-10-20T06:30:00Z");
  setDisplayZone(null);
  assert.equal(displayZone().timezone, "Africa/Kampala");
  assert.equal(stamp(t), "Tue 20 Oct 2026 09:30 EAT");
  setDisplayZone("Africa/Kigali");
  assert.equal(stamp(t), "Tue 20 Oct 2026 08:30 CAT");
  assert.equal(dateIn(Date.parse("2026-10-20T22:30:00Z")), "2026-10-21"); // 00:30 CAT
  setDisplayZone("Not/AZone");
  assert.equal(displayZone().timezone, "Africa/Kampala", "an invalid zone falls back to the default");
  assert.match(zoneLabel("Asia/Tokyo"), /GMT\+9|JST/);
  setDisplayZone(null);
});

test("source session times stay correct across the UK and US daylight-saving changes, shown in EAT", () => {
  // UK clocks change 25 Oct 2026, US clocks 1 Nov 2026; EAT has no daylight saving.
  assert.equal(stamp(zoned("2026-10-23", "17:00", "America/New_York")), "Sat 24 Oct 2026 00:00 EAT");
  assert.equal(stamp(zoned("2026-10-30", "17:00", "America/New_York")), "Sat 31 Oct 2026 00:00 EAT");
  assert.equal(stamp(zoned("2026-11-02", "17:00", "America/New_York")), "Tue 03 Nov 2026 01:00 EAT");
  assert.equal(stamp(zoned("2026-10-23", "24:00", "Europe/London")), "Sat 24 Oct 2026 02:00 EAT");
  assert.equal(stamp(zoned("2026-10-26", "24:00", "Europe/London")), "Tue 27 Oct 2026 03:00 EAT");
});

test("display timezone is a stored setting", async () => {
  await changeSettings((s) => { s.display_timezone = "Africa/Kigali"; });
  assert.equal(displayZone().timezone_label, "CAT");
  assert.equal((await getSettings()).display_timezone, "Africa/Kigali");
  await changeSettings((s) => { s.display_timezone = "Africa/Kampala"; });
  assert.equal(displayZone().timezone_label, "EAT");
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Fed officials see no rush to cut rates - Reuters</title><link>https://www.reuters.com/a</link><pubDate>Tue, 20 Oct 2026 14:05:00 GMT</pubDate></item>
<item><title>Sterling slips as UK inflation eases - Reuters</title><link>https://www.reuters.com/b</link><pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate></item>
<item><title>Celebrity chef opens restaurant - Reuters</title><link>https://www.reuters.com/c</link><pubDate>Tue, 20 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>Dollar steadies</title><link>https://www.reuters.com/d</link><pubDate>Tue, 20 Oct 2026 08:00:00</pubDate></item>
</channel></rss>`;

test("headline feeds: titles only, currency-tagged, untagged and timezone-less items dropped", () => {
  const items = parseHeadlines("Reuters", "test", RSS, "https://news.google.com/rss");
  assert.deepEqual(items.map((i) => i.title), ["Fed officials see no rush to cut rates", "Sterling slips as UK inflation eases"]);
  assert.deepEqual(items[0].currencies, ["USD"]);
  assert.deepEqual(items[1].currencies, ["GBP"]);
  assert.ok(items.every((i) => i.enteredBy === "feed" && i.summary === null));
  assert.deepEqual(tagCurrencies("U.S. Treasuries rally; euro firms after ECB"), ["USD", "EUR"]);
  assert.deepEqual(tagCurrencies("Eurotunnel results"), []);
});

test("calendar: green/red follows the currency (inverted for unemployment); range filters by currency and impact", async () => {
  const { resultTone } = await import("../lib/core/events.ts");
  assert.equal(resultTone("CPI y/y", "4.3%", "4.2%"), "better");
  assert.equal(resultTone("Unemployment Rate", "4.3%", "4.2%"), "worse");
  assert.equal(resultTone("Unemployment Claims", "219K", "225K"), "better");
  assert.equal(resultTone("GDP q/q", "0.2%", "0.20%"), "inline");
  assert.equal(resultTone("Speech", null, null), null);
  const { mergeEvents, recordValue } = await import("../lib/data/calendar.ts");
  const { calendarRange } = await import("../lib/views.ts");
  const at = Date.parse("2026-10-28T00:30:00Z");
  const ev = (currency: string, title: string, impact: string) => ({ id: `${currency}${title}`, source: "test", currency, title, impact, scheduledAt: at, sourceTime: "2026-10-28T00:30:00Z", consensus: "0.7%", previous: "0.4%" });
  await mergeEvents([ev("AUD", "CPI m/m", "High"), ev("EUR", "German GfK", "Medium"), ev("CHF", "UBS Expectations", "Low")], at - 86400_000);
  await recordValue("2026-10-26", "AUDCPI m/m", "actual", "0.8%", "official:ABS", null, at + 60_000);
  const all = await calendarRange("2026-10-28", "2026-10-28");
  assert.equal(all.rows.length, 3);
  assert.deepEqual(all.currencies, ["AUD", "CHF", "EUR"]);
  const aud = all.rows.find((r) => r.currency === "AUD")!;
  assert.equal(aud.actual, "0.8%"); assert.equal(aud.tone, "better"); assert.equal(aud.time, "03:30");
  assert.equal((await calendarRange("2026-10-28", "2026-10-28", { currencies: ["EUR"] })).rows.length, 1);
  assert.equal((await calendarRange("2026-10-28", "2026-10-28", { impacts: ["High", "Medium"] })).rows.length, 2);
});

test("browser timezone: reads are shown in the viewer's zone, per request", async () => {
  const { withZone } = await import("../lib/zone.ts");
  const t = Date.parse("2026-10-20T06:30:00Z");
  const a = withZone("America/New_York", async () => { await new Promise((r) => setTimeout(r, 20)); return stamp(t); });
  const b = withZone("Asia/Tokyo", async () => stamp(t));
  assert.equal(await b, "Tue 20 Oct 2026 15:30 GMT+9");
  assert.equal(await a, "Tue 20 Oct 2026 02:30 EDT", "overlapping requests keep their own zone");
  assert.equal(stamp(t), "Tue 20 Oct 2026 09:30 EAT", "outside a request the Configure zone applies");
  assert.equal(withZone("Not/AZone", () => displayZone().timezone), "Africa/Kampala");

  const { read, write, json } = await import("../lib/http.ts");
  const handler = async () => json({ tz: displayZone().timezone });
  const headers = { "x-display-tz": "America/New_York" };
  const got = await (await read(handler)(new Request("http://x/api/t", { headers }), {})).json();
  assert.equal(got.tz, "America/New_York");
  const viaQuery = await (await read(handler)(new Request("http://x/api/t?tz=Europe/London"), {})).json();
  assert.equal(viaQuery.tz, "Europe/London");
  const wrote = await (await write(handler)(new Request("http://x/api/t", { method: "POST", headers }), {})).json();
  assert.equal(wrote.tz, "Africa/Kampala", "writes use the Configure zone");
});

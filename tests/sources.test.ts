// Display timezone, headline feeds, scenario tables and writer selection.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_SOURCE = "fixture";
delete process.env.BLOB_READ_WRITE_TOKEN;
const { useLocalStore, putJSON } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "fxdesk-src-")));
const { setDisplayZone, stamp, zoned, zoneLabel, displayZone, dateIn } = await import("../lib/dates.ts");
const { parseHeadlines, tagCurrencies } = await import("../lib/data/headlines.ts");
const { scenarioTables } = await import("../lib/reports/render.ts");
const svc = await import("../lib/reports/service.ts");
const { changeSettings, getSettings } = await import("../lib/settings.ts");
const { dayWindow } = await import("../lib/core/sessions.ts");
const { CONFIG } = await import("../lib/config.ts");
const { addDays, monday, todayLocal } = await import("../lib/dates.ts");

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

test("a headline published after the data cutoff never enters the report; feed items are labelled headline-only", async () => {
  const day = addDays(monday(todayLocal()), -5);
  const w = dayWindow(CONFIG.instruments.GBP_USD.session, day), cutoff = w.start + 3 * 3600_000;
  await putJSON("headlines.json", { refreshedAt: cutoff, errors: [], items: [
    { id: "h1", sourceName: "Reuters", title: "Sterling firms before BoE remarks", url: "https://www.reuters.com/x", publishedAt: cutoff - 3600_000, summary: null, currencies: ["GBP"], enteredBy: "feed" },
    { id: "h2", sourceName: "WSJ", title: "Dollar jumps after the open", url: "https://www.wsj.com/y", publishedAt: cutoff + 60_000, summary: null, currencies: ["USD"], enteredBy: "feed" },
  ] });
  const v = await svc.generateDraft("GBP_USD", "daily_analysis", day, { cutoff, writer: "template", save: false });
  const news = Object.values(v.facts.policy).filter((p) => p.kind === "news");
  assert.deepEqual(news.map((n) => n.title), ["Sterling firms before BoE remarks"]);
  assert.match(news[0].text, /headline only; article content not verified/);
  assert.match(v.body_md, /Sterling firms before BoE remarks/);
  assert.equal(v.checks.blocking, 0, JSON.stringify(v.checks.findings.filter((f) => f.severity === "blocking"), null, 1));
});

test("scenario tables: verified consensus only, mutually exclusive outcomes, weights not estimated, inverse for unemployment", () => {
  const e = (id: string, title: string, consensus: string | null, state = "scheduled", at = "2026-10-20T12:30:00.000Z") => ({ id, kind: "event", event_id: id, currency: "USD", title, impact: "High",
    scheduled_at: at, scheduled_display: "", source_time: "", state, surprise: null, actual: null, consensus, previous: "4.1%", revised_previous: null, text: "", values: [] });
  const b = { events: { E1: e("E1", "Unemployment Rate", "4.2%"), E2: e("E2", "Average Hourly Earnings m/m", "0.3%"), E3: e("E3", "CPI m/m", null), E4: e("E4", "GDP q/q", "0.5%", "released", "2026-10-19T12:30:00.000Z") } } as never;
  const t = scenarioTables(b);
  assert.match(t, /In line \(4\.2% at the published precision\) \| Not estimated/);
  assert.match(t, /Above consensus \(above 4\.2%\) \| Not estimated \| Could weaken USD/);
  assert.match(t, /Released at the same time as Average Hourly Earnings/);
  assert.doesNotMatch(t, /CPI m\/m \[E3\]\*\*/, "no table without a verified consensus");
  assert.doesNotMatch(t, /GDP/, "no table for a release that already happened");
  assert.doesNotMatch(t, /\d+%\s*(?:chance|probability)/);
});

test("the free template writer is the default; Claude only when chosen and a key is set", () => {
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  assert.equal(svc.writerFor(null).name, "template");
  assert.equal(svc.writerFor(null, "claude").name, "claude");
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(svc.writerFor(null, "claude").name, "template");
  assert.equal(svc.writerFor("claude").name, "template");
  if (key) process.env.ANTHROPIC_API_KEY = key;
});

test("a weekly review without a weekly analysis says so and invents no initial forecast", async () => {
  const wk = addDays(monday(todayLocal()), -7);
  const v = await svc.generateDraft("EUR_USD", "weekly_review", wk, { writer: "template", save: false });
  assert.match(v.body_md, /No weekly analysis was published for this week/);
  assert.doesNotMatch(v.body_md, /original weekly outlook was/i);
  assert.equal(v.checks.findings.filter((f) => f.severity === "blocking" && f.check !== "data").length, 0);
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

test("browser timezone: reads are shown in the viewer's zone, per request; writes keep the Configure zone", async () => {
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
  assert.equal(wrote.tz, "Africa/Kampala", "drafting and publishing use the report zone");
});

// Example reports: one full connected week (weekly analysis, daily analyses, previous-day reviews, weekly review)
// for one instrument, built from DEVELOPMENT FIXTURE data with the free template writer and a throwaway store.
// Every report it writes carries the fixture banner; none of it is market data.
//   node --experimental-strip-types scripts/example-week.ts [INSTRUMENT] [OUT_DIR] [STORE_DIR]
// STORE_DIR=.data fills the local development store, so `DATA_SOURCE=fixture npm run dev` shows the week.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_SOURCE = "fixture";
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
const { useLocalStore, putJSON } = await import("../lib/store.ts");
useLocalStore(process.argv[4] ?? mkdtempSync(path.join(tmpdir(), "example-week-")));
const { CONFIG } = await import("../lib/config.ts");
const { mergeEvents, recordValue, eventId } = await import("../lib/data/calendar.ts");
const { dayWindow, weekWindow } = await import("../lib/core/sessions.ts");
const { addDays, monday, todayLocal, weekDays } = await import("../lib/dates.ts");
const svc = await import("../lib/reports/service.ts");

const inst = process.argv[2] ?? "GBP_USD";
const out = process.argv[3] ?? "docs/examples";
mkdirSync(out, { recursive: true });
const rule = CONFIG.instruments[inst].session;
const { base, quote } = CONFIG.instruments[inst];
const wk = addDays(monday(todayLocal()), -7);
const days = weekDays(wk);
const at = (d: string, hUtc: number) => Date.parse(`${d}T${String(hUtc).padStart(2, "0")}:30:00Z`);
const SRC = "DEVELOPMENT FIXTURE";

// Fixture calendar: synthetic events and actuals, flagged as fixtures everywhere they appear.
const ev = (currency: string, title: string, t: number, impact: string, consensus: string | null, previous: string | null) =>
  ({ id: eventId(currency, title, new Date(t).toISOString()), source: SRC, currency, title, impact, scheduledAt: t, sourceTime: new Date(t).toISOString(), consensus, previous, fixture: true });
const events = [
  ev(base, "CPI y/y", at(days[1], 6), "High", "3.6%", "3.8%"),
  ev(quote, "CPI y/y", at(days[1], 12), "High", "3.0%", "2.9%"),
  ev(quote, "Unemployment Claims", at(days[3], 12), "Medium", "225K", "231K"),
  ev(base, "GDP q/q", at(days[3], 6), "High", "0.2%", "0.1%"),
  ev(quote, "Retail Sales m/m", at(days[4], 12), "High", "0.4%", "0.6%"),
];
await mergeEvents(events, at(addDays(wk, -2), 0));
await recordValue(wk, events[0].id, "actual", "3.6%", SRC, null, events[0].scheduledAt + 300_000);      // in line
await recordValue(wk, events[1].id, "actual", "3.2%", SRC, null, events[1].scheduledAt + 300_000);      // above
await recordValue(wk, events[2].id, "actual", "219K", SRC, null, events[2].scheduledAt + 300_000);      // below (supportive for USD)
await recordValue(wk, events[3].id, "actual", "0.3%", SRC, null, events[3].scheduledAt + 300_000);
await recordValue(wk, events[3].id, "actual", "0.4%", `${SRC} (second source)`, null, events[3].scheduledAt + 600_000); // conflicting
// Retail sales: no actual recorded, so it stays "not yet verified".
await putJSON("headlines.json", { refreshedAt: at(days[4], 20), errors: [], items: [
  { id: "hfx1", sourceName: "FIXTURE HEADLINE", title: `Central bank officials signal patience on rates as inflation eases`, url: null, publishedAt: at(days[1], 9), summary: null, currencies: [base], enteredBy: "feed" },
  { id: "hfx2", sourceName: "FIXTURE HEADLINE", title: "Treasury yields climb after inflation data", url: null, publishedAt: at(days[1], 14), summary: null, currencies: ["USD"], enteredBy: "feed" },
] });

const files: string[] = [];
const save = async (v: Awaited<ReturnType<typeof svc.generateDraft>>, publishAt: number) => {
  const blocking = v.checks.findings.filter((f) => f.severity === "blocking" && f.check !== "data");
  if (blocking.length) console.error(`${v.kind} ${v.period_key}: ${blocking.length} blocking`, JSON.stringify(blocking, null, 1));
  const p = v.checks.blocking ? v : await svc.publish(v.id, null, false, publishAt);
  const name = `${String(files.length + 1).padStart(2, "0")}-${v.kind}-${v.period_key}.md`;
  writeFileSync(path.join(out, name), p.body_md + "\n");
  files.push(`${name}${p.status === "published" ? "" : " (draft: blocking data findings)"}`);
};

const ws = weekWindow(rule, wk).start;
const wa = await svc.generateDraft(inst, "weekly_analysis", wk, { cutoff: ws - 6 * 3600_000, writer: "template" });
await save(wa, ws - 6 * 3600_000 + 60_000);
for (const [i, d] of days.entries()) {
  const w = dayWindow(rule, d);
  if (i > 0) {
    const prev = days[i - 1], pw = dayWindow(rule, prev);
    const rv = await svc.generateDraft(inst, "daily_review", prev, { cutoff: pw.end + 3600_000, writer: "template" });
    await save(rv, pw.end + 3600_000 + 60_000);
  }
  const da = await svc.generateDraft(inst, "daily_analysis", d, { cutoff: w.start + 7 * 3600_000, writer: "template" });
  await save(da, w.start + 7 * 3600_000 + 60_000);
}
const last = dayWindow(rule, days[4]);
await save(await svc.generateDraft(inst, "daily_review", days[4], { cutoff: last.end + 3600_000, writer: "template" }), last.end + 3600_000 + 60_000);
const we = weekWindow(rule, wk).end;
await save(await svc.generateDraft(inst, "weekly_review", wk, { cutoff: we + 2 * 3600_000, writer: "template" }), we + 2 * 3600_000 + 60_000);
console.log(`${inst}, week of ${wk}: ${files.length} reports in ${out}\n${files.map((f) => `  ${f}`).join("\n")}`);

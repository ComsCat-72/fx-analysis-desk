// Live check against the real free sources (Yahoo, Forex Factory export, central-bank and headline feeds), using the offline
// template writer and a throwaway local store. Writes reports and a data summary to ./out. Run in CI:
//   node --experimental-strip-types scripts/live-check.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.ANTHROPIC_API_KEY;
const { useLocalStore } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "live-")));
const { CONFIG } = await import("../lib/config.ts");
const { refreshCalendar, eventsBetween } = await import("../lib/data/calendar.ts");
const { refreshPolicy, policyItems } = await import("../lib/data/policy.ts");
const { refreshHeadlines, headlineItems } = await import("../lib/data/headlines.ts");
const { fetchSeries } = await import("../lib/data/yahoo.ts");
const { dayWindow } = await import("../lib/core/sessions.ts");
const { addDays, monday, todayLocal, weekDays } = await import("../lib/dates.ts");
const svc = await import("../lib/reports/service.ts");

const out = "out";
mkdirSync(out, { recursive: true });
const summary: Record<string, unknown> = { at: new Date().toISOString() };
summary.calendar = await refreshCalendar().catch((e) => `ERROR ${e.message}`);
summary.policy = await refreshPolicy().catch((e) => `ERROR ${e.message}`);
summary.headlines = await refreshHeadlines().catch((e) => `ERROR ${e.message}`);
summary.headlines_sample = (await headlineItems()).slice(0, 8).map((h) => `${new Date(h.publishedAt).toISOString()} ${h.sourceName} [${h.currencies.join(",")}]: ${h.title}`);
const pol = await policyItems();
summary.policy_by_bank = Object.fromEntries(Object.keys(CONFIG.centralBanks).map((b) => [b, pol.filter((p) => p.bank === b).slice(0, 3).map((p) => `${new Date(p.publishedAt).toISOString()} ${p.kind}: ${p.title}`)]));
summary.events_this_week = (await eventsBetween(Date.now() - 7 * 864e5, Date.now() + 7 * 864e5)).length;

const lastWeek = addDays(monday(todayLocal()), -7);
const write = (name: string, body: string) => writeFileSync(path.join(out, name), body);
for (const code of Object.keys(CONFIG.instruments)) {
  const s: Record<string, unknown> = {};
  summary[code] = s;
  try {
    const series = await fetchSeries(code);
    const rule = CONFIG.instruments[code].session;
    s.bars = { H1: series.H1.length, D1: series.D1.length, W1: series.W1.length, quote: series.quote };
    s.last_d1 = series.D1.slice(-6).map((b) => ({ date: b.date, start: new Date(b.start).toISOString(), close: b.close, complete: b.complete,
      h1_in_window: series.H1.filter((h) => h.start >= b.start && h.start < b.end).length }));
    s.last_w1 = series.W1.slice(-3).map((b) => ({ date: b.date, open: b.open, close: b.close, complete: b.complete }));
    s.h1_outside_windows = series.H1.filter((h) => !series.D1.some((d) => h.start >= d.start && h.start < d.end)).length;
    // Replay last week: weekly analysis -> daily analyses -> reviews -> weekly review, each with its own cutoff.
    const wa = await svc.generateDraft(code, "weekly_analysis", lastWeek, { cutoff: dayWindow(rule, lastWeek).start - 6 * 3600e3, writer: "template", series });
    write(`${code}_1_weekly_analysis.md`, wa.body_md);
    const res: Record<string, unknown> = { weekly_analysis: wa.checks.blocking };
    if (!wa.checks.blocking) await svc.publish(wa, null, false, Date.parse(wa.data_cutoff) + 60e3);
    for (const d of weekDays(lastWeek)) {
      const w = dayWindow(rule, d);
      const da = await svc.generateDraft(code, "daily_analysis", d, { cutoff: w.start + 4 * 3600e3, writer: "template", series });
      res[`da_${d}`] = da.checks.blocking ? da.checks.findings.filter((f) => f.severity === "blocking").map((f) => f.message) : 0;
      if (!da.checks.blocking) await svc.publish(da, null, false, Date.parse(da.data_cutoff) + 60e3);
      const rv = await svc.generateDraft(code, "daily_review", d, { cutoff: w.end + 3600e3, writer: "template", series });
      res[`rv_${d}`] = rv.facts.evaluation?.directional?.outcome ?? rv.checks.findings.filter((f) => f.severity === "blocking").map((f) => f.message);
      if (!rv.checks.blocking) await svc.publish(rv, null, false, Date.parse(rv.data_cutoff) + 60e3);
      if (d === weekDays(lastWeek)[2]) { write(`${code}_2_daily_analysis_${d}.md`, da.body_md); write(`${code}_3_daily_review_${d}.md`, rv.body_md); }
    }
    const wr = await svc.generateDraft(code, "weekly_review", lastWeek, { writer: "template", series, cutoff: Date.now() });
    write(`${code}_4_weekly_review.md`, wr.body_md);
    res.weekly_review = wr.facts.evaluation?.weekly?.directional ?? wr.checks.findings.filter((f) => f.severity === "blocking").map((f) => f.message);
    const now = await svc.generateDraft(code, "daily_analysis", todayLocal(), { writer: "template", series, cutoff: Date.now() });
    write(`${code}_5_daily_analysis_now.md`, now.body_md);
    res.now_blocking = now.checks.findings.filter((f) => f.severity !== "info").map((f) => `${f.severity}: ${f.message}`);
    s.replay = res;
  } catch (e) {
    s.error = `${(e as Error).name}: ${(e as Error).message}`;
  }
}
write("summary.json", JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1).slice(0, 4000));

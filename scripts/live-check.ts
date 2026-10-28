// Live check against the real free sources (Yahoo, Forex Factory export, FXStreet and biquote.io actuals, CFTC COT,
// central-bank and headline feeds) with a throwaway local store. Writes a data summary to ./out. Run in CI:
//   node --experimental-strip-types scripts/live-check.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.BLOB_READ_WRITE_TOKEN;
const { useLocalStore } = await import("../lib/store.ts");
useLocalStore(mkdtempSync(path.join(tmpdir(), "live-")));
const { CONFIG } = await import("../lib/config.ts");
const { refreshCalendar, eventsBetween } = await import("../lib/data/calendar.ts");
const { refreshPolicy, policyItems } = await import("../lib/data/policy.ts");
const { refreshHeadlines, headlineItems } = await import("../lib/data/headlines.ts");
const { latestQuote } = await import("../lib/data/yahoo.ts");
const { syncActuals } = await import("../lib/data/actuals.ts");
const { strength } = await import("../lib/data/strength.ts");
const { correlations } = await import("../lib/data/correlation.ts");
const { refreshCot } = await import("../lib/data/cot.ts");
const { banks } = await import("../lib/data/banks.ts");

const out = "out";
mkdirSync(out, { recursive: true });
const write = (name: string, body: unknown) => writeFileSync(path.join(out, name), JSON.stringify(body, null, 1));
const attempt = async <T>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { return { error: `${(e as Error).name}: ${(e as Error).message}` }; } };

const summary: Record<string, unknown> = { at: new Date().toISOString() };
summary.calendar = await attempt(() => refreshCalendar());
summary.policy = await attempt(() => refreshPolicy());
summary.headlines = await attempt(() => refreshHeadlines());
summary.headlines_sample = (await headlineItems()).slice(0, 8).map((h) => `${new Date(h.publishedAt).toISOString()} ${h.sourceName} [${h.currencies.join(",")}]: ${h.title}`);
const pol = await policyItems();
summary.policy_by_bank = Object.fromEntries(Object.keys(CONFIG.centralBanks).map((b) => [b, pol.filter((p) => p.bank === b).slice(0, 3).map((p) => `${new Date(p.publishedAt).toISOString()} ${p.kind}: ${p.title}`)]));
summary.quotes = Object.fromEntries(await Promise.all(Object.entries(CONFIG.instruments).map(async ([code, i]) => [code, await attempt(() => latestQuote(i.yahoo))] as const)));

// Actual results: a real sync, then which of the week's released events now have an actual, by source.
summary.actuals_sync = await attempt(() => syncActuals(Date.now() - 3 * 86400_000, Date.now() + 86400_000, { minGapMs: 0 }));
const { eventAsOf } = await import("../lib/data/calendar.ts");
const released = (await eventsBetween(Date.now() - 3 * 86400_000, Date.now())).filter((e) => e.impact !== "Holiday" && (e.consensus || e.previous));
const actuals = released.map((e) => { const s = eventAsOf(e, Date.now()); return { at: new Date(e.scheduledAt).toISOString(), currency: e.currency, title: e.title, actual: s.actual, sources: s.actualSources }; });
write("actuals.json", actuals);
summary.actuals = { released: actuals.length, with_actual: actuals.filter((a) => a.actual).length,
  by_source: actuals.reduce<Record<string, number>>((m, a) => { for (const s of a.sources) { const k = s.replace(/ \(.*/, ""); m[k] = (m[k] ?? 0) + 1; } return m; }, {}),
  missing: actuals.filter((a) => !a.actual).map((a) => `${a.at} ${a.currency} ${a.title}`).slice(0, 30) };

// For each released event: the actual chosen, its figures and every candidate release (same currency, ±10 min).
{
  const A = await import("../lib/data/actuals.ts"), F = await import("../lib/data/fxstreet.ts");
  const from = Date.now() - 3 * 86400_000, to = Date.now();
  const fx = await attempt(async () => F.parseFxstreet(await (await fetch(F.fxstreetUrl(from, to), { headers: F.FXSTREET_HEADERS })).json()));
  const days = [0, 1, 2, 3].map((i) => new Date(from + i * 86400_000).toISOString().slice(0, 10));
  const bq = (await Promise.all(days.map((d) => attempt(async () => A.parseReleases(await (await fetch(`${A.BIQUOTE_URL}?from=${d}&to=${new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10)}`)).json())))))
    .flatMap((x) => (Array.isArray(x) ? x : []));
  const all = [...(Array.isArray(fx) ? fx : []), ...bq];
  const evs = await eventsBetween(from, to);
  write("actuals_debug.json", actuals.map((a) => {
    const e = evs.find((x) => x.title === a.title && new Date(x.scheduledAt).toISOString() === a.at)!;
    return { actual: a.actual, event: { title: e.title, currency: e.currency, at: a.at, consensus: e.consensus, previous: e.previous, history: e.history.filter((h) => h.field === "actual") },
      candidates: all.filter((r) => r.currency === e.currency && Math.abs(r.at - e.scheduledAt) <= 10 * 60_000)
        .map((r) => ({ title: r.title, source: r.source ?? "biquote", actual: r.actual, forecast: r.forecast, previous: r.previous, unit: r.unit, match: A.matchScored(r, [e])?.s ?? null })) };
  }));
}
const st = await attempt(() => strength());
write("strength.json", st);
summary.strength = "error" in st ? st : { today: st.today, week: st.week, errors: st.errors };
const co = await attempt(() => correlations());
write("correlation.json", co);
summary.correlation = "error" in co ? co : { labels: co.labels.map((l) => l.display), m20_row0: co.m20[0], errors: co.errors };
const cot = await attempt(() => refreshCot());
write("cot.json", cot);
summary.cot = !("rows" in cot) ? cot : { report_date: cot.report_date, rows: cot.rows.map((r) => `${r.label}: net ${r.spec_net} (${r.spec_net_change})`), error: cot.error };
const bk = await attempt(() => banks());
write("banks.json", bk);
summary.banks = !("rows" in bk) ? bk : { error: bk.error, rows: bk.rows.map((r) => `${r.id}: ${r.rate} at ${r.rate_at && new Date(r.rate_at).toISOString()} next ${r.next_at && new Date(r.next_at).toISOString()} last ${JSON.stringify(r.last_change)}`) };

write("summary.json", summary);
console.log(JSON.stringify(summary, null, 1).slice(0, 6000));

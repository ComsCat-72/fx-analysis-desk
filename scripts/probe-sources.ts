// Probes free, keyless data sources from an open network (CI) and records their shape: second actuals source
// candidates, CFTC Commitments of Traders, and past central-bank rate decisions. Writes out/probes.json.
//   node --experimental-strip-types scripts/probe-sources.ts
import { mkdirSync, writeFileSync } from "node:fs";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const today = new Date().toISOString().slice(0, 10);
const yday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const out: Record<string, unknown> = { at: new Date().toISOString() };

async function grab(name: string, url: string, init: RequestInit = {}, pick?: (b: unknown, text: string) => unknown) {
  try {
    const r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json, text/html, application/xml;q=0.9, */*;q=0.8", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    let b: unknown = null; try { b = JSON.parse(text); } catch { /* not JSON */ }
    out[name] = { status: r.status, type: r.headers.get("content-type"), bytes: text.length, result: pick ? pick(b, text) : (b ?? text.slice(0, 1500)) };
  } catch (e) { out[name] = { error: (e as Error).message }; }
}
const usgb = (x: unknown) => /United States|United Kingdom|\bUS\b|\bGB\b|\bUK\b|USD|GBP/.test(JSON.stringify(x));

// Candidate second actuals sources.
for (const d of [yday, today]) await grab(`nasdaq_${d}`, `https://api.nasdaq.com/api/calendar/economicevents?date=${d}`, { headers: { Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" } }, (b) => {
  const rows = ((b as { data?: { rows?: Record<string, unknown>[] } })?.data?.rows) ?? [];
  return { count: rows.length, keys: rows[0] ? Object.keys(rows[0]) : (b as object | null) && Object.keys(b as object), sample: rows.filter(usgb).slice(0, 25), with_actual: rows.filter((x) => x.actual && x.actual !== "&nbsp;").length };
});
await grab("fxstreet", `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${yday}T00:00:00Z/${today}T23:59:59Z`, { headers: { Origin: "https://www.fxstreet.com", Referer: "https://www.fxstreet.com/" } }, (b, t) => {
  const rows = Array.isArray(b) ? b as Record<string, unknown>[] : [];
  return rows.length ? { count: rows.length, keys: Object.keys(rows[0]), sample: rows.filter(usgb).slice(0, 15), with_actual: rows.filter((x) => x.actual != null).length } : t.slice(0, 800);
});
await grab("myfxbook_rss", "https://www.myfxbook.com/rss/forex-economic-calendar-events", {}, (_b, t) => t.slice(0, 4000));
await grab("ff_html", "https://www.forexfactory.com/calendar?day=today", {}, (_b, t) => ({ has_actual_cells: (t.match(/calendar__actual/g) ?? []).length, head: t.slice(0, 300) }));
await grab("te_guest", "https://api.tradingeconomics.com/calendar/country/united%20states?c=guest:guest", {}, (b, t) => Array.isArray(b) ? { count: b.length, sample: (b as unknown[]).slice(0, 5) } : t.slice(0, 500));
await grab("investing", "https://www.investing.com/economic-calendar/", {}, (_b, t) => ({ has_rows: (t.match(/js-event-item/g) ?? []).length, head: t.slice(0, 200) }));

// CFTC Commitments of Traders (Socrata, keyless): Traders in Financial Futures and legacy futures-only.
const names = ["EURO FX", "BRITISH POUND", "JAPANESE YEN", "AUSTRALIAN DOLLAR", "NZ DOLLAR", "NEW ZEALAND DOLLAR", "CANADIAN DOLLAR", "SWISS FRANC", "USD INDEX", "GOLD"];
const where = encodeURIComponent(names.map((n) => `upper(market_and_exchange_names) like '%${n}%'`).join(" OR "));
for (const [name, id] of [["cot_tff", "gpe5-46if"], ["cot_legacy", "6dca-aqww"], ["cot_disagg", "72hh-3qpy"]]) {
  await grab(name, `https://publicreporting.cftc.gov/resource/${id}.json?$where=${where}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=40`, {}, (b, t) => {
    const rows = Array.isArray(b) ? b as Record<string, unknown>[] : [];
    return rows.length ? { count: rows.length, markets: [...new Set(rows.map((r) => `${r.market_and_exchange_names} | ${r.cftc_contract_market_code}`))], first: rows[0] } : t.slice(0, 800);
  });
}

// Past central-bank rate decisions from biquote (for the rates table).
const from = new Date(Date.now() - 200 * 86400_000).toISOString().slice(0, 10);
await grab("biquote_rates", `https://biquote.io/api/calendar?from=${from}&to=${today}&importance=high&countries=US,EU,GB,JP,AU,NZ,CA,CH`, {}, (b) => {
  const rows = Array.isArray(b) ? b as Record<string, unknown>[] : [];
  const rate = rows.filter((x) => /rate|cash rate|refinancing|bank rate|policy/i.test(String(x.name)) && !/inflation|unemployment|exchange|mortgage|participation/i.test(String(x.name)));
  return { count: rows.length, rate: rate.map((x) => ({ time: x.time, cc: x.countryCode, name: x.name, actual: x.actual, previous: x.previous, unit: x.unit, source: x.source })) };
});

mkdirSync("out", { recursive: true });
writeFileSync("out/probes.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 3000));

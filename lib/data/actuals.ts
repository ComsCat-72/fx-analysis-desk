// Actual results for the Forex Factory schedule, from biquote.io's free, keyless economic calendar
// (https://biquote.io/api/calendar). Response: an array of events such as
//   { id, eventId, time: "2026-10-26T03:30:00Z", countryCode: "TH", currency: "THB", name: "Imports YoY", importance,
//     type, unit: "percent" | "currency" | "none", multiplier: "billions" | null, digits: 1,
//     actual: 50.4, forecast: 31.3, previous: 25.1, revisedPrevious: null, sourceUrl, source } Forex Factory stays the master schedule: a biquote release is attached to a
// Forex Factory event only when currency and time agree and the figures or titles identify it unambiguously.
// Values are appended to the event history (lib/data/calendar.ts), so a disagreement with another source shows
// as "conflicting" instead of being overwritten.
import { parseValue } from "../core/events.ts";
import { getJSON, putJSON } from "../store.ts";
import { eventsBetween, recordValues, type CalendarEvent } from "./calendar.ts";
import { addDays, dateIn, monday } from "../dates.ts";
import { FXSTREET_HEADERS, FXSTREET_SOURCE, fxstreetUrl, parseFxstreet } from "./fxstreet.ts";

export const BIQUOTE_URL = process.env.BIQUOTE_URL || "https://biquote.io/api/calendar"; // overridable for local testing
export const SOURCE = "biquote.io economic calendar";
const COUNTRIES = ["US", "EU", "GB", "JP", "AU", "NZ", "CA", "CH", "CN", "DE", "FR", "IT", "ES"];
const CURRENCY: Record<string, string> = { US: "USD", USA: "USD", EU: "EUR", EMU: "EUR", EA: "EUR", DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", GB: "GBP", UK: "GBP",
  JP: "JPY", AU: "AUD", NZ: "NZD", CA: "CAD", CH: "CHF", CN: "CNY" };

export interface Release { title: string; currency: string; at: number; actual: string | null; forecast: string | null; previous: string | null; revised: string | null; unit: string | null;
  digits?: number | null; multiplier?: string | null; source?: string; url?: string }

const pick = (o: Record<string, unknown>, keys: string[]) => { for (const k of keys) if (o[k] != null && o[k] !== "") return { key: k, value: o[k] }; return null; };
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

/** Parse biquote's response. The field names are matched against several candidates; `fields` records which matched. */
export function parseReleases(body: unknown, fields: Record<string, string> = {}): Release[] {
  const list = Array.isArray(body) ? body : (["data", "events", "items", "results"].map((k) => (body as Record<string, unknown>)?.[k]).find(Array.isArray) ?? []) as unknown[];
  const out: Release[] = [];
  for (const raw of list) {
    const o = raw as Record<string, unknown>;
    const f = (name: string, keys: string[]) => { const p = pick(o, keys); if (p) fields[name] ??= p.key; return p?.value; };
    const title = str(f("title", ["title", "event", "name", "eventName", "indicator"]));
    const cur = str(f("currency", ["currency", "ccy"]));
    const country = str(f("country", ["country", "countryCode", "country_code", "region"]));
    const when = f("time", ["date", "datetime", "dateTime", "time", "timestamp", "releaseDate", "scheduledAt"]);
    const at = typeof when === "number" ? (when < 1e12 ? when * 1000 : when) : when ? Date.parse(String(when).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(when)) ? "" : "Z")) : NaN;
    const currency = cur?.toUpperCase() ?? CURRENCY[(country ?? "").toUpperCase()];
    if (!title || !currency || Number.isNaN(at)) continue;
    out.push({ title, currency, at, actual: str(f("actual", ["actual", "actualValue", "value"])), forecast: str(f("forecast", ["forecast", "consensus", "estimate", "expected"])),
      previous: str(f("previous", ["previous", "prior", "prev"])), revised: str(f("revised", ["revisedPrevious", "revised", "previousRevised", "revised_previous"])), unit: str(f("unit", ["unit", "units", "suffix"])),
      digits: typeof o.digits === "number" ? o.digits : null, multiplier: str(o.multiplier) });
  }
  return out;
}

const SYN: [RegExp, string][] = [[/\bm\/m\b|\bmom\b|month[- ]over[- ]month/g, " mom "], [/\by\/y\b|\byoy\b|year[- ]over[- ]year/g, " yoy "], [/\bq\/q\b|\bqoq\b/g, " qoq "],
  [/consumer price index/g, " cpi "], [/producer price index/g, " ppi "], [/gross domestic product/g, " gdp "], [/purchasing managers'? index/g, " pmi "],
  [/(initial )?jobless claims|unemployment claims/g, " claims "], [/non[- ]?farm (employment change|payrolls)/g, " nfp "], [/(interest )?rate decision|cash rate|bank rate|policy rate|funds rate|refinancing rate/g, " rate "]];
export function tokens(title: string): Set<string> {
  let t = ` ${title.toLowerCase()} `;
  for (const [re, w] of SYN) t = t.replace(re, w);
  return new Set(t.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((x) => x.length > 1 && !["the", "of", "and", "s", "sa", "nsa", "prel", "final", "flash"].includes(x)));
}
const overlap = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.size, b.size); };

const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
const num = (s: string | null | undefined) => { const v = parseValue(s); return v ? v.num * (SCALE[v.unit] ?? 1) : null; };
const eq = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
/** Same figure, whether or not one side carries the K/M/B unit (225K = 225000 = 225). */
const same = (a: string | null | undefined, b: string | null | undefined) => {
  const pa = parseValue(a), pb = parseValue(b);
  if (!pa || !pb) return false;
  return eq(num(a)!, num(b)!) || eq(pa.num, pb.num);
};

/** Whether a release's figures are percentages; null when the source does not say (no unit, no "%"). */
function releasePct(r: Release): boolean | null {
  if (r.unit === "percent" || r.unit === "%" || [r.actual, r.forecast, r.previous].some((v) => v != null && /%$/.test(String(v)))) return true;
  return r.unit == null ? null : false;
}

/** The Forex Factory event a release belongs to, with its score, or null when none or more than one fit equally well.
 *  A percentage release never matches an event whose figures are not percentages (or the other way round). */
export function matchScored(r: Release, events: CalendarEvent[]): { e: CalendarEvent; s: number } | null {
  const pct = releasePct(r);
  const cands = events.filter((e) => {
    if (e.currency !== r.currency || Math.abs(e.scheduledAt - r.at) > 10 * 60_000 || e.impact === "Holiday") return false;
    const ref = parseValue(e.consensus) ?? parseValue(e.previous);
    return pct == null || !ref || (ref.unit === "%") === pct;
  });
  if (!cands.length) return null;
  const rt = tokens(r.title);
  const scored = cands.map((e) => ({ e, s: (same(r.previous, e.previous) ? 3 : 0) + (same(r.forecast, e.consensus) ? 2 : 0) + 2 * overlap(rt, tokens(e.title)) }))
    .sort((a, b) => b.s - a.s);
  if (scored[0].s < 1) return null; // nothing beyond coincidence of time
  if (scored.length > 1 && Math.abs(scored[0].s - scored[1].s) < 0.5) return null; // ambiguous: never guess
  return scored[0];
}
export const matchEvent = (r: Release, events: CalendarEvent[]) => matchScored(r, events)?.e ?? null;

// biquote describes units as e.g. unit "percent" with digits 1, or unit "currency" with multiplier "billions".
const MULT: Record<string, string> = { thousands: "K", millions: "M", billions: "B", trillions: "T" };

/** A biquote figure written the way Forex Factory writes the event's own figures (unit suffix and decimals).
 *  Without a Forex Factory figure to copy, biquote's own unit, multiplier and digits are used. */
export function formatLike(value: string, like: (string | null)[], unit: string | null = null, digits: number | null = null, multiplier: string | null = null): string {
  const raw = String(value).trim();
  const ref = like.map((x) => parseValue(x)).find(Boolean);
  if (/%$/.test(raw)) return raw; // already carries its unit
  const stated = MULT[multiplier ?? ""]; // biquote: 0.676 with multiplier "millions" is 0.676M
  const suf = raw.match(/^(-?[\d.,]+)\s*([KMBT])$/i) ?? (stated && ref && SCALE[ref.unit] && /^-?[\d.,]+$/.test(raw) ? [raw, raw, stated] : null);
  if (suf) {
    // A figure with its own multiplier (FXStreet "0.676M") rescaled to the Forex Factory unit ("676K").
    const scale = ref ? SCALE[ref.unit] : undefined;
    if (!ref || !scale) return raw;
    const abs = Number(suf[1].replace(/,/g, "")) * SCALE[suf[2].toUpperCase()];
    return `${(abs / scale).toFixed(ref.decimals)}${ref.unit}`;
  }
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  if (!ref) {
    const suffix = unit === "%" || unit === "percent" ? "%" : MULT[multiplier ?? ""] ?? "";
    return `${digits != null && digits >= 0 ? n.toFixed(digits) : raw}${suffix}`;
  }
  const scale = SCALE[ref.unit] ?? 1;
  // A plain number for a K/M/B series is either already in that unit or a full count; pick the reading near the reference.
  const v = scale > 1 && Math.abs(n) > Math.abs(ref.num) * scale / 100 ? n / scale : n;
  return `${v.toFixed(ref.decimals)}${ref.unit === "bp" ? "bp" : ref.unit}`;
}

export const HOT_GAP_MS = 20_000;

/** A release in the last 30 minutes that has figures but no actual yet. */
export async function releaseAwaiting(now: number): Promise<boolean> {
  const evs = await eventsBetween(now - 30 * 60_000, now + 1);
  return evs.some((e) => (e.consensus || e.previous) && e.impact !== "Holiday" && !e.history.some((h) => h.field === "actual" && h.value));
}

export interface SyncResult { fetched: number; matched: number; recorded: number; fields: Record<string, string>; error: string | null; skipped?: string }
interface SyncDoc { at: number; result: SyncResult; running?: number | null }

/** Fetch releases for the range and attach actuals (and missing forecast/previous) to Forex Factory events.
 *  Runs at most once every `minGapMs`, and never twice at once: a run first claims the sync document.
 *  All values for one calendar week are written in a single update. Failures are returned, never thrown. */
export async function syncActuals(from: number, to: number, o: { now?: number; minGapMs?: number; fetcher?: typeof fetch } = {}): Promise<SyncResult> {
  const now = o.now ?? Date.now(), gap = o.minGapMs ?? 120_000;
  const last = await getJSON<SyncDoc>("actuals-sync.json");
  if (last?.running && now - last.running < 90_000) return { ...last.result, skipped: "sync already running" };
  if (last && !last.running && now - last.at < gap) {
    // Right after a release (within 30 minutes, with figures but no actual yet) sync every 20 s instead.
    if (now - last.at < HOT_GAP_MS || !(await releaseAwaiting(now))) return { ...last.result, skipped: "synced recently" };
  }
  const empty: SyncResult = { fetched: 0, matched: 0, recorded: 0, fields: {}, error: null };
  await putJSON("actuals-sync.json", { at: last?.at ?? 0, result: last?.result ?? empty, running: now } satisfies SyncDoc).catch(() => undefined);
  const fields: Record<string, string> = {};
  let result: SyncResult;
  let sourceErrors: string | null = null;
  try {
    // Both free sources at once; one failing never blocks the other. FXStreet first: it publishes US/UK actuals within
    // minutes. biquote: one request per UTC day, because a multi-day query is capped at 100 rows.
    const days: string[] = [];
    for (let d = dateIn(from, "UTC"), end = dateIn(to, "UTC"); d <= end && days.length < 7; d = addDays(d, 1)) days.push(d);
    const get = async (url: string, headers: Record<string, string>) => {
      const r = await (o.fetcher ?? fetch)(url, { headers: { "User-Agent": "fx-analysis-desk/1.0", ...headers }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    };
    const [fxs, bq] = await Promise.allSettled([
      get(fxstreetUrl(Date.parse(`${days[0]}T00:00:00Z`), Date.parse(`${days.at(-1)}T23:59:59Z`)), FXSTREET_HEADERS).then(parseFxstreet),
      Promise.all(days.map((d) => get(`${BIQUOTE_URL}?${new URLSearchParams({ from: d, to: addDays(d, 1), countries: COUNTRIES.join(",") })}`, { Accept: "application/json" })
        .then((b) => parseReleases(b, fields)))).then((l) => l.flat()), // biquote needs to > from
    ]);
    const failed = [fxs.status === "rejected" && `FXStreet unavailable: ${(fxs.reason as Error).message}`, bq.status === "rejected" && `biquote.io unavailable: ${(bq.reason as Error).message}`].filter(Boolean) as string[];
    if (failed.length === 2) throw new Error(failed.join("; "));
    const seen = new Set<string>();
    const releases = [...(fxs.status === "fulfilled" ? fxs.value : []), ...(bq.status === "fulfilled" ? bq.value : [])]
      .filter((x) => { const k = `${x.source ?? SOURCE}|${x.currency}|${x.at}|${x.title}`; return !seen.has(k) && (seen.add(k), true); });
    sourceErrors = failed.length ? failed.join("; ") : null;
    const events = await eventsBetween(from - 86400_000, to + 86400_000);
    const byWeek = new Map<string, Parameters<typeof recordValues>[1]>();
    let matched = 0;
    // Several releases from one source can fit the same event (FXStreet lists "New Home Sales" and "New Home Sales
    // Change"); only the best fit per source and event is used, so a sibling series never makes the event conflicting.
    const best = new Map<string, { rel: Release; e: CalendarEvent; s: number }>();
    for (const rel of releases) {
      const m = matchScored(rel, events);
      if (!m) continue;
      const k = `${rel.source ?? SOURCE}|${m.e.id}`, cur = best.get(k);
      if (!cur || m.s > cur.s) best.set(k, { rel, ...m });
    }
    const fxsActual = new Set([...best.values()].filter((b) => b.rel.source === FXSTREET_SOURCE && b.rel.actual).map((b) => b.e.id));
    for (const { rel, e } of best.values()) {
      matched++;
      // FXStreet's figure is preferred; biquote fills only events FXStreet has no actual for.
      const fxsHas = fxsActual.has(e.id) || e.history.some((h) => h.field === "actual" && h.source === FXSTREET_SOURCE);
      const wk = monday(dateIn(e.scheduledAt, "America/New_York"));
      const src = rel.source ?? SOURCE;
      const put = (field: "actual" | "consensus" | "previous" | "revised_previous", v: string) => {
        // Skip only if it is already this source's latest value: re-recording an older value makes it current again.
        const mine = e.history.filter((h) => h.field === field && h.source === src).sort((a, b) => a.at - b.at).at(-1);
        if (mine?.value === v) return;
        const list = byWeek.get(wk) ?? [];
        // The same figure from the second source adds nothing; a different one is kept and shows as conflicting.
        if (field === "actual" && list.some((x) => x.id === e.id && x.field === "actual" && same(x.value, v))) return;
        if (field === "actual" && e.history.some((h) => h.field === "actual" && h.source !== src && same(h.value, v))) return;
        if (field !== "actual" && list.some((x) => x.id === e.id && x.field === field)) return;
        list.push({ id: e.id, field, value: v, source: src, url: rel.url ?? BIQUOTE_URL, at: now });
        byWeek.set(wk, list);
      };
      const fmt = (v: string) => formatLike(v, [e.consensus, e.previous], rel.unit, rel.digits, rel.multiplier);
      if (rel.actual && rel.at <= now && !(src !== FXSTREET_SOURCE && fxsHas)) put("actual", fmt(rel.actual));
      if (!e.consensus && rel.forecast) put("consensus", fmt(rel.forecast));
      if (!e.previous && rel.previous) put("previous", fmt(rel.previous));
      if (rel.revised && e.previous && !same(rel.revised, e.previous)) put("revised_previous", fmt(rel.revised));
    }
    let recorded = 0;
    for (const [wk, entries] of byWeek) recorded += await recordValues(wk, entries);
    result = { fetched: releases.length, matched, recorded, fields, error: sourceErrors };
  } catch (e) {
    result = { fetched: 0, matched: 0, recorded: 0, fields, error: (e as Error).message };
  }
  await putJSON("actuals-sync.json", { at: now, result, running: null } satisfies SyncDoc).catch(() => undefined);
  return result;
}

export const lastSync = async () => (await getJSON<SyncDoc>("actuals-sync.json")) ?? null;

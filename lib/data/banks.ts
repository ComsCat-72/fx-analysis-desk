// Central-bank policy rates. Past and scheduled decisions come from biquote.io's free calendar (high-importance
// events, fetched in monthly chunks because one long query is capped at 200 rows). A decision just released whose
// figure biquote has not filled yet is taken from the Forex Factory calendar's actual (FXStreet), when recorded there.
// Nothing is estimated: a bank with no recorded decision shows none.
import { CONFIG } from "../config.ts";
import { parseValue } from "../core/events.ts";
import { addDays, dateIn } from "../dates.ts";
import { getJSON, putJSON } from "../store.ts";
import { BIQUOTE_URL } from "./actuals.ts";
import { eventAsOf, eventsBetween } from "./calendar.ts";

export const BANKS: { id: string; name: string; currency: string; country: string; rate: string; biquote: RegExp; ff: RegExp }[] = [
  { id: "fed", name: "Federal Reserve", currency: "USD", country: "US", rate: "Federal funds rate (upper bound)", biquote: /^fed interest rate decision$/i, ff: /^federal funds rate$/i },
  { id: "ecb", name: "European Central Bank", currency: "EUR", country: "EU", rate: "Main refinancing rate", biquote: /^ecb interest rate decision$/i, ff: /^main refinancing rate$/i },
  { id: "boe", name: "Bank of England", currency: "GBP", country: "GB", rate: "Bank Rate", biquote: /^boe interest rate decision$/i, ff: /^official bank rate$/i },
  { id: "boj", name: "Bank of Japan", currency: "JPY", country: "JP", rate: "Policy rate", biquote: /^boj interest rate decision$/i, ff: /^boj policy rate$/i },
  { id: "rba", name: "Reserve Bank of Australia", currency: "AUD", country: "AU", rate: "Cash rate", biquote: /^rba interest rate decision$/i, ff: /^cash rate$/i },
  { id: "rbnz", name: "Reserve Bank of New Zealand", currency: "NZD", country: "NZ", rate: "Official cash rate", biquote: /^rbnz interest rate decision$/i, ff: /^official cash rate$/i },
  { id: "boc", name: "Bank of Canada", currency: "CAD", country: "CA", rate: "Overnight rate", biquote: /^boc interest rate decision$/i, ff: /^overnight rate$/i },
  { id: "snb", name: "Swiss National Bank", currency: "CHF", country: "CH", rate: "SNB policy rate", biquote: /^snb interest rate decision$/i, ff: /^snb policy rate$/i },
];

export interface Decision { bank: string; at: number; actual: number | null; previous: number | null; source: string }
export interface BanksDoc { fetchedAt: number; decisions: Decision[]; error: string | null }

const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : parseValue(String(v))?.num ?? null);

/** biquote rows to rate decisions of the eight banks. */
export function parseDecisions(body: unknown): Decision[] {
  const out: Decision[] = [];
  for (const o of (Array.isArray(body) ? body : []) as Record<string, unknown>[]) {
    const b = BANKS.find((x) => x.country === String(o.countryCode ?? "").toUpperCase() && x.biquote.test(String(o.name ?? "").trim()));
    const at = Date.parse(String(o.time ?? ""));
    if (b && !Number.isNaN(at)) out.push({ bank: b.id, at, actual: num(o.actual), previous: num(o.previous), source: "biquote.io" });
  }
  return out;
}

export async function refreshBanks(now = Date.now(), fetcher: typeof fetch = fetch): Promise<BanksDoc> {
  const chunks: [string, string][] = [];
  for (let d = addDays(dateIn(now, "UTC"), -365), end = addDays(dateIn(now, "UTC"), 150); d < end; d = addDays(d, 31)) chunks.push([d, addDays(d, 31)]);
  const prev = await getJSON<BanksDoc>("banks.json");
  const decisions: Decision[] = [], errors: string[] = [];
  for (let i = 0; i < chunks.length; i += 4) { // four requests at a time
    await Promise.all(chunks.slice(i, i + 4).map(async ([from, to]) => {
      try {
        const q = new URLSearchParams({ from, to, importance: "high", countries: BANKS.map((b) => b.country).join(",") });
        const r = await fetcher(`${BIQUOTE_URL}?${q}`, { headers: { Accept: "application/json", "User-Agent": "fx-analysis-desk/1.0" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        decisions.push(...parseDecisions(await r.json()));
      } catch (e) { errors.push(`${from}: ${(e as Error).message}`); }
    }));
  }
  if (!decisions.length) return { ...(prev ?? { decisions: [] }), fetchedAt: prev?.fetchedAt ?? 0, error: `biquote.io unavailable: ${errors[0] ?? "no decisions"}` };
  const seen = new Set<string>();
  const doc: BanksDoc = { fetchedAt: now, error: errors.length ? `some months missing: ${errors.join("; ")}` : null,
    decisions: decisions.filter((d) => { const k = `${d.bank}|${d.at}`; return !seen.has(k) && (seen.add(k), true); }).sort((a, b) => a.at - b.at) };
  await putJSON("banks.json", doc);
  return doc;
}

export interface BankRow {
  id: string; name: string; currency: string; rate_name: string; rate: number | null; rate_at: number | null; rate_source: string | null;
  awaiting_at: number | null; last_change: { at: number; bp: number } | null; next_at: number | null; history: { at: number; rate: number }[];
}

/** One row per bank from the stored decisions plus decisions recorded on the calendar. */
export function bankRows(decisions: Decision[], calendar: { currency: string; title: string; at: number; actual: string | null; previous: string | null }[], now: number): BankRow[] {
  return BANKS.map((b) => {
    const list = decisions.filter((d) => d.bank === b.id).map((d) => ({ ...d }));
    for (const c of calendar.filter((c) => c.currency === b.currency && b.ff.test(c.title.trim()) && c.actual)) {
      const v = parseValue(c.actual)?.num ?? null, near = list.find((d) => Math.abs(d.at - c.at) < 36 * 3600_000);
      if (near) { if (near.actual == null && v != null) Object.assign(near, { actual: v, source: "calendar" }); }
      else list.push({ bank: b.id, at: c.at, actual: v, previous: parseValue(c.previous)?.num ?? null, source: "calendar" });
    }
    const past = list.filter((d) => d.at <= now).sort((x, y) => y.at - x.at), known = past.filter((d) => d.actual != null);
    const cur = known[0] ?? null;
    let last: BankRow["last_change"] = null;
    for (let i = 0; i < known.length && !last; i++) {
      const before = known[i].previous ?? known[i + 1]?.actual ?? null;
      if (before != null && Math.abs(known[i].actual! - before) > 1e-9) last = { at: known[i].at, bp: Math.round((known[i].actual! - before) * 100) };
    }
    const awaiting = past.find((d) => d.actual == null && (!cur || d.at > cur.at));
    return { id: b.id, name: b.name, currency: b.currency, rate_name: b.rate, rate: cur?.actual ?? null, rate_at: cur?.at ?? null, rate_source: cur?.source ?? null,
      awaiting_at: awaiting?.at ?? null, last_change: last, next_at: list.filter((d) => d.at > now).sort((x, y) => x.at - y.at)[0]?.at ?? null,
      history: known.slice(0, 8).map((d) => ({ at: d.at, rate: d.actual! })) };
  });
}

/** Rate differential (base minus quote, percentage points) for each configured currency pair. */
export function differentials(rows: BankRow[]) {
  const rate = (c: string) => rows.find((r) => r.currency === c)?.rate ?? null;
  return Object.values(CONFIG.instruments).filter((i) => i.kind === "fx_spot").map((i) => {
    const a = rate(i.base), b = rate(i.quote);
    return { pair: i.display, base: i.base, quote: i.quote, diff: a != null && b != null ? a - b : null };
  });
}

/** Stored decisions (refreshed when older than 6 hours) merged with the calendar's recorded decisions. */
export async function banks(now = Date.now()) {
  let doc = await getJSON<BanksDoc>("banks.json");
  if (!doc || now - doc.fetchedAt > 6 * 3600_000) doc = await refreshBanks(now);
  const cal = (await eventsBetween(now - 45 * 86400_000, now + 86400_000)).map((e) => {
    const s = eventAsOf(e, now);
    return { currency: e.currency, title: e.title, at: e.scheduledAt, actual: s.actual, previous: s.previous };
  });
  const rows = bankRows(doc.decisions, cal, now);
  return { fetched_at: doc.fetchedAt || null, error: doc.error, rows, differentials: differentials(rows) };
}

// CFTC Commitments of Traders (free, no key): the Legacy futures-only report from the CFTC's public reporting API
// (publicreporting.cftc.gov, dataset 6dca-aqww). Published Fridays for positions as of the Tuesday before.
// Shown per contract: large speculators (non-commercial) and commercials, long, short, net and the weekly change.
import { getJSON, putJSON } from "../store.ts";

export const COT_URL = process.env.COT_URL || "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
export const COT_PAGE = "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm";
export const CONTRACTS: { code: string; label: string; currency: string }[] = [
  { code: "098662", label: "US Dollar Index", currency: "USD" }, { code: "099741", label: "Euro", currency: "EUR" },
  { code: "096742", label: "British pound", currency: "GBP" }, { code: "097741", label: "Japanese yen", currency: "JPY" },
  { code: "232741", label: "Australian dollar", currency: "AUD" }, { code: "112741", label: "New Zealand dollar", currency: "NZD" },
  { code: "090741", label: "Canadian dollar", currency: "CAD" }, { code: "092741", label: "Swiss franc", currency: "CHF" },
  { code: "088691", label: "Gold (COMEX)", currency: "XAU" },
];

export interface CotRow {
  code: string; label: string; currency: string; date: string; open_interest: number;
  spec_long: number; spec_short: number; spec_net: number; spec_net_change: number | null; spec_long_pct: number;
  comm_long: number; comm_short: number; comm_net: number; comm_net_change: number | null;
}
export interface CotDoc { fetchedAt: number; report_date: string | null; rows: CotRow[]; error: string | null }

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Socrata rows (newest first or not) to one row per contract with the change against the week before. */
export function parseCot(body: unknown): CotRow[] {
  const list = Array.isArray(body) ? body as Record<string, unknown>[] : [];
  const out: CotRow[] = [];
  for (const c of CONTRACTS) {
    const rows = list.filter((r) => String(r.cftc_contract_market_code).trim() === c.code)
      .sort((a, b) => String(b.report_date_as_yyyy_mm_dd).localeCompare(String(a.report_date_as_yyyy_mm_dd)));
    const [cur, prev] = rows;
    if (!cur) continue;
    const net = (r: Record<string, unknown>, k: "noncomm" | "comm") => n(r[`${k}_positions_long_all`]) - n(r[`${k}_positions_short_all`]);
    const sl = n(cur.noncomm_positions_long_all), ss = n(cur.noncomm_positions_short_all);
    out.push({ code: c.code, label: c.label, currency: c.currency, date: String(cur.report_date_as_yyyy_mm_dd).slice(0, 10), open_interest: n(cur.open_interest_all),
      spec_long: sl, spec_short: ss, spec_net: sl - ss, spec_net_change: prev ? net(cur, "noncomm") - net(prev, "noncomm") : null,
      spec_long_pct: sl + ss ? (100 * sl) / (sl + ss) : 0,
      comm_long: n(cur.comm_positions_long_all), comm_short: n(cur.comm_positions_short_all), comm_net: net(cur, "comm"),
      comm_net_change: prev ? net(cur, "comm") - net(prev, "comm") : null });
  }
  return out;
}

export async function refreshCot(now = Date.now(), fetcher: typeof fetch = fetch): Promise<CotDoc> {
  const q = new URLSearchParams({ $where: `cftc_contract_market_code in(${CONTRACTS.map((c) => `'${c.code}'`).join(",")})`,
    $order: "report_date_as_yyyy_mm_dd DESC", $limit: "60" });
  const prev = await getJSON<CotDoc>("cot.json");
  try {
    const r = await fetcher(`${COT_URL}?${q}`, { headers: { Accept: "application/json", "User-Agent": "fx-analysis-desk/1.0" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = parseCot(await r.json());
    if (!rows.length) throw new Error("no rows for the contracts");
    const doc: CotDoc = { fetchedAt: now, report_date: rows.map((x) => x.date).sort().at(-1) ?? null, rows, error: null };
    await putJSON("cot.json", doc);
    return doc;
  } catch (e) {
    const doc: CotDoc = { ...(prev ?? { report_date: null, rows: [] }), fetchedAt: prev?.fetchedAt ?? 0, error: `CFTC unavailable: ${(e as Error).message}` };
    return doc;
  }
}

/** Stored report, refreshed when older than 6 hours (the report changes once a week). */
export async function cot(now = Date.now()): Promise<CotDoc> {
  const doc = await getJSON<CotDoc>("cot.json");
  if (doc && now - doc.fetchedAt < 6 * 3600_000) return doc;
  return refreshCot(now);
}

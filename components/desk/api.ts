import { useEffect, useState } from "react";

export interface Instrument { code: string; display: string; base: string; quote: string; kind: string; label?: string | null; decimals: number; symbol: string }

export interface AppConfig {
  app_env: string;
  /** timezone: the viewer's browser zone (all display); default_timezone: used when a browser sends none (Configure). */
  display: { timezone: string; timezone_label: string; choices: { tz: string; label: string }[]; default_timezone: string; default_label: string };
  instruments: Instrument[];
  providers: Record<string, unknown>;
  credentials: Record<string, boolean>;
}

export interface StrengthRow { currency: string; pct: number }
export interface Strength {
  as_of_display: string; today_start_display: string; week_start_display: string; today: StrengthRow[]; week: StrengthRow[];
  crosses_today: { pair: string; pct: number }[]; quotes: { currency: string; symbol: string; price: number; time_display: string | null }[]; errors: string[];
}
export interface Correlation { as_of_display: string; labels: { code: string; display: string }[]; m20: (number | null)[][]; m60: (number | null)[][]; last_date: string | null; errors: string[]; note: string }
export interface CotRow {
  code: string; label: string; currency: string; date: string; open_interest: number; spec_long: number; spec_short: number; spec_net: number;
  spec_net_change: number | null; spec_long_pct: number; comm_long: number; comm_short: number; comm_net: number; comm_net_change: number | null;
}
export interface Cot { report_date: string | null; rows: CotRow[]; error: string | null; fetched_display: string | null; source_url: string }
export interface BankRow {
  id: string; name: string; currency: string; rate_name: string; rate: number | null; rate_display: string | null; rate_source: string | null;
  awaiting_display: string | null; last_change: { bp: number; display: string } | null; next_display: string | null; next_at: number | null;
  history: { rate: number; display: string }[];
}
export interface Banks { fetched_display: string | null; error: string | null; rows: BankRow[]; differentials: { pair: string; base: string; quote: string; diff: number | null }[] }
export interface Headline { id: string; source: string; title: string; url: string | null; at: number; at_display: string; currencies: string[] }
export interface Headlines { refreshed_display: string | null; errors: string[]; refreshing: boolean; items: Headline[] }
export interface Policy { refreshed_display: string | null; errors: string[]; refreshing: boolean; items: { bank: string; currency: string; kind: string; title: string; url: string | null; at_display: string }[] }

/** Plain-language versions of the technical errors a reader might meet; anything else is shown as the server wrote it. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/Failed to fetch|NetworkError|load failed/i.test(m)) return "The server could not be reached. Check your connection and try again.";
  if (/admin token required|not authorised/i.test(m)) return "This action needs the admin password: click the key icon in the top bar and enter your ADMIN_TOKEN.";
  if (/could not save .*kept rejecting/i.test(m)) return "The change could not be saved because another save happened at the same moment. Please try again.";
  if (/HTTP 50[24]|timed out|timeout|aborted|FUNCTION_INVOCATION_TIMEOUT/i.test(m)) return "The server took too long to answer. Please try again in a minute.";
  return m;
}

export interface CalRow {
  id: string; date: string; time: string; at: string; all_day: boolean; source_time: string; currency: string; impact: string; title: string;
  actual: string | null; forecast: string | null; previous: string | null; revised_previous: string | null; revision: "up" | "down" | null;
  state: string; tone: "better" | "worse" | "inline" | null; actual_sources: string[]; conflicting: Record<string, string> | null;
  source: string; is_fixture: boolean; is_next: boolean;
}
export interface CalRange { from: string; to: string; timezone: string; timezone_label: string; now: string; currencies: string[];
  coverage: { week: string; stored: boolean; refreshed_display: string | null }[]; rows: CalRow[];
  actuals_sync?: { fetched: number; matched: number; recorded: number; error: string | null; skipped?: string } | null; actuals_synced_display?: string | null }
export interface RateRow { pair: string; rate: number | null; time?: string | null; sources?: string[]; fixture?: boolean; error: string | null }

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : (detail as { message?: string })?.message ?? `HTTP ${status}`);
  }
}

export function getToken(): string {
  try { return localStorage.getItem("fx.adminToken") ?? ""; } catch { return ""; }
}
export function setToken(t: string) {
  try { localStorage.setItem("fx.adminToken", t); } catch { /* storage unavailable */ }
}
/** The viewer's own timezone, sent with every request so the server shows times in it. */
export const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
const authHeaders = (): Record<string, string> => ({ ...(getToken() ? { "X-Admin-Token": getToken() } : {}), ...(browserZone() ? { "X-Display-TZ": browserZone() } : {}) });

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) } });
  if (r.status === 401) window.dispatchEvent(new Event("fx:auth-required"));
  if (!r.ok) {
    let detail: unknown = r.statusText;
    try {
      const j = await r.json();
      detail = j.error ? `${j.detail ?? "Error"}: ${j.error}${j.where ? ` (${j.where.join(" > ")})` : ""}` : j.detail;
    } catch {
      detail = `HTTP ${r.status}${r.statusText ? " " + r.statusText : ""} (the server returned a non-JSON error; check the hosting logs)`;
    }
    throw new ApiError(r.status, detail);
  }
  return r.json() as Promise<T>;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const api = {
  health: () => req<{ ok: boolean; app_env: string; storage: string; persistent_storage: boolean }>("/api/health"),
  authCheck: () => req<{ token_required: boolean; protect_reads: boolean; valid: boolean }>("/api/auth/check"),
  config: () => req<AppConfig>("/api/config"),
  addActual: (id: string, value: string, source: string, url?: string) =>
    req<{ state: string }>(`/api/events/${encodeURIComponent(id)}/actual`, { method: "POST", body: JSON.stringify({ value, source, url }) }),
  calendarRange: (from: string, to: string, currencies: string[], impacts: string[]) =>
    req<CalRange>(`/api/calendar/range?${q({ from, to, currencies: currencies.join(","), impacts: impacts.join(",") })}`, { signal: AbortSignal.timeout(25_000) }),
  ohlc: (pair: string, period: string) => req<{ pair: string; period: string; start: string | null; open: number; high: number; low: number; close: number; source: string; fixture: boolean }>(`/api/ohlc?${q({ pair, period })}`),
  calendarDates: (from: string, to: string, currencies: string[], impacts: string[]) =>
    req<{ dates: string[]; currencies: string[] }>(`/api/calendar/range?${q({ from, to, currencies: currencies.join(","), impacts: impacts.join(","), shape: "dates" })}`),
  eventHistory: (id: string) => req<{ id: string; history: { field: string; value: string | null; source: string; url: string | null; at_display: string }[] }>(`/api/events/${encodeURIComponent(id)}`),
  rates: (pairs: string[]) => req<RateRow[]>(`/api/rates?${q({ pairs: pairs.join(",") })}`),
  saveSettings: (body: { display_timezone?: string }) => req<{ display_timezone: string }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  refreshCalendar: () => req("/api/calendar/refresh", { method: "POST" }),
  strength: () => req<Strength>("/api/markets/strength"),
  correlation: () => req<Correlation>("/api/markets/correlation"),
  cot: () => req<Cot>("/api/markets/cot"),
  banks: () => req<Banks>("/api/banks", { signal: AbortSignal.timeout(55_000) }),
  headlines: (currency?: string) => req<Headlines>(`/api/headlines${currency ? `?${q({ currency })}` : ""}`),
  policy: () => req<Policy>("/api/policy"),
};

/** Re-renders every `ms` with the browser's current time, so "now" markers and countdowns stay live. */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

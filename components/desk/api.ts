export type Kind = "weekly_analysis" | "daily_analysis" | "daily_review" | "weekly_review";

export interface Instrument { code: string; display: string; base: string; quote: string; kind: string; label?: string; decimals: number }

export interface AppConfig {
  app_env: string;
  display: { timezone: string; timezone_label: string; choices: { tz: string; label: string }[] };
  instruments: Instrument[];
  publication_mode: "manual" | "automatic";
  writer: string;
  writer_setting: "template" | "claude";
  schedules: Record<string, string | number | number[]>;
  providers: Record<string, unknown>;
  credentials: Record<string, boolean>;
  technical: Record<string, unknown>;
  evaluation: Record<string, unknown>;
}

export interface VersionSummary {
  id: string; report_id: string; week_key: string; kind: Kind; period_key: string; version: number; version_type: string;
  status: "draft" | "published" | "discarded"; title: string; writer: string; data_mode: "live" | "fixture";
  partial: boolean; created_display: string; published_display: string | null; data_cutoff_display: string;
  blocking: number; warnings: number; change_note: string | null; direction: string | null;
}

export interface Finding { check: string; category: string; severity: "blocking" | "warning" | "info"; message: string; excerpt: string; section: string | null; suggestion: string | null }

export interface FactItem { id: string; kind: string; text: string; source?: string; url?: string; [k: string]: unknown }

export interface ReportDetail extends VersionSummary {
  body_md: string;
  checks: { blocking: number; warnings: number; findings: Finding[] };
  sections: { text: Record<string, string>; outlook: unknown; headings: Record<string, string> };
  facts: { meta: Record<string, unknown>; facts: Record<string, FactItem>; levels: Record<string, FactItem>; events: Record<string, FactItem>; policy: Record<string, FactItem>; warnings: { code: string; severity: string; message: string }[]; missing: string[]; evaluation: unknown; continuity: Record<string, unknown> };
  content_hash: string | null;
  versions: VersionSummary[];
}

/** Whether a report can be written now (analyses before or during their period, reviews after it closes). */
export interface SlotState { ok: boolean; state: "open" | "not_yet" | "closed"; reason: string; opens_display: string | null }
export interface WeekDay { date: string; day: string; daily_analysis: VersionSummary[]; daily_review: VersionSummary[]; slots: { daily_analysis: SlotState; daily_review: SlotState } }
export interface Week { week_key: string; instrument: string; days: WeekDay[]; weekly_analysis: VersionSummary[]; weekly_review: VersionSummary[];
  slots: { weekly_analysis: SlotState; weekly_review: SlotState }; change_log: { at: string; from: string; to: string; evidence: string }[] }

export interface CalendarRow { id: string; currency: string; title: string; impact: string; time_eat: string; time_label: string; source_time: string; consensus: string | null; previous: string | null; revised_previous: string | null; actual: string | null; state: string; actual_sources: string[]; source: string; is_fixture: boolean }
export interface Level { id: string; lower: number; upper: number; timeframe: string; role: string; origin: string; reason: string; status: string; approximate: boolean; created_display: string; is_fixture: boolean }
export interface EvaluationRow { period_key: string; kind: string; direction: string; qualification: string | null; version: number; directional: string; detail: Record<string, string>; conditional: { side: string; boundary: string; outcome: string }[]; evaluated_display: string }
export interface Freshness { status: "ok" | "stale" | "missing"; message: string; market_open: boolean; last_h1_close: string | null; provider: string | null; is_fixture: boolean; age_hours?: number }
export interface DQWarning { id: number; code: string; severity: string; message: string; created_display: string }
export interface Job { job: string; slot: string; instrument: string; status: string; attempts: number; error: string | null; started_display: string; version_id: string | null; detail?: string | null }

/** Plain-language versions of the technical errors a reader might meet; anything else is shown as the server wrote it. */
export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/Failed to fetch|NetworkError|load failed/i.test(m)) return "The server could not be reached. Check your connection and try again.";
  if (/no such (report )?version/i.test(m)) return "That report version could not be found. It may still be saving: wait a moment and reload the page.";
  if (/admin token required|not authorised/i.test(m)) return "This action needs the admin password: click the key icon in the top bar and enter your ADMIN_TOKEN.";
  if (/could not save .*kept rejecting/i.test(m)) return "The report could not be saved because another save happened at the same moment. Please try again.";
  if (/HTTP 50[24]|timed out|FUNCTION_INVOCATION_TIMEOUT/i.test(m)) return "The server took too long to answer. Please try again in a minute.";
  return m;
}

export interface CalRow {
  id: string; date: string; time: string; at: string; all_day: boolean; source_time: string; currency: string; impact: string; title: string;
  actual: string | null; forecast: string | null; previous: string | null; revised_previous: string | null; revision: "up" | "down" | null;
  state: string; tone: "better" | "worse" | "inline" | null; actual_sources: string[]; conflicting: Record<string, string> | null;
  history: { field: string; value: string | null; source: string; url: string | null; at_display: string }[]; source: string; is_fixture: boolean; is_next: boolean;
}
export interface CalRange { from: string; to: string; timezone: string; timezone_label: string; now: string; currencies: string[];
  coverage: { week: string; stored: boolean; refreshed_display: string | null }[]; rows: CalRow[] }
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
/** Export links can't send headers, so the token rides as a query parameter. */
export const withToken = (url: string) => (getToken() ? `${url}?token=${encodeURIComponent(getToken())}` : url);
const authHeaders = (): Record<string, string> => (getToken() ? { "X-Admin-Token": getToken() } : {});

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
  health: () => req<{ ok: boolean; app_env: string; storage: string; persistent_storage: boolean; anthropic_key: boolean }>("/api/health"),
  refresh: (instrument: string) => req<{ problems: string[]; freshness: Freshness }>("/api/refresh", { method: "POST", body: JSON.stringify({ instrument }) }),
  authCheck: () => req<{ token_required: boolean; protect_reads: boolean; valid: boolean }>("/api/auth/check"),
  config: () => req<AppConfig>("/api/config"),
  week: (inst: string, wk: string) => req<Week>(`/api/weeks/${inst}/${wk}`),
  report: (id: string) => req<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`),
  draft: (instrument: string, kind: Kind, period: string, writer?: string) =>
    req<ReportDetail>("/api/reports/draft", { method: "POST", body: JSON.stringify({ instrument, kind, period, writer }) }),
  editDraft: (id: string, sections: Record<string, string>) =>
    req<ReportDetail>(`/api/reports/${id}/draft`, { method: "PUT", body: JSON.stringify({ sections }) }),
  publish: (id: string, change_note?: string, allow_partial = false) =>
    req<ReportDetail>(`/api/reports/${id}/publish`, { method: "POST", body: JSON.stringify({ change_note, allow_partial }) }),
  correct: (id: string, version_type: "correction" | "update") =>
    req<ReportDetail>(`/api/reports/${id}/correct`, { method: "POST", body: JSON.stringify({ version_type }) }),
  calendar: (instrument: string, week_key: string) => req<CalendarRow[]>(`/api/calendar?${q({ instrument, week_key })}`),
  addActual: (id: string, value: string, source: string, url?: string) =>
    req<{ state: string }>(`/api/events/${encodeURIComponent(id)}/actual`, { method: "POST", body: JSON.stringify({ value, source, url }) }),
  levels: (instrument: string) => req<Level[]>(`/api/levels?${q({ instrument })}`),
  addLevel: (body: { instrument: string; lower: number; upper: number; timeframe: string; role: string; reason: string; approximate?: boolean }) =>
    req<{ id: string }>("/api/levels", { method: "POST", body: JSON.stringify(body) }),
  setLevelStatus: (id: string, status: string, reason: string) =>
    req(`/api/levels/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status, reason }) }),
  evaluations: (instrument: string) => req<EvaluationRow[]>(`/api/evaluations?${q({ instrument })}`),
  freshness: (instrument: string) => req<Freshness>(`/api/freshness?${q({ instrument })}`),
  warnings: (instrument: string) => req<DQWarning[]>(`/api/warnings?${q({ instrument })}`),
  jobs: () => req<Job[]>("/api/jobs"),
  calendarRange: (from: string, to: string, currencies: string[], impacts: string[]) =>
    req<CalRange>(`/api/calendar/range?${q({ from, to, currencies: currencies.join(","), impacts: impacts.join(",") })}`),
  rates: (pairs: string[]) => req<RateRow[]>(`/api/rates?${q({ pairs: pairs.join(",") })}`),
  saveSettings: (body: { writer?: string; display_timezone?: string }) =>
    req<{ writer: string; display_timezone: string }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  setMode: (mode: string, confirm_automatic: boolean) =>
    req(`/api/settings/publication-mode`, { method: "PUT", body: JSON.stringify({ mode, confirm_automatic }) }),
  addNews: (body: { source_name: string; title: string; url?: string; published_at: string; currencies: string[] }) =>
    req("/api/news", { method: "POST", body: JSON.stringify(body) }),
  runJob: (job: Kind, instrument: string, force: boolean) =>
    req<Record<string, unknown>>("/api/jobs/run", { method: "POST", body: JSON.stringify({ job, instrument, force }) }),
  terminology: () => req<{ approved: { term: string }[]; prohibited: { phrase: string }[]; abbreviations: Record<string, { enabled: boolean }> }>("/api/terminology"),
  addTerm: (body: { kind: string; term: string; suggest: string | null; definition: string | null; enabled: boolean }) =>
    req("/api/terminology", { method: "POST", body: JSON.stringify(body) }),
  refreshCalendar: () => req("/api/calendar/refresh", { method: "POST" }),
  uploadScreenshot: async (instrument: string, file: File, extract: boolean) => {
    const fd = new FormData();
    fd.append("instrument", instrument); fd.append("file", file); fd.append("extract", String(extract));
    const r = await fetch("/api/screenshots", { method: "POST", body: fd, headers: authHeaders() });
    if (!r.ok) throw new ApiError(r.status, (await r.json()).detail);
    return r.json() as Promise<{ id: string; extracted: Record<string, unknown> }>;
  },
  confirmScreenshot: (id: string, levels: unknown[], chart_timestamp?: string) =>
    req<{ level_ids: string[] }>(`/api/screenshots/${encodeURIComponent(id)}/confirm`, { method: "POST", body: JSON.stringify({ levels, chart_timestamp }) }),
};

export type Kind = "weekly_analysis" | "daily_analysis" | "daily_review" | "weekly_review";

export interface Instrument { code: string; display: string; base: string; quote: string; kind: string; label?: string; decimals: number }

export interface AppConfig {
  app_env: string;
  display: { timezone: string; timezone_label: string };
  instruments: Instrument[];
  publication_mode: "manual" | "automatic";
  writer: string;
  schedules: Record<string, string | number | number[]>;
  providers: Record<string, unknown>;
  credentials: Record<string, boolean>;
  technical: Record<string, unknown>;
  evaluation: Record<string, unknown>;
}

export interface VersionSummary {
  id: number; report_id: number; kind: Kind; period_key: string; version: number; version_type: string;
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

export interface WeekDay { date: string; day: string; daily_analysis: VersionSummary[]; daily_review: VersionSummary[] }
export interface Week { week_key: string; instrument: string; days: WeekDay[]; weekly_analysis: VersionSummary[]; weekly_review: VersionSummary[]; change_log: { at: string; from: string; to: string; evidence: string }[] }

export interface CalendarRow { id: string; currency: string; title: string; impact: string; time_eat: string; time_label: string; source_time: string; consensus: string | null; previous: string | null; revised_previous: string | null; actual: string | null; state: string; actual_sources: string[]; source: string; is_fixture: boolean }
export interface Level { id: number; lower: number; upper: number; timeframe: string; role: string; origin: string; reason: string; status: string; approximate: boolean; created_display: string; is_fixture: boolean }
export interface EvaluationRow { period_key: string; kind: string; direction: string; qualification: string | null; version: number; directional: string; detail: Record<string, string>; conditional: { side: string; boundary: string; outcome: string }[]; evaluated_display: string }
export interface Freshness { status: "ok" | "stale" | "missing"; message: string; market_open: boolean; last_h1_close: string | null; provider: string | null; is_fixture: boolean; age_hours?: number }
export interface DQWarning { id: number; code: string; severity: string; message: string; created_display: string }
export interface Job { job: string; slot: string; instrument: string; status: string; attempts: number; error: string | null; started_display: string; version_id: number | null }

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
    try { detail = (await r.json()).detail; } catch { /* non-JSON error */ }
    throw new ApiError(r.status, detail);
  }
  return r.json() as Promise<T>;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const api = {
  authCheck: () => req<{ token_required: boolean; protect_reads: boolean; valid: boolean }>("/api/auth/check"),
  config: () => req<AppConfig>("/api/config"),
  week: (inst: string, wk: string) => req<Week>(`/api/weeks/${inst}/${wk}`),
  report: (id: number) => req<ReportDetail>(`/api/reports/${id}`),
  draft: (instrument: string, kind: Kind, period: string, writer?: string) =>
    req<ReportDetail>("/api/reports/draft", { method: "POST", body: JSON.stringify({ instrument, kind, period, writer }) }),
  editDraft: (id: number, sections: Record<string, string>) =>
    req<ReportDetail>(`/api/reports/${id}/draft`, { method: "PUT", body: JSON.stringify({ sections }) }),
  publish: (id: number, change_note?: string, allow_partial = false) =>
    req<ReportDetail>(`/api/reports/${id}/publish`, { method: "POST", body: JSON.stringify({ change_note, allow_partial }) }),
  correct: (id: number, version_type: "correction" | "update") =>
    req<ReportDetail>(`/api/reports/${id}/correct`, { method: "POST", body: JSON.stringify({ version_type }) }),
  calendar: (instrument: string, week_key: string) => req<CalendarRow[]>(`/api/calendar?${q({ instrument, week_key })}`),
  addActual: (id: string, value: string, source: string, url?: string) =>
    req<{ state: string }>(`/api/events/${id}/actual`, { method: "POST", body: JSON.stringify({ value, source, url }) }),
  levels: (instrument: string) => req<Level[]>(`/api/levels?${q({ instrument })}`),
  addLevel: (body: { instrument: string; lower: number; upper: number; timeframe: string; role: string; reason: string; approximate?: boolean }) =>
    req<{ id: number }>("/api/levels", { method: "POST", body: JSON.stringify(body) }),
  setLevelStatus: (id: number, status: string, reason: string) =>
    req(`/api/levels/${id}`, { method: "PATCH", body: JSON.stringify({ status, reason }) }),
  evaluations: (instrument: string) => req<EvaluationRow[]>(`/api/evaluations?${q({ instrument })}`),
  freshness: (instrument: string) => req<Freshness>(`/api/freshness?${q({ instrument })}`),
  warnings: (instrument: string) => req<DQWarning[]>(`/api/warnings?${q({ instrument })}`),
  jobs: () => req<Job[]>("/api/jobs"),
  setMode: (mode: string, confirm_automatic: boolean) =>
    req(`/api/settings/publication-mode`, { method: "PUT", body: JSON.stringify({ mode, confirm_automatic }) }),
  addNews: (body: { source_name: string; title: string; url?: string; published_at: string; currencies: string[] }) =>
    req("/api/news", { method: "POST", body: JSON.stringify(body) }),
  ingest: (instrument: string, start: string, end: string) =>
    req("/api/ingest", { method: "POST", body: JSON.stringify({ instrument, start, end }) }),
  refreshCalendar: () => req("/api/calendar/refresh", { method: "POST" }),
  uploadScreenshot: async (instrument: string, file: File, extract: boolean) => {
    const fd = new FormData();
    fd.append("instrument", instrument); fd.append("file", file); fd.append("extract", String(extract));
    const r = await fetch("/api/screenshots", { method: "POST", body: fd, headers: authHeaders() });
    if (!r.ok) throw new ApiError(r.status, (await r.json()).detail);
    return r.json() as Promise<{ id: number; extracted: Record<string, unknown> }>;
  },
  confirmScreenshot: (id: number, levels: unknown[], chart_timestamp?: string) =>
    req<{ level_ids: number[] }>(`/api/screenshots/${id}/confirm`, { method: "POST", body: JSON.stringify({ levels, chart_timestamp }) }),
};

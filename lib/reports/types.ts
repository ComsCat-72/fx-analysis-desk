// Shapes shared by the report pipeline, the API and the dashboard. Keys stay snake_case to match the
// stored documents and the dashboard contract.
import type { Kind } from "../config.ts";
import type { Finding } from "../content/advice.ts";

export interface Item {
  id: string; kind: string; text: string; values: (string | null)[];
  source?: string | null; url?: string | null; numbers_in_text?: string[]; role?: string;
  [k: string]: unknown;
}
export interface LevelItem extends Item {
  kind: "level"; role: "support" | "resistance"; lower: number; upper: number; timeframe: string;
  origin: "automated" | "user" | "screenshot"; status: string; break_confirmed: boolean; ref: string; // ref: stable key across reports
}
export interface EventItem extends Item {
  kind: "event"; currency: string; title: string; impact: string | null; scheduled_at: string; scheduled_display: string;
  source_time: string; state: string; surprise: string | null; actual: string | null; consensus: string | null; previous: string | null;
  revised_previous: string | null; event_id: string;
}

export interface OutlookSummary {
  version_id: string; version: number; version_type: string; period_key: string; published_at: string; published_display: string;
  data_cutoff_display: string; direction: string; direction_label: string; qualification: string | null;
  conditions: StoredCondition[]; reference_price: number | null; evaluation?: unknown; updates?: unknown[];
}

export interface Meta {
  instrument: string; display: string; base: string; quote: string; instrument_kind: string; instrument_label: string | null;
  economies: [string, string][]; kind: Kind; period_key: string; week_key: string; horizon_start: string; horizon_end: string;
  horizon_display: string; data_cutoff: string; data_cutoff_display: string; display_timezone: string; display_label: string;
  session_description: string; break_rules: { basis: string; sustained_closes: number; reversal_closes: number; timeframe: string };
  providers: string[]; data_mode: "live" | "fixture"; reference_price: number | null; reference_time: string | null; atr_d1: number | null;
  h1_structure: string; allowed_times: string[]; calendar_numbers: string[]; decimals: number;
}

export interface Bundle {
  meta: Meta;
  facts: Record<string, Item>; levels: Record<string, LevelItem>; events: Record<string, EventItem>; policy: Record<string, Item>;
  continuity: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  evaluation: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  warnings: { code: string; severity: string; message: string }[];
  missing: string[];
}

/** What the writer returns for analyses; conditions reference bundle level ids (L#). */
export interface OutlookIn {
  direction: "upward_lean" | "downward_lean" | "neutral" | "range_bound"; qualification: string;
  conditions: { level_id: string; boundary: "lower" | "upper"; side: "above" | "below"; effect: "strengthens" | "weakens"; text: string }[];
  range_level_ids: string[]; zone_ids: string[];
}

export interface StoredCondition { id: number; text: string; level_ref: string; boundary: number; boundary_edge: string; side: "above" | "below"; effect: string }
export interface StoredZone { ref: string; role: "support" | "resistance"; lower: number; upper: number; text: string }

/** Structured expectation stored with a published analysis and used verbatim by later reviews. */
export interface Outlook {
  kind: "weekly" | "daily"; direction: OutlookIn["direction"]; qualification: string | null;
  horizon_start: string; horizon_end: string; reference_price: number | null; reference_time: string | null; atr_at_publication: number | null;
  range_lower: number | null; range_upper: number | null; conditions: StoredCondition[]; zones: StoredZone[];
  weekly_context_version_id: string | null; rules: unknown; evidence: string[];
}

export interface Checks { blocking: number; warnings: number; findings: Finding[] }

export interface Version {
  id: string; instrument: string; kind: Kind; period_key: string; week_key: string; version: number;
  status: "draft" | "published" | "discarded"; version_type: "original" | "correction" | "update";
  title: string; body_md: string;
  sections: { text: Record<string, string>; outlook: OutlookIn | null; headings: Record<string, string>; revision_notes: string[]; edited_manually?: boolean };
  facts: Bundle; checks: Checks; data_cutoff: string; created_at: string; published_at: string | null; change_note: string | null;
  supersedes_id: string | null; content_hash: string | null; writer: string; model: string | null; data_mode: "live" | "fixture";
  partial: boolean; missing: string[];
  outlook: Outlook | null;        // set at publication for analyses
  evaluation: EvaluationRecord | null; // set at publication for reviews
  research: { model: string | null; searches: number; sources: string[] } | null;
}

export interface EvaluationRecord {
  outlook_version_id: string; period_key: string; kind: "daily" | "weekly"; direction: string; qualification: string | null; version: number;
  directional: string; detail: Record<string, unknown>; conditional: unknown[]; session_ohlc: unknown; evaluated_at: string;
}

export interface VersionSummary {
  id: string; report_id: string; kind: Kind; period_key: string; week_key: string; version: number; version_type: string; status: Version["status"];
  title: string; writer: string; data_mode: string; partial: boolean; created_display: string; published_display: string | null;
  data_cutoff_display: string; blocking: number; warnings: number; change_note: string | null; direction: string | null;
  created_at: string; published_at: string | null; data_cutoff: string;
}

export interface OutlookChange { at: string; at_display: string; week_key: string; previous_version_id: string | null; new_version_id: string; from: string | null; to: string; evidence: string }
export interface JobRun { job: Kind; slot: string; instrument: string; status: string; attempts: number; error: string | null; started_at: string; started_display: string; finished_at: string | null; version_id: string | null; detail?: string }

/** Per-instrument index: everything the dashboard lists, in one small document. */
export interface Index {
  instrument: string; versions: VersionSummary[]; changes: OutlookChange[]; evaluations: EvaluationRecord[];
  jobs: JobRun[]; warnings: { code: string; severity: string; message: string; at: string }[]; updated_at: string | null;
}

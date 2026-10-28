// Settings you change from the dashboard: publication mode, writer, display timezone and terminology edits.
import { CONFIG } from "./config.ts";
import { isTimeZone, setDisplayZone } from "./dates.ts";
import { getJSON, update } from "./store.ts";

export interface TermEdit { kind: "approved" | "prohibited" | "abbreviation"; term: string; definition?: string | null; alternatives?: string[];
  prohibited_alternatives?: string[]; suggest?: string | null; enabled: boolean; at: number }
export interface Settings {
  publication_mode: "manual" | "automatic";
  writer: "template" | "claude"; // "claude" takes effect only when ANTHROPIC_API_KEY is set
  display_timezone: string;
  terms: TermEdit[];
}

const defaults = (): Settings => ({ publication_mode: CONFIG.reports.publicationMode, writer: CONFIG.writer, display_timezone: CONFIG.display.timezone, terms: [] });

const apply = (s: Settings) => {
  if (!isTimeZone(s.display_timezone)) s.display_timezone = CONFIG.display.timezone;
  setDisplayZone(s.display_timezone);
  return s;
};

export async function getSettings(): Promise<Settings> {
  return apply({ ...defaults(), ...((await getJSON<Partial<Settings>>("settings.json")) ?? {}) });
}

export async function changeSettings(fn: (s: Settings) => void): Promise<Settings> {
  return apply(await update<Settings>("settings.json", defaults, (s) => { const full = { ...defaults(), ...s }; fn(full); return full; }));
}

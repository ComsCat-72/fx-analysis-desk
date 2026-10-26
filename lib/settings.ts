// Settings you change from the dashboard: publication mode and terminology edits.
import { CONFIG } from "./config.ts";
import { getJSON, update } from "./store.ts";

export interface TermEdit { kind: "approved" | "prohibited" | "abbreviation"; term: string; definition?: string | null; alternatives?: string[];
  prohibited_alternatives?: string[]; suggest?: string | null; enabled: boolean; at: number }
export interface Settings { publication_mode: "manual" | "automatic"; terms: TermEdit[] }

const defaults = (): Settings => ({ publication_mode: CONFIG.reports.publicationMode, terms: [] });

export async function getSettings(): Promise<Settings> {
  return { ...defaults(), ...((await getJSON<Partial<Settings>>("settings.json")) ?? {}) };
}

export async function changeSettings(fn: (s: Settings) => void): Promise<Settings> {
  return update<Settings>("settings.json", defaults, (s) => { const full = { ...defaults(), ...s }; fn(full); return full; });
}

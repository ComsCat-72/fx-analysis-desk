// Settings you change from the dashboard: the default display timezone (used when a browser sends none).
import { CONFIG } from "./config.ts";
import { isTimeZone, setDisplayZone } from "./dates.ts";
import { getJSON, update } from "./store.ts";

export interface Settings { display_timezone: string }

const defaults = (): Settings => ({ display_timezone: CONFIG.display.timezone });
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

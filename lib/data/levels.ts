// Technical levels you add (dashboard or confirmed screenshot readings). Calculated reference levels
// (previous session/week high and low) are not stored: each report computes them and its outlook keeps a copy.
import { getJSON, update } from "../store.ts";
import type { LevelStatus } from "../core/breaks.ts";

export interface StoredLevel {
  id: string; instrument: string; lower: number; upper: number; timeframe: string; role: "support" | "resistance";
  origin: "user" | "screenshot"; reason: string; status: LevelStatus; approximate: boolean; sourceRef: string | null;
  createdAt: number; updatedAt: number; history: { from: string; to: string; at: number; reason: string }[];
}

const path = (inst: string) => `levels/${inst}.json`;
export const levelsFor = async (inst: string) => (await getJSON<{ levels: StoredLevel[] }>(path(inst)))?.levels ?? [];

export async function addLevels(inst: string, rows: Omit<StoredLevel, "id" | "status" | "updatedAt" | "history" | "instrument">[]): Promise<string[]> {
  const ids: string[] = [];
  await update<{ levels: StoredLevel[] }>(path(inst), () => ({ levels: [] }), (doc) => {
    for (const r of rows) {
      const id = `${inst}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      ids.push(id);
      doc.levels.unshift({ ...r, id, instrument: inst, status: "active", updatedAt: r.createdAt, history: [] });
    }
  });
  return ids;
}

export async function setLevelStatus(inst: string, id: string, status: LevelStatus, reason: string, now = Date.now()) {
  let found: StoredLevel | null = null;
  await update<{ levels: StoredLevel[] }>(path(inst), () => ({ levels: [] }), (doc) => {
    const l = doc.levels.find((x) => x.id === id);
    if (!l) return;
    l.history.push({ from: l.status, to: status, at: now, reason });
    l.status = status; l.updatedAt = now;
    found = l;
  });
  if (!found) throw new Error("no such level");
  return found as StoredLevel;
}

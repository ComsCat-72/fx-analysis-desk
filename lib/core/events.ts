// Economic-event values, surprises, revisions, source reconciliation and scenario tables.

export type EventState = "scheduled" | "released" | "delayed" | "revised" | "conflicting" | "unavailable";

export interface Value { raw: string; num: number; unit: string; decimals: number }

export function parseValue(raw: string | null | undefined): Value | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace("−", "-");
  const m = s.match(/^[€$£¥]?\s*([-+]?\d+(?:[.,]\d+)?)\s*(%|[KMBT]|bps?)?$/i);
  if (!m) return null;
  const n = m[1].replace(",", ".");
  return { raw: s, num: Number(n), unit: (m[2] ?? "").toUpperCase().replace(/^BPS?$/, "bp"), decimals: n.includes(".") ? n.split(".")[1].length : 0 };
}

export type Surprise = "in line with consensus" | "above consensus" | "below consensus" | "no verified consensus" | "not comparable";

/** Compared at the precision the figures were published to. Equal = in line (never a surprise). */
export function classifySurprise(actual: string | null | undefined, consensus: string | null | undefined): Surprise {
  const a = parseValue(actual), c = parseValue(consensus);
  if (!c) return "no verified consensus";
  if (!a || a.unit !== c.unit) return "not comparable";
  const d = Math.max(a.decimals, c.decimals);
  const av = Number(a.num.toFixed(d)), cv = Number(c.num.toFixed(d));
  if (av === cv) return "in line with consensus";
  return av > cv ? "above consensus" : "below consensus";
}

export function revisionDirection(previous?: string | null, revised?: string | null): "revised up" | "revised down" | null {
  const p = parseValue(previous), r = parseValue(revised);
  if (!p || !r || p.unit !== r.unit || p.num === r.num) return null;
  return r.num > p.num ? "revised up" : "revised down";
}

/** source -> actual. Agreeing sources: released; disagreeing: conflicting with no value. Never averaged. */
export function reconcileActuals(values: Record<string, string>): { state: EventState; actual: string | null } {
  const clean = Object.entries(values).filter(([, v]) => v);
  if (!clean.length) return { state: "unavailable", actual: null };
  const distinct = new Set(clean.map(([, v]) => { const p = parseValue(v); return p ? `${p.num}|${p.unit}` : v; }));
  if (distinct.size > 1) return { state: "conflicting", actual: null };
  return { state: "released", actual: clean[0][1] };
}

export interface ScenarioRow { outcome: string; implication: string; weight?: number }

export function validateScenarios(rows: ScenarioRow[], method?: string): void {
  const w = rows.map((r) => r.weight);
  if (w.every((x) => x == null)) return;
  if (w.some((x) => x == null)) throw new Error("either all scenario weights are estimated or none are");
  if (!method) throw new Error("numeric scenario weights require a stored method");
  const sum = (w as number[]).reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 100) > 1e-6) throw new Error(`scenario weights sum to ${sum}, not 100`);
  if (new Set(rows.map((r) => r.outcome)).size !== rows.length) throw new Error("scenario outcomes must be distinct");
}

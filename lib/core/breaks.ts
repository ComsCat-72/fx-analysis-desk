// Break / rejection / sustained-break rules — the same functions are used when writing and reviewing.
//   Reached:   some bar traded beyond the boundary (wick).
//   Sustained: `sustainedCloses` consecutive closes beyond the boundary.
//   Rejection: a bar traded beyond the boundary but closed back on the original side.
//   Reversed:  after a sustained break, `reversalCloses` consecutive closes back on the original side.
import type { Bar } from "./technical.ts";

export type Side = "above" | "below";
export interface BreakRules { basis: "close" | "wick"; sustainedCloses: number; reversalCloses: number }

export const ConditionOutcome = {
  NOT_REACHED: "Condition not reached",
  BRIEFLY_REACHED: "Briefly reached, not sustained",
  CONFIRMED: "Confirmed",
  CONFIRMED_THEN_REVERSED: "Confirmed, then reversed",
  UNRESOLVED: "Unresolved by session end",
  NOT_ASSESSABLE: "Not assessable",
} as const;
export type ConditionOutcomeT = (typeof ConditionOutcome)[keyof typeof ConditionOutcome];

export interface BreakResult {
  outcome: ConditionOutcomeT;
  firstReachedAt: number | null;
  confirmedAt: number | null;
  reversedAt: number | null;
  rejections: number;
}

const beyond = (p: number, boundary: number, side: Side) => (side === "above" ? p > boundary : p < boundary);

export function evaluateBreak(bars: Bar[], boundary: number, side: Side, rules: BreakRules): BreakResult {
  const b = [...bars].sort((x, y) => x.start - y.start);
  const res: BreakResult = { outcome: ConditionOutcome.NOT_REACHED, firstReachedAt: null, confirmedAt: null, reversedAt: null, rejections: 0 };
  if (!b.length || b.some((x) => !x.complete)) return { ...res, outcome: ConditionOutcome.NOT_ASSESSABLE };
  let streak = 0, back = 0;
  for (const c of b) {
    const reached = beyond(side === "above" ? c.high : c.low, boundary, side);
    const closedBeyond = beyond(c.close, boundary, side);
    if (reached && res.firstReachedAt === null) res.firstReachedAt = c.start;
    if (reached && !closedBeyond) res.rejections++;
    if (res.confirmedAt === null) {
      streak = closedBeyond ? streak + 1 : 0;
      if (streak >= rules.sustainedCloses) res.confirmedAt = c.end;
    } else if (res.reversedAt === null) {
      back = closedBeyond ? 0 : back + 1;
      if (back >= rules.reversalCloses) res.reversedAt = c.end;
    }
  }
  if (res.reversedAt) res.outcome = ConditionOutcome.CONFIRMED_THEN_REVERSED;
  else if (res.confirmedAt) res.outcome = ConditionOutcome.CONFIRMED;
  else if (res.firstReachedAt === null) res.outcome = ConditionOutcome.NOT_REACHED;
  else if (streak > 0) res.outcome = ConditionOutcome.UNRESOLVED; // still closing beyond when the horizon ended
  else res.outcome = ConditionOutcome.BRIEFLY_REACHED;
  return res;
}

export type LevelStatus = "active" | "tested" | "broken" | "reclaimed" | "invalidated" | "archived";

/** Walk bars in order; support breaks below `lower`, resistance above `upper`; reclaim = sustained close back. */
export function levelStatus(status: LevelStatus, lower: number, upper: number, role: "support" | "resistance",
                            bars: Bar[], rules: BreakRules): { status: LevelStatus; reasons: string[] } {
  if (status === "invalidated" || status === "archived") return { status, reasons: [] };
  const reasons: string[] = [];
  const breakSide: Side = role === "support" ? "below" : "above";
  const boundary = role === "support" ? lower : upper;
  const reclaimSide: Side = breakSide === "below" ? "above" : "below";
  let streak = 0;
  for (const c of [...bars].filter((x) => x.complete).sort((x, y) => x.start - y.start)) {
    if (status === "active" && c.low <= upper && c.high >= lower) {
      status = "tested";
      reasons.push(`tested ${new Date(c.start).toISOString()}`);
    }
    if (status === "active" || status === "tested" || status === "reclaimed") {
      streak = beyond(c.close, boundary, breakSide) ? streak + 1 : 0;
      if (streak >= rules.sustainedCloses) { status = "broken"; streak = 0; reasons.push(`sustained break ${breakSide} ${boundary}`); }
    } else if (status === "broken") {
      streak = beyond(c.close, boundary, reclaimSide) || c.close === boundary ? streak + 1 : 0;
      if (streak >= rules.sustainedCloses) { status = "reclaimed"; streak = 0; reasons.push("reclaimed"); }
    }
  }
  return { status, reasons };
}

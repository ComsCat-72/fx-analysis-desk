// Directional assessment of a published outlook. No trades, no P&L, no win rates.
//   thr   = inconclusiveAtrFraction * ATR (ATR known at publication)
//   mixed = mixedExcursionAtrFraction * ATR
//   net   = session close - reference price (price at the report's data cutoff)
// Upward lean: net >= thr Supported; net <= -thr Not supported; else Inconclusive; either becomes Mixed
// when the session also moved >= mixed the other way. Downward mirrors. Neutral / range-bound: inside a
// published range with |net| < thr Supported; close outside the range Not supported; otherwise Mixed.
import type { Bar } from "./technical.ts";

export type Direction = "upward_lean" | "downward_lean" | "neutral" | "range_bound";
export const DIRECTION_LABEL: Record<Direction, string> = {
  upward_lean: "Upward lean", downward_lean: "Downward lean", neutral: "Neutral", range_bound: "Range-bound",
};
export type DirectionalOutcome = "Supported" | "Not supported" | "Mixed" | "Inconclusive" | "Not assessable";
export const CORRECT_INCORRECT: Record<DirectionalOutcome, string> = {
  Supported: "Correct", "Not supported": "Incorrect", Mixed: "Partly correct", Inconclusive: "Inconclusive", "Not assessable": "Not assessable",
};

export interface DirectionalResult { outcome: DirectionalOutcome; net: number | null; threshold: number | null; explanation: string }
export interface EvalConfig { inconclusiveAtrFraction: number; mixedExcursionAtrFraction: number }

export function assessDirection(direction: Direction, reference: number | null, session: Bar | null, atr: number | null,
                                cfg: EvalConfig, range?: [number, number] | null): DirectionalResult {
  if (reference == null || !atr || atr <= 0 || !session || !session.complete) {
    const why = reference == null ? "no reference price" : !atr ? "no ATR available at publication" : "no complete session bar";
    return { outcome: "Not assessable", net: null, threshold: null, explanation: why };
  }
  const thr = cfg.inconclusiveAtrFraction * atr, mixed = cfg.mixedExcursionAtrFraction * atr;
  const net = session.close - reference;
  const up = session.high - reference, down = reference - session.low;
  const r = (outcome: DirectionalOutcome, explanation: string): DirectionalResult => ({ outcome, net, threshold: thr, explanation });
  if (direction === "upward_lean" || direction === "downward_lean") {
    const sign = direction === "upward_lean" ? 1 : -1;
    const signed = sign * net;
    const fav = sign === 1 ? up : down, adv = sign === 1 ? down : up;
    if (signed >= thr) return adv >= mixed ? r("Mixed", "closed in the expected direction after a large opposite move")
      : r("Supported", "closed in the expected direction by more than the threshold");
    if (signed <= -thr) return fav >= mixed ? r("Mixed", "moved in the expected direction first but closed against it")
      : r("Not supported", "closed against the expected direction by more than the threshold");
    return r("Inconclusive", "net move smaller than the threshold");
  }
  if (range) {
    const [lo, hi] = range;
    if (session.close > hi || session.close < lo) return r("Not supported", "session closed outside the published range");
    return Math.abs(net) < thr ? r("Supported", "closed inside the range with a small net move")
      : r("Mixed", "closed inside the range but with a directional net move");
  }
  if (Math.abs(net) < thr) return r("Supported", "net move smaller than the threshold");
  if (Math.abs(net) >= 2 * thr) return r("Not supported", "clear directional net move");
  return r("Mixed", "moderate directional net move");
}

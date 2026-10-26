// Reproducible technical calculations on bars exactly as the data source publishes them.
// Every function takes an explicit `asOf` and ignores later or still-forming bars (no future leakage).
//
// Swing rule (fractal): bar i is a swing high if high[i] > max(high[i-L..i-1]) and
// high[i] >= max(high[i+1..i+R]); swing lows mirror this. A swing is CONFIRMED only at the end of
// bar i+R and does not exist for any analysis whose cutoff is earlier.

export interface Bar {
  start: number; // epoch ms, inclusive
  end: number;   // epoch ms, exclusive
  open: number;
  high: number;
  low: number;
  close: number;
  complete: boolean;
}

export const closedBefore = (bars: Bar[], asOf: number) =>
  [...bars].sort((a, b) => a.start - b.start).filter((b) => b.complete && b.end <= asOf);

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  return values.slice(-period).reduce((s, v) => s + v, 0) / period;
}

/** EMA seeded with the SMA of the first `period` values; alpha = 2/(period+1). */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let e = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (const v of values.slice(period)) e = alpha * v + (1 - alpha) * e;
  return e;
}

export function trueRanges(bars: Bar[]): number[] {
  return bars.map((c, i) => (i === 0 ? c.high - c.low
    : Math.max(c.high - c.low, Math.abs(c.high - bars[i - 1].close), Math.abs(c.low - bars[i - 1].close))));
}

/** Wilder ATR: mean of the first `period` true ranges, then (prev*(n-1)+TR)/n. */
export function atr(bars: Bar[], period = 14): number | null {
  const tr = trueRanges(bars);
  if (tr.length < period) return null;
  let a = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (const x of tr.slice(period)) a = (a * (period - 1) + x) / period;
  return a;
}

/** Wilder RSI. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const g: number[] = [], l: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g.push(Math.max(d, 0)); l.push(Math.max(-d, 0));
  }
  let ag = g.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let al = l.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < g.length; i++) {
    ag = (ag * (period - 1) + g[i]) / period;
    al = (al * (period - 1) + l[i]) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export interface Swing { kind: "high" | "low"; price: number; barStart: number; confirmedAt: number; label?: "HH" | "LH" | "HL" | "LL" }

export function findSwings(bars: Bar[], asOf: number, left = 3, right = 3): Swing[] {
  const b = closedBefore(bars, asOf);
  const out: Swing[] = [];
  for (let i = left; i < b.length - right; i++) {
    const lh = Math.max(...b.slice(i - left, i).map((x) => x.high));
    const rh = Math.max(...b.slice(i + 1, i + 1 + right).map((x) => x.high));
    const ll = Math.min(...b.slice(i - left, i).map((x) => x.low));
    const rl = Math.min(...b.slice(i + 1, i + 1 + right).map((x) => x.low));
    const conf = b[i + right].end;
    if (b[i].high > lh && b[i].high >= rh) out.push({ kind: "high", price: b[i].high, barStart: b[i].start, confirmedAt: conf });
    if (b[i].low < ll && b[i].low <= rl) out.push({ kind: "low", price: b[i].low, barStart: b[i].start, confirmedAt: conf });
  }
  // Label against the previous confirmed swing of the same kind.
  const last: Partial<Record<Swing["kind"], Swing>> = {};
  return out.sort((x, y) => x.confirmedAt - y.confirmedAt || x.barStart - y.barStart).map((s) => {
    const prev = last[s.kind];
    const label = prev ? (s.kind === "high" ? (s.price > prev.price ? "HH" : "LH") : (s.price > prev.price ? "HL" : "LL")) : undefined;
    const ns = { ...s, label } as Swing;
    last[s.kind] = ns;
    return ns;
  });
}

/** upward = latest high HH and latest low HL; downward = LH and LL; otherwise mixed. */
export function structure(swings: Swing[]): "upward" | "downward" | "mixed" | "insufficient" {
  const highs = swings.filter((s) => s.kind === "high"), lows = swings.filter((s) => s.kind === "low");
  if (highs.length < 2 || lows.length < 2) return "insufficient";
  const h = highs[highs.length - 1].label, l = lows[lows.length - 1].label;
  if (h === "HH" && l === "HL") return "upward";
  if (h === "LH" && l === "LL") return "downward";
  return "mixed";
}

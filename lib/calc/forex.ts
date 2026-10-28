// General forex arithmetic for the Calculators page. Pure functions, no data access.
// These tools are separate from the analysis reports: nothing under lib/reports imports this module.
import { addDays, zoned } from "../dates.ts";

export const PAIRS = ["EUR/USD", "GBP/USD", "AUD/USD", "NZD/USD", "USD/JPY", "USD/CHF", "USD/CAD", "EUR/GBP", "EUR/JPY", "GBP/JPY", "AUD/JPY",
  "EUR/CHF", "EUR/AUD", "EUR/CAD", "GBP/CHF", "GBP/AUD", "AUD/NZD", "CAD/JPY", "CHF/JPY", "NZD/JPY", "XAU/USD"] as const;
export const ACCOUNT_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"] as const;
export const LOT = { standard: 100_000, mini: 10_000, micro: 1_000 } as const;
export const GOLD_LOT = 100; // troy ounces per standard lot

export const split = (pair: string) => { const [base, quote] = pair.split("/"); return { base, quote }; };
/** 0.01 for JPY-quoted pairs and gold, 0.0001 otherwise. */
export const pipSize = (pair: string) => (split(pair).quote === "JPY" || split(pair).base === "XAU" ? 0.01 : 0.0001);
/** Units in one standard lot. */
export const lotUnits = (pair: string) => (split(pair).base === "XAU" ? GOLD_LOT : LOT.standard);

const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

/** Value of a pip in the account currency. `quoteToAccount`: units of account currency per unit of the quote currency. */
export function pipValue(o: { pair: string; units: number; pips?: number; quoteToAccount: number }) {
  if (!finite(o.units, o.quoteToAccount) || o.units < 0 || o.quoteToAccount <= 0) return null;
  const perPip = pipSize(o.pair) * o.units * o.quoteToAccount;
  return { perPip, total: perPip * (o.pips ?? 1) };
}

/** Position size from the amount at risk and the stop distance in pips. */
export function positionSize(o: { pair: string; balance: number; riskPercent?: number; riskAmount?: number; stopPips: number; quoteToAccount: number }) {
  const risk = o.riskAmount ?? (o.balance * (o.riskPercent ?? 0)) / 100;
  if (!finite(risk, o.stopPips, o.quoteToAccount) || risk <= 0 || o.stopPips <= 0 || o.quoteToAccount <= 0) return null;
  const units = risk / (o.stopPips * pipSize(o.pair) * o.quoteToAccount);
  const lot = lotUnits(o.pair);
  return { risk, units, lots: units / lot, miniLots: units / (lot / 10), microLots: units / (lot / 100) };
}

/** Margin required in the account currency. `baseToAccount`: account currency per unit of the base currency. */
export function margin(o: { units: number; leverage: number; baseToAccount: number }) {
  if (!finite(o.units, o.leverage, o.baseToAccount) || o.units < 0 || o.leverage <= 0 || o.baseToAccount <= 0) return null;
  const notional = o.units * o.baseToAccount;
  return { notional, margin: notional / o.leverage };
}

/** Result of a closed position, in pips and in the account currency (converted at `quoteToAccount`). */
export function profit(o: { pair: string; direction: "buy" | "sell"; open: number; close: number; units: number; quoteToAccount: number }) {
  if (!finite(o.open, o.close, o.units, o.quoteToAccount) || o.units < 0 || o.quoteToAccount <= 0) return null;
  const sign = o.direction === "buy" ? 1 : -1;
  const move = (o.close - o.open) * sign;
  return { pips: move / pipSize(o.pair), quote: move * o.units, account: move * o.units * o.quoteToAccount };
}

/** Distances from entry to stop and to target, and their ratio. The direction follows the target. */
export function riskReward(o: { pair: string; entry: number; stop: number; target: number }) {
  if (!finite(o.entry, o.stop, o.target) || o.entry === o.stop || o.entry === o.target) return null;
  const long = o.target > o.entry;
  if (long ? o.stop >= o.entry : o.stop <= o.entry) return { error: "The stop must be on the opposite side of the entry from the target." } as const;
  const risk = Math.abs(o.entry - o.stop) / pipSize(o.pair), reward = Math.abs(o.target - o.entry) / pipSize(o.pair);
  return { direction: long ? "long" : "short", riskPips: risk, rewardPips: reward, ratio: reward / risk } as const;
}

export type PivotSet = { method: string; levels: Record<string, number> };

/** Classic, Woodie, Camarilla, Fibonacci and DeMark pivot points from the previous period's high, low, close (and open). */
export function pivots(o: { high: number; low: number; close: number; open?: number }): PivotSet[] | null {
  const { high: H, low: L, close: C } = o;
  if (!finite(H, L, C) || H < L || C > H || C < L) return null;
  const R = H - L, P = (H + L + C) / 3;
  const W = (H + L + 2 * C) / 4;
  const out: PivotSet[] = [
    { method: "Classic", levels: { R3: H + 2 * (P - L), R2: P + R, R1: 2 * P - L, PP: P, S1: 2 * P - H, S2: P - R, S3: L - 2 * (H - P) } },
    { method: "Woodie", levels: { R3: H + 2 * (W - L), R2: W + R, R1: 2 * W - L, PP: W, S1: 2 * W - H, S2: W - R, S3: L - 2 * (H - W) } },
    { method: "Camarilla", levels: { R4: C + (R * 1.1) / 2, R3: C + (R * 1.1) / 4, R2: C + (R * 1.1) / 6, R1: C + (R * 1.1) / 12, PP: P,
      S1: C - (R * 1.1) / 12, S2: C - (R * 1.1) / 6, S3: C - (R * 1.1) / 4, S4: C - (R * 1.1) / 2 } },
    { method: "Fibonacci", levels: { R3: P + R, R2: P + 0.618 * R, R1: P + 0.382 * R, PP: P, S1: P - 0.382 * R, S2: P - 0.618 * R, S3: P - R } },
  ];
  if (o.open != null && Number.isFinite(o.open)) {
    const X = C < o.open ? H + 2 * L + C : C > o.open ? 2 * H + L + C : H + L + 2 * C;
    out.push({ method: "DeMark", levels: { R1: X / 2 - L, PP: X / 4, S1: X / 2 - H } });
  }
  return out;
}

export const RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786];
export const EXTENSIONS = [1.382, 1.5, 1.618, 2.618];

/** Retracements of the move between low and high, and extensions measured from the start of the move.
 *  Upward: the move ran from the low to the high; downward: from the high to the low. */
export function fibonacci(o: { high: number; low: number; trend: "up" | "down" }) {
  if (!finite(o.high, o.low) || o.high <= o.low) return null;
  const R = o.high - o.low, up = o.trend === "up";
  return {
    retracements: RETRACEMENTS.map((r) => ({ ratio: r, price: up ? o.high - R * r : o.low + R * r })),
    extensions: EXTENSIONS.map((e) => ({ ratio: e, price: up ? o.low + R * e : o.high - R * e })),
  };
}

/** Balance grown at a fixed percentage per period, with an optional deposit added at the end of each period. */
export function compounding(o: { start: number; ratePercent: number; periods: number; deposit?: number }) {
  if (!finite(o.start, o.ratePercent, o.periods) || o.start < 0 || o.periods < 1 || o.periods > 1200) return null;
  const rows: { period: number; start: number; gain: number; deposit: number; end: number }[] = [];
  let bal = o.start;
  for (let i = 1; i <= Math.floor(o.periods); i++) {
    const gain = bal * (o.ratePercent / 100), dep = o.deposit ?? 0;
    rows.push({ period: i, start: bal, gain, deposit: dep, end: bal + gain + dep });
    bal += gain + dep;
  }
  const deposits = (o.deposit ?? 0) * rows.length;
  return { end: bal, totalGain: bal - o.start - deposits, deposits, rows };
}

/** Balance after consecutive losses of a fixed percentage, the drawdown, and the gain needed to recover. */
export function drawdown(o: { start: number; lossPercent: number; losses: number }) {
  if (!finite(o.start, o.lossPercent, o.losses) || o.start <= 0 || o.lossPercent <= 0 || o.lossPercent >= 100 || o.losses < 1 || o.losses > 500) return null;
  const rows: { trade: number; balance: number; drawdownPercent: number; recoveryPercent: number }[] = [];
  let bal = o.start;
  for (let i = 1; i <= Math.floor(o.losses); i++) {
    bal *= 1 - o.lossPercent / 100;
    rows.push({ trade: i, balance: bal, drawdownPercent: (1 - bal / o.start) * 100, recoveryPercent: (o.start / bal - 1) * 100 });
  }
  return { end: bal, rows };
}

/** Gain needed to return to the starting balance after a loss of `lossPercent`. */
export const recoveryNeeded = (lossPercent: number) => (lossPercent >= 100 ? Infinity : (1 / (1 - lossPercent / 100) - 1) * 100);

// ---------------------------------------------------------------- market hours

export const SESSIONS = [
  { name: "Sydney", tz: "Australia/Sydney", open: "07:00", close: "16:00" },
  { name: "Tokyo", tz: "Asia/Tokyo", open: "09:00", close: "18:00" },
  { name: "London", tz: "Europe/London", open: "08:00", close: "17:00" },
  { name: "New York", tz: "America/New_York", open: "08:00", close: "17:00" },
] as const;

/** Spot FX trades from Sunday 17:00 to Friday 17:00 New York time. */
export function fxMarketOpen(t: number): boolean {
  const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  const wd = ny.find((x) => x.type === "weekday")!.value, h = Number(ny.find((x) => x.type === "hour")!.value);
  if (wd === "Sat") return false;
  if (wd === "Sun") return h >= 17;
  if (wd === "Fri") return h < 17;
  return true;
}

/** Each session's opening and closing instants for the local dates around `t`, plus which are open at `t`.
 *  Local business hours in each centre; daylight saving follows each centre's own rules. */
export function sessionsAt(t: number) {
  const day = (tz: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const marketOpen = fxMarketOpen(t);
  return SESSIONS.map((s) => {
    const today = day(s.tz);
    const windows = [-1, 0, 1, 2, 3].map((k) => { const d = addDays(today, k); return { start: zoned(d, s.open, s.tz), end: zoned(d, s.close, s.tz) }; });
    const isWeekday = (x: number) => { const w = new Intl.DateTimeFormat("en-US", { timeZone: s.tz, weekday: "short" }).format(new Date(x)); return w !== "Sat" && w !== "Sun"; };
    const valid = windows.filter((w) => isWeekday(w.start));
    const current = valid.find((w) => t >= w.start && t < w.end) ?? null;
    const upcoming = valid.find((w) => w.start > t) ?? null;
    return { ...s, open_now: marketOpen && !!current, current, next: upcoming, windows: valid };
  });
}

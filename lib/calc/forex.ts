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

/** An amount in the pair's quote currency, in the account currency (BabyPips' convention):
 *  account = quote → unchanged; account = base → divided by the pair's price; otherwise × the quote→account cross rate. */
export function toAccount(amountInQuote: number, pair: string, price: number, account: string, crossRate?: number | null): number | null {
  const { base, quote } = split(pair);
  if (account === quote) return amountInQuote;
  if (account === base) return finite(price) && price > 0 ? amountInQuote / price : null;
  return crossRate != null && finite(crossRate) && crossRate > 0 ? amountInQuote * crossRate : null;
}
/** Whether converting into `account` needs a cross rate (the account currency is neither side of the pair). */
export const needsCross = (pair: string, account: string) => account !== split(pair).base && account !== split(pair).quote;

/** Value of one pip (and of `pips` pips) in the account currency, plus per standard, mini and micro lot. */
export function pipValue(o: { pair: string; units: number; pips?: number; price: number; account: string; crossRate?: number | null }) {
  if (!finite(o.units) || o.units < 0) return null;
  const per = (units: number) => toAccount(units * pipSize(o.pair), o.pair, o.price, o.account, o.crossRate);
  const perPip = per(o.units);
  if (perPip == null) return null;
  const lot = lotUnits(o.pair);
  return { perPip, total: perPip * (o.pips ?? 1), standard: per(lot)!, mini: per(lot / 10)!, micro: per(lot / 100)! };
}

/** Stop distance in pips from two prices. */
export const pipsBetween = (pair: string, a: number, b: number) => Math.abs(a - b) / pipSize(pair);

/** Position size (BabyPips): units = amount at risk ÷ (stop pips × pip value per unit in the account currency). */
export function positionSize(o: { pair: string; balance: number; riskPercent?: number; riskAmount?: number; stopPips: number; price: number; account: string; crossRate?: number | null }) {
  const risk = o.riskAmount ?? (o.balance * (o.riskPercent ?? 0)) / 100;
  if (!finite(risk, o.stopPips) || risk <= 0 || o.stopPips <= 0) return null;
  const perUnit = toAccount(pipSize(o.pair), o.pair, o.price, o.account, o.crossRate);
  if (perUnit == null || perUnit <= 0) return null;
  const units = risk / (o.stopPips * perUnit);
  const lot = lotUnits(o.pair);
  return { risk, units, lots: units / lot, miniLots: units / (lot / 10), microLots: units / (lot / 100), pipValuePerLot: perUnit * lot };
}

/** Required margin (BabyPips): position value in the account currency ÷ leverage.
 *  Position value = units of the base currency: account = base → units; account = quote → units × price; else via the cross rate. */
export function margin(o: { pair: string; units: number; leverage: number; price: number; account: string; crossRate?: number | null }) {
  if (!finite(o.units, o.leverage) || o.units < 0 || o.leverage <= 0) return null;
  const notional = toAccount(o.units * o.price, o.pair, o.price, o.account, o.crossRate);
  if (notional == null) return null;
  return { notional, margin: notional / o.leverage, requirementPercent: 100 / o.leverage };
}

/** Result of a closed position: pips, the amount in the quote currency, and in the account currency converted at the close price. */
export function profit(o: { pair: string; direction: "buy" | "sell"; open: number; close: number; units: number; account: string; crossRate?: number | null }) {
  if (!finite(o.open, o.close, o.units) || o.units < 0 || o.open <= 0 || o.close <= 0) return null;
  const move = (o.close - o.open) * (o.direction === "buy" ? 1 : -1);
  const quote = move * o.units;
  return { pips: move / pipSize(o.pair), quote, account: toAccount(quote, o.pair, o.close, o.account, o.crossRate) };
}

/** Percentage gained or lost between two balances, and the gain needed to recover a loss (BabyPips Gain & Loss %).
 *  Give the start and one of: end, amount (signed), percent (signed). */
export function gainLoss(o: { start: number; end?: number; amount?: number; percent?: number }) {
  if (!finite(o.start) || o.start <= 0) return null;
  const end = o.end != null ? o.end : o.amount != null ? o.start + o.amount : o.percent != null ? o.start * (1 + o.percent / 100) : NaN;
  if (!finite(end) || end < 0) return null;
  const amount = end - o.start, percent = (amount / o.start) * 100;
  return { end, amount, percent, recoveryPercent: percent < 0 ? recoveryNeeded(-percent) : 0 };
}

/** BabyPips: the ratio of the entry→stop distance to the entry→target distance; break-even win rate = 1 ÷ (1 + reward/risk). */
export function riskReward(o: { pair: string; riskPips: number; rewardPips: number; units?: number; price?: number; account?: string; crossRate?: number | null }) {
  if (!finite(o.riskPips, o.rewardPips) || o.riskPips <= 0 || o.rewardPips <= 0) return null;
  const ratio = o.rewardPips / o.riskPips;
  let money: { risk: number; reward: number } | null = null;
  if (o.units && o.price && o.account) {
    const perPip = toAccount(o.units * pipSize(o.pair), o.pair, o.price, o.account, o.crossRate);
    if (perPip != null) money = { risk: perPip * o.riskPips, reward: perPip * o.rewardPips };
  }
  return { riskPips: o.riskPips, rewardPips: o.rewardPips, ratio, breakEvenWinRate: 100 / (1 + ratio), money };
}

/** Pip distances from entry, stop and target prices; the direction follows the target. */
export function riskRewardFromPrices(pair: string, entry: number, stop: number, target: number) {
  if (!finite(entry, stop, target) || entry === stop || entry === target) return null;
  const long = target > entry;
  if (long ? stop >= entry : stop <= entry) return { error: "The stop must be on the opposite side of the entry from the target." } as const;
  return { direction: long ? "long" : "short", riskPips: pipsBetween(pair, entry, stop), rewardPips: pipsBetween(pair, entry, target) } as const;
}

export type PivotSet = { method: string; levels: Record<string, number> };

/** Floor, Woodie, Camarilla, DeMark and Fibonacci pivot points from the previous period's high, low, close (and open, for DeMark). */
export function pivots(o: { high: number; low: number; close: number; open?: number }): PivotSet[] | null {
  const { high: H, low: L, close: C } = o;
  if (!finite(H, L, C) || H < L || C > H || C < L) return null;
  const R = H - L, P = (H + L + C) / 3;
  const W = (H + L + 2 * C) / 4;
  const out: PivotSet[] = [
    { method: "Floor", levels: { R3: H + 2 * (P - L), R2: P + R, R1: 2 * P - L, PP: P, S1: 2 * P - H, S2: P - R, S3: L - 2 * (H - P) } },
    { method: "Woodie", levels: { R2: W + R, R1: 2 * W - L, PP: W, S1: 2 * W - H, S2: W - R } },
    { method: "Camarilla", levels: { R4: C + (R * 1.1) / 2, R3: C + (R * 1.1) / 4, R2: C + (R * 1.1) / 6, R1: C + (R * 1.1) / 12, PP: P,
      S1: C - (R * 1.1) / 12, S2: C - (R * 1.1) / 6, S3: C - (R * 1.1) / 4, S4: C - (R * 1.1) / 2 } },
  ];
  if (o.open != null && Number.isFinite(o.open)) {
    const X = C < o.open ? H + 2 * L + C : C > o.open ? 2 * H + L + C : H + L + 2 * C;
    out.push({ method: "DeMark", levels: { R1: X / 2 - L, PP: X / 4, S1: X / 2 - H } });
  }
  out.push({ method: "Fibonacci", levels: { R3: P + R, R2: P + 0.618 * R, R1: P + 0.382 * R, PP: P, S1: P - 0.382 * R, S2: P - 0.618 * R, S3: P - R } });
  return out;
}

// BabyPips' Fibonacci lessons: retracements 23.6/38.2/50/61.8/76.4; 127.2 is √1.618.
export const RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.764];
export const EXTENSIONS = [1.272, 1.382, 1.618, 2, 2.618];

/** Retracements of the move, and extensions measured from its start (so 127.2% lies 27.2% of the range beyond the end).
 *  Upward move (low → high): retracement = high − range × r; extension = low + range × e.
 *  Downward move (high → low): retracement = low + range × r; extension = high − range × e. */
export function fibonacci(o: { high: number; low: number; trend: "up" | "down" }) {
  if (!finite(o.high, o.low) || o.high <= o.low) return null;
  const R = o.high - o.low, up = o.trend === "up";
  return {
    retracements: RETRACEMENTS.map((r) => ({ ratio: r, price: up ? o.high - R * r : o.low + R * r })),
    extensions: EXTENSIONS.map((e) => ({ ratio: e, price: up ? o.low + R * e : o.high - R * e })),
  };
}

/** Balance compounded at a fixed percentage per period. Each period applies the return first, then adds the deposit
 *  and takes the withdrawal, so new money compounds from the next period. */
export function compounding(o: { start: number; ratePercent: number; periods: number; deposit?: number; withdrawal?: number }) {
  if (!finite(o.start, o.ratePercent, o.periods) || o.start < 0 || o.periods < 1 || o.periods > 1200) return null;
  const rows: { period: number; start: number; gain: number; deposit: number; withdrawal: number; end: number }[] = [];
  let bal = o.start, dep = 0, wd = 0;
  for (let i = 1; i <= Math.floor(o.periods); i++) {
    const gain = bal * (o.ratePercent / 100), d = o.deposit ?? 0, w = Math.min(o.withdrawal ?? 0, bal + gain + d);
    rows.push({ period: i, start: bal, gain, deposit: d, withdrawal: w, end: bal + gain + d - w });
    bal += gain + d - w; dep += d; wd += w;
  }
  return { end: bal, totalGain: bal - o.start - dep + wd, deposits: dep, withdrawals: wd, rows };
}

/** Annualised equivalent of a per-period return. */
export const annualised = (ratePercent: number, periodsPerYear: number) => (Math.pow(1 + ratePercent / 100, periodsPerYear) - 1) * 100;

/** Balance after consecutive losses of a fixed percentage of the current balance, the drawdown, and the gain needed to recover. */
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

/** Gain needed to return to the starting balance after a loss of `lossPercent`: loss ÷ (100 − loss) × 100. */
export const recoveryNeeded = (lossPercent: number) => (lossPercent >= 100 ? Infinity : (lossPercent / (100 - lossPercent)) * 100);

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

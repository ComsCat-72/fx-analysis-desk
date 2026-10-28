// Calculator arithmetic against known values. These tools are separate from the reports.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../lib/calc/forex.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("pip value converts like BabyPips: quote = as is, base = ÷ price, otherwise × cross rate", () => {
  near(C.pipValue({ pair: "EUR/USD", units: 100_000, price: 1.12, account: "USD" })!.perPip, 10);
  near(C.pipValue({ pair: "EUR/USD", units: 100_000, price: 1.12, account: "EUR" })!.perPip, 8.928571, 1e-5); // $10 ÷ 1.12
  near(C.pipValue({ pair: "USD/JPY", units: 100_000, price: 150, account: "USD" })!.perPip, 6.666667, 1e-5); // ¥1,000 ÷ 150
  near(C.pipValue({ pair: "EUR/GBP", units: 100_000, price: 0.87, account: "USD", crossRate: 1.3 })!.perPip, 13); // £10 × GBP/USD
  assert.equal(C.pipValue({ pair: "EUR/GBP", units: 100_000, price: 0.87, account: "USD" }), null, "a cross rate is required");
  const v = C.pipValue({ pair: "EUR/USD", units: 30_000, pips: 25, price: 1.1, account: "USD" })!;
  near(v.perPip, 3); near(v.total, 75); near(v.standard, 10); near(v.mini, 1); near(v.micro, 0.1);
  assert.equal(C.pipSize("GBP/JPY"), 0.01);
  assert.equal(C.pipSize("XAU/USD"), 0.1);
  near(C.pipValue({ pair: "XAU/USD", units: 100, price: 4100, account: "USD" })!.perPip, 10); // 1 lot = 100 oz × 0.1
  near(C.profit({ pair: "XAU/USD", direction: "buy", open: 4100, close: 4101, units: 100, account: "USD" })!.pips, 10);
  assert.equal(C.priceDigits("XAU/USD"), 2); assert.equal(C.priceDigits("USD/JPY"), 3); assert.equal(C.priceDigits("EUR/USD"), 5);
  assert.equal(C.pipSize("EUR/GBP"), 0.0001);
});

test("position size: lots = amount at risk ÷ (stop pips × pip value per lot)", () => {
  const r = C.positionSize({ pair: "EUR/USD", balance: 5000, riskPercent: 1, stopPips: 25, price: 1.1, account: "USD" })!; // BabyPips' lesson example
  near(r.risk, 50); near(r.lots, 0.2); near(r.units, 20_000); near(r.miniLots, 2); near(r.microLots, 20); near(r.pipValuePerLot, 10);
  const eur = C.positionSize({ pair: "EUR/USD", balance: 10_000, riskAmount: 100, stopPips: 50, price: 1.25, account: "EUR" })!;
  near(eur.units, 25_000); // pip value per unit = 0.0001 ÷ 1.25 EUR
  near(C.pipsBetween("USD/JPY", 150.25, 149.75), 50);
  assert.equal(C.positionSize({ pair: "EUR/USD", balance: 10_000, riskPercent: 1, stopPips: 0, price: 1.1, account: "USD" }), null);
});

test("margin: position value in the account currency ÷ leverage", () => {
  const m = C.margin({ pair: "EUR/USD", units: 100_000, leverage: 30, price: 1.1, account: "USD" })!; // BabyPips' lesson: $110,000 at 30:1
  near(m.notional, 110_000); near(m.margin, 3666.666667, 1e-5); near(m.requirementPercent, 3.333333, 1e-5);
  near(C.margin({ pair: "USD/JPY", units: 100_000, leverage: 100, price: 150, account: "USD" })!.margin, 1000); // 1% of $100,000
  near(C.margin({ pair: "EUR/GBP", units: 100_000, leverage: 50, price: 0.87, account: "USD", crossRate: 1.3 })!.margin, 2262);
});

test("gain & loss %, trade profit and risk-reward", () => {
  const g = C.gainLoss({ start: 10_000, end: 8000 })!;
  near(g.percent, -20); near(g.amount, -2000); near(g.recoveryPercent, 25);
  near(C.gainLoss({ start: 10_000, percent: 10 })!.amount, 1000);
  near(C.gainLoss({ start: 10_000, amount: -5000 })!.recoveryPercent, 100);
  const p = C.profit({ pair: "GBP/USD", direction: "sell", open: 1.3, close: 1.295, units: 10_000, account: "USD" })!;
  near(p.pips, 50); near(p.account!, 50);
  near(C.profit({ pair: "USD/JPY", direction: "buy", open: 150, close: 151, units: 100_000, account: "USD" })!.account!, 662.251656, 1e-5); // ¥100,000 ÷ 151
  const d = C.riskRewardFromPrices("EUR/USD", 1.1, 1.095, 1.115);
  assert.ok(d && !("error" in d));
  const rr = C.riskReward({ pair: "EUR/USD", riskPips: (d as { riskPips: number }).riskPips, rewardPips: (d as { rewardPips: number }).rewardPips, units: 10_000, price: 1.1, account: "USD" })!;
  near(rr.ratio, 3); near(rr.breakEvenWinRate, 25); near(rr.money!.risk, 50); near(rr.money!.reward, 150);
  near(C.riskReward({ pair: "EUR/USD", riskPips: 50, rewardPips: 50 })!.breakEvenWinRate, 50);
  assert.ok("error" in (C.riskRewardFromPrices("EUR/USD", 1.1, 1.12, 1.115) as object));
});

test("pivot points", () => {
  const sets = C.pivots({ high: 1.32, low: 1.3, close: 1.31, open: 1.305 })!;
  const get = (m: string) => sets.find((s) => s.method === m)!.levels;
  near(get("Floor").PP, 1.31); near(get("Floor").R1, 1.32); near(get("Floor").S1, 1.3); near(get("Floor").R2, 1.33); near(get("Floor").S3, 1.28);
  near(get("Woodie").PP, (1.32 + 1.3 + 2 * 1.31) / 4);
  near(get("Camarilla").R4, 1.31 + 0.02 * 1.1 / 2);
  near(get("Fibonacci").R1, 1.31 + 0.382 * 0.02);
  near(get("DeMark").PP, (2 * 1.32 + 1.3 + 1.31) / 4);
  assert.equal(C.pivots({ high: 1, low: 2, close: 1.5 }), null);
});

test("fibonacci levels", () => {
  const up = C.fibonacci({ high: 1.2, low: 1.1, trend: "up" })!;
  near(up.retracements.find((r) => r.ratio === 0.618)!.price, 1.2 - 0.0618);
  near(up.retracements.find((r) => r.ratio === 0.764)!.price, 1.2 - 0.0764);
  near(up.extensions.find((r) => r.ratio === 1.272)!.price, 1.1 + 0.1272);
  near(up.extensions.find((r) => r.ratio === 1.618)!.price, 1.1 + 0.1618);
  near(C.fibonacci({ high: 1.2, low: 1.1, trend: "down" })!.extensions.find((r) => r.ratio === 1.618)!.price, 1.2 - 0.1618);
  near(C.fibonacci({ high: 1.2, low: 1.1, trend: "down" })!.retracements.find((r) => r.ratio === 0.5)!.price, 1.15);
});

test("compounding and drawdown", () => {
  near(C.compounding({ start: 1000, ratePercent: 10, periods: 3 })!.end, 1331);
  near(C.compounding({ start: 1000, ratePercent: 0, periods: 2, deposit: 100 })!.end, 1200);
  const w = C.compounding({ start: 1000, ratePercent: 10, periods: 2, deposit: 100, withdrawal: 50 })!; // 1000→1150→1315
  near(w.end, 1315); near(w.withdrawals, 100); near(w.deposits, 200); near(w.totalGain, 215);
  near(C.annualised(1, 12), 12.682503, 1e-5);
  const d = C.drawdown({ start: 10_000, lossPercent: 50, losses: 1 })!;
  near(d.end, 5000); near(d.rows[0].recoveryPercent, 100);
  near(C.recoveryNeeded(20), 25);
});

test("market hours follow each centre's daylight saving; FX is closed at the weekend", () => {
  // London on Tuesday 20 Oct 2026 (BST): opens 07:00 UTC; on Tuesday 27 Oct (GMT): opens 08:00 UTC.
  const lon = (t: number) => C.sessionsAt(t).find((s) => s.name === "London")!;
  assert.equal(new Date(lon(Date.parse("2026-10-20T10:00:00Z")).current!.start).toISOString(), "2026-10-20T07:00:00.000Z");
  assert.equal(new Date(lon(Date.parse("2026-10-27T10:00:00Z")).current!.start).toISOString(), "2026-10-27T08:00:00.000Z");
  assert.equal(C.fxMarketOpen(Date.parse("2026-10-31T12:00:00Z")), false); // Saturday
  assert.equal(C.sessionsAt(Date.parse("2026-10-31T12:00:00Z")).some((s) => s.open_now), false);
});

test("next weekly open/close matches a minute-by-minute search, across the US clock change", () => {
  const slow = (t: number) => { const o = C.fxMarketOpen(t); for (let x = t + 60_000; ; x += 60_000) if (C.fxMarketOpen(x) !== o) return x - (x % 60_000); };
  for (const iso of ["2026-10-28T17:00:00Z", "2026-10-30T20:59:00Z", "2026-10-31T12:00:00Z", "2026-11-01T21:30:00Z", "2026-11-01T22:30:00Z", "2026-11-06T21:00:00Z"]) {
    const t = Date.parse(iso), fast = C.nextMarketChange(t);
    assert.equal(new Date(fast.at).toISOString(), new Date(slow(t)).toISOString(), iso);
    assert.equal(fast.opens, !C.fxMarketOpen(t));
  }
});

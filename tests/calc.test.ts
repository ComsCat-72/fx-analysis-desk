// Calculator arithmetic against known values. These tools are separate from the reports.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as C from "../lib/calc/forex.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("pip value", () => {
  near(C.pipValue({ pair: "EUR/USD", units: 100_000, quoteToAccount: 1 })!.perPip, 10);
  near(C.pipValue({ pair: "USD/JPY", units: 100_000, quoteToAccount: 1 / 150 })!.perPip, 6.666667, 1e-5);
  near(C.pipValue({ pair: "XAU/USD", units: 100, pips: 10, quoteToAccount: 1 })!.total, 10);
  assert.equal(C.pipSize("GBP/JPY"), 0.01);
  assert.equal(C.pipSize("EUR/GBP"), 0.0001);
});

test("position size from risk and stop distance", () => {
  const r = C.positionSize({ pair: "EUR/USD", balance: 10_000, riskPercent: 1, stopPips: 50, quoteToAccount: 1 })!;
  near(r.risk, 100); near(r.units, 20_000); near(r.lots, 0.2); near(r.miniLots, 2); near(r.microLots, 20);
  assert.equal(C.positionSize({ pair: "EUR/USD", balance: 10_000, riskPercent: 1, stopPips: 0, quoteToAccount: 1 }), null);
});

test("margin, profit and risk-reward", () => {
  near(C.margin({ units: 100_000, leverage: 50, baseToAccount: 1.1 })!.margin, 2200);
  const p = C.profit({ pair: "GBP/USD", direction: "sell", open: 1.3, close: 1.295, units: 10_000, quoteToAccount: 1 })!;
  near(p.pips, 50); near(p.account, 50);
  const rr = C.riskReward({ pair: "EUR/USD", entry: 1.1, stop: 1.095, target: 1.115 });
  assert.ok(rr && !("error" in rr));
  near((rr as { ratio: number }).ratio, 3); near((rr as { riskPips: number }).riskPips, 50);
  assert.ok("error" in (C.riskReward({ pair: "EUR/USD", entry: 1.1, stop: 1.12, target: 1.115 }) as object));
});

test("pivot points", () => {
  const sets = C.pivots({ high: 1.32, low: 1.3, close: 1.31, open: 1.305 })!;
  const get = (m: string) => sets.find((s) => s.method === m)!.levels;
  near(get("Classic").PP, 1.31); near(get("Classic").R1, 1.32); near(get("Classic").S1, 1.3); near(get("Classic").R2, 1.33);
  near(get("Camarilla").R4, 1.31 + 0.02 * 1.1 / 2);
  near(get("Fibonacci").R1, 1.31 + 0.382 * 0.02);
  near(get("DeMark").PP, (2 * 1.32 + 1.3 + 1.31) / 4);
  assert.equal(C.pivots({ high: 1, low: 2, close: 1.5 }), null);
});

test("fibonacci levels", () => {
  const up = C.fibonacci({ high: 1.2, low: 1.1, trend: "up" })!;
  near(up.retracements.find((r) => r.ratio === 0.618)!.price, 1.2 - 0.0618);
  near(up.extensions.find((r) => r.ratio === 1.618)!.price, 1.1 + 0.1618);
  near(C.fibonacci({ high: 1.2, low: 1.1, trend: "down" })!.retracements.find((r) => r.ratio === 0.5)!.price, 1.15);
});

test("compounding and drawdown", () => {
  near(C.compounding({ start: 1000, ratePercent: 10, periods: 3 })!.end, 1331);
  near(C.compounding({ start: 1000, ratePercent: 0, periods: 2, deposit: 100 })!.end, 1200);
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

test("the analysis reports never use the calculators", () => {
  for (const f of readdirSync("lib/reports")) assert.doesNotMatch(readFileSync(`lib/reports/${f}`, "utf8"), /calc\//, f);
});

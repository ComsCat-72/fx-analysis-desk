import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIG } from "../lib/config.ts";
import { ConditionOutcome, evaluateBreak, levelStatus } from "../lib/core/breaks.ts";
import { assessDirection } from "../lib/core/evaluation.ts";
import { classifySurprise, reconcileActuals, revisionDirection, validateScenarios } from "../lib/core/events.ts";
import { dayWindow, lastClosedSession, sessionOf, weekWindow } from "../lib/core/sessions.ts";
import { atr, findSwings, structure, type Bar } from "../lib/core/technical.ts";

const H = 3600_000;
const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ start: i * H, end: (i + 1) * H, open: o, high: h, low: l, close: c, complete: true });
const closes = (cs: number[]) => cs.map((c, i) => bar(i, c, c + 0.0005, c - 0.0005, c));
const rules = { basis: "close" as const, sustainedCloses: 2, reversalCloses: 1 };

test("Wilder ATR", () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(i, 1, 1.01, 0.99, 1));
  assert.ok(Math.abs(atr(bars, 14)! - 0.02) < 1e-12);
  assert.equal(atr(bars.slice(0, 10), 14), null);
});

test("a swing exists only after its right-side bars have closed (no future leakage)", () => {
  const hs = [1, 2, 3, 9, 3, 2, 1, 2];
  const bars = hs.map((h, i) => bar(i, h - 0.5, h, h - 1, h - 0.5));
  assert.equal(findSwings(bars, bars[5].end).filter((s) => s.kind === "high").length, 0);
  const s = findSwings(bars, bars[6].end).filter((x) => x.kind === "high");
  assert.equal(s.length, 1);
  assert.equal(s[0].confirmedAt, bars[6].end);
});

test("structure labels", () => {
  const sw = (kind: "high" | "low", label: "HH" | "HL" | "LH" | "LL" | undefined) => ({ kind, label, price: 1, barStart: 0, confirmedAt: 0 });
  assert.equal(structure([sw("high", undefined), sw("high", "HH"), sw("low", undefined), sw("low", "HL")]), "upward");
  assert.equal(structure([sw("high", undefined), sw("high", "LH"), sw("low", undefined), sw("low", "LL")]), "downward");
  assert.equal(structure([sw("high", undefined), sw("high", "HH"), sw("low", undefined), sw("low", "LL")]), "mixed");
});

test("break outcomes follow the configured close rule", () => {
  assert.equal(evaluateBreak(closes([1.0, 1.001, 1.002]), 1.01, "above", rules).outcome, ConditionOutcome.NOT_REACHED);
  const brief = [bar(0, 1, 1.02, 0.99, 1.0), bar(1, 1, 1.0, 0.99, 1.0)];
  assert.equal(evaluateBreak(brief, 1.01, "above", rules).outcome, ConditionOutcome.BRIEFLY_REACHED);
  assert.equal(evaluateBreak(closes([1.0, 1.02, 1.03]), 1.01, "above", rules).outcome, ConditionOutcome.CONFIRMED);
  assert.equal(evaluateBreak(closes([1.0, 1.02, 1.03, 1.0]), 1.01, "above", rules).outcome, ConditionOutcome.CONFIRMED_THEN_REVERSED);
  assert.equal(evaluateBreak(closes([1.0, 1.02]), 1.01, "above", rules).outcome, ConditionOutcome.UNRESOLVED);
  assert.equal(evaluateBreak([{ ...bar(0, 1, 1, 1, 1), complete: false }], 1.01, "above", rules).outcome, ConditionOutcome.NOT_ASSESSABLE);
});

test("level status: tested, broken, reclaimed", () => {
  assert.equal(levelStatus("active", 1.0, 1.001, "support", closes([1.002, 1.0005]), rules).status, "tested");
  assert.equal(levelStatus("active", 1.0, 1.001, "support", closes([1.0005, 0.99, 0.98]), rules).status, "broken");
  assert.equal(levelStatus("active", 1.0, 1.001, "support", closes([1.0005, 0.99, 0.98, 1.01, 1.02]), rules).status, "reclaimed");
});

test("directional assessment thresholds", () => {
  const cfg = CONFIG.evaluation, day = (o: number, h: number, l: number, c: number) => bar(0, o, h, l, c);
  assert.equal(assessDirection("upward_lean", 1.0, day(1, 1.012, 0.999, 1.01), 0.01, cfg).outcome, "Supported");
  assert.equal(assessDirection("upward_lean", 1.0, day(1, 1.001, 0.99, 0.99), 0.01, cfg).outcome, "Not supported");
  assert.equal(assessDirection("upward_lean", 1.0, day(1, 1.001, 0.999, 1.001), 0.01, cfg).outcome, "Inconclusive");
  assert.equal(assessDirection("upward_lean", 1.0, day(1, 1.01, 0.994, 1.004), 0.01, cfg).outcome, "Mixed");
  assert.equal(assessDirection("downward_lean", 1.0, day(1, 1.001, 0.99, 0.99), 0.01, cfg).outcome, "Supported");
  assert.equal(assessDirection("range_bound", 1.0, day(1, 1.001, 0.999, 1.001), 0.01, cfg, [0.99, 1.01]).outcome, "Supported");
  assert.equal(assessDirection("range_bound", 1.0, day(1, 1.03, 0.999, 1.02), 0.01, cfg, [0.99, 1.01]).outcome, "Not supported");
  assert.equal(assessDirection("upward_lean", null, day(1, 1, 1, 1), 0.01, cfg).outcome, "Not assessable");
});

test("surprises are judged at published precision; sources are never averaged", () => {
  assert.equal(classifySurprise("3.1%", "3.1%"), "in line with consensus");
  assert.equal(classifySurprise("3.10%", "3.1%"), "in line with consensus");
  assert.equal(classifySurprise("3.2%", "3.1%"), "above consensus");
  assert.equal(classifySurprise("150K", "175K"), "below consensus");
  assert.equal(classifySurprise("3.1%", null), "no verified consensus");
  assert.equal(classifySurprise("3.1%", "150K"), "not comparable");
  assert.equal(revisionDirection("0.2%", "0.3%"), "revised up");
  assert.deepEqual(reconcileActuals({ a: "3.1%", b: "3.2%" }), { state: "conflicting", actual: null });
  assert.deepEqual(reconcileActuals({ a: "3.1%", b: "3.1%" }), { state: "released", actual: "3.1%" });
  assert.throws(() => validateScenarios([{ outcome: "a", implication: "x", weight: 60 }, { outcome: "b", implication: "y", weight: 30 }], "m"));
});

test("session windows follow each source's daily bars, across daylight saving", () => {
  const fx = CONFIG.instruments.GBP_USD.session, ny = CONFIG.instruments.DXY.session, cash = CONFIG.instruments.NAS100.session;
  assert.deepEqual(dayWindow(fx, "2026-10-27"), { start: Date.parse("2026-10-27T00:00:00Z"), end: Date.parse("2026-10-28T00:00:00Z") }); // GMT
  assert.equal(dayWindow(fx, "2026-07-14").start, Date.parse("2026-07-13T23:00:00Z")); // BST
  assert.deepEqual(dayWindow(ny, "2026-10-26"), { start: Date.parse("2026-10-25T21:00:00Z"), end: Date.parse("2026-10-26T21:00:00Z") }); // Monday opens Sunday 17:00 EDT
  assert.equal(dayWindow(ny, "2026-11-02").end, Date.parse("2026-11-02T22:00:00Z")); // EST
  assert.deepEqual(dayWindow(cash, "2026-10-26"), { start: Date.parse("2026-10-26T13:30:00Z"), end: Date.parse("2026-10-26T20:00:00Z") });
  assert.equal(weekWindow(fx, "2026-10-26").end, Date.parse("2026-10-31T00:00:00Z"));
  assert.equal(sessionOf(fx, Date.parse("2026-10-31T12:00:00Z")), null); // Saturday
  assert.equal(sessionOf(cash, Date.parse("2026-10-27T15:00:00Z")), "2026-10-27");
  assert.equal(lastClosedSession(fx, Date.parse("2026-10-27T03:00:00Z")), "2026-10-26");
});

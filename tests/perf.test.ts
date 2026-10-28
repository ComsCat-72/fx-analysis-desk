// Guards against the Market hours page getting slow again: these run on every clock tick.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "../lib/calc/forex.ts";

test("market-hours helpers stay cheap enough to run every second", () => {
  const t0 = Date.parse("2026-10-28T14:00:00Z");
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    const t = t0 + i * 600_000;
    C.sessionsAt(t); C.activityAt(t); C.nextMarketChange(t);
  }
  const ms = performance.now() - start;
  assert.ok(ms < 4000, `1000 iterations took ${ms.toFixed(0)} ms`);
});

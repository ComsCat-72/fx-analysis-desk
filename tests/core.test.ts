import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySurprise, reconcileActuals, revisionDirection } from "../lib/core/events.ts";

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
});

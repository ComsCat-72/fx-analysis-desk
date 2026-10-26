import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReport } from "../lib/checks.ts";

const BAD = [
  "Buy above 1.3400.", "Sell rallies.", "Enter after the retest.", "Place your stop below support.", "Target 1.3470.",
  "Avoid shorts here.", "The best opportunity is a long.", "This setup offers a 1:3 risk/reward.",
  "A clean break above 0.5710 opens room toward 0.5750.", "In that case, wait for the RBNZ and FOMC outcomes.",
  "Watch the Eurozone release first, then US data.", "Sell the pair.", "Price swept the liquidity grab below the lows.",
  "A BOS formed on the 1H chart.",
];
const GOOD = [
  "A sustained move above 1.3400 would strengthen the upward interpretation.",
  "Repeated rejection at resistance suggests upward momentum remains limited.",
  "A close below support would weaken the recovery.", "The next previously identified resistance area is near 1.3470.",
  "The outlook remains mixed while price stays within the range.", "Selling pressure increased after the release.",
  "Short-term yields fell while long-term yields held.", "Inflation remains above the RBNZ's 1–3% target band.",
  "Safe-haven buying supported the franc.", "Buyers defended support near the previous daily low.",
  "The economy entered a technical recession, reporting said.", "Corporate profits rose in the quarter.",
];

test("every prohibited example from the specification is caught", () => {
  for (const s of BAD) assert.ok(checkReport(s).length > 0, `missed: ${s}`);
});

test("acceptable analytical wording passes", () => {
  for (const s of GOOD) assert.deepEqual(checkReport(s), [], `false alarm: ${s}`);
});

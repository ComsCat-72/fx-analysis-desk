import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAdvice } from "../lib/content/advice.ts";
import { checkCitationsAndNumbers, checkIntegrity } from "../lib/content/checks.ts";
import { detectTerms, dictionary } from "../lib/content/terminology.ts";
import type { Bundle } from "../lib/reports/types.ts";

const flag = (s: string) => [...detectAdvice(s), ...detectTerms(s, dictionary())];

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
  for (const s of BAD) assert.ok(flag(s).length > 0, `missed: ${s}`);
});

test("acceptable analytical wording passes", () => {
  for (const s of GOOD) assert.deepEqual(flag(s), [], `false alarm: ${s}`);
});

test("a user-approved term is no longer blocked; a user-prohibited one is", () => {
  const d = dictionary([{ kind: "approved", term: "imbalance", enabled: true, at: 0 }, { kind: "prohibited", term: "moon shot", enabled: true, at: 0 }]);
  assert.equal(detectTerms("An imbalance formed.", d).length, 0);
  assert.equal(detectTerms("A moon shot followed.", d).length, 1);
});

const bundle = {
  meta: { calendar_numbers: ["27", "2026"], allowed_times: ["08:00"], display: "GBP/USD" },
  facts: { F1: { id: "F1", kind: "price", text: "The previous session closed at 1.30412.", values: ["1.30412"] } },
  levels: { L1: { id: "L1", kind: "level", text: "Support 1.30000", values: ["1.30000", "1.30000"], break_confirmed: false } },
  events: { E1: { id: "E1", kind: "event", title: "CPI y/y", text: "CPI y/y", values: ["3.1%", "3.0%", "3.1%"], surprise: "in line with consensus", state: "released" } },
  policy: {}, continuity: {}, evaluation: null, warnings: [], missing: [],
} as unknown as Bundle;

test("figures must be cited and match the cited facts", () => {
  const ok = checkCitationsAndNumbers({ s: "The previous session closed at 1.30412 [F1]." }, bundle, 5);
  assert.deepEqual(ok, []);
  const uncited = checkCitationsAndNumbers({ s: "The previous session closed at 1.30412." }, bundle, 5);
  assert.equal(uncited[0].category, "missing_citation");
  const wrong = checkCitationsAndNumbers({ s: "The previous session closed at 1.30999 [F1]." }, bundle, 5);
  assert.equal(wrong[0].category, "unsupported_number");
  const unknown = checkCitationsAndNumbers({ s: "It closed at 1.30412 [F9]." }, bundle, 5);
  assert.ok(unknown.some((f) => f.category === "unknown_citation"));
  const time = checkCitationsAndNumbers({ s: "Data at 14:30 matter." }, bundle, 5);
  assert.equal(time[0].category, "unsupported_time");
});

test("an in-line result is not a surprise; an unconfirmed break is not sustained", () => {
  assert.equal(checkIntegrity({ s: "CPI surprised markets [E1]." }, bundle)[0].category, "inline_as_surprise");
  assert.equal(checkIntegrity({ s: "Price made a sustained break of support [L1]." }, bundle)[0].category, "unconfirmed_sustained_break");
  assert.deepEqual(checkIntegrity({ s: "A sustained break below support [L1] would weaken the recovery." }, bundle), []);
});

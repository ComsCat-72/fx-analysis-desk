// Pre-publication checks. Deterministic checks run first; the semantic review (Claude) is layered on top.
// Checks read the model-written sections and the exact fact bundle the text was written from.
// Citations look like [F3], [L2], [E5], [P1]; every figure in prose must trace to a cited bundle value.
import type { Bundle, Checks, Item } from "../reports/types.ts";
import { detectAdvice, finding, type Finding } from "./advice.ts";
import { detectTerms, type Dictionary } from "./terminology.ts";

export const CITE_RE = /\[((?:[FLEP]\d+)(?:\s*,\s*[FLEP]\d+)*)\]/g;
const NUM_RE = /(?<![\w.])[-+−]?\d+(?:[.,]\d+)?(?:\s?(?:%|bp|bps|K|M|B|T))?(?!\w)/g;
const IGNORE_RE = /\b(?:H1|H4|D1|W1|M15|M30|1H|4H|1D|1W|Q[1-4]|G7|G10|G20|S&P\s?500|NAS100|Nasdaq-100|ATR\(\d+\)|[SE]MA\(\d+\)|RSI\(\d+\)|(?:[FLEP]\d+))(?!\w)/gi;
const TIME_RE = /\b\d{1,2}:\d{2}\b/g;
const SENT_RE = /(?<=[.!?])\s+(?=[A-Z("'])|\n+/;

const SURPRISE = /\b(?:surpris\w*|unexpected\w*|beat|beats|missed|misses|shock\w*|above (?:expectations|forecasts?|consensus)|below (?:expectations|forecasts?|consensus)|stronger[- ]than[- ]expected|weaker[- ]than[- ]expected|hotter|softer|cooler)\b/i;
const SUSTAINED = /\b(?:sustained|confirmed|decisive|clean)\s+(?:break|move|close)/i;
const CAUSAL = /\b(?:because of|due to|driven by|caused by|as a result of|triggered by|on the back of|thanks to|led to|sparked)\b/i;
const RELEASED = /\b(?:came in|printed|was reported at|was released at|rose to|fell to|increased to|decreased to|showed)\b/i;

export const splitSentences = (t: string) => t.split(SENT_RE).map((s) => s.trim()).filter(Boolean);
export const citesIn = (s: string) => [...s.matchAll(CITE_RE)].flatMap((m) => m[1].split(",").map((c) => c.trim()));

function norm(x: string): number | null {
  const s = x.replace("−", "-").replace(",", ".").trim().replace(/\s?(?:%|bp|bps|K|M|B|T)$/, "").replace(/^\+/, "");
  const n = Number(s);
  return s === "" || Number.isNaN(n) ? null : n;
}
const decimalsOf = (x: string) => { const m = x.replace(",", ".").match(/\.(\d+)/); return m ? m[1].length : 0; };

function matches(token: string, allowed: number[], minRoundDecimals: number): boolean {
  const v = norm(token);
  if (v == null) return true;
  const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  if (allowed.some((a) => eq(a, v) || eq(-a, v))) return true;
  const shown = decimalsOf(token);
  if (shown >= minRoundDecimals) return allowed.some((a) => eq(Number(a.toFixed(shown)), v) || eq(Number((-a).toFixed(shown)), v));
  return false;
}

export function citable(b: Bundle): Record<string, Item> {
  return { ...b.facts, ...b.levels, ...b.events, ...b.policy };
}

function allowedNumbers(items: { values?: (string | null)[]; numbers_in_text?: string[]; text?: string }[]): number[] {
  const out: number[] = [];
  for (const it of items) {
    for (const v of it.values ?? []) { if (v != null) { const d = norm(String(v)); if (d != null) out.push(d); } }
    for (const t of [...(it.numbers_in_text ?? []), ...((it.text ?? "").replace(TIME_RE, " ").match(NUM_RE) ?? [])]) {
      const d = norm(String(t)); if (d != null) out.push(d);
    }
  }
  return out;
}

export function checkCitationsAndNumbers(sections: Record<string, string>, b: Bundle, priceDecimals: number): Finding[] {
  const items = citable(b);
  const globalAllowed = allowedNumbers([{ values: b.meta.calendar_numbers ?? [] }]);
  const allowedTimes = new Set(b.meta.allowed_times ?? []);
  const out: Finding[] = [];
  for (const [key, text] of Object.entries(sections)) {
    for (const sent of splitSentences(text)) {
      const cited = citesIn(sent);
      for (const c of cited) if (!items[c]) out.push(finding("factual", "unknown_citation", "blocking", `Citation [${c}] is not in the fact bundle.`, sent.slice(0, 160), key));
      let body = sent.replace(CITE_RE, " ").replace(IGNORE_RE, " ");
      const citedTimes = new Set(cited.flatMap((c) => (items[c]?.text ?? "").match(TIME_RE) ?? []));
      for (const t of body.match(TIME_RE) ?? []) {
        if (!allowedTimes.has(t) && !citedTimes.has(t) && !allowedTimes.has(t.padStart(5, "0")))
          out.push(finding("factual", "unsupported_time", "blocking", `Time '${t}' does not match any event or report time in the bundle.`, sent.slice(0, 160), key));
      }
      body = body.replace(TIME_RE, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " "); // ISO dates (report keys) are not figures
      // Single digits (counts such as "2 closes") and calendar numbers from the report period need no citation.
      const nums = (body.match(NUM_RE) ?? []).filter((n) => !/^[1-9]$/.test(n.trim()) && !globalAllowed.includes(norm(n) as number));
      if (!nums.length) continue;
      if (!cited.length) { out.push(finding("factual", "missing_citation", "blocking", "Sentence states figures without citing a fact.", sent.slice(0, 160), key)); continue; }
      const allowed = allowedNumbers(cited.filter((c) => items[c]).map((c) => items[c]));
      for (const n of nums) {
        if (!matches(n, allowed, Math.max(2, priceDecimals - 1)))
          out.push(finding("factual", "unsupported_number", "blocking", `'${n.trim()}' does not match any value in the cited facts [${cited.join(", ")}].`, sent.slice(0, 160), key));
      }
    }
  }
  return out;
}

export function checkIntegrity(sections: Record<string, string>, b: Bundle): Finding[] {
  const items = citable(b);
  const out: Finding[] = [];
  for (const [key, text] of Object.entries(sections)) {
    for (const sent of splitSentences(text)) {
      const citedItems = citesIn(sent).filter((c) => items[c]).map((c) => items[c]);
      const events = citedItems.filter((i) => i.kind === "event"), levels = citedItems.filter((i) => i.kind === "level");
      if (SURPRISE.test(sent)) {
        for (const e of events) {
          if (e.surprise === "in line with consensus") out.push(finding("integrity", "inline_as_surprise", "blocking", `${e.title} was in line with consensus but is described as a surprise.`, sent.slice(0, 160), key));
          if (!["released", "revised"].includes(String(e.state))) out.push(finding("integrity", "unverified_result", "blocking", `${e.title} has no verified actual (state: ${e.state}).`, sent.slice(0, 160), key));
        }
      }
      if (RELEASED.test(sent)) {
        for (const e of events) if (!["released", "revised"].includes(String(e.state)))
          out.push(finding("integrity", "unverified_result", "blocking", `${e.title} is described as released but its actual is not verified.`, sent.slice(0, 160), key));
      }
      if (SUSTAINED.test(sent) && !/\b(?:would|could|if|unless|until|without|not|no)\b/i.test(sent) && levels.length && !levels.some((l) => l.break_confirmed))
        out.push(finding("integrity", "unconfirmed_sustained_break", "blocking", "Sentence describes a sustained/confirmed break that the break rules did not confirm.", sent.slice(0, 160), key));
      if (CAUSAL.test(sent) && !citedItems.some((i) => ["news", "policy", "event"].includes(i.kind)))
        out.push(finding("integrity", "causal_claim_without_evidence", "warning", "Causal wording without a cited news, policy or release fact; consider 'coincided with'.", sent.slice(0, 160), key));
      if (/\b\d+(?:\.\d+)?\s?%\s+(?:chance|probability|likelihood|odds)\b/i.test(sent) && !citedItems.some((i) => i.kind === "pricing"))
        out.push(finding("integrity", "arbitrary_probability", "blocking", "Probability stated without a sourced market-pricing fact.", sent.slice(0, 160), key));
    }
  }
  return out;
}

/** Text must not restate earlier outlooks differently from the stored published versions. */
export function checkContinuity(sections: Record<string, string>, b: Bundle): Finding[] {
  const weekly = b.continuity?.weekly;
  const text = Object.values(sections).join("\n");
  const m = text.match(/\b(?:weekly|initial weekly|original weekly)\s+(?:bias|outlook|view|thesis)\s+(?:was|is|remains|had been)\s+(?:an?\s+)?(\w+)/i);
  if (!m) return [];
  const said = m[1].toLowerCase();
  if (!weekly) return [finding("continuity", "invented_weekly_outlook", "blocking", "Text refers to a weekly outlook but none was published.", m[0])];
  const labels: Record<string, string> = { upward_lean: "upward", downward_lean: "downward", neutral: "neutral", range_bound: "range" };
  const syn: Record<string, string[]> = { upward: ["upward", "bullish", "positive"], downward: ["downward", "bearish", "negative"], neutral: ["neutral", "mixed"], range: ["range", "range-bound", "neutral"] };
  const want = labels[weekly.direction] ?? weekly.direction;
  return (syn[want] ?? [want]).includes(said) ? []
    : [finding("continuity", "misstated_prior_bias", "blocking", `Weekly outlook is stored as '${weekly.direction}', text says '${said}'.`, m[0])];
}

/** Reviews: "<instrument> rose/fell" must agree with the computed session movement. */
export function checkDirectionClaims(sections: Record<string, string>, b: Bundle): Finding[] {
  const actual = b.evaluation?.session_direction;
  if (!actual) return [];
  const disp = b.meta.display.split(" ")[0].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const out: Finding[] = [];
  for (const [key, text] of Object.entries(sections)) {
    for (const m of text.matchAll(new RegExp(`${disp}\\s+(rose|fell|gained|declined|dropped|climbed|consolidated|was little changed)`, "gi"))) {
      const w = m[1].toLowerCase();
      const said = ["rose", "gained", "climbed"].includes(w) ? "rose" : ["fell", "declined", "dropped"].includes(w) ? "fell" : "consolidated";
      if (said !== actual) out.push(finding("factual", "wrong_direction", "blocking", `Text says the instrument ${said}; session data shows it ${actual}.`, m[0], key));
    }
  }
  return out;
}

export function checkLength(sections: Record<string, string>, bounds?: [number, number]): Finding[] {
  if (!bounds) return [];
  const n = Object.values(sections).reduce((s, t) => s + t.replace(CITE_RE, "").split(/\s+/).filter(Boolean).length, 0);
  const [lo, hi] = bounds;
  return n < lo * 0.8 || n > hi * 1.15 ? [finding("style", "length", "warning", `Body is ${n} words; configured range is ${lo}-${hi}.`)] : [];
}

export function checkDataWarnings(b: Bundle): Finding[] {
  return [
    ...b.warnings.map((w) => finding("data", w.code, w.severity === "blocking" ? "blocking" : w.severity === "warning" ? "warning" : "info", w.message)),
    ...b.missing.map((m) => finding("data", "missing_essential", "blocking", m)),
  ];
}

export function runDeterministic(sections: Record<string, string>, b: Bundle, d: Dictionary, bounds: [number, number] | undefined, priceDecimals: number): Finding[] {
  const all: Finding[] = [];
  for (const [key, text] of Object.entries(sections)) all.push(...detectAdvice(text, key), ...detectTerms(text, d, key));
  all.push(...checkCitationsAndNumbers(sections, b, priceDecimals), ...checkIntegrity(sections, b), ...checkContinuity(sections, b),
    ...checkDirectionClaims(sections, b), ...checkLength(sections, bounds), ...checkDataWarnings(b));
  const seen = new Set<string>();
  return all.filter((f) => { const k = `${f.check}|${f.category}|${f.excerpt}|${f.section}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function summarize(findings: Finding[]): Checks {
  return { blocking: findings.filter((f) => f.severity === "blocking").length, warnings: findings.filter((f) => f.severity === "warning").length, findings };
}

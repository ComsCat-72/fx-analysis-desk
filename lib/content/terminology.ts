// User-controlled terminology dictionary. Terms are only ever added by you (Configure → Terminology);
// the system never adopts terms from source material.
import type { TermEdit } from "../settings.ts";
import { finding, type Finding } from "./advice.ts";

export interface Approved { term: string; definition: string | null; alternatives: string[]; prohibited_alternatives: string[] }
export interface Prohibited { phrase: string; suggest: string | null }
export interface Dictionary { approved: Approved[]; prohibited: Prohibited[]; abbreviations: Record<string, { enabled: boolean; plain: string | null }> }

const APPROVED: Approved[] = [
  { term: "support", definition: "A price area where declines have previously stopped or reversed.", alternatives: ["support area", "support zone"], prohibited_alternatives: ["demand zone", "bullish order block"] },
  { term: "resistance", definition: "A price area where advances have previously stopped or reversed.", alternatives: ["resistance area", "resistance zone"], prohibited_alternatives: ["supply zone", "bearish order block"] },
  { term: "sustained break", definition: "The configured number of consecutive candle closes beyond a boundary on the break timeframe (lib/config.ts technical.breaks).", alternatives: ["sustained move above", "sustained move below"], prohibited_alternatives: ["displacement"] },
  { term: "market structure", definition: "The sequence of confirmed swing highs and lows. Upward structure = higher highs and higher lows; downward = lower highs and lower lows; otherwise mixed.", alternatives: ["price structure"], prohibited_alternatives: [] },
  { term: "rejection", definition: "Price trades beyond a boundary but the candle closes back on the original side.", alternatives: ["failed break"], prohibited_alternatives: ["liquidity sweep", "stop hunt"] },
  { term: "range", definition: "A period where price is contained between an identified support and resistance area.", alternatives: ["price range", "consolidation"], prohibited_alternatives: [] },
  { term: "higher high / higher low / lower high / lower low", definition: "Comparisons between consecutive confirmed swing points.", alternatives: [], prohibited_alternatives: [] },
  { term: "rate expectations", definition: "Market pricing or reported expectations of future central-bank policy rates.", alternatives: ["policy expectations"], prohibited_alternatives: [] },
  { term: "risk sentiment", definition: "Broad willingness of investors to hold riskier assets, as reflected in reported market behaviour.", alternatives: ["risk appetite"], prohibited_alternatives: [] },
];

const PROHIBITED: Prohibited[] = ([
  ["smart money", "describe the observed price behaviour"], ["institutional manipulation", "remove; intent cannot be inferred from price"],
  ["liquidity grab", "brief move beyond the level followed by a close back inside"], ["liquidity hunt", "brief move beyond the level"],
  ["liquidity sweep", "brief move beyond the level followed by a close back inside"], ["stop hunt", "brief move beyond the level"],
  ["order block", "support or resistance area"], ["fair value gap", "price area with little trading on the way up/down"],
  ["imbalance", "fast move with little overlap between candles"], ["mitigation block", "support or resistance area"],
  ["breaker block", "former support now acting as resistance (or the reverse)"], ["inducement", "remove"],
  ["premium/discount", "upper / lower part of the range"], ["discount array", "lower part of the range"], ["premium array", "upper part of the range"],
  ["kill zone", "name the session, e.g. the London session"], ["killzone", "name the session"], ["sniper entry", "remove"],
  ["institutional footprint", "remove"], ["guaranteed setup", "remove"], ["market makers", "remove unsupported claims about intent"],
  ["bullish delivery", "upward momentum"], ["bearish delivery", "downward momentum"], ["displacement", "strong directional move"],
] as const).map(([phrase, suggest]) => ({ phrase, suggest }));

const ABBREVIATIONS: Dictionary["abbreviations"] = {
  BOS: { enabled: false, plain: "price moved above the previous swing high (or below the previous swing low)" },
  CHoCH: { enabled: false, plain: "price broke the most recent swing point against the prior direction" },
  MSS: { enabled: false, plain: "change in the sequence of swing highs and lows" },
  FVG: { enabled: false, plain: "price area with little trading on the way through" },
  OB: { enabled: false, plain: "support or resistance area" },
};

export function dictionary(edits: TermEdit[] = []): Dictionary {
  const d: Dictionary = { approved: [...APPROVED], prohibited: [...PROHIBITED], abbreviations: { ...ABBREVIATIONS } };
  for (const t of edits) {
    if (t.kind === "approved") {
      d.approved.push({ term: t.term, definition: t.definition ?? null, alternatives: t.alternatives ?? [], prohibited_alternatives: t.prohibited_alternatives ?? [] });
      d.prohibited = d.prohibited.filter((p) => p.phrase.toLowerCase() !== t.term.toLowerCase()); // explicit approval wins
    } else if (t.kind === "prohibited") {
      d.prohibited = d.prohibited.filter((p) => p.phrase.toLowerCase() !== t.term.toLowerCase());
      if (t.enabled) d.prohibited.push({ phrase: t.term, suggest: t.suggest ?? null });
    } else {
      d.abbreviations[t.term] = { enabled: t.enabled, plain: t.definition ?? d.abbreviations[t.term]?.plain ?? null };
    }
  }
  return d;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (p: string) => new RegExp(String.raw`\b${p.trim().split(/[\s-]+/).map(esc).join(String.raw`[\s-]+`)}s?\b`, "gi");

export function detectTerms(text: string, d: Dictionary, section: string | null = null): Finding[] {
  const out: Finding[] = [];
  const phrases: [string, string | null][] = [
    ...d.prohibited.map((p) => [p.phrase, p.suggest] as [string, string | null]),
    ...d.approved.flatMap((a) => a.prohibited_alternatives.map((x) => [x, `use '${a.term}'`] as [string, string | null])),
  ];
  for (const [phrase, suggest] of phrases) {
    for (const m of text.matchAll(phraseRe(phrase))) {
      const i = m.index ?? 0;
      out.push(finding("terminology", "prohibited_term", "blocking", `Unapproved term '${m[0]}'.`,
        text.slice(Math.max(0, i - 30), i + m[0].length + 30).trim(), section, suggest));
    }
  }
  for (const [abbr, cfg] of Object.entries(d.abbreviations)) {
    if (cfg.enabled) continue;
    for (const m of text.matchAll(new RegExp(String.raw`\b${esc(abbr)}s?\b`, "g"))) {
      const i = m.index ?? 0;
      out.push(finding("terminology", "unapproved_abbreviation", "blocking", `Abbreviation '${abbr}' is not enabled.`,
        text.slice(Math.max(0, i - 30), i + m[0].length + 30).trim(), section, `Use plain language: ${cfg.plain}`));
    }
  }
  return out;
}

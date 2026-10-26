// Deterministic wording checks run on every report before it is saved.
// Analytical phrases ("selling pressure", "short-term", "inflation target") are neutralised first so
// they never trigger; anything left that reads as trading advice or banned jargon is reported.

const EXEMPT = new RegExp([
  "selling pressure", "buying pressure", "sell-?off", "selloffs?", "buying interest", "selling interest",
  "safe-haven (?:buying|demand|flows?)", "short-term", "long-term", "short-dated", "long-dated", "short-end", "long-end",
  "inflation target", "target band", "target range", "policy target", "buyers", "sellers", "long run", "short run",
  "in the long", "in the short",
].join("|"), "gi");

const CUR = String.raw`(?:the\s+)?(?:pair|dips?|rall(?:y|ies)|bounces?|breaks?|breakouts?|retests?|pullbacks?|now|here|above|below|at|into|on|from|if|when|after|gbp|eur|aud|nzd|usd|chf|gold|xau|dxy|[a-z]{3}/[a-z]{3}|\d)`;

const ADVICE: [string, RegExp][] = [
  ["buy/sell instruction", new RegExp(String.raw`\b(?:buy|sell)(?:ing)?\s+${CUR}`, "gi")],
  ["imperative", /(?:^|[.!?]\s+|\n\s*[-*]?\s*)(?:buy|sell|go long|go short|short|long|enter|exit)\b(?![- ]term)/gim],
  ["position direction", /\bgo(?:ing)?\s+(?:long|short)\b|\b(?:long|short)\s+(?:positions?|trades?|entr(?:y|ies)|setups?)\b|\b(?:longs|shorts)\b/gi],
  ["entry", /\benter(?:ing)?\s+(?:a\s+|the\s+)?(?:trade|position|long|short|market)\b|\bentr(?:y|ies)\b/gi],
  ["stop loss", /\bstop[- ]?loss(?:es)?\b|\bstops?\s+(?:below|above|at|under|beyond)\b|\bplace\s+(?:your|a|the)\s+stop\b/gi],
  ["stop loss (SL)", /\bSL\b/g],
  ["take profit / target", /\btake[- ]?profits?\b|\bprofit targets?\b|\b(?:first|next|initial|second|third|upside|downside|price)\s+targets?\b|\btargets?\s+(?:of\s+|at\s+|near\s+|toward\s+|towards\s+)?\d/gi],
  ["take profit (TP)", /\bTP\d?\b/g],
  ["price objective", /\bopens?\s+(?:the\s+)?(?:room|door|way|path)\s+(?:to|toward|towards)\b|\broom\s+(?:to|toward|towards)\s+\d/gi],
  ["position sizing", /\bposition[- ]siz\w*|\blot sizes?\b|\b(?:use|increase|reduce|add)\s+leverage\b|\bper\s+trade\b/gi],
  ["risk/reward", /\brisk[ -/]?(?:to[ -])?reward\b|\bR:R\b|\b1\s*:\s*[1-9]\b/gi],
  ["order type", /\b(?:limit|stop|market|pending)\s+orders?\b|\b(?:buy|sell)[- ](?:stop|limit)s?\b/gi],
  ["setup language", /\b(?:best|good|great|ideal|high[- ]probability)\s+(?:trade|opportunit(?:y|ies)|setups?|entr(?:y|ies))\b|\bset-?ups?\b|\btrad(?:e|ing)\s+plans?\b/gi],
  ["instruction to reader", /\bwait\s+for\b|\bwatch\s+(?:for|the|this|how|whether)\b|\bkeep\s+an\s+eye\s+on\b|\b(?:you|traders|readers)\s+(?:should|could|might want to|may want to|need to|must)\b|\b(?:avoid|consider)\s+(?:longs?|shorts?|buying|selling|trading|entering|chasing)\b/gi],
  ["promises", /\bprofitable\b|\bguarantee(?:d|s)?\b|\bwin[- ]?rates?\b|\bwinning\s+trades?\b|\brisk[- ]free\b/gi],
  ["participation", /\b(?:join|ride|catch|chase)\s+(?:the\s+)?(?:move|trend|rally|breakout|wave)\b|\bdon'?t\s+miss\b/gi],
];

const BANNED_TERMS = [
  "smart money", "institutional manipulation", "liquidity grab", "liquidity hunt", "liquidity sweep", "stop hunt",
  "order block", "fair value gap", "imbalance", "mitigation block", "breaker block", "inducement", "premium array",
  "discount array", "kill zone", "killzone", "sniper entry", "institutional footprint", "guaranteed setup", "market makers",
];
const BANNED_ABBREVIATIONS = ["BOS", "CHoCH", "MSS", "FVG"];

export interface Finding { kind: "advice" | "terminology"; what: string; excerpt: string }

function excerpt(text: string, i: number, len: number): string {
  return text.slice(Math.max(0, i - 40), i + len + 40).replace(/\s+/g, " ").trim();
}

export function checkReport(text: string): Finding[] {
  const clean = text.replace(EXEMPT, (m) => "·".repeat(m.length));
  const out: Finding[] = [];
  for (const [what, rx] of ADVICE) {
    for (const m of clean.matchAll(rx)) out.push({ kind: "advice", what, excerpt: excerpt(text, m.index ?? 0, m[0].length) });
  }
  for (const term of BANNED_TERMS) {
    const rx = new RegExp(String.raw`\b${term.replace(/[-\s]+/g, String.raw`[\s-]+`)}s?\b`, "gi");
    for (const m of text.matchAll(rx)) out.push({ kind: "terminology", what: `unapproved term "${m[0]}"`, excerpt: excerpt(text, m.index ?? 0, m[0].length) });
  }
  for (const abbr of BANNED_ABBREVIATIONS) {
    for (const m of text.matchAll(new RegExp(String.raw`\b${abbr}s?\b`, "g"))) {
      out.push({ kind: "terminology", what: `abbreviation "${abbr}"`, excerpt: excerpt(text, m.index ?? 0, m[0].length) });
    }
  }
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.what + f.excerpt) && seen.add(f.what + f.excerpt));
}

// Deterministic detection of trading advice: the hard floor under the semantic review.
// Analytical phrases ("selling pressure", "short-term", "inflation target") are neutralised first, so they
// never trigger; anything left that reads as an instruction, a trade or a price objective is blocking.

export interface Finding {
  check: string;      // advice | terminology | factual | integrity | continuity | style | data | outlook | semantic
  category: string;
  severity: "blocking" | "warning" | "info";
  message: string;
  excerpt: string;
  section: string | null;
  suggestion: string | null;
}

export const finding = (check: string, category: string, severity: Finding["severity"], message: string,
  excerpt = "", section: string | null = null, suggestion: string | null = null): Finding =>
  ({ check, category, severity, message, excerpt, section, suggestion });

const EXEMPT = new RegExp([
  "selling pressure", "buying pressure", "sell-?off", "selloffs?", "buying interest", "selling interest",
  "safe-haven (?:buying|demand|flows?)", "short-term", "long-term", "short-dated", "long-dated", "short-end", "long-end",
  "inflation target", "target band", "target range", "policy target", "(?:fed|ecb|rbnz|rba|boe|snb)'s target",
  "buyers", "sellers", "long run", "short run", "in the long", "in the short",
].join("|"), "gi");

const CUR = String.raw`(?:the\s+)?(?:pair|dips?|rall(?:y|ies)|bounces?|breaks?|breakouts?|retests?|pullbacks?|now|here|above|below|at|into|on|from|if|when|after|gbp|eur|aud|nzd|usd|chf|gold|xau|nas100|dxy|[a-z]{3}/[a-z]{3}|\d)`;

const RULES: [string, RegExp, string][] = [
  ["buy_sell_instruction", new RegExp(String.raw`\b(?:buy|sell)(?:ing)?\s+${CUR}`, "gi"), "Describe what a move would mean, e.g. 'a sustained move above X would strengthen the upward interpretation'."],
  ["imperative", /(?:^|[.!?]\s+|\n\s*[-*]?\s*)(?:buy|sell|go long|go short|short|long|enter|exit|close)\b(?![- ]term)/gim, "Remove the instruction; describe the analytical condition."],
  ["position_direction", /\bgo(?:ing)?\s+(?:long|short)\b|\b(?:long|short)\s+(?:positions?|trades?|entr(?:y|ies)|setups?|bias trades?)\b|\b(?:longs|shorts)\b/gi, "Use 'upward lean' / 'downward lean'."],
  ["entry", /\benter(?:ing)?\s+(?:a\s+|the\s+)?(?:trade|position|long|short|market)\b|\bentr(?:y|ies)\b/gi, "Remove entry language."],
  ["stop_loss", /\bstop[- ]?loss(?:es)?\b|\bstops?\s+(?:below|above|at|under|beyond)\b|\bplace\s+(?:your|a|the)\s+stop\b/gi, "Remove stop instructions."],
  ["take_profit", /\btake[- ]?profits?\b|\bprofit targets?\b|\b(?:first|next|initial|second|third|upside|downside|price)\s+targets?\b|\btargets?\s+(?:of\s+|at\s+|near\s+|toward\s+|towards\s+)?\d|\btarget(?:ing|s)?\s+(?:the\s+)?\d/gi, "Say 'the next previously identified resistance/support area is near X'."],
  ["objective_language", /\bopens?\s+(?:the\s+)?(?:room|door|way|path)\s+(?:to|toward|towards)\b|\broom\s+(?:to|toward|towards)\s+\d/gi, "Say 'the next previously identified area is near X'."],
  ["position_sizing", /\bposition[- ]siz\w*|\blot sizes?\b|\b(?:use|increase|reduce|add)\s+leverage\b|\brisk\s+(?:\d+|one|two)\s*%|\bper\s+trade\b/gi, "Remove position-sizing guidance."],
  ["risk_reward", /\brisk[ -/]?(?:to[ -])?reward\b|\bR:R\b|\b1\s*:\s*[1-9]\b/gi, "Remove risk/reward framing."],
  ["order_type", /\b(?:limit|stop|market|pending)\s+orders?\b|\b(?:buy|sell)[- ](?:stop|limit)s?\b/gi, "Remove order instructions."],
  ["setup_language", /\b(?:best|good|great|ideal|high[- ]probability|a[- ]\+?)\s+(?:trade|opportunit(?:y|ies)|setups?|entr(?:y|ies))\b|\bset-?ups?\b|\btrade\s+(?:idea|plan)s?\b|\btrading\s+plans?\b/gi, "Remove trade-setup language."],
  ["reader_instruction", /\bwait\s+for\b|\bwatch\s+(?:for|the|this|how|whether)\b|\bkeep\s+an\s+eye\s+on\b|\b(?:you|traders|readers)\s+(?:should|could|might want to|may want to|need to|must)\b|\b(?:avoid|consider)\s+(?:longs?|shorts?|buying|selling|trading|entering|chasing)\b|\bdon'?t\s+(?:chase|fade|buy|sell)\b|\bfade\s+(?:the|this|rall|dips?)/gi, "Replace with descriptive wording, e.g. 'X is the main scheduled test of this interpretation'."],
  ["promises", /\bprofitable\b|\bguarantee(?:d|s)?\b|\bwin[- ]?rates?\b|\bwinning\s+trades?\b|\bpips?\s+(?:gained|profit|won)\b|\beasy\s+money\b|\brisk[- ]free\b/gi, "Remove profitability claims."],
  ["participation", /\b(?:join|ride|catch|chase)\s+(?:the\s+)?(?:move|trend|rally|breakout|wave)\b|\bdon'?t\s+miss\b|\bget\s+in\b/gi, "Remove encouragement to participate."],
  // Abbreviations that are only advice in capitals: matched case-sensitively.
  ["stop_loss", /\bSL\b/g, "Remove stop instructions."],
  ["take_profit", /\bTP\d?\b/g, "Remove take-profit language."],
  ["risk_reward", /\bRR\b/g, "Remove risk/reward framing."],
];

export function detectAdvice(text: string, section: string | null = null): Finding[] {
  const clean = text.replace(EXEMPT, (m) => "·".repeat(m.length));
  const out: Finding[] = [];
  for (const [cat, rx, sug] of RULES) {
    for (const m of clean.matchAll(rx)) {
      const i = m.index ?? 0;
      out.push(finding("advice", cat, "blocking", `Trading-advice language (${cat.replace(/_/g, " ")}).`,
        text.slice(Math.max(0, i - 40), i + m[0].length + 40).replace(/\s+/g, " ").trim(), section, sug));
    }
  }
  return out;
}

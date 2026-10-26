"""Deterministic detection of trading advice. Context-aware: analytical phrases such as
"selling pressure" or "short-term" are neutralised before matching, so they never trigger.
A semantic review (content/semantic.py) runs in addition; this layer is the hard floor."""
from __future__ import annotations

import re
from dataclasses import dataclass

# Phrases that describe market behaviour and must not be read as instructions.
EXEMPT = [
    r"selling pressure", r"buying pressure", r"sell-?off", r"selloffs?", r"buying interest", r"selling interest",
    r"safe-haven (?:buying|demand|flows?)", r"short-term", r"long-term", r"short-dated", r"long-dated",
    r"short-end", r"long-end", r"inflation target", r"target band", r"target range", r"policy target",
    r"(?:fed|ecb|rbnz|rba|boe|snb)'s target", r"buyers", r"sellers", r"long run", r"short run",
    r"in the long", r"in the short",
]
_EXEMPT_RE = re.compile("|".join(EXEMPT), re.I)

_CUR = r"(?:the\s+)?(?:pair|dips?|rall(?:y|ies)|bounces?|breaks?|breakouts?|retests?|pullbacks?|now|here|above|below|at|into|on|from|if|when|after|gbp|eur|aud|nzd|usd|chf|gold|xau|nas100|dxy|[a-z]{3}/[a-z]{3}|\d)"

RULES: list[tuple[str, str, str]] = [
    # (category, pattern, suggestion)
    ("buy_sell_instruction", rf"\b(?:buy|sell)(?:ing)?\s+{_CUR}", "Describe what a move would mean, e.g. 'a sustained move above X would strengthen the upward interpretation'."),
    ("imperative", r"(?:^|[.!?]\s+|\n\s*[-*]?\s*)(?:buy|sell|go long|go short|short|long|enter|exit|close)\b(?![- ]term)", "Remove the instruction; describe the analytical condition."),
    ("position_direction", r"\bgo(?:ing)?\s+(?:long|short)\b|\b(?:long|short)\s+(?:positions?|trades?|entr(?:y|ies)|setups?|bias trades?)\b|\b(?:longs|shorts)\b", "Use 'upward lean' / 'downward lean'."),
    ("entry", r"\benter(?:ing)?\s+(?:a\s+|the\s+)?(?:trade|position|long|short|market)\b|\bentr(?:y|ies)\b", "Remove entry language."),
    ("stop_loss", r"\bstop[- ]?loss(?:es)?\b|\bstops?\s+(?:below|above|at|under|beyond)\b|\bplace\s+(?:your|a|the)\s+stop\b", "Remove stop instructions."),
    ("take_profit", r"\btake[- ]?profits?\b|\bprofit targets?\b|\b(?:first|next|initial|second|third|upside|downside|price)\s+targets?\b|\btargets?\s+(?:of\s+|at\s+|near\s+|toward\s+|towards\s+)?\d|\btarget(?:ing|s)?\s+(?:the\s+)?\d", "Say 'the next previously identified resistance/support area is near X'."),
    ("objective_language", r"\bopens?\s+(?:the\s+)?(?:room|door|way|path)\s+(?:to|toward|towards)\b|\broom\s+(?:to|toward|towards)\s+\d", "Say 'the next previously identified area is near X'."),
    ("position_sizing", r"\bposition[- ]siz\w*|\blot sizes?\b|\b(?:use|increase|reduce|add)\s+leverage\b|\brisk\s+(?:\d+|one|two)\s*%|\bper\s+trade\b", "Remove position-sizing guidance."),
    ("risk_reward", r"\brisk[ -/]?(?:to[ -])?reward\b|\bR:R\b|\b1\s*:\s*[1-9]\b", "Remove risk/reward framing."),
    ("order_type", r"\b(?:limit|stop|market|pending)\s+orders?\b|\b(?:buy|sell)[- ](?:stop|limit)s?\b", "Remove order instructions."),
    ("setup_language", r"\b(?:best|good|great|ideal|high[- ]probability|a[- ]\+?)\s+(?:trade|opportunit(?:y|ies)|setups?|entr(?:y|ies))\b|\bset-?ups?\b|\btrade\s+(?:idea|plan)s?\b|\btrading\s+plan\b", "Remove trade-setup language."),
    ("reader_instruction", r"\bwait\s+for\b|\bwatch\s+(?:for|the|this|how|whether)\b|\bkeep\s+an\s+eye\s+on\b|\b(?:you|traders|readers)\s+(?:should|could|might want to|may want to|need to|must)\b|\b(?:avoid|consider)\s+(?:longs?|shorts?|buying|selling|trading|entering|chasing)\b|\bdon'?t\s+(?:chase|fade|buy|sell)\b|\bfade\s+(?:the|this|rall|dips?)", "Replace with descriptive wording, e.g. 'X is the main scheduled test of this interpretation'."),
    ("promises", r"\bprofitable\b|\bguarantee(?:d|s)?\b|\bwin[- ]?rates?\b|\bwinning\s+trades?\b|\bpips?\s+(?:gained|profit|won)\b|\beasy\s+money\b|\brisk[- ]free\b", "Remove profitability claims."),
    ("participation", r"\b(?:join|ride|catch|chase)\s+(?:the\s+)?(?:move|trend|rally|breakout|wave)\b|\bdon'?t\s+miss\b|\bget\s+in\b", "Remove encouragement to participate."),
]
_COMPILED = [(c, re.compile(p, re.I | re.M), s) for c, p, s in RULES]
# Abbreviations that are only advice in capitals (SL/TP/RR); matched case-sensitively.
_COMPILED += [(c, re.compile(p), s) for c, p, s in [
    ("stop_loss", r"\bSL\b", "Remove stop instructions."),
    ("take_profit", r"\bTP\d?\b", "Remove take-profit language."),
    ("risk_reward", r"\bRR\b", "Remove risk/reward framing."),
]]


@dataclass(frozen=True)
class Finding:
    check: str
    category: str
    severity: str        # blocking | warning | info
    message: str
    excerpt: str = ""
    section: str | None = None
    suggestion: str | None = None


def _neutralise(text: str) -> str:
    return _EXEMPT_RE.sub(lambda m: "·" * len(m.group(0)), text)


def detect_advice(text: str, section: str | None = None) -> list[Finding]:
    clean = _neutralise(text)
    out: list[Finding] = []
    for cat, rx, sug in _COMPILED:
        for m in rx.finditer(clean):
            a, b = max(0, m.start() - 40), min(len(text), m.end() + 40)
            out.append(Finding("advice", cat, "blocking", f"Trading-advice language ({cat.replace('_', ' ')}).",
                               text[a:b].replace("\n", " ").strip(), section, sug))
    return out

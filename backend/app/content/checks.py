"""Pre-publication checks. Deterministic checks run first; the semantic review is layered on top.

Checks operate on the model-written sections and the exact fact bundle the text was written from.
Citations look like [F3], [L2], [E5]; every number in prose must trace to a cited bundle value.
"""
from __future__ import annotations

import re
from dataclasses import asdict
from decimal import Decimal, InvalidOperation

from .advice import Finding, detect_advice
from .terminology import Dictionary, detect_terms

CITE_RE = re.compile(r"\[((?:[FLEP]\d+)(?:\s*,\s*[FLEP]\d+)*)\]")
NUM_RE = re.compile(r"(?<![\w.])[-+−]?\d+(?:[.,]\d+)?(?:\s?(?:%|bp|bps|K|M|B|T))?(?![\w])")
# Tokens that look numeric but are not factual claims.
IGNORE_RE = re.compile(r"\b(?:H1|H4|D1|W1|M15|M30|1H|4H|1D|1W|Q[1-4]|G7|G10|G20|S&P\s?500|NAS100|Nasdaq-100|"
                       r"(?:[FLEP]\d+))\b", re.I)
TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\b")
SENT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])|\n+")

SURPRISE_WORDS = re.compile(r"\b(?:surpris\w*|unexpected\w*|beat|beats|missed|misses|shock\w*|"
                            r"above (?:expectations|forecasts?|consensus)|below (?:expectations|forecasts?|consensus)|"
                            r"stronger[- ]than[- ]expected|weaker[- ]than[- ]expected|hotter|softer|cooler)\b", re.I)
SUSTAINED_WORDS = re.compile(r"\b(?:sustained|confirmed|decisive|clean)\s+(?:break|move|close)", re.I)
CAUSAL_WORDS = re.compile(r"\b(?:because of|due to|driven by|caused by|as a result of|triggered by|on the back of|"
                          r"thanks to|led to|sparked)\b", re.I)
RELEASED_WORDS = re.compile(r"\b(?:came in|printed|was reported at|was released at|rose to|fell to|"
                            r"increased to|decreased to|showed)\b", re.I)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in SENT_RE.split(text) if s.strip()]


def _norm(x: str) -> Decimal | None:
    x = x.replace("−", "-").replace(",", ".").strip()
    x = re.sub(r"\s?(?:%|bp|bps|K|M|B|T)$", "", x)
    try:
        return Decimal(x.lstrip("+"))
    except InvalidOperation:
        return None


def _matches(token: str, allowed: set[Decimal], min_round_decimals: int) -> bool:
    v = _norm(token)
    if v is None:
        return True
    if v in allowed or -v in allowed:
        return True
    shown = -v.as_tuple().exponent if v.as_tuple().exponent < 0 else 0
    if shown >= min_round_decimals:
        q = Decimal(1).scaleb(-shown)
        return any(a.quantize(q) == v for a in allowed if a == a)
    return False


def citable(bundle: dict) -> dict[str, dict]:
    out = {}
    for group in ("facts", "levels", "events", "policy"):
        out.update(bundle.get(group, {}))
    return out


def allowed_numbers(items: list[dict]) -> set[Decimal]:
    out: set[Decimal] = set()
    for it in items:
        for v in it.get("values", []):
            if v is None:
                continue
            d = _norm(str(v))
            if d is not None:
                out.add(d)
        for t in list(it.get("numbers_in_text", [])) + NUM_RE.findall(TIME_RE.sub(" ", it.get("text", ""))):
            d = _norm(str(t))
            if d is not None:
                out.add(d)
    return out


def check_citations_and_numbers(sections: dict[str, str], bundle: dict, price_decimals: int) -> list[Finding]:
    items = citable(bundle)
    meta = bundle.get("meta", {})
    global_allowed = allowed_numbers([{"values": meta.get("calendar_numbers", [])}])
    allowed_times = set(meta.get("allowed_times", []))
    out: list[Finding] = []
    for key, text in sections.items():
        for sent in split_sentences(text):
            cited = [c.strip() for grp in CITE_RE.findall(sent) for c in grp.split(",")]
            for c in cited:
                if c not in items:
                    out.append(Finding("factual", "unknown_citation", "blocking", f"Citation [{c}] is not in the fact bundle.",
                                       sent[:160], key))
            body = IGNORE_RE.sub(" ", CITE_RE.sub(" ", sent))
            cited_times = {t for c in cited if c in items for t in TIME_RE.findall(items[c].get("text", ""))}
            for t in TIME_RE.findall(body):
                if t not in allowed_times and t not in cited_times:
                    out.append(Finding("factual", "unsupported_time", "blocking",
                                       f"Time '{t}' does not match any event or report time in the bundle.", sent[:160], key))
            body = TIME_RE.sub(" ", body)
            body = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", body)  # ISO dates (report keys) are not figures
            nums = [m.group(0) for m in NUM_RE.finditer(body)]
            # Single digits (counts such as "2 closes") and calendar numbers from the report period need no citation.
            nums = [n for n in nums if not re.fullmatch(r"[1-9]", n.strip()) and _norm(n) not in global_allowed]
            if not nums:
                continue
            if not cited:
                out.append(Finding("factual", "missing_citation", "blocking",
                                   "Sentence states figures without citing a fact.", sent[:160], key))
                continue
            allowed = allowed_numbers([items[c] for c in cited if c in items])
            for n in nums:
                if not _matches(n, allowed, max(2, price_decimals - 1)):
                    out.append(Finding("factual", "unsupported_number", "blocking",
                                       f"'{n.strip()}' does not match any value in the cited facts {cited}.", sent[:160], key))
    return out


def check_integrity(sections: dict[str, str], bundle: dict) -> list[Finding]:
    items = citable(bundle)
    out: list[Finding] = []
    for key, text in sections.items():
        for sent in split_sentences(text):
            cited = [c.strip() for grp in CITE_RE.findall(sent) for c in grp.split(",")]
            cited_items = [items[c] for c in cited if c in items]
            events = [i for i in cited_items if i.get("kind") == "event"]
            levels = [i for i in cited_items if i.get("kind") == "level"]
            if SURPRISE_WORDS.search(sent):
                for e in events:
                    if e.get("surprise") == "in line with consensus":
                        out.append(Finding("integrity", "inline_as_surprise", "blocking",
                                           f"{e.get('title')} was in line with consensus but is described as a surprise.", sent[:160], key))
                    if e.get("state") not in ("released", "revised"):
                        out.append(Finding("integrity", "unverified_result", "blocking",
                                           f"{e.get('title')} has no verified actual (state: {e.get('state')}).", sent[:160], key))
            if RELEASED_WORDS.search(sent):
                for e in events:
                    if e.get("state") not in ("released", "revised"):
                        out.append(Finding("integrity", "unverified_result", "blocking",
                                           f"{e.get('title')} is described as released but its actual is not verified.", sent[:160], key))
            if SUSTAINED_WORDS.search(sent) and not re.search(r"\b(?:would|could|if|unless|until|without|not|no)\b", sent, re.I):
                if levels and not any(l.get("break_confirmed") for l in levels):
                    out.append(Finding("integrity", "unconfirmed_sustained_break", "blocking",
                                       "Sentence describes a sustained/confirmed break that the break rules did not confirm.", sent[:160], key))
            if CAUSAL_WORDS.search(sent) and not any(i.get("kind") in ("news", "policy", "event") for i in cited_items):
                out.append(Finding("integrity", "causal_claim_without_evidence", "warning",
                                   "Causal wording without a cited news, policy or release fact; consider 'coincided with'.", sent[:160], key))
            if re.search(r"\b\d+(?:\.\d+)?\s?%\s+(?:chance|probability|likelihood|odds)\b", sent, re.I) and \
                    not any(i.get("kind") in ("pricing",) for i in cited_items):
                out.append(Finding("integrity", "arbitrary_probability", "blocking",
                                   "Probability stated without a sourced market-pricing fact.", sent[:160], key))
    return out


def check_continuity(sections: dict[str, str], bundle: dict) -> list[Finding]:
    """Text must not restate earlier outlooks differently from the stored published versions."""
    cont = bundle.get("continuity", {})
    out: list[Finding] = []
    weekly = cont.get("weekly")
    text = "\n".join(sections.values())
    labels = {"upward_lean": "upward", "downward_lean": "downward", "neutral": "neutral", "range_bound": "range"}
    m = re.search(r"\b(?:weekly|initial weekly|original weekly)\s+(?:bias|outlook|view|thesis)\s+(?:was|is|remains|had been)\s+(?:an?\s+)?(\w+)", text, re.I)
    if m:
        said = m.group(1).lower()
        if weekly is None:
            out.append(Finding("continuity", "invented_weekly_outlook", "blocking",
                               "Text refers to a weekly outlook but none was published.", m.group(0)))
        else:
            want = labels.get(weekly["direction"], weekly["direction"])
            synonyms = {"upward": {"upward", "bullish", "positive"}, "downward": {"downward", "bearish", "negative"},
                        "neutral": {"neutral", "mixed"}, "range": {"range", "range-bound", "neutral"}}
            if said not in synonyms.get(want, {want}):
                out.append(Finding("continuity", "misstated_prior_bias", "blocking",
                                   f"Weekly outlook is stored as '{weekly['direction']}', text says '{said}'.", m.group(0)))
    return out


def check_direction_claims(sections: dict[str, str], bundle: dict) -> list[Finding]:
    """For reviews: '<PAIR> rose/fell' must agree with the computed session movement."""
    ev = bundle.get("evaluation") or {}
    actual = ev.get("session_direction")
    if not actual:
        return []
    disp = re.escape(bundle["meta"]["display"].split(" ")[0])
    out = []
    for key, text in sections.items():
        for m in re.finditer(rf"{disp}\s+(rose|fell|gained|declined|dropped|climbed|consolidated|was little changed)", text, re.I):
            word = m.group(1).lower()
            said = "rose" if word in ("rose", "gained", "climbed") else "fell" if word in ("fell", "declined", "dropped") else "consolidated"
            if said != actual:
                out.append(Finding("factual", "wrong_direction", "blocking",
                                   f"Text says the instrument {said}; session data shows it {actual}.", m.group(0), key))
    return out


def check_length(sections: dict[str, str], bounds: tuple[int, int] | None) -> list[Finding]:
    if not bounds:
        return []
    n = sum(len(CITE_RE.sub("", t).split()) for t in sections.values())
    lo, hi = bounds
    if n < lo * 0.8 or n > hi * 1.15:
        return [Finding("style", "length", "warning", f"Body is {n} words; configured range is {lo}-{hi}.")]
    return []


def check_data_warnings(bundle: dict) -> list[Finding]:
    out = []
    for w in bundle.get("warnings", []):
        sev = "blocking" if w["severity"] == "blocking" else "warning" if w["severity"] == "warning" else "info"
        out.append(Finding("data", w["code"], sev, w["message"]))
    for m in bundle.get("missing", []):
        out.append(Finding("data", "missing_essential", "blocking", m))
    return out


def run_deterministic(sections: dict[str, str], bundle: dict, dictionary: Dictionary,
                      length_bounds: tuple[int, int] | None, price_decimals: int) -> list[Finding]:
    findings: list[Finding] = []
    for key, text in sections.items():
        findings += detect_advice(text, key)
        findings += detect_terms(text, dictionary, key)
    findings += check_citations_and_numbers(sections, bundle, price_decimals)
    findings += check_integrity(sections, bundle)
    findings += check_continuity(sections, bundle)
    findings += check_direction_claims(sections, bundle)
    findings += check_length(sections, length_bounds)
    findings += check_data_warnings(bundle)
    seen, uniq = set(), []
    for f in findings:
        k = (f.check, f.category, f.excerpt, f.section)
        if k not in seen:
            seen.add(k)
            uniq.append(f)
    return uniq


def summarize(findings: list[Finding]) -> dict:
    return {
        "blocking": sum(f.severity == "blocking" for f in findings),
        "warnings": sum(f.severity == "warning" for f in findings),
        "findings": [asdict(f) for f in findings],
    }

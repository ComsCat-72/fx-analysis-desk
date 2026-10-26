"""User-controlled terminology dictionary and prohibited-term detection."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .advice import Finding


@dataclass
class Dictionary:
    approved: list[dict] = field(default_factory=list)
    prohibited: list[dict] = field(default_factory=list)
    abbreviations: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, yaml_cfg: dict, db_terms: list | None = None) -> "Dictionary":
        d = cls(list(yaml_cfg.get("approved", [])), list(yaml_cfg.get("prohibited", [])),
                dict(yaml_cfg.get("abbreviations", {})))
        for t in db_terms or []:
            if t.kind == "approved":
                d.approved.append({"term": t.term, "definition": t.definition, "alternatives": t.alternatives,
                                   "prohibited_alternatives": t.prohibited_alternatives})
                # An explicitly approved term is removed from the prohibited list.
                d.prohibited = [p for p in d.prohibited if p["phrase"].lower() != t.term.lower()]
            elif t.kind == "prohibited" and t.enabled:
                d.prohibited.append({"phrase": t.term, "suggest": t.suggest})
            elif t.kind == "abbreviation":
                d.abbreviations[t.term] = {"enabled": t.enabled, "plain": t.definition}
        return d

    def prohibited_phrases(self) -> list[tuple[str, str | None]]:
        out = [(p["phrase"], p.get("suggest")) for p in self.prohibited]
        for a in self.approved:
            out += [(x, f"use '{a['term']}'") for x in a.get("prohibited_alternatives") or []]
        return out


def _phrase_re(phrase: str) -> re.Pattern:
    parts = [re.escape(p) for p in re.split(r"[\s\-]+", phrase.strip())]
    return re.compile(r"\b" + r"[\s\-]+".join(parts) + r"s?\b", re.I)


def detect_terms(text: str, d: Dictionary, section: str | None = None) -> list[Finding]:
    out = []
    for phrase, suggest in d.prohibited_phrases():
        for m in _phrase_re(phrase).finditer(text):
            out.append(Finding("terminology", "prohibited_term", "blocking", f"Unapproved term '{m.group(0)}'.",
                               text[max(0, m.start() - 30):m.end() + 30].strip(), section, suggest))
    for abbr, cfg in d.abbreviations.items():
        if cfg.get("enabled"):
            continue
        for m in re.finditer(rf"\b{re.escape(abbr)}s?\b", text):
            out.append(Finding("terminology", "unapproved_abbreviation", "blocking",
                               f"Abbreviation '{abbr}' is not enabled.",
                               text[max(0, m.start() - 30):m.end() + 30].strip(), section,
                               f"Use plain language: {cfg.get('plain')}"))
    return out

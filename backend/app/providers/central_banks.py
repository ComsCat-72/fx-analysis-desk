"""Central-bank press releases and speeches from official RSS/Atom feeds.

Feed URLs change occasionally; they are configurable and must be verified once network access to the
banks' sites is available (this build could not reach them).
"""
from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser

from .base import HttpClient, PolicyItemIn, PolicyProvider, ProviderError

DEFAULT_FEEDS = {
    "fed": {"currency": "USD", "feeds": {
        "press": "https://www.federalreserve.gov/feeds/press_all.xml",
        "speech": "https://www.federalreserve.gov/feeds/speeches.xml"}},
    "ecb": {"currency": "EUR", "feeds": {"press": "https://www.ecb.europa.eu/rss/press.html"}},
    "boe": {"currency": "GBP", "feeds": {"press": "https://www.bankofengland.co.uk/rss/news"}},
    "rba": {"currency": "AUD", "feeds": {"press": "https://www.rba.gov.au/rss/rss-cb-media-releases.xml"}},
    "rbnz": {"currency": "NZD", "feeds": {"press": "https://www.rbnz.govt.nz/feeds/news"}},
    "snb": {"currency": "CHF", "feeds": {"press": "https://www.snb.ch/public/en/rss/pressrel"}},
}

_DECISION_WORDS = ("monetary policy decision", "policy decision", "official cash rate", "rate decision",
                   "fomc statement", "monetary policy statement", "bank rate")


def classify(kind_hint: str, title: str) -> str:
    t = title.lower()
    if any(w in t for w in _DECISION_WORDS):
        return "decision"
    if kind_hint == "speech" or "speech" in t or "remarks" in t:
        return "speech"
    if "minutes" in t:
        return "minutes"
    return "press"


def _entry_time(e) -> datetime | None:
    for key in ("published", "updated"):
        if e.get(key):
            try:
                dt = parsedate_to_datetime(e[key])
            except (TypeError, ValueError):
                try:
                    dt = datetime.fromisoformat(e[key])
                except ValueError:
                    continue
            if dt.tzinfo is None:
                return None  # unknown zone: do not guess
            return dt.astimezone(timezone.utc)
    return None


def parse_feed(bank: str, currency: str, kind_hint: str, content: bytes, source_url: str) -> list[PolicyItemIn]:
    feed = feedparser.parse(content)
    out = []
    for e in feed.entries:
        ts = _entry_time(e)
        if ts is None:
            continue
        title = (e.get("title") or "").strip()
        out.append(PolicyItemIn(bank=bank, currency=currency, kind=classify(kind_hint, title), title=title,
                                url=e.get("link"), published_at=ts, summary=(e.get("summary") or "")[:2000] or None,
                                source=source_url, speaker=e.get("author")))
    return out


class CentralBankFeeds(PolicyProvider):
    name = "central_bank_rss"

    def __init__(self, banks: list[str], feeds: dict | None = None, transport=None):
        self.cfg = {b: (feeds or DEFAULT_FEEDS)[b] for b in banks}
        self.http = HttpClient(min_interval_s=1.0, transport=transport,
                               headers={"User-Agent": "fx-analysis-desk/0.1"})

    def items(self):
        out, errors = [], []
        for bank, c in self.cfg.items():
            for kind, url in c["feeds"].items():
                try:
                    r = self.http.get(url)
                    if r.status_code != 200:
                        errors.append(f"{bank} {kind}: HTTP {r.status_code}")
                        continue
                    out.extend(parse_feed(bank, c["currency"], kind, r.content, url))
                except ProviderError as e:
                    errors.append(f"{bank} {kind}: {e}")
        if errors and not out:
            raise ProviderError("; ".join(errors))
        self.errors = errors
        return out

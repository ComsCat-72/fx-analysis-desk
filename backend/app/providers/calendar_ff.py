"""Economic calendar from the weekly JSON export published by Forex Factory's operator (Fair Economy).

URL: https://nfs.faireconomy.media/ff_calendar_thisweek.json
This export is offered for widgets/embedding. It contains title, currency ("country"), date with UTC
offset, impact, forecast and previous. It does **not** contain actual results, so actuals come from
official sources or manual entry (see providers/actuals.py). The Forex Factory website itself is not
scraped: its terms do not permit automated collection.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from .base import CalendarEventIn, CalendarProvider, HttpClient, ProviderError

FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"


def event_key(currency: str, title: str, source_time_text: str) -> str:
    """Stable across same-day reschedules: currency | title | local calendar date at the source."""
    return f"{currency}|{title}|{source_time_text[:10]}"


def event_id(source: str, key: str) -> str:
    return hashlib.sha256(f"{source}|{key}".encode()).hexdigest()[:32]


def _blank(v):
    v = (v or "").strip() if isinstance(v, str) else v
    return v or None


def parse_feed(rows: list[dict], source: str = "ff_weekly_json") -> list[CalendarEventIn]:
    out = []
    for r in rows:
        if (r.get("impact") or "").lower() == "holiday":
            impact = "Holiday"
        else:
            impact = r.get("impact")
        raw_date = r["date"]
        dt = datetime.fromisoformat(raw_date)
        if dt.tzinfo is None:
            raise ProviderError(f"calendar time without offset: {raw_date}")
        cur = r.get("country", "").upper()
        title = r.get("title", "").strip()
        out.append(CalendarEventIn(
            source=source, source_event_key=event_key(cur, title, raw_date), currency=cur, title=title,
            scheduled_at=dt.astimezone(timezone.utc), source_time_text=raw_date,
            source_timezone=dt.strftime("UTC%z"), impact=impact,
            consensus=_blank(r.get("forecast")), previous=_blank(r.get("previous")),
            actual=_blank(r.get("actual")),
        ))
    return out


class FFWeeklyJsonCalendar(CalendarProvider):
    name = "ff_weekly_json"

    def __init__(self, url: str = FEED_URL, transport=None):
        self.url = url
        # The feed is rate limited; one request per few minutes is plenty.
        self.http = HttpClient(min_interval_s=2.0, transport=transport,
                               headers={"User-Agent": "fx-analysis-desk/0.1 (calendar widget feed)"})

    def week_events(self):
        r = self.http.get(self.url)
        if r.status_code != 200:
            raise ProviderError(f"calendar feed HTTP {r.status_code}")
        return parse_feed(r.json(), self.name)

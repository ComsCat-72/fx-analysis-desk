"""Timezone handling. All storage is UTC-aware; display conversion uses zoneinfo, never fixed offsets."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc


def ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError(f"naive datetime not allowed: {dt!r}")
    return dt


def to_utc(dt: datetime) -> datetime:
    return ensure_aware(dt).astimezone(UTC)


def to_zone(dt: datetime, tz_name: str) -> datetime:
    return ensure_aware(dt).astimezone(ZoneInfo(tz_name))


def localize(d: date, t: time, tz_name: str) -> datetime:
    """Wall-clock time in a zone -> aware datetime (zoneinfo resolves DST)."""
    return datetime.combine(d, t, tzinfo=ZoneInfo(tz_name))


def format_display(dt: datetime, tz_name: str, label: str | None = None, with_date: bool = True) -> str:
    local = to_zone(dt, tz_name)
    fmt = "%a %d %b %Y %H:%M" if with_date else "%H:%M"
    return f"{local.strftime(fmt)} {label or local.tzname()}"


def parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)

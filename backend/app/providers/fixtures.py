"""DEVELOPMENT FIXTURES: synthetic, deterministic data for offline development and tests.

Nothing here is market data. Every record carries is_fixture=True and provider "FIXTURE"; reports
built on it are watermarked and cannot be published when APP_ENV=production. Prices are deliberately
anchored at round synthetic levels (FX pairs near 1.00000) so they cannot be confused with real quotes.
"""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from ..domain.sessions import Candle, SessionDef
from ..domain.validation import Quote
from .base import CalendarEventIn, CalendarProvider, PolicyItemIn, PriceProvider

FIXTURE = "FIXTURE"
EPOCH = datetime(2026, 1, 4, 22, tzinfo=timezone.utc)  # a Sunday evening
BASES = {"XAU_USD": 1000.0, "NAS100": 10000.0, "DXY": 100.0}
VOL = 0.0012  # per-hour volatility (fraction)


def _noise(instrument: str, i: int) -> float:
    h = hashlib.sha256(f"{instrument}:{i}".encode()).digest()
    u1 = (int.from_bytes(h[:8], "big") + 1) / (2 ** 64 + 2)
    u2 = int.from_bytes(h[8:16], "big") / 2 ** 64
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


@lru_cache(maxsize=32)
def _path(instrument: str, n: int) -> tuple[float, ...]:
    base = BASES.get(instrument, 1.0)
    out, p = [], base
    for i in range(n):
        # gentle mean reversion keeps the synthetic path near its base level
        p = p * math.exp(VOL * _noise(instrument, i) - 0.002 * math.log(p / base))
        out.append(p)
    return tuple(out)


def _price(instrument: str, i: int) -> float:
    need = ((i // 2000) + 1) * 2000
    return _path(instrument, need)[i]


class FixturePriceProvider(PriceProvider):
    name = FIXTURE
    is_fixture = True

    def __init__(self, session: SessionDef, decimals: dict[str, int] | None = None):
        self.session = session
        self.decimals = decimals or {}

    def _h1(self, instrument: str, start: datetime) -> Candle:
        i = int((start - EPOCH) / timedelta(hours=1))
        o = _price(instrument, i - 1) if i > 0 else BASES.get(instrument, 1.0)
        c = _price(instrument, i)
        wig = abs(_noise(instrument + ":w", i)) * VOL * 0.6 * o
        d = self.decimals.get(instrument, 5)
        r = lambda x: round(x, d)  # noqa: E731
        return Candle(instrument, "H1", start, start + timedelta(hours=1), r(o), r(max(o, c) + wig),
                      r(min(o, c) - wig), r(c), True, FIXTURE, "M", True)

    def candles(self, symbol, instrument, timeframe, start, end):
        if timeframe != "H1":
            raise ValueError("fixtures provide H1 only; D1/W1 are aggregated deterministically")
        t = start.replace(minute=0, second=0, microsecond=0)
        out = []
        bars = self.session.expected_h1_bars
        while t < end:
            d = self.session.trading_day_of(t)
            # Exchange sessions (e.g. the US cash index) only trade the last N hours before the close.
            if d is not None and (bars is None or self.session.close_at(d) - t <= timedelta(hours=bars)):
                out.append(self._h1(instrument, t))
            t += timedelta(hours=1)
        return out

    def latest_quote(self, symbol, instrument, as_of: datetime | None = None):
        as_of = as_of or datetime.now(timezone.utc)
        t = as_of.replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)
        while self.session.trading_day_of(t) is None:
            t -= timedelta(hours=1)
        c = self._h1(instrument, t)
        return Quote(instrument, c.end, None, None, c.close, FIXTURE, True)


class FixtureCalendar(CalendarProvider):
    """A small synthetic week of events. Titles are prefixed [FIXTURE]."""
    name = FIXTURE
    is_fixture = True

    def __init__(self, monday: datetime):
        self.monday = monday

    def week_events(self):
        def ev(day, hh, mm, cur, title, cons, prev, actual=None, tz="America/New_York"):
            from zoneinfo import ZoneInfo
            local = datetime(self.monday.year, self.monday.month, self.monday.day, hh, mm,
                             tzinfo=ZoneInfo(tz)) + timedelta(days=day)
            txt = local.isoformat()
            return CalendarEventIn(FIXTURE, f"{cur}|{title}|{txt[:10]}", cur, f"[FIXTURE] {title}",
                                   local.astimezone(timezone.utc), txt, tz, "High", cons, prev, actual,
                                   is_fixture=True)
        return [
            ev(1, 7, 0, "GBP", "Synthetic Retail Sales m/m", "0.3%", "0.1%", tz="Europe/London"),
            ev(1, 10, 0, "USD", "Synthetic Consumer Confidence", "100.0", "99.0"),
            ev(2, 8, 30, "USD", "Synthetic GDP q/q", "2.0%", "1.8%"),
            ev(3, 7, 0, "GBP", "Synthetic Policy Rate Decision", "4.00%", "4.00%", tz="Europe/London"),
            ev(4, 8, 30, "USD", "Synthetic Payrolls", "150K", "120K"),
        ]


def fixture_policy_items(monday: datetime) -> list[PolicyItemIn]:
    return [PolicyItemIn("fixture-cb", "USD", "speech", "[FIXTURE] Synthetic official remarks on inflation",
                         None, monday + timedelta(days=1, hours=15), "Synthetic text for development only.",
                         FIXTURE, "Synthetic Speaker", True)]

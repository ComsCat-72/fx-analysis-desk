"""Session boundaries and deterministic candle aggregation.

A trading day D is the session that *closes* on calendar date D at the configured close time in the
anchor zone (default 17:00 America/New_York). Monday's session opens at Sunday's close time.
A trading week is keyed by its Monday and runs from Sunday close-time to Friday close-time.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta

from .timeutil import localize, parse_hhmm, to_utc, to_zone


@dataclass(frozen=True)
class SessionDef:
    name: str
    anchor_timezone: str
    daily_close: str = "17:00"
    week_open_weekday: int = 6
    week_close_weekday: int = 4
    holidays: frozenset[date] = field(default_factory=frozenset)

    @classmethod
    def from_config(cls, name: str, cfg: dict, holidays: list | None = None) -> "SessionDef":
        return cls(
            name=name,
            anchor_timezone=cfg["anchor_timezone"],
            daily_close=cfg.get("daily_close", "17:00"),
            week_open_weekday=cfg.get("week_open_weekday", 6),
            week_close_weekday=cfg.get("week_close_weekday", 4),
            holidays=frozenset(date.fromisoformat(str(h)) for h in (holidays or [])),
        )

    # --- day boundaries -------------------------------------------------
    def close_at(self, d: date) -> datetime:
        return to_utc(localize(d, parse_hhmm(self.daily_close), self.anchor_timezone))

    def is_weekday_session(self, d: date) -> bool:
        return d.weekday() <= self.week_close_weekday  # Mon..Fri by default

    def is_trading_day(self, d: date) -> bool:
        return self.is_weekday_session(d) and d not in self.holidays

    def day_bounds(self, d: date) -> tuple[datetime, datetime]:
        """[start, end) in UTC for the session closing on d. Monday opens at Sunday's close."""
        if not self.is_weekday_session(d):
            raise ValueError(f"{d} is not a weekday session date")
        return self.close_at(d - timedelta(days=1)), self.close_at(d)

    def trading_day_of(self, ts: datetime) -> date | None:
        """Session date containing ts, or None if ts falls in the weekend gap."""
        ts = to_utc(ts)
        local = to_zone(ts, self.anchor_timezone)
        d = local.date()
        if ts >= self.close_at(d):
            d = d + timedelta(days=1)
        if not self.is_weekday_session(d):
            return None
        start, end = self.day_bounds(d)
        return d if start <= ts < end else None

    # --- week boundaries ------------------------------------------------
    @staticmethod
    def week_monday(d: date) -> date:
        return d - timedelta(days=d.weekday())

    def week_bounds(self, monday: date) -> tuple[datetime, datetime]:
        if monday.weekday() != 0:
            raise ValueError("week key must be a Monday")
        friday = monday + timedelta(days=self.week_close_weekday)
        return self.day_bounds(monday)[0], self.close_at(friday)

    def week_trading_days(self, monday: date) -> list[date]:
        return [monday + timedelta(days=i) for i in range(self.week_close_weekday + 1)
                if self.is_trading_day(monday + timedelta(days=i))]

    def expected_trading_days(self, start: date, end: date) -> list[date]:
        out, d = [], start
        while d <= end:
            if self.is_trading_day(d):
                out.append(d)
            d += timedelta(days=1)
        return out

    def market_open(self, ts: datetime) -> bool:
        d = self.trading_day_of(ts)
        return d is not None and d not in self.holidays


@dataclass(frozen=True)
class Candle:
    instrument: str
    timeframe: str          # H1 | D1 | W1
    start: datetime         # UTC, inclusive
    end: datetime           # UTC, exclusive
    open: float
    high: float
    low: float
    close: float
    complete: bool
    provider: str
    price_component: str = "M"
    is_fixture: bool = False
    volume: float | None = None

    def __post_init__(self):
        if not (self.low <= min(self.open, self.close) and self.high >= max(self.open, self.close)):
            raise ValueError(f"inconsistent OHLC for {self.instrument} {self.timeframe} {self.start}")


class AggregationError(ValueError):
    pass


def _check_homogeneous(candles: list[Candle]) -> None:
    if len({(c.instrument, c.provider, c.price_component, c.is_fixture) for c in candles}) > 1:
        raise AggregationError("refusing to aggregate candles from different instruments/providers/price types")


def aggregate(candles: list[Candle], timeframe: str, start: datetime, end: datetime,
              expected_count: int, as_of: datetime) -> Candle | None:
    """Combine ordered sub-candles inside [start, end) into one candle.

    complete = every expected sub-candle is present and complete, and the period has ended by as_of.
    """
    inside = sorted((c for c in candles if start <= c.start < end), key=lambda c: c.start)
    if not inside:
        return None
    _check_homogeneous(inside)
    complete = (len(inside) == expected_count and all(c.complete for c in inside) and end <= to_utc(as_of))
    first = inside[0]
    return Candle(
        instrument=first.instrument, timeframe=timeframe, start=start, end=end,
        open=first.open, high=max(c.high for c in inside), low=min(c.low for c in inside),
        close=inside[-1].close, complete=complete, provider=first.provider,
        price_component=first.price_component, is_fixture=first.is_fixture,
        volume=sum(c.volume or 0 for c in inside) if any(c.volume is not None for c in inside) else None,
    )


def daily_from_hourly(h1: list[Candle], session: SessionDef, d: date, as_of: datetime) -> Candle | None:
    start, end = session.day_bounds(d)
    expected = int((end - start) / timedelta(hours=1))
    return aggregate(h1, "D1", start, end, expected, as_of)


def weekly_from_daily(d1: list[Candle], session: SessionDef, monday: date, as_of: datetime) -> Candle | None:
    start, end = session.week_bounds(monday)
    days = session.week_trading_days(monday)
    # Daily candles are keyed by their session close date.
    by_close = {session.trading_day_of(c.start): c for c in d1}
    picked = [by_close[d] for d in days if d in by_close]
    agg = aggregate(picked, "W1", start, end, len(days), as_of)
    return agg


def with_completion(c: Candle, as_of: datetime) -> Candle:
    """A provider candle is only complete if its period has actually ended by as_of."""
    return c if (not c.complete or c.end <= to_utc(as_of)) else replace(c, complete=False)

"""Data-quality checks. Each returns warnings; nothing here silently repairs data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from .sessions import Candle, SessionDef
from .timeutil import to_utc


@dataclass(frozen=True)
class Warning_:
    code: str               # stale_quote | incomplete_candle | missing_session | source_conflict | mixed_sources | fixture_data
    severity: str           # info | warning | blocking
    message: str
    context: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Quote:
    instrument: str
    time: datetime
    bid: float | None
    ask: float | None
    mid: float
    provider: str
    is_fixture: bool = False


def check_stale_quote(q: Quote, as_of: datetime, max_age_s: int, session: SessionDef) -> Warning_ | None:
    age = (to_utc(as_of) - to_utc(q.time)).total_seconds()
    if age <= max_age_s:
        return None
    if not session.market_open(as_of):
        # Weekend/holiday: an old quote is expected, but it is still not a live price.
        return Warning_("stale_quote", "info",
                        f"Market closed; latest {q.instrument} quote is from {q.time.isoformat()}.",
                        {"age_seconds": age})
    return Warning_("stale_quote", "blocking",
                    f"{q.instrument} quote is {int(age)}s old (limit {max_age_s}s); not treated as current.",
                    {"age_seconds": age, "quote_time": q.time.isoformat()})


def check_incomplete(candles: list[Candle]) -> list[Warning_]:
    return [Warning_("incomplete_candle", "warning",
                     f"{c.instrument} {c.timeframe} candle starting {c.start.isoformat()} is incomplete; "
                     "its close is not a closing price.", {"start": c.start.isoformat()})
            for c in candles if not c.complete]


def check_missing_sessions(d1: list[Candle], session: SessionDef, start: date, end: date,
                           as_of: datetime) -> list[Warning_]:
    have = {session.trading_day_of(c.start) for c in d1}
    out = []
    for d in session.expected_trading_days(start, end):
        if session.close_at(d) > to_utc(as_of):
            continue  # session not finished yet
        if d not in have:
            out.append(Warning_("missing_session", "blocking",
                                f"No daily candle for trading day {d.isoformat()}.", {"date": d.isoformat()}))
    return out


def check_homogeneous_sources(candles: list[Candle]) -> list[Warning_]:
    keys = {(c.provider, c.price_component) for c in candles}
    if len(keys) > 1:
        return [Warning_("mixed_sources", "blocking",
                         f"Candles come from several providers/price types {sorted(keys)}; they are not combined.")]
    return []


def compare_values(field_name: str, values: dict[str, float], rel_tol: float) -> Warning_ | None:
    """values: provider -> value. Returns a conflict warning; never averages."""
    if len(values) < 2:
        return None
    lo, hi = min(values.values()), max(values.values())
    ref = abs(hi) or 1.0
    if (hi - lo) / ref <= rel_tol:
        return None
    return Warning_("source_conflict", "blocking",
                    f"Available sources disagree on {field_name}; interpretation is withheld pending verification.",
                    {"values": values})


def fixture_warning(is_fixture: bool) -> Warning_ | None:
    if is_fixture:
        return Warning_("fixture_data", "blocking",
                        "DEVELOPMENT FIXTURE: synthetic data, not market data.")
    return None

from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.domain.sessions import SessionDef, daily_from_hourly, weekly_from_daily, with_completion, AggregationError, aggregate
from app.domain.timeutil import format_display, localize, to_zone
from tests.helpers import bar, series

UTC = timezone.utc
S = SessionDef("fx_ny_close", "America/New_York", "17:00")


class TestEATConversion:
    def test_us_release_shifts_by_an_hour_in_eat_after_us_dst_ends(self):
        # US DST ends 1 Nov 2026. EAT has no DST, so 08:30 New York moves from 15:30 to 16:30 EAT.
        before = localize(date(2026, 10, 30), time(8, 30), "America/New_York")
        after = localize(date(2026, 11, 2), time(8, 30), "America/New_York")
        assert to_zone(before, "Africa/Kampala").strftime("%H:%M") == "15:30"
        assert to_zone(after, "Africa/Kampala").strftime("%H:%M") == "16:30"

    def test_uk_release_shifts_after_uk_dst_ends(self):
        # UK DST ends 25 Oct 2026: 07:00 London = 09:00 EAT before, 10:00 EAT after.
        before = localize(date(2026, 10, 23), time(7, 0), "Europe/London")
        after = localize(date(2026, 10, 26), time(7, 0), "Europe/London")
        assert to_zone(before, "Africa/Kampala").hour == 9
        assert to_zone(after, "Africa/Kampala").hour == 10

    def test_kigali_is_cat_not_eat(self):
        t = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
        assert to_zone(t, "Africa/Kampala").hour == 15
        assert to_zone(t, "Africa/Kigali").hour == 14

    def test_naive_datetimes_rejected(self):
        with pytest.raises(ValueError):
            to_zone(datetime(2026, 1, 1), "Africa/Kampala")

    def test_display_label(self):
        t = datetime(2026, 10, 26, 5, 30, tzinfo=UTC)
        assert format_display(t, "Africa/Kampala", "EAT") == "Mon 26 Oct 2026 08:30 EAT"


class TestSessionBoundaries:
    def test_daily_bounds_follow_new_york_dst(self):
        assert S.day_bounds(date(2026, 10, 30)) == (datetime(2026, 10, 29, 21, tzinfo=UTC), datetime(2026, 10, 30, 21, tzinfo=UTC))
        # Monday after DST ends: opens Sunday 17:00 EST = 22:00 UTC
        assert S.day_bounds(date(2026, 11, 2)) == (datetime(2026, 11, 1, 22, tzinfo=UTC), datetime(2026, 11, 2, 22, tzinfo=UTC))

    def test_week_bounds(self):
        assert S.week_bounds(date(2026, 10, 26)) == (datetime(2026, 10, 25, 21, tzinfo=UTC), datetime(2026, 10, 30, 21, tzinfo=UTC))
        with pytest.raises(ValueError):
            S.week_bounds(date(2026, 10, 27))

    def test_trading_day_of(self):
        assert S.trading_day_of(datetime(2026, 10, 26, 20, 59, tzinfo=UTC)) == date(2026, 10, 26)
        assert S.trading_day_of(datetime(2026, 10, 26, 21, 0, tzinfo=UTC)) == date(2026, 10, 27)
        assert S.trading_day_of(datetime(2026, 10, 25, 21, 0, tzinfo=UTC)) == date(2026, 10, 26)  # Sunday open
        assert S.trading_day_of(datetime(2026, 10, 31, 12, 0, tzinfo=UTC)) is None              # Saturday
        assert S.trading_day_of(datetime(2026, 10, 30, 21, 30, tzinfo=UTC)) is None             # after Friday close

    def test_market_open_and_holidays(self):
        h = SessionDef("x", "America/New_York", holidays=frozenset({date(2026, 12, 25)}))
        assert not h.market_open(datetime(2026, 12, 25, 12, tzinfo=UTC))
        assert h.market_open(datetime(2026, 12, 24, 12, tzinfo=UTC))
        assert date(2026, 12, 25) not in h.week_trading_days(date(2026, 12, 21))


class TestAggregation:
    def test_daily_from_hourly_complete_and_incomplete(self):
        start, end = S.day_bounds(date(2026, 10, 27))
        closes = [1.3 + i * 0.0001 for i in range(24)]
        h1 = series(start, closes)
        d = daily_from_hourly(h1, S, date(2026, 10, 27), as_of=end)
        assert d.complete and d.open == h1[0].open and d.close == h1[-1].close
        assert d.high == max(c.high for c in h1) and d.low == min(c.low for c in h1)
        # Missing an hour -> incomplete, so its close is not a closing price
        d2 = daily_from_hourly(h1[:-1], S, date(2026, 10, 27), as_of=end)
        assert not d2.complete
        # Period not ended yet -> incomplete
        d3 = daily_from_hourly(h1, S, date(2026, 10, 27), as_of=end - timedelta(minutes=1))
        assert not d3.complete

    def test_weekly_from_daily(self):
        monday = date(2026, 10, 26)
        d1 = []
        for i, d in enumerate(S.week_trading_days(monday)):
            s, e = S.day_bounds(d)
            d1.append(bar(s, 1.30 + i / 100, 1.32 + i / 100, 1.29 + i / 100, 1.31 + i / 100, tf="D1", hours=24))
        w = weekly_from_daily(d1, S, monday, as_of=S.week_bounds(monday)[1])
        assert w.complete and w.open == 1.30 and w.close == 1.35 and w.high == 1.36 and w.low == 1.29
        w2 = weekly_from_daily(d1[:4], S, monday, as_of=S.week_bounds(monday)[1])
        assert not w2.complete

    def test_refuses_mixed_providers(self):
        s = datetime(2026, 10, 26, 0, tzinfo=UTC)
        a = bar(s, 1, 1.1, 0.9, 1.0, provider="oanda")
        b = bar(s + timedelta(hours=1), 1, 1.1, 0.9, 1.0, provider="other")
        with pytest.raises(AggregationError):
            aggregate([a, b], "D1", s, s + timedelta(hours=2), 2, s + timedelta(hours=3))

    def test_provider_complete_flag_respects_as_of(self):
        s = datetime(2026, 10, 26, 0, tzinfo=UTC)
        c = bar(s, 1, 1.1, 0.9, 1.0)
        assert not with_completion(c, s + timedelta(minutes=30)).complete
        assert with_completion(c, s + timedelta(hours=1)).complete


def test_missing_bar_tolerance_is_bounded_and_recorded():
    start, end = S.day_bounds(date(2026, 10, 27))
    h1 = series(start, [1.3 + i * 0.0001 for i in range(24)])
    one_gap = h1[:5] + h1[6:]
    d = daily_from_hourly(one_gap, S, date(2026, 10, 27), as_of=end, max_missing=1)
    assert d.complete and d.bars == 23 and d.expected_bars == 24
    assert not daily_from_hourly(one_gap, S, date(2026, 10, 27), as_of=end).complete          # strict by default
    assert not daily_from_hourly(h1[:5] + h1[7:], S, date(2026, 10, 27), as_of=end, max_missing=1).complete

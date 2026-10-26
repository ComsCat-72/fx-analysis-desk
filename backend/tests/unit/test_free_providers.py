"""Free price providers, tested on responses recorded from the live APIs (tests/data, Oct 2026)."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from app.domain.sessions import SessionDef, daily_from_hourly
from app.providers.base import ProviderError, ProviderNotConfigured
from app.providers.twelvedata import TwelveDataProvider
from app.providers.yahoo import YahooProvider

DATA = Path(__file__).resolve().parents[1] / "data"
UTC = timezone.utc
NOW = datetime(2026, 10, 26, 14, 40, tzinfo=UTC)


def transport(fname, status=200, seen=None):
    body = (DATA / fname).read_bytes()

    def handler(req: httpx.Request):
        if seen is not None:
            seen.append(req)
        return httpx.Response(status, content=body, headers={"content-type": "application/json"})
    return httpx.MockTransport(handler)


def test_twelvedata_requires_key():
    with pytest.raises(ProviderNotConfigured):
        TwelveDataProvider(None)


def test_twelvedata_time_series():
    seen = []
    p = TwelveDataProvider("k", transport=transport("td_eurusd_1h.json", seen=seen), now=lambda: NOW)
    p.http.min_interval_s = 0
    cs = p.candles("EUR/USD", "EUR_USD", "H1", NOW - timedelta(days=3), NOW)
    assert cs and cs == sorted(cs, key=lambda c: c.start)
    assert all(c.provider == "twelvedata" and c.price_component == "C" and not c.is_fixture for c in cs)
    assert cs[-1].start == datetime(2026, 10, 26, 14, tzinfo=UTC) and not cs[-1].complete   # bar still forming
    assert cs[-2].complete
    q = dict(seen[0].url.params)
    assert q["symbol"] == "EUR/USD" and q["interval"] == "1h" and q["timezone"] == "UTC"


def test_twelvedata_error_is_raised_not_hidden():
    p = TwelveDataProvider("k", transport=transport("td_xauusd_1h.json", status=401), now=lambda: NOW)
    p.http.min_interval_s = 0
    with pytest.raises(ProviderError, match="401"):
        p.candles("XAU/USD", "XAU_USD", "H1", NOW - timedelta(days=1), NOW)


def test_yahoo_fx_drops_live_point_and_nulls():
    p = YahooProvider(transport=transport("yh_EURUSD_X.json"), now=lambda: NOW)
    p.http.min_interval_s = 0
    raw = json.loads((DATA / "yh_EURUSD_X.json").read_text())["chart"]["result"][0]
    cs = p.candles("EURUSD=X", "EUR_USD", "H1", NOW - timedelta(days=10), NOW + timedelta(hours=1))
    assert 0 < len(cs) < len(raw["timestamp"])
    assert all(c.start.minute == 0 for c in cs)                       # off-grid live point removed
    assert all(c.low <= min(c.open, c.close) and c.high >= max(c.open, c.close) for c in cs)


def test_yahoo_ndx_cash_session_aggregates_to_daily():
    p = YahooProvider(transport=transport("yh__5ENDX.json"), now=lambda: NOW)
    p.http.min_interval_s = 0
    cs = p.candles("^NDX", "NAS100", "H1", NOW - timedelta(days=10), NOW + timedelta(hours=1))
    assert cs and all(c.start.minute == 30 for c in cs)               # cash-session bars start at :30
    s = SessionDef("us_equity_cash", "America/New_York", "16:00", expected_h1_bars=7)
    days = sorted({s.trading_day_of(c.start) for c in cs if c.complete})
    full = [d for d in days if daily_from_hourly(cs, s, d, NOW) and daily_from_hourly(cs, s, d, NOW).complete]
    assert full, "at least one complete Nasdaq-100 session should aggregate from 7 hourly bars"


def test_yahoo_dxy_uses_full_fx_session():
    """Recorded data: Yahoo publishes 24 hourly DXY bars per session (the ICE break hour included)."""
    p = YahooProvider(transport=transport("yh_DX_Y_NYB.json"), now=lambda: NOW)
    p.http.min_interval_s = 0
    cs = p.candles("DX-Y.NYB", "DXY", "H1", NOW - timedelta(days=10), NOW + timedelta(hours=1))
    s = SessionDef("fx_ny_close", "America/New_York", "17:00")
    counts = {}
    for c in cs:
        d = s.trading_day_of(c.start)
        counts[d] = counts.get(d, 0) + 1
    assert max(counts.values()) == 24
    full = [d for d in counts if counts[d] == 24]
    assert all(daily_from_hourly(cs, s, d, NOW).complete for d in full)

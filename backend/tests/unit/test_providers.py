"""Provider adapters tested against documented response shapes using httpx.MockTransport.
The payloads below are hand-written samples of the formats, not real market data."""
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.domain.sessions import SessionDef
from app.providers.base import ProviderNotConfigured
from app.providers.calendar_ff import FFWeeklyJsonCalendar, parse_feed
from app.providers.central_banks import classify, parse_feed as parse_rss
from app.providers.fixtures import FixturePriceProvider
from app.providers.fred import FredSeries
from app.providers.oanda import OandaPriceProvider, parse_time

UTC = timezone.utc


def test_oanda_requires_token():
    with pytest.raises(ProviderNotConfigured):
        OandaPriceProvider(None, None)


def test_oanda_candles_parse_and_params():
    seen = {}

    def handler(req: httpx.Request):
        seen.update(dict(req.url.params))
        assert req.headers["Authorization"] == "Bearer t"
        return httpx.Response(200, json={"instrument": "GBP_USD", "granularity": "H1", "candles": [
            {"complete": True, "volume": 10, "time": "2026-10-26T00:00:00.000000000Z",
             "mid": {"o": "1.10000", "h": "1.10100", "l": "1.09900", "c": "1.10050"}},
            {"complete": False, "volume": 3, "time": "2026-10-26T01:00:00.000000000Z",
             "mid": {"o": "1.10050", "h": "1.10060", "l": "1.10000", "c": "1.10010"}}]})

    p = OandaPriceProvider("t", "acc", transport=httpx.MockTransport(handler))
    cs = p.candles("GBP_USD", "GBP_USD", "H1", datetime(2026, 10, 26, tzinfo=UTC), datetime(2026, 10, 26, 2, tzinfo=UTC))
    assert len(cs) == 2 and cs[0].complete and not cs[1].complete
    assert cs[0].close == 1.1005 and cs[0].provider == "oanda" and cs[0].price_component == "M"
    assert seen["price"] == "M" and seen["alignmentTimezone"] == "America/New_York" and seen["dailyAlignment"] == "17"


def test_oanda_rejects_bid_ask_mixing():
    with pytest.raises(ValueError):
        OandaPriceProvider("t", "a", price_component="B")


def test_oanda_time_parse():
    assert parse_time("2026-10-26T21:00:00.123456789Z") == datetime(2026, 10, 26, 21, 0, 0, 123456, tzinfo=UTC)


FF_SAMPLE = [
    {"title": "Sample CPI y/y", "country": "USD", "date": "2026-10-28T08:30:00-04:00", "impact": "High",
     "forecast": "3.1%", "previous": "3.0%"},
    {"title": "Bank Holiday", "country": "NZD", "date": "2026-10-26T00:00:00-04:00", "impact": "Holiday",
     "forecast": "", "previous": ""},
]


def test_ff_feed_parsing_keeps_source_time():
    evs = parse_feed(FF_SAMPLE)
    e = evs[0]
    assert e.scheduled_at == datetime(2026, 10, 28, 12, 30, tzinfo=UTC)
    assert e.source_time_text == "2026-10-28T08:30:00-04:00" and e.consensus == "3.1%" and e.actual is None
    assert evs[1].impact == "Holiday" and evs[1].consensus is None


def test_ff_provider_http():
    t = httpx.MockTransport(lambda r: httpx.Response(200, content=json.dumps(FF_SAMPLE)))
    assert len(FFWeeklyJsonCalendar(transport=t).week_events()) == 2


RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Sample FOMC statement</title><link>https://example.org/a</link><pubDate>Wed, 28 Oct 2026 18:00:00 GMT</pubDate></item>
<item><title>Sample speech by an official</title><link>https://example.org/b</link><pubDate>Thu, 29 Oct 2026 14:00:00 +0000</pubDate></item>
<item><title>No date item</title><link>https://example.org/c</link></item>
</channel></rss>"""


def test_central_bank_rss():
    items = parse_rss("fed", "USD", "press", RSS, "https://example.org/feed")
    assert [i.kind for i in items] == ["decision", "speech"]  # undated item dropped, not guessed
    assert items[0].published_at == datetime(2026, 10, 28, 18, tzinfo=UTC)
    assert classify("press", "Minutes of the meeting") == "minutes"


def test_fred_missing_values():
    t = httpx.MockTransport(lambda r: httpx.Response(200, json={"observations": [
        {"date": "2026-10-23", "value": "4.10"}, {"date": "2026-10-26", "value": "."}]}))
    pts = FredSeries("k", transport=t).series("DGS10", "2026-10-23", "2026-10-26")
    assert pts[0].value == 4.10 and pts[1].value is None


def test_fixture_prices_are_labelled_and_deterministic():
    s = SessionDef("fx", "America/New_York")
    p = FixturePriceProvider(s)
    a = p.candles("X", "GBP_USD", "H1", datetime(2026, 10, 26, tzinfo=UTC), datetime(2026, 10, 26, 5, tzinfo=UTC))
    b = p.candles("X", "GBP_USD", "H1", datetime(2026, 10, 26, tzinfo=UTC), datetime(2026, 10, 26, 5, tzinfo=UTC))
    assert a == b and all(c.is_fixture and c.provider == "FIXTURE" for c in a)
    # no candles generated in the weekend gap
    assert p.candles("X", "GBP_USD", "H1", datetime(2026, 10, 31, tzinfo=UTC), datetime(2026, 10, 31, 12, tzinfo=UTC)) == []
    assert 0.8 < a[0].close < 1.2  # synthetic level near 1.0, unlike any real GBP/USD quote


def test_policy_relevance_filter():
    from app.reports.facts import is_monetary_policy
    assert is_monetary_policy("decision", "FOMC statement")
    assert is_monetary_policy("speech", "Bowman, Supervisory Modernization")           # speeches are kept
    assert not is_monetary_policy("minutes", "Banknote imagery advisory group minutes")
    assert not is_monetary_policy("press", "Federal Reserve Board announces termination of enforcement actions")
    assert is_monetary_policy("minutes", "Minutes of the Monetary Policy Committee meeting")

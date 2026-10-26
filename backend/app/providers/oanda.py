"""OANDA v20 REST adapter (spot FX, metals, CFDs). Mid prices only, aligned to 17:00 New York.

Docs: https://developer.oanda.com/rest-live-v20/instrument-ep/ and /pricing-ep/
Requires OANDA_API_TOKEN (and OANDA_ACCOUNT_ID for live quotes).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..domain.sessions import Candle
from ..domain.validation import Quote
from .base import HealthResult, HttpClient, PriceProvider, ProviderError, ProviderNotConfigured

HOSTS = {"practice": "https://api-fxpractice.oanda.com", "live": "https://api-fxtrade.oanda.com"}
GRANULARITY = {"H1": "H1", "D1": "D", "W1": "W"}
STEP = {"H1": timedelta(hours=1), "D1": timedelta(days=1), "W1": timedelta(weeks=1)}
MAX_CANDLES = 4000  # OANDA allows 5000 per request; stay below


def parse_time(s: str) -> datetime:
    """OANDA RFC3339 with nanoseconds, e.g. 2026-10-26T21:00:00.000000000Z."""
    s = s.rstrip("Z")
    if "." in s:
        head, frac = s.split(".")
        s = f"{head}.{frac[:6]}"
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


class OandaPriceProvider(PriceProvider):
    name = "oanda"

    def __init__(self, token: str | None, account_id: str | None, environment: str = "practice",
                 price_component: str = "M", transport=None):
        if not token:
            raise ProviderNotConfigured("OANDA_API_TOKEN is not set")
        if price_component != "M":
            raise ValueError("only mid prices (M) are used, to avoid mixing bid/ask definitions")
        self.account_id = account_id
        self.http = HttpClient(HOSTS[environment], headers={"Authorization": f"Bearer {token}",
                                                            "Accept-Datetime-Format": "RFC3339"},
                               transport=transport)

    def _candle(self, instrument: str, timeframe: str, row: dict) -> Candle:
        start = parse_time(row["time"])
        m = row["mid"]
        # With weeklyAlignment=Friday a weekly candle starts at Friday 17:00 NY and spans one week.
        # The app builds weekly candles from daily ones itself; W is fetched only for cross-checks.
        end = start + STEP[timeframe]
        return Candle(instrument, timeframe, start, end, float(m["o"]), float(m["h"]), float(m["l"]), float(m["c"]),
                      bool(row["complete"]), self.name, "M", False, float(row.get("volume", 0)))

    def candles(self, symbol, instrument, timeframe, start, end):
        out: list[Candle] = []
        cursor = start
        while cursor < end:
            chunk_end = min(end, cursor + STEP[timeframe] * MAX_CANDLES)
            r = self.http.get(f"/v3/instruments/{symbol}/candles", params={
                "price": "M", "granularity": GRANULARITY[timeframe],
                "from": cursor.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "to": chunk_end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "dailyAlignment": 17, "alignmentTimezone": "America/New_York", "weeklyAlignment": "Friday",
            })
            if r.status_code != 200:
                raise ProviderError(f"OANDA candles {symbol} {timeframe}: HTTP {r.status_code} {r.text[:200]}")
            out.extend(self._candle(instrument, timeframe, row) for row in r.json().get("candles", []))
            cursor = chunk_end
        return sorted({c.start: c for c in out}.values(), key=lambda c: c.start)

    def latest_quote(self, symbol, instrument):
        if not self.account_id:
            raise ProviderNotConfigured("OANDA_ACCOUNT_ID is required for live pricing")
        r = self.http.get(f"/v3/accounts/{self.account_id}/pricing", params={"instruments": symbol})
        if r.status_code != 200:
            raise ProviderError(f"OANDA pricing {symbol}: HTTP {r.status_code}")
        p = r.json()["prices"][0]
        bid = float(p["bids"][0]["price"]) if p.get("bids") else None
        ask = float(p["asks"][0]["price"]) if p.get("asks") else None
        if bid is None or ask is None:
            raise ProviderError(f"OANDA pricing {symbol}: no bid/ask")
        return Quote(instrument, parse_time(p["time"]), bid, ask, (bid + ask) / 2, self.name)

    def health(self):
        import time
        t = time.monotonic()
        try:
            r = self.http.get("/v3/instruments/EUR_USD/candles", params={"count": 1, "granularity": "H1", "price": "M"})
            return HealthResult(self.name, r.status_code == 200, int((time.monotonic() - t) * 1000), f"HTTP {r.status_code}")
        except ProviderError as e:
            return HealthResult(self.name, False, None, str(e))

"""Twelve Data adapter (free plan: personal API key, 800 credits/day, 8 requests/minute).

Docs: https://twelvedata.com/docs#time-series and #quote. Response shapes in this module were taken from
recorded responses (tests/data/td_*.json). Bars are UTC-aligned; `datetime` is the bar start.
Prices are Twelve Data's composite FX quotes (recorded as price component "C"), not a broker's bid/ask.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..domain.sessions import Candle
from ..domain.validation import Quote
from .base import HealthResult, HttpClient, PriceProvider, ProviderError, ProviderNotConfigured

BASE = "https://api.twelvedata.com"
INTERVAL = {"H1": ("1h", timedelta(hours=1)), "D1": ("1day", timedelta(days=1))}
MAX_BARS = 5000


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


class TwelveDataProvider(PriceProvider):
    name = "twelvedata"

    def __init__(self, api_key: str | None, transport=None, now=None):
        if not api_key:
            raise ProviderNotConfigured("TWELVEDATA_API_KEY is not set (free key: https://twelvedata.com/pricing)")
        self.key = api_key
        self.now = now or (lambda: datetime.now(timezone.utc))
        # Free plan allows 8 requests per minute.
        self.http = HttpClient(BASE, min_interval_s=7.6, transport=transport, backoff=(10.0, 30.0, 61.0))

    def _get(self, path: str, params: dict) -> dict:
        r = self.http.get(path, params={**params, "apikey": self.key})
        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"Twelve Data {path}: HTTP {r.status_code}, non-JSON body")
        if r.status_code != 200 or data.get("status") == "error":
            raise ProviderError(f"Twelve Data {path} {params.get('symbol')}: {data.get('code', r.status_code)} {data.get('message', '')[:200]}")
        return data

    def candles(self, symbol, instrument, timeframe, start, end):
        interval, step = INTERVAL[timeframe]
        out: dict[datetime, Candle] = {}
        cursor = start
        now = self.now()
        while cursor < end:
            chunk_end = min(end, cursor + step * (MAX_BARS - 1))
            data = self._get("/time_series", {
                "symbol": symbol, "interval": interval, "timezone": "UTC", "order": "ASC", "outputsize": MAX_BARS,
                "start_date": cursor.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                "end_date": chunk_end.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            })
            for v in data.get("values", []):
                s = _ts(v["datetime"])
                if not (start <= s < end):
                    continue
                o, h, l, c = (float(v[k]) for k in ("open", "high", "low", "close"))
                e = s + step
                out[s] = Candle(instrument, timeframe, s, e, o, max(h, o, c), min(l, o, c), c,
                                complete=e <= now, provider=self.name, price_component="C")
            cursor = chunk_end
        return [out[k] for k in sorted(out)]

    def latest_quote(self, symbol, instrument):
        q = self._get("/quote", {"symbol": symbol})
        t = q.get("last_quote_at") or q.get("timestamp")
        if t is None or q.get("close") is None:
            raise ProviderError(f"Twelve Data quote {symbol}: missing price or time")
        price = float(q["close"])
        return Quote(instrument, datetime.fromtimestamp(int(t), timezone.utc), None, None, price, self.name)

    def health(self):
        import time
        t0 = time.monotonic()
        try:
            u = self._get("/api_usage", {})
            return HealthResult(self.name, True, int((time.monotonic() - t0) * 1000),
                                f"credits used {u.get('current_usage')}/{u.get('plan_limit')}")
        except ProviderError as e:
            return HealthResult(self.name, False, None, str(e))

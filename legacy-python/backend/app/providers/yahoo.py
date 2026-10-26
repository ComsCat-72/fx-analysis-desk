"""Yahoo Finance chart endpoint (no key). Unofficial and intended for personal use; reports name it.

Used by default for the official ICE dollar index (DX-Y.NYB) and the Nasdaq-100 index (^NDX), and
optionally as a no-key source for FX pairs (EURUSD=X ...). Shapes taken from recorded responses
(tests/data/yh_*.json). Rows with null prices are skipped, and the trailing "live" point (a timestamp
off the bar grid) is dropped, so only real bars are stored.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from ..domain.sessions import Candle
from ..domain.validation import Quote
from .base import HealthResult, HttpClient, PriceProvider, ProviderError

BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"
INTERVAL = {"H1": ("1h", timedelta(hours=1)), "D1": ("1d", timedelta(days=1))}
MAX_H1_DAYS = 720  # Yahoo serves hourly bars for roughly the last 730 days


class YahooProvider(PriceProvider):
    name = "yahoo"

    def __init__(self, transport=None, now=None):
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.http = HttpClient(min_interval_s=1.0, transport=transport,
                               headers={"User-Agent": "Mozilla/5.0 (compatible; fx-analysis-desk/0.1)"})

    def _chart(self, symbol: str, params: dict) -> dict:
        r = self.http.get(BASE + symbol, params=params)
        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"Yahoo {symbol}: HTTP {r.status_code}, non-JSON body")
        chart = data.get("chart") or {}
        if r.status_code != 200 or chart.get("error") or not chart.get("result"):
            err = chart.get("error") or {}
            raise ProviderError(f"Yahoo {symbol}: HTTP {r.status_code} {err.get('code', '')} {err.get('description', '')}".strip())
        return chart["result"][0]

    def candles(self, symbol, instrument, timeframe, start, end):
        interval, step = INTERVAL[timeframe]
        now = self.now()
        if timeframe == "H1":
            start = max(start, now - timedelta(days=MAX_H1_DAYS))
        res = self._chart(symbol, {"interval": interval, "period1": int(start.timestamp()),
                                   "period2": int(end.timestamp()), "includePrePost": "false"})
        ts = res.get("timestamp") or []
        q = (res.get("indicators", {}).get("quote") or [{}])[0]
        if not ts:
            return []
        # Bars sit on a fixed grid (e.g. :00 for FX, :30 for the cash index); drop off-grid live points.
        grid = Counter(t % 3600 for t in ts).most_common(1)[0][0] if timeframe == "H1" else None
        out = []
        for i, t in enumerate(ts):
            o, h, l, c = (q.get(k, [None] * len(ts))[i] for k in ("open", "high", "low", "close"))
            if None in (o, h, l, c):
                continue
            if grid is not None and t % 3600 != grid:
                continue
            s = datetime.fromtimestamp(t, timezone.utc)
            if not (start <= s < end):
                continue
            e = s + step
            out.append(Candle(instrument, timeframe, s, e, float(o), max(float(h), o, c), min(float(l), o, c),
                              float(c), complete=e <= now, provider=self.name, price_component="L"))
        return out

    def latest_quote(self, symbol, instrument):
        m = self._chart(symbol, {"interval": "1m", "range": "1d"}).get("meta", {})
        if m.get("regularMarketPrice") is None or m.get("regularMarketTime") is None:
            raise ProviderError(f"Yahoo {symbol}: no current price")
        return Quote(instrument, datetime.fromtimestamp(int(m["regularMarketTime"]), timezone.utc), None, None,
                     float(m["regularMarketPrice"]), self.name)

    def health(self):
        try:
            self._chart("EURUSD=X", {"interval": "1d", "range": "5d"})
            return HealthResult(self.name, True, message="ok")
        except ProviderError as e:
            return HealthResult(self.name, False, None, str(e))

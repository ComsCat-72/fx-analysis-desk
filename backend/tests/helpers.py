"""Test helpers. Candles built here are synthetic test inputs, not market data."""
from datetime import datetime, timedelta, timezone

from app.domain.sessions import Candle

UTC = timezone.utc


def bar(start: datetime, o, h, l, c, tf="H1", complete=True, inst="GBP_USD", provider="test", hours=1):
    return Candle(inst, tf, start, start + timedelta(hours=hours), o, h, l, c, complete, provider, "M", True)


def series(start: datetime, closes: list[float], spread=0.0005, tf="H1", inst="GBP_USD"):
    """Each bar opens at the previous close; high/low pad by `spread`."""
    out, prev = [], closes[0]
    for i, c in enumerate(closes):
        o = prev
        out.append(bar(start + timedelta(hours=i), o, max(o, c) + spread, min(o, c) - spread, c, tf, inst=inst))
        prev = c
    return out


def ohlc_series(start: datetime, rows: list[tuple], tf="H1"):
    return [bar(start + timedelta(hours=i), *r, tf=tf) for i, r in enumerate(rows)]

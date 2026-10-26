"""Reproducible technical calculations. Every function takes an explicit as_of and ignores later data.

Swing algorithm (fractal):
  bar i is a swing high if high[i] > max(high[i-L .. i-1]) and high[i] >= max(high[i+1 .. i+R]).
  Swing lows mirror this. A swing is *confirmed* at the close (end) of bar i+R; it does not exist
  for any analysis whose as_of is earlier than that. L and R are configurable (technical.swings).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .sessions import Candle
from .timeutil import to_utc


def closed_before(candles: list[Candle], as_of: datetime) -> list[Candle]:
    """Only complete candles whose period ended by as_of. Prevents future-data leakage."""
    t = to_utc(as_of)
    return [c for c in sorted(candles, key=lambda c: c.start) if c.complete and c.end <= t]


def sma(values: list[float], period: int) -> float | None:
    if period <= 0 or len(values) < period:
        return None
    return sum(values[-period:]) / period


def ema(values: list[float], period: int) -> float | None:
    """EMA seeded with the SMA of the first `period` values, alpha = 2/(period+1)."""
    if period <= 0 or len(values) < period:
        return None
    alpha = 2 / (period + 1)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = alpha * v + (1 - alpha) * e
    return e


def true_ranges(candles: list[Candle]) -> list[float]:
    out = []
    for i, c in enumerate(candles):
        if i == 0:
            out.append(c.high - c.low)
        else:
            pc = candles[i - 1].close
            out.append(max(c.high - c.low, abs(c.high - pc), abs(c.low - pc)))
    return out


def atr(candles: list[Candle], period: int = 14) -> float | None:
    """Wilder ATR: first value = mean of first `period` TRs, then (prev*(n-1)+TR)/n."""
    tr = true_ranges(candles)
    if len(tr) < period:
        return None
    a = sum(tr[:period]) / period
    for x in tr[period:]:
        a = (a * (period - 1) + x) / period
    return a


def rsi(closes: list[float], period: int = 14) -> float | None:
    """Wilder RSI."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for a, b in zip(closes[:-1], closes[1:]):
        d = b - a
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag = sum(gains[:period]) / period
    al = sum(losses[:period]) / period
    for g, l in zip(gains[period:], losses[period:]):
        ag = (ag * (period - 1) + g) / period
        al = (al * (period - 1) + l) / period
    if al == 0:
        return 100.0
    rs = ag / al
    return 100 - 100 / (1 + rs)


@dataclass(frozen=True)
class Swing:
    kind: str               # high | low
    price: float
    bar_start: datetime     # start of the swing bar
    confirmed_at: datetime  # end of bar i+R
    label: str | None = None  # HH/LH for highs, HL/LL for lows (relative to previous confirmed swing)


def find_swings(candles: list[Candle], as_of: datetime, left: int = 3, right: int = 3) -> list[Swing]:
    bars = closed_before(candles, as_of)
    out: list[Swing] = []
    for i in range(left, len(bars) - right):
        b = bars[i]
        lh = [x.high for x in bars[i - left:i]]
        rh = [x.high for x in bars[i + 1:i + 1 + right]]
        ll = [x.low for x in bars[i - left:i]]
        rl = [x.low for x in bars[i + 1:i + 1 + right]]
        conf = bars[i + right].end
        if b.high > max(lh) and b.high >= max(rh):
            out.append(Swing("high", b.high, b.start, conf))
        if b.low < min(ll) and b.low <= min(rl):
            out.append(Swing("low", b.low, b.start, conf))
    return _label(out)


def _label(swings: list[Swing]) -> list[Swing]:
    last = {"high": None, "low": None}
    out = []
    for s in sorted(swings, key=lambda s: (s.confirmed_at, s.bar_start)):
        prev = last[s.kind]
        label = None
        if prev is not None:
            if s.kind == "high":
                label = "HH" if s.price > prev.price else "LH"
            else:
                label = "HL" if s.price > prev.price else "LL"
        ns = Swing(s.kind, s.price, s.bar_start, s.confirmed_at, label)
        out.append(ns)
        last[s.kind] = ns
    return out


def structure(swings: list[Swing]) -> str:
    """'upward' if latest high is HH and latest low is HL; 'downward' if LH and LL; else 'mixed'.
    'insufficient' when fewer than two of each kind are confirmed."""
    highs = [s for s in swings if s.kind == "high"]
    lows = [s for s in swings if s.kind == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return "insufficient"
    h, l = highs[-1].label, lows[-1].label
    if h == "HH" and l == "HL":
        return "upward"
    if h == "LH" and l == "LL":
        return "downward"
    return "mixed"


def previous_high_low(candles: list[Candle], as_of: datetime) -> dict | None:
    bars = closed_before(candles, as_of)
    if not bars:
        return None
    b = bars[-1]
    return {"high": b.high, "low": b.low, "close": b.close, "start": b.start, "end": b.end, "timeframe": b.timeframe}


def range_bounds(candles: list[Candle], as_of: datetime, lookback: int) -> dict | None:
    bars = closed_before(candles, as_of)[-lookback:]
    if len(bars) < lookback:
        return None
    return {"high": max(b.high for b in bars), "low": min(b.low for b in bars),
            "from": bars[0].start, "to": bars[-1].end, "bars": lookback}


def summary(candles_by_tf: dict[str, list[Candle]], as_of: datetime, cfg: dict) -> dict:
    """Deterministic technical snapshot used as facts for reports."""
    tcfg = cfg
    out: dict = {"as_of": to_utc(as_of)}
    d1 = closed_before(candles_by_tf.get("D1", []), as_of)
    h1 = candles_by_tf.get("H1", [])
    w1 = candles_by_tf.get("W1", [])
    out["previous_day"] = previous_high_low(d1, as_of)
    out["previous_week"] = previous_high_low(w1, as_of)
    out["atr_d1"] = atr(d1, tcfg.get("atr_period", 14))
    closes = [c.close for c in d1]
    mas = {}
    for m in tcfg.get("moving_averages", []):
        fn = sma if m["type"].upper() == "SMA" else ema
        mas[f"{m['type'].upper()}{m['period']}_D1"] = fn(closes, m["period"])
    out["moving_averages"] = mas
    if tcfg.get("rsi", {}).get("enabled"):
        out["rsi_d1"] = rsi(closes, tcfg["rsi"].get("period", 14))
    sw = tcfg.get("swings", {})
    swings = find_swings(h1, as_of, sw.get("left_bars", 3), sw.get("right_bars", 3))
    out["h1_swings"] = swings[-6:]
    out["h1_structure"] = structure(swings)
    return out

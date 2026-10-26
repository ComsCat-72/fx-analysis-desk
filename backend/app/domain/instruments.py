"""Instrument definitions, currency direction, and the computed (spot-based) DXY."""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

from .sessions import Candle


@dataclass(frozen=True)
class Instrument:
    code: str
    display: str
    base: str
    quote: str
    kind: str          # fx_spot | metal_spot | index_computed | index_cfd
    decimals: int
    provider_symbol: str | None = None
    label: str | None = None
    enabled: bool = True

    @classmethod
    def from_config(cls, code: str, cfg: dict) -> "Instrument":
        return cls(code=code, display=cfg["display"], base=cfg["base"], quote=cfg["quote"], kind=cfg["kind"],
                   decimals=int(cfg["decimals"]), provider_symbol=cfg.get("provider_symbol"),
                   label=cfg.get("label"), enabled=cfg.get("enabled", True))

    @property
    def currencies(self) -> list[str]:
        """Economies analysed separately in reports."""
        if self.kind == "index_computed":
            return ["USD"]
        if self.kind == "index_cfd":
            return ["USD"]
        return [c for c in (self.base, self.quote) if c not in ("XAU", "NAS100", "BASKET")] or [self.quote]

    def fmt(self, price: float | None) -> str:
        return "n/a" if price is None else f"{price:.{self.decimals}f}"


def currency_effect(instrument: Instrument, pair_change: float) -> dict[str, str]:
    """Translate a move in the quoted price into currency strength.

    A higher BASE/QUOTE price means the base gained against the quote (and the quote lost).
    For USD/CHF a rise means USD strengthened against CHF; for EUR/USD a rise means EUR strengthened.
    """
    if pair_change == 0:
        return {instrument.base: "unchanged", instrument.quote: "unchanged"}
    up = pair_change > 0
    return {instrument.base: "stronger" if up else "weaker", instrument.quote: "weaker" if up else "stronger"}


def direction_word(change: float, tolerance: float = 0.0) -> str:
    if abs(change) <= tolerance:
        return "consolidated"
    return "rose" if change > 0 else "fell"


# --- Computed DXY --------------------------------------------------------------
# Published ICE formula: 50.14348112 * EURUSD^-0.576 * USDJPY^0.136 * GBPUSD^-0.119
#                         * USDCAD^0.091 * USDSEK^0.042 * USDCHF^0.036
DXY_CONSTANT = 50.14348112
DXY_WEIGHTS = {"EUR_USD": -0.576, "USD_JPY": 0.136, "GBP_USD": -0.119,
               "USD_CAD": 0.091, "USD_SEK": 0.042, "USD_CHF": 0.036}


def dxy_from_spot(prices: dict[str, float]) -> float:
    missing = set(DXY_WEIGHTS) - set(prices)
    if missing:
        raise ValueError(f"computed DXY needs {sorted(missing)}")
    return DXY_CONSTANT * math.prod(prices[k] ** w for k, w in DXY_WEIGHTS.items())


def dxy_candles(components: dict[str, list[Candle]]) -> list[Candle]:
    """Compute DXY candles from aligned component candles.
    Open and close are exact for the component opens/closes. High/low use only the computed open and
    close (component highs/lows are not simultaneous), so they understate the true range; the
    provider field records this."""
    missing = set(DXY_WEIGHTS) - set(components)
    if missing:
        raise ValueError(f"computed DXY needs {sorted(missing)}")
    by_start = [{c.start: c for c in components[k]} for k in DXY_WEIGHTS]
    starts = sorted(set.intersection(*(set(m) for m in by_start)))
    out = []
    keys = list(DXY_WEIGHTS)
    for s in starts:
        cs = {k: m[s] for k, m in zip(keys, by_start)}
        o = dxy_from_spot({k: c.open for k, c in cs.items()})
        cl = dxy_from_spot({k: c.close for k, c in cs.items()})
        first = next(iter(cs.values()))
        out.append(replace(first, instrument="DXY", open=o, close=cl, high=max(o, cl), low=min(o, cl),
                           complete=all(c.complete for c in cs.values()),
                           provider=f"computed:{first.provider}:open-close-only"))
    return out

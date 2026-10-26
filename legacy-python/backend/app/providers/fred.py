"""Government bond yields from FRED (St. Louis Fed). Requires FRED_API_KEY.

Daily series: DGS2, DGS10 (US Treasury constant maturity). Non-US long-term yields on FRED are
monthly OECD series (e.g. IRLTLT01GBM156N) and are labelled as such; they are not daily market yields.
"""
from __future__ import annotations

from .base import HttpClient, ProviderError, ProviderNotConfigured, SeriesPoint, SeriesProvider

BASE = "https://api.stlouisfed.org/fred/series/observations"

SERIES = {
    "US2Y": {"id": "DGS2", "frequency": "daily", "label": "US 2-year Treasury yield (constant maturity)"},
    "US10Y": {"id": "DGS10", "frequency": "daily", "label": "US 10-year Treasury yield (constant maturity)"},
    "UK10Y_M": {"id": "IRLTLT01GBM156N", "frequency": "monthly", "label": "UK long-term government yield (OECD, monthly)"},
    "DE10Y_M": {"id": "IRLTLT01DEM156N", "frequency": "monthly", "label": "Germany long-term government yield (OECD, monthly)"},
    "AU10Y_M": {"id": "IRLTLT01AUM156N", "frequency": "monthly", "label": "Australia long-term government yield (OECD, monthly)"},
    "NZ10Y_M": {"id": "IRLTLT01NZM156N", "frequency": "monthly", "label": "New Zealand long-term government yield (OECD, monthly)"},
    "CH10Y_M": {"id": "IRLTLT01CHM156N", "frequency": "monthly", "label": "Switzerland long-term government yield (OECD, monthly)"},
}


class FredSeries(SeriesProvider):
    name = "fred"

    def __init__(self, api_key: str | None, transport=None):
        if not api_key:
            raise ProviderNotConfigured("FRED_API_KEY is not set")
        self.key = api_key
        self.http = HttpClient(min_interval_s=0.6, transport=transport)

    def series(self, series_id, start, end):
        r = self.http.get(BASE, params={"series_id": series_id, "api_key": self.key, "file_type": "json",
                                        "observation_start": start, "observation_end": end})
        if r.status_code != 200:
            raise ProviderError(f"FRED {series_id}: HTTP {r.status_code}")
        out = []
        for o in r.json().get("observations", []):
            v = o.get("value")
            out.append(SeriesPoint(series_id, o["date"], None if v in (".", "", None) else float(v), f"FRED:{series_id}"))
        return out

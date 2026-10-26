"""Provider adapter interfaces. Adapters return plain records tagged with provider identity."""
from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime

import httpx

from ..domain.sessions import Candle
from ..domain.validation import Quote


class ProviderError(RuntimeError):
    pass


class ProviderNotConfigured(ProviderError):
    """Raised when credentials are missing. Callers must report this, never substitute fixtures."""


@dataclass(frozen=True)
class CalendarEventIn:
    source: str
    source_event_key: str
    currency: str
    title: str
    scheduled_at: datetime          # aware UTC
    source_time_text: str           # original timestamp exactly as published
    source_timezone: str | None
    impact: str | None
    consensus: str | None
    previous: str | None
    actual: str | None = None
    country: str | None = None
    period: str | None = None
    is_fixture: bool = False


@dataclass(frozen=True)
class PolicyItemIn:
    bank: str
    currency: str
    kind: str
    title: str
    url: str | None
    published_at: datetime
    summary: str | None
    source: str
    speaker: str | None = None
    is_fixture: bool = False


@dataclass(frozen=True)
class SeriesPoint:
    series_id: str
    date: str
    value: float | None
    source: str


@dataclass
class HealthResult:
    provider: str
    ok: bool
    latency_ms: int | None = None
    message: str | None = None


class PriceProvider(ABC):
    name: str
    is_fixture: bool = False

    @abstractmethod
    def candles(self, symbol: str, instrument: str, timeframe: str, start: datetime, end: datetime) -> list[Candle]: ...

    @abstractmethod
    def latest_quote(self, symbol: str, instrument: str) -> Quote: ...

    def health(self) -> HealthResult:
        return HealthResult(self.name, True, message="no health check implemented")


class CalendarProvider(ABC):
    name: str
    is_fixture: bool = False

    @abstractmethod
    def week_events(self) -> list[CalendarEventIn]: ...


class PolicyProvider(ABC):
    name: str

    @abstractmethod
    def items(self) -> list[PolicyItemIn]: ...


class SeriesProvider(ABC):
    name: str

    @abstractmethod
    def series(self, series_id: str, start: str, end: str) -> list[SeriesPoint]: ...


@dataclass
class HttpClient:
    """Small wrapper: timeouts, retries with backoff on 429/5xx, simple per-host rate limit."""
    base_url: str = ""
    headers: dict = field(default_factory=dict)
    timeout: float = 20.0
    retries: int = 3
    backoff: tuple = (1.0, 2.0, 4.0)
    min_interval_s: float = 0.2
    _last: float = 0.0
    transport: httpx.BaseTransport | None = None

    def get(self, path: str, params: dict | None = None) -> httpx.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        last_exc: Exception | None = None
        for attempt in range(self.retries + 1):
            wait = self.min_interval_s - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                with httpx.Client(timeout=self.timeout, headers=self.headers, transport=self.transport,
                                  follow_redirects=True) as c:
                    r = c.get(url, params=params)
                if r.status_code in (429, 500, 502, 503, 504) and attempt < self.retries:
                    time.sleep(self.backoff[min(attempt, len(self.backoff) - 1)])
                    continue
                return r
            except httpx.HTTPError as e:
                last_exc = e
                if attempt < self.retries:
                    time.sleep(self.backoff[min(attempt, len(self.backoff) - 1)])
        raise ProviderError(f"GET {url} failed: {last_exc}")

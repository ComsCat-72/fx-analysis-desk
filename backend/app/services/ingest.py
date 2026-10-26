"""Ingestion: store provider data with identity and history; build D1/W1 deterministically from H1."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.events import EventState, reconcile_actuals, revision_direction
from ..domain.instruments import DXY_WEIGHTS, Instrument, dxy_candles
from ..domain.sessions import Candle, SessionDef, daily_from_hourly, weekly_from_daily, with_completion
from ..models import (CandleRow, DataQualityWarning, EconomicEvent, EventValueHistory, NewsItem, PolicyItem,
                      ProviderHealth, QuoteRow, now_utc)
from ..providers.base import CalendarEventIn, PolicyItemIn, PriceProvider, ProviderError
from ..providers.calendar_ff import event_id


# --- candles -------------------------------------------------------------------

def to_domain(r: CandleRow) -> Candle:
    return Candle(r.instrument, r.timeframe, r.start, r.end, r.open, r.high, r.low, r.close, r.complete,
                  r.provider, r.price_component, r.is_fixture, r.volume, r.bars, r.expected_bars)


def upsert_candles(db: Session, candles: list[Candle]) -> int:
    n = 0
    for c in candles:
        row = db.scalar(select(CandleRow).where(
            CandleRow.instrument == c.instrument, CandleRow.timeframe == c.timeframe, CandleRow.start == c.start,
            CandleRow.provider == c.provider, CandleRow.price_component == c.price_component))
        if row is None:
            db.add(CandleRow(instrument=c.instrument, timeframe=c.timeframe, start=c.start, end=c.end, open=c.open,
                             high=c.high, low=c.low, close=c.close, volume=c.volume, complete=c.complete,
                             bars=c.bars, expected_bars=c.expected_bars,
                             provider=c.provider, price_component=c.price_component, is_fixture=c.is_fixture))
            n += 1
        elif not row.complete:
            # Only incomplete candles may be refreshed; complete candles are final.
            row.open, row.high, row.low, row.close, row.complete, row.end = c.open, c.high, c.low, c.close, c.complete, c.end
            row.bars, row.expected_bars = c.bars, c.expected_bars
            row.retrieved_at = now_utc()
            n += 1
    db.flush()
    return n


def load_candles(db: Session, instrument: str, timeframe: str, start: datetime, end: datetime,
                 provider: str | None = None) -> list[Candle]:
    q = select(CandleRow).where(CandleRow.instrument == instrument, CandleRow.timeframe == timeframe,
                                CandleRow.start >= start, CandleRow.start < end)
    if provider:
        q = q.where(CandleRow.provider == provider)
    return [to_domain(r) for r in db.scalars(q.order_by(CandleRow.start))]


def build_higher_timeframes(db: Session, instrument: str, session: SessionDef, start_day: date, end_day: date,
                            as_of: datetime, provider: str) -> None:
    s, _ = session.day_bounds(session.week_monday(start_day))
    e = session.close_at(end_day)
    h1 = load_candles(db, instrument, "H1", s - timedelta(days=1), e + timedelta(days=1), provider)
    d1 = []
    d = session.week_monday(start_day)
    while d <= end_day:
        if session.is_weekday_session(d):
            from ..config import app_config
            c = daily_from_hourly(h1, session, d, as_of, app_config()["technical"].get("max_missing_h1_bars", 0))
            if c:
                d1.append(c)
        d += timedelta(days=1)
    upsert_candles(db, d1)
    m = session.week_monday(start_day)
    all_d1 = load_candles(db, instrument, "D1", s - timedelta(days=1), e + timedelta(days=1), provider)
    while m <= end_day:
        w = weekly_from_daily(all_d1, session, m, as_of)
        if w:
            upsert_candles(db, [w])
        m += timedelta(days=7)


def component_symbol(provider: str, code: str) -> str:
    """Provider symbol for a DXY component pair code such as USD_JPY."""
    a, b = code.split("_")
    if provider == "twelvedata":
        return f"{a}/{b}"
    if provider == "yahoo":
        return f"{b}=X" if a == "USD" else f"{a}{b}=X"
    return code


def ingest_prices(db: Session, provider: PriceProvider, inst: Instrument, session: SessionDef,
                  start_day: date, end_day: date, as_of: datetime | None = None) -> dict:
    """Fetch H1 for [start_day, end_day] trading days, store, then aggregate D1 and W1."""
    as_of = as_of or datetime.now(timezone.utc)
    s, _ = session.day_bounds(session.week_monday(start_day))
    e = min(session.close_at(end_day), as_of)
    if inst.kind == "index_computed":
        comps = {}
        for code in DXY_WEIGHTS:
            comps[code] = provider.candles(component_symbol(provider.name, code), code, "H1", s, e)
        h1 = dxy_candles(comps)
    else:
        sym = inst.symbol_for(provider.name) or (inst.code if provider.is_fixture else None)
        if sym is None:
            raise ProviderError(f"{inst.display} has no symbol configured for provider '{provider.name}'")
        h1 = provider.candles(sym, inst.code, "H1", s, e)
    h1 = [with_completion(c, as_of) for c in h1]
    n = upsert_candles(db, h1)
    prov = h1[0].provider if h1 else provider.name
    build_higher_timeframes(db, inst.code, session, start_day, end_day, as_of, prov)
    return {"instrument": inst.code, "h1_written": n, "provider": prov}


def store_quote(db: Session, q) -> QuoteRow:
    row = QuoteRow(instrument=q.instrument, time=q.time, bid=q.bid, ask=q.ask, mid=q.mid, provider=q.provider,
                   is_fixture=q.is_fixture)
    db.add(row)
    db.flush()
    return row


# --- calendar ------------------------------------------------------------------

def _history(db: Session, ev: EconomicEvent, field: str, value: str | None, source: str, url: str | None = None):
    db.add(EventValueHistory(event_id=ev.id, field=field, value=value, source=source, source_url=url))


def upsert_events(db: Session, events: list[CalendarEventIn], now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    n = 0
    for e in events:
        eid = event_id(e.source, e.source_event_key)
        ev = db.get(EconomicEvent, eid)
        if ev is None:
            ev = EconomicEvent(id=eid, source=e.source, source_event_key=e.source_event_key, country=e.country,
                               currency=e.currency, title=e.title, period=e.period, scheduled_at=e.scheduled_at,
                               source_time_text=e.source_time_text, source_timezone=e.source_timezone,
                               impact=e.impact, consensus=e.consensus, previous=e.previous,
                               state=EventState.SCHEDULED.value, is_fixture=e.is_fixture)
            db.add(ev)
            db.flush()
            for f in ("consensus", "previous"):
                _history(db, ev, f, getattr(e, f), e.source)
            _history(db, ev, "scheduled_at", e.scheduled_at.isoformat(), e.source)
            n += 1
        else:
            if e.scheduled_at != ev.scheduled_at:
                # Preserve the original scheduled time; record the new one and mark delayed.
                _history(db, ev, "rescheduled_to", e.scheduled_at.isoformat(), e.source)
                if e.scheduled_at > ev.scheduled_at and ev.state == EventState.SCHEDULED.value:
                    ev.state = EventState.DELAYED.value
            if e.consensus != ev.consensus:
                _history(db, ev, "consensus", e.consensus, e.source)
                ev.consensus = e.consensus
            if e.previous != ev.previous and ev.previous is not None and e.previous is not None:
                # The feed's "previous" changing after first sight is a revision of the prior release.
                _history(db, ev, "revised_previous", e.previous, e.source)
                ev.revised_previous = e.previous
            ev.last_update = now
            n += 1
        if e.actual:
            record_actual(db, ev.id, e.actual, e.source, None)
    db.flush()
    return n


def record_actual(db: Session, eid: str, value: str, source: str, url: str | None) -> EconomicEvent:
    """Append an actual from one source, then reconcile across all sources (never averaged)."""
    ev = db.get(EconomicEvent, eid)
    if ev is None:
        raise KeyError(eid)
    _history(db, ev, "actual", value, source, url)
    db.flush()
    latest: dict[str, str] = {}
    rows = db.scalars(select(EventValueHistory).where(EventValueHistory.event_id == eid,
                                                     EventValueHistory.field == "actual")
                      .order_by(EventValueHistory.recorded_at, EventValueHistory.id))
    for h in rows:
        latest[h.source] = h.value
    state, actual = reconcile_actuals(latest)
    ev.actual = actual
    ev.actual_source = ", ".join(sorted(latest)) if actual else None
    ev.state = state.value if state != EventState.UNAVAILABLE else ev.state
    if state == EventState.CONFLICTING:
        db.add(DataQualityWarning(instrument=None, code="source_conflict", severity="blocking",
                                  message=f"Sources disagree on the actual for {ev.title}; interpretation withheld.",
                                  context={"event_id": ev.id, "values": latest}))
    ev.last_update = datetime.now(timezone.utc)
    db.flush()
    return ev


def record_revision(db: Session, eid: str, revised_previous: str, source: str, url: str | None) -> EconomicEvent:
    ev = db.get(EconomicEvent, eid)
    _history(db, ev, "revised_previous", revised_previous, source, url)
    ev.revised_previous = revised_previous
    if ev.state == EventState.RELEASED.value and revision_direction(ev.previous, revised_previous):
        ev.state = EventState.REVISED.value
    db.flush()
    return ev


def mark_unavailable(db: Session, now: datetime, grace: timedelta = timedelta(hours=2)) -> int:
    """Scheduled events well past their time with no verified actual."""
    n = 0
    for ev in db.scalars(select(EconomicEvent).where(EconomicEvent.state.in_(["scheduled", "delayed"]),
                                                    EconomicEvent.scheduled_at < now - grace)):
        if ev.impact == "Holiday":
            continue
        ev.state = EventState.UNAVAILABLE.value
        n += 1
    return n


# --- policy / news -------------------------------------------------------------

def upsert_policy(db: Session, items: list[PolicyItemIn]) -> int:
    n = 0
    for it in items:
        exists = db.scalar(select(PolicyItem).where(PolicyItem.bank == it.bank, PolicyItem.url == it.url)) if it.url else None
        if exists:
            continue
        db.add(PolicyItem(bank=it.bank, currency=it.currency, kind=it.kind, title=it.title, url=it.url,
                          speaker=it.speaker, published_at=it.published_at, summary=it.summary, source=it.source,
                          is_fixture=it.is_fixture))
        n += 1
    db.flush()
    return n


def add_news(db: Session, source_name: str, title: str, url: str | None, published_at: datetime,
             summary: str | None, currencies: list[str], entered_by: str = "user") -> NewsItem:
    item = NewsItem(source_name=source_name, title=title, url=url, published_at=published_at, summary=summary,
                    currencies=currencies, entered_by=entered_by)
    db.add(item)
    db.flush()
    return item


def record_health(db: Session, h) -> None:
    db.add(ProviderHealth(provider=h.provider, ok=h.ok, latency_ms=h.latency_ms, message=h.message))

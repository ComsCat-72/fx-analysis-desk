from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.domain.instruments import Instrument
from app.domain.sessions import SessionDef
from app.models import CandleRow, DataQualityWarning, EconomicEvent
from app.providers.base import CalendarEventIn
from app.providers.fixtures import FixturePriceProvider
from app.services import ingest

UTC = timezone.utc
S = SessionDef("fx_ny_close", "America/New_York")
GBP = Instrument("GBP_USD", "GBP/USD", "GBP", "USD", "fx_spot", 5, "GBP_USD")


def test_ingest_builds_daily_and_weekly(db):
    p = FixturePriceProvider(S)
    as_of = datetime(2026, 10, 31, 12, tzinfo=UTC)
    ingest.ingest_prices(db, p, GBP, S, date(2026, 10, 26), date(2026, 10, 30), as_of)
    d1 = db.scalars(select(CandleRow).where(CandleRow.timeframe == "D1")).all()
    w1 = db.scalars(select(CandleRow).where(CandleRow.timeframe == "W1")).all()
    assert len(d1) == 5 and all(r.complete and r.is_fixture for r in d1)
    assert len(w1) == 1 and w1[0].complete
    assert w1[0].open == d1[0].open and w1[0].close == d1[-1].close
    # idempotent: second run writes nothing new
    again = ingest.ingest_prices(db, p, GBP, S, date(2026, 10, 26), date(2026, 10, 30), as_of)
    assert again["h1_written"] == 0


def test_partial_day_is_incomplete(db):
    p = FixturePriceProvider(S)
    as_of = datetime(2026, 10, 27, 12, tzinfo=UTC)  # Tuesday session in progress
    ingest.ingest_prices(db, p, GBP, S, date(2026, 10, 26), date(2026, 10, 27), as_of)
    rows = {r.start: r for r in db.scalars(select(CandleRow).where(CandleRow.timeframe == "D1"))}
    tue_start = S.day_bounds(date(2026, 10, 27))[0]
    assert rows[tue_start].complete is False


def _ev(when, consensus="0.3%", previous="0.2%", actual=None, title="Sample CPI m/m"):
    txt = when.isoformat()
    return CalendarEventIn("test", f"USD|{title}|{txt[:10]}", "USD", title, when, txt, "UTC", "High",
                           consensus, previous, actual)


def test_event_lifecycle_delay_actual_conflict_revision(db):
    t = datetime(2026, 10, 28, 12, 30, tzinfo=UTC)
    ingest.upsert_events(db, [_ev(t)])
    ev = db.scalar(select(EconomicEvent))
    assert ev.state == "scheduled"
    # delayed by an hour, same day: original time kept, state delayed
    ingest.upsert_events(db, [_ev(t + timedelta(hours=1))])
    assert ev.scheduled_at == t and ev.state == "delayed"
    ingest.record_actual(db, ev.id, "0.4%", "official:BLS", "https://example.org/release")
    assert ev.state == "released" and ev.actual == "0.4%"
    ingest.record_actual(db, ev.id, "0.5%", "manual", None)
    assert ev.state == "conflicting" and ev.actual is None
    assert db.scalar(select(DataQualityWarning).where(DataQualityWarning.code == "source_conflict"))
    ingest.record_actual(db, ev.id, "0.4%", "manual", None)  # corrected entry -> sources agree again
    assert ev.state == "released" and ev.actual == "0.4%"
    ingest.record_revision(db, ev.id, "0.1%", "official:BLS", None)
    assert ev.state == "revised" and ev.revised_previous == "0.1%"
    db.refresh(ev)
    assert {h.field for h in ev.history} >= {"actual", "revised_previous", "rescheduled_to", "consensus"}


def test_missing_actual_becomes_unavailable(db):
    t = datetime(2026, 10, 28, 12, 30, tzinfo=UTC)
    ingest.upsert_events(db, [_ev(t)])
    assert ingest.mark_unavailable(db, t + timedelta(hours=3)) == 1
    assert db.scalar(select(EconomicEvent)).state == "unavailable"

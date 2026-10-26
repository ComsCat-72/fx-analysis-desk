"""End-to-end report flow on DEVELOPMENT FIXTURES with the deterministic template writer."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models import ImmutableReportError, Outlook, OutlookChange, ReportVersion
from app.providers.fixtures import FixtureCalendar, FixturePriceProvider
from app.reports import service
from app.services import ingest
from app.services.registry import instruments, session_def

UTC = timezone.utc
MON = date(2026, 10, 26)


def eat(d: date, hh: int, mm: int = 0) -> datetime:
    from zoneinfo import ZoneInfo
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZoneInfo("Africa/Kampala")).astimezone(UTC)


@pytest.fixture()
def seeded(db):
    s = session_def()
    inst = instruments()["GBP_USD"]
    ingest.ingest_prices(db, FixturePriceProvider(s), inst, s, date(2026, 8, 3), date(2026, 10, 30),
                         as_of=datetime(2026, 10, 31, 12, tzinfo=UTC))
    ingest.upsert_events(db, FixtureCalendar(datetime(2026, 10, 26, tzinfo=UTC)).week_events(),
                         now=datetime(2026, 10, 24, tzinfo=UTC))
    return db


def _publish(db, v, **kw):
    try:
        return service.publish(db, v.id, now=kw.pop("now", None), **kw)
    except service.PublishError as e:
        raise AssertionError(f"{e}: {e.findings}") from e


def test_full_week(seeded):
    db = seeded
    sun = MON - timedelta(days=1)
    wv = service.generate_draft(db, "GBP_USD", "weekly_analysis", MON, cutoff=eat(sun, 20), writer_name="template")
    assert wv.data_mode == "fixture" and "DEVELOPMENT FIXTURE" in wv.body_md
    assert "ANALYSIS" in wv.title and "Weekly Bias" in wv.body_md
    _publish(db, wv, now=eat(sun, 20, 5))
    assert wv.outlook and wv.outlook.kind == "weekly"

    days = [MON + timedelta(days=i) for i in range(5)]
    # Release one actual mid-week so a review sees a released event (recorded after Tuesday's analysis).
    from app.models import EconomicEvent
    ev = db.scalar(select(EconomicEvent).where(EconomicEvent.title.like("%Retail Sales%")))
    for d in days:
        dv = service.generate_draft(db, "GBP_USD", "daily_analysis", d, cutoff=eat(d, 8, 30), writer_name="template")
        assert dv.facts["continuity"]["weekly"]["version_id"] == wv.id  # references the published weekly
        _publish(db, dv, now=eat(d, 8, 35))
        if d == days[1]:
            ingest.record_actual(db, ev.id, "0.3%", "official:test-agency", None)
            for h in ev.history:
                if h.field == "actual":
                    h.recorded_at = eat(d, 10, 5)
        rv = service.generate_draft(db, "GBP_USD", "daily_review", d, cutoff=eat(d + timedelta(days=1), 7, 30),
                                    writer_name="template")
        assert rv.facts["evaluation"]["original"]["version_id"] == dv.id
        assert "Directional assessment" in rv.body_md
        _publish(db, rv, now=eat(d + timedelta(days=1), 7, 35))

    # A later daily analysis knows the earlier days of the week
    thu = db.scalar(select(ReportVersion).where(ReportVersion.title.like("%DAILY ANALYSIS%")).order_by(ReportVersion.id.desc()))
    assert len(thu.facts["continuity"]["daily"]) == 4

    # No post-cutoff leakage: Tuesday's analysis (cutoff 08:30 EAT) must not see the 10:05 actual
    tue = db.scalars(select(ReportVersion).where(ReportVersion.title.like("%DAILY ANALYSIS%")).order_by(ReportVersion.id)).all()[1]
    tue_ev = [e for e in tue.facts["events"].values() if "Retail" in e["title"]][0]
    assert tue_ev["actual"] is None

    sat = MON + timedelta(days=5)
    wr = service.generate_draft(db, "GBP_USD", "weekly_review", MON, cutoff=eat(sat, 10), writer_name="template")
    assert len(wr.facts["evaluation"]["days"]) == 5
    assert "| Monday |" in wr.body_md
    _publish(db, wr, now=eat(sat, 10, 5))

    # Immutability: ORM listener and the database trigger both refuse changes.
    db.commit()
    wv.body_md = "rewritten"
    with pytest.raises(ImmutableReportError):
        db.flush()
    db.rollback()
    with pytest.raises(Exception, match="immutable"):
        db.execute(text("UPDATE report_versions SET body_md='x' WHERE status='published'"))
    db.rollback()
    with pytest.raises(Exception, match="immutable"):
        db.execute(text("DELETE FROM report_versions WHERE status='published'"))
    db.rollback()
    assert db.get(ReportVersion, wv.id).body_md != "rewritten"


def test_correction_creates_new_version_and_change_log(seeded):
    db = seeded
    d = MON
    v1 = service.generate_draft(db, "GBP_USD", "daily_analysis", d, cutoff=eat(d, 8, 30), writer_name="template")
    _publish(db, v1, now=eat(d, 8, 35))
    v2 = service.correct(db, v1.id, "update", cutoff=eat(d, 14))
    assert v2.version == 2 and v2.version_type == "update" and v2.status == "draft"
    with pytest.raises(service.PublishError):
        service.publish(db, v2.id)  # change note required
    service.publish(db, v2.id, change_note="Intraday update after the London session.", now=eat(d, 14, 5))
    assert v1.status == "published" and v1.body_md != v2.body_md
    assert "Version 2 (update)" in v2.body_md
    assert db.scalar(select(OutlookChange)) is not None
    # the review compares against the original v1, and notes the later version
    rv = service.generate_draft(db, "GBP_USD", "daily_review", d, cutoff=eat(d + timedelta(days=1), 7, 30), writer_name="template")
    assert rv.facts["evaluation"]["original"]["version_id"] == v1.id
    assert rv.facts["evaluation"]["latest"]["version_id"] == v2.id


def test_review_without_original_is_blocked(seeded):
    db = seeded
    rv = service.generate_draft(db, "GBP_USD", "daily_review", MON, cutoff=eat(MON + timedelta(days=1), 7, 30), writer_name="template")
    assert any("No published daily analysis" in m for m in rv.missing)
    with pytest.raises(service.PublishError):
        service.publish(db, rv.id)


def test_weekly_review_without_weekly_analysis_says_so(seeded):
    db = seeded
    wr = service.generate_draft(db, "GBP_USD", "weekly_review", MON, cutoff=eat(MON + timedelta(days=5), 10), writer_name="template")
    assert "No weekly analysis was published for this week" in wr.body_md
    assert "working theme from the daily reports" in wr.body_md


def test_advice_in_manual_edit_blocks_publication(seeded):
    db = seeded
    v = service.generate_draft(db, "GBP_USD", "daily_analysis", MON, cutoff=eat(MON, 8, 30), writer_name="template")
    secs = dict(v.sections["text"])
    secs["analytical_outlook"] = "Buy above resistance and place your stop below support."
    service.update_draft(db, v.id, secs)
    with pytest.raises(service.PublishError) as ei:
        service.publish(db, v.id)
    cats = {f["category"] for f in ei.value.findings}
    assert {"buy_sell_instruction", "stop_loss"} <= cats


def test_invented_number_blocks_publication(seeded):
    db = seeded
    v = service.generate_draft(db, "GBP_USD", "daily_analysis", MON, cutoff=eat(MON, 8, 30), writer_name="template")
    secs = dict(v.sections["text"])
    secs["technical_picture"] = "Resistance sits at 1.98765 [F1]."
    service.update_draft(db, v.id, secs)
    with pytest.raises(service.PublishError) as ei:
        service.publish(db, v.id)
    assert any(f["category"] == "unsupported_number" for f in ei.value.findings)


def test_fixture_reports_cannot_publish_in_production(seeded, monkeypatch):
    db = seeded
    v = service.generate_draft(db, "GBP_USD", "daily_analysis", MON, cutoff=eat(MON, 8, 30), writer_name="template")
    from app import config
    monkeypatch.setattr(config.env(), "app_env", "production")
    with pytest.raises(service.PublishError):
        service.publish(db, v.id)

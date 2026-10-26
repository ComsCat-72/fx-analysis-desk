from datetime import date, datetime, timezone

from app.scheduler import claim, slot_for

UTC = timezone.utc


def test_slots():
    # Monday 08:30 EAT = 05:30 UTC -> Monday's session
    assert slot_for("daily_analysis", datetime(2026, 10, 26, 5, 30, tzinfo=UTC)) == date(2026, 10, 26)
    # Tuesday 07:30 EAT reviews Monday
    assert slot_for("daily_review", datetime(2026, 10, 27, 4, 30, tzinfo=UTC)) == date(2026, 10, 26)
    # Saturday 07:30 EAT reviews Friday
    assert slot_for("daily_review", datetime(2026, 10, 31, 4, 30, tzinfo=UTC)) == date(2026, 10, 30)
    # Sunday 20:00 EAT -> next Monday
    assert slot_for("weekly_analysis", datetime(2026, 10, 25, 17, tzinfo=UTC)) == date(2026, 10, 26)
    # Saturday -> the week that just closed
    assert slot_for("weekly_review", datetime(2026, 10, 31, 7, tzinfo=UTC)) == date(2026, 10, 26)
    # Weekend: no daily analysis
    assert slot_for("daily_analysis", datetime(2026, 10, 31, 7, tzinfo=UTC)) is None


def test_duplicate_slot_is_claimed_once(db):
    assert claim(db, "daily_analysis", "2026-10-26", "GBP_USD") is not None
    assert claim(db, "daily_analysis", "2026-10-26", "GBP_USD") is None
    assert claim(db, "daily_analysis", "2026-10-26", "EUR_USD") is not None

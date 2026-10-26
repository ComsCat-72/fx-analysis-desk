"""Report scheduler. Idempotent: each (job, slot, instrument) runs at most once, enforced by a unique row.

Slots (display timezone, configurable cron in config/app.yaml `schedules`):
  weekly_analysis  -> the Monday of the coming trading week
  daily_analysis   -> the trading day in progress at run time
  daily_review     -> the latest session that has closed
  weekly_review    -> the Monday of the week that has closed
Publication follows reports.publication_mode: 'manual' leaves drafts; 'automatic' publishes drafts that
pass every check (a draft with blocking findings always stays a draft).
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .config import app_config
from .db import session_scope
from .models import JobRun, Setting, now_utc
from .services.registry import instruments, session_def, session_for

log = logging.getLogger("fxdesk.scheduler")
JOBS = ("weekly_analysis", "daily_analysis", "daily_review", "weekly_review")


def publication_mode(db) -> str:
    s = db.get(Setting, "publication_mode")
    return (s.value or {}).get("mode") if s else app_config()["reports"].get("publication_mode", "manual")


def slot_for(job: str, now: datetime) -> date | None:
    """The report period a job run at `now` is responsible for, or None if nothing is due."""
    s = session_def()
    if job == "weekly_analysis":
        d = now.astimezone(timezone.utc).date()
        nxt = d + timedelta(days=(7 - d.weekday()) % 7 or 7) if d.weekday() != 0 else d
        return nxt
    if job == "daily_analysis":
        d = s.trading_day_of(now)
        return d if d and s.is_trading_day(d) else None
    if job == "daily_review":
        d = now.date()
        for _ in range(10):
            if s.is_weekday_session(d) and s.close_at(d) <= now:
                return d if s.is_trading_day(d) else None
            d -= timedelta(days=1)
        return None
    if job == "weekly_review":
        d = now.date()
        for _ in range(14):
            if d.weekday() == s.week_close_weekday and s.close_at(d) <= now:
                return s.week_monday(d)
            d -= timedelta(days=1)
    return None


def claim(db, job: str, slot: str, instrument: str) -> JobRun | None:
    """Insert the unique run row; returns None if this slot was already claimed (duplicate prevention)."""
    run = JobRun(job_name=job, slot_key=slot, instrument=instrument, status="running", attempts=0)
    try:
        with db.begin_nested():
            db.add(run)
            db.flush()
    except IntegrityError:
        return None
    return run


def refresh_inputs(db, instrument: str, now: datetime) -> list[str]:
    """Fetch fresh prices and the calendar before drafting. Failures are recorded, never papered over:
    the report's fact bundle will then show missing or stale data."""
    from .models import ProviderHealth
    from .services import ingest
    from .services.registry import calendar_provider, price_provider
    from sqlalchemy import func, select

    from .models import CandleRow, Setting
    problems = []
    try:
        s = session_for(instrument)
        # First run backfills enough daily history for ATR(14) and SMA(50); later runs only top up.
        n_daily = db.scalar(select(func.count()).select_from(CandleRow).where(
            CandleRow.instrument == instrument, CandleRow.timeframe == "D1")) or 0
        days = 130 if n_daily < 60 else 21
        ingest.ingest_prices(db, price_provider(instrument), instruments()[instrument], s,
                             (now - timedelta(days=days)).date(), now.date(), as_of=now)
    except Exception as e:  # noqa: BLE001
        problems.append(f"prices: {e}")
        db.rollback()
        db.add(ProviderHealth(provider="prices", ok=False, message=str(e)[:500]))
    # The calendar feed is rate limited; refresh it at most every 30 minutes.
    last = db.get(Setting, "calendar_refreshed_at")
    fresh = last and datetime.fromisoformat(last.value["at"]) > now - timedelta(minutes=30)
    if not fresh:
        try:
            ingest.upsert_events(db, calendar_provider().week_events(), now=now)
            ingest.mark_unavailable(db, now)
            db.merge(Setting(key="calendar_refreshed_at", value={"at": now.isoformat()}, updated_at=now))
        except Exception as e:  # noqa: BLE001
            problems.append(f"calendar: {e}")
            db.rollback()
            db.add(ProviderHealth(provider="calendar", ok=False, message=str(e)[:500]))
    db.commit()
    return problems


def data_is_stale(db, instrument: str, now: datetime) -> bool:
    """True when no hourly data is stored, or the market is open and the latest stored bar is over 2h old."""
    from sqlalchemy import select

    from .models import CandleRow
    last = db.scalar(select(CandleRow.end).where(CandleRow.instrument == instrument, CandleRow.timeframe == "H1")
                     .order_by(CandleRow.end.desc()).limit(1))
    if last is None:
        return True
    return session_for(instrument).market_open(now) and now - last > timedelta(hours=2)


def run_job(job: str, instrument: str, now: datetime | None = None, force: bool = False, writer: str | None = None) -> dict:
    from .reports import service
    now = now or datetime.now(timezone.utc)
    period = slot_for(job, now)
    if period is None:
        return {"job": job, "instrument": instrument, "status": "skipped", "reason": "no trading session due (weekend/holiday)"}
    cfg = app_config()["schedules"]
    backoff = cfg.get("backoff_seconds", [30, 120, 600])
    with session_scope() as db:
        run = claim(db, job, period.isoformat(), instrument)
        if run is None and not force:
            return {"job": job, "instrument": instrument, "slot": period.isoformat(), "status": "duplicate"}
        if run is None:  # manual regeneration of an already-run slot
            run = db.scalar(select(JobRun).where(JobRun.job_name == job, JobRun.slot_key == period.isoformat(),
                                                 JobRun.instrument == instrument))
        db.commit()
        problems = refresh_inputs(db, instrument, now)
        last_err = None
        for attempt in range(cfg.get("retries", 3) + 1):
            run.attempts += 1
            try:
                v = service.generate_draft(db, instrument, job, period, cutoff=now, writer_name=writer)
                run.report_version_id = v.id
                status = "drafted"
                if publication_mode(db) == "automatic" and v.checks.get("blocking", 0) == 0:
                    service.publish(db, v.id, change_note="Automatic regeneration" if v.version > 1 else None, now=now)
                    status = "published"
                run.status, run.finished_at, run.error = "succeeded", now_utc(), None
                db.commit()
                return {"job": job, "instrument": instrument, "slot": period.isoformat(), "status": status,
                        "version_id": v.id, "input_problems": problems}
            except Exception as e:  # noqa: BLE001 - recorded and retried
                db.rollback()
                last_err = f"{type(e).__name__}: {e}"
                log.warning("job %s %s attempt %s failed: %s", job, instrument, run.attempts, last_err)
                run = db.merge(run)
                run.error = last_err
                db.commit()
                if attempt < cfg.get("retries", 3):
                    time.sleep(backoff[min(attempt, len(backoff) - 1)])
        run.status, run.finished_at = "failed", now_utc()
        db.commit()
        return {"job": job, "instrument": instrument, "slot": period.isoformat(), "status": "failed", "error": last_err}


def build_scheduler(blocking: bool = False):
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.schedulers.blocking import BlockingScheduler
    from apscheduler.triggers.cron import CronTrigger
    cfg = app_config()
    tz = cfg["display"]["timezone"]
    sched = (BlockingScheduler if blocking else BackgroundScheduler)(timezone=tz)
    for job in JOBS:
        expr = cfg["schedules"].get(job)
        if not expr:
            continue
        for code in instruments():
            sched.add_job(run_job, CronTrigger.from_crontab(expr, timezone=tz), args=[job, code],
                          id=f"{job}:{code}", max_instances=1, coalesce=True, misfire_grace_time=3600)
    return sched


def run_forever():
    logging.basicConfig(level=logging.INFO)
    build_scheduler(blocking=True).start()

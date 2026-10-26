"""Command line: python -m app.cli <command>

  init-db                      apply migrations and load instruments/sessions from config
  ingest --instrument X --from D --to D     fetch prices from the configured provider
  calendar                     fetch this week's calendar from the configured provider
  central-banks                fetch central-bank feeds
  draft KIND INSTRUMENT DATE [--writer template|claude]
  publish VERSION_ID [--note TEXT] [--partial]
  export VERSION_ID --format md|pdf --out PATH
  demo-week [--out DIR]        build a full DEVELOPMENT FIXTURE week in a scratch DB and export examples
  scheduler                    run the report scheduler in the foreground
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


def init_db() -> None:
    from alembic import command
    from alembic.config import Config
    here = Path(__file__).resolve().parents[1]
    cfg = Config(str(here / "alembic.ini"))
    cfg.set_main_option("script_location", str(here / "migrations"))
    command.upgrade(cfg, "head")
    from .db import session_scope
    from .services.bootstrap import sync_config
    with session_scope() as db:
        sync_config(db)
    print("database ready")


def demo_week(out: Path) -> None:
    """Runs the whole connected week on synthetic fixtures with the template writer."""
    os.environ["DATABASE_URL"] = f"sqlite:///{out / 'demo.db'}"
    out.mkdir(parents=True, exist_ok=True)
    (out / "demo.db").unlink(missing_ok=True)
    from . import config, db as appdb
    config.reload()
    appdb.reset_engine()
    init_db()
    from zoneinfo import ZoneInfo
    from .db import session_scope
    from .export import to_pdf
    from .providers.fixtures import FixtureCalendar, FixturePriceProvider, fixture_policy_items
    from .reports import service
    from .services import ingest
    from .services.registry import instruments, session_def

    def eat(d, hh, mm=0):
        return datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZoneInfo("Africa/Kampala")).astimezone(timezone.utc)

    mon = date(2026, 10, 26)
    s = session_def()
    with session_scope() as db:
        ingest.ingest_prices(db, FixturePriceProvider(s), instruments()["GBP_USD"], s, date(2026, 8, 3), date(2026, 10, 30),
                             as_of=datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
        ingest.upsert_events(db, FixtureCalendar(datetime(2026, 10, 26, tzinfo=timezone.utc)).week_events(),
                             now=datetime(2026, 10, 24, tzinfo=timezone.utc))
        ingest.upsert_policy(db, fixture_policy_items(datetime(2026, 10, 26, tzinfo=timezone.utc)))
        written = []

        def pub(v, when, note=None):
            service.publish(db, v.id, change_note=note, now=when)
            written.append(v)

        pub(service.generate_draft(db, "GBP_USD", "weekly_analysis", mon, eat(mon - timedelta(days=1), 20), "template"),
            eat(mon - timedelta(days=1), 20, 5))
        from sqlalchemy import select
        from .models import EconomicEvent
        for i in range(5):
            d = mon + timedelta(days=i)
            pub(service.generate_draft(db, "GBP_USD", "daily_analysis", d, eat(d, 8, 30), "template"), eat(d, 8, 35))
            for ev in db.scalars(select(EconomicEvent).where(EconomicEvent.scheduled_at < s.close_at(d),
                                                             EconomicEvent.scheduled_at >= s.day_bounds(d)[0])):
                ingest.record_actual(db, ev.id, ev.consensus, "FIXTURE", None)
                for h in ev.history:
                    if h.field == "actual":
                        h.recorded_at = ev.scheduled_at + timedelta(minutes=1)
            pub(service.generate_draft(db, "GBP_USD", "daily_review", d, eat(d + timedelta(days=1), 7, 30), "template"),
                eat(d + timedelta(days=1), 7, 35))
        pub(service.generate_draft(db, "GBP_USD", "weekly_review", mon, eat(mon + timedelta(days=5), 10), "template"),
            eat(mon + timedelta(days=5), 10, 5))
        for v in written:
            name = f"{v.report.period_key}_{v.report.kind}"
            (out / f"{name}.md").write_text(v.body_md)
        (out / "weekly_review.pdf").write_bytes(to_pdf(written[-1].body_md, written[-1].title))
    print(f"wrote {len(written)} example reports to {out}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="fxdesk")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db")
    ig = sub.add_parser("ingest")
    ig.add_argument("--instrument", required=True)
    ig.add_argument("--from", dest="start", required=True)
    ig.add_argument("--to", dest="end", required=True)
    sub.add_parser("calendar")
    sub.add_parser("central-banks")
    dr = sub.add_parser("draft")
    dr.add_argument("kind")
    dr.add_argument("instrument")
    dr.add_argument("date")
    dr.add_argument("--writer")
    pb = sub.add_parser("publish")
    pb.add_argument("version_id", type=int)
    pb.add_argument("--note")
    pb.add_argument("--partial", action="store_true")
    ex = sub.add_parser("export")
    ex.add_argument("version_id", type=int)
    ex.add_argument("--format", choices=["md", "pdf"], default="md")
    ex.add_argument("--out", required=True)
    dw = sub.add_parser("demo-week")
    dw.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "docs" / "examples"))
    sub.add_parser("scheduler")
    a = p.parse_args(argv)

    if a.cmd == "init-db":
        init_db()
    elif a.cmd == "demo-week":
        demo_week(Path(a.out))
    elif a.cmd == "scheduler":
        from .scheduler import run_forever
        run_forever()
    else:
        from .db import session_scope
        from .services import ingest
        from .services.registry import calendar_provider, instruments, price_provider, session_def
        with session_scope() as db:
            if a.cmd == "ingest":
                r = ingest.ingest_prices(db, price_provider(), instruments()[a.instrument], session_def(),
                                         date.fromisoformat(a.start), date.fromisoformat(a.end))
                print(r)
            elif a.cmd == "calendar":
                print(ingest.upsert_events(db, calendar_provider().week_events()), "events stored")
            elif a.cmd == "central-banks":
                from .config import app_config
                from .providers.central_banks import CentralBankFeeds
                print(ingest.upsert_policy(db, CentralBankFeeds(app_config()["providers"]["central_banks"]["feeds"]).items()), "items")
            elif a.cmd == "draft":
                from .reports import service
                v = service.generate_draft(db, a.instrument, a.kind, date.fromisoformat(a.date), writer_name=a.writer)
                print(f"draft version {v.id}: {v.checks['blocking']} blocking, {v.checks['warnings']} warnings")
            elif a.cmd == "publish":
                from .reports import service
                v = service.publish(db, a.version_id, a.note, a.partial)
                print(f"published version {v.id} at {v.published_at.isoformat()}")
            elif a.cmd == "export":
                from .export import to_pdf
                from .models import ReportVersion
                v = db.get(ReportVersion, a.version_id)
                Path(a.out).write_bytes(to_pdf(v.body_md, v.title) if a.format == "pdf" else v.body_md.encode())
                print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

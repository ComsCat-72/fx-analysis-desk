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


def replay_week(out: Path, instruments_: list[str], writer: str | None, monday: date | None = None) -> int:
    """Real-data end-to-end run: ingest live prices, calendar and central-bank feeds, then replay the
    last complete week report by report. Each report is generated with its own historical data cutoff,
    so it only sees data that existed at that time. Also drafts this week's weekly and today's daily analysis.
    Writes Markdown reports and summary.json to `out`. Returns the number of failed steps."""
    import json
    from zoneinfo import ZoneInfo

    out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{out / 'replay.db'}")
    from . import config, db as appdb
    config.reload()
    appdb.reset_engine()
    init_db()
    from .config import app_config
    from .db import session_scope
    from .providers.central_banks import CentralBankFeeds
    from .reports import service
    from .services import ingest
    from .services.registry import calendar_provider, instruments, price_provider, price_provider_name, session_for

    tz = ZoneInfo(app_config()["display"]["timezone"])
    now = datetime.now(timezone.utc)

    def local(d, hh, mm=0):
        return datetime(d.year, d.month, d.day, hh, mm, tzinfo=tz).astimezone(timezone.utc)

    summary: dict = {"generated_at": now.isoformat(), "inputs": {}, "reports": []}
    failures = 0
    with session_scope() as db:
        for code in instruments_:
            inst = instruments(False)[code]
            s = session_for(code)
            try:
                r = ingest.ingest_prices(db, price_provider(code), inst, s, (now - timedelta(days=120)).date(), now.date(), as_of=now)
                summary["inputs"][code] = {"ok": True, "provider": price_provider_name(code), **r}
            except Exception as e:  # noqa: BLE001 - recorded in the summary
                failures += 1
                summary["inputs"][code] = {"ok": False, "provider": price_provider_name(code), "error": f"{type(e).__name__}: {e}"}
            db.commit()
        for name, fn in [("calendar", lambda: ingest.upsert_events(db, calendar_provider().week_events(), now=now)),
                         ("central_banks", lambda: ingest.upsert_policy(db, CentralBankFeeds(app_config()["providers"]["central_banks"]["feeds"]).items()))]:
            try:
                summary["inputs"][name] = {"ok": True, "stored": fn()}
            except Exception as e:  # noqa: BLE001
                failures += 1
                summary["inputs"][name] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            db.commit()
        ingest.mark_unavailable(db, now)
        db.commit()
        # Per-session bar coverage, so data gaps are visible in the summary.
        from sqlalchemy import select as _select
        from .models import CandleRow
        summary["coverage"] = {
            code: [{"start": r.start.isoformat(), "bars": r.bars, "expected": r.expected_bars, "complete": r.complete}
                   for r in db.scalars(_select(CandleRow).where(CandleRow.instrument == code, CandleRow.timeframe == "D1",
                                                               CandleRow.start >= now - timedelta(days=16))
                                       .order_by(CandleRow.start))]
            for code in instruments_}

        fx = session_for("GBP_USD")
        mon = monday or fx.week_monday(now.date()) - timedelta(days=7)
        steps = [("weekly_analysis", mon, local(mon - timedelta(days=1), 20))]
        for d in fx.week_trading_days(mon):
            steps.append(("daily_analysis", d, local(d, 8, 30)))
            steps.append(("daily_review", d, local(d + timedelta(days=1), 7, 30)))
        steps.append(("weekly_review", mon, local(mon + timedelta(days=5), 10)))
        this_mon = fx.week_monday(now.date())
        steps.append(("weekly_analysis", this_mon, now))
        if fx.trading_day_of(now):
            steps.append(("daily_analysis", fx.trading_day_of(now), now))

        for code in instruments_:
            if not summary["inputs"].get(code, {}).get("ok"):
                continue
            for kind, period, cutoff in steps:
                rec = {"instrument": code, "kind": kind, "period": period.isoformat(), "cutoff": cutoff.isoformat()}
                try:
                    v = service.generate_draft(db, code, kind, period, cutoff=cutoff, writer_name=writer)
                    rec.update({"version_id": v.id, "data_mode": v.data_mode, "providers": v.facts["meta"].get("providers"),
                                "missing": v.missing, "warnings": [w["message"] for w in v.facts.get("warnings", [])]})
                    try:
                        service.publish(db, v.id, now=cutoff + timedelta(minutes=5))
                        rec["status"] = "published"
                    except service.PublishError as e:
                        rec["status"] = "draft (publication blocked)"
                        rec["blocking"] = [f"{f['check']}/{f['category']}: {f['message']}" for f in e.findings] or [str(e)]
                    (out / f"{code}_{period.isoformat()}_{kind}{'_now' if cutoff == now else ''}.md").write_text(v.body_md)
                except Exception as e:  # noqa: BLE001
                    failures += 1
                    db.rollback()
                    rec.update({"status": "error", "error": f"{type(e).__name__}: {e}"})
                db.commit()
                summary["reports"].append(rec)
    (out / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    pub = sum(r.get("status") == "published" for r in summary["reports"])
    print(f"replay: {pub}/{len(summary['reports'])} reports published, {failures} failed steps; see {out / 'summary.json'}")
    return failures


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
    rp = sub.add_parser("replay-week")
    rp.add_argument("--out", required=True)
    rp.add_argument("--instruments", default="GBP_USD")
    rp.add_argument("--writer", default=None)
    rp.add_argument("--week", default=None, help="Monday of the week to replay (default: last complete week)")
    sub.add_parser("scheduler")
    a = p.parse_args(argv)

    if a.cmd == "init-db":
        init_db()
    elif a.cmd == "demo-week":
        demo_week(Path(a.out))
    elif a.cmd == "replay-week":
        return 1 if replay_week(Path(a.out), a.instruments.split(), a.writer,
                                date.fromisoformat(a.week) if a.week else None) else 0
    elif a.cmd == "scheduler":
        from .scheduler import run_forever
        run_forever()
    else:
        from .db import session_scope
        from .services import ingest
        from .services.registry import calendar_provider, instruments, price_provider, session_for
        with session_scope() as db:
            if a.cmd == "ingest":
                r = ingest.ingest_prices(db, price_provider(a.instrument), instruments()[a.instrument], session_for(a.instrument),
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

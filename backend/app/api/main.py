"""HTTP API for the dashboard. No endpoint places, suggests or signals trades."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import hmac

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import REPO_ROOT, app_config, env
from ..db import get_session
from ..domain.timeutil import format_display, to_zone
from ..export import to_pdf
from ..models import (DataQualityWarning, EconomicEvent, Evaluation, JobRun, NewsItem, Outlook,
                      OutlookChange, ProviderHealth, Report, ReportVersion, Screenshot, Setting, TechnicalLevel,
                      TerminologyTerm, now_utc)
from ..reports import service
from ..services import ingest
from ..services.registry import instruments, price_provider_name, session_def

app = FastAPI(title="FX Analysis Desk", version="0.1.0",
              description="Evidence-based FX analysis and reporting. Analysis only; no trading advice or signals.")
DB = Depends(get_session)

OPEN_PATHS = {"/api/health", "/api/auth/check"}


@app.middleware("http")
async def admin_token_guard(request: Request, call_next):
    """No token configured -> open (local use). Token configured -> writes always need it."""
    token = env().admin_token
    path = request.url.path
    if token and path.startswith("/api/") and path not in OPEN_PATHS:
        needs = request.method not in ("GET", "HEAD", "OPTIONS") or env().protect_reads
        given = request.headers.get("x-admin-token") or request.query_params.get("token") or ""
        if needs and not hmac.compare_digest(given.encode(), token.encode()):
            return JSONResponse({"detail": "admin token required"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/auth/check")
def auth_check(request: Request):
    token = env().admin_token
    given = request.headers.get("x-admin-token") or ""
    return {"token_required": bool(token), "protect_reads": env().protect_reads,
            "valid": (not token) or hmac.compare_digest(given.encode(), token.encode())}


def _tz():
    c = app_config()["display"]
    return c["timezone"], c.get("timezone_label")


def _disp(dt):
    tz, l = _tz()
    return format_display(dt, tz, l) if dt else None


def _version_summary(v: ReportVersion) -> dict:
    o = v.outlook
    return {"id": v.id, "report_id": v.report_id, "kind": v.report.kind, "period_key": v.report.period_key,
            "version": v.version, "version_type": v.version_type, "status": v.status, "title": v.title,
            "writer": v.writer, "data_mode": v.data_mode, "partial": v.partial,
            "created_display": _disp(v.created_at), "published_display": _disp(v.published_at),
            "data_cutoff_display": _disp(v.data_cutoff), "blocking": v.checks.get("blocking", 0),
            "warnings": v.checks.get("warnings", 0), "change_note": v.change_note,
            "direction": o.direction if o else (v.sections.get("outlook") or {}).get("direction")}


# ---------------------------------------------------------------- config
@app.get("/api/config")
def get_config(db: Session = DB):
    cfg, e = app_config(), env()
    mode = db.get(Setting, "publication_mode")
    return {
        "app_env": e.app_env, "display": cfg["display"],
        "instruments": [{"code": i.code, "display": i.display, "base": i.base, "quote": i.quote, "kind": i.kind,
                         "label": i.label, "decimals": i.decimals} for i in instruments().values()],
        "publication_mode": (mode.value or {}).get("mode") if mode else cfg["reports"]["publication_mode"],
        "writer": cfg["reports"]["writer"], "schedules": cfg["schedules"], "technical": cfg["technical"],
        "evaluation": cfg["evaluation"],
        "providers": {"prices": price_provider_name(), "calendar": cfg["providers"]["calendar"],
                      "news": cfg["providers"]["news"], "yields": cfg["providers"]["yields"]},
        "credentials": {"anthropic": bool(e.anthropic_api_key), "oanda": bool(e.oanda_api_token),
                        "oanda_account": bool(e.oanda_account_id), "fred": bool(e.fred_api_key)},
    }


class ModeIn(BaseModel):
    mode: str
    confirm_automatic: bool = False


@app.put("/api/settings/publication-mode")
def set_mode(body: ModeIn, db: Session = DB):
    if body.mode not in ("manual", "automatic"):
        raise HTTPException(400, "mode must be manual or automatic")
    if body.mode == "automatic" and not body.confirm_automatic:
        raise HTTPException(400, "automatic publication must be explicitly confirmed")
    db.merge(Setting(key="publication_mode", value={"mode": body.mode}, updated_at=now_utc()))
    return {"mode": body.mode}


# ---------------------------------------------------------------- week overview
@app.get("/api/weeks/{instrument}/{week_key}")
def week(instrument: str, week_key: str, db: Session = DB):
    monday = session_def().week_monday(date.fromisoformat(week_key))
    reps = db.scalars(select(Report).where(Report.instrument == instrument, Report.week_key == monday.isoformat()))
    out = {"week_key": monday.isoformat(), "instrument": instrument, "days": [], "weekly_analysis": None,
           "weekly_review": None}
    by = {}
    for r in reps:
        by[(r.kind, r.period_key)] = [_version_summary(v) for v in r.versions]
    out["weekly_analysis"] = by.get(("weekly_analysis", monday.isoformat()), [])
    out["weekly_review"] = by.get(("weekly_review", monday.isoformat()), [])
    for d in session_def().week_trading_days(monday):
        out["days"].append({"date": d.isoformat(), "day": d.strftime("%A"),
                            "daily_analysis": by.get(("daily_analysis", d.isoformat()), []),
                            "daily_review": by.get(("daily_review", d.isoformat()), [])})
    changes = db.scalars(select(OutlookChange).where(OutlookChange.instrument == instrument,
                                                     OutlookChange.week_key == monday.isoformat()).order_by(OutlookChange.at))
    out["change_log"] = [{"at": _disp(c.at), "from": c.previous_interpretation, "to": c.new_interpretation,
                          "evidence": c.evidence} for c in changes]
    return out


# ---------------------------------------------------------------- reports
@app.get("/api/reports/{version_id}")
def get_report(version_id: int, db: Session = DB):
    v = db.get(ReportVersion, version_id)
    if not v:
        raise HTTPException(404)
    all_versions = [_version_summary(x) for x in v.report.versions]
    return {**_version_summary(v), "body_md": v.body_md, "checks": v.checks, "sections": v.sections,
            "facts": v.facts, "content_hash": v.content_hash, "versions": all_versions}


class DraftIn(BaseModel):
    instrument: str
    kind: str
    period: date
    writer: str | None = None


@app.post("/api/reports/draft")
def draft(body: DraftIn, db: Session = DB):
    if body.instrument not in instruments():
        raise HTTPException(400, "unknown instrument")
    try:
        v = service.generate_draft(db, body.instrument, body.kind, body.period, writer_name=body.writer)
    except Exception as e:  # surfaced to the UI, never hidden
        raise HTTPException(422, f"{type(e).__name__}: {e}")
    return get_report(v.id, db)


class SectionsIn(BaseModel):
    sections: dict[str, str]
    outlook: dict | None = None


@app.put("/api/reports/{version_id}/draft")
def edit_draft(version_id: int, body: SectionsIn, db: Session = DB):
    try:
        service.update_draft(db, version_id, body.sections, body.outlook)
    except service.PublishError as e:
        raise HTTPException(409, str(e))
    return get_report(version_id, db)


class PublishIn(BaseModel):
    change_note: str | None = None
    allow_partial: bool = False


@app.post("/api/reports/{version_id}/publish")
def publish(version_id: int, body: PublishIn, db: Session = DB):
    try:
        service.publish(db, version_id, body.change_note, body.allow_partial)
    except service.PublishError as e:
        raise HTTPException(409, {"message": str(e), "findings": e.findings})
    return get_report(version_id, db)


class CorrectIn(BaseModel):
    version_type: str = "correction"
    writer: str | None = None


@app.post("/api/reports/{version_id}/correct")
def correct(version_id: int, body: CorrectIn, db: Session = DB):
    if body.version_type not in ("correction", "update"):
        raise HTTPException(400, "version_type must be correction or update")
    try:
        v = service.correct(db, version_id, body.version_type, writer_name=body.writer)
    except service.PublishError as e:
        raise HTTPException(409, str(e))
    return get_report(v.id, db)


@app.get("/api/reports/{version_id}/export.md")
def export_md(version_id: int, db: Session = DB):
    v = db.get(ReportVersion, version_id)
    if not v:
        raise HTTPException(404)
    name = f"{v.report.instrument}_{v.report.kind}_{v.report.period_key}_v{v.version}.md"
    return PlainTextResponse(v.body_md, media_type="text/markdown",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/reports/{version_id}/export.pdf")
def export_pdf(version_id: int, db: Session = DB):
    v = db.get(ReportVersion, version_id)
    if not v:
        raise HTTPException(404)
    name = f"{v.report.instrument}_{v.report.kind}_{v.report.period_key}_v{v.version}.pdf"
    try:
        pdf = to_pdf(v.body_md, v.title)
    except (ImportError, OSError):  # WeasyPrint or its Pango libraries missing (e.g. on Vercel)
        raise HTTPException(501, "PDF export is not available on this host; use the Markdown export")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- calendar
@app.get("/api/calendar")
def calendar(instrument: str, week_key: str, db: Session = DB):
    from ..reports.facts import _event_as_of, event_currencies
    inst = instruments()[instrument]
    monday = session_def().week_monday(date.fromisoformat(week_key))
    ws, we = session_def().week_bounds(monday)
    tz, l = _tz()
    now = datetime.now(timezone.utc)
    rows = []
    for ev in db.scalars(select(EconomicEvent).where(EconomicEvent.currency.in_(event_currencies(inst)),
                                                     EconomicEvent.scheduled_at >= ws - timedelta(days=2),
                                                     EconomicEvent.scheduled_at < we + timedelta(days=1))
                         .order_by(EconomicEvent.scheduled_at)):
        st = _event_as_of(db, ev, now)
        rows.append({"id": ev.id, "currency": ev.currency, "title": ev.title, "impact": ev.impact,
                     "time_eat": to_zone(ev.scheduled_at, tz).strftime("%a %d %b %H:%M"), "time_label": l,
                     "source_time": ev.source_time_text, "consensus": st["consensus"], "previous": st["previous"],
                     "revised_previous": st["revised_previous"], "actual": st["actual"], "state": st["state"],
                     "actual_sources": st["actual_sources"], "source": ev.source, "is_fixture": ev.is_fixture})
    return rows


class ActualIn(BaseModel):
    value: str
    source: str
    url: str | None = None


@app.post("/api/events/{event_id}/actual")
def add_actual(event_id: str, body: ActualIn, db: Session = DB):
    try:
        ev = ingest.record_actual(db, event_id, body.value, body.source, body.url)
    except KeyError:
        raise HTTPException(404)
    return {"state": ev.state, "actual": ev.actual}


@app.post("/api/events/{event_id}/revision")
def add_revision(event_id: str, body: ActualIn, db: Session = DB):
    ev = ingest.record_revision(db, event_id, body.value, body.source, body.url)
    return {"state": ev.state, "revised_previous": ev.revised_previous}


@app.post("/api/calendar/refresh")
def refresh_calendar(db: Session = DB):
    from ..services.registry import calendar_provider
    try:
        n = ingest.upsert_events(db, calendar_provider().week_events())
    except Exception as e:
        ingest.record_health(db, type("H", (), {"provider": "calendar", "ok": False, "latency_ms": None, "message": str(e)}))
        raise HTTPException(502, f"calendar provider failed: {e}")
    return {"stored": n}


# ---------------------------------------------------------------- levels
class LevelIn(BaseModel):
    instrument: str
    lower: float
    upper: float
    timeframe: str = "H1"
    role: str
    reason: str
    approximate: bool = False


@app.get("/api/levels")
def levels(instrument: str, db: Session = DB):
    rows = db.scalars(select(TechnicalLevel).where(TechnicalLevel.instrument == instrument)
                      .order_by(TechnicalLevel.created_at.desc()).limit(100))
    return [{"id": r.id, "lower": r.lower, "upper": r.upper, "timeframe": r.timeframe, "role": r.role,
             "origin": r.origin, "reason": r.reason, "status": r.status, "approximate": r.approximate,
             "created_display": _disp(r.created_at), "is_fixture": r.is_fixture} for r in rows]


@app.post("/api/levels")
def add_level(body: LevelIn, db: Session = DB):
    if body.role not in ("support", "resistance") or body.lower > body.upper:
        raise HTTPException(400, "role must be support/resistance and lower <= upper")
    r = TechnicalLevel(instrument=body.instrument, lower=body.lower, upper=body.upper, timeframe=body.timeframe,
                       role=body.role, origin="user", reason=body.reason, approximate=body.approximate)
    db.add(r)
    db.flush()
    return {"id": r.id}


class LevelStatusIn(BaseModel):
    status: str
    reason: str


@app.patch("/api/levels/{level_id}")
def level_status(level_id: int, body: LevelStatusIn, db: Session = DB):
    from ..models import LevelStatusHistory
    if body.status not in ("invalidated", "archived", "active"):
        raise HTTPException(400, "manual status changes: invalidated, archived or active")
    r = db.get(TechnicalLevel, level_id)
    db.add(LevelStatusHistory(level_id=r.id, from_status=r.status, to_status=body.status, reason=body.reason))
    r.status, r.updated_at = body.status, now_utc()
    return {"id": r.id, "status": r.status}


# ---------------------------------------------------------------- evidence, warnings, evaluations
@app.get("/api/warnings")
def warnings(instrument: str | None = None, db: Session = DB):
    q = select(DataQualityWarning).where(DataQualityWarning.resolved_at.is_(None))
    if instrument:
        q = q.where((DataQualityWarning.instrument == instrument) | DataQualityWarning.instrument.is_(None))
    return [{"id": w.id, "code": w.code, "severity": w.severity, "message": w.message, "created_display": _disp(w.created_at)}
            for w in db.scalars(q.order_by(DataQualityWarning.created_at.desc()).limit(50))]


@app.get("/api/freshness")
def freshness(instrument: str, db: Session = DB):
    from ..models import CandleRow
    s = session_def()
    now = datetime.now(timezone.utc)
    last = db.scalar(select(CandleRow).where(CandleRow.instrument == instrument, CandleRow.timeframe == "H1",
                                             CandleRow.complete.is_(True)).order_by(CandleRow.end.desc()))
    out = {"market_open": s.market_open(now), "last_h1_close": _disp(last.end) if last else None,
           "provider": last.provider if last else None, "is_fixture": bool(last and last.is_fixture)}
    if last is None:
        out["status"], out["message"] = "missing", "No price data stored for this instrument."
    else:
        age_h = (now - last.end).total_seconds() / 3600
        stale = s.market_open(now) and age_h > 2
        out["status"] = "stale" if stale else "ok"
        out["age_hours"] = round(age_h, 1)
        out["message"] = (f"Latest complete 1H candle is {age_h:.1f} hours old." if stale else
                          "Market closed; latest data is from the last session." if not s.market_open(now) else "Fresh")
    return out


@app.get("/api/evaluations")
def evaluations(instrument: str, db: Session = DB):
    rows = db.execute(select(Evaluation, Outlook, ReportVersion, Report)
                      .join(Outlook, Evaluation.outlook_id == Outlook.id)
                      .join(ReportVersion, Outlook.report_version_id == ReportVersion.id)
                      .join(Report, ReportVersion.report_id == Report.id)
                      .where(Outlook.instrument == instrument).order_by(Report.period_key.desc()).limit(60)).all()
    return [{"period_key": r.period_key, "kind": o.kind, "direction": o.direction, "qualification": o.qualification,
             "version": v.version, "directional": e.directional, "detail": e.directional_detail,
             "conditional": e.conditional, "evaluated_display": _disp(e.evaluated_at)} for e, o, v, r in rows]


class NewsIn(BaseModel):
    source_name: str
    title: str
    url: str | None = None
    published_at: datetime
    summary: str | None = None
    currencies: list[str] = []


@app.post("/api/news")
def add_news(body: NewsIn, db: Session = DB):
    if body.published_at.tzinfo is None:
        raise HTTPException(400, "published_at must include a timezone offset")
    n = ingest.add_news(db, body.source_name, body.title, body.url, body.published_at, body.summary, body.currencies)
    return {"id": n.id}


@app.get("/api/news")
def list_news(db: Session = DB):
    return [{"id": n.id, "source_name": n.source_name, "title": n.title, "url": n.url, "entered_by": n.entered_by,
             "published_display": _disp(n.published_at), "currencies": n.currencies}
            for n in db.scalars(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(50))]


# ---------------------------------------------------------------- screenshots
@app.post("/api/screenshots")
async def upload_screenshot(instrument: str = Form(...), file: UploadFile = File(...), extract: bool = Form(False),
                            db: Session = DB):
    from ..services import screenshots as ss
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(413, "screenshot larger than 8 MB")
    if file.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(415, "PNG, JPEG or WebP only")
    path = ss.save_upload(data, file.filename or "chart.png")
    extracted = ss.extract(path, file.content_type) if extract else {"status": "manual_entry_required"}
    row = Screenshot(instrument=instrument, file_path=str(path), timeframe=extracted.get("timeframe"),
                     extracted=extracted, status="needs_confirmation")
    db.add(row)
    db.flush()
    return {"id": row.id, "extracted": extracted}


class ConfirmIn(BaseModel):
    levels: list[LevelIn]
    chart_timestamp: datetime | None = None


@app.post("/api/screenshots/{sid}/confirm")
def confirm_screenshot(sid: int, body: ConfirmIn, db: Session = DB):
    s = db.get(Screenshot, sid)
    if not s:
        raise HTTPException(404)
    ids = []
    for lv in body.levels:
        r = TechnicalLevel(instrument=s.instrument, lower=lv.lower, upper=lv.upper, timeframe=lv.timeframe, role=lv.role,
                           origin="screenshot", reason=lv.reason, approximate=lv.approximate,
                           source_ref=f"screenshot:{sid}", created_at=body.chart_timestamp or now_utc())
        db.add(r)
        db.flush()
        ids.append(r.id)
    s.status = "confirmed"
    s.chart_timestamp = body.chart_timestamp
    return {"level_ids": ids}


# ---------------------------------------------------------------- providers, jobs, terminology
@app.get("/api/providers/health")
def provider_health(db: Session = DB):
    rows = db.scalars(select(ProviderHealth).order_by(ProviderHealth.checked_at.desc()).limit(30))
    return [{"provider": r.provider, "ok": r.ok, "latency_ms": r.latency_ms, "message": r.message,
             "checked_display": _disp(r.checked_at)} for r in rows]


class IngestIn(BaseModel):
    instrument: str
    start: date
    end: date


@app.post("/api/ingest")
def run_ingest(body: IngestIn, db: Session = DB):
    from ..services.registry import price_provider
    try:
        r = ingest.ingest_prices(db, price_provider(), instruments()[body.instrument], session_def(), body.start, body.end)
    except Exception as e:
        ingest.record_health(db, type("H", (), {"provider": price_provider_name(), "ok": False, "latency_ms": None, "message": str(e)}))
        raise HTTPException(502, f"{type(e).__name__}: {e}")
    return r


@app.get("/api/jobs")
def jobs(db: Session = DB):
    return [{"job": j.job_name, "slot": j.slot_key, "instrument": j.instrument, "status": j.status, "attempts": j.attempts,
             "error": j.error, "started_display": _disp(j.started_at), "version_id": j.report_version_id}
            for j in db.scalars(select(JobRun).order_by(JobRun.started_at.desc()).limit(50))]


class JobIn(BaseModel):
    job: str
    instrument: str
    force: bool = False


@app.post("/api/jobs/run")
def run_job_now(body: JobIn):
    from ..scheduler import run_job
    return run_job(body.job, body.instrument, force=body.force)


@app.get("/api/terminology")
def terminology(db: Session = DB):
    d = service.dictionary(db)
    return {"approved": d.approved, "prohibited": d.prohibited, "abbreviations": d.abbreviations}


class TermIn(BaseModel):
    kind: str
    term: str
    definition: str | None = None
    alternatives: list[str] = []
    prohibited_alternatives: list[str] = []
    suggest: str | None = None
    enabled: bool = True


@app.post("/api/terminology")
def add_term(body: TermIn, db: Session = DB):
    if body.kind not in ("approved", "prohibited", "abbreviation"):
        raise HTTPException(400)
    row = db.scalar(select(TerminologyTerm).where(TerminologyTerm.kind == body.kind, TerminologyTerm.term == body.term))
    row = row or TerminologyTerm(kind=body.kind, term=body.term)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    db.add(row)
    return {"ok": True}


# ---------------------------------------------------------------- frontend
DIST = REPO_ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")

"""Report lifecycle: draft -> checks -> preview -> publish (immutable) -> corrections as new versions."""
from __future__ import annotations

import hashlib
from dataclasses import asdict
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import app_config, env, terminology_config
from ..content.advice import Finding
from ..content.checks import run_deterministic, summarize
from ..content.semantic import semantic_review
from ..content.terminology import Dictionary
from ..domain.evaluation import DIRECTION_LABELS, Direction
from ..models import Evaluation, Outlook, OutlookChange, Report, ReportVersion, TerminologyTerm
from ..services.registry import instruments, session_def, session_for
from .facts import build_bundle, published_versions
from .render import render
from .templates import ANALYSIS_KINDS, headings
from .writer import TemplateWriter, WriterError, get_writer


class PublishError(RuntimeError):
    def __init__(self, message: str, findings: list | None = None):
        super().__init__(message)
        self.findings = findings or []


def dictionary(db: Session) -> Dictionary:
    return Dictionary.load(terminology_config(), list(db.scalars(select(TerminologyTerm))))


def _week_key(kind: str, period: date) -> str:
    s = session_def()
    return s.week_monday(period).isoformat()


def get_or_create_report(db: Session, instrument: str, kind: str, period: date) -> Report:
    pk = (session_def().week_monday(period) if kind in ("weekly_analysis", "weekly_review") else period).isoformat()
    r = db.scalar(select(Report).where(Report.instrument == instrument, Report.kind == kind, Report.period_key == pk))
    if r is None:
        r = Report(instrument=instrument, kind=kind, period_key=pk, week_key=_week_key(kind, period))
        db.add(r)
        db.flush()
    return r


def _validate_outlook(outlook: dict | None, bundle: dict) -> list[Finding]:
    if outlook is None:
        return []
    out = []
    levels = bundle["levels"]
    for c in outlook.get("conditions", []):
        if c["level_id"] not in levels:
            out.append(Finding("outlook", "unknown_level", "blocking", f"Condition refers to unknown level {c['level_id']}."))
    for lid in outlook.get("zone_ids", []) + outlook.get("range_level_ids", []):
        if lid not in levels:
            out.append(Finding("outlook", "unknown_level", "blocking", f"Outlook refers to unknown level {lid}."))
    if outlook.get("direction") == "range_bound" and len(outlook.get("range_level_ids", [])) != 2:
        out.append(Finding("outlook", "range_without_bounds", "warning", "Range-bound outlook without two range levels; assessed without a range."))
    return out


def _checks(db: Session, kind: str, bundle: dict, sections: dict, outlook: dict | None, body: str,
            run_semantic: bool) -> dict:
    cfg = app_config()
    inst = instruments(False)[bundle["meta"]["instrument"]]
    bounds = tuple(cfg["reports"]["length_words"].get(kind, [])) or None
    findings = run_deterministic(sections, bundle, dictionary(db), bounds, inst.decimals)
    findings += _validate_outlook(outlook, bundle)
    if outlook and outlook.get("qualification"):
        from ..content.advice import detect_advice
        findings += detect_advice(outlook["qualification"], "bias")
        for c in outlook.get("conditions", []):
            findings += detect_advice(c.get("text", ""), "conditions")
    if run_semantic:
        findings += semantic_review(body, bundle)
    if bundle["meta"].get("data_mode") == "fixture" and env().is_production:
        findings.append(Finding("data", "fixture_in_production", "blocking", "Fixture data cannot be used in production."))
    return summarize(findings)


def generate_draft(db: Session, instrument: str, kind: str, period: date, cutoff: datetime | None = None,
                   writer_name: str | None = None, version_type: str | None = None, max_revisions: int = 1) -> ReportVersion:
    cutoff = cutoff or datetime.now(timezone.utc)
    inst = instruments(False)[instrument]
    s = session_for(instrument)
    report = get_or_create_report(db, instrument, kind, period)
    bundle = build_bundle(db, inst, kind, period, cutoff, s).to_dict()
    hd = headings(kind, bundle["meta"], bundle.get("evaluation"))
    writer = get_writer(writer_name)
    bounds = tuple(app_config()["reports"]["length_words"].get(kind, [])) or None
    result = writer.write(kind, bundle, hd, bounds)
    notes = None
    for _ in range(max_revisions if not isinstance(writer, TemplateWriter) else 0):
        pre = run_deterministic(result["sections"], bundle, dictionary(db), bounds, inst.decimals)
        notes = [f"{f.message} Text: \"{f.excerpt}\"" + (f" Suggestion: {f.suggestion}" if f.suggestion else "")
                 for f in pre if f.severity == "blocking" and f.check != "data"]
        if not notes:
            break
        result = writer.write(kind, bundle, hd, bounds, revision_notes=notes)

    has_published = db.scalar(select(func.count()).select_from(ReportVersion).where(
        ReportVersion.report_id == report.id, ReportVersion.status == "published")) > 0
    vnum = (db.scalar(select(func.max(ReportVersion.version)).where(ReportVersion.report_id == report.id)) or 0) + 1
    vtype = "original" if not has_published else (version_type or "correction")
    title, body = render(kind, bundle, result["sections"], result.get("outlook"), hd, version=vnum, version_type=vtype)
    checks = _checks(db, kind, bundle, result["sections"], result.get("outlook"), body,
                     run_semantic=not isinstance(writer, TemplateWriter))
    if isinstance(writer, TemplateWriter):
        checks["findings"].append(asdict(Finding("semantic", "not_run", "info",
                                                 "Template writer: text consists only of deterministic sentences; semantic review skipped.")))
    v = ReportVersion(report_id=report.id, version=vnum, status="draft", version_type=vtype, title=title, body_md=body,
                      sections={"text": result["sections"], "outlook": result.get("outlook"), "headings": hd,
                                "revision_notes": notes or []},
                      facts=bundle, checks=checks, data_cutoff=cutoff, writer=writer.name, model=result.get("model"),
                      data_mode=bundle["meta"]["data_mode"], partial=False, missing=bundle.get("missing", []))
    db.add(v)
    db.flush()
    return v


def update_draft(db: Session, version_id: int, sections: dict[str, str], outlook: dict | None = None) -> ReportVersion:
    """Manual edits to a draft. Re-renders and re-runs checks. Published versions cannot be edited."""
    v = db.get(ReportVersion, version_id)
    if v.status != "draft":
        raise PublishError("only drafts can be edited; correct a published report as a new version")
    kind = v.report.kind
    outlook = outlook if outlook is not None else v.sections.get("outlook")
    hd = v.sections["headings"]
    title, body = render(kind, v.facts, sections, outlook, hd, version=v.version, version_type=v.version_type)
    v.title, v.body_md = title, body
    v.sections = {**v.sections, "text": sections, "outlook": outlook, "edited_manually": True}
    v.checks = _checks(db, kind, v.facts, sections, outlook, body, run_semantic=bool(env().anthropic_api_key))
    db.flush()
    return v


def publish(db: Session, version_id: int, change_note: str | None = None, allow_partial: bool = False,
            now: datetime | None = None) -> ReportVersion:
    now = now or datetime.now(timezone.utc)
    v = db.get(ReportVersion, version_id)
    if v is None:
        raise PublishError("no such version")
    if v.status != "draft":
        raise PublishError(f"version is {v.status}, not a draft")
    if v.data_mode == "fixture" and env().is_production:
        raise PublishError("fixture-based reports cannot be published in production")
    if v.version > 1 and not change_note:
        raise PublishError("a correction or update needs a change note")
    kind = v.report.kind
    outlook = v.sections.get("outlook")
    checks = _checks(db, kind, v.facts, v.sections["text"], outlook, v.body_md, run_semantic=False)
    # keep stored semantic findings from the draft step
    checks["findings"] += [f for f in v.checks.get("findings", []) if f["check"] == "semantic"]
    content_block = [f for f in checks["findings"] if f["severity"] == "blocking" and f["check"] != "data"]
    data_block = [f for f in checks["findings"] if f["severity"] == "blocking" and f["check"] == "data"]
    if content_block:
        raise PublishError(f"{len(content_block)} blocking content finding(s); revise the draft", content_block)
    partial = False
    if data_block:
        if app_config()["reports"].get("partial_publication") == "label" and allow_partial:
            partial = True
        else:
            raise PublishError(f"{len(data_block)} blocking data finding(s): essential data missing or unverified", data_block)
    hd = v.sections["headings"]
    _, body = render(kind, v.facts, v.sections["text"], outlook, hd, version=v.version, version_type=v.version_type,
                     published=now, change_note=change_note, partial=partial)
    v.body_md = body
    v.checks = {**checks, "blocking": 0}
    v.change_note = change_note
    v.partial = partial
    v.published_at = now
    v.content_hash = hashlib.sha256(body.encode()).hexdigest()
    prev = published_versions(db, v.report.instrument, kind, period_key=v.report.period_key)
    if prev:
        v.supersedes_id = prev[-1].id
    v.status = "published"
    db.flush()
    for other in db.scalars(select(ReportVersion).where(ReportVersion.report_id == v.report_id,
                                                        ReportVersion.status == "draft", ReportVersion.id != v.id)):
        other.status = "discarded"
    if kind in ANALYSIS_KINDS and outlook:
        _store_outlook(db, v, outlook, now, change_note)
    if kind == "daily_review":
        _store_evaluation(db, v)
    db.flush()
    return v


def _store_outlook(db: Session, v: ReportVersion, outlook: dict, now: datetime, change_note: str | None):
    b = v.facts
    meta, levels = b["meta"], b["levels"]
    conds = []
    for i, c in enumerate(outlook.get("conditions", []), 1):
        lv = levels[c["level_id"]]
        conds.append({"id": i, "text": c["text"], "level_id": lv["db_id"], "boundary": lv[c["boundary"]],
                      "boundary_edge": c["boundary"], "side": c["side"], "effect": c["effect"]})
    rng = [levels[x] for x in outlook.get("range_level_ids", []) if x in levels]
    weekly = (b.get("continuity") or {}).get("weekly")
    o = Outlook(report_version_id=v.id, instrument=meta["instrument"],
                kind="weekly" if v.report.kind == "weekly_analysis" else "daily",
                direction=outlook["direction"], qualification=outlook.get("qualification"),
                horizon_start=datetime.fromisoformat(meta["horizon_start"]), horizon_end=datetime.fromisoformat(meta["horizon_end"]),
                reference_price=meta.get("reference_price"),
                reference_time=datetime.fromisoformat(meta["reference_time"]) if meta.get("reference_time") else None,
                atr_at_publication=meta.get("atr_d1"),
                range_lower=min(l["lower"] for l in rng) if len(rng) == 2 else None,
                range_upper=max(l["upper"] for l in rng) if len(rng) == 2 else None,
                conditions=conds, published_zone_ids=[levels[x]["db_id"] for x in outlook.get("zone_ids", []) if x in levels],
                weekly_context_version_id=weekly["version_id"] if weekly and v.report.kind == "daily_analysis" else None,
                rules={"breaks": meta["break_rules"], "evaluation": app_config()["evaluation"]},
                evidence=sorted({*b["facts"], *b["levels"], *b["events"], *b["policy"]}))
    db.add(o)
    db.flush()
    # Outlook change log: compare with the most recent published outlook for this instrument and week.
    prev = db.scalar(select(Outlook).join(ReportVersion, Outlook.report_version_id == ReportVersion.id)
                     .join(Report).where(Report.instrument == meta["instrument"], Report.week_key == meta["week_key"],
                                         Report.kind.in_(ANALYSIS_KINDS), ReportVersion.status == "published",
                                         Outlook.id != o.id).order_by(ReportVersion.published_at.desc()))
    if prev is not None and (prev.direction != o.direction or v.version_type in ("correction", "update")):
        lab = lambda x: DIRECTION_LABELS[Direction(x.direction)] + (f" ({x.qualification})" if x.qualification else "")  # noqa: E731
        db.add(OutlookChange(instrument=meta["instrument"], week_key=meta["week_key"], at=now,
                             previous_version_id=prev.report_version_id, new_version_id=v.id,
                             previous_interpretation=lab(prev), new_interpretation=lab(o),
                             evidence=change_note or (v.sections["text"].get("market_context") or v.sections["text"].get("weekly_bias") or "")[:600]))


def _store_evaluation(db: Session, v: ReportVersion):
    ev = v.facts.get("evaluation") or {}
    orig = ev.get("original")
    if not orig:
        return
    o = db.scalar(select(Outlook).where(Outlook.report_version_id == orig["version_id"]))
    if o is None:
        return
    db.add(Evaluation(outlook_id=o.id, directional=ev["directional"]["outcome"], directional_detail=ev["directional"],
                      conditional=ev.get("conditional", []),
                      session_ohlc=v.facts["facts"].get(ev.get("session_fact"), {}).get("values")))


def correct(db: Session, version_id: int, version_type: str = "correction", cutoff: datetime | None = None,
            writer_name: str | None = None) -> ReportVersion:
    """Create a new draft version for a published report. The published version is untouched.
    'correction' keeps the original data cutoff (fixes errors); 'update' uses a new cutoff (intraday update)."""
    v = db.get(ReportVersion, version_id)
    if v.status != "published":
        raise PublishError("only published versions can be corrected")
    r = v.report
    period = date.fromisoformat(r.period_key)
    use_cutoff = v.data_cutoff if version_type == "correction" else (cutoff or datetime.now(timezone.utc))
    return generate_draft(db, r.instrument, r.kind, period, use_cutoff, writer_name or v.writer, version_type)

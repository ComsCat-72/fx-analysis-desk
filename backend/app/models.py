"""Persistence model. Every factual record keeps its source, timestamps and fixture flag."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Instrument(Base):
    __tablename__ = "instruments"
    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    display: Mapped[str] = mapped_column(String(40))
    base: Mapped[str] = mapped_column(String(10))
    quote: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(20))
    decimals: Mapped[int] = mapped_column(Integer)
    provider_symbol: Mapped[str | None] = mapped_column(String(40))
    label: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class SessionDefinition(Base):
    __tablename__ = "session_definitions"
    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    anchor_timezone: Mapped[str] = mapped_column(String(64))
    daily_close: Mapped[str] = mapped_column(String(5))
    week_open_weekday: Mapped[int] = mapped_column(Integer)
    week_close_weekday: Mapped[int] = mapped_column(Integer)
    holidays: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str | None] = mapped_column(Text)


class CandleRow(Base):
    __tablename__ = "candles"
    __table_args__ = (UniqueConstraint("instrument", "timeframe", "start", "provider", "price_component"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    timeframe: Mapped[str] = mapped_column(String(4))
    start: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    end: Mapped[datetime] = mapped_column(UTCDateTime)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float | None] = mapped_column(Float)
    complete: Mapped[bool] = mapped_column(Boolean)
    provider: Mapped[str] = mapped_column(String(60))
    price_component: Mapped[str] = mapped_column(String(4), default="M")
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)
    retrieved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)


class QuoteRow(Base):
    __tablename__ = "quotes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    time: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    bid: Mapped[float | None] = mapped_column(Float)
    ask: Mapped[float | None] = mapped_column(Float)
    mid: Mapped[float] = mapped_column(Float)
    provider: Mapped[str] = mapped_column(String(60))
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)
    retrieved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)


class EconomicEvent(Base):
    __tablename__ = "economic_events"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # deterministic hash of source key
    source: Mapped[str] = mapped_column(String(60))
    source_event_key: Mapped[str] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(String(40))
    currency: Mapped[str] = mapped_column(String(10), index=True)
    title: Mapped[str] = mapped_column(Text)
    period: Mapped[str | None] = mapped_column(String(40))
    scheduled_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    source_time_text: Mapped[str | None] = mapped_column(String(64))   # original timestamp string
    source_timezone: Mapped[str | None] = mapped_column(String(64))
    impact: Mapped[str | None] = mapped_column(String(20))
    unit: Mapped[str | None] = mapped_column(String(10))
    consensus: Mapped[str | None] = mapped_column(String(40))
    previous: Mapped[str | None] = mapped_column(String(40))
    revised_previous: Mapped[str | None] = mapped_column(String(40))
    actual: Mapped[str | None] = mapped_column(String(40))
    actual_source: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str] = mapped_column(String(20), default="scheduled")
    higher_supports_tighter_policy: Mapped[bool | None] = mapped_column(Boolean)
    last_update: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)
    history: Mapped[list["EventValueHistory"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class EventValueHistory(Base):
    """Every value ever recorded for an event, per source. Revisions append; nothing is overwritten."""
    __tablename__ = "event_value_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("economic_events.id"), index=True)
    field: Mapped[str] = mapped_column(String(30))  # actual | consensus | previous | revised_previous | scheduled_at | state
    value: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(120))
    source_url: Mapped[str | None] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    event: Mapped[EconomicEvent] = relationship(back_populates="history")


class PolicyItem(Base):
    __tablename__ = "policy_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bank: Mapped[str] = mapped_column(String(20), index=True)
    currency: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(20))  # decision | statement | speech | minutes | schedule | press
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    speaker: Mapped[str | None] = mapped_column(String(120))
    published_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    summary: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(120))
    retrieved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("bank", "url"),)


class NewsItem(Base):
    __tablename__ = "news_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    summary: Mapped[str | None] = mapped_column(Text)
    currencies: Mapped[list] = mapped_column(JSON, default=list)
    entered_by: Mapped[str] = mapped_column(String(20), default="user")  # user | feed
    retrieved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)


class UserObservation(Base):
    __tablename__ = "user_observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    text: Mapped[str] = mapped_column(Text)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    screenshot_id: Mapped[int | None] = mapped_column(ForeignKey("screenshots.id"))


class Screenshot(Base):
    __tablename__ = "screenshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    file_path: Mapped[str] = mapped_column(Text)
    timeframe: Mapped[str | None] = mapped_column(String(10))
    chart_timestamp: Mapped[datetime | None] = mapped_column(UTCDateTime)
    extracted: Mapped[dict] = mapped_column(JSON, default=dict)  # candidate levels, annotations (approximate)
    status: Mapped[str] = mapped_column(String(30), default="needs_confirmation")
    uploaded_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)


class TechnicalLevel(Base):
    __tablename__ = "technical_levels"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    lower: Mapped[float] = mapped_column(Float)
    upper: Mapped[float] = mapped_column(Float)
    timeframe: Mapped[str] = mapped_column(String(4))
    role: Mapped[str] = mapped_column(String(20))      # support | resistance
    origin: Mapped[str] = mapped_column(String(20))    # user | automated | screenshot
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")
    approximate: Mapped[bool] = mapped_column(Boolean, default=False)
    source_ref: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    is_fixture: Mapped[bool] = mapped_column(Boolean, default=False)


class LevelStatusHistory(Base):
    __tablename__ = "level_status_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    level_id: Mapped[int] = mapped_column(ForeignKey("technical_levels.id"), index=True)
    from_status: Mapped[str] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    reason: Mapped[str] = mapped_column(Text)


class Report(Base):
    """A logical report slot, e.g. GBP_USD daily_analysis 2026-10-27. Content lives in versions."""
    __tablename__ = "reports"
    __table_args__ = (UniqueConstraint("instrument", "kind", "period_key"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    kind: Mapped[str] = mapped_column(String(20))       # weekly_analysis | daily_analysis | daily_review | weekly_review
    period_key: Mapped[str] = mapped_column(String(20))  # ISO date; weekly kinds use the week's Monday
    week_key: Mapped[str] = mapped_column(String(10), index=True)  # Monday of the trading week
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    versions: Mapped[list["ReportVersion"]] = relationship(back_populates="report", order_by="ReportVersion.version")


class ImmutableReportError(RuntimeError):
    pass


class ReportVersion(Base):
    __tablename__ = "report_versions"
    __table_args__ = (UniqueConstraint("report_id", "version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(ForeignKey("reports.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | published | discarded
    version_type: Mapped[str] = mapped_column(String(20), default="original")  # original | correction | update
    title: Mapped[str] = mapped_column(Text)
    body_md: Mapped[str] = mapped_column(Text)
    sections: Mapped[dict] = mapped_column(JSON, default=dict)
    facts: Mapped[dict] = mapped_column(JSON, default=dict)     # the exact fact bundle the text was written from
    checks: Mapped[dict] = mapped_column(JSON, default=dict)
    data_cutoff: Mapped[datetime] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    change_note: Mapped[str | None] = mapped_column(Text)
    supersedes_id: Mapped[int | None] = mapped_column(ForeignKey("report_versions.id"))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    writer: Mapped[str] = mapped_column(String(40))
    model: Mapped[str | None] = mapped_column(String(60))
    data_mode: Mapped[str] = mapped_column(String(20))    # live | fixture
    partial: Mapped[bool] = mapped_column(Boolean, default=False)
    missing: Mapped[list] = mapped_column(JSON, default=list)
    report: Mapped[Report] = relationship(back_populates="versions")
    outlook: Mapped["Outlook | None"] = relationship(back_populates="report_version", uselist=False,
                                                     foreign_keys="Outlook.report_version_id")


# Published versions are immutable. Any attempted change raises; corrections are new versions.
_IMMUTABLE_FIELDS = {"title", "body_md", "sections", "facts", "checks", "data_cutoff", "published_at",
                     "content_hash", "status", "version", "report_id", "writer", "model", "data_mode", "partial",
                     "missing", "change_note", "version_type", "supersedes_id"}


@event.listens_for(ReportVersion, "before_update")
def _block_published_updates(mapper, connection, target: ReportVersion):
    from sqlalchemy import inspect
    state = inspect(target)
    hist_status = state.attrs.status.history
    was_published = (hist_status.deleted and hist_status.deleted[0] == "published") or \
                    (not hist_status.has_changes() and target.status == "published")
    if not was_published:
        return
    changed = {a.key for a in state.attrs if a.key in _IMMUTABLE_FIELDS and a.history.has_changes()}
    if changed:
        raise ImmutableReportError(f"published report version {target.id} is immutable (attempted: {sorted(changed)})")


@event.listens_for(ReportVersion, "before_delete")
def _block_published_delete(mapper, connection, target: ReportVersion):
    if target.status == "published":
        raise ImmutableReportError("published report versions cannot be deleted")


class Outlook(Base):
    """Structured analytical expectation stored at publication, used verbatim by reviews."""
    __tablename__ = "outlooks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_version_id: Mapped[int] = mapped_column(ForeignKey("report_versions.id"), unique=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    kind: Mapped[str] = mapped_column(String(10))       # weekly | daily
    direction: Mapped[str] = mapped_column(String(20))
    qualification: Mapped[str | None] = mapped_column(Text)
    horizon_start: Mapped[datetime] = mapped_column(UTCDateTime)
    horizon_end: Mapped[datetime] = mapped_column(UTCDateTime)
    reference_price: Mapped[float | None] = mapped_column(Float)
    reference_time: Mapped[datetime | None] = mapped_column(UTCDateTime)
    atr_at_publication: Mapped[float | None] = mapped_column(Float)
    range_lower: Mapped[float | None] = mapped_column(Float)
    range_upper: Mapped[float | None] = mapped_column(Float)
    conditions: Mapped[list] = mapped_column(JSON, default=list)   # [{id, text, boundary, side, effect, level_id}]
    published_zone_ids: Mapped[list] = mapped_column(JSON, default=list)
    weekly_context_version_id: Mapped[int | None] = mapped_column(ForeignKey("report_versions.id"))
    rules: Mapped[dict] = mapped_column(JSON, default=dict)        # break + evaluation rules in force
    evidence: Mapped[list] = mapped_column(JSON, default=list)     # fact ids
    report_version: Mapped[ReportVersion] = relationship(back_populates="outlook", foreign_keys=[report_version_id])


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlook_id: Mapped[int] = mapped_column(ForeignKey("outlooks.id"), index=True)
    evaluated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    directional: Mapped[str] = mapped_column(String(30))
    directional_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    conditional: Mapped[list] = mapped_column(JSON, default=list)
    session_ohlc: Mapped[dict | None] = mapped_column(JSON)


class OutlookChange(Base):
    __tablename__ = "outlook_changes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str] = mapped_column(String(20), index=True)
    week_key: Mapped[str] = mapped_column(String(10), index=True)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    previous_version_id: Mapped[int | None] = mapped_column(ForeignKey("report_versions.id"))
    new_version_id: Mapped[int] = mapped_column(ForeignKey("report_versions.id"))
    previous_interpretation: Mapped[str | None] = mapped_column(Text)
    new_interpretation: Mapped[str] = mapped_column(Text)
    evidence: Mapped[str] = mapped_column(Text)


class JobRun(Base):
    __tablename__ = "job_runs"
    __table_args__ = (UniqueConstraint("job_name", "slot_key", "instrument"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_name: Mapped[str] = mapped_column(String(40))
    slot_key: Mapped[str] = mapped_column(String(40))
    instrument: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | succeeded | failed | skipped
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    error: Mapped[str | None] = mapped_column(Text)
    report_version_id: Mapped[int | None] = mapped_column(ForeignKey("report_versions.id"))


class ProviderHealth(Base):
    __tablename__ = "provider_health"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(60), index=True)
    checked_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    ok: Mapped[bool] = mapped_column(Boolean)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str | None] = mapped_column(Text)


class DataQualityWarning(Base):
    __tablename__ = "data_quality_warnings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument: Mapped[str | None] = mapped_column(String(20), index=True)
    code: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(10))
    message: Mapped[str] = mapped_column(Text)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    report_version_id: Mapped[int | None] = mapped_column(ForeignKey("report_versions.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class TerminologyTerm(Base):
    """User edits to the terminology dictionary (overrides/extends config/terminology.yaml)."""
    __tablename__ = "terminology_terms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))   # approved | prohibited | abbreviation
    term: Mapped[str] = mapped_column(String(120))
    definition: Mapped[str | None] = mapped_column(Text)
    alternatives: Mapped[list] = mapped_column(JSON, default=list)
    prohibited_alternatives: Mapped[list] = mapped_column(JSON, default=list)
    suggest: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    approved_by_user_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    __table_args__ = (UniqueConstraint("kind", "term"),)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)

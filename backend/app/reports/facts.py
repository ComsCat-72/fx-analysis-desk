"""Fact bundles: everything a report may state, each item with an ID the text must cite.

Strictly as-of: only candles closed by the data cutoff, only event values recorded by the cutoff,
only policy/news published by the cutoff. Nothing after the cutoff can leak into a report.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import app_config
from ..domain import technical as T
from ..domain.breaks import BreakRules, LevelStatus, Side, evaluate_break, update_level_status
from ..domain.evaluation import DIRECTION_LABELS, Direction, assess_direction
from ..domain.events import classify_surprise, revision_direction
from ..domain.instruments import Instrument, currency_effect
from ..domain.sessions import SessionDef
from ..domain.timeutil import format_display, to_zone
from ..domain.validation import check_incomplete, check_missing_sessions, check_stale_quote, Quote
from ..models import (EconomicEvent, EventValueHistory, NewsItem, Outlook, OutlookChange, PolicyItem, QuoteRow,
                      Report, ReportVersion, TechnicalLevel)
from ..services.ingest import load_candles

KINDS = ("weekly_analysis", "daily_analysis", "daily_review", "weekly_review")

# Currencies whose releases matter for each non-FX instrument.
DXY_BASKET = ["USD", "EUR", "JPY", "GBP", "CAD", "SEK", "CHF"]
EXTRA_CURRENCIES = {"index": DXY_BASKET, "index_computed": DXY_BASKET, "metal_spot": ["USD"], "index_cash": ["USD"]}


def economies(inst: Instrument) -> list[tuple[str, str]]:
    """(key, heading) for the two separately analysed sides."""
    if inst.kind == "fx_spot":
        return [("base", inst.base), ("quote", inst.quote)]
    if inst.kind == "metal_spot":
        return [("base", "XAU (gold)"), ("quote", "USD")]
    if inst.kind == "index_cash":
        return [("base", "US equities (Nasdaq-100)"), ("quote", "USD")]
    return [("base", "USD"), ("quote", "Basket currencies (EUR, JPY, GBP, CAD, SEK, CHF)")]


def event_currencies(inst: Instrument) -> list[str]:
    if inst.kind == "fx_spot":
        return [inst.base, inst.quote]
    return EXTRA_CURRENCIES.get(inst.kind, ["USD"])


@dataclass
class Bundle:
    meta: dict
    facts: dict = field(default_factory=dict)
    levels: dict = field(default_factory=dict)
    events: dict = field(default_factory=dict)
    policy: dict = field(default_factory=dict)
    continuity: dict = field(default_factory=dict)
    evaluation: dict | None = None
    warnings: list = field(default_factory=list)
    missing: list = field(default_factory=list)
    _n: dict = field(default_factory=lambda: {"F": 0, "L": 0, "E": 0, "P": 0})

    def add(self, group: str, prefix: str, item: dict) -> str:
        self._n[prefix] += 1
        fid = f"{prefix}{self._n[prefix]}"
        item["id"] = fid
        getattr(self, group)[fid] = item
        return fid

    def to_dict(self) -> dict:
        return {"meta": self.meta, "facts": self.facts, "levels": self.levels, "events": self.events,
                "policy": self.policy, "continuity": self.continuity, "evaluation": self.evaluation,
                "warnings": self.warnings, "missing": self.missing}


def _f(x: float | None, d: int) -> str | None:
    return None if x is None else f"{x:.{d}f}"


def _ohlc_values(c, d):
    return [_f(c.open, d), _f(c.high, d), _f(c.low, d), _f(c.close, d)]


def _period(kind: str, period: date, s: SessionDef) -> tuple[date, datetime, datetime]:
    """(week Monday, horizon start, horizon end) for the report slot."""
    monday = s.week_monday(period)
    if kind in ("weekly_analysis", "weekly_review"):
        ws, we = s.week_bounds(monday)
        return monday, ws, we
    ds, de = s.day_bounds(period)
    return monday, ds, de


def published_versions(db: Session, instrument: str, kind: str, period_key: str | None = None,
                       week_key: str | None = None, before: datetime | None = None) -> list[ReportVersion]:
    q = select(ReportVersion).join(Report).where(Report.instrument == instrument, Report.kind == kind,
                                                 ReportVersion.status == "published")
    if period_key:
        q = q.where(Report.period_key == period_key)
    if week_key:
        q = q.where(Report.week_key == week_key)
    if before:
        q = q.where(ReportVersion.published_at <= before)
    return list(db.scalars(q.order_by(Report.period_key, ReportVersion.version)))


def original_and_latest(versions: list[ReportVersion]) -> tuple[ReportVersion | None, ReportVersion | None]:
    if not versions:
        return None, None
    return versions[0], versions[-1]


def outlook_summary(v: ReportVersion, tz: str, label: str) -> dict | None:
    o = v.outlook
    if o is None:
        return None
    return {"version_id": v.id, "version": v.version, "version_type": v.version_type,
            "period_key": v.report.period_key,
            "published_at": v.published_at.isoformat(), "published_display": format_display(v.published_at, tz, label),
            "data_cutoff_display": format_display(v.data_cutoff, tz, label),
            "direction": o.direction, "direction_label": DIRECTION_LABELS[Direction(o.direction)],
            "qualification": o.qualification, "conditions": o.conditions,
            "reference_price": o.reference_price}


def _event_as_of(db: Session, ev: EconomicEvent, cutoff: datetime) -> dict:
    """Reconstruct event values as they were known at the cutoff from the append-only history."""
    hist = list(db.scalars(select(EventValueHistory).where(EventValueHistory.event_id == ev.id,
                                                           EventValueHistory.recorded_at <= cutoff)
                           .order_by(EventValueHistory.recorded_at, EventValueHistory.id)))
    latest: dict[str, dict[str, str]] = {}
    resched = None
    for h in hist:
        if h.field == "rescheduled_to":
            resched = h.value
        latest.setdefault(h.field, {})[h.source] = h.value
    actuals = {k: v for k, v in latest.get("actual", {}).items() if v}
    if len(set(actuals.values())) > 1:
        state, actual = "conflicting", None
    elif actuals:
        state, actual = "released", next(iter(actuals.values()))
    else:
        state = "delayed" if resched else ("scheduled" if ev.scheduled_at > cutoff else "unavailable")
        actual = None
    def last(fld):
        vals = latest.get(fld, {})
        return list(vals.values())[-1] if vals else getattr(ev, fld)
    consensus, previous = last("consensus"), last("previous")
    revised = (list(latest["revised_previous"].values())[-1] if latest.get("revised_previous") else None)
    if state == "released" and revised and revision_direction(previous, revised):
        state = "revised"
    return {"state": state, "actual": actual, "actual_sources": sorted(actuals) if actual else [],
            "consensus": consensus, "previous": previous, "revised_previous": revised, "rescheduled_to": resched,
            "conflicting_values": actuals if state == "conflicting" else None}


def build_bundle(db: Session, inst: Instrument, kind: str, period: date, cutoff: datetime,
                 session: SessionDef) -> Bundle:
    if kind not in KINDS:
        raise ValueError(kind)
    cfg = app_config()
    tz, tzl = cfg["display"]["timezone"], cfg["display"].get("timezone_label")
    d = inst.decimals
    monday, h_start, h_end = _period(kind, period, session)
    rules = BreakRules.from_config(cfg["technical"]["breaks"])
    econ = economies(inst)

    b = Bundle(meta={
        "instrument": inst.code, "display": inst.display, "base": inst.base, "quote": inst.quote,
        "instrument_kind": inst.kind, "instrument_label": inst.label, "economies": econ,
        "kind": kind, "period_key": period.isoformat(), "week_key": monday.isoformat(),
        "horizon_start": h_start.isoformat(), "horizon_end": h_end.isoformat(),
        "horizon_display": f"{format_display(h_start, tz, tzl)} to {format_display(h_end, tz, tzl)}",
        "data_cutoff": cutoff.isoformat(), "data_cutoff_display": format_display(cutoff, tz, tzl),
        "display_timezone": tz, "display_label": tzl, "session": session.name,
        "session_description": cfg["sessions"][session.name].get("description"),
        "break_rules": {"basis": rules.basis, "sustained_closes": rules.sustained_closes,
                        "reversal_closes": rules.reversal_closes, "timeframe": cfg["technical"]["breaks"].get("timeframe", "H1")},
    })

    # ---------------- prices ----------------
    look_start = cutoff - timedelta(days=150)
    h1_all = load_candles(db, inst.code, "H1", cutoff - timedelta(days=35), h_end + timedelta(days=1))
    d1_all = load_candles(db, inst.code, "D1", look_start, h_end + timedelta(days=1))
    w1_all = load_candles(db, inst.code, "W1", cutoff - timedelta(days=400), h_end + timedelta(days=8))
    providers = sorted({c.provider for c in h1_all + d1_all})
    is_fixture = any(c.is_fixture for c in h1_all + d1_all)
    b.meta["providers"] = providers
    b.meta["data_mode"] = "fixture" if is_fixture else "live"
    if is_fixture:
        b.warnings.append({"code": "fixture_data", "severity": "info",
                           "message": "DEVELOPMENT FIXTURE: synthetic data, not market data."})
    if len(providers) > 1:
        b.warnings.append({"code": "mixed_sources", "severity": "blocking",
                           "message": f"Price data comes from several providers {providers}; they are not combined."})

    h1 = T.closed_before(h1_all, cutoff)
    d1 = T.closed_before(d1_all, cutoff)
    w1 = T.closed_before(w1_all, cutoff)
    if not h1 or not d1:
        b.missing.append(f"No complete price data for {inst.display} before the data cutoff.")

    # reference price: latest stored quote at/before cutoff, else latest complete H1 close
    qrow = db.scalar(select(QuoteRow).where(QuoteRow.instrument == inst.code, QuoteRow.time <= cutoff)
                     .order_by(QuoteRow.time.desc()))
    ref_price, ref_time = None, None
    max_age = cfg["providers"]["prices"].get("stale_after_seconds", 300)
    if qrow is not None:
        q = Quote(qrow.instrument, qrow.time, qrow.bid, qrow.ask, qrow.mid, qrow.provider, qrow.is_fixture)
        w = check_stale_quote(q, cutoff, max_age, session)
        if w is None:
            ref_price, ref_time = qrow.mid, qrow.time
            b.add("facts", "F", {"kind": "price", "text": f"{inst.display} spot mid quote {_f(qrow.mid, d)} at "
                                 f"{format_display(qrow.time, tz, tzl)} ({qrow.provider}). This is a quote, not a closing price.",
                                 "values": [_f(qrow.mid, d)], "source": qrow.provider, "time": qrow.time.isoformat(),
                                 "role": "reference_price"})
        elif w.severity == "blocking" and kind in ("daily_analysis",):
            b.warnings.append({"code": w.code, "severity": "warning", "message": w.message})
    if ref_price is None and h1:
        last = h1[-1]
        ref_price, ref_time = last.close, last.end
        b.add("facts", "F", {"kind": "price", "text": f"Latest complete 1H candle for {inst.display} closed at "
                             f"{_f(last.close, d)} at {format_display(last.end, tz, tzl)} ({last.provider} mid). "
                             "This is an hourly close, not a daily closing price.",
                             "values": [_f(last.close, d)], "source": last.provider, "time": last.end.isoformat(),
                             "role": "reference_price"})
    b.meta["reference_price"] = ref_price
    b.meta["reference_time"] = ref_time.isoformat() if ref_time else None

    if d1:
        p = d1[-1]
        pd = session.trading_day_of(p.start)
        chg = p.close - p.open
        b.add("facts", "F", {"kind": "price", "text": f"Previous complete session ({pd.strftime('%a %d %b %Y')}, "
                             f"ends 17:00 New York = {format_display(p.end, tz, tzl, with_date=False)}): "
                             f"open {_f(p.open, d)}, high {_f(p.high, d)}, low {_f(p.low, d)}, close {_f(p.close, d)}; "
                             f"change {chg:+.{d}f} ({p.provider} mid).",
                             "values": _ohlc_values(p, d) + [f"{chg:+.{d}f}", f"{abs(chg):.{d}f}"],
                             "source": p.provider, "time": p.end.isoformat(), "role": "previous_session"})
        b.add("levels", "L", _auto_level(db, inst, "D1", "support", p.low, p.low, f"previous session low ({pd})", p.end, is_fixture))
        b.add("levels", "L", _auto_level(db, inst, "D1", "resistance", p.high, p.high, f"previous session high ({pd})", p.end, is_fixture))
    if w1:
        pw = w1[-1]
        wk = session.trading_day_of(pw.start)
        b.add("facts", "F", {"kind": "price", "text": f"Previous complete week (week of {wk.strftime('%d %b %Y')}): open {_f(pw.open, d)}, "
                             f"high {_f(pw.high, d)}, low {_f(pw.low, d)}, close {_f(pw.close, d)} "
                             f"(aggregated from daily candles, {pw.provider}).",
                             "values": _ohlc_values(pw, d) + [f"{pw.close - pw.open:+.{d}f}"],
                             "source": pw.provider, "time": pw.end.isoformat(), "role": "previous_week"})
        b.add("levels", "L", _auto_level(db, inst, "W1", "support", pw.low, pw.low, f"previous week low (week of {wk})", pw.end, is_fixture))
        b.add("levels", "L", _auto_level(db, inst, "W1", "resistance", pw.high, pw.high, f"previous week high (week of {wk})", pw.end, is_fixture))

    tcfg = cfg["technical"]
    atr_d1 = T.atr(d1, tcfg.get("atr_period", 14))
    b.meta["atr_d1"] = atr_d1
    if atr_d1:
        b.add("facts", "F", {"kind": "indicator", "text": f"ATR({tcfg.get('atr_period', 14)}) on daily candles: {_f(atr_d1, d)} "
                             "(Wilder; volatility context only).", "values": [_f(atr_d1, d)], "source": "calculation"})
    closes = [c.close for c in d1]
    for m in tcfg.get("moving_averages", []):
        fn = T.sma if m["type"].upper() == "SMA" else T.ema
        v = fn(closes, m["period"])
        if v is not None:
            rel = "above" if closes[-1] > v else "below"
            b.add("facts", "F", {"kind": "indicator", "text": f"{m['type'].upper()}({m['period']}) of daily closes: {_f(v, d)}; "
                                 f"the last daily close was {rel} it.", "values": [_f(v, d)], "source": "calculation"})
    if tcfg.get("rsi", {}).get("enabled"):
        r = T.rsi(closes, tcfg["rsi"].get("period", 14))
        if r is not None:
            b.add("facts", "F", {"kind": "indicator", "text": f"RSI({tcfg['rsi'].get('period', 14)}) daily: {r:.1f}.",
                                 "values": [f"{r:.1f}"], "source": "calculation"})
    sw = tcfg.get("swings", {})
    swings = T.find_swings(h1, cutoff, sw.get("left_bars", 3), sw.get("right_bars", 3))
    struct = T.structure(swings)
    recent = swings[-4:]
    if recent:
        desc = "; ".join(f"{s.label or s.kind} {_f(s.price, d)} (confirmed {format_display(s.confirmed_at, tz, tzl)})" for s in recent)
        b.add("facts", "F", {"kind": "structure", "text": f"1H structure from confirmed swing points: {struct}. Recent swings: {desc}. "
                             f"Swing rule: {sw.get('left_bars', 3)} bars left, {sw.get('right_bars', 3)} bars right; "
                             "a swing counts only after the right-side bars close.",
                             "values": [_f(s.price, d) for s in recent], "source": "calculation", "structure": struct})
    b.meta["h1_structure"] = struct
    # week-to-date range
    wk_start, _ = session.week_bounds(monday)
    wtd = [c for c in h1 if c.start >= wk_start]
    if wtd and kind != "weekly_analysis":
        b.add("facts", "F", {"kind": "price", "text": f"Range this week through the data cutoff: high {_f(max(c.high for c in wtd), d)}, "
                             f"low {_f(min(c.low for c in wtd), d)} (1H candles).",
                             "values": [_f(max(c.high for c in wtd), d), _f(min(c.low for c in wtd), d)], "source": providers[0] if providers else None})

    # data quality in the lookback
    for w in check_missing_sessions(d1_all, session, (cutoff - timedelta(days=10)).date(), cutoff.date(), cutoff):
        b.warnings.append({"code": w.code, "severity": "warning", "message": w.message})

    # ---------------- user / stored levels ----------------
    rows = db.scalars(select(TechnicalLevel).where(TechnicalLevel.instrument == inst.code,
                                                   TechnicalLevel.origin != "automated",
                                                   TechnicalLevel.status.notin_(["archived", "invalidated"]),
                                                   TechnicalLevel.created_at <= cutoff))
    for lv in rows:
        since = [c for c in h1 if c.start >= lv.created_at]
        status, reasons = update_level_status(LevelStatus.ACTIVE, lv.lower, lv.upper, lv.role, since, rules)
        stale = (cutoff - lv.created_at) > timedelta(days=7)
        note = (f" Levels are carried forward from {format_display(lv.created_at, tz, tzl)}; current structure has not been "
                "verified against them by the user.") if stale and lv.origin in ("user", "screenshot") else ""
        approx = " (approximate reading from a screenshot)" if lv.approximate else ""
        b.add("levels", "L", {"kind": "level", "db_id": lv.id, "role": lv.role, "lower": lv.lower, "upper": lv.upper,
                              "timeframe": lv.timeframe, "origin": lv.origin, "status": status.value,
                              "break_confirmed": status in (LevelStatus.BROKEN, LevelStatus.RECLAIMED),
                              "text": f"{lv.role.title()} area {_f(lv.lower, d)}–{_f(lv.upper, d)} ({lv.timeframe}, {lv.origin}{approx}): "
                                      f"{lv.reason}. Status at cutoff: {status.value}.{note}",
                              "values": [_f(lv.lower, d), _f(lv.upper, d)], "status_reasons": reasons})

    # ---------------- events ----------------
    curs = event_currencies(inst)
    if kind in ("weekly_analysis", "daily_analysis"):
        ev_from, ev_to = cutoff - timedelta(days=1 if kind == "daily_analysis" else 3), h_end
    else:
        ev_from, ev_to = h_start, h_end
    evs = db.scalars(select(EconomicEvent).where(EconomicEvent.currency.in_(curs), EconomicEvent.scheduled_at >= ev_from,
                                                 EconomicEvent.scheduled_at < ev_to).order_by(EconomicEvent.scheduled_at))
    allowed_times = {to_zone(cutoff, tz).strftime("%H:%M")}
    for ev in evs:
        if ev.impact not in ("High", "Medium", "Holiday"):
            continue
        st = _event_as_of(db, ev, cutoff)
        surprise = classify_surprise(st["actual"], st["consensus"]).value if st["actual"] else None
        t_local = format_display(ev.scheduled_at, tz, tzl)
        allowed_times.add(to_zone(ev.scheduled_at, tz).strftime("%H:%M"))
        parts = [f"{ev.currency} {ev.title} — scheduled {t_local} (source time {ev.source_time_text})"]
        parts.append(f"consensus {st['consensus'] or 'not available'}, previous {st['previous'] or 'n/a'}")
        if st["revised_previous"]:
            parts.append(f"previous revised to {st['revised_previous']} ({revision_direction(st['previous'], st['revised_previous'])})")
        if st["state"] in ("released", "revised"):
            parts.append(f"actual {st['actual']} ({surprise}; source: {', '.join(st['actual_sources'])})")
        elif st["state"] == "conflicting":
            parts.append("available sources disagree on the actual; interpretation is withheld pending verification")
        elif ev.scheduled_at <= cutoff:
            parts.append(f"the release was scheduled for {t_local}, but the actual result is not yet verified")
        if st["state"] == "delayed":
            parts.append(f"delayed; rescheduled to {st['rescheduled_to']}")
        if ev.is_fixture:
            parts.append("DEVELOPMENT FIXTURE")
        b.add("events", "E", {"kind": "event", "db_id": ev.id, "currency": ev.currency, "title": ev.title,
                              "impact": ev.impact, "scheduled_at": ev.scheduled_at.isoformat(), "scheduled_display": t_local,
                              "source_time": ev.source_time_text, "state": st["state"], "surprise": surprise,
                              "actual": st["actual"], "consensus": st["consensus"], "previous": st["previous"],
                              "revised_previous": st["revised_previous"], "source": ev.source,
                              "text": "; ".join(parts) + ".",
                              "values": [st["consensus"], st["previous"], st["actual"], st["revised_previous"]]})
        if st["state"] == "conflicting":
            b.warnings.append({"code": "source_conflict", "severity": "warning",
                               "message": f"Sources disagree on {ev.title}; interpretation is withheld pending verification."})
    b.meta["allowed_times"] = sorted(allowed_times)

    # ---------------- policy and news ----------------
    p_from = cutoff - timedelta(days=10)
    for p in db.scalars(select(PolicyItem).where(PolicyItem.currency.in_(curs), PolicyItem.published_at <= cutoff,
                                                 PolicyItem.published_at >= p_from).order_by(PolicyItem.published_at.desc()).limit(12)):
        b.add("policy", "P", {"kind": "policy", "bank": p.bank, "currency": p.currency, "type": p.kind,
                              "title": p.title, "url": p.url, "published_display": format_display(p.published_at, tz, tzl),
                              "text": f"{p.bank.upper()} {p.kind}: \"{p.title}\" ({format_display(p.published_at, tz, tzl)}). "
                                      f"{(p.summary or '')[:400]}", "values": [], "numbers_in_text": _nums(p.title + ' ' + (p.summary or '')),
                              "source": p.url or p.source})
    for n in db.scalars(select(NewsItem).where(NewsItem.published_at <= cutoff, NewsItem.published_at >= p_from)
                        .order_by(NewsItem.published_at.desc()).limit(20)):
        if n.currencies and not set(n.currencies) & set(curs):
            continue
        b.add("policy", "P", {"kind": "news", "source_name": n.source_name, "title": n.title, "url": n.url,
                              "entered_by": n.entered_by, "published_display": format_display(n.published_at, tz, tzl),
                              "text": f"{n.source_name} ({'user-entered headline' if n.entered_by == 'user' else 'feed'}): "
                                      f"\"{n.title}\" ({format_display(n.published_at, tz, tzl)}). {(n.summary or '')[:400]}",
                              "values": [], "numbers_in_text": _nums(n.title + ' ' + (n.summary or '')), "source": n.url or n.source_name})

    # ---------------- continuity ----------------
    _continuity(db, b, inst, kind, period, monday, cutoff, tz, tzl)

    # ---------------- evaluation for reviews ----------------
    if kind == "daily_review":
        _daily_evaluation(db, b, inst, period, session, rules, cfg, d, tz, tzl, h1_all, d1_all)
    elif kind == "weekly_review":
        _weekly_evaluation(db, b, inst, monday, session, rules, cfg, d, tz, tzl, h1_all, d1_all, w1_all)

    # times of earlier published reports are quotable too
    for item in [b.continuity.get("weekly"), b.continuity.get("previous_weekly"), *(b.continuity.get("daily") or []),
                 (b.evaluation or {}).get("original")]:
        if item and item.get("published_at"):
            b.meta["allowed_times"].append(to_zone(datetime.fromisoformat(item["published_at"]), tz).strftime("%H:%M"))
    for item in [b.continuity.get("weekly"), *(b.continuity.get("daily") or []), (b.evaluation or {}).get("original")]:
        if item and item.get("data_cutoff_display"):
            b.meta["allowed_times"].append(item["data_cutoff_display"].split(" ")[-2])
    b.meta["allowed_times"] = sorted(set(b.meta["allowed_times"]))
    # numbers that may appear without a citation: calendar days/years around the period
    cal = set()
    for i in range(-10, 12):
        dd = monday + timedelta(days=i)
        cal.update({str(dd.day), str(dd.year)})
    b.meta["calendar_numbers"] = sorted(cal)
    return b


def _nums(text: str) -> list[str]:
    import re
    return re.findall(r"[-+]?\d+(?:\.\d+)?", text)


def _auto_level(db: Session, inst: Instrument, tf: str, role: str, lower: float, upper: float, reason: str,
                created: datetime, is_fixture: bool) -> dict:
    """Automated reference levels are persisted once so later reviews refer to the same record."""
    row = db.scalar(select(TechnicalLevel).where(TechnicalLevel.instrument == inst.code, TechnicalLevel.origin == "automated",
                                                 TechnicalLevel.timeframe == tf, TechnicalLevel.role == role,
                                                 TechnicalLevel.reason == reason))
    if row is None:
        row = TechnicalLevel(instrument=inst.code, lower=lower, upper=upper, timeframe=tf, role=role, origin="automated",
                             reason=reason, status="active", created_at=created, updated_at=created, is_fixture=is_fixture)
        db.add(row)
        db.flush()
    d = inst.decimals
    area = _f(lower, d) if lower == upper else f"{_f(lower, d)}–{_f(upper, d)}"
    return {"kind": "level", "db_id": row.id, "role": role, "lower": lower, "upper": upper, "timeframe": tf,
            "origin": "automated", "status": row.status, "break_confirmed": False,
            "text": f"{role.title()} reference {area}: {reason} (calculated).", "values": [_f(lower, d), _f(upper, d)]}


def _continuity(db, b: Bundle, inst, kind, period, monday, cutoff, tz, tzl):
    wk = monday.isoformat()
    wv = published_versions(db, inst.code, "weekly_analysis", period_key=wk, before=cutoff if kind != "weekly_review" else None)
    orig, latest = original_and_latest(wv)
    b.continuity["weekly"] = outlook_summary(orig, tz, tzl) if orig else None
    if latest and orig and latest.id != orig.id:
        b.continuity["weekly_latest"] = outlook_summary(latest, tz, tzl)
    if kind == "weekly_analysis":
        prev_monday = monday - timedelta(days=7)
        pr = published_versions(db, inst.code, "weekly_review", period_key=prev_monday.isoformat(), before=cutoff)
        b.continuity["previous_weekly_review"] = ({"version_id": pr[-1].id, "published_display": format_display(pr[-1].published_at, tz, tzl),
                                                   "summary": ((pr[-1].sections or {}).get("text") or {}).get("lesson")}
                                                  if pr else None)
        pw = published_versions(db, inst.code, "weekly_analysis", period_key=prev_monday.isoformat())
        b.continuity["previous_weekly"] = outlook_summary(pw[0], tz, tzl) if pw else None
        return
    days = []
    for dv in published_versions(db, inst.code, "daily_analysis", week_key=wk, before=cutoff):
        if kind == "daily_analysis" and dv.report.period_key >= period.isoformat():
            continue
        s = outlook_summary(dv, tz, tzl)
        if s:
            ev = dv.outlook and _latest_eval(db, dv.outlook.id)
            s["evaluation"] = ev
            days.append(s)
    # keep only original version per day, note later updates
    by_day: dict[str, dict] = {}
    for s in days:
        if s["period_key"] not in by_day:
            by_day[s["period_key"]] = s
        else:
            by_day[s["period_key"]].setdefault("updates", []).append({"version": s["version"], "type": s["version_type"],
                                                                     "direction": s["direction"], "published_display": s["published_display"]})
    b.continuity["daily"] = list(by_day.values())
    reviews = published_versions(db, inst.code, "daily_review", week_key=wk, before=cutoff if kind != "weekly_review" else None)
    b.continuity["reviews"] = [{"period_key": r.report.period_key, "published_display": format_display(r.published_at, tz, tzl),
                                "conclusion": ((r.sections or {}).get("text") or {}).get("daily_conclusion")} for r in reviews if r.version == 1]
    changes = db.scalars(select(OutlookChange).where(OutlookChange.instrument == inst.code, OutlookChange.week_key == wk,
                                                     OutlookChange.at <= cutoff).order_by(OutlookChange.at))
    b.continuity["change_log"] = [{"at": format_display(c.at, tz, tzl), "from": c.previous_interpretation,
                                   "to": c.new_interpretation, "evidence": c.evidence} for c in changes]
    if b.continuity["weekly"] is None:
        b.continuity["note"] = ("No weekly analysis was published for this week; continuity uses the working theme "
                                "from the daily reports.")


def _latest_eval(db, outlook_id):
    from ..models import Evaluation
    e = db.scalar(select(Evaluation).where(Evaluation.outlook_id == outlook_id).order_by(Evaluation.evaluated_at.desc()))
    return None if e is None else {"directional": e.directional, "conditional": e.conditional}


def _conditions_eval(o: Outlook, bars, rules, d: int) -> list[dict]:
    out = []
    for c in o.conditions or []:
        r = evaluate_break(bars, float(c["boundary"]), Side(c["side"]), rules)
        out.append({"id": c.get("id"), "text": c.get("text"), "boundary": _f(float(c["boundary"]), d), "side": c["side"],
                    "effect": c.get("effect"), "outcome": r.outcome.value,
                    "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
                    "reversed_at": r.reversed_at.isoformat() if r.reversed_at else None, "rejections": r.rejections})
    return out


def _zone_reactions(db, o: Outlook, bars, rules, d, period_word: str = "session") -> list[dict]:
    out = []
    for lid in o.published_zone_ids or []:
        lv = db.get(TechnicalLevel, lid)
        if lv is None:
            continue
        touched = any(c.low <= lv.upper and c.high >= lv.lower for c in bars)
        st, reasons = update_level_status(LevelStatus.ACTIVE, lv.lower, lv.upper, lv.role, bars, rules)
        side = Side.BELOW if lv.role == "support" else Side.ABOVE
        br = evaluate_break(bars, lv.lower if lv.role == "support" else lv.upper, side, rules)
        if not touched:
            reaction, meaning = "Not reached", f"No test of this area in the {period_word}."
        elif st is LevelStatus.BROKEN:
            reaction, meaning = "Sustained break", f"{lv.role.title()} gave way under the configured close rule."
        elif st is LevelStatus.RECLAIMED:
            reaction, meaning = "Broken, then reclaimed", "The break did not hold."
        elif br.first_reached_at and br.rejections:
            reaction, meaning = "Traded through, closed back", f"{lv.role.title()} held on a closing basis (rejection)."
        else:
            reaction, meaning = "Tested, held", f"{lv.role.title()} held."
        area = _f(lv.lower, d) if lv.lower == lv.upper else f"{_f(lv.lower, d)}–{_f(lv.upper, d)}"
        out.append({"level_id": lv.id, "area": area, "role": lv.role, "reaction": reaction, "meaning": meaning,
                    "status": st.value, "values": [_f(lv.lower, d), _f(lv.upper, d)]})
    return out


def _daily_evaluation(db, b: Bundle, inst, period, session, rules, cfg, d, tz, tzl, h1_all, d1_all):
    pv = published_versions(db, inst.code, "daily_analysis", period_key=period.isoformat())
    orig, latest = original_and_latest(pv)
    s_start, s_end = session.day_bounds(period)
    day = next((c for c in d1_all if c.start == s_start), None)
    ev: dict = {"session_date": period.isoformat()}
    if day is None or not day.complete:
        b.missing.append(f"No complete session candle for {period.isoformat()}; the review cannot assess the session.")
    else:
        bars = [c for c in h1_all if s_start <= c.start < s_end]
        hi_bar = max(bars, key=lambda c: c.high) if bars else None
        lo_bar = min(bars, key=lambda c: c.low) if bars else None
        atr_v = orig.outlook.atr_at_publication if orig and orig.outlook else b.meta.get("atr_d1")
        thr = cfg["evaluation"]["inconclusive_atr_fraction"] * atr_v if atr_v else 0
        net = day.close - day.open
        ev["session_direction"] = "consolidated" if abs(net) <= thr else ("rose" if net > 0 else "fell")
        eff = currency_effect(inst, net) if inst.kind == "fx_spot" else {}
        seq = ""
        if hi_bar and lo_bar:
            first = "high" if hi_bar.start < lo_bar.start else "low"
            seq = (f" The session high came at {format_display(hi_bar.start, tz, tzl)} and the low at "
                   f"{format_display(lo_bar.start, tz, tzl)} (the {first} came first).")
        fid = b.add("facts", "F", {"kind": "price", "role": "reviewed_session",
                                   "text": f"Reviewed session {period.strftime('%a %d %b %Y')} (ends 17:00 New York): open {_f(day.open, d)}, "
                                           f"high {_f(day.high, d)}, low {_f(day.low, d)}, close {_f(day.close, d)}; net {net:+.{d}f}; "
                                           f"classified as '{ev['session_direction']}' (threshold {_f(thr, d)} = "
                                           f"{cfg['evaluation']['inconclusive_atr_fraction']} x ATR).{seq}"
                                           + (f" Currency effect: {', '.join(f'{k} {v}' for k, v in eff.items())}." if eff else ""),
                                   "values": _ohlc_values(day, d) + [f"{net:+.{d}f}", f"{abs(net):.{d}f}", _f(thr, d)],
                                   "source": day.provider})
        ev["session_fact"] = fid
        if orig is None:
            b.missing.append(f"No published daily analysis exists for {period.isoformat()}; there is no original outlook to review.")
        else:
            o = orig.outlook
            horizon_bars = [c for c in bars if c.start >= orig.data_cutoff]
            rng = (o.range_lower, o.range_upper) if o.range_lower is not None and o.range_upper is not None else None
            dr = assess_direction(Direction(o.direction), o.reference_price, day, o.atr_at_publication, cfg["evaluation"], rng)
            ev.update({"original": outlook_summary(orig, tz, tzl),
                       "latest": outlook_summary(latest, tz, tzl) if latest.id != orig.id else None,
                       "directional": {"outcome": dr.outcome.value, "explanation": dr.explanation,
                                       "net_from_reference": None if dr.net_change is None else f"{dr.net_change:+.{d}f}",
                                       "threshold": None if dr.threshold is None else _f(dr.threshold, d),
                                       "label": dr.label(cfg["evaluation"].get("wording", "assessment"))},
                       "conditional": _conditions_eval(o, horizon_bars, rules, d),
                       "zones": _zone_reactions(db, o, horizon_bars, rules, d)})
            vals = [x for x in [ev["directional"]["net_from_reference"], ev["directional"]["threshold"], _f(o.reference_price, d)] if x]
            for c in ev["conditional"]:
                vals.append(c["boundary"])
            ev["evaluation_fact"] = b.add("facts", "F", {"kind": "evaluation", "values": vals, "source": "calculation",
                                                          "text": f"Published outlook (v{orig.version}, {ev['original']['published_display']}, "
                                                                  f"data cutoff {ev['original']['data_cutoff_display']}): {ev['original']['direction_label']} "
                                                                  f"from reference {_f(o.reference_price, d)}. Directional assessment: {dr.outcome.value} "
                                                                  f"({dr.explanation}).",
                                                          })
            for z in ev["zones"]:
                z["fact_id"] = b.add("facts", "F", {"kind": "reaction", "values": z["values"], "source": "calculation",
                                                     "text": f"Published {z['role']} {z['area']}: {z['reaction']}. {z['meaning']}"})
    b.evaluation = ev


def _weekly_evaluation(db, b: Bundle, inst, monday, session, rules, cfg, d, tz, tzl, h1_all, d1_all, w1_all):
    ws, we = session.week_bounds(monday)
    wk = next((c for c in w1_all if c.start == ws), None)
    ev: dict = {"week": monday.isoformat()}
    if wk is None or not wk.complete:
        b.missing.append("No complete weekly candle for the week; the weekly review cannot assess the week.")
        b.evaluation = ev
        return
    w1_prior = [c for c in w1_all if c.end <= ws and c.complete]
    n = min(14, len(w1_prior))
    atr_w = T.atr(w1_prior, n) if n >= 4 else None
    thr = cfg["evaluation"]["inconclusive_atr_fraction"] * atr_w if atr_w else None
    net = wk.close - wk.open
    direction = None if thr is None else ("consolidated" if abs(net) <= thr else ("rose" if net > 0 else "fell"))
    ev["session_direction"] = direction
    prev_dir = None
    if w1_prior and thr is not None:
        pn = w1_prior[-1].close - w1_prior[-1].open
        prev_dir = "consolidated" if abs(pn) <= thr else ("rose" if pn > 0 else "fell")
    # Heading word for "Why the market Continued / Reversed / Consolidated" (relative to the prior week).
    if direction is None:
        ev["sequence"] = None
    elif direction == "consolidated":
        ev["sequence"] = "consolidated"
    elif prev_dir == direction:
        ev["sequence"] = "continued"
    elif prev_dir in ("rose", "fell"):
        ev["sequence"] = "reversed"
    else:
        ev["sequence"] = direction  # prior week was flat or unknown: just rose / fell
    ev["week_fact"] = b.add("facts", "F", {"kind": "price", "role": "reviewed_week", "source": wk.provider,
                                           "text": f"Week of {monday.strftime('%d %b %Y')}: open {_f(wk.open, d)}, high {_f(wk.high, d)}, low {_f(wk.low, d)}, "
                                                   f"close {_f(wk.close, d)}; net {net:+.{d}f}"
                                                   + (f"; weekly ATR({n}) {_f(atr_w, d)}, threshold {_f(thr, d)}." if thr else "; weekly ATR not available (fewer than 4 prior weeks)."),
                                           "values": _ohlc_values(wk, d) + [f"{net:+.{d}f}", _f(atr_w, d), _f(thr, d)]})
    weekly_v = published_versions(db, inst.code, "weekly_analysis", period_key=monday.isoformat())
    orig, _ = original_and_latest(weekly_v)
    if orig and orig.outlook:
        o = orig.outlook
        rng = (o.range_lower, o.range_upper) if o.range_lower is not None and o.range_upper is not None else None
        dr = assess_direction(Direction(o.direction), o.reference_price, wk, atr_w, cfg["evaluation"], rng)
        week_bars = [c for c in h1_all if ws <= c.start < we and c.start >= orig.data_cutoff]
        ev["weekly"] = {"original": outlook_summary(orig, tz, tzl), "directional": dr.outcome.value, "explanation": dr.explanation,
                        "conditional": _conditions_eval(o, week_bars, rules, d), "zones": _zone_reactions(db, o, week_bars, rules, d, "week")}
        for z in ev["weekly"]["zones"]:
            z["fact_id"] = b.add("facts", "F", {"kind": "reaction", "values": z["values"], "source": "calculation",
                                                 "text": f"Weekly published {z['role']} {z['area']}: {z['reaction']}. {z['meaning']}"})
    else:
        ev["weekly"] = None
    days = []
    for dday in session.week_trading_days(monday):
        pv = published_versions(db, inst.code, "daily_analysis", period_key=dday.isoformat())
        o0 = pv[0] if pv else None
        row = {"date": dday.isoformat(), "day": dday.strftime("%A")}
        s_start, s_end = session.day_bounds(dday)
        day = next((c for c in d1_all if c.start == s_start), None)
        if o0 is None or o0.outlook is None:
            row.update({"published_bias": "No report published", "directional": "Not assessable", "conditional": "Not assessable"})
        else:
            o = o0.outlook
            bars = [c for c in h1_all if s_start <= c.start < s_end and c.start >= o0.data_cutoff]
            rng = (o.range_lower, o.range_upper) if o.range_lower is not None and o.range_upper is not None else None
            dr = assess_direction(Direction(o.direction), o.reference_price, day, o.atr_at_publication, cfg["evaluation"], rng)
            conds = _conditions_eval(o, bars, rules, d)
            row.update({"published_bias": DIRECTION_LABELS[Direction(o.direction)],
                        "directional": dr.label(cfg["evaluation"].get("wording", "assessment")),
                        "conditional": "; ".join(f"{c['side']} {c['boundary']}: {c['outcome']}" for c in conds) or "No conditions stated",
                        "version": o0.version})
        days.append(row)
    ev["days"] = days
    b.evaluation = ev

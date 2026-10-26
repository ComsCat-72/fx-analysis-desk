"""Markdown rendering. Code-owned parts (header, bias line, tables, sources, notes) are built here."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from ..domain.evaluation import DIRECTION_LABELS, Direction
from ..domain.timeutil import format_display, to_zone
from ..content.checks import CITE_RE
from .templates import SECTIONS, TITLES

FOOTER = ("_Analysis only. This report explains market behaviour and does not recommend buying, selling or "
          "positioning in any market._")
FIXTURE_BANNER = ("> **DEVELOPMENT FIXTURE — SYNTHETIC DATA, NOT MARKET DATA.** Prices, events and levels in this "
                  "report were generated for development and testing.")


def _date_line(kind: str, meta: dict, published: datetime | None) -> str:
    tz, tzl = meta["display_timezone"], meta.get("display_label")
    p = date.fromisoformat(meta["period_key"])
    if kind in ("weekly_analysis", "weekly_review"):
        start = date.fromisoformat(meta["week_key"])
        end = start + timedelta(days=4)
        line = f"{start.strftime('%d %b')}–{end.strftime('%d %b %Y')}"
    else:
        line = p.strftime("%A, %d %B %Y")
    stamp = format_display(published, tz, tzl) if published else f"DRAFT (data cutoff {meta['data_cutoff_display']})"
    return f"{line} | {stamp}"


def _events_table(bundle: dict) -> str:
    evs = list(bundle["events"].values())
    if not evs:
        return "_No high- or medium-impact releases are recorded for this period._"
    rows = ["| Time (EAT) | Currency | Event | Consensus | Previous | Actual | Status |", "|---|---|---|---|---|---|---|"]
    for e in evs:
        actual = e["actual"] if e["state"] in ("released", "revised") else "—"
        status = {"released": f"Released ({e['surprise']})", "revised": f"Released, prior revised ({e['surprise']})",
                  "conflicting": "Sources disagree", "delayed": "Delayed", "unavailable": "Not yet verified",
                  "scheduled": "Scheduled"}[e["state"]]
        when = to_zone(datetime.fromisoformat(e["scheduled_at"]), bundle["meta"]["display_timezone"]).strftime("%a %d %b %H:%M")
        rows.append(f"| {when} | {e['currency']} | {e['title']} [{e['id']}] | "
                    f"{e['consensus'] or 'n/a'} | {e['previous'] or 'n/a'} | {actual} | {status} |")
    return "\n".join(rows)


def _bias_line(outlook: dict | None) -> str:
    if not outlook:
        return ""
    lab = DIRECTION_LABELS[Direction(outlook["direction"])]
    q = outlook.get("qualification")
    return f"**Bias:** {lab}" + (f", {q}." if q else ".")


def _review_header(kind: str, bundle: dict) -> str:
    ev = bundle.get("evaluation") or {}
    if kind == "daily_review":
        o = ev.get("original")
        if not o:
            return "_No published daily analysis exists for this session; there is no original outlook to compare against._"
        if ev.get("session_incomplete"):
            return (f"**Original outlook:** {o['direction_label']} — version {o['version']}, published {o['published_display']}. "
                    "_The session's price data is incomplete, so the outlook is not assessed._")
        lines = [f"**Original outlook:** {o['direction_label']}" + (f", {o['qualification']}" if o.get("qualification") else "")
                 + f" — version {o['version']}, published {o['published_display']}, data cutoff {o['data_cutoff_display']}."]
        if ev.get("latest"):
            l = ev["latest"]
            lines.append(f"_A later version (v{l['version']}, {l['version_type']}, {l['published_display']}) changed the outlook to "
                         f"{l['direction_label']}; this review is assessed against the original._")
        d = ev.get("directional", {})
        lines.append(f"**Directional assessment:** {d.get('label')} — {d.get('explanation')}.")
        for c in ev.get("conditional", []):
            lines.append(f"**Condition** ({c['side']} {c['boundary']}): {c['outcome']}.")
        return "\n\n".join(lines)
    if kind == "weekly_review":
        w = ev.get("weekly")
        head = (f"**Original weekly outlook:** {w['original']['direction_label']} — published {w['original']['published_display']}. "
                f"**Directional assessment:** {w['directional']} — {w['explanation']}." if w else
                "**No weekly analysis was published for this week.** This review uses the working theme from the daily reports.")
        rows = ["| Day | Published bias | Directional assessment | Conditional assessment |", "|---|---|---|---|"]
        for r in ev.get("days", []):
            rows.append(f"| {r['day']} | {r['published_bias']} | {r['directional']} | {r['conditional']} |")
        return head + "\n\n" + "\n".join(rows)
    return ""


def _reaction_table(bundle: dict, weekly: bool = False) -> str:
    ev = bundle.get("evaluation") or {}
    zones = ((ev.get("weekly") or {}).get("zones") if weekly else ev.get("zones")) or []
    if not zones:
        return ""
    rows = ["| Published area | Observed reaction | Analytical meaning |", "|---|---|---|"]
    for z in zones:
        rows.append(f"| {z['role'].title()} {z['area']} | {z['reaction']} | {z['meaning']} |")
    return "\n".join(rows)


def _sources(bundle: dict, body: str) -> str:
    used = []
    for grp in CITE_RE.findall(body):
        for c in grp.split(","):
            c = c.strip()
            if c not in used:
                used.append(c)
    items = {}
    for g in ("facts", "levels", "events", "policy"):
        items.update(bundle.get(g, {}))
    lines = []
    for c in sorted(used, key=lambda x: (x[0], int(x[1:]))):
        it = items.get(c)
        if not it:
            continue
        src = it.get("url") or it.get("source") or ""
        lines.append(f"- **[{c}]** {it['text']}" + (f" — _{src}_" if src and src not in it["text"] else ""))
    return "\n".join(lines)


def render(kind: str, bundle: dict, sections: dict[str, str], outlook: dict | None, headings: dict[str, str],
           version: int = 1, version_type: str = "original", published: datetime | None = None,
           change_note: str | None = None, partial: bool = False) -> tuple[str, str]:
    m = bundle["meta"]
    p = date.fromisoformat(m["period_key"])
    title = TITLES[kind].format(display=m["display"], day=p.strftime("%A").upper(), date=p.strftime("%d %B %Y"))
    out = [f"# {title}", _date_line(kind, m, published)]
    if m.get("data_mode") == "fixture":
        out.append(FIXTURE_BANNER)
    if partial:
        out.append("> **PARTIAL REPORT.** Some essential information was unavailable: " + "; ".join(bundle.get("missing", [])))
    if version > 1:
        out.append(f"> Version {version} ({version_type}). {change_note or ''}".rstrip())
    if m.get("instrument_label"):
        out.append(f"_{m['instrument_label']}_")
    if kind == "daily_analysis":
        out.append(_bias_line(outlook))  # weekly analysis carries its bias inside "Weekly Bias"
    body_parts = []
    for key, _, _ in SECTIONS[kind]:
        txt = (sections.get(key) or "").strip()
        h = headings[key]
        level = "###" if key.startswith("fundamental_") else "##"
        if key == "fundamental_base":
            body_parts.append("## Fundamental Focus — Both Economies" if kind != "daily_review" and kind != "weekly_review"
                              else ("## Fundamental Reaction — Both Economies" if kind == "daily_review" else "## Fundamental Review — Both Economies"))
        if key == "weekly_bias":
            body_parts.append(f"## {h}\n\n{_bias_line(outlook)} {txt}")
            continue
        block = f"{level} {h}\n\n"
        if key == "expected_vs_actual" or key == "bias_vs_actual":
            block += _review_header(kind, bundle) + "\n\n"
        if key == "key_events":
            block += _events_table(bundle) + "\n\n"
        if key == "technical_takeaway":
            block += _reaction_table(bundle) + "\n\n"
        if key == "technical_review":
            block += _reaction_table(bundle, weekly=True) + "\n\n"
        if kind == "daily_analysis" and key == "fundamental_base":
            body_parts.append("**Scheduled and released events**\n\n" + _events_table(bundle))
        body_parts.append(block + txt)
    body = "\n\n".join(body_parts)
    out.append(body)
    notes = [w["message"] for w in bundle.get("warnings", []) if w["code"] != "fixture_data"]
    cont_note = (bundle.get("continuity") or {}).get("note")
    if cont_note:
        notes.append(cont_note)
    if notes:
        out.append("## Data Notes\n\n" + "\n".join(f"- {n}" for n in notes))
    out.append(f"## Sources and Evidence\n\nData cutoff: {m['data_cutoff_display']}. Price provider(s): "
               f"{', '.join(m.get('providers') or ['none'])}. Session: {m.get('session_description')}\n\n" + _sources(bundle, body))
    out.append(FOOTER)
    return title, "\n\n".join(x for x in out if x)

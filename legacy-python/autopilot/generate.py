"""Autopilot report writer.

Each run: fetch Yahoo daily prices and this week's economic calendar, collect this week's earlier reports
for continuity, and ask Claude (with web search for news and central-bank context) to write the report.
Reports are saved as Markdown in reports/<INSTRUMENT>/<date>_<kind>.md; publish with build_site.py.

Usage:
  python autopilot/generate.py                   # decide what is due from the EAT calendar day
  python autopilot/generate.py --kind daily_analysis --instruments GBP_USD
  python autopilot/generate.py --dry-run          # print the request instead of calling Claude
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[1]
CFG = yaml.safe_load((Path(__file__).parent / "config.yaml").read_text())
TZ = ZoneInfo(CFG["timezone"])
TZL = CFG.get("timezone_label", "EAT")
REPORTS = ROOT / "reports"
UA = {"User-Agent": "Mozilla/5.0 (compatible; fx-analysis-desk/0.2)"}
KINDS = ("weekly_analysis", "daily_analysis", "daily_review", "weekly_review")

sys.path.insert(0, str(ROOT / "backend"))
from app.content.advice import detect_advice  # noqa: E402  (deterministic advice check)
from app.content.terminology import Dictionary, detect_terms  # noqa: E402

TERMS = Dictionary.load(yaml.safe_load((ROOT / "config" / "terminology.yaml").read_text()))


# ----------------------------------------------------------------------------- what is due
def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def due_jobs(now_local: datetime) -> list[tuple[str, date]]:
    """Report slots due on this EAT calendar day."""
    d = now_local.date()
    wd = d.weekday()  # Mon=0 .. Sun=6
    if wd == 6:
        return [("weekly_analysis", d + timedelta(days=1))]
    if wd == 5:
        return [("daily_review", d - timedelta(days=1)), ("weekly_review", monday(d))]
    jobs = [] if wd == 0 else [("daily_review", d - timedelta(days=1))]
    return jobs + [("daily_analysis", d)]


def report_path(inst: str, kind: str, period: date) -> Path:
    return REPORTS / inst / f"{period.isoformat()}_{kind}.md"


# ----------------------------------------------------------------------------- data
def yahoo_daily(symbol: str) -> dict:
    r = httpx.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                  params={"interval": "1d", "range": "3mo"}, headers=UA, timeout=30, follow_redirects=True)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    meta, q = res["meta"], res["indicators"]["quote"][0]
    tzname = meta.get("exchangeTimezoneName", "UTC")
    bars = []
    for i, t in enumerate(res.get("timestamp") or []):
        o, h, l, c = (q[k][i] for k in ("open", "high", "low", "close"))
        if None in (o, h, l, c):
            continue
        bars.append({"date": datetime.fromtimestamp(t, ZoneInfo(tzname)).date(), "open": o, "high": h, "low": l, "close": c})
    price, ptime = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
    return {"bars": bars, "price": price,
            "price_time": datetime.fromtimestamp(ptime, timezone.utc) if ptime else None, "exchange_tz": tzname}


def market_block(inst: dict, data: dict, kind: str, period: date) -> str:
    d = inst["decimals"]
    f = lambda x: f"{x:.{d}f}"  # noqa: E731
    bars = data["bars"]
    today = datetime.now(TZ).date()
    if kind in ("daily_review", "weekly_review"):
        end = period + timedelta(days=4) if kind == "weekly_review" else period
        bars = [b for b in bars if b["date"] <= end]
    else:
        # Analyses must not treat today's still-forming bar as a completed session.
        bars = [b for b in bars if b["date"] < today]
    lines = [f"Source: Yahoo Finance `{inst['yahoo']}` daily bars (dates in {data['exchange_tz']}); prices exactly as published."]
    if inst.get("note"):
        lines.append(inst["note"])
    if data["price"] is not None and kind in ("daily_analysis", "weekly_analysis"):
        lines.append(f"Latest price: {f(data['price'])} at {data['price_time'].astimezone(TZ):%a %d %b %Y %H:%M} {TZL} (a live quote, not a closing price).")
    lines.append("\n| Date | Open | High | Low | Close |\n|---|---|---|---|---|")
    for b in bars[-25:]:
        lines.append(f"| {b['date']:%a %d %b} | {f(b['open'])} | {f(b['high'])} | {f(b['low'])} | {f(b['close'])} |")
    # Simple reference levels taken straight from the bars above.
    if bars:
        wk = monday(bars[-1]["date"])
        prev_week = [b for b in bars if wk - timedelta(days=7) <= b["date"] < wk]
        this_week = [b for b in bars if b["date"] >= wk]
        last20 = bars[-20:]
        if prev_week:
            lines.append(f"\nPrevious week high / low: {f(max(b['high'] for b in prev_week))} / {f(min(b['low'] for b in prev_week))}")
        if this_week:
            lines.append(f"Week-to-date high / low: {f(max(b['high'] for b in this_week))} / {f(min(b['low'] for b in this_week))}")
        lines.append(f"20-session high / low: {f(max(b['high'] for b in last20))} / {f(min(b['low'] for b in last20))}")
    return "\n".join(lines)


def calendar_block(currencies: list[str]) -> str:
    try:
        r = httpx.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json", headers=UA, timeout=30, follow_redirects=True)
        r.raise_for_status()
        rows = r.json()
    except Exception as e:  # noqa: BLE001
        return f"Economic calendar unavailable this run ({type(e).__name__}). Use web search and say the calendar feed was unavailable."
    out = ["Source: Forex Factory weekly calendar feed (schedule, consensus = forecast, previous; no actual results).",
           f"| Time ({TZL}) | Currency | Impact | Event | Consensus | Previous |", "|---|---|---|---|---|---|"]
    for e in rows:
        if e.get("country") not in currencies or e.get("impact") not in ("High", "Medium"):
            continue
        t = datetime.fromisoformat(e["date"]).astimezone(TZ)
        out.append(f"| {t:%a %d %b %H:%M} | {e['country']} | {e['impact']} | {e['title']} | {e.get('forecast') or '—'} | {e.get('previous') or '—'} |")
    return "\n".join(out) if len(out) > 3 else "No high- or medium-impact events listed this week for these currencies."


def earlier_reports(inst: str, kind: str, period: date) -> str:
    """Published reports this report must stay consistent with.
    weekly_analysis: last week's weekly analysis and weekly review.
    daily_analysis:  this week's weekly analysis and everything published for earlier days.
    daily_review:    the same, plus the original daily analysis of the reviewed day.
    weekly_review:   every report of the week."""
    folder = REPORTS / inst
    if not folder.exists():
        return "None published yet."
    wk = monday(period)
    picks = []
    for p in sorted(folder.glob("*.md")):
        d, k = date.fromisoformat(p.name[:10]), p.stem[11:]
        if kind == "weekly_analysis":
            keep = d == wk - timedelta(days=7) and k in ("weekly_analysis", "weekly_review")
        elif not (wk <= d <= wk + timedelta(days=6)):
            keep = False
        elif kind == "weekly_review":
            keep = k != "weekly_review"
        elif k == "weekly_analysis":
            keep = True
        elif kind == "daily_review" and d == period:
            keep = k == "daily_analysis"
        else:
            keep = d < period
        if keep:
            picks.append(p)
    if not picks:
        return "None published yet." + ("" if kind == "weekly_analysis" else " No weekly analysis exists for this week.")
    if kind != "weekly_analysis" and not any(p.stem.endswith("weekly_analysis") for p in picks):
        picks_note = "\nNote: no weekly analysis was published for this week."
    else:
        picks_note = ""
    return "\n\n".join(f"----- {p.stem} -----\n{strip_front_matter(p.read_text())}" for p in picks[-12:]) + picks_note


def strip_front_matter(text: str) -> str:
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)


# ----------------------------------------------------------------------------- Claude
def write_report(client, kind: str, inst_code: str, inst: dict, period: date, user: str) -> tuple[str, str]:
    import anthropic
    system = [{"type": "text", "text": (Path(__file__).parent / "prompt.md").read_text(), "cache_control": {"type": "ephemeral"}}]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": CFG.get("web_searches_per_report", 5)}]
    messages = [{"role": "user", "content": user}]

    def call(msgs):
        resp = None
        for _ in range(6):  # resume server-side tool loops that pause
            resp = client.beta.messages.create(
                model=CFG["model"], max_tokens=16000, system=system, tools=tools, messages=msgs,
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                output_config={"effort": CFG.get("effort", "medium")})
            if resp.stop_reason != "pause_turn":
                break
            msgs = msgs + [{"role": "assistant", "content": resp.content}]
        return resp, msgs

    try:
        resp, convo = call(messages)
    except anthropic.APIStatusError as e:
        raise SystemExit(f"Claude API error {e.status_code}: {e.message}")
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude declined to write this report")
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    text = text[text.find("# "):] if "# " in text else text

    issues = [f"{f.message} \"{f.excerpt}\"" for f in detect_advice(text) + detect_terms(text, TERMS)]
    if issues:  # one revision pass with the exact problems
        convo = convo + [{"role": "assistant", "content": resp.content},
                         {"role": "user", "content": "Rewrite the complete report, fixing these problems (no trading advice, "
                                                     "no unapproved terms):\n- " + "\n- ".join(issues)}]
        resp, _ = call(convo)
        text2 = "".join(b.text for b in resp.content if b.type == "text").strip()
        if "# " in text2:
            text = text2[text2.find("# "):]
    remaining = detect_advice(text) + detect_terms(text, TERMS)
    status = "flagged" if remaining else "ok"
    return text, status


def build_request(kind: str, inst_code: str, inst: dict, period: date, now_local: datetime) -> str:
    curr = [c for c in (inst["base"], inst["quote"]) if len(c) == 3 and c.isupper() and c not in ("XAU",)] or ["USD"]
    data = yahoo_daily(inst["yahoo"])
    wk = monday(period)
    what = {
        "weekly_analysis": f"the WEEKLY ANALYSIS for the week {wk:%d %b} – {wk + timedelta(days=4):%d %b %Y}",
        "daily_analysis": f"the DAILY ANALYSIS for {period:%A %d %B %Y}",
        "daily_review": f"the REVIEW of the session on {period:%A %d %B %Y}",
        "weekly_review": f"the WEEKLY REVIEW of the week {wk:%d %b} – {wk + timedelta(days=4):%d %b %Y}",
    }[kind]
    return f"""Write {what} for {inst['name']} (base: {inst['base']}, quote: {inst['quote']}).
Report type: {kind}. Publication time: {now_local:%a %d %b %Y %H:%M} {TZL}. Follow the {kind} template.

## Market data
{market_block(inst, data, kind, period)}

## Economic calendar (this week, times in {TZL})
{calendar_block(curr)}

## Earlier reports (continuity — quote earlier biases exactly)
{earlier_reports(inst_code, kind, period)}

Search the web for the latest news, central-bank communication and data results for {' and '.join(curr)} relevant to this period, cite sources, then write the report."""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=KINDS)
    ap.add_argument("--date", help="report period (YYYY-MM-DD); default: what is due today")
    ap.add_argument("--instruments", help="space-separated codes; default: scheduled_instruments")
    ap.add_argument("--force", action="store_true", help="overwrite an existing report")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    now_local = datetime.now(TZ)
    if a.kind:
        period = date.fromisoformat(a.date) if a.date else now_local.date()
        if a.kind == "weekly_analysis":   # the week being analysed; on a Sunday that is the coming week
            period = period + timedelta(days=1) if period.weekday() == 6 else monday(period)
        elif a.kind == "weekly_review":
            period = monday(period)
        jobs = [(a.kind, period)]
    else:
        jobs = due_jobs(now_local)
    codes = a.instruments.split() if a.instruments else CFG["scheduled_instruments"]

    client = None
    if not a.dry_run:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("ANTHROPIC_API_KEY is not set", file=sys.stderr)
            return 2
        import anthropic
        client = anthropic.Anthropic()

    failures = 0
    for kind, period in jobs:
        for code in codes:
            inst = CFG["instruments"][code]
            path = report_path(code, kind, period)
            if path.exists() and not a.force:
                print(f"skip  {path.relative_to(ROOT)} (already published)")
                continue
            try:
                req = build_request(kind, code, inst, period, now_local)
                if a.dry_run:
                    print(f"===== {code} {kind} {period} =====\n{req}\n")
                    continue
                text, status = write_report(client, kind, code, inst, period, req)
                path.parent.mkdir(parents=True, exist_ok=True)
                front = {"instrument": code, "name": inst["name"], "kind": kind, "period": period.isoformat(),
                         "published": now_local.isoformat(timespec="minutes"), "model": CFG["model"], "check": status}
                path.write_text("---\n" + yaml.safe_dump(front, sort_keys=False) + "---\n" + text + "\n")
                print(f"wrote {path.relative_to(ROOT)} ({status})")
            except Exception as e:  # noqa: BLE001 - one instrument failing must not stop the others
                failures += 1
                print(f"FAIL  {code} {kind} {period}: {type(e).__name__}: {e}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

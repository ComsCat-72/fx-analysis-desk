"""Builds the static reports website from reports/**.md into site/ (published to GitHub Pages)."""
from __future__ import annotations

import html
import re
import shutil
from datetime import date
from pathlib import Path

import markdown
import yaml

ROOT = Path(__file__).resolve().parents[1]
CFG = yaml.safe_load((Path(__file__).parent / "config.yaml").read_text())
REPORTS, SITE = ROOT / "reports", ROOT / "site"
LABEL = {"weekly_analysis": "Weekly analysis", "daily_analysis": "Daily analysis",
         "daily_review": "Session review", "weekly_review": "Weekly review"}
ORDER = {"weekly_analysis": 0, "daily_analysis": 1, "daily_review": 2, "weekly_review": 3}

CSS = """
:root{--bg:#070b14;--surface:#0d1322;--surface2:#131b2e;--line:#233049;--text:#e6ebf5;--muted:#95a2bb;--faint:#6b7892;
--accent:#8fb0ff;--accent-soft:rgba(143,176,255,.12);--warn:#f5b544;--warn-soft:rgba(245,181,68,.12);color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--bg:#f4f6fb;--surface:#fff;--surface2:#f7f9fd;--line:#dde3ee;
--text:#0e1424;--muted:#55627a;--faint:#7a869d;--accent:#3556c9;--accent-soft:rgba(53,86,201,.09);--warn:#a35f00;--warn-soft:rgba(196,120,0,.1);color-scheme:light}}
:root[data-theme="light"]{--bg:#f4f6fb;--surface:#fff;--surface2:#f7f9fd;--line:#dde3ee;--text:#0e1424;--muted:#55627a;--faint:#7a869d;
--accent:#3556c9;--accent-soft:rgba(53,86,201,.09);--warn:#a35f00;--warn-soft:rgba(196,120,0,.1);color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:15px/1.6 "Fira Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}header.top{border-bottom:1px solid var(--line);background:var(--surface)}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.bar{display:flex;align-items:center;gap:12px;min-height:60px;flex-wrap:wrap}
.brand{font-weight:600;color:var(--text);text-decoration:none}.brand small{display:block;font-weight:400;color:var(--faint);font-size:12px}
nav.inst{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
nav.inst a{font:500 13px/1 "Fira Code",monospace;text-decoration:none;color:var(--muted);padding:7px 9px;border:1px solid var(--line);border-radius:8px}
nav.inst a:hover,nav.inst a.on{color:var(--text);border-color:var(--accent);background:var(--accent-soft)}
main{padding:24px 0 56px}h1.page{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.card h2{font-size:15px;margin:0 0 8px;display:flex;justify-content:space-between;gap:8px}
.card h2 span{font:500 11px/1.6 "Fira Code",monospace;color:var(--faint)}
.card ul{list-style:none;margin:0;padding:0}.card li{padding:5px 0;border-top:1px solid var(--line);font-size:13.5px}
.card li:first-child{border-top:0}.card li a{text-decoration:none}.card li a:hover{text-decoration:underline}
.date{font:12px "Fira Code",monospace;color:var(--faint);margin-right:6px}
.flag{font-size:11px;color:var(--warn);background:var(--warn-soft);border-radius:5px;padding:1px 5px;margin-left:4px}
.list{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.list .row{display:flex;gap:10px;align-items:baseline;padding:10px 16px;border-top:1px solid var(--line)}.list .row:first-child{border-top:0}
.list .row .k{color:var(--muted);font-size:13px;min-width:120px}
article{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px 26px;max-width:820px}
article h1{font-size:23px;margin:0 0 4px;line-height:1.25}article h1+p{color:var(--muted);font:13px "Fira Code",monospace;margin-top:0}
article h2{font-size:16.5px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
article h3{font-size:13px;margin:16px 0 4px;color:var(--accent);text-transform:uppercase;letter-spacing:.06em}
article table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0 14px;display:block;overflow-x:auto}
article th,article td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
article th{background:var(--surface2);color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em}
article blockquote{margin:12px 0;padding:8px 12px;border-left:3px solid var(--warn);background:var(--warn-soft);border-radius:6px}
.meta{color:var(--faint);font-size:12.5px;margin:0 0 14px}.disclaimer{color:var(--faint);font-size:12.5px;margin-top:22px}
.crumbs{font-size:13px;margin-bottom:12px;color:var(--muted)}
.theme{margin-left:8px;background:none;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:6px 9px;cursor:pointer}
@media (max-width:640px){article{padding:16px}nav.inst{margin-left:0}}
"""

THEME_JS = """<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}
function toggleTheme(){var r=document.documentElement,n=(r.dataset.theme||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'))==='light'?'dark':'light';
r.dataset.theme=n;try{localStorage.setItem('theme',n)}catch(e){}}</script>"""


def page(title: str, body: str, depth: int, active: str | None = None) -> str:
    up = "../" * depth
    nav = "".join(f'<a class="{"on" if c == active else ""}" href="{up}{c}/">{html.escape(i["name"])}</a>'
                  for c, i in CFG["instruments"].items())
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Fira+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style>{THEME_JS}</head><body>
<header class="top"><div class="wrap bar"><a class="brand" href="{up}index.html">{html.escape(CFG.get('site_title', 'FX Analysis Desk'))}
<small>Analysis and reporting · not trading advice</small></a><nav class="inst">{nav}</nav>
<button class="theme" onclick="toggleTheme()" aria-label="Toggle light or dark theme">◐</button></div></header>
<main class="wrap">{body}</main></body></html>"""


def load() -> list[dict]:
    out = []
    for p in sorted(REPORTS.glob("*/*.md")):
        raw = p.read_text()
        m = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", raw, flags=re.S)
        meta, body = (yaml.safe_load(m.group(1)), m.group(2)) if m else ({}, raw)
        title = next((l[2:].strip() for l in body.splitlines() if l.startswith("# ")), p.stem)
        out.append({"inst": p.parent.name, "kind": meta.get("kind", p.stem[11:]), "period": p.name[:10], "meta": meta,
                    "title": title, "body": body, "slug": p.stem})
    return out


def when(value) -> str:
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(value)).strftime("%a %d %b %Y %H:%M") + " " + CFG.get("timezone_label", "")
    except ValueError:
        return str(value)


def link(r: dict, depth: int) -> str:
    flag = '<span class="flag" title="An automated check flagged wording in this report">check</span>' if r["meta"].get("check") == "flagged" else ""
    return f'<a href="{"../" * depth}{r["inst"]}/{r["slug"]}.html">{html.escape(LABEL.get(r["kind"], r["kind"]))}</a>{flag}'


def main() -> None:
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    reports = load()
    md = markdown.Markdown(extensions=["tables", "sane_lists"])
    by_inst: dict[str, list[dict]] = {}
    for r in reports:
        by_inst.setdefault(r["inst"], []).append(r)

    for code, items in by_inst.items():
        d = SITE / code
        d.mkdir()
        items.sort(key=lambda r: (r["period"], ORDER.get(r["kind"], 9)), reverse=True)
        for r in items:
            md.reset()
            body_html = md.convert(r["body"])
            body_html = body_html.replace("<a href=\"http", "<a target=\"_blank\" rel=\"noopener\" href=\"http")
            pub = r["meta"].get("published", "")
            meta = f'<p class="meta">Published {html.escape(when(pub))} · written by {html.escape(str(r["meta"].get("model", "")))}</p>'
            crumbs = f'<div class="crumbs"><a href="../index.html">Home</a> / <a href="./">{html.escape(CFG["instruments"].get(code, {}).get("name", code))}</a></div>'
            disc = '<p class="disclaimer">Analysis only. This report explains market behaviour and does not recommend buying, selling or positioning in any market.</p>'
            (d / f"{r['slug']}.html").write_text(page(r["title"], crumbs + meta + f"<article>{body_html}</article>" + disc, 1, code))
        rows = "".join(f'<div class="row"><span class="date">{date.fromisoformat(r["period"]):%a %d %b %Y}</span><span class="k">{link(r, 1)}</span>'
                       f'<span>{html.escape(r["title"])}</span></div>' for r in items)
        name = CFG["instruments"].get(code, {}).get("name", code)
        (d / "index.html").write_text(page(name, f'<h1 class="page">{html.escape(name)}</h1><p class="sub">All reports, newest first.</p>'
                                                f'<div class="list">{rows}</div>', 1, code))

    cards = []
    for code, inst in CFG["instruments"].items():
        items = by_inst.get(code, [])[:6]
        lis = "".join(f'<li><span class="date">{date.fromisoformat(r["period"]):%d %b}</span>{link(r, 0)}</li>' for r in items) \
            or '<li style="color:var(--faint)">No reports yet</li>'
        cards.append(f'<section class="card"><h2><a href="{code}/" style="color:inherit;text-decoration:none">{html.escape(inst["name"])}</a>'
                     f'<span>{code}</span></h2><ul>{lis}</ul></section>')
    latest = max((r["meta"].get("published", "") for r in reports), default="")
    sub = f"Latest update {when(latest)}" if latest else "Reports appear here after the first scheduled run."
    (SITE / "index.html").write_text(page(CFG.get("site_title", "FX Analysis Desk"),
                                          f'<h1 class="page">Market reports</h1><p class="sub">{html.escape(sub)}</p><div class="grid">{"".join(cards)}</div>', 0))
    (SITE / ".nojekyll").write_text("")
    print(f"built {len(reports)} reports into {SITE.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()

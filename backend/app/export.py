"""Markdown and PDF export of report versions."""
from __future__ import annotations

import markdown as md

CSS = """
@page { size: A4; margin: 18mm 16mm; @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt; color: #64748b; } }
body { font-family: 'Fira Sans', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #0f172a; }
h1 { font-size: 17pt; margin: 0 0 2mm; letter-spacing: .01em; }
h2 { font-size: 12pt; margin: 6mm 0 2mm; border-bottom: 1px solid #cbd5e1; padding-bottom: 1mm; }
h3 { font-size: 10.5pt; margin: 4mm 0 1mm; }
table { border-collapse: collapse; width: 100%; margin: 2mm 0 3mm; font-size: 8.5pt; }
th, td { border: 1px solid #cbd5e1; padding: 1.2mm 1.6mm; text-align: left; vertical-align: top; }
th { background: #f1f5f9; }
blockquote { margin: 3mm 0; padding: 2mm 3mm; background: #fef3c7; border-left: 3px solid #b45309; color: #78350f; }
code { font-family: 'Fira Code', monospace; }
em { color: #475569; }
"""


def to_html(body_md: str, title: str) -> str:
    html = md.markdown(body_md, extensions=["tables", "sane_lists"])
    return f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title><style>{CSS}</style></head><body>{html}</body></html>"


SIMPLE_CSS = """
@page { size: a4 portrait; margin: 16mm; }
body { font-family: Helvetica; font-size: 9.5pt; color: #0f172a; }
h1 { font-size: 16pt; } h2 { font-size: 12pt; margin-top: 10px; } h3 { font-size: 10.5pt; }
table { border: 0.5px solid #cbd5e1; } th, td { padding: 3px; font-size: 8pt; } th { background-color: #f1f5f9; }
blockquote { background-color: #fef3c7; padding: 6px; }
"""


def to_pdf(body_md: str, title: str) -> bytes:
    """WeasyPrint when its system libraries exist (Docker, local); otherwise the pure-Python
    xhtml2pdf renderer (serverless hosts such as Vercel, which lack Pango)."""
    try:
        from weasyprint import HTML
        return HTML(string=to_html(body_md, title)).write_pdf()
    except (ImportError, OSError):
        return _to_pdf_simple(body_md, title)


def _to_pdf_simple(body_md: str, title: str) -> bytes:
    import io

    from xhtml2pdf import pisa
    html = md.markdown(body_md, extensions=["tables", "sane_lists"])
    doc = f"<html><head><meta charset='utf-8'><title>{title}</title><style>{SIMPLE_CSS}</style></head><body>{html}</body></html>"
    out = io.BytesIO()
    result = pisa.CreatePDF(doc, dest=out, encoding="utf-8")
    if result.err:
        raise RuntimeError("PDF rendering failed")
    return out.getvalue()

"""Copies instruments and session definitions from config into the database (idempotent)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import app_config
from ..models import Instrument, SessionDefinition


def sync_config(db: Session) -> None:
    cfg = app_config()
    for code, c in cfg["instruments"].items():
        row = db.get(Instrument, code) or Instrument(code=code)
        row.display, row.base, row.quote, row.kind = c["display"], c["base"], c["quote"], c["kind"]
        row.decimals, row.provider_symbol, row.label = int(c["decimals"]), (c.get("symbols") or {}).get(c.get("price_provider") or ""), c.get("label")
        row.enabled = c.get("enabled", True)
        db.merge(row)
    for name, s in cfg["sessions"].items():
        if name == "holidays":
            continue
        row = db.get(SessionDefinition, name) or SessionDefinition(name=name)
        row.anchor_timezone, row.daily_close = s["anchor_timezone"], s.get("daily_close", "17:00")
        row.week_open_weekday, row.week_close_weekday = s.get("week_open_weekday", 6), s.get("week_close_weekday", 4)
        row.holidays = [str(h) for h in cfg["sessions"].get("holidays", [])]
        row.description = s.get("description")
        db.merge(row)

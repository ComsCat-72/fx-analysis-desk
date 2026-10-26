from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from app.providers.fixtures import FixtureCalendar, FixturePriceProvider
from app.services import ingest
from app.services.registry import instruments, session_def


def test_api_flow(db):
    s = session_def()
    ingest.ingest_prices(db, FixturePriceProvider(s), instruments()["GBP_USD"], s, date(2026, 8, 3), date(2026, 10, 30),
                         as_of=datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
    ingest.upsert_events(db, FixtureCalendar(datetime(2026, 10, 26, tzinfo=timezone.utc)).week_events())
    db.commit()
    from app.api.main import app
    c = TestClient(app)
    cfg = c.get("/api/config").json()
    assert cfg["display"]["timezone"] == "Africa/Kampala" and any(i["code"] == "GBP_USD" for i in cfg["instruments"])
    r = c.post("/api/reports/draft", json={"instrument": "GBP_USD", "kind": "weekly_analysis", "period": "2026-10-26",
                                           "writer": "template"})
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    assert r.json()["status"] == "draft"
    p = c.post(f"/api/reports/{vid}/publish", json={})
    assert p.status_code == 200, p.text
    assert p.json()["status"] == "published"
    assert c.post(f"/api/reports/{vid}/publish", json={}).status_code == 409   # already published
    wk = c.get("/api/weeks/GBP_USD/2026-10-26").json()
    assert wk["weekly_analysis"][0]["id"] == vid and len(wk["days"]) == 5
    md = c.get(f"/api/reports/{vid}/export.md")
    assert md.status_code == 200 and md.text.startswith("# GBP/USD")
    pdf = c.get(f"/api/reports/{vid}/export.pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    cal = c.get("/api/calendar", params={"instrument": "GBP_USD", "week_key": "2026-10-26"}).json()
    assert cal and cal[0]["time_eat"].startswith("Tue 27 Oct") and cal[0]["is_fixture"]
    assert c.put("/api/settings/publication-mode", json={"mode": "automatic"}).status_code == 400
    assert c.put("/api/settings/publication-mode", json={"mode": "automatic", "confirm_automatic": True}).status_code == 200
    lv = c.post("/api/levels", json={"instrument": "GBP_USD", "lower": 0.99, "upper": 0.991, "role": "support",
                                     "reason": "user zone"})
    assert lv.status_code == 200
    assert c.get("/api/levels", params={"instrument": "GBP_USD"}).json()
    # no trading endpoints exist
    paths = {r.path for r in app.routes}
    assert not [p for p in paths if any(w in p for w in ("order", "trade", "signal", "position", "broker"))]

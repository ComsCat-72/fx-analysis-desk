from fastapi.testclient import TestClient


def test_empty_database_draft_fetches_data_first(db):
    """The deployed-dashboard case: nothing ingested yet, user clicks Generate draft."""
    db.commit()
    from app.api.main import app
    c = TestClient(app)
    assert c.get("/api/freshness", params={"instrument": "GBP_USD"}).json()["status"] == "missing"
    r = c.post("/api/reports/draft", json={"instrument": "GBP_USD", "kind": "daily_analysis",
                                          "period": __import__("datetime").date.today().isoformat(), "writer": "template"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["refresh_problems"] == []
    assert body["facts"]["facts"], "the draft should be built on freshly ingested data"
    assert c.get("/api/freshness", params={"instrument": "GBP_USD"}).json()["status"] != "missing"
    assert c.get(f"/api/reports/{body['id']}").status_code == 200


def test_refresh_endpoint_and_health(db):
    db.commit()
    from app.api.main import app
    c = TestClient(app)
    r = c.post("/api/refresh", json={"instrument": "EUR_USD"})
    assert r.status_code == 200 and r.json()["problems"] == []
    h = c.get("/api/health").json()
    assert h["ok"] and h["persistent_database"] is True

from fastapi.testclient import TestClient


def test_admin_token_guard(db, monkeypatch):
    from app import config
    from app.api.main import app
    monkeypatch.setattr(config.env(), "admin_token", "s3cret")
    c = TestClient(app)
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/config").status_code == 200                      # reads open by default
    body = {"instrument": "GBP_USD", "kind": "daily_analysis", "period": "2026-10-26", "writer": "template"}
    assert c.post("/api/reports/draft", json=body).status_code == 401     # writes need the token
    assert c.post("/api/reports/draft", json=body, headers={"X-Admin-Token": "wrong"}).status_code == 401
    assert c.post("/api/reports/draft", json=body, headers={"X-Admin-Token": "s3cret"}).status_code != 401
    monkeypatch.setattr(config.env(), "protect_reads", True)
    assert c.get("/api/config").status_code == 401
    assert c.get("/api/config", headers={"X-Admin-Token": "s3cret"}).status_code == 200
    assert c.get("/api/auth/check").json()["token_required"] is True

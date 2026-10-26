"""Claude writer and semantic review against a mocked client (no network, no API key)."""
import json
from types import SimpleNamespace

from app.content.semantic import semantic_review
from app.reports.writer import ClaudeWriter, output_schema


class FakeMessages:
    def __init__(self, payloads):
        self.payloads = list(payloads)
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        p = self.payloads.pop(0)
        return SimpleNamespace(stop_reason=p.get("stop", "end_turn"), model="claude-opus-5-5",
                               content=[SimpleNamespace(type="text", text=json.dumps(p["json"]))])


def fake_client(payloads):
    m = FakeMessages(payloads)
    return SimpleNamespace(beta=SimpleNamespace(messages=m)), m


BUNDLE = {"meta": {"display": "GBP/USD"}, "facts": {}, "levels": {}, "events": {}, "policy": {}}


def test_schema_requires_all_sections_and_outlook():
    s = output_schema("daily_analysis")
    assert s["additionalProperties"] is False
    assert set(s["properties"]["sections"]["required"]) >= {"market_context", "analytical_outlook", "key_question"}
    assert s["properties"]["outlook"]["properties"]["direction"]["enum"] == ["upward_lean", "downward_lean", "neutral", "range_bound"]
    assert "outlook" not in output_schema("daily_review")["properties"]


def test_request_shape_and_parsing():
    out = {"sections": {"x": "y"}, "outlook": None}
    client, m = fake_client([{"json": out}])
    w = ClaudeWriter(client=client, model="claude-opus-5-5", effort="high")
    r = w.write("daily_review", BUNDLE, {"expected_vs_actual": "E", "fundamental_base": "B", "fundamental_quote": "Q",
                                          "why_moved": "W", "technical_takeaway": "T", "daily_conclusion": "C"})
    call = m.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"]["format"]["type"] == "json_schema" and call["output_config"]["effort"] == "high"
    assert call["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "temperature" not in call and "thinking" not in call
    assert r["sections"] == {"x": "y"} and r["model"] == "claude-opus-5-5"


def test_refusal_raises():
    import pytest
    from app.reports.writer import WriterError
    client, _ = fake_client([{"json": {}, "stop": "refusal"}])
    with pytest.raises(WriterError):
        ClaudeWriter(client=client).write("daily_review", BUNDLE, {k: k for k in
                                         ["expected_vs_actual", "fundamental_base", "fundamental_quote", "why_moved", "technical_takeaway", "daily_conclusion"]})


def test_semantic_review_maps_issues():
    client, _ = fake_client([{"json": {"issues": [{"category": "advice", "severity": "blocking",
                                                   "quote": "room toward 1.31", "explanation": "price objective"}]}}])
    f = semantic_review("body", BUNDLE, client=client)
    assert f[0].check == "semantic" and f[0].severity == "blocking" and f[0].excerpt == "room toward 1.31"


def test_semantic_review_without_key_is_flagged(monkeypatch):
    from app import config
    monkeypatch.setattr(config.env(), "anthropic_api_key", None)
    f = semantic_review("body", BUNDLE)
    assert f[0].category == "not_run"


def test_revision_loop_feeds_back_findings(db, monkeypatch):
    """A draft with advice is sent back once with the findings; the revised draft is used."""
    from datetime import date, datetime, timezone
    from app.providers.fixtures import FixturePriceProvider
    from app.reports import service, writer as wmod
    from app.services import ingest
    from app.services.registry import instruments, session_def
    s = session_def()
    ingest.ingest_prices(db, FixturePriceProvider(s), instruments()["GBP_USD"], s, date(2026, 8, 3), date(2026, 10, 30),
                         as_of=datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
    secs_bad = {k: "Buy the pair now." if k == "analytical_outlook" else "Price context is mixed."
                for k in output_schema("daily_analysis")["properties"]["sections"]["required"]}
    secs_good = dict(secs_bad, analytical_outlook="A sustained move above resistance would strengthen the upward interpretation.")
    ol = {"direction": "neutral", "qualification": "while price stays inside the range", "conditions": [],
          "range_level_ids": [], "zone_ids": []}
    client, m = fake_client([{"json": {"sections": secs_bad, "outlook": ol}}, {"json": {"sections": secs_good, "outlook": ol}},
                             {"json": {"issues": []}}])
    monkeypatch.setattr(wmod, "get_writer", lambda name=None: ClaudeWriter(client=client))
    monkeypatch.setattr(service, "get_writer", lambda name=None: ClaudeWriter(client=client))
    monkeypatch.setattr("app.reports.service.semantic_review", lambda body, bundle: semantic_review(body, bundle, client=client))
    v = service.generate_draft(db, "GBP_USD", "daily_analysis", date(2026, 10, 27),
                               cutoff=datetime(2026, 10, 27, 5, 30, tzinfo=timezone.utc))
    assert "previous draft failed" in m.calls[1]["messages"][0]["content"]
    assert v.sections["text"]["analytical_outlook"].startswith("A sustained move")
    assert not [f for f in v.checks["findings"] if f["check"] == "advice"]

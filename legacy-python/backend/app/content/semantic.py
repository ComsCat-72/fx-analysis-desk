"""Semantic review step: a second model pass that reads the draft against the bundle."""
from __future__ import annotations

import json
from pathlib import Path

from ..config import env
from .advice import Finding

PROMPT = (Path(__file__).resolve().parents[1] / "reports" / "prompts" / "review.md").read_text()

SCHEMA = {
    "type": "object",
    "properties": {"issues": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": ["advice", "terminology", "factual", "continuity", "integrity", "style"]},
            "severity": {"type": "string", "enum": ["blocking", "warning"]},
            "quote": {"type": "string"},
            "explanation": {"type": "string"},
        },
        "required": ["category", "severity", "quote", "explanation"], "additionalProperties": False}}},
    "required": ["issues"], "additionalProperties": False,
}


def semantic_review(body_md: str, bundle: dict, client=None) -> list[Finding]:
    e = env()
    if client is None:
        if not e.anthropic_api_key:
            return [Finding("semantic", "not_run", "warning",
                            "Semantic review not run (ANTHROPIC_API_KEY not set). Deterministic checks only.")]
        import anthropic
        client = anthropic.Anthropic(api_key=e.anthropic_api_key)
    import anthropic
    try:
        resp = client.beta.messages.create(
            model=e.claude_review_model, max_tokens=8000,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            system=[{"type": "text", "text": PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": "Draft report:\n\n" + body_md + "\n\nFact bundle:\n```json\n"
                       + json.dumps(bundle, indent=1, default=str) + "\n```"}],
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as ex:
        return [Finding("semantic", "not_run", "blocking", f"Semantic review failed: {ex}")]
    if resp.stop_reason == "refusal":
        return [Finding("semantic", "not_run", "blocking", "Semantic reviewer declined; manual review required.")]
    text = next((b.text for b in resp.content if b.type == "text"), "{}")
    issues = json.loads(text).get("issues", [])
    return [Finding("semantic", i["category"], i["severity"], i["explanation"], i["quote"]) for i in issues]

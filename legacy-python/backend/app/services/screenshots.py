"""Chart screenshots: store, optionally extract visible levels with Claude vision, require confirmation.

Extracted readings are always labelled approximate. They never become levels until the user confirms
them, and an old screenshot never says anything about later price behaviour.
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

from ..config import env

SCHEMA = {
    "type": "object",
    "properties": {
        "timeframe": {"type": "string", "description": "Timeframe label visible on the chart, or 'unknown'"},
        "chart_timestamp": {"type": "string", "description": "Latest date/time visible on the chart axis or header, or 'unknown'"},
        "instrument": {"type": "string"},
        "levels": {"type": "array", "items": {"type": "object", "properties": {
            "lower": {"type": "number"}, "upper": {"type": "number"},
            "label": {"type": "string", "description": "Text drawn next to the level, if any"},
            "clarity": {"type": "string", "enum": ["clear", "unclear"]}},
            "required": ["lower", "upper", "label", "clarity"], "additionalProperties": False}},
        "annotations": {"type": "array", "items": {"type": "string"}, "description": "User annotations exactly as written"},
    },
    "required": ["timeframe", "chart_timestamp", "instrument", "levels", "annotations"],
    "additionalProperties": False,
}

PROMPT = ("Read this trading chart screenshot. Report only what is visible: the timeframe label, the latest visible "
          "timestamp, the instrument, horizontal levels or zones drawn by the user (price readings from the axis), and any "
          "text annotations exactly as written. Do not describe what price did after the screenshot, do not predict, and do "
          "not interpret annotations. Mark a level 'unclear' if its price cannot be read precisely from the axis.")


def save_upload(data: bytes, filename: str) -> Path:
    d = env().storage_dir
    d.mkdir(parents=True, exist_ok=True)
    import hashlib
    p = d / f"{hashlib.sha256(data).hexdigest()[:16]}{Path(filename).suffix.lower() or '.png'}"
    p.write_bytes(data)
    return p


def extract(path: Path, media_type: str, client=None) -> dict:
    e = env()
    if client is None:
        if not e.anthropic_api_key:
            return {"status": "manual_entry_required", "reason": "ANTHROPIC_API_KEY not set; enter levels manually."}
        import anthropic
        client = anthropic.Anthropic(api_key=e.anthropic_api_key)
    resp = client.beta.messages.create(
        model=e.claude_model, max_tokens=4000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                         "data": base64.b64encode(path.read_bytes()).decode()}},
            {"type": "text", "text": PROMPT}]}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    if resp.stop_reason == "refusal":
        return {"status": "manual_entry_required", "reason": "extraction declined"}
    text = next((b.text for b in resp.content if b.type == "text"), "{}")
    out = json.loads(text)
    out["status"] = "needs_confirmation"
    out["note"] = "Approximate readings from a screenshot. Confirm or correct each level before use."
    return out

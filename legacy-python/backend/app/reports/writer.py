"""Report writers. Both return {"sections": {...}, "outlook": {...} | None}.

ClaudeWriter: synthesises the fact bundle into section text with citations (structured JSON output).
TemplateWriter: offline, deterministic sentences only; its bias comes from a stated rule (1H structure).
"""
from __future__ import annotations

import json
from pathlib import Path

from ..config import env
from .templates import ANALYSIS_KINDS, SECTIONS

PROMPTS = Path(__file__).parent / "prompts"
DIRECTIONS = ["upward_lean", "downward_lean", "neutral", "range_bound"]


class WriterError(RuntimeError):
    pass


def output_schema(kind: str) -> dict:
    sec_props = {k: {"type": "string"} for k, _, _ in SECTIONS[kind]}
    props: dict = {"sections": {"type": "object", "properties": sec_props, "required": list(sec_props),
                                "additionalProperties": False}}
    required = ["sections"]
    if kind in ANALYSIS_KINDS:
        props["outlook"] = {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": DIRECTIONS},
                "qualification": {"type": "string", "description": "Short qualifier, e.g. 'while support holds'"},
                "conditions": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "level_id": {"type": "string", "description": "L# id of the level the condition refers to"},
                        "boundary": {"type": "string", "enum": ["lower", "upper"]},
                        "side": {"type": "string", "enum": ["above", "below"]},
                        "effect": {"type": "string", "enum": ["strengthens", "weakens"]},
                        "text": {"type": "string"},
                    },
                    "required": ["level_id", "boundary", "side", "effect", "text"], "additionalProperties": False}},
                "range_level_ids": {"type": "array", "items": {"type": "string"},
                                    "description": "For range_bound: [support L#, resistance L#]; otherwise empty"},
                "zone_ids": {"type": "array", "items": {"type": "string"},
                             "description": "L# ids of the levels this report publishes as reference areas"},
            },
            "required": ["direction", "qualification", "conditions", "range_level_ids", "zone_ids"],
            "additionalProperties": False,
        }
        required.append("outlook")
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


def _user_message(kind: str, bundle: dict, headings: dict, length: tuple[int, int] | None, revision_notes: list[str] | None) -> str:
    spec = "\n".join(f"- `{k}` ({headings[k]}): {g}" for k, _, g in SECTIONS[kind])
    words = f"Total length of all sections: {length[0]}-{length[1]} words." if length else ""
    notes = ""
    if revision_notes:
        notes = "\n\nA previous draft failed these checks. Fix every one:\n" + "\n".join(f"- {n}" for n in revision_notes)
    return (f"Report type: {kind}\nInstrument: {bundle['meta']['display']}\n\nSections to write:\n{spec}\n{words}\n"
            + ("\nAlso return the structured outlook. Conditions must reference level IDs from the bundle; "
               "`side` is where price must close relative to that level's `boundary` for the condition to be met.\n"
               if kind in ANALYSIS_KINDS else "")
            + notes + "\n\nFact bundle (JSON):\n```json\n" + json.dumps(bundle, indent=1, default=str) + "\n```")


class ClaudeWriter:
    name = "claude"

    def __init__(self, client=None, model: str | None = None, effort: str | None = None):
        e = env()
        if client is None:
            import anthropic
            if not e.anthropic_api_key:
                raise WriterError("ANTHROPIC_API_KEY is not set; use writer=template for offline drafts")
            client = anthropic.Anthropic(api_key=e.anthropic_api_key)
        self.client = client
        self.model = model or e.claude_model
        self.effort = effort or e.claude_effort
        self.system = (PROMPTS / "system.md").read_text()

    def write(self, kind: str, bundle: dict, headings: dict, length=None, revision_notes=None) -> dict:
        import anthropic
        try:
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                # Frozen policy prompt first so it is cached across reports.
                system=[{"type": "text", "text": self.system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": _user_message(kind, bundle, headings, length, revision_notes)}],
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": output_schema(kind)}},
            )
        except anthropic.RateLimitError as e:
            raise WriterError(f"rate limited: {e}") from e
        except anthropic.APIStatusError as e:
            raise WriterError(f"Claude API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise WriterError(f"Claude API connection error: {e}") from e
        if resp.stop_reason == "refusal":
            raise WriterError("the model declined to write this report")
        if resp.stop_reason == "max_tokens":
            raise WriterError("the draft was cut off at max_tokens")
        text = next((b.text for b in resp.content if b.type == "text"), None)
        if not text:
            raise WriterError("no text in model response")
        out = json.loads(text)
        out["model"] = resp.model
        return out


class TemplateWriter:
    """Deterministic, offline writer. Uses only bundle sentences, so every statement is traceable.
    Bias rule: 1H structure upward -> upward lean; downward -> downward lean; otherwise neutral."""
    name = "template"

    def write(self, kind: str, bundle: dict, headings: dict, length=None, revision_notes=None) -> dict:
        m = bundle["meta"]
        facts, levels, events, policy = bundle["facts"], bundle["levels"], bundle["events"], bundle["policy"]
        cont, ev = bundle.get("continuity", {}), bundle.get("evaluation") or {}

        def cite(i):
            return f"[{i}]"

        def fx(item):
            """Fact text with its citation before the full stop of every sentence it contains."""
            from ..content.checks import split_sentences
            return " ".join(f"{x.rstrip().rstrip('.')} [{item['id']}]." for x in split_sentences(item["text"]))

        def first(role):
            return next((f for f in facts.values() if f.get("role") == role), None)

        ref = first("reference_price")
        prev = first("previous_session")
        prevw = first("previous_week")
        struct = next((f for f in facts.values() if f["kind"] == "structure"), None)
        indicators = [f for f in facts.values() if f["kind"] == "indicator"]
        econ = dict(m["economies"])

        def side_text(side_key):
            cur_heading = econ[side_key]
            cur = m["base"] if side_key == "base" else m["quote"]
            evs = [e for e in events.values() if e["currency"] == cur or (side_key == "quote" and m["instrument_kind"] != "fx_spot" and e["currency"] == "USD")]
            pol = [p for p in policy.values() if p.get("currency") == cur]
            lines = []
            for e in evs[:6]:
                if e["state"] in ("released", "revised"):
                    lines.append(f"- {e['title']}: actual {e['actual']} against consensus {e['consensus'] or 'n/a'} ({e['surprise']}) {cite(e['id'])}.")
                elif e["state"] == "conflicting":
                    lines.append(f"- {e['title']}: available sources disagree; interpretation is withheld pending verification {cite(e['id'])}.")
                else:
                    lines.append(f"- {e['title']} is scheduled for {e['scheduled_display']}; consensus {e['consensus'] or 'not available'} {cite(e['id'])}.")
            for p in pol[:3]:
                lines.append(f"- Recent {p.get('type', 'item')}: \"{p['title']}\" {cite(p['id'])}.")
            if not lines:
                lines.append(f"- No verified {cur_heading} developments are recorded in the bundle for this period.")
            return "\n".join(lines)

        tech = []
        if prev:
            tech.append(f"The previous session's range sets the nearest calculated reference areas {cite(prev['id'])}.")
        for l in list(levels.values())[:6]:
            tech.append(f"- {fx(l)}")
        if struct:
            tech.append(f"1H structure is {struct['structure']} {cite(struct['id'])}.")
        for f in indicators[:2]:
            tech.append(f"{fx(f)}")
        tech_txt = "\n".join(tech) or "No verified technical data is available."

        sections: dict[str, str] = {}
        outlook = None
        if kind in ANALYSIS_KINDS:
            s = (struct or {}).get("structure", "insufficient")
            direction = {"upward": "upward_lean", "downward": "downward_lean"}.get(s, "neutral")
            refp = m.get("reference_price")
            sup = sorted([l for l in levels.values() if l["role"] == "support" and refp is not None and l["upper"] < refp],
                         key=lambda l: -l["upper"])
            res = sorted([l for l in levels.values() if l["role"] == "resistance" and refp is not None and l["lower"] > refp],
                         key=lambda l: l["lower"])
            conds, zones = [], []
            if res:
                conds.append({"level_id": res[0]["id"], "boundary": "upper", "side": "above",
                              "effect": "strengthens" if direction != "downward_lean" else "weakens",
                              "text": f"A sustained move above {res[0]['values'][1]} would strengthen the upward interpretation."})
                zones.append(res[0]["id"])
            if sup:
                conds.append({"level_id": sup[0]["id"], "boundary": "lower", "side": "below",
                              "effect": "weakens" if direction != "downward_lean" else "strengthens",
                              "text": f"A sustained move below {sup[0]['values'][0]} would strengthen the downward interpretation."})
                zones.append(sup[0]["id"])
            outlook = {"direction": direction, "qualification": "rule-based: derived from confirmed 1H swing structure only",
                       "conditions": conds, "range_level_ids": [], "zone_ids": zones}
            change = []
            for c in conds:
                lv = levels[c["level_id"]]
                change.append(f"{c['text'].rstrip('.')} [{lv['id']}].")
            change_txt = "\n".join(change) or "No verified reference levels bracket the current price."
            events_txt = ("The scheduled releases in the table are the main tests of this interpretation."
                          if events else "No high- or medium-impact releases are recorded for this period.")
            weekly = cont.get("weekly")
            if kind == "weekly_analysis":
                sections = {
                    "weekly_bias": f"The bias follows the confirmed 1H swing structure {cite(struct['id']) if struct else ''}. "
                                   "It is a working interpretation, not a commitment.",
                    "market_context": (f"{fx(prevw)}" if prevw else "No complete previous-week data is available.")
                                      + (" The previous weekly review is recorded in the bundle." if cont.get("previous_weekly_review") else
                                         " No previous weekly review was published."),
                    "fundamental_base": side_text("base"),
                    "fundamental_quote": side_text("quote"),
                    "key_events": events_txt,
                    "technical_picture": tech_txt,
                    "what_would_change": change_txt,
                    "key_question": "Will the scheduled releases confirm or weaken the current price structure?",
                }
            else:
                days = cont.get("daily", [])
                prog = "; ".join(f"{d_['period_key']}: {d_['direction_label']}" for d_ in days)
                wk = (f"The weekly outlook published {weekly['published_display']} was {weekly['direction_label']}."
                      if weekly else cont.get("note", "No weekly analysis was published."))
                sections = {
                    "market_context": wk + (f" Earlier daily outlooks this week: {prog}." if prog else "")
                                      + (f" {fx(prev)}" if prev else "")
                                      + (f" {fx(ref)}" if ref else ""),
                    "fundamental_base": side_text("base"),
                    "fundamental_quote": side_text("quote"),
                    "technical_picture": tech_txt,
                    "analytical_outlook": change_txt + ("\n" + events_txt if events else ""),
                    "key_question": "Does price confirm a move beyond the nearest reference area, or remain between them?",
                }
        elif kind == "daily_review":
            sess = facts.get(ev.get("session_fact", ""), None)
            evf = facts.get(ev.get("evaluation_fact", ""), None)
            conds = ev.get("conditional", [])
            ecite = f" [{evf['id']}]" if evf else ""
            ctext = " ".join(f"The published condition ({c['side']} {c['boundary']}) was assessed as: {c['outcome']}{ecite}." for c in conds)
            sections = {
                # The code-rendered header already states the original outlook and both assessments.
                "expected_vs_actual": (fx(sess) if sess else "No complete session data is available.") + (" " + ctext if not evf else ""),
                "fundamental_base": side_text("base"),
                "fundamental_quote": side_text("quote"),
                "why_moved": "The bundle contains no attributed explanation for the move; the releases listed above coincided with the session."
                             if not policy else "Reporting recorded in the bundle coincided with the session; see the cited items above.",
                "technical_takeaway": " ".join(fx(facts[z['fact_id']]) for z in ev.get("zones", []) if z.get("fact_id"))
                                      or "No published reference areas were available to assess.",
                "daily_conclusion": "The weekly interpretation is unchanged by this rule-based review; see the assessment above.",
            }
        elif kind == "weekly_review":
            wkf = facts.get(ev.get("week_fact", ""), None)
            wv = ev.get("weekly")
            intro = (f"The original weekly outlook ({wv['original']['published_display']}) was {wv['original']['direction_label']}; "
                     f"directional assessment: {wv['directional']} ({wv['explanation']})." if wv else
                     "No weekly analysis was published for this week; this review uses the working theme from the daily reports.")
            sections = {
                "bias_vs_actual": fx(wkf) if wkf else intro,
                "fundamental_base": side_text("base"),
                "fundamental_quote": side_text("quote"),
                "why_sequence": "The rule-based writer does not attribute causes; the week's releases are listed above.",
                "technical_review": " ".join(fx(facts[z['fact_id']]) for z in (wv or {}).get("zones", []) if z.get("fact_id"))
                                    or "No published weekly reference areas were available to assess.",
                "lesson": "Daily assessments in the table show where the price evidence agreed or disagreed with each published outlook.",
            }
        return {"sections": sections, "outlook": outlook, "model": None}


def get_writer(name: str | None = None):
    from ..config import app_config
    name = name or app_config()["reports"].get("writer", "auto")
    if name == "auto":  # free by default: Claude only when a key is configured (each report records its writer)
        name = "claude" if env().anthropic_api_key else "template"
    if name == "template":
        return TemplateWriter()
    return ClaudeWriter()

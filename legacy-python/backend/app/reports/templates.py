"""Report templates: which sections the writer fills, and which parts code renders itself.

Code renders: title, date line, bias line, events table, evaluation tables, the original-outlook
statement in reviews, sources, data notes and the analysis-only footer. The writer never restates
stored outlooks or computed assessments; it explains them.
"""
from __future__ import annotations

SECTIONS: dict[str, list[tuple[str, str, str]]] = {
    "weekly_analysis": [
        ("weekly_bias", "Weekly Bias", "1-3 sentences after the code-rendered bias line: the main conditions behind the bias."),
        ("market_context", "Market Context", "How last week's outcome (previous week facts, previous weekly review if any) leads into this week."),
        ("fundamental_base", "{base}", "Main supporting and opposing factors for this side, from cited events/policy/news only."),
        ("fundamental_quote", "{quote}", "Main supporting and opposing factors for this side, from cited events/policy/news only."),
        ("key_events", "Key Events This Week", "Brief analytical relevance of the scheduled events in the table (the table is rendered by code)."),
        ("technical_picture", "Technical Picture", "Support, resistance, range and momentum using cited levels and structure facts."),
        ("what_would_change", "What Would Change the Picture", "Conditional statements: what would strengthen and what would weaken the interpretation."),
        ("key_question", "Key Question", "One concise analytical question. Not a trading decision."),
    ],
    "daily_analysis": [
        ("market_context", "Market Context", "Weekly theme, what Monday established, what later days changed, yesterday's outcome, current price. Concise."),
        ("fundamental_base", "{base}", "Released vs upcoming data for this side, with EAT times from the events facts."),
        ("fundamental_quote", "{quote}", "Released vs upcoming data for this side, with EAT times from the events facts."),
        ("technical_picture", "Technical Picture", "Relevant levels and observed behaviour."),
        ("analytical_outlook", "Today's Analytical Outlook", "Conditional interpretations only. No entries, stops, targets or instructions."),
        ("key_question", "Key Question", "The main unresolved analytical question."),
    ],
    "daily_review": [
        ("expected_vs_actual", "Expected vs. Actual", "Explain the code-rendered comparison: what was expected, what happened, which conditions were or were not confirmed."),
        ("fundamental_base", "{base}", "Positive, negative and limiting developments; separate what the data showed, vs expectations, policy expectations, and the price reaction."),
        ("fundamental_quote", "{quote}", "Positive, negative and limiting developments; same four-way distinction."),
        ("why_moved", "Why {display} {moved}", "Connected explanation. Use 'coincided with' unless a cited source attributes the move."),
        ("technical_takeaway", "Technical Takeaway", "One or two sentences on the code-rendered reaction table."),
        ("daily_conclusion", "Daily Conclusion", "Effect on the weekly interpretation."),
    ],
    "weekly_review": [
        ("bias_vs_actual", "Weekly Bias vs. Actual", "Explain the code-rendered comparison and day table honestly."),
        ("fundamental_base", "{base}", "Main developments for this side during the week."),
        ("fundamental_quote", "{quote}", "Main developments for this side during the week."),
        ("why_sequence", "Why the Market {sequence}", "Explain the sequence across the week."),
        ("technical_review", "Technical Review", "Important previously published areas and the reactions there."),
        ("lesson", "Lesson of the Week", "One specific lesson about evidence, interpretation, timing of updates, price confirmation or data limits. Never about trades, emotions or discipline."),
    ],
}

TITLES = {
    "weekly_analysis": "{display} — WEEKLY ANALYSIS",
    "daily_analysis": "{display} — DAILY ANALYSIS",
    "daily_review": "{display} — {day} REVIEW — {date}",
    "weekly_review": "{display} — WEEKLY REVIEW",
}

ANALYSIS_KINDS = ("weekly_analysis", "daily_analysis")


def headings(kind: str, meta: dict, evaluation: dict | None) -> dict[str, str]:
    econ = dict(meta["economies"]) if isinstance(meta["economies"], list) else meta["economies"]
    moved = {"rose": "Rose", "fell": "Fell", "consolidated": "Consolidated"}.get((evaluation or {}).get("session_direction"), "Moved")
    seq = {"continued": "Continued", "reversed": "Reversed", "consolidated": "Consolidated", "rose": "Rose",
           "fell": "Fell"}.get((evaluation or {}).get("sequence"), "Moved")
    out = {}
    for key, heading, _ in SECTIONS[kind]:
        out[key] = heading.format(base=econ.get("base", meta["base"]), quote=econ.get("quote", meta["quote"]),
                                  display=meta["display"], moved=moved, sequence=seq)
    return out

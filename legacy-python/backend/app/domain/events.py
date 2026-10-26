"""Economic-event values, states, surprises, revisions and scenario tables."""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum


class EventState(str, Enum):
    SCHEDULED = "scheduled"
    RELEASED = "released"
    DELAYED = "delayed"
    REVISED = "revised"
    CONFLICTING = "conflicting"
    UNAVAILABLE = "unavailable"


_NUM = re.compile(r"^\s*(?P<cur>[€$£¥]?)\s*(?P<num>[-+−]?\d+(?:[.,]\d+)?)\s*(?P<unit>%|[KMBT]|bp|bps)?\s*$", re.I)


@dataclass(frozen=True)
class Value:
    raw: str
    number: Decimal
    unit: str          # '%', 'K', 'M', 'B', 'T', 'bp', or ''
    decimals: int


def parse_value(raw: str | None) -> Value | None:
    """Parse calendar strings like '3.7%', '-16.1B', '250K', '0.25%'. Returns None if not numeric."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    m = _NUM.match(s.replace("−", "-"))
    if not m:
        return None
    num_s = m.group("num").replace(",", ".")
    try:
        n = Decimal(num_s)
    except InvalidOperation:
        return None
    dec = len(num_s.split(".")[1]) if "." in num_s else 0
    unit = (m.group("unit") or "").upper().replace("BPS", "bp").replace("BP", "bp")
    return Value(s, n, unit, dec)


class Surprise(str, Enum):
    IN_LINE = "in line with consensus"
    ABOVE = "above consensus"
    BELOW = "below consensus"
    NO_CONSENSUS = "no verified consensus"
    NOT_COMPARABLE = "not comparable"


def classify_surprise(actual: str | None, consensus: str | None) -> Surprise:
    """Compared at the precision the figures were published to. Equal -> in line (never a surprise)."""
    a, c = parse_value(actual), parse_value(consensus)
    if c is None:
        return Surprise.NO_CONSENSUS
    if a is None or a.unit != c.unit:
        return Surprise.NOT_COMPARABLE
    q = Decimal(1).scaleb(-max(a.decimals, c.decimals))
    av, cv = a.number.quantize(q), c.number.quantize(q)
    if av == cv:
        return Surprise.IN_LINE
    return Surprise.ABOVE if av > cv else Surprise.BELOW


def revision_direction(previous: str | None, revised: str | None) -> str | None:
    p, r = parse_value(previous), parse_value(revised)
    if p is None or r is None or p.unit != r.unit:
        return None
    if r.number == p.number:
        return None
    return "revised up" if r.number > p.number else "revised down"


def reconcile_actuals(values: dict[str, str]) -> tuple[EventState, str | None]:
    """values: source -> actual string. Agreeing sources -> RELEASED with that value.
    Disagreeing sources -> CONFLICTING and no value. Never averaged, never picked."""
    clean = {k: v for k, v in values.items() if v not in (None, "")}
    if not clean:
        return EventState.UNAVAILABLE, None
    parsed = {k: parse_value(v) for k, v in clean.items()}
    distinct = {(p.number.normalize(), p.unit) if p else clean[k] for k, p in parsed.items()}
    if len(distinct) > 1:
        return EventState.CONFLICTING, None
    return EventState.RELEASED, next(iter(clean.values()))


# --- scenario tables ---------------------------------------------------------

@dataclass(frozen=True)
class ScenarioRow:
    outcome: str
    implication: str
    weight: float | None = None   # percent; None = "Not estimated"


class ScenarioError(ValueError):
    pass


def validate_scenarios(rows: list[ScenarioRow], method: str | None) -> None:
    weights = [r.weight for r in rows]
    if all(w is None for w in weights):
        return
    if any(w is None for w in weights):
        raise ScenarioError("either all scenario weights are estimated or none are")
    if not method:
        raise ScenarioError("numeric scenario weights require a stored method")
    if abs(sum(weights) - 100.0) > 1e-6:
        raise ScenarioError(f"scenario weights sum to {sum(weights)}, not 100")
    if len({r.outcome for r in rows}) != len(rows):
        raise ScenarioError("scenario outcomes must be mutually exclusive and distinct")


def scenario_table_markdown(rows: list[ScenarioRow], method: str | None = None) -> str:
    validate_scenarios(rows, method)
    head = "| Outcome | Scenario weight | Possible analytical implication |\n|---|---|---|"
    body = "\n".join(
        f"| {r.outcome} | {('%.0f%% (judgmental)' % r.weight) if r.weight is not None else 'Not estimated'} | {r.implication} |"
        for r in rows)
    note = f"\n\n_Weights method: {method}. Weights describe release outcomes, not market responses._" if method else ""
    return f"{head}\n{body}{note}"


def default_scenarios(currency: str, higher_supports_tighter_policy: bool | None) -> list[ScenarioRow]:
    """Template rows. higher_supports_tighter_policy is set per indicator (True for CPI, False for
    unemployment, None when the link is unclear). The implications are conditional by design."""
    if higher_supports_tighter_policy is None:
        return [
            ScenarioRow("Near expectations", "Details and the price reaction remain important"),
            ScenarioRow("Above expectations", f"Effect on {currency} depends on how policy expectations respond"),
            ScenarioRow("Below expectations", f"Effect on {currency} depends on how policy expectations respond"),
        ]
    up, down = ("Above", "Below") if higher_supports_tighter_policy else ("Below", "Above")
    return [
        ScenarioRow("Near expectations", "Details and the price reaction remain important"),
        ScenarioRow(f"{up} expectations", f"Could support {currency} if policy expectations rise"),
        ScenarioRow(f"{down} expectations", f"Could weaken {currency} if expected policy support falls"),
    ]

"""Break / rejection / sustained-break rules. The same functions are used when writing and reviewing.

Definitions (parameters in config technical.breaks):
- Reached: some candle traded beyond the boundary (wick).
- Break: basis="close" -> a candle *closed* beyond the boundary; basis="wick" -> any trade beyond it.
- Sustained break: `sustained_closes` consecutive closes beyond the boundary on the break timeframe.
- Rejection: a candle traded beyond the boundary but closed back on the original side.
- Reversal after confirmation: `reversal_closes` consecutive closes back on the original side of
  the boundary after a sustained break.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from .sessions import Candle


class Side(str, Enum):
    ABOVE = "above"
    BELOW = "below"


@dataclass(frozen=True)
class BreakRules:
    basis: str = "close"
    sustained_closes: int = 2
    reversal_closes: int = 1

    @classmethod
    def from_config(cls, cfg: dict) -> "BreakRules":
        return cls(cfg.get("basis", "close"), int(cfg.get("sustained_closes", 2)), int(cfg.get("reversal_closes", 1)))


class ConditionOutcome(str, Enum):
    NOT_REACHED = "Condition not reached"
    BRIEFLY_REACHED = "Briefly reached, not sustained"
    CONFIRMED = "Confirmed"
    CONFIRMED_THEN_REVERSED = "Confirmed, then reversed"
    UNRESOLVED = "Unresolved by session end"
    NOT_ASSESSABLE = "Not assessable"


@dataclass
class BreakResult:
    outcome: ConditionOutcome
    first_reached_at: datetime | None = None
    confirmed_at: datetime | None = None
    reversed_at: datetime | None = None
    rejections: int = 0
    max_close_streak: int = 0
    notes: list[str] = field(default_factory=list)


def _beyond(price: float, boundary: float, side: Side) -> bool:
    return price > boundary if side is Side.ABOVE else price < boundary


def _wick_beyond(c: Candle, boundary: float, side: Side) -> bool:
    return _beyond(c.high if side is Side.ABOVE else c.low, boundary, side)


def evaluate_break(candles: list[Candle], boundary: float, side: Side, rules: BreakRules,
                   horizon_complete: bool = True) -> BreakResult:
    """candles: ordered, complete candles of the break timeframe within the evaluation horizon only."""
    bars = sorted(candles, key=lambda c: c.start)
    if not bars or any(not c.complete for c in bars):
        return BreakResult(ConditionOutcome.NOT_ASSESSABLE,
                           notes=["no complete candles in the horizon" if not bars else "horizon has incomplete candles"])
    res = BreakResult(ConditionOutcome.NOT_REACHED)
    streak = 0
    back_streak = 0
    for c in bars:
        reached = _wick_beyond(c, boundary, side)
        closed_beyond = _beyond(c.close, boundary, side)
        if reached and res.first_reached_at is None:
            res.first_reached_at = c.start
        if reached and not closed_beyond:
            res.rejections += 1
        if res.confirmed_at is None:
            streak = streak + 1 if closed_beyond else 0
            res.max_close_streak = max(res.max_close_streak, streak)
            if streak >= rules.sustained_closes:
                res.confirmed_at = c.end
        elif res.reversed_at is None:
            back_streak = back_streak + 1 if not closed_beyond else 0
            if back_streak >= rules.reversal_closes:
                res.reversed_at = c.end
    if res.reversed_at:
        res.outcome = ConditionOutcome.CONFIRMED_THEN_REVERSED
    elif res.confirmed_at:
        res.outcome = ConditionOutcome.CONFIRMED
    elif res.first_reached_at is None:
        res.outcome = ConditionOutcome.NOT_REACHED
    elif streak > 0:
        # Still closing beyond the boundary when the horizon ended, without enough closes to confirm.
        res.outcome = ConditionOutcome.UNRESOLVED
        if not horizon_complete:
            res.notes.append("horizon had not ended")
    else:
        res.outcome = ConditionOutcome.BRIEFLY_REACHED
    if rules.basis == "wick" and res.first_reached_at and res.outcome == ConditionOutcome.BRIEFLY_REACHED:
        res.notes.append("break basis is 'wick': a break occurred but was not sustained")
    return res


class LevelStatus(str, Enum):
    ACTIVE = "active"
    TESTED = "tested"
    BROKEN = "broken"
    RECLAIMED = "reclaimed"
    INVALIDATED = "invalidated"   # set manually
    ARCHIVED = "archived"         # set manually


def update_level_status(status: LevelStatus, lower: float, upper: float, role: str,
                        candles: list[Candle], rules: BreakRules) -> tuple[LevelStatus, list[str]]:
    """role: 'support' or 'resistance'. Walks candles in order and returns the new status + reasons.
    Support breaks below `lower`; resistance breaks above `upper`. Reclaim = sustained close back."""
    if status in (LevelStatus.INVALIDATED, LevelStatus.ARCHIVED):
        return status, []
    reasons: list[str] = []
    break_side = Side.BELOW if role == "support" else Side.ABOVE
    boundary = lower if role == "support" else upper
    reclaim_side = Side.ABOVE if break_side is Side.BELOW else Side.BELOW
    bars = sorted([c for c in candles if c.complete], key=lambda c: c.start)
    streak = 0
    for c in bars:
        touched = c.low <= upper and c.high >= lower
        if status is LevelStatus.ACTIVE and touched:
            status = LevelStatus.TESTED
            reasons.append(f"tested at {c.start.isoformat()}")
        if status in (LevelStatus.ACTIVE, LevelStatus.TESTED, LevelStatus.RECLAIMED):
            streak = streak + 1 if _beyond(c.close, boundary, break_side) else 0
            if streak >= rules.sustained_closes:
                status, streak = LevelStatus.BROKEN, 0
                reasons.append(f"sustained break {break_side.value} {boundary} confirmed {c.end.isoformat()}")
        elif status is LevelStatus.BROKEN:
            streak = streak + 1 if _beyond(c.close, boundary, reclaim_side) or c.close == boundary else 0
            if streak >= rules.sustained_closes:
                status, streak = LevelStatus.RECLAIMED, 0
                reasons.append(f"reclaimed {c.end.isoformat()}")
    return status, reasons

"""Evaluation of published analytical expectations. No trades, no P&L, no win rates.

Directional assessment rules (thresholds from config `evaluation`, scaled by daily ATR known at
publication):
  thr   = inconclusive_atr_fraction * ATR
  mixed = mixed_excursion_atr_fraction * ATR
  net   = session close - reference price (price at the data cutoff of the published report)

  Upward lean:   net >= thr -> Supported; net <= -thr -> Not supported; else Inconclusive.
                 Supported/Not supported become Mixed if the session also moved >= mixed
                 in the opposite direction from the reference.
  Downward lean: mirror image.
  Neutral / range-bound: with a published range, a close outside it -> Not supported;
                 otherwise |net| < thr -> Supported, else Mixed. Without a range:
                 |net| < thr -> Supported; |net| >= 2*thr -> Not supported; else Mixed.
  Missing reference price, ATR, or a complete session candle -> Not assessable.

Conditional assessments come from domain.breaks.evaluate_break, applied with the same rules used
when the report was written.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .sessions import Candle


class Direction(str, Enum):
    UPWARD = "upward_lean"
    DOWNWARD = "downward_lean"
    NEUTRAL = "neutral"
    RANGE = "range_bound"


DIRECTION_LABELS = {
    Direction.UPWARD: "Upward lean",
    Direction.DOWNWARD: "Downward lean",
    Direction.NEUTRAL: "Neutral",
    Direction.RANGE: "Range-bound",
}


class DirectionalOutcome(str, Enum):
    SUPPORTED = "Supported"
    NOT_SUPPORTED = "Not supported"
    MIXED = "Mixed"
    INCONCLUSIVE = "Inconclusive"
    NOT_ASSESSABLE = "Not assessable"


CORRECT_INCORRECT = {
    DirectionalOutcome.SUPPORTED: "Correct",
    DirectionalOutcome.NOT_SUPPORTED: "Incorrect",
    DirectionalOutcome.MIXED: "Partly correct",
    DirectionalOutcome.INCONCLUSIVE: "Inconclusive",
    DirectionalOutcome.NOT_ASSESSABLE: "Not assessable",
}


@dataclass(frozen=True)
class DirectionalResult:
    outcome: DirectionalOutcome
    net_change: float | None
    threshold: float | None
    favourable_excursion: float | None
    adverse_excursion: float | None
    explanation: str

    def label(self, wording: str = "assessment") -> str:
        return CORRECT_INCORRECT[self.outcome] if wording == "correct_incorrect" else self.outcome.value


def assess_direction(direction: Direction, reference_price: float | None, session: Candle | None,
                     atr_value: float | None, cfg: dict,
                     range_bounds: tuple[float, float] | None = None) -> DirectionalResult:
    if reference_price is None or atr_value is None or atr_value <= 0 or session is None or not session.complete:
        why = ("no reference price" if reference_price is None else
               "no ATR available at publication" if not atr_value else
               "no complete session candle")
        return DirectionalResult(DirectionalOutcome.NOT_ASSESSABLE, None, None, None, None, why)

    thr = cfg.get("inconclusive_atr_fraction", 0.25) * atr_value
    mixed = cfg.get("mixed_excursion_atr_fraction", 0.5) * atr_value
    net = session.close - reference_price
    up_exc = session.high - reference_price
    down_exc = reference_price - session.low

    def fmt(o: DirectionalOutcome, why: str, fav=None, adv=None):
        return DirectionalResult(o, net, thr, fav, adv, why)

    if direction in (Direction.UPWARD, Direction.DOWNWARD):
        sign = 1 if direction is Direction.UPWARD else -1
        signed = sign * net
        fav, adv = (up_exc, down_exc) if sign == 1 else (down_exc, up_exc)
        if signed >= thr:
            if adv >= mixed:
                return fmt(DirectionalOutcome.MIXED, "closed in the expected direction after a large opposite move", fav, adv)
            return fmt(DirectionalOutcome.SUPPORTED, "closed in the expected direction by more than the threshold", fav, adv)
        if signed <= -thr:
            if fav >= mixed:
                return fmt(DirectionalOutcome.MIXED, "moved in the expected direction first but closed against it", fav, adv)
            return fmt(DirectionalOutcome.NOT_SUPPORTED, "closed against the expected direction by more than the threshold", fav, adv)
        return fmt(DirectionalOutcome.INCONCLUSIVE, "net move smaller than the threshold", fav, adv)

    # Neutral / range-bound
    if range_bounds is not None:
        lo, hi = range_bounds
        if session.close > hi or session.close < lo:
            return fmt(DirectionalOutcome.NOT_SUPPORTED, "session closed outside the published range")
        if abs(net) < thr:
            return fmt(DirectionalOutcome.SUPPORTED, "closed inside the range with a small net move")
        return fmt(DirectionalOutcome.MIXED, "closed inside the range but with a directional net move")
    if abs(net) < thr:
        return fmt(DirectionalOutcome.SUPPORTED, "net move smaller than the threshold")
    if abs(net) >= 2 * thr:
        return fmt(DirectionalOutcome.NOT_SUPPORTED, "clear directional net move")
    return fmt(DirectionalOutcome.MIXED, "moderate directional net move")

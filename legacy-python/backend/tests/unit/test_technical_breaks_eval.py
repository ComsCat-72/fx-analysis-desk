from datetime import date, datetime, timedelta, timezone

import pytest

from app.domain import technical as T
from app.domain.breaks import BreakRules, ConditionOutcome, LevelStatus, Side, evaluate_break, update_level_status
from app.domain.evaluation import Direction, DirectionalOutcome, assess_direction
from app.domain.instruments import Instrument, currency_effect, dxy_from_spot
from app.domain.sessions import SessionDef
from app.domain.validation import Quote, check_incomplete, check_missing_sessions, check_stale_quote, compare_values
from tests.helpers import bar, ohlc_series, series

UTC = timezone.utc
T0 = datetime(2026, 10, 26, 0, tzinfo=UTC)
S = SessionDef("fx_ny_close", "America/New_York")


class TestIndicators:
    def test_sma_ema(self):
        assert T.sma([1, 2, 3, 4], 2) == 3.5
        assert T.sma([1], 2) is None
        # EMA seeded by SMA(1,2,3)=2, alpha=0.5: 0.5*4 + 0.5*2 = 3
        assert T.ema([1, 2, 3, 4], 3) == pytest.approx(3.0)

    def test_atr_wilder(self):
        rows = [(1.0, 1.2, 0.9, 1.1), (1.1, 1.3, 1.0, 1.2), (1.2, 1.25, 1.15, 1.2)]
        bars = ohlc_series(T0, rows)
        # TRs: 0.3, 0.3, 0.1 ; period 2 -> seed 0.3, then (0.3*1+0.1)/2 = 0.2
        assert T.atr(bars, 2) == pytest.approx(0.2)

    def test_rsi_all_gains(self):
        assert T.rsi([1, 2, 3, 4, 5], 3) == 100.0

    def test_closed_before_excludes_future_and_incomplete(self):
        bars = series(T0, [1, 2, 3])
        bars[-1] = bar(bars[-1].start, 2, 3.1, 1.9, 3, complete=False)
        assert len(T.closed_before(bars, T0 + timedelta(hours=3))) == 2
        assert len(T.closed_before(bars, T0 + timedelta(hours=1))) == 1


class TestSwings:
    closes = [1.00, 1.01, 1.02, 1.05, 1.02, 1.01, 1.00, 1.01, 1.03, 1.06, 1.04, 1.03, 1.02, 1.04]

    def test_swing_confirmation_time_and_no_leakage(self):
        bars = series(T0, self.closes, spread=0.0)
        # swing high at index 3 (1.05) needs 3 later bars -> confirmed at end of index 6
        early = T.find_swings(bars, as_of=bars[5].end, left=3, right=3)
        assert not [s for s in early if s.kind == "high"]
        later = T.find_swings(bars, as_of=bars[6].end, left=3, right=3)
        hs = [s for s in later if s.kind == "high"]
        assert hs and hs[0].price == 1.05 and hs[0].confirmed_at == bars[6].end

    def test_labels_and_structure(self):
        bars = series(T0, self.closes, spread=0.0)
        sw = T.find_swings(bars, as_of=bars[-1].end, left=3, right=3)
        highs = [s for s in sw if s.kind == "high"]
        assert [h.price for h in highs] == [1.05, 1.06] and highs[1].label == "HH"
        assert T.structure(sw) in ("insufficient", "upward", "mixed")

    def test_results_reproducible(self):
        bars = series(T0, self.closes)
        assert T.find_swings(bars, bars[-1].end) == T.find_swings(list(reversed(bars)), bars[-1].end)


R = BreakRules("close", sustained_closes=2, reversal_closes=1)


class TestBreaks:
    def test_not_reached(self):
        bars = ohlc_series(T0, [(1.30, 1.3050, 1.2990, 1.3040)] * 3)
        assert evaluate_break(bars, 1.3100, Side.ABOVE, R).outcome == ConditionOutcome.NOT_REACHED

    def test_wick_only_is_rejection_not_break(self):
        bars = ohlc_series(T0, [(1.3080, 1.3120, 1.3070, 1.3090), (1.3090, 1.3095, 1.3060, 1.3070)])
        r = evaluate_break(bars, 1.3100, Side.ABOVE, R)
        assert r.outcome == ConditionOutcome.BRIEFLY_REACHED and r.rejections == 1

    def test_single_close_is_not_sustained(self):
        bars = ohlc_series(T0, [(1.3090, 1.3120, 1.3085, 1.3110), (1.3110, 1.3115, 1.3080, 1.3090)])
        assert evaluate_break(bars, 1.3100, Side.ABOVE, R).outcome == ConditionOutcome.BRIEFLY_REACHED

    def test_sustained_then_reversed(self):
        rows = [(1.3090, 1.3120, 1.3085, 1.3110), (1.3110, 1.3130, 1.3105, 1.3125),
                (1.3125, 1.3126, 1.3080, 1.3085)]
        bars = ohlc_series(T0, rows)
        r2 = evaluate_break(bars[:2], 1.3100, Side.ABOVE, R)
        assert r2.outcome == ConditionOutcome.CONFIRMED and r2.confirmed_at == bars[1].end
        assert evaluate_break(bars, 1.3100, Side.ABOVE, R).outcome == ConditionOutcome.CONFIRMED_THEN_REVERSED

    def test_unresolved_at_session_end(self):
        bars = ohlc_series(T0, [(1.3080, 1.3090, 1.3070, 1.3085), (1.3085, 1.3115, 1.3080, 1.3110)])
        assert evaluate_break(bars, 1.3100, Side.ABOVE, R).outcome == ConditionOutcome.UNRESOLVED

    def test_below_side(self):
        bars = ohlc_series(T0, [(1.2950, 1.2955, 1.2890, 1.2895), (1.2895, 1.2900, 1.2880, 1.2885)])
        assert evaluate_break(bars, 1.2900, Side.BELOW, R).outcome == ConditionOutcome.CONFIRMED

    def test_not_assessable_on_incomplete(self):
        bars = [bar(T0, 1.3, 1.31, 1.29, 1.305, complete=False)]
        assert evaluate_break(bars, 1.31, Side.ABOVE, R).outcome == ConditionOutcome.NOT_ASSESSABLE
        assert evaluate_break([], 1.31, Side.ABOVE, R).outcome == ConditionOutcome.NOT_ASSESSABLE

    def test_level_status_lifecycle(self):
        rows = [(1.3050, 1.3095, 1.3040, 1.3080),   # touches zone 1.3090-1.3100 -> tested
                (1.3080, 1.3120, 1.3075, 1.3110),   # close above
                (1.3110, 1.3130, 1.3105, 1.3125),   # 2nd close above -> broken
                (1.3125, 1.3126, 1.3070, 1.3080),
                (1.3080, 1.3085, 1.3060, 1.3070)]   # 2 closes back below -> reclaimed
        st, reasons = update_level_status(LevelStatus.ACTIVE, 1.3090, 1.3100, "resistance", ohlc_series(T0, rows), R)
        assert st == LevelStatus.RECLAIMED and len(reasons) == 3
        st2, _ = update_level_status(LevelStatus.INVALIDATED, 1.3090, 1.3100, "resistance", ohlc_series(T0, rows), R)
        assert st2 == LevelStatus.INVALIDATED


CFG = {"inconclusive_atr_fraction": 0.25, "mixed_excursion_atr_fraction": 0.5}


def day(o, h, l, c, complete=True):
    return bar(T0, o, h, l, c, tf="D1", complete=complete, hours=24)


class TestDirectionalAssessment:
    def test_upward_lean_lower_close_not_supported(self):
        r = assess_direction(Direction.UPWARD, 1.3000, day(1.3000, 1.3010, 1.2900, 1.2920), 0.0100, CFG)
        assert r.outcome == DirectionalOutcome.NOT_SUPPORTED

    def test_upward_supported(self):
        r = assess_direction(Direction.UPWARD, 1.3000, day(1.3000, 1.3080, 1.2990, 1.3060), 0.0100, CFG)
        assert r.outcome == DirectionalOutcome.SUPPORTED and r.label("correct_incorrect") == "Correct"

    def test_small_move_inconclusive(self):
        r = assess_direction(Direction.UPWARD, 1.3000, day(1.3000, 1.3020, 1.2990, 1.3010), 0.0100, CFG)
        assert r.outcome == DirectionalOutcome.INCONCLUSIVE

    def test_mixed_when_large_opposite_excursion(self):
        r = assess_direction(Direction.UPWARD, 1.3000, day(1.3000, 1.3070, 1.2930, 1.3040), 0.0100, CFG)
        assert r.outcome == DirectionalOutcome.MIXED

    def test_downward_mirror(self):
        r = assess_direction(Direction.DOWNWARD, 1.3000, day(1.3000, 1.3010, 1.2920, 1.2950), 0.0100, CFG)
        assert r.outcome == DirectionalOutcome.SUPPORTED

    def test_range_bound(self):
        rng = (1.2950, 1.3050)
        assert assess_direction(Direction.RANGE, 1.3000, day(1.3, 1.304, 1.296, 1.3010), 0.01, CFG, rng).outcome == DirectionalOutcome.SUPPORTED
        assert assess_direction(Direction.RANGE, 1.3000, day(1.3, 1.308, 1.296, 1.3060), 0.01, CFG, rng).outcome == DirectionalOutcome.NOT_SUPPORTED

    def test_not_assessable(self):
        assert assess_direction(Direction.UPWARD, None, day(1, 1, 1, 1), 0.01, CFG).outcome == DirectionalOutcome.NOT_ASSESSABLE
        assert assess_direction(Direction.UPWARD, 1.3, day(1.3, 1.31, 1.29, 1.30, complete=False), 0.01, CFG).outcome == DirectionalOutcome.NOT_ASSESSABLE

    def test_brief_break_is_not_a_successful_forecast(self):
        # Conditional "upward continuation if resistance is sustained": price pokes above once.
        bars = ohlc_series(T0, [(1.3090, 1.3110, 1.3080, 1.3095)])
        assert evaluate_break(bars, 1.3100, Side.ABOVE, R).outcome == ConditionOutcome.BRIEFLY_REACHED


class TestValidation:
    def test_stale_quote_blocking_when_open(self):
        now = datetime(2026, 10, 27, 10, tzinfo=UTC)
        q = Quote("GBP_USD", now - timedelta(minutes=10), None, None, 1.3, "oanda")
        assert check_stale_quote(q, now, 300, S).severity == "blocking"
        assert check_stale_quote(Quote("GBP_USD", now - timedelta(seconds=10), None, None, 1.3, "oanda"), now, 300, S) is None

    def test_stale_quote_on_weekend_is_info(self):
        sat = datetime(2026, 10, 31, 10, tzinfo=UTC)
        q = Quote("GBP_USD", sat - timedelta(hours=12), None, None, 1.3, "oanda")
        assert check_stale_quote(q, sat, 300, S).severity == "info"

    def test_incomplete_and_missing(self):
        assert check_incomplete([bar(T0, 1, 1.1, 0.9, 1, complete=False)])[0].code == "incomplete_candle"
        mon = date(2026, 10, 26)
        s, _ = S.day_bounds(mon)
        d1 = [bar(s, 1, 1.1, 0.9, 1, tf="D1", hours=24)]
        w = check_missing_sessions(d1, S, mon, date(2026, 10, 28), as_of=datetime(2026, 10, 29, 12, tzinfo=UTC))
        assert [x.context["date"] for x in w] == ["2026-10-27", "2026-10-28"]

    def test_conflict_never_averaged(self):
        w = compare_values("GBP/USD daily close", {"a": 1.3000, "b": 1.3050}, 0.0002)
        assert w and w.severity == "blocking" and "withheld" in w.message
        assert compare_values("x", {"a": 1.30000, "b": 1.30001}, 0.0002) is None


class TestInstruments:
    def test_pair_direction(self):
        usdchf = Instrument("USD_CHF", "USD/CHF", "USD", "CHF", "fx_spot", 5)
        eurusd = Instrument("EUR_USD", "EUR/USD", "EUR", "USD", "fx_spot", 5)
        assert currency_effect(usdchf, +0.001) == {"USD": "stronger", "CHF": "weaker"}
        assert currency_effect(eurusd, +0.001) == {"EUR": "stronger", "USD": "weaker"}
        assert currency_effect(eurusd, -0.001)["USD"] == "stronger"

    def test_dxy_formula(self):
        # All components at 1.0 -> constant
        assert dxy_from_spot({k: 1.0 for k in ["EUR_USD", "USD_JPY", "GBP_USD", "USD_CAD", "USD_SEK", "USD_CHF"]}) == pytest.approx(50.14348112)
        with pytest.raises(ValueError):
            dxy_from_spot({"EUR_USD": 1.1})

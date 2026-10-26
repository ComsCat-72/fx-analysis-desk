import pytest

from app.domain.events import (EventState, ScenarioError, ScenarioRow, Surprise, classify_surprise, parse_value,
                               reconcile_actuals, revision_direction, scenario_table_markdown, validate_scenarios)


def test_parse_values():
    v = parse_value("3.7%")
    assert str(v.number) == "3.7" and v.unit == "%" and v.decimals == 1
    assert parse_value("-16.1B").unit == "B"
    assert parse_value("250K").number == 250
    assert parse_value("") is None and parse_value("n/a") is None


def test_in_line_is_not_a_surprise():
    assert classify_surprise("3.7%", "3.7%") == Surprise.IN_LINE
    assert classify_surprise("3.70%", "3.7%") == Surprise.IN_LINE
    assert classify_surprise("3.8%", "3.7%") == Surprise.ABOVE
    assert classify_surprise("0.4%", "0.7%") == Surprise.BELOW
    assert classify_surprise("3.7%", None) == Surprise.NO_CONSENSUS
    assert classify_surprise("250K", "3.7%") == Surprise.NOT_COMPARABLE


def test_revisions():
    assert revision_direction("0.2%", "0.3%") == "revised up"
    assert revision_direction("0.2%", "0.2%") is None


def test_conflicting_sources_are_not_resolved():
    assert reconcile_actuals({"bls": "0.3%", "manual": "0.3%"}) == (EventState.RELEASED, "0.3%")
    assert reconcile_actuals({"bls": "0.3%", "other": "0.4%"}) == (EventState.CONFLICTING, None)
    assert reconcile_actuals({}) == (EventState.UNAVAILABLE, None)


def test_scenario_rules():
    rows = [ScenarioRow("Near", "x"), ScenarioRow("Above", "y"), ScenarioRow("Below", "z")]
    assert "Not estimated" in scenario_table_markdown(rows)
    with pytest.raises(ScenarioError):
        validate_scenarios([ScenarioRow("A", "x", 50), ScenarioRow("B", "y", 40)], "judgment")
    with pytest.raises(ScenarioError):
        validate_scenarios([ScenarioRow("A", "x", 50), ScenarioRow("B", "y", 50)], None)
    with pytest.raises(ScenarioError):
        validate_scenarios([ScenarioRow("A", "x", 50), ScenarioRow("B", "y")], "m")
    validate_scenarios([ScenarioRow("A", "x", 60), ScenarioRow("B", "y", 40)], "analyst judgment")

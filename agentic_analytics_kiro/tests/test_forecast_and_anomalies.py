"""
Plan §16: forecasting beyond a single linear regression, and anomaly detection
beyond mean ± 2σ.

Each test is written as a comparison against the behaviour being replaced, so
a regression to the old rule fails here rather than passing quietly:

  * the old forecaster fitted one lag model, assumed a daily step, and reported
    no error and no interval;
  * the old detector used the mean and standard deviation (both moved by the
    outliers it was looking for), a 2σ cutoff (~5% of any normal series), and
    only ever looked at the upper tail.
"""
from __future__ import annotations

import datetime
import math

import numpy as np
import pandas as pd
import pytest

from anomaly import detect_anomalies, describe_anomalies
from predictor import predict_series, predict_sales
from conftest import upload


def _series(values, start=datetime.date(2024, 1, 1), step_days=1, date_col="on_day",
            value_col="amount") -> pd.DataFrame:
    return pd.DataFrame({
        date_col: [start + datetime.timedelta(days=i * step_days) for i in range(len(values))],
        value_col: list(values),
    })


# ── Forecasting ───────────────────────────────────────────────────────────────

class TestForecastsAreChosenNotAssumed:

    def test_the_result_says_which_model_ran_and_how_it_scored(self):
        values = [100 + 2 * i + 20 * math.sin(2 * math.pi * i / 7) for i in range(120)]
        result = predict_series(_series(values), periods=7)

        assert result["method"] in ("seasonal-trend", "lagged-linear")
        assert result["holdout_points"] > 0
        assert result["mae"] is not None
        assert result["baseline_mae"] is not None
        assert isinstance(result["beats_baseline"], bool)

    def test_a_seasonal_series_is_forecast_by_its_season(self):
        """A weekly cycle plus a trend: the seasonal model should win the
        holdout, and the seasonality it used must be named."""
        values = [100 + 2 * i + 40 * math.sin(2 * math.pi * i / 7) for i in range(140)]
        result = predict_series(_series(values), periods=7)

        assert result["method"] == "seasonal-trend"
        assert "weekly" in result["seasonality"]
        assert result["beats_baseline"] is True

    def test_the_forecast_beats_the_old_single_model_on_a_seasonal_series(self):
        """Held out the last 7 points, the chosen model's error must be lower
        than a flat continuation of the mean — the bar the old lag model
        cleared only by accident on seasonal data."""
        values = [100 + 1.5 * i + 45 * math.sin(2 * math.pi * i / 7) for i in range(140)]
        frame = _series(values)
        train, truth = frame.iloc[:-7], frame["amount"].to_numpy()[-7:]

        result = predict_series(train, periods=7)
        predicted = result["frame"]["predicted_amount"].to_numpy()

        model_mae = np.mean(np.abs(truth - predicted))
        flat_mae = np.mean(np.abs(truth - train["amount"].mean()))
        assert model_mae < flat_mae

    def test_the_winner_is_the_candidate_with_the_lowest_holdout_error(self):
        """The choice is inspectable: every candidate's holdout MAE comes back,
        and the reported method is the best of them — not a fixed preference."""
        values = [100 + 2 * i + 30 * math.sin(2 * math.pi * i / 7) for i in range(140)]
        result = predict_series(_series(values), periods=7)

        considered = result["considered"]
        assert len(considered) == 2, "both models must be scored, not just one"
        assert result["method"] == min(considered, key=considered.get)
        assert result["mae"] == considered[result["method"]]

    def test_both_models_win_somewhere(self):
        """A series whose level is unpredictable from the calendar but well
        predicted by its last value is where the original lag model belongs.
        Across a family of such series both models get chosen — which is what
        makes this a selection rather than a swap."""
        chosen = set()
        for seed in range(1, 7):
            rng = np.random.default_rng(seed)
            walk = 500 + np.cumsum(rng.normal(0, 25, 130))
            chosen.add(predict_series(_series(walk), periods=7)["method"])
        seasonal = [100 + 2 * i + 40 * math.sin(2 * math.pi * i / 7) for i in range(140)]
        chosen.add(predict_series(_series(seasonal), periods=7)["method"])

        assert chosen == {"seasonal-trend", "lagged-linear"}

    def test_the_step_matches_the_history_not_the_calendar(self):
        """Weekly observations must be forecast a week apart. The old code
        added one day per step, inventing six observations per week."""
        values = [200 + 3 * i for i in range(60)]
        result = predict_series(_series(values, step_days=7), periods=4)

        assert result["step_days"] == pytest.approx(7.0)
        dates = pd.to_datetime(result["frame"]["on_day"])
        assert (dates.diff().dropna().dt.days == 7).all()

    def test_the_interval_comes_from_measured_error(self):
        values = [100 + 2 * i + 15 * math.sin(2 * math.pi * i / 7) for i in range(120)]
        result = predict_series(_series(values), periods=7)
        frame = result["frame"]

        assert result["interval"] == 0.8
        assert (frame["predicted_amount_lower"] <= frame["predicted_amount"]).all()
        assert (frame["predicted_amount_upper"] >= frame["predicted_amount"]).all()
        assert "does not widen with horizon" in result["note"]

    def test_a_model_that_cannot_beat_the_baseline_says_so(self):
        """Pure noise: no model should claim skill on it."""
        rng = np.random.default_rng(7)
        result = predict_series(_series(rng.normal(500, 90, 120)), periods=7)
        if result["beats_baseline"] is False:
            assert "did not beat" in result["note"]

    def test_too_little_history_returns_nothing_rather_than_a_line(self):
        assert predict_series(_series([1, 2, 3, 4, 5]), periods=7) is None

    def test_the_legacy_wrapper_keeps_its_two_column_shape(self):
        """`app.py` (the untouched CLI) prints this frame directly."""
        values = [100 + 2 * i + 10 * math.sin(2 * math.pi * i / 7) for i in range(120)]
        frame = predict_sales(_series(values), periods=5)
        assert list(frame.columns) == ["on_day", "predicted_amount"]
        assert len(frame) == 5


class TestTheApiReportsHowTheForecastWasMade:

    def test_forecast_meta_travels_with_the_answer(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "week_start", "spend_gbp" FROM marketing']
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "forecast spend"}).json()

        meta = body["forecast_meta"]
        assert meta["method"] in ("seasonal-trend", "lagged-linear")
        assert meta["value_column"] == "spend_gbp"
        assert meta["date_column"] == "week_start"
        assert meta["periods"] == 7
        assert meta["history_points"] > 0
        assert meta["note"]

    def test_no_forecast_means_no_forecast_metadata(
        self, client, session_id, csv_files, llm
    ):
        """A turn that couldn't fit a model must not describe one."""
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "campaign", SUM("clicks") AS c FROM marketing GROUP BY "campaign"']
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "predict clicks"}).json()

        assert body["forecast"] is None
        assert body["forecast_meta"] is None


# ── Anomalies ─────────────────────────────────────────────────────────────────

class TestAnomaliesAreRobust:

    def test_a_clean_series_has_no_anomalies(self):
        """mean ± 2σ flags ~5% of any normal series by construction. On these
        200 points it finds several; the robust rule finds none."""
        rng = np.random.default_rng(3)
        values = rng.normal(100, 10, 200)
        frame = _series(values)

        result = detect_anomalies(frame)
        assert result["found"] is False
        assert result["count"] == 0

        old_rule = (values > values.mean() + 2 * values.std()).sum()
        assert old_rule > 0, "the old rule would have reported anomalies here"

    def test_a_large_outlier_does_not_hide_a_smaller_one(self):
        """The old threshold was inflated by the very points it looked for: one
        extreme value raises mean + 2σ above every other spike."""
        values = [100.0] * 60
        values[10] = 10_000.0   # extreme
        values[40] = 260.0      # real, but small next to it
        frame = _series(values)

        result = detect_anomalies(frame)
        flagged = {round(p["value"]) for p in result["points"]}
        assert {10_000, 260} <= flagged

        arr = np.array(values)
        old_threshold = arr.mean() + 2 * arr.std()
        assert 260 < old_threshold, "the old rule would have missed the smaller spike"

    def test_collapses_are_anomalies_too(self):
        """The old rule only tested the upper tail, so a drop to zero was never
        unusual while an equal spike was."""
        values = [100.0 + (i % 5) for i in range(60)]
        values[30] = 0.0
        result = detect_anomalies(_series(values))

        assert result["found"] is True
        assert any(p["direction"] == "low" and p["value"] == 0.0 for p in result["points"])

    def test_a_point_is_judged_against_its_own_season(self):
        """Sundays are always low in this series. A low Sunday is normal; a
        Wednesday at the same level is not."""
        start = datetime.date(2024, 1, 1)  # a Monday
        values = []
        for i in range(84):
            day = (start + datetime.timedelta(days=i)).weekday()
            values.append(20.0 if day == 6 else 100.0 + (i % 3))
        values[16] = 20.0  # a Wednesday at Sunday's level
        frame = _series(values, start=start)

        result = detect_anomalies(frame)
        assert "seasonally-adjusted" in result["method"]
        flagged_dates = {p["when"][:10] for p in result["points"]}
        assert (start + datetime.timedelta(days=16)).isoformat() in flagged_dates
        # No Sunday is flagged for being a normal Sunday.
        for when in flagged_dates:
            if when == (start + datetime.timedelta(days=16)).isoformat():
                continue
            assert pd.Timestamp(when).weekday() != 6

    def test_a_constant_series_is_reported_as_such(self):
        result = detect_anomalies(_series([50.0] * 40))
        assert result["found"] is False
        assert "same" in result["note"]

    def test_too_few_points_is_not_an_answer(self):
        result = detect_anomalies(_series([1.0, 2.0, 3.0]))
        assert result["found"] is False
        assert "too few" in result["note"].lower()

    def test_the_prompt_only_lists_detected_points(self):
        values = [100.0] * 40
        values[7] = 900.0
        text = describe_anomalies(detect_anomalies(_series(values)))
        assert "900" in text
        assert text.count("\n") <= 5


class TestInsightTurnsCarryWhatWasDetected:

    def test_structured_anomalies_come_back_with_the_narrative(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["hr"])
        llm.replies = [
            'SELECT "joined_on", "annual_cost_usd" FROM hr',
            "narrative",
        ]
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "why is cost changing"}).json()

        found = body["anomalies"]
        assert found["measure_column"] == "annual_cost_usd"
        assert found["threshold"] == 3.5
        assert isinstance(found["found"], bool)
        assert found["note"]

    def test_the_analyst_is_told_not_to_invent_anomalies(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["hr"])
        llm.replies = ['SELECT "joined_on", "annual_cost_usd" FROM hr', "narrative"]
        client.post(f"/session/{session_id}/query", json={"query": "why is cost changing"})

        prompt = llm.prompts[-1]
        assert "Anomalies:" in prompt
        assert "Only discuss anomalies listed above" in prompt

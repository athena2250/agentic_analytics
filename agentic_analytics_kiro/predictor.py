"""
Forecasting for an arbitrary (date, measure) pair.

Two candidate models are fitted and the one that actually predicts better on a
held-out tail is kept (plan §16, "advanced forecasting beyond linear
regression"):

  * ``seasonal-trend`` — a linear trend plus Fourier seasonality terms, fitted
    directly against the calendar. It extrapolates without feeding its own
    output back in, so a long horizon doesn't compound its own error.
  * ``lagged-linear`` — the original lag/rolling-mean model, forecast
    iteratively. Still the better model on series whose next value depends more
    on the last one than on where it sits in the week.

Both are scored against a seasonal-naive baseline on the same holdout, and the
result says which model won, by how much, and whether it beat the baseline at
all — a forecast that can't beat "same as last season" is reported as such
rather than presented as insight.

Prediction intervals are empirical: the quantiles of the chosen model's own
holdout residuals. They describe how wrong this model has been on this series,
not a distributional assumption, and they do not widen with horizon — stated
in ``note`` so the UI can repeat it rather than implying more than was measured.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

FEATURE_COLS = ["day", "month", "day_of_week", "week", "lag_1", "lag_7", "rolling_mean_7"]

# Fewest history points either model is allowed to fit on. Below this the
# holdout is too small to choose between models honestly.
_MIN_HISTORY = 10

# A seasonal period is only modelled when the history covers at least this many
# full cycles; one-and-a-bit cycles of a yearly term is curve-fitting noise.
_MIN_CYCLES = 2.0

# Empirical interval width. 10th–90th percentile of residuals: wide enough to
# be worth showing, narrow enough that exceeding it means something.
_INTERVAL = 0.8

_SEASONS = (
    # (name, period in days, harmonics)
    ("weekly", 7.0, 2),
    ("monthly", 30.44, 1),
    ("yearly", 365.25, 2),
)


def infer_date_column(df: pd.DataFrame) -> str | None:
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            return col
    for col in df.columns:
        if df[col].dtype == object:
            parsed = pd.to_datetime(df[col], errors="coerce")
            if parsed.notna().mean() > 0.8:
                return col
    return None


def infer_measure_column(df: pd.DataFrame, exclude: str | None = None) -> str | None:
    for col in df.columns:
        if col == exclude:
            continue
        if pd.api.types.is_numeric_dtype(df[col]):
            return col
    return None


# ── History ───────────────────────────────────────────────────────────────────

def _history(df: pd.DataFrame, date_col: str, value_col: str) -> pd.DataFrame:
    """One row per date, values summed, sorted — the series both models fit."""
    return (df.assign(_date=pd.to_datetime(df[date_col], errors="coerce"))
              .dropna(subset=["_date", value_col])
              .groupby("_date")[value_col].sum()
              .reset_index()
              .rename(columns={"_date": "date"})
              .sort_values("date")
              .reset_index(drop=True))


def _step_days(dates: pd.Series) -> float:
    """Typical spacing between observations, in days.

    Forecast rows are placed at this spacing rather than a hardcoded daily
    step: on weekly data a "7-day forecast" of daily rows would invent six
    observations per week that the series never had.
    """
    diffs = dates.diff().dropna().dt.total_seconds() / 86400.0
    diffs = diffs[diffs > 0]
    if diffs.empty:
        return 1.0
    return float(diffs.median())


# ── Seasonal-trend model ──────────────────────────────────────────────────────

def _seasons_for(span_days: float, step: float) -> list[tuple[str, float, int]]:
    """Which seasonal periods this history can actually support."""
    seasons = []
    for name, period, harmonics in _SEASONS:
        # Need enough cycles to estimate the term, and a sampling interval fine
        # enough to see inside one (Nyquist: two samples per cycle at minimum).
        if span_days >= period * _MIN_CYCLES and step <= period / 3:
            seasons.append((name, period, harmonics))
    return seasons


def _design(dates: pd.Series, origin: pd.Timestamp,
            seasons: list[tuple[str, float, int]]) -> np.ndarray:
    """[trend, sin/cos pairs per harmonic] for the given timestamps."""
    t = (pd.to_datetime(dates) - origin).dt.total_seconds().to_numpy() / 86400.0
    cols = [t]
    for _, period, harmonics in seasons:
        for k in range(1, harmonics + 1):
            angle = 2 * np.pi * k * t / period
            cols.append(np.sin(angle))
            cols.append(np.cos(angle))
    return np.column_stack(cols)


def _fit_seasonal(train: pd.DataFrame, value_col: str,
                  seasons: list[tuple[str, float, int]]):
    origin = train["date"].iloc[0]
    X = _design(train["date"], origin, seasons)
    y = train[value_col].to_numpy(dtype=float)
    model = LinearRegression().fit(X, y)

    def predict(dates: pd.Series) -> np.ndarray:
        return model.predict(_design(pd.Series(list(dates)), origin, seasons))

    return predict


# ── Lagged model (the original) ───────────────────────────────────────────────

def _build_features(ts: pd.DataFrame, value_col: str) -> pd.DataFrame:
    """Add time and lag features to a date-indexed value series."""
    df = ts.copy().sort_values("date")
    df["day"] = df["date"].dt.day
    df["month"] = df["date"].dt.month
    df["day_of_week"] = df["date"].dt.dayofweek
    df["week"] = df["date"].dt.isocalendar().week.astype(int)
    df["lag_1"] = df[value_col].shift(1)
    df["lag_7"] = df[value_col].shift(7)
    df["rolling_mean_7"] = df[value_col].rolling(7).mean()
    return df.dropna()


def _fit_lagged(train: pd.DataFrame, value_col: str):
    feat = _build_features(train, value_col)
    if len(feat) < _MIN_HISTORY:
        return None
    model = LinearRegression().fit(feat[FEATURE_COLS], feat[value_col])
    last = feat.iloc[-1].copy()

    def predict(dates) -> np.ndarray:
        """Iterative: each step consumes the previous step's own prediction."""
        state = last.copy()
        out = []
        for next_date in pd.to_datetime(pd.Series(list(dates))):
            x = pd.DataFrame([{
                "day": next_date.day,
                "month": next_date.month,
                "day_of_week": next_date.dayofweek,
                "week": int(next_date.isocalendar().week),
                "lag_1": state[value_col],
                "lag_7": state["lag_7"],
                "rolling_mean_7": state["rolling_mean_7"],
            }])
            pred = float(model.predict(x)[0])
            out.append(pred)
            state["lag_7"] = state["lag_1"]
            state["lag_1"] = state[value_col]
            state["rolling_mean_7"] = (state["rolling_mean_7"] * 6 + pred) / 7
            state[value_col] = pred
        return np.asarray(out, dtype=float)

    return predict


# ── Baseline ──────────────────────────────────────────────────────────────────

def _seasonal_naive(train: pd.DataFrame, value_col: str, horizon: int,
                    season_len: int | None) -> np.ndarray:
    """"Same as one season ago", or "same as the last value" when the series
    has no usable season. The bar any model has to clear to be worth fitting."""
    values = train[value_col].to_numpy(dtype=float)
    if season_len and len(values) >= season_len:
        cycle = values[-season_len:]
        return np.asarray([cycle[i % season_len] for i in range(horizon)])
    return np.repeat(values[-1], horizon)


def _mae(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.mean(np.abs(np.asarray(actual, dtype=float) - predicted)))


# ── Public API ────────────────────────────────────────────────────────────────

def predict_series(
    df: pd.DataFrame,
    date_col: str | None = None,
    value_col: str | None = None,
    periods: int = 7,
) -> dict | None:
    """Forecast `periods` steps beyond the history in `df`.

    Returns None when no forecast can honestly be fitted (no date/measure pair,
    or too little history). Otherwise a dict:

        {"frame": DataFrame[date_col, predicted_X, predicted_X_lower,
                            predicted_X_upper],
         "method", "seasonality", "step_days", "periods", "history_points",
         "holdout_points", "mae", "baseline_mae", "beats_baseline",
         "interval", "note"}

    Everything the caller needs to describe the forecast is measured here, so
    the UI never has to assume a daily step or a model it didn't fit.
    """
    date_col = date_col or infer_date_column(df)
    value_col = value_col or infer_measure_column(df, exclude=date_col)
    if date_col is None or value_col is None:
        return None

    ts = _history(df, date_col, value_col)
    if len(ts) < _MIN_HISTORY:
        return None

    step = _step_days(ts["date"])
    span_days = float((ts["date"].iloc[-1] - ts["date"].iloc[0]).total_seconds() / 86400.0)
    seasons = _seasons_for(span_days, step)

    # Holdout: the tail the models are scored on. Capped so that even a short
    # series keeps most of its points for fitting.
    holdout = max(3, min(periods, len(ts) // 5))
    train, test = ts.iloc[:-holdout], ts.iloc[-holdout:]
    if len(train) < _MIN_HISTORY:
        train, test = ts, ts.iloc[0:0]

    season_len = None
    if seasons and step > 0:
        season_len = int(round(seasons[0][1] / step)) or None

    candidates: dict[str, dict] = {}
    for name, fit in (("seasonal-trend", lambda t: _fit_seasonal(t, value_col, seasons)),
                      ("lagged-linear", lambda t: _fit_lagged(t, value_col))):
        if name == "seasonal-trend" and not seasons:
            # With no supportable season this is a plain straight line; the
            # lagged model subsumes it, so it isn't offered as a choice.
            continue
        try:
            predict = fit(train)
        except Exception:
            continue
        if predict is None:
            continue
        if len(test):
            try:
                preds = predict(test["date"])
            except Exception:
                continue
            residuals = test[value_col].to_numpy(dtype=float) - preds
            candidates[name] = {"mae": _mae(test[value_col].to_numpy(), preds),
                                "residuals": residuals}
        else:
            candidates[name] = {"mae": None, "residuals": np.zeros(0)}

    if not candidates:
        # Neither model could be fitted (e.g. too few rows survive the lag
        # features and no season is supportable) — say nothing rather than
        # falling back to something unvalidated.
        return None

    # Pick by holdout error; with no holdout, prefer the seasonal model when it
    # exists because it is the one that doesn't compound its own error.
    if len(test):
        method = min(candidates, key=lambda n: candidates[n]["mae"])
    else:
        method = "seasonal-trend" if "seasonal-trend" in candidates else next(iter(candidates))

    baseline_mae = None
    if len(test):
        baseline_mae = _mae(test[value_col].to_numpy(),
                            _seasonal_naive(train, value_col, len(test), season_len))

    # Refit the winner on the full history before forecasting forward.
    fit_full = (_fit_seasonal(ts, value_col, seasons) if method == "seasonal-trend"
                else _fit_lagged(ts, value_col))
    if fit_full is None:
        return None

    last_date = ts["date"].iloc[-1]
    future = [last_date + pd.Timedelta(days=step * (i + 1)) for i in range(periods)]
    predictions = np.asarray(fit_full(future), dtype=float)

    residuals = candidates[method]["residuals"]
    predicted_col = f"predicted_{value_col}"

    # A model that ran consistently low or high on the holdout is corrected by
    # that median offset before forecasting forward, and the band is built from
    # the residuals *after* the same correction. Without this the band is an
    # honest range that need not contain the point forecast at all — which
    # reads as a bug rather than as the bias it actually is.
    bias = float(np.median(residuals)) if residuals.size else 0.0
    predictions = predictions + bias
    frame = pd.DataFrame({date_col: future, predicted_col: predictions})
    if residuals.size:
        centered = residuals - bias
        lo, hi = np.quantile(centered, [(1 - _INTERVAL) / 2, 1 - (1 - _INTERVAL) / 2])
        frame[f"{predicted_col}_lower"] = predictions + lo
        frame[f"{predicted_col}_upper"] = predictions + hi

    mae = candidates[method]["mae"]
    beats_baseline = None if (mae is None or baseline_mae is None) else bool(mae < baseline_mae)

    notes = []
    if beats_baseline is False:
        notes.append(
            "This model did not beat a seasonal-naive baseline on the held-out "
            "tail — treat the numbers as a continuation of recent levels, not a "
            "prediction that adds information."
        )
    if residuals.size:
        notes.append(
            f"The band is the {int(_INTERVAL * 100)}% range of this model's own "
            f"errors on the held-out tail; it does not widen with horizon."
        )
    else:
        notes.append("Too little history to hold any out, so no error band is shown.")

    return {
        "frame": frame,
        "method": method,
        "seasonality": [name for name, _, _ in seasons],
        "step_days": round(step, 4),
        "periods": periods,
        "history_points": len(ts),
        "holdout_points": len(test),
        "mae": None if mae is None else round(mae, 4),
        # Every candidate's holdout error, so the choice is inspectable rather
        # than asserted: the reported method is the argmin of this map.
        "considered": {n: (None if c["mae"] is None else round(c["mae"], 4))
                       for n, c in candidates.items()},
        "baseline_mae": None if baseline_mae is None else round(baseline_mae, 4),
        "beats_baseline": beats_baseline,
        "interval": _INTERVAL if residuals.size else None,
        "bias_correction": round(bias, 4) if residuals.size else None,
        "date_column": date_col,
        "value_column": value_col,
        "note": " ".join(notes),
    }


def predict_sales(
    df: pd.DataFrame,
    date_col: str | None = None,
    value_col: str | None = None,
    periods: int = 7,
) -> pd.DataFrame | None:
    """Backwards-compatible wrapper: just the forecast rows.

    `app.py` (the legacy CLI) prints this frame directly, so it keeps the
    two-column shape it always had.
    """
    result = predict_series(df, date_col, value_col, periods)
    if result is None:
        return None
    frame = result["frame"]
    keep = [c for c in frame.columns if not c.endswith(("_lower", "_upper"))]
    return frame[keep]

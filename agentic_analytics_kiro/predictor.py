from __future__ import annotations

import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression

FEATURE_COLS = ["day", "month", "day_of_week", "week", "lag_1", "lag_7", "rolling_mean_7"]


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


def predict_sales(
    df: pd.DataFrame,
    date_col: str | None = None,
    value_col: str | None = None,
    periods: int = 7,
) -> pd.DataFrame | None:
    date_col = date_col or infer_date_column(df)
    value_col = value_col or infer_measure_column(df, exclude=date_col)

    if date_col is None or value_col is None:
        return None

    ts = (df.assign(date=pd.to_datetime(df[date_col], errors="coerce"))
            .dropna(subset=["date", value_col])
            .groupby("date")[value_col].sum()
            .reset_index())
    ts = ts.rename(columns={value_col: value_col})  # keep name for feature building

    df_feat = _build_features(ts, value_col)
    if len(df_feat) < 10:
        return None

    model = LinearRegression().fit(df_feat[FEATURE_COLS], df_feat[value_col])

    predicted_col = f"predicted_{value_col}"

    # Iterative forecast
    state = df_feat.iloc[-1].copy()
    rows = []
    for _ in range(periods):
        next_date = state["date"] + pd.Timedelta(days=1)
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
        rows.append({date_col: next_date, predicted_col: pred})
        # roll state forward
        state["lag_7"] = state["lag_1"]
        state["lag_1"] = state[value_col]
        state["rolling_mean_7"] = (state["rolling_mean_7"] * 6 + pred) / 7
        state["date"] = next_date
        state[value_col] = pred

    return pd.DataFrame(rows)

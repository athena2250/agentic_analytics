from __future__ import annotations

import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression

FEATURE_COLS = ["day", "month", "day_of_week", "week", "lag_1", "lag_7", "rolling_mean_7"]


def _build_features(ts: pd.DataFrame) -> pd.DataFrame:
    """Add time and lag features to a date-indexed revenue series."""
    df = ts.copy().sort_values("date")
    df["day"] = df["date"].dt.day
    df["month"] = df["date"].dt.month
    df["day_of_week"] = df["date"].dt.dayofweek
    df["week"] = df["date"].dt.isocalendar().week.astype(int)
    df["lag_1"] = df["revenue"].shift(1)
    df["lag_7"] = df["revenue"].shift(7)
    df["rolling_mean_7"] = df["revenue"].rolling(7).mean()
    return df.dropna()


def predict_sales(df: pd.DataFrame, periods: int = 7) -> pd.DataFrame | None:
    if "date" not in df.columns or "revenue" not in df.columns:
        return None

    ts = (df.assign(date=pd.to_datetime(df["date"], errors="coerce"))
            .dropna(subset=["date", "revenue"])
            .groupby("date")["revenue"].sum()
            .reset_index())

    df_feat = _build_features(ts)
    if len(df_feat) < 10:
        return None

    model = LinearRegression().fit(df_feat[FEATURE_COLS], df_feat["revenue"])

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
            "lag_1": state["revenue"],
            "lag_7": state["lag_7"],
            "rolling_mean_7": state["rolling_mean_7"],
        }])
        pred = float(model.predict(x)[0])
        rows.append({"date": next_date, "predicted_revenue": pred})
        # roll state forward
        state["lag_7"] = state["lag_1"]
        state["lag_1"] = state["revenue"]
        state["rolling_mean_7"] = (state["rolling_mean_7"] * 6 + pred) / 7
        state["date"] = next_date
        state["revenue"] = pred

    return pd.DataFrame(rows)

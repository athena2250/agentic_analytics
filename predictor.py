import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression


# ---------------- FEATURE ENGINEERING ---------------- #

def create_features(df):
    df = df.copy()

    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")

    df["day"] = df["date"].dt.day
    df["month"] = df["date"].dt.month
    df["day_of_week"] = df["date"].dt.dayofweek
    df["week"] = df["date"].dt.isocalendar().week.astype(int)

    df["lag_1"] = df["revenue"].shift(1)
    df["lag_7"] = df["revenue"].shift(7)

    df["rolling_mean_7"] = df["revenue"].rolling(7).mean()

    df = df.dropna()

    return df


# ---------------- PREPARE DATA ---------------- #

def prepare_data(df):
    # 🔥 FIX: Always return 3 values
    if "date" not in df.columns or "revenue" not in df.columns:
        return None, None, None

    df = df.copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")

    df = df.dropna(subset=["date", "revenue"])

    if df.empty:
        return None, None, None

    ts = df.groupby("date")["revenue"].sum().reset_index()

    df_feat = create_features(ts)

    if df_feat.empty:
        return None, None, None

    feature_cols = [
        "day", "month", "day_of_week", "week",
        "lag_1", "lag_7", "rolling_mean_7"
    ]

    X = df_feat[feature_cols]
    y = df_feat["revenue"]

    return X, y, df_feat


# ---------------- TRAIN MODEL ---------------- #

def train_model(X, y):
    model = LinearRegression()
    model.fit(X, y)
    return model


# ---------------- FORECAST ---------------- #

def forecast(model, df_feat, periods=7):
    current = df_feat.iloc[-1].copy()
    predictions = []

    for _ in range(periods):
        next_date = current["date"] + pd.Timedelta(days=1)

        next_features = {
            "day": next_date.day,
            "month": next_date.month,
            "day_of_week": next_date.dayofweek,
            "week": int(next_date.isocalendar().week),
            "lag_1": current["revenue"],
            "lag_7": current["lag_1"],
            "rolling_mean_7": current["rolling_mean_7"]
        }

        X_next = pd.DataFrame([next_features])
        pred = model.predict(X_next)[0]

        predictions.append((next_date, float(pred)))

        # update state
        current["date"] = next_date
        current["revenue"] = pred

    forecast_df = pd.DataFrame(predictions, columns=["date", "predicted_revenue"])

    return forecast_df


# ---------------- MAIN ENTRY ---------------- #

def predict_sales(df, periods=7):
    result = prepare_data(df)

    # 🔥 FIX: safe unpacking
    if result is None or result[0] is None:
        return None

    X, y, df_feat = result

    # 🔥 safety check
    if len(X) < 10:
        return None

    model = train_model(X, y)

    forecast_df = forecast(model, df_feat, periods)

    return forecast_df
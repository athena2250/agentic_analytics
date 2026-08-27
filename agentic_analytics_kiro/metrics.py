from __future__ import annotations

"""
All metrics computed from a single pre-aggregated stats dict to avoid
redundant DataFrame operations.
"""
import pandas as pd


def _stats(df: pd.DataFrame) -> dict:
    """Compute shared aggregates once."""
    revenue = df["revenue"].sum() if "revenue" in df.columns else 0.0
    cost = df["cost"].sum() if "cost" in df.columns else 0.0
    n_rows = len(df)
    n_customers = df["customer_id"].nunique() if "customer_id" in df.columns else 0
    n_transactions = df["transaction_id"].nunique() if "transaction_id" in df.columns else 0
    return dict(revenue=revenue, cost=cost, n_rows=n_rows,
                n_customers=n_customers, n_transactions=n_transactions)


def customer_count(df: pd.DataFrame) -> int:
    return _stats(df)["n_customers"]


def transactions(df: pd.DataFrame) -> int:
    return _stats(df)["n_transactions"]


def trips(df: pd.DataFrame) -> int:
    return len(df)


def net_sales(df: pd.DataFrame) -> float:
    return _stats(df)["revenue"]


def net_margin(df: pd.DataFrame) -> float:
    s = _stats(df)
    return s["revenue"] - s["cost"]


def margin_percent(df: pd.DataFrame) -> float:
    s = _stats(df)
    return (s["revenue"] - s["cost"]) / s["revenue"] * 100 if s["revenue"] else 0.0


def trips_per_customer(df: pd.DataFrame) -> float:
    s = _stats(df)
    return s["n_rows"] / s["n_customers"] if s["n_customers"] else 0.0


def sales_per_customer(df: pd.DataFrame) -> float:
    s = _stats(df)
    return s["revenue"] / s["n_customers"] if s["n_customers"] else 0.0


def sales_per_trip(df: pd.DataFrame) -> float:
    s = _stats(df)
    return s["revenue"] / s["n_rows"] if s["n_rows"] else 0.0


def net_units(df: pd.DataFrame):
    return df["units"].sum() if "units" in df.columns else None


# Dispatch table — avoids if-chains in agent.py
METRIC_FN = {
    "customer_count": customer_count,
    "transactions": transactions,
    "trips": trips,
    "net_sales": net_sales,
    "net_margin": net_margin,
    "margin_percent": margin_percent,
    "trips_per_customer": trips_per_customer,
    "sales_per_customer": sales_per_customer,
    "sales_per_trip": sales_per_trip,
    "net_units": net_units,
}

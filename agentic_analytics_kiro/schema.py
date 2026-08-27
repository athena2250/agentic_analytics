from __future__ import annotations

import pandas as pd


def standardize_columns(df: pd.DataFrame, aliases: dict) -> pd.DataFrame:
    """Single-pass rename: build full map then rename once."""
    lower_to_standard = {
        alias.lower(): standard
        for standard, options in aliases.items()
        for alias in options
    }
    col_map = {col: lower_to_standard[col.lower()]
               for col in df.columns if col.lower() in lower_to_standard}
    return df.rename(columns=col_map) if col_map else df


def normalize_date(df: pd.DataFrame) -> pd.DataFrame:
    if "date" in df.columns:
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
    return df


def extract_schema(df: pd.DataFrame) -> dict:
    return {"columns": list(df.columns), "dtypes": df.dtypes.astype(str).to_dict()}

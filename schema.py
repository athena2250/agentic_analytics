import pandas as pd

def standardize_columns(df, aliases):
    col_map = {}
    for standard, options in aliases.items():
        for col in df.columns:
            if col.lower() in options:
                col_map[col] = standard
    return df.rename(columns=col_map)


def normalize_date(df):
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    return df


def extract_schema(df):
    return {
        "columns": list(df.columns),
        "dtypes": df.dtypes.astype(str).to_dict()
    }
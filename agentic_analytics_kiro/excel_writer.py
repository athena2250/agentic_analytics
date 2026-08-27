import pandas as pd


def write_excel(df: pd.DataFrame, summary: dict, filename: str = "output.xlsx") -> None:
    summary_df = pd.DataFrame(list(summary.items()), columns=["Metric", "Value"])
    with pd.ExcelWriter(filename, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Raw Data", index=False)
        summary_df.to_excel(writer, sheet_name="Summary", index=False)

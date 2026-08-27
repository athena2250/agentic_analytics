import pandas as pd

def write_excel(df, summary, filename="output.xlsx"):
    with pd.ExcelWriter(filename) as writer:
        df.to_excel(writer, sheet_name="Raw Data", index=False)

        summary_df = pd.DataFrame(list(summary.items()), columns=["Metric", "Value"])
        summary_df.to_excel(writer, sheet_name="Summary", index=False)
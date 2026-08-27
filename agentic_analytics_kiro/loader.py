"""
Dynamic dataset loader for DuckDB.

Supports: CSV, TSV, Excel (.xlsx/.xls), Parquet, JSON, NDJSON, ORC, Avro
Handles multiple files — each becomes its own table, plus a unified view.
Files up to 500GB are handled via DuckDB's lazy scanning (no full RAM load).
"""

from __future__ import annotations

import os
import re
import duckdb
import pandas as pd

# Map extension → DuckDB reader expression
_READERS: dict[str, str] = {
    ".csv":     "read_csv_auto('{path}')",
    ".tsv":     "read_csv_auto('{path}', delim='\\t')",
    ".txt":     "read_csv_auto('{path}')",
    ".parquet": "read_parquet('{path}')",
    ".json":    "read_json_auto('{path}')",
    ".ndjson":  "read_json_auto('{path}')",
    ".jsonl":   "read_json_auto('{path}')",
    ".orc":     "read_orc('{path}')",
    ".avro":    "read_avro('{path}')",
}

# Excel needs pandas as DuckDB has no native Excel reader
_EXCEL_EXTS = {".xlsx", ".xls", ".xlsm"}


def _safe_table_name(path: str) -> str:
    """Derive a clean SQL table name from a file path."""
    base = os.path.splitext(os.path.basename(path))[0]
    name = re.sub(r"[^a-zA-Z0-9_]", "_", base).lower()
    # Ensure it doesn't start with a digit
    if name and name[0].isdigit():
        name = "t_" + name
    return name or "table_0"


def _reader_expr(path: str) -> str | None:
    ext = os.path.splitext(path)[1].lower()
    template = _READERS.get(ext)
    return template.format(path=path) if template else None


def _load_excel(path: str, con: duckdb.DuckDBPyConnection, table_name: str) -> list[str]:
    """Load all sheets of an Excel file as separate tables."""
    sheets = pd.read_excel(path, sheet_name=None, engine="openpyxl")
    loaded = []
    for sheet, df in sheets.items():
        tname = f"{table_name}_{re.sub(r'[^a-zA-Z0-9_]', '_', sheet).lower()}"
        # Register df temporarily, then persist as a real DuckDB table
        con.register("_tmp_excel_sheet", df)
        con.execute(f"CREATE OR REPLACE TABLE {tname} AS SELECT * FROM _tmp_excel_sheet")
        con.unregister("_tmp_excel_sheet")
        loaded.append(tname)
        print(f"  ✅ Loaded sheet '{sheet}' → table '{tname}' ({len(df):,} rows)")
    return loaded


def load_files(paths: list[str], con: duckdb.DuckDBPyConnection) -> dict:
    """
    Load one or more files into DuckDB.

    Returns:
        {
          "tables":  {table_name: [col, ...]},   # all registered tables
          "sample":  pd.DataFrame,               # small sample for schema display
          "unified": str | None,                 # name of unified view (if >1 table)
        }
    """
    if not paths:
        raise ValueError("No files provided.")

    tables: dict[str, list[str]] = {}
    used_names: dict[str, int] = {}

    for path in paths:
        path = path.strip()
        if not os.path.exists(path):
            print(f"  ⚠️  File not found, skipping: {path}")
            continue

        ext = os.path.splitext(path)[1].lower()
        base_name = _safe_table_name(path)

        # Deduplicate table names
        if base_name in used_names:
            used_names[base_name] += 1
            base_name = f"{base_name}_{used_names[base_name]}"
        else:
            used_names[base_name] = 0

        if ext in _EXCEL_EXTS:
            sheet_tables = _load_excel(path, con, base_name)
            for t in sheet_tables:
                cols = [r[0] for r in con.execute(f"DESCRIBE {t}").fetchall()]
                tables[t] = cols
        else:
            expr = _reader_expr(path)
            if expr is None:
                print(f"  ⚠️  Unsupported format, skipping: {path}")
                continue
            try:
                con.execute(f"CREATE OR REPLACE TABLE {base_name} AS SELECT * FROM {expr}")
                cols = [r[0] for r in con.execute(f"DESCRIBE {base_name}").fetchall()]
                tables[base_name] = cols
                row_count = con.execute(f"SELECT COUNT(*) FROM {base_name}").fetchone()[0]
                print(f"  ✅ Loaded '{os.path.basename(path)}' → table '{base_name}' ({row_count:,} rows, {len(cols)} cols)")
            except Exception as e:
                print(f"  ❌ Failed to load '{path}': {e}")
                continue

    if not tables:
        raise RuntimeError("No files were loaded successfully.")

    # Build a unified view when multiple tables share compatible columns
    unified_view = None
    if len(tables) > 1:
        unified_view = _build_unified_view(tables, con)

    # Sample from the first (or unified) table for schema display
    sample_table = unified_view or next(iter(tables))
    sample = con.execute(f"SELECT * FROM {sample_table} LIMIT 5").fetchdf()

    return {"tables": tables, "sample": sample, "unified": unified_view}


def _build_unified_view(tables: dict[str, list[str]], con: duckdb.DuckDBPyConnection) -> str | None:
    """
    UNION ALL tables that share the same column set.
    Tables with different schemas are left as individual tables.
    """
    # Group tables by their sorted column signature
    groups: dict[tuple, list[str]] = {}
    for tname, cols in tables.items():
        key = tuple(sorted(c.lower() for c in cols))
        groups.setdefault(key, []).append(tname)

    # Pick the largest compatible group
    best = max(groups.values(), key=len)
    if len(best) < 2:
        return None  # No compatible tables to union

    # Use column order from the first table in the group
    ref_cols = tables[best[0]]
    col_list = ", ".join(ref_cols)
    union_parts = [f"SELECT {col_list} FROM {t}" for t in best]
    view_sql = " UNION ALL ".join(union_parts)

    con.execute(f"CREATE OR REPLACE VIEW all_data AS {view_sql}")
    print(f"  🔗 Unified view 'all_data' created from: {', '.join(best)}")
    return "all_data"


def schema_summary(tables: dict[str, list[str]]) -> str:
    """Human-readable schema string for LLM prompts."""
    lines = []
    for tname, cols in tables.items():
        lines.append(f"TABLE: {tname}  COLUMNS: {', '.join(cols)}")
    return "\n".join(lines)


def rich_schema_summary(tables: dict[str, list[str]], con: duckdb.DuckDBPyConnection) -> str:
    """
    Richer schema string including data types and sample values.
    Used to give the LLM enough context to generate accurate SQL.
    """
    lines = []
    for tname, cols in tables.items():
        lines.append(f"TABLE: {tname}")
        try:
            desc = con.execute(f"DESCRIBE {tname}").fetchdf()
            sample = con.execute(f"SELECT * FROM {tname} LIMIT 3").fetchdf()
            for _, row in desc.iterrows():
                col = row["column_name"]
                dtype = row["column_type"]
                samples = sample[col].dropna().tolist()[:3] if col in sample.columns else []
                sample_str = ", ".join(str(s) for s in samples)
                lines.append(f"  {col} ({dtype}) — e.g. {sample_str}")
        except Exception:
            for col in cols:
                lines.append(f"  {col}")
        lines.append("")
    return "\n".join(lines)

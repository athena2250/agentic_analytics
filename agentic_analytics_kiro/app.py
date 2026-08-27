from __future__ import annotations

import warnings
warnings.filterwarnings("ignore")

import re
import time
import requests
import pandas as pd
import duckdb
from dateutil import parser as date_parser

from config import SPELL_CORRECTIONS, LLM_URL, LLM_MODEL, CACHE_TTL
from semantic_validator import validate_semantics
from planner import detect_metrics_from_query
from predictor import predict_sales
from loader import load_files, schema_summary

# ── State ─────────────────────────────────────────────────────────────────────

threads: dict[str, list[dict]] = {"default": []}
current_thread: str = "default"
_cache: dict[str, tuple[pd.DataFrame, float]] = {}

# ── Cache ─────────────────────────────────────────────────────────────────────

def _get_cached(key: str) -> pd.DataFrame | None:
    entry = _cache.get(key)
    if entry and time.time() - entry[1] < CACHE_TTL:
        return entry[0]
    return None


def _set_cache(key: str, df: pd.DataFrame) -> None:
    _cache[key] = (df, time.time())

# ── LLM ───────────────────────────────────────────────────────────────────────

def _llm(prompt: str) -> str:
    resp = requests.post(LLM_URL, json={"model": LLM_MODEL, "prompt": prompt, "stream": False})
    resp.raise_for_status()
    return resp.json()["response"]

# ── Query normalisation ───────────────────────────────────────────────────────

_CORRECTION_RE = re.compile("|".join(re.escape(k) for k in SPELL_CORRECTIONS))

def normalize_query(query: str) -> str:
    return _CORRECTION_RE.sub(lambda m: SPELL_CORRECTIONS[m.group()], query.lower())


def normalize_dates_in_query(query: str) -> str:
    words = query.split()
    out, i = [], 0
    while i < len(words):
        parsed = None
        for size in (3, 2, 1):
            chunk = " ".join(words[i:i + size])
            try:
                parsed = date_parser.parse(chunk, fuzzy=False, dayfirst=True)
                out.append(parsed.strftime("%Y-%m-%d"))
                i += size
                break
            except (ValueError, OverflowError):
                pass
        if parsed is None:
            out.append(words[i])
            i += 1
    return " ".join(out)

# ── Intent detection ──────────────────────────────────────────────────────────

_INTENT_KEYWORDS: dict[str, list[str]] = {
    "predict": ["predict", "forecast", "future"],
    "export":  ["excel", "export"],
    "insight": ["insight", "analyze", "why", "explain"],
    "sql":     ["sql"],
}

def detect_intent(query: str) -> str:
    q = query.lower()
    for intent, keywords in _INTENT_KEYWORDS.items():
        if any(k in q for k in keywords):
            return intent
    return "data"

# ── SQL helpers ───────────────────────────────────────────────────────────────

_SQL_FENCE_RE = re.compile(r"```sql|```", re.IGNORECASE)
_SQL_EXTRACT_RE = re.compile(r"(SELECT\b.*?;|SELECT\b.*)", re.DOTALL | re.IGNORECASE)

def extract_sql(text: str) -> str:
    text = _SQL_FENCE_RE.sub("", text)
    m = _SQL_EXTRACT_RE.search(text)
    return m.group(1).strip() if m else ""


_SQL_KEYWORDS = {
    "select","from","where","group","by","order","limit","sum","avg","count",
    "as","and","or","between","in","desc","asc","on","having","join","left",
    "right","inner","outer","null","is","not","like","distinct","case","when",
    "then","else","end","min","max","date","all","union","with","over",
    "partition","row_number","rank","coalesce","cast","interval","true","false",
}

def validate_sql(sql: str, tables: dict[str, list[str]]) -> tuple[bool, str]:
    sql_lower = sql.lower()
    all_cols = {c.lower() for cols in tables.values() for c in cols}
    table_names = {t.lower() for t in tables}
    allowed = _SQL_KEYWORDS | all_cols | table_names

    for token in re.findall(r"[a-zA-Z_]\w*", sql_lower):
        if token not in allowed:
            return False, f"Invalid token: {token}"
    return True, "valid"


def generate_sql(query: str, tables: dict[str, list[str]], unified: str | None) -> str:
    history = "\n".join(
        f"Q: {h['query']}\nSQL: {h['sql']}\nResult:\n{h['result_summary']}"
        for h in threads[current_thread][-3:]
    )
    metrics = detect_metrics_from_query(query)
    schema_text = schema_summary(tables)
    default_table = unified or next(iter(tables))

    prompt = (
        f"You are a STRICT SQL generator.\n\n"
        f"AVAILABLE TABLES AND SCHEMAS:\n{schema_text}\n\n"
        f"DEFAULT TABLE (use if unspecified): {default_table}\n\n"
        f"RULES:\n"
        f"- Use ONLY the table and column names listed above\n"
        f"- You MAY join tables if needed\n"
        f"- Use 'date' column for date filtering\n"
        f"- Return ONLY the SQL query, no explanation\n\n"
        f"Conversation history:\n{history}\n\n"
        f"User query: {query}\n"
        f"Detected metrics: {metrics}\n\n"
        f"SQL:"
    )
    return extract_sql(_llm(prompt))


def fix_sql(sql: str, tables: dict[str, list[str]], error_msg: str) -> str:
    schema_text = schema_summary(tables)
    prompt = (
        f"Fix this SQL query.\n\nError: {error_msg}\n\n"
        f"Available tables and columns:\n{schema_text}\n\n"
        f"SQL:\n{sql}\n\nFixed SQL:"
    )
    return extract_sql(_llm(prompt))


def fallback_query(tables: dict[str, list[str]], unified: str | None) -> str:
    tname = next(iter(tables))  # always use a real table, not the view
    cols = tables[tname]
    if "revenue" in cols and "department" in cols:
        return f"SELECT department, SUM(revenue) AS revenue FROM {tname} GROUP BY department"
    return f"SELECT * FROM {tname} LIMIT 50"

# ── Analytics helpers ─────────────────────────────────────────────────────────

def enrich_time_features(df: pd.DataFrame) -> pd.DataFrame:
    if {"date", "revenue"}.issubset(df.columns):
        df = df.sort_values("date").copy()
        df["moving_avg"] = df["revenue"].rolling(7).mean()
    return df


def detect_trend(df: pd.DataFrame) -> str:
    if "moving_avg" in df.columns:
        delta = df["moving_avg"].diff().mean()
        if delta > 0: return "increasing 📈"
        if delta < 0: return "decreasing 📉"
        return "stable ➡️"
    return "unknown"


def detect_anomalies(df: pd.DataFrame) -> str:
    if "revenue" in df.columns:
        mean, std = df["revenue"].mean(), df["revenue"].std()
        anomalies = df[df["revenue"] > mean + 2 * std]
        if not anomalies.empty:
            return anomalies.head(5).to_string(index=False)
    return "No anomalies detected."


def generate_insights(df: pd.DataFrame, query: str) -> str:
    if df.empty:
        return "No data."
    df = enrich_time_features(df)
    prompt = (
        f"You are a senior business analyst.\n\nUser Question: {query}\n\n"
        f"Trend: {detect_trend(df)}\nAnomalies: {detect_anomalies(df)}\n\n"
        f"Data (first 10 rows):\n{df.head(10).to_string(index=False)}\n\n"
        f"Answer:\n1. WHAT HAPPENED\n2. WHY IT HAPPENED\n3. WHAT TO DO NEXT"
    )
    return _llm(prompt)

# ── File input helper ─────────────────────────────────────────────────────────

def prompt_for_files() -> list[str]:
    """
    Accept file paths from the user.
    They can enter multiple paths separated by commas or newlines,
    or keep pressing Enter to add more (blank line to finish).
    """
    print("\n📂 Enter file path(s) to load.")
    print("   Supported: CSV, TSV, Excel, Parquet, JSON, NDJSON, ORC, Avro")
    print("   You can enter multiple paths separated by commas,")
    print("   or one per line (blank line when done):\n")

    raw = input("👉 ").strip()
    paths: list[str] = []

    if "," in raw:
        paths = [p.strip() for p in raw.split(",") if p.strip()]
    else:
        if raw:
            paths.append(raw)
        while True:
            more = input("   + another file (or Enter to finish): ").strip()
            if not more:
                break
            paths.append(more)

    return paths

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    global current_thread

    con = duckdb.connect()

    # ── Load files ──
    while True:
        paths = prompt_for_files()
        if paths:
            break
        print("  ⚠️  Please provide at least one file path.")

    print("\n⏳ Loading files...\n")
    try:
        result = load_files(paths, con)
    except RuntimeError as e:
        print(f"❌ {e}")
        return

    tables: dict[str, list[str]] = result["tables"]
    unified: str | None = result["unified"]
    sample: pd.DataFrame = result["sample"]

    print(f"\n📋 Schema overview:")
    for tname, cols in tables.items():
        print(f"   {tname}: {', '.join(cols)}")
    if unified:
        print(f"   (unified view: {unified})")

    print(f"\n🔍 Sample data:\n{sample.to_string(index=False)}\n")
    print("🤖 AI Analytics Ready!")

    current_thread = input("🧵 Chat name (default): ").strip() or "default"
    threads.setdefault(current_thread, [])

    while True:
        query = input(f"\n[{current_thread}] 💬 Ask: ").strip()
        if query in ("exit", "quit"):
            break

        # Allow adding more files mid-session
        if query.lower() in ("load", "add file", "add files"):
            extra_paths = prompt_for_files()
            if extra_paths:
                print("\n⏳ Loading additional files...\n")
                try:
                    extra = load_files(extra_paths, con)
                    tables.update(extra["tables"])
                    if extra["unified"]:
                        unified = extra["unified"]
                    print("✅ Files added.")
                except RuntimeError as e:
                    print(f"❌ {e}")
            continue

        query = normalize_dates_in_query(normalize_query(query))
        intent = detect_intent(query)

        sql = generate_sql(query, tables, unified)
        valid, msg = validate_sql(sql, tables)

        for _ in range(2):
            if valid:
                break
            sql = fix_sql(sql, tables, msg)
            valid, msg = validate_sql(sql, tables)

        if not valid:
            sql = fallback_query(tables, unified)

        result_df = _get_cached(sql)
        if result_df is None:
            try:
                result_df = con.execute(sql).fetchdf()
                _set_cache(sql, result_df)
            except Exception as e:
                print(f"❌ Query failed: {e}")
                continue

        threads[current_thread].append({
            "query": query,
            "sql": sql,
            "result_summary": result_df.head(3).to_string(index=False),
        })

        if intent == "predict":
            pred = predict_sales(result_df)
            print("\n🔮 Forecast:\n", pred if pred is not None else "Not enough data.")
            continue

        print("\n📊 Result:\n", result_df.head())

        if intent == "insight":
            print("\n💡 Insights:\n", generate_insights(result_df, query))

        if intent == "export":
            result_df.to_excel("output.xlsx", index=False)
            print("📁 Exported to output.xlsx")


if __name__ == "__main__":
    main()

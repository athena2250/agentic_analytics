"""
FastAPI backend — wraps all analytics logic and exposes REST endpoints.
Run with: uvicorn api:app --reload --port 8000
"""
from __future__ import annotations

import warnings
warnings.filterwarnings("ignore")

import io
import os
import re
import sys
import time
import uuid
import shutil
import tempfile
import requests as http_requests

import json
import numpy as np
import duckdb
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

# Add current dir to path so sibling modules resolve
sys.path.insert(0, os.path.dirname(__file__))

from config import SPELL_CORRECTIONS, LLM_URL, LLM_MODEL, CACHE_TTL
from predictor import predict_sales
from loader import load_files, schema_summary, rich_schema_summary
from dateutil import parser as date_parser

app = FastAPI(title="Agentic Analytics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── JSON serialisation ────────────────────────────────────────────────────────

class _Encoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return None if np.isnan(obj) else float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, float) and np.isnan(obj):
            return None
        return super().default(obj)

def _json(data) -> JSONResponse:
    return JSONResponse(content=json.loads(json.dumps(data, cls=_Encoder)))


# Each session has its own DuckDB connection, tables, and chat history.

class Session:
    def __init__(self):
        self.con = duckdb.connect()
        self.tables: dict[str, list[str]] = {}
        self.unified: str | None = None
        self.history: list[dict] = []
        self.cache: dict[str, tuple[pd.DataFrame, float]] = {}

_sessions: dict[str, Session] = {}

def get_session(sid: str) -> Session:
    if sid not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return _sessions[sid]

# ── Helpers (ported from app.py) ──────────────────────────────────────────────

_CORRECTION_RE = re.compile("|".join(re.escape(k) for k in SPELL_CORRECTIONS))

def _normalize(query: str) -> str:
    return _CORRECTION_RE.sub(lambda m: SPELL_CORRECTIONS[m.group()], query.lower())

def _normalize_dates(query: str) -> str:
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

_INTENT_KEYWORDS = {
    "predict": ["predict", "forecast", "future"],
    "export":  ["excel", "export"],
    "insight": ["insight", "analyze", "why", "explain"],
}

def _detect_intent(query: str) -> str:
    q = query.lower()
    for intent, kws in _INTENT_KEYWORDS.items():
        if any(k in q for k in kws):
            return intent
    return "data"

_SQL_FENCE_RE = re.compile(r"```sql|```", re.IGNORECASE)
_SQL_EXTRACT_RE = re.compile(r"(SELECT\b.*?;|SELECT\b.*)", re.DOTALL | re.IGNORECASE)

def _extract_sql(text: str) -> str:
    text = _SQL_FENCE_RE.sub("", text)
    m = _SQL_EXTRACT_RE.search(text)
    return m.group(1).strip() if m else ""

def _validate_sql(sql: str, session: Session) -> tuple[bool, str]:
    """Validate by doing a DuckDB dry-run (EXPLAIN). Catches real errors, not fake ones."""
    if not sql or not sql.strip().upper().startswith("SELECT"):
        return False, "Not a SELECT statement"
    try:
        session.con.execute(f"EXPLAIN {sql}")
        return True, "valid"
    except Exception as e:
        return False, str(e)

def _llm(prompt: str) -> str:
    resp = http_requests.post(LLM_URL, json={"model": LLM_MODEL, "prompt": prompt, "stream": False}, timeout=120)
    resp.raise_for_status()
    return resp.json()["response"]

def _generate_sql(query: str, session: Session) -> str:
    history = "\n".join(
        f"Q: {h['query']}\nSQL: {h['sql']}"
        for h in session.history[-3:]
    )
    default_table = session.unified or next(iter(session.tables))
    schema = rich_schema_summary(session.tables, session.con)

    prompt = f"""You are a DuckDB SQL expert. Generate a single accurate SQL query.

SCHEMA (table name, columns, types, sample values):
{schema}
DEFAULT TABLE: {default_table}

RULES:
- Output ONLY the raw SQL query — no explanation, no markdown, no code fences
- Use exact column and table names from the schema above
- Use DuckDB syntax (e.g. DATE_TRUNC, STRFTIME, EPOCH, INTERVAL)
- For date filtering use the actual date column type shown in schema
- For string filters use ILIKE for case-insensitive matching
- Always include ORDER BY for top-N queries
- Use LIMIT 200 unless the user specifies a different number

CONVERSATION HISTORY:
{history}

USER REQUEST: {query}

SQL:"""
    return _extract_sql(_llm(prompt))


def _fix_sql(sql: str, session: Session, error: str) -> str:
    schema = rich_schema_summary(session.tables, session.con)
    prompt = f"""Fix this DuckDB SQL query.

ERROR: {error}

SCHEMA:
{schema}

BROKEN SQL:
{sql}

Return ONLY the corrected SQL, no explanation:"""
    return _extract_sql(_llm(prompt))

def _fallback_sql(session: Session) -> str:
    tname = next(iter(session.tables))  # always a real table, not the view
    cols = session.tables[tname]
    if "revenue" in cols and "department" in cols:
        return f"SELECT department, SUM(revenue) AS revenue FROM {tname} GROUP BY department"
    return f"SELECT * FROM {tname} LIMIT 50"

def _get_cached(session: Session, sql: str) -> pd.DataFrame | None:
    entry = session.cache.get(sql)
    if entry and time.time() - entry[1] < CACHE_TTL:
        return entry[0]
    return None

def _enrich(df: pd.DataFrame) -> pd.DataFrame:
    if {"date", "revenue"}.issubset(df.columns):
        df = df.sort_values("date").copy()
        df["moving_avg"] = df["revenue"].rolling(7).mean()
    return df

def _trend(df: pd.DataFrame) -> str:
    if "moving_avg" in df.columns:
        d = df["moving_avg"].diff().mean()
        return "increasing 📈" if d > 0 else ("decreasing 📉" if d < 0 else "stable ➡️")
    return "unknown"

def _anomalies(df: pd.DataFrame) -> str:
    if "revenue" in df.columns:
        mean, std = df["revenue"].mean(), df["revenue"].std()
        a = df[df["revenue"] > mean + 2 * std]
        if not a.empty:
            return a.head(5).to_string(index=False)
    return "No anomalies detected."

def _insights(df: pd.DataFrame, query: str) -> str:
    if df.empty:
        return "No data."
    df = _enrich(df)
    prompt = (
        f"You are a senior business analyst.\nUser Question: {query}\n"
        f"Trend: {_trend(df)}\nAnomalies: {_anomalies(df)}\n"
        f"Data:\n{df.head(10).to_string(index=False)}\n\n"
        f"Answer:\n1. WHAT HAPPENED\n2. WHY IT HAPPENED\n3. WHAT TO DO NEXT"
    )
    return _llm(prompt)

# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/session")
def create_session():
    sid = str(uuid.uuid4())
    _sessions[sid] = Session()
    return {"session_id": sid}


@app.delete("/session/{sid}")
def delete_session(sid: str):
    _sessions.pop(sid, None)
    return {"ok": True}


@app.post("/session/{sid}/upload")
async def upload_files(sid: str, files: list[UploadFile] = File(...)):
    session = get_session(sid)
    tmp_dir = tempfile.mkdtemp()
    saved_paths = []

    try:
        for f in files:
            dest = os.path.join(tmp_dir, f.filename)
            with open(dest, "wb") as out:
                shutil.copyfileobj(f.file, out)
            saved_paths.append(dest)

        result = load_files(saved_paths, session.con)
        session.tables.update(result["tables"])
        if result["unified"]:
            session.unified = result["unified"]

        schema = {t: cols for t, cols in session.tables.items()}
        sample = result["sample"].to_dict(orient="records")

        return _json({
            "tables": schema,
            "unified": session.unified,
            "sample": sample,
            "files_loaded": [f.filename for f in files],
        })
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.get("/session/{sid}/schema")
def get_schema(sid: str):
    session = get_session(sid)
    return {"tables": session.tables, "unified": session.unified}


class QueryRequest(BaseModel):
    query: str

@app.post("/session/{sid}/query")
def run_query(sid: str, body: QueryRequest):
    session = get_session(sid)
    if not session.tables:
        raise HTTPException(status_code=400, detail="No data loaded. Upload files first.")

    query = _normalize_dates(_normalize(body.query))
    intent = _detect_intent(query)

    sql = _generate_sql(query, session)
    valid, msg = _validate_sql(sql, session)

    for _ in range(2):
        if valid:
            break
        sql = _fix_sql(sql, session, msg)
        valid, msg = _validate_sql(sql, session)

    if not valid:
        sql = _fallback_sql(session)

    result_df = _get_cached(session, sql)
    if result_df is None:
        try:
            result_df = session.con.execute(sql).fetchdf()
            session.cache[sql] = (result_df, time.time())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Query failed: {e}")

    session.history.append({
        "query": query,
        "sql": sql,
        "result_summary": result_df.head(3).to_string(index=False),
    })

    response: dict = {
        "intent": intent,
        "sql": sql,
        "rows": result_df.head(200).to_dict(orient="records"),
        "columns": list(result_df.columns),
        "total_rows": len(result_df),
    }

    if intent == "predict":
        pred = predict_sales(result_df)
        response["forecast"] = pred.to_dict(orient="records") if pred is not None else None

    if intent == "insight":
        response["insights"] = _insights(result_df, query)

    if intent == "export":
        buf = io.BytesIO()
        result_df.to_excel(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=export.xlsx"},
        )

    return _json(response)


@app.get("/session/{sid}/export")
def export_last(sid: str):
    session = get_session(sid)
    if not session.history:
        raise HTTPException(status_code=400, detail="No query run yet.")
    last_sql = session.history[-1]["sql"]
    df = session.con.execute(last_sql).fetchdf()
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=export.xlsx"},
    )

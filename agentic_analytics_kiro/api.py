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
import datetime
import decimal
import numpy as np
import duckdb
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

# Add current dir to path so sibling modules resolve
sys.path.insert(0, os.path.dirname(__file__))

from config import LLM_URL, LLM_MODEL, CACHE_TTL
from predictor import predict_series, infer_date_column, infer_measure_column
from loader import (
    load_files, schema_summary, rich_schema_summary, profile_tables,
    pick_default_columns, supported_formats, dataset_summary,
)
from analytical_context import (
    derive_context, describe_context, summarize_result, empty_context,
)
from anomaly import detect_anomalies, describe_anomalies
from crossdataset import (
    infer_relationships, describe_relationships, plan_correlation,
    correlation_sql, correlate, describe_correlation,
)
from dateutil import parser as date_parser
from difflib import SequenceMatcher

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
        if isinstance(obj, (pd.Timestamp, datetime.date, datetime.datetime)):
            return obj.isoformat()
        if isinstance(obj, decimal.Decimal):
            return float(obj)
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
        # Profiling result, computed once per set of loaded tables and reused
        # by /upload, /profile and the fallback SQL path. Invalidated (set to
        # None) whenever new files land, so it can never describe stale tables.
        self.profile: dict | None = None
        # Candidate joins between this session's tables (plan §16), computed
        # from the profile and invalidated with it. An empty list is a real
        # answer ("these tables don't appear to relate"); None means not yet
        # looked at.
        self.relationships: list[dict] | None = None
        # Structured analytical state (plan §11): what the last turn measured,
        # broken down by what, filtered how, over which period — derived from
        # the SQL that ran. Read back by the UI's context strip and fed into
        # the next turn's SQL prompt as facts rather than prose. None until a
        # turn has run.
        self.context: dict | None = None

_sessions: dict[str, Session] = {}

def get_session(sid: str) -> Session:
    if sid not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return _sessions[sid]


def _ensure_profile(session: Session) -> dict:
    """Profile the session's tables, reusing the cached result when the tables
    haven't changed since it was computed."""
    if session.profile is None:
        session.profile = profile_tables(session.tables, session.con)
    return session.profile


def _ensure_relationships(session: Session) -> list[dict]:
    """Candidate joins between the session's tables, computed once per set of
    loaded tables. A single-table session has none by definition."""
    if session.relationships is None:
        if len(session.tables) < 2:
            session.relationships = []
        else:
            try:
                session.relationships = infer_relationships(
                    session.tables, session.con, _ensure_profile(session)
                )
            except Exception:
                # Relationship inference is an aid to the SQL prompt, not part
                # of any answer — a failure costs the hints, not the turn.
                session.relationships = []
    return session.relationships

# ── Helpers (ported from app.py) ──────────────────────────────────────────────

# Typo correction, derived from the session's own schema (plan §1, §15).
#
# The legacy path used a fixed dictionary of sales-domain misspellings
# ("revnue" -> "revenue", "departmnt" -> "department"). That is a column-name
# literal assumption in the live /query path: it is useless on a dataset with
# no such columns, and actively wrong on one where "revnue" is a real column
# name. Instead, a token is only rewritten when it is a near-miss for a table
# or column name this session actually loaded.

# Below this ratio the "correction" is a different word, not a typo. 0.82 keeps
# one-or-two-character slips on words of ordinary length and rejects the rest.
_MIN_TYPO_SIMILARITY = 0.82

# Short tokens are excluded: at 3 characters or fewer, almost every edit turns
# one real word into another ("sum" -> "sun", "id" -> "in").
_MIN_TYPO_LEN = 4

_WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _schema_vocabulary(session: "Session") -> list[str]:
    """Every table and column name this session actually holds."""
    vocab: list[str] = []
    for tname, cols in session.tables.items():
        vocab.append(tname)
        vocab.extend(cols)
    if session.unified:
        vocab.append(session.unified)
    return vocab


def _normalize(query: str, session: "Session | None" = None) -> str:
    """Rewrite near-miss tokens toward real schema names, leaving everything
    else — including the caller's capitalisation — exactly as typed.

    Without a session there is no vocabulary to correct against, so the query
    is returned unchanged rather than run through a guess."""
    if session is None:
        return query

    vocab = _schema_vocabulary(session)
    if not vocab:
        return query

    # Exact matches (case-insensitive) are already correct; never "fix" a token
    # that names something real.
    exact = {name.lower() for name in vocab}

    def fix(match: re.Match) -> str:
        token = match.group()
        lowered = token.lower()
        if len(token) < _MIN_TYPO_LEN or lowered in exact:
            return token
        best, best_score = None, _MIN_TYPO_SIMILARITY
        for name in vocab:
            score = SequenceMatcher(None, lowered, name.lower()).ratio()
            if score > best_score:
                best, best_score = name, score
        return best if best is not None else token

    return _WORD_RE.sub(fix, query)

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
    # Cross-dataset comparison (plan §16). Checked before "insight" because
    # "why did spend affect signups" is a correlation question first and a
    # narrative second — but only ever on a session holding more than one
    # table, since these words are ordinary analysis language otherwise.
    "correlate": ["correlat", "affect", "impact", "driven by", "drive",
                  "relationship between", "related to", "move with",
                  "compare " ],
    "insight": ["insight", "analyze", "why", "explain"],
}

def _detect_intent(query: str, table_count: int = 1) -> str:
    q = query.lower()
    for intent, kws in _INTENT_KEYWORDS.items():
        if intent == "correlate" and table_count < 2:
            continue
        if any(k in q for k in kws):
            return intent
    return "data"

_SQL_FENCE_RE = re.compile(r"```sql|```", re.IGNORECASE)
_SQL_EXTRACT_RE = re.compile(r"(SELECT\b.*?;|SELECT\b.*)", re.DOTALL | re.IGNORECASE)

def _extract_sql(text: str) -> str:
    text = _SQL_FENCE_RE.sub("", text)
    m = _SQL_EXTRACT_RE.search(text)
    return m.group(1).strip() if m else ""

def _tables_used(sql: str, session: Session) -> list[str]:
    """Which of the session's known tables (and unified view) this SQL names.
    Matched against real table names — never a hardcoded one."""
    names = list(session.tables) + ([session.unified] if session.unified else [])
    used = []
    for name in names:
        # Optional quotes on either side, so a quoted "table" matches too.
        if re.search(rf'(^|[^\w"])"?{re.escape(name)}"?($|[^\w"])', sql, re.IGNORECASE):
            used.append(name)
    return used


# Statements that change data or the database, rejected before DuckDB sees
# them. The read-only check can't be "starts with SELECT" alone: a CTE query
# starts with WITH, and the correlation planner (plan §16) builds one, as does
# any model answer that names an intermediate result.
_WRITE_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|ATTACH|DETACH|"
    r"COPY|EXPORT|IMPORT|INSTALL|LOAD|PRAGMA|SET|CALL)\b",
    re.IGNORECASE,
)


def _validate_sql(sql: str, session: Session) -> tuple[bool, str]:
    """Validate by doing a DuckDB dry-run (EXPLAIN). Catches real errors, not fake ones."""
    head = (sql or "").strip().upper()
    if not head.startswith(("SELECT", "WITH")):
        return False, "Not a SELECT statement"
    if _WRITE_RE.search(sql):
        return False, "Only read-only queries are allowed"
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

    # Candidate joins between the session's tables (plan §16). Without this the
    # model sees several unrelated schemas and has no way to know which columns
    # line up, so a cross-dataset question gets a single-table answer or an
    # invented join. Stated as candidates with their evidence — a join it is
    # told about but shouldn't use is still its call.
    joins = describe_relationships(_ensure_relationships(session))
    join_block = f"""
CANDIDATE JOINS BETWEEN TABLES (measured from shared values, not declared keys —
use one only if the question actually spans those tables):
{joins}
""" if joins else ""

    # The previous turn's state, stated explicitly (plan §11). A follow-up
    # ("only California", "same thing for last year") usually *modifies* this
    # rather than replacing it, and saying so beats hoping the model re-derives
    # it from the SQL text in the history above.
    state = describe_context(session.context)
    state_block = f"""
CURRENT ANALYTICAL STATE (what the previous answer showed — a follow-up most
likely adjusts one part of this and keeps the rest):
{state}
""" if state else ""

    prompt = f"""You are a DuckDB SQL expert. Generate a single accurate SQL query.

SCHEMA (table name, columns, types, sample values):
{schema}
DEFAULT TABLE: {default_table}
{join_block}
RULES:
- Output ONLY the raw SQL query — no explanation, no markdown, no code fences
- Use exact column and table names from the schema above
- Use DuckDB syntax (e.g. DATE_TRUNC, STRFTIME, EPOCH, INTERVAL)
- For date filtering use the actual date column type shown in schema
- For string filters use ILIKE for case-insensitive matching
- Always include ORDER BY for top-N queries
- Use LIMIT 200 unless the user specifies a different number
- Query one table unless the question spans several; if it does, join them on a
  candidate join above rather than guessing a key

CONVERSATION HISTORY:
{history}
{state_block}

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
    picks = pick_default_columns(session.tables, session.con, tname, profile=_ensure_profile(session))
    measure, dimension = picks["measure"], picks["dimension"]
    if measure and dimension:
        return f'SELECT "{dimension}", SUM("{measure}") AS "{measure}" FROM {tname} GROUP BY "{dimension}"'
    return f"SELECT * FROM {tname} LIMIT 50"

def _get_cached(session: Session, sql: str) -> pd.DataFrame | None:
    entry = session.cache.get(sql)
    if entry and time.time() - entry[1] < CACHE_TTL:
        return entry[0]
    return None

def _enrich(df: pd.DataFrame) -> pd.DataFrame:
    date_col = infer_date_column(df)
    measure_col = infer_measure_column(df, exclude=date_col)
    if date_col and measure_col:
        df = df.copy()
        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df = df.sort_values(date_col)
        df["moving_avg"] = df[measure_col].rolling(7).mean()
        df.attrs["measure_col"] = measure_col
        df.attrs["date_col"] = date_col
    return df

def _trend(df: pd.DataFrame) -> str:
    if "moving_avg" in df.columns:
        d = df["moving_avg"].diff().mean()
        return "increasing 📈" if d > 0 else ("decreasing 📉" if d < 0 else "stable ➡️")
    return "unknown"

def _anomalies(df: pd.DataFrame) -> dict:
    """Robust, two-sided anomaly detection (plan §16).

    The old rule — rows more than two standard deviations above the mean — used
    statistics the outliers themselves move, flagged ~5% of any normal series by
    construction, and never looked at the low side. `anomaly.detect_anomalies`
    scores against the median/MAD, seasonally adjusted where the series
    supports it, and returns the points it found rather than a printed frame.
    """
    return detect_anomalies(
        df,
        measure_col=df.attrs.get("measure_col"),
        date_col=df.attrs.get("date_col"),
    )

def _insights(df: pd.DataFrame, query: str) -> tuple[str, dict | None]:
    """The analyst narrative, plus the structured anomalies it was built from.

    Both are returned so the UI can show what was actually detected next to the
    prose, instead of taking the model's word for which points were unusual.
    """
    if df.empty:
        return "No data.", None
    df = _enrich(df)
    found = _anomalies(df)
    prompt = (
        f"You are a senior business analyst.\nUser Question: {query}\n"
        f"Trend: {_trend(df)}\nAnomalies: {describe_anomalies(found)}\n"
        f"Data:\n{df.head(10).to_string(index=False)}\n\n"
        f"Only discuss anomalies listed above; if there are none, say so.\n\n"
        f"Answer:\n1. WHAT HAPPENED\n2. WHY IT HAPPENED\n3. WHAT TO DO NEXT"
    )
    return _llm(prompt), found

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/formats")
def get_formats():
    """
    File extensions the loader can actually ingest. The UI reads its
    upload-target format list from here rather than hardcoding one, so the
    two can never drift apart (plan §6).
    """
    return {"formats": supported_formats()}


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
        session.profile = None  # new tables — any cached profile is now stale
        session.relationships = None  # …and so are the joins derived from it

        schema = {t: cols for t, cols in session.tables.items()}
        sample = result["sample"].to_dict(orient="records")

        # Row/column counts and date span come back with the upload itself
        # (plan §9.4) so the UI never has to infer the shape of the dataset
        # from the 5-row sample above. Best-effort: a profiling failure costs
        # the summary, not the upload.
        try:
            summary = dataset_summary(_ensure_profile(session))
        except Exception:
            summary = None

        return _json({
            "tables": schema,
            "unified": session.unified,
            "sample": sample,
            "summary": summary,
            "files_loaded": [f.filename for f in files],
        })
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.get("/session/{sid}/schema")
def get_schema(sid: str):
    session = get_session(sid)
    return {"tables": session.tables, "unified": session.unified}


@app.get("/session/{sid}/profile")
def get_profile(sid: str):
    session = get_session(sid)
    if not session.tables:
        raise HTTPException(status_code=400, detail="No data loaded. Upload files first.")
    profile = _ensure_profile(session)
    return _json({
        "tables": profile,
        "unified": session.unified,
        # The same structured summary the upload response carries, so both
        # entry points describe the dataset identically (plan §9.4).
        "summary": dataset_summary(profile),
    })


@app.get("/session/{sid}/relationships")
def get_relationships(sid: str):
    """Candidate joins between the session's tables (plan §16).

    Served separately from /profile because it is about the dataset *set*, not
    any one table: a single-table session gets an empty list, which is a real
    answer rather than an error. Every record carries the counts it was derived
    from, so the UI can present a candidate as a candidate."""
    session = get_session(sid)
    if not session.tables:
        raise HTTPException(status_code=400, detail="No data loaded. Upload files first.")
    return _json({
        "relationships": _ensure_relationships(session),
        "tables": list(session.tables),
    })


@app.get("/session/{sid}/context")
def get_context(sid: str):
    """The session's current analytical state (plan §11). The same object the
    last `/query` returned — served separately so the UI can restore the strip
    without replaying the conversation. Before the first turn it is the empty
    context, not an error: "nothing is being analysed yet" is a real state."""
    session = get_session(sid)
    return _json({"context": session.context or empty_context(sid)})


class QueryRequest(BaseModel):
    query: str


# ── One conversational turn, as a sequence of real steps ──────────────────────
#
# The pipeline is written as a generator so the same code can serve both
# transports (plan §10): `/query` drains it and returns only the final payload,
# `/query/stream` forwards each step as an SSE event as it actually completes.
# Every event corresponds to backend work that just finished — nothing is
# emitted to fill silence.
#
# Event set, deliberately kept to the minimal one in §10:
#   PROFILE_STARTED / PROFILE_COMPLETED  — only when this turn had to profile
#   SQL_GENERATED / SQL_VALIDATED
#   QUERY_EXECUTED
#   INVESTIGATION_STEP                   — generic, carries a label
#   RESPONSE_READY
# plus ERROR, which the stream needs because a failure after the response has
# started can no longer be reported as an HTTP status.

def _query_pipeline(session: Session, raw_query: str, session_id: str | None = None):
    """Yield (event, payload) as each step of one turn completes; the last
    event is always RESPONSE_READY carrying the same dict `/query` returns."""
    started = time.perf_counter()
    query = _normalize_dates(_normalize(raw_query, session))
    intent = _detect_intent(query, table_count=len(session.tables))

    # Profiling is normally already done at upload time; it only runs here when
    # a code path below is the first to need it, and only then is it announced.
    if session.profile is None:
        yield "PROFILE_STARTED", {}
        _ensure_profile(session)
        # `profile` is keyed by table name (the shape /profile returns under
        # "tables"), so the names are its keys.
        yield "PROFILE_COMPLETED", {"tables": list(session.profile)}

    # A correlation turn doesn't ask the model for SQL. The alignment — both
    # measures bucketed onto one calendar grain and joined on it — is built
    # here (plan §16) so the join behind the coefficient is exactly the one
    # reported, and so the rows are ordinary result rows the user can read,
    # chart and export.
    correlation_plan = None
    if intent == "correlate":
        yield "INVESTIGATION_STEP", {"label": "Looking for two measures to align across tables"}
        correlation_plan = plan_correlation(query, session.tables, session.con,
                                            _ensure_profile(session))

    if correlation_plan and correlation_plan["ok"]:
        sql = correlation_sql(correlation_plan)
    else:
        if correlation_plan:
            # Planning failed for a stated reason; the turn continues as an
            # ordinary question so the user still gets rows, and the reason
            # travels with the response rather than being swallowed.
            yield "INVESTIGATION_STEP", {"label": "No alignable pair found — answering as a single-table question"}
        sql = _generate_sql(query, session)
    yield "SQL_GENERATED", {"sql": sql, "intent": intent}

    valid, msg = _validate_sql(sql, session)

    # How the SQL that ran was arrived at, reported to the UI rather than left
    # for it to guess (plan §9.4): validated first try, repaired after N fix
    # attempts, or abandoned for the schema-driven fallback.
    fix_attempts = 0
    for _ in range(2):
        if valid:
            break
        fix_attempts += 1
        yield "INVESTIGATION_STEP", {"label": f"Repairing SQL after a validation error (attempt {fix_attempts})"}
        sql = _fix_sql(sql, session, msg)
        valid, msg = _validate_sql(sql, session)

    if valid and correlation_plan and correlation_plan["ok"] and not fix_attempts:
        # Not model output, so "validated on first attempt" would understate
        # where it came from.
        validation = {"status": "planned", "fix_attempts": 0, "error": None}
    elif valid:
        validation = {
            "status": "repaired" if fix_attempts else "valid",
            "fix_attempts": fix_attempts,
            "error": None,
        }
    else:
        # The generated SQL never validated; the fallback is schema-driven and
        # answers a different question, so the UI is told plainly.
        validation = {"status": "fallback", "fix_attempts": fix_attempts, "error": msg}
        sql = _fallback_sql(session)

    yield "SQL_VALIDATED", {"sql": sql, "validation": validation}

    result_df = _get_cached(session, sql)
    cached = result_df is not None
    if result_df is None:
        try:
            result_df = session.con.execute(sql).fetchdf()
            session.cache[sql] = (result_df, time.time())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Query failed: {e}")

    yield "QUERY_EXECUTED", {
        "total_rows": len(result_df),
        "cached": cached,
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
    }

    # Structured state for this turn, derived from the SQL DuckDB actually ran
    # (plan §11). Stored on the session for the next turn's prompt and kept on
    # the history entry alongside the raw SQL/text, so a turn's state can still
    # be read after later turns have moved the session's state on (§9.5).
    try:
        context = derive_context(sql, session.con, session.profile, raw_query, dataset_id=session_id)
        context["last_finding_summary"] = summarize_result(result_df, context)
    except Exception:
        # The state is an aid to the next turn, not this turn's answer — the
        # user keeps their result and the strip simply shows nothing resolved.
        context = empty_context(session_id, raw_query)
    session.context = context

    session.history.append({
        "query": query,
        "sql": sql,
        "result_summary": result_df.head(3).to_string(index=False),
        "context": context,
    })

    response: dict = {
        "intent": intent,
        "sql": sql,
        "rows": result_df.head(200).to_dict(orient="records"),
        "columns": list(result_df.columns),
        "total_rows": len(result_df),
        # Execution detail for the technical drawer (plan §8, §9.4), measured
        # server-side instead of re-derived from the SQL text by the client.
        "tables_used": _tables_used(sql, session),
        "validation": validation,
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        # The session's analytical state after this turn, so the UI's context
        # strip updates from the answer itself rather than a second round trip.
        "context": context,
    }

    if intent == "predict":
        yield "INVESTIGATION_STEP", {"label": "Fitting and scoring candidate forecast models"}
        pred = predict_series(result_df)
        response["forecast"] = pred["frame"].to_dict(orient="records") if pred else None
        # How the forecast was arrived at (plan §16): which of the candidate
        # models won on held-out data, whether it beat a seasonal-naive
        # baseline, what the band around it means, and how far apart the
        # forecast steps are. Null when no forecast could be fitted, so the UI
        # never describes a model that didn't run.
        response["forecast_meta"] = (
            {k: v for k, v in pred.items() if k != "frame"} if pred else None
        )

    if intent == "insight":
        yield "INVESTIGATION_STEP", {"label": "Summarising trends and anomalies"}
        response["insights"], response["anomalies"] = _insights(result_df, query)

    if intent == "correlate":
        if correlation_plan and correlation_plan["ok"]:
            yield "INVESTIGATION_STEP", {"label": "Measuring how the two aligned series move together"}
            result = correlate(result_df, correlation_plan)
            response["text"] = describe_correlation(result)
        else:
            # Nothing was correlated, and the response says why rather than
            # leaving a correlation question quietly answered by one table.
            reason = (correlation_plan or {}).get("reason", "no alignable pair of measures.")
            result = {"available": False, "reason": reason}
            response["text"] = (
                f"No correlation could be computed: {reason} The rows below "
                "answer the question as an ordinary single-table query."
            )
        response["correlation"] = result

    response["duration_ms"] = round((time.perf_counter() - started) * 1000, 1)
    yield "RESPONSE_READY", {"response": response}


def _export_xlsx(session: Session, sql: str) -> StreamingResponse:
    df = _get_cached(session, sql)
    if df is None:
        df = session.con.execute(sql).fetchdf()
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=export.xlsx"},
    )


@app.post("/session/{sid}/query")
def run_query(sid: str, body: QueryRequest):
    session = get_session(sid)
    if not session.tables:
        raise HTTPException(status_code=400, detail="No data loaded. Upload files first.")

    # Same pipeline as the streaming endpoint, drained to its final event: this
    # endpoint's contract is unchanged, the intermediate steps are simply not
    # observable over a single blocking request (plan §10).
    response = None
    for event, payload in _query_pipeline(session, body.query, sid):
        if event == "RESPONSE_READY":
            response = payload["response"]

    if response["intent"] == "export":
        return _export_xlsx(session, response["sql"])

    return _json(response)


def _sse(event: str, payload: dict) -> str:
    """One SSE frame. Payload goes through the same encoder as every JSON
    response so timestamps/decimals/NaN survive the trip identically."""
    data = json.dumps(payload, cls=_Encoder)
    return f"event: {event}\ndata: {data}\n\n"


@app.post("/session/{sid}/query/stream")
def run_query_stream(sid: str, body: QueryRequest):
    """SSE variant of `/query` (plan §9.6, §10). Emits the minimal event set as
    each step completes; `/query` stays available unchanged for callers that
    only want the answer."""
    session = get_session(sid)
    if not session.tables:
        raise HTTPException(status_code=400, detail="No data loaded. Upload files first.")

    def stream():
        try:
            for event, payload in _query_pipeline(session, body.query, sid):
                if event == "RESPONSE_READY":
                    response = payload["response"]
                    # An .xlsx body can't travel down an event stream, so the
                    # export intent is reported and the client fetches the file
                    # from /export — the SQL it exports is this turn's, which
                    # /export re-runs as the session's last query.
                    if response["intent"] == "export":
                        response = {**response, "export_ready": True}
                    yield _sse(event, {"response": response})
                else:
                    yield _sse(event, payload)
        except HTTPException as e:
            # The stream's status line is already sent, so a mid-turn failure is
            # reported in-band rather than as an HTTP error the client can see.
            yield _sse("ERROR", {"detail": e.detail, "status": e.status_code})
        except Exception as e:
            yield _sse("ERROR", {"detail": str(e), "status": 500})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Proxies (including the Vite dev proxy's upstreams) otherwise
            # buffer the body and defeat the point of streaming.
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/session/{sid}/export")
def export_last(sid: str):
    session = get_session(sid)
    if not session.history:
        raise HTTPException(status_code=400, detail="No query run yet.")
    return _export_xlsx(session, session.history[-1]["sql"])

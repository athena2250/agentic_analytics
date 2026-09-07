# Quantara — Postgres persistence layer

DuckDB stays the analytics engine and holds the user's rows. Postgres holds the
metadata around it: what a session is, what was uploaded, what the profiler
found, what was asked, and what SQL came back. This closes the gap in
`plan.md` §2/§16 — sessions currently live in a process-local dict in `api.py`
and vanish on restart.

## Connection

| | |
|---|---|
| Host / Port | `localhost` / `5432` |
| Database | `quantara` |
| User | `rithvikat` (superuser, local trust auth — no password) |
| Schema | `app` |

## Applying migrations

```bash
psql -h localhost -p 5432 -d quantara -v ON_ERROR_STOP=1 -f db/001_init.sql
```

All migrations are idempotent and wrapped in a transaction, so re-running is
safe. Applied versions are recorded in `app.schema_migrations`.

## Tables

| Table | Holds | Maps to |
|---|---|---|
| `sessions` | one row per backend session; `id` is the uuid `POST /session` already returns | `api.Session` |
| `datasets` | analytical context inside a session — 1:1 today, modelled separately so §16's multi-dataset work needs no reshape | — |
| `dataset_files` | every uploaded file + its load outcome | `api.upload_files` (currently deletes its temp dir and keeps no record) |
| `dataset_tables` | the DuckDB tables the loader registered; `is_unified` marks the UNION ALL view | `Session.tables`, `Session.unified` |
| `dataset_columns` | per-column profile + the user-editable `semantic_label` | `loader.profile_tables()` |
| `queries` | one row per `/query` call, including retry count, fallback, latency | `Session.history` (which keeps only 3 turns of text) |
| `messages` | the rendered conversation the frontend restores | frontend `session.messages` |
| `session_overview` | view: session list with table/row/query counts | sidebar |

## Design notes

- **No domain assumptions.** Column names, types, and roles are stored as
  *rows* in `dataset_columns`, never as columns of their own. `plan.md` §1's
  core principle applied to the database itself.
- **Enums mirror the Python.** `column_role` matches
  `loader._classify_column()`'s return values; `query_intent` matches
  `api._detect_intent()`. Adding a value there means an `ALTER TYPE` here.
- **`min_value`/`max_value` are `text`** because the profiler runs `MIN()`/`MAX()`
  over columns of any type. `dtype` tells you how to read them.
- **`queries` records the invisible parts** — `fix_attempts`, `used_fallback`,
  `latency_ms`. Those are what separate "the model is degrading" from "this
  dataset is unusual", and nothing captures them today.
- **`sessions.duckdb_path`** is the hook that makes persistence real:
  `duckdb.connect()` with no argument opens an in-memory DB, so loaded tables
  die with the process. Pointing it at a per-session file makes them outlive it.

## Not yet wired up

`001_init.sql` creates the schema. `api.py` does not write to it yet — that is
the next step (a `db.py` with a connection pool, plus writes at session
create / upload / query).

-- ============================================================================
-- Quantara — app persistence layer (migration 001)
--
-- Scope: everything that must survive a backend restart. Today api.py keeps
-- sessions in a process-local dict (`_sessions`), so a restart destroys all
-- sessions, schemas, and history (plan.md §2, §16).
--
-- Division of labour, deliberately:
--   DuckDB   = the analytical engine. Holds the user's actual rows.
--   Postgres = the metadata around it. Sessions, what was uploaded, what the
--              profiler found, what was asked, what SQL was generated.
--
-- Nothing here encodes a user's domain. Column names, types, and roles are
-- stored as *data* (rows in dataset_columns), never as columns of their own —
-- this is plan.md §1's "no assumed schema" principle applied to the DB itself.
--
-- Run against: database `quantara`
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path TO app, public;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()


-- ── Migration bookkeeping ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text        PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);


-- ── Enumerated domains ──────────────────────────────────────────────────────
-- Closed sets that already exist in the Python code. Kept as enums so DBeaver
-- shows the legal values and the DB rejects typos.

DO $$ BEGIN
    -- loader._classify_column() return values
    CREATE TYPE column_role AS ENUM ('measure', 'dimension', 'date', 'identifier', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    -- api._detect_intent() return values
    CREATE TYPE query_intent AS ENUM ('data', 'predict', 'insight', 'export');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE load_status AS ENUM ('pending', 'loaded', 'skipped', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── updated_at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── sessions ────────────────────────────────────────────────────────────────
-- One row per api.py Session. `id` is the uuid already returned by
-- POST /session, so the existing frontend contract does not change.
--
-- duckdb_path is the move that makes persistence real: today
-- `duckdb.connect()` opens an in-memory DB. Pointing it at a file per session
-- lets the loaded tables outlive the process too.

CREATE TABLE IF NOT EXISTS sessions (
    id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text           NOT NULL DEFAULT 'New session',
    status         session_status NOT NULL DEFAULT 'active',
    duckdb_path    text,
    unified_view   text,          -- loader._build_unified_view() result, e.g. 'all_data'
    created_at     timestamptz    NOT NULL DEFAULT now(),
    updated_at     timestamptz    NOT NULL DEFAULT now(),
    last_active_at timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_status_last_active_idx
    ON sessions (status, last_active_at DESC);

DROP TRIGGER IF EXISTS sessions_set_updated_at ON sessions;
CREATE TRIGGER sessions_set_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── datasets ────────────────────────────────────────────────────────────────
-- A coherent analytical context within a session. plan.md §5 keeps this 1:1
-- with a session for the MVP, but models it separately so a second dataset can
-- be attached later (§16) without a migration that reshapes sessions.

CREATE TABLE IF NOT EXISTS datasets (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name       text        NOT NULL DEFAULT 'Dataset',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS datasets_session_idx ON datasets (session_id);

DROP TRIGGER IF EXISTS datasets_set_updated_at ON datasets;
CREATE TRIGGER datasets_set_updated_at
    BEFORE UPDATE ON datasets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── dataset_files ───────────────────────────────────────────────────────────
-- One row per uploaded file. api.upload_files() currently writes to a temp dir
-- and deletes it in a finally block, so there is no record of what was ingested
-- once the request ends. stored_path is for when uploads move to durable
-- storage; it stays NULL while the temp-dir behaviour remains.
--
-- load_status/load_error capture the outcomes loader.load_files() prints to
-- stdout today ("Unsupported format, skipping", "Failed to load") and then
-- discards.

CREATE TABLE IF NOT EXISTS dataset_files (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id  uuid        NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    filename    text        NOT NULL,
    extension   text,                        -- '.csv', '.parquet', … lowercased
    byte_size   bigint      CHECK (byte_size IS NULL OR byte_size >= 0),
    checksum    text,                        -- sha256, for dedupe / re-upload detection
    stored_path text,
    status      load_status NOT NULL DEFAULT 'pending',
    error       text,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dataset_files_dataset_idx ON dataset_files (dataset_id);


-- ── dataset_tables ──────────────────────────────────────────────────────────
-- The DuckDB tables loader.load_files() registered. Mirrors the keys of
-- Session.tables. is_unified marks the UNION ALL view (Session.unified).
--
-- One file can produce many tables (an Excel workbook becomes one table per
-- sheet), hence the FK to dataset_files rather than the other way round.

CREATE TABLE IF NOT EXISTS dataset_tables (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id     uuid        NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    source_file_id uuid        REFERENCES dataset_files(id) ON DELETE SET NULL,
    table_name     text        NOT NULL,     -- loader._safe_table_name() output
    sheet_name     text,                     -- Excel only; NULL otherwise
    is_unified     boolean     NOT NULL DEFAULT false,
    row_count      bigint      CHECK (row_count IS NULL OR row_count >= 0),
    column_count   integer     CHECK (column_count IS NULL OR column_count >= 0),
    profiled_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dataset_tables_unique_name UNIQUE (dataset_id, table_name)
);

CREATE INDEX IF NOT EXISTS dataset_tables_dataset_idx ON dataset_tables (dataset_id);

-- At most one unified view per dataset.
CREATE UNIQUE INDEX IF NOT EXISTS dataset_tables_one_unified_idx
    ON dataset_tables (dataset_id) WHERE is_unified;


-- ── dataset_columns ─────────────────────────────────────────────────────────
-- The output of loader.profile_tables(), which is recomputed from scratch on
-- every GET /session/{sid}/profile call today. Persisting it makes the profile
-- survive a restart and gives the semantic layer (plan.md §16) somewhere to
-- live: semantic_label is the user-editable "this column means revenue" that
-- the classifier cannot infer.
--
-- min/max are text because the profiler runs MIN()/MAX() over columns of any
-- type — a numeric column and a date column both land here. Keep the raw
-- rendering; dtype tells you how to read it.

CREATE TABLE IF NOT EXISTS dataset_columns (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id        uuid        NOT NULL REFERENCES dataset_tables(id) ON DELETE CASCADE,
    ordinal         integer     NOT NULL,    -- position in DESCRIBE output, 0-based
    name            text        NOT NULL,
    dtype           text        NOT NULL,    -- DuckDB type string, e.g. 'VARCHAR', 'BIGINT'
    null_pct        numeric(5,2) CHECK (null_pct IS NULL OR null_pct BETWEEN 0 AND 100),
    distinct_count  bigint      CHECK (distinct_count IS NULL OR distinct_count >= 0),
    min_value       text,
    max_value       text,
    sample_values   jsonb       NOT NULL DEFAULT '[]'::jsonb,
    role            column_role NOT NULL DEFAULT 'unknown',
    role_confidence numeric(3,2) CHECK (role_confidence IS NULL OR role_confidence BETWEEN 0 AND 1),
    semantic_label  text,                    -- user-supplied meaning; overrides `role` in the UI
    CONSTRAINT dataset_columns_unique_name UNIQUE (table_id, name)
);

CREATE INDEX IF NOT EXISTS dataset_columns_table_idx ON dataset_columns (table_id, ordinal);
CREATE INDEX IF NOT EXISTS dataset_columns_role_idx  ON dataset_columns (role);


-- ── queries ─────────────────────────────────────────────────────────────────
-- One row per POST /session/{sid}/query. Session.history keeps only
-- {query, sql, result_summary} for the last few turns as LLM prompt fodder;
-- this records the whole attempt, including the parts that are currently
-- invisible — how many _fix_sql retries it took, whether _fallback_sql fired,
-- how long the LLM round-trip cost. Those are the numbers you need to tell
-- "the model is getting worse" from "this dataset is unusual".

CREATE TABLE IF NOT EXISTS queries (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id     uuid         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    dataset_id     uuid         REFERENCES datasets(id) ON DELETE SET NULL,
    turn_index     integer      NOT NULL,    -- position in the conversation, 0-based
    raw_query      text         NOT NULL,    -- exactly what the user typed
    normalized_query text,                   -- after _normalize + _normalize_dates
    intent         query_intent NOT NULL DEFAULT 'data',
    generated_sql  text,
    sql_valid      boolean,
    fix_attempts   smallint     NOT NULL DEFAULT 0 CHECK (fix_attempts >= 0),
    used_fallback  boolean      NOT NULL DEFAULT false,
    cache_hit      boolean      NOT NULL DEFAULT false,
    result_columns jsonb,                    -- ["col_a", "col_b"]
    row_count      integer      CHECK (row_count IS NULL OR row_count >= 0),
    error          text,
    latency_ms     integer      CHECK (latency_ms IS NULL OR latency_ms >= 0),
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT queries_unique_turn UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS queries_session_created_idx ON queries (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS queries_intent_idx          ON queries (intent);
-- Partial index: failures are the rows you actually go looking for.
CREATE INDEX IF NOT EXISTS queries_failed_idx
    ON queries (created_at DESC) WHERE error IS NOT NULL OR used_fallback;


-- ── messages ────────────────────────────────────────────────────────────────
-- The rendered conversation, which is what the frontend needs to restore a
-- chat. Kept separate from `queries` because they are not 1:1: a user turn
-- produces a user message and an assistant message but only one query row,
-- and some assistant messages (upload confirmations, errors) have no query.

CREATE TABLE IF NOT EXISTS messages (
    id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    query_id   uuid         REFERENCES queries(id) ON DELETE SET NULL,
    seq        integer      NOT NULL,        -- render order within the session
    role       message_role NOT NULL,
    content    text         NOT NULL DEFAULT '',
    payload    jsonb,                        -- rows/forecast/insights blob the UI renders
    created_at timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT messages_unique_seq UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS messages_session_seq_idx ON messages (session_id, seq);


-- ── Convenience view ────────────────────────────────────────────────────────
-- What the sidebar needs to render the session list without N+1 queries.

CREATE OR REPLACE VIEW session_overview AS
SELECT
    s.id,
    s.name,
    s.status,
    s.created_at,
    s.last_active_at,
    d.id                                  AS dataset_id,
    count(DISTINCT t.id)                  AS table_count,
    coalesce(sum(t.row_count), 0)         AS total_rows,
    count(DISTINCT q.id)                  AS query_count,
    count(DISTINCT q.id) FILTER (WHERE q.error IS NOT NULL OR q.used_fallback)
                                          AS degraded_query_count
FROM sessions s
LEFT JOIN datasets       d ON d.session_id = s.id
LEFT JOIN dataset_tables t ON t.dataset_id = d.id AND NOT t.is_unified
LEFT JOIN queries        q ON q.session_id = s.id
GROUP BY s.id, s.name, s.status, s.created_at, s.last_active_at, d.id;


INSERT INTO schema_migrations (version) VALUES ('001_init')
ON CONFLICT (version) DO NOTHING;

COMMIT;

# Quantara AI UI Implementation Plan

## 1. Product Principles

**The core, non-negotiable principle: Quantara must not assume any dataset, schema, domain, or column names in advance.** Every part of the architecture — ingestion, profiling, SQL generation, metrics, forecasting, and the UI itself — must treat the dataset as a **runtime input**, discovered fresh each session.

Corollaries that follow from this and are used as review criteria throughout this plan:

- No code path may reference a fixed column name (`revenue`, `date`, `department`, `cost`, `customer_id`, `units`) as if it universally exists. Any such reference found in the current backend is classified as **technical debt to remove**, not a pattern to extend.
- "Understanding" a dataset is a discovery step (profiling + schema introspection + optional LLM-assisted semantic labeling) that produces structured, inspectable output — not a hardcoded mapping.
- Where the system can't confidently infer a concept (e.g., "which column is the primary date field?") it should surface that uncertainty to the user/LLM rather than silently guessing via a fixed name.
- A session owns exactly one analytical context (currently: one dataset's tables + schema + conversation). Nothing about the architecture should make it structurally hard to attach a second dataset to a session later (see §5, §16).
- The UI must never be built assuming specific columns exist. Components render whatever the schema/profile says is there.

## 2. Current Architecture (audit findings)

**Two parallel implementations exist. Only one is live.**

- Root-level files (`agent.py`, `predictor.py`, `planner.py`, `metrics.py`, `prompt.py`, `schema.py`, `semantic_validator.py`, `excel_writer.py`) at the repo root are an **earlier/stale prototype**. Nothing under `agentic_analytics_kiro/` imports them. They are dead code from the perspective of the live app. (306 lines total, no tests reference them either.)
- `agentic_analytics_kiro/` is the real, live implementation:
  - `api.py` — **canonical backend entrypoint**, a FastAPI app (`uvicorn api:app`). This is what the frontend actually talks to.
  - `app.py` — a **separate CLI tool** (`python app.py`, `input()`-driven loop). It duplicates most of `api.py`'s logic (normalization, SQL gen, intent detection) almost line-for-line, and additionally imports `agent.py`, `planner.py`, `metrics.py`, `semantic_validator.py` from the repo root (via `sys.path` not being needed since it's a sibling import — actually these are root-level files pulled in when running from repo root; confirm on Phase 0). This CLI is not used by the web app and should be left alone/untouched, treated as a separate maintenance surface.
  - `loader.py` — dynamic multi-format file loader into DuckDB. Used by both `api.py` and `app.py`. This is the best-designed dataset-agnostic piece in the codebase already.
  - `predictor.py` (inside `agentic_analytics_kiro/`) — forecasting via `LinearRegression`, imported by `api.py`. **Hardcodes `date` and `revenue` column names.**
  - `config.py` — small config: spell corrections, LLM URL/model (Ollama, `llama3`, `http://localhost:11434`), cache TTL.
  - `frontend/` — a working Vite + React 18 SPA, already talks to `api.py` over a dev proxy.

**Verdict:** `api.py` is confirmed as the canonical backend entrypoint. It is the only file this plan will modify. `app.py` and the root-level stale files are out of scope except to note their existence and recommend eventual archival (not part of MVP).

## 3. Current Frontend (what exists, what's reusable)

Stack: **Vite + React 18**, no router (single view), no state library (local `useState`/`useCallback` in `App.jsx`), plain inline JS-object styles (no CSS framework/Tailwind), `lucide-react` for icons, Google Fonts (Inter) preconnected.

Structure:
- `App.jsx` — root: owns `sessions[]` (client-side list of chat sessions, each tied to a backend session id), `activeId`, `activeSQL`. Renders 3-pane layout: `LeftPanel | ChatWindow | CodePanel`.
- `LeftPanel.jsx` — file upload (drag/drop + browse), a "Tables" list (renders `tableName: N cols` — schema-agnostic, good), and a chat/session switcher (rename, new chat). **Reusable almost as-is.**
- `ChatWindow.jsx` — message list + input box. Hardcodes 4 suggestion chips referencing "revenue"/"department"/"sales" — **must become dynamic**, derived from the actual detected schema instead of static strings.
- `MessageBubble.jsx` — renders SQL toggle, `ResultTable`, forecast table (hardcoded columns `["date","predicted_revenue"]`), insights text, errors. Structurally reusable, but forecast rendering is coupled to the hardcoded predictor contract.
- `CodePanel.jsx` — editable SQL viewer/editor, copy button. Fully reusable, maps directly onto the "Technical Details" pane in the target UI.
- `ResultTable.jsx` — generic sortable/paginated table, columns driven entirely by whatever `columns[]` is passed in. **Already dataset-agnostic, fully reusable.**
- `api.js` — thin fetch wrapper: `createSession`, `deleteSession`, `uploadFiles`, `runQuery`, `exportLast`. Talks to relative paths (Vite proxies `/session/*` to `localhost:8000`).
- `index.css` — CSS custom properties (`--bg`, `--accent`, etc.) for a light theme; no dark mode.

**Assessment:** Reuse `ResultTable`, `CodePanel` (as the Technical Details drawer), `LeftPanel`'s upload/drag-drop mechanics, and `api.js`'s fetch pattern. The 3-pane fixed layout and the chat-only interaction model need to evolve into the workspace layout described in §7, but this is an extension of existing structure, not a rewrite — no framework, build tool, or styling approach changes are needed for MVP.

## 4. Current Backend/API (actual contract — nothing invented)

Base URL: relative (`fetch("/session/...")`), proxied by Vite to `http://localhost:8000` in dev. CORS is wide open (`allow_origins=["*"]`) — acceptable for local dev only, flagged for later hardening, not in scope now.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| POST | `/session` | — | `{ session_id }` | Creates a `Session` (own DuckDB connection, `tables`, `unified`, `history`, `cache`) |
| DELETE | `/session/{sid}` | — | `{ ok: true }` | Drops session from memory (in-process dict, **no persistence** — restart = data loss) |
| POST | `/session/{sid}/upload` | multipart `files[]` | `{ tables, unified, sample, files_loaded }` | Loads files via `loader.load_files`, merges into session |
| GET | `/session/{sid}/schema` | — | `{ tables, unified }` | Just table→column-name-list, no types |
| POST | `/session/{sid}/query` | `{ query: string }` | `{ intent, sql, rows, columns, total_rows, forecast?, insights? }` (or an `.xlsx` stream if `intent==="export"`) | Single synchronous call: normalize → generate SQL (LLM) → validate (DuckDB `EXPLAIN`) → fix-retry ×2 → fallback → execute → optionally forecast/insight |
| GET | `/session/{sid}/export` | — | `.xlsx` stream | Re-runs last SQL and exports |

**Session handling:** in-memory `dict[str, Session]` inside `api.py` — no auth, no persistence, no expiry. Fine for MVP/local use; a restart destroys all sessions/data (must be communicated in UX, e.g., no "resume last session" promise yet).

**SQL generation:** one LLM call to a local Ollama server (`llama3`), given a rich schema summary (table/column/type/sample-values via `rich_schema_summary`) and the last 3 turns of conversation history. Validated via a DuckDB `EXPLAIN` dry-run (real syntax/semantic check, not a fake token check like the CLI's regex validator). Up to 2 auto-fix retries, then falls back to `_fallback_sql`, which **hardcodes `revenue`/`department`** — this fallback needs to become schema-driven (e.g., `SELECT * FROM {first_table} LIMIT 50` unconditionally, or better, pick the first detected measure/dimension pair from a generic profile).

**Intent detection:** keyword match (`predict`, `export`, `insight`, else `data`) — coarse, single-shot, not a real agentic plan. This is the biggest gap relative to the "agentic investigation" vision in §16 — flagged as backend work, not UI work.

**Streaming:** **not supported today.** `/session/{sid}/query` is a single blocking request/response. No SSE/WebSocket endpoint exists anywhere in `api.py`.

**Caching:** per-session `dict[sql, (df, timestamp)]`, 5-minute TTL (`CACHE_TTL` in `config.py`). Keyed on exact SQL string.

**Conversation handling:** `session.history` is a flat list of `{query, sql, result_summary}` dicts, used only to inject the last 3 turns as text into the SQL-gen prompt. There is no structured analytical state (metric/dimension/filter/time-period) anywhere — follow-ups like "only California" work only insofar as the LLM infers it from raw prior SQL text. This is the gap described in §11.

**Existing frontend integration:** frontend already fully implements this contract (`api.js` maps 1:1 to the 5 endpoints above). Nothing to reverse-engineer.

## 5. Runtime Dataset Architecture

Target flow, grounded in what `loader.py` and `api.py` already do plus what must be added:

```
Upload (existing: POST /upload, multi-file, multi-format)
  → Ingestion (existing: loader.load_files → DuckDB tables + optional unified view)
  → Profiling (NEW: per-table column-level stats — dtype, null %, distinct count,
                min/max, sample values — computed via DuckDB aggregate queries,
                no full data load into Python)
  → Schema discovery (existing, extend: rich_schema_summary already captures
                types + samples; expose this as structured JSON, not just a
                prompt-string)
  → Semantic understanding (NEW, best-effort: classify each column as
                measure / dimension / identifier / date / unknown, using dtype +
                name heuristics + cardinality; optionally one LLM call for
                low-confidence columns. Confidence is stored per column;
                low-confidence labels are shown as "uncertain" in the UI,
                never silently asserted.)
  → Session creation (existing: Session object; extend to hold profile +
                semantic labels alongside tables/unified/history/cache)
  → Analysis (existing: /query, extended over phases toward the agentic loop
                in §10/§16)
```

**UI interaction:** the frontend calls upload exactly as today, then polls or (once streaming lands) subscribes to profiling progress, then renders the "Dataset ready" summary (§6) sourced entirely from the new profiling endpoint's structured output — never from hardcoded column-name checks.

**Session-per-dataset:** already true in the backend (one `Session` = one DuckDB connection + its tables). The UI must make "New session" == "new dataset, new analytical context" explicit and easy (already partially there via `LeftPanel`'s "new chat", but today a chat can accumulate multiple unrelated uploads into one session/table-set with no boundary — MVP should keep one session = one coherent dataset, and treat "add more files" as adding to the *same* dataset, e.g. more sheets/timeframes, not an unrelated second dataset).

## 6. Target UX

**First launch (no data):**
Full-bleed empty state, no chat interface pretending to be ready. Headline: "Bring your data. Start analyzing." A single prominent upload target (drag/drop + click), listing actually-supported formats read from `loader.py`'s `_READERS`/`_EXCEL_EXTS` (CSV, TSV, TXT, Parquet, JSON/NDJSON/JSONL, ORC, Avro, XLSX/XLS/XLSM) — not a marketing list of hypothetical connectors.

**Upload → Processing:**
Progress states rendered as they actually happen server-side: Uploading → Loading into DuckDB → Profiling → (best-effort) Semantic labeling → Ready. Each state maps to real backend work (§10), no fabricated "AI thinking" animation.

**Dataset ready summary:**
A concise card, e.g.:
```
Dataset ready
245,382 rows · 18 columns · 14 months of data

Detected:
• 3 date fields
• 8 numerical fields
• 7 categorical fields
```
Numbers come from the profiling step, not guesses. If date range or row count can't be determined confidently, that line is omitted rather than shown as zero/wrong.

**Primary prompt:** "What would you like to investigate?" — replaces the current generic "Ask about your data…" placeholder, paired with 3-4 suggested questions that are **generated from the detected schema** (e.g. if a date + numeric column exist: "Show trend of {measure} over time"; if a categorical + numeric pair exists: "Break down {measure} by {dimension}") rather than the current hardcoded "Show total revenue by department".

**Asking a question → investigation → answer:** conversational turn triggers visible activity (§10), then a structured answer: short narrative + KPI/finding + chart/table + (secondary, collapsed) SQL/technical detail. Follow-ups ("Only California", "Compare with last year") are typed the same way as first questions, but internally should attach to structured analytical state (§11) once that lands.

**Dataset replacement / new session:** explicit "New session" starts a clean `Session` (existing backend capability), UI clearly resets conversation, tables, and any structured state — no bleed-through from the previous dataset.

## 7. Target UI Architecture

**Pages/routes (still no router needed for MVP — single page, view-state driven, matching current app's approach; introduce a router only if/when multi-session deep-linking is required):**

- **Onboarding/Empty view** — shown when the active session has no tables yet. Replaces today's "Select or start a chat" placeholder and the empty ChatWindow state.
- **Workspace view** — shown once a dataset is loaded. Composed of:
  - **Sidebar** (evolved `LeftPanel`): sessions list, active dataset summary (name, row/col counts, quality badge), collapsible schema explorer.
  - **Conversation panel** (evolved `ChatWindow` + `MessageBubble`): question input, message stream, inline activity indicator, inline findings (KPI cards, charts, tables).
  - **Technical details drawer** (evolved `CodePanel`): SQL, tables used, execution status/duration, validation status — collapsed by default, opened per-message.

**State/data flow:** Client-side session state stays in `App.jsx` (or is lifted into a small context if prop-drilling becomes painful — not needed yet at current component count). Each session object grows from today's `{id, name, messages, tables, unified, uploadedFiles}` to additionally hold `profile` (per-table column stats) and `semantics` (per-column labels) once those backend pieces exist (§9 Phase 2+). No global state library needed for MVP; introduce one only if a later phase (multi-dataset, §16) demands cross-session shared state.

## 8. Component Architecture

```
App
├── Sidebar (renamed/evolved LeftPanel)
│   ├── DatasetSummaryCard        [NEW — row/col counts, quality, schema toggle]
│   ├── SchemaExplorer            [NEW — collapsible list: dimensions/measures/dates/unknown]
│   ├── UploadDropzone            [existing upload/drag-drop logic, extracted from LeftPanel]
│   └── SessionList                [existing chat list: new/rename/select]
├── EmptyState                     [NEW — first-launch / no-data view]
├── Workspace
│   ├── DatasetReadyBanner         [NEW — "Dataset ready" summary, shown once per load]
│   ├── ConversationPanel (evolved ChatWindow)
│   │   ├── SuggestedQuestions     [NEW — schema-derived, replaces hardcoded SUGGESTIONS]
│   │   ├── MessageList
│   │   │   └── MessageBubble (evolved)
│   │   │       ├── ActivityTrace  [NEW — replaces "thinking dots" with real step list]
│   │   │       ├── FindingsBlock  [NEW — narrative + KPI cards]
│   │   │       ├── ResultTable (existing, reused as-is)
│   │   │       ├── ForecastBlock  [evolved — must not assume "date"/"predicted_revenue" once predictor is generalized]
│   │   │       └── TechnicalDetailsToggle [thin wrapper opening the drawer below]
│   │   └── QuestionInput
│   └── TechnicalDetailsDrawer (evolved CodePanel)
│       ├── SQLView (existing editor)
│       └── ExecutionMeta          [NEW — duration, validation status, tables used]
```

Everything under "existing"/"evolved" keeps its current file; "NEW" items are additions. No component is deleted; `ResultTable` and `CodePanel`'s editor internals need zero changes.

## 9. API / Backend Changes

**Required (blocking MVP as scoped in this plan):**
1. `GET /session/{sid}/profile` — new endpoint returning per-table column profiles (dtype, null%, distinct count, min/max/sample, and a best-effort `role` label: measure/dimension/date/identifier/unknown + confidence). Computed via DuckDB aggregate queries against already-loaded tables — no new ingestion path needed.
2. Remove hardcoded column names from `_fallback_sql`, `_enrich`, `_trend`, `_anomalies` in `api.py` — replace with logic driven by the new profile (e.g., pick first numeric column as default measure, first date-typed column as default time axis) or by omitting that enrichment entirely when no such column is confidently identified.
3. Generalize `predictor.py`'s `predict_sales` to accept a caller-specified date column and value column (from the profile / from the query context) instead of literal `"date"`/`"revenue"`.
4. Extend upload/query responses to include enough structured info for the UI's "Dataset ready" card (row count, column count, date span) without the frontend having to compute it client-side from a 5-row sample.

**Recommended (should land in an early post-MVP phase, not blocking):**
5. Structured analytical state object attached to `session.history` entries (metric/dimension/filters/time period) alongside the existing raw SQL/text history, to make follow-ups like "only California" more reliable than pure LLM prompt-stuffing (§11).
6. A `POST /session/{sid}/query/stream` (SSE) endpoint emitting the event model in §10, alongside (not replacing) the existing synchronous `/query` for simple cases.
7. Multi-step investigation: turn `_detect_intent`'s single keyword match into an actual plan (which sub-questions to investigate) — this is a real agent-loop change, out of scope for the UI plan itself but the UI's `ActivityTrace` component (§8) is designed to display whatever steps this eventually emits.

**Future (explicitly not MVP):** persistence layer for sessions (currently pure in-memory), auth, multi-dataset joins, saved analyses — see §16.

## 10. Streaming / Agent Activity

**Current state:** none. `/query` is fully synchronous.

**MVP decision:** do **not** build full SSE/event streaming in the first UI phases. Instead:
- For upload/profiling, the existing single request/response is enough for MVP — show a client-side sequence of labeled steps ("Uploading → Loading → Profiling") driven by the actual sequential awaits already present in the upload flow (upload call, then a follow-up profile call per §9.1), not by fake timers.
- For `/query`, MVP shows a single "Working…" state (already exists as "thinking dots" — replace the fake dots with a static, honest label like "Generating and validating query…") since the backend genuinely is one blocking call today. This is honest given §10's constraint: *"Only show activity that corresponds to actual backend operations."*
- **Once** the backend gains a real multi-step agent loop (§9.7, future), introduce SSE (`text/event-stream`, simplest to add to FastAPI, no new infra vs. WebSockets) with a minimal event set:
  - `PROFILE_STARTED` / `PROFILE_COMPLETED`
  - `SQL_GENERATED` / `SQL_VALIDATED`
  - `QUERY_EXECUTED`
  - `INVESTIGATION_STEP` (generic, carries a label — covers "checking category breakdown", "checking regional breakdown", etc. without the UI needing to know the domain)
  - `RESPONSE_READY`
  This minimal set is deliberately smaller than the example list in the prompt — collapse "started/completed" pairs into single events where the UI doesn't need the in-between state, and use one generic `INVESTIGATION_STEP` rather than a proliferating enum, since the actual sub-investigations are dataset-dependent and can't be enumerated in advance.

## 11. Analytical State

MVP: keep conversation state as it is today (raw text history feeding the LLM prompt) — this already works reasonably per the existing `history[-3:]` injection.

Post-MVP (Recommended, §9.5): introduce a structured `AnalyticalContext` per session:
```
{
  dataset_id,
  metric: string | null,       // resolved column, not a fixed name
  dimension: string | null,
  filters: [{column, op, value}],
  time_period: {column, range} | null,
  comparison_period: {column, range} | null,
  last_question: string,
  last_finding_summary: string | null,
}
```
This is populated/updated by the backend after each turn (parsed from the generated SQL + LLM's stated intent) and sent back to the UI so the sidebar can show "Currently analyzing: {metric} by {dimension}, filtered to {filters}" as a persistent, editable strip above the conversation — giving users a non-chat way to see/adjust what's being asked, without hardcoding what "metric" or "dimension" mean for their dataset.

## 12. Design System

- **Typography:** keep Inter (already loaded), add a monospace stack (already defined as `--mono`) for SQL/technical views only.
- **Spacing:** keep the existing 4/6/8/12/14/20px rhythm visible in current inline styles; no need to introduce a spacing scale system for MVP, but new components should reuse these exact values for consistency.
- **Color:** current light-only palette (`--bg`, `--surface`, `--accent` #7c6af7, etc.) stays as the base; dark mode is a future nice-to-have, not MVP-blocking since the current app doesn't have it either.
- **Cards:** dataset summary and finding cards use the existing bubble/card visual language (1px border, `--surface` background, subtle shadow, 8-12px radius) already established by `MessageBubble`.
- **Charts:** none exist yet (only tables). MVP introduces a minimal charting need (trend line, bar breakdown) — use a lightweight library decision to be made in the relevant phase, not now (recommend evaluating in Phase 4, not pre-decided here to avoid over-scoping this planning doc).
- **Tables:** `ResultTable` as-is — sortable, paginated, ellipsis-truncated cells.
- **Inputs:** existing textarea/button styling from `ChatWindow` reused for the question input.
- **States:** loading (existing thinking-dots → replaced per §10), empty (new), error (existing, red text — sufficient for MVP).

## 13. User Flows

1. **First launch, no data** — EmptyState shown, upload dropzone is the only actionable element.
2. **Upload data** — drag/drop or browse, using existing `LeftPanel` upload mechanics, extended with the formats list read from backend.
3. **Dataset processing** — sequential labeled steps (§10), no fake animation.
4. **Dataset ready** — summary card (§6) rendered from `/profile` (§9.1).
5. **First analysis** — user clicks a schema-derived suggestion or types a question; existing `/query` flow runs; result renders as narrative + table (+ chart once available).
6. **Multi-step investigation** — MVP: single-shot as today, UI simply labels it honestly; full multi-step trace deferred to post-MVP per §10.
7. **Follow-up question** — same input, same `/query` call; MVP relies on existing history-based context; UI shows the strip from §11 once that lands.
8. **Error** — existing error rendering in `MessageBubble` (`msg.error`), styled clearly, with a retry affordance added.
9. **Empty result** — new: distinguish "0 rows returned" from a generic error, with a plain-language message instead of an empty table.
10. **Dataset replacement** — user uploads a new file into an existing session; current backend behavior *adds* to the same session's tables. UI should make clear whether "add more files" (same dataset, e.g. more months) vs. "start new session" (different dataset) is intended — recommend making "replace dataset" always route through "New session" to avoid silently mixing schemas, consistent with §5's "no accidental context bleed" principle.
11. **New session** — existing `LeftPanel` "new chat" flow, relabeled to make clear it's a new dataset/analytical context, not just a new chat thread.
12. **Export** — existing `/export` endpoint and `exportLast` client call, surfaced as a button in the Technical Details drawer or per-finding.

## 14. Implementation Phases

Each phase is small and independently reviewable. No phase is executed until explicitly requested.

### Phase 1 — Backend: remove hardcoded columns + add profiling endpoint
- **Goal:** Make the backend genuinely dataset-agnostic before touching any UI.
- **Files affected:** `agentic_analytics_kiro/api.py`, `agentic_analytics_kiro/predictor.py` (new file or edit in place), `agentic_analytics_kiro/loader.py` (add a profiling helper alongside existing `schema_summary`/`rich_schema_summary`).
- **Tasks:** add `GET /session/{sid}/profile`; generalize `_fallback_sql`, `_enrich`, `_trend`, `_anomalies` to use profile-derived columns instead of literals; generalize `predict_sales` to take column names as parameters.
- **Dependencies:** none (pure backend).
- **Acceptance criteria:** uploading a dataset with no column named `revenue`/`date`/`department` still produces sensible fallback SQL, forecasts (when a date+numeric pair exists), and insights, with zero `KeyError`/silent no-ops caused by the removed literals.
- **Testing:** manual test with 2+ differently-shaped datasets (e.g. an HR CSV, a marketing dataset) through the existing CLI (`app.py` is untouched, so use direct API calls via `curl`/httpie or the existing frontend) confirming no hardcoded-name assumptions fire.
- **Expected result:** backend contract unchanged for existing UI, plus one new endpoint; no regression to current sales-style datasets.

### Phase 2 — Frontend: EmptyState + dynamic format list + DatasetSummaryCard
- **Goal:** Replace the "select or start a chat" placeholder with the intended first-launch experience, and surface real profile data.
- **Files affected:** `App.jsx` (new EmptyState branch), new `EmptyState.jsx`, new `DatasetSummaryCard.jsx`, `LeftPanel.jsx` (wire in the summary card), `api.js` (add `getProfile`).
- **Dependencies:** Phase 1's `/profile` endpoint.
- **Acceptance criteria:** with no data, user sees the upload-first empty state, not an empty chat; after upload, a summary card renders real row/column/date-span numbers.
- **Testing:** manual — verify with two different datasets that numbers are correct and no field is invented/zeroed silently.
- **Expected result:** visually distinct first-run experience; no change to query/chat behavior yet.

### Phase 3 — Frontend: dynamic suggested questions + honest activity state
- **Goal:** Remove hardcoded suggestion strings and fake "thinking dots", replace with schema-derived suggestions and an honest single-step activity label.
- **Files affected:** `ChatWindow.jsx`, `MessageBubble.jsx`.
- **Dependencies:** Phase 2 (needs profile data already loaded into session state).
- **Acceptance criteria:** suggestions change per dataset; no suggestion or activity text implies work the backend isn't doing.
- **Testing:** manual across 2+ datasets.
- **Expected result:** conversation entry point feels tailored, not templated.

### Phase 4 — Frontend: Technical Details drawer + findings layout polish
- **Goal:** Evolve `CodePanel` into the labeled "Technical Details" surface (SQL + execution meta), and restructure `MessageBubble` results into narrative/KPI/table sections.
- **Files affected:** `CodePanel.jsx` → relabeled/extended, `MessageBubble.jsx`, possibly new `FindingsBlock.jsx`.
- **Dependencies:** none new (uses existing `/query` response fields); chart library decision made here if pursued.
- **Acceptance criteria:** SQL/execution detail is present but secondary; primary answer is legible without opening it.
- **Testing:** manual, various query types (data/insight/predict/export intents).
- **Expected result:** matches the "answer first, technical detail on demand" product principle.

### Phase 5 — Session/dataset-replacement clarity
- **Goal:** Make "new session = new dataset" explicit in the UI per §13.10-11.
- **Files affected:** `LeftPanel.jsx`, `App.jsx`.
- **Dependencies:** none.
- **Acceptance criteria:** no UI path silently mixes two unrelated datasets into one session's table set without at least a warning.
- **Testing:** manual — upload dataset A, then attempt to upload unrelated dataset B into the same session; confirm the UI's guidance is clear.
- **Expected result:** reduces the "carried assumptions from previous dataset" risk called out in the prompt.

Later phases (structured analytical state, SSE streaming, multi-step investigation UI) are **not scheduled yet** — they depend on backend agent-loop work in §9.5-7 that is itself out of scope until after MVP phases above are reviewed.

## 15. MVP Definition

Quantara is MVP-complete when:
- A user with **no prior configuration** can open the app, upload any backend-supported file, and within the existing upload flow see accurate row/column/date-span info (Phase 1+2).
- The backend performs zero column-name-literal assumptions in the live `/query` and `/profile` paths (Phase 1).
- The question input offers schema-derived suggestions, not hardcoded sales-domain examples (Phase 3).
- Every activity indicator shown corresponds to a real backend step (Phase 3).
- Answers are legible at a glance (narrative + table/KPI) with SQL/technical detail available but secondary (Phase 4).
- Starting fresh with a different dataset does not silently inherit the previous dataset's schema/state (Phase 5).
- All existing functionality (multi-file upload, SQL editing, export, forecast, insights) continues to work exactly as before.

## 16. Future Features (explicitly not MVP)

- Multiple simultaneous datasets in one session, with cross-dataset questions ("did marketing spend affect sales?") — architecture in §5 avoids blocking this (one `Session` could hold multiple named datasets) but no join/correlation logic is built now.
- Database connectors (Postgres/Snowflake/etc.) beyond file upload — `loader.py` would need a new ingestion path; not started.
- Saved analyses, dashboards, scheduled reports.
- Collaboration / multi-user sessions (current sessions are single-process in-memory, no auth).
- Advanced forecasting beyond linear regression.
- Persistent projects (current sessions vanish on backend restart — no DB-backed persistence).
- Semantic metric layers (a durable, user-editable mapping of "this column means revenue" reused across sessions).
- Advanced anomaly detection beyond the current 2-std-dev heuristic.
- Full SSE-based multi-step agent activity streaming (§10) and structured analytical state (§11) — both scoped as post-MVP recommended backend work, UI hooks designed for but not built.

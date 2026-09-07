# Prompt: Event Analysis Pipeline (§17)

> Paste this to a coding agent working in this repo. It extends `plan.md`;
> read `plan.md` §1, §4, §9, §11, §16 first — its principles bind this work.

## Context you must verify before writing code

Do not trust this section — confirm each claim against the tree, then proceed.

- `agentic_analytics_kiro/api.py` is the only backend entrypoint the frontend
  uses. `app.py` (CLI) and the root-level `*.py` prototypes are out of scope.
- Intent is a flat keyword match in `_INTENT_KEYWORDS` (`api.py`), tested in
  dict order: `predict` → `export` → `correlate` → `insight` → `data`.
  One turn produces one SQL query and one intent.
- Export is `_export_xlsx`: `df.to_excel(buf, index=False)` — a single
  unformatted sheet of the last result. `excel_writer.py` already writes a
  two-sheet (Raw Data / Summary) workbook and has **no importer** — it is
  dead code, not a foundation; treat it as a reference, not a dependency.
- `GET /session/{sid}/export` re-runs `session.history[-1]["sql"]`.
- Acceptance tests live in `tests/`; `pytest.ini` is configured.

## §17.1 What to build

A multi-step **event analysis** pipeline: one user request about a discrete
event ("a sales event happened yesterday — analyze customer metrics and
cross-shop behaviour") produces a set of related queries, an interpreted
narrative, and one ready-to-use multi-sheet Excel workbook.

This is the first intent that is **not** one-question-one-query. Everything
below follows from that.

## §17.2 The binding constraint: no assumed schema

`plan.md` §1 forbids any code path from referencing a fixed column name. The
domain words in this spec — customer, transaction, shop, sales — are
**semantic roles resolved at runtime**, never column literals:

| Role | Resolved as | If unresolvable |
|---|---|---|
| `entity` | the column identifying a repeat actor (high cardinality, repeats across rows) | ask the user; do not guess |
| `event_key` | the column identifying one interaction/receipt | fall back to row count, and say so |
| `measure[]` | numeric additive columns | run count-based metrics only |
| `cross_dim` | the low-cardinality dimension an entity can span (store/category/channel) | skip the cross-shop sheets entirely |
| `time` | the primary date column | pipeline cannot run; report why |

Reuse `loader.profile_tables` / `pick_default_columns` and
`predictor.infer_date_column` / `infer_measure_column` — extend them, do not
add a parallel inference path. Resolved roles must be returned to the client
and rendered as a confirmable, user-editable mapping (§11's context strip is
the natural home). **A role the system guessed and a role the user confirmed
must be distinguishable in the response.**

## §17.3 Pipeline stages

Each stage emits an SSE event over the existing `/query/stream` contract —
reuse `INVESTIGATION_STEP`, do not invent a second streaming channel.

1. **Resolve** — roles per §17.2, plus the event window and a comparable
   baseline (prior N same-weekday periods, stated explicitly, never implied).
2. **Plan** — emit an ordered list of named sub-analyses before running any of
   them, so the UI can show the plan and the user can cancel.
3. **Execute** — one SQL query per sub-analysis, each through the existing
   validate → fix-retry → execute path. A failed sub-analysis is recorded and
   skipped; it must not abort the run.
4. **Interpret** — per-sub-analysis findings via `analytical_context` and
   `anomaly`, then one narrative over the whole set.
5. **Assemble** — the workbook (§17.5).

Sub-analyses (skip any whose roles did not resolve):
- Event vs baseline, one row per `cross_dim` value plus a total row.
- Entity metrics: distinct entities, events, events-per-entity, measure sums,
  measure-per-entity, measure-per-event — each with a baseline delta.
- Cross-dimension: entities spanning 2+ `cross_dim` values, their share of
  entities and of measure, mean dimensions per entity.
- Affinity: the top co-occurring `cross_dim` pairs by shared entities.
- New vs returning entities, if history predates the event window.

## §17.4 Scale

Assume the dataset does not fit in memory and the codebase is larger than one
context window.

- Every aggregation stays in DuckDB. Never `fetchdf()` a raw row set to
  aggregate it in pandas — the workbook is built from aggregates.
- The cross-dimension and affinity steps are the blow-up risk: an entity-pair
  self-join is quadratic. Aggregate to one row per entity first, then join.
  Cap affinity output to top-N pairs.
- Preview rows stay capped at 200 (`api.py`); the workbook is not capped.
- The 200-row `LIMIT` rule in the SQL prompt must not be applied to pipeline
  queries — state the exception in the prompt rather than post-stripping it.
- Reuse the per-SQL session cache; do not add a second cache layer.

## §17.5 The workbook

Replace the single-sheet export **for this intent only** — `_export_xlsx`
keeps its current behaviour for ordinary queries.

Sheets, in order, omitting any whose sub-analysis was skipped:
1. **Summary** — headline metrics, event vs baseline, delta and % delta.
2. **Narrative** — the written findings, one per row, so they survive as text.
3. One sheet per sub-analysis, in §17.3 order.
4. **Method** — resolved roles and whether each was inferred or confirmed,
   the event and baseline windows, every SQL query executed, row counts, and
   any sub-analysis that was skipped and why.

"Ready to use" is a testable requirement, not a stylistic one: header row
frozen and bold, columns auto-width, money and percentages carrying number
formats (not pre-rounded strings), no index column, sheet names ≤31 chars and
free of `[]:*?/\`. Deltas stay numeric so they remain sortable.

The Method sheet is not optional: a workbook that is forwarded without the
conversation must still disclose what the system assumed.

## §17.6 Wiring

- New intent `event_analysis`. Keyword routing is already the weakest part of
  the system (`plan.md` §4) — do not deepen it. Match on the co-occurrence of
  an event reference and an analysis request, and place it before `export`,
  since these requests almost always say "excel" and would otherwise route to
  the single-sheet exporter.
- `GET /export` must return this workbook when the last turn was an
  `event_analysis` — do not regenerate SQL from a follow-up "export to excel".
- The frontend needs: the plan list, per-step progress, the role mapping with
  its confirmed/inferred distinction, and a download. Reuse `ActivityTrace`,
  `AnalyticalContextStrip`, `CodePanel`; a workbook of many queries needs the
  panel to show more than one SQL statement.

## §17.7 Done means

- Acceptance tests in `tests/`, following `conftest.py`'s fixture style, run
  the whole pipeline on at least two datasets with **different** column names
  and no shared vocabulary, asserting both produce a valid workbook.
- A test asserts every sheet's provenance is present in Method.
- A test covers an unresolvable `cross_dim`: cross-shop sheets absent, the run
  still succeeds, and the omission is stated rather than silent.
- A test asserts a failed sub-analysis does not abort the run.
- `grep` for the domain literals `revenue`, `customer_id`, `department`,
  `transaction_id`, `cost`, `units` across new code returns nothing outside
  test fixtures and docstrings.
- Existing tests still pass; ordinary single-query export is unchanged.

## §17.8 Report back

State what you verified vs assumed, which roles your inference resolves
reliably and which are coin-flips, and anything here you think is wrong —
this spec was written from an audit, not from running the pipeline.

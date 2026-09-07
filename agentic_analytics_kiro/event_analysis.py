"""
Event analysis pipeline (plan §17): one request about a discrete event becomes
a set of related aggregations, an interpreted narrative, and one multi-sheet
workbook.

This is the first intent in the system that is not one-question-one-query, and
two things follow from that:

* **The queries are built, not generated.** Every sub-analysis below is a
  deterministic function of the *resolved roles* — there is no prompt that
  could return a different shape on a different run. The model is still in the
  loop (it repairs a query DuckDB rejects, and it writes the narrative), but
  the arithmetic behind a number in the workbook is this file's, not the
  model's.
* **No column name is written down here.** The domain words in §17 — customer,
  transaction, shop — are *roles* resolved at runtime from
  `loader.profile_tables`. `entity`, `event_key`, `cross_dim` are the names of
  positions in an analysis; which column fills each one is measured, reported,
  and overridable by the user (plan §1).

Everything aggregates inside DuckDB. Nothing here fetches a raw row set to
group it in pandas: the frames that come back are already one row per
dimension value, per metric, or per pair.
"""
from __future__ import annotations

import datetime
import re

import pandas as pd

# ── SQL literals ──────────────────────────────────────────────────────────────

def q(name: str) -> str:
    """Quote an identifier. Doubling embedded quotes is what keeps a column
    named `weird"name` from ending the identifier early."""
    return '"' + str(name).replace('"', '""') + '"'


def s(value) -> str:
    """A single-quoted SQL string literal."""
    return "'" + str(value).replace("'", "''") + "'"


def _date(value) -> str:
    return f"DATE {s(value)}"


# A date column may be typed DATE, TIMESTAMP, or (when only its *name* said so)
# VARCHAR. TRY_CAST covers all three and yields NULL rather than an error on the
# rows that aren't dates, so one unparseable value doesn't fail the run.
def _day(col: str, alias: str | None = None) -> str:
    ref = f"{alias}.{q(col)}" if alias else q(col)
    return f"TRY_CAST({ref} AS DATE)"


# ── Role resolution (§17.2) ───────────────────────────────────────────────────
#
# Every threshold below is a property of the *shape* of a column — how many
# distinct values it holds relative to the rows — never of its name. The name
# only ever breaks a tie, and where it does the reason travels with the answer.

# An entity repeats: strictly fewer distinct values than rows. 0.9 leaves room
# for a dataset where most actors appear once and a minority repeat.
_ENTITY_MAX_RATIO = 0.9

# Below this many distinct values a repeating column is a category, not a
# population of actors — that is `cross_dim`'s job, and calling it `entity`
# would make "events per entity" mean "events per category".
_ENTITY_MIN_DISTINCT = 8

# A key is one value per row. 0.98 rather than 1.0 tolerates a few duplicated
# or null rows in real data.
_KEY_MIN_RATIO = 0.98

# A dimension an entity can span is something a person could read off a chart
# axis. Above this it is another identifier.
_CROSS_DIM_MAX_DISTINCT = 50

# Name-based classification only (`profile` gives a column role of "date" at
# confidence 0.5 when just the name suggested it). Below this the column was
# typed as a date.
_DATE_CONFIDENCE_TYPED = 0.6

# A wide table would otherwise put every numeric column through every
# sub-analysis and produce a workbook nobody reads. The dropped columns are
# named in Method rather than silently omitted.
_MAX_MEASURES = 5

_ID_NAME_RE = re.compile(r"(^|_)(id|uuid|guid|key|code|no|num|number)($|_)", re.IGNORECASE)


def _role_entry(column, source, confidence, why, candidates=None) -> dict:
    """One resolved role.

    `source` is the field §17.2 requires: "inferred" is the system's guess and
    "confirmed" is the user's answer, and a workbook forwarded without the
    conversation has to be able to tell them apart.
    """
    return {
        "column": column,
        "source": source,
        "confidence": confidence,
        "why": why,
        "candidates": candidates or [],
    }


def _unresolved(why: str, candidates=None) -> dict:
    return _role_entry(None, "unresolved", 0.0, why, candidates)


def _pick_table(profile: dict) -> str | None:
    """The table the event lives in: the largest one that has a date column.

    Largest, because an event's transactions are the fact table and everything
    else in a session is usually a lookup beside it. With no date column
    anywhere there is no event window to resolve and the pipeline says so.
    """
    best, best_rows = None, -1
    for tname, tprofile in profile.items():
        has_date = any(c.get("role") == "date" for c in tprofile.get("columns", []))
        rows = tprofile.get("row_count") or 0
        if has_date and rows > best_rows:
            best, best_rows = tname, rows
    return best


def _ratio(col: dict, row_count: int) -> float | None:
    distinct = col.get("distinct_count")
    if not row_count or distinct is None:
        return None
    return distinct / row_count


def _spanning_fraction(con, table: str, entity: str, dim: str) -> float | None:
    """The share of entities that appear against 2+ values of `dim`.

    This is the measurement that decides which column is `cross_dim`: a
    dimension no entity ever spans is not one an entity can span, whatever it
    is called. Aggregated to one row per entity first (§17.4), so this is a
    grouped scan rather than a self-join.
    """
    sql = f"""
    SELECT AVG(CASE WHEN n_dims >= 2 THEN 1.0 ELSE 0.0 END)
    FROM (
        SELECT COUNT(DISTINCT {q(dim)}) AS n_dims
        FROM {q(table)}
        WHERE {q(entity)} IS NOT NULL AND {q(dim)} IS NOT NULL
        GROUP BY {q(entity)}
    )
    """
    try:
        value = con.execute(sql).fetchone()[0]
    except Exception:
        return None
    return float(value) if value is not None else None


def resolve_roles(profile: dict, con, overrides: dict | None = None) -> dict:
    """Resolve §17.2's roles against a session's profile.

    Returns {"table", "roles", "blocked"}. `blocked` is a sentence, not a flag:
    when the pipeline cannot run it must say which role it could not fill.

    `overrides` maps a role name to a column the user picked; those come back
    marked "confirmed" and are never second-guessed.
    """
    overrides = {k: v for k, v in (overrides or {}).items() if v}
    table = overrides.get("table") or _pick_table(profile)
    if table is None or table not in profile:
        return {
            "table": None,
            "roles": {},
            "blocked": "No table with a date column, so there is no event window "
                       "to analyse. The pipeline needs one dated table.",
        }

    tprofile = profile[table]
    row_count = tprofile.get("row_count") or 0
    columns = tprofile.get("columns", [])
    by_name = {c["name"]: c for c in columns}

    def confirmed(role: str, why: str) -> dict | None:
        column = overrides.get(role)
        if not column or column not in by_name:
            return None
        return _role_entry(column, "confirmed", 1.0, why)

    roles: dict[str, dict] = {}

    # ── time ──
    date_cols = [c for c in columns if c.get("role") == "date"]
    date_cols.sort(key=lambda c: (-(c.get("confidence") or 0), c["name"]))
    roles["time"] = confirmed("time", "Chosen by the user.") or (
        _role_entry(
            date_cols[0]["name"], "inferred",
            0.9 if (date_cols[0].get("confidence") or 0) >= _DATE_CONFIDENCE_TYPED else 0.5,
            ("Typed as a date." if (date_cols[0].get("confidence") or 0) >= _DATE_CONFIDENCE_TYPED
             else "Not typed as a date — read as one because its name suggests it."),
            [c["name"] for c in date_cols[1:]],
        ) if date_cols else
        _unresolved(f"No date column found in {table}.")
    )
    if roles["time"]["column"] is None:
        return {
            "table": table, "roles": roles,
            "blocked": f"No date column in {table}, so the event window cannot be placed. "
                       f"The pipeline cannot run on this dataset.",
        }
    time_col = roles["time"]["column"]

    # ── entity: the repeat actor ──
    entity_candidates = []
    for c in columns:
        if c["name"] == time_col or c.get("role") not in ("identifier", "dimension"):
            continue
        distinct, ratio = c.get("distinct_count"), _ratio(c, row_count)
        if distinct is None or ratio is None:
            continue
        if distinct >= _ENTITY_MIN_DISTINCT and ratio <= _ENTITY_MAX_RATIO:
            entity_candidates.append((distinct, c["name"]))
    entity_candidates.sort(reverse=True)

    roles["entity"] = confirmed("entity", "Chosen by the user.") or (
        _role_entry(
            entity_candidates[0][1], "inferred",
            0.75 if _ID_NAME_RE.search(entity_candidates[0][1]) else 0.6,
            f"{entity_candidates[0][0]} distinct values across {row_count} rows — "
            f"repeats often enough to be an actor rather than a category.",
            [name for _, name in entity_candidates[1:4]],
        ) if entity_candidates else
        _unresolved(
            "No column repeats across rows with enough distinct values to be a "
            "population of actors. Pick one and re-ask.",
            [c["name"] for c in columns if c.get("role") in ("identifier", "dimension")],
        )
    )
    if roles["entity"]["column"] is None:
        return {
            "table": table, "roles": roles,
            "blocked": "Could not identify the column that names a repeat actor. "
                       "Confirm it and re-ask — the pipeline will not guess one.",
        }
    entity_col = roles["entity"]["column"]

    # ── event_key: one value per interaction ──
    key_candidates = [
        c["name"] for c in columns
        if c["name"] not in (time_col, entity_col)
        and (_ratio(c, row_count) or 0) >= _KEY_MIN_RATIO
        and (c.get("role") == "identifier" or _ID_NAME_RE.search(c["name"]))
    ]
    roles["event_key"] = confirmed("event_key", "Chosen by the user.") or (
        _role_entry(key_candidates[0], "inferred", 0.7,
                    "One distinct value per row — read as the identifier of a single "
                    "interaction.", key_candidates[1:])
        if key_candidates else
        _unresolved("No column holds one value per row, so an event is counted as a "
                    "row. Counts are row counts, not distinct interactions.")
    )

    # ── measure[]: additive numerics ──
    measures, rejected = [], []
    for c in columns:
        if c.get("role") != "measure" or c["name"] in (time_col, entity_col):
            continue
        if c["name"] == roles["event_key"]["column"]:
            continue
        if _ID_NAME_RE.search(c["name"]):
            rejected.append((c["name"], "named like an identifier"))
            continue
        # A numeric column with one value per row is far more likely a key than
        # something worth summing. Rejected here, and named in Method so the
        # user can override a genuine near-unique measure.
        if (_ratio(c, row_count) or 0) >= _KEY_MIN_RATIO:
            rejected.append((c["name"], "one distinct value per row — reads as a key, not an amount"))
            continue
        measures.append(c["name"])

    override_measures = overrides.get("measure")
    if isinstance(override_measures, str):
        override_measures = [override_measures]
    if override_measures:
        kept = [m for m in override_measures if m in by_name]
        roles["measure"] = _role_entry(kept, "confirmed", 1.0, "Chosen by the user.")
    else:
        dropped = measures[_MAX_MEASURES:]
        roles["measure"] = _role_entry(
            measures[:_MAX_MEASURES],
            "inferred" if measures else "unresolved",
            0.8 if measures else 0.0,
            ("Numeric columns that are not identifiers."
             + (f" Capped at {_MAX_MEASURES}; not analysed: {', '.join(dropped)}." if dropped else "")
             + (f" Excluded: {'; '.join(f'{n} ({why})' for n, why in rejected)}." if rejected else ""))
            if measures else
            "No additive numeric column — only count-based metrics can be computed.",
            dropped,
        )

    # ── cross_dim: what an entity can span ──
    dim_candidates = []
    for c in columns:
        if c["name"] in (time_col, entity_col, roles["event_key"]["column"]):
            continue
        if c["name"] in (roles["measure"]["column"] or []):
            continue
        distinct = c.get("distinct_count")
        if distinct is None or not (2 <= distinct <= _CROSS_DIM_MAX_DISTINCT):
            continue
        if c.get("role") not in ("dimension", "identifier"):
            continue
        dim_candidates.append(c["name"])

    override_dim = confirmed("cross_dim", "Chosen by the user.")
    if override_dim:
        roles["cross_dim"] = override_dim
    elif not dim_candidates:
        roles["cross_dim"] = _unresolved(
            "No low-cardinality dimension an entity could span. The cross-dimension "
            "and affinity analyses are omitted from this run."
        )
    else:
        # Measured, not guessed: whichever candidate entities actually span.
        scored = []
        for name in dim_candidates:
            fraction = _spanning_fraction(con, table, entity_col, name)
            if fraction:
                scored.append((fraction, name))
        scored.sort(reverse=True)
        if scored:
            fraction, name = scored[0]
            roles["cross_dim"] = _role_entry(
                name, "inferred", min(0.9, 0.5 + fraction),
                f"Across the whole table, {fraction:.0%} of {entity_col} values "
                f"appear against 2 or more {name} values — the dimension entities "
                f"actually span.",
                [n for _, n in scored[1:4]],
            )
        else:
            roles["cross_dim"] = _unresolved(
                f"No candidate dimension is ever spanned by the same {entity_col} "
                f"(checked: {', '.join(dim_candidates)}). The cross-dimension and "
                f"affinity analyses are omitted from this run.",
                dim_candidates,
            )

    return {"table": table, "roles": roles, "blocked": None}


# ── Event window and baseline (§17.3) ─────────────────────────────────────────

_ISO_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")

# How long an event lasted, when the request says so in words rather than
# dates. Anything not listed here is one day, and the response says so.
_DURATIONS = (
    ("weekend", 2), ("fortnight", 14), ("quarter", 92),
    ("week", 7), ("month", 30), ("day", 1),
)

# Prior periods the event is compared against. Four is enough for an average
# that isn't one unusual week, and short enough to stay inside the recent
# behaviour of the data rather than reaching back into a different regime.
_BASELINE_PERIODS = 4

# Offset between baseline periods, in days. A week keeps every baseline window
# on the same weekdays as the event — comparing a Saturday sale against the
# preceding Wednesdays would measure the calendar, not the event.
_BASELINE_STRIDE_DAYS = 7


def _data_range(con, table: str, time_col: str) -> tuple[datetime.date | None, datetime.date | None]:
    try:
        lo, hi = con.execute(
            f"SELECT MIN({_day(time_col)}), MAX({_day(time_col)}) FROM {q(table)}"
        ).fetchone()
    except Exception:
        return None, None
    to_date = lambda v: v if isinstance(v, datetime.date) and not isinstance(v, datetime.datetime) \
        else (v.date() if isinstance(v, datetime.datetime) else None)
    return to_date(lo), to_date(hi)


def resolve_windows(question: str, table: str, time_col: str, con) -> dict:
    """Place the event window and the periods it is compared against.

    §17.3 requires the baseline to be *stated*, never implied, so both the
    window and every baseline period come back as explicit dates with a
    sentence saying how they were chosen. A baseline period that falls before
    the data starts is dropped and counted, rather than quietly contributing
    zeros to an average.
    """
    first_day, last_day = _data_range(con, table, time_col)
    if last_day is None:
        return {"blocked": f"No readable dates in {table}.{time_col}, so the event "
                           f"window cannot be placed."}

    found = [datetime.date.fromisoformat(d) for d in _ISO_DATE_RE.findall(question or "")]
    found = sorted(d for d in found if first_day is None or first_day <= d <= last_day)

    lowered = (question or "").lower()
    length = next((days for word, days in _DURATIONS if word in lowered), 1)

    if len(found) >= 2:
        start, end = found[0], found[-1]
        how = f"The request named {start} and {end}."
    elif len(found) == 1:
        start = found[0]
        end = start + datetime.timedelta(days=length - 1)
        end = min(end, last_day)
        how = (f"The request named {start}"
               + (f" and a period of {length} days." if length > 1 else "."))
    else:
        end = last_day
        start = end - datetime.timedelta(days=length - 1)
        how = (f"The request named no date, so the most recent {length} day"
               f"{'' if length == 1 else 's'} in {time_col} "
               f"({start} to {end}) was used as the event window.")

    span = (end - start).days + 1
    baseline, dropped = [], 0
    for k in range(1, _BASELINE_PERIODS + 1):
        offset = datetime.timedelta(days=_BASELINE_STRIDE_DAYS * k)
        b_start, b_end = start - offset, end - offset
        if first_day is not None and b_start < first_day:
            dropped += 1
            continue
        baseline.append({"label": f"baseline_{k}", "start": b_start.isoformat(),
                         "end": b_end.isoformat()})

    note = (
        f"{how} The baseline is the {len(baseline)} preceding period"
        f"{'' if len(baseline) == 1 else 's'} of the same {span} day"
        f"{'' if span == 1 else 's'}, each offset by a whole number of weeks so "
        f"every baseline window covers the same weekdays as the event"
        + (f"; {dropped} further period{'' if dropped == 1 else 's'} would have "
           f"started before the data does ({first_day}) and {'was' if dropped == 1 else 'were'} "
           f"dropped rather than counted as zero." if dropped else ".")
    )
    if not baseline:
        note += (" No baseline period fits inside the data, so nothing is compared "
                 "against a prior period in this run.")

    return {
        "event": {"start": start.isoformat(), "end": end.isoformat(), "days": span},
        "baseline": baseline,
        "baseline_periods": len(baseline),
        "data_start": first_day.isoformat() if first_day else None,
        "data_end": last_day.isoformat(),
        "note": note,
        "blocked": None,
    }


# ── Sub-analysis SQL (§17.3) ──────────────────────────────────────────────────
#
# Every builder below returns SQL that aggregates entirely inside DuckDB. The
# frames they produce are already the sheet: one row per dimension value, per
# metric, or per pair. Nothing fetches raw rows to group them in pandas (§17.4).

# Affinity is the one genuinely quadratic step. The self-join runs over one row
# per (entity, cross_dim) pair rather than over transactions, which bounds it at
# entities × dimensions, and the output is capped here as well.
_MAX_AFFINITY_PAIRS = 25


def _periods_cte(windows: dict) -> str:
    """The event window and its baselines as a small table of labelled ranges.

    Joining the fact table against this once is what lets a single scan serve
    both sides of every comparison, instead of running the same aggregate again
    per period.
    """
    rows = [f"(true, {s('event')}, {_date(windows['event']['start'])}, {_date(windows['event']['end'])})"]
    rows += [
        f"(false, {s(b['label'])}, {_date(b['start'])}, {_date(b['end'])})"
        for b in windows["baseline"]
    ]
    return ("periods AS (\n  SELECT * FROM (VALUES\n    "
            + ",\n    ".join(rows)
            + "\n  ) AS p(is_event, period_label, period_start, period_end)\n)")


def _scoped_cte(table: str, roles: dict, windows: dict, columns: list[str],
                event_only: bool = False) -> str:
    """Rows inside the windows, carrying only the columns a sub-analysis reads."""
    time_col = roles["time"]["column"]
    picked = ", ".join(f"t.{q(c)}" for c in dict.fromkeys(columns) if c)
    if event_only:
        return (f"scoped AS (\n  SELECT {picked}\n  FROM {q(table)} t\n"
                f"  WHERE {_day(time_col, 't')} BETWEEN "
                f"{_date(windows['event']['start'])} AND {_date(windows['event']['end'])}\n)")
    return (f"scoped AS (\n  SELECT p.is_event, p.period_label, {picked}\n"
            f"  FROM {q(table)} t\n  JOIN periods p\n"
            f"    ON {_day(time_col, 't')} BETWEEN p.period_start AND p.period_end\n)")


def _events_expr(roles: dict) -> str:
    """How one interaction is counted. With no key per row, an event is a row —
    §17.2's stated fallback, reported in Method rather than assumed silently."""
    key = roles["event_key"]["column"]
    return f"COUNT(DISTINCT {q(key)})" if key else "COUNT(*)"


def _baseline_avg(expr: str, n_periods: int) -> str:
    """Average per baseline period.

    Dividing by the number of periods rather than averaging the rows that came
    back matters: a baseline period in which a dimension value saw nothing
    produces no row, and `AVG` over the periods that *did* would report the
    baseline as the average of its good weeks.
    """
    if not n_periods:
        return "CAST(NULL AS DOUBLE)"
    return f"(COALESCE(SUM(CASE WHEN NOT is_event THEN {expr} END), 0) / {n_periods}.0)"


def _delta_columns(label: str, event_expr: str, baseline_expr: str) -> list[tuple[str, str]]:
    """The four columns every compared metric gets. Deltas stay numeric so the
    sheet stays sortable (§17.5)."""
    return [
        (f"{label} (event)", event_expr),
        (f"{label} (baseline avg)", baseline_expr),
        (f"{label} delta", f"({event_expr} - {baseline_expr})"),
        (f"{label} % delta", f"(({event_expr} - {baseline_expr}) / NULLIF({baseline_expr}, 0))"),
    ]


def _sub(key, title, description, sql=None, formats=None, skipped=None) -> dict:
    """One sub-analysis. A skipped one is a first-class record, not an absence:
    it keeps its place in the plan and its reason reaches the Method sheet."""
    return {
        "key": key, "title": title, "description": description,
        "sql": sql, "formats": formats or {}, "skipped": skipped,
    }


def _event_vs_baseline(table: str, roles: dict, windows: dict) -> dict:
    key = "event_vs_baseline"
    title = "Event vs baseline"
    n_base = windows["baseline_periods"]
    dim = roles["cross_dim"]["column"]
    entity = roles["entity"]["column"]
    measures = roles["measure"]["column"] or []
    label = (f"Each {dim} value over the event window against the baseline average"
             if dim else "The event window against the baseline average")

    if not n_base:
        return _sub(key, title, label, skipped=windows["note"])

    carried = [dim, entity, roles["event_key"]["column"], *measures]
    inner = [
        "period_label", "is_event",
        f"{_events_expr(roles)} AS events_n",
        f"COUNT(DISTINCT {q(entity)}) AS entities_n",
    ] + [f"SUM({q(m)}) AS {q('sum_' + m)}" for m in measures]

    if dim:
        inner.insert(2, f"GROUPING({q(dim)}) AS grouping_flag")
        inner.insert(3, f"{q(dim)} AS dim_value")
        group = (f"GROUP BY GROUPING SETS ((period_label, is_event, {q(dim)}), "
                 f"(period_label, is_event))")
        head = [
            (dim, f"CASE WHEN grouping_flag = 1 THEN {s('(all values)')} "
                  f"ELSE CAST(dim_value AS VARCHAR) END"),
            # A real dimension value could read "(all values)", so whether a row
            # is the total is carried as its own sortable column rather than
            # inferred from the label.
            ("is total", "grouping_flag = 1"),
        ]
        outer_group = "GROUP BY grouping_flag, dim_value"
        # Total first, then the busiest dimension values — an alias from the
        # SELECT above, so the ordering is by the number actually reported.
        order = f"ORDER BY {q('is total')} DESC, {q('events (event)')} DESC"
    else:
        group = "GROUP BY period_label, is_event"
        head = [("scope", s("(all values)")), ("is total", "true")]
        outer_group = ""
        order = ""

    def pair(expr):
        return (f"COALESCE(SUM(CASE WHEN is_event THEN {expr} END), 0)",
                _baseline_avg(expr, n_base))

    cols, formats = list(head), {head[0][0]: "text", "is total": "text"}
    ev, base = pair("events_n")
    cols += _delta_columns("events", ev, base)
    ev_ent, base_ent = pair("entities_n")
    cols += _delta_columns(f"distinct {entity}", ev_ent, base_ent)
    for m in measures:
        e, b = pair(q("sum_" + m))
        cols += _delta_columns(m, e, b)
    for name, _ in cols[2:]:
        formats[name] = "pct" if name.endswith("% delta") else (
            "count" if name.endswith("(event)") else "amount")

    select = ",\n    ".join(f"{expr} AS {q(name)}" for name, expr in cols)
    sql = f"""WITH {_periods_cte(windows)},
{_scoped_cte(table, roles, windows, carried)},
per_period AS (
  SELECT {', '.join(inner)}
  FROM scoped
  {group}
)
SELECT
    {select}
FROM per_period
{outer_group}
{order}"""
    return _sub(key, title, label, sql, formats)


def _entity_metrics(table: str, roles: dict, windows: dict) -> dict:
    key = "entity_metrics"
    title = "Entity metrics"
    n_base = windows["baseline_periods"]
    entity = roles["entity"]["column"]
    measures = roles["measure"]["column"] or []
    description = (f"Per-{entity} volume and intensity over the event window, each "
                   f"against the baseline average")
    if not n_base:
        return _sub(key, title, description, skipped=windows["note"])

    carried = [entity, roles["event_key"]["column"], *measures]
    agg_cols = [
        "period_label", "is_event",
        f"CAST(COUNT(DISTINCT {q(entity)}) AS DOUBLE) AS entities_n",
        f"CAST({_events_expr(roles)} AS DOUBLE) AS events_n",
    ] + [f"CAST(SUM({q(m)}) AS DOUBLE) AS {q('sum_' + m)}" for m in measures]

    # (label, expression over `agg`, kind). "total" metrics are summed across
    # the baseline periods and divided by their number; "ratio" metrics are
    # averaged over the periods that produced one, because a ratio in a period
    # with no rows is undefined rather than zero.
    metrics: list[tuple[str, str, str]] = [
        (f"Distinct {entity}", "entities_n", "total"),
        ("Events", "events_n", "total"),
        (f"Events per {entity}", "events_n / NULLIF(entities_n, 0)", "ratio"),
    ]
    for m in measures:
        col = q("sum_" + m)
        metrics += [
            (f"Total {m}", col, "total"),
            (f"{m} per {entity}", f"{col} / NULLIF(entities_n, 0)", "ratio"),
            (f"{m} per event", f"{col} / NULLIF(events_n, 0)", "ratio"),
        ]

    union = "\n  UNION ALL ".join(
        f"SELECT {i} AS sort_order, {s(label)} AS metric_name, {s(kind)} AS value_kind, "
        f"is_event, {expr} AS metric_value FROM agg"
        for i, (label, expr, kind) in enumerate(metrics)
    )

    sql = f"""WITH {_periods_cte(windows)},
{_scoped_cte(table, roles, windows, carried)},
agg AS (
  SELECT {', '.join(agg_cols)}
  FROM scoped
  GROUP BY period_label, is_event
),
metrics AS (
  {union}
),
paired AS (
  SELECT
    sort_order,
    metric_name,
    MAX(CASE WHEN is_event THEN metric_value END) AS event_value,
    CASE WHEN MAX(value_kind) = {s('ratio')}
         THEN AVG(CASE WHEN NOT is_event THEN metric_value END)
         ELSE COALESCE(SUM(CASE WHEN NOT is_event THEN metric_value END), 0) / {n_base}.0
    END AS baseline_value
  FROM metrics
  GROUP BY sort_order, metric_name
)
SELECT
    metric_name AS {q('Metric')},
    event_value AS {q('Event')},
    baseline_value AS {q('Baseline avg')},
    (event_value - baseline_value) AS {q('Delta')},
    ((event_value - baseline_value) / NULLIF(baseline_value, 0)) AS {q('% delta')}
FROM paired
ORDER BY sort_order"""
    formats = {"Metric": "text", "Event": "amount", "Baseline avg": "amount",
               "Delta": "amount", "% delta": "pct"}
    return _sub(key, title, description, sql, formats)


def _cross_dimension(table: str, roles: dict, windows: dict) -> dict:
    key = "cross_dimension"
    entity = roles["entity"]["column"]
    dim = roles["cross_dim"]["column"]
    title = "Cross-dimension"
    description = (f"How many {entity} values span 2 or more {dim} values during the "
                   f"event window, and what share of the total they account for"
                   if dim else "Entities spanning more than one dimension value")
    if not dim:
        return _sub(key, title, description, skipped=roles["cross_dim"]["why"])

    measures = roles["measure"]["column"] or []
    carried = [entity, dim, *measures]
    share_cols, formats = [], {}
    for m in measures:
        share_cols.append(
            f"(SUM(CASE WHEN n_dims >= 2 THEN {q('sum_' + m)} END) / "
            f"NULLIF(SUM({q('sum_' + m)}), 0)) AS {q('share of ' + m)}"
        )
        formats[f"share of {m}"] = "pct"

    sql = f"""WITH {_scoped_cte(table, roles, windows, carried, event_only=True)},
per_entity AS (
  SELECT
    {q(entity)} AS entity_value,
    COUNT(DISTINCT {q(dim)}) AS n_dims
    {''.join(f', SUM({q(m)}) AS {q("sum_" + m)}' for m in measures)}
  FROM scoped
  WHERE {q(entity)} IS NOT NULL
  GROUP BY {q(entity)}
)
SELECT
    COUNT(*) AS {q(entity + ' analysed')},
    COUNT(*) FILTER (WHERE n_dims >= 2) AS {q(entity + ' spanning 2+ ' + dim)},
    (COUNT(*) FILTER (WHERE n_dims >= 2) * 1.0 / NULLIF(COUNT(*), 0))
        AS {q('share of ' + entity)},
    AVG(n_dims) AS {q('mean ' + dim + ' per ' + entity)}
    {(', ' + ', '.join(share_cols)) if share_cols else ''}
FROM per_entity"""
    formats.update({
        f"{entity} analysed": "count",
        f"{entity} spanning 2+ {dim}": "count",
        f"share of {entity}": "pct",
        f"mean {dim} per {entity}": "amount",
    })
    return _sub(key, title, description, sql, formats)


def _affinity(table: str, roles: dict, windows: dict) -> dict:
    key = "affinity"
    entity = roles["entity"]["column"]
    dim = roles["cross_dim"]["column"]
    title = "Affinity"
    description = (f"The {dim} pairs most often visited by the same {entity} during "
                   f"the event window, top {_MAX_AFFINITY_PAIRS}"
                   if dim else "Co-occurring dimension pairs")
    if not dim:
        return _sub(key, title, description, skipped=roles["cross_dim"]["why"])

    # The self-join runs over distinct (entity, dimension) pairs — one row per
    # actor per value — not over the fact rows. That is what keeps a quadratic
    # step bounded by entities × dimension values instead of by transactions
    # squared (§17.4). CAST to VARCHAR so the a<b ordering that halves the join
    # works whatever the column's type is.
    sql = f"""WITH {_scoped_cte(table, roles, windows, [entity, dim], event_only=True)},
entity_dims AS (
  SELECT DISTINCT {q(entity)} AS entity_value, CAST({q(dim)} AS VARCHAR) AS dim_value
  FROM scoped
  WHERE {q(entity)} IS NOT NULL AND {q(dim)} IS NOT NULL
)
SELECT
    a.dim_value AS {q(dim + ' A')},
    b.dim_value AS {q(dim + ' B')},
    COUNT(*) AS {q('shared ' + entity)}
FROM entity_dims a
JOIN entity_dims b
  ON a.entity_value = b.entity_value AND a.dim_value < b.dim_value
GROUP BY a.dim_value, b.dim_value
ORDER BY {q('shared ' + entity)} DESC
LIMIT {_MAX_AFFINITY_PAIRS}"""
    formats = {f"{dim} A": "text", f"{dim} B": "text", f"shared {entity}": "count"}
    return _sub(key, title, description, sql, formats)


def _new_vs_returning(table: str, roles: dict, windows: dict) -> dict:
    key = "new_vs_returning"
    entity = roles["entity"]["column"]
    time_col = roles["time"]["column"]
    title = "New vs returning"
    description = (f"{entity} values seen for the first time during the event window "
                   f"against those with earlier history")
    start = windows["event"]["start"]
    if not windows["data_start"] or windows["data_start"] >= start:
        return _sub(key, title, description, skipped=(
            f"The data starts on {windows['data_start']}, which is not before the "
            f"event window ({start}), so there is no history against which an "
            f"{entity} could be new or returning."))

    sql = f"""WITH first_seen AS (
  SELECT {q(entity)} AS entity_value, MIN({_day(time_col)}) AS first_day
  FROM {q(table)}
  WHERE {q(entity)} IS NOT NULL
  GROUP BY {q(entity)}
),
in_event AS (
  SELECT DISTINCT {q(entity)} AS entity_value
  FROM {q(table)}
  WHERE {q(entity)} IS NOT NULL
    AND {_day(time_col)} BETWEEN {_date(start)} AND {_date(windows['event']['end'])}
)
SELECT
    COUNT(*) AS {q(entity + ' in event window')},
    COUNT(*) FILTER (WHERE f.first_day >= {_date(start)}) AS {q('new ' + entity)},
    COUNT(*) FILTER (WHERE f.first_day < {_date(start)}) AS {q('returning ' + entity)},
    (COUNT(*) FILTER (WHERE f.first_day >= {_date(start)}) * 1.0 / NULLIF(COUNT(*), 0))
        AS {q('share new')}
FROM in_event i
JOIN first_seen f ON i.entity_value = f.entity_value"""
    formats = {
        f"{entity} in event window": "count", f"new {entity}": "count",
        f"returning {entity}": "count", "share new": "pct",
    }
    return _sub(key, title, description, sql, formats)


def plan_sub_analyses(table: str, roles: dict, windows: dict) -> list[dict]:
    """The ordered plan of §17.3, emitted before any of it runs so the UI can
    show it and the user can cancel. Sub-analyses whose roles did not resolve
    are present and marked skipped — the plan states what will not happen."""
    return [
        build(table, roles, windows)
        for build in (_event_vs_baseline, _entity_metrics, _cross_dimension,
                      _affinity, _new_vs_returning)
    ]


# ── Interpretation (§17.3) ────────────────────────────────────────────────────
#
# Findings are read off the aggregates rather than asked for: every sentence
# below is a number that is in the workbook, so a reader can check it. The model
# is given these findings and writes the narrative over them — it is never the
# source of a figure.

def _fmt(value, kind: str = "amount") -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "not measured"
    if kind == "pct":
        return f"{value * 100:+.1f}%"
    if kind == "count" or (isinstance(value, (int,)) and not isinstance(value, bool)):
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def _cell(row, column):
    value = row.get(column)
    return None if value is None or pd.isna(value) else value


def findings_for(sub: dict, df: pd.DataFrame) -> list[str]:
    """Factual findings for one sub-analysis, in the vocabulary of the columns
    that actually came back."""
    if df is None or df.empty:
        return [f"{sub['title']}: the query returned no rows for this window."]

    out: list[str] = []
    pct_cols = [c for c in df.columns if str(c).endswith("% delta")]

    if sub["key"] == "event_vs_baseline":
        totals = df[df["is total"] == True] if "is total" in df.columns else df  # noqa: E712
        total = totals.iloc[0] if len(totals) else df.iloc[0]
        for column in pct_cols:
            base = str(column)[: -len(" % delta")]
            out.append(
                f"{base}: {_fmt(_cell(total, f'{base} (event)'))} over the event window "
                f"against a baseline average of {_fmt(_cell(total, f'{base} (baseline avg)'))} "
                f"({_fmt(_cell(total, column), 'pct')})."
            )
        rest = df[df["is total"] != True] if "is total" in df.columns else df.iloc[0:0]  # noqa: E712
        if len(rest) and pct_cols:
            lead, dim = pct_cols[0], df.columns[0]
            ranked = rest.dropna(subset=[lead]).sort_values(lead, ascending=False)
            if len(ranked):
                top, bottom = ranked.iloc[0], ranked.iloc[-1]
                out.append(f"Strongest {lead[:-len(' % delta')]} movement: {dim} "
                           f"{top[dim]} at {_fmt(_cell(top, lead), 'pct')}.")
                if len(ranked) > 1:
                    out.append(f"Weakest: {dim} {bottom[dim]} at "
                               f"{_fmt(_cell(bottom, lead), 'pct')}.")

    elif sub["key"] == "entity_metrics":
        ranked = df.dropna(subset=["% delta"]).reindex(
            df["% delta"].abs().sort_values(ascending=False).index).dropna(subset=["Metric"])
        for _, row in ranked.head(4).iterrows():
            out.append(f"{row['Metric']}: {_fmt(_cell(row, 'Event'))} against a baseline "
                       f"of {_fmt(_cell(row, 'Baseline avg'))} "
                       f"({_fmt(_cell(row, '% delta'), 'pct')}).")

    else:
        # One-row summaries (cross-dimension, new vs returning) and ranked pairs
        # (affinity) both read naturally as their leading row. Each value is
        # rendered in the kind the sub-analysis declared for its column, so a
        # count is not printed as a percentage because its name begins "shared".
        row = df.iloc[0]
        parts = [f"{c} {_fmt(_cell(row, c), sub['formats'].get(c, 'amount'))}"
                 for c in df.columns if not isinstance(_cell(row, c), str)]
        leading = [f"{c} {row[c]}" for c in df.columns if isinstance(_cell(row, c), str)]
        out.append(f"{sub['title']}: " + ", ".join(leading + parts) + ".")
        if sub["key"] == "affinity" and len(df) > 1:
            out.append(f"{len(df)} co-occurring pairs ranked; the sheet holds them all.")

    # Anomalies across dimension values, where there are enough of them to say
    # anything. Only on the event-vs-baseline sheet: its rows are one dimension
    # value each and so are comparable, whereas the metric sheet's rows mix
    # counts, sums and ratios and an outlier among them would mean nothing.
    # `detect_anomalies` returns its own "too few to call" note rather than a
    # verdict, so nothing is flagged on four rows.
    if sub["key"] == "event_vs_baseline" and pct_cols and len(df) >= 8:
        from anomaly import detect_anomalies, describe_anomalies
        found = detect_anomalies(df, measure_col=pct_cols[0], date_col=None)
        if found.get("found"):
            out.append(f"Unusual values in {pct_cols[0]}: {describe_anomalies(found)}")
    return out


def narrative_prompt(roles: dict, windows: dict, findings: list[dict]) -> str:
    """The one prompt that turns every sub-analysis's findings into a narrative.

    The model is told the figures and told not to add any — the workbook is
    forwarded without the conversation, so a number in the Narrative sheet that
    is in no other sheet would be unverifiable.
    """
    resolved = "\n".join(
        f"- {role}: {entry['column']} ({entry['source']}) — {entry['why']}"
        for role, entry in roles.items()
    )
    body = "\n\n".join(
        f"{f['title']} — {f['description']}\n" + "\n".join(f"  * {line}" for line in f["findings"])
        for f in findings if f["findings"]
    )
    return f"""You are a senior business analyst writing up a discrete event.

WHAT EACH COLUMN MEANS IN THIS DATASET:
{resolved}

WINDOWS:
Event window {windows['event']['start']} to {windows['event']['end']}.
{windows['note']}

MEASURED FINDINGS:
{body}

Write the findings up for someone who will read the spreadsheet without this
conversation. Rules:
- Use ONLY the figures above. Do not introduce a number that is not listed.
- One finding per line, no numbering, no headings, no markdown.
- Name the columns as they are named above.
- If the findings do not support a conclusion, say what is not known.

FINDINGS:"""

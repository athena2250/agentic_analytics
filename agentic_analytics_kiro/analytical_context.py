"""
Structured analytical state for a session (plan §11).

Every turn today is understood only as free text: `session.history` keeps the
question and the raw SQL, and follow-ups like "only California" work only to
the extent the LLM re-reads that text. This module derives a structured
`AnalyticalContext` — what is being measured, broken down by what, filtered how,
over which period — from the SQL that actually ran, so the state is inspectable
(the UI can show it), adjustable (the UI can offer to drop a filter) and
feedable back into SQL generation as facts rather than prose.

The derivation is a real parse, not a regex guess: DuckDB's own parser is asked
for the statement's AST via `json_serialize_sql`, so what comes back is what
DuckDB understood the query to mean. Anything the walk below can't confidently
structure is *counted*, not invented — the context then carries `partial: true`
and the UI says some of the query isn't represented rather than showing a
half-truth as the whole state (plan §1).

Nothing here knows a column name in advance. Which columns are dates comes from
the session profile's `role` labels; metric/dimension come from the query's own
aggregates and GROUP BY.
"""
from __future__ import annotations

import json

import duckdb

# Aggregates that make a select-list entry "the metric being measured".
# `count_star` is DuckDB's spelling of COUNT(*) — it has no column argument,
# which is why the metric column can legitimately be None while an aggregate
# is present.
_AGGREGATES = {
    "sum", "avg", "mean", "count", "count_star", "min", "max", "median",
    "stddev", "stddev_pop", "stddev_samp", "var_pop", "var_samp", "quantile",
    "quantile_cont", "quantile_disc", "first", "last", "any_value",
    "approx_count_distinct", "product", "mode",
}

_COMPARISONS = {
    "COMPARE_EQUAL": "=",
    "COMPARE_NOTEQUAL": "!=",
    "COMPARE_LESSTHAN": "<",
    "COMPARE_GREATERTHAN": ">",
    "COMPARE_LESSTHANOREQUALTO": "<=",
    "COMPARE_GREATERTHANOREQUALTO": ">=",
    "COMPARE_DISTINCT_FROM": "IS DISTINCT FROM",
    "COMPARE_NOT_DISTINCT_FROM": "IS NOT DISTINCT FROM",
}

# DuckDB represents LIKE/ILIKE as operator-functions; the UI should show the
# SQL spelling the user would recognise.
_OPERATOR_FUNCTIONS = {
    "~~": "LIKE",
    "~~*": "ILIKE",
    "!~~": "NOT LIKE",
    "!~~*": "NOT ILIKE",
}

_LOWER_OPS = {">", ">="}
_UPPER_OPS = {"<", "<="}


# ── AST helpers ───────────────────────────────────────────────────────────────

def _ast(sql: str, con: duckdb.DuckDBPyConnection) -> dict | None:
    """The first statement's node, or None if DuckDB can't parse the SQL."""
    try:
        raw = con.execute("SELECT json_serialize_sql(?)", [sql]).fetchone()[0]
        parsed = json.loads(raw)
    except Exception:
        return None
    if parsed.get("error") or not parsed.get("statements"):
        return None
    return parsed["statements"][0].get("node")


def _unwrap(node: dict | None) -> dict | None:
    """Strip casts, so `d >= DATE '2024-01-01'` reads as the constant it wraps."""
    while isinstance(node, dict) and node.get("type") == "OPERATOR_CAST":
        node = node.get("child")
    return node if isinstance(node, dict) else None


def _column_of(node: dict | None) -> str | None:
    """The column a node refers to: itself if it's a column reference, else the
    first one found beneath it (so `strftime(d, ...)` resolves to `d`)."""
    node = _unwrap(node)
    if not node:
        return None
    if node.get("class") == "COLUMN_REF":
        names = node.get("column_names") or []
        return names[-1] if names else None      # drop any table qualifier
    for child in node.get("children") or []:
        found = _column_of(child)
        if found:
            return found
    return None


def _constant(node: dict | None):
    """The Python value of a constant node, or None if it isn't one."""
    node = _unwrap(node)
    if not node or node.get("class") != "CONSTANT":
        return None
    value = node.get("value") or {}
    return None if value.get("is_null") else value.get("value")


def _expression_label(node: dict | None) -> str | None:
    """A short, readable label for a select/group expression, e.g. `d` or
    `strftime(d)`. Used for display only — never parsed back."""
    node = _unwrap(node)
    if not node:
        return None
    if node.get("class") == "COLUMN_REF":
        return _column_of(node)
    if node.get("class") == "FUNCTION":
        inner = _column_of(node)
        name = node.get("function_name")
        return f"{name}({inner})" if inner else name
    return None


# ── Predicate extraction ──────────────────────────────────────────────────────

def _leaf_predicate(node: dict) -> dict | None:
    """One WHERE condition as {column, op, value}, or None when this node isn't
    a shape the strip can honestly render."""
    cls, ntype = node.get("class"), node.get("type")

    if cls == "COMPARISON" and ntype in _COMPARISONS:
        column = _column_of(node.get("left"))
        value = _constant(node.get("right"))
        if column is not None and value is not None:
            return {"column": column, "op": _COMPARISONS[ntype], "value": value}
        return None

    if cls == "BETWEEN":
        column = _column_of(node.get("input"))
        lower, upper = _constant(node.get("lower")), _constant(node.get("upper"))
        if column is not None and lower is not None and upper is not None:
            return {"column": column, "op": "BETWEEN", "value": [lower, upper]}
        return None

    if cls == "OPERATOR":
        children = node.get("children") or []
        column = _column_of(children[0]) if children else None
        if column is None:
            return None
        if ntype == "COMPARE_IN":
            values = [_constant(c) for c in children[1:]]
            if values and all(v is not None for v in values):
                return {"column": column, "op": "IN", "value": values}
            return None
        if ntype == "COMPARE_NOT_IN":
            values = [_constant(c) for c in children[1:]]
            if values and all(v is not None for v in values):
                return {"column": column, "op": "NOT IN", "value": values}
            return None
        if ntype in ("OPERATOR_IS_NULL", "OPERATOR_IS_NOT_NULL"):
            op = "IS NULL" if ntype == "OPERATOR_IS_NULL" else "IS NOT NULL"
            return {"column": column, "op": op, "value": None}
        return None

    if cls == "FUNCTION" and node.get("function_name") in _OPERATOR_FUNCTIONS:
        children = node.get("children") or []
        if len(children) >= 2:
            column = _column_of(children[0])
            value = _constant(children[1])
            if column is not None and value is not None:
                return {"column": column, "op": _OPERATOR_FUNCTIONS[node["function_name"]], "value": value}
    return None


def _split_where(node: dict | None) -> tuple[list[dict], list[list[dict]], int]:
    """Flatten a WHERE clause into (AND-ed predicates, OR branches, unparsed).

    AND is the only connective the strip's flat filter list can represent, so
    ANDs are flattened and each OR branch is kept as its own group — the one
    thing that is then done with OR groups is recognising a period-vs-period
    comparison (below). `unparsed` counts conditions that survived neither
    route, which is what sets `partial` on the context.
    """
    predicates: list[dict] = []
    or_groups: list[list[dict]] = []
    unparsed = 0

    def branch(n: dict) -> tuple[list[dict], int]:
        """Predicates of one OR branch, plus how many of its conditions were
        not understood."""
        if n.get("type") == "CONJUNCTION_AND":
            found, missed = [], 0
            for child in n.get("children") or []:
                sub, sub_missed = branch(child)
                found += sub
                missed += sub_missed
            return found, missed
        parsed = _leaf_predicate(n)
        return ([parsed], 0) if parsed else ([], 1)

    def walk(n: dict | None) -> None:
        nonlocal unparsed
        if not isinstance(n, dict):
            return
        if n.get("type") == "CONJUNCTION_AND":
            for child in n.get("children") or []:
                walk(child)
            return
        if n.get("type") == "CONJUNCTION_OR":
            for child in n.get("children") or []:
                found, missed = branch(child)
                unparsed += missed
                or_groups.append(found)
            return
        parsed = _leaf_predicate(n)
        if parsed:
            predicates.append(parsed)
        else:
            unparsed += 1

    walk(node)
    return predicates, or_groups, unparsed


def _range_from(predicates: list[dict]) -> dict | None:
    """Turn date predicates on one column into a {from, to} range."""
    bounds: dict = {"from": None, "to": None}
    for p in predicates:
        if p["op"] == "BETWEEN":
            bounds["from"], bounds["to"] = p["value"][0], p["value"][1]
        elif p["op"] == "=":
            bounds["from"] = bounds["to"] = p["value"]
        elif p["op"] in _LOWER_OPS:
            bounds["from"] = p["value"]
        elif p["op"] in _UPPER_OPS:
            bounds["to"] = p["value"]
    if bounds["from"] is None and bounds["to"] is None:
        return None
    return bounds


def _period(column: str, predicates: list[dict]) -> dict | None:
    rng = _range_from(predicates)
    if not rng:
        return None
    return {"column": column, "range": rng}


def _period_start(period: dict) -> str:
    """Sort key for two periods on the same column: whichever range starts
    later is the current one, the other is what it's being compared against."""
    rng = period["range"]
    return str(rng["from"] if rng["from"] is not None else rng["to"])


# ── Tables ────────────────────────────────────────────────────────────────────

def _tables(node) -> list[str]:
    """Every base table named anywhere in the statement, in order of appearance."""
    found: list[str] = []

    def walk(n):
        if isinstance(n, list):
            for item in n:
                walk(item)
            return
        if not isinstance(n, dict):
            return
        if n.get("type") == "BASE_TABLE" and n.get("table_name"):
            if n["table_name"] not in found:
                found.append(n["table_name"])
        for value in n.values():
            walk(value)

    walk(node)
    return found


# ── Metric / dimension ────────────────────────────────────────────────────────

def _metric(node: dict) -> tuple[str | None, str | None, str | None]:
    """(column, aggregate, label) for the first aggregate in the select list."""
    for item in node.get("select_list") or []:
        entry = _unwrap(item)
        if not entry or entry.get("class") != "FUNCTION":
            continue
        name = (entry.get("function_name") or "").lower()
        if name not in _AGGREGATES:
            continue
        column = _column_of(entry)
        agg = "count" if name == "count_star" else name
        label = entry.get("alias") or (f"{agg.upper()}({column})" if column else f"{agg.upper()}(*)")
        return column, agg, label
    return None, None, None


def _dimension(node: dict) -> tuple[str | None, str | None]:
    """(column, label) for the first GROUP BY expression. Positional group-bys
    (`GROUP BY 1`) are resolved against the select list, which is what DuckDB
    itself does with them."""
    for expr in node.get("group_expressions") or []:
        target = _unwrap(expr)
        if not target:
            continue
        position = _constant(target)
        if isinstance(position, int):
            select_list = node.get("select_list") or []
            if not 1 <= position <= len(select_list):
                continue
            target = _unwrap(select_list[position - 1])
            if not target:
                continue
        column = _column_of(target)
        if column:
            return column, (target.get("alias") or _expression_label(target) or column)
    return None, None


# ── Public API ────────────────────────────────────────────────────────────────

def date_columns(profile: dict | None) -> set[str]:
    """Columns the profiler labelled as dates, across every table. The only
    thing that makes a filter a *time* filter rather than an ordinary one —
    no column-name heuristics live here (plan §1)."""
    names: set[str] = set()
    for table in (profile or {}).values():
        for col in table.get("columns") or []:
            if col.get("role") == "date":
                names.add(col["name"])
    return names


def empty_context(dataset_id: str | None = None, question: str | None = None) -> dict:
    """The shape of §11's AnalyticalContext with nothing resolved — what a
    session returns before its first turn, and what an unparseable query
    produces."""
    return {
        "dataset_id": dataset_id,
        "metric": None,
        "metric_aggregate": None,
        "metric_label": None,
        "dimension": None,
        "dimension_label": None,
        "filters": [],
        "time_period": None,
        "comparison_period": None,
        "tables": [],
        "last_question": question,
        "last_finding_summary": None,
        "parsed": False,
        "partial": False,
    }


def derive_context(
    sql: str,
    con: duckdb.DuckDBPyConnection,
    profile: dict | None,
    question: str,
    dataset_id: str | None = None,
) -> dict:
    """Derive §11's AnalyticalContext from the SQL that ran.

    Never raises: a query this can't parse yields the empty context with
    `parsed: false`, which the UI renders as "not shown" rather than as an
    analysis of nothing.
    """
    context = empty_context(dataset_id, question)

    node = _ast(sql, con)
    if not node or node.get("type") != "SELECT_NODE":
        return context

    context["parsed"] = True
    context["tables"] = _tables(node)
    context["metric"], context["metric_aggregate"], context["metric_label"] = _metric(node)
    context["dimension"], context["dimension_label"] = _dimension(node)

    predicates, or_groups, unparsed = _split_where(node.get("where_clause"))
    dates = date_columns(profile)

    # Time filters are pulled out of the flat filter list into their own field
    # (§11): the strip shows a period as a period, and dropping "just the date
    # range" stays a single action.
    time_predicates: dict[str, list[dict]] = {}
    filters: list[dict] = []
    for predicate in predicates:
        if predicate["column"] in dates:
            time_predicates.setdefault(predicate["column"], []).append(predicate)
        else:
            filters.append(predicate)

    periods = [p for col, preds in time_predicates.items() if (p := _period(col, preds))]

    # A period-vs-period query ("this quarter vs last") reaches SQL as an OR of
    # two ranges on the same date column. That exact shape is recognised and
    # becomes time_period + comparison_period; any other OR is state this flat
    # structure can't represent, so it counts as unparsed instead.
    or_periods: list[dict] = []
    unparsable_or = 0
    for group in or_groups:
        columns = {p["column"] for p in group}
        period = _period(next(iter(columns)), group) if len(columns) == 1 and columns <= dates else None
        if period:
            or_periods.append(period)
        else:
            unparsable_or += len(group) or 1

    if len(or_periods) >= 2 and len({p["column"] for p in or_periods}) == 1:
        or_periods.sort(key=_period_start)
        context["comparison_period"] = or_periods[-2]
        periods.append(or_periods[-1])
        # Three or more OR-ed ranges is more than "current vs previous"; the
        # extras are state the two fields can't hold.
        unparsable_or += len(or_periods) - 2
    else:
        # Date ranges OR-ed together that aren't a comparison pair — real
        # filtering the flat structure doesn't represent.
        unparsable_or += len(or_periods)
    unparsed += unparsable_or

    if periods:
        # More than one dated column is filtered; the first is shown as the
        # period and the rest stay visible as ordinary filters rather than
        # being dropped from the state.
        context["time_period"] = periods[0]
        for extra in periods[1:]:
            filters += time_predicates.get(extra["column"], [])

    context["filters"] = filters
    context["partial"] = unparsed > 0
    return context


def summarize_result(df, context: dict) -> str | None:
    """A factual one-line summary of what the turn returned, carried forward as
    `last_finding_summary`. Reports only what is in the frame — row count, and
    the leading row's dimension/metric values when the query had them — so a
    later turn is reminded of the finding without it being editorialised."""
    if df is None:
        return None
    rows = len(df)
    if rows == 0:
        return "0 rows"
    summary = f"{rows} row{'' if rows == 1 else 's'}"

    top = df.iloc[0]
    parts = []
    dimension = context.get("dimension")
    if dimension and dimension in df.columns:
        parts.append(f"{dimension}={top[dimension]}")
    # The metric usually comes back under its alias rather than its source
    # column name, so the alias is tried first.
    for name in (context.get("metric_label"), context.get("metric")):
        if name and name in df.columns:
            parts.append(f"{name}={top[name]}")
            break
    if parts:
        summary += f"; first row {', '.join(parts)}"
    return summary


def _format_value(value) -> str:
    if isinstance(value, list):
        return ", ".join(_format_value(v) for v in value)
    if isinstance(value, str):
        return f"'{value}'"
    return str(value)


def describe_filter(predicate: dict) -> str:
    """One filter as the SQL fragment it came from, e.g. `state = 'NY'`."""
    if predicate["op"] in ("IS NULL", "IS NOT NULL"):
        return f'{predicate["column"]} {predicate["op"]}'
    if predicate["op"] == "BETWEEN":
        low, high = predicate["value"]
        return f'{predicate["column"]} BETWEEN {_format_value(low)} AND {_format_value(high)}'
    if predicate["op"] in ("IN", "NOT IN"):
        return f'{predicate["column"]} {predicate["op"]} ({_format_value(predicate["value"])})'
    return f'{predicate["column"]} {predicate["op"]} {_format_value(predicate["value"])}'


def describe_period(period: dict) -> str:
    rng = period["range"]
    if rng["from"] is not None and rng["to"] is not None:
        span = f'{rng["from"]} to {rng["to"]}'
    elif rng["from"] is not None:
        span = f'from {rng["from"]}'
    else:
        span = f'up to {rng["to"]}'
    return f'{period["column"]} {span}'


def describe_context(context: dict | None) -> str | None:
    """The context as a few lines of plain text for the SQL-generation prompt.

    This is the point of deriving the state at all (plan §11): a follow-up like
    "only California" is answered against stated facts — this is the measure,
    this is the breakdown, these are the filters in force — instead of the LLM
    having to re-read the previous SQL and infer them. Returns None when there
    is no state worth stating, so the prompt gains nothing empty.
    """
    if not context or not context.get("parsed"):
        return None

    lines = []
    if context.get("metric_aggregate"):
        column = context.get("metric")
        lines.append(f'- measuring: {context["metric_aggregate"].upper()}({column or "*"})')
    if context.get("dimension"):
        lines.append(f'- broken down by: {context["dimension"]}')
    if context.get("filters"):
        lines.append("- filters: " + " AND ".join(describe_filter(f) for f in context["filters"]))
    if context.get("time_period"):
        lines.append(f'- time period: {describe_period(context["time_period"])}')
    if context.get("comparison_period"):
        lines.append(f'- compared with: {describe_period(context["comparison_period"])}')
    if context.get("last_finding_summary"):
        lines.append(f'- last result: {context["last_finding_summary"]}')
    if context.get("partial"):
        # Said out loud so the model doesn't treat the list above as exhaustive
        # and silently drop a condition the previous query had.
        lines.append("- note: parts of the previous query are not captured above; see its SQL")

    return "\n".join(lines) if lines else None

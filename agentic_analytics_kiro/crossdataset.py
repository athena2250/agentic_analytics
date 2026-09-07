"""
Cross-dataset reasoning: how a session's tables relate, and how two measures
living in different tables move together (plan §16, first bullet).

A session has always been able to hold several tables — `load_files` registers
one per file — but nothing told the model how they connect, so a question
spanning two of them ("did campaign spend move with headcount cost?") either
got a single-table answer or an invented join. Two pieces close that:

  * `infer_relationships` — candidate join keys between every pair of tables,
    scored on *values* (how far one column's distinct set falls inside the
    other's) rather than on names alone, because two columns both called `id`
    are not a relationship and `campaign` ↔ `campaign_name` is.
  * `plan_correlation` / `correlation_sql` / `correlate` — time-aligning two
    measures on a shared calendar grain and measuring how they move together,
    with the honest caveats attached: correlation isn't causation, a short
    overlap isn't evidence, and scanning lags inflates the best one found.

Nothing here guesses a join and hands it to the user as fact: every returned
relationship carries the counts it was derived from, and every correlation
carries the number of periods it was computed over.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

# Join keys are drawn from these roles. A float measure is excluded: two tables
# whose `spend` columns happen to share values are not thereby joinable.
_KEY_ROLES = ("identifier", "dimension", "date")

# Below this share of overlapping distinct values the pair isn't a key, it's a
# coincidence. Measured against the smaller side's distinct set, so a small
# lookup table joining into a large fact table still scores high.
_MIN_OVERLAP = 0.3

# Names alone can carry a pair over the overlap floor when the overlap is real
# but partial (two months of one file, twelve of the other).
_NAME_BONUS = 0.15

# Pairwise column comparison is O(n²) in columns; this caps the work on a
# session holding many wide tables.
_MAX_PAIRS = 400

_TYPE_FAMILIES = (
    ("date", ("DATE", "TIMESTAMP")),
    ("number", ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT",
                "USMALLINT", "UINTEGER", "UBIGINT", "FLOAT", "DOUBLE", "DECIMAL", "REAL")),
    ("text", ("VARCHAR", "CHAR", "TEXT", "UUID")),
)


def _family(dtype: str) -> str:
    up = (dtype or "").upper()
    for name, prefixes in _TYPE_FAMILIES:
        if any(up.startswith(p) for p in prefixes):
            return name
    return "other"


def _normalize_name(name: str) -> str:
    """`campaign_id` / `campaignID` / `Campaign` all reduce to `campaign`."""
    n = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name).lower()
    n = re.sub(r"[^a-z0-9]+", "_", n).strip("_")
    return re.sub(r"_(id|key|code|no|num|uuid|guid)$", "", n) or n


def _name_affinity(left_table: str, left_col: str, right_table: str, right_col: str) -> float:
    """How much the two names alone suggest a join, in [0, 1]."""
    a, b = _normalize_name(left_col), _normalize_name(right_col)
    if a == b:
        return 1.0
    # `orders.customer_id` ↔ `customers.id`: one side names the other's table.
    for table, other in ((left_table, b), (right_table, a)):
        stem = _normalize_name(table).rstrip("s")
        if other and stem and (other == stem or other.startswith(stem) or stem.startswith(other)):
            return 0.7
    if a and b and (a in b or b in a):
        return 0.5
    return 0.0


def _key_columns(profile_for_table: dict) -> list[dict]:
    return [c for c in profile_for_table.get("columns", [])
            if c.get("role") in _KEY_ROLES and c.get("distinct_count")]


def infer_relationships(
    tables: dict[str, list[str]],
    con,
    profile: dict,
    max_pairs: int = _MAX_PAIRS,
) -> list[dict]:
    """Candidate joins between the session's tables, best first.

    Each record carries what it was measured from — distinct counts, matched
    distinct values, overlap share — so the UI and the SQL prompt can show a
    relationship as a candidate rather than assert it as schema.
    """
    names = [t for t in tables if t in profile]
    relationships: list[dict] = []
    pairs_checked = 0

    for i, left in enumerate(names):
        for right in names[i + 1:]:
            for lc in _key_columns(profile[left]):
                for rc in _key_columns(profile[right]):
                    if pairs_checked >= max_pairs:
                        break
                    if _family(lc["dtype"]) != _family(rc["dtype"]) or _family(lc["dtype"]) == "other":
                        continue
                    affinity = _name_affinity(left, lc["name"], right, rc["name"])
                    # Unrelated names still get checked, but only when the
                    # column looks like a key on at least one side.
                    if affinity == 0 and "identifier" not in (lc["role"], rc["role"]):
                        continue
                    pairs_checked += 1
                    rel = _score_pair(con, left, lc, right, rc, affinity)
                    if rel:
                        relationships.append(rel)

    relationships.sort(key=lambda r: r["confidence"], reverse=True)
    return relationships


def _score_pair(con, left: str, lc: dict, right: str, rc: dict, affinity: float) -> dict | None:
    """Measure the value overlap of one candidate pair."""
    lq, rq = f'"{lc["name"]}"', f'"{rc["name"]}"'
    try:
        matched = con.execute(
            f'SELECT COUNT(*) FROM ('
            f'  SELECT DISTINCT {lq} AS v FROM {left} WHERE {lq} IS NOT NULL'
            f'  INTERSECT'
            f'  SELECT DISTINCT {rq} AS v FROM {right} WHERE {rq} IS NOT NULL)'
        ).fetchone()[0]
    except Exception:
        return None

    left_distinct = lc.get("distinct_count") or 0
    right_distinct = rc.get("distinct_count") or 0
    smaller = min(left_distinct, right_distinct)
    if not smaller or not matched:
        return None

    overlap = matched / smaller
    confidence = min(1.0, overlap + affinity * _NAME_BONUS)
    if confidence < _MIN_OVERLAP:
        return None

    # Cardinality read off the distinct counts against the matched set: a side
    # whose distinct values are (nearly) all matched and unique is the "one".
    left_unique = matched >= left_distinct * 0.98
    right_unique = matched >= right_distinct * 0.98
    kind = ("one-to-one" if left_unique and right_unique else
            "one-to-many" if left_unique else
            "many-to-one" if right_unique else "many-to-many")

    return {
        "left_table": left, "left_column": lc["name"],
        "right_table": right, "right_column": rc["name"],
        "kind": kind,
        "matched_values": int(matched),
        "left_distinct": int(left_distinct),
        "right_distinct": int(right_distinct),
        "overlap": round(overlap, 3),
        "confidence": round(confidence, 3),
        "basis": [b for b, on in (("name", affinity > 0), ("values", overlap > 0)) if on],
    }


def describe_relationships(relationships: list[dict], limit: int = 8) -> str:
    """The join block handed to the SQL prompt.

    Phrased as candidates with their evidence, not as declared foreign keys, so
    a model that needs a different join isn't pushed into a wrong one.
    """
    if not relationships:
        return ""
    lines = []
    for r in relationships[:limit]:
        lines.append(
            f'  {r["left_table"]}."{r["left_column"]}" = {r["right_table"]}."{r["right_column"]}" '
            f'({r["kind"]}, {r["matched_values"]} shared values, '
            f'{int(r["overlap"] * 100)}% of the smaller side)'
        )
    return "\n".join(lines)


# ── Correlation across two tables ─────────────────────────────────────────────

# Calendar grains, coarsest spacing that still fits each.
_GRAINS = (("day", 1.0), ("week", 7.0), ("month", 31.0), ("quarter", 92.0))

# Fewer aligned periods than this and a correlation coefficient is noise.
_MIN_PERIODS = 8

# Lags scanned, in periods, when looking for a delayed relationship.
_MAX_LAG = 4


def _date_and_measure(profile_for_table: dict) -> tuple[str | None, list[str]]:
    date_col, measures = None, []
    for col in profile_for_table.get("columns", []):
        if col.get("role") == "date" and date_col is None and (col.get("confidence") or 0) >= 0.6:
            date_col = col["name"]
        elif col.get("role") == "measure":
            measures.append(col["name"])
    return date_col, measures


def _mentioned(question: str, name: str) -> bool:
    token = _normalize_name(name)
    return bool(token) and token.replace("_", " ") in _normalize_name(question).replace("_", " ")


def _span_days(profile_for_table: dict, date_col: str) -> float | None:
    for col in profile_for_table.get("columns", []):
        if col["name"] != date_col:
            continue
        lo, hi = pd.to_datetime(col.get("min"), errors="coerce"), pd.to_datetime(col.get("max"), errors="coerce")
        if pd.isna(lo) or pd.isna(hi):
            return None
        return float((hi - lo).days)
    return None


def plan_correlation(question: str, tables: dict, con, profile: dict) -> dict:
    """Decide which two measures, in which two tables, the question is asking
    to compare — and on what calendar grain.

    Returns {"ok": True, "left": {...}, "right": {...}, "grain": str} or
    {"ok": False, "reason": str}. The reason is written for the user: a
    correlation that can't be computed is explained, never silently skipped.
    """
    candidates = []
    for tname in tables:
        if tname not in profile:
            continue
        date_col, measures = _date_and_measure(profile[tname])
        if date_col and measures:
            candidates.append({"table": tname, "date": date_col, "measures": measures})

    if len(candidates) < 2:
        return {"ok": False, "reason": (
            "A cross-dataset correlation needs two tables that each have a date "
            "column and a numeric measure; this session has "
            f"{len(candidates)} such table(s)."
        )}

    # Prefer the tables and measures the question actually names; fall back to
    # the first two candidates so a vague question still gets an answer that
    # says plainly what it compared.
    scored = sorted(
        candidates,
        key=lambda c: (_mentioned(question, c["table"]),
                       any(_mentioned(question, m) for m in c["measures"])),
        reverse=True,
    )
    left, right = scored[0], scored[1]

    def pick_measure(c):
        named = [m for m in c["measures"] if _mentioned(question, m)]
        return named[0] if named else c["measures"][0]

    grain = _pick_grain(profile, left, right)
    if grain is None:
        return {"ok": False, "reason": (
            f"The date ranges in {left['table']} and {right['table']} are too "
            "short to align on any calendar grain."
        )}

    return {
        "ok": True,
        "grain": grain,
        "left": {"table": left["table"], "date": left["date"], "measure": pick_measure(left)},
        "right": {"table": right["table"], "date": right["date"], "measure": pick_measure(right)},
    }


def _pick_grain(profile: dict, left: dict, right: dict) -> str | None:
    """The finest grain that still yields enough periods on both sides."""
    spans = [_span_days(profile[c["table"]], c["date"]) for c in (left, right)]
    spans = [s for s in spans if s]
    if not spans:
        return None
    shortest = min(spans)
    for name, days in _GRAINS:
        if shortest / days >= _MIN_PERIODS:
            return name
    return None


def correlation_sql(spec: dict) -> str:
    """The aligned time series, as SQL DuckDB runs.

    Built here rather than asked of the model so the join is exactly the one
    reported to the user, and so the rows behind the coefficient are ordinary
    result rows — chartable, exportable, and visible in the SQL drawer.
    """
    grain = spec["grain"]
    left, right = spec["left"], spec["right"]
    la, ra = _alias(left), _alias(right)
    return (
        f'WITH left_side AS (\n'
        f'  SELECT DATE_TRUNC(\'{grain}\', "{left["date"]}") AS period,\n'
        f'         SUM("{left["measure"]}") AS "{la}"\n'
        f'  FROM {left["table"]} GROUP BY 1\n'
        f'), right_side AS (\n'
        f'  SELECT DATE_TRUNC(\'{grain}\', "{right["date"]}") AS period,\n'
        f'         SUM("{right["measure"]}") AS "{ra}"\n'
        f'  FROM {right["table"]} GROUP BY 1\n'
        f')\n'
        f'SELECT l.period AS period, l."{la}", r."{ra}"\n'
        f'FROM left_side l JOIN right_side r USING (period)\n'
        f'ORDER BY period'
    )


def _alias(side: dict) -> str:
    return f'{side["table"]}_{side["measure"]}'


def _pearson(a: np.ndarray, b: np.ndarray) -> float | None:
    if a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def _p_value(r: float, n: int) -> float | None:
    """Two-sided p for Pearson r, when scipy is importable (it ships with
    scikit-learn). Absent rather than approximated if it isn't."""
    if r is None or n <= 2 or abs(r) >= 1:
        return None
    try:
        from scipy import stats
    except Exception:
        return None
    t = r * np.sqrt((n - 2) / (1 - r ** 2))
    return float(2 * stats.t.sf(abs(t), n - 2))


def correlate(df: pd.DataFrame, spec: dict) -> dict:
    """Measure how the two aligned series move together.

    Reports Pearson (linear) and Spearman (monotonic) side by side — they
    disagree exactly when the relationship is real but not straight-line — plus
    the best lagged fit, with the caveat that scanning lags inflates it.
    """
    la, ra = _alias(spec["left"]), _alias(spec["right"])
    caveat = (
        "Correlation is not causation: an association here means the two series "
        "moved together over the aligned periods, not that one caused the other."
    )
    base = {
        "available": False,
        "grain": spec["grain"],
        "left": {**spec["left"], "column": la},
        "right": {**spec["right"], "column": ra},
        "caveat": caveat,
    }

    if la not in df.columns or ra not in df.columns:
        return {**base, "reason": "The aligned query returned neither measure."}

    pair = df[[la, ra]].apply(pd.to_numeric, errors="coerce").dropna()
    n = len(pair)
    if n < _MIN_PERIODS:
        return {**base, "periods": n, "reason": (
            f"Only {n} {spec['grain']}(s) overlap between "
            f"{spec['left']['table']} and {spec['right']['table']} — too few to "
            "read anything into a correlation."
        )}

    a = pair[la].to_numpy(dtype=float)
    b = pair[ra].to_numpy(dtype=float)
    pearson = _pearson(a, b)
    if pearson is None:
        return {**base, "periods": n, "reason": (
            "One of the two series never changes over the overlapping periods, "
            "so there is nothing to correlate."
        )}

    spearman = _pearson(pd.Series(a).rank().to_numpy(), pd.Series(b).rank().to_numpy())

    # Lag scan: b shifted forward means "the left series leads the right".
    lags = []
    max_lag = min(_MAX_LAG, n // 4)
    for lag in range(-max_lag, max_lag + 1):
        if lag == 0:
            r = pearson
            m = n
        else:
            x, y = (a[:-lag], b[lag:]) if lag > 0 else (a[-lag:], b[:lag])
            m = len(x)
            r = _pearson(x, y) if m >= _MIN_PERIODS else None
        if r is not None:
            lags.append({"lag": lag, "r": round(r, 4), "periods": m})
    best_lag = max(lags, key=lambda e: abs(e["r"])) if lags else None

    strength = ("strong" if abs(pearson) >= 0.7 else
                "moderate" if abs(pearson) >= 0.4 else
                "weak" if abs(pearson) >= 0.2 else "negligible")

    return {
        **base,
        "available": True,
        "periods": n,
        "pearson": round(pearson, 4),
        "spearman": None if spearman is None else round(spearman, 4),
        "p_value": _p_value(pearson, n),
        "direction": "positive" if pearson > 0 else "negative",
        "strength": strength,
        "lags": lags,
        "best_lag": best_lag,
        "lag_caveat": (
            f"{len(lags)} lags were tested; the strongest of several is expected "
            "to look better than the true relationship, so treat a best lag as a "
            "lead to check, not a finding."
        ) if len(lags) > 1 else None,
    }


def describe_correlation(result: dict) -> str:
    """Plain-language summary, used for the narrative and the analyst prompt."""
    left, right = result["left"], result["right"]
    pair = (f'{left["table"]}.{left["measure"]} and {right["table"]}.{right["measure"]}')
    if not result.get("available"):
        return f"No correlation was computed for {pair}: {result.get('reason', 'not enough aligned data.')}"

    parts = [
        f'Over {result["periods"]} aligned {result["grain"]}(s), {pair} show a '
        f'{result["strength"]} {result["direction"]} correlation '
        f'(Pearson r = {result["pearson"]}'
        + (f', Spearman = {result["spearman"]}' if result.get("spearman") is not None else "")
        + ").",
    ]
    if result.get("p_value") is not None:
        parts.append(f'p = {result["p_value"]:.3g}.')
    best = result.get("best_lag")
    if best and best["lag"] != 0:
        leader = left["table"] if best["lag"] > 0 else right["table"]
        parts.append(
            f'The strongest fit is at a lag of {abs(best["lag"])} {result["grain"]}(s) '
            f'(r = {best["r"]}), with {leader} moving first.'
        )
    parts.append(result["caveat"])
    if result.get("lag_caveat"):
        parts.append(result["lag_caveat"])
    return " ".join(parts)

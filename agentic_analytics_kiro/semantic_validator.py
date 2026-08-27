from __future__ import annotations

import re

NUMERIC_COLS = {"revenue", "cost"}

# Compiled once
_AGG_RE = re.compile(r"\b(sum|avg|min|max)\((\w+)\)")
_WHERE_RE = re.compile(r"\bwhere\b(.*)", re.DOTALL)
_STR_COMPARE_RE = {
    col: re.compile(rf"\b{col}\s*=\s*'[a-z]+'") for col in NUMERIC_COLS
}


def validate_semantics(sql: str) -> tuple[bool, str]:
    sql_lower = sql.lower()

    for func, col in _AGG_RE.findall(sql_lower):
        if col.strip() not in NUMERIC_COLS:
            return False, f"Invalid aggregation: {func}({col}) not allowed"

    m = _WHERE_RE.search(sql_lower)
    if m:
        conditions = m.group(1)
        for col, pattern in _STR_COMPARE_RE.items():
            if pattern.search(conditions):
                return False, f"Invalid filter: {col} compared to string"

    return True, "semantic valid"

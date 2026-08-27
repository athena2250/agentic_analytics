from __future__ import annotations

import re

# Compiled once at import time
_METRIC_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(sales|revenue)\b"), "net_sales"),
    (re.compile(r"\bmargin\b"), "margin_percent"),
    (re.compile(r"\bprofit\b"), "net_margin"),
    (re.compile(r"\btransactions?\b"), "transactions"),
    (re.compile(r"\btrips?\b"), "trips"),
    (re.compile(r"\bcustomers?\b"), "customer_count"),
]


def detect_metrics_from_query(query: str) -> list[str]:
    q = query.lower()
    seen: set[str] = set()
    for pattern, metric in _METRIC_PATTERNS:
        if pattern.search(q) and metric not in seen:
            seen.add(metric)
    return list(seen)

from __future__ import annotations
from metrics import METRIC_FN


def run_agent(df, parsed_plan: dict) -> dict:
    """Compute requested metrics via dispatch table — no if-chains."""
    result = {}
    for name in parsed_plan.get("metrics", []):
        fn = METRIC_FN.get(name)
        if fn:
            value = fn(df)
            if value is not None:
                result[name] = value
    return result

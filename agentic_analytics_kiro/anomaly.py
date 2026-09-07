"""
Robust anomaly detection for an arbitrary (date, measure) pair.

Replaces the mean ± 2σ heuristic the plan flags in §16. Three problems with
that rule, all fixed here:

  * The mean and standard deviation are themselves moved by the outliers being
    looked for, so a single extreme point raises the threshold above itself and
    hides the rest. The median and the median absolute deviation are not.
  * Two standard deviations flags ~5% of any normal series by construction —
    on 200 rows that is ten "anomalies" in data with none.
  * Only the upper tail was checked, so a collapse to zero was never an
    anomaly while an equally sized spike was.

The detector scores points by their modified z-score (Iglewicz–Hoaglin), after
removing a seasonal profile when the series has enough history to estimate one:
a Monday that is low for a Monday is an anomaly even if it sits comfortably
inside the overall spread.

Output is structured — one record per flagged point, plus the method and
threshold that produced them — so the UI can show what was found and the LLM
prompt can be built from the same facts instead of a printed DataFrame.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# 0.6745 is the 75th percentile of the standard normal: it puts the MAD on the
# same scale as a standard deviation, so the threshold below reads the way a
# sigma-threshold reads.
_MAD_SCALE = 0.6745

# Flag at |modified z| > 3.5, the conventional Iglewicz–Hoaglin cutoff: ~0.05%
# of a clean normal series rather than the ~5% that 2σ flags.
_THRESHOLD = 3.5

# Seasonal adjustment needs enough cycles for a per-phase median to mean
# anything, and at least this many points per phase.
_MIN_CYCLES = 3
_MIN_PER_PHASE = 3

_SEASON_PERIODS = (7, 12, 4)  # weekly on daily data; monthly/quarterly cycles

_MIN_POINTS = 8


def _mad_scores(values: np.ndarray) -> tuple[np.ndarray, str]:
    """Modified z-scores, falling back to an IQR scale when the MAD is zero
    (a series where more than half the points share one value)."""
    median = np.median(values)
    mad = np.median(np.abs(values - median))
    if mad > 0:
        return _MAD_SCALE * (values - median) / mad, "median-absolute-deviation"
    q1, q3 = np.percentile(values, [25, 75])
    iqr = q3 - q1
    if iqr > 0:
        # Same scaling intent: 1.349 IQRs ≈ 1σ for a normal series.
        return (values - median) / (iqr / 1.349), "interquartile-range"
    return np.zeros_like(values), "degenerate"


def _rare_values(values: np.ndarray) -> np.ndarray:
    """Indices of values that stand out by *rarity* rather than by magnitude.

    Reached when both robust scales are zero — three-quarters or more of the
    series is one repeated value. No spread can be estimated from a series like
    that, so a z-score of any kind is undefined; what makes a point unusual is
    that it differs from the plateau at all and does so in a handful of rows.
    Scoring it by magnitude would rank a huge spike as anomalous and let a
    smaller but equally rare one pass, which is the masking the median was
    adopted to avoid.
    """
    median = np.median(values)
    uniques, counts = np.unique(values, return_counts=True)
    frequency = dict(zip(uniques.tolist(), counts.tolist()))
    rare_at_most = max(1, int(len(values) * 0.05))
    return np.array([
        i for i, v in enumerate(values)
        if v != median and frequency[float(v)] <= rare_at_most
    ], dtype=int)


def _seasonal_phase(dates: pd.Series, n: int) -> tuple[np.ndarray, int] | None:
    """Pick a cycle the series is long enough to estimate, and return each
    point's phase within it."""
    if dates is None:
        return None
    dates = pd.to_datetime(dates, errors="coerce")
    if dates.isna().any():
        return None
    for period in _SEASON_PERIODS:
        if n < period * _MIN_CYCLES:
            continue
        if period == 7:
            phase = dates.dt.dayofweek.to_numpy()
        elif period == 12:
            phase = (dates.dt.month - 1).to_numpy()
        else:
            phase = (dates.dt.quarter - 1).to_numpy()
        counts = np.bincount(phase, minlength=period)
        if counts[counts > 0].min() >= _MIN_PER_PHASE and (counts > 0).sum() >= period - 1:
            return phase, period
    return None


def detect_anomalies(
    df: pd.DataFrame,
    measure_col: str | None = None,
    date_col: str | None = None,
    max_points: int = 10,
) -> dict:
    """Find unusually high *and* low values of `measure_col`.

    Returns {"found": bool, "method", "threshold", "count", "points": [...],
    "measure_column", "date_column", "note"} — always a dict, so "nothing
    unusual" and "couldn't look" stay distinguishable (the plan's §1 rule).
    """
    # Imported here rather than at module scope: predictor imports nothing from
    # this module, and keeping it one-way avoids a cycle if that ever changes.
    from predictor import infer_date_column, infer_measure_column

    date_col = date_col if date_col is not None else infer_date_column(df)
    measure_col = measure_col or infer_measure_column(df, exclude=date_col)

    base = {
        "found": False,
        "method": None,
        "threshold": _THRESHOLD,
        "count": 0,
        "points": [],
        "measure_column": measure_col,
        "date_column": date_col if date_col in getattr(df, "columns", []) else None,
    }

    if measure_col is None or measure_col not in df.columns:
        return {**base, "note": "No numeric column in the result to check."}

    series = pd.to_numeric(df[measure_col], errors="coerce")
    usable = series.notna()
    if usable.sum() < _MIN_POINTS:
        return {**base, "note": f"Only {int(usable.sum())} usable values — too few to call anything unusual."}

    frame = df.loc[usable].copy()
    values = series[usable].to_numpy(dtype=float)

    # Seasonal adjustment: score each point against its own phase of the cycle.
    method_prefix = ""
    dates = frame[date_col] if (date_col and date_col in frame.columns) else None
    season = _seasonal_phase(dates, len(values)) if dates is not None else None
    if season is not None:
        phase, period = season
        residuals = values.copy().astype(float)
        for p in np.unique(phase):
            mask = phase == p
            residuals[mask] = values[mask] - np.median(values[mask])
        scored, method = _mad_scores(residuals)
        method_prefix = f"seasonally-adjusted ({period}-point cycle), "
    else:
        scored, method = _mad_scores(values)

    if method == "degenerate":
        flagged = _rare_values(values)
        if not len(flagged):
            return {**base, "method": "constant",
                    "note": "Every value is the same, so no point stands out."}
        method = "rare-value"
        method_prefix = ""
        # Ordered by distance from the plateau purely so the largest departures
        # are shown first; the *decision* was rarity, not size.
        scored = values - np.median(values)
    else:
        flagged = np.where(np.abs(scored) > _THRESHOLD)[0]

    order = flagged[np.argsort(-np.abs(scored[flagged]))][:max_points]
    rare = method == "rare-value"

    points = []
    for i in order:
        row = frame.iloc[int(i)]
        point = {
            "value": float(values[i]),
            # A rarity call has no z-score to report; saying None keeps it from
            # being read as one.
            "score": None if rare else round(float(scored[i]), 2),
            "direction": "high" if scored[i] > 0 else "low",
        }
        if dates is not None:
            when = pd.to_datetime(row[date_col], errors="coerce")
            point["when"] = None if pd.isna(when) else when.isoformat()
        points.append(point)

    return {
        "found": bool(len(flagged)),
        "method": method_prefix + method,
        "threshold": None if rare else _THRESHOLD,
        # The count is every flagged point; `points` is the largest few.
        "count": int(len(flagged)),
        "points": points,
        "measure_column": measure_col,
        "date_column": base["date_column"],
        "note": (
            f"{len(flagged)} of {len(values)} points differ from an otherwise "
            f"constant series and occur in only a few rows."
            if rare else
            f"{len(flagged)} of {len(values)} points fall beyond a modified "
            f"z-score of {_THRESHOLD}."
            if len(flagged) else
            f"No point in {len(values)} falls beyond a modified z-score of {_THRESHOLD}."
        ),
    }


def describe_anomalies(result: dict, limit: int = 5) -> str:
    """One-line-per-point rendering for the analyst prompt.

    The LLM is told what was measured and how, so it can't narrate a spike the
    detector didn't find.
    """
    if not result or not result.get("found"):
        return (result or {}).get("note") or "No anomalies detected."

    rule = (f"|modified z| > {result['threshold']}" if result.get("threshold")
            else "rare departures from an otherwise constant series")
    lines = [f"{result['count']} unusual point(s) in {result['measure_column']} "
             f"({result['method']}, {rule}):"]
    for p in result["points"][:limit]:
        when = f"{p['when']}: " if p.get("when") else ""
        score = f", z={p['score']}" if p.get("score") is not None else ""
        lines.append(f"  {when}{p['value']:,.4g} ({p['direction']}{score})")
    return "\n".join(lines)

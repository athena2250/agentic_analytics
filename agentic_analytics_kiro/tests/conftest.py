"""
Shared fixtures for the §15 MVP acceptance suite.

Two datasets that share no column name with each other or with the sales-domain
literals the plan calls out as technical debt (`revenue`, `date`, `department`,
`cost`, `customer_id`, `units`). Every criterion is checked against both, so a
passing assertion can't be one that only holds for sales-shaped data.
"""
from __future__ import annotations

import math
import os
import random
import sys
import datetime

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import api as api_module  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


# ── Datasets ──────────────────────────────────────────────────────────────────

def _hr_frame() -> pd.DataFrame:
    """People data: no measure that sounds like money-per-day, dates named
    `joined_on`, and one column (`employee_id`) that must be read as an
    identifier rather than something to sum."""
    start = datetime.date(2023, 1, 2)
    teams = ["Platform", "Design", "Support", "Research"]
    rows = []
    for i in range(260):
        rows.append({
            "employee_id": 1000 + i,
            "joined_on": start + datetime.timedelta(days=i),
            "team": teams[i % len(teams)],
            "annual_cost_usd": 55_000 + (i % 37) * 900,
            "tenure_years": round(1 + (i % 11) * 0.5, 1),
        })
    return pd.DataFrame(rows)


def _marketing_frame() -> pd.DataFrame:
    """Campaign data: a different date column name, a different currency
    suffix, and enough distinct dates for a forecast to actually fit."""
    start = datetime.date(2024, 1, 1)
    campaigns = ["brand", "search", "social", "retarget"]
    rows = []
    for i in range(200):
        rows.append({
            "campaign": campaigns[i % len(campaigns)],
            "week_start": start + datetime.timedelta(days=i),
            "impressions": 10_000 + (i % 53) * 310,
            "clicks": 120 + (i % 29) * 7,
            "spend_gbp": round(400 + (i % 41) * 12.5, 2),
        })
    return pd.DataFrame(rows)


def _campaigns_frame() -> pd.DataFrame:
    """A small lookup table: one row per campaign, keyed by `campaign_id`."""
    return pd.DataFrame([
        {"campaign_id": 100 + i,
         "campaign_name": name,
         "channel": ["paid", "organic"][i % 2]}
        for i, name in enumerate(["brand", "search", "social", "retarget", "affiliate"])
    ])


def _campaign_events_frame() -> pd.DataFrame:
    """A fact table referencing the lookup above — the join key is spelled
    identically on both sides, and every value on this side exists there."""
    start = datetime.date(2024, 1, 1)
    rows = []
    for i in range(150):
        rows.append({
            "event_id": 900_000 + i,
            "campaign_id": 100 + (i % 5),
            "event_day": start + datetime.timedelta(days=i),
            "cost_eur": round(80 + (i % 23) * 4.5, 2),
        })
    return pd.DataFrame(rows)


def _daily_spend_frame() -> pd.DataFrame:
    """A smooth, deterministic spend series over a fixed range."""
    start = datetime.date(2024, 3, 1)
    return pd.DataFrame([
        {"spend_date": start + datetime.timedelta(days=i),
         "spend_gbp": round(500 + 200 * math.sin(i / 6), 2)}
        for i in range(120)
    ])


def _daily_signups_frame() -> pd.DataFrame:
    """Signups that follow the spend series two days later, exactly. The lag is
    the point: a correlation that only ever looks at the same day understates a
    relationship that is real but delayed."""
    start = datetime.date(2024, 3, 1)
    rows = []
    for i in range(120):
        driver = 500 + 200 * math.sin((i - 2) / 6)
        rows.append({
            "signup_date": start + datetime.timedelta(days=i),
            "signups": round(100 + 0.4 * driver, 2),
        })
    return pd.DataFrame(rows)


def _purchases_frame() -> pd.DataFrame:
    """Retail-shaped event data for the §17 pipeline: a repeat actor
    (`shopper_ref`), one row per interaction (`basket_ref`), a low-cardinality
    dimension an actor can span (`outlet`), a date, and two additive measures.

    Deterministic: seeded, so every assertion about a number below is stable.
    Day 116 is four times the usual volume — the event.
    """
    rng = random.Random(11)
    start = datetime.date(2024, 1, 1)
    outlets = ["north", "south", "harbour", "airport"]
    rows, ref = [], 500_000
    for offset in range(120):
        day = start + datetime.timedelta(days=offset)
        for _ in range(160 if offset == 116 else 40):
            rows.append({
                "shopper_ref": f"S{rng.randint(1, 300):04d}",
                "basket_ref": f"B{ref}",
                "outlet": outlets[rng.randrange(len(outlets))],
                "purchase_day": day,
                "basket_total_aud": round(rng.uniform(8, 120), 2),
                "line_items": rng.randint(1, 9),
            })
            ref += 1
    return pd.DataFrame(rows)


def _consultations_frame() -> pd.DataFrame:
    """The same *shape* in a vocabulary that shares no word with the retail
    frame above — the point of §17.7's two-dataset requirement. If a pipeline
    assertion passes here and there, it cannot be reading a column name."""
    rng = random.Random(23)
    start = datetime.date(2023, 6, 1)
    sites = ["riverside", "hilltop", "central"]
    rows, ref = [], 900_000
    for offset in range(150):
        day = start + datetime.timedelta(days=offset)
        for _ in range(120 if offset == 143 else 30):
            rows.append({
                "patient_code": f"P{rng.randint(1, 220):04d}",
                "visit_ref": f"V{ref}",
                "clinic_site": sites[rng.randrange(len(sites))],
                "seen_on": day,
                "billed_amount_chf": round(rng.uniform(40, 400), 2),
                "minutes_spent": rng.randint(5, 60),
            })
            ref += 1
    return pd.DataFrame(rows)


def _redemptions_frame() -> pd.DataFrame:
    """Event-shaped, but with nothing an actor could span: an entity, a key, a
    date and a measure, and no low-cardinality dimension at all. The pipeline
    must still run and must say what it left out (§17.7)."""
    rng = random.Random(5)
    start = datetime.date(2024, 2, 1)
    rows, ref = [], 700_000
    for offset in range(90):
        day = start + datetime.timedelta(days=offset)
        for _ in range(100 if offset == 86 else 25):
            rows.append({
                "member_tag": f"M{rng.randint(1, 180):04d}",
                "voucher_ref": f"R{ref}",
                "logged_on": day,
                "points_awarded": rng.randint(1, 500),
            })
            ref += 1
    return pd.DataFrame(rows)


DATASETS = {
    "hr": _hr_frame,
    "marketing": _marketing_frame,
}

# Datasets shaped like a discrete event, for the pipeline in §17. Kept separate
# from DATASETS so the MVP suite above still runs against its own two files.
EVENT_DATASETS = {
    "purchases": _purchases_frame,
    "consultations": _consultations_frame,
}

# The roles each event dataset's columns should resolve to, and the day the
# event actually happened. Asserted against so a test can't pass by resolving
# the *other* dataset's shape.
EVENT_EXPECTATIONS = {
    "purchases": {
        "entity": "shopper_ref", "event_key": "basket_ref", "cross_dim": "outlet",
        "time": "purchase_day", "measure": ["basket_total_aud", "line_items"],
        "event_day": "2024-04-26",
        "foreign": ["patient_code", "visit_ref", "clinic_site", "seen_on",
                    "billed_amount_chf", "minutes_spent"],
    },
    "consultations": {
        "entity": "patient_code", "event_key": "visit_ref", "cross_dim": "clinic_site",
        "time": "seen_on", "measure": ["billed_amount_chf", "minutes_spent"],
        "event_day": "2023-10-22",
        "foreign": ["shopper_ref", "basket_ref", "outlet", "purchase_day",
                    "basket_total_aud", "line_items"],
    },
}

# Datasets that *do* relate to each other, for the cross-dataset work in §16.
# Kept separate from DATASETS so the MVP suite above still runs against two
# deliberately unrelated files.
RELATED_DATASETS = {
    "campaigns": _campaigns_frame,
    "campaign_events": _campaign_events_frame,
    "daily_spend": _daily_spend_frame,
    "daily_signups": _daily_signups_frame,
}

# The names each dataset's answers must be phrased in — asserted against so a
# test can't pass by naming a column from the *other* dataset.
DATASET_COLUMNS = {
    "hr": ["employee_id", "joined_on", "team", "annual_cost_usd", "tenure_years"],
    "marketing": ["campaign", "week_start", "impressions", "clicks", "spend_gbp"],
}

# Literals §1 classifies as technical debt. No live code path may name one.
BANNED_LITERALS = [
    "revenue", "department", "customer_id", "transaction_id",
]


@pytest.fixture
def csv_files(tmp_path):
    """Write both datasets to disk and hand back {name: path}."""
    paths = {}
    for name, build in DATASETS.items():
        path = tmp_path / f"{name}.csv"
        build().to_csv(path, index=False)
        paths[name] = str(path)
    return paths


@pytest.fixture
def event_csv_files(tmp_path):
    """The event-shaped datasets, written to disk as {name: path}."""
    paths = {}
    for name, build in EVENT_DATASETS.items():
        path = tmp_path / f"{name}.csv"
        build().to_csv(path, index=False)
        paths[name] = str(path)
    return paths


@pytest.fixture
def no_cross_dim_csv(tmp_path):
    """One event-shaped dataset with no dimension an entity could span."""
    path = tmp_path / "redemptions.csv"
    _redemptions_frame().to_csv(path, index=False)
    return str(path)


@pytest.fixture
def related_csv_files(tmp_path):
    """The joinable/correlatable datasets, written to disk as {name: path}."""
    paths = {}
    for name, build in RELATED_DATASETS.items():
        path = tmp_path / f"{name}.csv"
        build().to_csv(path, index=False)
        paths[name] = str(path)
    return paths


# ── App under test ────────────────────────────────────────────────────────────

class FakeLLM:
    """Stands in for the local model so the suite tests *our* pipeline rather
    than the model's SQL. `replies` is consumed in order; once exhausted, the
    last reply repeats. Every prompt is recorded so tests can assert what the
    backend actually told the model."""

    def __init__(self):
        self.replies: list[str] = ["SELECT 1"]
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if len(self.replies) > 1:
            return self.replies.pop(0)
        return self.replies[0]


@pytest.fixture
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(api_module, "_llm", fake)
    return fake


@pytest.fixture
def client(llm):
    with TestClient(api_module.app) as c:
        yield c


@pytest.fixture
def session_id(client):
    sid = client.post("/session").json()["session_id"]
    yield sid
    client.delete(f"/session/{sid}")


def upload(client, sid, path):
    with open(path, "rb") as fh:
        r = client.post(
            f"/session/{sid}/upload",
            files={"files": (os.path.basename(path), fh, "text/csv")},
        )
    assert r.status_code == 200, r.text
    return r.json()


def sse_events(response_text: str) -> list[tuple[str, str]]:
    """Parse an SSE body into [(event, data), ...]."""
    events = []
    for frame in response_text.split("\n\n"):
        if not frame.strip():
            continue
        event, data = "message", []
        for line in frame.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        events.append((event, "\n".join(data)))
    return events

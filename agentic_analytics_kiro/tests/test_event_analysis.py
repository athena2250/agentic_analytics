"""
Acceptance tests for the event analysis pipeline (plan §17.7).

The suite's organising constraint is §17.2: no code path may reference a fixed
column name. Every behavioural assertion below therefore runs against two
event-shaped datasets whose column names share no word with each other, and
reads the answer back in the vocabulary the dataset under test actually uses.
An assertion that passed by naming a column would fail on the other dataset.
"""
from __future__ import annotations

import io
import os
import re

import pytest
from openpyxl import load_workbook

from conftest import EVENT_DATASETS, EVENT_EXPECTATIONS, upload, sse_events

import api as api_module


PACKAGE = os.path.join(os.path.dirname(__file__), "..")

# The one-question-one-query intents are unaffected by any of this; these are
# the words that route into the pipeline instead (§17.6).
ASK = ("a promotional event happened on {day} - analyse the metrics per actor "
       "and the cross-shop behaviour, as an excel workbook")


def _run(client, sid, question, roles=None):
    """One turn over the streaming endpoint, returned as (events, response)."""
    body = {"query": question}
    if roles:
        body["roles"] = roles
    r = client.post(f"/session/{sid}/query/stream", json=body)
    assert r.status_code == 200, r.text
    events = sse_events(r.text)
    assert not [e for e in events if e[0] == "ERROR"], events
    final = [e for e in events if e[0] == "RESPONSE_READY"]
    assert final, [e[0] for e in events]
    import json
    return events, json.loads(final[-1][1])["response"]


def _workbook(client, sid):
    r = client.get(f"/session/{sid}/export")
    assert r.status_code == 200, r.text
    assert "spreadsheetml" in r.headers["content-type"]
    return load_workbook(io.BytesIO(r.content))


@pytest.fixture(params=sorted(EVENT_DATASETS))
def event_session(request, client, session_id, tmp_path):
    """A session holding one event-shaped dataset, plus what that dataset's
    columns are expected to mean."""
    name = request.param
    path = tmp_path / f"{name}.csv"
    EVENT_DATASETS[name]().to_csv(path, index=False)
    upload(client, session_id, str(path))
    return session_id, name, EVENT_EXPECTATIONS[name]


# ── §17.7: the pipeline runs on two datasets with no shared vocabulary ────────

def test_routes_to_the_pipeline_rather_than_the_single_sheet_exporter(event_session, client):
    """§17.6: these requests say "excel" and must not reach `_export_xlsx`."""
    sid, _, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))
    assert response["intent"] == "event_analysis"


def test_pipeline_produces_a_valid_multi_sheet_workbook(event_session, client):
    sid, name, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))

    wb = _workbook(client, sid)
    # Summary and Narrative lead, Method closes, sub-analyses in §17.3 order
    # between them.
    assert wb.sheetnames[0] == "Summary"
    assert wb.sheetnames[1] == "Narrative"
    assert wb.sheetnames[-1] == "Method"
    assert len(wb.sheetnames) >= 5, wb.sheetnames

    # Every sheet is phrased in this dataset's own column names, and none of
    # the other dataset's names appears anywhere in the file.
    text = " ".join(
        str(cell.value)
        for sheet in wb.worksheets
        for row in sheet.iter_rows()
        for cell in row
        if cell.value is not None
    )
    assert expected["entity"] in text
    assert expected["cross_dim"] in text
    for foreign in expected["foreign"]:
        assert foreign not in text, f"{name}'s workbook names {foreign}"


def test_roles_resolve_to_this_datasets_columns(event_session, client):
    sid, _, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))
    roles = response["event_analysis"]["roles"]

    assert roles["entity"]["column"] == expected["entity"]
    assert roles["event_key"]["column"] == expected["event_key"]
    assert roles["cross_dim"]["column"] == expected["cross_dim"]
    assert roles["time"]["column"] == expected["time"]
    assert sorted(roles["measure"]["column"]) == sorted(expected["measure"])


def test_inferred_and_confirmed_roles_are_distinguishable(event_session, client):
    """§17.2: "A role the system guessed and a role the user confirmed must be
    distinguishable in the response." """
    sid, _, expected = event_session
    _, inferred = _run(client, sid, ASK.format(day=expected["event_day"]))
    assert all(r["source"] == "inferred" for r in inferred["event_analysis"]["roles"].values())

    _, confirmed = _run(client, sid, ASK.format(day=expected["event_day"]),
                        roles={"cross_dim": expected["cross_dim"]})
    roles = confirmed["event_analysis"]["roles"]
    assert roles["cross_dim"]["source"] == "confirmed"
    assert roles["entity"]["source"] == "inferred"

    # …and the distinction survives into the forwarded workbook.
    method = _workbook(client, sid)["Method"]
    rows = [[str(c.value) for c in row] for row in method.iter_rows()]
    cross = next(r for r in rows if r[0] == "Resolved role" and r[1] == "cross_dim")
    assert "[confirmed]" in cross[2]
    entity = next(r for r in rows if r[0] == "Resolved role" and r[1] == "entity")
    assert "[inferred]" in entity[2]


def test_event_and_baseline_windows_are_stated_never_implied(event_session, client):
    sid, _, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))
    windows = response["event_analysis"]["windows"]

    assert windows["event"]["start"] == expected["event_day"]
    assert windows["baseline"], "no baseline periods were placed"
    # Each baseline window is a whole number of weeks earlier, so it covers the
    # same weekdays as the event (§17.3).
    import datetime
    event_day = datetime.date.fromisoformat(expected["event_day"])
    for b in windows["baseline"]:
        gap = (event_day - datetime.date.fromisoformat(b["start"])).days
        assert gap % 7 == 0, b
    assert "baseline" in windows["note"].lower()


# ── §17.7: every sheet's provenance is present in Method ─────────────────────

def test_method_carries_every_sheets_provenance(event_session, client):
    sid, _, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))
    wb = _workbook(client, sid)
    method = wb["Method"]
    rows = [[("" if c.value is None else str(c.value)) for c in row]
            for row in method.iter_rows(min_row=2)]

    sections = {r[0] for r in rows}
    assert {"Source", "Resolved role", "Window", "Sub-analysis", "Query"} <= sections

    # Every role that was resolved is disclosed, with how it was arrived at.
    disclosed = {r[1] for r in rows if r[0] == "Resolved role"}
    assert {"entity", "event_key", "cross_dim", "time", "measure"} <= disclosed

    # Every sub-analysis sheet in the workbook has both a description row and
    # the SQL that produced it.
    described = {r[1] for r in rows if r[0] == "Sub-analysis"}
    queried = {r[1] for r in rows if r[0] == "Query" and not r[1].endswith("validation")}
    data_sheets = [s for s in wb.sheetnames if s not in ("Summary", "Narrative", "Method")]
    for sheet in data_sheets:
        assert sheet in described, f"{sheet} has no Method entry"
        assert sheet in queried, f"{sheet}'s SQL is not disclosed"

    # …and the disclosed SQL is really SQL, not a label.
    for row in rows:
        if row[0] == "Query" and not row[1].endswith("validation"):
            assert re.match(r"^\s*(WITH|SELECT)\b", row[2], re.IGNORECASE), row[2][:80]

    # The row count each sheet returned is disclosed alongside it.
    for row in rows:
        if row[0] == "Sub-analysis" and not row[2].startswith("SKIPPED"):
            assert row[3].isdigit(), row


# ── §17.7: an unresolvable cross_dim omits the cross-shop sheets, and says so ─

def test_unresolvable_cross_dim_omits_those_sheets_and_states_it(
        client, session_id, no_cross_dim_csv):
    upload(client, session_id, no_cross_dim_csv)
    _, response = _run(client, session_id,
                       "an event happened - analyse the metrics and cross-shop behaviour")

    block = response["event_analysis"]
    assert block["roles"]["cross_dim"]["column"] is None
    assert block["roles"]["cross_dim"]["source"] == "unresolved"

    # The run still succeeds and still produces a workbook.
    assert response["workbook_ready"] is True
    wb = _workbook(client, session_id)
    assert "Cross-dimension" not in wb.sheetnames
    assert "Affinity" not in wb.sheetnames
    # The sub-analyses that do not need it still ran.
    assert "Entity metrics" in wb.sheetnames

    # The omission is stated, not silent — in the response and in the workbook
    # a reader receives without the conversation.
    skipped = {s["title"]: s["reason"] for s in block["skipped"]}
    assert "Cross-dimension" in skipped and "Affinity" in skipped
    assert skipped["Cross-dimension"].strip()

    method_text = " ".join(
        str(c.value) for row in wb["Method"].iter_rows() for c in row if c.value is not None
    )
    assert "SKIPPED" in method_text
    assert "Cross-dimension" in method_text and "Affinity" in method_text


# ── §17.7: a failed sub-analysis does not abort the run ──────────────────────

def test_failed_sub_analysis_is_recorded_and_skipped(
        event_session, client, monkeypatch):
    sid, _, expected = event_session
    real_plan = api_module.plan_sub_analyses

    def broken_plan(table, roles, windows):
        """Corrupt exactly one sub-analysis's SQL, leaving the rest intact."""
        subs = real_plan(table, roles, windows)
        for sub in subs:
            if sub["key"] == "affinity" and sub["sql"]:
                sub["sql"] = sub["sql"].replace("SELECT DISTINCT", "SELECT DISTINCT no_such_column,")
                break
        return subs

    monkeypatch.setattr(api_module, "plan_sub_analyses", broken_plan)
    # The repair path is the model's; give it nothing usable so the failure is
    # the one under test rather than an accidental fix.
    api_module._llm.replies = ["SELECT still_no_such_column"]

    events, response = _run(client, sid, ASK.format(day=expected["event_day"]))

    block = response["event_analysis"]
    failed = {s["title"]: s["reason"] for s in block["skipped"]}
    assert "Affinity" in failed
    assert "did not validate" in failed["Affinity"]

    # The run completed: the other sub-analyses produced sheets and the
    # workbook was still assembled.
    assert response["workbook_ready"] is True
    wb = _workbook(client, sid)
    assert "Affinity" not in wb.sheetnames
    assert "Entity metrics" in wb.sheetnames
    assert "Cross-dimension" in wb.sheetnames

    # And the failure is disclosed rather than looking like it was never planned.
    assert any(p["key"] == "affinity" for p in block["plan"])
    method_text = " ".join(
        str(c.value) for row in wb["Method"].iter_rows() for c in row if c.value is not None
    )
    assert "Affinity" in method_text and "SKIPPED" in method_text


# ── §17.3: the plan is emitted before anything runs ──────────────────────────

def test_plan_is_streamed_before_any_sub_analysis_executes(event_session, client):
    sid, _, expected = event_session
    events, _ = _run(client, sid, ASK.format(day=expected["event_day"]))

    steps = [data for name, data in events if name == "INVESTIGATION_STEP"]
    planned = next(i for i, d in enumerate(steps) if '"plan"' in d)
    running = next(i for i, d in enumerate(steps) if "Running " in d)
    assert planned < running, "sub-analyses started before the plan was emitted"

    import json
    plan = json.loads(steps[planned])["plan"]
    assert [p["key"] for p in plan] == [
        "event_vs_baseline", "entity_metrics", "cross_dimension",
        "affinity", "new_vs_returning",
    ]


# ── §17.5: "ready to use" is a property of the file, not a style ─────────────

def test_workbook_is_ready_to_use(event_session, client):
    sid, _, expected = event_session
    _run(client, sid, ASK.format(day=expected["event_day"]))
    wb = _workbook(client, sid)

    illegal = re.compile(r"[\[\]:*?/\\]")
    for sheet in wb.worksheets:
        assert len(sheet.title) <= 31, sheet.title
        assert not illegal.search(sheet.title), sheet.title
        assert sheet.freeze_panes == "A2", sheet.title
        header = [c for c in sheet[1] if c.value is not None]
        assert header, sheet.title
        assert all(c.font.bold for c in header), sheet.title
        for cell in header:
            width = sheet.column_dimensions[cell.column_letter].width
            assert width and width >= 10, (sheet.title, cell.value)

    metrics = wb["Entity metrics"]
    headers = [c.value for c in metrics[1]]
    assert "% delta" in headers and "Delta" in headers
    pct = metrics.cell(row=2, column=headers.index("% delta") + 1)
    delta = metrics.cell(row=2, column=headers.index("Delta") + 1)
    # Percentages carry a percent format over a numeric fraction, and deltas
    # stay numeric — both so the columns remain sortable (§17.5).
    assert pct.number_format == "0.0%"
    assert isinstance(pct.value, (int, float))
    assert isinstance(delta.value, (int, float))

    # No index column: the first header is a real column, not a blank.
    for sheet in wb.worksheets:
        assert sheet.cell(row=1, column=1).value not in (None, "")


def test_narrative_survives_as_text_one_finding_per_row(event_session, client):
    sid, _, expected = event_session
    api_module._llm.replies = ["Traffic rose sharply.\nThe rise was broad-based."]
    _run(client, sid, ASK.format(day=expected["event_day"]))

    narrative = _workbook(client, sid)["Narrative"]
    rows = [[c.value for c in row] for row in narrative.iter_rows(min_row=2)]
    findings = [r[1] for r in rows]
    assert "Traffic rose sharply." in findings
    assert "The rise was broad-based." in findings
    # The measured findings are there too, attributed to the sub-analysis that
    # produced them rather than to the narrative.
    assert any(r[0] not in (None, "Narrative") for r in rows)


# ── §17.6: wiring ────────────────────────────────────────────────────────────

def test_export_after_an_event_analysis_returns_the_workbook_not_regenerated_sql(
        event_session, client):
    """A follow-up "export to excel" must not re-run one sub-analysis's SQL and
    hand that back as the analysis (§17.6)."""
    sid, _, expected = event_session
    _run(client, sid, ASK.format(day=expected["event_day"]))
    _, follow_up = _run(client, sid, "export to excel")
    assert follow_up["intent"] == "export"
    assert _workbook(client, sid).sheetnames[-1] == "Method"


def test_every_query_behind_the_workbook_is_returned_to_the_client(event_session, client):
    """§17.6: the technical panel needs more than one SQL statement."""
    sid, _, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))
    statements = response["event_analysis"]["sql_statements"]
    assert len(statements) >= 4
    assert all(re.match(r"^\s*(WITH|SELECT)\b", s["sql"], re.IGNORECASE) for s in statements)
    assert response["sql"] in [s["sql"] for s in statements]


def test_pipeline_queries_are_not_capped_at_200_rows(event_session, client):
    """§17.4: the preview is capped, the workbook is not."""
    sid, _, expected = event_session
    _, response = _run(client, sid, ASK.format(day=expected["event_day"]))
    for statement in response["event_analysis"]["sql_statements"]:
        # Affinity's top-N cap is deliberate and stated; nothing else limits.
        if "LIMIT" in statement["sql"].upper():
            assert statement["title"] == "Affinity", statement["title"]


def test_ordinary_single_query_export_is_unchanged(client, session_id, csv_files):
    """The single-sheet exporter keeps its behaviour for ordinary queries."""
    upload(client, session_id, csv_files["hr"])
    api_module._llm.replies = ["SELECT team, COUNT(*) AS n FROM hr GROUP BY team"]
    r = client.post(f"/session/{session_id}/query", json={"query": "export this to excel"})
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Sheet1"]


# ── §17.7: no domain literals in the new code ────────────────────────────────

def test_no_domain_literals_in_pipeline_code():
    """`grep` for the §1 literals across the new modules returns nothing.

    Checked here rather than by hand so it stays true: a column name written
    into this pipeline is a bug the moment someone uploads a dataset that
    doesn't have it.
    """
    banned = ["revenue", "customer_id", "department", "transaction_id", "cost", "units"]
    for name in ("event_analysis.py", "workbook.py"):
        source = open(os.path.join(PACKAGE, name)).read().lower()
        # Docstrings are the one place §17.7 permits these words; strip them so
        # explaining the rule doesn't break it.
        stripped = re.sub(r'""".*?"""', "", source, flags=re.DOTALL)
        stripped = re.sub(r"#.*", "", stripped)
        for literal in banned:
            assert literal not in stripped, f"{name} names the literal {literal!r}"

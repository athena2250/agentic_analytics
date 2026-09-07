"""
Executable form of plan §15 — the MVP definition.

One test class per bullet of §15, each named after the bullet it checks, run
against two datasets that share no column name with each other or with the
sales-domain literals §1 classifies as technical debt. §15 is a list of claims
about the system; this file is those claims, executed.

The local model is stubbed (see conftest.FakeLLM) so what is under test is the
backend pipeline — profiling, validation, fallback, forecasting, streaming —
rather than any particular model's SQL.
"""
from __future__ import annotations

import json
import re

import pytest

import api as api_module
from conftest import (
    BANNED_LITERALS, DATASET_COLUMNS, sse_events, upload,
)


LIVE_BACKEND_MODULES = ["api.py", "loader.py", "predictor.py", "analytical_context.py"]


# ── Bullet 1 ──────────────────────────────────────────────────────────────────
# "A user with no prior configuration can open the app, upload any
#  backend-supported file, and within the existing upload flow see accurate
#  row/column/date-span info."

class TestUploadReportsAccurateShape:

    def test_advertised_formats_are_all_loadable(self, client):
        formats = client.get("/formats").json()["formats"]
        assert "csv" in formats
        # Advertised straight from the loader's reader tables, so the UI can
        # never offer a format load_files() would reject.
        from loader import supported_formats
        assert formats == supported_formats()

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_upload_returns_measured_shape(self, client, session_id, csv_files, dataset):
        body = upload(client, session_id, csv_files[dataset])
        summary = body["summary"]

        assert summary is not None, "upload must carry the summary, not defer it"
        assert summary["row_count"] == (260 if dataset == "hr" else 200)
        assert summary["column_count"] == len(DATASET_COLUMNS[dataset])
        assert summary["table_count"] == 1

    @pytest.mark.parametrize("dataset,start,end", [
        ("hr", "2023-01-02", "2023-09-18"),
        ("marketing", "2024-01-01", "2024-07-18"),
    ])
    def test_date_span_is_real(self, client, session_id, csv_files, dataset, start, end):
        summary = upload(client, session_id, csv_files[dataset])["summary"]
        span = summary["date_span"]
        assert span is not None, "both datasets have a date column; the span must be found"
        assert span["start"].startswith(start)
        assert span["end"].startswith(end)
        assert span["days"] > 0

    def test_no_date_column_reports_no_span_rather_than_zero(self, client, session_id, tmp_path):
        """A number that couldn't be measured is omitted, never reported as 0
        (plan §1: surface uncertainty instead of guessing)."""
        import pandas as pd
        path = tmp_path / "undated.csv"
        pd.DataFrame({"label": list("abcdef"), "score": range(6)}).to_csv(path, index=False)

        summary = upload(client, session_id, str(path))["summary"]
        assert summary["date_span"] is None
        assert summary["row_count"] == 6

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_profile_endpoint_agrees_with_upload(self, client, session_id, csv_files, dataset):
        """Both entry points describe the dataset identically — the card can be
        rendered from either without the numbers moving."""
        from_upload = upload(client, session_id, csv_files[dataset])["summary"]
        from_profile = client.get(f"/session/{session_id}/profile").json()["summary"]
        assert from_upload == from_profile


# ── Bullet 2 ──────────────────────────────────────────────────────────────────
# "The backend performs zero column-name-literal assumptions in the live
#  /query and /profile paths."

class TestNoColumnNameLiterals:

    @pytest.mark.parametrize("module", LIVE_BACKEND_MODULES)
    def test_live_modules_name_no_domain_column(self, module):
        source = open(module).read()
        # Strip comments and docstrings: the prose *discusses* these names.
        source = re.sub(r"#.*", "", source)
        source = re.sub(r'"""(?:.|\n)*?"""', "", source)
        offenders = [lit for lit in BANNED_LITERALS if lit in source.lower()]
        assert not offenders, f"{module} still names {offenders} outside comments"

    def test_query_path_no_longer_imports_the_sales_spell_table(self):
        """config.SPELL_CORRECTIONS maps sales-domain misspellings and is legacy
        CLI-only; importing it into the live path would reintroduce exactly the
        assumption §15 forbids."""
        assert "SPELL_CORRECTIONS" not in open("api.py").read()

    @pytest.mark.parametrize("dataset,typo,expected", [
        ("hr", "annual_cst_usd", "annual_cost_usd"),
        ("marketing", "imprssions", "impressions"),
    ])
    def test_typos_are_corrected_against_this_dataset_only(
        self, client, session_id, csv_files, dataset, typo, expected
    ):
        upload(client, session_id, csv_files[dataset])
        session = api_module._sessions[session_id]
        assert api_module._normalize(f"total {typo} by group", session) == \
            f"total {expected} by group"

    def test_a_real_column_name_is_never_corrected(self, client, session_id, csv_files):
        """The legacy table rewrote `revnue` -> `revenue` unconditionally. A
        dataset whose column really is spelled that way must survive."""
        import pandas as pd
        import os
        path = os.path.join(os.path.dirname(csv_files["hr"]), "oddly_named.csv")
        pd.DataFrame({"revnue": [1, 2], "departmnt": ["a", "b"]}).to_csv(path, index=False)
        upload(client, session_id, path)
        session = api_module._sessions[session_id]
        assert api_module._normalize("revnue by departmnt", session) == "revnue by departmnt"

    def test_normalize_preserves_the_users_capitalisation(self, client, session_id, csv_files):
        upload(client, session_id, csv_files["marketing"])
        session = api_module._sessions[session_id]
        assert api_module._normalize("Spend for Q1 in London", session) == \
            "Spend for Q1 in London"

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_fallback_sql_is_built_from_this_datasets_columns(
        self, client, session_id, csv_files, llm, dataset
    ):
        """Force the model to emit unusable SQL twice; the fallback must still
        name real columns of the uploaded file."""
        upload(client, session_id, csv_files[dataset])
        llm.replies = ["SELECT * FROM nonexistent_table"]

        body = client.post(f"/session/{session_id}/query",
                           json={"query": "break the sql"}).json()

        assert body["validation"]["status"] == "fallback"
        assert body["validation"]["fix_attempts"] == 2
        named = [c for c in DATASET_COLUMNS[dataset] if f'"{c}"' in body["sql"]]
        assert named, f"fallback SQL {body['sql']!r} names none of this dataset's columns"
        assert body["total_rows"] > 0

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_profile_roles_come_from_the_data(self, client, session_id, csv_files, dataset):
        upload(client, session_id, csv_files[dataset])
        tables = client.get(f"/session/{session_id}/profile").json()["tables"]
        cols = {c["name"]: c for t in tables.values() for c in t["columns"]}

        assert set(cols) == set(DATASET_COLUMNS[dataset])
        date_col = "joined_on" if dataset == "hr" else "week_start"
        assert cols[date_col]["role"] == "date"
        measure = "annual_cost_usd" if dataset == "hr" else "spend_gbp"
        assert cols[measure]["role"] == "measure"

    def test_forecast_is_keyed_by_this_datasets_own_columns(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "week_start", "spend_gbp" FROM marketing']

        body = client.post(f"/session/{session_id}/query",
                           json={"query": "predict spend"}).json()

        assert body["intent"] == "predict"
        assert body["forecast"], "a date+measure pair was returned; a forecast must fit"
        # Every key is built from this dataset's own column names — including
        # the interval columns the upgraded forecaster adds (plan §16).
        assert set(body["forecast"][0]) == {
            "week_start",
            "predicted_spend_gbp",
            "predicted_spend_gbp_lower",
            "predicted_spend_gbp_upper",
        }


# ── Bullet 3 ──────────────────────────────────────────────────────────────────
# "The question input offers schema-derived suggestions, not hardcoded
#  sales-domain examples."

class TestSuggestionsAreSchemaDerived:

    SUGGESTIONS = "frontend/src/components/SuggestedQuestions.jsx"

    def test_suggestion_component_names_no_domain_column(self):
        source = open(self.SUGGESTIONS).read()
        offenders = [lit for lit in BANNED_LITERALS if lit in source.lower()]
        assert not offenders, f"suggestions still hardcode {offenders}"

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_profile_carries_every_field_the_builder_needs(
        self, client, session_id, csv_files, dataset
    ):
        """buildSuggestions filters on role, confidence and distinct_count, and
        drops forecast chips below a date-count floor. All four must be present
        per column or the UI silently falls back to nothing."""
        upload(client, session_id, csv_files[dataset])
        tables = client.get(f"/session/{session_id}/profile").json()["tables"]
        for table in tables.values():
            assert isinstance(table["row_count"], int)
            for col in table["columns"]:
                assert {"name", "dtype", "role", "confidence", "distinct_count"} <= set(col)
                assert col["confidence"] is not None

    def test_identifier_columns_are_not_offered_as_measures(
        self, client, session_id, csv_files
    ):
        """`employee_id` is an integer that is unique per row — summing it is
        meaningless, so it must not be labeled a measure."""
        upload(client, session_id, csv_files["hr"])
        tables = client.get(f"/session/{session_id}/profile").json()["tables"]
        cols = {c["name"]: c for t in tables.values() for c in t["columns"]}
        assert cols["employee_id"]["role"] == "identifier"


# ── Bullet 4 ──────────────────────────────────────────────────────────────────
# "Every activity indicator shown corresponds to a real backend step."

DOCUMENTED_EVENTS = {
    "PROFILE_STARTED", "PROFILE_COMPLETED", "SQL_GENERATED", "SQL_VALIDATED",
    "QUERY_EXECUTED", "INVESTIGATION_STEP", "RESPONSE_READY", "ERROR",
}


class TestActivityIsHonest:

    def _stream(self, client, sid, query):
        r = client.post(f"/session/{sid}/query/stream", json={"query": query})
        assert r.status_code == 200, r.text
        return sse_events(r.text)

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_stream_emits_only_documented_events(
        self, client, session_id, csv_files, llm, dataset
    ):
        upload(client, session_id, csv_files[dataset])
        table = dataset
        llm.replies = [f'SELECT * FROM {table} LIMIT 5']
        events = [e for e, _ in self._stream(client, session_id, "show me rows")]
        assert set(events) <= DOCUMENTED_EVENTS
        assert events[-1] == "RESPONSE_READY"

    def test_profiling_events_only_fire_when_profiling_runs(
        self, client, session_id, csv_files, llm
    ):
        """Upload already profiled the dataset, so a turn must not claim to be
        profiling it again."""
        upload(client, session_id, csv_files["hr"])
        llm.replies = ["SELECT * FROM hr LIMIT 5"]
        events = [e for e, _ in self._stream(client, session_id, "show me rows")]
        assert "PROFILE_STARTED" not in events

    def test_repair_steps_are_reported_only_when_a_repair_happened(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["marketing"])

        llm.replies = ['SELECT "campaign" FROM marketing LIMIT 5']
        clean = self._stream(client, session_id, "list campaigns")
        assert not [d for e, d in clean if e == "INVESTIGATION_STEP" and "Repairing" in d]

        llm.replies = ["SELECT * FROM nope"]
        broken = self._stream(client, session_id, "list campaigns again")
        repairs = [d for e, d in broken if e == "INVESTIGATION_STEP" and "Repairing" in d]
        assert len(repairs) == 2, "two repair attempts ran; two must be reported"

    def test_forecast_step_is_only_announced_for_a_predict_turn(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "campaign" FROM marketing LIMIT 5']
        steps = [d for e, d in self._stream(client, session_id, "list campaigns")
                 if e == "INVESTIGATION_STEP"]
        assert not [s for s in steps if "forecast" in s.lower()]

    def test_stream_and_blocking_endpoints_return_the_same_answer(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["hr"])
        sql = 'SELECT "team", SUM("annual_cost_usd") AS total FROM hr GROUP BY "team"'
        llm.replies = [sql]

        blocking = client.post(f"/session/{session_id}/query",
                               json={"query": "cost by team"}).json()
        streamed = next(json.loads(d)["response"]
                        for e, d in self._stream(client, session_id, "cost by team")
                        if e == "RESPONSE_READY")

        for field in ("sql", "columns", "rows", "total_rows", "intent"):
            assert blocking[field] == streamed[field]


# ── Bullet 5 ──────────────────────────────────────────────────────────────────
# "Answers are legible at a glance (narrative + table/KPI) with SQL/technical
#  detail available but secondary."

class TestAnswerIsLegibleBeforeTheSQL:

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_response_carries_the_answer_and_its_provenance(
        self, client, session_id, csv_files, llm, dataset
    ):
        upload(client, session_id, csv_files[dataset])
        llm.replies = [f"SELECT * FROM {dataset} LIMIT 5"]
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "show me rows"}).json()

        # The answer itself.
        assert body["columns"] == DATASET_COLUMNS[dataset]
        assert len(body["rows"]) == 5
        assert body["total_rows"] == 5
        # The technical drawer's contents, measured server-side.
        assert body["tables_used"] == [dataset]
        assert body["validation"]["status"] == "valid"
        assert isinstance(body["duration_ms"], float)

    def test_an_empty_result_is_distinguishable_from_an_error(
        self, client, session_id, csv_files, llm
    ):
        """§13.9: zero rows is an answer. Columns survive and validation still
        reads valid, which is what lets the UI say "no rows matched" instead of
        showing a failure."""
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT * FROM marketing WHERE "clicks" < 0']
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "impossible filter"}).json()

        assert body["total_rows"] == 0
        assert body["rows"] == []
        assert body["columns"] == DATASET_COLUMNS["marketing"]
        assert body["validation"]["status"] == "valid"

    def test_a_predict_turn_without_a_date_column_says_so(
        self, client, session_id, csv_files, llm
    ):
        """The gap §14 closed: forecast comes back explicitly null (not absent)
        so the UI can explain what it would have needed."""
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "campaign", SUM("clicks") AS c FROM marketing GROUP BY "campaign"']
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "predict clicks"}).json()

        assert body["intent"] == "predict"
        assert "forecast" in body and body["forecast"] is None

    def test_insight_turns_carry_a_narrative(self, client, session_id, csv_files, llm):
        upload(client, session_id, csv_files["hr"])
        llm.replies = [
            'SELECT "joined_on", "annual_cost_usd" FROM hr',
            "1. WHAT HAPPENED ... 2. WHY ... 3. WHAT TO DO NEXT ...",
        ]
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "analyze cost over time"}).json()

        assert body["intent"] == "insight"
        assert "WHAT HAPPENED" in body["insights"]

    @pytest.mark.parametrize("dataset", ["hr", "marketing"])
    def test_context_strip_describes_this_dataset(
        self, client, session_id, csv_files, llm, dataset
    ):
        upload(client, session_id, csv_files[dataset])
        llm.replies = [f"SELECT * FROM {dataset} LIMIT 5"]
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "show me rows"}).json()

        assert body["context"], "every turn must leave the strip in a real state"
        served = client.get(f"/session/{session_id}/context").json()["context"]
        assert served == body["context"]


# ── Bullet 6 ──────────────────────────────────────────────────────────────────
# "Starting fresh with a different dataset does not silently inherit the
#  previous dataset's schema/state."

class TestNewSessionInheritsNothing:

    def test_a_fresh_session_knows_nothing(self, client, session_id, csv_files, llm):
        upload(client, session_id, csv_files["hr"])
        llm.replies = ["SELECT * FROM hr LIMIT 5"]
        client.post(f"/session/{session_id}/query", json={"query": "show me rows"})

        second = client.post("/session").json()["session_id"]
        try:
            assert client.get(f"/session/{second}/schema").json()["tables"] == {}
            assert client.get(f"/session/{second}/profile").status_code == 400
            assert client.post(f"/session/{second}/query",
                               json={"query": "show me rows"}).status_code == 400

            ctx = client.get(f"/session/{second}/context").json()["context"]
            assert not json.dumps(ctx).lower().count("annual_cost_usd")

            upload(client, second, csv_files["marketing"])
            cols = {c["name"]
                    for t in client.get(f"/session/{second}/profile").json()["tables"].values()
                    for c in t["columns"]}
            assert cols == set(DATASET_COLUMNS["marketing"])
        finally:
            client.delete(f"/session/{second}")

    def test_the_second_dataset_does_not_carry_the_firsts_vocabulary(
        self, client, session_id, csv_files
    ):
        """Typo correction is per-session: an HR column name must not be
        suggested inside a marketing session."""
        upload(client, session_id, csv_files["marketing"])
        session = api_module._sessions[session_id]
        assert "annual_cost_usd" not in api_module._normalize("annual_cst_usd", session)

    def test_deleting_a_session_removes_it(self, client, csv_files):
        sid = client.post("/session").json()["session_id"]
        upload(client, sid, csv_files["hr"])
        client.delete(f"/session/{sid}")
        assert client.get(f"/session/{sid}/schema").status_code == 404

    def test_uploading_into_a_loaded_session_keeps_tables_separate(
        self, client, session_id, csv_files
    ):
        """Two files in one session stay two profiled tables — schemas are never
        merged into one implied dataset."""
        upload(client, session_id, csv_files["hr"])
        upload(client, session_id, csv_files["marketing"])
        tables = client.get(f"/session/{session_id}/profile").json()["tables"]
        assert set(tables) == {"hr", "marketing"}
        for name in tables:
            assert {c["name"] for c in tables[name]["columns"]} == set(DATASET_COLUMNS[name])

    def test_profile_is_recomputed_after_new_files_land(
        self, client, session_id, csv_files
    ):
        first = upload(client, session_id, csv_files["hr"])["summary"]
        second = upload(client, session_id, csv_files["marketing"])["summary"]
        assert first["column_count"] == 5
        assert second["column_count"] == 10, "a stale profile would still say 5"
        assert second["table_count"] == 2


# ── Bullet 7 ──────────────────────────────────────────────────────────────────
# "All existing functionality (multi-file upload, SQL editing, export,
#  forecast, insights) continues to work exactly as before."

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class TestExistingFunctionalityStillWorks:

    def test_multi_file_upload_in_one_request(self, client, session_id, csv_files):
        with open(csv_files["hr"], "rb") as a, open(csv_files["marketing"], "rb") as b:
            r = client.post(
                f"/session/{session_id}/upload",
                files=[("files", ("hr.csv", a, "text/csv")),
                       ("files", ("marketing.csv", b, "text/csv"))],
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body["tables"]) == {"hr", "marketing"}
        assert body["files_loaded"] == ["hr.csv", "marketing.csv"]

    def test_edited_sql_runs_verbatim(self, client, session_id, csv_files, llm):
        """SQL editing in the technical drawer re-submits the edited statement
        as the question; it must run as written, not be re-generated."""
        upload(client, session_id, csv_files["marketing"])
        edited = 'SELECT "campaign", SUM("clicks") AS clicks FROM marketing GROUP BY "campaign"'
        llm.replies = [edited]

        body = client.post(f"/session/{session_id}/query", json={"query": edited}).json()
        assert body["sql"] == edited
        assert body["columns"] == ["campaign", "clicks"]
        assert body["total_rows"] == 4

    def test_export_intent_returns_a_workbook(self, client, session_id, csv_files, llm):
        upload(client, session_id, csv_files["hr"])
        llm.replies = ['SELECT "team", SUM("annual_cost_usd") AS total FROM hr GROUP BY "team"']
        r = client.post(f"/session/{session_id}/query",
                        json={"query": "export this to excel"})
        assert r.status_code == 200
        assert r.headers["content-type"] == XLSX_MIME
        assert r.content[:2] == b"PK"

    def test_export_endpoint_replays_the_last_query(self, client, session_id, csv_files, llm):
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "campaign" FROM marketing LIMIT 3']
        client.post(f"/session/{session_id}/query", json={"query": "list campaigns"})

        r = client.get(f"/session/{session_id}/export")
        assert r.status_code == 200
        assert r.headers["content-type"] == XLSX_MIME

    def test_export_before_any_query_is_an_error_not_an_empty_file(
        self, client, session_id, csv_files
    ):
        upload(client, session_id, csv_files["hr"])
        assert client.get(f"/session/{session_id}/export").status_code == 400

    def test_streamed_export_turn_signals_the_client_instead_of_a_body(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["hr"])
        llm.replies = ["SELECT * FROM hr LIMIT 5"]
        r = client.post(f"/session/{session_id}/query/stream",
                        json={"query": "export to excel"})
        payload = next(json.loads(d)["response"]
                       for e, d in sse_events(r.text) if e == "RESPONSE_READY")
        assert payload["export_ready"] is True

    def test_forecast_still_fits_seven_periods(self, client, session_id, csv_files, llm):
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ['SELECT "week_start", "spend_gbp" FROM marketing']
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "forecast spend"}).json()
        assert len(body["forecast"]) == 7

    def test_insights_still_run_trend_and_anomaly_detection(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["hr"])
        llm.replies = [
            'SELECT "joined_on", "annual_cost_usd" FROM hr',
            "narrative",
        ]
        client.post(f"/session/{session_id}/query", json={"query": "why is cost changing"})
        analyst_prompt = llm.prompts[-1]
        assert "Trend:" in analyst_prompt and "Anomalies:" in analyst_prompt
        assert "unknown" not in analyst_prompt.split("Trend:")[1].split("\n")[0]

    def test_repeated_query_is_served_from_cache(self, client, session_id, csv_files, llm):
        upload(client, session_id, csv_files["hr"])
        llm.replies = ["SELECT * FROM hr LIMIT 5"]
        first = client.post(f"/session/{session_id}/query", json={"query": "rows"}).json()
        second = client.post(f"/session/{session_id}/query", json={"query": "rows"}).json()
        assert first["rows"] == second["rows"]

    def test_query_without_data_is_rejected_clearly(self, client, session_id):
        r = client.post(f"/session/{session_id}/query", json={"query": "anything"})
        assert r.status_code == 400
        assert "Upload files first" in r.json()["detail"]

"""
Plan §16, first bullet: several datasets in one session, and questions that
span them.

The MVP suite next door checks that nothing assumes a column *name*; this one
checks that nothing assumes a single *table*. Every assertion is about measured
evidence — shared values, aligned periods — rather than about names lining up,
so a join or a correlation can't pass by looking plausible.
"""
from __future__ import annotations

import json

import pytest

from conftest import upload, sse_events


def _relationships(client, sid):
    r = client.get(f"/session/{sid}/relationships")
    assert r.status_code == 200, r.text
    return r.json()["relationships"]


def _find(rels, left_col, right_col):
    for r in rels:
        if {r["left_column"], r["right_column"]} == {left_col, right_col}:
            return r
    return None


# ── Relationship discovery ────────────────────────────────────────────────────

class TestRelationshipsAreMeasured:

    def test_a_shared_key_is_found_with_its_evidence(
        self, client, session_id, related_csv_files
    ):
        upload(client, session_id, related_csv_files["campaigns"])
        upload(client, session_id, related_csv_files["campaign_events"])

        rel = _find(_relationships(client, session_id), "campaign_id", "campaign_id")
        assert rel, "a key present on both sides with the same values must be found"
        # Every campaign in the lookup appears in the fact table.
        assert rel["matched_values"] == 5
        assert rel["overlap"] == 1.0
        # Five distinct ids on one side, five on the other but 150 rows: the
        # lookup is the "one" side.
        assert rel["kind"] in ("one-to-one", "one-to-many", "many-to-one")
        assert "values" in rel["basis"]

    def test_unrelated_datasets_produce_no_join(
        self, client, session_id, csv_files
    ):
        """The HR and marketing files share no column and no values. A
        name-only heuristic would still pair their identifier columns."""
        upload(client, session_id, csv_files["hr"])
        upload(client, session_id, csv_files["marketing"])

        for rel in _relationships(client, session_id):
            assert rel["matched_values"] > 0, "a join with no shared values is not a join"

    def test_a_single_table_session_has_no_relationships_rather_than_an_error(
        self, client, session_id, csv_files
    ):
        upload(client, session_id, csv_files["hr"])
        assert _relationships(client, session_id) == []

    def test_relationships_are_recomputed_when_a_file_lands(
        self, client, session_id, related_csv_files
    ):
        upload(client, session_id, related_csv_files["campaigns"])
        assert _relationships(client, session_id) == []
        upload(client, session_id, related_csv_files["campaign_events"])
        assert _find(_relationships(client, session_id), "campaign_id", "campaign_id")

    def test_relationships_before_upload_are_an_error_not_an_empty_list(
        self, client, session_id
    ):
        assert client.get(f"/session/{session_id}/relationships").status_code == 400


class TestTheModelIsToldHowTablesJoin:

    def test_candidate_joins_reach_the_sql_prompt(
        self, client, session_id, related_csv_files, llm
    ):
        upload(client, session_id, related_csv_files["campaigns"])
        upload(client, session_id, related_csv_files["campaign_events"])
        llm.replies = ["SELECT * FROM campaigns LIMIT 5"]

        client.post(f"/session/{session_id}/query", json={"query": "cost by campaign name"})

        prompt = llm.prompts[0]
        assert "CANDIDATE JOINS" in prompt
        assert 'campaigns."campaign_id" = campaign_events."campaign_id"' in prompt

    def test_a_single_table_session_is_told_about_no_joins(
        self, client, session_id, csv_files, llm
    ):
        upload(client, session_id, csv_files["hr"])
        llm.replies = ["SELECT * FROM hr LIMIT 5"]
        client.post(f"/session/{session_id}/query", json={"query": "rows"})
        assert "CANDIDATE JOINS" not in llm.prompts[0]

    def test_a_join_written_against_the_hint_runs(
        self, client, session_id, related_csv_files, llm
    ):
        """The join the prompt advertises has to be a join DuckDB accepts."""
        upload(client, session_id, related_csv_files["campaigns"])
        upload(client, session_id, related_csv_files["campaign_events"])
        llm.replies = ['''SELECT c."campaign_name", SUM(e."cost_eur") AS total
                          FROM campaign_events e
                          JOIN campaigns c ON e."campaign_id" = c."campaign_id"
                          GROUP BY 1 ORDER BY 2 DESC''']

        body = client.post(f"/session/{session_id}/query",
                           json={"query": "cost by campaign"}).json()

        assert body["validation"]["status"] == "valid"
        assert set(body["tables_used"]) == {"campaigns", "campaign_events"}
        assert body["total_rows"] == 5


# ── Cross-dataset correlation ─────────────────────────────────────────────────

class TestCorrelationIsComputedNotGuessed:

    def test_correlate_intent_needs_more_than_one_table(
        self, client, session_id, csv_files, llm
    ):
        """"Affect" is ordinary analysis language on a single dataset; it only
        means a cross-dataset comparison when there is a second dataset."""
        upload(client, session_id, csv_files["hr"])
        llm.replies = ['SELECT "team" FROM hr LIMIT 5']
        body = client.post(f"/session/{session_id}/query",
                           json={"query": "does tenure affect cost"}).json()
        assert body["intent"] != "correlate"

    def test_two_series_are_aligned_and_measured(
        self, client, session_id, related_csv_files, llm
    ):
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, related_csv_files["daily_signups"])
        # No reply is consumed: the SQL for this turn is built, not generated.
        llm.replies = ["SELECT 1"]

        body = client.post(
            f"/session/{session_id}/query",
            json={"query": "did daily spend affect daily signups"},
        ).json()

        assert body["intent"] == "correlate"
        corr = body["correlation"]
        assert corr["available"] is True
        assert corr["periods"] == 120
        assert corr["grain"] == "day"
        assert corr["strength"] in ("strong", "moderate")
        assert corr["direction"] == "positive"
        # The rows behind the number are real rows the user can read.
        assert set(body["columns"]) == {
            "period", "daily_spend_spend_gbp", "daily_signups_signups"
        }
        assert body["total_rows"] == 120

    def test_the_model_is_not_asked_for_the_alignment_sql(
        self, client, session_id, related_csv_files, llm
    ):
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, related_csv_files["daily_signups"])

        body = client.post(
            f"/session/{session_id}/query",
            json={"query": "did daily spend affect daily signups"},
        ).json()

        assert llm.prompts == [], "the alignment is planned, not generated"
        assert body["validation"]["status"] == "planned"
        assert "DATE_TRUNC('day'" in body["sql"]

    def test_the_delayed_relationship_is_found_at_its_lag(
        self, client, session_id, related_csv_files
    ):
        """Signups follow spend by exactly two days in the fixture."""
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, related_csv_files["daily_signups"])

        corr = client.post(
            f"/session/{session_id}/query",
            json={"query": "did daily spend affect daily signups"},
        ).json()["correlation"]

        best = corr["best_lag"]
        assert abs(best["lag"]) == 2
        assert abs(best["r"]) > abs(corr["pearson"])
        assert corr["lag_caveat"], "scanning lags must be disclosed"

    def test_every_correlation_carries_its_caveat(
        self, client, session_id, related_csv_files
    ):
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, related_csv_files["daily_signups"])
        body = client.post(
            f"/session/{session_id}/query",
            json={"query": "did daily spend affect daily signups"},
        ).json()

        assert "not causation" in body["correlation"]["caveat"]
        assert "not causation" in body["text"]

    def test_non_overlapping_ranges_are_refused_not_correlated(
        self, client, session_id, csv_files, llm
    ):
        """The HR file is 2023 and the marketing file is 2024: there is no
        period on which the two can be compared, and a coefficient computed
        anyway would be meaningless."""
        upload(client, session_id, csv_files["hr"])
        upload(client, session_id, csv_files["marketing"])
        llm.replies = ["SELECT 1"]

        body = client.post(
            f"/session/{session_id}/query",
            json={"query": "did annual cost affect spend"},
        ).json()

        corr = body["correlation"]
        assert corr["available"] is False
        assert "overlap" in corr["reason"]
        assert body["total_rows"] == 0

    def test_a_table_without_a_date_falls_back_and_says_so(
        self, client, session_id, related_csv_files, tmp_path, llm
    ):
        no_date = tmp_path / "ratings.csv"
        no_date.write_text("label,score\na,1\nb,2\nc,3\n")
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, str(no_date))
        llm.replies = ['SELECT "spend_gbp" FROM daily_spend LIMIT 5']

        body = client.post(
            f"/session/{session_id}/query",
            json={"query": "did score affect spend"},
        ).json()

        assert body["correlation"]["available"] is False
        assert "date column" in body["correlation"]["reason"]
        # The turn still answers with rows rather than failing outright.
        assert body["total_rows"] == 5
        assert "No correlation could be computed" in body["text"]

    def test_the_stream_reports_the_alignment_steps(
        self, client, session_id, related_csv_files
    ):
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, related_csv_files["daily_signups"])

        r = client.post(f"/session/{session_id}/query/stream",
                        json={"query": "did daily spend affect daily signups"})
        labels = [json.loads(d).get("label")
                  for e, d in sse_events(r.text) if e == "INVESTIGATION_STEP"]

        assert any("align" in (l or "") for l in labels)
        assert any("move together" in (l or "") for l in labels)


class TestSessionsStillHoldTablesSeparately:

    def test_correlation_does_not_merge_the_two_datasets(
        self, client, session_id, related_csv_files
    ):
        """Aligning two tables for one answer must not turn them into one
        table: the schema after the turn is still two named datasets."""
        upload(client, session_id, related_csv_files["daily_spend"])
        upload(client, session_id, related_csv_files["daily_signups"])
        client.post(f"/session/{session_id}/query",
                    json={"query": "did daily spend affect daily signups"})

        schema = client.get(f"/session/{session_id}/schema").json()
        assert set(schema["tables"]) == {"daily_spend", "daily_signups"}
        assert schema["unified"] is None

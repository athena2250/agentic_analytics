# Agentic Analytics

Upload any dataset, ask questions in plain English, get SQL-backed answers with
charts, forecasts, anomalies and cross-dataset correlations.

```bash
./run.sh          # API on :8000, UI on :5173 — Ctrl+C stops both
```

The application lives in [`agentic_analytics_kiro/`](agentic_analytics_kiro/) —
see its [README](agentic_analytics_kiro/README.md) for setup, requirements and
how to run the two halves separately.

| Path | What it is |
|---|---|
| `agentic_analytics_kiro/api.py` | FastAPI backend — the canonical entry point |
| `agentic_analytics_kiro/frontend/` | React + Vite UI |
| `agentic_analytics_kiro/tests/` | Acceptance suite (`pytest tests`), stubs the model |
| `agentic_analytics_kiro/db/` | Postgres metadata schema (not yet wired to `api.py`) |
| `agentic_analytics_kiro/app.py` | Legacy CLI, kept as a separate surface |
| `plan.md` | Design notes and the MVP definition the tests encode |

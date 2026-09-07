# Agentic Analytics

## Setup

### Run everything (one command)
```bash
./run.sh          # from the repo root
```
Starts the API on :8000 and the UI on :5173, then Ctrl+C stops both.
If a port is taken: `API_PORT=8010 UI_PORT=5175 ./run.sh`.

### Or run the two halves separately

#### Backend
```bash
cd agentic_analytics_kiro
pip install -r requirements.txt
uvicorn api:app --reload --port 8000
```

#### Frontend
```bash
cd agentic_analytics_kiro/frontend
npm install
npm run dev
```

Open http://localhost:5173

## Requirements
- Ollama running locally with llama3: `ollama run llama3`
- Python 3.11+
- Node 18+

# Agentic Analytics

## Setup

### Backend
```bash
cd agentic_analytics_kiro
pip install -r requirements.txt
uvicorn api:app --reload --port 8000
```

### Frontend
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

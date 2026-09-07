#!/usr/bin/env bash
# Start the backend (FastAPI on :8000) and the frontend (Vite on :5173) together.
# Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/agentic_analytics_kiro"
FRONTEND="$BACKEND/frontend"

PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"

# Override with e.g. `API_PORT=8010 UI_PORT=5175 ./run.sh` when the defaults are taken.
API_PORT="${API_PORT:-8000}"
UI_PORT="${UI_PORT:-5173}"
export API_PORT UI_PORT   # vite.config.js reads API_PORT to point its proxy here

for port in "$API_PORT" "$UI_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use — stop that process, or rerun with API_PORT/UI_PORT set." >&2
    exit 1
  fi
done

[ -d "$FRONTEND/node_modules" ] || (cd "$FRONTEND" && npm install)

# Job control, so each server becomes its own process group and cleanup can
# signal the whole group. Without it, killing `npm run dev` orphans the vite
# process it spawned and the port stays occupied.
set -m

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

cd "$BACKEND"
"$PY" -m uvicorn api:app --reload --port "$API_PORT" &
pids+=($!)

cd "$FRONTEND"
npm run dev -- --port "$UI_PORT" --strictPort &
pids+=($!)

echo ""
echo "  backend   http://localhost:$API_PORT"
echo "  frontend  http://localhost:$UI_PORT   <- open this"
echo ""

# Exit as soon as either process dies, so a crashed backend doesn't leave a
# frontend that only proxies to nothing. Polled rather than `wait -n` because
# macOS ships bash 3.2, which has no `wait -n`.
while true; do
  for pid in "${pids[@]}"; do
    kill -0 "$pid" 2>/dev/null || exit 1
  done
  sleep 1
done

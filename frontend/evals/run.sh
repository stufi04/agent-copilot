#!/usr/bin/env bash
# Runs the copilot eval (evals/copilot.eval.ts) against a backend of its own on a spare
# port, so it never depends on or disturbs `make dev`. Real OpenAI calls (~$0.50 a run).
# Usage, from the repo root:  make copilot-eval
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${EVAL_PORT:-7898}"
LOG="$ROOT/frontend/test-results/copilot-eval-backend.log"
mkdir -p "$ROOT/frontend/test-results"

uv run --directory "$ROOT/backend" python bot.py --port "$PORT" > "$LOG" 2>&1 &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:$PORT/client/" && break
  sleep 0.5
done

VITE_BACKEND_URL="http://localhost:$PORT" npm --prefix "$ROOT/frontend" run eval:copilot

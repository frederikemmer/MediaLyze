#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
CONFIG_PATH="${CONFIG_PATH:-$ROOT_DIR/.local-config}"
MEDIA_ROOT="${MEDIA_ROOT:-$HOME/Desktop}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_LOG="${BACKEND_LOG:-$CONFIG_PATH/dev-api.log}"
BACKEND_PID_FILE="${BACKEND_PID_FILE:-$CONFIG_PATH/dev-api.pid}"

mkdir -p "$CONFIG_PATH"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Python virtualenv not found at $VENV_DIR"
  echo "Create it first, then rerun this script."
  exit 1
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "frontend/node_modules is missing."
  echo "Run: npm -C frontend install"
  exit 1
fi

if [[ ! -d "$MEDIA_ROOT" ]]; then
  echo "MEDIA_ROOT does not exist: $MEDIA_ROOT"
  exit 1
fi

source "$VENV_DIR/bin/activate"
export CONFIG_PATH
export MEDIA_ROOT

stop_backend() {
  if [[ -f "$BACKEND_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)"
    if [[ -n "${existing_pid:-}" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      kill -TERM "$existing_pid" 2>/dev/null || true
      sleep 0.5
    fi
    rm -f "$BACKEND_PID_FILE"
  fi

  local port_pids
  port_pids="$(lsof -ti:"$BACKEND_PORT" 2>/dev/null || true)"
  if [[ -n "$port_pids" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      kill -TERM "$pid" 2>/dev/null || true
    done <<< "$port_pids"
    sleep 0.5
  fi
}

cleanup() {
  stop_backend
}

trap cleanup INT TERM EXIT

stop_backend

echo "Starting backend on http://$BACKEND_HOST:$BACKEND_PORT"
echo "Backend log: $BACKEND_LOG"

cd "$ROOT_DIR"
nohup python -m uvicorn backend.app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
  >"$BACKEND_LOG" 2>&1 &
API_PID=$!
echo "$API_PID" > "$BACKEND_PID_FILE"

backend_ready=0
for _ in {1..80}; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "Backend exited during startup. Recent log output:"
    tail -n 80 "$BACKEND_LOG" || true
    exit 1
  fi

  if curl -fsS "http://$BACKEND_HOST:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    backend_ready=1
    break
  fi
  sleep 0.25
done

if [[ "$backend_ready" -ne 1 ]]; then
  echo "Backend did not become healthy in time. Recent log output:"
  tail -n 80 "$BACKEND_LOG" || true
  exit 1
fi

echo "Backend is ready."
echo "Starting frontend on http://127.0.0.1:$FRONTEND_PORT"

cd "$ROOT_DIR/frontend"
npm run dev

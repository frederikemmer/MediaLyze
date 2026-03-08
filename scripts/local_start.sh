#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

CONFIG_PATH="${CONFIG_PATH:-$ROOT_DIR/config}"
MEDIA_ROOT="${MEDIA_ROOT:-$ROOT_DIR/media}"
APP_PORT="${APP_PORT:-8080}"
VITE_PORT="${VITE_PORT:-5173}"
TZ="${TZ:-UTC}"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_BIN="$VENV_DIR/bin/python"
PIP_BIN="$VENV_DIR/bin/pip"
BACKEND_STAMP="$VENV_DIR/.backend-deps.stamp"
FRONTEND_STAMP="$ROOT_DIR/frontend/.frontend-deps.stamp"

mkdir -p "$CONFIG_PATH" "$MEDIA_ROOT"

if [ ! -x "$PYTHON_BIN" ]; then
  python3 -m venv "$VENV_DIR"
fi

if [ ! -f "$BACKEND_STAMP" ] || [ "$ROOT_DIR/pyproject.toml" -nt "$BACKEND_STAMP" ]; then
  "$PIP_BIN" install -U pip
  "$PIP_BIN" install -e '.[dev]'
  touch "$BACKEND_STAMP"
fi

if [ ! -d "$ROOT_DIR/frontend/node_modules" ] || [ ! -f "$FRONTEND_STAMP" ] || [ "$ROOT_DIR/frontend/package.json" -nt "$FRONTEND_STAMP" ]; then
  (
    cd "$ROOT_DIR/frontend"
    npm install
  )
  touch "$FRONTEND_STAMP"
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

export CONFIG_PATH
export MEDIA_ROOT
export APP_PORT
export TZ

"$PYTHON_BIN" -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port "$APP_PORT" &
BACKEND_PID=$!

(
  cd "$ROOT_DIR/frontend"
  npm run dev -- --host 127.0.0.1 --port "$VITE_PORT"
) &
FRONTEND_PID=$!

printf 'Backend:  http://127.0.0.1:%s\n' "$APP_PORT"
printf 'Frontend: http://127.0.0.1:%s\n' "$VITE_PORT"
printf 'CONFIG_PATH=%s\n' "$CONFIG_PATH"
printf 'MEDIA_ROOT=%s\n' "$MEDIA_ROOT"
printf 'TZ=%s\n' "$TZ"

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

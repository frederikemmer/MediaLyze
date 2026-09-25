#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
CONFIG_PATH="${CONFIG_PATH:-$ROOT_DIR/.local-config}"
MEDIA_ROOT="${MEDIA_ROOT:-$HOME/Desktop}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_LOG="${BACKEND_LOG:-$CONFIG_PATH/dev-api.log}"
FRONTEND_LOG="${FRONTEND_LOG:-$CONFIG_PATH/dev-vite.log}"
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
export BACKEND_HOST BACKEND_PORT
export APP_HOST="$BACKEND_HOST" APP_PORT="$BACKEND_PORT"

access_hosts() {
  local bind_host="$1"
  if [[ "$bind_host" != "0.0.0.0" ]]; then
    printf '%s\n' "$bind_host"
    return
  fi

  printf '%s\n' "127.0.0.1"
  hostname 2>/dev/null || true
  hostname -f 2>/dev/null || true
  if command -v scutil >/dev/null 2>&1; then
    local mac_host
    mac_host="$(scutil --get LocalHostName 2>/dev/null || true)"
    if [[ -n "$mac_host" ]]; then
      printf '%s.local\n' "$mac_host"
    fi
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -o -4 addr show up | awk '{split($4, address, "/"); print address[1]}'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig -a | awk '$1 == "inet" {print $2}'
  fi
}

print_access_urls() {
  local label="$1" bind_host="$2" port="$3" path="$4" address
  if [[ -n "$label" ]]; then
    echo "$label"
  fi
  while IFS= read -r address; do
    [[ -n "$address" ]] || continue
    printf '  http://%s:%s%s\n' "$address" "$port" "$path"
  done < <(access_hosts "$bind_host" | awk '!/^(0\.|169\.254\.)/ && !seen[$0]++')
}

HEALTH_HOST="$BACKEND_HOST"
if [[ "$HEALTH_HOST" == "0.0.0.0" ]]; then
  HEALTH_HOST="127.0.0.1"
fi
FRONTEND_HEALTH_HOST="$FRONTEND_HOST"
if [[ "$FRONTEND_HEALTH_HOST" == "0.0.0.0" ]]; then
  FRONTEND_HEALTH_HOST="127.0.0.1"
fi
FRONTEND_PID=""
TAIL_PID=""
BACKEND_TAIL_PID=""

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
  if [[ -n "$TAIL_PID" ]]; then
    kill -TERM "$TAIL_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_TAIL_PID" ]]; then
    kill -TERM "$BACKEND_TAIL_PID" 2>/dev/null || true
  fi
  if [[ -n "$FRONTEND_PID" ]]; then
    kill -TERM "$FRONTEND_PID" 2>/dev/null || true
  fi
  stop_backend
}

trap cleanup INT TERM EXIT

stop_backend

cd "$ROOT_DIR"
nohup python -m uvicorn backend.app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT" --log-level error --no-access-log \
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

  if curl -fsS "http://$HEALTH_HOST:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
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

cd "$ROOT_DIR/frontend"
node node_modules/vite/bin/vite.js --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort --logLevel error \
  >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

frontend_ready=0
for _ in {1..80}; do
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend exited during startup. Recent log output:"
    tail -n 80 "$FRONTEND_LOG" || true
    exit 1
  fi
  if curl -fsS "http://$FRONTEND_HEALTH_HOST:$FRONTEND_PORT/" >/dev/null 2>&1; then
    frontend_ready=1
    break
  fi
  sleep 0.25
done

if [[ "$frontend_ready" -ne 1 ]]; then
  echo "Frontend did not become ready in time. Recent log output:"
  tail -n 80 "$FRONTEND_LOG" || true
  exit 1
fi

echo "Everything is ready. Open one of these URLs:"
print_access_urls "" "$FRONTEND_HOST" "$FRONTEND_PORT" "/"
tail -n +1 -f "$FRONTEND_LOG" &
TAIL_PID=$!
tail -n +1 -f "$BACKEND_LOG" &
BACKEND_TAIL_PID=$!

if wait "$FRONTEND_PID"; then
  exit 0
else
  frontend_exit_code=$?
  if [[ "$frontend_exit_code" -ne 130 && "$frontend_exit_code" -ne 143 ]]; then
    echo "Frontend exited with code $frontend_exit_code. Recent log output:"
    tail -n 80 "$FRONTEND_LOG" || true
  fi
  exit "$frontend_exit_code"
fi

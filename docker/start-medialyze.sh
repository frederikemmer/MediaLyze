#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${MEDIALYZE_COMPOSE_FILE:-"$SCRIPT_DIR/docker-compose.yaml"}
cd "$PROJECT_DIR"

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker Compose is required but the docker command was not found." >&2
    exit 1
fi

OVERRIDE_FILE=$(mktemp "${TMPDIR:-/tmp}/medialyze-compose.XXXXXX.yaml")
cleanup() {
    rm -f "$OVERRIDE_FILE"
}
trap cleanup EXIT INT TERM

has_override=0
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    printf '%s\n' 'services:' '  medialyze:' '    gpus: all' > "$OVERRIDE_FILE"
    has_override=1
fi

if [ -d /dev/dri ]; then
    if [ "$has_override" -eq 0 ]; then
        printf '%s\n' 'services:' '  medialyze:' > "$OVERRIDE_FILE"
        has_override=1
    fi
    printf '%s\n' '    devices:' '      - /dev/dri:/dev/dri' >> "$OVERRIDE_FILE"
fi

if [ "$has_override" -eq 1 ]; then
    docker compose -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" up -d "$@"
else
    docker compose -f "$COMPOSE_FILE" up -d "$@"
fi

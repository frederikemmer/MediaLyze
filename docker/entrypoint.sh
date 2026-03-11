#!/bin/sh
set -eu

if [ -n "${PUID:-}" ] || [ -n "${PGID:-}" ]; then
    if [ -z "${PUID:-}" ] || [ -z "${PGID:-}" ]; then
        echo "Both PUID and PGID must be set together." >&2
        exit 1
    fi

    case "${PUID}" in
        ''|*[!0-9]*)
            echo "PUID must be a numeric user id." >&2
            exit 1
            ;;
    esac

    case "${PGID}" in
        ''|*[!0-9]*)
            echo "PGID must be a numeric group id." >&2
            exit 1
            ;;
    esac

    if [ -e /config ]; then
        chown -R "${PUID}:${PGID}" /config
    fi

    exec su-exec "${PUID}:${PGID}" "$@"
fi

exec "$@"

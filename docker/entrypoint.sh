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

    # Docker's group_add entries contain host numeric device groups.  gosu
    # intentionally rebuilds supplementary groups from /etc/group and would
    # otherwise discard those IDs before the application starts.  Preserve
    # them only when a DRM device is actually mounted; the normal path keeps
    # using gosu and its regular group lookup behavior.
    if [ -d /dev/dri ]; then
        exec python3 - "${PUID}" "${PGID}" "$@" <<'PY'
import os
import sys

uid = int(sys.argv[1])
gid = int(sys.argv[2])
command = sys.argv[3:]
groups = set(os.getgroups())
if gid != 0:
    groups.discard(0)
groups.add(gid)
os.setgroups(sorted(groups))
os.setgid(gid)
os.setuid(uid)
os.execvp(command[0], command)
PY
    fi

    exec gosu "${PUID}:${PGID}" "$@"
fi

exec "$@"

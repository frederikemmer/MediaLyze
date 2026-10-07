"""Lossless storage encoding and bounded, resumable legacy file-history migration.

Only snapshot storage changes; IDs, hashes, timestamps and retention decisions do
not. Library history remains JSON so SQLite can project individual chart metrics.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import zlib
from collections.abc import Callable
from time import monotonic

from sqlalchemy import String, cast, select, text
from sqlalchemy.orm import Session

MARKER = "medialyze.file-history.zlib.v1"
CURSOR_KEY = "file_history_compression_v1"


def encode_snapshot_text(raw: str) -> dict | None:
    data = raw.encode("utf-8")
    if len(data) < 1024:
        return None
    envelope = {
        "_encoding": MARKER,
        "logical_chars": len(raw),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "data": base64.b64encode(zlib.compress(data, level=6)).decode("ascii"),
    }
    # Leave small/incompressible snapshots in their original representation.
    return envelope if len(json.dumps(envelope)) < len(data) * .9 else None


def decode_snapshot(value):
    if not isinstance(value, dict) or value.get("_encoding") != MARKER:
        return value
    data = zlib.decompress(base64.b64decode(value["data"], validate=True))
    if len(data) != value["bytes"] or hashlib.sha256(data).hexdigest() != value["sha256"]:
        raise ValueError("File-history snapshot integrity check failed")
    return json.loads(data)


def compress_file_history_batch(db: Session, *, limit=200, seconds=1.0,
                                should_continue: Callable[[], bool] = lambda: True) -> int:
    from backend.app.models.entities import AppSetting, MediaFileHistory
    state = db.get(AppSetting, CURSOR_KEY)
    cursor = int((state.value if state else {}).get("last_id", 0))
    start = monotonic()
    changed = 0
    # One decoded source at a time. Use raw SQL for exact stored-text preservation
    # and compare-and-set so concurrent history changes cannot be overwritten.
    rows = db.execute(select(MediaFileHistory.id, cast(MediaFileHistory.snapshot, String))
                      .where(MediaFileHistory.id > cursor).order_by(MediaFileHistory.id)
                      .limit(limit).execution_options(yield_per=1))
    try:
        for row_id, raw in rows:
            if monotonic() - start >= seconds or not should_continue():
                break
            value = json.loads(raw)
            if not (isinstance(value, dict) and value.get("_encoding") == MARKER):
                envelope = encode_snapshot_text(raw)
                if envelope is not None:
                    # Verify before committing any replacement.
                    if decode_snapshot(envelope) != value:
                        raise ValueError("File-history compression round trip failed")
                    result = db.execute(text("UPDATE media_file_history SET snapshot=:new WHERE id=:id AND snapshot=:old"),
                                        {"id": row_id, "old": raw, "new": json.dumps(envelope)})
                    changed += result.rowcount
            cursor = row_id
    finally:
        rows.close()
    if state is None:
        db.add(AppSetting(key=CURSOR_KEY, value={"last_id": cursor}))
    else:
        state.value = {"last_id": cursor}
    db.commit()
    if changed:
        logging.getLogger("uvicorn.error").info("File-history compression: %s snapshots encoded, cursor %s", changed, cursor)
    return changed


def restore_plain_json(database_path: str) -> int:
    """Offline downgrade helper. Restore exact original JSON, never delete history."""
    import sqlite3
    from pathlib import Path
    path = Path(database_path).resolve(strict=True)
    connection = sqlite3.connect(f"{path.as_uri()}?mode=rw", uri=True, timeout=5)
    restored = 0
    cursor = 0
    try:
        while True:
            rows = connection.execute(
                "SELECT id,snapshot FROM media_file_history WHERE id>? ORDER BY id LIMIT 50", (cursor,)
            )
            found = False
            for row_id, raw in rows:
                found = True
                value = json.loads(raw)
                if isinstance(value, dict) and value.get("_encoding") == MARKER:
                    decode_snapshot(value)  # Validate integrity before replacement.
                    original = zlib.decompress(base64.b64decode(value["data"], validate=True)).decode("utf-8")
                    connection.execute("UPDATE media_file_history SET snapshot=? WHERE id=? AND snapshot=?", (original, row_id, raw))
                    restored += 1
                cursor = row_id
            rows.close()
            connection.commit()
            if not found:
                break
        connection.execute("DELETE FROM app_settings WHERE key=?", (CURSOR_KEY,))
        connection.commit()
        return restored
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Offline, lossless file-history downgrade helper; stop MediaLyze first.")
    parser.add_argument("--restore-json", required=True, metavar="EXISTING_DATABASE")
    args = parser.parse_args()
    print(f"Restored {restore_plain_json(args.restore_json)} snapshots to plain JSON.")

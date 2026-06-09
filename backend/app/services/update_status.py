from __future__ import annotations

import json
import re
import ssl
import urllib.request
from datetime import datetime, timedelta
import certifi
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.models.entities import AppSetting
from backend.app.schemas.update_status import UpdateStatusRead
from backend.app.utils.time import utc_now

UPDATE_STATUS_KEY = "update_status"
UPDATE_STATUS_MAX_AGE = timedelta(hours=12)
LATEST_RELEASE_URL = "https://api.github.com/repos/frederikemmer/MediaLyze/releases/latest"
REMOTE_CHANGELOG_URL = "https://raw.githubusercontent.com/frederikemmer/MediaLyze/main/CHANGELOG.md"
SEMVER_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
CHANGELOG_HEADING_PATTERN = re.compile(r"^##\s+v([0-9][^\s]*)\s*$", re.MULTILINE)


def normalize_stable_version(value: str | None) -> str | None:
    candidate = (value or "").strip()
    match = SEMVER_PATTERN.fullmatch(candidate)
    if match is None:
        return None
    return ".".join(match.groups())


def semver_key(value: str) -> tuple[int, int, int]:
    normalized = normalize_stable_version(value)
    if normalized is None:
        raise ValueError(f"Unsupported stable version: {value}")
    major, minor, patch = normalized.split(".")
    return int(major), int(minor), int(patch)


def is_newer_stable_version(candidate: str | None, current: str | None) -> bool:
    normalized_candidate = normalize_stable_version(candidate)
    normalized_current = normalize_stable_version(current)
    if normalized_candidate is None or normalized_current is None:
        return False
    return semver_key(normalized_candidate) > semver_key(normalized_current)


def _clean_markdown_text(value: str) -> str:
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def _clean_release_note_item_text(value: str) -> str:
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def _parse_release_notes_block(version: str, block: str) -> dict | None:
    payload = {"version": version, "date": None, "sections": []}
    current_section: dict | None = None
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(">"):
            payload["date"] = _clean_markdown_text(line[1:])
            continue
        section_match = re.match(r"^###\s+(.+)$", line)
        if section_match:
            current_section = {"title": _clean_markdown_text(section_match.group(1)), "items": []}
            payload["sections"].append(current_section)
            continue
        item_match = re.match(r"^-\s+(.+)$", line)
        if item_match:
            if current_section is None:
                current_section = {"title": "", "items": []}
                payload["sections"].append(current_section)
            current_section["items"].append(_clean_release_note_item_text(item_match.group(1)))
    return payload if any(section["items"] for section in payload["sections"]) else None


def parse_remote_release_notes(markdown: str) -> list[dict]:
    headings = list(CHANGELOG_HEADING_PATTERN.finditer(markdown))
    release_notes: list[dict] = []
    for index, heading in enumerate(headings):
        version = normalize_stable_version(heading.group(1))
        if version is None:
            continue
        next_heading = headings[index + 1] if index + 1 < len(headings) else None
        block_end = next_heading.start() if next_heading is not None else len(markdown)
        parsed = _parse_release_notes_block(version, markdown[heading.end() : block_end])
        if parsed is not None:
            release_notes.append(parsed)
    return release_notes


def _get_text(url: str, timeout_seconds: float) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json" if url.endswith("/latest") else "text/plain",
            "User-Agent": "MediaLyze-update-check",
        },
    )
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(request, timeout=timeout_seconds, context=context) as response:
        return response.read().decode("utf-8")


def get_update_status(db: Session, settings: Settings) -> UpdateStatusRead:
    stored = db.get(AppSetting, UPDATE_STATUS_KEY)
    payload = dict(stored.value) if stored is not None else {}
    if isinstance(payload.get("checked_at"), str):
        payload["checked_at"] = datetime.fromisoformat(payload["checked_at"].replace("Z", "+00:00"))
    payload["current_version"] = settings.app_version
    payload["update_available"] = is_newer_stable_version(payload.get("latest_version"), settings.app_version)
    return UpdateStatusRead.model_validate(payload)


def _is_update_status_stale(status: UpdateStatusRead) -> bool:
    if status.checked_at is None:
        return True
    return utc_now() - status.checked_at > UPDATE_STATUS_MAX_AGE


def get_or_check_update_status(db: Session, settings: Settings) -> UpdateStatusRead:
    status = get_update_status(db, settings)
    if not _is_update_status_stale(status):
        return status
    return check_for_updates(db, settings) or status


def check_for_updates(db: Session, settings: Settings) -> UpdateStatusRead | None:
    current_version = normalize_stable_version(settings.app_version)
    if current_version is None:
        return None

    try:
        release_payload = json.loads(_get_text(LATEST_RELEASE_URL, settings.telemetry_timeout_seconds))
        latest_version = normalize_stable_version(release_payload.get("tag_name"))
        if release_payload.get("draft") or release_payload.get("prerelease") or latest_version is None:
            return None
        release_notes = parse_remote_release_notes(_get_text(REMOTE_CHANGELOG_URL, settings.telemetry_timeout_seconds))
    except (OSError, ValueError, json.JSONDecodeError):
        return None

    checked_at = utc_now()
    payload = {
        "latest_version": latest_version,
        "checked_at": checked_at.isoformat(),
        "release_notes": release_notes,
    }
    stored = db.get(AppSetting, UPDATE_STATUS_KEY)
    if stored is None:
        db.add(AppSetting(key=UPDATE_STATUS_KEY, value=payload))
    else:
        stored.value = payload
    db.commit()
    return get_update_status(db, settings)

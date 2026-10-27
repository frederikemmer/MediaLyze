from __future__ import annotations

import re
from typing import Any


_SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|credential)",
    re.IGNORECASE,
)
_SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)"
    r"(\s*[:=]\s*)([^\s,;]+)"
)
_URL_CREDENTIALS = re.compile(r"(?P<scheme>https?://)[^/@\s]+@", re.IGNORECASE)


def contains_sensitive_connector_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            _SENSITIVE_KEY.search(str(key)) or contains_sensitive_connector_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(contains_sensitive_connector_key(item) for item in value)
    return False


def public_connector_payload(value: Any, *, secrets: tuple[str, ...] = ()) -> Any:
    if isinstance(value, dict):
        return {
            str(key): public_connector_payload(item, secrets=secrets)
            for key, item in value.items()
            if not _SENSITIVE_KEY.search(str(key))
        }
    if isinstance(value, list):
        return [public_connector_payload(item, secrets=secrets) for item in value]
    if isinstance(value, str):
        result = value
        for secret in secrets:
            if secret:
                result = result.replace(secret, "***")
        return redact_connector_error(result, limit=max(len(result), 1))
    return value


def redact_connector_error(
    error: BaseException | str,
    *,
    secrets: tuple[str, ...] = (),
    limit: int = 2048,
) -> str:
    message = (
        (str(error) or error.__class__.__name__)
        if isinstance(error, BaseException)
        else str(error)
    )
    for secret in secrets:
        if secret:
            message = message.replace(secret, "***")
    message = _URL_CREDENTIALS.sub(r"\g<scheme>***@", message)
    message = _SENSITIVE_ASSIGNMENT.sub(r"\1\2***", message)
    return message[:limit]

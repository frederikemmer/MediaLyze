"""Atomic personal preference updates, independent of browser/desktop sessions."""

import json

from sqlalchemy import func, update
from sqlalchemy.dialects.sqlite import insert

from backend.app.models.access import LocalAccount
from backend.app.models.entities import AppSetting
from backend.app.schemas.app_settings import UiPreferencesRead
from backend.app.services.access import fail

DESKTOP_PREFERENCES_KEY = "desktop_preferences"
MAX_PREFERENCE_BYTES = 262144


def read_preferences(db, principal):
    if principal.kind == "account":
        return db.get(LocalAccount, principal.id).preferences
    if principal.kind != "desktop":
        fail()
    saved = db.get(AppSetting, DESKTOP_PREFERENCES_KEY)
    if saved is not None:
        return saved.value
    # Preserve existing Desktop/NO_USERS appearance and Notification settings.
    from backend.app.services.app_settings import APP_SETTINGS_KEY

    legacy = db.get(AppSetting, APP_SETTINGS_KEY)
    ui = (legacy.value if legacy else {}).get("ui_preferences", {})
    return {"ui_preferences": UiPreferencesRead.model_validate(ui).model_dump(mode="json")}


def _patch_expression(value, patch):
    for key, item in patch.items():
        if key == "ui_preferences":
            # Merge each owned field against the current SQL value, never a stale
            # ORM/browser snapshot from another settings editor or tab.
            for field, field_value in item.items():
                if field == "notifications":
                    for notification_field, notification_value in field_value.items():
                        value = func.json_set(
                            value, f"$.ui_preferences.notifications.{notification_field}",
                            func.json(json.dumps(notification_value)),
                        )
                else:
                    value = func.json_set(
                        value, f"$.ui_preferences.{field}", func.json(json.dumps(field_value))
                    )
        else:
            # Storage is a complete snapshot; removed layout keys must stay removed.
            value = func.json_set(value, "$.storage", func.json(json.dumps(item)))
    return value


def patch_preferences(db, principal, patch):
    if len(json.dumps(patch).encode()) > MAX_PREFERENCE_BYTES:
        fail(413, "Preferences too large")
    if principal.kind == "account":
        statement = (
            update(LocalAccount)
            .where(LocalAccount.id == principal.id)
            .values(preferences=_patch_expression(LocalAccount.preferences, patch))
            .returning(LocalAccount.preferences)
        )
    elif principal.kind == "desktop":
        initial = read_preferences(db, principal)
        previous_notifications = initial.get("ui_preferences", {}).get("notifications", {})
        initial = {**initial, **{k: v for k, v in patch.items() if k != "ui_preferences"}}
        initial["ui_preferences"] = {
            **initial.get("ui_preferences", {}),
            **patch.get("ui_preferences", {}),
        }
        if "notifications" in patch.get("ui_preferences", {}):
            initial["ui_preferences"]["notifications"] = {
                **previous_notifications,
                **patch["ui_preferences"]["notifications"],
            }
        statement = (
            insert(AppSetting)
            .values(key=DESKTOP_PREFERENCES_KEY, value=initial)
            .on_conflict_do_update(
                index_elements=[AppSetting.key],
                set_={"value": _patch_expression(AppSetting.value, patch)},
            )
            .returning(AppSetting.value)
        )
    else:
        fail()
    result = db.execute(statement.execution_options(synchronize_session=False)).scalar_one()
    if len(json.dumps(result).encode()) > MAX_PREFERENCE_BYTES:
        fail(413, "Preferences too large")
    db.commit()
    db.expire_all()
    return result

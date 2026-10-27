"""Explicit runtime policy over the registered route inventory.

Open product mappings and complex unprojected payloads remain Owner-only.
New method/path pairs are denied even to the Owner until explicitly inventoried.
"""

import json
from pathlib import Path
from backend.app.services.access import fail
from backend.app.models.entities import Library, MediaFile, TranscodeVariant
from sqlalchemy import select, text
from pydantic import TypeAdapter

INVENTORY = json.loads(Path(__file__).with_name("access_inventory.json").read_text())
AUTH_PATHS = {
    ("GET", "/me/passkeys"),
    ("POST", "/me/passkeys/options"),
    ("POST", "/me/passkeys/verify"),
    ("PATCH", "/me/passkeys/{passkey_id}"),
    ("DELETE", "/me/passkeys/{passkey_id}"),
    ("POST", "/auth/passkeys/options"),
    ("POST", "/auth/passkeys/verify"),

    ("GET", "/auth/status"),
    ("POST", "/auth/setup"),
    ("POST", "/auth/login"),
    ("POST", "/auth/guest"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/password"),
    ("GET", "/users"),
    ("POST", "/users"),
    ("PATCH", "/users/{account_id}"),
    ("DELETE", "/users/{account_id}"),
    ("GET", "/access/guest"),
    ("PUT", "/access/guest"),
    ("GET", "/access/libraries"),
    ("GET", "/me/preferences"),
    ("PUT", "/me/preferences"),
    ("PATCH", "/me/account"),
}
PUBLIC_AUTH = {"/auth/passkeys/options", "/auth/passkeys/verify", "/auth/status", "/auth/setup", "/auth/login", "/auth/guest", "/auth/logout"}
TECHNICAL_LIBRARY_READ = {
    "library_summary",
    "library_statistics",
    "library_statistics_comparison",
    "library_duplicates",
    "library_history",
    "library_series",
    "library_series_detail",
    "library_series_grouped_detail",
    "library_files",
    "library_grouped_files",
    "library_storage_map",
    "library_scan_jobs",
}
TECHNICAL_FILE_READ = {
    "file_detail",
    "file_raw_ffprobe",
    "file_stream_details",
    "file_quality_score",
    "file_history",
    "file_cover",  # Display and download are both metadata access, with the same file scope.
}
GLOBAL_POLICIES = {
    "jellyfin_path_mappings": "connector.view",
    "jellyfin_users_update": "connector.manage",
    "jellyfin_sync_start": "connector.manage",
    "jellyfin_sync_cancel": "connector.manage",
    "performance_snapshot": "settings.app.view",
    "history_storage": "settings.app.view",
    "telemetry_preview": "settings.app.view",
    "telemetry_send_now": "settings.app.edit",
    "connector_providers": "connector.view",
    "connector_provider_descriptors": "connector.view",
    "connector_connections": "connector.view",
    "connector_connection_get": "connector.view",
    "connector_connection_create": "connector.manage",
    "connector_connection_update": "connector.manage",
    "connector_connection_delete": "connector.manage",
    "connector_connection_test": "connector.manage",
    "connector_sync_start": "connector.manage",
    "connector_sync_cancel": "connector.manage",
    "dashboard": "overview.dashboard",
    "dashboard_history": "overview.dashboard",
    "dashboard_comparison": "overview.dashboard",
    "file_search": "overview.compare",
    "quality_profiles_list": "settings.quality.view",
    "quality_profile_create": "settings.quality.edit",
    "quality_profile_update": "settings.quality.edit",
    "quality_profile_delete": "settings.quality.edit",
    "compatibility_hardware_profiles": "settings.hardware.view",
    "create_compatibility_hardware_profile": "settings.hardware.edit",
    "update_compatibility_hardware_profile": "settings.hardware.edit",
    "delete_compatibility_hardware_profile": "settings.hardware.edit",
    "compatibility_software_profiles": "settings.hardware.view",
    "create_compatibility_software_profile": "settings.hardware.edit",
    "update_compatibility_software_profile": "settings.hardware.edit",
    "delete_compatibility_software_profile": "settings.hardware.edit",
    "compatibility_profiles": "settings.hardware.view",
    "create_compatibility_profile": "settings.hardware.edit",
    "update_compatibility_profile": "settings.hardware.edit",
    "delete_compatibility_profile": "settings.hardware.edit",
    "transcoding_presets_list": "settings.presets.view",
    "transcoding_preset_detail": "settings.presets.view",
    "transcoding_preset_create": "settings.presets.edit",
    "transcoding_preset_update": "settings.presets.edit",
    "transcoding_preset_delete": "settings.presets.edit",
    "transcoding_preset_duplicate": "settings.presets.edit",
    "transcoding_formatting_presets_list": "settings.presets.view",
    "transcoding_formatting_preset_create": "settings.presets.edit",
    "transcoding_formatting_preset_update": "settings.presets.edit",
    "transcoding_formatting_preset_delete": "settings.presets.edit",
}

# Explicit installation-wide diagnostic DTOs, authorized before lifting SQL scope.
# Do not include ordinary media/catalog routes or general app-settings reads.
OPERATIONAL_GLOBAL_SCOPE = {"history_storage", "telemetry_preview", "telemetry_send_now"}

# External catalog authority never disables local-file/root/match scopes.
CATALOG_READS = {
    "connector_libraries", "connector_locations", "connector_bindings",
    "connector_mapping_overview", "connector_items", "connector_item_status_summary",
    "connector_item_provider_payload", "connector_users",
    "jellyfin_catalog_summary", "jellyfin_libraries", "jellyfin_library_overview",
    "jellyfin_library_items", "jellyfin_unmatched", "jellyfin_item_detail", "jellyfin_image",
    "jellyfin_users",
}


def authorize(request, db, principal, name, params, body):
    if principal.owner:
        return
    if name == "notification_history":
        return  # The endpoint derives its owner solely from the authenticated request.
    query = request.query_params
    if not principal.has("connector.playback"):
        if name in CATALOG_READS and any(key in query for key in ("played", "user_id")):
            fail()
        if any(
            key in {"sort_key", "x_field", "y_field", "metric", "panels"}
            and any(
                word in str(value).lower()
                for word in ("play_count", "users_played", "user_plays", "playback")
            )
            for key, value in query.multi_items()
        ):
            fail()

    def require(right, library_id=None):
        if not principal.has(right, library_id):
            fail(
                404 if library_id is not None else 403,
                "Not found" if library_id is not None else "Forbidden",
            )

    path_mapping_writes = {
        "jellyfin_path_mappings_batch_update", "jellyfin_path_mapping_create",
        "jellyfin_path_mapping_update", "jellyfin_path_mapping_delete",
    }
    if name == "jellyfin_path_mappings":
        require("connector.view")
        return  # The response handler returns mappings fully contained in readable roots.
    if name in path_mapping_writes:
        require("connector.manage")
        # A global path rewrite can rematch every local library. Require explicit
        # read and path-management authority for all affected libraries.
        ids = list(db.execute(text("SELECT id FROM libraries ORDER BY id")).scalars())
        if not ids or any(
            not principal.has("library.read", library_id)
            or not principal.has("library.paths", library_id)
            for library_id in ids
        ):
            fail()
        return
    library_id = params.get("library_id")
    file_id = params.get("file_id")
    if file_id is not None:
        library_id = db.scalar(select(MediaFile.library_id).where(MediaFile.id == int(file_id)))
        if library_id is None:
            fail(404, "Not found")
    if "variant_id" in params:
        # Preserve origin through the root, even when the primary file is gone.
        from backend.app.models.entities import TranscodeVariantGroup

        library_id = db.scalar(
            select(TranscodeVariantGroup.library_id)
            .join(TranscodeVariant, TranscodeVariant.group_id == TranscodeVariantGroup.id)
            .where(TranscodeVariant.id == int(params["variant_id"]))
        )
        if library_id is None:
            fail(404, "Not found")
    if library_id is not None:
        library_id = int(library_id)
        require("library.read", library_id)
        if db.get(Library, library_id) is None:
            fail(404, "Not found")
    if name == "file_connector_playback":
        require("connector.playback")
        return
    if name in {"file_connector_sources", "file_jellyfin_overlay"}:
        return  # Already resolved and authorized by local file/library identity.
    if name == "jellyfin_image" and not principal.has("connector.view"):
        from backend.app.models.entities import JellyfinMediaMatch

        target = db.scalar(select(MediaFile.library_id).join(
            JellyfinMediaMatch, JellyfinMediaMatch.media_file_id == MediaFile.id
        ).where(JellyfinMediaMatch.jellyfin_item_id == int(params["item_id"]),
                JellyfinMediaMatch.status == "matched"))
        if target is None:
            fail(404, "Not found")
        require("library.read", target)
        return
    if name in CATALOG_READS:
        require("connector.view")
        return
    if name in {"file_compatibility", "file_hardware_compatibility", "file_software_compatibility"}:
        require("settings.hardware.view")
        return  # File identity and metadata-read scope were checked above.
    if name == "evaluate_saved_compatibility_profile":
        require("settings.hardware.view")
        try:
            target_id = int(body.get("file_id", 0))
        except (ValueError, TypeError):
            fail(422, "Invalid file")
        target_library = db.scalar(select(MediaFile.library_id).where(MediaFile.id == target_id))
        if target_library is None:
            fail(404, "Not found")
        require("library.read", target_library)
        return
    rule_reads = {"transcoding_rules_list", "transcoding_rule_detail"}
    rule_writes = {
        "transcoding_rule_create",
        "transcoding_rule_update",
        "transcoding_rule_delete",
        "transcoding_rule_replacement_approval",
    }
    if name in rule_reads | rule_writes:
        from backend.app.models.entities import TranscodeRule

        require("settings.app.view")
        write = name in rule_writes
        if write:
            require("settings.app.edit")
        existing = None
        if "rule_id" in params:
            existing = db.get(TranscodeRule, int(params["rule_id"]))
            if existing is None:
                fail(404, "Not found")
            if not existing.library_ids:
                fail(403, "Explicit library scope required")

        def scope_check(target_ids, replace=False):
            for target in target_ids:
                if not isinstance(target, int) or isinstance(target, bool):
                    fail(422, "Invalid library scope")
                require("library.read", target)
                require("transcode.view", target)
                if write:
                    require("transcode.run", target)
                    if replace:
                        require("transcode.replace", target)

        if existing is not None:
            scope_check(
                existing.library_ids,
                existing.output_mode == "replace_original"
                or name == "transcoding_rule_replacement_approval",
            )
        if write and name != "transcoding_rule_delete":
            target_ids = body.get("library_ids", existing.library_ids if existing else [])
            if not isinstance(target_ids, list) or not target_ids:
                fail(422, "Explicit library scope required")
            scope_check(
                target_ids,
                body.get("output_mode", existing.output_mode if existing else "transcode_output")
                == "replace_original",
            )
        return
    if name in TECHNICAL_LIBRARY_READ or name in TECHNICAL_FILE_READ:
        if name == "library_storage_map":
            require("overview.storage")
        return
    if name in {"file_media", "transcode_variant_media"}:
        try:
            download = TypeAdapter(bool).validate_python(query.get("download", "false"))
        except ValueError:
            fail(422, "Invalid download option")
        require("library.download" if download else "library.preview", library_id)
        return
    if name in {"library_files_export_csv", "file_chapters_export"}:
        require("library.export", library_id)
        return
    if name in {"library_scan", "library_scan_cancel"}:
        require("library.scan", library_id)
        return
    if name == "history_reconstruct":
        from backend.app.services.access_jobs import history_target_ids
        if set(body) - {"library_ids"}:
            fail(422, "Invalid reconstruction request")
        history_target_ids(db, body.get("library_ids"))
        return
    if name in {"history_reconstruct_status", "library_history_reconstruct_status"}:
        return  # Runtime returns no status for work outside the caller's readable scope.
    if name == "library_history_reconstruct":
        require("library.scan", library_id)
        return
    if name in {"library_duplicate_suppression_create", "library_duplicate_suppression_delete"}:
        require("library.edit", library_id)
        return
    if name == "cancel_active_scan_jobs":
        return  # The route cancels only the caller's permitted libraries.
    if name in {"active_scan_jobs", "recent_scan_jobs"}:
        return  # SQL scopes scan/quality jobs before deduplication and pagination.
    if name == "scan_job_detail":
        from backend.app.models.entities import ScanJob

        job = db.get(ScanJob, int(params["job_id"]))
        if job is None:
            fail(404, "Not found")
        require("library.read", job.library_id)
        return
    if name in {"file_transcode_detail", "file_transcode_validate", "file_transcode_start"}:
        require("transcode.view", library_id)
        if name != "file_transcode_detail":
            require("transcode.run", library_id)
            if body.get("target_mode", "local") != "local":
                fail(403, "Federation access policy is pending")
            from backend.app.services.app_settings import get_app_settings

            output_mode = (
                body.get("output_mode") or get_app_settings(db).transcoding.default_output_mode
            )
            if output_mode == "replace_original":
                require("transcode.replace", library_id)
        return
    if name in {"transcode_jobs_active", "transcode_jobs_list"}:
        if query.get("library_id"):
            try:
                selected_library = int(query["library_id"])
            except ValueError:
                fail(422, "Invalid library")
            require("library.read", selected_library)
            require("transcode.view", selected_library)
        return  # SQL scopes by transcode.view before totals and pagination.
    if name in {"transcode_job_detail", "transcode_job_delete", "transcode_job_cancel"}:
        from backend.app.models.entities import TranscodeJob
        from backend.app.models.access import JobAuthority

        job = db.get(TranscodeJob, int(params["job_id"]))
        if not job:
            fail(404, "Not found")
        require("library.read", job.library_id)
        require("transcode.view", job.library_id)
        if name == "transcode_job_delete":
            require("transcode.clean", job.library_id)
        if name == "transcode_job_cancel":
            provenance = db.get(JobAuthority, f"transcode:{job.id}")
            own = (
                provenance is not None
                and principal.kind == "account"
                and provenance.actor_kind == "account"
                and provenance.actor_id == principal.id
            )
            require("transcode.cancel_own" if own else "transcode.cancel_other", job.library_id)
        return
    if name in {"app_settings", "update_status"}:
        return  # app_settings returns a safe UI projection without its global view right.
    if name == "app_settings_update":
        if set(body) - {"ui_preferences"}:
            require("settings.app.view")
            require("settings.app.edit")
        elif principal.kind != "account":
            fail()
        return
    if name == "libraries":
        return
    if name == "library_delete":
        require("library.delete", library_id)
        return
    if name == "library_update":
        # Allow reviewed fields only. Connector preference and history reconstruction remain restricted.
        safe = {
            "name",
            "type",
            "scan_mode",
            "scan_config",
            "duplicate_detection_mode",
            "quality_profile",
            "quality_profile_id",
            "show_on_dashboard",
            "path",
            "paths",
            "roots",
        }
        if set(body) - safe:
            fail()
        if set(body) & {"path", "paths", "roots"}:
            require("library.paths", library_id)
        if set(body) - {"path", "paths", "roots"}:
            require("library.edit", library_id)
        return
    if name == "libraries_create":
        if not principal.can_create():
            fail()
        # Prevent alternate connector setup paths through nested create fields.
        if body.get("preferred_connector_connection_id") is not None:
            fail()
        return
    if name == "browse":
        context = query.get("context")
        if context == "create" and principal.can_create():
            return
        if context == "edit":
            try:
                target = int(query.get("library_id", ""))
            except ValueError:
                fail()
            require("library.paths", target)
            return
        fail()
    if name == "transcoding_rules_reorder":
        fail(403, "Global ordering of partially visible rules is restricted")
    if name in GLOBAL_POLICIES:
        right = GLOBAL_POLICIES[name]
        require(right)
        if right.endswith(".edit"):
            require(right[:-5] + ".view")
        if right == "connector.manage":
            require("connector.view")
        return
    # Unresolved mappings and unfinished projections do not grant access.
    fail(403, "This operation is restricted pending a reviewed access policy")

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime

from sqlalchemy import Float, and_, case, cast, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    Library,
    LibraryHistory,
    MediaFile,
    MediaFileHistory,
    MediaFileHistoryCaptureReason,
    MediaFormat,
    ScanStatus,
    SubtitleStream,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.container_formats import normalize_container
from backend.app.services.languages import normalize_language_code
from backend.app.services.library_service import get_library_summary
from backend.app.services.media_service import serialize_media_file_detail
from backend.app.services.numeric_distributions import (
    NUMERIC_DISTRIBUTION_CONFIGS,
    audio_bitrate_value_expression,
    bitrate_value_expression,
    build_audio_bitrate_subquery,
)
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.spatial_audio import format_spatial_audio_profile
from backend.app.services.video_queries import primary_video_streams_subquery
from backend.app.utils.time import utc_now


RESOLUTION_MP_BINS: tuple[tuple[float | None, float | None], ...] = (
    (0.0, 1.0),
    (1.0, 2.0),
    (2.0, 4.0),
    (4.0, 8.0),
    (8.0, 12.0),
    (12.0, 20.0),
    (20.0, None),
)


def _canonicalize_snapshot(snapshot: dict) -> tuple[dict, str]:
    payload = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return snapshot, hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_media_file_history_snapshot(media_file: MediaFile, resolution_categories) -> tuple[dict, str]:
    snapshot = serialize_media_file_detail(media_file, resolution_categories).model_dump(mode="json")
    return _canonicalize_snapshot(snapshot)


def create_media_file_history_entry_if_changed(
    db: Session,
    media_file: MediaFile,
    capture_reason: MediaFileHistoryCaptureReason,
    resolution_categories,
    *,
    captured_at: datetime | None = None,
) -> bool:
    snapshot, snapshot_hash = build_media_file_history_snapshot(media_file, resolution_categories)
    latest_hash = db.scalar(
        select(MediaFileHistory.snapshot_hash)
        .where(
            MediaFileHistory.library_id == media_file.library_id,
            MediaFileHistory.relative_path == media_file.relative_path,
        )
        .order_by(MediaFileHistory.captured_at.desc(), MediaFileHistory.id.desc())
        .limit(1)
    )
    if latest_hash == snapshot_hash:
        return False

    db.add(
        MediaFileHistory(
            library_id=media_file.library_id,
            media_file_id=media_file.id,
            relative_path=media_file.relative_path,
            filename=media_file.filename,
            captured_at=captured_at or utc_now(),
            capture_reason=capture_reason,
            snapshot_hash=snapshot_hash,
            snapshot=snapshot,
        )
    )
    return True


def _resolution_category_id_expression(primary_video_streams, resolution_categories):
    max_edge = func.max(primary_video_streams.c.width, primary_video_streams.c.height)
    min_edge = func.min(primary_video_streams.c.width, primary_video_streams.c.height)
    return case(
        *[
            (
                and_(max_edge >= category.min_width, min_edge >= category.min_height),
                category.id,
            )
            for category in resolution_categories
        ],
        else_=resolution_categories[-1].id if resolution_categories else None,
    )


def _normalized_text(value: str | None, fallback: str) -> str:
    candidate = (value or "").strip().lower()
    return candidate or fallback


def _scan_status_value(value) -> str:
    if isinstance(value, ScanStatus):
        return value.value
    return str(value or ScanStatus.pending.value)


def _numeric_summary(values: list[float]) -> dict:
    if not values:
        return {
            "count": 0,
            "sum": 0.0,
            "average": None,
            "minimum": None,
            "maximum": None,
        }
    total = float(sum(values))
    return {
        "count": len(values),
        "sum": total,
        "average": total / len(values),
        "minimum": float(min(values)),
        "maximum": float(max(values)),
    }


def _bin_key(lower: float | None, upper: float | None) -> tuple[float | None, float | None]:
    return lower, upper


def _numeric_distribution(values: list[float], bins: tuple[tuple[float | None, float | None], ...]) -> dict:
    counts = {_bin_key(lower, upper): 0 for lower, upper in bins}
    for value in values:
        for lower, upper in bins:
            if (lower is None or value >= lower) and (upper is None or value < upper):
                counts[_bin_key(lower, upper)] += 1
                break

    total = len(values)
    return {
        "total": total,
        "bins": [
            {
                "lower": lower,
                "upper": upper,
                "count": counts[_bin_key(lower, upper)],
                "percentage": (counts[_bin_key(lower, upper)] / total) * 100.0 if total > 0 else 0.0,
            }
            for lower, upper in bins
        ],
    }


def _numeric_distribution_bins() -> dict[str, tuple[tuple[float | None, float | None], ...]]:
    return {
        **{config.metric_id: config.bins for config in NUMERIC_DISTRIBUTION_CONFIGS},
        "resolution_mp": RESOLUTION_MP_BINS,
    }


def _counts_from_mapping(values_by_file: dict[int, set[str]]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for values in values_by_file.values():
        for value in values:
            counts[value] += 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _audio_category_counts(db: Session, library_id: int) -> dict[str, dict[str, int]]:
    audio_codecs_by_file: dict[int, set[str]] = defaultdict(set)
    audio_spatial_profiles_by_file: dict[int, set[str]] = defaultdict(set)
    audio_languages_by_file: dict[int, set[str]] = defaultdict(set)

    rows = db.execute(
        select(
            AudioStream.media_file_id,
            AudioStream.codec,
            AudioStream.spatial_audio_profile,
            AudioStream.language,
        )
        .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
        .where(MediaFile.library_id == library_id)
        .where(MediaFile.scan_status == ScanStatus.ready)
    ).all()
    for media_file_id, codec, spatial_audio_profile, language in rows:
        audio_codecs_by_file[int(media_file_id)].add(_normalized_text(codec, "unknown"))
        spatial_label = format_spatial_audio_profile(spatial_audio_profile)
        if spatial_label:
            audio_spatial_profiles_by_file[int(media_file_id)].add(spatial_label)
        audio_languages_by_file[int(media_file_id)].add(normalize_language_code(language) or "und")

    return {
        "audio_codecs": _counts_from_mapping(audio_codecs_by_file),
        "audio_spatial_profiles": _counts_from_mapping(audio_spatial_profiles_by_file),
        "audio_languages": _counts_from_mapping(audio_languages_by_file),
    }


def _subtitle_category_counts(db: Session, library_id: int) -> dict[str, dict[str, int]]:
    subtitle_languages_by_file: dict[int, set[str]] = defaultdict(set)
    subtitle_codecs_by_file: dict[int, set[str]] = defaultdict(set)
    subtitle_sources_by_file: dict[int, set[str]] = defaultdict(set)

    internal_rows = db.execute(
        select(SubtitleStream.media_file_id, SubtitleStream.codec, SubtitleStream.language)
        .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
        .where(MediaFile.library_id == library_id)
        .where(MediaFile.scan_status == ScanStatus.ready)
    ).all()
    for media_file_id, codec, language in internal_rows:
        file_id = int(media_file_id)
        subtitle_languages_by_file[file_id].add(normalize_language_code(language) or "und")
        subtitle_codecs_by_file[file_id].add(_normalized_text(codec, "unknown"))
        subtitle_sources_by_file[file_id].add("internal")

    external_rows = db.execute(
        select(ExternalSubtitle.media_file_id, ExternalSubtitle.format, ExternalSubtitle.language)
        .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
        .where(MediaFile.library_id == library_id)
        .where(MediaFile.scan_status == ScanStatus.ready)
    ).all()
    for media_file_id, subtitle_format, language in external_rows:
        file_id = int(media_file_id)
        subtitle_languages_by_file[file_id].add(normalize_language_code(language) or "und")
        subtitle_codecs_by_file[file_id].add(_normalized_text(subtitle_format, "unknown"))
        subtitle_sources_by_file[file_id].add("external")

    return {
        "subtitle_languages": _counts_from_mapping(subtitle_languages_by_file),
        "subtitle_codecs": _counts_from_mapping(subtitle_codecs_by_file),
        "subtitle_sources": _counts_from_mapping(subtitle_sources_by_file),
    }


def _build_library_trend_metrics_snapshot(db: Session, library_id: int) -> dict:
    resolution_categories = get_app_settings(db).resolution_categories
    resolution_counts = {category.id: 0 for category in resolution_categories}
    primary_video_streams = primary_video_streams_subquery("library_history_primary_video_streams")

    audio_bitrate_totals = build_audio_bitrate_subquery("library_history_audio_bitrate_totals")
    audio_bitrate_expression = audio_bitrate_value_expression(audio_bitrate_totals)
    bitrate_expression = bitrate_value_expression()
    rows = db.execute(
        select(
            MediaFile.id,
            MediaFile.size_bytes,
            MediaFile.scan_status,
            MediaFile.extension,
            MediaFile.quality_score,
            MediaFormat.duration,
            cast(bitrate_expression, Float).label("bitrate"),
            cast(audio_bitrate_expression, Float).label("audio_bitrate"),
            primary_video_streams.c.codec,
            primary_video_streams.c.width,
            primary_video_streams.c.height,
            primary_video_streams.c.hdr_type,
        )
        .select_from(MediaFile)
        .outerjoin(MediaFormat, MediaFormat.media_file_id == MediaFile.id)
        .outerjoin(primary_video_streams, primary_video_streams.c.media_file_id == MediaFile.id)
        .outerjoin(audio_bitrate_totals, audio_bitrate_totals.c.media_file_id == MediaFile.id)
        .where(MediaFile.library_id == library_id)
    ).all()

    numeric_values: dict[str, list[float]] = {
        "quality_score": [],
        "duration": [],
        "size": [],
        "bitrate": [],
        "audio_bitrate": [],
        "resolution_mp": [],
    }
    category_counts: dict[str, dict[str, int]] = {
        "container": {},
        "video_codec": {},
        "resolution": dict(resolution_counts),
        "hdr_type": {},
        "scan_status": {},
    }
    totals = {
        "file_count": 0,
        "ready_files": 0,
        "pending_files": 0,
        "total_size_bytes": 0,
        "total_duration_seconds": 0.0,
    }

    for row in rows:
        scan_status = _scan_status_value(row.scan_status)
        is_ready = scan_status == ScanStatus.ready.value
        size_bytes = max(int(row.size_bytes or 0), 0)
        duration = float(row.duration) if row.duration is not None and row.duration > 0 else None
        bitrate = float(row.bitrate) if row.bitrate is not None and row.bitrate > 0 else None
        audio_bitrate = float(row.audio_bitrate) if row.audio_bitrate is not None and row.audio_bitrate > 0 else None
        quality_score = float(row.quality_score) if row.quality_score is not None and row.quality_score >= 1 else None
        resolution_mp = (
            (float(row.width) * float(row.height)) / 1_000_000
            if row.width is not None and row.height is not None and row.width > 0 and row.height > 0
            else None
        )

        totals["file_count"] += 1
        totals["total_size_bytes"] += size_bytes
        if duration is not None:
            totals["total_duration_seconds"] += duration
        if is_ready:
            totals["ready_files"] += 1
        else:
            totals["pending_files"] += 1

        container = normalize_container(row.extension) or "unknown"
        category_counts["container"][container] = category_counts["container"].get(container, 0) + 1
        category_counts["scan_status"][scan_status] = category_counts["scan_status"].get(scan_status, 0) + 1
        numeric_values["size"].append(float(size_bytes))
        if quality_score is not None:
            numeric_values["quality_score"].append(quality_score)

        if not is_ready:
            continue

        if row.codec:
            codec = _normalized_text(row.codec, "unknown")
            category_counts["video_codec"][codec] = category_counts["video_codec"].get(codec, 0) + 1
        resolution_category = classify_resolution_category(row.width, row.height, resolution_categories)
        if resolution_category is not None:
            resolution_counts[resolution_category.id] = resolution_counts.get(resolution_category.id, 0) + 1
            category_counts["resolution"][resolution_category.id] = category_counts["resolution"].get(resolution_category.id, 0) + 1
        hdr_type = (row.hdr_type or "").strip() or "SDR"
        category_counts["hdr_type"][hdr_type] = category_counts["hdr_type"].get(hdr_type, 0) + 1

        if duration is not None:
            numeric_values["duration"].append(duration)
        if bitrate is not None:
            numeric_values["bitrate"].append(bitrate)
        if audio_bitrate is not None:
            numeric_values["audio_bitrate"].append(audio_bitrate)
        if resolution_mp is not None:
            numeric_values["resolution_mp"].append(resolution_mp)

    category_counts.update(_audio_category_counts(db, library_id))
    category_counts.update(_subtitle_category_counts(db, library_id))

    numeric_summaries = {
        metric_id: _numeric_summary(values)
        for metric_id, values in numeric_values.items()
    }
    distribution_bins = _numeric_distribution_bins()
    numeric_distributions = {
        metric_id: _numeric_distribution(values, distribution_bins[metric_id])
        for metric_id, values in numeric_values.items()
    }

    return {
        "schema_version": 2,
        "total_files": int(totals["ready_files"]),
        "resolution_counts": resolution_counts,
        "average_bitrate": numeric_summaries["bitrate"]["average"],
        "average_audio_bitrate": numeric_summaries["audio_bitrate"]["average"],
        "average_duration_seconds": numeric_summaries["duration"]["average"],
        "average_quality_score": numeric_summaries["quality_score"]["average"],
        "totals": totals,
        "numeric_summaries": numeric_summaries,
        "category_counts": {
            metric_id: dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
            for metric_id, counts in category_counts.items()
        },
        "numeric_distributions": numeric_distributions,
    }


def build_library_history_snapshot(
    db: Session,
    library: Library,
    *,
    scan_summary: dict | None = None,
) -> dict:
    summary = get_library_summary(db, library.id)
    aggregate = summary.model_dump(mode="json") if summary is not None else {}
    scan_summary = scan_summary or {}
    changes = scan_summary.get("changes") or {}
    return {
        "file_count": aggregate.get("file_count", 0),
        "total_size_bytes": aggregate.get("total_size_bytes", 0),
        "total_duration_seconds": aggregate.get("total_duration_seconds", 0.0),
        "ready_files": aggregate.get("ready_files", 0),
        "pending_files": aggregate.get("pending_files", 0),
        "last_scan_at": aggregate.get("last_scan_at"),
        "scan_mode": library.scan_mode.value,
        "duplicate_detection_mode": library.duplicate_detection_mode.value,
        "show_on_dashboard": library.show_on_dashboard,
        "scan_delta": {
            "discovered_files": ((scan_summary.get("discovery") or {}).get("discovered_files") or 0),
            "new_files": ((changes.get("new_files") or {}).get("count") or 0),
            "modified_files": ((changes.get("modified_files") or {}).get("count") or 0),
            "deleted_files": ((changes.get("deleted_files") or {}).get("count") or 0),
        },
        "trend_metrics": _build_library_trend_metrics_snapshot(db, library.id),
    }


def upsert_library_history_snapshot(
    db: Session,
    library: Library,
    *,
    source_scan_job_id: int | None = None,
    scan_summary: dict | None = None,
    captured_at: datetime | None = None,
) -> LibraryHistory:
    captured_at_value = captured_at or utc_now()
    snapshot_day = captured_at_value.date().isoformat()
    snapshot = build_library_history_snapshot(db, library, scan_summary=scan_summary)
    history_row = db.scalar(
        select(LibraryHistory).where(
            LibraryHistory.library_id == library.id,
            LibraryHistory.snapshot_day == snapshot_day,
        )
    )
    if history_row is None:
        history_row = LibraryHistory(
            library_id=library.id,
            snapshot_day=snapshot_day,
        )
        db.add(history_row)
    history_row.captured_at = captured_at_value
    history_row.source_scan_job_id = source_scan_job_id
    history_row.snapshot = snapshot
    return history_row

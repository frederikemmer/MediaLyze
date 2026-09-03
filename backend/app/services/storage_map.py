from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import PurePosixPath

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    JellyfinItem,
    JellyfinMediaMatch,
    Library,
    LibraryRoot,
    MediaFile,
    VideoStream,
)
from backend.app.schemas.storage_map import (
    LibraryStorageMapRead,
    StorageMapBreadcrumbRead,
    StorageMapColorShareRead,
    StorageMapNodeRead,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.stats_cache import stats_cache


class StorageMapPathError(ValueError):
    pass


@dataclass(slots=True)
class _FolderAggregate:
    name: str
    path: str
    size_bytes: int = 0
    file_count: int = 0
    weighted_quality_total: int = 0
    weighted_quality_raw_total: float = 0
    codec_bytes: Counter[str] = field(default_factory=Counter)
    resolution_bytes: Counter[str] = field(default_factory=Counter)
    resolution_category_bytes: Counter[tuple[str, str]] = field(default_factory=Counter)
    hdr_bytes: Counter[str] = field(default_factory=Counter)
    container_bytes: Counter[str] = field(default_factory=Counter)
    audio_codec_bytes: Counter[str] = field(default_factory=Counter)
    audio_channel_bytes: Counter[int] = field(default_factory=Counter)
    frame_rate_bytes: Counter[float] = field(default_factory=Counter)
    bit_depth_bytes: Counter[int] = field(default_factory=Counter)
    audio_language_bytes: Counter[str] = field(default_factory=Counter)
    subtitle_status_bytes: Counter[str] = field(default_factory=Counter)
    subtitle_language_bytes: Counter[str] = field(default_factory=Counter)
    analysis_status_bytes: Counter[str] = field(default_factory=Counter)
    duration_weighted_total: float = 0
    duration_weight: int = 0
    bitrate_weighted_total: int = 0
    bitrate_weight: int = 0
    audio_bitrate_weighted_total: int = 0
    audio_bitrate_weight: int = 0
    color_distribution_bytes: defaultdict[str, Counter] = field(
        default_factory=lambda: defaultdict(Counter),
    )

    def add(
        self,
        *,
        size_bytes: int,
        quality_score: int,
        quality_score_raw: float,
        video_codec: str | None,
        resolution: str | None,
        resolution_category: tuple[str, str] | None,
        hdr_type: str | None,
        container: str | None,
        duration_seconds: float | None,
        bitrate: int | None,
        audio_bitrate: int | None,
        audio_codec: str | None,
        audio_channels: int | None,
        frame_rate: float | None,
        bit_depth: int | None,
        audio_language: str | None,
        subtitle_status: str,
        subtitle_language: str | None,
        analysis_status: str,
    ) -> None:
        weight = max(size_bytes, 1)
        self.size_bytes += size_bytes
        self.file_count += 1
        self.weighted_quality_total += quality_score * weight
        self.weighted_quality_raw_total += quality_score_raw * weight
        if video_codec:
            self.codec_bytes[video_codec] += weight
        if resolution:
            self.resolution_bytes[resolution] += weight
        if resolution_category:
            self.resolution_category_bytes[resolution_category] += weight
        if hdr_type:
            self.hdr_bytes[hdr_type] += weight
        if container:
            self.container_bytes[container] += weight
        if duration_seconds is not None:
            self.duration_weighted_total += duration_seconds * weight
            self.duration_weight += weight
        if bitrate:
            self.bitrate_weighted_total += bitrate * weight
            self.bitrate_weight += weight
        if audio_bitrate:
            self.audio_bitrate_weighted_total += audio_bitrate * weight
            self.audio_bitrate_weight += weight
        if audio_codec:
            self.audio_codec_bytes[audio_codec] += weight
        if audio_channels:
            self.audio_channel_bytes[audio_channels] += weight
        if frame_rate:
            self.frame_rate_bytes[round(frame_rate, 3)] += weight
        if bit_depth:
            self.bit_depth_bytes[bit_depth] += weight
        if audio_language:
            self.audio_language_bytes[audio_language] += weight
        self.subtitle_status_bytes[subtitle_status] += weight
        if subtitle_language:
            self.subtitle_language_bytes[subtitle_language] += weight
        self.analysis_status_bytes[analysis_status] += weight
        distribution_values = {
            "codec": video_codec,
            "resolution": resolution_category[0] if resolution_category else resolution,
            "hdr": hdr_type,
            "quality": quality_score_raw,
            "size": size_bytes,
            "container": container,
            "duration": duration_seconds,
            "bitrate": bitrate,
            "audio_bitrate": audio_bitrate,
            "audio_codec": audio_codec,
            "audio_channels": audio_channels,
            "frame_rate": round(frame_rate, 3) if frame_rate else None,
            "bit_depth": bit_depth,
            "audio_language": audio_language,
            "subtitle_status": subtitle_status,
            "subtitle_language": subtitle_language,
            "analysis_status": analysis_status,
        }
        for mode, value in distribution_values.items():
            self.color_distribution_bytes[mode][value] += weight

    def to_read(self) -> StorageMapNodeRead:
        quality = round(self.weighted_quality_total / max(self.size_bytes, 1)) if self.file_count else None
        quality_raw = (
            round(self.weighted_quality_raw_total / max(self.size_bytes, 1), 2)
            if self.file_count
            else None
        )
        category = _dominant(self.resolution_category_bytes)
        return StorageMapNodeRead(
            kind="folder",
            name=self.name,
            path=self.path,
            size_bytes=self.size_bytes,
            file_count=self.file_count,
            video_codec=_dominant(self.codec_bytes),
            resolution=_dominant(self.resolution_bytes),
            resolution_category_id=category[0] if category else None,
            resolution_category_label=category[1] if category else None,
            hdr_type=_dominant(self.hdr_bytes),
            quality_score=quality,
            quality_score_raw=quality_raw,
            container=_dominant(self.container_bytes),
            duration_seconds=_weighted_average(self.duration_weighted_total, self.duration_weight),
            bitrate=_weighted_average_int(self.bitrate_weighted_total, self.bitrate_weight),
            audio_bitrate=_weighted_average_int(
                self.audio_bitrate_weighted_total,
                self.audio_bitrate_weight,
            ),
            audio_codec=_dominant(self.audio_codec_bytes),
            audio_channels=_dominant(self.audio_channel_bytes),
            frame_rate=_dominant(self.frame_rate_bytes),
            bit_depth=_dominant(self.bit_depth_bytes),
            audio_language=_dominant(self.audio_language_bytes),
            subtitle_status=_dominant(self.subtitle_status_bytes),
            subtitle_language=_dominant(self.subtitle_language_bytes),
            analysis_status=_dominant(self.analysis_status_bytes),
            color_distributions=_color_distributions(self.color_distribution_bytes),
        )


def _dominant(counter: Counter):
    if not counter:
        return None
    return counter.most_common(1)[0][0]


def _weighted_average(total: float, weight: int) -> float | None:
    return round(total / weight, 3) if weight else None


def _weighted_average_int(total: int, weight: int) -> int | None:
    return round(total / weight) if weight else None


def _effective_quality_score_raw(quality_score: int, quality_score_raw: float) -> float:
    return quality_score_raw if quality_score_raw > 0 else quality_score * 10


def _color_distributions(
    distributions: dict[str, Counter],
    *,
    max_entries: int = 10,
) -> dict[str, list[StorageMapColorShareRead]]:
    result: dict[str, list[StorageMapColorShareRead]] = {}
    for mode, counter in distributions.items():
        entries = counter.most_common(max_entries)
        omitted_bytes = sum(counter.values()) - sum(size_bytes for _, size_bytes in entries)
        shares = [
            StorageMapColorShareRead(value=value, size_bytes=size_bytes)
            for value, size_bytes in entries
        ]
        if omitted_bytes > 0:
            unknown_share = next((share for share in shares if share.value is None), None)
            if unknown_share is not None:
                unknown_share.size_bytes += omitted_bytes
            else:
                shares.append(StorageMapColorShareRead(value=None, size_bytes=omitted_bytes))
        result[mode] = shares
    return result


def _subtitle_status(has_internal: bool, has_external: bool) -> str:
    if has_internal and has_external:
        return "mixed"
    if has_external:
        return "external"
    if has_internal:
        return "internal"
    return "none"


def _storage_map_hdr_type(
    hdr_type: str | None,
    *,
    video_codec: str | None,
    video_width: int | None,
    video_height: int | None,
) -> str | None:
    normalized = (hdr_type or "").strip()
    if normalized:
        return normalized
    if video_codec or (video_width and video_height):
        return "SDR"
    return None


def _normalize_path(path: str) -> tuple[str, ...]:
    normalized = path.strip().replace("\\", "/").strip("/")
    if not normalized:
        return ()
    parts = PurePosixPath(normalized).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise StorageMapPathError("Invalid storage map path")
    return tuple(parts)


def get_library_storage_map(
    db: Session,
    library_id: int,
    *,
    path: str = "",
) -> LibraryStorageMapRead | None:
    library = db.scalar(select(Library).where(Library.id == library_id))
    if library is None:
        return None

    current_parts = _normalize_path(path)
    cache_key = str(id(db.get_bind()))
    normalized_path = "/".join(current_parts)
    return stats_cache.get_or_compute_storage_map(
        cache_key,
        library_id,
        normalized_path,
        lambda: _build_library_storage_map(db, library, current_parts),
    )


def _build_library_storage_map(
    db: Session,
    library: Library,
    current_parts: tuple[str, ...],
) -> LibraryStorageMapRead:
    library_id = library.id
    resolution_categories = get_app_settings(db).resolution_categories
    roots = list(
        db.scalars(
            select(LibraryRoot)
            .where(LibraryRoot.library_id == library_id)
            .order_by(LibraryRoot.id.asc())
        )
    )
    root_count = len(roots)
    show_root_names = root_count > 1
    primary_video_frame_rate = (
        select(VideoStream.frame_rate)
        .where(VideoStream.media_file_id == MediaFile.id)
        .order_by(VideoStream.stream_index.asc())
        .limit(1)
        .correlate(MediaFile)
        .scalar_subquery()
    )
    primary_video_bit_depth = (
        select(VideoStream.bit_depth)
        .where(VideoStream.media_file_id == MediaFile.id)
        .order_by(VideoStream.stream_index.asc())
        .limit(1)
        .correlate(MediaFile)
        .scalar_subquery()
    )
    query = (
        select(
            MediaFile.id,
            MediaFile.library_root_id,
            LibraryRoot.display_name.label("root_name"),
            MediaFile.relative_path,
            MediaFile.filename,
            MediaFile.extension,
            JellyfinItem.title.label("jellyfin_title"),
            MediaFile.size_bytes,
            MediaFile.quality_score,
            MediaFile.quality_score_raw,
            MediaFile.primary_video_codec,
            MediaFile.primary_video_width,
            MediaFile.primary_video_height,
            MediaFile.primary_video_hdr_type,
            MediaFile.duration_seconds,
            MediaFile.bitrate,
            MediaFile.audio_bitrate,
            MediaFile.min_audio_codec,
            MediaFile.audio_channels,
            MediaFile.min_audio_language,
            MediaFile.has_internal_subtitles,
            MediaFile.has_external_subtitles,
            MediaFile.min_subtitle_language,
            MediaFile.scan_status,
            primary_video_frame_rate.label("primary_video_frame_rate"),
            primary_video_bit_depth.label("primary_video_bit_depth"),
        )
        .outerjoin(LibraryRoot, LibraryRoot.id == MediaFile.library_root_id)
        .outerjoin(
            JellyfinMediaMatch,
            and_(
                JellyfinMediaMatch.media_file_id == MediaFile.id,
                JellyfinMediaMatch.status == "matched",
            ),
        )
        .outerjoin(JellyfinItem, JellyfinItem.id == JellyfinMediaMatch.jellyfin_item_id)
        .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
        .order_by(MediaFile.relative_path.asc())
    )
    if current_parts:
        relative_parts = current_parts
        if show_root_names:
            selected_root = next((root for root in roots if root.display_name == current_parts[0]), None)
            if selected_root is None:
                raise StorageMapPathError("Storage map folder not found")
            query = query.where(MediaFile.library_root_id == selected_root.id)
            relative_parts = current_parts[1:]
        if relative_parts:
            relative_prefix = "/".join(relative_parts)
            escaped_prefix = (
                relative_prefix
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            query = query.where(MediaFile.relative_path.like(f"{escaped_prefix}/%", escape="\\"))
    rows = db.execute(query).all()

    folders: dict[str, _FolderAggregate] = {}
    files: list[StorageMapNodeRead] = []
    matching_file_count = 0
    matching_size_bytes = 0

    for row in rows:
        relative_parts = PurePosixPath(row.relative_path).parts
        display_parts = ((row.root_name,) if show_root_names and row.root_name else ()) + relative_parts
        if display_parts[: len(current_parts)] != current_parts:
            continue
        remaining = display_parts[len(current_parts) :]
        if not remaining:
            continue

        resolution = (
            f"{row.primary_video_width}x{row.primary_video_height}"
            if row.primary_video_width and row.primary_video_height
            else None
        )
        resolution_category = classify_resolution_category(
            row.primary_video_width,
            row.primary_video_height,
            resolution_categories,
        )
        category_pair = (
            (resolution_category.id, resolution_category.label)
            if resolution_category is not None
            else None
        )
        hdr_type = _storage_map_hdr_type(
            row.primary_video_hdr_type,
            video_codec=row.primary_video_codec,
            video_width=row.primary_video_width,
            video_height=row.primary_video_height,
        )
        container = (row.extension or "").lstrip(".").lower() or None
        subtitle_status = _subtitle_status(
            row.has_internal_subtitles,
            row.has_external_subtitles,
        )
        analysis_status = (
            row.scan_status.value
            if hasattr(row.scan_status, "value")
            else str(row.scan_status)
        )
        quality_score_raw = _effective_quality_score_raw(
            row.quality_score,
            row.quality_score_raw,
        )
        matching_file_count += 1
        matching_size_bytes += row.size_bytes

        child_path = "/".join((*current_parts, remaining[0]))
        if len(remaining) > 1:
            folder = folders.setdefault(
                remaining[0],
                _FolderAggregate(name=remaining[0], path=child_path),
            )
            folder.add(
                size_bytes=row.size_bytes,
                quality_score=row.quality_score,
                quality_score_raw=quality_score_raw,
                video_codec=row.primary_video_codec,
                resolution=resolution,
                resolution_category=category_pair,
                hdr_type=hdr_type,
                container=container,
                duration_seconds=row.duration_seconds,
                bitrate=row.bitrate,
                audio_bitrate=row.audio_bitrate,
                audio_codec=(row.min_audio_codec or "").strip() or None,
                audio_channels=row.audio_channels,
                frame_rate=row.primary_video_frame_rate,
                bit_depth=row.primary_video_bit_depth,
                audio_language=(row.min_audio_language or "").strip() or None,
                subtitle_status=subtitle_status,
                subtitle_language=(row.min_subtitle_language or "").strip() or None,
                analysis_status=analysis_status,
            )
            continue

        files.append(
            StorageMapNodeRead(
                kind="file",
                name=row.filename,
                path=child_path,
                size_bytes=row.size_bytes,
                file_count=1,
                file_id=row.id,
                extension=(row.extension or "").lstrip(".").lower() or None,
                jellyfin_title=row.jellyfin_title,
                video_codec=row.primary_video_codec,
                resolution=resolution,
                resolution_category_id=resolution_category.id if resolution_category else None,
                resolution_category_label=resolution_category.label if resolution_category else None,
                hdr_type=hdr_type,
                quality_score=row.quality_score,
                quality_score_raw=quality_score_raw,
                container=container,
                duration_seconds=row.duration_seconds,
                bitrate=row.bitrate,
                audio_bitrate=row.audio_bitrate,
                audio_codec=(row.min_audio_codec or "").strip() or None,
                audio_channels=row.audio_channels,
                frame_rate=row.primary_video_frame_rate,
                bit_depth=row.primary_video_bit_depth,
                audio_language=(row.min_audio_language or "").strip() or None,
                subtitle_status=subtitle_status,
                subtitle_language=(row.min_subtitle_language or "").strip() or None,
                analysis_status=analysis_status,
            )
        )

    if current_parts and matching_file_count == 0:
        raise StorageMapPathError("Storage map folder not found")

    items = [folder.to_read() for folder in folders.values()]
    items.extend(files)
    items.sort(key=lambda item: (-item.size_bytes, item.kind != "folder", item.name.lower()))

    breadcrumbs = [StorageMapBreadcrumbRead(name=library.name, path="")]
    breadcrumbs.extend(
        StorageMapBreadcrumbRead(name=part, path="/".join(current_parts[: index + 1]))
        for index, part in enumerate(current_parts)
    )
    return LibraryStorageMapRead(
        library_id=library.id,
        library_name=library.name,
        path="/".join(current_parts),
        total_size_bytes=matching_size_bytes,
        file_count=matching_file_count,
        breadcrumbs=breadcrumbs,
        items=items,
    )

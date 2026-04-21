from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    AudioStream,
    JobStatus,
    Library,
    LibraryHistory,
    LibraryType,
    MediaFile,
    MediaFileHistory,
    MediaFileHistoryCaptureReason,
    MediaFormat,
    ScanJob,
    ScanMode,
    ScanStatus,
    VideoStream,
)
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import update_app_settings
from backend.app.services.history_reconstruction import reconstruct_history_from_media_files
from backend.app.services.history_retention import apply_history_retention
from backend.app.services.history_snapshots import (
    build_library_history_snapshot,
    create_media_file_history_entry_if_changed,
    upsert_library_history_snapshot,
)
from backend.app.services.library_history_service import get_dashboard_history, get_library_history
from backend.app.services.history_storage import get_history_storage
from backend.app.services.resolution_categories import default_resolution_categories


def _session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _build_media_file(library_id: int) -> MediaFile:
    media_file = MediaFile(
        library_id=library_id,
        relative_path="movie.mkv",
        filename="movie.mkv",
        extension="mkv",
        size_bytes=1_500_000_000,
        mtime=1.0,
        scan_status=ScanStatus.ready,
        quality_score=8,
        quality_score_raw=8.5,
        quality_score_breakdown={"score": 8, "score_raw": 8.5, "categories": []},
        raw_ffprobe_json={"format": {"duration": "7200"}},
        last_analyzed_at=datetime(2026, 3, 24, 10, 0, tzinfo=UTC),
    )
    media_file.media_format = MediaFormat(container_format="matroska", duration=7200.0, bit_rate=12_000_000, probe_score=100)
    media_file.video_streams = [
        VideoStream(stream_index=0, codec="hevc", width=3840, height=2160, hdr_type="HDR10")
    ]
    media_file.audio_streams = [
        AudioStream(stream_index=1, codec="truehd", channels=8, channel_layout="7.1", language="en")
    ]
    return media_file


def test_create_media_file_history_entry_if_changed_avoids_duplicate_snapshot() -> None:
    session_factory = _session_factory()
    resolution_categories = default_resolution_categories()

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        media_file = _build_media_file(library.id)
        db.add(media_file)
        db.commit()

        created_first = create_media_file_history_entry_if_changed(
            db,
            media_file,
            MediaFileHistoryCaptureReason.scan_analysis,
            resolution_categories,
        )
        db.commit()
        created_second = create_media_file_history_entry_if_changed(
            db,
            media_file,
            MediaFileHistoryCaptureReason.scan_analysis,
            resolution_categories,
        )
        media_file.quality_score = 9
        media_file.quality_score_raw = 9.1
        media_file.quality_score_breakdown = {"score": 9, "score_raw": 9.1, "categories": []}
        created_third = create_media_file_history_entry_if_changed(
            db,
            media_file,
            MediaFileHistoryCaptureReason.quality_recompute,
            resolution_categories,
        )
        db.commit()

        history_entries = db.scalars(select(MediaFileHistory).order_by(MediaFileHistory.id.asc())).all()

    assert created_first is True
    assert created_second is False
    assert created_third is True
    assert len(history_entries) == 2
    assert history_entries[0].capture_reason == MediaFileHistoryCaptureReason.scan_analysis
    assert history_entries[1].capture_reason == MediaFileHistoryCaptureReason.quality_recompute


def test_upsert_library_history_snapshot_reuses_same_day_row() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            last_scan_at=datetime(2026, 3, 24, 10, 0, tzinfo=UTC),
        )
        db.add(library)
        db.flush()
        db.add(_build_media_file(library.id))
        db.commit()

        first = upsert_library_history_snapshot(
            db,
            library,
            source_scan_job_id=1,
            scan_summary={"discovery": {"discovered_files": 4}, "changes": {"new_files": {"count": 1}}},
            captured_at=datetime(2026, 3, 24, 10, 15, tzinfo=UTC),
        )
        db.commit()
        second = upsert_library_history_snapshot(
            db,
            library,
            source_scan_job_id=2,
            scan_summary={"discovery": {"discovered_files": 5}, "changes": {"new_files": {"count": 2}}},
            captured_at=datetime(2026, 3, 24, 18, 15, tzinfo=UTC),
        )
        db.commit()
        third = upsert_library_history_snapshot(
            db,
            library,
            source_scan_job_id=3,
            scan_summary={"discovery": {"discovered_files": 6}, "changes": {"new_files": {"count": 3}}},
            captured_at=datetime(2026, 3, 25, 9, 0, tzinfo=UTC),
        )
        db.commit()

        rows = db.scalars(select(LibraryHistory).order_by(LibraryHistory.snapshot_day.asc())).all()

    assert first.id == second.id
    assert third.id != second.id
    assert len(rows) == 2
    assert rows[0].source_scan_job_id == 2
    assert rows[0].snapshot["scan_delta"]["new_files"] == 2
    assert rows[0].snapshot["trend_metrics"]["total_files"] == 1
    assert rows[0].snapshot["trend_metrics"]["resolution_counts"]["4k"] == 1
    assert rows[1].source_scan_job_id == 3


def test_get_dashboard_history_aggregates_visible_libraries() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        visible_library = Library(
            name="Visible",
            path="/tmp/history-visible",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=True,
        )
        hidden_library = Library(
            name="Hidden",
            path="/tmp/history-hidden",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=False,
        )
        db.add_all([visible_library, hidden_library])
        db.flush()
        db.add_all(
            [
                LibraryHistory(
                    library_id=visible_library.id,
                    snapshot_day="2026-03-24",
                    snapshot={
                        "file_count": 2,
                        "total_size_bytes": 3_000,
                        "total_duration_seconds": 10_800,
                        "trend_metrics": {
                            "total_files": 2,
                            "resolution_counts": {"4k": 2},
                            "average_bitrate": 8_000_000,
                            "average_audio_bitrate": 512_000,
                            "average_duration_seconds": 5_400,
                            "average_quality_score": 7.5,
                        }
                    },
                ),
                LibraryHistory(
                    library_id=visible_library.id,
                    snapshot_day="2026-03-25",
                    snapshot={
                        "file_count": 3,
                        "total_size_bytes": 6_000,
                        "total_duration_seconds": 18_000,
                        "trend_metrics": {
                            "total_files": 3,
                            "resolution_counts": {"4k": 1, "1080p": 2},
                            "average_bitrate": 10_000_000,
                            "average_audio_bitrate": 640_000,
                            "average_duration_seconds": 6_000,
                            "average_quality_score": 8.0,
                        }
                    },
                ),
                LibraryHistory(
                    library_id=hidden_library.id,
                    snapshot_day="2026-03-24",
                    snapshot={
                        "trend_metrics": {
                            "total_files": 10,
                            "resolution_counts": {"sd": 10},
                            "average_bitrate": 2_000_000,
                            "average_audio_bitrate": 128_000,
                            "average_duration_seconds": 1_800,
                            "average_quality_score": 4.0,
                        }
                    },
                ),
            ]
        )
        db.commit()

        payload = get_dashboard_history(db)

    assert payload.visible_library_ids == [visible_library.id]
    assert payload.oldest_snapshot_day == "2026-03-24"
    assert payload.newest_snapshot_day == "2026-03-25"
    assert [point.snapshot_day for point in payload.points] == ["2026-03-24", "2026-03-25"]
    assert payload.points[0].trend_metrics.total_files == 2
    assert payload.points[0].trend_metrics.resolution_counts == {"4k": 2}
    assert payload.points[0].trend_metrics.average_bitrate == 8_000_000.0
    assert payload.points[0].trend_metrics.totals["total_size_bytes"] == 3_000
    assert payload.points[0].trend_metrics.totals["total_duration_seconds"] == 10_800.0
    assert payload.points[0].trend_metrics.numeric_summaries["size"].average == 1_500.0
    assert payload.points[0].trend_metrics.numeric_summaries["resolution_mp"].average == 8.2944


def test_build_library_history_snapshot_includes_trend_metrics() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            last_scan_at=datetime(2026, 3, 24, 10, 0, tzinfo=UTC),
        )
        db.add(library)
        db.flush()
        media_file = _build_media_file(library.id)
        media_file.audio_streams[0].bit_rate = 768_000
        db.add(media_file)
        db.commit()

        snapshot = build_library_history_snapshot(
            db,
            library,
            scan_summary={"discovery": {"discovered_files": 4}, "changes": {"new_files": {"count": 1}}},
        )

    assert snapshot["trend_metrics"]["total_files"] == 1
    assert snapshot["trend_metrics"]["resolution_counts"]["8k"] == 0
    assert snapshot["trend_metrics"]["resolution_counts"]["4k"] == 1
    assert snapshot["trend_metrics"]["average_bitrate"] == 12_000_000.0
    assert snapshot["trend_metrics"]["average_audio_bitrate"] == 768_000.0
    assert snapshot["trend_metrics"]["average_duration_seconds"] == 7200.0
    assert snapshot["trend_metrics"]["average_quality_score"] == 8.0
    assert snapshot["trend_metrics"]["schema_version"] == 2
    assert snapshot["trend_metrics"]["totals"]["file_count"] == 1
    assert snapshot["trend_metrics"]["totals"]["ready_files"] == 1
    assert snapshot["trend_metrics"]["numeric_summaries"]["size"]["count"] == 1
    assert snapshot["trend_metrics"]["numeric_summaries"]["size"]["average"] == 1_500_000_000.0
    assert snapshot["trend_metrics"]["numeric_summaries"]["resolution_mp"]["average"] == 8.2944
    assert snapshot["trend_metrics"]["category_counts"]["container"]["mkv"] == 1
    assert snapshot["trend_metrics"]["category_counts"]["video_codec"]["hevc"] == 1
    assert snapshot["trend_metrics"]["category_counts"]["hdr_type"]["HDR10"] == 1
    assert snapshot["trend_metrics"]["category_counts"]["audio_codecs"]["truehd"] == 1
    assert snapshot["trend_metrics"]["category_counts"]["audio_languages"]["en"] == 1
    assert snapshot["trend_metrics"]["category_counts"]["scan_status"]["ready"] == 1
    assert snapshot["trend_metrics"]["numeric_distributions"]["resolution_mp"]["total"] == 1


def test_build_library_history_snapshot_averages_ignore_null_values() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        null_only = MediaFile(
            library_id=library.id,
            relative_path="null-only.mkv",
            filename="null-only.mkv",
            extension="mkv",
            size_bytes=1_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
        )
        null_only.media_format = MediaFormat(container_format="matroska", duration=None, bit_rate=None, probe_score=100)
        null_only.video_streams = [VideoStream(stream_index=0, codec="h264", width=1920, height=1080, hdr_type=None)]
        null_only.audio_streams = [AudioStream(stream_index=1, codec="aac", channels=2, language="en", bit_rate=None)]

        with_values = MediaFile(
            library_id=library.id,
            relative_path="with-values.mkv",
            filename="with-values.mkv",
            extension="mkv",
            size_bytes=2_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        with_values.media_format = MediaFormat(
            container_format="matroska",
            duration=5400.0,
            bit_rate=9_000_000,
            probe_score=100,
        )
        with_values.video_streams = [VideoStream(stream_index=0, codec="hevc", width=3840, height=2160, hdr_type="HDR10")]
        with_values.audio_streams = [AudioStream(stream_index=1, codec="ac3", channels=6, language="en", bit_rate=512_000)]

        db.add_all([null_only, with_values])
        db.commit()

        snapshot = build_library_history_snapshot(db, library)

    assert snapshot["trend_metrics"]["total_files"] == 2
    assert snapshot["trend_metrics"]["average_bitrate"] == 9_000_000.0
    assert snapshot["trend_metrics"]["average_audio_bitrate"] == 512_000.0
    assert snapshot["trend_metrics"]["average_duration_seconds"] == 5400.0
    assert snapshot["trend_metrics"]["average_quality_score"] == 7.0


def test_build_library_history_snapshot_returns_null_for_null_only_average_columns() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="null-only.mkv",
            filename="null-only.mkv",
            extension="mkv",
            size_bytes=1_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        media_file.media_format = MediaFormat(container_format="matroska", duration=None, bit_rate=None, probe_score=100)
        media_file.video_streams = [VideoStream(stream_index=0, codec="h264", width=1920, height=1080, hdr_type=None)]
        media_file.audio_streams = [AudioStream(stream_index=1, codec="aac", channels=2, language="en", bit_rate=None)]
        db.add(media_file)
        db.commit()

        snapshot = build_library_history_snapshot(db, library)

    assert snapshot["trend_metrics"]["average_bitrate"] is None
    assert snapshot["trend_metrics"]["average_audio_bitrate"] is None
    assert snapshot["trend_metrics"]["average_duration_seconds"] is None
    assert snapshot["trend_metrics"]["average_quality_score"] == 5.0


def test_get_library_history_enriches_legacy_rows_and_preserves_unknown_resolution_categories() -> None:
    session_factory = _session_factory()
    settings = Settings()

    with session_factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(
                resolution_categories=[
                    {"id": "4k", "label": "Ultra HD", "min_width": 3648, "min_height": 1520},
                    {"id": "1080p", "label": "Full HD", "min_width": 1824, "min_height": 760},
                    {"id": "sd", "label": "SD", "min_width": 0, "min_height": 0},
                ]
            ),
            settings,
        )
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        db.add_all(
            [
                LibraryHistory(
                    library_id=library.id,
                    snapshot_day="2026-03-22",
                    captured_at=datetime(2026, 3, 22, 9, 0, tzinfo=UTC),
                    snapshot={
                        "file_count": 1,
                        "ready_files": 1,
                        "pending_files": 0,
                        "total_size_bytes": 1_500_000_000,
                        "total_duration_seconds": 5_400,
                    },
                ),
                LibraryHistory(
                    library_id=library.id,
                    snapshot_day="2026-03-23",
                    captured_at=datetime(2026, 3, 23, 9, 0, tzinfo=UTC),
                    snapshot={
                        "file_count": 10,
                        "total_size_bytes": 15_000_000_000,
                        "total_duration_seconds": 54_000,
                        "trend_metrics": {
                            "total_files": 10,
                            "resolution_counts": {"4k": 4, "legacy_hd": 6},
                            "average_bitrate": 8_000_000,
                            "average_audio_bitrate": 512_000,
                            "average_duration_seconds": 5400,
                            "average_quality_score": 7.3,
                        }
                    },
                ),
                LibraryHistory(
                    library_id=library.id,
                    snapshot_day="2026-03-24",
                    captured_at=datetime(2026, 3, 24, 9, 0, tzinfo=UTC),
                    snapshot={
                        "trend_metrics": {
                            "total_files": 12,
                            "resolution_counts": {"1080p": 8, "legacy_hd": 4},
                            "average_bitrate": 9_000_000,
                            "average_audio_bitrate": 640_000,
                            "average_duration_seconds": 5600,
                            "average_quality_score": 7.8,
                        }
                    },
                ),
            ]
        )
        db.commit()

        payload = get_library_history(db, library.id)

    assert payload is not None
    assert payload.oldest_snapshot_day == "2026-03-22"
    assert payload.newest_snapshot_day == "2026-03-24"
    assert [point.snapshot_day for point in payload.points] == [
        "2026-03-22",
        "2026-03-23",
        "2026-03-24",
    ]
    assert payload.points[0].trend_metrics.totals["total_size_bytes"] == 1_500_000_000
    assert payload.points[0].trend_metrics.totals["total_duration_seconds"] == 5_400.0
    assert payload.points[0].trend_metrics.numeric_summaries["size"].average == 1_500_000_000.0
    assert payload.points[1].trend_metrics.resolution_counts["legacy_hd"] == 6
    assert payload.points[1].trend_metrics.totals["total_duration_seconds"] == 54_000.0
    assert payload.points[1].trend_metrics.numeric_summaries["resolution_mp"].average == 8.2944
    assert payload.points[2].trend_metrics.numeric_summaries["resolution_mp"].average == 2.0736
    assert [item.model_dump() for item in payload.resolution_categories] == [
        {"id": "4k", "label": "Ultra HD"},
        {"id": "1080p", "label": "Full HD"},
        {"id": "sd", "label": "SD"},
        {"id": "legacy_hd", "label": "legacy_hd"},
    ]


def test_get_history_storage_reports_bucket_usage_and_limits(tmp_path) -> None:
    db_path = tmp_path / "history-storage.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    settings = Settings(config_path=tmp_path, media_root=tmp_path / "media", database_filename=db_path.name)

    with session_factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(
                history_retention={
                    "file_history": {"days": 90, "storage_limit_gb": 1},
                    "library_history": {"days": 365, "storage_limit_gb": 0},
                    "scan_history": {"days": 30, "storage_limit_gb": 0.5},
                }
            ),
            settings,
        )
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        media_file = _build_media_file(library.id)
        db.add(media_file)
        db.flush()
        create_media_file_history_entry_if_changed(
            db,
            media_file,
            MediaFileHistoryCaptureReason.scan_analysis,
            default_resolution_categories(),
        )
        upsert_library_history_snapshot(
            db,
            library,
            source_scan_job_id=1,
            scan_summary={"discovery": {"discovered_files": 1}},
            captured_at=datetime.now(UTC),
        )
        db.add(
            ScanJob(
                library_id=library.id,
                status=JobStatus.completed,
                job_type="incremental",
                finished_at=datetime.now(UTC),
                trigger_details={"reason": "manual"},
                scan_summary={"analysis": {"analysis_failed": 0}},
            )
        )
        db.commit()

        payload = get_history_storage(db, settings)

    assert payload.database_file_bytes > 0
    assert payload.categories.file_history.entry_count == 1
    assert payload.categories.file_history.current_estimated_bytes > 0
    assert payload.categories.file_history.storage_limit_bytes == 1024 * 1024 * 1024
    assert payload.categories.library_history.entry_count == 1
    assert payload.categories.scan_history.entry_count == 1


def test_apply_history_retention_prunes_media_file_history_by_age(monkeypatch) -> None:
    session_factory = _session_factory()
    settings = Settings()
    monkeypatch.setattr("backend.app.services.history_retention._compact_database", lambda db, allow_vacuum: allow_vacuum)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        update_app_settings(db, AppSettingsUpdate(history_retention={"file_history": {"days": 30}}), settings)
        db.add_all(
            [
                MediaFileHistory(
                    library_id=library.id,
                    media_file_id=1,
                    relative_path="old.mkv",
                    filename="old.mkv",
                    captured_at=datetime.now(UTC) - timedelta(days=90),
                    capture_reason=MediaFileHistoryCaptureReason.scan_analysis,
                    snapshot_hash="old",
                    snapshot={"value": "old"},
                ),
                MediaFileHistory(
                    library_id=library.id,
                    media_file_id=1,
                    relative_path="new.mkv",
                    filename="new.mkv",
                    captured_at=datetime.now(UTC) - timedelta(days=2),
                    capture_reason=MediaFileHistoryCaptureReason.scan_analysis,
                    snapshot_hash="new",
                    snapshot={"value": "new"},
                ),
            ]
        )
        db.commit()

        result = apply_history_retention(db, settings)
        remaining = db.scalars(select(MediaFileHistory).order_by(MediaFileHistory.id.asc())).all()

    assert result.deleted_entries == 1
    assert result.compaction_completed is True
    assert [entry.relative_path for entry in remaining] == ["new.mkv"]


def test_apply_history_retention_prunes_oldest_scan_history_and_keeps_active_jobs(monkeypatch) -> None:
    session_factory = _session_factory()
    settings = Settings()
    compact_calls: list[bool] = []
    monkeypatch.setattr(
        "backend.app.services.history_retention._compact_database",
        lambda db, allow_vacuum: compact_calls.append(allow_vacuum) or allow_vacuum,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        update_app_settings(
            db,
            AppSettingsUpdate(history_retention={"scan_history": {"days": 0, "storage_limit_gb": 0.000001}}),
            settings,
        )
        db.add_all(
            [
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.completed,
                    job_type="incremental",
                    finished_at=datetime.now(UTC) - timedelta(days=2),
                    trigger_details={"reason": "old"},
                    scan_summary={"detail": "x" * 4000},
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.completed,
                    job_type="incremental",
                    finished_at=datetime.now(UTC) - timedelta(days=1),
                    trigger_details={"reason": "new"},
                    scan_summary={"detail": "ok"},
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.running,
                    job_type="incremental",
                    started_at=datetime.now(UTC),
                ),
            ]
        )
        db.commit()

        result = apply_history_retention(db, settings)
        jobs = db.scalars(select(ScanJob).order_by(ScanJob.id.asc())).all()

    assert result.deleted_entries == 1
    assert result.compaction_deferred is True
    assert result.compaction_completed is False
    assert compact_calls == [False]
    assert [job.status for job in jobs] == [JobStatus.completed, JobStatus.running]
    assert jobs[0].trigger_details == {"reason": "new"}


def test_reconstruct_history_from_media_files_backfills_missing_earlier_history(monkeypatch) -> None:
    session_factory = _session_factory()
    settings = Settings()
    fixed_now = datetime(2026, 4, 19, 12, 0, tzinfo=UTC)
    monkeypatch.setattr("backend.app.services.history_reconstruction.utc_now", lambda: fixed_now)

    with session_factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(
                history_retention={
                    "file_history": {"days": 90, "storage_limit_gb": 0},
                    "library_history": {"days": 365, "storage_limit_gb": 0},
                }
            ),
            settings,
        )
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        older_file = _build_media_file(library.id)
        older_file.relative_path = "older.mkv"
        older_file.filename = "older.mkv"
        older_file.mtime = datetime(2026, 4, 10, 9, 0, tzinfo=UTC).timestamp()

        newer_file = _build_media_file(library.id)
        newer_file.relative_path = "newer.mkv"
        newer_file.filename = "newer.mkv"
        newer_file.mtime = datetime(2026, 4, 15, 11, 0, tzinfo=UTC).timestamp()
        newer_file.quality_score = 6
        newer_file.quality_score_raw = 6.2
        newer_file.quality_score_breakdown = {"score": 6, "score_raw": 6.2, "categories": []}

        db.add_all([older_file, newer_file])
        db.flush()
        db.add(
            LibraryHistory(
                library_id=library.id,
                snapshot_day="2026-04-17",
                captured_at=datetime(2026, 4, 17, 12, 0, tzinfo=UTC),
                snapshot={"trend_metrics": {"total_files": 2, "resolution_counts": {"4k": 2}}},
            )
        )
        db.add(
            MediaFileHistory(
                library_id=library.id,
                media_file_id=newer_file.id,
                relative_path=newer_file.relative_path,
                filename=newer_file.filename,
                captured_at=datetime(2026, 4, 16, 12, 0, tzinfo=UTC),
                capture_reason=MediaFileHistoryCaptureReason.scan_analysis,
                snapshot_hash="existing",
                snapshot={"value": "existing"},
            )
        )
        db.commit()

        result = reconstruct_history_from_media_files(db)
        library_rows = db.scalars(
            select(LibraryHistory)
            .where(LibraryHistory.library_id == library.id)
            .order_by(LibraryHistory.snapshot_day.asc())
        ).all()
        file_rows = db.scalars(
            select(MediaFileHistory)
            .where(MediaFileHistory.library_id == library.id)
            .order_by(MediaFileHistory.captured_at.asc(), MediaFileHistory.id.asc())
        ).all()

    assert result.created_library_history_entries == 9
    assert result.updated_library_history_entries == 1
    assert result.created_file_history_entries == 2
    assert result.oldest_reconstructed_snapshot_day == "2026-04-10"
    assert result.newest_reconstructed_snapshot_day == "2026-04-19"
    assert [row.snapshot_day for row in library_rows] == [
        "2026-04-10",
        "2026-04-11",
        "2026-04-12",
        "2026-04-13",
        "2026-04-14",
        "2026-04-15",
        "2026-04-16",
        "2026-04-17",
        "2026-04-18",
        "2026-04-19",
    ]
    assert library_rows[0].snapshot["trend_metrics"]["total_files"] == 1
    assert library_rows[0].snapshot["trend_metrics"]["schema_version"] == 2
    assert library_rows[0].snapshot["trend_metrics"]["category_counts"]["container"]["mkv"] == 1
    assert library_rows[0].snapshot["trend_metrics"]["numeric_distributions"]["size"]["total"] == 1
    assert library_rows[5].snapshot["trend_metrics"]["total_files"] == 2
    assert library_rows[5].snapshot["trend_metrics"]["numeric_summaries"]["quality_score"]["count"] == 2
    assert library_rows[5].snapshot["scan_delta"]["new_files"] == 1
    assert library_rows[7].snapshot["trend_metrics"]["schema_version"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["total_files"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["resolution_counts"] == {"4k": 2}
    assert library_rows[7].snapshot["trend_metrics"]["category_counts"]["container"]["mkv"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["category_counts"]["video_codec"]["hevc"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["category_counts"]["hdr_type"]["HDR10"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["category_counts"]["audio_codecs"]["truehd"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["category_counts"]["audio_languages"]["en"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["category_counts"]["scan_status"]["ready"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["numeric_distributions"]["size"]["total"] == 2
    assert library_rows[7].snapshot["trend_metrics"]["numeric_distributions"]["resolution_mp"]["total"] == 2
    assert file_rows[0].capture_reason == MediaFileHistoryCaptureReason.history_reconstruction
    assert file_rows[0].relative_path == "older.mkv"
    assert file_rows[1].capture_reason == MediaFileHistoryCaptureReason.history_reconstruction
    assert file_rows[1].relative_path == "newer.mkv"
    assert file_rows[2].relative_path == "newer.mkv"


def test_reconstruct_history_from_media_files_is_idempotent(monkeypatch) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(
        "backend.app.services.history_reconstruction.utc_now",
        lambda: datetime(2026, 4, 19, 12, 0, tzinfo=UTC),
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = _build_media_file(library.id)
        media_file.mtime = datetime(2026, 4, 10, 9, 0, tzinfo=UTC).timestamp()
        db.add(media_file)
        db.commit()

        first = reconstruct_history_from_media_files(db)
        second = reconstruct_history_from_media_files(db)

    assert first.created_library_history_entries > 0
    assert first.created_file_history_entries == 1
    assert second.created_library_history_entries == 0
    assert second.created_file_history_entries == 0

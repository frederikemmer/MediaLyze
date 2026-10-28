from __future__ import annotations

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.base import Base
from backend.app.db.session import init_db
from backend.app.models.entities import (
    ConnectorConnection,
    ConnectorCredential,
    ConnectorItem,
    ConnectorLibrary,
    ConnectorLibraryLink,
    ConnectorLibraryLocation,
    ConnectorMediaMatch,
    ConnectorPlaybackEvent,
    ConnectorRootBinding,
    ConnectorSyncJob,
    ConnectorSyncStageItem,
    ConnectorSyncStageLibrary,
    ConnectorSyncStagePlaybackEvent,
    ConnectorSyncStageUser,
    ConnectorSyncStageUserData,
    ConnectorUser,
    ConnectorUserItemData,
    JellyfinConnection,
    JellyfinItem,
    JellyfinLibrary,
    JellyfinMediaMatch,
    JellyfinPathMapping,
    JellyfinPlaybackEvent,
    JellyfinUser,
    JellyfinUserItemData,
    JobStatus,
    Library,
    LibraryRoot,
    LibraryType,
    MediaFile,
    ScanMode,
    ScanStatus,
)
from backend.app.schemas.connectors import (
    ConnectorBindingBatchUpdate,
    ConnectorBindingWrite,
    ConnectorConnectionCreate,
    ConnectorLibraryLinkBatchUpdate,
    ConnectorLibraryLinkWrite,
)
from backend.app.services.connector_contract import RemoteItem
from backend.app.services.connector_mapping import reconcile_connector_mappings
from backend.app.services.connector_matching import recompute_connector_matches
from backend.app.services.connector_pathing import (
    normalize_connector_path,
    normalize_target_subpath,
)
from backend.app.services.connector_security import redact_connector_error
from backend.app.services.connector_service import (
    create_connector_connection,
    replace_connector_bindings,
    replace_connector_library_links,
    serialize_connector_connection,
)
from backend.app.services.connector_sync import (
    _stage_item_row,
    _upsert_stage_items,
    claim_connector_sync_job,
    create_or_get_connector_sync_job,
    mirror_legacy_jellyfin_snapshot,
    promote_connector_playback_staging,
    promote_connector_staging,
    recover_orphaned_connector_sync_jobs,
    request_connector_sync_cancellation,
    run_connector_recompute,
)
from backend.app.utils.time import utc_now


def _session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _connector_graph(db: Session, root_path: str):
    library = Library(
        name="Movies",
        path=root_path,
        type=LibraryType.movies,
        scan_mode=ScanMode.manual,
        scan_config={},
    )
    connection = ConnectorConnection(
        provider="jellyfin",
        name="Living Room",
        base_url="http://jellyfin.local",
        enabled=True,
        path_mapping_mode="manual",
        library_mapping_mode="manual",
    )
    db.add_all([library, connection])
    db.flush()
    root = LibraryRoot(
        library_id=library.id,
        path=root_path,
        display_name="Primary",
        path_key=root_path.casefold(),
    )
    remote_library = ConnectorLibrary(
        connection_id=connection.id,
        remote_id="remote-library",
        name="Movies",
    )
    db.add_all([root, remote_library])
    db.flush()
    location = ConnectorLibraryLocation(
        connector_library_id=remote_library.id,
        remote_path="/srv/media",
        normalized_path="/srv/media",
    )
    db.add(location)
    db.flush()
    return connection, library, root, remote_library, location


def test_connector_path_normalization_handles_windows_unc_and_rejects_escape() -> None:
    assert normalize_connector_path(r"C:\Media\Movies\Film.mkv").display == "C:/Media/Movies/Film.mkv"
    assert normalize_connector_path(r"\\nas\Media\Film.mkv").display == "//nas/Media/Film.mkv"
    assert normalize_connector_path("/Media/Film.mkv", case_mode="insensitive").key == "/media/film.mkv"
    with pytest.raises(ValueError, match="relative"):
        normalize_target_subpath("../escape")


def test_connector_matcher_allows_multiple_items_for_one_file_and_prefers_longest_prefix(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        media = MediaFile(
            library_id=library.id,
            library_root_id=root.id,
            relative_path="nested/movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
        )
        db.add_all(
            [
                ConnectorRootBinding(
                    location_id=location.id,
                    library_root_id=root.id,
                    source_prefix="/srv",
                    normalized_source_prefix="/srv",
                    target_subpath="wrong",
                    case_mode="sensitive",
                    priority=0,
                ),
                ConnectorRootBinding(
                    location_id=location.id,
                    library_root_id=root.id,
                    source_prefix="/srv/media",
                    normalized_source_prefix="/srv/media",
                    target_subpath="nested",
                    case_mode="sensitive",
                    priority=0,
                ),
                ConnectorItem(
                    connection_id=connection.id,
                    connector_library_id=remote_library.id,
                    remote_id="item-a",
                    item_type="Movie",
                    remote_path="/srv/media/movie.mkv",
                    normalized_remote_path="/srv/media/movie.mkv",
                    title="A",
                ),
                ConnectorItem(
                    connection_id=connection.id,
                    connector_library_id=remote_library.id,
                    remote_id="item-b",
                    item_type="Movie",
                    remote_path="/srv/media/movie.mkv",
                    normalized_remote_path="/srv/media/movie.mkv",
                    title="B",
                ),
                media,
            ]
        )
        db.commit()

        summary = recompute_connector_matches(db, connection_id=connection.id)
        matches = list(db.scalars(select(ConnectorMediaMatch).order_by(ConnectorMediaMatch.id)))

    assert summary["matched"] == 2
    assert len(matches) == 2
    assert {match.media_file_id for match in matches} == {media.id}


def test_connector_matching_batches_catalog_and_preserves_unicode_casefold(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        binding = ConnectorRootBinding(
            location_id=location.id,
            library_root_id=root.id,
            source_prefix="/srv/media",
            normalized_source_prefix="/srv/media",
            case_mode="insensitive",
        )
        unicode_media = MediaFile(
            library_id=library.id,
            library_root_id=root.id,
            relative_path="Straße/movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
        )
        items = [
            ConnectorItem(
                connection_id=connection.id,
                connector_library_id=remote_library.id,
                remote_id=f"batch-{index}",
                item_type="Movie",
                remote_path=f"/srv/media/Film-{index}.mkv",
                title=f"Film {index}",
            )
            for index in range(260)
        ]
        unicode_item = ConnectorItem(
            connection_id=connection.id,
            connector_library_id=remote_library.id,
            remote_id="unicode-casefold",
            item_type="Movie",
            remote_path="/srv/media/STRASSE/movie.mkv",
            title="Unicode casefold",
        )
        db.add_all([binding, unicode_media, *items, unicode_item])
        db.commit()

        summary = recompute_connector_matches(db, connection_id=connection.id)
        match = db.scalar(
            select(ConnectorMediaMatch).where(
                ConnectorMediaMatch.connector_item_id == unicode_item.id
            )
        )

    assert summary["matched"] == 1
    assert summary["no_local_file"] == 260
    assert match is not None and match.media_file_id == unicode_media.id


def test_binding_batch_rejects_equivalent_active_rules_atomically(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, _library, root, _remote_library, location = _connector_graph(db, str(tmp_path))
        db.commit()
        payload = ConnectorBindingBatchUpdate(
            bindings=[
                ConnectorBindingWrite(
                    location_id=location.id,
                    library_root_id=root.id,
                    source_prefix="/srv/media",
                ),
                ConnectorBindingWrite(
                    location_id=location.id,
                    library_root_id=root.id,
                    source_prefix="/srv/media/",
                ),
            ]
        )
        with pytest.raises(ValueError, match="Equivalent"):
            replace_connector_bindings(db, connection.id, payload)
        count = db.scalar(select(func.count()).select_from(ConnectorRootBinding))

    assert count == 0


def test_automatic_mapping_requires_three_consistent_assets(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        connection.path_mapping_mode = "automatic"
        connection.library_mapping_mode = "automatic"
        location.remote_path = "/connector/movies"
        location.normalized_path = "/connector/movies"
        for index in range(3):
            filename = f"movie-{index}.mkv"
            db.add_all([
                MediaFile(
                    library_id=library.id,
                    library_root_id=root.id,
                    relative_path=f"Action/{filename}",
                    filename=filename,
                    extension="mkv",
                    size_bytes=1000 + index,
                    duration_seconds=90 + index,
                    mtime=1.0,
                    scan_status=ScanStatus.ready,
                ),
                ConnectorItem(
                    connection_id=connection.id,
                    connector_library_id=remote_library.id,
                    remote_id=f"remote-{index}",
                    item_type="Movie",
                    remote_path=f"/connector/movies/Action/{filename}",
                    normalized_remote_path=f"/connector/movies/Action/{filename}",
                    title=filename,
                    size_bytes=1000 + index,
                    duration_seconds=90 + index,
                ),
            ])
        db.commit()

        summary = reconcile_connector_mappings(db, connection.id)
        binding = db.scalar(select(ConnectorRootBinding))

        assert summary["verified"] == 1
        assert binding is not None
        assert binding.source_prefix == "/connector/movies"
        assert binding.library_root_id == root.id
        assert binding.evidence_count == 3
        assert binding.verification_status == "verified"
        assert binding.origin == "automatic"


def test_automatic_mapping_does_not_guess_from_two_assets(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        connection.path_mapping_mode = "automatic"
        connection.library_mapping_mode = "automatic"
        location.remote_path = "/different/mount"
        location.normalized_path = "/different/mount"
        for index in range(2):
            filename = f"movie-{index}.mkv"
            db.add_all([
                MediaFile(
                    library_id=library.id,
                    library_root_id=root.id,
                    relative_path=filename,
                    filename=filename,
                    extension="mkv",
                    size_bytes=1000 + index,
                    mtime=1.0,
                    scan_status=ScanStatus.ready,
                ),
                ConnectorItem(
                    connection_id=connection.id,
                    connector_library_id=remote_library.id,
                    remote_id=f"remote-{index}",
                    item_type="Movie",
                    remote_path=f"/different/mount/{filename}",
                    normalized_remote_path=f"/different/mount/{filename}",
                    title=filename,
                    size_bytes=1000 + index,
                ),
            ])
        db.commit()

        reconcile_connector_mappings(db, connection.id)

        assert db.scalar(select(func.count()).select_from(ConnectorRootBinding)) == 0


def test_automatic_mapping_removes_trusted_rule_when_new_evidence_conflicts(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, first_library, first_root, remote_library, location = _connector_graph(
            db, str(tmp_path / "first")
        )
        connection.path_mapping_mode = "automatic"
        connection.library_mapping_mode = "automatic"
        location.remote_path = "/different/mount"
        location.normalized_path = "/different/mount"
        second_library = Library(
            name="Archive",
            path=str(tmp_path / "second"),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(second_library)
        db.flush()
        second_root = LibraryRoot(
            library_id=second_library.id,
            path=str(tmp_path / "second"),
            display_name="Archive",
            path_key=str(tmp_path / "second").casefold(),
        )
        db.add(second_root)
        db.flush()
        db.add(
            ConnectorRootBinding(
                location_id=location.id,
                library_root_id=first_root.id,
                source_prefix="/different/mount",
                normalized_source_prefix="/different/mount",
                origin="automatic",
                verification_status="verified",
            )
        )
        for root, library, group in (
            (first_root, first_library, "first"),
            (second_root, second_library, "second"),
        ):
            for index in range(3):
                filename = f"{group}-{index}.mkv"
                db.add_all([
                    MediaFile(
                        library_id=library.id,
                        library_root_id=root.id,
                        relative_path=f"Shared/{filename}",
                        filename=filename,
                        extension="mkv",
                        size_bytes=1000 + index,
                        mtime=1.0,
                        scan_status=ScanStatus.ready,
                    ),
                    ConnectorItem(
                        connection_id=connection.id,
                        connector_library_id=remote_library.id,
                        remote_id=f"{group}-{index}",
                        item_type="Movie",
                        remote_path=f"/different/mount/Shared/{filename}",
                        normalized_remote_path=f"/different/mount/Shared/{filename}",
                        title=filename,
                        size_bytes=1000 + index,
                    ),
                ])
        db.commit()

        reconcile_connector_mappings(db, connection.id)

        assert db.scalar(select(func.count()).select_from(ConnectorRootBinding)) == 0


def test_manual_library_batch_keeps_binding_derived_link_required(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        db.commit()
        replace_connector_bindings(
            db,
            connection.id,
            ConnectorBindingBatchUpdate(
                bindings=[
                    ConnectorBindingWrite(
                        location_id=location.id,
                        library_root_id=root.id,
                        source_prefix=location.remote_path,
                    )
                ]
            ),
        )

        replace_connector_library_links(
            db,
            connection.id,
            ConnectorLibraryLinkBatchUpdate(
                links=[
                    ConnectorLibraryLinkWrite(
                        connector_library_id=remote_library.id,
                        library_ids=[library.id],
                    )
                ]
            ),
        )
        link = db.scalar(select(ConnectorLibraryLink))

        assert link is not None
        assert link.link_method == "derived"


def test_connector_sync_is_single_flight_per_connection_but_independent_between_connections() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        first = ConnectorConnection(provider="jellyfin", name="First")
        second = ConnectorConnection(provider="jellyfin", name="Second")
        db.add_all([first, second])
        db.commit()

        first_job, first_accepted = create_or_get_connector_sync_job(db, first.id)
        duplicate_job, duplicate_accepted = create_or_get_connector_sync_job(db, first.id)
        second_job, second_accepted = create_or_get_connector_sync_job(db, second.id)

        assert first_accepted is True
        assert duplicate_accepted is False
        assert duplicate_job.id == first_job.id
        assert second_accepted is True
        assert second_job.connection_id == second.id
        assert db.scalar(select(func.count()).select_from(ConnectorSyncJob)) == 2


def test_connector_startup_recovery_cancels_orphaned_jobs() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Recovery")
        db.add(connection)
        db.commit()
        job, _accepted = create_or_get_connector_sync_job(db, connection.id)
        job.status = JobStatus.running
        db.commit()

        assert recover_orphaned_connector_sync_jobs(db) == 1
        db.refresh(job)
        assert job.status == JobStatus.canceled
        assert job.active_lock is None
        assert job.finished_at is not None


def test_legacy_connector_mirror_honors_cancellation() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        db.add_all([
            ConnectorConnection(provider="jellyfin", name="Jellyfin"),
            JellyfinConnection(id=1, enabled=True),
        ])
        db.commit()

        class MirrorCanceled(RuntimeError):
            pass

        def cancel_mirror() -> None:
            raise MirrorCanceled

        with pytest.raises(MirrorCanceled):
            mirror_legacy_jellyfin_snapshot(
                db,
                cancellation_check=cancel_mirror,
            )


def test_legacy_connector_mirror_bulk_copies_playback_data_and_is_idempotent() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        now = utc_now()
        connection = ConnectorConnection(provider="jellyfin", name="Jellyfin")
        legacy_connection = JellyfinConnection(id=1, enabled=True)
        legacy_library = JellyfinLibrary(
            remote_item_id="movies",
            name="Movies",
            locations=["/media"],
        )
        enabled_user = JellyfinUser(
            jellyfin_user_id="enabled",
            name="Alice",
            enabled_for_sync=True,
        )
        disabled_user = JellyfinUser(
            jellyfin_user_id="disabled",
            name="Bob",
            enabled_for_sync=False,
        )
        db.add_all([
            connection,
            legacy_connection,
            legacy_library,
            enabled_user,
            disabled_user,
        ])
        db.flush()
        legacy_item = JellyfinItem(
            jellyfin_item_id="movie",
            library_id=legacy_library.id,
            library_name="Movies",
            item_type="Movie",
            path="/media/movie.mkv",
            title="Movie",
            last_synced_at=now,
        )
        db.add(legacy_item)
        db.flush()
        db.add_all([
            JellyfinUserItemData(
                jellyfin_item_id=legacy_item.id,
                jellyfin_user_id=enabled_user.jellyfin_user_id,
                play_count=3,
                played=True,
                playback_position_ticks=42,
                is_favorite=True,
                last_synced_at=now,
            ),
            JellyfinUserItemData(
                jellyfin_item_id=legacy_item.id,
                jellyfin_user_id=disabled_user.jellyfin_user_id,
                play_count=1,
                played=True,
                playback_position_ticks=0,
                is_favorite=False,
                last_synced_at=now,
            ),
            JellyfinPlaybackEvent(
                jellyfin_activity_id=10,
                jellyfin_item_id=legacy_item.id,
                jellyfin_user_id=enabled_user.jellyfin_user_id,
                played_at=now,
                last_synced_at=now,
            ),
            JellyfinPlaybackEvent(
                jellyfin_activity_id=11,
                jellyfin_item_id=legacy_item.id,
                jellyfin_user_id=disabled_user.jellyfin_user_id,
                played_at=now,
                last_synced_at=now,
            ),
        ])
        db.commit()
        progress: list[tuple[str, int, int | None]] = []

        for _run in range(2):
            mirrored_connection_id, _matching = mirror_legacy_jellyfin_snapshot(
                db,
                progress_callback=lambda phase, current, total: progress.append(
                    (phase, current, total)
                ),
            )
            assert mirrored_connection_id == connection.id

        mirrored_state = db.scalar(select(ConnectorUserItemData))
        mirrored_event = db.scalar(select(ConnectorPlaybackEvent))
        assert db.scalar(select(func.count()).select_from(ConnectorUserItemData)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorPlaybackEvent)) == 1
        assert mirrored_state is not None
        assert mirrored_state.play_count == 3
        assert mirrored_state.is_favorite is True
        assert mirrored_event is not None
        assert mirrored_event.remote_event_id == "10"
        assert ("mirroring_items", 1, 1) in progress
        assert ("mirroring_user_states", 1, 1) in progress
        assert ("mirroring_playback_events", 1, 1) in progress


def test_canceled_queued_connector_job_cannot_be_claimed() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Canceled")
        db.add(connection)
        db.commit()
        job, _accepted = create_or_get_connector_sync_job(db, connection.id)

        canceled = request_connector_sync_cancellation(db, connection.id, job.id)

        assert canceled is not None
        assert canceled.status == JobStatus.canceled
        assert claim_connector_sync_job(db, job.id) is None


def test_startup_recovery_removes_abandoned_connector_staging_rows() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Staging recovery")
        db.add(connection)
        db.commit()
        db.add(
            ConnectorSyncStageLibrary(
                sync_run_id="abandoned",
                connection_id=connection.id,
                remote_id="movies",
                name="Movies",
                last_synced_at=utc_now(),
            )
        )
        db.commit()

        assert recover_orphaned_connector_sync_jobs(db) == 0
        assert db.scalar(select(func.count()).select_from(ConnectorSyncStageLibrary)) == 0


def test_connector_secret_is_write_only_in_serialized_contract() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = create_connector_connection(
            db,
            ConnectorConnectionCreate(
                provider="jellyfin",
                name="Secret",
                base_url="http://jellyfin.local",
                secret="do-not-return",
            ),
        )
        response = serialize_connector_connection(db, connection).model_dump()

        assert response["has_secret"] is True
        assert "secret" not in response
        assert "do-not-return" not in str(response)


def test_connector_config_rejects_secret_fields_and_errors_are_redacted() -> None:
    _engine, factory = _session_factory()
    with factory() as db, pytest.raises(ValueError, match="dedicated secret field"):
        create_connector_connection(
            db,
            ConnectorConnectionCreate(
                provider="jellyfin",
                name="Unsafe",
                config={"nested": {"api_key": "do-not-store"}},
            ),
        )
    error = redact_connector_error(
        RuntimeError("request failed token=do-not-log at http://user:password@example.test"),
        secrets=("do-not-log",),
    )
    assert "do-not-log" not in error
    assert "password" not in error
    assert "***" in error


def test_deleted_media_locator_recomputes_previously_matched_item(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        media = MediaFile(
            library_id=library.id,
            library_root_id=root.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
        )
        item = ConnectorItem(
            connection_id=connection.id,
            connector_library_id=remote_library.id,
            remote_id="deleted",
            item_type="Movie",
            remote_path="/srv/media/movie.mkv",
            title="Deleted",
        )
        db.add_all([
            ConnectorRootBinding(
                location_id=location.id,
                library_root_id=root.id,
                source_prefix="/srv/media",
                normalized_source_prefix="/srv/media",
            ),
            media,
            item,
        ])
        db.commit()
        recompute_connector_matches(db, connection_id=connection.id)
        assert item.match_status == "matched"

        db.delete(media)
        db.commit()
        recompute_connector_matches(
            db,
            media_file_locators={(root.id, "movie.mkv")},
        )

        assert item.match_status == "no_local_file"
        assert db.scalar(
            select(ConnectorMediaMatch).where(ConnectorMediaMatch.connector_item_id == item.id)
        ) is None


def test_manual_library_links_are_many_to_many_and_durable(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, first, _root, remote_library, _location = _connector_graph(db, str(tmp_path))
        second = Library(
            name="Archive",
            path=str(tmp_path / "archive"),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(second)
        db.commit()

        libraries = replace_connector_library_links(
            db,
            connection.id,
            ConnectorLibraryLinkBatchUpdate(
                links=[
                    ConnectorLibraryLinkWrite(
                        connector_library_id=remote_library.id,
                        library_ids=[first.id, second.id],
                    )
                ]
            ),
        )

        assert libraries[0].linked_library_ids == [first.id, second.id]
        assert first.preferred_connector_connection_id == connection.id
        assert second.preferred_connector_connection_id == connection.id


def test_connector_recompute_runs_as_persisted_job(tmp_path) -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection, _library, _root, _remote_library, _location = _connector_graph(db, str(tmp_path))
        db.commit()
        job, accepted = create_or_get_connector_sync_job(
            db,
            connection.id,
            trigger_source="binding",
            job_type="recompute",
        )
        assert accepted is True
        assert claim_connector_sync_job(db, job.id) is not None

        assert run_connector_recompute(db, job.id) == {}
        db.refresh(job)
        assert job.status == JobStatus.completed
        assert job.job_type == "recompute"


def test_connector_promote_can_roll_back_without_replacing_live_snapshot() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Atomic")
        db.add(connection)
        db.flush()
        live_library = ConnectorLibrary(
            connection_id=connection.id,
            remote_id="movies",
            name="Old catalog",
        )
        db.add(live_library)
        db.flush()
        db.add(
            ConnectorItem(
                connection_id=connection.id,
                connector_library_id=live_library.id,
                remote_id="old-item",
                item_type="Movie",
                title="Old item",
            )
        )
        db.commit()
        run_id = "failed-run"
        now = utc_now()
        db.add_all(
            [
                ConnectorSyncStageLibrary(
                    sync_run_id=run_id,
                    connection_id=connection.id,
                    remote_id="movies",
                    name="New catalog",
                    last_synced_at=now,
                ),
                ConnectorSyncStageItem(
                    sync_run_id=run_id,
                    connection_id=connection.id,
                    remote_id="new-item",
                    library_remote_id="movies",
                    item_type="Movie",
                    title="New item",
                    last_synced_at=now,
                ),
            ]
        )
        db.commit()

        promote_connector_staging(db, run_id, connection.id, commit=False)
        db.rollback()

        assert db.scalar(
            select(ConnectorLibrary.name).where(ConnectorLibrary.connection_id == connection.id)
        ) == "Old catalog"
        assert set(
            db.scalars(select(ConnectorItem.remote_id).where(ConnectorItem.connection_id == connection.id))
        ) == {"old-item"}


def test_connector_playback_identity_is_scoped_per_connection() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        first = ConnectorConnection(provider="jellyfin", name="First")
        second = ConnectorConnection(provider="jellyfin", name="Second")
        db.add_all([first, second])
        db.flush()
        first_item = ConnectorItem(
            connection_id=first.id,
            remote_id="shared-item",
            item_type="Movie",
            title="First item",
        )
        second_item = ConnectorItem(
            connection_id=second.id,
            remote_id="shared-item",
            item_type="Movie",
            title="Second item",
        )
        first_user = ConnectorUser(
            connection_id=first.id,
            remote_id="shared-user",
            name="Alice",
            enabled_for_sync=True,
        )
        second_user = ConnectorUser(
            connection_id=second.id,
            remote_id="shared-user",
            name="Alice",
            enabled_for_sync=True,
        )
        db.add_all([first_item, second_item, first_user, second_user])
        db.commit()
        now = utc_now()
        for connection in (first, second):
            db.add_all([
                ConnectorSyncStageUser(
                    sync_run_id=f"run-{connection.id}",
                    connection_id=connection.id,
                    remote_id="shared-user",
                    name="Alice",
                    last_synced_at=now,
                ),
                ConnectorSyncStageUserData(
                    sync_run_id=f"run-{connection.id}",
                    connection_id=connection.id,
                    item_remote_id="shared-item",
                    user_remote_id="shared-user",
                    play_count=connection.id,
                    played=True,
                    last_synced_at=now,
                ),
                ConnectorSyncStagePlaybackEvent(
                    sync_run_id=f"run-{connection.id}",
                    connection_id=connection.id,
                    remote_event_id="shared-event",
                    item_remote_id="shared-item",
                    user_remote_id="shared-user",
                    played_at=now,
                    last_synced_at=now,
                ),
            ])
        db.commit()

        promote_connector_playback_staging(db, f"run-{first.id}", first.id)
        promote_connector_playback_staging(db, f"run-{second.id}", second.id)
        db.commit()

        assert db.scalar(select(func.count()).select_from(ConnectorUser)) == 2
        assert db.scalar(select(func.count()).select_from(ConnectorUserItemData)) == 2
        assert db.scalar(select(func.count()).select_from(ConnectorPlaybackEvent)) == 2
        assert {
            (event.connection_id, event.remote_event_id)
            for event in db.scalars(select(ConnectorPlaybackEvent))
        } == {(first.id, "shared-event"), (second.id, "shared-event")}


def test_new_connector_users_are_enabled_by_default() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Default users")
        db.add(connection)
        db.flush()
        db.add(
            ConnectorSyncStageUser(
                sync_run_id="default-users",
                connection_id=connection.id,
                remote_id="new-user",
                name="Alice",
                last_synced_at=utc_now(),
            )
        )
        db.commit()

        promote_connector_playback_staging(db, "default-users", connection.id)
        db.commit()

        user = db.scalar(
            select(ConnectorUser).where(
                ConnectorUser.connection_id == connection.id,
                ConnectorUser.remote_id == "new-user",
            )
        )
        assert user is not None
        assert user.enabled_for_sync is True


def test_connector_playback_promote_rolls_back_to_complete_previous_snapshot() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Atomic playback")
        db.add(connection)
        db.flush()
        item = ConnectorItem(
            connection_id=connection.id,
            remote_id="item",
            item_type="Movie",
            title="Movie",
        )
        user = ConnectorUser(
            connection_id=connection.id,
            remote_id="user",
            name="Alice",
            enabled_for_sync=True,
        )
        db.add_all([item, user])
        db.flush()
        db.add(
            ConnectorPlaybackEvent(
                connection_id=connection.id,
                remote_event_id="old-event",
                connector_item_id=item.id,
                connector_user_id=user.id,
                played_at=utc_now(),
            )
        )
        db.commit()
        now = utc_now()
        db.add_all(
            [
                ConnectorSyncStageUser(
                    sync_run_id="replacement",
                    connection_id=connection.id,
                    remote_id="user",
                    name="Alice",
                    last_synced_at=now,
                ),
                ConnectorSyncStagePlaybackEvent(
                    sync_run_id="replacement",
                    connection_id=connection.id,
                    remote_event_id="new-event",
                    item_remote_id="item",
                    user_remote_id="user",
                    played_at=now,
                    last_synced_at=now,
                ),
            ]
        )
        db.commit()

        promote_connector_playback_staging(db, "replacement", connection.id)
        db.rollback()

        assert list(
            db.scalars(
                select(ConnectorPlaybackEvent.remote_event_id).where(
                    ConnectorPlaybackEvent.connection_id == connection.id
                )
            )
        ) == ["old-event"]


def test_connector_bulk_stage_and_promote_preserve_normalized_metadata() -> None:
    _engine, factory = _session_factory()
    with factory() as db:
        connection = ConnectorConnection(provider="jellyfin", name="Bulk")
        db.add(connection)
        db.commit()
        run_id = "bulk-run"
        now = utc_now()
        db.add(
            ConnectorSyncStageLibrary(
                sync_run_id=run_id,
                connection_id=connection.id,
                remote_id="movies",
                name="Movies",
                last_synced_at=now,
            )
        )
        _upsert_stage_items(
            db,
            [
                _stage_item_row(
                    run_id,
                    connection.id,
                    RemoteItem(
                        remote_id="item",
                        library_remote_id="movies",
                        item_type="Movie",
                        remote_path="/media/movie.mkv",
                        title="Movie",
                        original_title="Original",
                        date_created=now,
                        provider_ids={"Imdb": "tt123"},
                        size_bytes=123,
                        duration_seconds=60.5,
                    ),
                )
            ],
        )
        db.commit()

        promote_connector_staging(db, run_id, connection.id)
        item = db.scalar(select(ConnectorItem).where(ConnectorItem.remote_id == "item"))

        assert item is not None
        assert item.connector_library_id is not None
        assert item.original_title == "Original"
        assert item.date_created == now
        assert item.provider_ids == {"Imdb": "tt123"}
        assert item.size_bytes == 123
        assert item.duration_seconds == 60.5


def test_init_db_migrates_legacy_jellyfin_catalog_idempotently(tmp_path) -> None:
    database = tmp_path / "migration.sqlite3"
    engine = create_engine(f"sqlite:///{database}")
    init_db(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with factory() as db:
        library = Library(
            name="Movies",
            path=str(tmp_path),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        legacy_connection = JellyfinConnection(
            id=1,
            base_url="http://jellyfin.local",
            api_key="top-secret",
            enabled=True,
        )
        db.add_all([library, legacy_connection])
        db.flush()
        root = LibraryRoot(
            library_id=library.id,
            path=str(tmp_path),
            display_name="Movies",
            path_key=str(tmp_path).casefold(),
        )
        legacy_library = JellyfinLibrary(
            remote_item_id="jf-library",
            name="Movies",
            locations=["/srv/media"],
            mapped_locations=[str(tmp_path)],
            mapped_status="linked",
            linked_library_id=library.id,
            link_method="manual",
        )
        db.add_all([root, legacy_library])
        db.flush()
        media = MediaFile(
            library_id=library.id,
            library_root_id=root.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
        )
        item = JellyfinItem(
            jellyfin_item_id="jf-item",
            library_id=legacy_library.id,
            library_name="Movies",
            item_type="Movie",
            path="/srv/media/movie.mkv",
            title="Movie",
            match_status="matched",
        )
        legacy_user = JellyfinUser(
            jellyfin_user_id="shared-user",
            name="Alice",
            enabled_for_sync=True,
        )
        mapping = JellyfinPathMapping(
            jellyfin_path_prefix="/srv/media",
            medialyze_path_prefix=str(tmp_path),
            enabled=True,
        )
        db.add_all([media, item, mapping, legacy_user])
        db.flush()
        db.add_all([
            JellyfinMediaMatch(
                media_file_id=media.id,
                jellyfin_item_id=item.id,
                match_method="path",
                confidence=1.0,
                status="matched",
            ),
            JellyfinUserItemData(
                jellyfin_item_id=item.id,
                jellyfin_user_id=legacy_user.jellyfin_user_id,
                play_count=2,
                played=True,
                playback_position_ticks=0,
                is_favorite=False,
            ),
            JellyfinPlaybackEvent(
                jellyfin_activity_id=99,
                jellyfin_item_id=item.id,
                jellyfin_user_id=legacy_user.jellyfin_user_id,
                played_at=utc_now(),
            ),
        ])
        db.commit()

    init_db(engine)
    init_db(engine)

    with factory() as db:
        connection = db.scalar(select(ConnectorConnection).where(ConnectorConnection.provider == "jellyfin"))
        assert connection is not None
        assert db.get(ConnectorCredential, connection.id).secret_payload == "top-secret"
        assert db.scalar(select(func.count()).select_from(ConnectorLibrary)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorLibraryLocation)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorItem)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorMediaMatch)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorUser)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorUserItemData)) == 1
        assert db.scalar(select(func.count()).select_from(ConnectorPlaybackEvent)) == 1
        binding = db.scalar(select(ConnectorRootBinding))
        assert binding is not None
        assert binding.case_mode == "insensitive"
        assert binding.library_root_id == root.id


def test_matching_does_not_duplicate_exact_candidate_when_another_path_needs_filename_fallback(tmp_path):
    _engine, factory = _session_factory()
    with factory() as db:
        connection, library, root, remote_library, location = _connector_graph(db, str(tmp_path))
        media = MediaFile(library_id=library.id, library_root_id=root.id, relative_path="found/movie.mkv",
                          filename="movie.mkv", extension="mkv", size_bytes=123, mtime=1.0,
                          scan_status=ScanStatus.ready)
        binding = ConnectorRootBinding(location_id=location.id, library_root_id=root.id,
            source_prefix="/srv/media", normalized_source_prefix="/srv/media", case_mode="sensitive")
        exact = ConnectorItem(connection_id=connection.id, connector_library_id=remote_library.id,
            remote_id="exact-same-name", item_type="Movie", remote_path="/srv/media/found/movie.mkv", title="Exact")
        missing = ConnectorItem(connection_id=connection.id, connector_library_id=remote_library.id,
            remote_id="missing-same-name", item_type="Movie", remote_path="/srv/media/missing/movie.mkv", title="Missing")
        db.add_all([media, binding, exact, missing])
        db.commit()
        summary = recompute_connector_matches(db, connection_id=connection.id, connector_item_ids={exact.id, missing.id})
        assert summary["matched"] == 1
        assert summary["no_local_file"] == 1
        match = db.scalar(select(ConnectorMediaMatch).where(ConnectorMediaMatch.connector_item_id == exact.id))
        assert match is not None and match.media_file_id == media.id

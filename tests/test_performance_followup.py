import gzip
import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import AppSetting, Library, LibraryHistory, LibraryType, MediaFile, MediaFileHistory, MediaFileHistoryCaptureReason, MediaSeries
from backend.app.services.history_compression import CURSOR_KEY, decode_snapshot, encode_snapshot_text, compress_file_history_batch
from backend.app.services.library_history_service import HISTORY_METRICS, _project_metrics, get_dashboard_history, get_library_history
from backend.app.services.stats_cache import StatsCache, stats_cache


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv('CONFIG_PATH', str(tmp_path / 'config'))
    monkeypatch.setenv('MEDIA_ROOT', str(tmp_path / 'media'))
    from backend.app.core.config import get_settings
    get_settings.cache_clear()
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, expire_on_commit=False)() as db:
        db.add(Library(id=1, name='Synthetic', path='/synthetic', type=LibraryType.series))
        db.commit()
        yield db
    stats_cache.invalidate(str(id(engine)))
    engine.dispose()
    get_settings.cache_clear()


@pytest.mark.parametrize('metric', sorted(HISTORY_METRICS))
def test_projected_history_keeps_selected_metric_and_range_metadata(db, metric):
    snapshot = {'file_count': 2, 'total_size_bytes': 4000, 'trend_metrics': {
        'schema_version': 2, 'total_files': 2, 'resolution_counts': {'1080p': 1, 'legacy': 1},
        'average_bitrate': 10, 'category_counts': {'audio_languages': {'en': 2}, 'resolution': {'1080p': 1, 'legacy': 1}},
        'numeric_distributions': {'size': {'total': 2, 'bins': [{'count': 2, 'lower': 0, 'upper': 4000, 'percentage': 100}]}}}}
    db.add_all([LibraryHistory(library_id=1, snapshot_day=day, snapshot=snapshot) for day in ['2020-01-01','2026-10-01','2026-10-02']])
    db.commit()
    for load in [lambda **kw: get_library_history(db, 1, **kw), lambda **kw: get_dashboard_history(db, **kw)]:
        full = load()
        projected = load(metric=metric, days=2)
        assert [p.snapshot_day for p in projected.points] == ['2026-10-01','2026-10-02']
        assert projected.oldest_snapshot_day == '2020-01-01'
        assert projected.newest_snapshot_day == '2026-10-02'
        assert projected.points[-1].trend_metrics == _project_metrics(full.points[-1].trend_metrics, metric)
        assert len(load(metric=metric, start='2020-01-01', end='2020-01-01').points) == 1
    stats_cache.invalidate_connectors(str(id(db.get_bind())))
    assert stats_cache.get_dashboard_history(str(id(db.get_bind())), query_key=(metric,None,None,2)) is None


def test_grouped_series_does_not_hydrate_episode_tables(db, monkeypatch):
    import backend.app.services.media_service as media
    db.add(MediaSeries(id=1, library_id=1, title='Show', normalized_title='show', relative_path='Show'))
    db.flush()
    db.add_all([MediaFile(library_id=1, series_id=1, filename=f'{i}.mkv', relative_path=f'Show/{i}.mkv', extension='mkv', mtime=1, size_bytes=100+i, duration_seconds=None if i==0 else 60, bitrate=0 if i==0 else 1000, audio_bitrate=128, quality_score=None if i==0 else 8) for i in range(100)])
    db.commit()
    db.execute(text("UPDATE media_files SET duration_seconds=60, bitrate=1000, audio_bitrate=128, quality_score=8, search_fields_version=4"))
    db.execute(text("UPDATE media_files SET duration_seconds=NULL, bitrate=0, quality_score=0 WHERE id=1"))
    db.commit()
    original = media._load_compact_table_rows
    def guard(db, ids, categories):
        assert not ids
        return original(db, ids, categories)
    monkeypatch.setattr(media, '_load_compact_table_rows', guard)
    result = media.list_grouped_library_files(db, 1).items[0]
    assert result.episode_count == 100
    assert result.total_size_bytes == sum(100+i for i in range(100))
    assert result.total_duration_seconds == 5940
    assert result.quality_score_average == 7.92
    assert result.bitrate_average == (128 + 99*1000)/100
    assert result.play_count_total is None
    assert result.children_loaded is False


def test_language_normalization_once_per_unique_value(monkeypatch):
    from backend.app.services import stats, library_service
    for module in (stats, library_service):
        calls = []
        original = module.normalize_language_code
        def normalize(value):
            calls.append(value)
            return original(value)
        with monkeypatch.context() as patch:
            patch.setattr(module, 'normalize_language_code', normalize)
            result = module._count_distinct_normalized_languages([(i,v) for i in range(100) for v in ['eng','en','deu','de','unknown','en-US']])
        assert dict(result) == {'de': 100, 'en': 100, 'unknown': 100}
        assert len(calls) == 6


def test_overlapping_panel_layouts_reuse_existing_aggregates(db):
    from backend.app.services.stats import build_dashboard
    statements = []
    def capture(conn, cursor, statement, *args):
        statements.append(statement.lower())
    event.listen(db.get_bind(), 'before_cursor_execute', capture)
    build_dashboard(db, ['audio_languages','container'])
    statements.clear()
    result = build_dashboard(db, ['audio_languages','size'])
    assert not any('from audio_streams' in stmt for stmt in statements)
    assert 'size' in result.numeric_distributions
    event.remove(db.get_bind(), 'before_cursor_execute', capture)


def test_cache_weight_budget_evicts_and_rejects_oversize(monkeypatch):
    import backend.app.services.stats_cache as module
    monkeypatch.setattr(module, 'CACHE_NAMESPACE_BYTES', 500)
    cache = StatsCache()
    cache.set_dashboard('db', 'x'*300, ('one',))
    cache.set_dashboard('db', 'y'*300, ('two',))
    assert cache.get_dashboard('db', ('one',)) is None
    assert cache.get_dashboard('db', ('two',)) is not None
    cache.set_dashboard('db', 'z'*1000, ('huge',))
    assert cache.get_dashboard('db', ('huge',)) is None


def test_file_history_compression_is_lossless_resumable_and_keeps_budget_estimates(db):
    from backend.app.services.history_storage import _stored_length_expression
    from backend.app.services.history_retention import _json_length
    snapshot = {'title': 'Grüße 日本語', 'probe': {'padding': 'repeated '*3000, 'number': 1.25, 'null': None}}
    raw = json.dumps(snapshot, ensure_ascii=False, indent=2)
    envelope = encode_snapshot_text(raw)
    assert decode_snapshot(envelope) == snapshot
    with pytest.raises(ValueError):
        decode_snapshot({**envelope, 'sha256': 'broken'})
    for i in [1,2]:
        db.execute(text("INSERT INTO media_file_history (id,library_id,relative_path,filename,captured_at,capture_reason,snapshot_hash,snapshot) VALUES (:id,1,'a.mkv','a.mkv','2026-10-01 00:00:00','scan_analysis','unchanged',:snapshot)"), {'id':i,'snapshot':raw})
    db.commit()
    assert compress_file_history_batch(db, limit=1) == 1
    assert db.get(AppSetting, CURSOR_KEY).value['last_id'] == 1
    assert compress_file_history_batch(db, should_continue=lambda: False) == 0
    assert db.get(AppSetting, CURSOR_KEY).value['last_id'] == 1
    assert compress_file_history_batch(db, limit=1) == 1
    entries = list(db.scalars(select(MediaFileHistory)))
    assert all(entry.snapshot == snapshot and entry.snapshot_hash == 'unchanged' for entry in entries)
    assert all(_json_length(entry.snapshot) == _json_length(snapshot) for entry in entries)
    assert list(db.scalars(select(_stored_length_expression(MediaFileHistory.snapshot)))) == [len(raw),len(raw)]
    stored = list(db.execute(text('SELECT length(snapshot) FROM media_file_history')).scalars())
    assert max(stored) < len(raw)/5
    db.add(MediaFileHistory(library_id=1, relative_path='new.mkv', filename='new.mkv', capture_reason=MediaFileHistoryCaptureReason.scan_analysis, snapshot_hash='new', snapshot=snapshot))
    db.commit(); db.expire_all()
    assert db.scalars(select(MediaFileHistory).order_by(MediaFileHistory.id.desc())).first().snapshot == snapshot


def test_precompressed_assets_negotiate_and_keep_original_semantics(tmp_path, monkeypatch):
    from backend.app.core.config import Settings
    from backend.app.main import create_app
    monkeypatch.setenv('CONFIG_PATH', str(tmp_path/'config'))
    dist = tmp_path/'dist'; assets = dist/'assets'; assets.mkdir(parents=True)
    (dist/'index.html').write_text('<html></html>')
    source = b'console.log("example");'*500
    (assets/'sample.js').write_bytes(source)
    (assets/'sample.js.gz').write_bytes(gzip.compress(source))
    client = TestClient(create_app(Settings(config_path=tmp_path/'config', media_root=tmp_path/'media', frontend_dist_path=dist)))
    encoded = client.get('/assets/sample.js', headers={'Accept-Encoding':'gzip'})
    assert encoded.content == source
    assert encoded.headers['content-encoding'] == 'gzip'
    assert 'javascript' in encoded.headers['content-type']
    assert encoded.headers['vary'] == 'Accept-Encoding'
    assert int(encoded.headers['content-length']) == len(gzip.compress(source))
    plain = client.get('/assets/sample.js', headers={'Accept-Encoding':'gzip;q=0, identity'})
    assert plain.content == source and 'content-encoding' not in plain.headers
    assert client.get('/assets/missing.js').status_code == 404
    etag = encoded.headers['etag']
    assert client.get('/assets/sample.js', headers={'Accept-Encoding':'gzip','If-None-Match':etag}).status_code == 304


def test_offline_downgrade_restores_exact_json_text(tmp_path):
    import sqlite3
    from backend.app.services.history_compression import restore_plain_json
    path = tmp_path / 'offline.sqlite3'
    raw = json.dumps({'title':'日本語', 'metadata': ['repeated text'] * 500}, indent=2, ensure_ascii=False)
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE media_file_history (id INTEGER PRIMARY KEY, snapshot JSON)')
        conn.execute('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value JSON)')
        conn.execute('INSERT INTO media_file_history VALUES (1,?)', (json.dumps(encode_snapshot_text(raw)),))
        conn.execute('INSERT INTO app_settings VALUES (?,?)', (CURSOR_KEY, '{"last_id":1}'))
    assert restore_plain_json(str(path)) == 1
    with sqlite3.connect(path) as conn:
        assert conn.execute('SELECT snapshot FROM media_file_history').fetchone()[0] == raw
        assert conn.execute('SELECT count(*) FROM app_settings').fetchone()[0] == 0
    assert restore_plain_json(str(path)) == 0


def test_background_compression_skips_active_jobs_and_releases_single_flight(db, monkeypatch):
    from backend.app.services import runtime as module, history_compression
    from backend.app.core.config import Settings
    manager = module.ScanRuntimeManager(Settings())
    manager.started = True
    monkeypatch.setattr(module, 'SessionLocal', lambda: db)
    calls = []
    monkeypatch.setattr(history_compression, 'compress_file_history_batch', lambda *args, **kwargs: calls.append('compressed'))
    monkeypatch.setattr(module, 'has_active_scan_jobs', lambda db: True)
    manager.history_compression_submitted = True
    manager._run_history_compression()
    assert not calls and manager.history_compression_submitted is False
    monkeypatch.setattr(module, 'has_active_scan_jobs', lambda db: False)
    manager.history_compression_submitted = True
    manager._run_history_compression()
    assert calls == ['compressed'] and manager.history_compression_submitted is False
    manager.started = False
    manager.executor.shutdown(wait=False, cancel_futures=True)
    manager.maintenance_executor.shutdown(wait=False, cancel_futures=True)
    manager.connector_executor.shutdown(wait=False, cancel_futures=True)


def test_grouped_playback_sums_only_matched_filtered_primary_files_and_enabled_users(db):
    from backend.app.models.entities import JellyfinItem, JellyfinMediaMatch, JellyfinUser, JellyfinUserItemData
    from backend.app.services.media_service import list_grouped_library_files
    from backend.app.services.media_search import LibraryFileSearchFilters
    db.add(MediaSeries(id=1, library_id=1, title='Show', normalized_title='show', relative_path='Show'))
    db.flush()
    db.add_all([MediaFile(id=i, library_id=1, series_id=1, filename=f'{i}.mkv', relative_path=f'Show/{i}.mkv', extension='mkv', mtime=1, size_bytes=i*100, search_fields_version=4, is_transcode_variant=(i==4)) for i in range(1,5)])
    db.add_all([JellyfinUser(jellyfin_user_id='enabled', name='Enabled', enabled_for_sync=True), JellyfinUser(jellyfin_user_id='disabled', name='Disabled', enabled_for_sync=False)])
    db.add_all([JellyfinItem(id=i, jellyfin_item_id=f'item-{i}', title=f'Item {i}', item_type='Episode') for i in [1,2,4]])
    db.flush()
    for i in [1,2,4]:
        db.add(JellyfinMediaMatch(media_file_id=i, jellyfin_item_id=i, match_method='exact_path', status='matched'))
    db.add_all([JellyfinUserItemData(jellyfin_item_id=1, jellyfin_user_id='enabled', play_count=3), JellyfinUserItemData(jellyfin_item_id=1, jellyfin_user_id='disabled', play_count=100), JellyfinUserItemData(jellyfin_item_id=4, jellyfin_user_id='enabled', play_count=100)])
    db.commit()
    assert list_grouped_library_files(db,1).items[0].play_count_total == 3
    assert list_grouped_library_files(db,1,search_filters=LibraryFileSearchFilters(search_size='>=200')).items[0].play_count_total == 0
    assert list_grouped_library_files(db,1,search_filters=LibraryFileSearchFilters(search_size='>=300')).items[0].play_count_total is None


def test_history_identical_distributions_share_cached_graph_without_changing_values(db):
    snapshot={'trend_metrics': {'total_files':2, 'numeric_distributions': {'size': {'total':2, 'bins':[{'lower':0,'upper':1000,'count':2,'percentage':100}]}}}}
    db.add_all([LibraryHistory(library_id=1, snapshot_day=day, snapshot=snapshot) for day in ['2026-10-01','2026-10-02']])
    db.commit()
    payload=get_dashboard_history(db)
    assert payload.points[0].trend_metrics.numeric_distributions['size'] is payload.points[1].trend_metrics.numeric_distributions['size']
    assert get_dashboard_history(db) is payload


def test_projection_preserves_tolerant_parsing_of_malformed_legacy_metrics(db):
    db.add(LibraryHistory(library_id=1, snapshot_day='2026-10-01', snapshot={'trend_metrics': {'total_files':3, 'category_counts':'broken', 'numeric_distributions':['broken']}}))
    db.commit()
    assert get_dashboard_history(db, metric='resolution_mix').points[0].trend_metrics.total_files == 3

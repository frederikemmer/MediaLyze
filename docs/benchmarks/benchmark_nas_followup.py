"""Synthetic same-host benchmark; never opens a production database or media."""
import argparse
import hashlib
import json
import statistics
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from _support import create_benchmark_database, environment_metadata
from sqlalchemy import insert
from backend.app.models.entities import Library, LibraryType, MediaFile, MediaSeries, LibraryHistory
from backend.app.services.media_service import list_grouped_library_files
from backend.app.services.library_history_service import get_dashboard_history
from backend.app.services.stats import _count_distinct_normalized_languages
from backend.app.services.stats_cache import stats_cache


def measure(fn):
    values = []
    result = None
    for _ in range(3):
        start = time.perf_counter()
        result = fn()
        values.append(time.perf_counter() - start)
    return {'seconds': values, 'median_seconds': statistics.median(values)}, result


def run():
    result = {'environment': environment_metadata(), 'cases': {}}
    languages = [(i // 8, ('eng', 'en-US', 'deu', 'ger', 'und', 'fr', 'zxx', 'unknown')[i % 8]) for i in range(140000)]
    result['cases']['languages'], counts = measure(lambda: _count_distinct_normalized_languages(languages))
    result['cases']['languages']['result'] = counts
    try:
        from backend.app.services.history_compression import encode_snapshot_text, decode_snapshot
        probes = []
        for i in range(200):
            streams = [dict(index=j, codec_name="subrip", codec_type="subtitle", time_base="1/1000", tags={"language": ["eng","deu","fra"][j%3], "title": f"Subtitle {j}"}, disposition={"default":0,"forced":int(j%10==0)}) for j in range(40)]
            probes.append(json.dumps({"filename": f"Synthetic-{i}.mkv", "size_bytes": 6000000000+i, "raw_ffprobe_json": {"format":{"format_name":"matroska,webm", "duration":"7200.123", "tags":{"ENCODER":"Synthetic benchmark"}}, "streams": streams}, "subtitle_streams": streams}))
        result['cases']['compression_encode'], envelopes = measure(lambda: [encode_snapshot_text(raw) for raw in probes])
        result['cases']['compression_decode'], decoded = measure(lambda: [decode_snapshot(item) for item in envelopes])
        assert decoded == [json.loads(raw) for raw in probes]
        result['cases']['compression_size'] = {'raw_bytes': sum(len(raw.encode()) for raw in probes), 'encoded_bytes': sum(len(json.dumps(item).encode()) for item in envelopes), 'snapshots':len(probes)}
    except ImportError:
        pass
    with tempfile.TemporaryDirectory(prefix='medialyze-followup-') as folder:
        engine, factory = create_benchmark_database(Path(folder) / 'benchmark.sqlite3')
        with factory() as db:
            db.add(Library(id=1, name='Synthetic series', path='/synthetic', type=LibraryType.series))
            db.commit()
            db.execute(insert(MediaSeries), [dict(id=i+1, library_id=1, title=f'Show {i:03}', normalized_title=f'show {i:03}', relative_path=f'Show {i:03}') for i in range(100)])
            db.execute(insert(MediaFile), [dict(id=i+1, library_id=1, series_id=i//60+1, filename=f'Episode {i}.mkv', relative_path=f'Show {i//60:03}/{i}.mkv', extension='mkv', mtime=1, size_bytes=1000+i, duration_seconds=1800, quality_score=8, bitrate=1000000, audio_bitrate=128000) for i in range(6000)])
            distribution = {'total': 6000, 'bins': [dict(lower=i, upper=i+1, count=60, percentage=1) for i in range(100)]}
            snapshot = {'trend_metrics': {'schema_version':2, 'total_files':6000, 'resolution_counts':{'1080p':6000}, 'totals':{'file_count':6000, 'total_size_bytes':123456}, 'numeric_summaries':{'size':{'count':6000,'sum':123456,'average':20.576}}, 'numeric_distributions':{key:distribution for key in ['size','duration','bitrate','audio_bitrate','quality_score','resolution_mp']}, 'category_counts':{'resolution':{'1080p':6000}, 'audio_languages':{'en':6000}}}}
            db.execute(insert(LibraryHistory), [dict(library_id=1, snapshot_day=(datetime(2023,1,1,tzinfo=UTC)+timedelta(days=i)).date().isoformat(), snapshot=snapshot) for i in range(1000)])
            db.commit()
            result['cases']['grouped_100'], page = measure(lambda: list_grouped_library_files(db,1,limit=100,include_total=False))
            result['cases']['grouped_100']['sha256'] = hashlib.sha256(page.model_dump_json().encode()).hexdigest()
            def history():
                stats_cache.invalidate(str(id(engine)))
                return get_dashboard_history(db)
            result['cases']['history_full'], payload = measure(history)
            result['cases']['history_full_hit'], _ = measure(lambda: get_dashboard_history(db))
            stable = payload.model_dump(mode='json'); stable.pop('generated_at')
            result['cases']['history_full'].update(bytes=len(payload.model_dump_json().encode()), sha256=hashlib.sha256(json.dumps(stable,sort_keys=True).encode()).hexdigest())
            try:
                def projected():
                    stats_cache.invalidate(str(id(engine)))
                    return get_dashboard_history(db, metric='resolution_mix', days=365)
                result['cases']['history_projected'], payload = measure(projected)
                result['cases']['history_projected']['bytes'] = len(payload.model_dump_json().encode())
                result['cases']['history_projected_all'], payload = measure(lambda: get_dashboard_history(db, metric='resolution_mix', _coalesced=True))
                result['cases']['history_projected_all']['bytes'] = len(payload.model_dump_json().encode())
            except TypeError:
                pass
        engine.dispose()
    return result

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--output',type=Path,required=True); args=parser.parse_args()
    data=run(); args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(json.dumps(data,indent=2)+'\n'); print(json.dumps(data['cases'],indent=2))

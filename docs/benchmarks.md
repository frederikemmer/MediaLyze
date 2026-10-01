# Performance benchmarks

The scripts in `docs/benchmarks/` measure selected database and filesystem workloads with synthetic data. They are developer tools; the application does not run them during normal startup or library scans. Each script creates its own temporary SQLite database, and the scan and duplicate benchmarks create temporary media-like files. The temporary data is removed when the script exits.

Run commands from the repository root with the project virtual environment. On Windows:

```powershell
.venv\Scripts\python.exe docs\benchmarks\benchmark_jellyfin_bulk_promote.py --items 100000
.venv\Scripts\python.exe docs\benchmarks\benchmark_connector_bulk_promote.py --items 100000
.venv\Scripts\python.exe docs\benchmarks\benchmark_connector_matching.py --items 100000
.venv\Scripts\python.exe docs\benchmarks\benchmark_library_file_queries.py --items 100000
.venv\Scripts\python.exe docs\benchmarks\benchmark_library_statistics.py --items 100000
.venv\Scripts\python.exe docs\benchmarks\benchmark_scan_pipeline.py --items 2000
.venv\Scripts\python.exe docs\benchmarks\benchmark_duplicate_detection.py --items 10000
```

On Linux or macOS, use `.venv/bin/python` and forward slashes in the paths. Start with smaller `--items` values when checking that the scripts work or when using a slower machine.

## Coverage

| Script | What it measures | Important limits |
| --- | --- | --- |
| `benchmark_jellyfin_bulk_promote.py` | Jellyfin catalog staging, database upserts, and atomic promotion. | Synthetic catalog; no Jellyfin server or network request. |
| `benchmark_connector_bulk_promote.py` | Provider-neutral catalog staging, upserts, and promotion. | Synthetic catalog; excludes connector HTTP fetching and DTO parsing. |
| `benchmark_connector_matching.py` | Matching a large provider-neutral catalog to library paths. | Prepares matching rows in a temporary database; excludes remote connector calls. |
| `benchmark_library_file_queries.py` | First and deep pages, text search, and metadata-filtered file lists through the application query service. | Measures database/service work, not HTTP, response transfer, or browser rendering. Reports whether SQLite trigram FTS or the LIKE fallback was used. |
| `benchmark_library_statistics.py` | Selected library distributions and numeric charts with the application statistics cache missed and hit. | “Cache miss” clears MediaLyze's in-process cache; SQLite and operating-system page caches may still be warm. |
| `benchmark_scan_pipeline.py` | Initial indexing, unchanged incremental scans, an incremental scan with additions/changes/deletions, and full reanalysis. | Uses small synthetic files and a fixed `ffprobe` response. It measures scanning, normalization, and persistence, not real media probing or decoding. |
| `benchmark_duplicate_detection.py` | Filename signatures, SHA-256 hashing, and filename/hash duplicate-group queries. | Uses synthetic files (4 KiB each by default); hashing results depend on storage and worker count. Repeated passes may benefit from the operating-system file cache. |
| `benchmark_startup_memory.py` | Signature backfill, upgrade/repeated database startup, file-history storage pruning, and initial/repeated quality recomputation with large stored JSON; `--reconstruct-only` measures manual history reconstruction. | Temporary synthetic catalog; measures Python allocations with `tracemalloc`, not container RSS or real ffprobe memory. |

The new query, statistics, and duplicate scripts report individual samples and their median, minimum, and maximum. Their `--repeats` option defaults to 3. The three connector benchmarks report one pass per invocation; run each command several times when comparing revisions. All benchmark results include Python, SQLite, and platform versions where applicable.

## Options and interpretation

- `--items` controls the synthetic catalog or file count. The file-query and statistics benchmarks default to 100,000 entries; the scan benchmark defaults to 2,000 files; the duplicate benchmark defaults to 10,000 files.
- `--batch-size` controls fixture insertion batches in the database-oriented benchmarks.
- `benchmark_library_file_queries.py` supports `--repeats`; each case includes the total match count and number of rows returned. The total count cache is invalidated for each sample.
- `benchmark_library_statistics.py` supports `--repeats` and a comma-separated `--panels` list. Its default set covers common video, audio, subtitle, and numeric-statistic panels.
- `benchmark_duplicate_detection.py` supports `--repeats`, `--workers`, and `--file-size-bytes`. Its JSON reports total fixture bytes so the temporary storage cost is clear.

Benchmark setup and measured work are reported separately when useful. Compare runs on the same machine, with the same SQLite/Python versions, item count, batch size, worker count, and search-index mode. A single runtime is not a portable performance guarantee; use the samples to compare changes under a controlled setup. These scripts are not absolute-time CI gates.

The scan and startup-memory scripts report peak Python allocations as well as elapsed time. Allocation tracing adds runtime overhead. Benchmark databases use WAL and NORMAL synchronization, matching the production SQLite configuration; default import-time runtime paths are temporary so the scripts also run outside Docker. Run, for example:

```bash
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 1000 --payload-bytes 65536
.venv/bin/python docs/benchmarks/benchmark_scan_pipeline.py --items 1000
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 1000 --payload-bytes 65536 --reconstruct-only
```

The transcoding capability matrix measures tested hardware paths and practical parallel capacity separately. These database and filesystem scripts do not estimate real CPU/GPU transcoding speed.

The [Issue #184 resilience comparison](benchmarks/issue-184-resilience.md) records measured before/after memory and runtime samples, result parity checks, and the limits of native testing without a running Docker daemon.

[Cancellation, RAM scheduling and maintenance follow-up](benchmarks/issue-184-followup.md) includes separate before/after timing, final Linux Docker tests and UX consequences.

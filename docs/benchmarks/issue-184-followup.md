# Issue #184: cancellation, memory admission and maintenance follow-up

[Documentation home](../README.md)

Measured on 2026-10-01. This compares the first resilience fixes from [the initial report](issue-184-resilience.md) with the subsequent cancellation, RAM scheduling and maintenance changes. It does not use the original release baseline as the "before" version. The before source was copied to an isolated temporary directory before editing; source hashes and all samples are recorded in [the raw results](results/issue-184-followup.json).

## Maintenance comparison

Three fresh, alternating native before/after runs, executed sequentially without heavy tests running concurrently. Same benchmark, WAL/NORMAL SQLite and Python allocation tracing in both versions. Each temporary fixture contains 1,000 media records and 1,000 history entries, each with 64 KiB JSON padding. Fixture creation is outside per-phase measurements. Environment: Python 3.12.13, SQLite 3.51.2, macOS arm64.

| Workload | Before median seconds | After median seconds | Before peak Python MiB | After peak Python MiB |
| --- | ---: | ---: | ---: | ---: |
| Quality recomputation | 10.0057 | 8.2289 | 4.463 | 4.486 |
| Unchanged quality repeat | 5.8377 | 4.2750 | 4.422 | 4.430 |
| History reconstruction | 5.1877 | 4.8229 | 12.950 | 12.939 |

Quality recomputation is about 18% faster, its unchanged repeat about 27% faster, and reconstruction about 7% faster in these synthetic measurements. Memory peaks remain effectively unchanged. Quality jobs reuse the effective profile per media type, avoiding repeated profile queries/normalization. Reconstruction inserts the same full snapshots directly into SQLite in the existing transaction, avoiding per-file ORM flush overhead. Both still release each file's raw payload and stream graph.

All workload assertions pass in every run: 1,000 signatures, identical oldest-first pruning (501 removed/499 retained), 1,000 quality records with zero errors, no new history on an unchanged quality repeat, and 1,000 reconstructed full snapshots.

## Cancellation comparison

One fresh before/after run of the new scan-cancellation regression. A Python executable stands in for ffprobe and sleeps for 30 seconds after creating a marker. Cancellation is requested only once that marker exists, so the probe is already running. Elapsed times include scan setup and teardown.

| Version | Elapsed seconds | Fast cancellation regression |
| --- | ---: | --- |
| Before follow-up | 30.6133 | Fails the three-second bound |
| After follow-up | 0.7528 | Passes; cancellation creates no file failure |

Scan threads signal an event rather than accessing the scan's SQLAlchemy session from worker threads. Probe waiting checks cancellation every 100 ms; canceled processes are killed/reaped and their pipes closed. Hashing checks the same signal between chunks. Pending/admission-waiting workers can also stop. The timeout/output-limit behavior remains covered by subprocess tests. Blocking OS filesystem reads can still delay cancellation on an unresponsive mount; this is not a hard real-time guarantee.

## RAM scheduling and startup behavior

Configured scan parallelism remains the maximum. The initial pool size is capped by available RAM, and running scans also share a process-wide admission gate that rechecks availability while workers wait. Host availability and standard Linux cgroup v1/v2 limits/usage are considered, including enclosing cgroup limits. The gate leaves a 64 MiB reserve and estimates 128 MiB per analysis worker. At least one worker proceeds to avoid permanently stalling a low-memory scan. These are scheduling estimates, not enforced subprocess allocation limits. A single pathological ffprobe or unrelated transcoding workload can still exhaust RAM.

The final 2,000-record/64 KiB maintenance benchmark also completes in Linux Docker at 256 MiB RAM, without swap: exit 0, `OOMKilled=false`, 2,000 signatures, 1,001 old history entries deleted/999 retained, and 2,000 quality records with zero errors. A separate 256 MiB container observation admits one analysis worker. Regression tests cover the configured upper bound, smaller RAM budgets, nested cgroup limits, process-wide sharing and cancellation of a waiting worker.

Startup queues history pruning on the existing single-worker maintenance executor. Database initialization and orphaned-job recovery still finish before readiness. The startup regression checks that retention has been submitted but has not run synchronously. Retention failures are logged. There is no startup-speed percentage claim: an end-to-end HTTP readiness benchmark with a large persisted history was not run.

## Scan overhead check

After identifying excess polling overhead, persisted cancellation status and shared RAM availability are sampled at most every 100 ms. In-memory runtime cancellation remains immediate. Three fresh before/after scan runs use 500 synthetic files and fixed stubbed probe metadata; run order alternates between before-first and after-first. No heavy tests run alongside these timing samples.

| Workload | Before median seconds | After median seconds |
| --- | ---: | ---: |
| Initial indexing | 8.0025 | 8.3207 |
| Unchanged incremental | 1.7527 | 1.7583 |
| Mixed incremental | 1.8553 | 1.8594 |
| Full reanalysis | 7.6508 | 7.6530 |

Existing-library scan runtimes remain effectively unchanged; initial indexing has about 4% overhead here. Traced peaks are effectively unchanged (about 3.8 MiB for indexing and 2.7 MiB for full reanalysis). Counts and statuses match in every run: 500 indexed files, 500 unchanged files, 5 additions/modifications/deletions in mixed scans, and 500 full reanalyses. This fixture does not measure real ffprobe decoding speed or promise unchanged throughput under low RAM.

## Validation and UX

Final full Linux Docker backend suite at 512 MiB RAM: **707 passed, 2 dependency deprecation warnings in 53.15s**. The new cancellation test uses a Python fake probe; the existing real ffprobe corrupt-MP4/healthy-WAV regression also passes in this suite. No frontend/API/settings changes were introduced.

The existing Cancel control responds sooner; scans may slow down under low RAM; expired history may remain visible briefly after startup until background pruning finishes. No new controls are needed. Maintenance retains the same full history content and quality rules. No commit, push, release or GitHub comment was made.

## Reproduce

Run the existing maintenance and scan benchmarks with the project virtual environment:

```bash
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 1000 --payload-bytes 65536
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 1000 --payload-bytes 65536 --reconstruct-only
.venv/bin/python docs/benchmarks/benchmark_scan_pipeline.py --items 1000
CONFIG_PATH=/tmp/medialyze-tests MEDIA_ROOT=/tmp/medialyze-media .venv/bin/python -m pytest -q
```

For before/after comparisons, use separate source copies and fresh interpreters with the same current benchmark instrumentation. The original issue report includes commands for the memory-limited Docker runs. Cancellation is reproduced by `test_cancel_scan_interrupts_running_probe_without_file_failure` in `tests/test_scanner.py`; its source must be available in both variants while the backend source is switched independently.

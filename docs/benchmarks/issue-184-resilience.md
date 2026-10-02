# Issue #184: startup and scan resilience comparison

[Documentation home](../README.md)

Measured on 2026-10-01. Baseline: `66101d702b76dbe6e8042950d3d9fb4c8cce3bfd` (the existing dev implementation before these fixes). After: the first resilience implementation, before the [follow-up scheduling and maintenance optimizations](issue-184-followup.md). This compares source code, not published release images; the follow-up Docker validation below uses the same local Linux image for both source versions.

Three fresh, alternating before/after runs per workload, executed sequentially. The startup/maintenance fixture contains 1,000 media records and 1,000 history entries with 64 KiB of JSON padding each. The scan fixture contains 1,000 small files and stubs ffprobe with a fixed valid payload. Fixture construction and garbage collection are outside measured intervals; allocation tracing is enabled for both versions. SQLite uses WAL/NORMAL in both versions.

Environment: Python 3.12.13, SQLite 3.51.2, macOS-27.0-arm64-arm-64bit.

## Median results

| Workload | Before peak Python MiB | After peak Python MiB | Before seconds | After seconds |
| --- | ---: | ---: | ---: | ---: |
| Startup signature backfill | 127.626 | 0.457 | 0.395 | 0.159 |
| Upgrade database startup | 129.821 | 2.699 | 1.488 | 1.263 |
| Already migrated startup | 0.160 | 0.153 | 0.064 | 0.064 |
| File-history storage pruning | 125.774 | 0.507 | 0.325 | 0.546 |
| Quality recomputation, first pass | 127.881 | 4.466 | 5.984 | 9.084 |
| Quality recomputation, unchanged repeat | 139.128 | 4.426 | 4.821 | 5.869 |
| Manual history reconstruction | 148.428 | 12.945 | 2.763 | 5.619 |
| Initial indexing | 5.460 | 4.959 | 22.637 | 18.113 |
| Unchanged incremental scan | 5.293 | 2.660 | 3.681 | 3.681 |
| Mixed incremental scan | 5.600 | 2.427 | 3.972 | 3.966 |
| Full reanalysis scan | 8.338 | 4.219 | 21.286 | 16.517 |

The upgrade-startup peak drops by about 98%. Initial indexing and full reanalysis are about 20–22% faster here, and existing-library scans use roughly half the Python memory. Unchanged/mixed incremental runtimes are effectively unchanged.

The maintenance trade-off is explicit: storage pruning uses a second streamed pass to preserve the previous canonical JSON byte estimates, and quality recomputation/history reconstruction flush per-file snapshots and release raw payloads instead of retaining all of them. Pruning and maintenance are therefore slower in this fixture. This is a resilience improvement, not a claim that every operation is faster.

## Scaling check

A separate single before/after pass doubles the maintenance fixture to 2,000 records, each still containing 64 KiB of JSON.

| Workload | Before peak Python MiB | After peak Python MiB |
| --- | ---: | ---: |
| Signature backfill | 254.949 | 0.458 |
| Upgrade startup | 257.304 | 2.705 |
| Storage pruning | 251.498 | 0.537 |
| Quality recomputation | 255.410 | 4.457 |

The old peaks approximately double with stored JSON volume; the new peaks for these workloads remain near the 1,000-record values. This does not mean total application memory is constant: the compact scan index, prepared reconstruction aggregates, SQLite caches, and one file's decoded metadata still consume memory.

## Behavior and validation

- All scan runs returned identical statuses and file/change counts: 1,000 initial files; 1,000 unchanged files; 10 additions, 10 modifications and 10 deletions in mixed scans; 1,000 files in full reanalysis. No synthetic probe errors.
- Both versions populated 1,000 signatures, pruned exactly the same 501 oldest file-history entries, retained 499 original entries, and processed all 1,000 quality records without errors. Repeated quality recomputation creates no duplicate history entries. Reconstruction creates the same 1,000 full file snapshots.
- At 2,000 records, both versions populate 2,000 signatures, delete 1,001 oldest entries, retain 999 original entries, and process all 2,000 quality records without errors.
- Final backend suite: **699 passed, 3 warnings in 130.67s (0:02:10)**. Warnings are dependency deprecations. `git diff --check` also passed.
- Regression coverage includes committed migration resumption, transaction rollback for ordinary callers, unrelated malformed raw JSON, empty filename normalization, Unicode byte budgets, NULL/tied timestamps across pruning batches, active-job preservation, transcode variant/media preservation, bounded raw-data retention in quality/reconstruction, unchanged snapshot detection, inaccessible roots/directories/files, and unrelated unreadable media during subtitle detection.
- Existing subprocess tests verify ffprobe timeout/output limits, reaping and pipe closure; an installed real ffprobe verifies that a corrupt MP4 does not prevent a healthy WAV from being analyzed.

## Limits

These are Python allocation peaks, not RSS, cgroup memory, or ffprobe's internal allocations. Real media decoding is excluded from the scan benchmark. The initial native measurements ran without Docker; the follow-up below now verifies memory-limited Linux containers. The reported production OOM cause still requires host/container diagnostics. No frontend files, API shapes, or settings were changed; the existing scan log reports filesystem failures. No release, commit, push, or GitHub comment was made.

## Docker memory-limit validation

Follow-up on 2026-10-01, using the existing local `medialyze-validation:macos-m1-max-20260903` image (Python 3.12.14, SQLAlchemy 2.0.52). Both versions use the current benchmark and the same image, read-only source mounts, temporary SQLite/config/media paths, and no network. The baseline overrides only `/workspace/backend` with the isolated baseline backend. No production data is mounted. Equal memory and memory-swap limits disable swap.

| Source | RAM limit | Exit | Docker OOMKilled | Outcome |
| --- | ---: | ---: | --- | --- |
| Baseline | 256 MiB | 137 | true | Killed before benchmark result |
| Updated | 256 MiB | 0 | false | All workload assertions pass |
| Baseline control | 1 GiB | 0 | false | All workload assertions pass |

The fixture contains 2,000 media records and 2,000 history entries with 64 KiB JSON payloads. Updated code at 256 MiB and baseline at 1 GiB produce the same 2,000 signatures, delete the same 1,001 oldest history entries, retain 999 original entries, and recompute quality for 2,000 files with zero errors. The repeated quality pass creates no additional history entries. The container outcome covers fixture creation and all benchmark phases, unlike the per-phase Python allocation measurements. This demonstrates a reproducible memory-limit failure fixed for this workload; it does not establish the reporter's exact host OOM cause or bound ffprobe's internal memory.

The seven affected regression modules also pass inside Linux Docker at 512 MiB: **225 passed in 18.97s**, including the real corrupt-MP4/healthy-WAV scan and timeout/output-limit tests. Pytest 9.0.3 was installed only in the disposable test container. This is a targeted Linux run; the full 699-test result above is the native run.

[Docker states, limits and benchmark outputs](results/issue-184-docker.json)

To reproduce the container workloads, use a local Python 3.12 image with the project runtime dependencies installed. From the repository root:

```bash
baseline_dir=$(mktemp -d)
git archive 66101d702b76dbe6e8042950d3d9fb4c8cce3bfd backend | tar -x -C "$baseline_dir"
# Updated source, 256 MiB. Keep the container until its OOM state is inspected.
docker run --name medialyze-184-repro-after --memory 256m --memory-swap 256m --network none \
  --mount "type=bind,src=$PWD,dst=/workspace,readonly" --workdir /workspace \
  --env CONFIG_PATH=/tmp/config --env MEDIA_ROOT=/tmp/media --env PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint python medialyze-validation:macos-m1-max-20260903 \
  docs/benchmarks/benchmark_startup_memory.py --items 2000 --payload-bytes 65536
docker inspect medialyze-184-repro-after --format '{{json .State}}'
docker rm medialyze-184-repro-after
# Baseline: repeat with a different container name and add this source override:
# --mount "type=bind,src=$baseline_dir/backend,dst=/workspace/backend,readonly"
# First use 256m/256m, then 1g/1g as the successful control.
```

## Reproduce

```bash
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 1000 --payload-bytes 65536
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 2000 --payload-bytes 65536
.venv/bin/python docs/benchmarks/benchmark_startup_memory.py --items 1000 --payload-bytes 65536 --reconstruct-only
.venv/bin/python docs/benchmarks/benchmark_scan_pipeline.py --items 1000
# For local non-Docker tests, use temporary writable config/media paths:
CONFIG_PATH=/tmp/medialyze-test-config MEDIA_ROOT=/tmp/medialyze-test-media .venv/bin/python -m pytest -q
```

For an exact before/after rerun, use an isolated copy of the baseline backend, copy the updated benchmark scripts into that copy, and run the same commands in fresh processes on both versions. Do not compare to the previous benchmark helper's non-WAL database configuration. Temporary fixtures include ascending historical timestamps in the past so the unchanged-repeat check is not distorted by future-dated synthetic history.

[Raw samples and environment metadata](results/issue-184-resilience.json)

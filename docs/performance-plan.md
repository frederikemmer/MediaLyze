# Performance implementation plan

Status: implemented and regression-tested; final results in [the report](benchmarks/performance-report.md). Baseline: current `dev` plus the pre-existing local changes on 2026-10-01. No commits, pushes or publication are part of this work.

Each step must preserve response semantics and pass the relevant regression tests before moving on. Benchmark databases are temporary, install production indexes and use WAL/NORMAL. Timing comparisons run sequentially on the same host; cache misses do not imply a cold OS cache. Full backend/frontend suites and a production build close the work. Findings and actual outcomes are recorded in `docs/benchmarks/performance-report.md`.

| Order | Work | Acceptance goal | Validation |
| --- | --- | --- | --- |
| 1 | Compact transcode source/status queries | No raw probe JSON in list queries; reduce 200-job memory by at least 80%, preserve detail responses | SQL/response regression; repeated history benchmark |
| 2 | Batch connector status and reduce inactive/history polling | One connector status request per interval; pause hidden tabs; history refresh only when needed; detect externally started jobs | API tests, fake-clock/visibility/component tests |
| 3 | Modular chart imports | At least 40% smaller compressed ECharts chunk; preserve all registered chart/renderers/tooltips | Frontend tests, production build, catalog/browser inspection |
| 4 | Domain-specific cache invalidation | Connector mutations keep unrelated technical statistics warm and invalidate dependent views | Cache/sync regressions; cache miss/hit comparison |
| 5 | Bounded comparison aggregation | Avoid full source-row retention; preserve exact heatmaps, counts and deterministic scatter selection | Comparison parity tests; 100k timing/memory benchmark |
| 6 | Reusable bounded Storage Map aggregation | Avoid retaining source rows; reuse folder accumulators and resolution classification within a calculation; retain the existing per-path cache without stale totals | Root/multi-root/path/color parity tests; 100k benchmark |
| 7 | Load language/chart resources when needed | Reduce initial JS; selected language ready before rendering; preserve language switching | Language tests, build sizes and catalog inspection |
| 8 | Bound browser table caches | Enforce byte/row budgets without truncating the active table or changing scroll position | LRU/page cache tests; deterministic cache budget workload |
| 9 | Separate/background resource priorities | Connector limits independent of scans; FFmpeg background priority; preserve explicit concurrency controls | Runtime/subprocess tests and reproducible mixed-load benchmark where feasible |
| 10 | Opt-in performance observations | Aggregate route/cache/queue measurements with bounded memory and negligible disabled overhead | Instrumentation tests; mixed-load response latency report |

Persistent aggregates, new UI controls and database indexes are introduced only if measured benefits justify their maintenance/write costs. A failed performance goal is recorded honestly; correctness takes precedence over a faster but changed result.

Implementation decisions: after measuring the existing paths, use streaming aggregation before adding persisted folder summaries; there is no new aggregate schema or index write cost. Bound reusable result caches first. Eviction from the active scrolling table is deferred because it requires a separate scroll/refetch UX design. The final report records these scope refinements and remaining limits explicitly.

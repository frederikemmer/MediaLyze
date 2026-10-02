# Architecture Notes

[Documentation home](README.md)

## Backend

- `backend/app/main.py` boots FastAPI, initializes SQLite, and serves the built frontend.
- `backend/app/models/entities.py` contains the normalized schema required for library, format, stream, and scan-job tracking.
- `backend/app/services/scanner.py` performs deterministic discovery and parallel `ffprobe` execution.
- `backend/app/services/transcoding.py` validates versioned structured plans, discovers and smoke-tests FFmpeg encoders/devices, builds shell-free argument lists, publishes according to the explicit output policy, and reconciles analyzed files with persistent variant groups.
- `backend/app/services/connector_contract.py` defines the provider-neutral adapter boundary and DTOs.
- `backend/app/services/connector_sync.py` owns connection-scoped staging, atomic promotion, cancellation, and recovery.
- `backend/app/services/connector_mapping.py` infers conservative connection-scoped mapping rules, while `connector_pathing.py` and `connector_matching.py` resolve them to stable root-relative file identities.

Scan jobs are persisted and scheduled through `ScanRuntimeManager`, with independent scan, two-worker connector, maintenance, and transcode execution paths. Per-file probe workers share a RAM admission gate; ffprobe has bounded output/time and supports cancellation. Startup cancels orphaned jobs and queues history retention asynchronously. [Metadata/runtime support](supported_metadata.md#7-cross-cutting-runtime-support) and [benchmarks](benchmarks.md) provide the detailed limits.

## Frontend

- The UI is a React SPA built with Vite, with lazily loaded routes, languages, and modular chart resources.
- Main routes are `/`, `/settings`, `/libraries/:libraryId`, `/files/:fileId`, `/files/:fileId/preview`, `/files/compare`, `/storage-map`, and `/transcoding`. The development-only `/ui-elements` catalog is the visual reference.
- `frontend/src/lib/release-visibility.ts` hides Federation and automation-rule UI while preserving their backend implementation.
- Routing is client-side; the backend serves `index.html` for deep links.
- `frontend/globals.css` provides the design language, extended by `frontend/src/medialyze.css`.

## Data flow

1. A library is created from one or more browsed roots under `MEDIA_ROOT` in server mode, or native absolute folder selections in desktop mode.
2. A scan job traverses the filesystem and updates `media_files`.
3. New or changed files are analyzed with `ffprobe`.
4. Normalized rows are stored and aggregated for dashboard/detail endpoints.

## Transcoding data flow

1. A regular video file receives an editable profile-derived, structured plan.
2. Server-side validation resolves the source below its library root and the target below the configured output root or, for explicit source-directory/replacement policies, the library root, verifies stream/container/encoder compatibility, and persists the exact normalized plan and command.
3. `ScanRuntimeManager` runs the job on a dedicated transcode executor with CPU-budget and per-device GPU slots; scan workers remain available for discovery and analysis.
4. FFmpeg writes to a hidden temporary file beside the target. Cancellation, failure, or a changed source removes that temporary output when partial-output cleanup is enabled.
5. Successful output is published without replacing an existing path, except for the explicit confirmed replacement mode; then an incremental scan with trigger `transcode` analyzes same-directory output.
6. Reconciliation attaches the resulting `MediaFile` to the durable `TranscodeVariantGroup`, while same-directory variants are excluded from primary queries and later scans. Pruning job history never deletes output media or variant relationships.

The complete contract, safety invariants, profiles, and API are documented in [Transcoding](transcoding.md).

Federation is retained implementation hidden by the current frontend release switches; it is not a shipped UI workflow. Backend activation also requires the persisted opt-in and process gate. See [internal notes](internal/unreleased-transcoding.md). It extends that flow without changing ownership of local media. The origin installation owns the user-facing `TranscodeJob`, source
snapshot, output publication, variant relationship, and follow-up analysis.
It selects a directly paired worker from the worker's persisted capabilities,
resource state, and measured network estimate, then sends a versioned,
authenticated/encrypted assignment and resumable chunks. The worker stores
only a connection-scoped remote attempt and isolated temporary files, leases a
local CPU/GPU slot, validates the structured plan against its own FFmpeg
probe, and returns a hash-verified result. Heartbeat expiry and persisted
attempt/transfer/chunk state make interruption resumable while keeping scans,
normal library rows, and local transcode slots independent.

## Connector data flow

External catalogs use the architecture documented in [connectors.md](connectors.md):

```mermaid
flowchart LR
    P["Provider adapter"] --> D["Provider-neutral DTOs"]
    D --> S["Connection-scoped staging"]
    S --> C["Atomic connector catalog"]
    C --> R["Location-to-root resolver"]
    R --> M["Exact root-relative matcher"]
    M --> O["API and file overlays"]
```

The connector core owns connections, provider descriptors, credentials, remote catalogs, mapping inference, synchronization, background recompute jobs, and exact-path matches. Provider adapters own transport and response normalization. The inference step derives only transformations supported by a conservative multi-asset corpus; it never persists file candidates. The matcher prepares bindings once, persists resolved root locators, and performs bulk indexed matching. The MediaLyze scanner remains the sole owner of local paths and file identities and reports pre/post root locators so additions, deletions, and renames enqueue connector remapping on the dedicated executor. Jellyfin image behavior remains a provider-specific compatibility extension during the first connector release.

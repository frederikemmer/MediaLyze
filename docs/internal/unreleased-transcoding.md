# Unreleased transcoding implementation notes

[Documentation home](../README.md)

Status: Federation and automatic rules are currently hidden in the shipped frontend; saved presets and local transcoding remain available. Hiding these controls does not disable their backend routes or runtime. Federation additionally requires persisted opt-in and the process-level gate below.

To expose these features in a later release, set the corresponding switches in
`frontend/src/lib/release-visibility.ts` to `true`, restore the relevant public
documentation and Docker port examples from this file, and run the existing
frontend and backend test suites. The API, runtime, translations, and UI
implementations remain in the repository.

Automatic rules are disabled when created. Each rule has an explicit library selection, a priority, a preset, an output mode, and a safe optional output subfolder. Conditions reuse the analyzed-file dimensions used by the file search (including path/name, size, duration, quality, bitrate, codecs, resolution, HDR, audio/subtitle languages and codecs, and stream properties) and can be nested with `AND` or `OR`. Active rules are evaluated in priority order; the first matching rule wins. A winning rule that is blocked by validation, a missing capability, an unsafe target, or missing replacement approval is recorded as blocked and does not fall through to a lower-priority rule.

Separate-output jobs use `Transcode_Output` and can optionally use a rule-relative subfolder. The subfolder is normalized and rejected when it is absolute, escapes through `..`, contains a drive/UNC prefix, or contains control/path-separator abuse. Same-directory output and original replacement do not accept a rule subfolder. Replace-original rules are disabled until the current rule version is explicitly approved; changing their match, library, preset, output mode, or subfolder revokes approval and cancels queued work. Reordering rules changes their evaluation priority and version while preserving an already approved replacement contract.

The management API exposes preset and rule CRUD, rule ordering and replacement approval, a bounded preview, pagewise inventory start/cancel/status, and durable run history. Inventory uses the same source size/mtime and rule/preset version identity for deduplication, records skipped/blocked/completed decisions, and never retries failed work implicitly. A successful, error-free full or incremental scan can enqueue only newly analyzed or changed primary video files for matching rules. Canceled, failed, or partially failed scans do not trigger automation, and automation output variants are not re-enqueued as primary sources. Restart recovery cancels orphaned queued automation work; running transcodes retain their immutable job snapshot and are finalized by the normal job runtime.

## Direct transcode federation

MediaLyze can optionally form a direct network of trusted installations for
transcoding. Federation is opt-in and has no cloud coordinator, UPnP
dependency, or multihop routing: a member connects directly to the advertised
HTTP(S) protocol endpoint of another member. The normal local admin API remains
available on its existing port; Docker and split-network deployments can expose
the separate federation listener on port `8091` plus UDP discovery on `43211`.

Each installation keeps a stable installation ID and shows a six-digit pairing
code for the initial connection. The code rotates automatically every 30
seconds; the server verifies the current short-lived code with a small clock
skew tolerance, while already trusted members continue using their established
peer secret. The local Transcoding settings panel shows detected hostname and
IP endpoint URLs in one responsive, copyable list for pairing another
installation. Explicitly advertised URLs are shown with their configured
scheme and port; for Docker port mappings, NAT, or reverse proxies, set
`MEDIALYZE_FEDERATION_ADVERTISE_URLS` to the address the peer can actually
reach. LAN discovery omits the local
installation, and a discovered installation name is shown instead of repeating
the same endpoint as its display label. Each discovered candidate has its own
pairing-code field next to the Connect action; an empty code is indicated on
that field without adding a panel-level notification.
Pairing is accepted only when the human-supplied code matches, and the two
installations derive a peer-specific authenticated/encrypted application
envelope from that exchange. Resetting the code immediately replaces the
rotating-code secret, prevents future pairings with the previous code, and does
not silently remove already trusted members; an excluded member must be paired
again explicitly. LAN discovery only returns direct candidates from
other installations and never presents this installation as a peer or grants
trust by itself. The shared Transcoding automation workspace
exposes the trusted member list with reachability, acceptance of remote jobs,
and sync/exclude actions in the same searchable expandable treatment as
presets and rules. The Transcoding settings page combines the local matrix
with each member's locally persisted codec
matrix in the `Accelerators` tab and labels remote devices with their member
name. The matrix is evidence of a path that passed the real FFmpeg probe; it
is not a speed ranking and federation does not run an automatic benchmark on
a peer.

The transcode target is persisted in the structured plan as `local`,
`automatic`, or a specific member, with an optional target device ID. Automatic
selection filters for the requested codec, execution mode, hardware/device
support, acceptance state, and reachability, then estimates queue time,
source/result transfer time, and transcode time. Local execution wins a true
tie. A job never changes from an explicit target to another target silently;
the UI keeps the selected worker and every wait reason visible.

Remote execution has the same origin-side output and source-snapshot safety
rules as local execution. The origin sends only the structured plan, a source
metadata snapshot, the source file, and the selected external subtitle
sidecars. It never sends a library path or a shell command. The target validates
the plan again against its own real capabilities, creates a private workspace
under `CONFIG_PATH/transcode-federation`, reserves a CPU/GPU resource with a
lease, and runs FFmpeg with `shell=False`. It does not create a library entry
or `MediaFile`. The origin verifies the result hash and source size/mtime again
before publishing a variant, replacing the original, and/or scheduling the
normal follow-up analysis.

Source and result files use deterministic resumable chunks with per-chunk and
full-file SHA-256 verification. Chunk state is persisted on both sides so a
retry resumes missing chunks. Heartbeats are sent while the attempt is active;
the target expires a stale lease. Automatic selection happens before assignment;
if the selected peer temporarily disappears, the origin keeps the deterministic
attempt queued and resumes it when that peer returns. The current worker runtime
keeps reservations separate from scan workers and records the origin, global job,
attempt, device, lease, transfer, and processing phase. The visible
phases are queued, worker selection, reservation, source transfer, target
preparation, transcoding, result transfer, validation, publishing, analysis,
completion, cancellation, and failure.


## Federation settings

Federation also requires the installation to be enabled in the Transcoding
settings. `MEDIALYZE_FEDERATION_ENABLED` is the process-level safety gate; the
persisted Federation setting in the database must also be enabled.

| Variable | Default | Description |
| --- | --- | --- |
| `MEDIALYZE_FEDERATION_ENABLED` | `true` | Process-level enable/disable gate for direct Federation. Set to `false` to disable it without deleting paired members. |
| `MEDIALYZE_FEDERATION_HOST` | `0.0.0.0` | Bind address for the separate Federation HTTP listener. |
| `MEDIALYZE_FEDERATION_PORT` | `8091` | Internal TCP port for Federation protocol requests. Expose the same container port in Compose. |
| `MEDIALYZE_FEDERATION_DISCOVERY_PORT` | `43211` | UDP port used for LAN discovery. |
| `MEDIALYZE_FEDERATION_PASSCODE` | unset | Optional secret seed for the rotating six-digit pairing code. Treat it as a secret; existing persisted pairing state is retained when it is unset. |
| `MEDIALYZE_FEDERATION_ADVERTISE_URLS` | unset | Comma-separated HTTP/HTTPS base URLs that peers can actually reach, for example `http://nas.example.lan:8091,http://192.0.2.10:8091`. |
| `MEDIALYZE_FEDERATION_CHUNK_SIZE_BYTES` | `1048576` | Resumable transfer chunk size. Valid range: 64 KiB to 16 MiB. |
| `MEDIALYZE_FEDERATION_TEMP_BUDGET_BYTES` | `0` | Maximum Federation workspace budget in bytes. `0` means no explicit budget. |
| `MEDIALYZE_FEDERATION_RESULT_RETENTION_HOURS` | `24` | Retention period for completed remote result workspaces, from 1 to 168 hours. |
| `MEDIALYZE_FEDERATION_REQUEST_TIMEOUT_SECONDS` | `15` | HTTP request timeout used for peer operations, from greater than 0.5 to 120 seconds. |

Host-side Compose port variables are different from the container settings:

| Variable | Default | Description |
| --- | --- | --- |
| `FEDERATION_HOST_PORT` | `8091` | Host TCP port mapped to `MEDIALYZE_FEDERATION_PORT`. |
| `FEDERATION_DISCOVERY_PORT` | `43211` | Host UDP port mapped to `MEDIALYZE_FEDERATION_DISCOVERY_PORT`. |

If a host port or container port is changed, update the mapping and the
advertised URL together. A port that is merely published by Docker is not
enough; the application listener must bind the corresponding container port.


## Federation API

- `GET /api/transcoding/federation`
- `PATCH /api/transcoding/federation`
- `POST /api/transcoding/federation/passcode/reset`
- `POST /api/transcoding/federation/discover`
- `POST /api/transcoding/federation/members/pair`
- `POST /api/transcoding/federation/members/{installation_id}/sync`
- `DELETE /api/transcoding/federation/members/{installation_id}`

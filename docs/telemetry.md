# Telemetry

MediaLyze telemetry is designed as coarse installation telemetry, not user tracking. Payloads never include file paths, media names, library names, hostnames, search terms, raw `ffprobe` JSON, per-file metadata, or scan diagnostics.

Telemetry modes:

- `none`: no user decision exists yet. Payloads contain only install/runtime/system fields.
- `initialized`: the first-run telemetry prompt has been shown or the first pre-choice payload was sent, but no user decision exists yet.
- `off`: telemetry is disabled. No payload is sent while this mode is active.
- `minimal`: minimal anonymous installation snapshot. Payloads contain only install/runtime/system fields.
- `enabled`: extended anonymous installation snapshot with coarse usage counts and selected app settings.

Set `MEDIALYZE_TELEMETRY_DISABLED=true` to force telemetry off. In that state the UI toggle is locked to `off`, and no telemetry payload is sent.

The app sends accepted telemetry modes to `https://www.medialyze.app/api/telemetry/ingest` by default. Override this with `MEDIALYZE_TELEMETRY_ENDPOINT` for development or alternate deployments.

Development builds send normal payloads with `is_test: false`. Test payloads are only used by explicit development connectivity checks, not by the regular app sender.

## Send Timing

On first startup with `mode=none`, MediaLyze attempts one pre-choice minimal payload. If that send succeeds, the stored mode changes to `initialized`; if it fails, the mode remains `none` so the next startup can retry. This initial payload is not shown as the last user-visible payload because it can happen before a user has made a telemetry choice.

When a user changes telemetry from `off`, `none`, or `initialized` to `minimal` or `enabled`, MediaLyze schedules the first selected-mode payload for 60 seconds later. If telemetry is switched back to `off` before the delay expires, the pending send is canceled.

After that, regular telemetry is sent once per day around `00:00` UTC. The scheduler applies up to 10 minutes of jitter so installations spread requests instead of all posting at the same instant.

Failed sends are retried in the same background task after 1 second, 2 seconds, 5 seconds, and 10 seconds. If all attempts fail, MediaLyze stops retrying that payload and waits for the next scheduled or user-triggered send opportunity.

## Preview API

The app exposes a local preview endpoint:

```text
GET /api/telemetry/preview?mode=none
GET /api/telemetry/preview?mode=minimal
GET /api/telemetry/preview?mode=enabled
```

Response format:

```json
{
  "payload": {},
  "redacted": true,
  "mode": "enabled"
}
```

The `payload` field contains the exact JSON shape for the selected mode. Preview responses use a redacted placeholder installation id.

Telemetry mode is persisted in app settings:

```json
{
  "telemetry": {
    "mode": "minimal",
    "environment_disabled": false,
    "last_user_visible_payload": null
  }
}
```

The UI updates telemetry mode through:

```http
PATCH /api/app-settings
Content-Type: application/json

{
  "telemetry": {
    "mode": "minimal"
  }
}
```

Accepted update modes are `off`, `minimal`, and `enabled`.

## None Payload

`none` is used before the user has made a telemetry choice. It does not include `usage`, `app_settings`, or media-kind counts.

```json
{
  "schema_version": 1,
  "event_type": "installation_snapshot",
  "telemetry_mode": "none",
  "installation_id": "uuid-v4",
  "sent_at": "2026-05-09T12:00:00Z",
  "is_test": false,
  "app": {
    "name": "MediaLyze",
    "version": "0.10.4",
    "runtime_mode": "server",
    "deployment_channel": "docker"
  },
  "system": {
    "os_family": "linux",
    "architecture": "arm64"
  }
}
```

## Minimal Payload

`minimal` also excludes `usage`, `app_settings`, and media-kind counts.

```json
{
  "schema_version": 1,
  "event_type": "installation_snapshot",
  "telemetry_mode": "minimal",
  "installation_id": "uuid-v4",
  "sent_at": "2026-05-09T12:00:00Z",
  "is_test": false,
  "app": {
    "name": "MediaLyze",
    "version": "0.10.4",
    "runtime_mode": "server",
    "deployment_channel": "docker"
  },
  "system": {
    "os_family": "linux",
    "architecture": "arm64"
  }
}
```

## Enabled Payload

`enabled` includes coarse library and analyzed-file statistics plus selected app settings.

```json
{
  "schema_version": 1,
  "event_type": "installation_snapshot",
  "telemetry_mode": "enabled",
  "installation_id": "uuid-v4",
  "sent_at": "2026-05-09T12:00:00Z",
  "is_test": false,
  "app": {
    "name": "MediaLyze",
    "version": "0.10.4",
    "runtime_mode": "server",
    "deployment_channel": "docker"
  },
  "system": {
    "os_family": "linux",
    "architecture": "arm64"
  },
  "usage": {
    "library_count": 3,
    "library_type_counts": {
      "movies": 1,
      "series": 1,
      "music": 1,
      "mixed": 0,
      "other": 0
    },
    "media_kind_counts": {
      "audio": 3400,
      "video": 1800,
      "other": 0
    },
    "analyzed_file_count_rounded": 23000,
    "storage_size_gb_rounded": 12000,
    "scan_mode_counts": {
      "manual": 1,
      "scheduled": 0,
      "scheduled_daily": 1,
      "watch": 1
    },
    "duplicate_detection_mode_counts": {
      "off": 2,
      "filename": 1,
      "filehash": 0,
      "both": 0
    },
    "enabled_feature_flags": ["show_full_width_app_shell"]
  },
  "app_settings": {
    "interface_language": "de",
    "color_theme": "dark",
    "scan_worker_count": 4,
    "parallel_scan_jobs": 2,
    "comparison_scatter_point_limit": 5000
  }
}
```

## Enabled-Only App Settings

The `app_settings` object is sent only in `enabled` mode:

- `interface_language`: `en` or `de`
- `color_theme`: `system`, `light`, or `dark`
- `scan_worker_count`: per-scan analysis workers
- `parallel_scan_jobs`: parallel library scan limit
- `comparison_scatter_point_limit`: scatter plot sample limit

Language and theme are explicit MediaLyze UI preferences. They are not broad browser fingerprinting data. No other `localStorage` contents are sent.

## Media Kind Counts

`usage.media_kind_counts` is sent only in `enabled` mode. It is a string-keyed object so future kinds such as `audiobook`, `image`, `subtitle`, or `document` can be added without changing the payload shape.

Current classification is extension-based:

- `audio`: extension is in MediaLyze audio extensions
- `video`: extension is in MediaLyze video extensions
- `other`: extension is neither audio nor video

Counts are based on current analyzed files with `scan_status == ready`. Mixed libraries are counted by each file's extension, not by the library type.

## Rounding Rules

Analyzed file counts and media-kind counts use `round_count_for_telemetry(value)`: values below `100` are unchanged, and larger values are rounded down to their first two significant digits. Examples:

```text
127 -> 120
23793 -> 23000
```

Storage uses `round_storage_gb_for_telemetry(bytes_value)`: bytes are converted to decimal GB, values below 1 GB round up to `1`, and larger GB values use the same first-two-digits rounding. Examples:

```text
534 MB -> 1 GB
24 GB -> 24 GB
496 GB -> 490 GB
12 TB -> 12000 GB
```

## Ingest Contract

A telemetry backend can accept:

```text
POST /api/telemetry/ingest
```

The production app sender posts to this path with `is_test: false` in both dev and release builds.

Development connectivity checks should send the same payload shape with `is_test: true`. Test events must be accepted for endpoint verification but excluded from production aggregates.

Example test request:

```bash
curl -X POST "https://deine-railway-domain/api/telemetry/ingest" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": 1,
    "event_type": "installation_snapshot",
    "telemetry_mode": "minimal",
    "installation_id": "11111111-1111-4111-8111-111111111111",
    "sent_at": "2026-05-11T12:00:00Z",
    "is_test": true,
    "app": {
      "name": "MediaLyze",
      "version": "0.10.4",
      "runtime_mode": "server",
      "deployment_channel": "docker"
    },
    "system": {
      "os_family": "linux",
      "architecture": "arm64"
    }
  }'
```

Expected success response:

```json
{
  "accepted": true
}
```

Expected validation failure response:

```json
{
  "accepted": false,
  "error": "unsupported_schema_version"
}
```

Recommended validation:

- accept only `schema_version: 1`
- accept only `event_type: "installation_snapshot"`
- reject payloads over 16 KB
- rate-limit by `installation_id` and transient IP
- accept `is_test: true` payloads for development connectivity checks and exclude them from production aggregates
- store raw events for at most 30 days
- store aggregate daily counts separately

Suggested aggregate dimensions:

- date
- app version
- runtime mode
- deployment channel
- telemetry mode
- OS family
- architecture
- rounded file count
- rounded storage size
- media-kind counts
- selected app settings from `enabled` payloads
- active installations by distinct installation id

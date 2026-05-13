# Telemetry

MediaLyze telemetry is coarse installation reporting for understanding active installations, versions, operating systems, deployment channels, and broad usage scale. It is not intended to track people or media collections, but mainly to show of the userbase and more importantly help me with development.

Telemetry never sends:

- file paths
- media names
- library names
- hostnames
- search terms
- raw `ffprobe` outputs
- per-file metadata
- per-file values
- scan diagnostics or failure details
- authentication or user identity data
- broad browser `localStorage` contents

Network and hosting layers can still see transport metadata such as source IP addresses transiently. MediaLyze therefore describes this telemetry as privacy-preserving anonymous installation telemetry, not as a legal guarantee that every transport-layer data point is anonymous.
IP addresses are never stored, only the information contained in the payload is.

---

Always feel welcome to ask me any questions about this "feature" or recommend change!

You can always take a look at your contributed payloads and delete them at any time on the website 

## Modes

Telemetry has five stored modes:

- `none`: state after updated from pre-telemtry version or new install.
- `initialized`: the first-run telemetry choice has been shown, but no user decision exists yet.
- `off`: telemetry is disabled. No telemetry payloads are sent.
- `minimal`: send install/runtime/system fields only.
- `enabled`: send install/runtime/system fields plus coarse usage counts and selected app settings.

Users can actively choose only `off`, `minimal`, or `enabled`. `none` and `initialized` are undecided internal states and should keep the UI prompt visible until the user chooses a real mode.

Set `MEDIALYZE_TELEMETRY_DISABLED=true` to force telemetry off. In that state:

- `GET /api/app-settings` reports telemetry as `mode: "off"` and `environment_disabled: true`.
- Telemetry toggles are locked in the UI.
- Scheduled, delayed, and manual sends are blocked.
- Existing installation id and last user-visible payload data remain readable locally if already present.

## Endpoint And Configuration

The default production ingest endpoint is:

```text
https://www.medialyze.app/api/telemetry/ingest
```

Override it with:

```text
MEDIALYZE_TELEMETRY_ENDPOINT=https://example.test/api/telemetry/ingest
```

Other telemetry configuration:

- `MEDIALYZE_TELEMETRY_DISABLED=true`: force telemetry off.
- `telemetry_timeout_seconds`: backend setting, currently `2.0` seconds.

Regular app sends use `is_test: false` in both development and release builds. `is_test: true` is reserved for explicit development connectivity checks outside the normal app sender.

## Installation Id

Telemetry uses a random UUIDv4 `installation_id`.

For the regular telemetry flow, the id is generated when the user first switches telemetry to `minimal` or `enabled`. It is stored in the existing app settings JSON row:

```json
{
  "telemetry": {
    "mode": "minimal",
    "installation_id": "51b48549-d1f0-4553-8acd-a8064ba7f510",
    "last_sent_at": "2026-05-13T00:07:56.179328Z",
    "last_user_visible_payload": {}
  }
}
```

In Docker deployments this normally lives in `/config/medialyze.db`, so the id survives image updates as long as the `/config` volume is kept. Deleting the configuration database, starting with a fresh `/config` volume, or manually removing the telemetry settings creates a new installation id.

The full installation id is shown in the local Telemetry settings panel. Users can use it on the public statistics page to view and delete all telemetry data contributed by their installation:

```text
https://www.medialyze.app/stats
```

## Send Timing

When a user changes telemetry to `minimal` or `enabled`, MediaLyze schedules a selected-mode send for 60 seconds later. This delay gives the user time to correct an accidental choice.

If telemetry is switched to `off` before the 60-second delay expires, the pending send is canceled.

After a successful selected-mode send, regular telemetry is sent once per UTC day around midnight:

- Scheduler job id: `telemetry-daily-snapshot`
- Trigger: `00:00` UTC
- Jitter: up to 10 minutes
- Misfire grace time: 1 hour

The daily decision is calendar-day based in UTC. A snapshot sent at any time on a UTC day prevents another non-forced regular snapshot for that same UTC date.

Telemetry sends run in the maintenance executor. Network failures must not block scans, startup, settings updates, or API responses.

## Retry Behavior

Each telemetry send is best effort. If the POST fails, MediaLyze retries in the same background task after:

```text
1s, 2s, 5s, 10s
```

After the final retry fails, the payload is dropped and MediaLyze waits for the next scheduled, delayed, or explicit send opportunity.

Failures are logged at info level and are not surfaced as runtime errors to scanning workflows.

## Local API

### Preview

The local app exposes payload previews:

```text
GET /api/telemetry/preview?mode=none
GET /api/telemetry/preview?mode=minimal
GET /api/telemetry/preview?mode=enabled
```

Response:

```json
{
  "payload": {},
  "redacted": false,
  "mode": "enabled"
}
```

`payload` is the JSON object that would be sent for that mode. If an installation id exists, the preview includes the full id and `redacted` is `false`. If no id exists yet, the preview uses `00000000-0000-0000-0000-000000000000` and `redacted` is `true`.

### Settings Update

Telemetry mode is updated through app settings:

```http
PATCH /api/app-settings
Content-Type: application/json

{
  "telemetry": {
    "mode": "enabled"
  }
}
```

Accepted update modes:

```text
off
minimal
enabled
```

Changing to `minimal` or `enabled` schedules the delayed send. Changing to `off` cancels a pending delayed send.

### Manual Local Send

The local API also exposes:

```text
POST /api/telemetry/send-now
```

This forces one normal payload for the currently selected mode and returns updated app settings. It only works when telemetry is currently `minimal` or `enabled`; otherwise it returns `409`.

This endpoint is intended for local/admin workflows.

## Payload Contract

All telemetry payloads share these root fields:

- `schema_version`: for future updates
- `event_type`: for future updates (maybe an issue report feature)
- `telemetry_mode`: `minimal` or `enabled`
- `installation_id`: UUIDv4 id ONLY for later identification by the OWNING user
- `sent_at`: UTC ISO timestamp
- `is_test`: boolean
- `app`: app metadata
- `system`: OS metadata

`minimal` and `none` payloads do not include `usage`, `app_settings`, or `media_kind_counts`.

---

`enabled` payloads include:

- `usage`
- `usage.media_kind_counts`
- `app_settings`

### App Object

```json
{
  "name": "MediaLyze",
  "version": "0.11.0",
  "runtime_mode": "server",
  "deployment_channel": "docker"
}
```

Fields:

- `name`: configured app name.
- `version`: resolved backend app version. If version resolution fails, MediaLyze reports `0.0.0`.
- `runtime_mode`: `server` or `desktop`.
- `deployment_channel`: `docker`, `desktop`, or `server`.

### System Object

```json
{
  "os_family": "linux",
  "architecture": "arm64"
}
```

Fields are derived from Python platform data and normalized to lowercase. Examples include `linux`, `darwin`, `windows`, `x86_64`, `arm64`, and `aarch64`.

## Minimal Payload

`minimal` contains only install/runtime/system fields.

```json
{
  "schema_version": 1,
  "event_type": "installation_snapshot",
  "telemetry_mode": "minimal",
  "installation_id": "51b48549-d1f0-4553-8acd-a8064ba7f510",
  "sent_at": "2026-05-13T00:07:56.179328Z",
  "is_test": false,
  "app": {
    "name": "MediaLyze",
    "version": "0.11.0",
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

`enabled` includes coarse installation usage and selected app settings.

```json
{
  "schema_version": 1,
  "event_type": "installation_snapshot",
  "telemetry_mode": "enabled",
  "installation_id": "51b48549-d1f0-4553-8acd-a8064ba7f510",
  "sent_at": "2026-05-13T00:07:56.179328Z",
  "is_test": false,
  "app": {
    "name": "MediaLyze",
    "version": "0.11.0",
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
      "scheduled": 1,
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

## Enabled Usage Fields

Enabled usage counts cover the whole configured MediaLyze installation.

Usage fields:

- `library_count`: total configured library count.
- `library_type_counts`: count by library type: `movies`, `series`, `music`, `mixed`, `other`.
- `media_kind_counts`: rounded analyzed media count by coarse media kind.
- `analyzed_file_count_rounded`: rounded count of current analyzed files.
- `storage_size_gb_rounded`: rounded total size of current analyzed files in decimal GB.
- `scan_mode_counts`: count by library scan mode: `manual`, `scheduled`, `watch`.
- `duplicate_detection_mode_counts`: count by duplicate detection mode: `off`, `filename`, `filehash`, `both`.
- `enabled_feature_flags`: enabled app feature flag keys.

Current analyzed file scope is `MediaFile.scan_status == ready`.

## Media Kind Counts

`usage.media_kind_counts` is a string-keyed object so future kinds such as `audiobook`, `image`, `subtitle`, or `document` can be added without changing the payload shape.

Current classification is extension-based:

- `audio`: extension is in MediaLyze audio extensions.
- `video`: extension is in MediaLyze video extensions.
- `other`: extension is neither audio nor video.

Extensions are normalized to lowercase and counted from current analyzed files. Mixed libraries are counted by each file extension, not by library type.

## Enabled App Settings

- `interface_language`: `en` or `de`
- `color_theme`: `system`, `light`, or `dark`
- `scan_worker_count`: per-scan analysis workers
- `parallel_scan_jobs`: parallel library scan limit
- `comparison_scatter_point_limit`: scatter plot sample limit

Language and theme are explicit MediaLyze UI preferences. They are persisted into backend app settings so backend-sent telemetry can include them. No other localStorage values are sent.

## Rounding Rules

Analyzed file counts and media-kind counts use `round_count_for_telemetry(value)`.

Rules:

- Values `<= 0` become `0`.
- Values below `100` are unchanged.
- Values `>= 100` are rounded down to the first two significant digits.

Examples:

```text
7 -> 7
99 -> 99
127 -> 120
999 -> 990
23793 -> 23000
```

Storage uses `round_storage_gb_for_telemetry(bytes_value)`.

Rules:

- Values `<= 0` become `0`.
- Bytes are converted to decimal GB.
- Positive values below 1 GB become `1`.
- Larger GB values use the same first-two-digits rounding as counts.

Examples:

```text
534 MB -> 1 GB
24 GB -> 24 GB
496 GB -> 490 GB
12 TB -> 12000 GB
1PB -> 1000000 GB
```

I know about TiB and all of that...... let's keep that one simple and conservative.

## Last User-Visible Payload

After a successful regular `minimal` or `enabled` send, MediaLyze stores the sent payload in:

```text
telemetry.last_user_visible_payload
```

The Telemetry settings panel shows this as `Last sent`. If no user-visible telemetry payload exists yet, the panel shows an empty-state message. If telemetry is off or environment-disabled, it explains that no payload is available and no telemetry will be sent while telemetry is off or disabled.

The panel can also generate local `minimal` and `enabled` preview payloads. Leaving the Settings page resets the viewer back to `Last sent`.

## Public Statistics Page

The Telemetry settings panel links to:

```text
https://www.medialyze.app/stats
```

The page is intended to show public aggregate MediaLyze telemetry statistics. Users can also enter their randomized installation id to view data contributed by their installation and delete all telemetry data for that installation.

In Electron builds, the stats link should open externally in the system browser instead of navigating inside the app window.

## Ingest Service

The public telemetry backend accepts:

```text
POST /api/telemetry/ingest
Content-Type: application/json
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

Validation is hidden/closed-source for now to prevent spam.

#### Other details

- Rate-limit by `installation_id` and transient IP.
- Use IP only transiently for rate limiting, then discard or anonymize it before storage.
- Accept `is_test: true` payloads for development connectivity checks and exclude them from production aggregates.
- Store raw events for at most 30 days.
- Store aggregate daily counts separately.

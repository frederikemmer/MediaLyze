# Environment variables

[Documentation home](README.md)

MediaLyze reads application settings from environment variables through
`pydantic-settings`. Names are case-insensitive, but the uppercase names below
are the portable form to use in Docker Compose and `.env` files.

The Docker image already supplies the server defaults for `APP_PORT`,
`CONFIG_PATH`, and `MEDIA_ROOT`. Most deployments therefore only need the
mounts and timezone.

## Minimal Docker Compose configuration

This is a compact server configuration for a host that uses the default
internal paths and ports. Remove the GPU-related entries when the host does not
provide the corresponding device.

```yaml
services:
  medialyze:
    image: ghcr.io/frederikemmer/medialyze:latest
    container_name: medialyze
    hostname: medialyze
    restart: unless-stopped
    ports:
      - "8080:8080"
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "105"
      - "44"
    environment:
      TZ: Europe/Berlin
      MEDIALYZE_TRANSCODE_OUTPUT_ROOT: /transcode-output
      # Optional: keep only when the container uses these permissions/GPU paths.
      PUID: "1000"
      PGID: "1000"
      NVIDIA_DRIVER_CAPABILITIES: compute,video,utility
    volumes:
      - ./config:/config
      - /path/to/media:/media:ro
      - ./Transcode_Output:/transcode-output:rw
```

## Application and runtime settings

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `MediaLyze` | Display/API application name. |
| `MEDIALYZE_APP_VERSION` | build/package version | Version exposed by the API and UI. Packaged build metadata takes precedence when present. |
| `MEDIALYZE_RUNTIME` | `server` | Runtime mode: `server` or `desktop`. Server mode creates `/config` and `/media` when needed; desktop mode uses the platform user-data directory for config by default. |
| `APP_HOST` | `0.0.0.0` in server mode, `127.0.0.1` in desktop mode | HTTP bind address for the main API. |
| `APP_PORT` | `8080` | Internal HTTP port for the main API. The Docker image exposes this port. |
| `API_PREFIX` | `/api` | Prefix for API routes. Changing it also requires matching reverse-proxy/frontend configuration. |
| `CONFIG_PATH` | `/config` in server mode | Writable application data directory, including the SQLite database, persisted settings, and transcode workspaces. Protect this directory. |
| `MEDIA_ROOT` | `/media` | Server-side root under which library paths are allowed. Media should normally be mounted read-only. |
| `DATABASE_FILENAME` | `medialyze.db` | SQLite filename below `CONFIG_PATH`. Change only when intentionally using a different database file. |
| `FRONTEND_DIST_PATH` | bundled `frontend/dist` | Frontend bundle served by the backend, mainly for packaged/custom deployments. |
| `FFPROBE_PATH` | `ffprobe` | Path or executable name used for media analysis. |
| `FFMPEG_PATH` | `ffmpeg` | Path or executable name used for preview generation and transcoding. |
| `MEDIALYZE_TRANSCODE_OUTPUT_ROOT` | `CONFIG_PATH/Transcode_Output` | Writable in-runtime root for separate transcoded output. Set this when a dedicated `/transcode-output` mount is used. |
| `MEDIALYZE_HW_RENDER_NODE` | automatic probing | Optional Linux DRM render node, such as `/dev/dri/renderD128`, for VAAPI/QSV/other DRM-backed paths. Omit it to probe visible nodes. |
| `JELLYFIN_API_KEY_FILE` | unset | Optional file containing the API key for the migrated standard Jellyfin connection. Do not put the key itself in Compose or logs. |
| `SCAN_DISCOVERY_BATCH_SIZE` | `500` | Number of discovered files accumulated per scan discovery batch. Advanced tuning. |
| `SCAN_COMMIT_BATCH_SIZE` | `5` | Number of analyzed files committed per persistence batch. Advanced tuning. |
| `SQLITE_BUSY_TIMEOUT_SECONDS` | `30` | SQLite busy timeout used for transient writer contention. Increase only when the storage is slow or has expected short-lived contention. |
| `FFPROBE_WORKER_COUNT` | `4` | Maximum per-file ffprobe worker count. |
| `SCAN_RUNTIME_WORKER_COUNT` | `2` | Default scan runtime worker count before the persisted App Settings value is applied. |
| `DISABLE_DEFAULT_IGNORE_PATTERNS` | `false` | When `true`, do not seed the built-in ignore patterns on a new installation. |
| `TELEMETRY_TIMEOUT_SECONDS` | `2` | Timeout for the optional telemetry request. |
| `ALLOWED_MEDIA_EXTENSIONS` | built-in video extensions | Legacy/general settings allow-list. Current type-aware scans use the `VIDEO_EXTENSIONS` and `AUDIO_EXTENSIONS` constants via `get_allowed_media_extensions`; this variable does not override those per-type sets. See [discovery rules](patterns.md). |
| `MEDIALYZE_PERFORMANCE_METRICS` | `false` | Enables bounded, in-process API/SQL/cache/queue measurements and `/api/performance`. This is local diagnostic data, separate from opt-in telemetry. |
| `SUBTITLE_EXTENSIONS` | `.srt`, `.ass`, `.ssa`, `.sub`, `.idx` | Advanced JSON array override for recognized sidecar subtitle extensions. |
| `TZ` | image/host timezone | Process and scheduler timezone, for example `Europe/Berlin`. |

`CONFIG_PATH` contains production state. Do not point it at a temporary or
shared directory, and do not change it during an upgrade unless the database
and all persisted configuration have been deliberately migrated.

## Telemetry

| Variable | Default | Description |
| --- | --- | --- |
| `MEDIALYZE_TELEMETRY_DISABLED` | `false` | Force telemetry off and lock the corresponding UI control. |
| `MEDIALYZE_TELEMETRY_ENDPOINT` | `https://www.medialyze.app/api/telemetry/ingest` | HTTPS endpoint for the opt-in telemetry payload. Use a controlled endpoint only when the deployment requires it. |

## Docker Compose and entrypoint variables

These variables are used by the repository's Compose files or entrypoint and
are not all application settings:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST_PORT` | `8080` | Host port mapped to the main API's container port 8080. |
| `CONFIG_HOST_DIR` | `./config` | Host directory mounted at `/config`. |
| `MEDIA_HOST_DIR` | `./media` | Host directory mounted at `/media`; the provided Compose files mount it read-only. |
| `TRANSCODE_OUTPUT_HOST_DIR` | `./Transcode_Output` | Host directory mounted at `/transcode-output` for writable transcoded output. |
| `PUID` | unset | Optional numeric runtime user ID. Must be set together with `PGID`; the entrypoint changes ownership of `/config` and drops privileges. |
| `PGID` | unset | Optional numeric runtime group ID. Must be set together with `PUID`. |
| `NVIDIA_DRIVER_CAPABILITIES` | `compute,video,utility` in the provided Compose examples | Capabilities requested when an NVIDIA Docker runtime/GPU override is actually used. It does not install drivers or prove that an encoder works. |
| `APP_VERSION` | `dev` for local Compose builds | Docker build argument used for the image/build version. It is not the same as the runtime `MEDIALYZE_APP_VERSION` override. |

`PUID` and `PGID` are optional. Use them only when the mounted directories and
device access are prepared for that user/group. When `/dev/dri` is mounted,
the entrypoint preserves the supplementary device groups supplied by
`group_add` while dropping to the configured user.

Federation process settings are documented in the [internal unreleased-feature reference](internal/unreleased-transcoding.md#federation-settings). Federation and automation rules are currently hidden by the frontend release switches; that visibility does not disable retained backend APIs.

## Desktop-specific process variables

The Electron desktop launcher sets `MEDIALYZE_RUNTIME=desktop`, `APP_HOST`,
`APP_PORT`, `CONFIG_PATH`, `FRONTEND_DIST_PATH`, `FFMPEG_PATH`, and
`FFPROBE_PATH` for its local backend. These normally should not be set
manually. `MEDIALYZE_DESKTOP_PYTHON` selects the Python executable for an
unpackaged development launch; `PYTHON` is the fallback. `APPDATA` on Windows
and `XDG_CONFIG_HOME` on Linux are used when resolving the desktop config
directory if an explicit `CONFIG_PATH` is not supplied.

## Security and upgrade notes

- Never commit Jellyfin keys or a writable production `.env` file.
- Keep `/media` read-only unless a workflow explicitly requires writes.
- Keep `/config` and `/transcode-output` on persistent storage with sufficient
  free space.
- Before changing `CONFIG_PATH`, `DATABASE_FILENAME`, or output mounts, stop
  only the MediaLyze service and verify the old paths are backed up and
  recoverable.

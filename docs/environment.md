# Environment variables

MediaLyze reads application settings from environment variables through
`pydantic-settings`. Names are case-insensitive, but the uppercase names below
are the portable form to use in Docker Compose and `.env` files.

The Docker image already supplies the server defaults for `APP_PORT`,
`CONFIG_PATH`, and `MEDIA_ROOT`. Most deployments therefore only need the
mounts, timezone, and any federation address that is not discoverable from the
container.

## Minimal Docker Compose configuration

This is a compact server configuration for a host that uses the default
internal paths and ports. Remove the GPU-related entries when the host does not
provide the corresponding device.

```yaml
services:
  medialyze:
    image: ghcr.io/frederikemmer/medialyze:dev
    container_name: medialyze
    hostname: medialyze
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "8091:8091/tcp"
      - "43211:43211/udp"
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - "105"
      - "44"
    environment:
      TZ: Europe/Berlin
      MEDIALYZE_FEDERATION_ADVERTISE_URLS: http://192.0.2.10:8091
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

`192.0.2.10` is only an example address. Replace it with an address reachable
by the other MediaLyze installation, or omit `MEDIALYZE_FEDERATION_ADVERTISE_URLS`
when LAN discovery and the automatically detected addresses are sufficient.
The application defaults are intentionally not repeated in this example:
`CONFIG_PATH=/config`, `MEDIA_ROOT=/media`, federation enabled, federation
listener `0.0.0.0:8091`, and discovery port `43211` are already the defaults.

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
| `ALLOWED_MEDIA_EXTENSIONS` | built-in video extensions | Advanced JSON array override for accepted media extensions, for example `[".mkv", ".mp4"]`. |
| `SUBTITLE_EXTENSIONS` | `.srt`, `.ass`, `.ssa`, `.sub`, `.idx` | Advanced JSON array override for recognized sidecar subtitle extensions. |
| `TZ` | image/host timezone | Process and scheduler timezone, for example `Europe/Berlin`. |

`CONFIG_PATH` contains production state. Do not point it at a temporary or
shared directory, and do not change it during an upgrade unless the database
and all persisted configuration have been deliberately migrated.

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

## Desktop-specific process variables

The Electron desktop launcher sets `MEDIALYZE_RUNTIME=desktop`, `APP_HOST`,
`APP_PORT`, `CONFIG_PATH`, `FRONTEND_DIST_PATH`, `FFMPEG_PATH`, and
`FFPROBE_PATH` for its local backend. These normally should not be set
manually. `MEDIALYZE_DESKTOP_PYTHON` selects the Python executable for an
unpackaged development launch; `PYTHON` is the fallback. `APPDATA` on Windows
and `XDG_CONFIG_HOME` on Linux are used when resolving the desktop config
directory if an explicit `CONFIG_PATH` is not supplied.

## Security and upgrade notes

- Never commit `MEDIALYZE_FEDERATION_PASSCODE`, Jellyfin keys, or a writable
  production `.env` file.
- Keep `/media` read-only unless a workflow explicitly requires writes.
- Keep `/config` and `/transcode-output` on persistent storage with sufficient
  free space.
- Before changing `CONFIG_PATH`, `DATABASE_FILENAME`, or output mounts, stop
  only the MediaLyze service and verify the old paths are backed up and
  recoverable.

# Transcoding

[Documentation home](README.md)

MediaLyze can create a new video variant with FFmpeg from the `Transcoding` panel of a file detail page. The feature is intentionally limited to files with a regular video stream. The default is a separate `Transcode_Output` tree; writing beside the source is explicit, and replacing the original requires a server-side confirmation and creates no byte-for-byte backup.

## Transcoding plans

The file-detail panel starts with a copy plan that preserves the source streams and container where compatible. Users can edit the plan directly, select one of their saved presets, or choose `Custom`. MediaLyze no longer supplies bundled transcoding presets.

The normalized versioned plan stores the container; `copy`, `drop`, or `encode` for every stream (the legacy `keep` value remains accepted for old plans); target codec and quality fields; the resolved worker-specific encoder; resolution, frame rate, pixel format, profile, level, preset and GOP controls; dynamic-range handling; chapter, metadata, cover, and attachment behavior; selected sidecar subtitles; the filename template; and the effective execution/output policy. The file-detail UI asks only for the target codec. The selected worker resolves a compatible encoder and device at validation/queue time. Existing explicit encoder fields remain accepted for backwards-compatible API and saved-plan payloads. The API accepts no raw command or arbitrary FFmpeg argument field.

Filename tokens are `{sourceName}`, `{movieTitle}`, `{releaseYear}`, `{resolution}`, `{resolutionCategory}`, `{dynRange}`, `{codec}`, `{audioLanguages}`, `{audioCodecs}`, `{audioProfiles}`, `{audioChannels}`, `{frameRate}`, `{bitDepth}`, `{subtitleLanguages}`, `{subtitleFormats}`, `{seriesName}`, `{seasonNumber}`, `{episodeNumber}`, `{episodeTitle}`, `{contentCategory}`, `{container}`, and `{videoBitrate}`. Folder templates also support `{folderName}`. Connector-derived title/year values are available only when matched metadata exists; missing values render empty. The standard filename template is `{sourceName} [{resolution}, {dynRange}, {codec}] [{audioLanguages}]`. Filename and folder formatting have independent enable switches, cleanup presets/regexes, separators, and language-code formats; folder formatting is disabled by default. With `filename_template_override: false`, MediaLyze uses its standard template and can append subtitle languages when `include_subtitle_languages` is enabled. Set the override to `true` to use the supplied token template. Empty values and punctuation are collapsed, names are made safe for the active operating system, and the extension always follows the selected container.

## Validation and capabilities

`GET /api/transcoding/capabilities` reads the local FFmpeg version, muxers, encoders, decoder codecs, and each video encoder's locally reported option names. NVIDIA devices are enumerated with `nvidia-smi` when available; minimal Linux containers without that executable use the injected `libcuda.so.1` Driver API instead, while native Windows uses `nvcuda.dll`. The Linux Driver API path also works for Docker Desktop WSL2 where `/dev/dri/renderD*` is absent. Linux inventories every visible DRM render node and probes VAAPI/QSV against the individual node. Native Windows additionally enumerates the visible D3D11 adapters and creates separate AMF/QSV targets for the matching AMD/Intel adapters, so hybrid systems do not accidentally bind an integrated media engine to adapter 0. macOS exposes the native VideoToolbox target. CUDA/NVENC probes bind the selected CUDA device and execute a real one-frame encode. VAAPI/QSV probes initialize each candidate DRM render node, upload a 256×256 test frame (small enough to be cheap but above minimum NVENC frame-size limits), and pass the encoder's native quality option (ICQ/global quality for QSV, QP for H.264/HEVC VAAPI, and global quality for AV1/VP8/VP9/MPEG-2/MJPEG VAAPI). Hardware encoders are only marked available after a real one-frame test succeeds, and each encoder records the device IDs on which it passed. Automatic selection chooses a passing device at request time; selecting an unavailable encoder is a validation error, and hardware-required mode never silently falls back to CPU.

The Transcoding settings page can start a separate codec-matrix test. It creates short synthetic sources below `CONFIG_PATH/transcoding-tests`, forces a complete hardware decode-to-encode path for every exposed codec direction on every detected device, and checks an explicit software path when the complete hardware path fails. Results distinguish hardware, software-only, unavailable, and not-tested cases. Every passing hardware codec direction is also run with up to four simultaneous sessions; `4+` means all four passed and the actual device limit may be higher. Temporary media is removed after the run, the sanitized matrix is kept in `CONFIG_PATH/transcoding-tests/capability-matrix.json`, and the test never reads `MEDIA_ROOT` or creates normal library, scan, transcode-job, variant, or history records.

Validation resolves all files below their library root and returns the target, stream diff, warnings, normalized plan, detected capabilities, and complete readable command. It blocks existing targets, duplicate active targets, incompatible container/codec pairs, bitmap-to-text subtitle conversions, missing sidecars, invalid BCP 47 language tags, video upscaling or aspect-ratio changes, and unsupported dynamic-range choices. Dolby Vision is never synthesized: V1 only permits verified source passthrough in a supported container with video stream copy.

Video encode controls use constant-quality ranges and optional speed presets while the backend maps those values to the resolved encoder's supported FFmpeg options. The file-detail UI exposes the target codec, not the worker-specific encoder; only even-pixel 360p–2160p presets that are no larger than the source are offered. Audio encode controls use fixed, codec-appropriate bitrate presets. Stream language metadata can be changed for video, audio, and internal subtitles in both `copy` and `encode` mode. Copy mode remuxes the selected streams without re-encoding, preserving codec and quality while writing the chosen language tags; language selections are retained when switching between copy and encode. Stream languages are normalized to BCP 47 while retaining regional subtags and the original code in the localized label; `und` and unknown codes remain explicit.

## Saved presets

The Transcoding settings page stores reusable, versioned preset definitions in SQLite. A preset is an ordered set of stream rules for video, audio, internal subtitles, and optional external subtitle sidecars. Each rule can match codec, language, and default-track state and can copy, convert, or remove the matching stream. Internal streams that do not match a rule are copied; external sidecars are not embedded unless an external-subtitle rule explicitly selects them. Saved presets contain abstract stream criteria rather than file-specific stream indexes, subtitle IDs, or raw FFmpeg arguments. A saved preset is materialized against the current file into the same concrete `TranscodePlan` used by the file-detail workflow.

The preset catalog starts empty on new installations. Users can create, edit, duplicate, and delete their own presets. Preset versions and the selected preset version are recorded on every queued job. Jobs retain a complete preset snapshot, so later edits do not change the provenance of an existing run.

The canonical management endpoint is `/api/transcoding/presets`. The former `/api/transcoding/profiles` paths and profile-named storage/plan fields remain compatibility aliases for existing clients and data.

## CPU- and APU-integrated media engines

In this documentation, "CPU hardware acceleration" means the dedicated media
engine integrated into the CPU package or SoC. It is not the same as a CPU
software encoder such as `libx264` or `libx265`. MediaLyze discovers and probes
these engines automatically:

| Host and hardware | Integrated media engine | FFmpeg path used by MediaLyze |
| --- | --- | --- |
| Linux Intel CPU with enabled iGPU | Intel Quick Sync | `*_qsv`; `*_vaapi` is also probed on the same DRM render node as a compatible fallback |
| Linux AMD APU/iGPU | AMD VCN | `*_vaapi` through the `amdgpu` DRM render node |
| Native Windows Intel CPU with enabled iGPU | Intel Quick Sync | `*_qsv` through the installed Intel driver/API |
| Native Windows AMD APU/iGPU | AMD VCN | `*_amf` through the installed AMD driver/API |
| Native macOS Apple Silicon | Apple media engine | `*_videotoolbox` through macOS VideoToolbox |

The automatic path does not require a CPU/GPU vendor setting. On Linux every
visible `/dev/dri/renderD*` node is considered, so an integrated CPU/APU engine
and a discrete adapter can coexist. On native Windows, QSV and AMF are
adapter-specific native-API targets when FFmpeg can enumerate D3D11 adapters; older builds retain the logical automatic target. The one-frame probe decides whether each target is usable. The capability response
keeps only encoders that passed on the actual target. Codec support still
depends on the exact processor, enabled iGPU, driver, FFmpeg build, and input
format.

If no integrated media engine passes, `hardware_required` reports the concrete
failure and does not fall back to CPU software encoding. Software encoding is
available only after explicitly selecting `cpu_only`.

## Execution safety

Transcoding uses a dedicated runtime executor. Scan discovery and analysis keep their own workers, while transcode capacity is calculated from the CPU budget, CPU job limit, detected GPU devices, and GPU slots per device. A transcode job consumes a CPU or GPU resource reservation without occupying scan workers. FFmpeg requests background process priority where supported, but concurrent jobs can still compete with scans for CPU, RAM, disk bandwidth, and GPU resources. The default CPU budget is 90%. Retry count defaults to zero, and `continue` or `stop_queue` controls what happens after a failed job.

The output is first written as a hidden temporary file in the target directory. Before publication MediaLyze verifies that the source size and modification time still match the queued snapshot. Separate-output and same-directory publication refuse an existing target according to the configured `fail`/`skip` policy and use a no-replace same-filesystem operation; replacement uses an atomic `os.replace` only after explicit confirmation and emits a no-backup warning. Failure, cancellation, startup recovery, or source changes remove the temporary file when `remove_partial_output` is enabled.

After same-directory publication, an incremental scan with trigger `transcode` analyzes the output. The scan attaches the analyzed file to a persistent variant group containing immutable source and output path snapshots. Same-directory variants are flagged as non-primary and are excluded from library lists, dashboard/library statistics, duplicate groups, CSV exports, storage/telemetry aggregates, and later scan discovery; the detail view and transcode history still expose them. Separate `Transcode_Output` variants remain external to the source library and are represented in the job/variant history without being counted as primary files. Replacement keeps the source file as the primary record.

## API

- `GET /api/transcoding/capabilities`
- `GET /api/transcoding/capability-matrix`
- `POST /api/transcoding/capability-matrix/test`
- `GET /api/files/{file_id}/transcode`
- `POST /api/files/{file_id}/transcode/validate`
- `POST /api/files/{file_id}/transcode`
- `GET /api/transcode-jobs/active`
- `GET /api/transcode-jobs?library_id=&status=&started_after=&started_before=&limit=&offset=`
- `GET /api/transcode-jobs/{job_id}`
- `POST /api/transcode-jobs/{job_id}/cancel`

The file endpoint returns the original summary, FFprobe attachment breakdown, the default copy plan, jobs, and linked variants. The global history supports library, status, and time filters. Active and queued jobs are never pruned. The independent `transcode_history` retention bucket defaults to 90 days; `0` days or `0 GB` means unlimited. Pruning removes job records only, never output media or variant groups.

## Job center and comparison

The `/transcoding` page separates Active jobs from History, with library/status/time filters, compact progress and speed history, hardware details, cancellation, and deletion of terminal history entries. Deleting a terminal job retains media output and linked variants. The history API also supports `DELETE /api/transcode-jobs/{job_id}`.

File Detail exposes linked versions below Preview, including separate `Transcode_Output` files, with left/right version selection when several versions exist. `VideoWipeCompare` synchronizes playback, seeking, volume, and mute state and provides a keyboard-operable wipe slider. The `/files/{file_id}/preview?compare={variant_id}` route remains available; metadata comparison uses `/files/compare?left={id}&right={id}`. Preview warns about duration differences and browser playback failures. Playback is an experimental inspection aid and depends on browser codec support.

Federation and automatic rules are retained in the backend but hidden in the shipped frontend by `release-visibility.ts`. Their contract, enablement gates, and API are documented in [internal implementation notes](internal/unreleased-transcoding.md), rather than presented as available user workflows.

## Runtime paths

Docker installs the pinned Debian FFmpeg `5.1.9` package (`7:5.1.9-0+deb12u1`) in `python:3.12-slim-bookworm` and verifies the architecture-specific DEB SHA-256 before installation; this build includes the NVENC, QSV, and VAAPI encoder families and uses `FFMPEG_PATH=ffmpeg` by default. Desktop sidecars receive the pinned `ffmpeg-static` 5.3.0 binary from Electron packaging; the Windows bundle includes the native NVENC, AMF, and QSV encoder families, while macOS bundles VideoToolbox support. On macOS, the bundled FFmpeg exposes the VideoToolbox H.264/HEVC encoders and MediaLyze verifies them with a real one-frame smoke test before showing Apple VideoToolbox as available. The macOS ARM64 artifact reports FFmpeg 6.0; its manifest entry records that per-artifact version separately from the upstream `b6.1.1` release tag. `MEDIALYZE_FFMPEG_DIR` selects a packaging input; `FFMPEG_PATH` is the runtime override. Release packaging verifies the desktop binary and performs a one-frame encode on Windows, macOS, and Linux. The complete platform/source/checksum record is in [the FFmpeg manifest](ffmpeg-manifest.json). Docker image builds accept the manifest's explicit version and checksum build arguments; they never download a `latest` binary during container startup.

The global `transcoding` app setting controls `hardware_required` versus `cpu_only`, the 90% default CPU budget, CPU/GPU parallel slots, output policy, retry/error handling, and partial-output cleanup. All devices that pass the real capability probe remain candidates; a file-detail target codec is resolved to a compatible encoder and device automatically on the selected worker at transcode time. Explicit encoder fields from older presets, rules, or API clients remain validated for compatibility. The settings page shows the last real capability probe and the reason a device or encoder is unavailable.

## NVIDIA GPU on local Windows and Docker

The NVIDIA path requires a working host driver, an FFmpeg build with NVENC support, and a successful device-, codec-, and encoder-specific one-frame smoke test. The presence of `nvidia-smi`, a listed `*_nvenc` encoder, or a listed CUDA hardware accelerator alone is not sufficient. MediaLyze marks the device/encoder unavailable when the real probe fails and keeps hardware-required jobs from using CPU.

The production Compose file is CPU-safe by default and keeps `/media` read-only. Run `docker/start-medialyze.sh` on Linux/macOS or `docker/start-medialyze.ps1` on Windows to generate a temporary Compose override. The launcher adds `gpus: all` only when the host has both `nvidia-smi` and a reachable Docker daemon, and adds `/dev/dri` plus the numeric group IDs of its render/video devices when they exist. It never installs host drivers. `TRANSCODE_OUTPUT_HOST_DIR` controls the writable host directory mounted at `/transcode-output`.

## Intel and AMD media engines on Linux containers

The Debian runtime image includes FFmpeg's VAAPI/QSV encoder support, the Mesa
VAAPI driver, the full Intel media/i965 VAAPI drivers, and the Intel oneVPL GPU
runtime on amd64. Intel and AMD containers must still expose `/dev/dri` and have a
compatible host kernel driver; the NVIDIA path is enabled by the Compose
`NVIDIA_DRIVER_CAPABILITIES` setting when the generated GPU override is active.
MediaLyze discovers every `/dev/dri/renderD*` node on Linux by default and
selects the first node that passes the requested encoder probe. Vendor metadata
from the DRM node also keeps an Intel CPU/iGPU or AMD APU/iGPU target visible
when the local FFmpeg build exposes only a subset of the expected backend
families; an encoder is still marked usable only after its exact runtime probe
passes. This covers Intel CPU/iGPU Quick Sync and AMD APU/iGPU VCN as well as
discrete adapters; there is no separate container setting for an integrated
media engine. Set
`MEDIALYZE_HW_RENDER_NODE` only as an optional override when a host needs a
specific node. The exact node that passed is used for both capability testing
and the actual job, so an encoder is shown in the UI only when that driver and
device really work.

The provided launcher exposes the DRM devices and forwards their numeric host
groups automatically, including when `PUID/PGID` runs the application as
non-root. A manual Compose deployment (without the launcher) must provide the
same device and group access explicitly:

```yaml
devices:
  - /dev/dri:/dev/dri
group_add:
  - "44"   # video (example)
  - "105"  # render (example)
environment:
  # Optional override only; automatic probing covers all visible nodes.
  MEDIALYZE_HW_RENDER_NODE: /dev/dri/renderD128
```

VAAPI jobs initialize the render node and upload frames with `format=nv12` (or
`p010le` for 10-bit input). QSV-only jobs initialize a named QSV device with
the selected DRM node as its `child_device`; plans that mix QSV and VAAPI derive
the QSV device from the same named VAAPI device. No host driver installation or
media-file modification is performed by MediaLyze.

## AMD and Intel on Windows and hybrid systems

On native Windows, FFmpeg's AMF and QSV encoders use the installed driver/API.
MediaLyze first enumerates the native D3D11 adapter ordinals and creates one
target per matching AMD/Intel adapter, retaining that ordinal for capability
probes, matrix tests, and later jobs. This prevents adapter-order fallbacks on
hybrid systems such as an NVIDIA GPU plus an AMD CPU/iGPU. Older FFmpeg builds
that cannot enumerate D3D11 adapters keep the legacy automatic target and are
still gated by the real encoder probe. This is the automatic path for Intel
CPU/iGPU Quick Sync, AMD APU/iGPU VCN, and discrete AMD or Intel adapters; the
device is not shown as available when the local driver or packaged FFmpeg
build cannot complete the smoke test. This section describes the selection
logic, not a claim that every Windows driver/encoder combination is supported;
the local probe remains authoritative.

On Linux, integrated and discrete adapters are represented by their separate
`/dev/dri/renderD*` nodes. The first passing node is selected automatically;
when a host exposes multiple adapters, the capability response retains the
node-specific mapping so a failed integrated path cannot cause a job to run on
an untested discrete path (or vice versa). Exact adapter names are best-effort
sysfs metadata; the runtime probe is authoritative.

## Apple GPU on macOS

The desktop version supports Apple Silicon and Intel Mac graphics through
macOS VideoToolbox. It uses the bundled `h264_videotoolbox` and
`hevc_videotoolbox` encoders, and only enables the device after a real runtime
probe succeeds. A user-created preset that targets HEVC can use HEVC VideoToolbox
when hardware-required mode is active and the encoder passes its runtime probe.

Docker Desktop for macOS runs the Linux image inside a virtual machine and
does not expose the Mac's Apple GPU or macOS VideoToolbox framework to that
Linux container. Consequently, the same Apple hardware acceleration cannot be
enabled inside the container; the container correctly reports no Apple GPU and
keeps Apple hardware encoders unavailable. CPU encoding requires the explicit
`cpu_only` execution mode. Docker hardware acceleration remains available on
supported Linux hosts (NVIDIA CUDA or Intel VAAPI/QSV) when the host runtime
and device mounts are configured.

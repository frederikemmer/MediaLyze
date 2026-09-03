# Transcoding

MediaLyze can create a new video variant with FFmpeg from the `Transcoding` panel of a file detail page. The feature is intentionally limited to files with a regular video stream. The default is a separate `Transcode_Output` tree; writing beside the source is explicit, and replacing the original requires a server-side confirmation and creates no byte-for-byte backup.

## Profiles and plans

The initial profiles are editable starting points:

- **Original / copy:** uses the source container when it can carry the existing streams and copies every internal stream unchanged. This is the default and keeps the source codec, quality, language, HDR signaling, and stream metadata intact.
- **Save storage:** MKV/HEVC, CRF or CQ 22, preserved resolution, frame rate, and dynamic range, with non-video streams copied where compatible.
- **Modern:** MKV/AV1, CRF or CQ 30, with non-video streams copied where compatible.

The normalized versioned plan stores the container; `copy`, `drop`, or `encode` for every stream (the legacy `keep` value remains accepted for old plans); encoder and quality fields; resolution, frame rate, pixel format, profile, level, preset and GOP controls; dynamic-range handling; chapter, metadata, cover, and attachment behavior; selected sidecar subtitles; the filename template; and the effective execution/output policy. The normal UI exposes only the three safe stream actions. The API accepts no raw command or arbitrary FFmpeg argument field.

Filename tokens are `{resolution}`, `{dynRange}`, `{codec}`, `{audioLanguages}`, `{subtitleLanguages}`, `{container}`, and `{videoBitrate}`. With `filename_template_override: false`, MediaLyze uses its standard template and can append subtitle languages when `include_subtitle_languages` is enabled. Set the override to `true` to use the supplied token template. Empty values and punctuation are collapsed, names are made safe for the active operating system, and the extension always follows the selected container.

## Validation and capabilities

`GET /api/transcoding/capabilities` reads the local FFmpeg version, muxers, encoders, decoder codecs, and each video encoder's locally reported option names. NVIDIA devices are enumerated with `nvidia-smi` when available; minimal Linux containers without that executable use the injected `libcuda.so.1` Driver API instead, which also works for Docker Desktop WSL2 where `/dev/dri/renderD*` is absent. CUDA/NVENC probes bind the selected CUDA device and execute a real one-frame encode. Intel QSV and VAAPI probes initialize the selected DRM render node, upload a 256×256 test frame (small enough to be cheap but above minimum NVENC frame-size limits), and pass the encoder's native quality option (ICQ/global quality for QSV, QP for H.264/HEVC VAAPI, and global quality for AV1/VP8/VP9/MPEG-2/MJPEG VAAPI). Hardware encoders are only marked available after a real one-frame test succeeds. Selecting an unavailable encoder is a validation error; hardware-required mode never silently falls back to CPU.

Validation resolves all files below their library root and returns the target, stream diff, warnings, normalized plan, detected capabilities, and complete readable command. It blocks existing targets, duplicate active targets, incompatible container/codec pairs, bitmap-to-text subtitle conversions, missing sidecars, invalid BCP 47 language tags, video upscaling or aspect-ratio changes, and unsupported dynamic-range choices. Dolby Vision is never synthesized: V1 only permits verified source passthrough in a supported container with video stream copy.

Video encode controls use encoder-specific constant-quality ranges (CRF, CQ, QP, or ICQ as required by the selected backend), an encoder-specific speed preset, and only even-pixel 360p–2160p presets that are no larger than the source. Speed presets map to FFmpeg's `preset` option and are shown only for encoders whose capability probe reports that option; the UI keeps the values curated per encoder family (including Intel QSV, NVENC, AMF, x264/x265, and SVT-AV1). Audio encode controls use fixed, codec-appropriate bitrate presets. Stream languages are normalized to BCP 47 while retaining regional subtags and the original code in the localized label; `und` and unknown codes remain explicit.

## Execution safety

Transcoding uses a dedicated runtime executor. Scan discovery and analysis keep their own workers, while transcode capacity is calculated from the CPU budget, CPU job limit, selected GPU devices, and GPU slots per device. A transcode job consumes one CPU or one selected-GPU slot; it cannot starve scan workers. The default CPU budget is 90%. Retry count defaults to zero, and `continue` or `stop_queue` controls what happens after a failed job.

The output is first written as a hidden temporary file in the target directory. Before publication MediaLyze verifies that the source size and modification time still match the queued snapshot. Separate-output and same-directory publication refuse an existing target according to the configured `fail`/`skip` policy and use a no-replace same-filesystem operation; replacement uses an atomic `os.replace` only after explicit confirmation and emits a no-backup warning. Failure, cancellation, startup recovery, or source changes remove the temporary file when `remove_partial_output` is enabled.

After same-directory publication, an incremental scan with trigger `transcode` analyzes the output. The scan attaches the analyzed file to a persistent variant group containing immutable source and output path snapshots. Same-directory variants are flagged as non-primary and are excluded from library lists, dashboard/library statistics, duplicate groups, CSV exports, storage/telemetry aggregates, and later scan discovery; the detail view and transcode history still expose them. Separate `Transcode_Output` variants remain external to the source library and are represented in the job/variant history without being counted as primary files. Replacement keeps the source file as the primary record.

## API

- `GET /api/transcoding/capabilities`
- `GET /api/files/{file_id}/transcode`
- `POST /api/files/{file_id}/transcode/validate`
- `POST /api/files/{file_id}/transcode`
- `GET /api/transcode-jobs/active`
- `GET /api/transcode-jobs?library_id=&status=&started_after=&started_before=&limit=&offset=`
- `GET /api/transcode-jobs/{job_id}`
- `POST /api/transcode-jobs/{job_id}/cancel`

The file endpoint returns the original summary, FFprobe attachment breakdown, curated plans, jobs, and linked variants. The global history supports library, status, and time filters. Active and queued jobs are never pruned. The independent `transcode_history` retention bucket defaults to 90 days; `0` days or `0 GB` means unlimited. Pruning removes job records only, never output media or variant groups.

## Comparison

The Transcoding panel exposes a single synchronized-preview link for the newest analyzed variant. The `/files/{file_id}/preview?compare={variant_id}` route loads both files and keeps their playback, seeking, volume and mute state synchronized through the shared `VideoWipeCompare` control. The ordinary file detail and metadata comparison routes remain available separately; the preview comparison exposes an accessible keyboard-operable wipe slider, warns when durations differ, and reports browser playback failures.

## Runtime paths

Docker installs the pinned Debian FFmpeg `5.1.9` package (`7:5.1.9-0+deb12u1`) in `python:3.12-slim-bookworm` and verifies the architecture-specific DEB SHA-256 before installation; this build includes the NVENC, QSV, and VAAPI encoder families and uses `FFMPEG_PATH=ffmpeg` by default. Desktop sidecars receive the pinned `ffmpeg-static` 5.3.0 / FFmpeg 6.1.1 binary from Electron packaging. `MEDIALYZE_FFMPEG_DIR` selects a packaging input; `FFMPEG_PATH` is the runtime override. Release packaging verifies the desktop binary and performs a one-frame encode on Windows, macOS, and Linux. The complete platform/source/checksum record is in [the FFmpeg manifest](ffmpeg-manifest.json). Docker image builds accept the manifest's explicit version and checksum build arguments; they never download a `latest` binary during container startup.

The global `transcoding` app setting controls `hardware_required` versus `cpu_only`, the 90% default CPU budget, CPU/GPU parallel slots, selected devices, output policy, retry/error handling, and partial-output cleanup. The settings page also shows the last real capability probe and the reason a device or encoder is unavailable.

## NVIDIA GPU on local Windows and Docker

The NVIDIA path requires a working host driver, an FFmpeg build with NVENC support, and a successful device-, codec-, and encoder-specific one-frame smoke test. The presence of `nvidia-smi`, a listed `*_nvenc` encoder, or a listed CUDA hardware accelerator alone is not sufficient. MediaLyze marks the device/encoder unavailable when the real probe fails and keeps hardware-required jobs from using CPU.

The production Compose file is CPU-safe by default and keeps `/media` read-only. Run `docker/start-medialyze.sh` on Linux/macOS or `docker/start-medialyze.ps1` on Windows to generate a temporary Compose override. The launcher adds `gpus: all` only when the host has both `nvidia-smi` and a reachable Docker daemon, and adds `/dev/dri` only when it exists. It never installs host drivers. `TRANSCODE_OUTPUT_HOST_DIR` controls the writable host directory mounted at `/transcode-output`.

## Intel GPU on Linux containers

The Debian runtime image includes FFmpeg's VAAPI/QSV encoder support. Intel
containers must expose `/dev/dri` and provide a compatible host VAAPI/oneVPL
driver; the NVIDIA path is enabled by the Compose `NVIDIA_DRIVER_CAPABILITIES`
setting when the generated GPU override is active.
MediaLyze discovers the first `/dev/dri/renderD*` node on Linux by default; set
`MEDIALYZE_HW_RENDER_NODE` when a host exposes more than one GPU. The selected
node is used for both the capability smoke test and actual jobs, so an encoder
is shown in the UI only when the driver and device really work.

The container must expose the DRM devices and the host's `video` and `render`
groups. A minimal Compose service looks like this (use the numeric `render` GID
reported by the host):

```yaml
devices:
  - /dev/dri:/dev/dri
group_add:
  - "44"   # video (example)
  - "105"  # render (example)
environment:
  LIBVA_DRIVER_NAME: iHD
  MEDIALYZE_HW_RENDER_NODE: /dev/dri/renderD128
```

VAAPI jobs initialize the render node and upload frames with `format=nv12` (or
`p010le` for 10-bit input). QSV-only jobs initialize a named QSV device with
the selected DRM node as its `child_device`; plans that mix QSV and VAAPI derive
the QSV device from the same named VAAPI device. No host driver installation or
media-file modification is performed by MediaLyze.

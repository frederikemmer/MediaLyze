# Transcoding hardware matrix

This document records reproducible runtime evidence. A device is listed as usable only after the exact FFmpeg build, driver, device, codec, and encoder combination passes a one-frame smoke test. Do not infer support from `nvidia-smi`, `-hwaccels`, or an encoder listing alone.

## Test template

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<host>` | `<device>` | `<driver>` | `<version>` | `<decoder>` | `<encoder>` | `<format/filter>` | `pass` / `fail` | `<command and short error>` |

## Local Windows evidence

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local Windows host | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | 9.0.1-full_build-www.gyan.dev | CUDA/NVDEC path | `h264_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | The updated driver satisfies the FFmpeg NVENC API requirement. |
| Local Windows host | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | 9.0.1-full_build-www.gyan.dev | CUDA/NVDEC path | `hevc_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | The updated driver satisfies the FFmpeg NVENC API requirement. |
| Local Windows host | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | 9.0.1-full_build-www.gyan.dev | CUDA/NVDEC path | `av1_nvenc` | 256×256 one-frame CUDA smoke test | **fail (expected)** | FFmpeg reports that the device does not support the required NVENC features; this GPU generation has no AV1 NVENC encoder. |
| Local Windows host | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | 6.1.1-essentials_build-www.gyan.dev (pinned desktop bundle) | CUDA/NVDEC path | `h264_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | Exact bundled executable matches the Windows SHA-256 in [the FFmpeg manifest](ffmpeg-manifest.json). |
| Local Windows host | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | 6.1.1-essentials_build-www.gyan.dev (pinned desktop bundle) | CUDA/NVDEC path | `hevc_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | Exact bundled executable matches the Windows SHA-256 in [the FFmpeg manifest](ffmpeg-manifest.json). |
| Local Windows host | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | 6.1.1-essentials_build-www.gyan.dev (pinned desktop bundle) | CUDA/NVDEC path | `av1_nvenc` | 256×256 one-frame CUDA smoke test | **fail (expected)** | FFmpeg reports `No capable devices found`; this GPU generation has no AV1 NVENC encoder. |

With driver 616.56, both the current PATH FFmpeg 9.0.1 combination and the pinned desktop FFmpeg 6.1.1 combination successfully encode H.264 and HEVC on the RTX 3080. AV1 remains unavailable as expected for this GPU generation. MediaLyze keeps unsupported encoder combinations unavailable instead of silently falling back.

## Local macOS desktop evidence — MacBook Pro M1 Max, 64 GB

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local MacBook Pro M1 Max (`Darwin`, Apple Silicon `arm64`, 64 GB) | Apple GPU through VideoToolbox | macOS 26.3.1 (`Darwin 25.3.0`) | bundled `ffmpeg-static` 5.3.0 binary, observed `FFmpeg 6.0` | system-memory input; hardware decode not claimed | `h264_videotoolbox` | 256×256 test pattern, no Linux hardware-upload filter | **pass** | Bundled FFmpeg produced a non-empty MP4 (`10206` bytes); exit code 0. SHA-256: `a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584`. |
| Local MacBook Pro M1 Max (`Darwin`, Apple Silicon `arm64`, 64 GB) | Apple GPU through VideoToolbox | macOS 26.3.1 (`Darwin 25.3.0`) | bundled `ffmpeg-static` 5.3.0 binary, observed `FFmpeg 6.0` | system-memory input; hardware decode not claimed | `hevc_videotoolbox` | 256×256 test pattern, no Linux hardware-upload filter | **pass** | Bundled FFmpeg produced a non-empty MP4 (`10709` bytes); exit code 0. SHA-256: `a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584`. |

The ARM64 desktop sidecar was built successfully with `npm run build:backend` using PyInstaller 6.22.2. The complete unpacked Electron package also built successfully with Electron Builder 26.15.3 for Electron 41.10.3 (`darwin/arm64`); its app binary reported version `0.18.0`. The generated Mach-O `arm64` FFmpeg and FFprobe binaries ran successfully from both the sidecar output and the final `.app` resources. MediaLyze's capability endpoint was then run against this exact bundled FFmpeg executable. It reported `videotoolbox0` (`vendor=apple`, `backend=videotoolbox`, status `available`) and marked both H.264 and HEVC VideoToolbox encoders available after their one-frame probes. The `Save storage` profile selected `hevc_videotoolbox` in hardware-required mode. The manifest currently labels this SHA-256 as FFmpeg `6.1.1`, while the executable itself reports `6.0`; the observed executable version is recorded above and should be reconciled with the manifest separately.

## Docker Desktop on this MacBook

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker Desktop on macOS (`linux/arm64` VM) | Apple GPU | not exposed to Linux VM | Debian package `5.1.9-0+deb12u1` in freshly built `medialyze-validation:macos-m1-max-20260903` | no VideoToolbox framework | `h264_videotoolbox` / `hevc_videotoolbox` | encoder family absent; no `/dev/dri` | **not available (platform limitation)** | Container `ffmpeg -encoders` listed no VideoToolbox encoder. The running MediaLyze image reported `devices=[]` and no VideoToolbox encoders. |
| Docker Desktop on macOS (`linux/arm64` VM) | Apple GPU | not exposed to Linux VM | Debian package `5.1.9-0+deb12u1` in freshly built `medialyze-validation:macos-m1-max-20260903` | software input | `libx264` | CPU encode, 256×256 test pattern | **pass** | Container CPU encode exited 0; `/api/health` returned `status=ok`; `ffmpeg_available=true` in `/api/transcoding/capabilities`. |
| Docker Desktop on macOS (`linux/arm64` VM) | no NVIDIA GPU passthrough | no `libcuda.so.1` / no `nvidia-smi` | Debian package `5.1.9-0+deb12u1` in freshly built `medialyze-validation:macos-m1-max-20260903` | CUDA device init | `h264_nvenc`, `hevc_nvenc` | CUDA init without device | **not available** | MediaLyze marked both encoders unavailable with `Cannot load libcuda.so.1`; the container had `nvidia_smi=absent`. |
| Docker Desktop on macOS (`linux/arm64` VM) | no Linux DRM GPU passthrough | no `/dev/dri/renderD*` | Debian package `5.1.9-0+deb12u1` in freshly built `medialyze-validation:macos-m1-max-20260903` | VAAPI device init | `h264_vaapi`, `hevc_vaapi`, `mjpeg_vaapi`, `mpeg2_vaapi`, `vp8_vaapi`, `vp9_vaapi` | no DRM render node | **not available** | MediaLyze marked the listed VAAPI encoders unavailable with `No DRM render node is available`; the running container reported `dri=absent`. |

The image build completed successfully for `linux/arm64` on Docker Desktop 29.7.2. The image starts and performs CPU transcoding correctly, but Docker Desktop's Linux VM has no access to the macOS VideoToolbox framework or the Apple GPU. The macOS desktop sidecar is therefore the supported path for Apple hardware encoding; Docker hardware acceleration remains available on supported Linux hosts with NVIDIA CUDA or Intel VAAPI/QSV device passthrough.

## Docker Desktop WSL2 evidence

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker Desktop WSL2 (`linux/amd64`) | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | Debian package `5.1.9-0+deb12u1` in the locally built `medialyze-validation:20260903` image | CUDA device init / `hwupload_cuda` | `h264_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | `docker run --gpus all -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility ...`; exit code 0 and `libnvidia-encode.so.1` visible in the container. |
| Docker Desktop WSL2 (`linux/amd64`) | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | Debian package `5.1.9-0+deb12u1` in the locally built `medialyze-validation:20260903` image | CUDA device init / `hwupload_cuda` | `hevc_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | `docker run --gpus all -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility ...`; exit code 0 and `libnvidia-encode.so.1` visible in the container. |

The Docker image build also verifies the architecture-specific FFmpeg DEB checksum before installation. The production image starts successfully without a GPU, reports healthy API/settings responses, and exposes zero GPU devices in that CPU-only run; GPU transcoding is enabled when the generated Compose override supplies the NVIDIA runtime and video capability.

## Private Linux NAS Docker evidence — Intel Arc

The following rows were recorded after the automatic update to MediaLyze
`0.18.0-dev023`. The capability endpoint ran the exact device-, codec-, and
encoder-specific one-frame probes inside the amd64 container; no media file or
transcode job was used. Hardware decoding is not claimed by these encode-only
probes.

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | QSV device init; hardware decode not claimed | `h264_qsv` | `format=nv12,hwupload=extra_hw_frames=16` | **pass** | `/api/transcoding/capabilities?refresh=true`; device `qsv-renderD128` reported `available`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | VAAPI device init; hardware decode not claimed | `h264_vaapi` | `format=nv12,hwupload` | **pass** | `/api/transcoding/capabilities?refresh=true`; device `vaapi-renderD128` reported `available`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | VAAPI device init; hardware decode not claimed | `hevc_vaapi` | `format=nv12,hwupload` | **pass** | `/api/transcoding/capabilities?refresh=true`; device `vaapi-renderD128` reported `available`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | QSV device init; hardware decode not claimed | `mjpeg_qsv` | `format=nv12,hwupload=extra_hw_frames=16` | **pass** | `/api/transcoding/capabilities?refresh=true`; device `qsv-renderD128` reported `available`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | VAAPI device init; hardware decode not claimed | `mjpeg_vaapi` | `format=nv12,hwupload` | **pass** | `/api/transcoding/capabilities?refresh=true`; device `vaapi-renderD128` reported `available`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | VAAPI device init; hardware decode not claimed | `vp9_vaapi` | `format=nv12,hwupload` | **pass** | `/api/transcoding/capabilities?refresh=true`; device `vaapi-renderD128` reported `available`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | QSV device init; hardware decode not claimed | `hevc_qsv` | `format=nv12,hwupload=extra_hw_frames=16` | **fail** | The Arc runtime rejected the selected QSV rate-control/low-power parameters; MediaLyze therefore does not advertise this encoder. HEVC uses the verified `hevc_vaapi` path. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | QSV device init; hardware decode not claimed | `vp9_qsv` | `format=nv12,hwupload=extra_hw_frames=16` | **fail** | FFmpeg reported `Error initializing the encoder: device failed (-17)`. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | QSV device init; hardware decode not claimed | `mpeg2_qsv` | `format=nv12,hwupload=extra_hw_frames=16` | **fail** | The Arc runtime rejected the selected profile/rate-control parameters. |
| Private Linux NAS Docker (`linux/amd64`) | Intel Arc GPU, PCI `8086:56A6`, `/dev/dri/renderD128` | `i915` | Debian `5.1.9-0+deb12u1` in MediaLyze `0.18.0-dev023` | VAAPI device init; hardware decode not claimed | `mpeg2_vaapi` / `vp8_vaapi` | `format=nv12,hwupload` | **fail** | FFmpeg reported no usable encoding entrypoint/profile for these codecs. |

For this concrete Arc installation, automatic selection can therefore use
H.264 QSV, H.264/HEVC VAAPI, MJPEG QSV/VAAPI, and VP9 VAAPI. The failed
encoder/backend combinations remain visible as unavailable and never trigger
a silent CPU fallback.

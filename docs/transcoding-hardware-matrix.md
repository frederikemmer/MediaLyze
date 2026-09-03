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

## Docker Desktop WSL2 evidence

| Host | Device | Driver | FFmpeg | Decoder path | Encoder | Pixel format/filter | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Docker Desktop WSL2 (`linux/amd64`) | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | Debian package `5.1.9-0+deb12u1` in the locally built `medialyze-validation:20260903` image | CUDA device init / `hwupload_cuda` | `h264_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | `docker run --gpus all -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility ...`; exit code 0 and `libnvidia-encode.so.1` visible in the container. |
| Docker Desktop WSL2 (`linux/amd64`) | NVIDIA GeForce RTX 3080, compute capability 8.6, 10240 MiB | 616.56 | Debian package `5.1.9-0+deb12u1` in the locally built `medialyze-validation:20260903` image | CUDA device init / `hwupload_cuda` | `hevc_nvenc` | 256×256 one-frame CUDA smoke test | **pass** | `docker run --gpus all -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility ...`; exit code 0 and `libnvidia-encode.so.1` visible in the container. |

The Docker image build also verifies the architecture-specific FFmpeg DEB checksum before installation. The production image starts successfully without a GPU, reports healthy API/settings responses, and exposes zero GPU devices in that CPU-only run; GPU transcoding is enabled when the generated Compose override supplies the NVIDIA runtime and video capability.

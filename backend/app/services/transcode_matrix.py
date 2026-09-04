from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import tempfile
from threading import Lock

from backend.app.core.config import Settings
from backend.app.schemas.transcoding import (
    TranscodeCapabilitiesRead,
    TranscodeCapabilityMatrixRead,
    TranscodeDeviceMatrixRead,
    TranscodeEncoderCapability,
    TranscodeHardwareDevice,
    TranscodeMatrixCellRead,
)
from backend.app.services.transcoding import (
    _encoder_quality_spec,
    _hardware_backend,
    _hardware_device_arguments,
    _quality_option,
    get_transcode_capabilities,
)
from backend.app.utils.time import utc_now


MATRIX_LOCK = Lock()
MATRIX_DIRECTORY = "transcoding-tests"
MATRIX_RESULT_FILE = "capability-matrix.json"
VIDEO_CODEC_ORDER = ("h264", "hevc", "av1", "vp9", "vp8", "mpeg2video", "mjpeg")
SOFTWARE_ENCODERS = {
    "h264": ("libx264",),
    "hevc": ("libx265",),
    "av1": ("libsvtav1", "libaom-av1"),
    "vp9": ("libvpx-vp9",),
    "vp8": ("libvpx",),
    "mpeg2video": ("mpeg2video",),
    "mjpeg": ("mjpeg",),
}
MAX_PARALLEL_PROBE_JOBS = 4


class TranscodeMatrixBusyError(RuntimeError):
    pass


def _matrix_root(settings: Settings) -> Path:
    root = (Path(settings.config_path) / MATRIX_DIRECTORY).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _result_path(settings: Settings) -> Path:
    return _matrix_root(settings) / MATRIX_RESULT_FILE


def load_transcode_matrix(settings: Settings) -> TranscodeCapabilityMatrixRead:
    try:
        payload = json.loads(_result_path(settings).read_text(encoding="utf-8"))
        return TranscodeCapabilityMatrixRead.model_validate(payload)
    except FileNotFoundError:
        return TranscodeCapabilityMatrixRead()
    except (OSError, ValueError, TypeError) as exc:
        return TranscodeCapabilityMatrixRead(status="failed", error=f"Stored matrix could not be read: {exc}")


def _store_transcode_matrix(settings: Settings, result: TranscodeCapabilityMatrixRead) -> None:
    target = _result_path(settings)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(target)


def _run_command(arguments: list[str], *, timeout: int = 25) -> tuple[bool, str | None]:
    try:
        completed = subprocess.run(
            arguments,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    output = (completed.stderr or completed.stdout or "").strip()
    if len(output) > 800:
        output = output[-800:]
    return completed.returncode == 0, output or None


def _fixture_options(encoder: str) -> list[str]:
    if encoder in {"libx264", "libx265"}:
        return ["-preset", "ultrafast"]
    if encoder == "libsvtav1":
        return ["-preset", "12"]
    if encoder == "libaom-av1":
        return ["-cpu-used", "8"]
    if encoder.startswith("libvpx"):
        return ["-deadline", "realtime", "-cpu-used", "8"]
    return []


def _create_fixture(ffmpeg_path: str, codec: str, directory: Path) -> tuple[Path | None, str | None]:
    errors: list[str] = []
    for encoder in SOFTWARE_ENCODERS[codec]:
        target = directory / f"source-{codec}.mkv"
        command = [
            ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=256x256:rate=30:duration=1",
            "-an",
            "-c:v",
            encoder,
            *_fixture_options(encoder),
            "-pix_fmt",
            "yuv420p",
            "-frames:v",
            "30",
            str(target),
        ]
        succeeded, error = _run_command(command, timeout=40)
        if succeeded and target.is_file():
            return target, encoder
        if error:
            errors.append(error)
    return None, errors[-1] if errors else "No software fixture encoder is available"


def _software_encoder(capabilities: TranscodeCapabilitiesRead, codec: str) -> str | None:
    preferred = SOFTWARE_ENCODERS[codec]
    available = {
        encoder.name
        for encoder in capabilities.encoders
        if encoder.available and not encoder.hardware
    }
    return next((name for name in preferred if name in available), None)


def _device_hardware_encoder(
    capabilities: TranscodeCapabilitiesRead,
    device: TranscodeHardwareDevice,
    codec: str,
) -> TranscodeEncoderCapability | None:
    candidates = [
        encoder
        for encoder in capabilities.encoders
        if encoder.hardware and encoder.available and encoder.codec == codec
    ]
    for encoder in candidates:
        if device.id in encoder.device_ids or encoder.name in device.encoder_names:
            return encoder
    return None


def _hardware_pair_command(
    ffmpeg_path: str,
    fixture: Path,
    device: TranscodeHardwareDevice,
    encoder: str,
    *,
    frames: int = 30,
    stream_loops: int = 0,
) -> list[str] | None:
    backend = _hardware_backend(encoder)
    if backend != device.backend:
        return None
    command = [ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y"]
    if backend == "cuda":
        command.extend(_hardware_device_arguments({"cuda"}, None, cuda_device_id=device.id))
        command.extend(["-hwaccel", "cuda", "-hwaccel_device", "cu", "-hwaccel_output_format", "cuda"])
    elif backend in {"qsv", "vaapi"} and device.render_node:
        qsv_direct = backend == "qsv"
        command.extend(_hardware_device_arguments({backend}, device.render_node, qsv_direct=qsv_direct))
        hardware_name = "qs" if qsv_direct else "va"
        command.extend(["-hwaccel", backend, "-hwaccel_device", hardware_name, "-hwaccel_output_format", backend])
    elif backend == "qsv":
        command.extend(["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"])
    elif backend == "amf":
        command.extend(["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"])
    elif backend == "videotoolbox":
        command.extend(["-hwaccel", "videotoolbox", "-hwaccel_output_format", "videotoolbox_vld"])
    else:
        return None
    if stream_loops:
        command.extend(["-stream_loop", str(stream_loops)])
    command.extend(["-i", str(fixture), "-map", "0:v:0", "-an", "-c:v", encoder])
    quality_spec = _encoder_quality_spec(encoder)
    if quality_spec:
        command.extend([f"-{_quality_option(quality_spec[0])}", f"{quality_spec[3]:g}"])
    command.extend(["-frames:v", str(frames), "-f", "null", "-"])
    return command


def _software_pair_command(ffmpeg_path: str, fixture: Path, encoder: str) -> list[str]:
    return [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(fixture),
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        encoder,
        *_fixture_options(encoder),
        "-frames:v",
        "30",
        "-f",
        "null",
        "-",
    ]


def _parallel_capacity(command: list[str]) -> tuple[int, bool]:
    maximum = 1
    for count in range(2, MAX_PARALLEL_PROBE_JOBS + 1):
        with ThreadPoolExecutor(max_workers=count, thread_name_prefix="transcode-matrix") as executor:
            outcomes = list(executor.map(lambda _index: _run_command(command, timeout=45)[0], range(count)))
        if not all(outcomes):
            return maximum, False
        maximum = count
    return maximum, True


def _codec_axes(capabilities: TranscodeCapabilitiesRead) -> tuple[list[str], list[str]]:
    del capabilities
    codecs = list(VIDEO_CODEC_ORDER)
    return codecs, list(codecs)


def _device_group_key(device: TranscodeHardwareDevice) -> str:
    return f"render:{device.render_node}" if device.render_node else f"device:{device.id}"


def _device_group_name(devices: list[TranscodeHardwareDevice]) -> str:
    first = devices[0]
    if not first.render_node:
        return first.name.removesuffix(" (automatic)")
    name_parts = first.name.split(" · ")
    return " · ".join(name_parts[:-1]) if len(name_parts) > 1 else first.name


def _build_matrices(
    settings: Settings,
    capabilities: TranscodeCapabilitiesRead,
) -> TranscodeCapabilityMatrixRead:
    tested_at = utc_now()
    decode_codecs, encode_codecs = _codec_axes(capabilities)
    root = _matrix_root(settings)
    with tempfile.TemporaryDirectory(prefix="run-", dir=root) as temporary_directory:
        temporary_path = Path(temporary_directory)
        fixtures = {
            codec: _create_fixture(settings.ffmpeg_path, codec, temporary_path)
            for codec in decode_codecs
        }
        software_results: dict[tuple[str, str], tuple[bool, str | None]] = {}
        matrices: list[TranscodeDeviceMatrixRead] = []
        device_groups: dict[str, list[TranscodeHardwareDevice]] = {}
        for device in capabilities.devices:
            if device.status == "available":
                device_groups.setdefault(_device_group_key(device), []).append(device)
        for device_key, devices in device_groups.items():
            cells: list[TranscodeMatrixCellRead] = []
            hardware_commands: dict[tuple[str, str], list[str]] = {}
            for decode_codec in decode_codecs:
                fixture, _fixture_encoder = fixtures[decode_codec]
                for encode_codec in encode_codecs:
                    if fixture is None:
                        cells.append(
                            TranscodeMatrixCellRead(
                                decode_codec=decode_codec,
                                encode_codec=encode_codec,
                                status="not_tested",
                                detail="The synthetic source codec could not be created with this FFmpeg build.",
                            )
                        )
                        continue
                    hardware_cell: TranscodeMatrixCellRead | None = None
                    for device in devices:
                        hardware_encoder = _device_hardware_encoder(capabilities, device, encode_codec)
                        if hardware_encoder is None:
                            continue
                        command = _hardware_pair_command(
                            settings.ffmpeg_path,
                            fixture,
                            device,
                            hardware_encoder.name,
                        )
                        if command is None:
                            continue
                        succeeded, _error = _run_command(command)
                        if succeeded:
                            hardware_commands[(decode_codec, encode_codec)] = command
                            hardware_cell = TranscodeMatrixCellRead(
                                decode_codec=decode_codec,
                                encode_codec=encode_codec,
                                status="hardware",
                                decoder=f"{device.backend}:{decode_codec}",
                                encoder=hardware_encoder.name,
                            )
                            break
                    if hardware_cell is not None:
                        cells.append(hardware_cell)
                        continue
                    software_encoder = _software_encoder(capabilities, encode_codec)
                    software_key = (decode_codec, encode_codec)
                    if software_encoder is not None and software_key not in software_results:
                        software_results[software_key] = _run_command(
                            _software_pair_command(settings.ffmpeg_path, fixture, software_encoder),
                            timeout=40,
                        )
                    software_succeeded = software_results.get(software_key, (False, None))[0]
                    cells.append(
                        TranscodeMatrixCellRead(
                            decode_codec=decode_codec,
                            encode_codec=encode_codec,
                            status="software" if software_succeeded else "unsupported",
                            decoder="software:auto" if software_succeeded else None,
                            encoder=software_encoder if software_succeeded else None,
                            detail=(
                                "The complete hardware decode and encode path failed; the software path passed."
                                if software_succeeded
                                else "Neither a complete hardware path nor an available software path passed."
                            ),
                        )
                    )
            for (decode_codec, encode_codec), base_command in hardware_commands.items():
                representative = list(base_command)
                frames_index = representative.index("-frames:v") + 1
                representative[frames_index] = "120"
                input_index = representative.index("-i")
                representative[input_index:input_index] = ["-stream_loop", "3"]
                maximum, lower_bound = _parallel_capacity(representative)
                for cell in cells:
                    if (
                        cell.status == "hardware"
                        and cell.decode_codec == decode_codec
                        and cell.encode_codec == encode_codec
                    ):
                        cell.max_parallel_jobs = maximum
                        cell.max_parallel_jobs_is_lower_bound = lower_bound
            matrices.append(
                TranscodeDeviceMatrixRead(
                    device_id=device_key,
                    device_name=_device_group_name(devices),
                    backend=" + ".join(sorted({device.backend for device in devices})),
                    tested_at=tested_at,
                    decode_codecs=decode_codecs,
                    encode_codecs=encode_codecs,
                    cells=cells,
                )
            )
    return TranscodeCapabilityMatrixRead(
        status="completed",
        tested_at=tested_at,
        ffmpeg_version=capabilities.ffmpeg_version or capabilities.version,
        matrices=matrices,
    )


def run_transcode_matrix_test(settings: Settings) -> TranscodeCapabilityMatrixRead:
    if not MATRIX_LOCK.acquire(blocking=False):
        raise TranscodeMatrixBusyError("A transcoding capability test is already running")
    try:
        capabilities = get_transcode_capabilities(settings, refresh=True)
        if not capabilities.ffmpeg_available:
            result = TranscodeCapabilityMatrixRead(
                status="failed",
                tested_at=utc_now(),
                ffmpeg_version=capabilities.ffmpeg_version or capabilities.version,
                error=capabilities.error or "FFmpeg is unavailable",
            )
        elif not capabilities.devices:
            result = TranscodeCapabilityMatrixRead(
                status="completed",
                tested_at=utc_now(),
                ffmpeg_version=capabilities.ffmpeg_version or capabilities.version,
                matrices=[],
            )
        else:
            result = _build_matrices(settings, capabilities)
        _store_transcode_matrix(settings, result)
        return result
    finally:
        MATRIX_LOCK.release()

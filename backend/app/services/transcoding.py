from __future__ import annotations

import ctypes
import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from math import floor
from pathlib import Path
from threading import Lock
from typing import Callable
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    JobStatus,
    LibraryRoot,
    MediaFile,
    SubtitleStream,
    TranscodeJob,
    TranscodeVariant,
    TranscodeVariantGroup,
    VideoStream,
)
from backend.app.schemas.transcoding import (
    ExternalSubtitlePlan,
    FileTranscodeRead,
    TranscodeCapabilitiesRead,
    TranscodeAttachmentSummary,
    TranscodeEncoderCapability,
    TranscodeFileSummary,
    TranscodeHardwareDevice,
    TranscodeJobPageRead,
    TranscodeJobRead,
    TranscodePlan,
    TranscodeStreamAction,
    TranscodeStreamPlan,
    TranscodeValidationRead,
    TranscodeVariantRead,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.languages import normalize_language_tag
from backend.app.utils.time import utc_now


HARDWARE_ENCODER_MARKERS = (
    "_nvenc",
    "_qsv",
    "_amf",
    "_videotoolbox",
    "_vaapi",
    "_vulkan",
    "_v4l2m2m",
    "_d3d12va",
    "_mediacodec",
    "_rkmpp",
)
VIDEO_ENCODER_CODECS = {
    "libx264": "h264",
    "h264_nvenc": "h264",
    "h264_qsv": "h264",
    "h264_amf": "h264",
    "h264_videotoolbox": "h264",
    "h264_vaapi": "h264",
    "mjpeg_qsv": "mjpeg",
    "mjpeg_vaapi": "mjpeg",
    "mpeg2_qsv": "mpeg2video",
    "mpeg2_vaapi": "mpeg2video",
    "libx265": "hevc",
    "hevc_nvenc": "hevc",
    "hevc_qsv": "hevc",
    "hevc_amf": "hevc",
    "hevc_videotoolbox": "hevc",
    "hevc_vaapi": "hevc",
    "libsvtav1": "av1",
    "libaom-av1": "av1",
    "av1_nvenc": "av1",
    "av1_qsv": "av1",
    "av1_amf": "av1",
    "av1_vaapi": "av1",
    "vp8_vaapi": "vp8",
    "libvpx-vp9": "vp9",
    "vp9_qsv": "vp9",
    "vp9_vaapi": "vp9",
    "libvpx": "vp8",
}
AUDIO_ENCODER_CODECS = {
    "aac": "aac",
    "libfdk_aac": "aac",
    "libopus": "opus",
    "opus": "opus",
    "libvorbis": "vorbis",
    "ac3": "ac3",
    "eac3": "eac3",
    "flac": "flac",
    "libmp3lame": "mp3",
}
SUBTITLE_ENCODER_CODECS = {
    "mov_text": "mov_text",
    "srt": "subrip",
    "subrip": "subrip",
    "ass": "ass",
    "webvtt": "webvtt",
}
ENCODER_QUALITY_SPECS = {
    # mode, minimum, maximum, default, step.  The values mirror FFmpeg's
    # constant-quality controls for the encoder families MediaLyze exposes.
    "libx264": ("crf", 0, 51, 23, 1),
    "libx265": ("crf", 0, 51, 28, 1),
    "libsvtav1": ("crf", 0, 63, 30, 1),
    "libaom-av1": ("crf", 0, 63, 30, 1),
    "libvpx-vp9": ("crf", 0, 63, 31, 1),
}
# VAAPI exposes the common ``global_quality`` option for codecs which do not
# have a codec-specific QP option.  Keep these ranges close to the native
# FFmpeg/VAAPI ranges so that the UI does not send an option the encoder cannot
# understand (notably ``av1_vaapi`` does not accept ``-qp`` on current builds).
VAAPI_QUALITY_SPECS = {
    "h264": ("qp", 0, 51, 23, 1),
    "hevc": ("qp", 0, 51, 23, 1),
    "av1": ("global_quality", 1, 255, 80, 1),
    "vp8": ("global_quality", 1, 127, 60, 1),
    "vp9": ("global_quality", 1, 255, 120, 1),
    "mpeg2video": ("global_quality", 1, 51, 23, 1),
    "mjpeg": ("global_quality", 1, 100, 80, 1),
}
QSV_QUALITY_SPECS = {
    "mjpeg": ("global_quality", 1, 100, 80, 1),
    "h264": ("global_quality", 1, 51, 23, 1),
    "hevc": ("global_quality", 1, 51, 23, 1),
    "av1": ("global_quality", 1, 51, 23, 1),
    "vp9": ("global_quality", 1, 51, 23, 1),
    "mpeg2video": ("global_quality", 1, 51, 23, 1),
}
CONTAINER_FORMATS = {"mkv": "matroska", "mp4": "mp4", "webm": "webm"}
CONTAINER_COMPATIBILITY = {
    "mp4": {
        "video": {"h264", "hevc", "av1", "mpeg4", "mjpeg"},
        "audio": {"aac", "ac3", "eac3", "mp3", "alac"},
        "subtitle": {"mov_text"},
    },
    "webm": {
        "video": {"vp8", "vp9", "av1"},
        "audio": {"opus", "vorbis"},
        "subtitle": {"webvtt"},
    },
}
DEFAULT_FILENAME_TEMPLATE = "[{resolution}, {dynRange}, {codec}] [{audioLanguages}]"
FILENAME_TOKENS = {
    "resolution",
    "dynRange",
    "codec",
    "audioLanguages",
    "subtitleLanguages",
    "container",
    "videoBitrate",
}
BITMAP_SUBTITLE_CODECS = {"dvb_subtitle", "dvd_subtitle", "hdmv_pgs_subtitle", "pgs", "xsub"}
CAPABILITIES_LOCK = Lock()


def _encoder_quality_spec(name: str) -> tuple[str, int, int, int, int] | None:
    """Return the quality control used by an encoder, if it is known."""
    normalized = name.lower()
    if normalized in ENCODER_QUALITY_SPECS:
        return ENCODER_QUALITY_SPECS[normalized]
    if normalized.endswith("_vaapi"):
        codec = _hardware_encoder_codec(normalized)
        return VAAPI_QUALITY_SPECS.get(codec) if codec else None
    if normalized.endswith("_qsv"):
        codec = _hardware_encoder_codec(normalized)
        return QSV_QUALITY_SPECS.get(codec) if codec else None
    if any(normalized.endswith(suffix) for suffix in ("_nvenc", "_amf")):
        return ("cq", 0, 51, 23, 1)
    # VideoToolbox does not expose FFmpeg's generic cq/crf/qp controls in the
    # bundled macOS build. Its rate control is bitrate-driven instead.
    return None


def _quality_option(mode: str) -> str:
    return {
        "crf": "crf",
        "cq": "cq",
        "qp": "qp",
        "global_quality": "global_quality",
    }.get(mode, mode)


class TranscodeValidationError(ValueError):
    def __init__(self, validation: TranscodeValidationRead) -> None:
        self.validation = validation
        super().__init__("; ".join(validation.errors) or "Transcoding plan is invalid")


class TranscodeCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class SourcePaths:
    root: Path
    source: Path


def _safe_path_below(root: Path, relative_path: str) -> Path:
    resolved_root = root.resolve()
    candidate = (resolved_root / relative_path).resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("Media path escapes its library root") from exc
    return candidate


def _source_paths(media_file: MediaFile) -> SourcePaths:
    root = Path(media_file.library_root.path if media_file.library_root else media_file.library.path)
    source = _safe_path_below(root, media_file.relative_path)
    return SourcePaths(root=root.resolve(), source=source)


def _is_hardware_encoder(name: str) -> bool:
    return any(marker in name for marker in HARDWARE_ENCODER_MARKERS)


def _hardware_encoder_codec(name: str) -> str | None:
    if not _is_hardware_encoder(name):
        return None
    normalized = name.lower()
    for prefix, codec in (
        ("h264", "h264"),
        ("hevc", "hevc"),
        ("av1", "av1"),
        ("vp9", "vp9"),
        ("vp8", "vp8"),
        ("mpeg2", "mpeg2video"),
        ("mjpeg", "mjpeg"),
    ):
        if normalized.startswith(prefix):
            return codec
    return None


def _hardware_backend(name: str | None) -> str | None:
    normalized = (name or "").lower()
    if normalized.endswith("_nvenc"):
        return "cuda"
    if normalized.endswith("_vaapi"):
        return "vaapi"
    if normalized.endswith("_qsv"):
        return "qsv"
    if normalized.endswith("_amf"):
        return "amf"
    if normalized.endswith("_videotoolbox"):
        return "videotoolbox"
    return None


def _is_linux() -> bool:
    return sys.platform.startswith("linux")


def _is_macos() -> bool:
    return sys.platform == "darwin"


def _is_windows() -> bool:
    return sys.platform.startswith("win") or os.name == "nt"


def _resolve_hardware_render_nodes(configured: str | Path | None) -> tuple[str, ...]:
    """Return every usable Linux DRM render node in deterministic order.

    A single global ``/dev/dri/renderD128`` default is not sufficient on
    laptops with an integrated GPU next to a discrete adapter.  The launcher
    and capability probe both keep the node explicit, while the normal
    configuration still requires no user input.  An explicitly configured
    node remains a supported escape hatch for hosts whose device ordering is
    unusual.
    """

    if not _is_linux():
        return ()
    if configured:
        candidate = Path(configured).expanduser()
        return (str(candidate),) if candidate.exists() else ()
    dri_directory = Path("/dev/dri")
    if not dri_directory.is_dir():
        return ()
    return tuple(
        str(candidate)
        for candidate in sorted(dri_directory.glob("renderD*"))
        if candidate.is_char_device() or candidate.exists()
    )


def _resolve_hardware_render_node(configured: str | Path | None) -> str | None:
    """Resolve the DRM render node used for Intel VAAPI/QSV operations.

    Linux containers normally expose one or more ``/dev/dri/renderD*`` nodes.
    An explicit setting is preferred so multi-GPU hosts can select the right
    adapter; otherwise the first available render node is used.  Other
    platforms keep their native FFmpeg device selection behavior.
    """

    return next(iter(_resolve_hardware_render_nodes(configured)), None)


def _hardware_device_arguments(
    backends: set[str],
    render_node: str | None,
    *,
    qsv_direct: bool = False,
    cuda_device_id: str = "cuda0",
    native_device_index: int | None = None,
) -> list[str]:
    """Build FFmpeg's named hardware-device initialization arguments.

    A QSV-only graph uses FFmpeg's explicit Linux ``child_device`` syntax. It
    avoids relying on the driver's default adapter, which is especially
    important when an Arc GPU is present next to an integrated adapter. When
    VAAPI and QSV are used in the same graph, QSV is derived from the named
    VAAPI device so both encoders share the same DRM context.
    """

    arguments: list[str] = []
    # Windows exposes the native D3D11 adapter ordinal as the stable selector
    # for AMF and QSV.  Without this explicit binding FFmpeg uses adapter 0,
    # which is commonly an NVIDIA GPU on hybrid systems and makes an AMD/iGPU
    # encoder fail with an opaque ``AMF failed to initialise`` error.
    if native_device_index is not None and backends == {"amf"}:
        arguments.extend(["-init_hw_device", f"d3d11va=amf:{native_device_index}"])
        return arguments
    if native_device_index is not None and backends == {"qsv"} and _is_windows():
        arguments.extend(["-qsv_device", str(native_device_index)])
        return arguments
    if "cuda" in backends:
        # Keep the selected NVIDIA adapter explicit. ``cuda=<name>:<index>``
        # assigns a stable per-process name and, unlike ``cuda=cuda0``, does
        # not silently fall back to adapter 0 on multi-GPU hosts.
        match = re.fullmatch(r"cuda(\d+)", cuda_device_id or "")
        cuda_index = match.group(1) if match else "0"
        arguments.extend(["-init_hw_device", f"cuda=cu:{cuda_index}"])
    if qsv_direct and backends == {"qsv"} and render_node:
        arguments.extend(
            [
                "-init_hw_device",
                f"qsv=qs:hw,child_device={render_node}",
            ]
        )
        return arguments
    if ("vaapi" in backends or "qsv" in backends) and render_node:
        arguments.extend(["-init_hw_device", f"vaapi=va:{render_node}"])
    if "qsv" in backends:
        # Deriving QSV from the VAAPI device keeps Intel's DRM render node
        # selection explicit and works with oneVPL-backed FFmpeg builds.
        arguments.extend(["-init_hw_device", "qsv=qs@va"])
    return arguments


def _hardware_upload_format(source: VideoStream | None, effective_pixel_format: str | None) -> str:
    pixel_format = (effective_pixel_format or (source.pix_fmt if source else None) or "").lower()
    bit_depth = (source.bit_depth if source else None) or 0
    if bit_depth >= 10 or "10" in pixel_format or pixel_format.startswith("p010"):
        return "p010le"
    return "nv12"


def _hardware_upload_filter(
    backend: str,
    source: VideoStream | None,
    effective_pixel_format: str | None,
    *,
    qsv_direct: bool = False,
) -> str:
    if backend == "cuda":
        return f"format={_hardware_upload_format(source, effective_pixel_format)},hwupload_cuda"
    if backend == "vaapi":
        upload = "hwupload"
    elif backend in {"amf", "videotoolbox"}:
        # AMF and VideoToolbox accept system-memory frames and let the native
        # driver/framework choose the active adapter.  They must not inherit
        # the Linux VAAPI/QSV upload filter through the generic fallback.
        # VideoToolbox accepts system-memory frames and is negotiated by the
        # macOS framework; AMF behaves equivalently on Windows.
        return ""
    elif qsv_direct:
        # With a direct QSV device, filter_hw_device already points at the
        # target surface pool. Extra frames prevent short sources from
        # exhausting the QSV upload queue during startup.
        upload = "hwupload=extra_hw_frames=16"
    else:
        upload = "hwupload=derive_device=qsv"
    return f"format={_hardware_upload_format(source, effective_pixel_format)},{upload}"


DRM_VENDOR_NAMES = {
    "0x8086": "intel",
    "0x1002": "amd",
    "0x10de": "nvidia",
}
DRM_DRIVER_VENDORS = {
    "i915": "intel",
    "xe": "intel",
    "amdgpu": "amd",
    "radeon": "amd",
    "nouveau": "nvidia",
    "nvidia": "nvidia",
    "nvidia-drm": "nvidia",
}
BACKEND_DISPLAY_NAMES = {
    "vaapi": "VAAPI",
    "qsv": "Quick Sync",
    "amf": "AMF",
    "videotoolbox": "VideoToolbox",
    "cuda": "CUDA",
}


def _read_optional_text(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


def _device_class_from_name(name: str) -> str:
    normalized = name.lower()
    if any(
        marker in normalized
        for marker in (
            "integrated",
            "uhd graphics",
            "iris",
            "radeon(tm) graphics",
            "radeon graphics",
            "radeon 7",
            "radeon vega",
            "vega 6",
            "vega 7",
        )
    ):
        return "integrated"
    if any(
        marker in normalized
        for marker in ("arc ", "geforce", "quadro", "tesla", "radeon rx", "firepro", "radeon pro")
    ):
        return "dedicated"
    return "unknown"


def _windows_d3d11_adapters(ffmpeg_path: str) -> tuple[dict[str, object], ...]:
    """Enumerate the native D3D11 adapters visible to a Windows FFmpeg.

    FFmpeg's AMF and Windows-QSV encoders otherwise default to adapter 0. On
    hybrid systems that is often the discrete NVIDIA adapter, even though an
    AMD or Intel media engine is also present. Initialising a tiny D3D11
    device per ordinal gives us the driver-provided PCI identity and lets
    later probes/jobs bind the exact adapter. The helper is deliberately
    best-effort: older builds or test doubles may not support
    ``d3d11va=...``, in which case the caller keeps the legacy logical target.
    """

    if not _is_windows() or _is_linux():
        return ()
    pattern = re.compile(
        r"Using device\s+([0-9A-Fa-f]{4}:[0-9A-Fa-f]{4})\s+\((.*)\)\."
    )
    vendor_by_pci = {
        "1002": "amd",
        "10de": "nvidia",
        "8086": "intel",
    }
    adapters: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    # D3D11 adapter ordinals are small in practice. Sixteen is enough to
    # cover multi-GPU workstations while still keeping capability refreshes
    # bounded when a driver reports no adapters.
    for index in range(16):
        command = [
            ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "verbose",
            "-init_hw_device",
            f"d3d11va=probe:{index}",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16:d=0.01",
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except Exception:
            # Adapter enumeration must never make the normal encoder probe
            # fail. This also keeps compatibility with older FFmpeg builds
            # and mocked subprocess implementations.
            break
        output = "\n".join(
            value for value in (completed.stdout or "", completed.stderr or "") if value
        )
        match = pattern.search(output)
        if match is None:
            break
        pci_id = match.group(1).lower()
        name = match.group(2).strip()
        identity = (pci_id, name.lower())
        # FFmpeg falls back to the default adapter for an out-of-range index;
        # the repeated identity is therefore the end of the enumeration.
        if identity in seen:
            break
        seen.add(identity)
        vendor = vendor_by_pci.get(pci_id.split(":", 1)[0], "unknown")
        if vendor == "unknown":
            lowered_name = name.lower()
            if "radeon" in lowered_name or "amd" in lowered_name:
                vendor = "amd"
            elif "intel" in lowered_name or "arc " in lowered_name or "iris" in lowered_name:
                vendor = "intel"
            elif "nvidia" in lowered_name or "geforce" in lowered_name or "quadro" in lowered_name:
                vendor = "nvidia"
        adapters.append(
            {
                "index": index,
                "pci_id": pci_id,
                "name": name or f"D3D11 adapter {index}",
                "vendor": vendor,
                "device_class": _device_class_from_name(name),
            }
        )
    return tuple(adapters)


def _linux_render_device_metadata(render_node: str) -> dict[str, str]:
    """Read best-effort identity data for one Linux DRM render node.

    The metadata is deliberately advisory.  The actual encoder probe remains
    the source of truth because sysfs vendor strings and driver names do not
    prove that a container can open the device.
    """

    node_name = Path(render_node).name
    device_path = Path("/sys/class/drm") / node_name / "device"
    vendor_id = (_read_optional_text(device_path / "vendor") or "").lower()
    if vendor_id and not vendor_id.startswith("0x"):
        vendor_id = f"0x{vendor_id}"
    vendor = DRM_VENDOR_NAMES.get(vendor_id, "unknown")
    driver_path = device_path / "driver"
    try:
        driver = driver_path.resolve().name if driver_path.exists() else ""
    except OSError:
        driver = ""
    uevent: dict[str, str] = {}
    raw_uevent = _read_optional_text(device_path / "uevent")
    if raw_uevent:
        for line in raw_uevent.splitlines():
            key, separator, value = line.partition("=")
            if separator:
                uevent[key.strip().upper()] = value.strip()
    # Some NAS/container combinations expose the DRM driver and render node
    # but hide the PCI vendor file.  Prefer a vendor from the uevent PCI_ID,
    # then use the Intel i915/xe and AMD amdgpu/radeon driver names.  The
    # subsequent encoder probe remains authoritative for actual usability.
    if vendor == "unknown":
        uevent_vendor_id = uevent.get("PCI_ID", "").partition(":")[0].lower()
        if uevent_vendor_id and not uevent_vendor_id.startswith("0x"):
            uevent_vendor_id = f"0x{uevent_vendor_id}"
        vendor = DRM_VENDOR_NAMES.get(uevent_vendor_id, "unknown")
    if not driver:
        driver = uevent.get("DRIVER", "")
    if vendor == "unknown":
        vendor = DRM_DRIVER_VENDORS.get(driver.lower(), "unknown")
    vendor_label = vendor.capitalize() if vendor != "unknown" else "GPU"
    name = f"{vendor_label} GPU ({node_name})"
    if uevent.get("PCI_ID"):
        name = f"{name} · {uevent['PCI_ID']}"
    device_class = _device_class_from_name(name)
    return {
        "vendor": vendor,
        "name": name,
        "driver": driver,
        "device_class": device_class,
        "render_node": render_node,
    }


def _device_for_backend(
    backend: str,
    index: int,
    *,
    render_node: str | None = None,
    vendor: str | None = None,
    name: str | None = None,
    driver_version: str | None = None,
    native_device_index: int | None = None,
    device_class: str = "unknown",
) -> TranscodeHardwareDevice:
    normalized_vendor = vendor or {
        "cuda": "nvidia",
        "qsv": "intel",
        "amf": "amd",
        "videotoolbox": "apple",
        "vaapi": "unknown",
    }.get(backend, "unknown")
    suffix = Path(render_node).name if render_node else str(index)
    device_id = f"{backend}-{suffix}" if render_node else f"{backend}{index}"
    display_name = name or f"{normalized_vendor.capitalize()} {BACKEND_DISPLAY_NAMES.get(backend, backend)} (automatic)"
    if render_node and "(" not in display_name:
        display_name = f"{display_name} ({Path(render_node).name})"
    return TranscodeHardwareDevice(
        id=device_id,
        name=display_name,
        vendor=normalized_vendor,
        backend=backend,
        driver_version=driver_version,
        render_node=render_node,
        native_device_index=native_device_index,
        device_class=device_class if device_class in {"integrated", "dedicated", "unknown"} else "unknown",
    )


def _build_hardware_device_inventory(
    listed_names: set[str],
    render_nodes: tuple[str, ...],
    nvidia_devices: list[TranscodeHardwareDevice],
    *,
    native_adapters: tuple[dict[str, object], ...] = (),
) -> list[TranscodeHardwareDevice]:
    """Build logical adapter targets before probing individual encoders.

    FFmpeg exposes encoder families rather than a portable cross-platform GPU
    inventory.  The inventory therefore combines native CUDA identity,
    Linux DRM nodes, and platform-native logical backends.  Every target is
    still marked unavailable until its own FFmpeg smoke test succeeds.

    An Intel CPU with an enabled integrated GPU exposes its Quick Sync media
    engine through the same Linux DRM render node as the Intel graphics
    adapter. AMD APUs expose their VCN media engine through VAAPI. These are
    hardware-media paths, not CPU software encoding, so they must be included
    in the same per-device probe and automatic-selection flow as discrete
    adapters.
    """

    devices = list(nvidia_devices)
    render_metadata = [_linux_render_device_metadata(node) for node in render_nodes]
    listed_render_backends = {
        backend
        for backend in ("vaapi", "qsv")
        if any(name.lower().endswith(f"_{backend}") for name in listed_names)
    }
    for metadata in render_metadata:
        # A vendor-identified DRM node is itself evidence that a hardware
        # media engine is present, including integrated CPU/APU engines, even
        # when this FFmpeg build does not list every backend family. Add the
        # native Intel/AMD targets so the device remains visible in diagnostics
        # and can become available as soon as one of its hardware encoders
        # passes the real probe. Do not infer anything for unknown render
        # nodes; NVIDIA and virtualized paths continue to be gated by their
        # explicit backend listings.
        render_backends = set(listed_render_backends)
        if metadata["vendor"] == "intel":
            render_backends.update({"qsv", "vaapi"})
        elif metadata["vendor"] == "amd":
            render_backends.add("vaapi")
        for backend in sorted(render_backends):
            # QSV is an Intel path.  Unknown metadata is retained because
            # tests and some virtualized/container environments expose a
            # render node without the PCI sysfs tree.
            if backend == "qsv" and metadata["vendor"] not in {"intel", "unknown"}:
                continue
            devices.append(
                _device_for_backend(
                    backend,
                    len(devices),
                    render_node=metadata["render_node"],
                    vendor=metadata["vendor"],
                    name=f"{metadata['name']} · {BACKEND_DISPLAY_NAMES[backend]}",
                    driver_version=metadata["driver"] or None,
                    device_class=metadata["device_class"],
                )
            )

    # AMF and Windows QSV select the adapter through the native driver/API.
    # Prefer one target per physical D3D11 adapter so hybrid systems expose
    # their AMD/Intel integrated media engine alongside a discrete GPU. Keep
    # the old logical fallback for FFmpeg builds that cannot enumerate
    # adapters; the subsequent smoke probe remains authoritative.
    if _is_windows() and not _is_linux():
        backend_ordinals = {"amf": 0, "qsv": 0}
        for adapter in native_adapters:
            vendor = str(adapter.get("vendor") or "unknown")
            adapter_name = str(adapter.get("name") or "D3D11 adapter")
            adapter_index = adapter.get("index")
            if not isinstance(adapter_index, int) or adapter_index < 0:
                continue
            if vendor == "amd" and any(name.lower().endswith("_amf") for name in listed_names):
                ordinal = backend_ordinals["amf"]
                backend_ordinals["amf"] += 1
                devices.append(
                    _device_for_backend(
                        "amf",
                        ordinal,
                        vendor="amd",
                        name=f"{adapter_name} · {BACKEND_DISPLAY_NAMES['amf']}",
                        native_device_index=adapter_index,
                        device_class=str(
                            adapter.get("device_class") or _device_class_from_name(adapter_name)
                        ),
                    )
                )
            if vendor == "intel" and any(name.lower().endswith("_qsv") for name in listed_names):
                ordinal = backend_ordinals["qsv"]
                backend_ordinals["qsv"] += 1
                devices.append(
                    _device_for_backend(
                        "qsv",
                        ordinal,
                        vendor="intel",
                        name=f"{adapter_name} · {BACKEND_DISPLAY_NAMES['qsv']}",
                        native_device_index=adapter_index,
                        device_class=str(
                            adapter.get("device_class") or _device_class_from_name(adapter_name)
                        ),
                    )
                )
        for backend in ("amf", "qsv"):
            if any(name.lower().endswith(f"_{backend}") for name in listed_names) and not any(
                device.backend == backend for device in devices
            ):
                devices.append(_device_for_backend(backend, 0))

    return devices


def _test_hardware_encoder(
    ffmpeg_path: str,
    encoder: str,
    render_node: str | None = None,
    device_id: str | None = None,
    native_device_index: int | None = None,
) -> tuple[bool, str | None]:
    backend = _hardware_backend(encoder)
    # CUDA/NVENC uses the NVIDIA device exposed by the container/runtime and
    # does not require a Linux DRM render node.  A WSL2 Docker container, for
    # example, can expose `/dev/dxg` while `/dev/dri/renderD*` is absent.  DRM
    # render nodes remain mandatory for the Intel VAAPI/QSV paths.
    if backend in {"vaapi", "qsv"} and _is_linux() and not render_node:
        return False, f"No DRM render node is available for {backend} hardware encoding"
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
    ]
    qsv_direct = False
    if backend == "cuda":
        command.extend(_hardware_device_arguments({backend}, None, cuda_device_id=device_id or "cuda0"))
        command.extend(["-filter_hw_device", "cu"])
    elif backend == "amf" and native_device_index is not None:
        command.extend(
            _hardware_device_arguments(
                {backend},
                None,
                native_device_index=native_device_index,
            )
        )
        command.extend(["-filter_hw_device", "amf"])
    elif backend == "qsv" and native_device_index is not None and _is_windows():
        command.extend(
            _hardware_device_arguments(
                {backend},
                None,
                native_device_index=native_device_index,
            )
        )
    elif backend and render_node:
        qsv_direct = backend == "qsv" and _is_linux()
        command.extend(_hardware_device_arguments({backend}, render_node, qsv_direct=qsv_direct))
        command.extend(["-filter_hw_device", "qs" if qsv_direct else "va"])
    command.extend([
        "-f",
        "lavfi",
        "-i",
        # NVENC rejects very small frame sizes on some driver generations;
        # 256x256 remains tiny while exercising the real encoder path.
        "color=c=black:s=256x256:d=0.1",
    ])
    if backend and (backend == "cuda" or render_node):
        command.extend([
            "-vf",
            _hardware_upload_filter(backend, None, None, qsv_direct=qsv_direct),
        ])
    command.extend([
        "-frames:v",
        "1",
        "-c:v",
        encoder,
    ])
    quality_spec = _encoder_quality_spec(encoder)
    if quality_spec:
        command.extend([f"-{_quality_option(quality_spec[0])}", f"{quality_spec[3]:g}"])
    command.extend(["-f", "null", "-"])
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, str(exc)
    error = (completed.stderr or completed.stdout or "").strip()
    if len(error) > 1000:
        error = f"{error[:500]}\n...\n{error[-497:]}"
    return completed.returncode == 0, error or None


def _nvidia_smi_path() -> str | None:
    return shutil.which("nvidia-smi") or shutil.which("nvidia-smi.exe")


def _cuda_driver_error(cuda: ctypes.CDLL, result: int) -> str:
    """Return a readable CUDA Driver API error without requiring nvidia-smi."""
    try:
        get_error_string = getattr(cuda, "cuGetErrorString")
        get_error_string.restype = ctypes.c_int
        error_string = ctypes.c_char_p()
        get_error_string.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_char_p)]
        if get_error_string(result, ctypes.byref(error_string)) == 0 and error_string.value:
            return error_string.value.decode("utf-8", errors="replace")
    except (AttributeError, OSError, TypeError):
        pass
    return f"CUDA driver API error {result}"


def _detect_nvidia_devices_via_cuda() -> tuple[list[TranscodeHardwareDevice], str | None]:
    """Enumerate visible NVIDIA devices through the native CUDA driver API.

    The NVIDIA Container Toolkit injects ``libcuda.so.1`` into a GPU-enabled
    container but does not necessarily add the ``nvidia-smi`` executable to a
    Debian/Alpine application image. Native Windows exposes the same API as
    ``nvcuda.dll``. The Driver API provides the device identity fields needed
    by the UI without installing a second copy of the host driver in the image.
    """
    driver_library = "nvcuda.dll" if _is_windows() else "libcuda.so.1"
    try:
        cuda = ctypes.CDLL(driver_library)
    except OSError as exc:
        return [], f"nvidia-smi is not available and {driver_library} could not be loaded: {exc}"

    def symbol(name: str):
        try:
            function = getattr(cuda, name)
        except AttributeError:
            return None
        function.restype = ctypes.c_int
        return function

    cu_init = symbol("cuInit")
    cu_device_get_count = symbol("cuDeviceGetCount")
    cu_device_get = symbol("cuDeviceGet")
    cu_device_get_name = symbol("cuDeviceGetName")
    cu_device_compute_capability = symbol("cuDeviceComputeCapability")
    if not all(
        (
            cu_init,
            cu_device_get_count,
            cu_device_get,
            cu_device_get_name,
            cu_device_compute_capability,
        )
    ):
        return [], f"{driver_library} does not expose the required CUDA Driver API"

    result = cu_init(0)
    if result != 0:
        return [], _cuda_driver_error(cuda, result)
    count = ctypes.c_int()
    cu_device_get_count.argtypes = [ctypes.POINTER(ctypes.c_int)]
    result = cu_device_get_count(ctypes.byref(count))
    if result != 0:
        return [], _cuda_driver_error(cuda, result)
    if count.value <= 0:
        return [], "CUDA Driver API did not report a GPU"

    cu_device_get.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]
    cu_device_get_name.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
    cu_device_compute_capability.argtypes = [
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
        ctypes.c_int,
    ]
    cu_device_total_mem = symbol("cuDeviceTotalMem_v2") or symbol("cuDeviceTotalMem")
    if cu_device_total_mem:
        cu_device_total_mem.argtypes = [ctypes.POINTER(ctypes.c_size_t), ctypes.c_int]

    devices: list[TranscodeHardwareDevice] = []
    for ordinal in range(count.value):
        device = ctypes.c_int()
        result = cu_device_get(ctypes.byref(device), ordinal)
        if result != 0:
            return [], _cuda_driver_error(cuda, result)

        name_buffer = ctypes.create_string_buffer(256)
        result = cu_device_get_name(name_buffer, len(name_buffer), device)
        if result != 0:
            return [], _cuda_driver_error(cuda, result)
        name = name_buffer.value.decode("utf-8", errors="replace").strip()

        major = ctypes.c_int()
        minor = ctypes.c_int()
        result = cu_device_compute_capability(ctypes.byref(major), ctypes.byref(minor), device)
        if result != 0:
            return [], _cuda_driver_error(cuda, result)

        memory_total_bytes: int | None = None
        if cu_device_total_mem:
            total_memory = ctypes.c_size_t()
            if cu_device_total_mem(ctypes.byref(total_memory), device) == 0:
                memory_total_bytes = int(total_memory.value)
        devices.append(
            TranscodeHardwareDevice(
                id=f"cuda{ordinal}",
                name=name or f"NVIDIA GPU {ordinal}",
                vendor="nvidia",
                backend="cuda",
                compute_capability=f"{major.value}.{minor.value}",
                memory_total_bytes=memory_total_bytes,
                device_class=_device_class_from_name(name),
            )
        )
    return devices, None


def _detect_nvidia_devices() -> tuple[list[TranscodeHardwareDevice], str | None]:
    executable = _nvidia_smi_path()
    if not executable:
        return _detect_nvidia_devices_via_cuda()
    try:
        completed = subprocess.run(
            [
                executable,
                "--query-gpu=index,name,driver_version,memory.total,compute_cap",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return [], str(exc)
    if completed.returncode != 0:
        return [], (completed.stderr or completed.stdout or "nvidia-smi failed").strip()[-1000:]
    devices: list[TranscodeHardwareDevice] = []
    for line in (completed.stdout or "").splitlines():
        fields = [item.strip() for item in line.split(",")]
        if len(fields) < 5:
            continue
        index, name, driver_version, memory_total, compute_capability = fields[:5]
        try:
            memory_total_bytes = int(float(memory_total) * 1024 * 1024)
        except (TypeError, ValueError):
            memory_total_bytes = None
        devices.append(
            TranscodeHardwareDevice(
                id=f"cuda{index}",
                name=name or f"NVIDIA GPU {index}",
                vendor="nvidia",
                backend="cuda",
                driver_version=driver_version or None,
                compute_capability=compute_capability or None,
                memory_total_bytes=memory_total_bytes,
                device_class=_device_class_from_name(name),
            )
        )
    return devices, None if devices else "nvidia-smi did not report a GPU"


def _list_decoder_codecs(ffmpeg_path: str) -> list[str]:
    try:
        completed = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-decoders"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if completed.returncode != 0:
        return []
    codecs: set[str] = set()
    for line in (completed.stdout or "").splitlines():
        match = re.match(r"^\s*[A-Z\.]{6}\s+([A-Za-z0-9_.-]+)\s", line)
        if match:
            name = match.group(1)
            if name.endswith("_cuvid"):
                codecs.add(name.removesuffix("_cuvid"))
    return sorted(codecs)


def _encoder_options(ffmpeg_path: str, encoder: str) -> list[str]:
    try:
        completed = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-h", f"encoder={encoder}"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if completed.returncode != 0:
        return []
    options = {
        match.group(1)
        for line in (completed.stdout or "").splitlines()
        if (match := re.match(r"^\s+-([A-Za-z0-9_]+)\s+<", line))
    }
    return sorted(options)


@lru_cache(maxsize=8)
def _detect_capabilities_cached(
    ffmpeg_path: str,
    render_nodes: tuple[str, ...] = (),
) -> TranscodeCapabilitiesRead:
    # Keep direct callers that used the old single-node helper working while
    # the public path now probes every automatically discovered node.
    if isinstance(render_nodes, str):
        render_nodes = (render_nodes,)
    try:
        version_result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-version"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return TranscodeCapabilitiesRead(
            ffmpeg_available=False,
            ffmpeg_path=ffmpeg_path,
            error=str(exc),
        )
    if version_result.returncode != 0:
        return TranscodeCapabilitiesRead(
            ffmpeg_available=False,
            ffmpeg_path=ffmpeg_path,
            error=(version_result.stderr or version_result.stdout or "FFmpeg failed").strip(),
        )
    version_line = (version_result.stdout or "").splitlines()[0] if version_result.stdout else None
    encoder_result = subprocess.run(
        [ffmpeg_path, "-hide_banner", "-encoders"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if encoder_result.returncode != 0:
        return TranscodeCapabilitiesRead(
            ffmpeg_available=True,
            ffmpeg_path=ffmpeg_path,
            version=version_line,
            ffmpeg_version=version_line,
            error=(encoder_result.stderr or "Unable to list FFmpeg encoders").strip(),
        )
    muxer_result = subprocess.run(
        [ffmpeg_path, "-hide_banner", "-muxers"],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    muxers: set[str] = set()
    if muxer_result.returncode == 0:
        for line in (muxer_result.stdout or "").splitlines():
            match = re.match(r"^\s*E\s+([A-Za-z0-9_,.-]+)\s", line)
            if match:
                muxers.update(match.group(1).split(","))

    listed_names: set[str] = set()
    for line in (encoder_result.stdout or "").splitlines():
        match = re.match(r"^\s*[A-Z\.]{6}\s+([A-Za-z0-9_.-]+)\s", line)
        if match:
            listed_names.add(match.group(1))
    nvidia_encoder_names = sorted(
        name for name in listed_names if name.lower().endswith("_nvenc")
    )
    nvidia_devices: list[TranscodeHardwareDevice] = []
    nvidia_detection_error: str | None = None
    nvidia_decoder_codecs: list[str] = []
    if nvidia_encoder_names:
        nvidia_devices, nvidia_detection_error = _detect_nvidia_devices()
        nvidia_decoder_codecs = _list_decoder_codecs(ffmpeg_path)
        for device in nvidia_devices:
            device.decoder_codecs = list(nvidia_decoder_codecs)
            device.encoder_names = []
            device.encoder_codecs = []
    native_adapters = (
        _windows_d3d11_adapters(ffmpeg_path)
        if _is_windows()
        and not _is_linux()
        and any(
            name.lower().endswith(suffix)
            for suffix in ("_amf", "_qsv")
            for name in listed_names
        )
        else ()
    )
    if native_adapters:
        devices = _build_hardware_device_inventory(
            listed_names,
            render_nodes,
            nvidia_devices,
            native_adapters=native_adapters,
        )
    else:
        # Keep the original three-argument call path intact for older
        # integrations that replace the inventory helper in-process.
        devices = _build_hardware_device_inventory(
            listed_names,
            render_nodes,
            nvidia_devices,
        )
    videotoolbox_encoder_names = sorted(
        name for name in listed_names if name.lower().endswith("_videotoolbox")
    )
    if _is_macos() and videotoolbox_encoder_names:
        devices.append(
            _device_for_backend(
                "videotoolbox",
                0,
                vendor="apple",
                name="Apple VideoToolbox (automatic)",
            )
        )
    known = {**VIDEO_ENCODER_CODECS, **AUDIO_ENCODER_CODECS, **SUBTITLE_ENCODER_CODECS}
    for name in listed_names:
        inferred_codec = _hardware_encoder_codec(name)
        if inferred_codec:
            known.setdefault(name, inferred_codec)
    capabilities: list[TranscodeEncoderCapability] = []
    probe_errors: dict[str, list[str]] = {device.id: [] for device in devices}
    successful_encoder_names: dict[str, list[str]] = {device.id: [] for device in devices}

    def probe_targets(encoder: str) -> list[tuple[TranscodeHardwareDevice | None, str | None]]:
        backend = _hardware_backend(encoder)
        candidates = [
            device
            for device in devices
            if device.backend == backend
        ]
        if candidates:
            return [(device, device.render_node) for device in candidates]
        # A generic hardware encoder such as a future D3D/V4L2 backend can
        # still prove itself without a separately enumerable device.  CUDA,
        # VAAPI, and QSV on Linux intentionally fail closed when their
        # required device is not visible.
        return [(None, None)]

    for name in sorted(listed_names & set(known)):
        hardware = _is_hardware_encoder(name)
        tested = False
        available = True
        test_error = None
        device_ids: list[str] = []
        if hardware:
            tested = True
            successful = False
            errors: list[str] = []
            for device, render_node in probe_targets(name):
                probe_kwargs: dict[str, object] = {
                    "device_id": device.id if device is not None else None,
                }
                if device is not None and device.native_device_index is not None:
                    probe_kwargs["native_device_index"] = device.native_device_index
                available_for_target, target_error = _test_hardware_encoder(
                    ffmpeg_path,
                    name,
                    render_node,
                    **probe_kwargs,
                )
                if available_for_target:
                    successful = True
                    if device is not None:
                        device_ids.append(device.id)
                        successful_encoder_names[device.id].append(name)
                elif target_error:
                    errors.append(target_error)
                    if device is not None:
                        probe_errors[device.id].append(target_error)
            available = successful
            test_error = next(iter(errors), None)
        quality_spec = _encoder_quality_spec(name)
        capabilities.append(
            TranscodeEncoderCapability(
                name=name,
                codec=known[name],
                hardware=hardware,
                available=available,
                tested=tested,
                test_error=test_error,
                device_ids=sorted(set(device_ids)),
                options=_encoder_options(ffmpeg_path, name)
                if name in VIDEO_ENCODER_CODECS or hardware
                else [],
                quality_mode=quality_spec[0] if quality_spec else None,
                quality_min=quality_spec[1] if quality_spec else None,
                quality_max=quality_spec[2] if quality_spec else None,
                quality_default=quality_spec[3] if quality_spec else None,
                quality_step=quality_spec[4] if quality_spec else None,
            )
        )
    tested_at = utc_now()
    for device in devices:
        names = sorted(set(successful_encoder_names[device.id]))
        device.encoder_names = names
        device.encoder_codecs = sorted(
            {
                VIDEO_ENCODER_CODECS[name]
                for name in names
                if name in VIDEO_ENCODER_CODECS
            }
        )
        device.last_tested_at = tested_at
        device.status = "available" if names else "unavailable"
        if not names:
            device.failure_reason = next(iter(probe_errors[device.id]), None)
            if device.backend == "cuda" and not device.failure_reason:
                device.failure_reason = nvidia_detection_error or "No CUDA encoder passed its runtime smoke test"
            elif device.backend == "videotoolbox" and not device.failure_reason:
                device.failure_reason = "VideoToolbox did not pass its runtime smoke test"
    return TranscodeCapabilitiesRead(
        ffmpeg_available=True,
        ffmpeg_path=ffmpeg_path,
        version=version_line,
        ffmpeg_version=version_line,
        encoders=capabilities,
        devices=devices,
        decoder_codecs=nvidia_decoder_codecs,
        platform=sys.platform,
        last_tested_at=tested_at,
        dolby_vision_passthrough=bool({"matroska", "mp4"} & muxers),
    )


def get_transcode_capabilities(settings: Settings, *, refresh: bool = False) -> TranscodeCapabilitiesRead:
    with CAPABILITIES_LOCK:
        if refresh:
            _detect_capabilities_cached.cache_clear()
        render_nodes = _resolve_hardware_render_nodes(getattr(settings, "hardware_render_node", None))
        return _detect_capabilities_cached(settings.ffmpeg_path, render_nodes).model_copy(deep=True)


def _available_encoder(capabilities: TranscodeCapabilitiesRead, *preferred: str) -> str | None:
    available = {item.name for item in capabilities.encoders if item.available}
    return next((name for name in preferred if name in available), None)


def _preferred_hardware_encoders(codec: str) -> tuple[str, ...]:
    """Return a platform-aware preference order for automatic profiles.

    The order is only a preference.  Availability still comes from the
    device-specific smoke probes, so an Intel CPU/iGPU Quick Sync engine, an
    AMD APU VCN engine, a discrete AMD/NVIDIA/Intel adapter, or an Apple media
    engine can win without a vendor setting in the user's configuration.
    """

    if _is_macos():
        backends = ("videotoolbox", "qsv", "vaapi", "cuda", "amf")
    elif _is_windows():
        backends = ("cuda", "amf", "qsv", "vaapi", "videotoolbox")
    else:
        backends = ("cuda", "qsv", "vaapi", "amf", "videotoolbox")
    return tuple(f"{codec}_{backend}" for backend in backends)


def _listed_encoder(capabilities: TranscodeCapabilitiesRead, *preferred: str) -> str | None:
    """Choose a listed encoder even when its runtime probe failed.

    Hardware-required profile plans must surface a concrete failed hardware
    encoder (and its probe error) instead of silently switching to CPU.
    """
    listed = {item.name for item in capabilities.encoders}
    return next((name for name in preferred if name in listed), None)


def _default_subtitle_encoder(container: str) -> str:
    if container == "mp4":
        return "mov_text"
    if container == "webm":
        return "webvtt"
    return "srt"


def _source_container(media_file: MediaFile) -> str:
    """Return the closest supported muxer for the source file.

    The default profile is intentionally lossless at stream level.  Keeping a
    supported source container where possible avoids an unnecessary remux
    conversion and means the default plan really is a copy operation.
    """
    extension = (media_file.extension or Path(media_file.filename).suffix.lstrip(".")).lower()
    if extension not in CONTAINER_FORMATS:
        return "mkv"
    compatibility = CONTAINER_COMPATIBILITY.get(extension)
    if compatibility:
        source_streams = {
            "video": media_file.video_streams,
            "audio": media_file.audio_streams,
            "subtitle": media_file.subtitle_streams,
        }
        for kind, streams in source_streams.items():
            if any((stream.codec or "").lower() not in compatibility[kind] for stream in streams):
                return "mkv"
    return extension


def _profile_plan(
    media_file: MediaFile,
    profile: str,
    capabilities: TranscodeCapabilitiesRead,
    *,
    output_mode: str | None = None,
    execution_mode: str | None = None,
) -> TranscodePlan:
    dynamic_range = "preserve"
    if profile == "compatibility":
        container = _source_container(media_file)
        video_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy")
            for stream in media_file.video_streams
        ]
        audio_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy")
            for stream in media_file.audio_streams
        ]
        subtitle_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy")
            for stream in media_file.subtitle_streams
        ]
    elif profile == "storage":
        container = "mkv"
        preferred_hardware = _preferred_hardware_encoders("hevc")
        video_encoder = (
            _available_encoder(capabilities, *preferred_hardware)
            if execution_mode != "cpu_only"
            else None
        )
        video_encoder = video_encoder or (
            _listed_encoder(capabilities, *preferred_hardware)
            if execution_mode == "hardware_required"
            else None
        ) or _available_encoder(capabilities, "libx265") or "libx265"
        video_plans = [
            TranscodeStreamPlan(
                stream_index=stream.stream_index,
                action="encode",
                codec="hevc",
                encoder=video_encoder,
                crf=22,
                preset="medium",
            )
            for stream in media_file.video_streams
        ]
        audio_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy", language=stream.language)
            for stream in media_file.audio_streams
        ]
        subtitle_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy", language=stream.language)
            for stream in media_file.subtitle_streams
        ]
    else:
        container = "mkv"
        preferred_hardware = _preferred_hardware_encoders("av1")
        video_encoder = (
            _available_encoder(capabilities, *preferred_hardware)
            if execution_mode != "cpu_only"
            else None
        )
        video_encoder = video_encoder or (
            _listed_encoder(capabilities, *preferred_hardware)
            if execution_mode == "hardware_required"
            else None
        ) or _available_encoder(capabilities, "libsvtav1", "libaom-av1") or "libsvtav1"
        video_plans = [
            TranscodeStreamPlan(
                stream_index=stream.stream_index,
                action="encode",
                codec="av1",
                encoder=video_encoder,
                crf=30,
                preset="6" if video_encoder == "libsvtav1" else None,
            )
            for stream in media_file.video_streams
        ]
        audio_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy", language=stream.language)
            for stream in media_file.audio_streams
        ]
        subtitle_plans = [
            TranscodeStreamPlan(stream_index=stream.stream_index, action="copy", language=stream.language)
            for stream in media_file.subtitle_streams
        ]
    return TranscodePlan(
        profile=profile,
        container=container,
        video_streams=video_plans,
        audio_streams=audio_plans,
        subtitle_streams=subtitle_plans,
        dynamic_range=dynamic_range,
        filename_template=DEFAULT_FILENAME_TEMPLATE,
        filename_template_override=False,
        include_subtitle_languages=False,
        output_mode=output_mode,
        execution_mode=execution_mode,
    )


def initial_transcode_profiles(
    media_file: MediaFile,
    capabilities: TranscodeCapabilitiesRead,
    *,
    output_mode: str | None = None,
    execution_mode: str | None = None,
) -> dict[str, TranscodePlan]:
    return {
        profile: _profile_plan(
            media_file,
            profile,
            capabilities,
            output_mode=output_mode,
            execution_mode=execution_mode,
        )
        for profile in ("compatibility", "storage", "modern")
    }


def _stream_codec_map(media_file: MediaFile) -> dict[tuple[str, int], str]:
    result: dict[tuple[str, int], str] = {}
    for stream in media_file.video_streams:
        result[("video", stream.stream_index)] = (stream.codec or "").lower()
    for stream in media_file.audio_streams:
        result[("audio", stream.stream_index)] = (stream.codec or "").lower()
    for stream in media_file.subtitle_streams:
        result[("subtitle", stream.stream_index)] = (stream.codec or "").lower()
    return result


def _encoder_codec(encoder: str | None) -> str | None:
    if not encoder:
        return None
    return ({**VIDEO_ENCODER_CODECS, **AUDIO_ENCODER_CODECS, **SUBTITLE_ENCODER_CODECS}).get(encoder)


def _sanitize_filename(value: str, *, suffix: str) -> str:
    candidate = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", "_", value)
    candidate = re.sub(r"\s+", " ", candidate).strip(" .")
    if not candidate:
        candidate = "transcoded"
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    if candidate.upper() in reserved:
        candidate = f"_{candidate}"
    max_stem = max(32, 240 - len(suffix))
    return candidate[:max_stem].rstrip(" .") or "transcoded"


def _token_values(media_file: MediaFile, plan: TranscodePlan) -> dict[str, str]:
    primary_video = next((item for item in plan.video_streams if item.action != TranscodeStreamAction.drop), None)
    source_video = media_file.video_streams[0] if media_file.video_streams else None
    width = primary_video.width if primary_video and primary_video.width else (source_video.width if source_video else None)
    height = primary_video.height if primary_video and primary_video.height else (source_video.height if source_video else None)
    codec = (
        (primary_video.codec or _encoder_codec(primary_video.encoder))
        if primary_video and primary_video.action == TranscodeStreamAction.encode
        else (source_video.codec if source_video else None)
    )
    def selected_languages(
        decisions: list[TranscodeStreamPlan],
        sources: list[AudioStream | SubtitleStream],
    ) -> set[str]:
        values: set[str] = set()
        for decision in decisions:
            if decision.action == TranscodeStreamAction.drop:
                continue
            source = next((item for item in sources if item.stream_index == decision.stream_index), None)
            language = (decision.language or (source.language if source else None) or "").strip()
            if language:
                values.add(language)
        return values

    audio_languages = selected_languages(plan.audio_streams, media_file.audio_streams)
    subtitle_languages = selected_languages(plan.subtitle_streams, media_file.subtitle_streams)
    external_rows = {item.id: item for item in media_file.external_subtitles}
    for decision in plan.external_subtitles:
        if decision.action == "drop":
            continue
        row = external_rows.get(decision.subtitle_id)
        language = (decision.language or (row.language if row else None) or "").strip()
        if language:
            subtitle_languages.add(language)
    bitrate = primary_video.bitrate if primary_video else None
    return {
        "resolution": f"{width}x{height}" if width and height else "",
        "dynRange": plan.dynamic_range if plan.dynamic_range != "preserve" else (media_file.primary_video_hdr_type or ""),
        "codec": (codec or "").upper(),
        "audioLanguages": "+".join(sorted(audio_languages)),
        "subtitleLanguages": "+".join(sorted(subtitle_languages)),
        "container": plan.container.upper(),
        "videoBitrate": f"{round(bitrate / 1_000_000, 1):g}Mbps" if bitrate else "",
    }


def _effective_filename_template(plan: TranscodePlan) -> str:
    if plan.filename_template_override is False:
        template = DEFAULT_FILENAME_TEMPLATE
        if plan.include_subtitle_languages:
            template += " [{subtitleLanguages}]"
        return template
    return plan.filename_template


def render_output_filename(media_file: MediaFile, plan: TranscodePlan) -> str:
    template = _effective_filename_template(plan)
    unknown_tokens = set(re.findall(r"\{([^{}]+)\}", template)) - FILENAME_TOKENS
    if unknown_tokens:
        raise ValueError(f"Unsupported filename token(s): {', '.join(sorted(unknown_tokens))}")
    rendered = template
    for token, value in _token_values(media_file, plan).items():
        rendered = rendered.replace(f"{{{token}}}", value)
    rendered = re.sub(r"\[\s*[,;|+\-]*\s*\]", "", rendered)
    rendered = re.sub(r"([\[,;|+])\s*([,;|+])", r"\1", rendered)
    rendered = re.sub(r"\s*,\s*(?=\])", "", rendered)
    rendered = re.sub(r"\[\s*,\s*", "[", rendered)
    rendered = re.sub(r"\s+", " ", rendered).strip(" ,;|+-")
    suffix = f".{plan.container}"
    stem = _sanitize_filename(f"{Path(media_file.filename).stem} {rendered}".strip(), suffix=suffix)
    return f"{stem}{suffix}"


def _dynamic_range_filter(dynamic_range: str) -> str | None:
    if dynamic_range == "sdr":
        return "zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p"
    if dynamic_range == "hdr10":
        return "zscale=t=linear:npl=100,format=gbrpf32le,tonemap=clip,zscale=p=bt2020:t=smpte2084:m=bt2020nc:r=tv,format=yuv420p10le"
    if dynamic_range == "hlg":
        return "zscale=t=linear:npl=100,format=gbrpf32le,tonemap=clip,zscale=p=bt2020:t=arib-std-b67:m=bt2020nc:r=tv,format=yuv420p10le"
    return None


def _output_codec(kind: str, decision: TranscodeStreamPlan, source_codec: str) -> str:
    if decision.action in {TranscodeStreamAction.keep, TranscodeStreamAction.copy}:
        return source_codec
    return (decision.codec or _encoder_codec(decision.encoder) or "").lower()


def _normalize_plan_languages(plan: TranscodePlan) -> tuple[TranscodePlan, list[str]]:
    """Canonicalize stream language metadata and report malformed tags."""
    normalized_plan = plan.model_copy(deep=True)
    errors: list[str] = []
    decisions = [
        *normalized_plan.video_streams,
        *normalized_plan.audio_streams,
        *normalized_plan.subtitle_streams,
    ]
    for decision in decisions:
        if decision.action == TranscodeStreamAction.keep:
            decision.action = TranscodeStreamAction.copy
        raw = decision.language
        if not raw:
            continue
        normalized = normalize_language_tag(raw)
        if normalized is None:
            errors.append(f"Invalid BCP 47 language tag for stream {decision.stream_index}: {raw}")
        else:
            decision.language = normalized
    for decision in normalized_plan.external_subtitles:
        raw = decision.language
        if not raw:
            continue
        normalized = normalize_language_tag(raw)
        if normalized is None:
            errors.append(f"Invalid BCP 47 language tag for external subtitle {decision.subtitle_id}: {raw}")
        else:
            decision.language = normalized
    return normalized_plan, errors


def _validate_video_scale(source: VideoStream, decision: TranscodeStreamPlan) -> str | None:
    """Reject upscaling and aspect-ratio changes in a user-supplied plan."""
    if decision.width is None and decision.height is None:
        return None
    if source.width is None or source.height is None or source.width <= 0 or source.height <= 0:
        return "Video scaling requires known source dimensions"
    target_width = decision.width
    target_height = decision.height
    if target_width is None:
        target_width = max(2, round(source.width * target_height / source.height / 2) * 2)
    if target_height is None:
        target_height = max(2, round(source.height * target_width / source.width / 2) * 2)
    if target_width > source.width or target_height > source.height:
        return (
            f"Video stream {decision.stream_index} may only be downscaled "
            f"(source {source.width}x{source.height}, requested {target_width}x{target_height})"
        )
    if (decision.width is not None and decision.width % 2) or (decision.height is not None and decision.height % 2):
        return f"Video stream {decision.stream_index} scaling dimensions must be even"
    source_ratio = source.width / source.height
    target_ratio = target_width / target_height
    if abs(source_ratio - target_ratio) > max(0.01, source_ratio * 0.01):
        return (
            f"Video stream {decision.stream_index} scaling must preserve the source aspect ratio "
            f"({source.width}x{source.height} → {target_width}x{target_height})"
        )
    return None


def _quote_command(arguments: list[str]) -> str:
    return subprocess.list2cmdline(arguments) if os.name == "nt" else shlex.join(arguments)


def _append_stream_options(
    arguments: list[str],
    kind_letter: str,
    output_index: int,
    decision: TranscodeStreamPlan,
    source: VideoStream | AudioStream | SubtitleStream,
    dynamic_range: str,
    *,
    hardware_device_name: str | None = None,
) -> None:
    specifier = f"{kind_letter}:{output_index}"
    if decision.action in {TranscodeStreamAction.keep, TranscodeStreamAction.copy}:
        arguments.extend([f"-c:{specifier}", "copy"])
    else:
        encoder = decision.encoder or decision.codec
        hardware_backend = _hardware_backend(encoder) if kind_letter == "v" else None
        filters: list[str] = []
        if encoder:
            arguments.extend([f"-c:{specifier}", encoder])
        if decision.bitrate:
            arguments.extend([f"-b:{specifier}", str(decision.bitrate)])
        quality = decision.cq if decision.cq is not None else decision.crf
        if quality is not None:
            quality_spec = _encoder_quality_spec(encoder or "")
            if quality_spec:
                quality_option = _quality_option(quality_spec[0])
            elif hardware_backend == "vaapi":
                # Keep a conservative fallback for an unknown VAAPI encoder
                # reported by a future FFmpeg build.
                quality_option = "qp"
            elif hardware_backend == "qsv":
                quality_option = "global_quality"
            elif decision.cq is not None:
                quality_option = "cq"
            else:
                quality_option = "crf"
            arguments.extend([f"-{quality_option}:{specifier}", f"{quality:g}"])
        if decision.width or decision.height:
            width = decision.width or -2
            height = decision.height or -2
            filters.append(f"scale={width}:{height}:force_original_aspect_ratio=decrease")
        effective_pixel_format = decision.pixel_format
        if kind_letter == "v":
            dynamic_filter = _dynamic_range_filter(dynamic_range)
            if dynamic_filter:
                filters.append(dynamic_filter)
            if dynamic_range == "hdr10":
                arguments.extend([f"-color_primaries:{specifier}", "bt2020", f"-color_trc:{specifier}", "smpte2084", f"-colorspace:{specifier}", "bt2020nc"])
            elif dynamic_range == "hlg":
                arguments.extend([f"-color_primaries:{specifier}", "bt2020", f"-color_trc:{specifier}", "arib-std-b67", f"-colorspace:{specifier}", "bt2020nc"])
            elif dynamic_range == "preserve":
                if source.color_primaries:
                    arguments.extend([f"-color_primaries:{specifier}", source.color_primaries])
                if source.color_transfer:
                    arguments.extend([f"-color_trc:{specifier}", source.color_transfer])
                if source.color_space:
                    arguments.extend([f"-colorspace:{specifier}", source.color_space])
                source_hdr = (source.hdr_type or "").lower()
                if not effective_pixel_format and source_hdr not in {"", "sdr"} and (source.bit_depth or 0) >= 10:
                    effective_pixel_format = source.pix_fmt or "yuv420p10le"
            if hardware_backend and hardware_device_name:
                upload_filter = _hardware_upload_filter(
                    hardware_backend,
                    source,
                    effective_pixel_format,
                    qsv_direct=hardware_device_name == "qs",
                )
                if upload_filter:
                    filters.append(upload_filter)
        if filters:
            arguments.extend([f"-filter:{specifier}", ",".join(filters)])
        if decision.frame_rate:
            arguments.extend([f"-r:{specifier}", f"{decision.frame_rate:g}"])
        # Hardware encoders consume the uploaded VAAPI/QSV surface format;
        # passing a software ``-pix_fmt`` would force FFmpeg to negotiate
        # away from that surface and commonly fails with an opaque format error.
        uses_uploaded_hardware_surface = hardware_backend in {"cuda", "vaapi", "qsv"} and hardware_device_name
        if effective_pixel_format and not uses_uploaded_hardware_surface:
            arguments.extend([f"-pix_fmt:{specifier}", effective_pixel_format])
        if decision.profile:
            arguments.extend([f"-profile:{specifier}", decision.profile])
        if decision.level:
            arguments.extend([f"-level:{specifier}", decision.level])
        if decision.preset and hardware_backend not in {"vaapi", "videotoolbox"}:
            arguments.extend([f"-preset:{specifier}", decision.preset])
        if decision.gop_size:
            arguments.extend([f"-g:{specifier}", str(decision.gop_size)])
    language = decision.language or getattr(source, "language", None)
    if language:
        arguments.extend([f"-metadata:s:{specifier}", f"language={language}"])
    if decision.title:
        arguments.extend([f"-metadata:s:{specifier}", f"title={decision.title}"])
    disposition: list[str] = []
    if getattr(source, "default_flag", False):
        disposition.append("default")
    if getattr(source, "forced_flag", False):
        disposition.append("forced")
    arguments.extend([f"-disposition:{specifier}", "+".join(disposition) if disposition else "0"])


def _effective_output_mode(plan: TranscodePlan, app_settings=None) -> str:
    if plan.output_mode:
        return plan.output_mode
    return getattr(getattr(app_settings, "transcoding", None), "default_output_mode", None) or "same_directory"


def _nearest_existing_parent(path: Path) -> Path:
    candidate = path
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate


def _effective_device_id_for_backend(
    capabilities: TranscodeCapabilitiesRead,
    app_settings,
    backend: str,
) -> str | None:
    selected = app_settings.transcoding.selected_devices
    if isinstance(selected, list):
        for candidate in selected:
            if any(device.id == candidate and device.backend == backend for device in capabilities.devices):
                return candidate
        return None
    return next((device.id for device in capabilities.devices if device.backend == backend), None)


def _select_hardware_device_for_encoder(
    capabilities: TranscodeCapabilitiesRead,
    app_settings,
    encoder: str,
) -> TranscodeHardwareDevice | None:
    """Select the first probed adapter that can run ``encoder``.

    ``selected_devices=auto`` is intentionally resolved at request time, not
    during installation.  This makes hot-plugged GPUs, Docker passthrough,
    hybrid laptops, and driver updates behave consistently after a capability
    refresh.  Explicit selections remain respected and fail validation when
    they cannot run the requested encoder.
    """

    backend = _hardware_backend(encoder)
    if backend is None:
        return None
    capability = next((item for item in capabilities.encoders if item.name == encoder), None)
    if capability is None:
        return None
    candidates = [
        device
        for device in capabilities.devices
        if device.backend == backend and device.status == "available"
    ]
    selected = app_settings.transcoding.selected_devices
    if isinstance(selected, list):
        selected_ids = set(selected)
        candidates = [device for device in candidates if device.id in selected_ids]
    if capability.device_ids:
        probed_ids = set(capability.device_ids)
        candidates = [device for device in candidates if device.id in probed_ids]
    elif any(device.encoder_names for device in candidates):
        candidates = [device for device in candidates if encoder in device.encoder_names]
    return candidates[0] if candidates else None


def _hardware_render_node_for_encoder(
    settings: Settings,
    device: TranscodeHardwareDevice | None,
) -> str | None:
    if device is not None and device.render_node:
        return device.render_node
    return _resolve_hardware_render_node(getattr(settings, "hardware_render_node", None))


def effective_cpu_count() -> float:
    """Return the smallest usable CPU capacity reported by the host/container."""
    fallback = float(max(1, os.cpu_count() or 1))
    try:
        affinity_count = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        affinity_count = 0
    candidates = [float(affinity_count)] if affinity_count else [fallback]
    if sys.platform.startswith("linux"):
        for quota_path in (Path("/sys/fs/cgroup/cpu.max"), Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")):
            try:
                raw = quota_path.read_text(encoding="utf-8").strip().split()
            except OSError:
                continue
            if quota_path.name == "cpu.max":
                if len(raw) < 2 or raw[0] == "max":
                    continue
                try:
                    quota = float(raw[0])
                    period = float(raw[1])
                except ValueError:
                    continue
            else:
                if not raw or raw[0] in {"-1", "max"}:
                    continue
                try:
                    quota = float(raw[0])
                    period = float(Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text(encoding="utf-8").strip())
                except (OSError, ValueError):
                    continue
            if quota > 0 and period > 0:
                candidates.append(quota / period)
    return max(1.0, min(candidates))


def effective_cpu_thread_budget(cpu_budget_percent: int, *, cpu_count: float | None = None) -> int:
    available = max(1.0, float(cpu_count if cpu_count is not None else effective_cpu_count()))
    budget = floor(available * max(1, min(100, cpu_budget_percent)) / 100)
    return max(1, min(floor(available), budget))


def transcode_capacity(settings: Settings, app_settings=None) -> dict[str, object]:
    """Return the resource capacity used by the dedicated transcode runtime."""
    resolved = app_settings
    if resolved is None:
        with SessionLocal() as db:
            resolved = get_app_settings(db, settings)
    configured_cpu_jobs = resolved.transcoding.cpu_parallel_jobs
    total_cpu_threads = effective_cpu_thread_budget(resolved.transcoding.cpu_budget_percent)
    cpu_jobs = (
        max(1, min(total_cpu_threads, int(configured_cpu_jobs)))
        if configured_cpu_jobs != "auto"
        else max(1, min(4, total_cpu_threads))
    )
    selected_devices = resolved.transcoding.selected_devices
    devices = list(selected_devices) if isinstance(selected_devices, list) else "auto"
    return {
        "cpu_threads": total_cpu_threads,
        "cpu_threads_per_job": max(1, total_cpu_threads // cpu_jobs),
        "cpu_parallel_jobs": cpu_jobs,
        "gpu_parallel_jobs_per_device": resolved.transcoding.gpu_parallel_jobs_per_device,
        "selected_devices": devices or "auto",
    }


def validate_transcode_plan(
    db: Session,
    settings: Settings,
    media_file: MediaFile,
    plan: TranscodePlan,
    *,
    output_path_override: Path | None = None,
) -> TranscodeValidationRead:
    paths = _source_paths(media_file)
    capabilities = get_transcode_capabilities(settings)
    app_settings = get_app_settings(db, settings)
    plan, language_errors = _normalize_plan_languages(plan)
    output_mode = _effective_output_mode(plan, app_settings)
    if plan.output_mode is None:
        plan.output_mode = output_mode
    execution_mode = plan.execution_mode or app_settings.transcoding.execution_mode
    plan.execution_mode = execution_mode
    errors: list[str] = []
    errors.extend(language_errors)
    warnings: list[str] = []
    kept: list[str] = []
    changed: list[str] = []
    removed: list[str] = []
    added: list[str] = []
    if not paths.source.exists() or not paths.source.is_file():
        errors.append("The source file no longer exists")
    if not media_file.video_streams:
        errors.append("Transcoding is only available for files with a regular video stream")
    if not capabilities.ffmpeg_available:
        errors.append(capabilities.error or "FFmpeg is unavailable")

    try:
        output_filename = render_output_filename(media_file, plan)
    except ValueError as exc:
        output_filename = f"{Path(media_file.filename).stem}.transcoded.{plan.container}"
        errors.append(str(exc))
    if output_mode == "replace_original":
        output_filename = paths.source.name
        output_root = paths.root
        output_path = output_path_override or paths.source
        if plan.container != paths.source.suffix.lower().lstrip("."):
            errors.append("Replacing the original requires the output container to match the source extension")
        if not plan.replacement_confirmed:
            errors.append("Replacing the original requires an explicit confirmation")
        warnings.append("The original file will be replaced in place without a byte-for-byte backup")
    elif output_mode == "transcode_output":
        output_root = Path(
            getattr(settings, "transcode_output_root", None)
            or (Path(settings.config_path) / "Transcode_Output")
        ).resolve()
        relative_parent = Path(media_file.relative_path).parent
        output_relative = Path(f"library-{media_file.library_id}") / f"root-{media_file.library_root_id or 0}"
        output_relative = output_relative / relative_parent / output_filename
        output_path = output_path_override or _safe_path_below(output_root, output_relative.as_posix())
    else:
        output_root = paths.root
        output_path = output_path_override or (paths.source.parent / output_filename)
    try:
        output_path.resolve().relative_to(output_root.resolve())
    except ValueError:
        errors.append("The output path escapes the configured output root")
    if output_mode != "replace_original" and output_path.resolve() == paths.source.resolve():
        errors.append("The output path must differ from the source path")
    writable_parent = _nearest_existing_parent(output_path.parent)
    if not writable_parent.is_dir() or not os.access(writable_parent, os.W_OK):
        errors.append(f"The output directory is not writable: {output_path.parent}")
    if output_path.exists() and output_mode != "replace_original":
        if app_settings.transcoding.existing_output == "skip":
            errors.append("The output file already exists and was skipped by policy")
        else:
            errors.append("The output file already exists and will not be overwritten")
    active_collision = db.scalar(
        select(TranscodeJob.id).where(
            TranscodeJob.output_path_snapshot == str(output_path),
            TranscodeJob.status.in_([JobStatus.queued, JobStatus.running]),
        ).limit(1)
    )
    if active_collision is not None:
        errors.append("Another active transcoding job already targets this output path")

    source_by_kind = {
        "video": {item.stream_index: item for item in media_file.video_streams},
        "audio": {item.stream_index: item for item in media_file.audio_streams},
        "subtitle": {item.stream_index: item for item in media_file.subtitle_streams},
    }
    plan_by_kind = {
        "video": plan.video_streams,
        "audio": plan.audio_streams,
        "subtitle": plan.subtitle_streams,
    }
    available_encoders = {item.name: item for item in capabilities.encoders}
    encoded_video = [
        decision
        for decision in plan.video_streams
        if decision.action == TranscodeStreamAction.encode
    ]
    selected_video_backends = {
        backend
        for decision in encoded_video
        for backend in [_hardware_backend(decision.encoder or decision.codec)]
        if backend is not None
    }
    accelerated_backends = selected_video_backends & {
        "vaapi",
        "qsv",
        "cuda",
        "amf",
        "videotoolbox",
    }
    hardware_backend = (
        next(iter(selected_video_backends))
        if len(selected_video_backends) == 1
        else "mixed"
        if selected_video_backends
        else None
    )
    selected_hardware_devices: list[TranscodeHardwareDevice] = []
    for decision in encoded_video:
        encoder = decision.encoder or decision.codec
        backend = _hardware_backend(encoder)
        if not backend:
            continue
        selected_device = _select_hardware_device_for_encoder(capabilities, app_settings, encoder or "")
        if selected_device is not None:
            selected_hardware_devices.append(selected_device)
    selected_device_ids = {device.id for device in selected_hardware_devices}
    if len(selected_device_ids) > 1:
        errors.append("All encoded video streams must use the same automatically selected hardware device")
    hardware_device_name: str | None = None
    selected_device = selected_hardware_devices[0] if selected_hardware_devices else None
    device_id = selected_device.id if selected_device is not None else None
    render_node = _hardware_render_node_for_encoder(settings, selected_device)
    for backend in accelerated_backends:
        backend_devices = [device for device in capabilities.devices if device.backend == backend]
        backend_decisions = [
            decision
            for decision in encoded_video
            if _hardware_backend(decision.encoder or decision.codec) == backend
        ]
        if not backend_decisions:
            continue
        if selected_device is None and (
            backend in {"cuda", "videotoolbox"}
            or backend_devices
            or isinstance(app_settings.transcoding.selected_devices, list)
        ):
            errors.append(
                f"{backend} encoding requires a detected, available device selected in Transcoding settings"
            )
        if backend in {"vaapi", "qsv"} and _is_linux() and not render_node:
            errors.append(
                "Linux VAAPI/QSV encoding requires an available DRM render node "
                "(for example /dev/dri/renderD128)"
            )
    if execution_mode == "hardware_required":
        if encoded_video and any(
            _hardware_backend(decision.encoder or decision.codec) is None for decision in encoded_video
        ):
            errors.append("Hardware-required mode refuses a software video encoder; choose a tested hardware encoder")
    elif execution_mode == "cpu_only" and selected_video_backends:
        errors.append("CPU-only mode refuses a hardware video encoder")
    replace_output = output_mode == "replace_original"
    arguments = [
        settings.ffmpeg_path,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y" if replace_output else "-n",
        "-threads",
        str(transcode_capacity(settings, app_settings)["cpu_threads_per_job"]),
    ]
    if accelerated_backends:
        if len(accelerated_backends) > 1:
            errors.append(
                "Encoded video streams must use one hardware backend per job so every stream shares the selected device"
            )
        qsv_direct = accelerated_backends == {"qsv"} and _is_linux()
        if (
            len(accelerated_backends) == 1
            and (
                render_node
                or accelerated_backends <= {"cuda", "amf", "videotoolbox"}
                or (
                    accelerated_backends == {"qsv"}
                    and _is_windows()
                    and selected_device is not None
                    and selected_device.native_device_index is not None
                )
            )
        ):
            arguments.extend(
                _hardware_device_arguments(
                    accelerated_backends,
                    render_node,
                    qsv_direct=qsv_direct,
                    cuda_device_id=device_id or "cuda0",
                    native_device_index=(
                        selected_device.native_device_index
                        if selected_device is not None
                        else None
                    ),
                )
            )
            # VAAPI is the base DRM device when QSV/VAAPI is selected;
            # QSV-only plans use the explicitly selected QSV child device.
            if "cuda" in accelerated_backends:
                filter_device = "cu"
                arguments.extend(["-filter_hw_device", filter_device])
                hardware_device_name = filter_device
            elif accelerated_backends == {"amf"}:
                filter_device = "amf"
                if selected_device is not None and selected_device.native_device_index is not None:
                    arguments.extend(["-filter_hw_device", filter_device])
                hardware_device_name = filter_device
            elif accelerated_backends in ({"vaapi"}, {"qsv"}):
                if (
                    accelerated_backends == {"qsv"}
                    and _is_windows()
                    and selected_device is not None
                    and selected_device.native_device_index is not None
                ):
                    # Windows QSV's ``-qsv_device`` selects the native
                    # adapter directly; unlike Linux's named DRM/QSV graph
                    # it does not create a filter device to attach here.
                    hardware_device_name = None
                else:
                    filter_device = "va" if not qsv_direct else "qs"
                    arguments.extend(["-filter_hw_device", filter_device])
                    hardware_device_name = filter_device
    arguments.extend(["-i", str(paths.source)])
    external_rows = {item.id: item for item in media_file.external_subtitles}
    selected_external: list[tuple[ExternalSubtitlePlan, ExternalSubtitle, Path]] = []
    for external in plan.external_subtitles:
        if external.action == "drop":
            continue
        row = external_rows.get(external.subtitle_id)
        if row is None:
            errors.append(f"External subtitle {external.subtitle_id} does not belong to this file")
            continue
        external_path = (paths.source.parent / row.path).resolve()
        try:
            external_path.relative_to(paths.root)
        except ValueError:
            errors.append(f"External subtitle escapes the library root: {row.path}")
            continue
        if not external_path.exists():
            errors.append(f"External subtitle no longer exists: {row.path}")
            continue
        arguments.extend(["-i", str(external_path)])
        selected_external.append((external, row, external_path))
        added.append(f"external subtitle {row.path}")

    output_counts = {"video": 0, "audio": 0, "subtitle": 0}
    kind_letter = {"video": "v", "audio": "a", "subtitle": "s"}
    for kind, decisions in plan_by_kind.items():
        seen: set[int] = set()
        for decision in decisions:
            if decision.stream_index in seen:
                errors.append(f"Stream {decision.stream_index} is selected more than once for {kind}")
                continue
            seen.add(decision.stream_index)
            source = source_by_kind[kind].get(decision.stream_index)
            label = f"{kind} stream {decision.stream_index}"
            if source is None:
                errors.append(f"{label} does not exist in the source")
                continue
            if decision.action == TranscodeStreamAction.drop:
                removed.append(label)
                continue
            source_codec = (source.codec or "").lower()
            output_codec = _output_codec(kind, decision, source_codec)
            if decision.action == TranscodeStreamAction.encode:
                encoder = decision.encoder or decision.codec
                capability = available_encoders.get(encoder or "")
                if capability is None:
                    errors.append(f"Requested encoder is not provided by this FFmpeg build: {encoder or 'none'}")
                elif not capability.available:
                    errors.append(f"Requested hardware encoder failed its capability test: {encoder}")
                if decision.codec and _encoder_codec(encoder) not in {None, decision.codec}:
                    errors.append(f"Encoder {encoder} does not produce requested codec {decision.codec}")
                if kind == "video":
                    scale_error = _validate_video_scale(source, decision)
                    if scale_error:
                        errors.append(scale_error)
                if kind == "subtitle" and source_codec in BITMAP_SUBTITLE_CODECS and output_codec in {
                    "ass",
                    "mov_text",
                    "srt",
                    "subrip",
                    "webvtt",
                }:
                    errors.append(
                        f"Bitmap subtitle stream {decision.stream_index} cannot be converted to text codec {output_codec}"
                    )
                changed.append(label)
            else:
                kept.append(label)
            compatibility = CONTAINER_COMPATIBILITY.get(plan.container)
            if compatibility and output_codec not in compatibility[kind]:
                errors.append(f"Codec {output_codec or 'unknown'} is not supported for {kind} in {plan.container}")
            arguments.extend(["-map", f"0:{decision.stream_index}"])
            _append_stream_options(
                arguments,
                kind_letter[kind],
                output_counts[kind],
                decision,
                source,
                plan.dynamic_range,
                hardware_device_name=hardware_device_name,
            )
            output_counts[kind] += 1
        for stream_index in set(source_by_kind[kind]) - seen:
            removed.append(f"{kind} stream {stream_index}")

    for input_offset, (decision, row, _path) in enumerate(selected_external, start=1):
        output_index = output_counts["subtitle"]
        arguments.extend(["-map", f"{input_offset}:0"])
        codec = decision.codec or _default_subtitle_encoder(plan.container)
        if decision.action == "copy":
            codec = "copy"
        elif codec not in available_encoders:
            errors.append(f"Requested subtitle encoder is unavailable: {codec}")
        if (row.format or "").lower() in BITMAP_SUBTITLE_CODECS and codec in {
            "ass",
            "mov_text",
            "srt",
            "subrip",
            "webvtt",
        }:
            errors.append(f"Bitmap external subtitle {row.path} cannot be converted to text codec {codec}")
        arguments.extend([f"-c:s:{output_index}", codec])
        language = decision.language or row.language
        if language:
            arguments.extend([f"-metadata:s:s:{output_index}", f"language={language}"])
        if decision.title:
            arguments.extend([f"-metadata:s:s:{output_index}", f"title={decision.title}"])
        output_counts["subtitle"] += 1

    if not output_counts["video"]:
        errors.append("At least one video stream must be kept or encoded")
    source_hdr = (media_file.primary_video_hdr_type or "").lower()
    if plan.dynamic_range == "dolby_vision":
        video_decisions = [item for item in plan.video_streams if item.action != TranscodeStreamAction.drop]
        if not capabilities.dolby_vision_passthrough:
            errors.append("This FFmpeg build has no verified Dolby Vision passthrough container")
        if "dolby" not in source_hdr:
            errors.append("Dolby Vision can only be preserved from a detected Dolby Vision source")
        if (media_file.primary_video_codec or "").lower() not in {"hevc", "h265"}:
            errors.append("Dolby Vision passthrough requires a detected HEVC video stream")
        if plan.container not in {"mkv", "mp4"}:
            errors.append("Dolby Vision passthrough is only offered for MKV or MP4")
        if any(item.action not in {TranscodeStreamAction.keep, TranscodeStreamAction.copy} for item in video_decisions):
            errors.append("MediaLyze does not synthesize Dolby Vision metadata; Dolby Vision requires video stream copy")
    elif "dolby" in source_hdr and plan.dynamic_range == "preserve" and any(
        item.action == TranscodeStreamAction.encode for item in plan.video_streams
    ):
        warnings.append("Encoding the video stream does not preserve Dolby Vision RPU metadata; choose SDR, HDR10, HLG, or stream copy")
    elif "hdr10+" in source_hdr and plan.dynamic_range == "preserve" and any(
        item.action == TranscodeStreamAction.encode for item in plan.video_streams
    ):
        warnings.append("Encoding may not preserve HDR10+ dynamic metadata; use video stream copy when exact preservation is required")
    if plan.dynamic_range != "preserve" and any(
        item.action in {TranscodeStreamAction.keep, TranscodeStreamAction.copy}
        for item in plan.video_streams
        if item.action != TranscodeStreamAction.drop
    ):
        errors.append("Dynamic-range conversion requires encoding every selected video stream")

    if plan.attachments == "keep" and plan.container == "mkv":
        arguments.extend(["-map", "0:t?", "-c:t", "copy"])
    elif plan.attachments == "keep" and plan.container != "mkv":
        warnings.append(f"Attachments are not copied to {plan.container}")
    if plan.cover == "keep" and media_file.has_embedded_cover:
        if media_file.embedded_cover_stream_index is None:
            warnings.append("The embedded cover has no source stream index and cannot be copied")
        elif plan.container not in {"mkv", "mp4"}:
            warnings.append(f"Embedded covers are not copied to {plan.container}")
        else:
            cover_output_index = output_counts["video"]
            arguments.extend(
                [
                    "-map",
                    f"0:{media_file.embedded_cover_stream_index}",
                    f"-c:v:{cover_output_index}",
                    "copy",
                    f"-disposition:v:{cover_output_index}",
                    "attached_pic",
                ]
            )
            added.append("embedded cover")
    arguments.extend(["-map_metadata", "0" if plan.metadata == "keep" else "-1"])
    arguments.extend(["-map_chapters", "0" if plan.chapters == "keep" else "-1"])
    arguments.extend(["-progress", "pipe:1", "-stats_period", "0.5", "-f", CONTAINER_FORMATS[plan.container], str(output_path)])

    hardware = [item.name for item in capabilities.encoders if item.hardware and item.available]
    return TranscodeValidationRead(
        valid=not errors,
        output_path=str(output_path),
        output_filename=output_filename,
        normalized_plan=plan,
        ffmpeg_arguments=arguments,
        ffmpeg_command=_quote_command(arguments),
        kept_streams=kept,
        changed_streams=changed,
        removed_streams=removed,
        added_streams=added,
        warnings=warnings,
        errors=errors,
        detected_hardware_encoders=hardware,
        output_mode=output_mode,
        execution_mode=execution_mode,
        device_id=device_id,
        hardware_backend=hardware_backend,
        ffmpeg_version=capabilities.version,
        cpu_thread_budget=int(transcode_capacity(settings, app_settings)["cpu_threads_per_job"]),
        cpu_budget_percent=app_settings.transcoding.cpu_budget_percent,
    )


def _group_for_source(db: Session, media_file: MediaFile) -> TranscodeVariantGroup | None:
    group = db.scalar(
        select(TranscodeVariantGroup).where(TranscodeVariantGroup.original_file_id == media_file.id).limit(1)
    )
    if group is not None:
        return group
    return db.scalar(
        select(TranscodeVariantGroup)
        .join(TranscodeVariant, TranscodeVariant.group_id == TranscodeVariantGroup.id)
        .where(TranscodeVariant.output_file_id == media_file.id)
        .limit(1)
    )


def queue_transcode_job(
    db: Session,
    settings: Settings,
    media_file: MediaFile,
    plan: TranscodePlan,
) -> tuple[TranscodeJob, TranscodeValidationRead]:
    validation = validate_transcode_plan(db, settings, media_file, plan)
    if not validation.valid:
        raise TranscodeValidationError(validation)
    plan = validation.normalized_plan
    paths = _source_paths(media_file)
    source_stat = paths.source.stat()
    group = _group_for_source(db, media_file)
    if group is None:
        group = TranscodeVariantGroup(
            library_id=media_file.library_id,
            original_file_id=media_file.id,
            original_library_root_id=media_file.library_root_id,
            original_relative_path=media_file.relative_path,
            original_filename=media_file.filename,
        )
        db.add(group)
        db.flush()
    output_path = Path(validation.output_path)
    if validation.output_mode == "transcode_output":
        output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(
        f".{output_path.stem}.medialyze-{uuid4().hex}{output_path.suffix}.part"
    )
    actual_validation = validate_transcode_plan(
        db,
        settings,
        media_file,
        plan,
        output_path_override=temporary_path,
    )
    if not actual_validation.valid:
        raise TranscodeValidationError(actual_validation)
    actual_arguments = list(actual_validation.ffmpeg_arguments)
    app_settings = get_app_settings(db, settings)
    if validation.output_mode == "transcode_output":
        output_storage_root = Path(
            getattr(settings, "transcode_output_root", None)
            or (Path(settings.config_path) / "Transcode_Output")
        ).resolve()
        output_relative_path = output_path.relative_to(output_storage_root).as_posix()
    else:
        output_storage_root = paths.root
        output_relative_path = output_path.relative_to(paths.root).as_posix()
    job = TranscodeJob(
        group_id=group.id,
        library_id=media_file.library_id,
        source_file_id=media_file.id,
        status=JobStatus.queued,
        profile=plan.profile,
        plan_version=plan.version,
        plan=plan.model_dump(mode="json"),
        ffmpeg_arguments=actual_arguments,
        ffmpeg_command=_quote_command(actual_arguments),
        warnings=validation.warnings,
        source_path_snapshot=str(paths.source),
        source_size_snapshot=source_stat.st_size,
        source_mtime_snapshot=source_stat.st_mtime,
        output_path_snapshot=validation.output_path,
        output_relative_path=output_relative_path,
        output_mode=validation.output_mode,
        output_storage_root=str(output_storage_root),
        retry_count=app_settings.transcoding.retry_count,
        cpu_budget_percent=app_settings.transcoding.cpu_budget_percent,
        cpu_thread_budget=validation.cpu_thread_budget,
        device_id=validation.device_id,
        hardware_backend=validation.hardware_backend,
        ffmpeg_version=validation.ffmpeg_version,
        remove_partial_output=app_settings.transcoding.remove_partial_output,
        on_error=app_settings.transcoding.on_error,
        temporary_path=str(temporary_path),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, validation


def _publish_without_overwrite(temporary_path: Path, output_path: Path) -> None:
    if output_path.exists():
        raise FileExistsError("The output file appeared while transcoding and was not overwritten")
    try:
        os.link(temporary_path, output_path)
    except FileExistsError:
        raise FileExistsError("The output file appeared while transcoding and was not overwritten") from None
    except OSError:
        if os.name != "nt":
            raise RuntimeError("The target filesystem cannot atomically publish the transcoded file without overwrite") from None
        os.rename(temporary_path, output_path)
        return
    temporary_path.unlink()


def _remove_temporary_output(temporary_path: Path, output_path: Path) -> None:
    expected_prefix = f".{output_path.stem}.medialyze-"
    expected_suffix = f"{output_path.suffix}.part"
    if (
        temporary_path.parent.resolve() != output_path.parent.resolve()
        or not temporary_path.name.startswith(expected_prefix)
        or not temporary_path.name.endswith(expected_suffix)
    ):
        return
    temporary_path.unlink(missing_ok=True)


def _verify_job_paths(db: Session, job: TranscodeJob, source: Path, output: Path, temporary: Path) -> None:
    group = db.get(TranscodeVariantGroup, job.group_id)
    root = db.get(LibraryRoot, group.original_library_root_id) if group and group.original_library_root_id else None
    if root is None:
        raise ValueError("The original library root no longer exists")
    resolved_root = Path(root.path).resolve()
    output_root = Path(job.output_storage_root or resolved_root).resolve()
    try:
        source.resolve().relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("The source path escapes the original library root") from exc
    for label, candidate in (("output", output), ("temporary output", temporary)):
        try:
            candidate.resolve().relative_to(output_root)
        except ValueError as exc:
            raise ValueError(f"The {label} path escapes the configured output root") from exc
    if job.output_mode != "replace_original" and source.resolve() == output.resolve():
        raise ValueError("Source and output paths must be different")
    if source.resolve() == temporary.resolve():
        raise ValueError("Source and temporary output paths must be different")


def _update_progress(job: TranscodeJob, key: str, value: str, duration: float) -> None:
    if key in {"out_time_us", "out_time_ms"}:
        try:
            raw = float(value)
        except ValueError:
            return
        seconds = raw / 1_000_000
        job.processed_seconds = max(job.processed_seconds, seconds)
        if duration > 0:
            job.progress_percent = min(99.9, max(0.0, seconds / duration * 100))
    elif key == "speed":
        job.speed = value or None
        try:
            multiplier = float(value.rstrip("x"))
        except (TypeError, ValueError):
            multiplier = 0.0
        remaining = max(0.0, duration - job.processed_seconds)
        job.eta_seconds = remaining / multiplier if multiplier > 0 else None


def execute_transcode_job(
    job_id: int,
    *,
    is_cancel_requested: Callable[[int], bool],
) -> int:
    db = SessionLocal()
    process: subprocess.Popen[str] | None = None
    temporary_path: Path | None = None
    try:
        job = db.get(TranscodeJob, job_id)
        if job is None:
            raise ValueError("Transcoding job not found")
        if job.status != JobStatus.queued:
            return job.library_id
        job.status = JobStatus.running
        job.started_at = utc_now()
        job.attempt = (job.attempt or 0) + 1
        job.error = None
        db.commit()
        source_path = Path(job.source_path_snapshot)
        output_path = Path(job.output_path_snapshot)
        temporary_path = Path(job.temporary_path or "")
        if not temporary_path.name:
            raise ValueError("Transcoding job has no temporary output path")
        _verify_job_paths(db, job, source_path, output_path, temporary_path)
        current_stat = source_path.stat()
        if current_stat.st_size != job.source_size_snapshot or current_stat.st_mtime != job.source_mtime_snapshot:
            raise ValueError("The source file changed before transcoding started")
        if output_path.exists() and job.output_mode != "replace_original":
            raise FileExistsError("The output file already exists and was not overwritten")
        _remove_temporary_output(temporary_path, output_path)
        duration = 0.0
        source = db.get(MediaFile, job.source_file_id) if job.source_file_id else None
        if source is not None:
            duration = float(source.duration_seconds or 0.0)
        process = subprocess.Popen(
            list(job.ffmpeg_arguments),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
        )
        last_commit = utc_now()
        if process.stdout is not None:
            for raw_line in process.stdout:
                if is_cancel_requested(job_id):
                    process.terminate()
                    raise TranscodeCancelled("Transcoding was canceled")
                line = raw_line.strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                _update_progress(job, key, value, duration)
                now = utc_now()
                if (now - last_commit).total_seconds() >= 0.5 or key == "progress":
                    db.commit()
                    last_commit = now
        stderr = process.stderr.read() if process.stderr is not None else ""
        return_code = process.wait()
        if is_cancel_requested(job_id):
            raise TranscodeCancelled("Transcoding was canceled")
        if return_code != 0:
            raise RuntimeError((stderr or f"FFmpeg exited with code {return_code}").strip()[-32000:])
        current_stat = source_path.stat()
        if current_stat.st_size != job.source_size_snapshot or current_stat.st_mtime != job.source_mtime_snapshot:
            raise ValueError("The source file changed while transcoding; the temporary result was discarded")
        if not temporary_path.exists() or temporary_path.stat().st_size <= 0:
            raise RuntimeError("FFmpeg completed without producing a valid output file")
        if job.output_mode == "replace_original":
            os.replace(temporary_path, output_path)
        else:
            _publish_without_overwrite(temporary_path, output_path)
        variant = TranscodeVariant(
            group_id=job.group_id,
            job_id=job.id,
            original_file_id=job.source_file_id,
            library_root_id=source.library_root_id if source else None,
            output_relative_path=job.output_relative_path,
            output_filename=output_path.name,
            source_path_snapshot=job.source_path_snapshot,
            output_path_snapshot=job.output_path_snapshot,
            output_mode=job.output_mode,
            analysis_status="awaiting_analysis",
            output_file_id=source.id if job.output_mode == "replace_original" and source is not None else None,
        )
        if source is not None and job.output_mode == "replace_original":
            source.is_transcode_variant = False
            job.result_file_id = source.id
        db.add(variant)
        job.status = JobStatus.completed
        job.progress_percent = 100.0
        job.processed_seconds = duration or job.processed_seconds
        job.eta_seconds = 0.0
        job.finished_at = utc_now()
        db.commit()
        return job.library_id
    except TranscodeCancelled as exc:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        job = db.get(TranscodeJob, job_id)
        if job is not None:
            job.status = JobStatus.canceled
            job.error = str(exc)
            job.finished_at = utc_now()
            db.commit()
        return job.library_id if job is not None else 0
    except Exception as exc:
        if process is not None and process.poll() is None:
            process.kill()
        job = db.get(TranscodeJob, job_id)
        if job is not None:
            job.status = JobStatus.failed
            job.error = (str(exc) or exc.__class__.__name__)[-32000:]
            job.finished_at = utc_now()
            db.commit()
            return job.library_id
        raise
    finally:
        job_for_cleanup = db.get(TranscodeJob, job_id)
        if (
            temporary_path is not None
            and "output_path" in locals()
            and (job_for_cleanup is None or job_for_cleanup.remove_partial_output)
        ):
            _remove_temporary_output(temporary_path, output_path)
        db.close()


def cancel_transcode_job(db: Session, job_id: int) -> TranscodeJob:
    job = db.get(TranscodeJob, job_id)
    if job is None:
        raise ValueError("Transcoding job not found")
    if job.status == JobStatus.queued:
        job.status = JobStatus.canceled
        job.finished_at = utc_now()
        if job.temporary_path and job.remove_partial_output:
            _remove_temporary_output(Path(job.temporary_path), Path(job.output_path_snapshot))
        db.commit()
        db.refresh(job)
    return job


def recover_orphaned_transcode_jobs(db: Session) -> int:
    jobs = db.scalars(
        select(TranscodeJob).where(TranscodeJob.status.in_([JobStatus.queued, JobStatus.running]))
    ).all()
    finished = utc_now()
    for job in jobs:
        job.status = JobStatus.canceled
        job.error = "Canceled during startup recovery"
        job.finished_at = finished
        if job.temporary_path and job.remove_partial_output:
            _remove_temporary_output(Path(job.temporary_path), Path(job.output_path_snapshot))
    if jobs:
        db.commit()
    return len(jobs)


def reconcile_transcode_variants(db: Session, library_id: int) -> int:
    variants = db.scalars(
        select(TranscodeVariant)
        .join(TranscodeVariantGroup, TranscodeVariant.group_id == TranscodeVariantGroup.id)
        .where(TranscodeVariantGroup.library_id == library_id)
    ).all()
    reconciled = 0
    dirty = False
    for variant in variants:
        variant_changed = False
        if variant.output_mode == "transcode_output":
            if variant.analysis_status != "external":
                variant.analysis_status = "external"
                variant_changed = True
                dirty = True
                reconciled += 1
            continue
        media_file = db.get(MediaFile, variant.output_file_id) if variant.output_file_id else None
        if media_file is None:
            media_file = db.scalar(
                select(MediaFile).where(
                    MediaFile.library_id == library_id,
                    MediaFile.library_root_id == variant.library_root_id,
                    MediaFile.relative_path == variant.output_relative_path,
                ).limit(1)
            )
        if media_file is None:
            if variant.analysis_status != "awaiting_analysis":
                variant.analysis_status = "awaiting_analysis"
                variant_changed = True
                dirty = True
                reconciled += 1
            continue
        next_status = "ready" if media_file.scan_status.value == "ready" else media_file.scan_status.value
        desired_variant_flag = variant.output_mode == "same_directory"
        if media_file.is_transcode_variant != desired_variant_flag:
            media_file.is_transcode_variant = desired_variant_flag
            variant_changed = True
            dirty = True
        if variant.output_file_id != media_file.id or variant.analysis_status != next_status:
            variant.output_file_id = media_file.id
            variant.analysis_status = next_status
            variant_changed = True
            dirty = True
        job = db.get(TranscodeJob, variant.job_id) if variant.job_id else None
        if job is not None and job.result_file_id != media_file.id:
            job.result_file_id = media_file.id
            variant_changed = True
            dirty = True
        if variant_changed:
            reconciled += 1
    if dirty:
        db.commit()
    return reconciled


def _file_summary(media_file: MediaFile) -> TranscodeFileSummary:
    return TranscodeFileSummary(
        id=media_file.id,
        filename=media_file.filename,
        relative_path=media_file.relative_path,
        size_bytes=media_file.size_bytes,
        duration_seconds=media_file.duration_seconds,
        width=media_file.primary_video_width,
        height=media_file.primary_video_height,
        dynamic_range=media_file.primary_video_hdr_type,
        video_codec=media_file.primary_video_codec,
        audio_codecs=sorted({item.codec for item in media_file.audio_streams if item.codec}),
        audio_languages=sorted({item.language for item in media_file.audio_streams if item.language}),
    )


def _attachment_summaries(media_file: MediaFile) -> list[TranscodeAttachmentSummary]:
    payload = media_file.raw_ffprobe_json if isinstance(media_file.raw_ffprobe_json, dict) else {}
    streams = payload.get("streams") if isinstance(payload, dict) else None
    if not isinstance(streams, list):
        return []
    attachments: list[TranscodeAttachmentSummary] = []
    for stream in streams:
        if not isinstance(stream, dict) or stream.get("codec_type") != "attachment":
            continue
        tags = stream.get("tags") if isinstance(stream.get("tags"), dict) else {}
        normalized_tags = {str(key).lower(): str(value) for key, value in tags.items()}
        try:
            stream_index = int(stream.get("index"))
        except (TypeError, ValueError):
            continue
        attachments.append(
            TranscodeAttachmentSummary(
                stream_index=stream_index,
                codec=str(stream.get("codec_name")) if stream.get("codec_name") else None,
                filename=normalized_tags.get("filename"),
                mimetype=normalized_tags.get("mimetype"),
                title=normalized_tags.get("title"),
            )
        )
    return attachments


def serialize_transcode_job(job: TranscodeJob) -> TranscodeJobRead:
    payload = TranscodeJobRead.model_validate(job)
    payload.status = job.status.value if hasattr(job.status, "value") else str(job.status)
    return payload


def _serialize_variant(db: Session, variant: TranscodeVariant) -> TranscodeVariantRead:
    payload = TranscodeVariantRead.model_validate(variant)
    if variant.output_file_id:
        media_file = db.get(MediaFile, variant.output_file_id)
        if media_file is not None:
            payload.file = _file_summary(media_file)
    return payload


def get_file_transcode(db: Session, settings: Settings, media_file: MediaFile) -> FileTranscodeRead:
    capabilities = get_transcode_capabilities(settings)
    app_settings = get_app_settings(db, settings)
    groups = list(
        db.scalars(
            select(TranscodeVariantGroup).where(
                or_(
                    TranscodeVariantGroup.original_file_id == media_file.id,
                    TranscodeVariantGroup.id.in_(
                        select(TranscodeVariant.group_id).where(TranscodeVariant.output_file_id == media_file.id)
                    ),
                )
            )
        )
    )
    group_ids = [item.id for item in groups]
    variants = list(
        db.scalars(
            select(TranscodeVariant)
            .where(TranscodeVariant.group_id.in_(group_ids or [-1]))
            .order_by(TranscodeVariant.created_at.desc())
        )
    )
    jobs = list(
        db.scalars(
            select(TranscodeJob)
            .where(TranscodeJob.group_id.in_(group_ids or [-1]))
            .order_by(TranscodeJob.created_at.desc())
        )
    )
    original = media_file
    if groups and groups[0].original_file_id:
        original = db.get(MediaFile, groups[0].original_file_id) or media_file
    return FileTranscodeRead(
        original=_file_summary(original),
        profiles=initial_transcode_profiles(
            media_file,
            capabilities,
            output_mode=app_settings.transcoding.default_output_mode,
            execution_mode=app_settings.transcoding.execution_mode,
        ),
        attachments=_attachment_summaries(media_file),
        variants=[_serialize_variant(db, item) for item in variants],
        jobs=[serialize_transcode_job(item) for item in jobs],
    )


def list_transcode_jobs(
    db: Session,
    *,
    active_only: bool = False,
    library_id: int | None = None,
    status: JobStatus | None = None,
    started_after: datetime | None = None,
    started_before: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> TranscodeJobPageRead:
    filters = []
    if active_only:
        filters.append(TranscodeJob.status.in_([JobStatus.queued, JobStatus.running]))
    if library_id is not None:
        filters.append(TranscodeJob.library_id == library_id)
    if status is not None:
        filters.append(TranscodeJob.status == status)
    effective_start = func.coalesce(TranscodeJob.started_at, TranscodeJob.created_at)
    if started_after is not None:
        filters.append(effective_start >= started_after)
    if started_before is not None:
        filters.append(effective_start <= started_before)
    total = int(db.scalar(select(func.count(TranscodeJob.id)).where(*filters)) or 0)
    jobs = db.scalars(
        select(TranscodeJob)
        .where(*filters)
        .order_by(TranscodeJob.created_at.desc(), TranscodeJob.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return TranscodeJobPageRead(items=[serialize_transcode_job(item) for item in jobs], total=total)

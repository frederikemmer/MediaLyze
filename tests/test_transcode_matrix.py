from pathlib import Path

from backend.app.core.config import RuntimeMode, Settings
from backend.app.schemas.transcoding import (
    TranscodeCapabilitiesRead,
    TranscodeEncoderCapability,
    TranscodeHardwareDevice,
)
from backend.app.services import transcode_matrix


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        runtime_mode=RuntimeMode.desktop,
        config_path=tmp_path / "config",
        media_root=tmp_path / "media",
        frontend_dist_path=tmp_path / "frontend",
        ffmpeg_path="ffmpeg-test",
    )


def _capabilities() -> TranscodeCapabilitiesRead:
    return TranscodeCapabilitiesRead(
        ffmpeg_available=True,
        ffmpeg_path="ffmpeg-test",
        version="ffmpeg test",
        ffmpeg_version="ffmpeg test",
        encoders=[
            TranscodeEncoderCapability(name="libx264", codec="h264"),
            TranscodeEncoderCapability(name="libx265", codec="hevc"),
            TranscodeEncoderCapability(
                name="h264_nvenc",
                codec="h264",
                hardware=True,
                tested=True,
                device_ids=["cuda0"],
            ),
            TranscodeEncoderCapability(
                name="hevc_nvenc",
                codec="hevc",
                hardware=True,
                tested=True,
                device_ids=["cuda0"],
            ),
        ],
        devices=[
            TranscodeHardwareDevice(
                id="cuda0",
                name="Test GPU",
                vendor="nvidia",
                backend="cuda",
                encoder_names=["h264_nvenc", "hevc_nvenc"],
                encoder_codecs=["h264", "hevc"],
                status="available",
            )
        ],
    )


def test_matrix_uses_hardware_only_after_complete_pair_passes_and_persists(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path)
    monkeypatch.setattr(transcode_matrix, "get_transcode_capabilities", lambda *_args, **_kwargs: _capabilities())
    monkeypatch.setattr(
        transcode_matrix,
        "_create_fixture",
        lambda _ffmpeg, codec, directory: (directory / f"source-{codec}.mkv", f"fixture-{codec}"),
    )

    def fake_run(arguments: list[str], *, timeout: int = 25) -> tuple[bool, str | None]:
        if "-hwaccel" in arguments:
            if "hwdownload,format=nv12" in arguments:
                return "source-h264.mkv" in " ".join(arguments), None
            return (
                "source-h264.mkv" in " ".join(arguments) and "hevc_nvenc" in arguments,
                None,
            )
        return True, None

    monkeypatch.setattr(transcode_matrix, "_run_command", fake_run)
    monkeypatch.setattr(transcode_matrix, "MAX_PARALLEL_PROBE_JOBS", 4)
    monkeypatch.setattr(
        transcode_matrix,
        "_timed_run_command",
        lambda *_args, **_kwargs: (True, 1.0, None),
    )

    result = transcode_matrix.run_transcode_matrix_test(settings)

    assert result.status == "completed"
    matrix = result.matrices[0]
    hardware = next(
        cell for cell in matrix.cells
        if cell.decode_codec == "h264" and cell.encode_codec == "hevc"
    )
    fallback = next(
        cell for cell in matrix.cells
        if cell.decode_codec == "hevc" and cell.encode_codec == "h264"
    )
    assert hardware.status == "hardware"
    assert hardware.max_parallel_jobs == 4
    assert hardware.max_parallel_jobs_is_lower_bound is True
    assert hardware.parallel_benchmark is not None
    assert hardware.parallel_benchmark.baseline_median_seconds == 1.0
    assert [level.concurrency for level in hardware.parallel_benchmark.levels] == [1, 2, 4]
    assert fallback.status == "software"
    assert transcode_matrix.load_transcode_matrix(settings) == result


def test_parallel_capacity_reports_highest_level_before_repeatable_slowdown(monkeypatch) -> None:
    monkeypatch.setattr(transcode_matrix, "MAX_PARALLEL_PROBE_JOBS", 8)
    calls = 0

    def fake_timed_run(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        # Baseline (3), level 2 (6), and level 4 (12) retain full speed.
        # The exponential level 8 and the intervening boundary checks are slower.
        return True, 1.0 if calls <= 21 else 1.3, None

    monkeypatch.setattr(transcode_matrix, "_timed_run_command", fake_timed_run)

    maximum, lower_bound, benchmark = transcode_matrix._parallel_capacity(["ffmpeg-test"])

    assert (maximum, lower_bound) == (4, False)
    assert benchmark.baseline_median_seconds == 1.0
    assert benchmark.slowdown_limit_seconds == 1.2
    assert [level.concurrency for level in benchmark.levels] == [1, 2, 4, 5, 8]
    assert all(len(level.runs) == 3 for level in benchmark.levels)
    assert benchmark.levels[-1].passed is False


def test_matrix_does_not_accept_zero_exit_hardware_pair_without_hardware_decode(
    tmp_path, monkeypatch
) -> None:
    capabilities = _capabilities()
    monkeypatch.setattr(
        transcode_matrix,
        "_create_fixture",
        lambda _ffmpeg, codec, directory: (directory / f"source-{codec}.mkv", f"fixture-{codec}"),
    )

    def fake_run(arguments: list[str], *, timeout: int = 25) -> tuple[bool, str | None]:
        if "hwdownload,format=nv12" in arguments:
            return False, "No decoder device for codec found"
        return True, None

    monkeypatch.setattr(transcode_matrix, "_run_command", fake_run)

    result = transcode_matrix._build_matrices(_settings(tmp_path), capabilities)

    cell = next(
        cell
        for cell in result.matrices[0].cells
        if cell.decode_codec == "h264" and cell.encode_codec == "hevc"
    )
    assert cell.status == "software"
    assert cell.decoder == "software:auto"


def test_matrix_uses_available_software_mpeg2_and_mjpeg_encoders(tmp_path, monkeypatch) -> None:
    capabilities = _capabilities()
    capabilities.encoders.extend(
        [
            TranscodeEncoderCapability(name="mpeg2video", codec="mpeg2video"),
            TranscodeEncoderCapability(name="mjpeg", codec="mjpeg"),
        ]
    )
    monkeypatch.setattr(
        transcode_matrix,
        "_create_fixture",
        lambda _ffmpeg, codec, directory: (directory / f"source-{codec}.mkv", f"fixture-{codec}"),
    )
    monkeypatch.setattr(
        transcode_matrix,
        "_run_command",
        lambda arguments, **_kwargs: (False, "hardware failed") if "-hwaccel" in arguments else (True, None),
    )

    result = transcode_matrix._build_matrices(_settings(tmp_path), capabilities)
    cells = {cell.encode_codec: cell for cell in result.matrices[0].cells if cell.decode_codec == "h264"}

    assert cells["mpeg2video"].status == "software"
    assert cells["mpeg2video"].encoder == "mpeg2video"
    assert cells["mjpeg"].status == "software"
    assert cells["mjpeg"].encoder == "mjpeg"


def test_matrix_marks_missing_synthetic_source_as_not_tested(tmp_path, monkeypatch) -> None:
    capabilities = _capabilities()
    monkeypatch.setattr(
        transcode_matrix,
        "_create_fixture",
        lambda _ffmpeg, codec, directory: (
            (None, "missing") if codec == "hevc" else (directory / f"source-{codec}.mkv", "libx264")
        ),
    )
    monkeypatch.setattr(transcode_matrix, "_run_command", lambda *_args, **_kwargs: (False, "failed"))

    result = transcode_matrix._build_matrices(_settings(tmp_path), capabilities)

    assert all(
        cell.status == "not_tested"
        for cell in result.matrices[0].cells
        if cell.decode_codec == "hevc"
    )


def test_matrix_keeps_distinct_hardware_devices_separate(tmp_path, monkeypatch) -> None:
    settings = _settings(tmp_path)
    capabilities = _capabilities()
    capabilities.devices.append(
        TranscodeHardwareDevice(
            id="cuda1",
            name="Second GPU",
            vendor="nvidia",
            backend="cuda",
            encoder_names=["h264_nvenc", "hevc_nvenc"],
            encoder_codecs=["h264", "hevc"],
            status="available",
        )
    )
    for encoder in capabilities.encoders:
        if encoder.hardware:
            encoder.device_ids = ["cuda0", "cuda1"]

    monkeypatch.setattr(transcode_matrix, "_create_fixture", lambda _ffmpeg, codec, directory: (
        directory / f"source-{codec}.mkv",
        f"fixture-{codec}",
    ))
    monkeypatch.setattr(transcode_matrix, "_run_command", lambda *_args, **_kwargs: (True, None))

    result = transcode_matrix._build_matrices(settings, capabilities)

    assert result.status == "completed"
    assert {matrix.device_name for matrix in result.matrices} == {"Test GPU", "Second GPU"}
    assert len(result.matrices) == 2


def test_linux_backend_paths_with_same_render_node_share_one_physical_device() -> None:
    qsv = TranscodeHardwareDevice(
        id="qsv-renderD128",
        name="Intel GPU (renderD128) · 8086:56A6 · Quick Sync",
        vendor="intel",
        backend="qsv",
        render_node="/dev/dri/renderD128",
        status="available",
    )
    vaapi = qsv.model_copy(
        update={
            "id": "vaapi-renderD128",
            "name": "Intel GPU (renderD128) · 8086:56A6 · VAAPI",
            "backend": "vaapi",
        }
    )

    assert transcode_matrix._device_group_key(qsv) == transcode_matrix._device_group_key(vaapi)
    assert transcode_matrix._device_group_name([qsv, vaapi]) == "Intel GPU (renderD128) · 8086:56A6"


def test_windows_amf_matrix_command_binds_native_d3d11_adapter() -> None:
    device = TranscodeHardwareDevice(
        id="amf0",
        name="AMD Radeon(TM) Graphics · AMF",
        vendor="amd",
        backend="amf",
        native_device_index=1,
        status="available",
    )

    command = transcode_matrix._hardware_pair_command(
        "ffmpeg-test",
        Path("source-h264.mkv"),
        device,
        "h264_amf",
    )

    assert command is not None
    init_index = command.index("-init_hw_device")
    filter_index = command.index("-filter_hw_device")
    hwaccel_index = command.index("-hwaccel")
    assert ["-init_hw_device", "d3d11va=amf:1"] == command[init_index : init_index + 2]
    assert ["-filter_hw_device", "amf"] == command[filter_index : filter_index + 2]
    assert ["-hwaccel", "d3d11va", "-hwaccel_device", "amf"] == command[hwaccel_index : hwaccel_index + 4]

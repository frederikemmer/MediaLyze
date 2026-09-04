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
            return (
                "source-h264.mkv" in " ".join(arguments) and "hevc_nvenc" in arguments,
                None,
            )
        return True, None

    monkeypatch.setattr(transcode_matrix, "_run_command", fake_run)

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
    assert fallback.status == "software"
    assert transcode_matrix.load_transcode_matrix(settings) == result


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

import subprocess
from pathlib import Path

import backend.app.services.duplicates.perceptual as perceptual


def test_extract_frame_hash_disables_stdin_and_uses_nostdin(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    class CompletedProcess:
        stdout = bytes([0] * (perceptual.FRAME_WIDTH * perceptual.FRAME_HEIGHT))

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return CompletedProcess()

    monkeypatch.setattr(perceptual.subprocess, "run", fake_run)

    frame_hash = perceptual._extract_frame_hash("ffmpeg", tmp_path / "movie.mkv", 12.5)

    assert isinstance(frame_hash, int)
    assert captured["command"][1] == "-nostdin"
    assert captured["kwargs"]["stdin"] is subprocess.DEVNULL

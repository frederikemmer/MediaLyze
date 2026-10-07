from pathlib import Path

from backend.app.services.subtitles import detect_external_subtitles


def test_detect_external_subtitles_matches_sibling_files(tmp_path: Path) -> None:
    video = tmp_path / "movie.mkv"
    video.write_text("video")
    (tmp_path / "movie.en.srt").write_text("sub")
    (tmp_path / "movie.ger.ass").write_text("sub")
    (tmp_path / "movie.de-DE.ssa").write_text("sub")
    (tmp_path / "movie.cmn-Hans-CN.srt").write_text("sub")
    (tmp_path / "other.en.srt").write_text("sub")

    subtitles = detect_external_subtitles(video, (".srt", ".ass", ".ssa"))

    assert subtitles == [
        {"path": "movie.cmn-Hans-CN.srt", "language": "cmn-Hans-CN", "format": "srt"},
        {"path": "movie.de-DE.ssa", "language": "de-DE", "format": "ssa"},
        {"path": "movie.en.srt", "language": "en", "format": "srt"},
        {"path": "movie.ger.ass", "language": "de", "format": "ass"},
    ]


def test_sidecar_detection_does_not_inspect_unrelated_unreadable_files(tmp_path, monkeypatch):
    video = tmp_path / "movie.mkv"
    video.write_text("video")
    (tmp_path / "movie.en.srt").write_text("subtitle")
    (tmp_path / "movie.de.srt").mkdir()
    unrelated = tmp_path / "unreadable.mkv"
    unrelated.write_text("video")
    real_stat = Path.stat

    def checked_stat(path, *args, **kwargs):
        if path == unrelated:
            raise PermissionError("unrelated file is unreadable")
        return real_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", checked_stat)
    assert detect_external_subtitles(video, (".srt",)) == [
        {"path": "movie.en.srt", "language": "en", "format": "srt"},
    ]

from pathlib import Path

from backend.app.services.subtitles import detect_external_subtitles


def test_detect_external_subtitles_matches_sibling_files(tmp_path: Path) -> None:
    video = tmp_path / "movie.mkv"
    video.write_text("video")
    (tmp_path / "movie.en.srt").write_text("sub")
    (tmp_path / "movie.ger.ass").write_text("sub")
    (tmp_path / "movie.de-DE.ssa").write_text("sub")
    (tmp_path / "other.en.srt").write_text("sub")

    subtitles = detect_external_subtitles(video, (".srt", ".ass", ".ssa"))

    assert subtitles == [
        {"path": "movie.de-DE.ssa", "language": "de", "format": "ssa"},
        {"path": "movie.en.srt", "language": "en", "format": "srt"},
        {"path": "movie.ger.ass", "language": "de", "format": "ass"},
    ]

from backend.app.utils.glob_patterns import matches_ignore_pattern, normalize_ignore_patterns


def test_normalize_ignore_patterns_trims_and_deduplicates() -> None:
    assert normalize_ignore_patterns(["  *.nfo  ", "*/Extras/*", "*.nfo", ""]) == ["*.nfo", "*/Extras/*"]


def test_matches_ignore_pattern_matches_relative_paths_from_root() -> None:
    assert matches_ignore_pattern("movie.nfo", ("*.nfo",))
    assert matches_ignore_pattern("Extras/bonus.mkv", ("*/Extras/*",))
    assert matches_ignore_pattern("Sample/clip.mkv", ("*/Sample/*",))
    assert matches_ignore_pattern("Movies/trailer-1080p.mkv", ("*trailer*",))


def test_matches_ignore_pattern_matches_directories_with_trailing_slash_patterns() -> None:
    assert matches_ignore_pattern("Extras", ("Extras/",), is_dir=True)
    assert matches_ignore_pattern("Season 1/Extras", ("*/Extras/",), is_dir=True)
    assert not matches_ignore_pattern("Season 1/Featurettes", ("*/Extras/",), is_dir=True)

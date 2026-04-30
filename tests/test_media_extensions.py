from backend.app.core.config import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, get_allowed_media_extensions


def test_get_allowed_media_extensions_by_library_type() -> None:
    assert get_allowed_media_extensions("movies") == VIDEO_EXTENSIONS
    assert get_allowed_media_extensions("series") == VIDEO_EXTENSIONS
    assert get_allowed_media_extensions("music") == AUDIO_EXTENSIONS
    assert get_allowed_media_extensions("mixed") == VIDEO_EXTENSIONS + AUDIO_EXTENSIONS
    assert get_allowed_media_extensions("other") == VIDEO_EXTENSIONS + AUDIO_EXTENSIONS

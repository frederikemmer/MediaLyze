"""Media fields visibility and categorization based on library type.

This module defines which fields are relevant for which library types,
enabling type-aware visibility control in statistics, search, and UI.
"""


# Fields that are relevant for each library type
FIELDS_BY_LIBRARY_TYPE = {
    "movies": {
        "video_fields": {
            "video_codec",
            "resolution",
            "hdr_type",
            "bitrate",
            "primary_video_width",
            "primary_video_height",
            "primary_video_resolution_pixels",
            "primary_video_hdr_type",
        },
        "audio_fields": {
            "audio_codec",
            "audio_spatial_profile",
            "audio_language",
            "audio_bitrate",
        },
        "shared_fields": {
            "container",
            "duration",
            "size",
            "quality_score",
            "file_path",
            "extension",
        },
    },
    "series": {
        "video_fields": {
            "video_codec",
            "resolution",
            "hdr_type",
            "bitrate",
            "primary_video_width",
            "primary_video_height",
            "primary_video_resolution_pixels",
            "primary_video_hdr_type",
        },
        "audio_fields": {
            "audio_codec",
            "audio_spatial_profile",
            "audio_language",
            "audio_bitrate",
        },
        "shared_fields": {
            "container",
            "duration",
            "size",
            "quality_score",
            "file_path",
            "extension",
        },
    },
    "music": {
        "video_fields": set(),
        "audio_fields": {
            "audio_codec",
            "audio_spatial_profile",
            "audio_language",
            "audio_bitrate",
            # Music-specific audio fields
            "audio_title",
            "audio_artist",
            "audio_album",
            "audio_album_artist",
            "audio_genre",
            "audio_date",
            "audio_disc",
            "audio_composer",
        },
        "shared_fields": {
            "container",
            "duration",
            "size",
            "quality_score",
            "file_path",
            "extension",
        },
    },
    "mixed": {
        "video_fields": {
            "video_codec",
            "resolution",
            "hdr_type",
            "bitrate",
            "primary_video_width",
            "primary_video_height",
            "primary_video_resolution_pixels",
            "primary_video_hdr_type",
        },
        "audio_fields": {
            "audio_codec",
            "audio_spatial_profile",
            "audio_language",
            "audio_bitrate",
            "audio_title",
            "audio_artist",
            "audio_album",
            "audio_album_artist",
            "audio_genre",
            "audio_date",
            "audio_disc",
            "audio_composer",
        },
        "shared_fields": {
            "container",
            "duration",
            "size",
            "quality_score",
            "file_path",
            "extension",
        },
    },
    "other": {
        "video_fields": {
            "video_codec",
            "resolution",
            "hdr_type",
            "bitrate",
            "primary_video_width",
            "primary_video_height",
            "primary_video_resolution_pixels",
            "primary_video_hdr_type",
        },
        "audio_fields": {
            "audio_codec",
            "audio_spatial_profile",
            "audio_language",
            "audio_bitrate",
            "audio_title",
            "audio_artist",
            "audio_album",
            "audio_album_artist",
            "audio_genre",
            "audio_date",
            "audio_disc",
            "audio_composer",
        },
        "shared_fields": {
            "container",
            "duration",
            "size",
            "quality_score",
            "file_path",
            "extension",
        },
    },
}


def get_visible_fields_for_library_type(library_type: str) -> set[str]:
    """Get all visible field identifiers for a library type.
    
    Args:
        library_type: One of "movies", "series", "music", "mixed", "other"
        
    Returns:
        Set of visible field identifiers
    """
    type_fields = FIELDS_BY_LIBRARY_TYPE.get(library_type, FIELDS_BY_LIBRARY_TYPE["other"])
    return (
        type_fields["shared_fields"]
        | type_fields["video_fields"]
        | type_fields["audio_fields"]
    )


def get_video_only_fields() -> set[str]:
    """Get fields that are video-only (hidden for music libraries)."""
    return {
        "video_codec",
        "resolution",
        "hdr_type",
        "bitrate",
        "primary_video_width",
        "primary_video_height",
        "primary_video_resolution_pixels",
        "primary_video_hdr_type",
    }


def get_music_only_fields() -> set[str]:
    """Get fields that are music-only (hidden for video-only libraries)."""
    return {
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
    }


def should_hide_video_fields(library_type: str) -> bool:
    """Check if video-exclusive fields should be hidden for this library type."""
    return library_type == "music"


def should_hide_music_fields(library_type: str) -> bool:
    """Check if music-exclusive fields should be hidden for this library type."""
    return library_type in ("movies", "series")

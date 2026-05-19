/**
 * Media fields visibility and categorization based on library type (Frontend).
 * Used to determine which columns/panels/filters should be shown for each library type.
 */

import type { LibraryType } from "./api";

export type FieldCategory = "video_only" | "audio_only" | "music_only" | "audiobook_only" | "shared";

// Map of fields to their categories
export const FIELD_CATEGORIES: Record<string, FieldCategory> = {
  // Video-only fields
  video_codec: "video_only",
  resolution: "video_only",
  hdr_type: "video_only",
  bitrate: "video_only",

  // Shared fields
  file: "shared",
  size: "shared",
  container: "shared",
  duration: "shared",
  quality_score: "shared",

  // Audio fields (appear in all types that support audio)
  audio_codec: "audio_only",
  audio_spatial_profile: "audio_only",
  audio_language: "audio_only",
  audio_bitrate: "audio_only",
  bit_depth: "audio_only",

  // Music-only fields
  audio_title: "music_only",
  audio_artist: "music_only",
  audio_album: "music_only",
  audio_album_artist: "music_only",
  audio_genre: "music_only",
  audio_date: "music_only",
  audio_disc: "music_only",
  audio_composer: "music_only",
  audio_channels: "audio_only",
  sample_rate: "audio_only",
  track_number: "music_only",
  bit_rate_mode: "audio_only",
  has_embedded_cover: "music_only",
  chapter_count: "audiobook_only",
  chapter_titles: "audiobook_only",
  audiobook_narrator: "audiobook_only",
  audiobook_author: "audiobook_only",
  audiobook_publisher: "audiobook_only",
  audiobook_series: "audiobook_only",
  audiobook_series_part: "audiobook_only",
  audiobook_language: "audiobook_only",
  audiobook_abridged: "audiobook_only",
  audiobook_asin: "audiobook_only",
  audiobook_isbn: "audiobook_only",
};

/**
 * Determine if a field should be visible for a given library type.
 */
export function shouldShowField(fieldKey: string, libraryType: LibraryType): boolean {
  const category = FIELD_CATEGORIES[fieldKey] ?? "shared";

  switch (category) {
    case "video_only":
      return libraryType !== "music" && libraryType !== "audiobooks";
    case "music_only":
      return libraryType !== "movies" && libraryType !== "series";
    case "audiobook_only":
      return libraryType === "audiobooks";
    case "audio_only":
      return true; // Audio is in all types
    case "shared":
      return true; // Shared fields always visible
    default:
      return true;
  }
}

/**
 * Get all visible field keys for a library type.
 */
export function getVisibleFieldsForType(libraryType: LibraryType): Set<string> {
  return new Set(
    Object.entries(FIELD_CATEGORIES)
      .filter(([fieldKey]) => shouldShowField(fieldKey, libraryType))
      .map(([fieldKey]) => fieldKey)
  );
}

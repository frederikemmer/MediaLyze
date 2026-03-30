import type { MediaFileSortKey } from "./api";

export const LIBRARY_FILE_COLUMN_WIDTHS_STORAGE_KEY = "medialyze-library-file-column-widths";

const LIBRARY_FILE_COLUMN_WIDTH_KEYS: MediaFileSortKey[] = [
  "file",
  "size",
  "video_codec",
  "resolution",
  "hdr_type",
  "duration",
  "audio_codecs",
  "audio_languages",
  "subtitle_languages",
  "subtitle_codecs",
  "subtitle_sources",
  "mtime",
  "last_analyzed_at",
  "quality_score",
];

export type LibraryFileColumnWidths = Partial<Record<MediaFileSortKey, number>>;

function normalizeLibraryFileColumnWidths(
  payload: unknown,
): LibraryFileColumnWidths {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const candidate = payload as Record<string, unknown>;
  const normalized: LibraryFileColumnWidths = {};

  for (const key of LIBRARY_FILE_COLUMN_WIDTH_KEYS) {
    const rawValue = candidate[key];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue <= 0) {
      continue;
    }
    normalized[key] = Math.round(rawValue);
  }

  return normalized;
}

export function getLibraryFileColumnWidths(): LibraryFileColumnWidths {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(LIBRARY_FILE_COLUMN_WIDTHS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeLibraryFileColumnWidths(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveLibraryFileColumnWidths(
  widths: LibraryFileColumnWidths,
): LibraryFileColumnWidths {
  const normalized = normalizeLibraryFileColumnWidths(widths);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LIBRARY_FILE_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

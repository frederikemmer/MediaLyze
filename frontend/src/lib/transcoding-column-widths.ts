export const TRANSCODING_COLUMN_WIDTHS_STORAGE_KEY = "medialyze-transcoding-column-widths";

export const TRANSCODING_COLUMN_KEYS = [
  "file",
  "target",
  "hardware",
  "progress",
  "actions",
] as const;

export type TranscodingColumnKey = typeof TRANSCODING_COLUMN_KEYS[number];
export type TranscodingColumnWidths = Partial<Record<TranscodingColumnKey, number>>;

function normalizeTranscodingColumnWidths(payload: unknown): TranscodingColumnWidths {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const candidate = payload as Record<string, unknown>;
  const normalized: TranscodingColumnWidths = {};

  for (const key of TRANSCODING_COLUMN_KEYS) {
    const rawValue = candidate[key];
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue <= 0) {
      continue;
    }
    normalized[key] = Math.round(rawValue);
  }

  return normalized;
}

export function getTranscodingColumnWidths(): TranscodingColumnWidths {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(TRANSCODING_COLUMN_WIDTHS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeTranscodingColumnWidths(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveTranscodingColumnWidths(widths: TranscodingColumnWidths): TranscodingColumnWidths {
  const normalized = normalizeTranscodingColumnWidths(widths);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TRANSCODING_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

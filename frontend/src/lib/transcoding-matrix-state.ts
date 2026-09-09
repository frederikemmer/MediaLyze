export const TRANSCODING_MATRIX_EXPANSION_STORAGE_KEY = "medialyze-transcoding-matrix-expansion";

export type TranscodingMatrixExpansionState = Record<string, boolean>;

export type TranscodingMatrixFocus = {
  memberInstallationId: string;
  deviceId: string;
};

export function buildTranscodingMatrixEntryKey(
  memberInstallationId: string | null | undefined,
  deviceId: string,
): string {
  return `${memberInstallationId ?? "local"}:${deviceId}`;
}

export function buildTranscodingMatrixAnchorId(
  memberInstallationId: string | null | undefined,
  deviceId: string,
): string {
  return `transcode-matrix-${encodeURIComponent(buildTranscodingMatrixEntryKey(memberInstallationId, deviceId))}`;
}

function normalizeTranscodingMatrixExpansionState(value: unknown): TranscodingMatrixExpansionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: TranscodingMatrixExpansionState = {};
  for (const [key, expanded] of Object.entries(value)) {
    if (typeof expanded === "boolean") {
      normalized[key] = expanded;
    }
  }
  return normalized;
}

export function getTranscodingMatrixExpansionState(): TranscodingMatrixExpansionState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(TRANSCODING_MATRIX_EXPANSION_STORAGE_KEY);
    return raw ? normalizeTranscodingMatrixExpansionState(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveTranscodingMatrixExpansionState(
  state: TranscodingMatrixExpansionState,
): TranscodingMatrixExpansionState {
  const normalized = normalizeTranscodingMatrixExpansionState(state);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        TRANSCODING_MATRIX_EXPANSION_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {
      // Ignore storage errors; the matrix remains usable for this render.
    }
  }
  return normalized;
}

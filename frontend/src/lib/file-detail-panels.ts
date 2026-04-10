export type FileDetailPanelId =
  | "qualityBreakdown"
  | "format"
  | "videoStreams"
  | "audioStreams"
  | "subtitles"
  | "rawJson";

export type FileDetailPanelSettings = {
  order: FileDetailPanelId[];
  collapsed: Record<FileDetailPanelId, boolean>;
};

export const FILE_DETAIL_PANEL_SETTINGS_STORAGE_KEY = "medialyze-file-detail-panel-settings";

const DEFAULT_ORDER: FileDetailPanelId[] = [
  "qualityBreakdown",
  "format",
  "videoStreams",
  "audioStreams",
  "subtitles",
  "rawJson",
];

const DEFAULT_COLLAPSED: Record<FileDetailPanelId, boolean> = {
  qualityBreakdown: false,
  format: false,
  videoStreams: false,
  audioStreams: false,
  subtitles: false,
  rawJson: false,
};

function normalizeOrder(value: unknown): FileDetailPanelId[] {
  const source = Array.isArray(value) ? value : [];
  const validIds = source.filter((entry): entry is FileDetailPanelId => DEFAULT_ORDER.includes(entry as FileDetailPanelId));
  const uniqueIds = [...new Set(validIds)];
  return [...uniqueIds, ...DEFAULT_ORDER.filter((entry) => !uniqueIds.includes(entry))];
}

function normalizeCollapsed(value: unknown): Record<FileDetailPanelId, boolean> {
  if (!value || typeof value !== "object") {
    return DEFAULT_COLLAPSED;
  }

  return {
    qualityBreakdown:
      "qualityBreakdown" in value && typeof value.qualityBreakdown === "boolean"
        ? value.qualityBreakdown
        : DEFAULT_COLLAPSED.qualityBreakdown,
    format: "format" in value && typeof value.format === "boolean" ? value.format : DEFAULT_COLLAPSED.format,
    videoStreams:
      "videoStreams" in value && typeof value.videoStreams === "boolean"
        ? value.videoStreams
        : DEFAULT_COLLAPSED.videoStreams,
    audioStreams:
      "audioStreams" in value && typeof value.audioStreams === "boolean"
        ? value.audioStreams
        : DEFAULT_COLLAPSED.audioStreams,
    subtitles:
      "subtitles" in value && typeof value.subtitles === "boolean" ? value.subtitles : DEFAULT_COLLAPSED.subtitles,
    rawJson: "rawJson" in value && typeof value.rawJson === "boolean" ? value.rawJson : DEFAULT_COLLAPSED.rawJson,
  };
}

function normalizeFileDetailPanelSettings(value: unknown): FileDetailPanelSettings {
  if (!value || typeof value !== "object") {
    return {
      order: DEFAULT_ORDER,
      collapsed: DEFAULT_COLLAPSED,
    };
  }

  return {
    order: normalizeOrder("order" in value ? value.order : undefined),
    collapsed: normalizeCollapsed("collapsed" in value ? value.collapsed : undefined),
  };
}

export function getFileDetailPanelSettings(): FileDetailPanelSettings {
  if (typeof window === "undefined") {
    return normalizeFileDetailPanelSettings(undefined);
  }

  try {
    const raw = window.localStorage.getItem(FILE_DETAIL_PANEL_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeFileDetailPanelSettings(undefined);
    }
    return normalizeFileDetailPanelSettings(JSON.parse(raw));
  } catch {
    return normalizeFileDetailPanelSettings(undefined);
  }
}

export function saveFileDetailPanelSettings(settings: FileDetailPanelSettings): FileDetailPanelSettings {
  const normalized = normalizeFileDetailPanelSettings(settings);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(FILE_DETAIL_PANEL_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // ignore storage errors
    }
  }

  return normalized;
}

export function moveFileDetailPanel(
  settings: FileDetailPanelSettings,
  draggedId: FileDetailPanelId,
  targetId: FileDetailPanelId,
): FileDetailPanelSettings {
  if (draggedId === targetId) {
    return settings;
  }

  const nextOrder = [...settings.order];
  const draggedIndex = nextOrder.indexOf(draggedId);
  const targetIndex = nextOrder.indexOf(targetId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return settings;
  }

  nextOrder.splice(draggedIndex, 1);
  nextOrder.splice(targetIndex, 0, draggedId);
  return { ...settings, order: nextOrder };
}

export function toggleFileDetailPanelCollapsed(
  settings: FileDetailPanelSettings,
  panelId: FileDetailPanelId,
): FileDetailPanelSettings {
  return {
    ...settings,
    collapsed: {
      ...settings.collapsed,
      [panelId]: !settings.collapsed[panelId],
    },
  };
}

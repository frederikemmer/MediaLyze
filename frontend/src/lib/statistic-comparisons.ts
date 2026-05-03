import type {
  ComparisonBucket,
  ComparisonFieldId,
  ComparisonFieldKind,
  ComparisonRendererId,
  LibraryType,
  NumericDistributionMetricId,
} from "./api";
import { formatCodecLabel, formatContainerLabel } from "./format";
import { formatHdrType } from "./hdr";
import { buildNumericDistributionFilterExpression, formatNumericDistributionBinLabel } from "./numeric-distributions";

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;
type MusicComparisonVisibilityOptions = {
  showMusicQualityScore?: boolean;
};

export type ComparisonScope = "dashboard" | "library";
export type ComparisonSelection = {
  xField: ComparisonFieldId;
  yField: ComparisonFieldId;
  renderer: ComparisonRendererId;
};

export type ComparisonFieldDefinition = {
  id: ComparisonFieldId;
  kind: ComparisonFieldKind;
  labelKey: string;
};

const STORAGE_KEYS: Record<ComparisonScope, string> = {
  dashboard: "medialyze-comparison-selection-dashboard",
  library: "medialyze-comparison-selection-library",
};

export const COMPARISON_FIELD_DEFINITIONS: ComparisonFieldDefinition[] = [
  { id: "duration", kind: "numeric", labelKey: "libraryStatistics.items.duration" },
  { id: "size", kind: "numeric", labelKey: "libraryStatistics.items.size" },
  { id: "quality_score", kind: "numeric", labelKey: "libraryStatistics.items.qualityScore" },
  { id: "bitrate", kind: "numeric", labelKey: "libraryStatistics.items.bitrate" },
  { id: "audio_bitrate", kind: "numeric", labelKey: "libraryStatistics.items.audioBitrate" },
  { id: "resolution_mp", kind: "numeric", labelKey: "libraryStatistics.items.resolutionMp" },
  { id: "container", kind: "category", labelKey: "libraryStatistics.items.container" },
  { id: "video_codec", kind: "category", labelKey: "libraryStatistics.items.videoCodec" },
  { id: "resolution", kind: "category", labelKey: "libraryStatistics.items.resolution" },
  { id: "hdr_type", kind: "category", labelKey: "libraryStatistics.items.dynamicRange" },
];

const FIELD_MAP = new Map(COMPARISON_FIELD_DEFINITIONS.map((definition) => [definition.id, definition]));
const FILTERABLE_COMPARISON_FIELDS = new Set<ComparisonFieldId>([
  "duration",
  "size",
  "quality_score",
  "bitrate",
  "audio_bitrate",
  "container",
  "video_codec",
  "resolution",
  "hdr_type",
]);
const DEFAULT_SELECTION: ComparisonSelection = {
  xField: "duration",
  yField: "size",
  renderer: "heatmap",
};
const VIDEO_ONLY_COMPARISON_FIELDS = new Set<ComparisonFieldId>([
  "bitrate",
  "resolution_mp",
  "video_codec",
  "resolution",
  "hdr_type",
]);

export function getComparisonFieldDefinition(fieldId: ComparisonFieldId): ComparisonFieldDefinition {
  return FIELD_MAP.get(fieldId) ?? FIELD_MAP.get(DEFAULT_SELECTION.xField)!;
}

export function getAvailableComparisonRenderers(
  xField: ComparisonFieldId,
  yField: ComparisonFieldId,
): ComparisonRendererId[] {
  const xKind = getComparisonFieldDefinition(xField).kind;
  const yKind = getComparisonFieldDefinition(yField).kind;
  const renderers: ComparisonRendererId[] = ["heatmap"];
  if (xKind === "numeric" && yKind === "numeric") {
    renderers.push("scatter");
  }
  if (yKind === "numeric") {
    renderers.push("bar");
  }
  return renderers;
}

function normalizeSelection(candidate: Partial<ComparisonSelection> | null | undefined): ComparisonSelection {
  const xField = candidate?.xField && FIELD_MAP.has(candidate.xField) ? candidate.xField : DEFAULT_SELECTION.xField;
  let yField = candidate?.yField && FIELD_MAP.has(candidate.yField) ? candidate.yField : DEFAULT_SELECTION.yField;
  if (xField === yField) {
    yField = xField === DEFAULT_SELECTION.yField ? "size" : DEFAULT_SELECTION.yField;
  }
  const availableRenderers = getAvailableComparisonRenderers(xField, yField);
  return {
    xField,
    yField,
    renderer:
      candidate?.renderer && availableRenderers.includes(candidate.renderer)
        ? candidate.renderer
        : availableRenderers[0],
  };
}

export function getComparisonSelection(scope: ComparisonScope): ComparisonSelection {
  if (typeof window === "undefined") {
    return DEFAULT_SELECTION;
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS[scope]);
  if (!raw) {
    return DEFAULT_SELECTION;
  }
  try {
    return normalizeSelection(JSON.parse(raw));
  } catch {
    return DEFAULT_SELECTION;
  }
}

export function saveComparisonSelection(scope: ComparisonScope, selection: ComparisonSelection): ComparisonSelection {
  const normalized = normalizeSelection(selection);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEYS[scope], JSON.stringify(normalized));
  }
  return normalized;
}

export function sanitizeComparisonRenderer(
  xField: ComparisonFieldId,
  yField: ComparisonFieldId,
  renderer: ComparisonRendererId,
): ComparisonRendererId {
  const available = getAvailableComparisonRenderers(xField, yField);
  return available.includes(renderer) ? renderer : available[0];
}

export function getComparisonFieldDefinitionsForLibraryType(
  libraryType?: LibraryType | null,
  options?: MusicComparisonVisibilityOptions,
): ComparisonFieldDefinition[] {
  if (libraryType !== "music") {
    return COMPARISON_FIELD_DEFINITIONS;
  }
  return COMPARISON_FIELD_DEFINITIONS.filter((definition) => {
    if (VIDEO_ONLY_COMPARISON_FIELDS.has(definition.id)) {
      return false;
    }
    if (definition.id === "quality_score" && options?.showMusicQualityScore !== true) {
      return false;
    }
    return true;
  });
}

export function normalizeComparisonSelectionForLibraryType(
  selection: ComparisonSelection,
  libraryType?: LibraryType | null,
  options?: MusicComparisonVisibilityOptions,
): ComparisonSelection {
  const availableFields = getComparisonFieldDefinitionsForLibraryType(libraryType, options);
  if (availableFields.length < 2) {
    return selection;
  }

  const availableFieldIds = new Set(availableFields.map((field) => field.id));
  const firstField = availableFields[0].id;
  const secondField = availableFields[1].id;

  const xField = availableFieldIds.has(selection.xField) ? selection.xField : firstField;
  let yField = availableFieldIds.has(selection.yField) ? selection.yField : secondField;
  if (xField === yField) {
    yField = availableFields.find((field) => field.id !== xField)?.id ?? secondField;
  }

  return {
    xField,
    yField,
    renderer: sanitizeComparisonRenderer(xField, yField, selection.renderer),
  };
}

export function isComparisonFieldFilterable(fieldId: ComparisonFieldId): boolean {
  return FILTERABLE_COMPARISON_FIELDS.has(fieldId);
}

export function buildComparisonFieldFilterValue(fieldId: ComparisonFieldId, bucket: ComparisonBucket): string {
  if (getComparisonFieldDefinition(fieldId).kind === "numeric") {
    if (fieldId === "resolution_mp") {
      const segments: string[] = [];
      if (typeof bucket.lower === "number") {
        segments.push(`>=${bucket.lower}MP`);
      }
      if (typeof bucket.upper === "number") {
        segments.push(`<${bucket.upper}MP`);
      }
      return segments.join(",");
    }
    return buildNumericDistributionFilterExpression(fieldId as NumericDistributionMetricId, {
      lower: bucket.lower,
      upper: bucket.upper,
      count: 0,
      percentage: 0,
    });
  }
  return bucket.key;
}

export function formatComparisonBucketLabel(
  fieldId: ComparisonFieldId,
  bucket: ComparisonBucket,
  t: TranslationFn,
  options?: { inDepthDolbyVisionProfiles?: boolean },
): string {
  if (getComparisonFieldDefinition(fieldId).kind === "numeric") {
    if (fieldId === "resolution_mp") {
      if (bucket.lower === null && bucket.upper === null) {
        return "0 MP";
      }
      if (bucket.lower === null) {
        return `< ${bucket.upper} MP`;
      }
      if (bucket.upper === null) {
        return `${bucket.lower}+ MP`;
      }
      return `${bucket.lower} - ${bucket.upper} MP`;
    }
    return formatNumericDistributionBinLabel(fieldId as NumericDistributionMetricId, {
      lower: bucket.lower,
      upper: bucket.upper,
      count: 0,
      percentage: 0,
    });
  }
  if (fieldId === "container") {
    return formatContainerLabel(bucket.label) ?? "Unknown";
  }
  if (fieldId === "video_codec") {
    return formatCodecLabel(bucket.label, "video");
  }
  if (fieldId === "hdr_type") {
    return formatHdrType(bucket.label, options) ?? "Unknown";
  }
  return bucket.label;
}

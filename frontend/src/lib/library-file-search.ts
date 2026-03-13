import type { LucideIcon } from "lucide-react";
import {
  AudioLines,
  Captions,
  Clock3,
  FileText,
  Film,
  FolderSearch,
  Frame,
  Gauge,
  HardDrive,
  Languages,
  SlidersHorizontal,
  SunMedium,
  Waypoints,
} from "lucide-react";

import {
  LIBRARY_STATISTIC_DEFINITIONS,
  type LibraryStatisticId,
} from "./library-statistics-settings";

export type LibraryFileMetadataSearchField = LibraryStatisticId;

export type LibraryFileSearchConfig = {
  field: "file" | LibraryFileMetadataSearchField;
  icon: LucideIcon;
  labelKey: string;
  placeholderKey: string;
  tooltipKey?: string;
  validate?: (value: string) => boolean;
};

const COMPARATOR_RE = /^\s*(>=|<=|>|<|=)?\s*(.*?)\s*$/;
const SIZE_RE = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?b|b)?\s*$/i;
const DURATION_PART_RE = /(\d+(?:\.\d+)?)\s*([smhd])/gi;
const SCORE_RE = /^\d+$/;

function isValidStructuredValue(value: string, checker: (rawValue: string) => boolean): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  const match = COMPARATOR_RE.exec(trimmed);
  if (!match) {
    return false;
  }

  const rawValue = match[2].trim();
  if (!rawValue) {
    return false;
  }

  return checker(rawValue);
}

function isValidSizeValue(value: string): boolean {
  return isValidStructuredValue(value, (rawValue) => SIZE_RE.test(rawValue));
}

function isValidDurationValue(value: string): boolean {
  return isValidStructuredValue(value, (rawValue) => {
    DURATION_PART_RE.lastIndex = 0;
    const matches = Array.from(rawValue.matchAll(DURATION_PART_RE));
    if (matches.length === 0) {
      return false;
    }

    const normalizedSource = rawValue.replace(/\s+/g, "").toLowerCase();
    const normalizedMatches = matches.map((match) => match[0].replace(/\s+/g, "").toLowerCase()).join("");
    return normalizedSource === normalizedMatches;
  });
}

function isValidQualityScoreValue(value: string): boolean {
  return isValidStructuredValue(value, (rawValue) => {
    if (!SCORE_RE.test(rawValue)) {
      return false;
    }
    const score = Number(rawValue);
    return Number.isInteger(score) && score >= 1 && score <= 10;
  });
}

export const LIBRARY_FILE_SEARCH_PICKER_ICON = SlidersHorizontal;

export const LIBRARY_FILE_SEARCH_CONFIGS: LibraryFileSearchConfig[] = [
  {
    field: "file",
    icon: FolderSearch,
    labelKey: "libraryDetail.searchFields.file.label",
    placeholderKey: "libraryDetail.searchFields.file.placeholder",
  },
  {
    field: "size",
    icon: HardDrive,
    labelKey: "libraryStatistics.items.size",
    placeholderKey: "libraryDetail.searchFields.size.placeholder",
    tooltipKey: "libraryDetail.searchFields.size.tooltip",
    validate: isValidSizeValue,
  },
  {
    field: "quality_score",
    icon: Gauge,
    labelKey: "libraryStatistics.items.qualityScore",
    placeholderKey: "libraryDetail.searchFields.qualityScore.placeholder",
    tooltipKey: "libraryDetail.searchFields.qualityScore.tooltip",
    validate: isValidQualityScoreValue,
  },
  {
    field: "video_codec",
    icon: Film,
    labelKey: "libraryStatistics.items.videoCodec",
    placeholderKey: "libraryDetail.searchFields.videoCodec.placeholder",
  },
  {
    field: "resolution",
    icon: Frame,
    labelKey: "libraryStatistics.items.resolution",
    placeholderKey: "libraryDetail.searchFields.resolution.placeholder",
  },
  {
    field: "hdr_type",
    icon: SunMedium,
    labelKey: "libraryStatistics.items.hdr",
    placeholderKey: "libraryDetail.searchFields.hdr.placeholder",
  },
  {
    field: "duration",
    icon: Clock3,
    labelKey: "libraryStatistics.items.duration",
    placeholderKey: "libraryDetail.searchFields.duration.placeholder",
    tooltipKey: "libraryDetail.searchFields.duration.tooltip",
    validate: isValidDurationValue,
  },
  {
    field: "audio_codecs",
    icon: AudioLines,
    labelKey: "libraryStatistics.items.audioCodecs",
    placeholderKey: "libraryDetail.searchFields.audioCodecs.placeholder",
  },
  {
    field: "audio_languages",
    icon: Languages,
    labelKey: "libraryStatistics.items.audioLanguages",
    placeholderKey: "libraryDetail.searchFields.audioLanguages.placeholder",
  },
  {
    field: "subtitle_languages",
    icon: Captions,
    labelKey: "libraryStatistics.items.subtitleLanguages",
    placeholderKey: "libraryDetail.searchFields.subtitleLanguages.placeholder",
  },
  {
    field: "subtitle_codecs",
    icon: FileText,
    labelKey: "libraryStatistics.items.subtitleCodecs",
    placeholderKey: "libraryDetail.searchFields.subtitleCodecs.placeholder",
  },
  {
    field: "subtitle_sources",
    icon: Waypoints,
    labelKey: "libraryStatistics.items.subtitleSources",
    placeholderKey: "libraryDetail.searchFields.subtitleSources.placeholder",
  },
];

const SEARCH_CONFIG_MAP = new Map(LIBRARY_FILE_SEARCH_CONFIGS.map((config) => [config.field, config]));

export const LIBRARY_METADATA_SEARCH_FIELDS = LIBRARY_STATISTIC_DEFINITIONS.map(
  (definition) => definition.id,
);

export function getLibraryFileSearchConfig(field: "file" | LibraryFileMetadataSearchField): LibraryFileSearchConfig {
  return SEARCH_CONFIG_MAP.get(field) ?? LIBRARY_FILE_SEARCH_CONFIGS[0];
}

export function serializeLibraryFileSearchFilters(
  filters: Partial<Record<"file" | LibraryFileMetadataSearchField, string>>,
): string {
  const orderedEntries = [
    ["file", filters.file?.trim() ?? ""],
    ...LIBRARY_METADATA_SEARCH_FIELDS.map((field) => [field, filters[field]?.trim() ?? ""] as const),
  ].filter(([, value]) => value);

  return JSON.stringify(orderedEntries);
}

export function deserializeLibraryFileSearchFilters(
  value: string,
): Partial<Record<"file" | LibraryFileMetadataSearchField, string>> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Array<[string, string]>;
    const filters: Partial<Record<"file" | LibraryFileMetadataSearchField, string>> = {};
    for (const [field, fieldValue] of parsed) {
      if ((field === "file" || LIBRARY_METADATA_SEARCH_FIELDS.includes(field as LibraryStatisticId)) && fieldValue) {
        filters[field as "file" | LibraryFileMetadataSearchField] = fieldValue;
      }
    }
    return filters;
  } catch {
    return {};
  }
}

export function validateLibraryFileSearchField(
  field: LibraryFileMetadataSearchField,
  value: string,
): string | null {
  const config = getLibraryFileSearchConfig(field);
  if (!config.validate || config.validate(value)) {
    return null;
  }
  return `libraryDetail.searchFields.validation.${field}`;
}

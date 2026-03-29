import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { DistributionList, type DistributionListEntry } from "../components/DistributionList";
import { LoaderPinwheelIcon } from "../components/LoaderPinwheelIcon";
import { StatCard } from "../components/StatCard";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import {
  api,
  type DuplicateGroupPage,
  type LibraryStatistics,
  type LibrarySummary,
  type MediaFileQualityScoreDetail,
  type MediaFileRow,
  type MediaFileSortKey,
} from "../lib/api";
import { formatBytes, formatCodecLabel, formatDate, formatDuration } from "../lib/format";
import { collapseHdrDistribution, formatHdrType } from "../lib/hdr";
import {
  LIBRARY_METADATA_SEARCH_FIELDS,
  deserializeLibraryFileSearchFilters,
  getLibraryFileSearchConfig,
  serializeLibraryFileSearchFilters,
  validateLibraryFileSearchField,
  type LibraryFileMetadataSearchField,
} from "../lib/library-file-search";
import {
  LIBRARY_STATISTIC_DEFINITIONS,
  getLibraryStatisticPanelItems,
  getLibraryStatisticsSettings,
  getVisibleLibraryStatisticPanels,
  getVisibleLibraryStatisticTableColumns,
} from "../lib/library-statistics-settings";
import {
  InflightPageRequestGate,
  buildFilePageRequestKey,
  mergeUniqueFiles,
  resolveFileLoadTransition,
} from "../lib/paginated-files";
import { useScanJobs } from "../lib/scan-jobs";

type FileColumnKey = MediaFileSortKey;
type SortDirection = "asc" | "desc";

type FileColumnSizing =
  | {
      mode: "content";
      minPx?: number;
      maxPx?: number;
    }
  | {
      mode: "flex";
      minPx: number;
      fr: number;
      maxPx?: number;
    };

type FileColumnDefinition = {
  key: FileColumnKey;
  labelKey: string;
  sizing: FileColumnSizing;
  sticky?: boolean;
  hideable?: boolean;
  measureValue: (file: MediaFileRow) => string;
  render: (file: MediaFileRow) => ReactNode;
};

type CachedFileList = {
  total: number;
  items: MediaFileRow[];
};

type LibraryFileSearchFilters = Partial<Record<"file" | LibraryFileMetadataSearchField, string>>;

const PAGE_SIZE = 200;
const LOAD_MORE_THRESHOLD_ROWS = 40;
const ROW_ESTIMATE_PX = 68;
const OVERSCAN_ROWS = 12;
const DUPLICATE_PANEL_COLLAPSE_STORAGE_KEY = "medialyze-library-detail-duplicates-collapsed";
const HEADER_FONT_SIZE_PX = 12.48;
const BODY_FONT_SIZE_PX = 16;
const HEADER_FONT = `600 ${HEADER_FONT_SIZE_PX}px "Space Grotesk", system-ui, sans-serif`;
const BODY_FONT = `400 ${BODY_FONT_SIZE_PX}px "Space Grotesk", system-ui, sans-serif`;
const HEADER_LETTER_SPACING_PX = HEADER_FONT_SIZE_PX * 0.08;
const CELL_HORIZONTAL_PADDING_PX = 20;
const SORT_INDICATOR_WIDTH_PX = 18;
const librarySummaryCache = new Map<string, LibrarySummary>();
const libraryStatisticsCache = new Map<string, LibraryStatistics>();
const libraryDuplicateGroupsCache = new Map<string, DuplicateGroupPage>();
const libraryFileListCache = new Map<string, CachedFileList>();
let measurementCanvasContext: CanvasRenderingContext2D | null | undefined;

const DEFAULT_VISIBLE_COLUMNS: FileColumnKey[] = [
  "file",
  ...getVisibleLibraryStatisticTableColumns(getLibraryStatisticsSettings()),
];

function compactValues(values: string[], limit = 4): string {
  if (values.length === 0) {
    return "n/a";
  }
  const visible = values.slice(0, limit);
  return values.length > limit ? `${visible.join(", ")}, ...` : visible.join(", ");
}

function scoreMeterLabel(score: number): string {
  if (score <= 3) {
    return "low";
  }
  if (score <= 6) {
    return "medium";
  }
  return "high";
}

function sortIndicator(direction: SortDirection): string {
  return direction === "asc" ? "↑" : "↓";
}

function ariaSortValue(isActive: boolean, direction: SortDirection): "none" | "ascending" | "descending" {
  if (!isActive) {
    return "none";
  }
  return direction === "asc" ? "ascending" : "descending";
}

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementCanvasContext !== undefined) {
    return measurementCanvasContext;
  }

  if (typeof document === "undefined") {
    measurementCanvasContext = null;
    return measurementCanvasContext;
  }

  if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) {
    measurementCanvasContext = null;
    return measurementCanvasContext;
  }

  measurementCanvasContext = document.createElement("canvas").getContext("2d");
  return measurementCanvasContext;
}

function measureTextWidth(text: string, font: string, letterSpacingPx = 0): number {
  const content = text.trim();
  if (content.length === 0) {
    return 0;
  }

  const context = getMeasurementContext();
  if (!context) {
    const estimatedFontSize = font.includes(`${HEADER_FONT_SIZE_PX}px`) ? HEADER_FONT_SIZE_PX : BODY_FONT_SIZE_PX;
    return content.length * estimatedFontSize * 0.62 + Math.max(content.length - 1, 0) * letterSpacingPx;
  }

  context.font = font;
  return context.measureText(content).width + Math.max(content.length - 1, 0) * letterSpacingPx;
}

function clampWidth(widthPx: number, minPx?: number, maxPx?: number): number {
  const min = minPx ?? 0;
  const max = maxPx ?? Number.POSITIVE_INFINITY;
  return Math.min(Math.max(widthPx, min), max);
}

function buildColumnTemplate(
  columns: FileColumnDefinition[],
  files: MediaFileRow[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return columns
    .map((column) => {
      const headerWidth =
        measureTextWidth(t(column.labelKey).toUpperCase(), HEADER_FONT, HEADER_LETTER_SPACING_PX) +
        SORT_INDICATOR_WIDTH_PX +
        CELL_HORIZONTAL_PADDING_PX;
      const contentWidth = files.reduce((maxWidth, file) => {
        const valueWidth = measureTextWidth(column.measureValue(file), BODY_FONT) + CELL_HORIZONTAL_PADDING_PX;
        return Math.max(maxWidth, valueWidth);
      }, 0);
      const measuredWidth = Math.ceil(Math.max(headerWidth, contentWidth));

      if (column.sizing.mode === "content") {
        return `${Math.ceil(clampWidth(measuredWidth, column.sizing.minPx, column.sizing.maxPx))}px`;
      }

      const flexibleMinWidth = clampWidth(measuredWidth, column.sizing.minPx, column.sizing.maxPx);
      return `minmax(${Math.ceil(flexibleMinWidth)}px, ${column.sizing.fr}fr)`;
    })
    .join(" ");
}

function buildQualityTooltipContent(
  detail: MediaFileQualityScoreDetail | undefined,
  isLoading: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): ReactNode {
  if (isLoading) {
    return t("quality.loading");
  }
  if (!detail) {
    return t("quality.unavailable");
  }
  return (
    <div className="quality-tooltip-content">
      <div className="quality-tooltip-summary">
        <strong>{detail.score}/10</strong>
        <span>{t("quality.rawScore", { value: detail.score_raw.toFixed(2) })}</span>
      </div>
      {detail.breakdown.categories.map((category) => (
        <div className="quality-tooltip-row" key={category.key}>
          <div className="quality-tooltip-head">
            <strong>{t(`quality.category.${category.key}`)}</strong>
            <span>{category.score.toFixed(1)}</span>
          </div>
          <div>{t("quality.weight", { value: category.weight })}</div>
          {category.skipped ? <div>{t("quality.skipped")}</div> : null}
          {category.unknown_mapping ? <div>{t("quality.unknownMapping")}</div> : null}
        </div>
      ))}
    </div>
  );
}

function buildFileColumns(
  t: (key: string, options?: Record<string, unknown>) => string,
  detailCache: Record<number, MediaFileQualityScoreDetail>,
  detailLoading: Record<number, boolean>,
  loadDetail: (fileId: number) => void,
  showDolbyVisionProfiles: boolean,
): FileColumnDefinition[] {
  return [
    {
      key: "file",
      labelKey: "fileTable.file",
      sizing: { mode: "flex", minPx: 240, fr: 2.2, maxPx: 420 },
      sticky: true,
      hideable: false,
      measureValue: (file) => file.filename,
      render: (file) => (
        <div className="media-file-cell">
          <Link to={`/files/${file.id}`} className="file-link">
            {file.filename}
          </Link>
        </div>
      ),
    },
    {
      key: "size",
      labelKey: "fileTable.size",
      sizing: { mode: "content", minPx: 82, maxPx: 110 },
      measureValue: (file) => formatBytes(file.size_bytes),
      render: (file) => formatBytes(file.size_bytes),
    },
    {
      key: "video_codec",
      labelKey: "fileTable.codec",
      sizing: { mode: "content", minPx: 112, maxPx: 168 },
      measureValue: (file) =>
        file.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileTable.na"),
      render: (file) => (file.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileTable.na")),
    },
    {
      key: "resolution",
      labelKey: "fileTable.resolution",
      sizing: { mode: "content", minPx: 120, maxPx: 156 },
      measureValue: (file) => file.resolution ?? t("fileTable.na"),
      render: (file) => file.resolution ?? t("fileTable.na"),
    },
    {
      key: "hdr_type",
      labelKey: "fileTable.hdr",
      sizing: { mode: "content", minPx: 72, maxPx: 92 },
      measureValue: (file) => formatHdrType(file.hdr_type, showDolbyVisionProfiles) ?? t("fileTable.sdr"),
      render: (file) => formatHdrType(file.hdr_type, showDolbyVisionProfiles) ?? t("fileTable.sdr"),
    },
    {
      key: "duration",
      labelKey: "fileTable.duration",
      sizing: { mode: "content", minPx: 90, maxPx: 110 },
      measureValue: (file) => formatDuration(file.duration),
      render: (file) => formatDuration(file.duration),
    },
    {
      key: "audio_codecs",
      labelKey: "fileTable.audioCodecs",
      sizing: { mode: "content", minPx: 132, maxPx: 220 },
      measureValue: (file) => compactValues(file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio"))),
      render: (file) => compactValues(file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio"))),
    },
    {
      key: "audio_languages",
      labelKey: "fileTable.audioLanguages",
      sizing: { mode: "content", minPx: 112, maxPx: 176 },
      measureValue: (file) => compactValues(file.audio_languages),
      render: (file) => compactValues(file.audio_languages),
    },
    {
      key: "subtitle_languages",
      labelKey: "fileTable.subtitleLanguages",
      sizing: { mode: "content", minPx: 112, maxPx: 176 },
      measureValue: (file) => compactValues(file.subtitle_languages),
      render: (file) => compactValues(file.subtitle_languages),
    },
    {
      key: "subtitle_codecs",
      labelKey: "fileTable.subtitleCodecs",
      sizing: { mode: "content", minPx: 126, maxPx: 220 },
      measureValue: (file) => compactValues(file.subtitle_codecs.map((codec) => formatCodecLabel(codec, "subtitle"))),
      render: (file) => compactValues(file.subtitle_codecs.map((codec) => formatCodecLabel(codec, "subtitle"))),
    },
    {
      key: "subtitle_sources",
      labelKey: "fileTable.subtitleSources",
      sizing: { mode: "content", minPx: 110, maxPx: 170 },
      measureValue: (file) => compactValues(file.subtitle_sources, 2),
      render: (file) => compactValues(file.subtitle_sources, 2),
    },
    {
      key: "mtime",
      labelKey: "fileTable.modified",
      sizing: { mode: "content", minPx: 128, maxPx: 164 },
      measureValue: (file) => formatDate(new Date(file.mtime * 1000).toISOString()),
      render: (file) => formatDate(new Date(file.mtime * 1000).toISOString()),
    },
    {
      key: "last_analyzed_at",
      labelKey: "fileTable.lastAnalyzed",
      sizing: { mode: "content", minPx: 138, maxPx: 172 },
      measureValue: (file) => formatDate(file.last_analyzed_at),
      render: (file) => formatDate(file.last_analyzed_at),
    },
    {
      key: "quality_score",
      labelKey: "fileTable.score",
      sizing: { mode: "content", minPx: 120, maxPx: 120 },
      measureValue: (file) => `${file.quality_score}/10`,
      render: (file) => (
        <TooltipTrigger
          ariaLabel={t("quality.tooltipAria")}
          className="quality-score-tooltip-trigger"
          content={buildQualityTooltipContent(detailCache[file.id], Boolean(detailLoading[file.id]), t)}
          onOpen={() => loadDetail(file.id)}
        >
          <div className="score-cell">
            <strong>{file.quality_score}/10</strong>
            <div className="score-meter" aria-hidden="true">
              <span
                className={`score-meter-fill score-meter-fill-${scoreMeterLabel(file.quality_score)}`}
                style={{ width: `${Math.max(0, Math.min(10, file.quality_score)) * 10}%` }}
              />
            </div>
          </div>
        </TooltipTrigger>
      ),
    },
  ];
}

function findLibrarySummary(libraries: LibrarySummary[], libraryId: string) {
  return libraries.find((entry) => String(entry.id) === libraryId) ?? null;
}

function buildFileCacheKey(
  libraryId: string,
  searchFilters: string,
  sortKey: FileColumnKey,
  sortDirection: SortDirection,
) {
  return `${libraryId}::${searchFilters}::${sortKey}::${sortDirection}`;
}

function hasActiveSearchFilters(filters: LibraryFileSearchFilters): boolean {
  return Object.values(filters).some((value) => Boolean(value?.trim()));
}

function buildSearchFieldErrorMap(
  fieldValues: Partial<Record<LibraryFileMetadataSearchField, string>>,
): Partial<Record<LibraryFileMetadataSearchField, string>> {
  const nextErrors: Partial<Record<LibraryFileMetadataSearchField, string>> = {};
  for (const field of LIBRARY_METADATA_SEARCH_FIELDS) {
    const rawValue = fieldValues[field] ?? "";
    const errorKey = validateLibraryFileSearchField(field, rawValue);
    if (errorKey) {
      nextErrors[field] = errorKey;
    }
  }
  return nextErrors;
}

function buildActiveSearchFilters(
  baseSearch: string,
  selectedFields: LibraryFileMetadataSearchField[],
  fieldValues: Partial<Record<LibraryFileMetadataSearchField, string>>,
): LibraryFileSearchFilters {
  const filters: LibraryFileSearchFilters = {};
  const normalizedBaseSearch = baseSearch.trim();
  if (normalizedBaseSearch) {
    filters.file = normalizedBaseSearch;
  }

  for (const field of selectedFields) {
    const value = fieldValues[field]?.trim();
    if (value) {
      filters[field] = value;
    }
  }

  return filters;
}

function searchValueTokens(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function hasSearchValueTokens(existingValue: string | undefined, candidateValue: string): boolean {
  const existingTokens = new Set(searchValueTokens(existingValue ?? ""));
  const candidateTokens = searchValueTokens(candidateValue);
  return candidateTokens.length > 0 && candidateTokens.every((token) => existingTokens.has(token));
}

function matchesSearchTokens(candidate: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const normalizedCandidate = candidate.toLowerCase();
  return tokens.every((token) => normalizedCandidate.includes(token));
}

function readDuplicatePanelCollapsedPreference(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  const storedPreference = window.localStorage.getItem(DUPLICATE_PANEL_COLLAPSE_STORAGE_KEY);
  if (storedPreference === null) {
    return true;
  }
  return storedPreference === "true";
}

function buildCsvFallbackFilename(libraryName: string): string {
  const safeLibraryName = libraryName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Library";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `MediaLyze_${safeLibraryName}_${timestamp}.csv`;
}

export function LibraryDetailPage() {
  const { t } = useTranslation();
  const { libraryId = "" } = useParams();
  const { appSettings, libraries } = useAppData();
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary | null>(null);
  const [libraryStatistics, setLibraryStatistics] = useState<LibraryStatistics | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupPage | null>(null);
  const [duplicateSearch, setDuplicateSearch] = useState("");
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const [duplicateGroupsError, setDuplicateGroupsError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(true);
  const [isDuplicateGroupsLoading, setIsDuplicateGroupsLoading] = useState(true);
  const [isFilesLoading, setIsFilesLoading] = useState(true);
  const [isFilesRefreshing, setIsFilesRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<FileColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [sortKey, setSortKey] = useState<FileColumnKey>("file");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [baseSearch, setBaseSearch] = useState("");
  const [selectedMetadataFields, setSelectedMetadataFields] = useState<LibraryFileMetadataSearchField[]>([]);
  const [fieldValues, setFieldValues] = useState<Partial<Record<LibraryFileMetadataSearchField, string>>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [appliedSearchFilters, setAppliedSearchFilters] = useState<LibraryFileSearchFilters>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [isDuplicatesPanelCollapsed, setIsDuplicatesPanelCollapsed] = useState(() =>
    readDuplicatePanelCollapsedPreference(),
  );
  const [qualityScoreDetails, setQualityScoreDetails] = useState<Record<number, MediaFileQualityScoreDetail>>({});
  const [qualityScoreLoading, setQualityScoreLoading] = useState<Record<number, boolean>>({});
  const { activeJobs } = useScanJobs();
  const activeJob = activeJobs.find((job) => String(job.library_id) === libraryId) ?? null;
  const hadActiveJobRef = useRef(Boolean(activeJob));
  const fallbackSummary = findLibrarySummary(libraries, libraryId);
  const displayLibrary = librarySummary ?? fallbackSummary;
  const statisticsSettings = useState(() => getLibraryStatisticsSettings())[0];
  const showDolbyVisionProfiles = appSettings.feature_flags.show_dolby_vision_profiles;
  const showAnalyzedFilesCsvExport = appSettings.feature_flags.show_analyzed_files_csv_export;
  const loadQualityScoreDetail = useEffectEvent(async (fileId: number) => {
    if (qualityScoreDetails[fileId] || qualityScoreLoading[fileId]) {
      return;
    }
    setQualityScoreLoading((current) => ({ ...current, [fileId]: true }));
    try {
      const payload = await api.fileQualityScore(fileId);
      setQualityScoreDetails((current) => ({ ...current, [fileId]: payload }));
    } catch {
      // Ignore transient tooltip fetch errors.
    } finally {
      setQualityScoreLoading((current) => {
        const next = { ...current };
        delete next[fileId];
        return next;
      });
    }
  });
  const fileColumns = useMemo(
    () => buildFileColumns(t, qualityScoreDetails, qualityScoreLoading, loadQualityScoreDetail, showDolbyVisionProfiles),
    [loadQualityScoreDetail, qualityScoreDetails, qualityScoreLoading, showDolbyVisionProfiles, t],
  );
  const baseSearchConfig = useMemo(() => getLibraryFileSearchConfig("file"), []);
  const BaseSearchIcon = baseSearchConfig.icon;
  const visibleStatisticColumns = useMemo(
    () => getVisibleLibraryStatisticTableColumns(statisticsSettings),
    [statisticsSettings],
  );
  const visibleStatisticPanels = useMemo(
    () => getVisibleLibraryStatisticPanels(statisticsSettings),
    [statisticsSettings],
  );
  const activeColumns = useMemo(
    () => fileColumns.filter((column) => visibleColumns.includes(column.key)),
    [fileColumns, visibleColumns],
  );
  const activeColumnSignature = useMemo(
    () => activeColumns.map((column) => column.key).join("|"),
    [activeColumns],
  );
  const columnTemplate = useMemo(
    () => buildColumnTemplate(activeColumns, files, t),
    [activeColumns, files, t],
  );
  const orderedMetadataFieldDefinitions = useMemo(
    () => LIBRARY_STATISTIC_DEFINITIONS.filter((definition) => LIBRARY_METADATA_SEARCH_FIELDS.includes(definition.id)),
    [],
  );
  const orderedSelectedMetadataFields = useMemo(
    () =>
      orderedMetadataFieldDefinitions
        .map((definition) => definition.id)
        .filter((field) => selectedMetadataFields.includes(field)),
    [orderedMetadataFieldDefinitions, selectedMetadataFields],
  );
  const searchFieldErrors = useMemo(() => buildSearchFieldErrorMap(fieldValues), [fieldValues]);
  const hasInvalidSearchField = useMemo(
    () => Object.keys(searchFieldErrors).length > 0,
    [searchFieldErrors],
  );
  const nextSearchFilters = useMemo(
    () => buildActiveSearchFilters(baseSearch, orderedSelectedMetadataFields, fieldValues),
    [baseSearch, fieldValues, orderedSelectedMetadataFields],
  );
  const appliedSearchFilterKey = useMemo(
    () => serializeLibraryFileSearchFilters(appliedSearchFilters),
    [appliedSearchFilters],
  );
  const deferredAppliedSearchFilterKey = useDeferredValue(appliedSearchFilterKey);
  const deferredDuplicateSearch = useDeferredValue(duplicateSearch);
  const deferredAppliedSearchFilters = useMemo(
    () => deserializeLibraryFileSearchFilters(deferredAppliedSearchFilterKey),
    [deferredAppliedSearchFilterKey],
  );
  const hasAppliedSearchFilters = useMemo(
    () => hasActiveSearchFilters(deferredAppliedSearchFilters),
    [deferredAppliedSearchFilters],
  );
  const duplicateSearchTokens = useMemo(
    () => searchValueTokens(deferredDuplicateSearch),
    [deferredDuplicateSearch],
  );
  const filteredDuplicateGroups = useMemo(() => {
    if (!duplicateGroups) {
      return [];
    }
    if (duplicateSearchTokens.length === 0) {
      return duplicateGroups.items;
    }
    return duplicateGroups.items.flatMap((group) => {
      const groupMatches = matchesSearchTokens(`${group.label} ${group.signature}`, duplicateSearchTokens);
      if (groupMatches) {
        return [group];
      }

      const matchingItems = group.items.filter((item) =>
        matchesSearchTokens(`${item.filename} ${item.relative_path}`, duplicateSearchTokens),
      );
      if (matchingItems.length === 0) {
        return [];
      }

      return [{ ...group, items: matchingItems }];
    });
  }, [duplicateGroups, duplicateSearchTokens]);
  const fileQueryKey = useMemo(
    () => buildFileCacheKey(libraryId, deferredAppliedSearchFilterKey, sortKey, sortDirection),
    [deferredAppliedSearchFilterKey, libraryId, sortDirection, sortKey],
  );
  const activeFileQueryKeyRef = useRef(fileQueryKey);
  const filesRef = useRef<MediaFileRow[]>([]);
  const analyzedFilesPanelRef = useRef<HTMLDivElement | null>(null);
  const pendingStatisticFocusFieldRef = useRef<LibraryFileMetadataSearchField | null>(null);
  const dataTableShellRef = useRef<HTMLDivElement | null>(null);
  const searchToolsHeaderRef = useRef<HTMLDivElement | null>(null);
  const searchToolsBodyRef = useRef<HTMLDivElement | null>(null);
  const inflightRequestGateRef = useRef(new InflightPageRequestGate());
  const previousLibraryIdRef = useRef(libraryId);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const statisticsAbortRef = useRef<AbortController | null>(null);
  const duplicateGroupsAbortRef = useRef<AbortController | null>(null);
  const filesAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const hasMoreFiles = files.length < filesTotal;

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => dataTableShellRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN_ROWS,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const toggleMetadataField = useEffectEvent((field: LibraryFileMetadataSearchField) => {
    startTransition(() => {
      setSelectedMetadataFields((current) => {
        if (current.includes(field)) {
          return current.filter((entry) => entry !== field);
        }
        return [...current, field];
      });
      setFieldValues((current) => {
        if (!(field in current)) {
          return current;
        }
        const next = { ...current };
        delete next[field];
        return next;
      });
    });
  });

  const removeMetadataField = useEffectEvent((field: LibraryFileMetadataSearchField) => {
    startTransition(() => {
      setSelectedMetadataFields((current) => current.filter((entry) => entry !== field));
      setFieldValues((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    });
  });

  const updateMetadataFieldValue = useEffectEvent((field: LibraryFileMetadataSearchField, value: string) => {
    startTransition(() => {
      setFieldValues((current) => ({ ...current, [field]: value }));
    });
  });

  const applyStatisticFilter = useEffectEvent((field: LibraryFileMetadataSearchField, rawValue: string) => {
    const normalizedValue = rawValue.trim();
    if (!normalizedValue) {
      return;
    }

    const shouldFocusField = !selectedMetadataFields.includes(field);

    startTransition(() => {
      setSelectedMetadataFields((current) => (current.includes(field) ? current : [...current, field]));
      setFieldValues((current) => {
        if ((current[field]?.trim() ?? "") === normalizedValue) {
          return current;
        }
        return { ...current, [field]: normalizedValue };
      });
    });

    if (shouldFocusField) {
      pendingStatisticFocusFieldRef.current = field;
    }
    requestAnimationFrame(() => {
      analyzedFilesPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  });

  const loadLibrarySummary = useEffectEvent(async (showLoading = false) => {
    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;

    if (showLoading) {
      setIsSummaryLoading(true);
    }

    try {
      const payload = await api.librarySummary(libraryId, controller.signal);
      librarySummaryCache.set(libraryId, payload);
      setLibrarySummary(payload);
      setSummaryError(null);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      setSummaryError((reason as Error).message);
    } finally {
      if (summaryAbortRef.current === controller) {
        summaryAbortRef.current = null;
      }
      if (showLoading) {
        setIsSummaryLoading(false);
      }
    }
  });

  const loadLibraryStatistics = useEffectEvent(async (showLoading = false) => {
    statisticsAbortRef.current?.abort();
    const controller = new AbortController();
    statisticsAbortRef.current = controller;

    if (showLoading) {
      setIsStatisticsLoading(true);
    }

    try {
      const payload = await api.libraryStatistics(libraryId, controller.signal);
      libraryStatisticsCache.set(libraryId, payload);
      setLibraryStatistics(payload);
      setStatisticsError(null);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      setStatisticsError((reason as Error).message);
    } finally {
      if (statisticsAbortRef.current === controller) {
        statisticsAbortRef.current = null;
      }
      if (showLoading) {
        setIsStatisticsLoading(false);
      }
    }
  });

  const loadDuplicateGroups = useEffectEvent(async (showLoading = false) => {
    duplicateGroupsAbortRef.current?.abort();
    const controller = new AbortController();
    duplicateGroupsAbortRef.current = controller;

    if (showLoading) {
      setIsDuplicateGroupsLoading(true);
    }

    try {
      const payload = await api.libraryDuplicates(libraryId, { offset: 0, limit: 25, signal: controller.signal });
      libraryDuplicateGroupsCache.set(libraryId, payload);
      setDuplicateGroups(payload);
      setDuplicateGroupsError(null);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      setDuplicateGroupsError((reason as Error).message);
    } finally {
      if (duplicateGroupsAbortRef.current === controller) {
        duplicateGroupsAbortRef.current = null;
      }
      if (showLoading) {
        setIsDuplicateGroupsLoading(false);
      }
    }
  });

  const loadFilesPage = useEffectEvent(async (offset: number, append: boolean, queryKey: string) => {
    const requestKey = buildFilePageRequestKey(queryKey, offset);
    if (!inflightRequestGateRef.current.begin(requestKey)) {
      return;
    }

    filesAbortRef.current?.abort();
    const controller = new AbortController();
    filesAbortRef.current = controller;

    if (append) {
      setIsLoadingMore(true);
    } else if (filesRef.current.length > 0 && previousLibraryIdRef.current === libraryId) {
      setIsFilesRefreshing(true);
    } else {
      setIsFilesLoading(true);
    }

    try {
      const payload = await api.libraryFiles(libraryId, {
        offset,
        limit: PAGE_SIZE,
        filters: deferredAppliedSearchFilters,
        sortKey,
        sortDirection,
        signal: controller.signal,
      });
      if (activeFileQueryKeyRef.current !== queryKey) {
        return;
      }

      const nextItems = append ? mergeUniqueFiles(filesRef.current, payload.items) : payload.items;
      libraryFileListCache.set(queryKey, { total: payload.total, items: nextItems });
      startTransition(() => {
        setFiles(nextItems);
        setFilesTotal(payload.total);
      });
      setFilesError(null);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      if (activeFileQueryKeyRef.current === queryKey) {
        setFilesError((reason as Error).message);
      }
    } finally {
      inflightRequestGateRef.current.end(requestKey);
      if (filesAbortRef.current === controller) {
        filesAbortRef.current = null;
      }
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsFilesLoading(false);
        setIsFilesRefreshing(false);
      }
    }
  });

  const exportCsv = useEffectEvent(async () => {
    if (!displayLibrary || hasInvalidSearchField || isExporting) {
      return;
    }

    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    setExportError(null);

    try {
      const payload = await api.downloadLibraryFilesCsv(libraryId, {
        filters: deferredAppliedSearchFilters,
        sortKey,
        sortDirection,
        signal: controller.signal,
      });
      const objectUrl = window.URL.createObjectURL(payload.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = payload.filename ?? buildCsvFallbackFilename(displayLibrary.name);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      setExportError((reason as Error).message);
    } finally {
      if (exportAbortRef.current === controller) {
        exportAbortRef.current = null;
      }
      setIsExporting(false);
    }
  });

  function updateSort(nextKey: FileColumnKey) {
    startTransition(() => {
      if (sortKey === nextKey) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortKey(nextKey);
      setSortDirection(nextKey === "quality_score" ? "desc" : "asc");
    });
  }

  useEffect(() => {
    activeFileQueryKeyRef.current = fileQueryKey;
  }, [fileQueryKey]);

  useEffect(() => {
    window.localStorage.setItem(
      DUPLICATE_PANEL_COLLAPSE_STORAGE_KEY,
      isDuplicatesPanelCollapsed ? "true" : "false",
    );
  }, [isDuplicatesPanelCollapsed]);

  useEffect(() => {
    setDuplicateSearch("");
  }, [libraryId]);

  useEffect(() => {
    if (hasInvalidSearchField) {
      return;
    }
    setAppliedSearchFilters(nextSearchFilters);
  }, [hasInvalidSearchField, nextSearchFilters]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        searchToolsHeaderRef.current?.contains(event.target as Node) ||
        searchToolsBodyRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setPickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);

  useEffect(() => {
    const pendingField = pendingStatisticFocusFieldRef.current;
    if (!pendingField || !orderedSelectedMetadataFields.includes(pendingField)) {
      return;
    }

    document.getElementById(`library-metadata-search-${pendingField}`)?.focus();
    pendingStatisticFocusFieldRef.current = null;
  }, [orderedSelectedMetadataFields]);

  useEffect(() => {
    setVisibleColumns(["file", ...visibleStatisticColumns]);
  }, [visibleStatisticColumns]);

  useEffect(() => {
    if (visibleColumns.includes(sortKey)) {
      return;
    }
    setSortKey("file");
    setSortDirection("asc");
  }, [sortKey, visibleColumns]);

  useEffect(() => {
    const cachedSummary = librarySummaryCache.get(libraryId) ?? fallbackSummary ?? null;
    const cachedStatistics = libraryStatisticsCache.get(libraryId) ?? null;
    const cachedDuplicateGroups = libraryDuplicateGroupsCache.get(libraryId) ?? null;

    setLibrarySummary(cachedSummary);
    setLibraryStatistics(cachedStatistics);
    setDuplicateGroups(cachedDuplicateGroups);
    setSummaryError(null);
    setStatisticsError(null);
    setDuplicateGroupsError(null);
    setIsSummaryLoading(cachedSummary === null);
    setIsStatisticsLoading(cachedStatistics === null);
    setIsDuplicateGroupsLoading(cachedDuplicateGroups === null);

    void loadLibrarySummary(cachedSummary === null);
    void loadLibraryStatistics(cachedStatistics === null);
    void loadDuplicateGroups(cachedDuplicateGroups === null);
  }, [libraryId]);

  useEffect(() => {
    const cachedFiles = libraryFileListCache.get(fileQueryKey);
    const isSameLibrary = previousLibraryIdRef.current === libraryId;
    const currentFilesLength = filesRef.current.length;
    const transition = resolveFileLoadTransition({
      hasCachedFiles: Boolean(cachedFiles),
      currentFilesLength,
      isSameLibrary,
    });

    setFilesError(null);
    setIsLoadingMore(false);
    if (cachedFiles) {
      setFiles(cachedFiles.items);
      setFilesTotal(cachedFiles.total);
      setIsFilesLoading(false);
      setIsFilesRefreshing(true);
      previousLibraryIdRef.current = libraryId;
      void loadFilesPage(0, false, fileQueryKey);
      return;
    }

    if (transition.clearExisting) {
      setFiles([]);
      setFilesTotal(0);
    }
    setIsFilesLoading(transition.showFullLoader);
    setIsFilesRefreshing(transition.showInlineRefresh);

    previousLibraryIdRef.current = libraryId;
    void loadFilesPage(0, false, fileQueryKey);
  }, [fileQueryKey, libraryId]);

  useEffect(() => {
    if (!dataTableShellRef.current) {
      return;
    }
    dataTableShellRef.current.scrollTop = 0;
  }, [fileQueryKey]);

  useEffect(() => {
    setQualityScoreDetails({});
    setQualityScoreLoading({});
  }, [fileQueryKey]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [activeColumnSignature, rowVirtualizer]);

  useEffect(() => {
    const lastVirtualRow = virtualRows.at(-1);
    if (!lastVirtualRow || !hasMoreFiles || isFilesLoading || isLoadingMore) {
      return;
    }
    if (lastVirtualRow.index < files.length - LOAD_MORE_THRESHOLD_ROWS) {
      return;
    }
    void loadFilesPage(files.length, true, fileQueryKey);
  }, [fileQueryKey, files.length, hasMoreFiles, isFilesLoading, isLoadingMore, virtualRows]);

  useEffect(() => {
    if (hadActiveJobRef.current && !activeJob) {
      librarySummaryCache.delete(libraryId);
      libraryStatisticsCache.delete(libraryId);
      libraryDuplicateGroupsCache.delete(libraryId);
      libraryFileListCache.delete(fileQueryKey);
      setQualityScoreDetails({});
      setQualityScoreLoading({});
      void loadLibrarySummary(false);
      void loadLibraryStatistics(false);
      void loadDuplicateGroups(false);
      void loadFilesPage(0, false, fileQueryKey);
    }
    hadActiveJobRef.current = Boolean(activeJob);
  }, [activeJob, fileQueryKey, libraryId]);

  useEffect(() => {
    return () => {
      summaryAbortRef.current?.abort();
      statisticsAbortRef.current?.abort();
      duplicateGroupsAbortRef.current?.abort();
      filesAbortRef.current?.abort();
      exportAbortRef.current?.abort();
      inflightRequestGateRef.current.reset();
    };
  }, []);

  function renderExportButton(className: string) {
    return (
      <button
        type="button"
        className={className}
        aria-label={t("libraryDetail.export.aria")}
        disabled={!displayLibrary || isExporting || hasInvalidSearchField}
        onClick={() => void exportCsv()}
      >
        <span>export CSV</span>
      </button>
    );
  }

  return (
    <>
      <section className="panel stack">
        <div className="panel-title-row">
          <h2>{displayLibrary?.name ?? t("libraryDetail.loading")}</h2>
          {displayLibrary?.path ? (
            <TooltipTrigger ariaLabel={t("libraryDetail.libraryPathAria")} content={displayLibrary.path}>
              ?
            </TooltipTrigger>
          ) : null}
        </div>
        <div className="card-grid grid">
          <StatCard label={t("libraryDetail.files")} value={String(displayLibrary?.file_count ?? filesTotal)} />
          <StatCard
            label={t("libraryDetail.storage")}
            value={formatBytes(displayLibrary?.total_size_bytes ?? 0)}
            tone="teal"
          />
          <StatCard
            label={t("libraryDetail.duration")}
            value={formatDuration(displayLibrary?.total_duration_seconds ?? 0)}
            tone="blue"
          />
          <StatCard label={t("libraryDetail.lastScan")} value={formatDate(displayLibrary?.last_scan_at ?? null)} />
        </div>
        {summaryError && !displayLibrary ? <div className="notice">{summaryError}</div> : null}
        {isSummaryLoading && !displayLibrary ? (
          <div className="panel-loader">
            <LoaderPinwheelIcon className="panel-loader-icon" size={30} />
            <span>{t("libraryDetail.loading")}</span>
          </div>
        ) : null}
      </section>

      <div className="media-grid">
        {visibleStatisticPanels.length > 0 ? (
          visibleStatisticPanels.map((panel) => {
            const items =
              panel.id === "hdr_type"
                ? collapseHdrDistribution(getLibraryStatisticPanelItems(libraryStatistics, panel), showDolbyVisionProfiles)
                : getLibraryStatisticPanelItems(libraryStatistics, panel);
            const formattedItems: DistributionListEntry[] = items.map((item) => {
              const rawLabel = item.label;
              const filterValue = item.filter_value ?? rawLabel;
              const label = panel.panelFormatKind ? formatCodecLabel(rawLabel, panel.panelFormatKind) : rawLabel;
              const isApplied = hasSearchValueTokens(fieldValues[panel.id], filterValue);
              return {
                key: `${panel.id}:${rawLabel}`,
                label,
                value: item.value,
                disabled: isApplied,
                ariaLabel: isApplied
                  ? t("libraryDetail.statistics.filterAlreadyApplied", {
                      field: t(panel.nameKey),
                      value: label,
                    })
                  : t("libraryDetail.statistics.filterByValue", {
                      field: t(panel.nameKey),
                      value: label,
                    }),
                onClick: statisticsError || !libraryStatistics ? undefined : () => applyStatisticFilter(panel.id, filterValue),
              };
            });
            return (
              <AsyncPanel
                key={panel.id}
                title={t(panel.panelTitleKey ?? panel.nameKey)}
                loading={isStatisticsLoading && !libraryStatistics && !statisticsError}
                error={statisticsError}
                bodyClassName="async-panel-body-scroll"
              >
                <DistributionList items={formattedItems} maxVisibleRows={5} scrollable />
              </AsyncPanel>
            );
          })
        ) : (
          <div className="notice">{t("libraryStatistics.noPanelsSelected")}</div>
        )}
      </div>

      <AsyncPanel
        title={t("libraryDetail.duplicates.title")}
        loading={isDuplicateGroupsLoading && !duplicateGroups && !duplicateGroupsError}
        error={duplicateGroupsError}
        titleAddon={
          duplicateGroups ? <span className="badge">{duplicateGroups.total_groups}</span> : null
        }
        headerAddon={
          !isDuplicatesPanelCollapsed ? (
            <div className="data-table-search-layout duplicate-search-layout">
              <div className="metadata-search-control duplicate-search-control">
                <span className="metadata-search-icon-button" aria-hidden="true">
                  <Search size={18} />
                </span>
                <input
                  type="search"
                  value={duplicateSearch}
                  placeholder={t("libraryDetail.duplicates.searchPlaceholder")}
                  aria-label={t("libraryDetail.duplicates.searchLabel")}
                  autoComplete="off"
                  className={duplicateSearch ? "has-trailing-action" : undefined}
                  onChange={(event) => setDuplicateSearch(event.target.value)}
                />
                {duplicateSearch ? (
                  <button
                    type="button"
                    className="metadata-search-remove"
                    aria-label={t("libraryDetail.duplicates.clearSearch")}
                    onClick={() => setDuplicateSearch("")}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null
        }
        collapseState={{
          collapsed: isDuplicatesPanelCollapsed,
          onToggle: () => setIsDuplicatesPanelCollapsed((current) => !current),
          bodyId: "library-duplicates-panel-body",
        }}
      >
        {duplicateGroups && filteredDuplicateGroups.length > 0 ? (
          <div className="duplicate-group-list">
            {filteredDuplicateGroups.map((group) => (
              <div key={group.signature} className="media-card duplicate-group-card">
                <div className="duplicate-group-summary">
                  <div className="meta-tags">
                    <span className="badge">{t(`libraries.duplicateDetectionModes.${duplicateGroups.mode}`)}</span>
                    <span className="badge">{t("libraryDetail.duplicates.fileCount", { count: group.file_count })}</span>
                    <span className="badge">{formatBytes(group.total_size_bytes)}</span>
                  </div>
                  <code className="scan-log-path">{group.signature}</code>
                </div>
                <div className="scan-log-path-list">
                  {group.items.map((item) => (
                    <div key={item.id} className="scan-log-pattern-card">
                      <div className="scan-log-detail-title">
                        <Link to={`/files/${item.id}`} className="file-link">
                          {item.filename}
                        </Link>
                        <span className="badge">{formatBytes(item.size_bytes)}</span>
                      </div>
                      <code className="scan-log-path">{item.relative_path}</code>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="notice">
            {duplicateSearchTokens.length > 0
              ? t("libraryDetail.duplicates.emptySearch")
              : t("libraryDetail.duplicates.empty")}
          </div>
        )}
      </AsyncPanel>

      <div ref={analyzedFilesPanelRef}>
        <AsyncPanel
          title={t("libraryDetail.analyzedFiles")}
          subtitle={
            hasAppliedSearchFilters
              ? t("libraryDetail.indexedEntriesFiltered", {
                  shown: filesTotal,
                  total: displayLibrary?.file_count ?? filesTotal,
                })
              : t("libraryDetail.indexedEntries", { count: filesTotal })
          }
          error={filesError}
          titleAddon={showAnalyzedFilesCsvExport ? renderExportButton("analyzed-files-export-button analyzed-files-export-button-desktop") : null}
          subtitleAddon={showAnalyzedFilesCsvExport ? renderExportButton("analyzed-files-export-button analyzed-files-export-button-mobile") : null}
          headerAddon={
            <div ref={searchToolsHeaderRef} className="data-table-search-layout">
              <div className="metadata-search-control metadata-search-control-base search-filter-picker">
                <button
                  type="button"
                  className={`search-filter-picker-button${pickerOpen ? " is-open" : ""}`}
                  aria-expanded={pickerOpen}
                  aria-controls="library-search-picker"
                  aria-label={t("libraryDetail.searchFields.addMetadataAria")}
                  onClick={() => setPickerOpen((current) => !current)}
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
                {pickerOpen ? (
                  <div id="library-search-picker" className="search-filter-picker-popover" role="menu">
                    {orderedMetadataFieldDefinitions.map((definition) => {
                      const field = definition.id;
                      const config = getLibraryFileSearchConfig(field);
                      const Icon = config.icon;
                      const isSelected = selectedMetadataFields.includes(field);
                      return (
                        <button
                          key={field}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={isSelected}
                          className={`search-filter-picker-item${isSelected ? " is-selected" : ""}`}
                          onClick={() => {
                            toggleMetadataField(field);
                            setPickerOpen(false);
                          }}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span>{t(config.labelKey)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <label className="sr-only" htmlFor="library-file-search">
                  {t("libraryDetail.searchLabel")}
                </label>
                <TooltipTrigger
                  ariaLabel={t("libraryDetail.searchLabel")}
                  content={t(baseSearchConfig.labelKey)}
                  className="metadata-search-icon-button metadata-search-icon-button-middle"
                >
                  <BaseSearchIcon size={16} aria-hidden="true" />
                </TooltipTrigger>
                <input
                  id="library-file-search"
                  type="search"
                  value={baseSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    startTransition(() => {
                      setBaseSearch(nextValue);
                    });
                  }}
                  placeholder={t("libraryDetail.searchFields.file.placeholder")}
                  autoComplete="off"
                />
              </div>
            </div>
          }
        >
        <div className="data-table-tools data-table-tools-search">
          {exportError ? <div className="notice">{t("libraryDetail.export.error", { message: exportError })}</div> : null}
          {isExporting ? <div className="media-meta">{t("libraryDetail.export.exporting")}</div> : null}
          {orderedSelectedMetadataFields.length > 0 ? (
            <div
              ref={searchToolsBodyRef}
              className="metadata-search-fields"
              aria-label={t("libraryDetail.searchFields.activeMetadata")}
            >
              {orderedSelectedMetadataFields.map((field) => {
                const config = getLibraryFileSearchConfig(field);
                const Icon = config.icon;
                const errorKey = searchFieldErrors[field];
                return (
                  <div key={field} className={`metadata-search-row${errorKey ? " is-invalid" : ""}`}>
                    <div className="metadata-search-control">
                      <TooltipTrigger
                        ariaLabel={t("libraryDetail.searchFields.tooltipAria")}
                        content={
                          config.tooltipKey
                            ? `${t(config.labelKey)}\n\n${t(config.tooltipKey)}`
                            : t(config.labelKey)
                        }
                        preserveLineBreaks={Boolean(config.tooltipKey)}
                        className="metadata-search-icon-button"
                      >
                        <Icon size={16} />
                      </TooltipTrigger>
                      <input
                        id={`library-metadata-search-${field}`}
                        type="search"
                        value={fieldValues[field] ?? ""}
                        onChange={(event) => updateMetadataFieldValue(field, event.target.value)}
                        placeholder={t(config.placeholderKey)}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="metadata-search-remove"
                        aria-label={t("libraryDetail.searchFields.removeAria", { field: t(config.labelKey) })}
                        onClick={() => removeMetadataField(field)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                    {errorKey ? <p className="metadata-search-error">{t(errorKey)}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        {isFilesLoading && files.length === 0 ? (
          <div className="panel-loader">
            <LoaderPinwheelIcon className="panel-loader-icon" size={30} />
            <span>{t("libraryDetail.loadingFiles")}</span>
          </div>
        ) : files.length === 0 ? (
          <div className="notice">{t("libraryDetail.noAnalyzedFiles")}</div>
        ) : (
          <div ref={dataTableShellRef} className="data-table-shell">
            <div className="media-data-table" role="table" aria-rowcount={filesTotal}>
              <div className="media-data-table-head" role="rowgroup">
                <div className="media-data-row media-data-head-row" role="row" style={{ gridTemplateColumns: columnTemplate }}>
                  {activeColumns.map((column) => {
                    const isActiveSort = sortKey === column.key;
                    return (
                      <div
                        key={column.key}
                        className={`media-data-cell media-data-header-cell${column.sticky ? " is-sticky" : ""}`}
                        role="columnheader"
                        aria-sort={ariaSortValue(isActiveSort, sortDirection)}
                      >
                        <button type="button" className="column-sort" onClick={() => updateSort(column.key)}>
                          <span>{t(column.labelKey)}</span>
                          <span className={`sort-indicator${isActiveSort ? " is-active" : ""}`} aria-hidden="true">
                            {isActiveSort ? sortIndicator(sortDirection) : ""}
                          </span>
                          {isActiveSort ? <span className="sr-only">{t(`sort.${sortDirection}`)}</span> : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className="media-data-table-body"
                role="rowgroup"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {virtualRows.map((virtualRow) => {
                  const file = files[virtualRow.index];
                  if (!file) {
                    return null;
                  }
                  return (
                    <div
                      key={file.id}
                      className="media-data-row media-data-body-row"
                      role="row"
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        gridTemplateColumns: columnTemplate,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {activeColumns.map((column) => (
                        <div
                          key={column.key}
                          className={`media-data-cell${column.sticky ? " is-sticky" : ""}`}
                          role="cell"
                        >
                          {column.render(file)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="data-table-footer">
              <span className="media-meta">
                {t("libraryDetail.renderedEntries", { rendered: files.length, total: filesTotal })}
              </span>
              {isLoadingMore || isFilesRefreshing ? <span className="media-meta">{t("libraryDetail.loadingMore")}</span> : null}
            </div>
          </div>
        )}
        </AsyncPanel>
      </div>
    </>
  );
}

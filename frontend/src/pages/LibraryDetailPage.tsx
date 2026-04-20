import { useVirtualizer } from "@tanstack/react-virtual";
import {
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  PanelTopClose,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
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
import { Link, useNavigate, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { ComparisonChartPanel } from "../components/ComparisonChartPanel";
import { DistributionChartPanel } from "../components/DistributionChartPanel";
import { DistributionList, type DistributionListEntry } from "../components/DistributionList";
import { LibraryHistoryPanel } from "../components/LibraryHistoryPanel";
import { LoaderPinwheelIcon } from "../components/LoaderPinwheelIcon";
import { SettingsIcon } from "../components/SettingsIcon";
import { StatCard } from "../components/StatCard";
import { StatisticPanelLayoutControls } from "../components/StatisticPanelLayoutControls";
import { StreamDetailsList } from "../components/StreamDetailsList";
import { TableViewSettingsEditor } from "../components/TableViewSettingsEditor";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import {
  api,
  type ComparisonResponse,
  type DuplicateGroupPage,
  type LibraryHistoryResponse,
  type LibraryStatistics,
  type LibrarySummary,
  type MediaFileQualityScoreDetail,
  type MediaFileRow,
  type MediaFileSortKey,
  type MediaFileStreamDetails,
} from "../lib/api";
import { formatBitrate, formatBytes, formatCodecLabel, formatContainerLabel, formatDate, formatDuration } from "../lib/format";
import { isLibraryHistoryMetricId, type LibraryHistoryMetricId } from "../lib/history-metrics";
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
  getLibraryFileColumnWidths,
  saveLibraryFileColumnWidths,
  type LibraryFileColumnWidths,
} from "../lib/library-file-column-widths";
import {
  buildDefaultLibraryStatisticsSettings,
  cloneLibraryStatisticsSettings,
  getEnabledLibraryStatisticTableTooltipColumns,
  LIBRARY_STATISTIC_DEFINITIONS,
  getLibraryStatisticNumericDistribution,
  getLibraryStatisticPanelItems,
  getLibraryStatisticsSettings,
  getVisibleLibraryStatisticTableColumns,
  saveLibraryStatisticsSettings,
  type LibraryStatisticId,
  type LibraryStatisticsSettings,
} from "../lib/library-statistics-settings";
import { buildNumericDistributionFilterExpression } from "../lib/numeric-distributions";
import {
  getComparisonSelection,
  sanitizeComparisonRenderer,
  saveComparisonSelection,
  type ComparisonSelection,
} from "../lib/statistic-comparisons";
import {
  InflightPageRequestGate,
  buildFilePageRequestKey,
  mergeUniqueFiles,
  resolveFileLoadTransition,
} from "../lib/paginated-files";
import {
  addStatisticPanelLayoutItem,
  buildDefaultStatisticPanelLayout,
  cloneStatisticPanelLayout,
  getStatisticPanelSizeConfigForItem,
  getAvailableStatisticPanelDefinitions,
  getStatisticPanelLayout,
  moveStatisticPanelLayoutItem,
  removeStatisticPanelLayoutItem,
  resizeStatisticPanelLayoutItem,
  saveStatisticPanelLayout,
  type ExtraLibraryStatisticPanelId,
  type StatisticPanelLayoutId,
  updateStatisticPanelLayoutComparisonSelection,
} from "../lib/statistic-panel-layout";
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

type LibraryLayoutPanelDefinition =
  | {
      id: LibraryStatisticId;
      kind: "statistic";
      statisticDefinition: (typeof LIBRARY_STATISTIC_DEFINITIONS)[number];
      nameKey: string;
    }
  | {
      id: ExtraLibraryStatisticPanelId;
      kind: ExtraLibraryStatisticPanelId;
      nameKey: string;
    };

type VisibleLibraryLayoutPanel = {
  item: ReturnType<typeof getStatisticPanelLayout>["items"][number];
  definition: LibraryLayoutPanelDefinition;
};

const PAGE_SIZE = 200;
const LOAD_MORE_THRESHOLD_ROWS = 40;
const ROW_ESTIMATE_PX = 68;
const OVERSCAN_ROWS = 12;
const HISTORY_SELECTED_METRIC_STORAGE_KEY = "medialyze-library-detail-history-selected-metric";
const DEFAULT_HISTORY_METRIC: LibraryHistoryMetricId = "resolution_mix";
const HEADER_FONT_SIZE_PX = 12.48;
const BODY_FONT_SIZE_PX = 16;
const HEADER_FONT = `600 ${HEADER_FONT_SIZE_PX}px "Space Grotesk", system-ui, sans-serif`;
const BODY_FONT = `400 ${BODY_FONT_SIZE_PX}px "Space Grotesk", system-ui, sans-serif`;
const HEADER_LETTER_SPACING_PX = HEADER_FONT_SIZE_PX * 0.08;
const CELL_HORIZONTAL_PADDING_PX = 20;
const SORT_INDICATOR_WIDTH_PX = 18;
const librarySummaryCache = new Map<string, LibrarySummary>();
const libraryStatisticsCache = new Map<string, LibraryStatistics>();
const libraryHistoryCache = new Map<string, LibraryHistoryResponse>();
const libraryComparisonCache = new Map<string, ComparisonResponse>();
const libraryDuplicateGroupsCache = new Map<string, DuplicateGroupPage>();
const libraryFileListCache = new Map<string, CachedFileList>();
const libraryLayoutPanelDefinitionMap = new Map<StatisticPanelLayoutId, LibraryLayoutPanelDefinition>([
  ...LIBRARY_STATISTIC_DEFINITIONS.map(
    (definition) =>
      [
        definition.id,
        {
          id: definition.id,
          kind: "statistic",
          statisticDefinition: definition,
          nameKey: definition.nameKey,
        },
      ] as const,
  ),
  ["history", { id: "history", kind: "history", nameKey: "libraryDetail.history.title" }],
  ["duplicates", { id: "duplicates", kind: "duplicates", nameKey: "libraryDetail.duplicates.title" }],
  ["analyzed_files", { id: "analyzed_files", kind: "analyzed_files", nameKey: "libraryDetail.analyzedFiles" }],
]);
let measurementCanvasContext: CanvasRenderingContext2D | null | undefined;

const DEFAULT_COLUMN_RESIZE_MIN_PX = 72;
const DEFAULT_COLUMN_RESIZE_MAX_PX = 960;

function compactValues(values: string[], limit = 4): string {
  if (values.length === 0) {
    return "n/a";
  }
  const visible = values.slice(0, limit);
  return values.length > limit ? `${visible.join(", ")}, ...` : visible.join(", ");
}

function listValues(values: string[]): string {
  return values.length === 0 ? "n/a" : values.join(", ");
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
  widthOverrides: LibraryFileColumnWidths,
): string {
  return columns
    .map((column) => {
      const overrideWidth = widthOverrides[column.key];
      if (overrideWidth !== undefined) {
        return `${Math.ceil(clampWidth(overrideWidth, columnResizeBounds(column).minPx, columnResizeBounds(column).maxPx))}px`;
      }

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

function columnResizeBounds(column: FileColumnDefinition): { minPx: number; maxPx: number } {
  const minPx =
    column.sizing.mode === "flex"
      ? Math.max(column.sizing.minPx, 180)
      : Math.max(column.sizing.minPx ?? DEFAULT_COLUMN_RESIZE_MIN_PX, DEFAULT_COLUMN_RESIZE_MIN_PX);
  const maxPx = column.key === "file" ? 1400 : DEFAULT_COLUMN_RESIZE_MAX_PX;

  return { minPx, maxPx };
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

export function buildFileColumns(
  t: (key: string, options?: Record<string, unknown>) => string,
  qualityDetailCache: Record<number, MediaFileQualityScoreDetail>,
  qualityDetailLoading: Record<number, boolean>,
  streamDetailCache: Record<number, MediaFileStreamDetails>,
  streamDetailLoading: Record<number, boolean>,
  loadQualityDetail: (fileId: number) => void,
  loadStreamDetail: (fileId: number) => void,
  tooltipEnabledColumns: Set<FileColumnKey>,
  hideQualityScoreMeter: boolean,
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
      key: "container",
      labelKey: "fileTable.container",
      sizing: { mode: "content", minPx: 86, maxPx: 108 },
      measureValue: (file) => formatContainerLabel(file.container),
      render: (file) => formatContainerLabel(file.container),
    },
    {
      key: "video_codec",
      labelKey: "fileTable.codec",
      sizing: { mode: "content", minPx: 112, maxPx: 168 },
      measureValue: (file) =>
        file.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileTable.na"),
      render: (file) =>
        file.video_codec && tooltipEnabledColumns.has("video_codec") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.videoTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="video"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{formatCodecLabel(file.video_codec, "video")}</span>
          </TooltipTrigger>
        ) : file.video_codec ? (
          formatCodecLabel(file.video_codec, "video")
        ) : (
          t("fileTable.na")
        ),
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
      measureValue: (file) => formatHdrType(file.hdr_type) ?? t("fileTable.sdr"),
      render: (file) => formatHdrType(file.hdr_type) ?? t("fileTable.sdr"),
    },
    {
      key: "duration",
      labelKey: "fileTable.duration",
      sizing: { mode: "content", minPx: 90, maxPx: 110 },
      measureValue: (file) => formatDuration(file.duration),
      render: (file) => formatDuration(file.duration),
    },
    {
      key: "bitrate",
      labelKey: "fileTable.bitrate",
      sizing: { mode: "content", minPx: 92, maxPx: 122 },
      measureValue: (file) => formatBitrate(file.bitrate),
      render: (file) => formatBitrate(file.bitrate),
    },
    {
      key: "audio_bitrate",
      labelKey: "fileTable.audioBitrate",
      sizing: { mode: "content", minPx: 108, maxPx: 138 },
      measureValue: (file) => formatBitrate(file.audio_bitrate),
      render: (file) => formatBitrate(file.audio_bitrate),
    },
    {
      key: "audio_codecs",
      labelKey: "fileTable.audioCodecs",
      sizing: { mode: "content", minPx: 132, maxPx: 220 },
      measureValue: (file) => compactValues(file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio"))),
      render: (file) => {
        const value = compactValues(file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio")));
        return file.audio_codecs.length > 0 && tooltipEnabledColumns.has("audio_codecs") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.audioTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="audio"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{value}</span>
          </TooltipTrigger>
        ) : (
          value
        );
      },
    },
    {
      key: "audio_spatial_profiles",
      labelKey: "fileTable.audioSpatialProfiles",
      sizing: { mode: "content", minPx: 138, maxPx: 204 },
      measureValue: (file) => compactValues(file.audio_spatial_profiles),
      render: (file) => {
        const value = compactValues(file.audio_spatial_profiles);
        return file.audio_spatial_profiles.length > 0 && tooltipEnabledColumns.has("audio_spatial_profiles") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.audioTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="audio"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{value}</span>
          </TooltipTrigger>
        ) : (
          <span className="media-data-text-ellipsis" title={value}>
            {value}
          </span>
        );
      },
    },
    {
      key: "audio_languages",
      labelKey: "fileTable.audioLanguages",
      sizing: { mode: "content", minPx: 112, maxPx: 176 },
      measureValue: (file) => listValues(file.audio_languages),
      render: (file) => {
        const value = listValues(file.audio_languages);
        return file.audio_languages.length > 0 && tooltipEnabledColumns.has("audio_languages") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.audioTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="audio"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{value}</span>
          </TooltipTrigger>
        ) : (
          <span className="media-data-text-ellipsis" title={value}>
            {value}
          </span>
        );
      },
    },
    {
      key: "subtitle_languages",
      labelKey: "fileTable.subtitleLanguages",
      sizing: { mode: "content", minPx: 112, maxPx: 176 },
      measureValue: (file) => listValues(file.subtitle_languages),
      render: (file) => {
        const value = listValues(file.subtitle_languages);
        return file.subtitle_languages.length > 0 && tooltipEnabledColumns.has("subtitle_languages") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.subtitleTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="subtitle"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{value}</span>
          </TooltipTrigger>
        ) : (
          <span className="media-data-text-ellipsis" title={value}>
            {value}
          </span>
        );
      },
    },
    {
      key: "subtitle_codecs",
      labelKey: "fileTable.subtitleCodecs",
      sizing: { mode: "content", minPx: 126, maxPx: 220 },
      measureValue: (file) => compactValues(file.subtitle_codecs.map((codec) => formatCodecLabel(codec, "subtitle"))),
      render: (file) => {
        const value = compactValues(file.subtitle_codecs.map((codec) => formatCodecLabel(codec, "subtitle")));
        return file.subtitle_codecs.length > 0 && tooltipEnabledColumns.has("subtitle_codecs") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.subtitleTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="subtitle"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{value}</span>
          </TooltipTrigger>
        ) : (
          value
        );
      },
    },
    {
      key: "subtitle_sources",
      labelKey: "fileTable.subtitleSources",
      sizing: { mode: "content", minPx: 110, maxPx: 170 },
      measureValue: (file) => compactValues(file.subtitle_sources, 2),
      render: (file) => {
        const value = compactValues(file.subtitle_sources, 2);
        return file.subtitle_sources.length > 0 && tooltipEnabledColumns.has("subtitle_sources") ? (
          <TooltipTrigger
            ariaLabel={t("streamDetails.subtitleTooltipAria", { file: file.filename })}
            className="stream-details-tooltip-trigger"
            tooltipClassName="stream-details-tooltip-portal"
            maxWidth={420}
            content={
              <StreamDetailsList
                kind="subtitle"
                detail={streamDetailCache[file.id]}
                isLoading={Boolean(streamDetailLoading[file.id])}
                t={t}
              />
            }
            onOpen={() => loadStreamDetail(file.id)}
          >
            <span className="media-data-text-ellipsis">{value}</span>
          </TooltipTrigger>
        ) : (
          value
        );
      },
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
        tooltipEnabledColumns.has("quality_score") ? (
          <TooltipTrigger
            ariaLabel={t("quality.tooltipAria")}
            className="quality-score-tooltip-trigger"
            content={buildQualityTooltipContent(qualityDetailCache[file.id], Boolean(qualityDetailLoading[file.id]), t)}
            onOpen={() => loadQualityDetail(file.id)}
          >
            <div className="score-cell">
              <strong>{file.quality_score}/10</strong>
              {hideQualityScoreMeter ? null : (
                <div className="score-meter" aria-hidden="true">
                  <span
                    className={`score-meter-fill score-meter-fill-${scoreMeterLabel(file.quality_score)}`}
                    style={{ width: `${Math.max(0, Math.min(10, file.quality_score)) * 10}%` }}
                  />
                </div>
              )}
            </div>
          </TooltipTrigger>
        ) : (
          <div className="score-cell">
            <strong>{file.quality_score}/10</strong>
            {hideQualityScoreMeter ? null : (
              <div className="score-meter" aria-hidden="true">
                <span
                  className={`score-meter-fill score-meter-fill-${scoreMeterLabel(file.quality_score)}`}
                  style={{ width: `${Math.max(0, Math.min(10, file.quality_score)) * 10}%` }}
                />
              </div>
            )}
          </div>
        )
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

function buildDuplicatePanelCollapseStorageKey(libraryId: string): string {
  return `medialyze-library-detail-${libraryId}-duplicates-collapsed`;
}

function buildHistoryPanelCollapseStorageKey(libraryId: string): string {
  return `medialyze-library-detail-${libraryId}-history-collapsed`;
}

function readDuplicatePanelCollapsedPreference(libraryId: string): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  const storedPreference = window.localStorage.getItem(buildDuplicatePanelCollapseStorageKey(libraryId));
  if (storedPreference === null) {
    return true;
  }
  return storedPreference === "true";
}

function readHistoryPanelCollapsedPreference(libraryId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const storedPreference = window.localStorage.getItem(buildHistoryPanelCollapseStorageKey(libraryId));
  if (storedPreference === null) {
    return false;
  }
  return storedPreference === "true";
}

function readHistoryMetricPreference(): LibraryHistoryMetricId {
  if (typeof window === "undefined") {
    return DEFAULT_HISTORY_METRIC;
  }
  const storedPreference = window.localStorage.getItem(HISTORY_SELECTED_METRIC_STORAGE_KEY);
  if (isLibraryHistoryMetricId(storedPreference)) {
    return storedPreference;
  }
  return DEFAULT_HISTORY_METRIC;
}

function buildCsvFallbackFilename(libraryName: string): string {
  const safeLibraryName = libraryName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "Library";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `MediaLyze_${safeLibraryName}_${timestamp}.csv`;
}

function buildLibraryComparisonQueryKey(libraryId: string, selection: ComparisonSelection): string {
  return `${libraryId}:${selection.xField}:${selection.yField}`;
}

function buildLibraryTableViewSettingsScope(libraryId: string): string {
  return `library-${libraryId}`;
}

export function LibraryDetailPage() {
  const { t } = useTranslation();
  const { libraryId = "" } = useParams();
  const navigate = useNavigate();
  const { appSettings, libraries } = useAppData();
  const tableViewSettingsScope = useMemo(() => buildLibraryTableViewSettingsScope(libraryId), [libraryId]);
  const statisticLayoutOptions = useMemo(
    () => ({ unlimitedHeight: appSettings.feature_flags.unlimited_panel_size }),
    [appSettings.feature_flags.unlimited_panel_size],
  );
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary | null>(null);
  const [libraryStatistics, setLibraryStatistics] = useState<LibraryStatistics | null>(null);
  const [libraryHistory, setLibraryHistory] = useState<LibraryHistoryResponse | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupPage | null>(null);
  const [duplicateSearch, setDuplicateSearch] = useState("");
  const [savedStatisticLayout, setSavedStatisticLayout] = useState(() =>
    getStatisticPanelLayout("library", libraryId, statisticLayoutOptions),
  );
  const [draftStatisticLayout, setDraftStatisticLayout] = useState(() =>
    cloneStatisticPanelLayout(getStatisticPanelLayout("library", libraryId, statisticLayoutOptions)),
  );
  const [isEditingStatisticLayout, setIsEditingStatisticLayout] = useState(false);
  const [draggedStatisticPanelId, setDraggedStatisticPanelId] = useState<string | null>(null);
  const [dropTargetStatisticPanelId, setDropTargetStatisticPanelId] = useState<string | null>(null);
  const [comparisonByPanel, setComparisonByPanel] = useState<Record<string, ComparisonResponse | null>>({});
  const [comparisonErrorByPanel, setComparisonErrorByPanel] = useState<Record<string, string | null>>({});
  const [comparisonLoadingByPanel, setComparisonLoadingByPanel] = useState<Record<string, boolean>>({});
  const [savedTableViewSettings, setSavedTableViewSettings] = useState<LibraryStatisticsSettings>(() =>
    getLibraryStatisticsSettings(tableViewSettingsScope),
  );
  const [draftTableViewSettings, setDraftTableViewSettings] = useState<LibraryStatisticsSettings>(() =>
    cloneLibraryStatisticsSettings(getLibraryStatisticsSettings(tableViewSettingsScope)),
  );
  const [isEditingTableView, setIsEditingTableView] = useState(false);
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [duplicateGroupsError, setDuplicateGroupsError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isDuplicateGroupsLoading, setIsDuplicateGroupsLoading] = useState(true);
  const [isFilesLoading, setIsFilesLoading] = useState(true);
  const [isFilesRefreshing, setIsFilesRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<FileColumnKey[]>(() => [
    "file",
    ...getVisibleLibraryStatisticTableColumns(getLibraryStatisticsSettings(tableViewSettingsScope)),
  ]);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<LibraryFileColumnWidths>(() =>
    getLibraryFileColumnWidths(),
  );
  const [sortKey, setSortKey] = useState<FileColumnKey>("file");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [baseSearch, setBaseSearch] = useState("");
  const [selectedMetadataFields, setSelectedMetadataFields] = useState<LibraryFileMetadataSearchField[]>([]);
  const [fieldValues, setFieldValues] = useState<Partial<Record<LibraryFileMetadataSearchField, string>>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [appliedSearchFilters, setAppliedSearchFilters] = useState<LibraryFileSearchFilters>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [isDuplicatesPanelCollapsed, setIsDuplicatesPanelCollapsed] = useState(() =>
    readDuplicatePanelCollapsedPreference(libraryId),
  );
  const [isHistoryPanelCollapsed, setIsHistoryPanelCollapsed] = useState(() =>
    readHistoryPanelCollapsedPreference(libraryId),
  );
  const [selectedHistoryMetric, setSelectedHistoryMetric] = useState<LibraryHistoryMetricId>(() =>
    readHistoryMetricPreference(),
  );
  const [qualityScoreDetails, setQualityScoreDetails] = useState<Record<number, MediaFileQualityScoreDetail>>({});
  const [qualityScoreLoading, setQualityScoreLoading] = useState<Record<number, boolean>>({});
  const [streamDetails, setStreamDetails] = useState<Record<number, MediaFileStreamDetails>>({});
  const [streamDetailsLoading, setStreamDetailsLoading] = useState<Record<number, boolean>>({});
  const { activeJobs } = useScanJobs();
  const activeJob = activeJobs.find((job) => String(job.library_id) === libraryId) ?? null;
  const hadActiveJobRef = useRef(Boolean(activeJob));
  const fallbackSummary = findLibrarySummary(libraries, libraryId);
  const displayLibrary = librarySummary ?? fallbackSummary;
  const activeStatisticLayout = isEditingStatisticLayout ? draftStatisticLayout : savedStatisticLayout;
  const showAnalyzedFilesCsvExport = appSettings.feature_flags.show_analyzed_files_csv_export;
  const hideQualityScoreMeter = appSettings.feature_flags.hide_quality_score_meter;
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
  const loadStreamDetail = useEffectEvent(async (fileId: number) => {
    if (streamDetails[fileId] || streamDetailsLoading[fileId]) {
      return;
    }
    setStreamDetailsLoading((current) => ({ ...current, [fileId]: true }));
    try {
      const payload = await api.fileStreams(fileId);
      setStreamDetails((current) => ({ ...current, [fileId]: payload }));
    } catch {
      // Ignore transient tooltip fetch errors.
    } finally {
      setStreamDetailsLoading((current) => {
        const next = { ...current };
        delete next[fileId];
        return next;
      });
    }
  });
  const tooltipEnabledColumns = useMemo(
    () => new Set<FileColumnKey>(getEnabledLibraryStatisticTableTooltipColumns(savedTableViewSettings)),
    [savedTableViewSettings],
  );
  const fileColumns = useMemo(
    () =>
      buildFileColumns(
        t,
        qualityScoreDetails,
        qualityScoreLoading,
        streamDetails,
        streamDetailsLoading,
        loadQualityScoreDetail,
        loadStreamDetail,
        tooltipEnabledColumns,
        hideQualityScoreMeter,
      ),
    [
      hideQualityScoreMeter,
      loadQualityScoreDetail,
      loadStreamDetail,
      qualityScoreDetails,
      qualityScoreLoading,
      streamDetails,
      streamDetailsLoading,
      t,
      tooltipEnabledColumns,
    ],
  );
  const baseSearchConfig = useMemo(() => getLibraryFileSearchConfig("file"), []);
  const BaseSearchIcon = baseSearchConfig.icon;
  const visibleStatisticColumns = useMemo(
    () => getVisibleLibraryStatisticTableColumns(savedTableViewSettings),
    [savedTableViewSettings],
  );
  const visibleLayoutPanels = useMemo(
    () =>
      activeStatisticLayout.items
        .map((item) => {
          const definition = libraryLayoutPanelDefinitionMap.get(item.statisticId);
          if (!definition) {
            return null;
          }
          return { item, definition };
        })
        .filter((entry): entry is VisibleLibraryLayoutPanel => Boolean(entry)),
    [activeStatisticLayout.items],
  );
  const comparisonPanels = useMemo(
    () =>
      visibleLayoutPanels.filter(
        (panel): panel is VisibleLibraryLayoutPanel & { definition: Extract<LibraryLayoutPanelDefinition, { kind: "statistic" }> } =>
          panel.item.statisticId === "comparison" && panel.definition.kind === "statistic",
      ),
    [visibleLayoutPanels],
  );
  const comparisonPanelsKey = useMemo(
    () =>
      comparisonPanels
        .map(({ item }) => {
          const selection = item.comparisonSelection ?? getComparisonSelection("library");
          return `${item.instanceId}:${selection.xField}:${selection.yField}`;
        })
        .join("|"),
    [comparisonPanels],
  );
  const availableStatisticPanelDefinitions = useMemo(
    () => getAvailableStatisticPanelDefinitions("library", draftStatisticLayout),
    [draftStatisticLayout],
  );
  const activeColumns = useMemo(
    () => fileColumns.filter((column) => visibleColumns.includes(column.key)),
    [fileColumns, visibleColumns],
  );
  const activeColumnMap = useMemo(
    () => new Map(activeColumns.map((column) => [column.key, column] as const)),
    [activeColumns],
  );
  const activeColumnSignature = useMemo(
    () => activeColumns.map((column) => column.key).join("|"),
    [activeColumns],
  );
  const columnTemplate = useMemo(
    () => buildColumnTemplate(activeColumns, files, t, columnWidthOverrides),
    [activeColumns, columnWidthOverrides, files, t],
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
  const headerCellRefs = useRef<Partial<Record<FileColumnKey, HTMLDivElement | null>>>({});
  const searchToolsHeaderRef = useRef<HTMLDivElement | null>(null);
  const searchToolsBodyRef = useRef<HTMLDivElement | null>(null);
  const inflightRequestGateRef = useRef(new InflightPageRequestGate());
  const resizeStateRef = useRef<{
    columnKey: FileColumnKey;
    startX: number;
    startWidth: number;
    minPx: number;
    maxPx: number;
  } | null>(null);
  const previousLibraryIdRef = useRef(libraryId);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const statisticsAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const comparisonAbortRef = useRef<Map<string, AbortController>>(new Map());
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

  const beginColumnResize = useEffectEvent((columnKey: FileColumnKey, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const column = activeColumnMap.get(columnKey);
    const headerCell = headerCellRefs.current[columnKey];
    if (!column || !headerCell) {
      return;
    }

    const bounds = columnResizeBounds(column);
    resizeStateRef.current = {
      columnKey,
      startX: event.clientX,
      startWidth: headerCell.getBoundingClientRect().width,
      minPx: bounds.minPx,
      maxPx: bounds.maxPx,
    };
    document.body.classList.add("is-column-resizing");
  });

  const resetColumnWidth = useEffectEvent((columnKey: FileColumnKey) => {
    setColumnWidthOverrides((current) => {
      if (!(columnKey in current)) {
        return current;
      }
      const next = { ...current };
      delete next[columnKey];
      return saveLibraryFileColumnWidths(next);
    });
  });

  const applyMetadataFilters = useEffectEvent((nextFilters: Partial<Record<LibraryFileMetadataSearchField, string>>) => {
    const filterEntries = Object.entries(nextFilters)
      .map(([field, value]) => [field as LibraryFileMetadataSearchField, value?.trim() ?? ""] as const)
      .filter(([, value]) => Boolean(value));

    if (filterEntries.length === 0) {
      return;
    }

    const firstNewField = filterEntries.find(([field]) => !selectedMetadataFields.includes(field))?.[0] ?? null;

    startTransition(() => {
      setSelectedMetadataFields((current) => {
        const next = new Set(current);
        for (const [field] of filterEntries) {
          next.add(field);
        }
        return LIBRARY_METADATA_SEARCH_FIELDS.filter((field) => next.has(field));
      });
      setFieldValues((current) => {
        let changed = false;
        const next = { ...current };
        for (const [field, value] of filterEntries) {
          if ((current[field]?.trim() ?? "") === value) {
            continue;
          }
          next[field] = value;
          changed = true;
        }
        if (!changed) {
          return current;
        }
        return next;
      });
    });

    if (firstNewField) {
      pendingStatisticFocusFieldRef.current = firstNewField;
    }
    requestAnimationFrame(() => {
      analyzedFilesPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  });

  const applyStatisticFilter = useEffectEvent((field: LibraryFileMetadataSearchField, rawValue: string) => {
    const normalizedValue = rawValue.trim();
    if (!normalizedValue) {
      return;
    }
    applyMetadataFilters({ [field]: normalizedValue });
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

  const loadLibraryHistory = useEffectEvent(async (showLoading = false) => {
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;

    if (showLoading) {
      setIsHistoryLoading(true);
    }

    try {
      const payload = await api.libraryHistory(libraryId, controller.signal);
      libraryHistoryCache.set(libraryId, payload);
      setLibraryHistory(payload);
      setHistoryError(null);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      setHistoryError((reason as Error).message);
    } finally {
      if (historyAbortRef.current === controller) {
        historyAbortRef.current = null;
      }
      if (showLoading) {
        setIsHistoryLoading(false);
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
    setIsDuplicatesPanelCollapsed(readDuplicatePanelCollapsedPreference(libraryId));
    setIsHistoryPanelCollapsed(readHistoryPanelCollapsedPreference(libraryId));
  }, [libraryId]);

  useEffect(() => {
    window.localStorage.setItem(
      buildDuplicatePanelCollapseStorageKey(libraryId),
      isDuplicatesPanelCollapsed ? "true" : "false",
    );
  }, [isDuplicatesPanelCollapsed, libraryId]);

  useEffect(() => {
    window.localStorage.setItem(
      buildHistoryPanelCollapseStorageKey(libraryId),
      isHistoryPanelCollapsed ? "true" : "false",
    );
  }, [isHistoryPanelCollapsed, libraryId]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_SELECTED_METRIC_STORAGE_KEY, selectedHistoryMetric);
  }, [selectedHistoryMetric]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = clampWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX),
        resizeState.minPx,
        resizeState.maxPx,
      );

      setColumnWidthOverrides((current) => {
        if (current[resizeState.columnKey] === nextWidth) {
          return current;
        }
        return saveLibraryFileColumnWidths({
          ...current,
          [resizeState.columnKey]: nextWidth,
        });
      });
    }

    function handlePointerUp() {
      if (!resizeStateRef.current) {
        return;
      }
      resizeStateRef.current = null;
      document.body.classList.remove("is-column-resizing");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.classList.remove("is-column-resizing");
    };
  }, []);

  useEffect(() => {
    setDuplicateSearch("");
  }, [libraryId]);

  useEffect(() => {
    const nextLayout = saveStatisticPanelLayout(
      "library",
      libraryId,
      getStatisticPanelLayout("library", libraryId, statisticLayoutOptions),
      statisticLayoutOptions,
    );
    setSavedStatisticLayout(nextLayout);
    setDraftStatisticLayout(cloneStatisticPanelLayout(nextLayout));
    setIsEditingStatisticLayout(false);
    setDraggedStatisticPanelId(null);
    setDropTargetStatisticPanelId(null);
  }, [libraryId, statisticLayoutOptions]);

  useEffect(() => {
    const nextSettings = getLibraryStatisticsSettings(tableViewSettingsScope);
    setSavedTableViewSettings(nextSettings);
    setDraftTableViewSettings(cloneLibraryStatisticsSettings(nextSettings));
    setIsEditingTableView(false);
  }, [tableViewSettingsScope]);

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
    const cachedHistory = libraryHistoryCache.get(libraryId) ?? null;
    const cachedDuplicateGroups = libraryDuplicateGroupsCache.get(libraryId) ?? null;

    setComparisonByPanel({});
    setComparisonErrorByPanel({});
    setComparisonLoadingByPanel({});
    setLibrarySummary(cachedSummary);
    setLibraryStatistics(cachedStatistics);
    setLibraryHistory(cachedHistory);
    setDuplicateGroups(cachedDuplicateGroups);
    setSummaryError(null);
    setStatisticsError(null);
    setHistoryError(null);
    setDuplicateGroupsError(null);
    setIsSummaryLoading(cachedSummary === null);
    setIsStatisticsLoading(cachedStatistics === null);
    setIsHistoryLoading(cachedHistory === null);
    setIsDuplicateGroupsLoading(cachedDuplicateGroups === null);

    void loadLibrarySummary(cachedSummary === null);
    void loadLibraryStatistics(cachedStatistics === null);
    void loadLibraryHistory(cachedHistory === null);
    void loadDuplicateGroups(cachedDuplicateGroups === null);
  }, [libraryId]);

  const syncComparisonPanels = useEffectEvent((force = false) => {
    const activeIds = new Set(comparisonPanels.map(({ item }) => item.instanceId));
    for (const [instanceId, controller] of comparisonAbortRef.current.entries()) {
      if (!activeIds.has(instanceId)) {
        controller.abort();
        comparisonAbortRef.current.delete(instanceId);
      }
    }

    if (comparisonPanels.length === 0) {
      return;
    }

    for (const { item } of comparisonPanels) {
      const selection = item.comparisonSelection ?? getComparisonSelection("library");
      const queryKey = buildLibraryComparisonQueryKey(libraryId, selection);
      const cachedComparison = !force ? libraryComparisonCache.get(queryKey) ?? null : null;

      setComparisonErrorByPanel((current) => ({ ...current, [item.instanceId]: null }));
      setComparisonByPanel((current) =>
        current[item.instanceId] === cachedComparison ? current : { ...current, [item.instanceId]: cachedComparison },
      );
      setComparisonLoadingByPanel((current) => ({
        ...current,
        [item.instanceId]: cachedComparison === null,
      }));

      if (cachedComparison) {
        continue;
      }

      const controller = new AbortController();
      comparisonAbortRef.current.get(item.instanceId)?.abort();
      comparisonAbortRef.current.set(item.instanceId, controller);

      api.libraryComparison(libraryId, {
        xField: selection.xField,
        yField: selection.yField,
        signal: controller.signal,
      })
        .then((payload) => {
          libraryComparisonCache.set(queryKey, payload);
          setComparisonByPanel((current) => ({ ...current, [item.instanceId]: payload }));
          setComparisonErrorByPanel((current) => ({ ...current, [item.instanceId]: null }));
        })
        .catch((reason: Error) => {
          if (reason.name === "AbortError") {
            return;
          }
          setComparisonErrorByPanel((current) => ({ ...current, [item.instanceId]: reason.message }));
        })
        .finally(() => {
          if (comparisonAbortRef.current.get(item.instanceId) === controller) {
            comparisonAbortRef.current.delete(item.instanceId);
          }
          setComparisonLoadingByPanel((current) => ({ ...current, [item.instanceId]: false }));
        });
    }
  });

  useEffect(() => {
    syncComparisonPanels();
  }, [comparisonPanelsKey, libraryId]);

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
  }, [activeColumnSignature, columnTemplate, rowVirtualizer]);

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
      libraryHistoryCache.delete(libraryId);
      for (const { item } of comparisonPanels) {
        const selection = item.comparisonSelection ?? getComparisonSelection("library");
        libraryComparisonCache.delete(buildLibraryComparisonQueryKey(libraryId, selection));
      }
      libraryDuplicateGroupsCache.delete(libraryId);
      libraryFileListCache.delete(fileQueryKey);
      setQualityScoreDetails({});
      setQualityScoreLoading({});
      void loadLibrarySummary(false);
      void loadLibraryStatistics(false);
      void loadLibraryHistory(false);
      void loadDuplicateGroups(false);
      void loadFilesPage(0, false, fileQueryKey);
      syncComparisonPanels(true);
    }
    hadActiveJobRef.current = Boolean(activeJob);
  }, [
    activeJob,
    comparisonPanelsKey,
    fileQueryKey,
    libraryId,
  ]);

  useEffect(() => {
    return () => {
      summaryAbortRef.current?.abort();
      statisticsAbortRef.current?.abort();
      historyAbortRef.current?.abort();
      for (const controller of comparisonAbortRef.current.values()) {
        controller.abort();
      }
      comparisonAbortRef.current.clear();
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

  function persistStatisticLayout(nextLayout: typeof savedStatisticLayout) {
    const normalized = saveStatisticPanelLayout("library", libraryId, nextLayout, statisticLayoutOptions);
    setSavedStatisticLayout(normalized);
    setDraftStatisticLayout(cloneStatisticPanelLayout(normalized));
  }

  function persistTableViewSettings(nextSettings: LibraryStatisticsSettings) {
    const normalized = saveLibraryStatisticsSettings(nextSettings, tableViewSettingsScope);
    setSavedTableViewSettings(normalized);
    setDraftTableViewSettings(cloneLibraryStatisticsSettings(normalized));
  }

  function updateStatisticLayout(
    transform: (current: typeof activeStatisticLayout) => typeof activeStatisticLayout,
    persistWhenViewing = false,
  ) {
    if (isEditingStatisticLayout) {
      setDraftStatisticLayout((current) => transform(current));
      return;
    }

    const nextLayout = transform(savedStatisticLayout);
    if (persistWhenViewing) {
      persistStatisticLayout(nextLayout);
      return;
    }

    setSavedStatisticLayout(nextLayout);
    setDraftStatisticLayout(cloneStatisticPanelLayout(nextLayout));
  }

  function handleStatisticPanelDrop(targetInstanceId: string) {
    if (!draggedStatisticPanelId) {
      return;
    }

    updateStatisticLayout((current) =>
      moveStatisticPanelLayoutItem(current, draggedStatisticPanelId, targetInstanceId),
    );
    setDraggedStatisticPanelId(null);
    setDropTargetStatisticPanelId(null);
  }

  function updateComparisonSelection(instanceId: string, nextSelection: ComparisonSelection) {
    const normalized = saveComparisonSelection("library", {
      ...nextSelection,
      renderer: sanitizeComparisonRenderer(nextSelection.xField, nextSelection.yField, nextSelection.renderer),
    });
    updateStatisticLayout(
      (current) =>
        updateStatisticPanelLayoutComparisonSelection("library", current, instanceId, normalized),
      true,
    );
  }

  function renderStatisticPanelResizeControls(panel: VisibleLibraryLayoutPanel) {
    const { item } = panel;
    const sizeConfig = getStatisticPanelSizeConfigForItem("library", item.statisticId, statisticLayoutOptions);
    return (
      <>
        <div className="statistic-layout-size-controls statistic-layout-size-controls-top-left">
          <button
            type="button"
            className="statistic-layout-size-button"
            aria-label={t("panelLayout.remove")}
            title={t("panelLayout.remove")}
            onClick={() =>
              updateStatisticLayout((current) => removeStatisticPanelLayoutItem(current, item.instanceId))
            }
          >
            <Trash2 className="nav-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="statistic-layout-size-controls statistic-layout-size-controls-right">
          {sizeConfig.allowWidthResize && item.width < sizeConfig.maxWidth ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.expandWidth")}
              title={t("panelLayout.expandWidth")}
              onClick={() =>
                updateStatisticLayout((current) =>
                  resizeStatisticPanelLayoutItem("library", current, item.instanceId, { width: item.width + 1 }),
                )
              }
            >
              <PanelRightClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
          {sizeConfig.allowWidthResize && item.width > sizeConfig.minWidth ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.shrinkWidth")}
              title={t("panelLayout.shrinkWidth")}
              onClick={() =>
                updateStatisticLayout((current) =>
                  resizeStatisticPanelLayoutItem("library", current, item.instanceId, { width: item.width - 1 }),
                )
              }
            >
              <PanelLeftClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="statistic-layout-size-controls statistic-layout-size-controls-bottom">
          {sizeConfig.allowHeightResize && item.height < sizeConfig.maxHeight ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.expandHeight")}
              title={t("panelLayout.expandHeight")}
              onClick={() =>
                updateStatisticLayout((current) =>
                  resizeStatisticPanelLayoutItem(
                    "library",
                    current,
                    item.instanceId,
                    { height: item.height + 1 },
                    statisticLayoutOptions,
                  ),
                )
              }
            >
              <PanelBottomClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
          {sizeConfig.allowHeightResize && item.height > sizeConfig.minHeight ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.shrinkHeight")}
              title={t("panelLayout.shrinkHeight")}
              onClick={() =>
                updateStatisticLayout((current) =>
                  resizeStatisticPanelLayoutItem(
                    "library",
                    current,
                    item.instanceId,
                    { height: item.height - 1 },
                    statisticLayoutOptions,
                  ),
                )
              }
            >
              <PanelTopClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <section className="panel stack statistic-layout-header-panel">
        <div className="panel-title-row panel-title-row-with-actions">
          <div className="panel-title-row">
            <h2>{displayLibrary?.name ?? t("libraryDetail.loading")}</h2>
            {displayLibrary?.path ? (
              <TooltipTrigger ariaLabel={t("libraryDetail.libraryPathAria")} content={displayLibrary.path}>
                ?
              </TooltipTrigger>
            ) : null}
          </div>
          <StatisticPanelLayoutControls
            availableDefinitions={availableStatisticPanelDefinitions}
            isEditing={isEditingStatisticLayout}
            onStartEditing={() => {
              setDraftStatisticLayout(cloneStatisticPanelLayout(savedStatisticLayout));
              setIsEditingStatisticLayout(true);
            }}
            onCancelEditing={() => {
              setDraftStatisticLayout(cloneStatisticPanelLayout(savedStatisticLayout));
              setDraggedStatisticPanelId(null);
              setDropTargetStatisticPanelId(null);
              setIsEditingStatisticLayout(false);
            }}
            onRestoreDefault={() => {
              setDraftStatisticLayout(buildDefaultStatisticPanelLayout("library", statisticLayoutOptions));
              setDraggedStatisticPanelId(null);
              setDropTargetStatisticPanelId(null);
            }}
            onSaveEditing={() => {
              persistStatisticLayout(draftStatisticLayout);
              setDraggedStatisticPanelId(null);
              setDropTargetStatisticPanelId(null);
              setIsEditingStatisticLayout(false);
            }}
            onAddPanel={(statisticId) =>
              updateStatisticLayout((current) =>
                addStatisticPanelLayoutItem("library", current, statisticId, statisticLayoutOptions)
              )
            }
          />
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

      <div className={`media-grid statistic-layout-grid${isEditingStatisticLayout ? " is-editing" : ""}`}>
        {(() => {
          let collapsedPanelsBefore = 0;

          return visibleLayoutPanels.map((panel) => {
            const offsetCount = collapsedPanelsBefore;
            const isCollapsedLargePanel =
              (panel.definition.kind === "history" && isHistoryPanelCollapsed) ||
              (panel.definition.kind === "duplicates" && isDuplicatesPanelCollapsed);
            if (isCollapsedLargePanel) {
              collapsedPanelsBefore += 1;
            }

            const shellClassName = [
              "statistic-layout-panel-shell",
              `span-x-${panel.item.width}`,
              `span-y-${panel.item.height}`,
              panel.definition.kind === "history" ? "library-layout-panel-history" : "",
              panel.definition.kind === "duplicates" ? "library-layout-panel-duplicates" : "",
              panel.definition.kind === "analyzed_files" ? "library-layout-panel-analyzed-files" : "",
              panel.definition.kind === "history" && isHistoryPanelCollapsed ? "is-collapsed-panel" : "",
              panel.definition.kind === "duplicates" && isDuplicatesPanelCollapsed ? "is-collapsed-panel" : "",
              draggedStatisticPanelId === panel.item.instanceId ? "is-dragging" : "",
              dropTargetStatisticPanelId === panel.item.instanceId ? "is-drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ");

            let content: ReactNode;
            if (panel.definition.kind === "statistic" && panel.definition.statisticDefinition.panelKind === "comparison") {
              const selection = panel.item.comparisonSelection ?? getComparisonSelection("library");
              content = (
                <ComparisonChartPanel
                  comparison={comparisonByPanel[panel.item.instanceId] ?? null}
                  selection={selection}
                  resizeToken={`${panel.item.width}:${panel.item.height}`}
                  loading={Boolean(comparisonLoadingByPanel[panel.item.instanceId])}
                  error={comparisonErrorByPanel[panel.item.instanceId] ?? null}
                  onChangeXField={(xField) =>
                    updateComparisonSelection(panel.item.instanceId, { ...selection, xField })
                  }
                  onChangeYField={(yField) =>
                    updateComparisonSelection(panel.item.instanceId, { ...selection, yField })
                  }
                  onSwapAxes={() =>
                    updateComparisonSelection(panel.item.instanceId, {
                      ...selection,
                      xField: selection.yField,
                      yField: selection.xField,
                    })
                  }
                  onChangeRenderer={(renderer) =>
                    updateComparisonSelection(panel.item.instanceId, { ...selection, renderer })
                  }
                  onOpenFile={(fileId) => navigate(`/files/${fileId}`)}
                  onSelectFilters={(filters) =>
                    applyMetadataFilters(filters as Partial<Record<LibraryFileMetadataSearchField, string>>)
                  }
                />
              );
            } else if (
              panel.definition.kind === "statistic" &&
              panel.definition.statisticDefinition.panelKind === "numeric-chart" &&
              panel.definition.statisticDefinition.numericMetricId
            ) {
              const statisticDefinition = panel.definition.statisticDefinition;
              const metricId = statisticDefinition.numericMetricId;
              if (!metricId) {
                content = null;
              } else {
              const distribution = getLibraryStatisticNumericDistribution(libraryStatistics, statisticDefinition);
              content = (
                <DistributionChartPanel
                  title={t(statisticDefinition.panelTitleKey ?? statisticDefinition.nameKey)}
                  distribution={distribution}
                  metricId={metricId}
                  resizeToken={`${panel.item.width}:${panel.item.height}`}
                  loading={isStatisticsLoading && !libraryStatistics && !statisticsError}
                  error={statisticsError}
                  interactive={!statisticsError && !libraryStatistics ? false : true}
                  onSelectBin={
                    statisticsError || !libraryStatistics
                      ? undefined
                      : (bin) =>
                          applyStatisticFilter(
                            statisticDefinition.id,
                            buildNumericDistributionFilterExpression(metricId, bin),
                          )
                  }
                />
              );
              }
            } else if (panel.definition.kind === "statistic") {
              const statisticDefinition = panel.definition.statisticDefinition;
              const items =
                statisticDefinition.id === "hdr_type"
                  ? collapseHdrDistribution(getLibraryStatisticPanelItems(libraryStatistics, statisticDefinition))
                  : getLibraryStatisticPanelItems(libraryStatistics, statisticDefinition);
              const formattedItems: DistributionListEntry[] = items.map((item) => {
                const rawLabel = item.label;
                const filterValue = item.filter_value ?? rawLabel;
                const label = statisticDefinition.panelFormatKind
                  ? formatCodecLabel(rawLabel, statisticDefinition.panelFormatKind)
                  : rawLabel;
                const isApplied = hasSearchValueTokens(fieldValues[statisticDefinition.id], filterValue);
                return {
                  key: `${statisticDefinition.id}:${rawLabel}`,
                  label,
                  value: item.value,
                  disabled: isApplied,
                  ariaLabel: isApplied
                    ? t("libraryDetail.statistics.filterAlreadyApplied", {
                        field: t(statisticDefinition.nameKey),
                        value: label,
                      })
                    : t("libraryDetail.statistics.filterByValue", {
                        field: t(statisticDefinition.nameKey),
                        value: label,
                      }),
                  onClick:
                    statisticsError || !libraryStatistics
                      ? undefined
                      : () => applyStatisticFilter(statisticDefinition.id, filterValue),
                };
              });
              content = (
                <AsyncPanel
                  title={t(statisticDefinition.panelTitleKey ?? statisticDefinition.nameKey)}
                  loading={isStatisticsLoading && !libraryStatistics && !statisticsError}
                  error={statisticsError}
                  bodyClassName="async-panel-body-scroll"
                >
                  <DistributionList items={formattedItems} maxVisibleRows={5} scrollable />
                </AsyncPanel>
              );
            } else if (panel.definition.kind === "history") {
              content = (
                <LibraryHistoryPanel
                  history={libraryHistory}
                  loading={isHistoryLoading && !libraryHistory && !historyError}
                  error={historyError}
                  selectedMetric={selectedHistoryMetric}
                  onChangeMetric={setSelectedHistoryMetric}
                  collapsed={isHistoryPanelCollapsed}
                  onToggleCollapsed={() => setIsHistoryPanelCollapsed((current) => !current)}
                  currentResolutionCategoryIds={appSettings.resolution_categories?.map((category) => category.id) ?? []}
                  bodyId={`library-history-panel-body-${panel.item.instanceId}`}
                />
              );
            } else if (panel.definition.kind === "duplicates") {
              content = (
                <AsyncPanel
                  title={t("libraryDetail.duplicates.title")}
                  loading={isDuplicateGroupsLoading && !duplicateGroups && !duplicateGroupsError}
                  error={duplicateGroupsError}
                  bodyClassName="async-panel-body-scroll"
                  collapseActions={
                    <div className="duplicate-panel-title-actions">
                      {duplicateGroups ? <span className="badge">{duplicateGroups.total_groups}</span> : null}
                      {!isDuplicatesPanelCollapsed ? (
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
                      ) : null}
                    </div>
                  }
                  collapseButtonClassName="async-panel-toggle-icon-button-flat"
                  collapseState={{
                    collapsed: isDuplicatesPanelCollapsed,
                    onToggle: () => setIsDuplicatesPanelCollapsed((current) => !current),
                    bodyId: "library-duplicates-panel-body",
                  }}
                >
                  {duplicateGroups && filteredDuplicateGroups.length > 0 ? (
                    <div className="duplicate-group-list">
                      {filteredDuplicateGroups.map((group) => (
                        <div key={`${group.mode}:${group.signature}`} className="media-card duplicate-group-card">
                          <div className="duplicate-group-summary">
                            <div className="meta-tags">
                              <span className="badge">{t(`libraries.duplicateDetectionModes.${group.mode}`)}</span>
                              <span className="badge">{t("libraryDetail.duplicates.fileCount", { count: group.file_count })}</span>
                              <span className="badge">{formatBytes(group.total_size_bytes)}</span>
                            </div>
                            <code className="scan-log-path">{group.signature}</code>
                          </div>
                          <div className="scan-log-path-list duplicate-group-items-scroll">
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
              );
            } else {
              content = (
                <AsyncPanel
                  title={t("libraryDetail.analyzedFiles")}
                  error={filesError}
                  bodyClassName="async-panel-body-scroll"
                  titleAddon={
                    <div className="analyzed-files-title-addon">
                      <StatisticPanelLayoutControls
                        availableDefinitions={[]}
                        isEditing={isEditingTableView}
                        showAddButton={false}
                        editButtonLabel={t("libraryDetail.tableView.edit")}
                        editButtonTitle={t("libraryDetail.tableView.edit")}
                        editButtonIcon={<SettingsIcon className="statistic-layout-action-icon" size={18} />}
                        onStartEditing={() => {
                          setDraftTableViewSettings(cloneLibraryStatisticsSettings(savedTableViewSettings));
                          setIsEditingTableView(true);
                        }}
                        onCancelEditing={() => {
                          setDraftTableViewSettings(cloneLibraryStatisticsSettings(savedTableViewSettings));
                          setIsEditingTableView(false);
                        }}
                        onRestoreDefault={() => {
                          setDraftTableViewSettings(buildDefaultLibraryStatisticsSettings());
                        }}
                        onSaveEditing={() => {
                          persistTableViewSettings(draftTableViewSettings);
                          setIsEditingTableView(false);
                        }}
                        onAddPanel={() => undefined}
                      />
                      <span className="analyzed-files-count" aria-label={t("libraryDetail.indexedEntries", { count: filesTotal })}>
                        {String(filesTotal)}
                      </span>
                      {!isEditingTableView && showAnalyzedFilesCsvExport
                        ? renderExportButton("analyzed-files-export-button analyzed-files-export-button-desktop")
                        : null}
                    </div>
                  }
                  subtitleAddon={
                    !isEditingTableView && showAnalyzedFilesCsvExport
                      ? renderExportButton("analyzed-files-export-button analyzed-files-export-button-mobile")
                      : null
                  }
                  headerAddon={
                    !isEditingTableView ? (
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
                            <div
                              id="library-search-picker"
                              className="search-filter-picker-popover search-filter-picker-popover-scroll"
                              role="menu"
                            >
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
                    ) : null
                  }
                >
                  <div className="analyzed-files-panel-content">
                    {isEditingTableView ? (
                      <TableViewSettingsEditor
                        settings={draftTableViewSettings}
                        onChange={(nextSettings) => setDraftTableViewSettings(cloneLibraryStatisticsSettings(nextSettings))}
                      />
                    ) : (
                      <>
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
                                        ref={(element) => {
                                          headerCellRefs.current[column.key] = element;
                                        }}
                                      >
                                        <button type="button" className="column-sort" onClick={() => updateSort(column.key)}>
                                          <span>{t(column.labelKey)}</span>
                                          <span className={`sort-indicator${isActiveSort ? " is-active" : ""}`} aria-hidden="true">
                                            {isActiveSort ? sortIndicator(sortDirection) : ""}
                                          </span>
                                          {isActiveSort ? <span className="sr-only">{t(`sort.${sortDirection}`)}</span> : null}
                                        </button>
                                        <button
                                          type="button"
                                          className="column-resize-handle"
                                          aria-label={t("libraryDetail.resizeColumnAria", { column: t(column.labelKey) })}
                                          onPointerDown={(event) => beginColumnResize(column.key, event)}
                                          onDoubleClick={() => resetColumnWidth(column.key)}
                                        />
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
                      </>
                    )}
                  </div>
                </AsyncPanel>
              );
            }

            return (
              <div
                key={panel.item.instanceId}
                className={shellClassName}
                draggable={isEditingStatisticLayout}
                ref={panel.definition.kind === "analyzed_files" ? analyzedFilesPanelRef : undefined}
                onDragStart={() => {
                  if (!isEditingStatisticLayout) {
                    return;
                  }
                  setDraggedStatisticPanelId(panel.item.instanceId);
                  setDropTargetStatisticPanelId(null);
                }}
                onDragOver={(event) => {
                  if (!isEditingStatisticLayout || draggedStatisticPanelId === panel.item.instanceId) {
                    return;
                  }
                  event.preventDefault();
                  setDropTargetStatisticPanelId(panel.item.instanceId);
                }}
                onDragLeave={() => {
                  if (dropTargetStatisticPanelId === panel.item.instanceId) {
                    setDropTargetStatisticPanelId(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!isEditingStatisticLayout) {
                    return;
                  }
                  handleStatisticPanelDrop(panel.item.instanceId);
                }}
                onDragEnd={() => {
                  setDraggedStatisticPanelId(null);
                  setDropTargetStatisticPanelId(null);
                }}
                style={
                  {
                    "--collapsed-panel-offset-count": String(offsetCount),
                    "--statistic-panel-row-span": String(panel.item.height),
                  } as CSSProperties
                }
              >
                {content}
                {isEditingStatisticLayout ? (
                  <div className="statistic-layout-overlay">
                    <div className="statistic-layout-overlay-sheen" />
                    {renderStatisticPanelResizeControls(panel)}
                  </div>
                ) : null}
              </div>
            );
          });
        })()}
      </div>
    </>
  );
}

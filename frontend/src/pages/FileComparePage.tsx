import {
  ChevronDown,
  ChevronRight,
  Copy as CopyIcon,
  Diff,
  FileJson,
  Film,
  Funnel,
  Gauge,
  Info,
  Layers,
  Library,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { ChevronsRightLeftIcon } from "../components/ChevronsRightLeftIcon";
import { DeleteIcon } from "../components/DeleteIcon";
import { LoaderPinwheelIcon } from "../components/LoaderPinwheelIcon";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import {
  api,
  type LibrarySummary,
  type MediaFileDetail,
  type MediaFileQualityScoreDetail,
  type MediaFileSearchResult,
} from "../lib/api";
import { useAppData } from "../lib/app-data";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDate, formatDuration } from "../lib/format";
import { formatHdrType } from "../lib/hdr";

type CompareSide = "left" | "right";
type CompareDisplayMode = "all" | "differences";

type CompareFileState = {
  detail: MediaFileDetail | null;
  quality: MediaFileQualityScoreDetail | null;
  loading: boolean;
  error: string | null;
};

type CompareRow = {
  key: string;
  label: string;
  left: ReactNode;
  right: ReactNode;
  leftValue: unknown;
  rightValue: unknown;
};

type CompareSection = {
  id: string;
  title: string;
  icon: typeof Info;
  rows: CompareRow[];
  rawJson?: {
    left: Record<string, unknown> | null;
    right: Record<string, unknown> | null;
  };
};

const CHAPTER_COMPARE_PREVIEW_LIMIT = 10;

const DEFAULT_FILE_STATE: CompareFileState = {
  detail: null,
  quality: null,
  loading: false,
  error: null,
};

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function parseFileId(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedCompareValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((entry) => normalizedCompareValue(entry)).sort());
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value).trim().toLowerCase();
}

function compareRowHasDifference(entry: CompareRow): boolean {
  return normalizedCompareValue(entry.leftValue) !== normalizedCompareValue(entry.rightValue);
}

function searchResultMediaTypeLabel(result: MediaFileSearchResult, t: ReturnType<typeof useTranslation>["t"]): string {
  if (result.library_type === "audiobooks") return t("libraries.qualityProfiles.mediaTypes.audiobook");
  if (result.library_type === "music") return t("libraries.qualityProfiles.mediaTypes.music");
  if (result.library_type === "movies" || result.library_type === "series") return t("libraries.qualityProfiles.mediaTypes.video");
  return t(`libraryTypes.${result.library_type}`);
}

function formatBitRate(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return "n/a";
  }
  const megabitsPerSecond = value / 1_000_000;
  const decimals = megabitsPerSecond >= 10 ? 0 : 1;
  return `${megabitsPerSecond.toFixed(decimals)} Mbps`;
}

function valueOrFallback(value: string | number | boolean | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function compactList(values: Array<string | null | undefined>, fallback: string): string {
  const entries = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return entries.length > 0 ? entries.join(", ") : fallback;
}

function row(
  key: string,
  label: string,
  left: ReactNode,
  right: ReactNode,
  leftValue: unknown = left,
  rightValue: unknown = right,
): CompareRow {
  return { key, label, left, right, leftValue, rightValue };
}

function buildOverviewRows(
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  inDepthDolbyVisionProfiles: boolean,
): CompareRow[] {
  return [
    row("filename", t("fileCompare.rows.filename"), left?.filename ?? "n/a", right?.filename ?? "n/a", left?.filename, right?.filename),
    row("relativePath", t("fileDetail.relativePath"), left?.relative_path ?? "n/a", right?.relative_path ?? "n/a", left?.relative_path, right?.relative_path),
    row("library", t("fileCompare.rows.library"), left?.library_id ?? "n/a", right?.library_id ?? "n/a", left?.library_id, right?.library_id),
    row("container", t("fileDetail.containerLabel"), formatContainerLabel(left?.container ?? left?.extension), formatContainerLabel(right?.container ?? right?.extension), left?.container ?? left?.extension, right?.container ?? right?.extension),
    row("size", t("fileDetail.size"), left ? formatBytes(left.size_bytes) : "n/a", right ? formatBytes(right.size_bytes) : "n/a", left?.size_bytes, right?.size_bytes),
    row("duration", t("fileDetail.duration"), formatDuration(left?.duration ?? null), formatDuration(right?.duration ?? null), left?.duration, right?.duration),
    row("quality", t("fileDetail.quality"), left ? `${left.quality_score}/10` : "n/a", right ? `${right.quality_score}/10` : "n/a", left?.quality_score, right?.quality_score),
    row("videoCodec", t("fileTable.codec"), left?.video_codec ? formatCodecLabel(left.video_codec, "video") : "n/a", right?.video_codec ? formatCodecLabel(right.video_codec, "video") : "n/a", left?.video_codec, right?.video_codec),
    row("resolution", t("fileTable.resolution"), left?.resolution_category_label ?? left?.resolution ?? "n/a", right?.resolution_category_label ?? right?.resolution ?? "n/a", left?.resolution, right?.resolution),
    row(
      "hdr",
      t("fileTable.hdr"),
      left ? formatHdrType(left.hdr_type, { inDepthDolbyVisionProfiles }) ?? t("fileTable.sdr") : "n/a",
      right ? formatHdrType(right.hdr_type, { inDepthDolbyVisionProfiles }) ?? t("fileTable.sdr") : "n/a",
      formatHdrType(left?.hdr_type, { inDepthDolbyVisionProfiles }) ?? "sdr",
      formatHdrType(right?.hdr_type, { inDepthDolbyVisionProfiles }) ?? "sdr",
    ),
  ];
}

function buildFormatRows(
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    row("format", t("fileDetail.containerLabel"), formatContainerLabel(left?.container ?? left?.extension), formatContainerLabel(right?.container ?? right?.extension), left?.container ?? left?.extension, right?.container ?? right?.extension),
    row("bitRate", t("fileDetail.bitRate"), formatBitRate(left?.media_format?.bit_rate), formatBitRate(right?.media_format?.bit_rate), left?.media_format?.bit_rate, right?.media_format?.bit_rate),
    row("probeScore", t("fileDetail.probeScore"), left?.media_format?.probe_score ?? "n/a", right?.media_format?.probe_score ?? "n/a", left?.media_format?.probe_score, right?.media_format?.probe_score),
    row("modified", t("fileTable.modified"), left ? formatDate(new Date(left.mtime * 1000).toISOString()) : "n/a", right ? formatDate(new Date(right.mtime * 1000).toISOString()) : "n/a", left?.mtime, right?.mtime),
    row("lastAnalyzed", t("fileTable.lastAnalyzed"), formatDate(left?.last_analyzed_at ?? null), formatDate(right?.last_analyzed_at ?? null), left?.last_analyzed_at, right?.last_analyzed_at),
  ];
}

function buildQualityRows(
  left: MediaFileQualityScoreDetail | null,
  right: MediaFileQualityScoreDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const categoryKeys = [
    ...new Set([
      ...(left?.breakdown.categories.map((category) => category.key) ?? []),
      ...(right?.breakdown.categories.map((category) => category.key) ?? []),
    ]),
  ];
  return [
    row("score", t("fileDetail.quality"), left ? `${left.score}/10` : "n/a", right ? `${right.score}/10` : "n/a", left?.score, right?.score),
    row("raw", t("fileCompare.rows.rawQuality"), left ? left.score_raw.toFixed(2) : "n/a", right ? right.score_raw.toFixed(2) : "n/a", left?.score_raw, right?.score_raw),
    ...categoryKeys.map((key) => {
      const leftCategory = left?.breakdown.categories.find((category) => category.key === key);
      const rightCategory = right?.breakdown.categories.find((category) => category.key === key);
      return row(
        `category-${key}`,
        t(`quality.category.${key}`),
        leftCategory ? `${leftCategory.score}/100` : "n/a",
        rightCategory ? `${rightCategory.score}/100` : "n/a",
        leftCategory?.score,
        rightCategory?.score,
      );
    }),
  ];
}

function buildStreamRows(
  kind: "video" | "audio" | "subtitle",
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const leftStreams =
    kind === "video" ? left?.video_streams ?? [] : kind === "audio" ? left?.audio_streams ?? [] : left?.subtitle_streams ?? [];
  const rightStreams =
    kind === "video" ? right?.video_streams ?? [] : kind === "audio" ? right?.audio_streams ?? [] : right?.subtitle_streams ?? [];
  const length = Math.max(leftStreams.length, rightStreams.length);
  const rows: CompareRow[] = [
    row("count", t("fileCompare.rows.streamCount"), leftStreams.length, rightStreams.length),
  ];
  for (let index = 0; index < length; index += 1) {
    const leftStream = leftStreams[index] as Record<string, unknown> | undefined;
    const rightStream = rightStreams[index] as Record<string, unknown> | undefined;
    const label = t("fileCompare.rows.stream", { number: index + 1 });
    if (kind === "video") {
      rows.push(row(`${kind}-${index}`, label, compactList([
        valueOrFallback(leftStream?.codec as string | null | undefined, ""),
        valueOrFallback(leftStream?.profile as string | null | undefined, ""),
        leftStream?.width && leftStream?.height ? `${leftStream.width}x${leftStream.height}` : "",
        valueOrFallback(leftStream?.hdr_type as string | null | undefined, ""),
      ], "n/a"), compactList([
        valueOrFallback(rightStream?.codec as string | null | undefined, ""),
        valueOrFallback(rightStream?.profile as string | null | undefined, ""),
        rightStream?.width && rightStream?.height ? `${rightStream.width}x${rightStream.height}` : "",
        valueOrFallback(rightStream?.hdr_type as string | null | undefined, ""),
      ], "n/a"), leftStream ?? null, rightStream ?? null));
    } else if (kind === "audio") {
      rows.push(row(`${kind}-${index}`, label, compactList([
        valueOrFallback(leftStream?.codec as string | null | undefined, ""),
        valueOrFallback(leftStream?.profile as string | null | undefined, ""),
        valueOrFallback(leftStream?.spatial_audio_profile as string | null | undefined, ""),
        leftStream?.channels ? `${leftStream.channels} ch` : "",
        leftStream?.language ? String(leftStream.language) : "",
      ], "n/a"), compactList([
        valueOrFallback(rightStream?.codec as string | null | undefined, ""),
        valueOrFallback(rightStream?.profile as string | null | undefined, ""),
        valueOrFallback(rightStream?.spatial_audio_profile as string | null | undefined, ""),
        rightStream?.channels ? `${rightStream.channels} ch` : "",
        rightStream?.language ? String(rightStream.language) : "",
      ], "n/a"), leftStream ?? null, rightStream ?? null));
    } else {
      rows.push(row(`${kind}-${index}`, label, compactList([
        valueOrFallback(leftStream?.codec as string | null | undefined, ""),
        valueOrFallback(leftStream?.language as string | null | undefined, ""),
        valueOrFallback(leftStream?.subtitle_type as string | null | undefined, ""),
      ], "n/a"), compactList([
        valueOrFallback(rightStream?.codec as string | null | undefined, ""),
        valueOrFallback(rightStream?.language as string | null | undefined, ""),
        valueOrFallback(rightStream?.subtitle_type as string | null | undefined, ""),
      ], "n/a"), leftStream ?? null, rightStream ?? null));
    }
  }
  return rows;
}

function buildSubtitleRows(
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    ...buildStreamRows("subtitle", left, right, t),
    row("externalCount", t("fileCompare.rows.externalSubtitleCount"), left?.external_subtitles.length ?? 0, right?.external_subtitles.length ?? 0),
    row(
      "externalPaths",
      t("fileCompare.rows.externalSubtitlePaths"),
      compactList(left?.external_subtitles.map((subtitle) => subtitle.path) ?? [], "n/a"),
      compactList(right?.external_subtitles.map((subtitle) => subtitle.path) ?? [], "n/a"),
      left?.external_subtitles.map((subtitle) => subtitle.path),
      right?.external_subtitles.map((subtitle) => subtitle.path),
    ),
  ];
}

function buildCoverRows(
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    row("embedded", t("fileTable.embeddedCover"), left?.has_embedded_cover ? t("fileCompare.yes") : t("fileCompare.no"), right?.has_embedded_cover ? t("fileCompare.yes") : t("fileCompare.no"), left?.has_embedded_cover, right?.has_embedded_cover),
    row("codec", t("fileDetail.coverCodec"), left?.embedded_cover_codec || "n/a", right?.embedded_cover_codec || "n/a", left?.embedded_cover_codec, right?.embedded_cover_codec),
    row("dimensions", t("fileDetail.coverDimensions"), left?.embedded_cover_width && left?.embedded_cover_height ? `${left.embedded_cover_width}x${left.embedded_cover_height}` : "n/a", right?.embedded_cover_width && right?.embedded_cover_height ? `${right.embedded_cover_width}x${right.embedded_cover_height}` : "n/a", [left?.embedded_cover_width, left?.embedded_cover_height], [right?.embedded_cover_width, right?.embedded_cover_height]),
  ];
}

function buildChapterRows(
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const leftChapters = left?.chapters ?? [];
  const rightChapters = right?.chapters ?? [];
  const length = Math.max(leftChapters.length, rightChapters.length);
  const rows = [row("count", t("fileTable.chapterCount"), leftChapters.length, rightChapters.length)];
  for (let index = 0; index < length; index += 1) {
    const leftChapter = leftChapters[index];
    const rightChapter = rightChapters[index];
    rows.push(row(
      `chapter-${index}`,
      t("fileCompare.rows.chapter", { number: index + 1 }),
      compactList([leftChapter?.title ?? "", leftChapter?.duration !== null && leftChapter?.duration !== undefined ? formatDuration(leftChapter.duration) : ""], "n/a"),
      compactList([rightChapter?.title ?? "", rightChapter?.duration !== null && rightChapter?.duration !== undefined ? formatDuration(rightChapter.duration) : ""], "n/a"),
      leftChapter ?? null,
      rightChapter ?? null,
    ));
  }
  return rows;
}

function buildRawRows(
  left: MediaFileDetail | null,
  right: MediaFileDetail | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const leftKeys = Object.keys(left?.raw_ffprobe_json ?? {}).sort();
  const rightKeys = Object.keys(right?.raw_ffprobe_json ?? {}).sort();
  return [
    row("present", t("fileCompare.rows.rawJsonPresent"), left?.raw_ffprobe_json ? t("fileCompare.yes") : t("fileCompare.no"), right?.raw_ffprobe_json ? t("fileCompare.yes") : t("fileCompare.no"), Boolean(left?.raw_ffprobe_json), Boolean(right?.raw_ffprobe_json)),
    row("keys", t("fileCompare.rows.rawJsonKeys"), compactList(leftKeys, "n/a"), compactList(rightKeys, "n/a"), leftKeys, rightKeys),
  ];
}

function SearchSelect({
  side,
  selected,
  libraries,
  libraryId,
  blockedFileId,
  onChangeLibrary,
  onClear,
  onSelect,
}: {
  side: CompareSide;
  selected: MediaFileDetail | null;
  libraries: LibrarySummary[];
  libraryId: number | null;
  blockedFileId: number | null;
  onChangeLibrary: (libraryId: number | null) => void;
  onClear: () => void;
  onSelect: (fileId: number) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaFileSearchResult[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const selectedLibrary = selected ? libraries.find((library) => library.id === selected.library_id) : null;
  const selectedPathTitle = selected
    ? [selectedLibrary?.name, selected.relative_path].filter(Boolean).join(" / ")
    : undefined;

  useEffect(() => {
    if (!isFocused && !query.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      api.fileSearch({ query, libraryId, limit: 20, signal: controller.signal })
        .then((payload) => setResults(payload.items))
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            setResults([]);
          }
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isFocused, libraryId, query]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!controlRef.current?.contains(event.target as Node)) {
        setIsFilterOpen(false);
        setIsFocused(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div ref={controlRef} className="file-compare-search-card">
      {selected ? (
        <div className="file-compare-search-label">
          <strong title={selectedPathTitle}>{selected.filename}</strong>
          <button
            type="button"
            className="file-compare-clear-file-button"
            aria-label={t("fileCompare.removeFile", { filename: selected.filename })}
            data-tooltip={t("fileCompare.removeFile", { filename: selected.filename })}
            title={t("fileCompare.removeFile", { filename: selected.filename })}
            onClick={onClear}
          >
            <DeleteIcon size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="metadata-search-control metadata-search-control-base search-filter-picker file-compare-search-control">
        <button
          type="button"
          className={`search-filter-picker-button${isFilterOpen ? " is-open" : ""}`}
          aria-expanded={isFilterOpen}
          aria-label={t("fileCompare.search.libraryFilterAria")}
          onClick={() => setIsFilterOpen((current) => !current)}
        >
          <Funnel size={18} aria-hidden="true" />
        </button>
        {isFilterOpen ? (
          <div className="search-filter-picker-popover search-filter-picker-popover-scroll file-compare-library-popover" role="menu">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={libraryId === null}
              className={`search-filter-picker-item${libraryId === null ? " is-selected" : ""}`}
              onClick={() => {
                onChangeLibrary(null);
                setIsFilterOpen(false);
              }}
            >
              <Library size={16} aria-hidden="true" />
              <span>{t("fileCompare.search.allLibraries")}</span>
            </button>
            {libraries.map((library) => (
              <button
                key={library.id}
                type="button"
                role="menuitemradio"
                aria-checked={library.id === libraryId}
                className={`search-filter-picker-item${library.id === libraryId ? " is-selected" : ""}`}
                onClick={() => {
                  onChangeLibrary(library.id);
                  setIsFilterOpen(false);
                }}
              >
                <Library size={16} aria-hidden="true" />
                <span>{library.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        <label className="sr-only" htmlFor={`file-compare-${side}-search`}>
          {t("fileCompare.search.label", { side: t(`fileCompare.${side}`) })}
        </label>
        <input
          id={`file-compare-${side}-search`}
          type="search"
          value={query}
          placeholder={t("fileCompare.search.placeholder")}
          autoComplete="off"
          className={query ? "has-trailing-action" : undefined}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setIsFocused(true)}
        />
        {query ? (
          <button
            type="button"
            className="metadata-search-remove"
            aria-label={t("fileCompare.search.clear")}
            onClick={() => setQuery("")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {isFocused || results.length > 0 ? (
        <div className="file-compare-search-results">
          {loading ? (
            <div className="file-compare-search-status">
              <LoaderPinwheelIcon size={18} aria-hidden="true" />
              <span>{t("panel.loading")}</span>
            </div>
          ) : null}
          {!loading && results.length === 0 ? (
            <div className="file-compare-search-status">{t("fileCompare.search.empty")}</div>
          ) : null}
          {results.map((result) => {
            const isBlocked = result.id === blockedFileId;
            return (
              <button
                key={result.id}
                type="button"
                className={`file-compare-search-result${isBlocked ? " is-disabled" : ""}`}
                disabled={isBlocked}
                title={isBlocked ? t("fileCompare.search.alreadySelected") : undefined}
                onClick={() => {
                  if (isBlocked) {
                    return;
                  }
                  onSelect(result.id);
                  setQuery("");
                  setResults([]);
                  setIsFocused(false);
                }}
              >
                <span
                  className="file-compare-search-result-main"
                  title={`${result.library_name} / ${result.relative_path}`}
                >
                  {result.filename}
                </span>
                <span className="file-compare-search-result-meta">
                  {[formatBytes(result.size_bytes), searchResultMediaTypeLabel(result, t), result.library_name].join(" - ")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CompareSectionView({
  section,
  showOnlyDifferences = false,
}: {
  section: CompareSection;
  showOnlyDifferences?: boolean;
}) {
  const { t } = useTranslation();
  const changedCount = section.rows.filter(compareRowHasDifference).length;
  const [open, setOpen] = useState(() => changedCount > 0);
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedRawSide, setCopiedRawSide] = useState<CompareSide | null>(null);
  const rawCopyResetTimeoutRef = useRef<number | null>(null);
  const Icon = section.icon;
  const isChaptersSection = section.id === "chapters";
  const filteredRows = showOnlyDifferences ? section.rows.filter(compareRowHasDifference) : section.rows;
  const shouldLimitChapters = isChaptersSection && filteredRows.length > CHAPTER_COMPARE_PREVIEW_LIMIT + 1;
  const showAllChapterCount = showOnlyDifferences
    ? filteredRows.length
    : Math.max(0, section.rows.length - 1);
  const visibleRows = shouldLimitChapters && !showAllChapters
    ? filteredRows.slice(0, CHAPTER_COMPARE_PREVIEW_LIMIT + 1)
    : filteredRows;
  const hasRawJson = Boolean(section.rawJson);
  const canCopyRawJson = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText);

  useEffect(() => {
    setOpen(changedCount > 0);
  }, [changedCount, section.id]);

  useEffect(() => () => {
    if (rawCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(rawCopyResetTimeoutRef.current);
    }
  }, []);

  const copyRawJson = useCallback(async (side: CompareSide) => {
    const clipboard = navigator.clipboard;
    const value = section.rawJson?.[side] ?? {};
    if (!clipboard?.writeText) {
      return;
    }
    await clipboard.writeText(JSON.stringify(value, null, 2));
    setCopiedRawSide(side);
    if (rawCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(rawCopyResetTimeoutRef.current);
    }
    rawCopyResetTimeoutRef.current = window.setTimeout(() => {
      setCopiedRawSide(null);
      rawCopyResetTimeoutRef.current = null;
    }, 1600);
  }, [section.rawJson]);

  return (
    <section className="panel file-compare-section">
      <button
        type="button"
        className="file-compare-section-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="file-compare-section-title">
          <Icon size={18} aria-hidden="true" />
          <span>{section.title}</span>
          {changedCount > 0 ? (
            <span
              className="badge file-compare-section-diff-badge"
              aria-label={t("fileCompare.changedCount", { count: changedCount })}
              title={t("fileCompare.changedCount", { count: changedCount })}
            >
              <Diff size={14} aria-hidden="true" />
              <span>{changedCount}</span>
            </span>
          ) : null}
        </span>
        {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>
      {open ? (
        <div className="file-compare-row-list">
          {visibleRows.map((entry) => {
            const changed = compareRowHasDifference(entry);
            return (
              <div key={entry.key} className={`file-compare-row${changed ? " has-difference" : " is-identical"}`}>
                <div className="file-compare-row-label">{entry.label}</div>
                <div className="file-compare-cell file-compare-cell-left">{entry.left}</div>
                <div className="file-compare-cell file-compare-cell-right">{entry.right}</div>
              </div>
            );
          })}
          {shouldLimitChapters ? (
            <div className="file-compare-section-more">
              <button
                type="button"
                className="secondary small settings-panel-header-action"
                onClick={() => setShowAllChapters((current) => !current)}
              >
                {showAllChapters
                  ? t("fileCompare.showLessChapters")
                  : t("fileCompare.showAllChapters", { count: showAllChapterCount })}
              </button>
            </div>
          ) : null}
          {hasRawJson ? (
            <div className="file-compare-section-more file-compare-raw-json-actions">
              <button
                type="button"
                className="secondary small settings-panel-header-action"
                onClick={() => setShowRawJson((current) => !current)}
              >
                {showRawJson ? t("fileCompare.hideFullRawJson") : t("fileCompare.showFullRawJson")}
              </button>
            </div>
          ) : null}
          {hasRawJson && showRawJson ? (
            <div className="file-compare-raw-json-grid">
              {(["left", "right"] as CompareSide[]).map((side) => {
                const copyLabel = copiedRawSide === side ? t("fileDetail.rawJsonCopied") : t("fileDetail.copyRawJson");
                return (
                  <div key={side} className="file-compare-raw-json-panel">
                    <div className="file-compare-raw-json-toolbar">
                      <strong>{side === "left" ? t("fileCompare.left") : t("fileCompare.right")}</strong>
                      <button
                        type="button"
                        className="secondary icon-only-button async-panel-toggle-icon-button-flat file-detail-raw-json-copy-button"
                        aria-label={copyLabel}
                        data-tooltip={copyLabel}
                        title={copyLabel}
                        disabled={!canCopyRawJson}
                        onClick={() => void copyRawJson(side)}
                      >
                        <CopyIcon aria-hidden="true" className="nav-icon" size={20} />
                      </button>
                    </div>
                    <JsonPreview value={section.rawJson?.[side] ?? {}} />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function FileComparePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { appSettings, libraries, librariesLoaded, loadLibraries } = useAppData();
  const inDepthDolbyVisionProfiles = appSettings.feature_flags.in_depth_dolby_vision_profiles;
  const leftId = parseFileId(searchParams.get("left"));
  const rightId = parseFileId(searchParams.get("right"));
  const [leftState, setLeftState] = useState<CompareFileState>(DEFAULT_FILE_STATE);
  const [rightState, setRightState] = useState<CompareFileState>(DEFAULT_FILE_STATE);
  const [leftLibraryFilter, setLeftLibraryFilter] = useState<number | null>(null);
  const [rightLibraryFilter, setRightLibraryFilter] = useState<number | null>(null);
  const [displayMode, setDisplayMode] = useState<CompareDisplayMode>("all");

  useEffect(() => {
    if (!librariesLoaded) {
      void loadLibraries(false);
    }
  }, [librariesLoaded, loadLibraries]);

  const loadFile = useCallback((side: CompareSide, fileId: number | null) => {
    const setState = side === "left" ? setLeftState : setRightState;
    if (!fileId) {
      setState(DEFAULT_FILE_STATE);
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    Promise.all([
      api.file(fileId),
      api.fileQualityScore(fileId).catch(() => null),
    ])
      .then(([detail, quality]) => {
        setState({ detail, quality, loading: false, error: null });
      })
      .catch((error: Error) => {
        setState({ detail: null, quality: null, loading: false, error: error.message });
      });
  }, []);

  useEffect(() => loadFile("left", leftId), [leftId, loadFile]);
  useEffect(() => loadFile("right", rightId), [rightId, loadFile]);

  const updateSelectedFile = useCallback(
    (side: CompareSide, fileId: number) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set(side, String(fileId));
        return next;
      });
    },
    [setSearchParams],
  );

  const clearSelectedFile = useCallback(
    (side: CompareSide) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete(side);
        return next;
      });
    },
    [setSearchParams],
  );

  const swapSelectedFiles = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const currentLeft = current.get("left");
      const currentRight = current.get("right");
      if (currentRight) {
        next.set("left", currentRight);
      } else {
        next.delete("left");
      }
      if (currentLeft) {
        next.set("right", currentLeft);
      } else {
        next.delete("right");
      }
      return next;
    });
  }, [setSearchParams]);

  const sections = useMemo<CompareSection[]>(() => [
    {
      id: "overview",
      title: t("fileDetail.navigation.overview"),
      icon: Info,
      rows: buildOverviewRows(leftState.detail, rightState.detail, t, inDepthDolbyVisionProfiles),
    },
    {
      id: "format",
      title: t("fileDetail.format"),
      icon: Film,
      rows: buildFormatRows(leftState.detail, rightState.detail, t),
    },
    {
      id: "quality",
      title: t("fileDetail.qualityBreakdown"),
      icon: Gauge,
      rows: buildQualityRows(leftState.quality, rightState.quality, t),
    },
    {
      id: "video",
      title: t("fileDetail.videoStreams"),
      icon: Film,
      rows: buildStreamRows("video", leftState.detail, rightState.detail, t),
    },
    {
      id: "audio",
      title: t("fileDetail.audioStreams"),
      icon: Gauge,
      rows: buildStreamRows("audio", leftState.detail, rightState.detail, t),
    },
    {
      id: "subtitles",
      title: t("fileDetail.subtitles"),
      icon: Info,
      rows: buildSubtitleRows(leftState.detail, rightState.detail, t),
    },
    {
      id: "cover",
      title: t("fileDetail.cover"),
      icon: Info,
      rows: buildCoverRows(leftState.detail, rightState.detail, t),
    },
    {
      id: "chapters",
      title: t("fileDetail.chapters"),
      icon: Info,
      rows: buildChapterRows(leftState.detail, rightState.detail, t),
    },
    {
      id: "raw",
      title: t("fileDetail.rawJson"),
      icon: FileJson,
      rows: buildRawRows(leftState.detail, rightState.detail, t),
      rawJson: {
        left: leftState.detail?.raw_ffprobe_json ?? {},
        right: rightState.detail?.raw_ffprobe_json ?? {},
      },
    },
  ], [inDepthDolbyVisionProfiles, leftState.detail, leftState.quality, rightState.detail, rightState.quality, t]);

  const loading = leftState.loading || rightState.loading;
  const error = leftState.error ?? rightState.error;
  const canCompare = Boolean(leftState.detail && rightState.detail);
  const displayModeOptions = useMemo(
    () => [
      { key: "all" as const, label: t("fileCompare.displayMode.all"), icon: Layers },
      { key: "differences" as const, label: t("fileCompare.displayMode.differences"), icon: Diff },
    ],
    [t],
  );
  const visibleSections = displayMode === "differences"
    ? sections.filter((section) => section.rows.some(compareRowHasDifference))
    : sections;

  return (
    <div className="file-compare-page">
      <section className="panel file-compare-panel">
        <div className="panel-title-row panel-title-row-with-actions">
          <div className="file-compare-title-block">
            <h2>{t("fileCompare.title")}</h2>
            <p className="subtitle">{t("fileCompare.subtitle")}</p>
          </div>
        </div>
        <div className="file-compare-body">
          <div className={`file-compare-toolbar${leftState.detail || rightState.detail ? " has-file-labels" : ""}`}>
            <div
              className="distribution-chart-mode-toggle duplicate-panel-view-toggle file-compare-display-toggle"
              role="group"
              aria-label={t("fileCompare.displayMode.label")}
            >
              <SlidingTogglePill
                activeKey={displayMode}
                className="nav-active-pill distribution-chart-mode-pill"
              />
              {displayModeOptions.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  data-toggle-key={key}
                  className={`distribution-chart-mode-button duplicate-panel-view-button file-compare-display-button${
                    displayMode === key ? " active" : ""
                  }`}
                  aria-label={label}
                  title={label}
                  onClick={() => setDisplayMode(key)}
                >
                  <span className="distribution-chart-mode-button-content">
                    <Icon aria-hidden="true" className="distribution-chart-mode-icon" />
                  </span>
                </button>
              ))}
            </div>
            <SearchSelect
              side="left"
              selected={leftState.detail}
              libraries={libraries}
              libraryId={leftLibraryFilter}
              blockedFileId={rightState.detail?.id ?? null}
              onChangeLibrary={setLeftLibraryFilter}
              onClear={() => clearSelectedFile("left")}
              onSelect={(fileId) => updateSelectedFile("left", fileId)}
            />
            <button
              type="button"
              className="file-compare-swap-button"
              aria-label={t("fileCompare.swapFiles")}
              data-tooltip={t("fileCompare.swapFiles")}
              title={t("fileCompare.swapFiles")}
              onClick={swapSelectedFiles}
              disabled={!leftId && !rightId}
            >
              <ChevronsRightLeftIcon size={22} aria-hidden="true" />
            </button>
            <SearchSelect
              side="right"
              selected={rightState.detail}
              libraries={libraries}
              libraryId={rightLibraryFilter}
              blockedFileId={leftState.detail?.id ?? null}
              onChangeLibrary={setRightLibraryFilter}
              onClear={() => clearSelectedFile("right")}
              onSelect={(fileId) => updateSelectedFile("right", fileId)}
            />
          </div>
          <div className="file-compare-results-body">
            {loading ? (
              <div className="panel-loader" role="status" aria-live="polite">
                <LoaderPinwheelIcon className="panel-loader-icon" size={30} />
                <span>{t("panel.loading")}</span>
              </div>
            ) : null}
            {error ? <div className="alert">{error}</div> : null}
            {!loading && !error && !canCompare ? (
              <div className="duplicate-panel-empty-state" role="status">
                {t("fileCompare.emptySelection")}
              </div>
            ) : null}
            {!loading && !error && canCompare ? (
              visibleSections.length > 0 ? (
                <div className="file-compare-sections">
                  {visibleSections.map((section) => (
                    <CompareSectionView
                      key={section.id}
                      section={section}
                      showOnlyDifferences={displayMode === "differences"}
                    />
                  ))}
                </div>
              ) : (
                <div className="duplicate-panel-empty-state" role="status">
                  {t("fileCompare.noDifferences")}
                </div>
              )
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

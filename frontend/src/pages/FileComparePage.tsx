import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Columns3,
  Columns3Cog,
  Columns4,
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
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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

type CompareSlotKey = "left" | "right" | "third" | "fourth";
type CompareDisplayMode = "all" | "differences";
type CompareColumnCount = 2 | 3 | 4;

type CompareFileState = {
  detail: MediaFileDetail | null;
  quality: MediaFileQualityScoreDetail | null;
  loading: boolean;
  error: string | null;
};

type CompareRow = {
  key: string;
  label: string;
  cells: CompareCell[];
};

type CompareCell = {
  key: CompareSlotKey;
  content: ReactNode;
  value: unknown;
  isEmptySlot?: boolean;
};

type CompareSection = {
  id: string;
  title: string;
  icon: typeof Info;
  rows: CompareRow[];
  rawJson?: CompareRawJsonEntry[];
};

type CompareSlot = {
  key: CompareSlotKey;
  param: string;
};

type CompareFileColumn = CompareSlot & {
  detail: MediaFileDetail | null;
  quality: MediaFileQualityScoreDetail | null;
};

type CompareRawJsonEntry = {
  key: CompareSlotKey;
  label: string;
  value: Record<string, unknown> | null;
};

const CHAPTER_COMPARE_PREVIEW_LIMIT = 10;
const COMPARE_COLUMN_COUNT_STORAGE_KEY = "medialyze-file-compare-column-count";
const COMPARE_SLOTS: CompareSlot[] = [
  { key: "left", param: "left" },
  { key: "right", param: "right" },
  { key: "third", param: "third" },
  { key: "fourth", param: "fourth" },
];
const COMPARE_COLUMN_OPTIONS: Array<{ count: CompareColumnCount; icon: typeof Columns2 }> = [
  { count: 2, icon: Columns2 },
  { count: 3, icon: Columns3 },
  { count: 4, icon: Columns4 },
];

const DEFAULT_FILE_STATE: CompareFileState = {
  detail: null,
  quality: null,
  loading: false,
  error: null,
};

const DEFAULT_FILE_STATES: Record<CompareSlotKey, CompareFileState> = {
  left: { ...DEFAULT_FILE_STATE },
  right: { ...DEFAULT_FILE_STATE },
  third: { ...DEFAULT_FILE_STATE },
  fourth: { ...DEFAULT_FILE_STATE },
};

const DEFAULT_LIBRARY_FILTERS: Record<CompareSlotKey, number | null> = {
  left: null,
  right: null,
  third: null,
  fourth: null,
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
  const comparableCells = entry.cells.filter((cellEntry) => !cellEntry.isEmptySlot);
  if (comparableCells.length < 2) {
    return false;
  }
  return new Set(comparableCells.map((cellEntry) => normalizedCompareValue(cellEntry.value))).size > 1;
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

function getSlotLabel(slotKey: CompareSlotKey, t: (key: string, options?: Record<string, unknown>) => string): string {
  return t(`fileCompare.${slotKey}`);
}

function readStoredCompareColumnCount(searchParams: URLSearchParams): CompareColumnCount {
  const stored = typeof window !== "undefined"
    ? Number(window.localStorage.getItem(COMPARE_COLUMN_COUNT_STORAGE_KEY))
    : 2;
  const highestParamCount = searchParams.get("fourth") ? 4 : searchParams.get("third") ? 3 : 2;
  const storedCount = stored === 3 || stored === 4 ? stored : 2;
  return Math.max(storedCount, highestParamCount) as CompareColumnCount;
}

function compareCell(key: CompareSlotKey, content: ReactNode, value: unknown = content, isEmptySlot = false): CompareCell {
  return { key, content, value, isEmptySlot };
}

function row(
  key: string,
  label: string,
  cells: CompareCell[],
): CompareRow {
  return { key, label, cells };
}

function buildOverviewRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
  inDepthDolbyVisionProfiles: boolean,
): CompareRow[] {
  return [
    row("filename", t("fileCompare.rows.filename"), columns.map(({ key, detail }) => compareCell(key, detail?.filename ?? "n/a", detail?.filename, !detail))),
    row("relativePath", t("fileDetail.relativePath"), columns.map(({ key, detail }) => compareCell(key, detail?.relative_path ?? "n/a", detail?.relative_path, !detail))),
    row("library", t("fileCompare.rows.library"), columns.map(({ key, detail }) => compareCell(key, detail?.library_id ?? "n/a", detail?.library_id, !detail))),
    row("container", t("fileDetail.containerLabel"), columns.map(({ key, detail }) => compareCell(key, formatContainerLabel(detail?.container ?? detail?.extension), detail?.container ?? detail?.extension, !detail))),
    row("size", t("fileDetail.size"), columns.map(({ key, detail }) => compareCell(key, detail ? formatBytes(detail.size_bytes) : "n/a", detail?.size_bytes, !detail))),
    row("duration", t("fileDetail.duration"), columns.map(({ key, detail }) => compareCell(key, formatDuration(detail?.duration ?? null), detail?.duration, !detail))),
    row("quality", t("fileDetail.quality"), columns.map(({ key, detail }) => compareCell(key, detail ? `${detail.quality_score}/10` : "n/a", detail?.quality_score, !detail))),
    row("videoCodec", t("fileTable.codec"), columns.map(({ key, detail }) => compareCell(key, detail?.video_codec ? formatCodecLabel(detail.video_codec, "video") : "n/a", detail?.video_codec, !detail))),
    row("resolution", t("fileTable.resolution"), columns.map(({ key, detail }) => compareCell(key, detail?.resolution_category_label ?? detail?.resolution ?? "n/a", detail?.resolution, !detail))),
    row(
      "hdr",
      t("fileTable.hdr"),
      columns.map(({ key, detail }) => compareCell(
        key,
        detail ? formatHdrType(detail.hdr_type, { inDepthDolbyVisionProfiles }) ?? t("fileTable.sdr") : "n/a",
        detail ? formatHdrType(detail.hdr_type, { inDepthDolbyVisionProfiles }) ?? "sdr" : null,
        !detail,
      )),
    ),
  ];
}

function buildFormatRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    row("format", t("fileDetail.containerLabel"), columns.map(({ key, detail }) => compareCell(key, formatContainerLabel(detail?.container ?? detail?.extension), detail?.container ?? detail?.extension, !detail))),
    row("bitRate", t("fileDetail.bitRate"), columns.map(({ key, detail }) => compareCell(key, formatBitRate(detail?.media_format?.bit_rate), detail?.media_format?.bit_rate, !detail))),
    row("probeScore", t("fileDetail.probeScore"), columns.map(({ key, detail }) => compareCell(key, detail?.media_format?.probe_score ?? "n/a", detail?.media_format?.probe_score, !detail))),
    row("modified", t("fileTable.modified"), columns.map(({ key, detail }) => compareCell(key, detail ? formatDate(new Date(detail.mtime * 1000).toISOString()) : "n/a", detail?.mtime, !detail))),
    row("lastAnalyzed", t("fileTable.lastAnalyzed"), columns.map(({ key, detail }) => compareCell(key, formatDate(detail?.last_analyzed_at ?? null), detail?.last_analyzed_at, !detail))),
  ];
}

function buildQualityRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const categoryKeys = [
    ...new Set([
      ...columns.flatMap(({ quality }) => quality?.breakdown.categories.map((category) => category.key) ?? []),
    ]),
  ];
  return [
    row("score", t("fileDetail.quality"), columns.map(({ key, detail, quality }) => compareCell(key, quality ? `${quality.score}/10` : "n/a", quality?.score, !detail))),
    row("raw", t("fileCompare.rows.rawQuality"), columns.map(({ key, detail, quality }) => compareCell(key, quality ? quality.score_raw.toFixed(2) : "n/a", quality?.score_raw, !detail))),
    ...categoryKeys.map((key) => {
      return row(
        `category-${key}`,
        t(`quality.category.${key}`),
        columns.map(({ key: slotKey, detail, quality }) => {
          const category = quality?.breakdown.categories.find((entry) => entry.key === key);
          return compareCell(slotKey, category ? `${category.score}/100` : "n/a", category?.score, !detail);
        }),
      );
    }),
  ];
}

function buildStreamRows(
  kind: "video" | "audio" | "subtitle",
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const streamGroups = columns.map(({ key, detail }) => ({
    key,
    isEmptySlot: !detail,
    streams: kind === "video" ? detail?.video_streams ?? [] : kind === "audio" ? detail?.audio_streams ?? [] : detail?.subtitle_streams ?? [],
  }));
  const length = Math.max(0, ...streamGroups.map(({ streams }) => streams.length));
  const rows: CompareRow[] = [
    row("count", t("fileCompare.rows.streamCount"), streamGroups.map(({ key, streams, isEmptySlot }) => compareCell(key, streams.length, streams.length, isEmptySlot))),
  ];
  for (let index = 0; index < length; index += 1) {
    const label = t("fileCompare.rows.stream", { number: index + 1 });
    if (kind === "video") {
      rows.push(row(`${kind}-${index}`, label, streamGroups.map(({ key, streams, isEmptySlot }) => {
        const stream = streams[index] as Record<string, unknown> | undefined;
        return compareCell(key, compactList([
          valueOrFallback(stream?.codec as string | null | undefined, ""),
          valueOrFallback(stream?.profile as string | null | undefined, ""),
          stream?.width && stream?.height ? `${stream.width}x${stream.height}` : "",
          valueOrFallback(stream?.hdr_type as string | null | undefined, ""),
        ], "n/a"), stream ?? null, isEmptySlot);
      })));
    } else if (kind === "audio") {
      rows.push(row(`${kind}-${index}`, label, streamGroups.map(({ key, streams, isEmptySlot }) => {
        const stream = streams[index] as Record<string, unknown> | undefined;
        return compareCell(key, compactList([
          valueOrFallback(stream?.codec as string | null | undefined, ""),
          valueOrFallback(stream?.profile as string | null | undefined, ""),
          valueOrFallback(stream?.spatial_audio_profile as string | null | undefined, ""),
          stream?.channels ? `${stream.channels} ch` : "",
          stream?.language ? String(stream.language) : "",
        ], "n/a"), stream ?? null, isEmptySlot);
      })));
    } else {
      rows.push(row(`${kind}-${index}`, label, streamGroups.map(({ key, streams, isEmptySlot }) => {
        const stream = streams[index] as Record<string, unknown> | undefined;
        return compareCell(key, compactList([
          valueOrFallback(stream?.codec as string | null | undefined, ""),
          valueOrFallback(stream?.language as string | null | undefined, ""),
          valueOrFallback(stream?.subtitle_type as string | null | undefined, ""),
        ], "n/a"), stream ?? null, isEmptySlot);
      })));
    }
  }
  return rows;
}

function buildSubtitleRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    ...buildStreamRows("subtitle", columns, t),
    row("externalCount", t("fileCompare.rows.externalSubtitleCount"), columns.map(({ key, detail }) => compareCell(key, detail?.external_subtitles.length ?? 0, detail?.external_subtitles.length ?? 0, !detail))),
    row(
      "externalPaths",
      t("fileCompare.rows.externalSubtitlePaths"),
      columns.map(({ key, detail }) => compareCell(
        key,
        compactList(detail?.external_subtitles.map((subtitle) => subtitle.path) ?? [], "n/a"),
        detail?.external_subtitles.map((subtitle) => subtitle.path),
        !detail,
      )),
    ),
  ];
}

function buildCoverRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    row("embedded", t("fileTable.embeddedCover"), columns.map(({ key, detail }) => compareCell(key, detail?.has_embedded_cover ? t("fileCompare.yes") : t("fileCompare.no"), detail?.has_embedded_cover, !detail))),
    row("codec", t("fileDetail.coverCodec"), columns.map(({ key, detail }) => compareCell(key, detail?.embedded_cover_codec || "n/a", detail?.embedded_cover_codec, !detail))),
    row("dimensions", t("fileDetail.coverDimensions"), columns.map(({ key, detail }) => compareCell(
      key,
      detail?.embedded_cover_width && detail?.embedded_cover_height ? `${detail.embedded_cover_width}x${detail.embedded_cover_height}` : "n/a",
      [detail?.embedded_cover_width, detail?.embedded_cover_height],
      !detail,
    ))),
  ];
}

function buildChapterRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  const chapterGroups = columns.map(({ key, detail }) => ({ key, isEmptySlot: !detail, chapters: detail?.chapters ?? [] }));
  const length = Math.max(0, ...chapterGroups.map(({ chapters }) => chapters.length));
  const rows = [row("count", t("fileTable.chapterCount"), chapterGroups.map(({ key, chapters, isEmptySlot }) => compareCell(key, chapters.length, chapters.length, isEmptySlot)))];
  for (let index = 0; index < length; index += 1) {
    rows.push(row(
      `chapter-${index}`,
      t("fileCompare.rows.chapter", { number: index + 1 }),
      chapterGroups.map(({ key, chapters, isEmptySlot }) => {
        const chapter = chapters[index];
        return compareCell(
          key,
          compactList([chapter?.title ?? "", chapter?.duration !== null && chapter?.duration !== undefined ? formatDuration(chapter.duration) : ""], "n/a"),
          chapter ?? null,
          isEmptySlot,
        );
      }),
    ));
  }
  return rows;
}

function buildRawRows(
  columns: CompareFileColumn[],
  t: (key: string, options?: Record<string, unknown>) => string,
): CompareRow[] {
  return [
    row("present", t("fileCompare.rows.rawJsonPresent"), columns.map(({ key, detail }) => compareCell(key, detail?.raw_ffprobe_json ? t("fileCompare.yes") : t("fileCompare.no"), Boolean(detail?.raw_ffprobe_json), !detail))),
    row("keys", t("fileCompare.rows.rawJsonKeys"), columns.map(({ key, detail }) => {
      const keys = Object.keys(detail?.raw_ffprobe_json ?? {}).sort();
      return compareCell(key, compactList(keys, "n/a"), keys, !detail);
    })),
  ];
}

function SearchSelect({
  slotKey,
  selected,
  reserveLabelSpace = false,
  libraries,
  libraryId,
  blockedFileIds,
  onChangeLibrary,
  onClear,
  onSelect,
}: {
  slotKey: CompareSlotKey;
  selected: MediaFileDetail | null;
  reserveLabelSpace?: boolean;
  libraries: LibrarySummary[];
  libraryId: number | null;
  blockedFileIds: number[];
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
      {selected || reserveLabelSpace ? (
        <div className={`file-compare-search-label${selected ? "" : " is-empty"}`}>
          {selected ? (
            <>
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
            </>
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
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
        <label className="sr-only" htmlFor={`file-compare-${slotKey}-search`}>
          {t("fileCompare.search.label", { side: getSlotLabel(slotKey, t) })}
        </label>
        <input
          id={`file-compare-${slotKey}-search`}
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
            const isBlocked = blockedFileIds.includes(result.id);
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

function ColumnCountPicker({
  value,
  onChange,
}: {
  value: CompareColumnCount;
  onChange: (value: CompareColumnCount) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div ref={pickerRef} className="search-filter-picker file-compare-column-count-picker">
      <button
        type="button"
        className={`file-compare-column-count-button${open ? " is-open" : ""}`}
        aria-label={t("fileCompare.columnCount.label")}
        aria-expanded={open}
        title={t("fileCompare.columnCount.label")}
        onClick={() => setOpen((current) => !current)}
      >
        <Columns3Cog size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div className="search-filter-picker-popover file-compare-column-count-popover" role="menu">
          {COMPARE_COLUMN_OPTIONS.map(({ count, icon: Icon }) => (
            <button
              key={count}
              type="button"
              role="menuitemradio"
              aria-checked={value === count}
              className={`search-filter-picker-item${value === count ? " is-selected" : ""}`}
              onClick={() => {
                onChange(count);
                setOpen(false);
              }}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{t(`fileCompare.columnCount.${count}`)}</span>
            </button>
          ))}
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
  const [copiedRawSide, setCopiedRawSide] = useState<CompareSlotKey | null>(null);
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

  const copyRawJson = useCallback(async (side: CompareSlotKey) => {
    const clipboard = navigator.clipboard;
    const value = section.rawJson?.find((entry) => entry.key === side)?.value ?? {};
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
            const columnStyle = {
              "--file-compare-value-columns": entry.cells.length,
            } as CSSProperties;
            return (
              <div
                key={entry.key}
                className={`file-compare-row${changed ? " has-difference" : " is-identical"}`}
                style={columnStyle}
              >
                <div className="file-compare-row-label">{entry.label}</div>
                {entry.cells.map((cellEntry) => (
                  <div
                    key={cellEntry.key}
                    className={`file-compare-cell${cellEntry.isEmptySlot ? " is-empty-slot" : ""}`}
                  >
                    {cellEntry.content}
                  </div>
                ))}
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
            <div
              className="file-compare-raw-json-grid"
              style={{ "--file-compare-value-columns": section.rawJson?.length ?? 2 } as CSSProperties}
            >
              {section.rawJson?.map(({ key, label, value }) => {
                const copyLabel = copiedRawSide === key ? t("fileDetail.rawJsonCopied") : t("fileDetail.copyRawJson");
                return (
                  <div key={key} className="file-compare-raw-json-panel">
                    <div className="file-compare-raw-json-toolbar">
                      <strong>{label}</strong>
                      <button
                        type="button"
                        className="secondary icon-only-button async-panel-toggle-icon-button-flat file-detail-raw-json-copy-button"
                        aria-label={copyLabel}
                        data-tooltip={copyLabel}
                        title={copyLabel}
                        disabled={!canCopyRawJson}
                        onClick={() => void copyRawJson(key)}
                      >
                        <CopyIcon aria-hidden="true" className="nav-icon" size={20} />
                      </button>
                    </div>
                    <JsonPreview value={value ?? {}} />
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
  const selectedIds = useMemo(() => Object.fromEntries(
    COMPARE_SLOTS.map((slot) => [slot.key, parseFileId(searchParams.get(slot.param))]),
  ) as Record<CompareSlotKey, number | null>, [searchParams]);
  const [fileStates, setFileStates] = useState<Record<CompareSlotKey, CompareFileState>>(DEFAULT_FILE_STATES);
  const [libraryFilters, setLibraryFilters] = useState<Record<CompareSlotKey, number | null>>(DEFAULT_LIBRARY_FILTERS);
  const [displayMode, setDisplayMode] = useState<CompareDisplayMode>("all");
  const [columnCount, setColumnCount] = useState<CompareColumnCount>(() => readStoredCompareColumnCount(searchParams));

  useEffect(() => {
    if (!librariesLoaded) {
      void loadLibraries(false);
    }
  }, [librariesLoaded, loadLibraries]);

  useEffect(() => {
    window.localStorage.setItem(COMPARE_COLUMN_COUNT_STORAGE_KEY, String(columnCount));
  }, [columnCount]);

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      COMPARE_SLOTS.slice(columnCount).forEach((slot) => next.delete(slot.param));
      return next.toString() === current.toString() ? current : next;
    });
    setFileStates((current) => {
      const next = { ...current };
      COMPARE_SLOTS.slice(columnCount).forEach((slot) => {
        next[slot.key] = { ...DEFAULT_FILE_STATE };
      });
      return next;
    });
  }, [columnCount, setSearchParams]);

  const loadFile = useCallback((slotKey: CompareSlotKey, fileId: number | null) => {
    if (!fileId) {
      setFileStates((current) => ({ ...current, [slotKey]: { ...DEFAULT_FILE_STATE } }));
      return;
    }
    setFileStates((current) => ({ ...current, [slotKey]: { ...current[slotKey], loading: true, error: null } }));
    Promise.all([
      api.file(fileId),
      api.fileQualityScore(fileId).catch(() => null),
    ])
      .then(([detail, quality]) => {
        setFileStates((current) => ({ ...current, [slotKey]: { detail, quality, loading: false, error: null } }));
      })
      .catch((error: Error) => {
        setFileStates((current) => ({ ...current, [slotKey]: { detail: null, quality: null, loading: false, error: error.message } }));
      });
  }, []);

  useEffect(() => loadFile("left", selectedIds.left), [selectedIds.left, loadFile]);
  useEffect(() => loadFile("right", selectedIds.right), [selectedIds.right, loadFile]);
  useEffect(() => loadFile("third", selectedIds.third), [selectedIds.third, loadFile]);
  useEffect(() => loadFile("fourth", selectedIds.fourth), [selectedIds.fourth, loadFile]);

  const updateSelectedFile = useCallback(
    (slotKey: CompareSlotKey, fileId: number) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        const slot = COMPARE_SLOTS.find((entry) => entry.key === slotKey);
        if (slot) {
          next.set(slot.param, String(fileId));
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const clearSelectedFile = useCallback(
    (slotKey: CompareSlotKey) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        const slot = COMPARE_SLOTS.find((entry) => entry.key === slotKey);
        if (slot) {
          next.delete(slot.param);
        }
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

  const visibleSlots = useMemo(() => COMPARE_SLOTS.slice(0, columnCount), [columnCount]);
  const columns = useMemo<CompareFileColumn[]>(() => visibleSlots.map((slot) => ({
    ...slot,
    detail: fileStates[slot.key].detail,
    quality: fileStates[slot.key].quality,
  })), [fileStates, visibleSlots]);
  const selectedVisibleFiles = columns.filter((column) => column.detail);
  const hasFileLabels = selectedVisibleFiles.length > 0;

  const sections = useMemo<CompareSection[]>(() => [
    {
      id: "overview",
      title: t("fileDetail.navigation.overview"),
      icon: Info,
      rows: buildOverviewRows(columns, t, inDepthDolbyVisionProfiles),
    },
    {
      id: "format",
      title: t("fileDetail.format"),
      icon: Film,
      rows: buildFormatRows(columns, t),
    },
    {
      id: "quality",
      title: t("fileDetail.qualityBreakdown"),
      icon: Gauge,
      rows: buildQualityRows(columns, t),
    },
    {
      id: "video",
      title: t("fileDetail.videoStreams"),
      icon: Film,
      rows: buildStreamRows("video", columns, t),
    },
    {
      id: "audio",
      title: t("fileDetail.audioStreams"),
      icon: Gauge,
      rows: buildStreamRows("audio", columns, t),
    },
    {
      id: "subtitles",
      title: t("fileDetail.subtitles"),
      icon: Info,
      rows: buildSubtitleRows(columns, t),
    },
    {
      id: "cover",
      title: t("fileDetail.cover"),
      icon: Info,
      rows: buildCoverRows(columns, t),
    },
    {
      id: "chapters",
      title: t("fileDetail.chapters"),
      icon: Info,
      rows: buildChapterRows(columns, t),
    },
    {
      id: "raw",
      title: t("fileDetail.rawJson"),
      icon: FileJson,
      rows: buildRawRows(columns, t),
      rawJson: columns.map((column) => ({
        key: column.key,
        label: column.detail?.filename ?? getSlotLabel(column.key, t),
        value: column.detail?.raw_ffprobe_json ?? {},
      })),
    },
  ], [columns, inDepthDolbyVisionProfiles, t]);

  const loading = visibleSlots.some((slot) => fileStates[slot.key].loading);
  const error = visibleSlots.map((slot) => fileStates[slot.key].error).find(Boolean);
  const canCompare = selectedVisibleFiles.length >= 2;
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
          <div className="file-compare-title-actions">
            <ColumnCountPicker value={columnCount} onChange={setColumnCount} />
          </div>
        </div>
        <div className="file-compare-body">
          <div
            className={`file-compare-toolbar file-compare-toolbar-${columnCount}-columns${
              hasFileLabels ? " has-file-labels" : ""
            }`}
          >
            <div className="file-compare-toolbar-controls">
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
            </div>
            {visibleSlots.map((slot, index) => (
              <Fragment key={slot.key}>
                {columnCount === 2 && index === 1 ? (
                  <button
                    key="swap"
                    type="button"
                    className="file-compare-swap-button"
                    aria-label={t("fileCompare.swapFiles")}
                    data-tooltip={t("fileCompare.swapFiles")}
                    title={t("fileCompare.swapFiles")}
                    onClick={swapSelectedFiles}
                    disabled={!selectedIds.left && !selectedIds.right}
                  >
                    <ChevronsRightLeftIcon size={22} aria-hidden="true" />
                  </button>
                ) : null}
                <SearchSelect
                  slotKey={slot.key}
                  selected={fileStates[slot.key].detail}
                  reserveLabelSpace={hasFileLabels}
                  libraries={libraries}
                  libraryId={libraryFilters[slot.key]}
                  blockedFileIds={visibleSlots
                    .filter((otherSlot) => otherSlot.key !== slot.key)
                    .map((otherSlot) => fileStates[otherSlot.key].detail?.id)
                    .filter((fileId): fileId is number => typeof fileId === "number")}
                  onChangeLibrary={(libraryId) => {
                    setLibraryFilters((current) => ({ ...current, [slot.key]: libraryId }));
                  }}
                  onClear={() => clearSelectedFile(slot.key)}
                  onSelect={(fileId) => updateSelectedFile(slot.key, fileId)}
                />
              </Fragment>
            ))}
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

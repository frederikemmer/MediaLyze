import { useVirtualizer } from "@tanstack/react-virtual";
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
import { DistributionList } from "../components/DistributionList";
import { LoaderPinwheelIcon } from "../components/LoaderPinwheelIcon";
import { StatCard } from "../components/StatCard";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import {
  api,
  type LibraryStatistics,
  type LibrarySummary,
  type MediaFileRow,
  type MediaFileSortKey,
} from "../lib/api";
import { formatBytes, formatCodecLabel, formatDate, formatDuration } from "../lib/format";
import {
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

type FileColumnDefinition = {
  key: FileColumnKey;
  labelKey: string;
  width: string;
  sticky?: boolean;
  hideable?: boolean;
  render: (file: MediaFileRow) => ReactNode;
};

type CachedFileList = {
  total: number;
  items: MediaFileRow[];
};

const PAGE_SIZE = 200;
const LOAD_MORE_THRESHOLD_ROWS = 40;
const ROW_ESTIMATE_PX = 68;
const OVERSCAN_ROWS = 12;
const librarySummaryCache = new Map<string, LibrarySummary>();
const libraryStatisticsCache = new Map<string, LibraryStatistics>();
const libraryFileListCache = new Map<string, CachedFileList>();

function formatDistributionItems(
  items: { label: string; value: number }[],
  kind: "video" | "audio" | "subtitle",
) {
  return items.map((item) => ({ ...item, label: formatCodecLabel(item.label, kind) }));
}

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

function buildFileColumns(t: (key: string, options?: Record<string, unknown>) => string): FileColumnDefinition[] {
  return [
    {
      key: "file",
      labelKey: "fileTable.file",
      width: "24rem",
      sticky: true,
      hideable: false,
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
      width: "9rem",
      render: (file) => formatBytes(file.size_bytes),
    },
    {
      key: "video_codec",
      labelKey: "fileTable.codec",
      width: "10rem",
      render: (file) => (file.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileTable.na")),
    },
    {
      key: "resolution",
      labelKey: "fileTable.resolution",
      width: "10rem",
      render: (file) => file.resolution ?? t("fileTable.na"),
    },
    {
      key: "hdr_type",
      labelKey: "fileTable.hdr",
      width: "8rem",
      render: (file) => file.hdr_type ?? t("fileTable.sdr"),
    },
    {
      key: "duration",
      labelKey: "fileTable.duration",
      width: "9rem",
      render: (file) => formatDuration(file.duration),
    },
    {
      key: "audio_codecs",
      labelKey: "fileTable.audioCodecs",
      width: "13rem",
      render: (file) => compactValues(file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio"))),
    },
    {
      key: "audio_languages",
      labelKey: "fileTable.audioLanguages",
      width: "12rem",
      render: (file) => compactValues(file.audio_languages),
    },
    {
      key: "subtitle_languages",
      labelKey: "fileTable.subtitleLanguages",
      width: "12rem",
      render: (file) => compactValues(file.subtitle_languages),
    },
    {
      key: "subtitle_codecs",
      labelKey: "fileTable.subtitleCodecs",
      width: "13rem",
      render: (file) => compactValues(file.subtitle_codecs.map((codec) => formatCodecLabel(codec, "subtitle"))),
    },
    {
      key: "subtitle_sources",
      labelKey: "fileTable.subtitleSources",
      width: "11rem",
      render: (file) => compactValues(file.subtitle_sources, 2),
    },
    {
      key: "mtime",
      labelKey: "fileTable.modified",
      width: "12rem",
      render: (file) => formatDate(new Date(file.mtime * 1000).toISOString()),
    },
    {
      key: "last_analyzed_at",
      labelKey: "fileTable.lastAnalyzed",
      width: "12rem",
      render: (file) => formatDate(file.last_analyzed_at),
    },
    {
      key: "quality_score",
      labelKey: "fileTable.score",
      width: "10rem",
      render: (file) => (
        <div className="score-cell">
          <strong>{file.quality_score}/10</strong>
          <div className="score-meter" aria-hidden="true">
            <span
              className={`score-meter-fill score-meter-fill-${scoreMeterLabel(file.quality_score)}`}
              style={{ width: `${Math.max(0, Math.min(10, file.quality_score)) * 10}%` }}
            />
          </div>
        </div>
      ),
    },
  ];
}

function findLibrarySummary(libraries: LibrarySummary[], libraryId: string) {
  return libraries.find((entry) => String(entry.id) === libraryId) ?? null;
}

function buildFileCacheKey(
  libraryId: string,
  searchQuery: string,
  sortKey: FileColumnKey,
  sortDirection: SortDirection,
) {
  return `${libraryId}::${searchQuery}::${sortKey}::${sortDirection}`;
}

export function LibraryDetailPage() {
  const { t } = useTranslation();
  const { libraryId = "" } = useParams();
  const { libraries } = useAppData();
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary | null>(null);
  const [libraryStatistics, setLibraryStatistics] = useState<LibraryStatistics | null>(null);
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(true);
  const [isFilesLoading, setIsFilesLoading] = useState(true);
  const [isFilesRefreshing, setIsFilesRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<FileColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [sortKey, setSortKey] = useState<FileColumnKey>("file");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const { activeJobs } = useScanJobs();
  const activeJob = activeJobs.find((job) => String(job.library_id) === libraryId) ?? null;
  const hadActiveJobRef = useRef(Boolean(activeJob));
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const fallbackSummary = findLibrarySummary(libraries, libraryId);
  const displayLibrary = librarySummary ?? fallbackSummary;
  const statisticsSettings = useState(() => getLibraryStatisticsSettings())[0];
  const fileColumns = useMemo(() => buildFileColumns(t), [t]);
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
  const columnTemplate = useMemo(
    () => activeColumns.map((column) => `minmax(0, ${column.width})`).join(" "),
    [activeColumns],
  );
  const fileQueryKey = useMemo(
    () => buildFileCacheKey(libraryId, deferredSearchQuery, sortKey, sortDirection),
    [deferredSearchQuery, libraryId, sortDirection, sortKey],
  );
  const activeFileQueryKeyRef = useRef(fileQueryKey);
  const filesRef = useRef<MediaFileRow[]>([]);
  const dataTableShellRef = useRef<HTMLDivElement | null>(null);
  const inflightRequestGateRef = useRef(new InflightPageRequestGate());
  const initializedLibraryIdRef = useRef<string | null>(null);
  const initializedFileQueryKeyRef = useRef<string | null>(null);
  const previousLibraryIdRef = useRef(libraryId);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const statisticsAbortRef = useRef<AbortController | null>(null);
  const filesAbortRef = useRef<AbortController | null>(null);
  const hasMoreFiles = files.length < filesTotal;

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => dataTableShellRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN_ROWS,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

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
        search: deferredSearchQuery,
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
    filesRef.current = files;
  }, [files]);

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
    if (initializedLibraryIdRef.current === libraryId) {
      return;
    }
    initializedLibraryIdRef.current = libraryId;

    const cachedSummary = librarySummaryCache.get(libraryId) ?? fallbackSummary ?? null;
    const cachedStatistics = libraryStatisticsCache.get(libraryId) ?? null;

    setLibrarySummary(cachedSummary);
    setLibraryStatistics(cachedStatistics);
    setSummaryError(null);
    setStatisticsError(null);
    setIsSummaryLoading(cachedSummary === null);
    setIsStatisticsLoading(cachedStatistics === null);

    void loadLibrarySummary(cachedSummary === null);
    void loadLibraryStatistics(cachedStatistics === null);
  }, [fallbackSummary, libraryId, loadLibraryStatistics, loadLibrarySummary]);

  useEffect(() => {
    if (initializedFileQueryKeyRef.current === fileQueryKey) {
      return;
    }
    initializedFileQueryKeyRef.current = fileQueryKey;

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
  }, [fileQueryKey, libraryId, loadFilesPage]);

  useEffect(() => {
    if (!dataTableShellRef.current) {
      return;
    }
    dataTableShellRef.current.scrollTop = 0;
  }, [fileQueryKey]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [activeColumns, rowVirtualizer]);

  useEffect(() => {
    const lastVirtualRow = virtualRows.at(-1);
    if (!lastVirtualRow || !hasMoreFiles || isFilesLoading || isLoadingMore) {
      return;
    }
    if (lastVirtualRow.index < files.length - LOAD_MORE_THRESHOLD_ROWS) {
      return;
    }
    void loadFilesPage(files.length, true, fileQueryKey);
  }, [fileQueryKey, files.length, hasMoreFiles, isFilesLoading, isLoadingMore, loadFilesPage, virtualRows]);

  useEffect(() => {
    if (hadActiveJobRef.current && !activeJob) {
      librarySummaryCache.delete(libraryId);
      libraryStatisticsCache.delete(libraryId);
      libraryFileListCache.delete(fileQueryKey);
      void loadLibrarySummary(false);
      void loadLibraryStatistics(false);
      void loadFilesPage(0, false, fileQueryKey);
    }
    hadActiveJobRef.current = Boolean(activeJob);
  }, [activeJob, fileQueryKey, libraryId, loadFilesPage, loadLibraryStatistics, loadLibrarySummary]);

  useEffect(() => {
    return () => {
      summaryAbortRef.current?.abort();
      statisticsAbortRef.current?.abort();
      filesAbortRef.current?.abort();
    };
  }, []);

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
            const items = getLibraryStatisticPanelItems(libraryStatistics, panel);
            const formattedItems = panel.panelFormatKind
              ? formatDistributionItems(items, panel.panelFormatKind)
              : items;
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
        title={t("libraryDetail.analyzedFiles")}
        subtitle={
          deferredSearchQuery
            ? t("libraryDetail.indexedEntriesFiltered", {
                shown: filesTotal,
                total: displayLibrary?.file_count ?? filesTotal,
              })
            : t("libraryDetail.indexedEntries", { count: filesTotal })
        }
        error={filesError}
        headerAddon={
          <div className="data-table-search">
            <label className="sr-only" htmlFor="library-file-search">
              {t("libraryDetail.searchLabel")}
            </label>
            <input
              id="library-file-search"
              type="search"
              value={searchQuery}
              onChange={(event) => {
                const nextValue = event.target.value;
                startTransition(() => {
                  setSearchQuery(nextValue);
                });
              }}
              placeholder={t("libraryDetail.searchPlaceholder")}
              autoComplete="off"
            />
          </div>
        }
      >
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
    </>
  );
}

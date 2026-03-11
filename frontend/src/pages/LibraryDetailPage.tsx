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
import { useAppData } from "../lib/app-data";
import { api, type LibraryDetail, type LibrarySummary, type MediaFileRow, type MediaFileSortKey, type ScanJob } from "../lib/api";
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
  shouldRequestNextPage,
} from "../lib/paginated-files";
import { useScanJobs } from "../lib/scan-jobs";

type FileColumnKey = MediaFileSortKey;
type SortDirection = "asc" | "desc";

type FileColumnDefinition = {
  key: FileColumnKey;
  labelKey: string;
  sticky?: boolean;
  hideable?: boolean;
  render: (file: MediaFileRow) => ReactNode;
};

type CachedFileList = {
  total: number;
  items: MediaFileRow[];
};

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

const PAGE_SIZE = 50;
const libraryDetailCache = new Map<string, LibraryDetail>();
const libraryFileListCache = new Map<string, CachedFileList>();

function joinValues(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "n/a";
}

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
      render: (file) => formatBytes(file.size_bytes),
    },
    {
      key: "video_codec",
      labelKey: "fileTable.codec",
      render: (file) => (file.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileTable.na")),
    },
    {
      key: "resolution",
      labelKey: "fileTable.resolution",
      render: (file) => file.resolution ?? t("fileTable.na"),
    },
    {
      key: "hdr_type",
      labelKey: "fileTable.hdr",
      render: (file) => file.hdr_type ?? t("fileTable.sdr"),
    },
    {
      key: "duration",
      labelKey: "fileTable.duration",
      render: (file) => formatDuration(file.duration),
    },
    {
      key: "audio_codecs",
      labelKey: "fileTable.audioCodecs",
      render: (file) => compactValues(file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio"))),
    },
    {
      key: "audio_languages",
      labelKey: "fileTable.audioLanguages",
      render: (file) => compactValues(file.audio_languages),
    },
    {
      key: "subtitle_languages",
      labelKey: "fileTable.subtitleLanguages",
      render: (file) => compactValues(file.subtitle_languages),
    },
    {
      key: "subtitle_codecs",
      labelKey: "fileTable.subtitleCodecs",
      render: (file) => compactValues(file.subtitle_codecs.map((codec) => formatCodecLabel(codec, "subtitle"))),
    },
    {
      key: "subtitle_sources",
      labelKey: "fileTable.subtitleSources",
      render: (file) => compactValues(file.subtitle_sources, 2),
    },
    {
      key: "mtime",
      labelKey: "fileTable.modified",
      render: (file) => formatDate(new Date(file.mtime * 1000).toISOString()),
    },
    {
      key: "last_analyzed_at",
      labelKey: "fileTable.lastAnalyzed",
      render: (file) => formatDate(file.last_analyzed_at),
    },
    {
      key: "quality_score",
      labelKey: "fileTable.score",
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
  const [library, setLibrary] = useState<LibraryDetail | null>(null);
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLibraryLoading, setIsLibraryLoading] = useState(true);
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
  const librarySummary = findLibrarySummary(libraries, libraryId);
  const displayLibrary = library ?? librarySummary;
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
  const fileQueryKey = useMemo(
    () => buildFileCacheKey(libraryId, deferredSearchQuery, sortKey, sortDirection),
    [deferredSearchQuery, libraryId, sortDirection, sortKey],
  );
  const activeFileQueryKeyRef = useRef(fileQueryKey);
  const filesRef = useRef<MediaFileRow[]>([]);
  const dataTableShellRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const inflightRequestGateRef = useRef(new InflightPageRequestGate());
  const initializedLibraryIdRef = useRef<string | null>(null);
  const initializedFileQueryKeyRef = useRef<string | null>(null);
  const previousLibraryIdRef = useRef(libraryId);
  const hasMoreFiles = files.length < filesTotal;

  const loadLibraryDetail = useEffectEvent(async (showLoading = false) => {
    if (showLoading) {
      setIsLibraryLoading(true);
    }

    try {
      const payload = await api.library(libraryId);
      libraryDetailCache.set(libraryId, payload);
      setLibrary(payload);
      setError(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      if (showLoading) {
        setIsLibraryLoading(false);
      }
    }
  });

  const loadFilesPage = useEffectEvent(async (offset: number, append: boolean, queryKey: string) => {
    const requestKey = buildFilePageRequestKey(queryKey, offset);
    if (!inflightRequestGateRef.current.begin(requestKey)) {
      return;
    }

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
      setError(null);
    } catch (reason) {
      if (activeFileQueryKeyRef.current === queryKey) {
        setError((reason as Error).message);
      }
    } finally {
      inflightRequestGateRef.current.end(requestKey);
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

    const cachedLibrary = libraryDetailCache.get(libraryId) ?? null;
    setLibrary(cachedLibrary);
    setError(null);
    setIsLibraryLoading(cachedLibrary === null);

    void loadLibraryDetail(cachedLibrary === null);
  }, [libraryId, loadLibraryDetail]);

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

    setError(null);
    setIsLoadingMore(false);
    if (cachedFiles) {
      setFiles(cachedFiles.items);
      setFilesTotal(cachedFiles.total);
      setIsFilesLoading(false);
      setIsFilesRefreshing(false);
      previousLibraryIdRef.current = libraryId;
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
    if (
      !shouldRequestNextPage({
        hasMoreFiles,
        isFilesLoading,
        isLoadingMore,
      })
    ) {
      return;
    }

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        void loadFilesPage(files.length, true, fileQueryKey);
      },
      {
        root: dataTableShellRef.current,
        rootMargin: "120px 0px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fileQueryKey, files.length, hasMoreFiles, isFilesLoading, isLoadingMore, loadFilesPage]);

  useEffect(() => {
    if (hadActiveJobRef.current && !activeJob) {
      libraryFileListCache.delete(fileQueryKey);
      void loadLibraryDetail(false);
      void loadFilesPage(0, false, fileQueryKey);
    }
    hadActiveJobRef.current = Boolean(activeJob);
  }, [activeJob, fileQueryKey, loadFilesPage, loadLibraryDetail]);

  return (
    <>
      <section className="panel stack">
        <div className="panel-title-row">
          <h2>{displayLibrary?.name ?? t("libraryDetail.loading")}</h2>
          {displayLibrary?.path ? (
            <span
              className="tooltip-trigger"
              tabIndex={0}
              aria-label={t("libraryDetail.libraryPathAria")}
              data-tooltip={displayLibrary.path}
            >
              ?
            </span>
          ) : null}
        </div>
        <div className="card-grid grid">
          <StatCard label={t("libraryDetail.files")} value={String(displayLibrary?.file_count ?? 0)} />
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
      </section>

      <div className="media-grid">
        {visibleStatisticPanels.length > 0 ? (
          visibleStatisticPanels.map((panel) => {
            const items = getLibraryStatisticPanelItems(library, panel);
            const formattedItems = panel.panelFormatKind
              ? formatDistributionItems(items, panel.panelFormatKind)
              : items;
            return (
              <AsyncPanel
                key={panel.id}
                title={t(panel.panelTitleKey ?? panel.nameKey)}
                loading={isLibraryLoading && !library && !error}
                error={error}
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
        error={error}
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
            <table className="media-data-table">
              <thead>
                <tr>
                  {activeColumns.map((column) => {
                    const isActiveSort = sortKey === column.key;
                    return (
                      <th
                        key={column.key}
                        className={column.sticky ? "is-sticky" : undefined}
                        scope="col"
                        aria-sort={ariaSortValue(isActiveSort, sortDirection)}
                      >
                        <button type="button" className="column-sort" onClick={() => updateSort(column.key)}>
                          <span>{t(column.labelKey)}</span>
                          <span className={`sort-indicator${isActiveSort ? " is-active" : ""}`} aria-hidden="true">
                            {isActiveSort ? sortIndicator(sortDirection) : ""}
                          </span>
                          {isActiveSort ? <span className="sr-only">{t(`sort.${sortDirection}`)}</span> : null}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    {activeColumns.map((column) => (
                      <td key={column.key} className={column.sticky ? "is-sticky" : undefined}>
                        {column.render(file)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="data-table-footer">
              <span className="media-meta">
                {t("libraryDetail.renderedEntries", { rendered: files.length, total: filesTotal })}
              </span>
              {isLoadingMore || isFilesRefreshing ? <span className="media-meta">{t("libraryDetail.loadingMore")}</span> : null}
            </div>
            <div ref={loadMoreSentinelRef} className="data-table-sentinel" aria-hidden="true" />
          </div>
        )}
      </AsyncPanel>
    </>
  );
}

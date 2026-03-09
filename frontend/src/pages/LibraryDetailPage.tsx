import type { ReactNode } from "react";
import { useDeferredValue, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { DistributionList } from "../components/DistributionList";
import { StatCard } from "../components/StatCard";
import { api, type LibraryDetail, type MediaFileRow, type ScanJob } from "../lib/api";
import { formatBytes, formatDate, formatDuration } from "../lib/format";
import { useScanJobs } from "../lib/scan-jobs";

type FileColumnKey =
  | "file"
  | "size"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "duration"
  | "audio_languages"
  | "subtitle_languages"
  | "mtime"
  | "last_analyzed_at"
  | "quality_score";

type SortDirection = "asc" | "desc";

type FileColumnDefinition = {
  key: FileColumnKey;
  labelKey: string;
  sticky?: boolean;
  hideable?: boolean;
  sortValue: (file: MediaFileRow) => number | string;
  render: (file: MediaFileRow) => ReactNode;
};

const DEFAULT_VISIBLE_COLUMNS: FileColumnKey[] = [
  "file",
  "size",
  "video_codec",
  "resolution",
  "duration",
  "audio_languages",
  "subtitle_languages",
  "quality_score",
];

function joinValues(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "n/a";
}

function compactValues(values: string[], limit = 4): string {
  if (values.length === 0) {
    return "n/a";
  }
  const visible = values.slice(0, limit);
  return values.length > limit ? `${visible.join(",")},...` : visible.join(",");
}

function resolutionSortValue(resolution: string | null): number {
  if (!resolution) {
    return -1;
  }
  const match = /^(\d+)x(\d+)$/i.exec(resolution);
  if (!match) {
    return -1;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width * height;
}

function timeSortValue(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
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

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}

function fuzzyScore(text: string, query: string): number {
  if (!query) {
    return 0;
  }

  if (text.includes(query)) {
    return 200 - Math.max(0, text.indexOf(query));
  }

  if (fuzzyIncludes(text.replaceAll(" ", ""), query.replaceAll(" ", ""))) {
    return 120 - Math.max(0, text.length - query.length);
  }

  return 0;
}

function buildFileColumns(t: (key: string, options?: Record<string, unknown>) => string): FileColumnDefinition[] {
  return [
    {
      key: "file",
      labelKey: "fileTable.file",
      sticky: true,
      hideable: false,
      sortValue: (file) => file.relative_path.toLowerCase(),
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
      sortValue: (file) => file.size_bytes,
      render: (file) => formatBytes(file.size_bytes),
    },
    {
      key: "video_codec",
      labelKey: "fileTable.codec",
      sortValue: (file) => (file.video_codec ?? "").toLowerCase(),
      render: (file) => file.video_codec ?? t("fileTable.na"),
    },
    {
      key: "resolution",
      labelKey: "fileTable.resolution",
      sortValue: (file) => resolutionSortValue(file.resolution),
      render: (file) => file.resolution ?? t("fileTable.na"),
    },
    {
      key: "hdr_type",
      labelKey: "fileTable.hdr",
      sortValue: (file) => (file.hdr_type ?? "").toLowerCase(),
      render: (file) => file.hdr_type ?? t("fileTable.sdr"),
    },
    {
      key: "duration",
      labelKey: "fileTable.duration",
      sortValue: (file) => file.duration ?? 0,
      render: (file) => formatDuration(file.duration),
    },
    {
      key: "audio_languages",
      labelKey: "fileTable.audio",
      sortValue: (file) => joinValues(file.audio_languages).toLowerCase(),
      render: (file) => compactValues(file.audio_languages),
    },
    {
      key: "subtitle_languages",
      labelKey: "fileTable.subtitles",
      sortValue: (file) => joinValues(file.subtitle_languages).toLowerCase(),
      render: (file) => compactValues(file.subtitle_languages),
    },
    {
      key: "mtime",
      labelKey: "fileTable.modified",
      sortValue: (file) => file.mtime,
      render: (file) => formatDate(new Date(file.mtime * 1000).toISOString()),
    },
    {
      key: "last_analyzed_at",
      labelKey: "fileTable.lastAnalyzed",
      sortValue: (file) => timeSortValue(file.last_analyzed_at),
      render: (file) => formatDate(file.last_analyzed_at),
    },
    {
      key: "quality_score",
      labelKey: "fileTable.score",
      sortValue: (file) => file.quality_score,
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

export function LibraryDetailPage() {
  const { t } = useTranslation();
  const { libraryId = "" } = useParams();
  const [library, setLibrary] = useState<LibraryDetail | null>(null);
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanJob[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<FileColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [sortKey, setSortKey] = useState<FileColumnKey>("file");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const { activeJobs, hasActiveJobs } = useScanJobs();
  const activeJob = activeJobs.find((job) => String(job.library_id) === libraryId) ?? null;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const fileColumns = buildFileColumns(t);
  const activeColumns = fileColumns.filter((column) => visibleColumns.includes(column.key));
  const filteredFiles = (() => {
    const query = normalizeSearchValue(deferredSearchQuery);
    if (!query) {
      return files;
    }

    return files
      .map((file) => {
        const searchFields = [
          file.filename,
          file.relative_path,
          file.video_codec ?? "",
          file.resolution ?? "",
          file.hdr_type ?? "",
          file.scan_status,
          file.extension,
          file.audio_languages.join(" "),
          file.subtitle_languages.join(" "),
        ];
        const score = searchFields.reduce((best, field) => {
          const normalizedField = normalizeSearchValue(field);
          return Math.max(best, fuzzyScore(normalizedField, query));
        }, 0);

        return { file, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.file.relative_path.localeCompare(right.file.relative_path))
      .map((entry) => entry.file);
  })();
  const sortedFiles = [...filteredFiles].sort((left, right) => {
    const column = fileColumns.find((entry) => entry.key === sortKey);
    if (!column) {
      return 0;
    }
    const leftValue = column.sortValue(left);
    const rightValue = column.sortValue(right);

    let comparison = 0;
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      comparison = leftValue - rightValue;
    } else {
      comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    if (comparison === 0) {
      comparison = left.relative_path.localeCompare(right.relative_path, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }

    return sortDirection === "asc" ? comparison : comparison * -1;
  });

  function toggleColumn(columnKey: FileColumnKey) {
    const column = fileColumns.find((entry) => entry.key === columnKey);
    if (!column || column.hideable === false) {
      return;
    }
    setVisibleColumns((current) => {
      if (current.includes(columnKey)) {
        if (sortKey === columnKey) {
          setSortKey("file");
          setSortDirection("asc");
        }
        return current.filter((entry) => entry !== columnKey);
      }
      const next = [...current, columnKey];
      return fileColumns.filter((entry) => next.includes(entry.key)).map((entry) => entry.key);
    });
  }

  function updateSort(nextKey: FileColumnKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "quality_score" ? "desc" : "asc");
  }

  function loadPage() {
    Promise.all([api.library(libraryId), api.libraryFiles(libraryId), api.libraryScanJobs(libraryId)])
      .then(([libraryPayload, filesPayload, scanJobsPayload]) => {
        setLibrary(libraryPayload);
        setFiles(filesPayload);
        setScanHistory(scanJobsPayload);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    loadPage();
  }, [libraryId]);

  useEffect(() => {
    if (!hasActiveJobs) {
      return;
    }
    const timer = window.setInterval(loadPage, 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, libraryId]);

  return (
    <>
      <section className="panel stack">
        {activeJob ? (
          <div className="notice">
            <div className="distribution-copy">
              <strong>{t("libraryDetail.scanInProgress")}</strong>
              <span>{activeJob.phase_detail ?? activeJob.phase_label}</span>
            </div>
            <div className="progress">
              <span style={{ width: `${activeJob.progress_percent}%` }} />
            </div>
          </div>
        ) : null}
        <div className="panel-title-row">
          <h2>{library?.name ?? t("libraryDetail.loading")}</h2>
          {library?.path ? (
            <span
              className="tooltip-trigger"
              tabIndex={0}
              aria-label={t("libraryDetail.libraryPathAria")}
              data-tooltip={library.path}
            >
              ?
            </span>
          ) : null}
        </div>
        <div className="card-grid grid">
          <StatCard label={t("libraryDetail.files")} value={String(library?.file_count ?? 0)} />
          <StatCard label={t("libraryDetail.storage")} value={formatBytes(library?.total_size_bytes ?? 0)} tone="teal" />
          <StatCard
            label={t("libraryDetail.duration")}
            value={formatDuration(library?.total_duration_seconds ?? 0)}
            tone="blue"
          />
          <StatCard label={t("libraryDetail.lastScan")} value={formatDate(library?.last_scan_at ?? null)} />
        </div>
      </section>

      <div className="media-grid">
        <AsyncPanel
          title={t("libraryDetail.videoCodecs")}
          loading={!library && !error}
          error={error}
          bodyClassName="async-panel-body-scroll"
        >
          <DistributionList
            items={library?.video_codec_distribution ?? []}
            maxVisibleRows={5}
            scrollable
          />
        </AsyncPanel>
        <AsyncPanel
          title={t("libraryDetail.resolutions")}
          loading={!library && !error}
          error={error}
          bodyClassName="async-panel-body-scroll"
        >
          <DistributionList
            items={library?.resolution_distribution ?? []}
            maxVisibleRows={5}
            scrollable
          />
        </AsyncPanel>
        <AsyncPanel
          title={t("libraryDetail.hdrCoverage")}
          loading={!library && !error}
          error={error}
          bodyClassName="async-panel-body-scroll"
        >
          <DistributionList
            items={library?.hdr_distribution ?? []}
            maxVisibleRows={5}
            scrollable
          />
        </AsyncPanel>
        <AsyncPanel
          title={t("libraryDetail.audioLanguages")}
          loading={!library && !error}
          error={error}
          bodyClassName="async-panel-body-scroll"
        >
          <DistributionList
            items={library?.audio_language_distribution ?? []}
            maxVisibleRows={5}
            scrollable
          />
        </AsyncPanel>
      </div>

      <AsyncPanel
        title={t("libraryDetail.analyzedFiles")}
        subtitle={
          deferredSearchQuery.trim()
            ? t("libraryDetail.indexedEntriesFiltered", { shown: sortedFiles.length, total: files.length })
            : t("libraryDetail.indexedEntries", { count: files.length })
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
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("libraryDetail.searchPlaceholder")}
              autoComplete="off"
            />
          </div>
        }
      >
        <div className="data-table-tools">
          <div className="column-picker" aria-label="Visible metadata columns">
            <span className="badge">
              {t("sort.prefix")}: {t(fileColumns.find((column) => column.key === sortKey)?.labelKey ?? "fileTable.file")}
            </span>
            <span className="badge">{t(`sort.${sortDirection}`)}</span>
            {fileColumns.map((column) => {
              const isVisible = visibleColumns.includes(column.key);
              return (
                <button
                  key={column.key}
                  type="button"
                  className={`column-toggle${isVisible ? " is-active" : ""}`}
                  onClick={() => toggleColumn(column.key)}
                  disabled={column.hideable === false}
                >
                  {t(column.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
        {sortedFiles.length === 0 ? (
          <div className="notice">{t("libraryDetail.noAnalyzedFiles")}</div>
        ) : (
          <div className="data-table-shell">
            <table className="media-data-table">
              <thead>
                <tr>
                  {activeColumns.map((column) => {
                    const isActiveSort = sortKey === column.key;
                    return (
                      <th key={column.key} className={column.sticky ? "is-sticky" : undefined} scope="col">
                        <button type="button" className="column-sort" onClick={() => updateSort(column.key)}>
                          <span>{t(column.labelKey)}</span>
                          <span className={`sort-indicator${isActiveSort ? " is-active" : ""}`}>
                            {isActiveSort ? t(`sort.${sortDirection}`) : ""}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((file) => (
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
          </div>
        )}
      </AsyncPanel>

      <AsyncPanel title={t("libraryDetail.recentScanJobs")} subtitle={t("libraryDetail.recentScanJobsSubtitle")} error={error}>
        <div className="listing">
          {scanHistory.map((job) => (
            <div className="media-card compact-row-card" key={job.id}>
              <div className="stack">
                <strong>{t("libraryDetail.jobLabel", { id: job.id })}</strong>
                <span className="media-meta">{job.job_type} · {job.phase_label}</span>
                {job.phase_detail ? <span className="media-meta">{job.phase_detail}</span> : null}
              </div>
              <div className="stack">
                <span>{job.files_total > 0 ? `${job.files_scanned}/${job.files_total}` : job.phase_label}</span>
                <div className="progress">
                  <span style={{ width: `${job.progress_percent}%` }} />
                </div>
              </div>
              <span className="badge">{job.status}</span>
            </div>
          ))}
        </div>
      </AsyncPanel>
    </>
  );
}

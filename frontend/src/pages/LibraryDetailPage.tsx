import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
  | "scan_status"
  | "mtime"
  | "last_seen_at"
  | "last_analyzed_at"
  | "quality_score";

type SortDirection = "asc" | "desc";

type FileColumnDefinition = {
  key: FileColumnKey;
  label: string;
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

const FILE_COLUMNS: FileColumnDefinition[] = [
  {
    key: "file",
    label: "File",
    sticky: true,
    hideable: false,
    sortValue: (file) => file.relative_path.toLowerCase(),
    render: (file) => (
      <div className="media-file-cell">
        <Link to={`/files/${file.id}`} className="file-link">
          {file.filename}
        </Link>
        <small>{file.relative_path}</small>
      </div>
    ),
  },
  {
    key: "size",
    label: "Size",
    sortValue: (file) => file.size_bytes,
    render: (file) => formatBytes(file.size_bytes),
  },
  {
    key: "video_codec",
    label: "Codec",
    sortValue: (file) => (file.video_codec ?? "").toLowerCase(),
    render: (file) => file.video_codec ?? "n/a",
  },
  {
    key: "resolution",
    label: "Resolution",
    sortValue: (file) => resolutionSortValue(file.resolution),
    render: (file) => file.resolution ?? "n/a",
  },
  {
    key: "hdr_type",
    label: "HDR",
    sortValue: (file) => (file.hdr_type ?? "").toLowerCase(),
    render: (file) => file.hdr_type ?? "SDR",
  },
  {
    key: "duration",
    label: "Duration",
    sortValue: (file) => file.duration ?? 0,
    render: (file) => formatDuration(file.duration),
  },
  {
    key: "audio_languages",
    label: "Audio",
    sortValue: (file) => joinValues(file.audio_languages).toLowerCase(),
    render: (file) => joinValues(file.audio_languages),
  },
  {
    key: "subtitle_languages",
    label: "Subtitles",
    sortValue: (file) => joinValues(file.subtitle_languages).toLowerCase(),
    render: (file) => joinValues(file.subtitle_languages),
  },
  {
    key: "scan_status",
    label: "Status",
    sortValue: (file) => file.scan_status.toLowerCase(),
    render: (file) => file.scan_status,
  },
  {
    key: "mtime",
    label: "Modified",
    sortValue: (file) => file.mtime,
    render: (file) => formatDate(new Date(file.mtime * 1000).toISOString()),
  },
  {
    key: "last_seen_at",
    label: "Last seen",
    sortValue: (file) => timeSortValue(file.last_seen_at),
    render: (file) => formatDate(file.last_seen_at),
  },
  {
    key: "last_analyzed_at",
    label: "Last analyzed",
    sortValue: (file) => timeSortValue(file.last_analyzed_at),
    render: (file) => formatDate(file.last_analyzed_at),
  },
  {
    key: "quality_score",
    label: "Score",
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

export function LibraryDetailPage() {
  const { libraryId = "" } = useParams();
  const [library, setLibrary] = useState<LibraryDetail | null>(null);
  const [files, setFiles] = useState<MediaFileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanJob[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<FileColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [sortKey, setSortKey] = useState<FileColumnKey>("file");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const { activeJobs, hasActiveJobs } = useScanJobs();
  const activeJob = activeJobs.find((job) => String(job.library_id) === libraryId) ?? null;
  const activeColumns = FILE_COLUMNS.filter((column) => visibleColumns.includes(column.key));
  const sortedFiles = [...files].sort((left, right) => {
    const column = FILE_COLUMNS.find((entry) => entry.key === sortKey);
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
    const column = FILE_COLUMNS.find((entry) => entry.key === columnKey);
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
      return FILE_COLUMNS.filter((entry) => next.includes(entry.key)).map((entry) => entry.key);
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
              <strong>Scan in progress</strong>
              <span>{activeJob.files_total > 0 ? `${activeJob.files_scanned}/${activeJob.files_total} files` : null}</span>
            </div>
            <div className="progress">
              <span style={{ width: `${activeJob.progress_percent}%` }} />
            </div>
          </div>
        ) : null}
        <div className="panel-title-row">
          <h2>{library?.name ?? "Loading library…"}</h2>
          {library?.path ? (
            <span
              className="tooltip-trigger"
              tabIndex={0}
              aria-label="Library path"
              data-tooltip={library.path}
            >
              ?
            </span>
          ) : null}
        </div>
        <div className="card-grid grid">
          <StatCard label="Files" value={String(library?.file_count ?? 0)} />
          <StatCard label="Storage" value={formatBytes(library?.total_size_bytes ?? 0)} tone="teal" />
          <StatCard
            label="Duration"
            value={formatDuration(library?.total_duration_seconds ?? 0)}
            tone="blue"
          />
          <StatCard label="Last scan" value={formatDate(library?.last_scan_at ?? null)} />
        </div>
      </section>

      <div className="media-grid">
        <AsyncPanel
          title="Video codecs"
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
          title="Resolutions"
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
          title="HDR coverage"
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
          title="Audio languages"
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

      <AsyncPanel title="Analyzed files" subtitle={`${files.length} indexed entries`} error={error}>
        <div className="data-table-tools">
          <div className="data-table-state">
            <span className="badge">Sort: {FILE_COLUMNS.find((column) => column.key === sortKey)?.label ?? "File"}</span>
            <span className="badge">{sortDirection}</span>
          </div>
          <div className="column-picker" aria-label="Visible metadata columns">
            {FILE_COLUMNS.map((column) => {
              const isVisible = visibleColumns.includes(column.key);
              return (
                <button
                  key={column.key}
                  type="button"
                  className={`column-toggle${isVisible ? " is-active" : ""}`}
                  onClick={() => toggleColumn(column.key)}
                  disabled={column.hideable === false}
                >
                  {column.label}
                </button>
              );
            })}
          </div>
        </div>
        {sortedFiles.length === 0 ? (
          <div className="notice">No analyzed files yet.</div>
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
                          <span>{column.label}</span>
                          <span className={`sort-indicator${isActiveSort ? " is-active" : ""}`}>
                            {isActiveSort ? sortDirection : "off"}
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

      <AsyncPanel title="Recent scan jobs" subtitle="Latest queue and run history" error={error}>
        <div className="listing">
          {scanHistory.map((job) => (
            <div className="media-card compact-row-card" key={job.id}>
              <div className="stack">
                <strong>Job #{job.id}</strong>
                <span className="media-meta">
                  {job.job_type} · {job.phase_label}
                </span>
              </div>
              <div className="stack">
                <span>
                  {job.files_total > 0 ? `${job.files_scanned}/${job.files_total}` : null}
                </span>
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

import { GripVertical } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { PathSegmentTrail } from "../components/PathSegmentTrail";
import { StreamDetailsList } from "../components/StreamDetailsList";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { api, type MediaFileDetail, type MediaFileQualityScoreDetail } from "../lib/api";
import {
  type FileDetailPanelId,
  getFileDetailPanelSettings,
  moveFileDetailPanel,
  saveFileDetailPanelSettings,
  toggleFileDetailPanelCollapsed,
} from "../lib/file-detail-panels";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDuration } from "../lib/format";
import { formatHdrType } from "../lib/hdr";

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function formatContainerFormatLabel(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "n/a";
  }

  return normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.length <= 4 && /[a-z]/i.test(entry)) {
        return entry.toUpperCase();
      }
      return entry.charAt(0).toUpperCase() + entry.slice(1);
    })
    .join(", ");
}

function formatBitRate(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return "n/a";
  }

  const megabitsPerSecond = value / 1_000_000;
  const decimals = megabitsPerSecond >= 10 ? 0 : 1;
  return `${megabitsPerSecond.toFixed(decimals)} Mbps`;
}

function formatProbeScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value}/100`;
}

function FormatDetailsList({
  detail,
  t,
}: {
  detail: MediaFileDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactNode {
  if (!detail) {
    return t("streamDetails.unavailable");
  }

  const rows = [
    {
      key: "container",
      label: t("fileDetail.containerLabel"),
      value: formatContainerLabel(detail.container ?? detail.extension),
    },
    {
      key: "containerFormat",
      label: t("fileDetail.containerFormat"),
      value: formatContainerFormatLabel(detail.media_format?.container_format),
    },
    {
      key: "duration",
      label: t("fileDetail.duration"),
      value: formatDuration(detail.media_format?.duration ?? detail.duration ?? null),
    },
    {
      key: "bitRate",
      label: t("fileDetail.bitRate"),
      value: formatBitRate(detail.media_format?.bit_rate),
    },
    {
      key: "probeScore",
      label: t("fileDetail.probeScore"),
      value: formatProbeScore(detail.media_format?.probe_score),
    },
  ];

  return (
    <div className="stream-tooltip-content stream-tooltip-content-panel format-details-content">
      <div className="stream-tooltip-summary">
        <strong>{t("fileDetail.format")}</strong>
        <span>{rows.length}</span>
      </div>
      {rows.map((row) => (
        <div className="stream-tooltip-row" key={row.key}>
          <div className="stream-tooltip-head format-details-row">
            <span className="format-details-label">{row.label}</span>
            <strong className="format-details-value">{row.value}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FileDetailPage() {
  const { t } = useTranslation();
  const { fileId = "" } = useParams();
  const [file, setFile] = useState<MediaFileDetail | null>(null);
  const [qualityDetail, setQualityDetail] = useState<MediaFileQualityScoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelSettings, setPanelSettings] = useState(() => getFileDetailPanelSettings());
  const [draggedPanelId, setDraggedPanelId] = useState<FileDetailPanelId | null>(null);
  const [dropTargetPanelId, setDropTargetPanelId] = useState<FileDetailPanelId | null>(null);

  useEffect(() => {
    api
      .file(fileId)
      .then((payload) => {
        setFile(payload);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
    api
      .fileQualityScore(fileId)
      .then((payload) => setQualityDetail(payload))
      .catch(() => setQualityDetail(null));
  }, [fileId]);

  function updatePanelSettings(transform: (current: ReturnType<typeof getFileDetailPanelSettings>) => ReturnType<typeof getFileDetailPanelSettings>) {
    setPanelSettings((current) => saveFileDetailPanelSettings(transform(current)));
  }

  function handlePanelDrop(targetId: FileDetailPanelId) {
    if (!draggedPanelId) {
      return;
    }

    updatePanelSettings((current) => moveFileDetailPanel(current, draggedPanelId, targetId));
    setDraggedPanelId(null);
    setDropTargetPanelId(null);
  }

  const panels: Record<
    FileDetailPanelId,
    {
      title: string;
      loading: boolean;
      error: string | null;
      body: ReactNode;
      isWide?: boolean;
    }
  > = {
    qualityBreakdown: {
      title: t("fileDetail.qualityBreakdown"),
      loading: !qualityDetail && !error,
      error: null,
      body: qualityDetail ? (
        <div className="quality-tooltip-content quality-detail-list">
          <div className="quality-tooltip-summary">
            <strong>{qualityDetail.score}/10</strong>
            <span>{t("quality.rawScore", { value: qualityDetail.score_raw.toFixed(2) })}</span>
          </div>
          {qualityDetail.breakdown.categories.map((category) => (
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
      ) : null,
    },
    format: {
      title: t("fileDetail.format"),
      loading: !file && !error,
      error,
      body: <FormatDetailsList detail={file} t={t} />,
    },
    videoStreams: {
      title: t("fileDetail.videoStreams"),
      loading: !file && !error,
      error,
      body: <StreamDetailsList kind="video" detail={file ?? undefined} t={t} surface="panel" />,
    },
    audioStreams: {
      title: t("fileDetail.audioStreams"),
      loading: !file && !error,
      error,
      body: <StreamDetailsList kind="audio" detail={file ?? undefined} t={t} surface="panel" />,
    },
    subtitles: {
      title: t("fileDetail.subtitles"),
      loading: !file && !error,
      error,
      body: <StreamDetailsList kind="subtitle" detail={file ?? undefined} t={t} surface="panel" />,
    },
    rawJson: {
      title: t("fileDetail.rawJson"),
      loading: !file && !error,
      error,
      body: <JsonPreview value={file?.raw_ffprobe_json ?? {}} />,
      isWide: true,
    },
  };

  return (
    <>
      <section className="panel stack">
        <div className="detail-back">
          <Link to={`/libraries/${file?.library_id ?? ""}`} className="badge">
            {t("fileDetail.backToLibrary")}
          </Link>
        </div>
        <div className="file-detail-title-row">
          <h2 className="file-detail-title">{file?.filename ?? t("fileDetail.loading")}</h2>
          {file?.filename ? (
            <TooltipTrigger ariaLabel={t("fileDetail.showFullFilename")} content={file.filename}>
              ?
            </TooltipTrigger>
          ) : null}
        </div>
        <div className="meta-tags">
          <span className="badge">{file?.video_codec ? formatCodecLabel(file.video_codec, "video") : t("fileDetail.unknownCodec")}</span>
          {file?.resolution_category_label ? (
            <TooltipTrigger
              ariaLabel="Show exact resolution"
              content={file.resolution ?? t("fileDetail.unknownResolution")}
              className="file-detail-badge-tooltip-trigger"
            >
              <span className="badge">{file.resolution_category_label}</span>
            </TooltipTrigger>
          ) : (
            <span className="badge">{file?.resolution ?? t("fileDetail.unknownResolution")}</span>
          )}
          <span className="badge">{formatHdrType(file?.hdr_type) ?? t("fileTable.sdr")}</span>
        </div>
        <div className="card-grid grid">
          <article className="media-card metric-card file-detail-path-card">
            <div className="metric-card-label-row">
              <p className="eyebrow">{t("fileDetail.relativePath")}</p>
              {file?.relative_path ? (
                <TooltipTrigger ariaLabel={t("fileDetail.showFullRelativePath")} content={file.relative_path}>
                  ?
                </TooltipTrigger>
              ) : null}
            </div>
            {file?.relative_path ? <PathSegmentTrail value={file.relative_path} /> : <h3>…</h3>}
          </article>
          <article className="media-card metric-card metric-card-teal">
            <p className="eyebrow">{t("fileDetail.size")}</p>
            <h3>{formatBytes(file?.size_bytes ?? 0)}</h3>
          </article>
          <article className="media-card metric-card metric-card-blue">
            <p className="eyebrow">{t("fileDetail.duration")}</p>
            <h3>{formatDuration(file?.duration ?? 0)}</h3>
          </article>
          <article className="media-card metric-card">
            <p className="eyebrow">{t("fileDetail.quality")}</p>
            <h3>{file ? `${file.quality_score}/10` : "…"}</h3>
          </article>
        </div>
      </section>

      <div className="media-grid file-detail-panels-grid">
        {panelSettings.order.map((panelId) => {
          const panel = panels[panelId];
          return (
            <div
              key={panelId}
              className={`file-detail-panel-shell${panel.isWide ? " is-wide" : ""}${dropTargetPanelId === panelId ? " is-drop-target" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggedPanelId && draggedPanelId !== panelId) {
                  setDropTargetPanelId(panelId);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handlePanelDrop(panelId);
              }}
            >
              <AsyncPanel
                title={panel.title}
                loading={panel.loading}
                error={panel.error}
                headerAddon={
                  <span
                    className={`statistics-drag-handle file-detail-panel-drag-handle${draggedPanelId === panelId ? " is-dragging" : ""}`}
                    draggable
                    onDragStart={(event) => {
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", panelId);
                      }
                      setDraggedPanelId(panelId);
                      setDropTargetPanelId(panelId);
                    }}
                    onDragEnd={() => {
                      setDraggedPanelId(null);
                      setDropTargetPanelId(null);
                    }}
                    aria-hidden="true"
                  >
                    <GripVertical className="nav-icon" />
                  </span>
                }
                collapseState={{
                  collapsed: panelSettings.collapsed[panelId],
                  onToggle: () => updatePanelSettings((current) => toggleFileDetailPanelCollapsed(current, panelId)),
                  bodyId: `file-detail-panel-${panelId}`,
                }}
              >
                {panel.body}
              </AsyncPanel>
            </div>
          );
        })}
      </div>
    </>
  );
}

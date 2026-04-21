import { GripVertical } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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

const FILE_DETAIL_PANEL_GAP = 10;
const FILE_DETAIL_PANEL_MIN_WIDTH = 320;
const WIDE_FILE_DETAIL_PANEL_IDS = new Set<FileDetailPanelId>(["rawJson"]);

type FileDetailPanelLayoutItem = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FileDetailPanelLayout = Partial<Record<FileDetailPanelId, FileDetailPanelLayoutItem>>;

type FileDetailPanelDragState = {
  id: FileDetailPanelId;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FileDetailPanelSettingsTransform = (
  current: ReturnType<typeof getFileDetailPanelSettings>,
) => ReturnType<typeof getFileDetailPanelSettings>;

function getFileDetailPanelColumnCount(containerWidth: number): number {
  return Math.max(
    1,
    Math.floor((containerWidth + FILE_DETAIL_PANEL_GAP) / (FILE_DETAIL_PANEL_MIN_WIDTH + FILE_DETAIL_PANEL_GAP)),
  );
}

function pointIsInsideLayoutItem(x: number, y: number, item: FileDetailPanelLayoutItem): boolean {
  return x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height;
}

function findPanelDropTarget(
  x: number,
  y: number,
  draggedId: FileDetailPanelId,
  order: FileDetailPanelId[],
  layout: FileDetailPanelLayout,
): FileDetailPanelId | null {
  const containingTarget = order.find((panelId) => {
    const item = layout[panelId];
    return panelId !== draggedId && item ? pointIsInsideLayoutItem(x, y, item) : false;
  });
  if (containingTarget) {
    return containingTarget;
  }

  let closest: { id: FileDetailPanelId; distance: number; threshold: number } | null = null;
  for (const panelId of order) {
    if (panelId === draggedId) {
      continue;
    }
    const item = layout[panelId];
    if (!item) {
      continue;
    }
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    const distance = Math.hypot(centerX - x, centerY - y);
    const threshold = Math.max(item.width, item.height) * 0.8;
    if (!closest || distance < closest.distance) {
      closest = { id: panelId, distance, threshold };
    }
  }

  return closest && closest.distance <= closest.threshold ? closest.id : null;
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
  const [panelLayout, setPanelLayout] = useState<FileDetailPanelLayout>({});
  const [panelContainerHeight, setPanelContainerHeight] = useState(0);
  const [dragState, setDragState] = useState<FileDetailPanelDragState | null>(null);
  const panelContainerRef = useRef<HTMLDivElement | null>(null);
  const panelShellRefs = useRef<Partial<Record<FileDetailPanelId, HTMLDivElement | null>>>({});
  const panelSettingsRef = useRef(panelSettings);
  const panelLayoutRef = useRef<FileDetailPanelLayout>({});
  const dragStateRef = useRef<FileDetailPanelDragState | null>(null);
  const layoutFrameRef = useRef<number | null>(null);

  useEffect(() => {
    panelSettingsRef.current = panelSettings;
  }, [panelSettings]);

  useEffect(() => {
    panelLayoutRef.current = panelLayout;
  }, [panelLayout]);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

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

  const measurePanelLayout = useCallback(() => {
    const container = panelContainerRef.current;
    if (!container) {
      return;
    }

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) {
      return;
    }

    const columnCount = getFileDetailPanelColumnCount(containerWidth);
    const columnWidth = (containerWidth - FILE_DETAIL_PANEL_GAP * (columnCount - 1)) / columnCount;
    const columnHeights = Array.from({ length: columnCount }, () => 0);
    const nextLayout: FileDetailPanelLayout = {};

    for (const panelId of panelSettingsRef.current.order) {
      const shell = panelShellRefs.current[panelId];
      const isWide = WIDE_FILE_DETAIL_PANEL_IDS.has(panelId);
      const itemWidth = isWide ? containerWidth : columnWidth;
      if (shell) {
        shell.style.width = `${itemWidth}px`;
      }
      const itemHeight = Math.max(1, Math.ceil(shell?.getBoundingClientRect().height ?? 1));

      if (isWide) {
        const y = Math.max(...columnHeights);
        nextLayout[panelId] = { x: 0, y, width: itemWidth, height: itemHeight };
        columnHeights.fill(y + itemHeight + FILE_DETAIL_PANEL_GAP);
        continue;
      }

      const columnIndex = columnHeights.reduce(
        (shortestIndex, currentHeight, currentIndex) =>
          currentHeight < columnHeights[shortestIndex] ? currentIndex : shortestIndex,
        0,
      );
      const x = columnIndex * (columnWidth + FILE_DETAIL_PANEL_GAP);
      const y = columnHeights[columnIndex];
      nextLayout[panelId] = { x, y, width: itemWidth, height: itemHeight };
      columnHeights[columnIndex] = y + itemHeight + FILE_DETAIL_PANEL_GAP;
    }

    const nextHeight = Math.max(0, Math.max(...columnHeights) - FILE_DETAIL_PANEL_GAP);
    panelLayoutRef.current = nextLayout;
    setPanelLayout(nextLayout);
    setPanelContainerHeight(nextHeight);
  }, []);

  const schedulePanelLayoutMeasure = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (layoutFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutFrameRef.current);
    }
    layoutFrameRef.current = window.requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      measurePanelLayout();
    });
  }, [measurePanelLayout]);

  useLayoutEffect(() => {
    measurePanelLayout();
  }, [file, qualityDetail, error, panelSettings, measurePanelLayout]);

  useEffect(() => {
    const container = panelContainerRef.current;
    if (!container) {
      return undefined;
    }

    schedulePanelLayoutMeasure();
    window.addEventListener("resize", schedulePanelLayoutMeasure);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", schedulePanelLayoutMeasure);
        if (layoutFrameRef.current !== null) {
          window.cancelAnimationFrame(layoutFrameRef.current);
          layoutFrameRef.current = null;
        }
      };
    }

    const observer = new ResizeObserver(() => schedulePanelLayoutMeasure());
    observer.observe(container);
    for (const panelId of panelSettingsRef.current.order) {
      const shell = panelShellRefs.current[panelId];
      if (shell) {
        observer.observe(shell);
      }
    }

    return () => {
      window.removeEventListener("resize", schedulePanelLayoutMeasure);
      observer.disconnect();
      if (layoutFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
    };
  }, [panelSettings.order, schedulePanelLayoutMeasure]);

  const updatePanelSettings = useCallback(
    (transform: FileDetailPanelSettingsTransform) => {
      setPanelSettings((current) => {
        const next = saveFileDetailPanelSettings(transform(current));
        panelSettingsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateTransientPanelSettings = useCallback(
    (transform: FileDetailPanelSettingsTransform) => {
      setPanelSettings((current) => {
        const next = transform(current);
        panelSettingsRef.current = next;
        return next;
      });
    },
    [],
  );

  function handlePanelDrop(targetId: FileDetailPanelId) {
    if (!draggedPanelId) {
      return;
    }

    updatePanelSettings((current) => moveFileDetailPanel(current, draggedPanelId, targetId));
    setDraggedPanelId(null);
    setDropTargetPanelId(null);
  }

  const updatePointerDrag = useCallback((event: PointerEvent) => {
    const currentDragState = dragStateRef.current;
    const container = panelContainerRef.current;
    if (!currentDragState || !container || event.pointerId !== currentDragState.pointerId) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const pointerX = event.clientX - containerRect.left;
    const pointerY = event.clientY - containerRect.top;
    const nextDragState = {
      ...currentDragState,
      x: pointerX - currentDragState.offsetX,
      y: pointerY - currentDragState.offsetY,
    };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);

    const targetId = findPanelDropTarget(
      pointerX,
      pointerY,
      currentDragState.id,
      panelSettingsRef.current.order,
      panelLayoutRef.current,
    );
    if (!targetId) {
      setDropTargetPanelId(null);
      return;
    }

    setDropTargetPanelId(targetId);
    updateTransientPanelSettings((current) => moveFileDetailPanel(current, currentDragState.id, targetId));
  }, [updateTransientPanelSettings]);

  const finishPointerDrag = useCallback((event: PointerEvent) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState || event.pointerId !== currentDragState.pointerId) {
      return;
    }

    const savedSettings = saveFileDetailPanelSettings(panelSettingsRef.current);
    panelSettingsRef.current = savedSettings;
    setPanelSettings(savedSettings);
    dragStateRef.current = null;
    setDragState(null);
    setDraggedPanelId(null);
    setDropTargetPanelId(null);
    schedulePanelLayoutMeasure();
  }, [schedulePanelLayoutMeasure]);

  useEffect(() => {
    if (!dragState) {
      return undefined;
    }

    window.addEventListener("pointermove", updatePointerDrag);
    window.addEventListener("pointerup", finishPointerDrag);
    window.addEventListener("pointercancel", finishPointerDrag);

    return () => {
      window.removeEventListener("pointermove", updatePointerDrag);
      window.removeEventListener("pointerup", finishPointerDrag);
      window.removeEventListener("pointercancel", finishPointerDrag);
    };
  }, [dragState?.pointerId, finishPointerDrag, updatePointerDrag]);

  function handlePanelPointerDown(panelId: FileDetailPanelId, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const shell = panelShellRefs.current[panelId];
    const layout = panelLayoutRef.current[panelId];
    const container = panelContainerRef.current;
    if (!shell || !layout || !container) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const shellRect = shell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const nextDragState = {
      id: panelId,
      pointerId: event.pointerId,
      offsetX: event.clientX - shellRect.left,
      offsetY: event.clientY - shellRect.top,
      x: shellRect.left - containerRect.left,
      y: shellRect.top - containerRect.top,
      width: layout.width,
      height: layout.height,
    };
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
    setDraggedPanelId(panelId);
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
  const hasPanelLayout = panelSettings.order.every((panelId) => Boolean(panelLayout[panelId]));
  const panelContainerStyle: CSSProperties | undefined = hasPanelLayout
    ? { height: `${panelContainerHeight}px` }
    : undefined;

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

      <div
        ref={panelContainerRef}
        className={`media-grid file-detail-panels-grid${hasPanelLayout ? " is-masonry-ready" : ""}${
          dragState ? " is-reordering" : ""
        }`}
        style={panelContainerStyle}
      >
        {panelSettings.order.map((panelId) => {
          const panel = panels[panelId];
          const layout = panelLayout[panelId];
          const isDragging = dragState?.id === panelId;
          const x = isDragging && dragState ? dragState.x : layout?.x ?? 0;
          const y = isDragging && dragState ? dragState.y : layout?.y ?? 0;
          const width = isDragging && dragState ? dragState.width : layout?.width;
          const shellStyle: CSSProperties | undefined = layout
            ? {
                width: width ? `${width}px` : undefined,
                transform: `translate3d(${x}px, ${y}px, 0)`,
                zIndex: isDragging ? 40 : undefined,
              }
            : undefined;
          return (
            <div
              key={panelId}
              ref={(node) => {
                panelShellRefs.current[panelId] = node;
              }}
              className={`file-detail-panel-shell${panel.isWide ? " is-wide" : ""}${
                dropTargetPanelId === panelId ? " is-drop-target" : ""
              }${isDragging ? " is-dragging" : ""}`}
              style={shellStyle}
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
                    onPointerDown={(event) => handlePanelPointerDown(panelId, event)}
                    onDragStart={(event) => {
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", panelId);
                      }
                      setDraggedPanelId(panelId);
                      setDropTargetPanelId(null);
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

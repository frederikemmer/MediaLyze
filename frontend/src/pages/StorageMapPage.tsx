import {
  ArrowUp,
  ChevronRight,
  File,
  FileText,
  Folder,
  Info,
  Map as MapIcon,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";

import { JellyfinIcon } from "../components/JellyfinIcon";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import { StatCard } from "../components/StatCard";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import { api, type LibraryStorageMap, type StorageMapNode } from "../lib/api";
import {
  formatBitrate,
  formatBytes,
  formatCodecLabel,
  formatContainerLabel,
  formatDuration,
} from "../lib/format";
import { formatHdrType } from "../lib/hdr";
import { LruCache } from "../lib/lru-cache";

type StorageMapColorMode =
  | "codec"
  | "resolution"
  | "hdr"
  | "quality"
  | "size"
  | "container"
  | "duration"
  | "bitrate"
  | "audio_bitrate"
  | "audio_codec"
  | "audio_channels"
  | "frame_rate"
  | "bit_depth"
  | "audio_language"
  | "subtitle_status"
  | "subtitle_language"
  | "analysis_status";
type StorageMapSortMode = "size" | "name" | "quality";
type StorageMapNameSource = "file" | "jellyfin";

type StorageMapRect = {
  node: StorageMapNode;
  x: number;
  y: number;
  width: number;
  height: number;
};

const COLOR_MODE_GROUPS: Array<{
  label: "video" | "audio" | "subtitles" | "file";
  modes: StorageMapColorMode[];
}> = [
  {
    label: "video",
    modes: ["codec", "resolution", "hdr", "frame_rate", "bit_depth"],
  },
  {
    label: "audio",
    modes: ["audio_codec", "audio_channels", "audio_bitrate", "audio_language"],
  },
  {
    label: "subtitles",
    modes: ["subtitle_status", "subtitle_language"],
  },
  {
    label: "file",
    modes: ["container", "size", "duration", "bitrate", "quality", "analysis_status"],
  },
];
const COLOR_MODES = COLOR_MODE_GROUPS.flatMap((group) => group.modes);
const SORT_MODES: StorageMapSortMode[] = ["size", "name", "quality"];
const UNKNOWN_COLOR = "#6b7280";
const CATEGORY_PALETTE = ["#1b998b", "#ff6b3d", "#4f6fcf", "#a967c7", "#d49b2f", "#397f9e"];

function isColorMode(value: string | null): value is StorageMapColorMode {
  return COLOR_MODES.includes(value as StorageMapColorMode);
}

function isSortMode(value: string | null): value is StorageMapSortMode {
  return SORT_MODES.includes(value as StorageMapSortMode);
}

function displayNameForNode(node: StorageMapNode, nameSource: StorageMapNameSource): string {
  return node.kind === "file" && nameSource === "jellyfin"
    ? (node.jellyfin_title ?? node.name)
    : node.name;
}

function stablePaletteColor(value: string | null | undefined): string {
  if (!value) return UNKNOWN_COLOR;
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

function qualityScoreForColor(node: StorageMapNode): number | null {
  if (node.quality_score_raw !== null) return node.quality_score_raw;
  return node.quality_score === null ? null : node.quality_score * 10;
}

function colorForNode(
  node: StorageMapNode,
  mode: StorageMapColorMode,
  maxValue: number,
): string {
  if (mode === "codec") {
    const codec = node.video_codec?.toLowerCase();
    if (codec === "hevc" || codec === "h265") return "#1b998b";
    if (codec === "h264") return "#4f6fcf";
    if (codec === "av1") return "#ff6b3d";
    return stablePaletteColor(codec);
  }
  if (mode === "resolution") {
    return stablePaletteColor(node.resolution_category_id ?? node.resolution);
  }
  if (mode === "hdr") {
    const hdr = node.hdr_type?.toLowerCase();
    if (!hdr || hdr === "sdr") return "#60717d";
    if (hdr.includes("dolby")) return "#a967c7";
    if (hdr.includes("hdr10+")) return "#ff6b3d";
    if (hdr.includes("hdr10")) return "#d49b2f";
    if (hdr.includes("hlg")) return "#397f9e";
    return stablePaletteColor(hdr);
  }
  if (mode === "quality") {
    const qualityScoreRaw = qualityScoreForColor(node);
    if (qualityScoreRaw === null) return UNKNOWN_COLOR;
    const normalized = Math.max(0, Math.min(1, qualityScoreRaw / 100));
    return `hsl(${Math.round(8 + normalized * 154)} 48% ${Math.round(46 - normalized * 10)}%)`;
  }
  if (mode === "container") return stablePaletteColor(node.container);
  if (mode === "audio_codec") return stablePaletteColor(node.audio_codec);
  if (mode === "audio_channels") {
    const channelColors: Record<number, string> = {
      1: "#60717d",
      2: "#397f9e",
      6: "#1b998b",
      8: "#a967c7",
    };
    return node.audio_channels
      ? (channelColors[node.audio_channels] ?? stablePaletteColor(String(node.audio_channels)))
      : UNKNOWN_COLOR;
  }
  if (mode === "frame_rate") {
    return node.frame_rate
      ? stablePaletteColor(String(Math.round(node.frame_rate * 1000) / 1000))
      : UNKNOWN_COLOR;
  }
  if (mode === "bit_depth") {
    const depthColors: Record<number, string> = {
      8: "#397f9e",
      10: "#1b998b",
      12: "#a967c7",
    };
    return node.bit_depth
      ? (depthColors[node.bit_depth] ?? stablePaletteColor(String(node.bit_depth)))
      : UNKNOWN_COLOR;
  }
  if (mode === "audio_language") return stablePaletteColor(node.audio_language);
  if (mode === "subtitle_language") return stablePaletteColor(node.subtitle_language);
  if (mode === "subtitle_status") {
    const statusColors: Record<string, string> = {
      none: "#60717d",
      internal: "#4f6fcf",
      external: "#ff6b3d",
      mixed: "#a967c7",
    };
    return node.subtitle_status ? (statusColors[node.subtitle_status] ?? UNKNOWN_COLOR) : UNKNOWN_COLOR;
  }
  if (mode === "analysis_status") {
    const statusColors: Record<string, string> = {
      ready: "#1b998b",
      analyzing: "#d49b2f",
      pending: "#60717d",
      failed: "#c45151",
    };
    return node.analysis_status ? (statusColors[node.analysis_status] ?? UNKNOWN_COLOR) : UNKNOWN_COLOR;
  }
  const value = numericValueForNode(node, mode);
  if (value === null) return UNKNOWN_COLOR;
  const normalized = Math.sqrt(Math.max(0, value) / Math.max(maxValue, 1));
  return `hsl(${Math.round(204 - normalized * 178)} 55% ${Math.round(48 - normalized * 10)}%)`;
}

function numericValueForNode(node: StorageMapNode, mode: StorageMapColorMode): number | null {
  if (mode === "duration") return node.duration_seconds;
  if (mode === "bitrate") return node.bitrate;
  if (mode === "audio_bitrate") return node.audio_bitrate;
  return node.size_bytes;
}

function colorForDistributionValue(
  node: StorageMapNode,
  mode: StorageMapColorMode,
  value: string | number | null,
  maxValue: number,
): string {
  if (value === null) return UNKNOWN_COLOR;
  const syntheticNode = { ...node };
  if (mode === "codec") syntheticNode.video_codec = typeof value === "string" ? value : null;
  else if (mode === "resolution") {
    syntheticNode.resolution_category_id = typeof value === "string" ? value : null;
    syntheticNode.resolution = null;
  } else if (mode === "hdr") syntheticNode.hdr_type = typeof value === "string" ? value : null;
  else if (mode === "quality") {
    syntheticNode.quality_score_raw = typeof value === "number" ? value : null;
  }
  else if (mode === "size") syntheticNode.size_bytes = typeof value === "number" ? value : 0;
  else if (mode === "container") syntheticNode.container = typeof value === "string" ? value : null;
  else if (mode === "duration") syntheticNode.duration_seconds = typeof value === "number" ? value : null;
  else if (mode === "bitrate") syntheticNode.bitrate = typeof value === "number" ? value : null;
  else if (mode === "audio_bitrate") syntheticNode.audio_bitrate = typeof value === "number" ? value : null;
  else if (mode === "audio_codec") syntheticNode.audio_codec = typeof value === "string" ? value : null;
  else if (mode === "audio_channels") syntheticNode.audio_channels = typeof value === "number" ? value : null;
  else if (mode === "frame_rate") syntheticNode.frame_rate = typeof value === "number" ? value : null;
  else if (mode === "bit_depth") syntheticNode.bit_depth = typeof value === "number" ? value : null;
  else if (mode === "audio_language") syntheticNode.audio_language = typeof value === "string" ? value : null;
  else if (mode === "subtitle_status") syntheticNode.subtitle_status = typeof value === "string" ? value : null;
  else if (mode === "subtitle_language") syntheticNode.subtitle_language = typeof value === "string" ? value : null;
  else if (mode === "analysis_status") syntheticNode.analysis_status = typeof value === "string" ? value : null;
  return colorForNode(syntheticNode, mode, maxValue);
}

const FOLDER_GRADIENT_ANCHORS = [
  [0, 0, 0.9, 1.04],
  [100, 0, 1.04, 0.9],
  [100, 100, 0.9, 1.04],
  [0, 100, 1.04, 0.9],
  [32, 34, 0.68, 0.86],
  [70, 40, 0.86, 0.68],
  [50, 76, 0.74, 0.74],
] as const;

function folderGradientForNode(
  node: StorageMapNode,
  mode: StorageMapColorMode,
  maxValue: number,
): string | undefined {
  if (node.kind !== "folder") return undefined;
  const distribution = node.color_distributions[mode] ?? [];
  if (distribution.length < 2) return undefined;

  const byColor = new Map<string, number>();
  for (const share of distribution) {
    const color = colorForDistributionValue(node, mode, share.value, maxValue);
    byColor.set(color, (byColor.get(color) ?? 0) + share.size_bytes);
  }
  const colors = [...byColor.entries()]
    .map(([color, sizeBytes]) => ({ color, sizeBytes }))
    .sort((left, right) => right.sizeBytes - left.sizeBytes);
  if (colors.length < 2) return undefined;

  const total = colors.reduce((sum, item) => sum + item.sizeBytes, 0);
  const guaranteedColors = colors.slice(0, FOLDER_GRADIENT_ANCHORS.length);
  const weightedSlots = FOLDER_GRADIENT_ANCHORS.length - guaranteedColors.length;
  const weightedColors = Array.from({ length: weightedSlots }, (_, index) => {
    const target = ((index + 0.5) / Math.max(weightedSlots, 1)) * total;
    let accumulated = 0;
    return colors.find((item) => {
      accumulated += item.sizeBytes;
      return accumulated >= target;
    }) ?? colors[0];
  });
  const anchorColors = [...guaranteedColors, ...weightedColors];

  const layers = FOLDER_GRADIENT_ANCHORS.map(([x, y, widthScale, heightScale], index) => {
    const item = anchorColors[index];
    const share = item.sizeBytes / Math.max(total, 1);
    const radius = 38 + Math.sqrt(share) * 40;
    const radiusX = Math.round(radius * widthScale);
    const radiusY = Math.round(radius * heightScale);
    return (
      `radial-gradient(ellipse ${radiusX}% ${radiusY}% at ${x}% ${y}%, ` +
      `${item.color} 0%, ` +
      `color-mix(in srgb, ${item.color} 78%, transparent) 30%, ` +
      `color-mix(in srgb, ${item.color} 24%, transparent) 58%, transparent 78%)`
    );
  });
  return layers.reverse().join(", ");
}

function labelForNode(
  node: StorageMapNode,
  mode: StorageMapColorMode,
  unknownLabel: string,
  valueLabel: (value: string) => string,
): string {
  if (mode === "codec") {
    return node.video_codec ? formatCodecLabel(node.video_codec, "video") : unknownLabel;
  }
  if (mode === "resolution") {
    return node.resolution_category_label ?? node.resolution ?? unknownLabel;
  }
  if (mode === "hdr") {
    return node.hdr_type ? (formatHdrType(node.hdr_type) ?? unknownLabel) : unknownLabel;
  }
  if (mode === "quality") {
    return node.quality_score === null ? unknownLabel : `${Math.round(node.quality_score)}/10`;
  }
  if (mode === "container") return node.container ? formatContainerLabel(node.container) : unknownLabel;
  if (mode === "duration") return node.duration_seconds === null ? unknownLabel : formatDuration(node.duration_seconds);
  if (mode === "bitrate") return node.bitrate === null ? unknownLabel : formatBitrate(node.bitrate);
  if (mode === "audio_bitrate") {
    return node.audio_bitrate === null ? unknownLabel : formatBitrate(node.audio_bitrate);
  }
  if (mode === "audio_codec") {
    return node.audio_codec ? formatCodecLabel(node.audio_codec, "audio") : unknownLabel;
  }
  if (mode === "audio_channels") {
    return node.audio_channels === null ? unknownLabel : `${node.audio_channels} ch`;
  }
  if (mode === "frame_rate") {
    return node.frame_rate === null ? unknownLabel : `${Number(node.frame_rate.toFixed(3))} fps`;
  }
  if (mode === "bit_depth") {
    return node.bit_depth === null ? unknownLabel : `${node.bit_depth}-bit`;
  }
  if (mode === "audio_language") return node.audio_language?.toUpperCase() ?? unknownLabel;
  if (mode === "subtitle_language") return node.subtitle_language?.toUpperCase() ?? unknownLabel;
  if (mode === "subtitle_status") {
    return node.subtitle_status
      ? valueLabel(node.subtitle_status)
      : unknownLabel;
  }
  if (mode === "analysis_status") {
    return node.analysis_status
      ? valueLabel(node.analysis_status)
      : unknownLabel;
  }
  return formatBytes(node.size_bytes);
}

function splitStorageMapNodes(
  nodes: StorageMapNode[],
  x: number,
  y: number,
  width: number,
  height: number,
  output: StorageMapRect[],
): void {
  if (nodes.length === 0) return;
  if (nodes.length === 1) {
    output.push({ node: nodes[0], x, y, width, height });
    return;
  }

  const total = nodes.reduce((sum, node) => sum + Math.max(node.size_bytes, 1), 0);
  let leftWeight = 0;
  let splitIndex = 1;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    leftWeight += Math.max(nodes[index].size_bytes, 1);
    splitIndex = index + 1;
    if (leftWeight >= total / 2) break;
  }

  const ratio = Math.max(0.001, Math.min(0.999, leftWeight / total));
  if (width >= height) {
    const leftWidth = width * ratio;
    splitStorageMapNodes(nodes.slice(0, splitIndex), x, y, leftWidth, height, output);
    splitStorageMapNodes(nodes.slice(splitIndex), x + leftWidth, y, width - leftWidth, height, output);
  } else {
    const topHeight = height * ratio;
    splitStorageMapNodes(nodes.slice(0, splitIndex), x, y, width, topHeight, output);
    splitStorageMapNodes(nodes.slice(splitIndex), x, y + topHeight, width, height - topHeight, output);
  }
}

export function layoutStorageMapNodes(nodes: StorageMapNode[]): StorageMapRect[] {
  const output: StorageMapRect[] = [];
  splitStorageMapNodes(nodes, 0, 0, 100, 100, output);
  return output;
}

function StorageMapTile({
  node,
  colorMode,
  maxSize,
  rect,
  nameSource,
  onOpen,
}: {
  node: StorageMapNode;
  colorMode: StorageMapColorMode;
  maxSize: number;
  rect: Omit<StorageMapRect, "node">;
  nameSource: StorageMapNameSource;
  onOpen: (node: StorageMapNode) => void;
}) {
  const { t } = useTranslation();
  const displayName = displayNameForNode(node, nameSource);
  const metricLabel = labelForNode(
    node,
    colorMode,
    t("storageMap.unknown"),
    (value) => t(`storageMap.values.${value}`),
  );
  const tooltipRows = [
    { label: t("dashboard.storage"), value: formatBytes(node.size_bytes) },
    ...(node.kind === "folder"
      ? [{ label: t("dashboard.files"), value: String(node.file_count) }]
      : []),
    ...(node.video_codec
      ? [{ label: t("storageMap.modes.codec"), value: formatCodecLabel(node.video_codec, "video") }]
      : []),
    ...(node.resolution || node.resolution_category_label
      ? [{
          label: t("storageMap.modes.resolution"),
          value: node.resolution
            ? node.resolution.replace("x", " × ")
            : (node.resolution_category_label ?? t("storageMap.unknown")),
        }]
      : []),
    ...(node.hdr_type
      ? [{
          label: t("storageMap.modes.hdr"),
          value: formatHdrType(node.hdr_type) ?? node.hdr_type,
        }]
      : []),
    ...(node.quality_score !== null
      ? [{
          label: t("storageMap.modes.quality"),
          value: `${Math.round(node.quality_score)}/10`,
        }]
      : []),
  ];
  const folderGradient = folderGradientForNode(node, colorMode, maxSize);
  const style = {
    "--storage-map-tile-color": colorForNode(node, colorMode, maxSize),
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  } as CSSProperties;

  return (
    <TooltipTrigger
      ariaLabel={t(node.kind === "folder" ? "storageMap.folderAria" : "storageMap.fileAria", {
        name: displayName,
        size: formatBytes(node.size_bytes),
      })}
      className={`storage-map-tile storage-map-tile-${node.kind}`}
      tooltipClassName="storage-map-tile-tooltip"
      content={(
        <div className="storage-map-tile-tooltip-content">
          <div className="storage-map-tile-tooltip-heading">
            <span className="storage-map-tile-tooltip-icon" aria-hidden="true">
              {node.kind === "folder" ? <Folder /> : <File />}
            </span>
            <span>
              <strong>{displayName}</strong>
              <small>
                {node.kind === "folder"
                  ? t("storageMap.folders")
                  : t("dashboard.files")}
              </small>
            </span>
          </div>
          <span className="storage-map-tile-tooltip-metric">
            {t(`storageMap.modes.${colorMode}`)} · {metricLabel}
          </span>
          <dl>
            {tooltipRows.map((row) => (
              <div key={`${row.label}:${row.value}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      hoverOpenDelay={80}
      maxWidth={360}
      placement="auto"
      pinOnClick={false}
      style={style}
      onClick={() => onOpen(node)}
    >
      {folderGradient ? (
        <span
          className="storage-map-tile-color-field"
          aria-hidden="true"
          style={{ backgroundImage: folderGradient }}
        />
      ) : null}
      <span className="storage-map-tile-copy" aria-hidden="true">
        <span className="storage-map-tile-name">
          {node.kind === "folder" ? <Folder aria-hidden="true" /> : <File aria-hidden="true" />}
          <strong>{displayName}</strong>
        </span>
        <span className="storage-map-tile-meta">{metricLabel}</span>
        <span className="storage-map-tile-size">{formatBytes(node.size_bytes)}</span>
      </span>
    </TooltipTrigger>
  );
}

function StorageMapTreemap({
  nodes,
  colorMode,
  nameSource,
  onOpen,
}: {
  nodes: StorageMapNode[];
  colorMode: StorageMapColorMode;
  nameSource: StorageMapNameSource;
  onOpen: (node: StorageMapNode) => void;
}) {
  const { t } = useTranslation();
  const maxValue = Math.max(
    ...nodes.map((node) => numericValueForNode(node, colorMode) ?? 0),
    1,
  );
  const rects = useMemo(() => layoutStorageMapNodes(nodes), [nodes]);

  return (
    <div className="storage-map-treemap" role="group" aria-label={t("storageMap.treemapAria")}>
      {rects.map(({ node, x, y, width, height }) => (
        <StorageMapTile
          key={`${node.kind}:${node.path}`}
          node={node}
          colorMode={colorMode}
          maxSize={maxValue}
          rect={{ x, y, width, height }}
          nameSource={nameSource}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export function StorageMapPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { libraries, librariesLoaded } = useAppData();
  const storageMapCacheRef = useRef(
    new LruCache<string, LibraryStorageMap>(32, { ttlMs: 2 * 60 * 1000 }),
  );
  const [data, setData] = useState<LibraryStorageMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedLibraryId = Number(searchParams.get("library")) || libraries[0]?.id || null;
  const currentPath = searchParams.get("path") ?? "";
  const colorParam = searchParams.get("color");
  const sortParam = searchParams.get("sort");
  const selectedLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? null;
  const supportsJellyfinNames = Boolean(selectedLibrary?.linked_jellyfin_library);
  const nameSource: StorageMapNameSource =
    supportsJellyfinNames && searchParams.get("names") === "jellyfin" ? "jellyfin" : "file";
  const colorMode: StorageMapColorMode = isColorMode(colorParam) ? colorParam : "codec";
  const sortMode: StorageMapSortMode = isSortMode(sortParam) ? sortParam : "size";

  const updateQuery = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      setSearchParams(next, { replace });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (!librariesLoaded || libraries.length === 0) return;
    const selectedExists = libraries.some((library) => library.id === selectedLibraryId);
    if (!selectedExists) {
      updateQuery({ library: String(libraries[0].id), path: null }, true);
    } else if (!searchParams.get("library") && selectedLibraryId) {
      updateQuery({ library: String(selectedLibraryId) }, true);
    }
  }, [libraries, librariesLoaded, searchParams, selectedLibraryId, updateQuery]);

  const loadMap = useCallback((force = false) => {
    if (!selectedLibraryId) return () => undefined;
    const cacheKey = `${selectedLibraryId}:${currentPath}`;
    const cached = force ? undefined : storageMapCacheRef.current.get(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return () => undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .libraryStorageMap(selectedLibraryId, { path: currentPath, signal: controller.signal })
      .then((payload) => {
        storageMapCacheRef.current.set(cacheKey, payload);
        setData(payload);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : t("storageMap.error"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [currentPath, selectedLibraryId, t]);

  useEffect(() => loadMap(), [loadMap]);

  const sortedItems = useMemo(() => {
    if (!data) return [];
    return [...data.items].sort((left, right) => {
      if (sortMode === "name") {
        return displayNameForNode(left, nameSource).localeCompare(displayNameForNode(right, nameSource));
      }
      if (sortMode === "quality") {
        return (
          (qualityScoreForColor(right) ?? -1) - (qualityScoreForColor(left) ?? -1) ||
          right.size_bytes - left.size_bytes
        );
      }
      return (
        right.size_bytes - left.size_bytes ||
        displayNameForNode(left, nameSource).localeCompare(displayNameForNode(right, nameSource))
      );
    });
  }, [data, nameSource, sortMode]);
  const parentPath = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";

  function openNode(node: StorageMapNode) {
    if (node.kind === "folder") {
      updateQuery({ path: node.path });
    } else if (node.file_id) {
      navigate(`/files/${node.file_id}`);
    }
  }

  return (
    <div className="storage-map-page">
      <section className="panel storage-map-panel">
        <div className="storage-map-header">
          <div className="storage-map-title-block">
            <h2>{t("storageMap.title")}</h2>
            <p className="subtitle">{t("storageMap.subtitle")}</p>
          </div>
          {data ? (
            <div className="card-grid grid storage-map-header-cards">
              <StatCard
                label={t("dashboard.storage")}
                value={formatBytes(data.total_size_bytes)}
                tone="blue"
              />
              <StatCard
                label={t("dashboard.files")}
                value={String(data.file_count)}
                tone="teal"
              />
            </div>
          ) : null}
        </div>

        {librariesLoaded && libraries.length === 0 ? (
          <div className="storage-map-empty">
            <MapIcon aria-hidden="true" />
            <h3>{t("storageMap.noLibrariesTitle")}</h3>
            <p>{t("storageMap.noLibrariesBody")}</p>
          </div>
        ) : (
          <div className="storage-map-explorer">
            <div className="storage-map-content">
              <div className={`storage-map-breadcrumb-row${currentPath ? "" : " is-root"}`}>
                <nav className="storage-map-breadcrumbs" aria-label={t("storageMap.breadcrumbAria")}>
                  {(data?.breadcrumbs ?? []).map((breadcrumb, index) => (
                    <span key={breadcrumb.path || "root"}>
                      {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
                      <button type="button" onClick={() => updateQuery({ path: breadcrumb.path })}>
                        {breadcrumb.name}
                      </button>
                    </span>
                  ))}
                </nav>
              </div>

              <div className="storage-map-toolbar">
                <label className="storage-map-field storage-map-library-field">
                  <span>{t("storageMap.library")}</span>
                  <select
                    className="settings-choice-input"
                    value={selectedLibraryId ?? ""}
                    disabled={!librariesLoaded}
                    onChange={(event) => updateQuery({ library: event.target.value, path: null })}
                  >
                    {libraries.map((library) => (
                      <option key={library.id} value={library.id}>
                        {library.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="storage-map-field">
                  <span>{t("storageMap.colorBy")}</span>
                  <select
                    className="settings-choice-input"
                    value={colorMode}
                    onChange={(event) => updateQuery({ color: event.target.value })}
                  >
                    {COLOR_MODE_GROUPS.map((group) => (
                      <optgroup
                        key={group.label}
                        label={t(`storageMap.groups.${group.label}`)}
                      >
                        {group.modes.map((mode) => (
                          <option key={mode} value={mode}>
                            {t(`storageMap.modes.${mode}`)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="storage-map-field">
                  <span>{t("storageMap.sortBy")}</span>
                  <select
                    className="settings-choice-input"
                    value={sortMode}
                    onChange={(event) => updateQuery({ sort: event.target.value })}
                  >
                    {SORT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`storageMap.sorts.${mode}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {supportsJellyfinNames ? (
                  <div
                    className="distribution-chart-mode-toggle analyzed-file-name-source-toggle storage-map-name-source-toggle"
                    role="group"
                    aria-label={t("libraryDetail.fileNameSource.label")}
                  >
                    <SlidingTogglePill
                      activeKey={nameSource}
                      className="nav-active-pill distribution-chart-mode-pill"
                    />
                    <button
                      type="button"
                      data-toggle-key="file"
                      className={`distribution-chart-mode-button analyzed-file-name-source-button${
                        nameSource === "file" ? " active" : ""
                      }`}
                      aria-label={t("libraryDetail.fileNameSource.file")}
                      title={t("libraryDetail.fileNameSource.file")}
                      aria-pressed={nameSource === "file"}
                      onClick={() => updateQuery({ names: null })}
                    >
                      <span className="distribution-chart-mode-button-content">
                        <FileText aria-hidden="true" className="distribution-chart-mode-icon" />
                      </span>
                    </button>
                    <button
                      type="button"
                      data-toggle-key="jellyfin"
                      className={`distribution-chart-mode-button analyzed-file-name-source-button${
                        nameSource === "jellyfin" ? " active" : ""
                      }`}
                      aria-label={t("libraryDetail.fileNameSource.jellyfin")}
                      title={t("libraryDetail.fileNameSource.jellyfin")}
                      aria-pressed={nameSource === "jellyfin"}
                      onClick={() => updateQuery({ names: "jellyfin" })}
                    >
                      <span className="distribution-chart-mode-button-content">
                        <JellyfinIcon aria-hidden="true" className="distribution-chart-mode-icon" />
                      </span>
                    </button>
                  </div>
                ) : null}
                <span className="storage-map-area-hint">
                  <Info aria-hidden="true" />
                  {t("storageMap.areaHint")}
                </span>
              </div>

              <div className={`storage-map-stage${currentPath ? " has-up-overlay" : ""}`}>
                {currentPath ? (
                  <button
                    type="button"
                    aria-label={t("storageMap.up")}
                    className="secondary icon-only-button storage-map-up-button storage-map-up-overlay"
                    onClick={() => updateQuery({ path: parentPath })}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                ) : null}
                {loading && !data ? (
                  <div className="storage-map-empty" aria-busy="true">
                    <RefreshCw aria-hidden="true" className="storage-map-spinner" />
                    <p>{t("storageMap.loading")}</p>
                  </div>
                ) : error ? (
                  <div className="storage-map-empty" role="alert">
                    <Info aria-hidden="true" />
                    <h3>{t("storageMap.errorTitle")}</h3>
                    <p>{error}</p>
                    <button type="button" className="secondary small" onClick={() => loadMap(true)}>
                      <RefreshCw aria-hidden="true" />
                      {t("storageMap.retry")}
                    </button>
                  </div>
                ) : sortedItems.length === 0 ? (
                  <div className="storage-map-empty">
                    <Folder aria-hidden="true" />
                    <h3>{t("storageMap.emptyTitle")}</h3>
                    <p>{t("storageMap.emptyBody")}</p>
                  </div>
                ) : (
                  <StorageMapTreemap
                    nodes={sortedItems}
                    colorMode={colorMode}
                    nameSource={nameSource}
                    onOpen={openNode}
                  />
                )}
              </div>

            </div>
          </div>
        )}
      </section>
    </div>
  );
}

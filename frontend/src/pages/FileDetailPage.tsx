import {
  Archive,
  AudioLines,
  Captions,
  ChevronDown,
  Download,
  FileClock,
  FileJson,
  Film,
  Gauge,
  ImageIcon,
  Info,
  ListVideo,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { PanelLeftToggleIcon } from "../components/PanelLeftToggleIcon";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import { StreamDetailsList } from "../components/StreamDetailsList";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { api, type MediaFileDetail, type MediaFileHistory, type MediaFileQualityScoreDetail } from "../lib/api";
import { useAppData } from "../lib/app-data";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDate, formatDuration } from "../lib/format";
import { formatHdrType } from "../lib/hdr";

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

type FileDetailPanelId =
  | "overview"
  | "format"
  | "qualityBreakdown"
  | "videoStreams"
  | "audioStreams"
  | "subtitles"
  | "cover"
  | "chapters"
  | "fileHistory"
  | "rawJson";

type FileDetailNavItem = {
  id: FileDetailPanelId;
  labelKey: string;
  icon: typeof Info;
};

const FILE_DETAIL_ACTIVE_PANEL_STORAGE_KEY = "medialyze-file-detail-active-panel";
const FILE_DETAIL_NAV_COLLAPSED_STORAGE_KEY = "medialyze-file-detail-sidebar-collapsed";
const DEFAULT_FILE_DETAIL_PANEL_ID: FileDetailPanelId = "overview";

const FILE_DETAIL_NAV_ITEMS: FileDetailNavItem[] = [
  { id: "overview", labelKey: "fileDetail.navigation.overview", icon: Info },
  { id: "format", labelKey: "fileDetail.format", icon: Archive },
  { id: "qualityBreakdown", labelKey: "fileDetail.qualityBreakdown", icon: Gauge },
  { id: "videoStreams", labelKey: "fileDetail.videoStreams", icon: Film },
  { id: "audioStreams", labelKey: "fileDetail.audioStreams", icon: AudioLines },
  { id: "subtitles", labelKey: "fileDetail.subtitles", icon: Captions },
  { id: "cover", labelKey: "fileDetail.cover", icon: ImageIcon },
  { id: "chapters", labelKey: "fileDetail.chapters", icon: ListVideo },
  { id: "fileHistory", labelKey: "fileDetail.history.title", icon: FileClock },
  { id: "rawJson", labelKey: "fileDetail.rawJson", icon: FileJson },
];

function isFileDetailPanelId(value: string | null): value is FileDetailPanelId {
  return FILE_DETAIL_NAV_ITEMS.some((item) => item.id === value);
}

function readStoredFileDetailPanelId(): FileDetailPanelId {
  if (typeof window === "undefined") {
    return DEFAULT_FILE_DETAIL_PANEL_ID;
  }
  const value = window.localStorage.getItem(FILE_DETAIL_ACTIVE_PANEL_STORAGE_KEY);
  return isFileDetailPanelId(value) ? value : DEFAULT_FILE_DETAIL_PANEL_ID;
}

function readStoredFileDetailNavCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(FILE_DETAIL_NAV_COLLAPSED_STORAGE_KEY) === "true";
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

function formatChapterTime(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : formatDuration(value);
}

function ChaptersList({
  detail,
  t,
}: {
  detail: MediaFileDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  if (!detail) {
    return t("streamDetails.unavailable");
  }
  const chapters = detail.chapters ?? [];
  if (!chapters.length) {
    return t("streamDetails.none");
  }
  const normalizedQuery = query.trim().toLowerCase();
  const filteredChapters = normalizedQuery
    ? chapters.filter((chapter) => (chapter.title ?? "").toLowerCase().includes(normalizedQuery))
    : chapters;
  const visibleChapters = showAll ? filteredChapters : filteredChapters.slice(0, 50);

  async function handleExport() {
    if (!detail) {
      return;
    }
    const payload = await api.downloadFileChaptersCsv(detail.id);
    const objectUrl = window.URL.createObjectURL(payload.blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = payload.filename ?? `${detail.filename}-chapters.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="stream-tooltip-content stream-tooltip-content-panel">
      <div className="stream-tooltip-summary">
        <strong>{t("fileDetail.chapters")}</strong>
        <span>{chapters.length}</span>
      </div>
      <div className="file-detail-chapter-tools">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setShowAll(false);
          }}
          placeholder={t("fileDetail.chapterSearchPlaceholder")}
          aria-label={t("fileDetail.chapterSearch")}
        />
        <button type="button" className="secondary-button" onClick={() => void handleExport()}>
          {t("fileDetail.exportChapters")}
        </button>
      </div>
      {visibleChapters.map((chapter, index) => (
        <div className="stream-tooltip-row" key={`${chapter.chapter_index}-${chapter.start_time ?? index}`}>
          <div className="stream-tooltip-head">
            <div className="stream-tooltip-inline">
              <strong>{chapter.title?.trim() || t("fileDetail.untitledChapter", { number: index + 1 })}</strong>
              <div className="stream-tooltip-meta">
                <span className="stream-tooltip-pill">{formatChapterTime(chapter.start_time)}</span>
                {chapter.end_time !== null && chapter.end_time !== undefined ? (
                  <span className="stream-tooltip-pill">{formatChapterTime(chapter.end_time)}</span>
                ) : null}
                {chapter.duration !== null && chapter.duration !== undefined ? (
                  <span className="stream-tooltip-pill">{formatChapterTime(chapter.duration)}</span>
                ) : null}
              </div>
            </div>
            <span>#{index + 1}</span>
          </div>
        </div>
      ))}
      {filteredChapters.length > visibleChapters.length ? (
        <button type="button" className="secondary-button" onClick={() => setShowAll(true)}>
          {t("fileDetail.showAllChapters", { count: filteredChapters.length })}
        </button>
      ) : null}
      {showAll && filteredChapters.length > 50 ? (
        <button type="button" className="secondary-button" onClick={() => setShowAll(false)}>
          {t("fileDetail.showFewerChapters")}
        </button>
      ) : null}
    </div>
  );
}

function CoverDetailsList({
  detail,
  t,
}: {
  detail: MediaFileDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactNode {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverFilename, setCoverFilename] = useState<string | null>(null);
  const [isCoverLoading, setIsCoverLoading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  useEffect(() => {
    setCoverBlob(null);
    setCoverFilename(null);
    setCoverError(null);
    setCoverUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, [detail?.id]);

  useEffect(() => {
    return () => {
      if (coverUrl) {
        URL.revokeObjectURL(coverUrl);
      }
    };
  }, [coverUrl]);

  if (!detail) {
    return t("streamDetails.unavailable");
  }
  if (!detail.has_embedded_cover) {
    return t("streamDetails.none");
  }
  const dimensions =
    detail.embedded_cover_width && detail.embedded_cover_height
      ? `${detail.embedded_cover_width}x${detail.embedded_cover_height}`
      : "n/a";
  const rows = [
    { key: "codec", label: t("fileDetail.coverCodec"), value: detail.embedded_cover_codec ?? "n/a" },
    { key: "dimensions", label: t("fileDetail.coverDimensions"), value: dimensions },
    {
      key: "stream",
      label: t("fileDetail.coverStream"),
      value: detail.embedded_cover_stream_index !== null && detail.embedded_cover_stream_index !== undefined
        ? String(detail.embedded_cover_stream_index)
        : "n/a",
    },
  ];
  const fallbackCoverFilename = `${detail.filename.replace(/\.[^.]+$/, "") || "cover"}-cover.png`;

  async function loadCover() {
    if (!detail) {
      return;
    }
    setIsCoverLoading(true);
    setCoverError(null);
    try {
      const payload = await api.downloadFileCover(detail.id);
      const objectUrl = URL.createObjectURL(payload.blob);
      setCoverUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return objectUrl;
      });
      setCoverBlob(payload.blob);
      setCoverFilename(payload.filename ?? fallbackCoverFilename);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : t("fileDetail.coverLoadError"));
    } finally {
      setIsCoverLoading(false);
    }
  }

  function downloadCover() {
    if (!coverBlob || !coverUrl) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = coverUrl;
    anchor.download = coverFilename ?? fallbackCoverFilename;
    anchor.click();
  }

  return (
    <div className="stream-tooltip-content stream-tooltip-content-panel file-detail-cover-panel">
      <div className="file-detail-cover-actions">
        <button type="button" className="secondary small file-detail-cover-button" onClick={() => void loadCover()} disabled={isCoverLoading}>
          <ImageIcon size={16} aria-hidden="true" />
          {isCoverLoading ? t("fileDetail.coverLoading") : t("fileDetail.loadCover")}
        </button>
        {coverUrl ? (
          <button type="button" className="secondary small file-detail-cover-button" onClick={downloadCover}>
            <Download size={16} aria-hidden="true" />
            {t("fileDetail.downloadCover")}
          </button>
        ) : null}
      </div>
      {coverError ? <div className="notice compact file-detail-cover-error">{coverError}</div> : null}
      {coverUrl ? (
        <figure className="file-detail-cover-preview">
          <img src={coverUrl} alt={t("fileDetail.coverPreviewAlt", { filename: detail.filename })} />
        </figure>
      ) : null}
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

function nonEmptyText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function hasAnyValue(values: Array<string | number | boolean | null | undefined>): boolean {
  return values.some((value) => {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return value !== null && value !== undefined;
  });
}

function hasVideoMetadata(file: MediaFileDetail | null): boolean {
  if (!file) {
    return false;
  }
  return file.video_streams.length > 0 || hasAnyValue([file.video_codec, file.resolution, file.hdr_type]);
}

function hasAudioMetadata(file: MediaFileDetail | null): boolean {
  if (!file) {
    return false;
  }
  return (
    file.audio_streams.length > 0 ||
    file.audio_codecs.length > 0 ||
    file.audio_languages.length > 0 ||
    hasAnyValue([
      file.audio_title,
      file.audio_artist,
      file.audio_album,
      file.audio_album_artist,
      file.audio_genre,
      file.audio_date,
      file.audio_disc,
      file.audio_composer,
      file.audio_channels,
      file.sample_rate,
      file.track_number,
      file.bit_rate_mode,
      file.audiobook_narrator,
      file.audiobook_author,
      file.audiobook_publisher,
      file.audiobook_series,
      file.audiobook_series_part,
      file.audiobook_description,
      file.audiobook_copyright,
      file.audiobook_asin,
      file.audiobook_isbn,
      file.audiobook_language,
      file.audiobook_abridged,
    ])
  );
}

function hasSubtitleMetadata(file: MediaFileDetail | null): boolean {
  return Boolean(file && (file.subtitle_streams.length > 0 || file.external_subtitles.length > 0));
}

function hasCoverMetadata(file: MediaFileDetail | null): boolean {
  return Boolean(
    file &&
      (file.has_embedded_cover ||
        hasAnyValue([file.embedded_cover_codec, file.embedded_cover_width, file.embedded_cover_height])),
  );
}

function hasQualityMetadata(file: MediaFileDetail | null, qualityDetail: MediaFileQualityScoreDetail | null): boolean {
  return Boolean(qualityDetail || (file && Number.isFinite(file.quality_score)));
}

function buildAvailableFileDetailPanelIds(
  file: MediaFileDetail | null,
  qualityDetail: MediaFileQualityScoreDetail | null,
): FileDetailPanelId[] {
  const ids: FileDetailPanelId[] = ["overview", "format"];
  if (hasQualityMetadata(file, qualityDetail)) {
    ids.push("qualityBreakdown");
  }
  if (hasVideoMetadata(file)) {
    ids.push("videoStreams");
  }
  if (hasAudioMetadata(file)) {
    ids.push("audioStreams");
  }
  if (hasSubtitleMetadata(file)) {
    ids.push("subtitles");
  }
  if (hasCoverMetadata(file)) {
    ids.push("cover");
  }
  if ((file?.chapters ?? []).length > 0) {
    ids.push("chapters");
  }
  ids.push("fileHistory", "rawJson");
  return ids;
}

function normalizeFileDetailPanelId(
  candidate: FileDetailPanelId,
  availablePanelIds: FileDetailPanelId[],
): FileDetailPanelId {
  return availablePanelIds.includes(candidate) ? candidate : DEFAULT_FILE_DETAIL_PANEL_ID;
}

function OverviewPanel({
  file,
  t,
  inDepthDolbyVisionProfiles = false,
}: {
  file: MediaFileDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  inDepthDolbyVisionProfiles?: boolean;
}): ReactNode {
  if (!file) {
    return t("streamDetails.unavailable");
  }

  const rows = [
    { key: "relativePath", label: t("fileDetail.relativePath"), value: file.relative_path },
    { key: "container", label: t("fileDetail.containerLabel"), value: formatContainerLabel(file.container ?? file.extension) },
    { key: "size", label: t("fileDetail.size"), value: formatBytes(file.size_bytes) },
    { key: "duration", label: t("fileDetail.duration"), value: formatDuration(file.duration ?? 0) },
    { key: "quality", label: t("fileDetail.quality"), value: `${file.quality_score}/10` },
  ];

  const badges = [
    hasVideoMetadata(file) && file.video_codec ? formatCodecLabel(file.video_codec, "video") : null,
    hasVideoMetadata(file) ? file.resolution_category_label ?? file.resolution ?? null : null,
    hasVideoMetadata(file) ? formatHdrType(file.hdr_type, { inDepthDolbyVisionProfiles }) ?? t("fileTable.sdr") : null,
    hasAudioMetadata(file) && file.audio_codecs.length > 0
      ? file.audio_codecs.map((codec) => formatCodecLabel(codec, "audio")).join(", ")
      : null,
    file.content_category === "bonus" ? t("fileDetail.bonusContent") : null,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <div className="file-detail-overview">
      <div className="file-detail-title-row">
        <h3 className="file-detail-title">{file.filename}</h3>
        {file.relative_path ? (
          <TooltipTrigger ariaLabel={t("fileDetail.showFullRelativePath")} content={file.relative_path}>
            ?
          </TooltipTrigger>
        ) : null}
      </div>
      {badges.length > 0 ? (
        <div className="meta-tags">
          {badges.map((badge) => (
            <span className="badge" key={badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      <div className="stream-tooltip-content stream-tooltip-content-panel format-details-content">
        {rows.map((row) => (
          <div className="stream-tooltip-row" key={row.key}>
            <div className="stream-tooltip-head format-details-row">
              <span className="format-details-label">{row.label}</span>
              <strong className="format-details-value">{row.value}</strong>
            </div>
          </div>
        ))}
      </div>
      {file.analysis_failure_reason ? (
        <div className="notice file-detail-analysis-warning">
          <strong>{t("fileDetail.analysisFailure")}</strong>
          <span>{file.analysis_failure_reason}</span>
        </div>
      ) : null}
    </div>
  );
}

function AudioMetadataList({
  detail,
  t,
}: {
  detail: MediaFileDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactNode {
  if (!detail) {
    return null;
  }

  const rows = [
    { key: "title", label: t("fileTable.audioTitle"), value: nonEmptyText(detail.audio_title) },
    { key: "artist", label: t("fileTable.audioArtist"), value: nonEmptyText(detail.audio_artist) },
    { key: "album", label: t("fileTable.audioAlbum"), value: nonEmptyText(detail.audio_album) },
    { key: "albumArtist", label: t("fileTable.audioAlbumArtist"), value: nonEmptyText(detail.audio_album_artist) },
    { key: "genre", label: t("fileTable.audioGenre"), value: nonEmptyText(detail.audio_genre) },
    { key: "date", label: t("fileTable.audioDate"), value: nonEmptyText(detail.audio_date) },
    { key: "disc", label: t("fileTable.audioDisc"), value: nonEmptyText(detail.audio_disc) },
    { key: "composer", label: t("fileTable.audioComposer"), value: nonEmptyText(detail.audio_composer) },
    { key: "channels", label: t("fileTable.audioChannels"), value: detail.audio_channels ? String(detail.audio_channels) : null },
    { key: "sampleRate", label: t("fileTable.sampleRate"), value: detail.sample_rate ? `${detail.sample_rate} Hz` : null },
    { key: "trackNumber", label: t("fileTable.trackNumber"), value: nonEmptyText(detail.track_number) },
    { key: "bitRateMode", label: t("fileTable.bitRateMode"), value: nonEmptyText(detail.bit_rate_mode) },
    { key: "narrator", label: t("fileTable.audiobookNarrator"), value: nonEmptyText(detail.audiobook_narrator) },
    { key: "author", label: t("fileTable.audiobookAuthor"), value: nonEmptyText(detail.audiobook_author) },
    { key: "publisher", label: t("fileTable.audiobookPublisher"), value: nonEmptyText(detail.audiobook_publisher) },
    { key: "series", label: t("fileTable.audiobookSeries"), value: nonEmptyText(detail.audiobook_series) },
    { key: "seriesPart", label: t("fileTable.audiobookSeriesPart"), value: nonEmptyText(detail.audiobook_series_part) },
    { key: "description", label: t("fileTable.audiobookDescription"), value: nonEmptyText(detail.audiobook_description) },
    { key: "copyright", label: t("fileTable.audiobookCopyright"), value: nonEmptyText(detail.audiobook_copyright) },
    { key: "language", label: t("fileTable.audiobookLanguage"), value: nonEmptyText(detail.audiobook_language) },
    { key: "abridged", label: t("fileTable.audiobookAbridged"), value: nonEmptyText(detail.audiobook_abridged) },
    { key: "asin", label: t("fileTable.audiobookAsin"), value: nonEmptyText(detail.audiobook_asin) },
    { key: "isbn", label: t("fileTable.audiobookIsbn"), value: nonEmptyText(detail.audiobook_isbn) },
  ].filter((row): row is { key: string; label: string; value: string } => Boolean(row.value));

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="stream-tooltip-content stream-tooltip-content-panel format-details-content file-detail-audio-metadata">
      <div className="stream-tooltip-summary">
        <strong>{t("fileDetail.audioMetadata")}</strong>
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

function snapshotNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function snapshotList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function formatHistoryList(value: unknown, fallback: string): string {
  const entries = snapshotList(value);
  return entries.length > 0 ? entries.join(", ") : fallback;
}

type FileHistoryEntry = MediaFileHistory["items"][number];
type FileHistoryState = {
  entry: FileHistoryEntry;
  startedAt: string;
  endedAt: string | null;
};
type FileHistoryMetric = {
  key: string;
  label: string;
  value: string;
  previousValue: string | null;
  changed: boolean;
};

const HISTORY_VOLATILE_FIELD_KEYS = new Set([
  "id",
  "library_id",
  "filename",
  "last_seen_at",
  "last_analyzed_at",
  "raw_ffprobe_json",
  "quality_score_breakdown",
]);

const HISTORY_STATE_FIELD_KEYS = new Set([
  "relative_path",
  "extension",
  "size_bytes",
  "mtime",
  "scan_status",
  "quality_score",
  "quality_score_raw",
  "analysis_failure_kind",
  "analysis_failure_reason",
  "analysis_failure_detail",
]);

const HISTORY_STATE_FIELD_PREFIXES = ["external_subtitles."];

const HISTORY_FIELD_LABELS: Record<string, string> = {
  relative_path: "Path",
  extension: "Container",
  size_bytes: "Size",
  mtime: "Modified",
  scan_status: "Analysis status",
  quality_score: "Quality",
  quality_score_raw: "Raw quality",
  container: "Container",
  duration: "Duration",
  bitrate: "Bitrate",
  audio_bitrate: "Audio bitrate",
  video_codec: "Video codec",
  resolution: "Resolution",
  resolution_category_id: "Resolution category ID",
  resolution_category_label: "Resolution category",
  hdr_type: "Dynamic range",
  audio_codecs: "Audio codecs",
  audio_spatial_profiles: "Spatial audio",
  audio_languages: "Audio languages",
  subtitle_languages: "Subtitle languages",
  subtitle_codecs: "Subtitle codecs",
  subtitle_sources: "Subtitle sources",
  "media_format.container_format": "Format name",
  "media_format.duration": "Format duration",
  "media_format.bit_rate": "Format bitrate",
  "media_format.probe_score": "Probe score",
  "external_subtitles.path": "External subtitle path",
  "external_subtitles.language": "External subtitle language",
  "external_subtitles.format": "External subtitle format",
};

function stableHistoryValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
      .filter((entry) => entry !== "")
      .sort();
  }
  return value ?? null;
}

function flattenHistorySnapshot(value: unknown, prefix = ""): Record<string, unknown> {
  if (prefix && HISTORY_VOLATILE_FIELD_KEYS.has(prefix)) {
    return {};
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry !== "object" || entry === null)) {
      return { [prefix]: stableHistoryValue(value) };
    }
    return value.reduce<Record<string, unknown>>(
      (flattened, entry, index) => ({
        ...flattened,
        ...flattenHistorySnapshot(entry, `${prefix}.${index}`),
      }),
      {},
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (flattened, [key, entry]) => {
        if (HISTORY_VOLATILE_FIELD_KEYS.has(key)) {
          return flattened;
        }
        return {
          ...flattened,
          ...flattenHistorySnapshot(entry, prefix ? `${prefix}.${key}` : key),
        };
      },
      {},
    );
  }
  return prefix ? { [prefix]: stableHistoryValue(value) } : {};
}

function historyStateKey(snapshot: FileHistoryEntry["snapshot"]): string {
  const flattened = flattenHistorySnapshot(snapshot);
  return JSON.stringify(
    Object.keys(flattened)
      .filter(isHistoryStateFieldKey)
      .sort()
      .map((key) => [key, stableHistoryValue(flattened[key])]),
  );
}

function isHistoryStateFieldKey(key: string): boolean {
  const arraylessKey = key.replace(/\.\d+\./g, ".");
  return (
    HISTORY_STATE_FIELD_KEYS.has(key) ||
    HISTORY_STATE_FIELD_KEYS.has(arraylessKey) ||
    HISTORY_STATE_FIELD_PREFIXES.some(
      (prefix) => key.startsWith(prefix) || arraylessKey.startsWith(prefix),
    )
  );
}

function collapseHistoryStates(items: FileHistoryEntry[]): FileHistoryState[] {
  const grouped: Array<{ entries: FileHistoryEntry[] }> = [];

  for (const item of items) {
    const currentGroup = grouped.at(-1);
    if (currentGroup && historyStateKey(currentGroup.entries[0].snapshot) === historyStateKey(item.snapshot)) {
      currentGroup.entries.push(item);
      continue;
    }
    grouped.push({ entries: [item] });
  }

  return grouped.map((group, index) => {
    const oldestEntry = group.entries.at(-1) ?? group.entries[0];
    const newerGroup = grouped[index - 1];
    const newerOldestEntry = newerGroup?.entries.at(-1) ?? newerGroup?.entries[0] ?? null;
    return {
      entry: group.entries[0],
      startedAt: oldestEntry.captured_at,
      endedAt: newerOldestEntry?.captured_at ?? null,
    };
  });
}

function formatHistoryRange(
  state: FileHistoryState,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!state.endedAt) {
    return t("fileDetail.history.since", { start: formatDate(state.startedAt) });
  }
  return t("fileDetail.history.range", {
    start: formatDate(state.startedAt),
    end: formatDate(state.endedAt),
  });
}

function formatHistoryFieldLabel(key: string): string {
  if (HISTORY_FIELD_LABELS[key]) {
    return HISTORY_FIELD_LABELS[key];
  }
  const arraylessKey = key.replace(/\.\d+\./g, ".");
  if (HISTORY_FIELD_LABELS[arraylessKey]) {
    return HISTORY_FIELD_LABELS[arraylessKey];
  }
  return key
    .replace(/\.(\d+)\./g, " #$1 ")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatHistoryFieldValue(
  key: string,
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
  inDepthDolbyVisionProfiles = false,
): string {
  if (value === null || value === undefined || value === "") {
    return t("fileTable.na");
  }
  if (key.endsWith("size_bytes")) {
    return formatBytes(snapshotNumber(value) ?? 0);
  }
  if (key === "duration" || key.endsWith(".duration")) {
    return formatDuration(snapshotNumber(value));
  }
  if (key === "bitrate" || key === "audio_bitrate" || key.endsWith(".bit_rate")) {
    return formatBitRate(snapshotNumber(value));
  }
  if (key === "quality_score") {
    return snapshotNumber(value) === null ? t("fileTable.na") : t("fileDetail.history.qualityValue", { value });
  }
  if (key === "mtime" && typeof value === "number") {
    return formatDate(new Date(value * 1000).toISOString());
  }
  if (key === "video_codec" && typeof value === "string") {
    return formatCodecLabel(value, "video");
  }
  if (key.endsWith("hdr_type") && typeof value === "string") {
    return formatHdrType(value, { inDepthDolbyVisionProfiles }) ?? value;
  }
  if (Array.isArray(value)) {
    return formatHistoryList(value, t("fileTable.na"));
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

function buildHistoryDiffMetrics(
  snapshot: FileHistoryEntry["snapshot"],
  previousSnapshot: FileHistoryEntry["snapshot"] | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  inDepthDolbyVisionProfiles = false,
): FileHistoryMetric[] {
  if (!previousSnapshot) {
    return [];
  }
  const current = flattenHistorySnapshot(snapshot);
  const previous = flattenHistorySnapshot(previousSnapshot);
  const keys = [...new Set([...Object.keys(current), ...Object.keys(previous)])]
    .filter(isHistoryStateFieldKey)
    .sort();

  return keys.reduce<FileHistoryMetric[]>((metrics, key) => {
    if (JSON.stringify(stableHistoryValue(current[key])) === JSON.stringify(stableHistoryValue(previous[key]))) {
      return metrics;
    }
    const value = formatHistoryFieldValue(key, current[key], t, inDepthDolbyVisionProfiles);
    const previousValue = formatHistoryFieldValue(key, previous[key], t, inDepthDolbyVisionProfiles);
    if (key.endsWith("hdr_type") && value === previousValue) {
      return metrics;
    }
    metrics.push({
      key,
      label: formatHistoryFieldLabel(key),
      value,
      previousValue,
      changed: true,
    });
    return metrics;
  }, []);
}

function FileHistoryPanel({
  history,
  t,
  inDepthDolbyVisionProfiles = false,
}: {
  history: MediaFileHistory | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  inDepthDolbyVisionProfiles?: boolean;
}): ReactNode {
  const items = history?.items ?? [];
  if (items.length === 0) {
    return <div className="notice">{t("fileDetail.history.empty")}</div>;
  }

  const states = collapseHistoryStates(items);

  return (
    <div className="file-history-list">
      {history && history.total > items.length ? (
        <div className="notice">
          {t("fileDetail.history.limited", {
            shown: items.length,
            total: history.total,
          })}
        </div>
      ) : null}
      {states.map((state, index) => {
        const entry = state.entry;
        const snapshot = entry.snapshot;
        const previousSnapshot = states[index + 1]?.entry.snapshot;
        const metrics = buildHistoryDiffMetrics(snapshot, previousSnapshot, t, inDepthDolbyVisionProfiles);

        return (
          <details className="file-history-entry" key={entry.id} open={index === 0}>
            <summary className="file-history-entry-head">
              <strong>{formatHistoryRange(state, t)}</strong>
            </summary>
            {metrics.length > 0 ? (
              <dl className="file-history-metrics">
                {metrics.map((metric) => (
                  <div className="file-history-metric has-changed" key={metric.key}>
                    <dt>{metric.label}</dt>
                    <dd>
                      {metric.previousValue !== null ? (
                        <span className="file-history-old-value">{metric.previousValue}</span>
                      ) : null}
                      <strong>{metric.value}</strong>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="notice">{t("fileDetail.history.noChanges")}</div>
            )}
          </details>
        );
      })}
    </div>
  );
}

export function FileDetailPage() {
  const { t } = useTranslation();
  const { fileId = "" } = useParams();
  const { appSettings } = useAppData();
  const inDepthDolbyVisionProfiles = appSettings.feature_flags.in_depth_dolby_vision_profiles;
  const [file, setFile] = useState<MediaFileDetail | null>(null);
  const [qualityDetail, setQualityDetail] = useState<MediaFileQualityScoreDetail | null>(null);
  const [qualityError, setQualityError] = useState(false);
  const [fileHistory, setFileHistory] = useState<MediaFileHistory | null>(null);
  const [fileHistoryError, setFileHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanelId, setActivePanelId] = useState<FileDetailPanelId>(() => readStoredFileDetailPanelId());
  const [isNavCollapsed, setIsNavCollapsed] = useState(() => readStoredFileDetailNavCollapsed());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    api
      .file(fileId)
      .then((payload) => {
        setFile(payload);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
    setQualityDetail(null);
    setQualityError(false);
    api
      .fileQualityScore(fileId)
      .then((payload) => {
        setQualityDetail(payload);
        setQualityError(false);
      })
      .catch(() => {
        setQualityDetail(null);
        setQualityError(true);
      });
    api
      .fileHistory(fileId)
      .then((payload) => {
        setFileHistory(payload);
        setFileHistoryError(null);
      })
      .catch((reason: Error) => setFileHistoryError(reason.message));
  }, [fileId]);

  const panels: Record<
    FileDetailPanelId,
    {
      title: string;
      loading: boolean;
      error: string | null;
      body: ReactNode;
    }
  > = {
    overview: {
      title: t("fileDetail.navigation.overview"),
      loading: !file && !error,
      error,
      body: <OverviewPanel file={file} t={t} inDepthDolbyVisionProfiles={inDepthDolbyVisionProfiles} />,
    },
    qualityBreakdown: {
      title: t("fileDetail.qualityBreakdown"),
      loading: !qualityDetail && !qualityError && !error,
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
      ) : (
        <div className="notice">{t("quality.unavailable")}</div>
      ),
    },
    format: {
      title: t("fileDetail.format"),
      loading: !file && !error,
      error,
      body: <FormatDetailsList detail={file} t={t} />,
    },
    cover: {
      title: t("fileDetail.cover"),
      loading: !file && !error,
      error,
      body: <CoverDetailsList detail={file} t={t} />,
    },
    fileHistory: {
      title: t("fileDetail.history.title"),
      loading: !fileHistory && !fileHistoryError,
      error: fileHistoryError,
      body: (
        <FileHistoryPanel
          history={fileHistory}
          t={t}
          inDepthDolbyVisionProfiles={inDepthDolbyVisionProfiles}
        />
      ),
    },
    videoStreams: {
      title: t("fileDetail.videoStreams"),
      loading: !file && !error,
      error,
      body: (
        <StreamDetailsList
          kind="video"
          detail={file ?? undefined}
          t={t}
          surface="panel"
          showSummary={false}
          inDepthDolbyVisionProfiles={inDepthDolbyVisionProfiles}
        />
      ),
    },
    audioStreams: {
      title: t("fileDetail.audioStreams"),
      loading: !file && !error,
      error,
      body: (
        <div className="file-detail-audio-panel">
          <AudioMetadataList detail={file} t={t} />
          <StreamDetailsList kind="audio" detail={file ?? undefined} t={t} surface="panel" showSummary={false} />
        </div>
      ),
    },
    chapters: {
      title: t("fileDetail.chapters"),
      loading: !file && !error,
      error,
      body: <ChaptersList detail={file} t={t} />,
    },
    subtitles: {
      title: t("fileDetail.subtitles"),
      loading: !file && !error,
      error,
      body: <StreamDetailsList kind="subtitle" detail={file ?? undefined} t={t} surface="panel" showSummary={false} />,
    },
    rawJson: {
      title: t("fileDetail.rawJson"),
      loading: !file && !error,
      error,
      body: <JsonPreview value={file?.raw_ffprobe_json ?? {}} />,
    },
  };

  const availablePanelIds = useMemo(
    () => buildAvailableFileDetailPanelIds(file, qualityDetail),
    [file, qualityDetail],
  );
  const navItems = FILE_DETAIL_NAV_ITEMS.filter((item) => availablePanelIds.includes(item.id));
  const normalizedActivePanelId = normalizeFileDetailPanelId(activePanelId, availablePanelIds);
  const activePanel = panels[normalizedActivePanelId];
  const activeNavItem = navItems.find((item) => item.id === normalizedActivePanelId) ?? navItems[0];
  const ActiveNavIcon = activeNavItem.icon;

  useEffect(() => {
    if (!file && !error) {
      return;
    }
    const normalized = normalizeFileDetailPanelId(activePanelId, availablePanelIds);
    if (normalized !== activePanelId) {
      setActivePanelId(normalized);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(FILE_DETAIL_ACTIVE_PANEL_STORAGE_KEY, normalized);
      }
    }
  }, [activePanelId, availablePanelIds, error, file]);

  const selectPanel = useCallback((panelId: FileDetailPanelId) => {
    setActivePanelId(panelId);
    setIsMobileMenuOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FILE_DETAIL_ACTIVE_PANEL_STORAGE_KEY, panelId);
    }
  }, []);

  const toggleNavCollapsed = useCallback(() => {
    setIsNavCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(FILE_DETAIL_NAV_COLLAPSED_STORAGE_KEY, next ? "true" : "false");
      }
      return next;
    });
  }, []);

  function renderNavItem(item: FileDetailNavItem, mobile = false): ReactNode {
    const Icon = item.icon;
    const label = t(item.labelKey);
    const active = normalizedActivePanelId === item.id;
    return (
      <button
        type="button"
        key={item.id}
        className={`settings-navigation-item${mobile ? " settings-mobile-navigation-item" : ""}${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        title={!mobile && isNavCollapsed ? label : undefined}
        data-file-detail-panel-id={item.id}
        data-toggle-key={item.id}
        tabIndex={mobile && !isMobileMenuOpen ? -1 : undefined}
        onClick={() => selectPanel(item.id)}
      >
        {active ? <SlidingTogglePill activeKey={item.id} className="nav-active-pill" /> : null}
        <span className="settings-navigation-item-content">
          <Icon aria-hidden="true" className="nav-icon" />
          {mobile || !isNavCollapsed ? <span>{label}</span> : null}
        </span>
      </button>
    );
  }

  return (
    <div className={`settings-layout file-detail-layout${isNavCollapsed ? " is-settings-nav-collapsed" : ""}`}>
      <aside className="settings-navigation-panel file-detail-navigation-panel" aria-label={t("fileDetail.navigation.label")}>
        <button
          type="button"
          className="settings-mobile-menu-button"
          aria-label={
            isMobileMenuOpen
              ? t("fileDetail.navigation.closeMobile")
              : t("fileDetail.navigation.openMobile")
          }
          aria-expanded={isMobileMenuOpen}
          aria-controls="file-detail-mobile-navigation-menu"
          onClick={() => setIsMobileMenuOpen((current) => !current)}
        >
          <span className="settings-mobile-menu-button-content">
            <span className="settings-mobile-menu-current">
              <ActiveNavIcon aria-hidden="true" className="nav-icon" />
              <span>{t(activeNavItem.labelKey)}</span>
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`settings-mobile-menu-chevron${isMobileMenuOpen ? " is-open" : ""}`}
          />
        </button>
        <div
          id="file-detail-mobile-navigation-menu"
          className={`settings-mobile-navigation-menu${isMobileMenuOpen ? " is-open" : ""}`}
          aria-hidden={!isMobileMenuOpen}
        >
          <nav className="settings-mobile-navigation-list" aria-label={t("fileDetail.navigation.mobileLabel")}>
            {navItems.map((item) => renderNavItem(item, true))}
          </nav>
        </div>
        <div className="settings-navigation-header">
          {!isNavCollapsed ? <span>{t("fileDetail.navigation.title")}</span> : null}
          <button
            type="button"
            className="secondary icon-only-button settings-navigation-collapse-button"
            aria-label={
              isNavCollapsed
                ? t("fileDetail.navigation.expand")
                : t("fileDetail.navigation.collapse")
            }
            title={
              isNavCollapsed
                ? t("fileDetail.navigation.expand")
                : t("fileDetail.navigation.collapse")
            }
            aria-expanded={!isNavCollapsed}
            onClick={toggleNavCollapsed}
          >
            <PanelLeftToggleIcon
              aria-hidden="true"
              collapsed={isNavCollapsed}
              className="settings-navigation-toggle-icon"
              size={24}
            />
          </button>
        </div>
        <nav className="settings-navigation-list">
          {navItems.map((item) => renderNavItem(item))}
        </nav>
      </aside>

      <div className="settings-main-column file-detail-main-column">
        <AsyncPanel
          title={activePanel.title}
          loading={activePanel.loading}
          error={activePanel.error}
          className="file-detail-active-panel"
        >
          {activePanel.body}
        </AsyncPanel>
      </div>
    </div>
  );
}

import {
  AudioLines,
  ArrowLeft,
  Captions,
  ChevronDown,
  Cpu,
  FileClock,
  FileJson,
  Film,
  Gauge,
  ImageIcon,
  Info,
  ListVideo,
  Play,
  Search,
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
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { ArrowUpRightIcon, type ArrowUpRightIconHandle } from "../components/ArrowUpRightIcon";
import { AudioStreamPrimaryToggle, type AudioStreamPrimaryMode } from "../components/AudioStreamPrimaryToggle";
import { CopyIcon } from "../components/CopyIcon";
import { DownloadIcon, type DownloadIconHandle } from "../components/DownloadIcon";
import { DuplicatePanelEmptyState } from "../components/DuplicatePanelEmptyState";
import { LoaderCircleIcon } from "../components/LoaderCircleIcon";
import { PanelLeftToggleIcon } from "../components/PanelLeftToggleIcon";
import { ProfileFavoriteButton } from "../components/ProfileFavoriteButton";
import { SlidingTogglePill } from "../components/SlidingTogglePill";
import { StreamDetailsList } from "../components/StreamDetailsList";
import { TooltipTrigger } from "../components/TooltipTrigger";
import {
  api,
  type CompatibilityEvaluation,
  type CompatibilityProfile,
  type CompatibilityStatus,
  type HardwareProfile,
  type MediaFileDetail,
  type MediaFileHistory,
  type MediaFileQualityScoreDetail,
  type ProfileEvaluation,
  type QualityCategoryBreakdown,
  type SoftwareProfile,
} from "../lib/api";
import { useAppData } from "../lib/app-data";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDate, formatDuration } from "../lib/format";
import { formatHdrType } from "../lib/hdr";
import {
  favoriteProfileKey,
  readFavoriteProfileKeys,
  writeFavoriteProfileKeys,
  type CompatibilityProfileType,
} from "../lib/profile-favorites";
import { formatVisualDensityGbPerHour } from "../lib/quality-format";
import { saveActiveSettingsPanel } from "../lib/settings-panel-state";

function JsonPreview({ value }: { value: unknown }) {
  return <pre className="json-preview">{JSON.stringify(value, null, 2)}</pre>;
}

type FileDetailPanelId =
  | "overview"
  | "preview"
  | "qualityBreakdown"
  | "compatibility"
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
const FILE_DETAIL_AUDIO_STREAM_PRIMARY_STORAGE_KEY = "medialyze-file-detail-audio-stream-primary";
const DEFAULT_FILE_DETAIL_PANEL_ID: FileDetailPanelId = "overview";
const DEFAULT_AUDIO_STREAM_PRIMARY_MODE: AudioStreamPrimaryMode = "quality";
const PREVIEW_REPORT_URL = "https://www.medialyze.app/report?source=file_detail_page";

const FILE_DETAIL_NAV_ITEMS: FileDetailNavItem[] = [
  { id: "overview", labelKey: "fileDetail.navigation.overview", icon: Info },
  { id: "preview", labelKey: "fileDetail.preview", icon: Play },
  { id: "qualityBreakdown", labelKey: "fileDetail.qualityBreakdown", icon: Gauge },
  { id: "compatibility", labelKey: "fileDetail.compatibility.title", icon: Cpu },
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
  if (isFileDetailPanelId(value)) {
    return value;
  }
  if (value !== null) {
    window.localStorage.setItem(FILE_DETAIL_ACTIVE_PANEL_STORAGE_KEY, DEFAULT_FILE_DETAIL_PANEL_ID);
  }
  return DEFAULT_FILE_DETAIL_PANEL_ID;
}

function readStoredFileDetailNavCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(FILE_DETAIL_NAV_COLLAPSED_STORAGE_KEY) === "true";
}

function isAudioStreamPrimaryMode(value: string | null): value is AudioStreamPrimaryMode {
  return value === "quality" || value === "language";
}

function readStoredAudioStreamPrimaryMode(): AudioStreamPrimaryMode {
  if (typeof window === "undefined") {
    return DEFAULT_AUDIO_STREAM_PRIMARY_MODE;
  }
  const value = window.localStorage.getItem(FILE_DETAIL_AUDIO_STREAM_PRIMARY_STORAGE_KEY);
  return isAudioStreamPrimaryMode(value) ? value : DEFAULT_AUDIO_STREAM_PRIMARY_MODE;
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

function formatQualityNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function formatQualityBreakdownValue(
  categoryKey: string,
  value: QualityCategoryBreakdown["actual"],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => (typeof entry === "number" ? formatQualityNumber(entry) : String(entry).trim()))
      .filter(Boolean);
    return entries.length > 0 ? entries.join(", ") : t("fileTable.na");
  }
  if (typeof value === "number") {
    if (categoryKey === "visual_density") {
      return t("quality.visualDensityGbPerHourValue", {
        value: formatVisualDensityGbPerHour(value),
      });
    }
    return formatQualityNumber(value);
  }
  if (typeof value === "string") {
    return value.trim() || t("fileTable.na");
  }
  return t("fileTable.na");
}

function formatQualityNote(note: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const translated = t(`quality.note.${note}`);
  if (translated !== `quality.note.${note}`) {
    return translated;
  }
  return note
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function QualityBreakdownCategoryList({
  qualityDetail,
  t,
}: {
  qualityDetail: MediaFileQualityScoreDetail;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactNode {
  return (
    <div className="quality-tooltip-content quality-detail-list">
      <div className="quality-tooltip-summary">
        <strong>{qualityDetail.score}/10</strong>
        <span>{t("quality.rawScore", { value: qualityDetail.score_raw.toFixed(2) })}</span>
      </div>
      {qualityDetail.breakdown.categories.map((category, index) => {
        const meta = [
          t("quality.weight", { value: category.weight }),
          !category.active ? t("quality.inactive") : null,
          category.skipped ? t("quality.skipped") : null,
          category.unknown_mapping ? t("quality.unknownMapping") : null,
        ].filter((entry): entry is string => Boolean(entry));
        const detailRows = [
          {
            key: "actual",
            label: t("quality.actualLabel"),
            value: formatQualityBreakdownValue(category.key, category.actual, t),
          },
          {
            key: "minimum",
            label: t("quality.minimumLabel"),
            value: formatQualityBreakdownValue(category.key, category.minimum, t),
          },
          {
            key: "ideal",
            label: t("quality.idealLabel"),
            value: formatQualityBreakdownValue(category.key, category.ideal, t),
          },
          category.maximum !== undefined
            ? {
                key: "maximum",
                label: t("quality.maximumLabel"),
                value: formatQualityBreakdownValue(category.key, category.maximum ?? null, t),
              }
            : null,
          category.notes.length > 0
            ? {
                key: "notes",
                label: t("quality.notes"),
                value: category.notes.map((note) => formatQualityNote(note, t)).join(", "),
              }
            : null,
          category.skipped
            ? {
                key: "skipped",
                label: t("quality.status"),
                value: t("quality.skipped"),
              }
            : null,
          category.unknown_mapping
            ? {
                key: "unknownMapping",
                label: t("quality.status"),
                value: t("quality.unknownMapping"),
              }
            : null,
        ].filter((row): row is { key: string; label: string; value: string } => Boolean(row));

        return (
          <details className="stream-detail-entry quality-detail-entry" key={category.key} open={index === 0}>
            <summary className="stream-detail-entry-head quality-detail-entry-head">
              <div className="stream-tooltip-inline">
                <strong>{t(`quality.category.${category.key}`)}</strong>
                {meta.length > 0 ? (
                  <div className="stream-tooltip-meta">
                    {meta.map((item) => (
                      <span className="stream-tooltip-pill" key={`${category.key}-${item}`}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <span>{formatQualityNumber(category.score)} / 100</span>
            </summary>
            <div className="stream-detail-entry-body">
              {detailRows.map((row) => (
                <div className="stream-detail-field" key={`${category.key}-${row.key}`}>
                  <span className="stream-detail-field-label">{row.label}</span>
                  <strong className="stream-detail-field-value">{row.value}</strong>
                </div>
              ))}
            </div>
          </details>
        );
      })}
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
  const downloadCoverIconRef = useRef<DownloadIconHandle>(null);

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
          {isCoverLoading ? (
            <LoaderCircleIcon size={16} aria-hidden="true" />
          ) : (
            <ImageIcon size={16} aria-hidden="true" />
          )}
          {isCoverLoading ? t("fileDetail.coverLoading") : t("fileDetail.loadCover")}
        </button>
        {coverUrl ? (
          <button
            type="button"
            className="secondary small file-detail-cover-button"
            onClick={downloadCover}
            onFocus={() => downloadCoverIconRef.current?.startAnimation()}
            onBlur={() => downloadCoverIconRef.current?.stopAnimation()}
            onMouseEnter={() => downloadCoverIconRef.current?.startAnimation()}
            onMouseLeave={() => downloadCoverIconRef.current?.stopAnimation()}
          >
            <DownloadIcon ref={downloadCoverIconRef} size={16} aria-hidden="true" />
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

function PreviewDetailsPanel({
  detail,
  t,
}: {
  detail: MediaFileDetail | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactNode {
  if (!detail) {
    return t("streamDetails.unavailable");
  }

  const isVideoPreview = hasVideoMetadata(detail);
  const previewUrl = api.fileMediaUrl(detail.id);

  return (
    <div className="file-detail-preview-panel">
      <div className="file-detail-preview-player-shell">
        {isVideoPreview ? (
          <video className="file-detail-preview-player" controls preload="metadata" src={previewUrl}>
            {t("fileDetail.previewUnsupported")}
          </video>
        ) : (
          <audio className="file-detail-preview-player file-detail-preview-player-audio" controls preload="metadata" src={previewUrl}>
            {t("fileDetail.previewUnsupported")}
          </audio>
        )}
      </div>
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
  const hasVideo = hasVideoMetadata(file);
  return (
    file.audio_streams.length > 0 ||
    file.audio_codecs.length > 0 ||
    file.audio_languages.length > 0 ||
    (!hasVideo &&
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
      ]))
  );
}

function hasSubtitleMetadata(file: MediaFileDetail | null): boolean {
  return Boolean(file && (file.subtitle_streams.length > 0 || file.external_subtitles.length > 0));
}

function hasPreviewMetadata(file: MediaFileDetail | null): boolean {
  return Boolean(file && (hasVideoMetadata(file) || hasAudioMetadata(file)));
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
  compatibilityCount = 0,
): FileDetailPanelId[] {
  const ids: FileDetailPanelId[] = ["overview"];
  if (hasPreviewMetadata(file)) {
    ids.push("preview");
  }
  if (hasQualityMetadata(file, qualityDetail)) {
    ids.push("qualityBreakdown");
  }
  if (compatibilityCount > 0) {
    ids.push("compatibility");
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

function bestCompatibilityStatus(results: Array<{ status: CompatibilityStatus }>): CompatibilityStatus | null {
  if (results.some((result) => result.status === "direct_play")) return "direct_play";
  if (results.some((result) => result.status === "direct_stream")) return "direct_stream";
  if (results.some((result) => result.status === "conditional")) return "conditional";
  if (results.some((result) => result.status === "video_transcode")) return "video_transcode";
  if (results.some((result) => result.status === "unsupported")) return "unsupported";
  return null;
}

type CompatibilityScope = "container" | "video" | "audio" | "subtitle";

function CompatibilityScopePills({
  result,
  scopes,
}: {
  result: Pick<
    CompatibilityEvaluation | ProfileEvaluation,
    "status" | "container_status" | "video_status" | "audio_status" | "subtitle_status"
  >;
  scopes: CompatibilityScope[];
}) {
  const { t } = useTranslation();
  return (
    <div className="stream-tooltip-meta">
      {scopes.map((scope) => {
        const status = result[`${scope}_status`] ?? result.status;
        return (
          <span className={`stream-tooltip-pill compatibility-scope-pill status-${status}`} key={scope}>
            {t(`fileDetail.compatibility.scopes.${scope}`)}:{" "}
            {t(`fileDetail.compatibility.status.${status}`)}
          </span>
        );
      })}
    </div>
  );
}

function CompatibilityFindings({
  result,
  scopes,
}: {
  result: Pick<CompatibilityEvaluation | ProfileEvaluation, "selected_audio_stream_index" | "findings">;
  scopes: CompatibilityScope[];
}) {
  const { t } = useTranslation();
  const visibleFindings = result.findings.filter((finding) => (
    finding.scope === "metadata"
    || finding.scope === "profile"
    || scopes.includes(finding.scope as CompatibilityScope)
  ));
  return (
    <>
      {scopes.includes("audio")
      && result.selected_audio_stream_index !== null
      && result.selected_audio_stream_index !== undefined ? (
        <p>{t("fileDetail.compatibility.selectedAudio", { index: result.selected_audio_stream_index })}</p>
      ) : null}
      {visibleFindings.length ? (
        <ul className="compatibility-finding-list">
          {visibleFindings.map((finding, index) => (
            <li className={`compatibility-finding severity-${finding.severity}`} key={`${finding.code}-${finding.stream_index ?? "file"}-${index}`}>
              <strong>{t(`fileDetail.compatibility.reasons.${finding.code}`, { defaultValue: finding.code })}</strong>
              <span>{finding.message}</span>
              {finding.stream_index !== null && finding.stream_index !== undefined ? (
                <code>{t("fileDetail.compatibility.stream", { index: finding.stream_index })}</code>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="notice">{t("fileDetail.compatibility.noFindings")}</div>
      )}
    </>
  );
}

function CompatibilityReport({
  result,
  context,
  scopes,
}: {
  result: CompatibilityEvaluation | ProfileEvaluation;
  context?: string;
  scopes: CompatibilityScope[];
}) {
  return (
    <div className={`compatibility-profile-report status-${result.status}`}>
      {context ? <p className="compatibility-profile-report-context">{context}</p> : null}
      <CompatibilityScopePills result={result} scopes={scopes} />
      <CompatibilityFindings result={result} scopes={scopes} />
    </div>
  );
}

function FavoriteCompatibilityResults({
  results,
  hardwareResults,
  softwareResults,
  hardware,
  software,
  combinations,
  favoriteKeys,
  onToggleFavorite,
  file,
}: {
  results: CompatibilityEvaluation[];
  hardwareResults: ProfileEvaluation[];
  softwareResults: ProfileEvaluation[];
  hardware: HardwareProfile[];
  software: SoftwareProfile[];
  combinations: CompatibilityProfile[];
  favoriteKeys: Set<string>;
  onToggleFavorite: (type: CompatibilityProfileType, id: string) => void;
  file: MediaFileDetail | null;
}) {
  const { t } = useTranslation();
  const [searchQueries, setSearchQueries] = useState<Record<CompatibilityProfileType, string>>({
    hardware: "",
    software: "",
    compatibility: "",
  });
  const [activeSearchSections, setActiveSearchSections] = useState<Set<CompatibilityProfileType>>(
    () => new Set(),
  );
  const closeProfileSearch = useCallback((type?: CompatibilityProfileType) => {
    setActiveSearchSections((current) => {
      if (!current.size) return current;
      if (!type) return new Set();
      if (!current.has(type)) return current;
      const next = new Set(current);
      next.delete(type);
      return next;
    });
    setSearchQueries((current) => {
      if (!type) {
        return current.hardware || current.software || current.compatibility
          ? { hardware: "", software: "", compatibility: "" }
          : current;
      }
      return current[type] ? { ...current, [type]: "" } : current;
    });
  }, []);

  useEffect(() => {
    if (!activeSearchSections.size) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".compatibility-favorite-section-body")) return;
      closeProfileSearch();
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [activeSearchSections, closeProfileSearch]);

  const relevantScopes = useMemo<CompatibilityScope[]>(() => {
    const scopes: CompatibilityScope[] = ["container"];
    if ((file?.video_streams.length ?? 0) > 0) scopes.push("video");
    if ((file?.audio_streams.length ?? 0) > 0) scopes.push("audio");
    if ((file?.subtitle_streams.length ?? 0) > 0 || (file?.external_subtitles.length ?? 0) > 0) {
      scopes.push("subtitle");
    }
    return scopes;
  }, [file]);
  const hardwareNames = new Map(hardware.map((profile) => [profile.id, profile.name]));
  const softwareNames = new Map(software.map((profile) => [profile.id, profile.name]));
  const sections: Array<{
    type: CompatibilityProfileType;
    label: string;
    profiles: Array<{
      id: string;
      name: string;
      searchableText: string;
      favorite: boolean;
      evaluation?: ProfileEvaluation;
      results: CompatibilityEvaluation[];
    }>;
  }> = [
    {
      type: "hardware",
      label: t("compatibilityProfiles.tabs.hardware"),
      profiles: hardware.map((profile) => ({
        id: profile.id,
        name: profile.name,
        searchableText: `${profile.name} ${profile.id} ${profile.manufacturer}`,
        favorite: favoriteKeys.has(favoriteProfileKey("hardware", profile.id)),
        evaluation: hardwareResults.find((result) => result.profile_id === profile.id),
        results: [],
      })),
    },
    {
      type: "software",
      label: t("compatibilityProfiles.tabs.software"),
      profiles: software.map((profile) => ({
        id: profile.id,
        name: profile.name,
        searchableText: `${profile.name} ${profile.id} ${profile.developer}`,
        favorite: favoriteKeys.has(favoriteProfileKey("software", profile.id)),
        evaluation: softwareResults.find((result) => result.profile_id === profile.id),
        results: [],
      })),
    },
    {
      type: "compatibility",
      label: t("compatibilityProfiles.tabs.compatibility"),
      profiles: combinations.map((profile) => ({
        id: profile.id,
        name: profile.name,
        searchableText: [
          profile.name,
          profile.id,
          hardwareNames.get(profile.hardware_profile_id),
          softwareNames.get(profile.software_profile_id),
        ].filter(Boolean).join(" "),
        favorite: favoriteKeys.has(favoriteProfileKey("compatibility", profile.id)),
        results: results.filter((result) => result.compatibility_profile_id === profile.id),
      })),
    },
  ];

  return (
    <div className="compatibility-favorite-sections">
      {sections.map((section) => {
        const normalizedQuery = searchQueries[section.type].trim().toLocaleLowerCase();
        const searchActive = activeSearchSections.has(section.type);
        const visibleProfiles = [...section.profiles]
          .sort((left, right) => Number(right.favorite) - Number(left.favorite))
          .filter((profile) => {
            if (!profile.favorite && !searchActive) return false;
            return !normalizedQuery || profile.searchableText.toLocaleLowerCase().includes(normalizedQuery);
          });
        const favoriteCount = section.profiles.filter((profile) => profile.favorite).length;
        return (
        <details className="compatibility-favorite-section" key={section.type} open>
          <summary>
            <span>{section.label}</span>
            <span className="compatibility-favorite-count">{favoriteCount}</span>
          </summary>
          <div
            className="compatibility-favorite-section-body"
            onBlurCapture={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              closeProfileSearch(section.type);
            }}
          >
            <div className="compatibility-profile-search">
              <Search size={16} aria-hidden="true" className="compatibility-profile-search-icon" />
              <input
                type="search"
                value={searchQueries[section.type]}
                aria-label={t("compatibilityProfiles.searchAria", { type: section.label })}
                placeholder={t("compatibilityProfiles.searchPlaceholder")}
                onFocus={() => setActiveSearchSections((current) => (
                  current.has(section.type) ? current : new Set(current).add(section.type)
                ))}
                onChange={(event) => setSearchQueries((current) => ({
                  ...current,
                  [section.type]: event.target.value,
                }))}
              />
              {searchQueries[section.type] ? (
                <button
                  type="button"
                  className="compatibility-profile-search-clear"
                  aria-label={t("compatibilityProfiles.clearSearch")}
                  onClick={() => setSearchQueries((current) => ({ ...current, [section.type]: "" }))}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {visibleProfiles.length ? visibleProfiles.map((profile) => {
              const status = profile.evaluation?.status ?? bestCompatibilityStatus(profile.results);
              const favoriteLabel = t(
                profile.favorite
                  ? "compatibilityProfiles.favoriteRemoveAria"
                  : "compatibilityProfiles.favoriteAddAria",
                { name: profile.name },
              );
              if (!profile.favorite) {
                return (
                  <div className="compatibility-favorite-profile-row" key={profile.id}>
                    <span>{profile.name}</span>
                    <span className="compatibility-profile-quick-actions">
                      <ProfileFavoriteButton
                        favorite={false}
                        label={favoriteLabel}
                        onClick={() => onToggleFavorite(section.type, profile.id)}
                      />
                    </span>
                  </div>
                );
              }
              return (
                <details className={`compatibility-favorite-profile${status ? ` status-${status}` : ""}`} key={profile.id}>
                  <summary className="compatibility-favorite-profile-summary">
                    <span>{profile.name}</span>
                    <span className="compatibility-favorite-profile-actions">
                      {status ? (
                        <span className={`compatibility-status-badge status-${status}`}>
                          {t(`fileDetail.compatibility.status.${status}`)}
                        </span>
                      ) : (
                        <span className="compatibility-status-badge status-not-evaluated">
                          {t("fileDetail.compatibility.notEvaluated")}
                        </span>
                      )}
                      <span className="compatibility-profile-quick-actions">
                        <ProfileFavoriteButton
                          favorite
                          label={favoriteLabel}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleFavorite(section.type, profile.id);
                          }}
                        />
                      </span>
                    </span>
                  </summary>
                  <div className="compatibility-favorite-profile-report">
                  {profile.evaluation ? (
                    <CompatibilityReport result={profile.evaluation} scopes={relevantScopes} />
                  ) : profile.results.length ? (
                    <div className="compatibility-result-list">
                      {profile.results.map((result) => (
                        <CompatibilityReport
                          key={result.compatibility_profile_id}
                          result={result}
                          context={`${hardwareNames.get(result.hardware_profile_id) ?? result.hardware_profile_id} + ${softwareNames.get(result.software_profile_id) ?? result.software_profile_id}`}
                          scopes={relevantScopes}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="notice">{t("fileDetail.compatibility.noCombination")}</div>
                  )}
                  </div>
                </details>
              );
            }) : (
              <p className="compatibility-profile-search-empty">
                {searchActive
                  ? t("compatibilityProfiles.searchEmpty")
                  : t("fileDetail.compatibility.noFavoritesForType", { type: section.label })}
              </p>
            )}
          </div>
        </details>
        );
      })}
    </div>
  );
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
    {
      key: "containerFormat",
      label: t("fileDetail.containerFormat"),
      tooltip: t("fileDetail.containerFormatTooltip"),
      tooltipAria: t("fileDetail.containerFormatTooltipAria"),
      value: formatContainerFormatLabel(file.media_format?.container_format),
    },
    {
      key: "bitRate",
      label: t("fileDetail.bitRate"),
      value: formatBitRate(file.media_format?.bit_rate),
    },
    {
      key: "probeScore",
      label: t("fileDetail.probeScore"),
      tooltip: t("fileDetail.probeScoreTooltip"),
      tooltipAria: t("fileDetail.probeScoreTooltipAria"),
      value: formatProbeScore(file.media_format?.probe_score),
    },
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
              <span className="format-details-label">
                {row.label}
                {row.tooltip ? (
                  <TooltipTrigger
                    ariaLabel={row.tooltipAria}
                    className="file-detail-field-tooltip"
                    content={row.tooltip}
                    maxWidth={360}
                    preserveLineBreaks
                  >
                    <Info aria-hidden="true" size={13} strokeWidth={2.4} />
                  </TooltipTrigger>
                ) : null}
              </span>
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
  if (hasVideoMetadata(detail)) {
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

function collapseHistoryStates(
  items: FileHistoryEntry[],
  t: (key: string, options?: Record<string, unknown>) => string,
  inDepthDolbyVisionProfiles = false,
): FileHistoryState[] {
  const chronologicalItems = [...items].reverse();
  const grouped: Array<{ entries: FileHistoryEntry[] }> = [];

  for (const item of chronologicalItems) {
    const currentGroup = grouped.at(-1);
    const currentLatestEntry = currentGroup?.entries.at(-1);
    if (
      currentGroup &&
      currentLatestEntry &&
      buildHistoryDiffMetrics(item.snapshot, currentLatestEntry.snapshot, t, inDepthDolbyVisionProfiles).length === 0
    ) {
      currentGroup.entries.push(item);
      continue;
    }
    grouped.push({ entries: [item] });
  }

  return grouped
    .map((group, index) => {
      const oldestEntry = group.entries[0];
      const newestEntry = group.entries.at(-1) ?? group.entries[0];
      const newerGroup = grouped[index + 1];
      const newerOldestEntry = newerGroup?.entries[0] ?? null;
      return {
        entry: newestEntry,
        startedAt: oldestEntry.captured_at,
        endedAt: newerOldestEntry?.captured_at ?? null,
      };
    })
    .reverse();
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

  const states = collapseHistoryStates(items, t, inDepthDolbyVisionProfiles);
  const renderableStates = states
    .map((state, index) => {
      const previousSnapshot = states[index + 1]?.entry.snapshot;
      const metrics = buildHistoryDiffMetrics(state.entry.snapshot, previousSnapshot, t, inDepthDolbyVisionProfiles);
      return { metrics, state };
    })
    .filter(({ metrics }) => metrics.length > 0);

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
      {renderableStates.length === 0 ? (
        <DuplicatePanelEmptyState message={t("fileDetail.history.noChanges")} />
      ) : null}
      {renderableStates.map(({ metrics, state }, index) => {
        const entry = state.entry;

        return (
          <details className="file-history-entry" key={entry.id} open={index === 0}>
            <summary className="file-history-entry-head">
              <strong>{formatHistoryRange(state, t)}</strong>
            </summary>
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
          </details>
        );
      })}
    </div>
  );
}

export function FileDetailPage() {
  const { t } = useTranslation();
  const { fileId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { appSettings } = useAppData();
  const inDepthDolbyVisionProfiles = appSettings.feature_flags.in_depth_dolby_vision_profiles;
  const [file, setFile] = useState<MediaFileDetail | null>(null);
  const [qualityDetail, setQualityDetail] = useState<MediaFileQualityScoreDetail | null>(null);
  const [qualityError, setQualityError] = useState(false);
  const [compatibilityResults, setCompatibilityResults] = useState<CompatibilityEvaluation[]>([]);
  const [hardwareCompatibilityResults, setHardwareCompatibilityResults] = useState<ProfileEvaluation[]>([]);
  const [softwareCompatibilityResults, setSoftwareCompatibilityResults] = useState<ProfileEvaluation[]>([]);
  const [hardwareProfiles, setHardwareProfiles] = useState<HardwareProfile[]>([]);
  const [softwareProfiles, setSoftwareProfiles] = useState<SoftwareProfile[]>([]);
  const [combinationProfiles, setCombinationProfiles] = useState<CompatibilityProfile[]>([]);
  const [favoriteProfileKeys, setFavoriteProfileKeys] = useState(readFavoriteProfileKeys);
  const [compatibilityLoading, setCompatibilityLoading] = useState(true);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [fileHistory, setFileHistory] = useState<MediaFileHistory | null>(null);
  const [fileHistoryError, setFileHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePanelId, setActivePanelId] = useState<FileDetailPanelId>(() => readStoredFileDetailPanelId());
  const [isNavCollapsed, setIsNavCollapsed] = useState(() => readStoredFileDetailNavCollapsed());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [audioStreamPrimaryMode, setAudioStreamPrimaryMode] = useState<AudioStreamPrimaryMode>(() =>
    readStoredAudioStreamPrimaryMode(),
  );
  const [rawJsonCopied, setRawJsonCopied] = useState(false);
  const rawJsonCopyResetTimeoutRef = useRef<number | null>(null);
  const previewReportIconRef = useRef<ArrowUpRightIconHandle>(null);

  const goBack = useCallback(() => {
    if (location.key !== "default") {
      navigate(-1);
      return;
    }
    if (file?.library_id) {
      navigate(`/libraries/${file.library_id}`, { replace: true });
      return;
    }
    navigate("/", { replace: true });
  }, [file?.library_id, location.key, navigate]);

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
    Promise.all([
      api.hardwareProfiles(),
      api.softwareProfiles(),
      api.compatibilityProfiles(),
    ])
      .then(([nextHardware, nextSoftware, nextCombinations]) => {
        setHardwareProfiles(nextHardware);
        setSoftwareProfiles(nextSoftware);
        setCombinationProfiles(nextCombinations);
        setCompatibilityError(null);
      })
      .catch((reason: Error) => {
        setHardwareProfiles([]);
        setSoftwareProfiles([]);
        setCombinationProfiles([]);
        setCompatibilityError(reason.message);
      })
      .finally(() => setCompatibilityLoading(false));
  }, [fileId]);

  useEffect(() => {
    const hardwareIds = hardwareProfiles
      .filter((profile) => favoriteProfileKeys.has(favoriteProfileKey("hardware", profile.id)))
      .map((profile) => profile.id);
    const softwareIds = softwareProfiles
      .filter((profile) => favoriteProfileKeys.has(favoriteProfileKey("software", profile.id)))
      .map((profile) => profile.id);
    const combinationIds = combinationProfiles
      .filter((profile) => favoriteProfileKeys.has(favoriteProfileKey("compatibility", profile.id)))
      .map((profile) => profile.id);

    Promise.all([
      combinationIds.length ? api.fileCompatibility(fileId, combinationIds) : Promise.resolve([]),
      hardwareIds.length ? api.fileHardwareCompatibility(fileId, hardwareIds) : Promise.resolve([]),
      softwareIds.length ? api.fileSoftwareCompatibility(fileId, softwareIds) : Promise.resolve([]),
    ])
      .then(([evaluations, hardwareEvaluations, softwareEvaluations]) => {
        setCompatibilityResults(evaluations);
        setHardwareCompatibilityResults(hardwareEvaluations);
        setSoftwareCompatibilityResults(softwareEvaluations);
        setCompatibilityError(null);
      })
      .catch((reason: Error) => {
        setCompatibilityResults([]);
        setHardwareCompatibilityResults([]);
        setSoftwareCompatibilityResults([]);
        setCompatibilityError(reason.message);
      });
  }, [
    combinationProfiles,
    favoriteProfileKeys,
    fileId,
    hardwareProfiles,
    softwareProfiles,
  ]);

  const toggleFavoriteProfile = useCallback((type: CompatibilityProfileType, id: string) => {
    setFavoriteProfileKeys((current) => {
      const next = new Set(current);
      const key = favoriteProfileKey(type, id);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writeFavoriteProfileKeys(next);
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      if (rawJsonCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(rawJsonCopyResetTimeoutRef.current);
      }
    },
    [],
  );

  const rawJsonText = useMemo(() => JSON.stringify(file?.raw_ffprobe_json ?? {}, null, 2), [file?.raw_ffprobe_json]);
  const canCopyRawJson = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.writeText);
  const rawJsonCopyLabel = rawJsonCopied ? t("fileDetail.rawJsonCopied") : t("fileDetail.copyRawJson");

  const copyRawJson = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      return;
    }
    await clipboard.writeText(rawJsonText);
    setRawJsonCopied(true);
    if (rawJsonCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(rawJsonCopyResetTimeoutRef.current);
    }
    rawJsonCopyResetTimeoutRef.current = window.setTimeout(() => {
      setRawJsonCopied(false);
      rawJsonCopyResetTimeoutRef.current = null;
    }, 1800);
  }, [rawJsonText]);

  const changeAudioStreamPrimaryMode = useCallback((mode: AudioStreamPrimaryMode) => {
    setAudioStreamPrimaryMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FILE_DETAIL_AUDIO_STREAM_PRIMARY_STORAGE_KEY, mode);
    }
  }, []);

  const panels: Record<
    FileDetailPanelId,
    {
      title: string;
      loading: boolean;
      error: string | null;
      titleAddon?: ReactNode;
      subtitleAddon?: ReactNode;
      actions?: ReactNode;
      body: ReactNode;
    }
  > = {
    overview: {
      title: t("fileDetail.navigation.overview"),
      loading: !file && !error,
      error,
      body: <OverviewPanel file={file} t={t} inDepthDolbyVisionProfiles={inDepthDolbyVisionProfiles} />,
    },
    preview: {
      title: t("fileDetail.preview"),
      loading: !file && !error,
      error,
      titleAddon: (
        <TooltipTrigger
          ariaLabel={t("fileDetail.previewPlaybackWarningAria")}
          className="file-detail-preview-warning-tooltip"
          content={t("fileDetail.previewPlaybackWarning")}
        >
          <Info size={14} aria-hidden="true" />
        </TooltipTrigger>
      ),
      subtitleAddon: (
        <div className="file-detail-preview-supported-formats">
          <p>{t("fileDetail.previewSupportedFormats")}</p>
          <div className="file-detail-preview-report">
            <p>{t("fileDetail.previewReportPrompt")}</p>
            <a
              className="secondary small file-detail-cover-button file-detail-preview-report-button"
              href={PREVIEW_REPORT_URL}
              onBlur={() => previewReportIconRef.current?.stopAnimation()}
              onFocus={() => previewReportIconRef.current?.startAnimation()}
              onMouseEnter={() => previewReportIconRef.current?.startAnimation()}
              onMouseLeave={() => previewReportIconRef.current?.stopAnimation()}
              rel="noreferrer"
              target="_blank"
            >
              <ArrowUpRightIcon ref={previewReportIconRef} size={16} aria-hidden="true" />
              {t("fileDetail.previewReportLink")}
            </a>
          </div>
        </div>
      ),
      body: <PreviewDetailsPanel detail={file} t={t} />,
    },
    qualityBreakdown: {
      title: t("fileDetail.qualityBreakdown"),
      loading: !qualityDetail && !qualityError && !error,
      error: null,
      body: qualityDetail ? (
        <QualityBreakdownCategoryList qualityDetail={qualityDetail} t={t} />
      ) : (
        <div className="notice">{t("quality.unavailable")}</div>
      ),
    },
    compatibility: {
      title: t("fileDetail.compatibility.title"),
      loading: compatibilityLoading,
      error: compatibilityError,
      titleAddon: (
        <TooltipTrigger
          ariaLabel={t("fileDetail.compatibility.favoritesHelpAria")}
          className="file-detail-compatibility-help-tooltip"
          content={(
            <div className="file-detail-compatibility-help-content">
              <span>{t("fileDetail.compatibility.favoritesHelp")}</span>
              <a
                href="/settings"
                onClick={() => saveActiveSettingsPanel("compatibilityProfiles")}
                onMouseDown={(event) => event.preventDefault()}
              >
                {t("fileDetail.compatibility.openProfileSettings")}
              </a>
            </div>
          )}
        >
          <Info size={14} aria-hidden="true" />
        </TooltipTrigger>
      ),
      body: (
        <FavoriteCompatibilityResults
          results={compatibilityResults}
          hardwareResults={hardwareCompatibilityResults}
          softwareResults={softwareCompatibilityResults}
          hardware={hardwareProfiles}
          software={softwareProfiles}
          combinations={combinationProfiles}
          favoriteKeys={favoriteProfileKeys}
          onToggleFavorite={toggleFavoriteProfile}
          file={file}
        />
      ),
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
      actions: (
        <AudioStreamPrimaryToggle
          mode={audioStreamPrimaryMode}
          onChange={changeAudioStreamPrimaryMode}
        />
      ),
      body: (
        <div className="file-detail-audio-panel">
          <AudioMetadataList detail={file} t={t} />
          <StreamDetailsList
            kind="audio"
            detail={file ?? undefined}
            t={t}
            surface="panel"
            showSummary={false}
            audioPrimaryMode={audioStreamPrimaryMode}
          />
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
      actions: (
        <button
          type="button"
          className="secondary icon-only-button async-panel-toggle-icon-button-flat file-detail-raw-json-copy-button"
          aria-label={rawJsonCopyLabel}
          data-tooltip={rawJsonCopyLabel}
          title={rawJsonCopyLabel}
          disabled={!canCopyRawJson || !file}
          onClick={() => void copyRawJson()}
        >
          <CopyIcon aria-hidden="true" className="nav-icon" size={20} />
        </button>
      ),
      body: <JsonPreview value={file?.raw_ffprobe_json ?? {}} />,
    },
  };

  const availablePanelIds = useMemo(
    () => buildAvailableFileDetailPanelIds(
      file,
      qualityDetail,
      hardwareProfiles.length + softwareProfiles.length + combinationProfiles.length,
    ),
    [combinationProfiles.length, file, hardwareProfiles.length, qualityDetail, softwareProfiles.length],
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
            <button
              type="button"
              className="secondary settings-navigation-quick-action settings-mobile-navigation-quick-action"
              aria-label={t("fileDetail.navigation.back")}
              onClick={goBack}
              tabIndex={!isMobileMenuOpen ? -1 : undefined}
            >
              <ArrowLeft className="nav-icon" aria-hidden="true" />
              <span>{t("fileDetail.navigation.back")}</span>
            </button>
            {navItems.map((item) => renderNavItem(item, true))}
          </nav>
        </div>
        <div className="settings-navigation-quick-actions file-detail-navigation-actions">
          <button
            type="button"
            className="secondary small settings-panel-header-action file-detail-navigation-back-button"
            aria-label={t("fileDetail.navigation.back")}
            title={t("fileDetail.navigation.back")}
            onClick={goBack}
          >
            <ArrowLeft className="nav-icon" aria-hidden="true" />
            {!isNavCollapsed ? <span>{t("fileDetail.navigation.back")}</span> : null}
          </button>
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
          titleAddon={activePanel.titleAddon}
          subtitleAddon={activePanel.subtitleAddon}
          collapseActions={activePanel.actions}
        >
          {activePanel.body}
        </AsyncPanel>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";

import { AsyncPanel } from "../components/AsyncPanel";
import { DashboardVisibilityIcon } from "../components/DashboardVisibilityIcon";
import { PathBrowser } from "../components/PathBrowser";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import {
  api,
  type AppSettings,
  DEFAULT_QUALITY_PROFILE,
  type DuplicateDetectionMode,
  type HistoryReconstructionStatus,
  type HistoryReconstructionResult,
  type HistoryStorage,
  type LibraryType,
  type LibrarySummary,
  type PathInspection,
  type QualityProfile,
  type ResolutionCategory,
  type RecentScanJob,
  type ScanJobDetail,
} from "../lib/api";
import { getDesktopBridge, isDesktopApp } from "../lib/desktop";
import { formatBytes, formatCodecLabel, formatDate, formatDuration } from "../lib/format";
import { getIgnorePatternSectionState, saveIgnorePatternSectionState } from "../lib/ignore-pattern-sections";
import {
  DEFAULT_SHOW_SEASON_PATTERN_INPUTS,
  defaultBonusFolderPatternInputs,
  defaultPatternRecognitionSettings,
  type PatternRecognitionSettings,
} from "../lib/pattern-recognition";
import {
  getSettingsPanelState,
  saveSettingsPanelState,
  type SettingsPanelId,
} from "../lib/settings-panel-state";
import {
  DEFAULT_RESOLUTION_CATEGORIES,
  normalizeResolutionCategories,
  resolutionCategoryChangeSummary,
} from "../lib/resolution-categories";
import { useScanJobs } from "../lib/scan-jobs";
import { useTheme, type ThemePreference } from "../lib/theme";

type CreateLibraryForm = {
  name: string;
  path: string;
  type: LibraryType;
  scan_mode: string;
  duplicate_detection_mode: DuplicateDetectionMode;
};

const EMPTY_FORM: CreateLibraryForm = {
  name: "",
  path: ".",
  type: "mixed",
  scan_mode: "manual",
  duplicate_detection_mode: "off",
};

function createEmptyForm(isDesktop: boolean): CreateLibraryForm {
  return {
    ...EMPTY_FORM,
    path: isDesktop ? "" : EMPTY_FORM.path,
  };
}

type LibrarySettingsForm = {
  scan_mode: string;
  duplicate_detection_mode: DuplicateDetectionMode;
  interval_minutes: number;
  debounce_seconds: number;
  quality_profile: QualityProfile;
};

type LibraryIdentityForm = {
  name: string;
  type: LibraryType;
};

type PersistedIgnorePatterns = Record<IgnorePatternGroup, string[]>;

type IgnorePatternGroup = "user" | "default";

type PatternSectionKey =
  | "series_folder_regexes"
  | "season_folder_regexes"
  | "bonus_folder_patterns";

type PatternRecognitionSectionState = Record<PatternSectionKey, boolean>;

const PATTERN_RECOGNITION_SECTION_STORAGE_KEY = "medialyze-pattern-recognition-sections";

const DEFAULT_PATTERN_RECOGNITION_SECTION_STATE: PatternRecognitionSectionState = {
  series_folder_regexes: true,
  season_folder_regexes: true,
  bonus_folder_patterns: true,
};

const PATTERN_DOCS_URL = "https://github.com/frederikemmer/MediaLyze/blob/dev/docs/patterns.md";

function normalizePatternRecognitionInputs(settings?: PatternRecognitionSettings | null): PatternRecognitionSettings {
  const next = settings ?? DEFAULT_PATTERN_RECOGNITION_INPUTS;
  return {
    ...next,
    analyze_bonus_content: true,
    show_season_patterns: {
      ...DEFAULT_SHOW_SEASON_PATTERN_INPUTS,
      ...next.show_season_patterns,
      series_folder_regexes:
        next.show_season_patterns?.series_folder_regexes ?? DEFAULT_SHOW_SEASON_PATTERN_INPUTS.series_folder_regexes,
      season_folder_regexes:
        next.show_season_patterns?.season_folder_regexes ?? DEFAULT_SHOW_SEASON_PATTERN_INPUTS.season_folder_regexes,
    },
  };
}

function normalizePatternRecognitionSectionState(value: unknown): PatternRecognitionSectionState {
  const state = { ...DEFAULT_PATTERN_RECOGNITION_SECTION_STATE };
  if (!value || typeof value !== "object") {
    return state;
  }

  const candidate = value as Partial<Record<PatternSectionKey, unknown> & Record<string, unknown>>;
  for (const key of Object.keys(state) as PatternSectionKey[]) {
    if (typeof candidate[key] === "boolean") {
      state[key] = candidate[key];
    }
  }
  if (typeof candidate.bonus_folder_patterns !== "boolean") {
    const legacyExpanded =
      candidate.bonus_user_folder_patterns === true || candidate.bonus_default_folder_patterns === true;
    if (legacyExpanded) {
      state.bonus_folder_patterns = true;
    }
  }
  return state;
}

function getPatternRecognitionSectionState(): PatternRecognitionSectionState {
  if (typeof window === "undefined") {
    return DEFAULT_PATTERN_RECOGNITION_SECTION_STATE;
  }

  const raw = window.localStorage.getItem(PATTERN_RECOGNITION_SECTION_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PATTERN_RECOGNITION_SECTION_STATE;
  }

  try {
    return normalizePatternRecognitionSectionState(JSON.parse(raw));
  } catch {
    return DEFAULT_PATTERN_RECOGNITION_SECTION_STATE;
  }
}

function savePatternRecognitionSectionState(state: PatternRecognitionSectionState): PatternRecognitionSectionState {
  const normalized = normalizePatternRecognitionSectionState(state);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PATTERN_RECOGNITION_SECTION_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}
const VIDEO_CODEC_OPTIONS = ["mpeg2video", "mpeg4", "vc1", "mjpeg", "h264", "vp9", "hevc", "prores", "av1"];
const AUDIO_CHANNEL_OPTIONS = ["mono", "stereo", "5.1", "7.1"];
const AUDIO_CODEC_OPTIONS = [
  "mp3",
  "vorbis",
  "aac",
  "ac3",
  "eac3",
  "opus",
  "dts",
  "dts_hd",
  "truehd",
  "flac",
  "alac",
  "pcm_bluray",
  "pcm_s16le",
  "pcm_s16be",
  "pcm_s24le",
  "pcm_s24be",
  "pcm_s32le",
  "pcm_s32be",
];
const DYNAMIC_RANGE_OPTIONS = ["sdr", "hdr10", "hdr10_plus", "dolby_vision"];
const LANGUAGE_OPTIONS = ["de", "en", "fr", "es", "it", "ja", "ko", "pl", "pt", "ru", "tr", "uk", "zh", "cs", "nl"];
const ISO_639_1_CODES = new Set([
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu",
]);
const QUALITY_OPTION_RANKS: Record<string, Record<string, number>> = {
  video_codec: Object.fromEntries(VIDEO_CODEC_OPTIONS.map((value, index) => [value, index])),
  audio_channels: Object.fromEntries(AUDIO_CHANNEL_OPTIONS.map((value, index) => [value, index])),
  audio_codec: Object.fromEntries(AUDIO_CODEC_OPTIONS.map((value, index) => [value, index])),
  dynamic_range: Object.fromEntries(DYNAMIC_RANGE_OPTIONS.map((value, index) => [value, index])),
};
const VIDEO_CODEC_OPTION_LABELS = new Map(VIDEO_CODEC_OPTIONS.map((value) => [value, formatCodecLabel(value, "video")]));
const AUDIO_CODEC_OPTION_LABELS = new Map(AUDIO_CODEC_OPTIONS.map((value) => [value, formatCodecLabel(value, "audio")]));

type ResolutionCategoryDraft = ResolutionCategory & {
  persisted: boolean;
};

const RESOLUTION_CATEGORY_TOOLTIP = [
  "Default buckets intentionally use 5% lower minimum width and height thresholds so cropped and cinema-scope encodes still land in the expected format bucket.",
  "Reference dimensions:",
  "8k: 7680x4320",
  "4k / UHD: 3840x2160",
  "1080p / Full HD: 1920x1080",
  "720p / HD: 1280x720",
].join("\n");

type NewResolutionCategoryDraft = {
  label: string;
  min_width: string;
  min_height: string;
};

const EMPTY_NEW_RESOLUTION_CATEGORY_DRAFT: NewResolutionCategoryDraft = {
  label: "",
  min_width: "",
  min_height: "",
};

const SCAN_WORKER_COUNT_MIN = 1;
const SCAN_WORKER_COUNT_MAX = 16;
const PARALLEL_SCAN_JOB_COUNT_MIN = 1;
const PARALLEL_SCAN_JOB_COUNT_MAX = 8;
const COMPARISON_SCATTER_POINT_LIMIT_MIN = 100;
const COMPARISON_SCATTER_POINT_LIMIT_MAX = 500000;
const DEFAULT_SCAN_PERFORMANCE = {
  scan_worker_count: 4,
  parallel_scan_jobs: 2,
  comparison_scatter_point_limit: 5000,
};
const DEFAULT_HISTORY_RETENTION = {
  file_history: { days: 30, storage_limit_gb: 0 },
  library_history: { days: 365, storage_limit_gb: 0 },
  scan_history: { days: 30, storage_limit_gb: 0 },
};
const SCAN_WORKER_OPTIONS = Array.from({ length: SCAN_WORKER_COUNT_MAX }, (_, index) => index + 1);
const PARALLEL_SCAN_JOB_OPTIONS = Array.from({ length: PARALLEL_SCAN_JOB_COUNT_MAX }, (_, index) => index + 1);
const COMPARISON_SCATTER_POINT_LIMIT_OPTIONS = [
  250,
  500,
  1000,
  2500,
  5000,
  10000,
  20000,
  50000,
  100000,
  250000,
  500000,
];
const HISTORY_RECONSTRUCTION_POLL_INTERVAL_MS = 1500;

function cloneResolutionCategoryDrafts(categories: ResolutionCategory[]): ResolutionCategoryDraft[] {
  return categories.map((category) => ({ ...category, persisted: true }));
}

function resolutionCategoriesFromDrafts(drafts: ResolutionCategoryDraft[]): ResolutionCategory[] {
  return normalizeResolutionCategories(
    drafts.map(({ persisted, ...category }) => ({
      ...category,
      id: persisted ? category.id : "",
    })),
  );
}

function createResolutionCategoryId(label: string, drafts: ResolutionCategoryDraft[]): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "resolution";
  let candidate = base;
  let suffix = 2;
  while (drafts.some((draft) => draft.id === candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function resolutionCategoryRanks(categories: ResolutionCategory[]): Record<string, number> {
  return Object.fromEntries(categories.map((category, index) => [category.id, categories.length - index]));
}

function cloneQualityProfile(profile: QualityProfile): QualityProfile {
  return JSON.parse(JSON.stringify(profile)) as QualityProfile;
}

function normalizeVisualDensityBounds(minimum: number, ideal: number, maximum: number) {
  const nextMinimum = Math.max(0, minimum);
  const nextIdeal = Math.max(nextMinimum, ideal);
  const nextMaximum = Math.max(nextIdeal, maximum);
  return {
    minimum: nextMinimum,
    ideal: nextIdeal,
    maximum: nextMaximum,
  };
}

function weightFieldStyle(weight: number) {
  const clamped = Math.max(0, Math.min(10, weight));
  const lightness = 90 - clamped * 3.4;
  const alpha = 0.16 + clamped * 0.035;
  return {
    backgroundColor: `hsla(157, 57%, ${lightness}%, ${alpha})`,
    borderColor: `hsla(157, 57%, 38%, ${0.18 + clamped * 0.04})`,
    color: clamped >= 7 ? "#f7fbf9" : "#145c49",
  };
}

function toLibrarySettingsForm(library: LibrarySummary): LibrarySettingsForm {
  return {
    scan_mode: library.scan_mode,
    duplicate_detection_mode: library.duplicate_detection_mode,
    interval_minutes: Number(library.scan_config.interval_minutes ?? 60),
    debounce_seconds: Number(library.scan_config.debounce_seconds ?? 15),
    quality_profile: cloneQualityProfile(library.quality_profile ?? DEFAULT_QUALITY_PROFILE),
  };
}

function toLibraryIdentityForm(library: LibrarySummary): LibraryIdentityForm {
  return {
    name: library.name,
    type: library.type,
  };
}

function buildScanConfig(settings: LibrarySettingsForm): Record<string, number> {
  if (settings.scan_mode === "scheduled") {
    return { interval_minutes: settings.interval_minutes };
  }
  if (settings.scan_mode === "watch") {
    return { debounce_seconds: settings.debounce_seconds };
  }
  return {};
}

function settingsMatchLibrary(library: LibrarySummary, settings: LibrarySettingsForm | undefined): boolean {
  if (!settings) {
    return true;
  }
  const current = toLibrarySettingsForm(library);
  return (
    current.scan_mode === settings.scan_mode &&
    current.duplicate_detection_mode === settings.duplicate_detection_mode &&
    current.interval_minutes === settings.interval_minutes &&
    current.debounce_seconds === settings.debounce_seconds &&
    JSON.stringify(current.quality_profile) === JSON.stringify(settings.quality_profile)
  );
}

function normalizeIgnorePatterns(patterns: string[]): string[] {
  return patterns
    .map((line) => line.trim())
    .filter(Boolean);
}

const DEFAULT_PATTERN_RECOGNITION_INPUTS = defaultPatternRecognitionSettings();

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizeScanPerformanceInput(
  value: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampInteger(parsed, minimum, maximum);
}

function normalizeHistoryRetentionDaysInput(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.round(parsed));
}

function normalizeHistoryRetentionStorageInput(value: string, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

type HistoryRetentionBucketKey = keyof typeof DEFAULT_HISTORY_RETENTION;
const HISTORY_RETENTION_BUCKETS: HistoryRetentionBucketKey[] = [
  "file_history",
  "library_history",
  "scan_history",
];

type HistoryRetentionInputs = Record<
  HistoryRetentionBucketKey,
  {
    days: string;
    storage_limit_gb: string;
  }
>;

function historyRetentionInputsFromSettings(
  historyRetention = DEFAULT_HISTORY_RETENTION,
): HistoryRetentionInputs {
  return {
    file_history: {
      days: String(historyRetention.file_history.days),
      storage_limit_gb: String(historyRetention.file_history.storage_limit_gb),
    },
    library_history: {
      days: String(historyRetention.library_history.days),
      storage_limit_gb: String(historyRetention.library_history.storage_limit_gb),
    },
    scan_history: {
      days: String(historyRetention.scan_history.days),
      storage_limit_gb: String(historyRetention.scan_history.storage_limit_gb),
    },
  };
}

function formatHistoryProjection(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "∞";
  }
  return formatBytes(value);
}

function toPersistedIgnorePatterns(payload: {
  user_ignore_patterns?: string[];
  default_ignore_patterns?: string[];
}): PersistedIgnorePatterns {
  return {
    user: payload.user_ignore_patterns ?? [],
    default: payload.default_ignore_patterns ?? [],
  };
}

function formatScanJobType(
  t: (key: string, options?: Record<string, unknown>) => string,
  value: string,
) {
  return value === "full" ? t("scanLogs.jobTypeFull") : t("scanLogs.jobTypeIncremental");
}

function formatTriggerSource(
  t: (key: string, options?: Record<string, unknown>) => string,
  value: RecentScanJob["trigger_source"],
) {
  if (value === "scheduled") {
    return t("scanLogs.triggerScheduled");
  }
  if (value === "watchdog") {
    return t("scanLogs.triggerWatchdog");
  }
  return t("scanLogs.triggerManual");
}

function formatOutcome(
  t: (key: string, options?: Record<string, unknown>) => string,
  value: RecentScanJob["outcome"],
) {
  if (value === "canceled") {
    return t("scanLogs.outcomeCanceled");
  }
  if (value === "failed") {
    return t("scanLogs.outcomeFailed");
  }
  if (value === "completed_with_issues") {
    return t("scanLogs.outcomeCompletedWithIssues");
  }
  return t("scanLogs.outcomeSuccessful");
}

function summarizeTriggerDetails(
  t: (key: string, options?: Record<string, unknown>) => string,
  job: RecentScanJob | ScanJobDetail,
) {
  if (job.trigger_source === "scheduled") {
    const intervalMinutes = Number((job as ScanJobDetail).trigger_details?.interval_minutes ?? 0);
    return intervalMinutes > 0
      ? t("scanLogs.triggerScheduledSummary", { minutes: intervalMinutes })
      : t("scanLogs.triggerScheduled");
  }
  if (job.trigger_source === "watchdog") {
    const triggerDetails = (job as ScanJobDetail).trigger_details ?? {};
    const eventCount = Number(triggerDetails.event_count ?? 0);
    return eventCount > 0
      ? t("scanLogs.triggerWatchdogSummary", { count: eventCount })
      : t("scanLogs.triggerWatchdog");
  }
  return t("scanLogs.triggerManualSummary");
}

function compactScanValues(values: string[], limit = 2): string {
  if (values.length === 0) {
    return "";
  }
  const visible = values.slice(0, limit);
  return values.length > limit ? `${visible.join(", ")}, ...` : visible.join(", ");
}

function buildScanFailureDiagnostic(
  job: ScanJobDetail,
  section: "analysis" | "duplicates",
  entry: { path: string; reason: string; detail?: string | null },
): string {
  return JSON.stringify(
    {
      job_id: job.id,
      library_id: job.library_id,
      library_name: job.library_name,
      outcome: job.outcome,
      trigger_source: job.trigger_source,
      started_at: job.started_at,
      finished_at: job.finished_at,
      section,
      path: entry.path,
      reason: entry.reason,
      detail: entry.detail ?? entry.reason,
    },
    null,
    2,
  );
}

function scanLogTitle(job: RecentScanJob) {
  return formatDate(job.finished_at ?? job.started_at);
}

function networkWatchFallbackApplied(inspection: PathInspection | null | undefined, scanMode: string): boolean {
  return Boolean(inspection && !inspection.watch_supported && scanMode === "scheduled");
}

export function LibrariesPage() {
  const { t, i18n } = useTranslation();
  const desktopBridge = getDesktopBridge();
  const desktopApp = isDesktopApp();
  const {
    appSettings,
    appSettingsLoaded,
    libraries,
    librariesLoaded,
    loadAppSettings,
    loadDashboard,
    loadLibraries,
    setAppSettings,
    upsertLibrary,
    removeLibrary: removeLibraryFromStore,
  } = useAppData();
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settingsForms, setSettingsForms] = useState<Record<number, LibrarySettingsForm>>({});
  const [qualitySectionOpen, setQualitySectionOpen] = useState<Record<number, boolean>>({});
  const [qualityPickerOpenKey, setQualityPickerOpenKey] = useState<string | null>(null);
  const [qualityLanguageDrafts, setQualityLanguageDrafts] = useState<Record<string, string>>({});
  const [qualityLanguageErrors, setQualityLanguageErrors] = useState<Record<string, string | null>>({});
  const autoSaveTimers = useRef<Record<number, number>>({});
  const [libraryMessages, setLibraryMessages] = useState<Record<number, string | null>>({});
  const [libraryIdentityForms, setLibraryIdentityForms] = useState<Record<number, LibraryIdentityForm>>({});
  const [libraryIdentityPending, setLibraryIdentityPending] = useState<Record<number, boolean>>({});
  const [isRunningFullScanAll, setIsRunningFullScanAll] = useState(false);
  const [dashboardVisibilityPending, setDashboardVisibilityPending] = useState<Record<number, boolean>>({});
  const [settingsPanelState, setSettingsPanelState] = useState(() => getSettingsPanelState());
  const [recentScanJobs, setRecentScanJobs] = useState<RecentScanJob[]>([]);
  const [isLoadingRecentScanJobs, setIsLoadingRecentScanJobs] = useState(true);
  const [recentScanJobsError, setRecentScanJobsError] = useState<string | null>(null);
  const [hasMoreRecentScanJobs, setHasMoreRecentScanJobs] = useState(false);
  const [isLoadingMoreRecentScanJobs, setIsLoadingMoreRecentScanJobs] = useState(false);
  const [expandedScanJobIds, setExpandedScanJobIds] = useState<Record<number, boolean>>({});
  const [scanJobDetails, setScanJobDetails] = useState<Record<number, ScanJobDetail>>({});
  const [scanJobDetailLoading, setScanJobDetailLoading] = useState<Record<number, boolean>>({});
  const [scanJobDetailErrors, setScanJobDetailErrors] = useState<Record<number, string | null>>({});
  const [copiedScanDiagnosticKey, setCopiedScanDiagnosticKey] = useState<string | null>(null);
  const [form, setForm] = useState<CreateLibraryForm>(() => createEmptyForm(desktopApp));
  const [formPathInspection, setFormPathInspection] = useState<PathInspection | null>(null);
  const [formPathInspectionError, setFormPathInspectionError] = useState<string | null>(null);
  const [libraryPathInspections, setLibraryPathInspections] = useState<Record<number, PathInspection | null>>({});
  const [userIgnorePatternInputs, setUserIgnorePatternInputs] = useState<string[]>([]);
  const [defaultIgnorePatternInputs, setDefaultIgnorePatternInputs] = useState<string[]>([]);
  const [ignorePatternDraft, setIgnorePatternDraft] = useState("");
  const [patternRecognitionInputs, setPatternRecognitionInputs] = useState<PatternRecognitionSettings>(
    normalizePatternRecognitionInputs(appSettings.pattern_recognition ?? DEFAULT_PATTERN_RECOGNITION_INPUTS),
  );
  const [patternRecognitionDrafts, setPatternRecognitionDrafts] = useState<Record<PatternSectionKey, string>>({
    series_folder_regexes: "",
    season_folder_regexes: "",
    bonus_folder_patterns: "",
  });
  const [ignorePatternSectionState, setIgnorePatternSectionState] = useState(() => getIgnorePatternSectionState());
  const [patternRecognitionSectionState, setPatternRecognitionSectionState] = useState(() =>
    getPatternRecognitionSectionState(),
  );
  const [ignorePatternsLoadError, setIgnorePatternsLoadError] = useState<string | null>(null);
  const [ignorePatternsStatus, setIgnorePatternsStatus] = useState<string | null>(null);
  const [isLoadingIgnorePatterns, setIsLoadingIgnorePatterns] = useState(true);
  const [isSavingIgnorePatterns, setIsSavingIgnorePatterns] = useState(false);
  const [showAnalyzedFilesCsvExport, setShowAnalyzedFilesCsvExport] = useState(false);
  const [showFullWidthAppShell, setShowFullWidthAppShell] = useState(false);
  const [hideQualityScoreMeter, setHideQualityScoreMeter] = useState(false);
  const [unlimitedPanelSize, setUnlimitedPanelSize] = useState(false);
  const [inDepthDolbyVisionProfiles, setInDepthDolbyVisionProfiles] = useState(false);
  const [scanWorkerCountInput, setScanWorkerCountInput] = useState("4");
  const [parallelScanJobsInput, setParallelScanJobsInput] = useState("2");
  const [comparisonScatterPointLimitInput, setComparisonScatterPointLimitInput] = useState("5000");
  const [historyRetentionInputs, setHistoryRetentionInputs] = useState<HistoryRetentionInputs>(
    historyRetentionInputsFromSettings(),
  );
  const [historyStorage, setHistoryStorage] = useState<HistoryStorage | null>(null);
  const [historyReconstruction, setHistoryReconstruction] = useState<HistoryReconstructionStatus | null>(null);
  const [historyStorageError, setHistoryStorageError] = useState<string | null>(null);
  const [isLoadingHistoryStorage, setIsLoadingHistoryStorage] = useState(true);
  const [resolutionCategoryDrafts, setResolutionCategoryDrafts] = useState<ResolutionCategoryDraft[]>([]);
  const [newResolutionCategoryDraft, setNewResolutionCategoryDraft] = useState<NewResolutionCategoryDraft>(
    EMPTY_NEW_RESOLUTION_CATEGORY_DRAFT,
  );
  const [featureFlagsStatus, setFeatureFlagsStatus] = useState<string | null>(null);
  const [scanPerformanceStatus, setScanPerformanceStatus] = useState<string | null>(null);
  const [historyRetentionStatus, setHistoryRetentionStatus] = useState<string | null>(null);
  const [historyRetentionStatusTone, setHistoryRetentionStatusTone] = useState<"success" | "error">("error");
  const [resolutionCategoriesStatus, setResolutionCategoriesStatus] = useState<string | null>(null);
  const [patternRecognitionStatus, setPatternRecognitionStatus] = useState<string | null>(null);
  const [isSavingFeatureFlags, setIsSavingFeatureFlags] = useState(false);
  const [isSavingScanPerformance, setIsSavingScanPerformance] = useState(false);
  const [isSavingHistoryRetention, setIsSavingHistoryRetention] = useState(false);
  const [isSavingResolutionCategories, setIsSavingResolutionCategories] = useState(false);
  const [isSavingPatternRecognition, setIsSavingPatternRecognition] = useState(false);
  const ignorePatternsSaveTimer = useRef<number | null>(null);
  const copiedScanDiagnosticResetTimer = useRef<number | null>(null);
  const scanWorkerCountInputRef = useRef("4");
  const parallelScanJobsInputRef = useRef("2");
  const comparisonScatterPointLimitInputRef = useRef("5000");
  const historyRetentionInputsRef = useRef<HistoryRetentionInputs>(historyRetentionInputsFromSettings());
  const persistedResolutionCategories = useRef<ResolutionCategory[]>(normalizeResolutionCategories(appSettings.resolution_categories));
  const ignorePatternsRequestId = useRef(0);
  const ignorePatternsSuccessId = useRef(0);
  const persistedIgnorePatterns = useRef<PersistedIgnorePatterns>({ user: [], default: [] });
  const seededDefaultIgnorePatterns = useRef<string[] | null>(null);
  const libraryNameInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const resolutionOptions = normalizeResolutionCategories(appSettings.resolution_categories);
  const resolutionOptionIds = resolutionOptions.map((category) => category.id);
  const resolutionOptionLabels = new Map(resolutionOptions.map((category) => [category.id, category.label]));
  const appScanPerformance = appSettings.scan_performance ?? DEFAULT_SCAN_PERFORMANCE;
  const appHistoryRetention = appSettings.history_retention ?? DEFAULT_HISTORY_RETENTION;
  const { preference: themePref, setPreference: setThemePref } = useTheme();
  const { activeJobs, hasActiveJobs, refresh, trackJob } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const hadActiveHistoryReconstructionRef = useRef(false);
  const isHistoryReconstructionActive =
    historyReconstruction?.status === "queued" || historyReconstruction?.status === "running";

  useEffect(() => {
    return () => {
      if (copiedScanDiagnosticResetTimer.current !== null) {
        window.clearTimeout(copiedScanDiagnosticResetTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const nextInputs = historyRetentionInputsFromSettings(appHistoryRetention);
    historyRetentionInputsRef.current = nextInputs;
    setHistoryRetentionInputs(nextInputs);
  }, [appHistoryRetention]);

  function applyUpdatedAppSettingsState(updated: typeof appSettings) {
    setShowAnalyzedFilesCsvExport(updated.feature_flags.show_analyzed_files_csv_export);
    setShowFullWidthAppShell(updated.feature_flags.show_full_width_app_shell);
    setHideQualityScoreMeter(updated.feature_flags.hide_quality_score_meter);
    setUnlimitedPanelSize(updated.feature_flags.unlimited_panel_size);
    setInDepthDolbyVisionProfiles(updated.feature_flags.in_depth_dolby_vision_profiles);
    const updatedScanPerformance = updated.scan_performance ?? DEFAULT_SCAN_PERFORMANCE;
    scanWorkerCountInputRef.current = String(updatedScanPerformance.scan_worker_count);
    parallelScanJobsInputRef.current = String(updatedScanPerformance.parallel_scan_jobs);
    comparisonScatterPointLimitInputRef.current = String(updatedScanPerformance.comparison_scatter_point_limit);
    setScanWorkerCountInput(scanWorkerCountInputRef.current);
    setParallelScanJobsInput(parallelScanJobsInputRef.current);
    setComparisonScatterPointLimitInput(comparisonScatterPointLimitInputRef.current);
    const nextHistoryRetentionInputs = historyRetentionInputsFromSettings(updated.history_retention ?? DEFAULT_HISTORY_RETENTION);
    historyRetentionInputsRef.current = nextHistoryRetentionInputs;
    setHistoryRetentionInputs(nextHistoryRetentionInputs);
    persistedResolutionCategories.current = normalizeResolutionCategories(updated.resolution_categories);
    setResolutionCategoryDrafts(cloneResolutionCategoryDrafts(persistedResolutionCategories.current));
    setPatternRecognitionInputs(normalizePatternRecognitionInputs(updated.pattern_recognition));
    setAppSettings(updated);
  }

  const refreshHistoryStorage = (showLoading = false) => {
    if (showLoading) {
      setIsLoadingHistoryStorage(true);
    }
    return api
      .historyStorage()
      .then((payload) => {
        setHistoryStorage(payload);
        setHistoryStorageError(null);
        return payload;
      })
      .catch((reason: Error) => {
        setHistoryStorageError(reason.message);
        throw reason;
      })
      .finally(() => {
        if (showLoading) {
          setIsLoadingHistoryStorage(false);
        }
      });
  };

  const refreshHistoryReconstructionStatus = () => {
    return api
      .historyReconstructionStatus()
      .then((payload) => {
        setHistoryReconstruction(payload);
        return payload;
      })
      .catch((reason: Error) => {
        throw reason;
      });
  };

  const refreshRecentScanJobs = (showLoading = false) => {
    if (showLoading) {
      setIsLoadingRecentScanJobs(true);
    }
    return api
      .recentScanJobs({ sinceHours: 24, limit: 200 })
      .then((payload) => {
        setRecentScanJobs(payload.items);
        setHasMoreRecentScanJobs(payload.items.length > 0);
        setRecentScanJobsError(null);
        return payload;
      })
      .catch((reason: Error) => {
        setRecentScanJobsError(reason.message);
        throw reason;
      })
      .finally(() => {
        if (showLoading) {
          setIsLoadingRecentScanJobs(false);
        }
      });
  };

  async function loadMoreRecentScanJobs() {
    if (isLoadingMoreRecentScanJobs || recentScanJobs.length === 0) {
      return;
    }
    const lastJob = recentScanJobs[recentScanJobs.length - 1];
    if (!lastJob.finished_at) {
      return;
    }
    setIsLoadingMoreRecentScanJobs(true);
    try {
      const payload = await api.recentScanJobs({
        limit: 20,
        beforeFinishedAt: lastJob.finished_at,
        beforeId: lastJob.id,
      });
      setRecentScanJobs((current) => [...current, ...payload.items]);
      setHasMoreRecentScanJobs(payload.has_more);
      setRecentScanJobsError(null);
    } catch (reason) {
      setRecentScanJobsError((reason as Error).message);
    } finally {
      setIsLoadingMoreRecentScanJobs(false);
    }
  }

  async function reconstructHistory() {
    if (isHistoryReconstructionActive || hasActiveJobs) {
      return;
    }
    setHistoryRetentionStatus(null);
    try {
      const status = await api.reconstructHistory();
      setHistoryReconstruction(status);
    } catch (reason) {
      setHistoryRetentionStatusTone("error");
      setHistoryRetentionStatus((reason as Error).message);
    }
  }

  const refreshLibraries = (showLoading = false, force = false) => {
    if (showLoading) {
      setIsLoadingLibraries(true);
    }
    return loadLibraries(force)
      .then((payload) => {
        setError(null);
        return payload;
      })
      .catch((reason: Error) => {
        setError(reason.message);
        throw reason;
      })
      .finally(() => {
        if (showLoading) {
          setIsLoadingLibraries(false);
        }
      });
  };

  useEffect(() => {
    if (librariesLoaded) {
      setIsLoadingLibraries(false);
      return;
    }
    void refreshLibraries(true).catch(() => undefined);
  }, [librariesLoaded]);

  useEffect(() => {
    void refreshRecentScanJobs(true).catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshHistoryStorage(true).catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshHistoryReconstructionStatus().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isHistoryReconstructionActive) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshHistoryReconstructionStatus().catch(() => undefined);
    }, HISTORY_RECONSTRUCTION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [isHistoryReconstructionActive]);

  useEffect(() => {
    if (!historyReconstruction) {
      hadActiveHistoryReconstructionRef.current = false;
      return;
    }

    if (hadActiveHistoryReconstructionRef.current && !isHistoryReconstructionActive) {
      if (historyReconstruction.status === "completed" && historyReconstruction.result) {
        void refreshHistoryStorage().catch(() => undefined);
        setHistoryRetentionStatusTone("success");
        setHistoryRetentionStatus(formatHistoryReconstructionStatus(historyReconstruction.result));
      } else if (historyReconstruction.status === "failed") {
        setHistoryRetentionStatusTone("error");
        setHistoryRetentionStatus(historyReconstruction.error ?? t("libraries.historyRetention.reconstructFailed"));
      }
    }

    hadActiveHistoryReconstructionRef.current = isHistoryReconstructionActive;
  }, [historyReconstruction, isHistoryReconstructionActive, t]);

  useEffect(() => {
    setForm((current) =>
      current.path === EMPTY_FORM.path || current.path === ""
        ? createEmptyForm(desktopApp)
        : current
    );
  }, [desktopApp]);

  useEffect(() => {
    setSettingsForms((current) => {
      const next = { ...current };
      for (const library of libraries) {
        if (!next[library.id] || settingsMatchLibrary(library, next[library.id])) {
          next[library.id] = toLibrarySettingsForm(library);
        }
      }
      return next;
    });
  }, [libraries]);

  useEffect(() => {
    if (!desktopApp) {
      setFormPathInspection(null);
      setFormPathInspectionError(null);
      return;
    }
    if (!form.path.trim()) {
      setFormPathInspection(null);
      setFormPathInspectionError(null);
      return;
    }

    let canceled = false;
    void api
      .inspectPath(form.path)
      .then((payload) => {
        if (canceled) {
          return;
        }
        setFormPathInspection(payload);
        setFormPathInspectionError(null);
      })
      .catch((reason: Error) => {
        if (canceled) {
          return;
        }
        setFormPathInspection(null);
        setFormPathInspectionError(reason.message);
      });

    return () => {
      canceled = true;
    };
  }, [desktopApp, form.path]);

  useEffect(() => {
    if (!desktopApp || libraries.length === 0) {
      return;
    }

    let canceled = false;
    void Promise.all(
      libraries.map(async (library) => {
        try {
          const inspection = await api.inspectPath(library.path);
          return [library.id, inspection] as const;
        } catch {
          return [library.id, null] as const;
        }
      })
    ).then((entries) => {
      if (canceled) {
        return;
      }
      setLibraryPathInspections((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      canceled = true;
    };
  }, [desktopApp, libraries]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      void refreshLibraries(false, true).catch(() => undefined);
      void refreshRecentScanJobs().catch(() => undefined);
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [hasActiveJobs]);

  useEffect(() => {
    if (!desktopApp) {
      return;
    }
    setSettingsForms((current) => {
      let changed = false;
      const next = { ...current };
      for (const [libraryIdText, inspection] of Object.entries(libraryPathInspections)) {
        if (!inspection || inspection.watch_supported) {
          continue;
        }
        const libraryId = Number(libraryIdText);
        const formState = next[libraryId];
        if (!formState || formState.scan_mode !== "watch") {
          continue;
        }
        next[libraryId] = {
          ...formState,
          scan_mode: "scheduled",
          interval_minutes: formState.interval_minutes || 60,
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [desktopApp, libraryPathInspections]);

  useEffect(() => {
    if (!qualityPickerOpenKey) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".quality-picker-field-shell")) {
        return;
      }
      setQualityPickerOpenKey(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [qualityPickerOpenKey]);

  useEffect(() => {
    if (appSettingsLoaded) {
      setIsLoadingIgnorePatterns(false);
      setIgnorePatternsLoadError(null);
      return;
    }

    let active = true;
    setIsLoadingIgnorePatterns(true);
    void loadAppSettings()
      .then(() => {
        if (!active) {
          return;
        }
        setIgnorePatternsLoadError(null);
      })
      .catch((reason: Error) => {
        if (!active) {
          return;
        }
        setIgnorePatternsLoadError(reason.message);
      })
      .finally(() => {
        if (active) {
          setIsLoadingIgnorePatterns(false);
        }
      });

    return () => {
      active = false;
    };
  }, [appSettingsLoaded, loadAppSettings]);

  useEffect(() => {
    if (!appSettingsLoaded) {
      return;
    }
    const persisted = toPersistedIgnorePatterns(appSettings);
    const persistedResolution = normalizeResolutionCategories(appSettings.resolution_categories);
    persistedIgnorePatterns.current = persisted;
    if (seededDefaultIgnorePatterns.current === null) {
      seededDefaultIgnorePatterns.current = [...persisted.default];
    }
    persistedResolutionCategories.current = persistedResolution;
    ignorePatternsSuccessId.current = ignorePatternsRequestId.current;
    setUserIgnorePatternInputs(persisted.user);
    setDefaultIgnorePatternInputs(persisted.default);
    setPatternRecognitionInputs(normalizePatternRecognitionInputs(appSettings.pattern_recognition));
    setResolutionCategoryDrafts(cloneResolutionCategoryDrafts(persistedResolution));
    setShowAnalyzedFilesCsvExport(appSettings.feature_flags.show_analyzed_files_csv_export);
    setShowFullWidthAppShell(appSettings.feature_flags.show_full_width_app_shell);
    setHideQualityScoreMeter(appSettings.feature_flags.hide_quality_score_meter);
    setUnlimitedPanelSize(appSettings.feature_flags.unlimited_panel_size);
    setInDepthDolbyVisionProfiles(appSettings.feature_flags.in_depth_dolby_vision_profiles);
    scanWorkerCountInputRef.current = String(appScanPerformance.scan_worker_count);
    parallelScanJobsInputRef.current = String(appScanPerformance.parallel_scan_jobs);
    comparisonScatterPointLimitInputRef.current = String(appScanPerformance.comparison_scatter_point_limit);
    setScanWorkerCountInput(scanWorkerCountInputRef.current);
    setParallelScanJobsInput(parallelScanJobsInputRef.current);
    setComparisonScatterPointLimitInput(comparisonScatterPointLimitInputRef.current);
  }, [appScanPerformance, appSettings, appSettingsLoaded]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(autoSaveTimers.current)) {
        window.clearTimeout(timer);
      }
      if (ignorePatternsSaveTimer.current) {
        window.clearTimeout(ignorePatternsSaveTimer.current);
      }
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const created = await api.createLibrary(form);
      upsertLibrary(created);
      setForm(createEmptyForm(desktopApp));
      setFormPathInspection(null);
      setFormPathInspectionError(null);
      setSubmitError(null);
    } catch (reason) {
      setSubmitError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function selectDesktopLibraryPath() {
    const selectedPath = await desktopBridge?.selectLibraryPath();
    if (!selectedPath) {
      return;
    }
    setForm((current) => ({ ...current, path: selectedPath }));
    setSubmitError(null);
  }

  function updateLibraryForm(
    libraryId: number,
    patch: Partial<LibrarySettingsForm>,
  ) {
    const current = settingsForms[libraryId] ?? {
      scan_mode: "manual",
      duplicate_detection_mode: "off",
      interval_minutes: 60,
      debounce_seconds: 15,
      quality_profile: cloneQualityProfile(DEFAULT_QUALITY_PROFILE),
    };
    const inspection = libraryPathInspections[libraryId];
    const next = { ...current, ...patch };
    if (desktopApp && next.scan_mode === "watch" && inspection && !inspection.watch_supported) {
      next.scan_mode = "scheduled";
      next.interval_minutes = next.interval_minutes || 60;
      setLibraryMessages((messages) => ({
        ...messages,
        [libraryId]: t("libraries.watchUnavailableNetwork"),
      }));
    }
    setSettingsForms((forms) => ({
      ...forms,
      [libraryId]: next,
    }));
    if (!(desktopApp && next.scan_mode === "scheduled" && inspection && !inspection.watch_supported)) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
    }

    if (autoSaveTimers.current[libraryId]) {
      window.clearTimeout(autoSaveTimers.current[libraryId]);
    }

    autoSaveTimers.current[libraryId] = window.setTimeout(async () => {
      try {
        const updated = await api.updateLibrarySettings(libraryId, {
          scan_mode: next.scan_mode,
          duplicate_detection_mode: next.duplicate_detection_mode,
          scan_config: buildScanConfig(next),
          quality_profile: next.quality_profile,
        });
        upsertLibrary(updated);
        setSettingsForms((forms) => ({
          ...forms,
          [libraryId]: toLibrarySettingsForm(updated),
        }));
        setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
      } catch (reason) {
        setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
      } finally {
        delete autoSaveTimers.current[libraryId];
      }
    }, 450);
  }

  function updateLibraryQualityProfile(
    libraryId: number,
    transform: (current: QualityProfile) => QualityProfile,
  ) {
    const fallback =
      libraries.find((library) => library.id === libraryId)?.quality_profile ?? DEFAULT_QUALITY_PROFILE;
    const current = settingsForms[libraryId]?.quality_profile ?? cloneQualityProfile(fallback);
    updateLibraryForm(libraryId, { quality_profile: transform(cloneQualityProfile(current)) });
  }

  async function persistPendingLibrarySettings(libraryId: number): Promise<string | null> {
    const current = settingsForms[libraryId];
    if (!(current && autoSaveTimers.current[libraryId])) {
      return null;
    }

    window.clearTimeout(autoSaveTimers.current[libraryId]);
    delete autoSaveTimers.current[libraryId];
    try {
      const updated = await api.updateLibrarySettings(libraryId, {
        scan_mode: current.scan_mode,
        duplicate_detection_mode: current.duplicate_detection_mode,
        scan_config: buildScanConfig(current),
        quality_profile: current.quality_profile,
      });
      upsertLibrary(updated);
      return null;
    } catch (reason) {
      const message = (reason as Error).message;
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: message }));
      return message;
    }
  }

  async function requestLibraryScan(libraryId: number, scanType: "incremental" | "full"): Promise<string | null> {
    const settingsError = await persistPendingLibrarySettings(libraryId);
    if (settingsError) {
      return settingsError;
    }

    try {
      const job = await api.scanLibrary(libraryId, scanType);
      trackJob(job);
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
      return null;
    } catch (reason) {
      const message = (reason as Error).message;
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: message }));
      return message;
    }
  }

  async function runLibraryScan(libraryId: number) {
    await requestLibraryScan(libraryId, "incremental");
  }

  async function runFullScanForAllLibraries() {
    if (!libraries.length || isRunningFullScanAll) {
      return;
    }

    setIsRunningFullScanAll(true);
    try {
      for (const library of libraries) {
        await requestLibraryScan(library.id, "full");
      }
    } finally {
      setIsRunningFullScanAll(false);
    }
  }

  async function toggleLibraryDashboardVisibility(library: LibrarySummary) {
    if (dashboardVisibilityPending[library.id]) {
      return;
    }

    const nextShowOnDashboard = !library.show_on_dashboard;
    setDashboardVisibilityPending((current) => ({ ...current, [library.id]: true }));
    upsertLibrary({ ...library, show_on_dashboard: nextShowOnDashboard });

    try {
      const updated = await api.updateLibrarySettings(library.id, {
        show_on_dashboard: nextShowOnDashboard,
      });
      upsertLibrary(updated);
      setLibraryMessages((messages) => ({ ...messages, [library.id]: null }));
      await loadDashboard(true);
    } catch (reason) {
      upsertLibrary(library);
      setLibraryMessages((messages) => ({ ...messages, [library.id]: (reason as Error).message }));
    } finally {
      setDashboardVisibilityPending((current) => {
        const next = { ...current };
        delete next[library.id];
        return next;
      });
    }
  }

  function startEditingLibraryIdentity(library: LibrarySummary) {
    setLibraryIdentityForms((current) => ({
      ...current,
      [library.id]: toLibraryIdentityForm(library),
    }));
    setLibraryMessages((messages) => ({ ...messages, [library.id]: null }));
    window.requestAnimationFrame(() => {
      const input = libraryNameInputRefs.current[library.id];
      input?.focus();
      input?.select();
    });
  }

  function stopEditingLibraryIdentity(libraryId: number) {
    setLibraryIdentityForms((current) => {
      const next = { ...current };
      delete next[libraryId];
      return next;
    });
    setLibraryIdentityPending((current) => {
      if (!(libraryId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[libraryId];
      return next;
    });
  }

  function updateLibraryIdentityForm(libraryId: number, patch: Partial<LibraryIdentityForm>) {
    setLibraryIdentityForms((current) => {
      const existing = current[libraryId];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [libraryId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  async function saveLibraryIdentity(library: LibrarySummary) {
    const draft = libraryIdentityForms[library.id] ?? toLibraryIdentityForm(library);
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setLibraryMessages((messages) => ({ ...messages, [library.id]: t("libraries.nameRequired") }));
      return;
    }
    if (trimmedName === library.name && draft.type === library.type) {
      stopEditingLibraryIdentity(library.id);
      return;
    }

    setLibraryIdentityPending((current) => ({ ...current, [library.id]: true }));
    try {
      const updated = await api.updateLibrarySettings(library.id, {
        name: trimmedName,
        type: draft.type,
      });
      upsertLibrary(updated);
      stopEditingLibraryIdentity(library.id);
      setLibraryMessages((messages) => ({ ...messages, [library.id]: null }));
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [library.id]: (reason as Error).message }));
    } finally {
      setLibraryIdentityPending((current) => {
        const next = { ...current };
        delete next[library.id];
        return next;
      });
    }
  }

  function handleLibraryIdentityEditorKeyDown(
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    library: LibrarySummary,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      stopEditingLibraryIdentity(library.id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void saveLibraryIdentity(library);
    }
  }

  async function removeLibrary(libraryId: number) {
    try {
      await api.deleteLibrary(libraryId);
      removeLibraryFromStore(libraryId);
      setSettingsForms((currentForms) => {
        const next = { ...currentForms };
        delete next[libraryId];
        return next;
      });
      setLibraryMessages((messages) => {
        const next = { ...messages };
        delete next[libraryId];
        return next;
      });
      stopEditingLibraryIdentity(libraryId);
      await refresh();
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
    }
  }

  function persistIgnorePatternSectionStateValue(
    nextState: Parameters<typeof saveIgnorePatternSectionState>[0],
  ) {
    setIgnorePatternSectionState(saveIgnorePatternSectionState(nextState));
  }

  function toggleIgnorePatternSection() {
    persistIgnorePatternSectionStateValue({
      ...ignorePatternSectionState,
      combinedExpanded: !ignorePatternSectionState.combinedExpanded,
    });
  }

  function togglePatternRecognitionSection(section: PatternSectionKey) {
    setPatternRecognitionSectionState((current) =>
      savePatternRecognitionSectionState({
        ...current,
        [section]: !current[section],
      }),
    );
  }

  function toggleSettingsPanel(panelId: SettingsPanelId) {
    setSettingsPanelState((current) =>
      saveSettingsPanelState({
        ...current,
        [panelId]: !current[panelId],
      }),
    );
  }

  async function toggleScanJobExpansion(jobId: number) {
    const nextOpen = !expandedScanJobIds[jobId];
    setExpandedScanJobIds((current) => ({ ...current, [jobId]: nextOpen }));
    if (!nextOpen || scanJobDetails[jobId] || scanJobDetailLoading[jobId]) {
      return;
    }
    setScanJobDetailLoading((current) => ({ ...current, [jobId]: true }));
    setScanJobDetailErrors((current) => ({ ...current, [jobId]: null }));
    try {
      const payload = await api.scanJobDetail(jobId);
      setScanJobDetails((current) => ({ ...current, [jobId]: payload }));
    } catch (reason) {
      setScanJobDetailErrors((current) => ({ ...current, [jobId]: (reason as Error).message }));
    } finally {
      setScanJobDetailLoading((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });
    }
  }

  async function persistAppSettingsSnapshot(
    nextUserPatterns: string[],
    nextDefaultPatterns: string[],
    nextShowAnalyzedFilesCsvExport: boolean,
    nextShowFullWidthAppShell: boolean,
    nextHideQualityScoreMeter: boolean,
    nextUnlimitedPanelSize: boolean,
    nextResolutionCategories?: ResolutionCategory[],
    nextHistoryRetention = appHistoryRetention,
    nextScanPerformance = {
      scan_worker_count: normalizeScanPerformanceInput(
        scanWorkerCountInputRef.current,
        appScanPerformance.scan_worker_count,
        SCAN_WORKER_COUNT_MIN,
        SCAN_WORKER_COUNT_MAX,
      ),
      parallel_scan_jobs: normalizeScanPerformanceInput(
        parallelScanJobsInputRef.current,
        appScanPerformance.parallel_scan_jobs,
        PARALLEL_SCAN_JOB_COUNT_MIN,
        PARALLEL_SCAN_JOB_COUNT_MAX,
      ),
      comparison_scatter_point_limit: normalizeScanPerformanceInput(
        comparisonScatterPointLimitInputRef.current,
        appScanPerformance.comparison_scatter_point_limit,
        COMPARISON_SCATTER_POINT_LIMIT_MIN,
        COMPARISON_SCATTER_POINT_LIMIT_MAX,
      ),
    },
  ) {
    return api.updateAppSettings({
      user_ignore_patterns: normalizeIgnorePatterns(nextUserPatterns),
      default_ignore_patterns: normalizeIgnorePatterns(nextDefaultPatterns),
      ...(nextResolutionCategories ? { resolution_categories: normalizeResolutionCategories(nextResolutionCategories) } : {}),
      scan_performance: nextScanPerformance,
      history_retention: nextHistoryRetention,
      feature_flags: {
        show_analyzed_files_csv_export: nextShowAnalyzedFilesCsvExport,
        show_full_width_app_shell: nextShowFullWidthAppShell,
        hide_quality_score_meter: nextHideQualityScoreMeter,
        unlimited_panel_size: nextUnlimitedPanelSize,
        in_depth_dolby_vision_profiles: inDepthDolbyVisionProfiles,
      },
    });
  }

  async function persistIgnorePatterns(
    nextUserPatterns: string[],
    nextDefaultPatterns: string[],
    nextShowAnalyzedFilesCsvExport = showAnalyzedFilesCsvExport,
    nextShowFullWidthAppShell = showFullWidthAppShell,
    nextHideQualityScoreMeter = hideQualityScoreMeter,
    nextUnlimitedPanelSize = unlimitedPanelSize,
    nextResolutionCategories?: ResolutionCategory[],
  ) {
    const requestId = ignorePatternsRequestId.current + 1;
    ignorePatternsRequestId.current = requestId;
    setIsSavingIgnorePatterns(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        nextUserPatterns,
        nextDefaultPatterns,
        nextShowAnalyzedFilesCsvExport,
        nextShowFullWidthAppShell,
        nextHideQualityScoreMeter,
        nextUnlimitedPanelSize,
        nextResolutionCategories,
      );
      const persisted = toPersistedIgnorePatterns(updated);
      if (requestId > ignorePatternsSuccessId.current) {
        ignorePatternsSuccessId.current = requestId;
        persistedIgnorePatterns.current = persisted;
      }
      if (requestId === ignorePatternsRequestId.current) {
        setUserIgnorePatternInputs(persisted.user);
        setDefaultIgnorePatternInputs(persisted.default);
        applyUpdatedAppSettingsState(updated);
        setIgnorePatternsStatus(null);
        setFeatureFlagsStatus(null);
        setScanPerformanceStatus(null);
        setHistoryRetentionStatus(null);
        setResolutionCategoriesStatus(null);
        setPatternRecognitionStatus(null);
      }
      void refreshHistoryStorage().catch(() => undefined);
      return persisted;
    } catch (reason) {
      if (requestId === ignorePatternsRequestId.current) {
        setUserIgnorePatternInputs(persistedIgnorePatterns.current.user);
        setDefaultIgnorePatternInputs(persistedIgnorePatterns.current.default);
        setIgnorePatternsStatus((reason as Error).message);
      }
      return null;
    } finally {
      if (requestId === ignorePatternsRequestId.current) {
        setIsSavingIgnorePatterns(false);
      }
    }
  }

  async function toggleAnalyzedFilesCsvExport(enabled: boolean) {
    const previousValue = showAnalyzedFilesCsvExport;
    setShowAnalyzedFilesCsvExport(enabled);
    setFeatureFlagsStatus(null);
    setIsSavingFeatureFlags(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        enabled,
        showFullWidthAppShell,
        hideQualityScoreMeter,
        unlimitedPanelSize,
      );
      applyUpdatedAppSettingsState(updated);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      setShowAnalyzedFilesCsvExport(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
    }
  }

  async function toggleFullWidthAppShell(enabled: boolean) {
    const previousValue = showFullWidthAppShell;
    setShowFullWidthAppShell(enabled);
    setFeatureFlagsStatus(null);
    setIsSavingFeatureFlags(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        showAnalyzedFilesCsvExport,
        enabled,
        hideQualityScoreMeter,
        unlimitedPanelSize,
      );
      applyUpdatedAppSettingsState(updated);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      setShowFullWidthAppShell(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
    }
  }

  async function toggleHideQualityScoreMeter(enabled: boolean) {
    const previousValue = hideQualityScoreMeter;
    setHideQualityScoreMeter(enabled);
    setFeatureFlagsStatus(null);
    setIsSavingFeatureFlags(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        showAnalyzedFilesCsvExport,
        showFullWidthAppShell,
        enabled,
        unlimitedPanelSize,
      );
      applyUpdatedAppSettingsState(updated);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      setHideQualityScoreMeter(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
    }
  }

  async function toggleUnlimitedPanelSize(enabled: boolean) {
    const previousValue = unlimitedPanelSize;
    setUnlimitedPanelSize(enabled);
    setFeatureFlagsStatus(null);
    setIsSavingFeatureFlags(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        showAnalyzedFilesCsvExport,
        showFullWidthAppShell,
        hideQualityScoreMeter,
        enabled,
      );
      applyUpdatedAppSettingsState(updated);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      setUnlimitedPanelSize(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
    }
  }

  async function toggleInDepthDolbyVisionProfiles(enabled: boolean) {
    const previousValue = inDepthDolbyVisionProfiles;
    setInDepthDolbyVisionProfiles(enabled);
    setFeatureFlagsStatus(null);
    setIsSavingFeatureFlags(true);
    try {
      const updated = await api.updateAppSettings({
        user_ignore_patterns: normalizeIgnorePatterns(userIgnorePatternInputs),
        default_ignore_patterns: normalizeIgnorePatterns(defaultIgnorePatternInputs),
        scan_performance: {
          scan_worker_count: normalizeScanPerformanceInput(
            scanWorkerCountInputRef.current,
            appScanPerformance.scan_worker_count,
            SCAN_WORKER_COUNT_MIN,
            SCAN_WORKER_COUNT_MAX,
          ),
          parallel_scan_jobs: normalizeScanPerformanceInput(
            parallelScanJobsInputRef.current,
            appScanPerformance.parallel_scan_jobs,
            PARALLEL_SCAN_JOB_COUNT_MIN,
            PARALLEL_SCAN_JOB_COUNT_MAX,
          ),
          comparison_scatter_point_limit: normalizeScanPerformanceInput(
            comparisonScatterPointLimitInputRef.current,
            appScanPerformance.comparison_scatter_point_limit,
            COMPARISON_SCATTER_POINT_LIMIT_MIN,
            COMPARISON_SCATTER_POINT_LIMIT_MAX,
          ),
        },
        history_retention: appHistoryRetention,
        feature_flags: {
          show_analyzed_files_csv_export: showAnalyzedFilesCsvExport,
          show_full_width_app_shell: showFullWidthAppShell,
          hide_quality_score_meter: hideQualityScoreMeter,
          unlimited_panel_size: unlimitedPanelSize,
          in_depth_dolby_vision_profiles: enabled,
        },
      });
      applyUpdatedAppSettingsState(updated);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      setInDepthDolbyVisionProfiles(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
    }
  }

  function updateScanWorkerCountInput(value: string) {
    scanWorkerCountInputRef.current = value;
    setScanWorkerCountInput(value);
    setScanPerformanceStatus(null);
  }

  function updateParallelScanJobsInput(value: string) {
    parallelScanJobsInputRef.current = value;
    setParallelScanJobsInput(value);
    setScanPerformanceStatus(null);
  }

  function updateComparisonScatterPointLimitInput(value: string) {
    comparisonScatterPointLimitInputRef.current = value;
    setComparisonScatterPointLimitInput(value);
    setScanPerformanceStatus(null);
  }

  function updateHistoryRetentionInput(
    bucket: HistoryRetentionBucketKey,
    field: "days" | "storage_limit_gb",
    value: string,
  ) {
    historyRetentionInputsRef.current = {
      ...historyRetentionInputsRef.current,
      [bucket]: {
        ...historyRetentionInputsRef.current[bucket],
        [field]: value,
      },
    };
    setHistoryRetentionInputs((current) => ({
      ...current,
      [bucket]: {
        ...current[bucket],
        [field]: value,
      },
    }));
    setHistoryRetentionStatus(null);
  }

  async function saveHistoryRetention(bucket: HistoryRetentionBucketKey) {
    const currentBucket = appHistoryRetention[bucket];
    const nextBucketInputs = historyRetentionInputsRef.current[bucket];
    const nextHistoryRetention = {
      ...appHistoryRetention,
      [bucket]: {
        days: normalizeHistoryRetentionDaysInput(nextBucketInputs.days, currentBucket.days),
        storage_limit_gb: normalizeHistoryRetentionStorageInput(
          nextBucketInputs.storage_limit_gb,
          currentBucket.storage_limit_gb,
        ),
      },
    };

    setIsSavingHistoryRetention(true);
    setHistoryRetentionStatus(null);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        showAnalyzedFilesCsvExport,
        showFullWidthAppShell,
        hideQualityScoreMeter,
        unlimitedPanelSize,
        undefined,
        nextHistoryRetention,
      );
      applyUpdatedAppSettingsState(updated);
      setIgnorePatternsStatus(null);
      setFeatureFlagsStatus(null);
      setScanPerformanceStatus(null);
      setResolutionCategoriesStatus(null);
      setHistoryRetentionStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      const revertedInputs = historyRetentionInputsFromSettings(appHistoryRetention);
      historyRetentionInputsRef.current = revertedInputs;
      setHistoryRetentionInputs(revertedInputs);
      setHistoryRetentionStatusTone("error");
      setHistoryRetentionStatus((reason as Error).message);
    } finally {
      setIsSavingHistoryRetention(false);
    }
  }

  function updateResolutionCategoryDraft(index: number, patch: Partial<ResolutionCategoryDraft>) {
    setResolutionCategoryDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)),
    );
    setResolutionCategoriesStatus(null);
  }

  function updateNewResolutionCategoryDraft(patch: Partial<NewResolutionCategoryDraft>) {
    setNewResolutionCategoryDraft((current) => ({ ...current, ...patch }));
    setResolutionCategoriesStatus(null);
  }

  async function saveResolutionCategories(drafts: ResolutionCategoryDraft[] = resolutionCategoryDrafts) {
    const nextCategories = resolutionCategoriesFromDrafts(drafts);
    const changeKind = resolutionCategoryChangeSummary(persistedResolutionCategories.current, nextCategories);
    if (changeKind === "none") {
      setResolutionCategoriesStatus(null);
      return;
    }

    setIsSavingResolutionCategories(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        showAnalyzedFilesCsvExport,
        showFullWidthAppShell,
        hideQualityScoreMeter,
        unlimitedPanelSize,
        nextCategories,
      );
      const normalized = normalizeResolutionCategories(updated.resolution_categories);
      persistedResolutionCategories.current = normalized;
      setResolutionCategoryDrafts(cloneResolutionCategoryDrafts(normalized));
      setResolutionCategoriesStatus(null);
      setIgnorePatternsStatus(null);
      setFeatureFlagsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      applyUpdatedAppSettingsState(updated);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      setResolutionCategoriesStatus((reason as Error).message);
    } finally {
      setIsSavingResolutionCategories(false);
    }
  }

  async function saveScanPerformance(
    nextScanWorkerInput = scanWorkerCountInputRef.current,
    nextParallelScanJobsInput = parallelScanJobsInputRef.current,
    nextComparisonScatterPointLimitInput = comparisonScatterPointLimitInputRef.current,
  ) {
    const nextScanWorkerCount = normalizeScanPerformanceInput(
      nextScanWorkerInput,
      appScanPerformance.scan_worker_count,
      SCAN_WORKER_COUNT_MIN,
      SCAN_WORKER_COUNT_MAX,
    );
    const nextParallelScanJobs = normalizeScanPerformanceInput(
      nextParallelScanJobsInput,
      appScanPerformance.parallel_scan_jobs,
      PARALLEL_SCAN_JOB_COUNT_MIN,
      PARALLEL_SCAN_JOB_COUNT_MAX,
    );
    const nextComparisonScatterPointLimit = normalizeScanPerformanceInput(
      nextComparisonScatterPointLimitInput,
      appScanPerformance.comparison_scatter_point_limit,
      COMPARISON_SCATTER_POINT_LIMIT_MIN,
      COMPARISON_SCATTER_POINT_LIMIT_MAX,
    );

    setIsSavingScanPerformance(true);
    setScanPerformanceStatus(null);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        showAnalyzedFilesCsvExport,
        showFullWidthAppShell,
        hideQualityScoreMeter,
        unlimitedPanelSize,
        undefined,
        appHistoryRetention,
        {
          scan_worker_count: nextScanWorkerCount,
          parallel_scan_jobs: nextParallelScanJobs,
          comparison_scatter_point_limit: nextComparisonScatterPointLimit,
        },
      );
      applyUpdatedAppSettingsState(updated);
      setIgnorePatternsStatus(null);
      setFeatureFlagsStatus(null);
      setResolutionCategoriesStatus(null);
      setHistoryRetentionStatus(null);
      setPatternRecognitionStatus(null);
      setScanPerformanceStatus(null);
      void refreshHistoryStorage().catch(() => undefined);
    } catch (reason) {
      scanWorkerCountInputRef.current = String(appScanPerformance.scan_worker_count);
      parallelScanJobsInputRef.current = String(appScanPerformance.parallel_scan_jobs);
      comparisonScatterPointLimitInputRef.current = String(appScanPerformance.comparison_scatter_point_limit);
      setScanWorkerCountInput(scanWorkerCountInputRef.current);
      setParallelScanJobsInput(parallelScanJobsInputRef.current);
      setComparisonScatterPointLimitInput(comparisonScatterPointLimitInputRef.current);
      setScanPerformanceStatus((reason as Error).message);
    } finally {
      setIsSavingScanPerformance(false);
    }
  }

  async function addResolutionCategoryDraft() {
    const label = newResolutionCategoryDraft.label.trim();
    if (!label) {
      return;
    }

    const nextDrafts = [...resolutionCategoryDrafts];
    nextDrafts.splice(Math.max(0, nextDrafts.length - 1), 0, {
      id: createResolutionCategoryId(label, resolutionCategoryDrafts),
      label,
      min_width: Math.max(0, Number(newResolutionCategoryDraft.min_width) || 0),
      min_height: Math.max(0, Number(newResolutionCategoryDraft.min_height) || 0),
      persisted: false,
    });
    setResolutionCategoryDrafts(nextDrafts);
    setNewResolutionCategoryDraft(EMPTY_NEW_RESOLUTION_CATEGORY_DRAFT);
    setResolutionCategoriesStatus(null);
    await saveResolutionCategories(nextDrafts);
  }

  async function removeResolutionCategoryDraft(index: number) {
    const nextDrafts = resolutionCategoryDrafts.filter((_, draftIndex) => draftIndex !== index);
    setResolutionCategoryDrafts(nextDrafts);
    setResolutionCategoriesStatus(null);
    await saveResolutionCategories(nextDrafts);
  }

  async function restoreDefaultResolutionCategories() {
    const nextDrafts = cloneResolutionCategoryDrafts(DEFAULT_RESOLUTION_CATEGORIES);
    setResolutionCategoryDrafts(nextDrafts);
    setResolutionCategoriesStatus(null);
    await saveResolutionCategories(nextDrafts);
  }

  function scheduleIgnorePatternsSave(nextPatterns: string[], nextDefaultPatterns: string[] = []) {
    setUserIgnorePatternInputs(nextPatterns);
    setDefaultIgnorePatternInputs(nextDefaultPatterns);
    setIgnorePatternsStatus(null);
    if (ignorePatternsSaveTimer.current) {
      window.clearTimeout(ignorePatternsSaveTimer.current);
    }
    ignorePatternsSaveTimer.current = window.setTimeout(() => {
      ignorePatternsSaveTimer.current = null;
      void persistIgnorePatterns(nextPatterns, nextDefaultPatterns);
    }, 450);
  }

  function flushIgnorePatternsSave(nextPatterns: string[], nextDefaultPatterns: string[] = []) {
    if (ignorePatternsSaveTimer.current) {
      window.clearTimeout(ignorePatternsSaveTimer.current);
      ignorePatternsSaveTimer.current = null;
    }
    return persistIgnorePatterns(nextPatterns, nextDefaultPatterns);
  }

  async function addIgnorePattern() {
    const candidate = ignorePatternDraft.trim();
    if (!candidate) {
      return;
    }
    const updated = await flushIgnorePatternsSave([...combinedIgnorePatterns(), candidate]);
    if (updated) {
      setIgnorePatternDraft("");
    }
  }

  async function removeIgnorePattern(index: number) {
    const nextPatterns = combinedIgnorePatterns().filter((_, rowIndex) => rowIndex !== index);
    setUserIgnorePatternInputs(nextPatterns);
    setDefaultIgnorePatternInputs([]);
    await flushIgnorePatternsSave(nextPatterns);
  }

  function updateIgnorePattern(index: number, value: string) {
    const nextPatterns = combinedIgnorePatterns().map((pattern, rowIndex) => (rowIndex === index ? value : pattern));
    scheduleIgnorePatternsSave(nextPatterns);
  }

  async function finalizeIgnorePatternEdit(index: number) {
    const sourcePatterns = combinedIgnorePatterns();
    const currentValue = sourcePatterns[index];
    if (currentValue === undefined) {
      return;
    }
    const nextPatterns = sourcePatterns.map((pattern, rowIndex) => (rowIndex === index ? pattern.trim() : pattern));
    setUserIgnorePatternInputs(nextPatterns);
    setDefaultIgnorePatternInputs([]);
    await flushIgnorePatternsSave(nextPatterns);
  }

  function patternListValue(settings: PatternRecognitionSettings, key: PatternSectionKey): string[] {
    switch (key) {
      case "series_folder_regexes":
      case "season_folder_regexes":
        return settings.show_season_patterns[key];
      case "bonus_folder_patterns":
        return [...settings.bonus_content.user_folder_patterns, ...settings.bonus_content.default_folder_patterns];
    }
  }

  function updatePatternListValue(
    settings: PatternRecognitionSettings,
    key: PatternSectionKey,
    patterns: string[],
  ): PatternRecognitionSettings {
    if (key === "series_folder_regexes" || key === "season_folder_regexes") {
      return {
        ...settings,
        show_season_patterns: {
          ...settings.show_season_patterns,
          [key]: patterns,
        },
      };
    }
    const nextPatterns = patterns.map((pattern) => pattern.trim());
    return {
      ...settings,
      analyze_bonus_content: true,
      bonus_content: {
        ...settings.bonus_content,
        user_folder_patterns: nextPatterns,
        default_folder_patterns: [],
        effective_folder_patterns: nextPatterns,
        user_file_patterns: [],
        default_file_patterns: [],
        effective_file_patterns: [],
      },
    };
  }

  async function savePatternRecognition(nextSettings: PatternRecognitionSettings) {
    const normalizedSettings = normalizePatternRecognitionInputs(nextSettings);
    setPatternRecognitionInputs(normalizedSettings);
    setIsSavingPatternRecognition(true);
    setPatternRecognitionStatus(null);
    try {
      const updated = await api.updateAppSettings({
        pattern_recognition: {
          analyze_bonus_content: true,
          show_season_patterns: {
            recognition_mode: normalizedSettings.show_season_patterns.recognition_mode,
            series_folder_depth: normalizedSettings.show_season_patterns.series_folder_depth,
            season_folder_depth: normalizedSettings.show_season_patterns.season_folder_depth,
            series_folder_regexes: normalizedSettings.show_season_patterns.series_folder_regexes,
            season_folder_regexes: normalizedSettings.show_season_patterns.season_folder_regexes,
          },
          bonus_content: {
            user_folder_patterns: normalizedSettings.bonus_content.user_folder_patterns,
            default_folder_patterns: normalizedSettings.bonus_content.default_folder_patterns,
            user_file_patterns: [],
            default_file_patterns: [],
          },
        },
      });
      applyUpdatedAppSettingsState(updated);
      setIgnorePatternsStatus(null);
      setFeatureFlagsStatus(null);
      setScanPerformanceStatus(null);
      setHistoryRetentionStatus(null);
      setResolutionCategoriesStatus(null);
    } catch (reason) {
      setPatternRecognitionInputs(normalizePatternRecognitionInputs(appSettings.pattern_recognition));
      setPatternRecognitionStatus((reason as Error).message);
    } finally {
      setIsSavingPatternRecognition(false);
    }
  }

  async function addPatternRecognitionEntry(key: PatternSectionKey) {
    const candidate = patternRecognitionDrafts[key].trim();
    if (!candidate) {
      return;
    }
    const nextSettings = updatePatternListValue(
      patternRecognitionInputs,
      key,
      [...patternListValue(patternRecognitionInputs, key), candidate],
    );
    await savePatternRecognition(nextSettings);
    setPatternRecognitionDrafts((current) => ({ ...current, [key]: "" }));
  }

  async function removePatternRecognitionEntry(key: PatternSectionKey, index: number) {
    const nextPatterns = patternListValue(patternRecognitionInputs, key).filter((_, rowIndex) => rowIndex !== index);
    await savePatternRecognition(updatePatternListValue(patternRecognitionInputs, key, nextPatterns));
  }

  function updatePatternRecognitionEntry(key: PatternSectionKey, index: number, value: string) {
    const nextPatterns = patternListValue(patternRecognitionInputs, key).map((pattern, rowIndex) =>
      rowIndex === index ? value : pattern,
    );
    setPatternRecognitionInputs(updatePatternListValue(patternRecognitionInputs, key, nextPatterns));
    setPatternRecognitionStatus(null);
  }

  async function finalizePatternRecognitionEntry(key: PatternSectionKey, index: number) {
    const nextPatterns = patternListValue(patternRecognitionInputs, key).map((pattern, rowIndex) =>
      rowIndex === index ? pattern.trim() : pattern,
    );
    await savePatternRecognition(updatePatternListValue(patternRecognitionInputs, key, nextPatterns));
  }

  async function restoreDefaultShowSeasonPatterns() {
    await savePatternRecognition({
      ...patternRecognitionInputs,
      show_season_patterns: DEFAULT_SHOW_SEASON_PATTERN_INPUTS,
    });
  }

  async function restoreDefaultBonusPatterns() {
    const defaultFolderPatterns = defaultBonusFolderPatternInputs();
    await savePatternRecognition({
      ...patternRecognitionInputs,
      bonus_content: {
        ...patternRecognitionInputs.bonus_content,
        user_folder_patterns: [],
        default_folder_patterns: defaultFolderPatterns,
        effective_folder_patterns: defaultFolderPatterns,
        user_file_patterns: [],
        default_file_patterns: [],
        effective_file_patterns: [],
      },
    });
  }

  async function restoreDefaultIgnorePatterns() {
    const defaultPatterns = [...(seededDefaultIgnorePatterns.current ?? appSettings.default_ignore_patterns ?? [])];
    setUserIgnorePatternInputs([]);
    setDefaultIgnorePatternInputs(defaultPatterns);
    setIgnorePatternDraft("");
    await flushIgnorePatternsSave([], defaultPatterns);
  }

  async function updateShowSeasonRecognitionMode(mode: "folder_depth" | "regex") {
    await savePatternRecognition({
      ...patternRecognitionInputs,
      show_season_patterns: {
        ...patternRecognitionInputs.show_season_patterns,
        recognition_mode: mode,
      },
    });
  }

  async function updateShowSeasonDepth(key: "series_folder_depth" | "season_folder_depth", value: number) {
    const nextShowSeasonPatterns = {
      ...patternRecognitionInputs.show_season_patterns,
      [key]: value,
    };
    if (key === "series_folder_depth" && nextShowSeasonPatterns.season_folder_depth <= value) {
      nextShowSeasonPatterns.season_folder_depth = value + 1;
    }
    if (key === "season_folder_depth" && value <= nextShowSeasonPatterns.series_folder_depth) {
      nextShowSeasonPatterns.series_folder_depth = Math.max(1, value - 1);
    }
    await savePatternRecognition({
      ...patternRecognitionInputs,
      show_season_patterns: nextShowSeasonPatterns,
    });
  }

  function renderScanPathList(
    title: string,
    count: number,
    paths: string[],
    truncatedCount = 0,
    summary = "",
  ) {
    return (
      <details className="scan-log-detail-block scan-log-collapsible-block">
        <summary className="scan-log-collapse-toggle">
          <span className="scan-log-collapse-copy">
            <strong>{title}</strong>
            {summary ? <span className="scan-log-collapse-summary">{summary}</span> : null}
          </span>
          <span className="scan-log-collapse-meta">
            <span className="badge">{count}</span>
            <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
          </span>
        </summary>
        <div className="scan-log-collapse-content">
          {paths.length > 0 ? (
            <div className="scan-log-path-list">
              {paths.map((path) => (
                <code key={`${title}-${path}`} className="scan-log-path">
                  {path}
                </code>
              ))}
            </div>
          ) : (
            <div className="notice scan-log-empty-detail">{t("scanLogs.none")}</div>
          )}
          {truncatedCount > 0 ? <div className="subtitle">{t("scanLogs.moreEntries", { count: truncatedCount })}</div> : null}
        </div>
      </details>
    );
  }

  async function copyScanFailureDiagnostic(
    job: ScanJobDetail,
    section: "analysis" | "duplicates",
    entry: { path: string; reason: string; detail?: string | null },
  ) {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(buildScanFailureDiagnostic(job, section, entry));
    const diagnosticKey = `${job.id}:${section}:${entry.path}`;
    setCopiedScanDiagnosticKey(diagnosticKey);
    if (copiedScanDiagnosticResetTimer.current !== null) {
      window.clearTimeout(copiedScanDiagnosticResetTimer.current);
    }
    copiedScanDiagnosticResetTimer.current = window.setTimeout(() => {
      setCopiedScanDiagnosticKey((current) => (current === diagnosticKey ? null : current));
      copiedScanDiagnosticResetTimer.current = null;
    }, 2000);
  }

  function renderFailureList(
    detail: ScanJobDetail,
    section: "analysis" | "duplicates",
    entries: Array<{ path: string; reason: string; detail?: string | null }>,
  ) {
    if (entries.length === 0) {
      return <div className="notice scan-log-empty-detail">{t("scanLogs.none")}</div>;
    }

    return (
      <div className="scan-log-scroll-area">
        <div className="scan-log-pattern-list">
          {entries.map((entry) => {
            const diagnosticKey = `${detail.id}:${section}:${entry.path}`;
            const copied = copiedScanDiagnosticKey === diagnosticKey;
            return (
              <div className="scan-log-pattern-card" key={`${detail.id}-${section}-${entry.path}`}>
                <div className="scan-log-detail-title">
                  <code>{entry.path}</code>
                  <button
                    type="button"
                    className="scan-log-copy-button"
                    aria-label={t("scanLogs.copyDiagnosticsAria", { path: entry.path })}
                    onClick={() => void copyScanFailureDiagnostic(detail, section, entry)}
                  >
                    {copied ? t("scanLogs.copiedDiagnostics") : t("scanLogs.copyDiagnostics")}
                  </button>
                </div>
                <p className="scan-log-failure-reason">{entry.reason}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderScanJobDetail(job: RecentScanJob) {
    const detail = scanJobDetails[job.id];
    if (scanJobDetailLoading[job.id]) {
      return <div className="notice">{t("scanLogs.loadingDetail")}</div>;
    }
    if (scanJobDetailErrors[job.id]) {
      return <div className="alert">{scanJobDetailErrors[job.id]}</div>;
    }
    if (!detail) {
      return null;
    }

    const patternHits = detail.scan_summary.discovery.ignored_pattern_hits;
    const ignorePatternsSummary = compactScanValues(detail.scan_summary.ignore_patterns);
    const patternHitsSummary = compactScanValues(patternHits.map((hit) => hit.pattern));
    const duplicateFailureSummary = compactScanValues(detail.scan_summary.duplicates.failed_files.map((entry) => entry.path));
    return (
      <div className="scan-log-detail">
        <div className="scan-log-summary-meta scan-log-summary-meta-detail">
          <span>{t("scanLogs.startedAt")}: {formatDate(detail.started_at)}</span>
          <span>{t("scanLogs.finishedAt")}: {formatDate(detail.finished_at)}</span>
          <span>{t("scanLogs.duration")}: {formatDuration(detail.duration_seconds)}</span>
        </div>

        <div className="scan-log-summary-grid">
          <div className="scan-log-stat">
            <strong>{detail.scan_summary.discovery.discovered_files}</strong>
            <span>{t("scanLogs.metricDetected")}</span>
          </div>
          <div className="scan-log-stat">
            <strong>{detail.scan_summary.discovery.ignored_total}</strong>
            <span>{t("scanLogs.metricIgnored")}</span>
          </div>
          <div className="scan-log-stat">
            <strong>{detail.scan_summary.analysis.analyzed_successfully}</strong>
            <span>{t("scanLogs.metricAnalyzed")}</span>
          </div>
          <div className="scan-log-stat">
            <strong>{detail.scan_summary.analysis.analysis_failed}</strong>
            <span>{t("scanLogs.metricFailed")}</span>
          </div>
          <div className="scan-log-stat">
            <strong>{detail.scan_summary.duplicates.duplicate_groups}</strong>
            <span>{t("scanLogs.metricDuplicateGroups")}</span>
          </div>
          <div className="scan-log-stat">
            <strong>{detail.scan_summary.duplicates.duplicate_files}</strong>
            <span>{t("scanLogs.metricDuplicateFiles")}</span>
          </div>
        </div>

        <div className="scan-log-panels-grid">
          <details className="scan-log-detail-block scan-log-collapsible-block">
            <summary className="scan-log-collapse-toggle">
              <span className="scan-log-collapse-copy">
                <strong>{t("scanLogs.ignorePatterns")}</strong>
                {ignorePatternsSummary ? <span className="scan-log-collapse-summary">{ignorePatternsSummary}</span> : null}
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">{detail.scan_summary.ignore_patterns.length}</span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              {detail.scan_summary.ignore_patterns.length > 0 ? (
                <div className="scan-log-scroll-area">
                  <div className="scan-log-path-list">
                    {detail.scan_summary.ignore_patterns.map((pattern) => (
                      <code key={`pattern-${detail.id}-${pattern}`} className="scan-log-path">
                        {pattern}
                      </code>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="notice scan-log-empty-detail">{t("scanLogs.none")}</div>
              )}
            </div>
          </details>

          <details className="scan-log-detail-block scan-log-collapsible-block">
            <summary className="scan-log-collapse-toggle">
              <span className="scan-log-collapse-copy">
                <strong>{t("scanLogs.patternHits")}</strong>
                {patternHitsSummary ? <span className="scan-log-collapse-summary">{patternHitsSummary}</span> : null}
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">{patternHits.length}</span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              {patternHits.length > 0 ? (
                <div className="scan-log-scroll-area">
                  <div className="scan-log-pattern-list">
                    {patternHits.map((hit) => (
                      <div className="scan-log-pattern-card" key={`${detail.id}-${hit.pattern}`}>
                        <div className="scan-log-detail-title">
                          <code>{hit.pattern}</code>
                          <span className="badge">{hit.count}</span>
                        </div>
                        {hit.paths.length > 0 ? (
                          <div className="scan-log-path-list">
                            {hit.paths.map((path) => (
                              <code key={`${hit.pattern}-${path}`} className="scan-log-path">
                                {path}
                              </code>
                            ))}
                          </div>
                        ) : null}
                        {hit.truncated_count > 0 ? (
                          <div className="subtitle">{t("scanLogs.moreEntries", { count: hit.truncated_count })}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="notice scan-log-empty-detail">{t("scanLogs.none")}</div>
              )}
            </div>
          </details>

          {renderScanPathList(
            t("scanLogs.newFiles"),
            detail.scan_summary.changes.new_files.count,
            detail.scan_summary.changes.new_files.paths,
            detail.scan_summary.changes.new_files.truncated_count,
            compactScanValues(detail.scan_summary.changes.new_files.paths),
          )}
          {renderScanPathList(
            t("scanLogs.changedFiles"),
            detail.scan_summary.changes.modified_files.count,
            detail.scan_summary.changes.modified_files.paths,
            detail.scan_summary.changes.modified_files.truncated_count,
            compactScanValues(detail.scan_summary.changes.modified_files.paths),
          )}
          {renderScanPathList(
            t("scanLogs.deletedFiles"),
            detail.scan_summary.changes.deleted_files.count,
            detail.scan_summary.changes.deleted_files.paths,
            detail.scan_summary.changes.deleted_files.truncated_count,
            compactScanValues(detail.scan_summary.changes.deleted_files.paths),
          )}

          <details className="scan-log-detail-block scan-log-collapsible-block">
            <summary className="scan-log-collapse-toggle">
              <span className="scan-log-collapse-copy">
                <strong>{t("scanLogs.failedFiles")}</strong>
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">{detail.scan_summary.analysis.analysis_failed}</span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              {renderFailureList(detail, "analysis", detail.scan_summary.analysis.failed_files)}
              {detail.scan_summary.analysis.failed_files_truncated_count > 0 ? (
                <div className="subtitle">
                  {t("scanLogs.moreEntries", { count: detail.scan_summary.analysis.failed_files_truncated_count })}
                </div>
              ) : null}
            </div>
          </details>

          <details className="scan-log-detail-block scan-log-collapsible-block">
            <summary className="scan-log-collapse-toggle">
              <span className="scan-log-collapse-copy">
                <strong>{t("scanLogs.duplicatesTitle")}</strong>
                <span className="scan-log-collapse-summary">
                  {t("scanLogs.duplicatesSummary", {
                    mode: t(`libraries.duplicateDetectionModes.${detail.scan_summary.duplicates.mode}`),
                    groups: detail.scan_summary.duplicates.duplicate_groups,
                    files: detail.scan_summary.duplicates.duplicate_files,
                  })}
                </span>
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">
                  {detail.scan_summary.duplicates.processing_failed > 0
                    ? detail.scan_summary.duplicates.processing_failed
                    : detail.scan_summary.duplicates.processed_successfully}
                </span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              <div className="scan-log-summary-grid">
                <div className="scan-log-stat">
                  <strong>{t(`libraries.duplicateDetectionModes.${detail.scan_summary.duplicates.mode}`)}</strong>
                  <span>{t("scanLogs.duplicatesMode")}</span>
                </div>
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.queued_for_processing}</strong>
                  <span>{t("scanLogs.duplicatesQueued")}</span>
                </div>
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.processed_successfully}</strong>
                  <span>{t("scanLogs.duplicatesProcessed")}</span>
                </div>
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.processing_failed}</strong>
                  <span>{t("scanLogs.duplicatesFailed")}</span>
                </div>
              </div>
              {detail.scan_summary.duplicates.failed_files.length > 0 ? (
                renderFailureList(detail, "duplicates", detail.scan_summary.duplicates.failed_files)
              ) : (
                <div className="notice scan-log-empty-detail">
                  {duplicateFailureSummary ? duplicateFailureSummary : t("scanLogs.none")}
                </div>
              )}
              {detail.scan_summary.duplicates.failed_files_truncated_count > 0 ? (
                <div className="subtitle">
                  {t("scanLogs.moreEntries", { count: detail.scan_summary.duplicates.failed_files_truncated_count })}
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    );
  }

  function historyRetentionBucketTitle(bucket: HistoryRetentionBucketKey) {
    return t(`libraries.historyRetention.buckets.${bucket}.title`);
  }

  function formatHistoryReconstructionStatus(result: HistoryReconstructionResult) {
    if (
      result.created_library_history_entries === 0 &&
      result.updated_library_history_entries === 0 &&
      result.created_file_history_entries === 0
    ) {
      return t("libraries.historyRetention.reconstructNoChanges");
    }
    if (result.updated_library_history_entries > 0) {
      return t("libraries.historyRetention.reconstructSuccessWithUpdates", {
        libraryEntries: result.created_library_history_entries,
        updatedLibraryEntries: result.updated_library_history_entries,
        fileEntries: result.created_file_history_entries,
      });
    }
    return t("libraries.historyRetention.reconstructSuccess", {
      libraryEntries: result.created_library_history_entries,
      fileEntries: result.created_file_history_entries,
    });
  }

  function formatHistoryReconstructionPhaseLabel(status: HistoryReconstructionStatus) {
    if (status.status === "queued") {
      return t("libraries.historyRetention.progressQueued");
    }
    switch (status.phase) {
      case "loading_libraries":
        return t("libraries.historyRetention.progressLoadingLibraries");
      case "loading_library":
        return t("libraries.historyRetention.progressLoadingLibrary");
      case "reconstructing_file_history":
        return t("libraries.historyRetention.progressFileHistory");
      case "reconstructing_library_history":
        return t("libraries.historyRetention.progressLibraryHistory");
      case "completed":
        return t("libraries.historyRetention.progressCompleted");
      case "failed":
        return t("libraries.historyRetention.progressFailed");
      default:
        return t("libraries.historyRetention.reconstructButton");
    }
  }

  function formatHistoryReconstructionPhaseDetail(status: HistoryReconstructionStatus) {
    if (status.status === "queued") {
      return null;
    }
    if (status.phase === "loading_libraries") {
      return t("libraries.historyRetention.progressLibraries", {
        completed: status.libraries_processed,
        total: status.libraries_total,
      });
    }
    if (status.phase === "loading_library") {
      return status.current_library_name
        ? t("libraries.historyRetention.progressCurrentLibrary", { name: status.current_library_name })
        : null;
    }
    if (status.phase === "reconstructing_file_history") {
      return t("libraries.historyRetention.progressFiles", {
        completed: status.phase_completed,
        total: status.phase_total,
      });
    }
    if (status.phase === "reconstructing_library_history") {
      return t("libraries.historyRetention.progressDays", {
        completed: status.phase_completed,
        total: status.phase_total,
      });
    }
    if (status.phase === "completed" && status.result) {
      return formatHistoryReconstructionStatus(status.result);
    }
    if (status.phase === "failed") {
      return status.error ?? t("libraries.historyRetention.reconstructFailed");
    }
    return null;
  }

  function combinedIgnorePatterns(): string[] {
    return [...userIgnorePatternInputs, ...defaultIgnorePatternInputs];
  }

  function renderIgnorePatternSection(title: string, expanded: boolean, inputId: string) {
    const patterns = combinedIgnorePatterns();
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div className="ignore-pattern-section">
        <button
          type="button"
          className="secondary ignore-pattern-section-toggle"
          aria-expanded={expanded}
          onClick={() => toggleIgnorePatternSection()}
        >
          <span className="ignore-pattern-section-title">{title}</span>
          <span className="ignore-pattern-section-meta">
            <span className="badge">{patterns.length}</span>
            <ToggleIcon aria-hidden="true" className="nav-icon" />
          </span>
        </button>
        {expanded ? (
          <div className="ignore-pattern-section-body">
            <div className="ignore-pattern-row ignore-pattern-row-draft">
              <input
                id={inputId}
                type="text"
                value={ignorePatternDraft}
                onChange={(event) => {
                  setIgnorePatternDraft(event.target.value);
                  setIgnorePatternsStatus(null);
                }}
                placeholder={t("libraries.ignorePatternsPlaceholder")}
                spellCheck={false}
              />
              <button
                type="button"
                className="secondary icon-only-button"
                aria-label={t("libraries.ignorePatternsAddAria")}
                disabled={isSavingIgnorePatterns || !ignorePatternDraft.trim()}
                onClick={() => void addIgnorePattern()}
              >
                <Plus aria-hidden="true" className="nav-icon" />
              </button>
            </div>
            <div className="ignore-patterns-stack">
              {patterns.map((pattern, index) => (
                <div className="ignore-pattern-row ignore-pattern-row-saved" key={`ignore-pattern-${index}`}>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(event) => updateIgnorePattern(index, event.target.value)}
                    onBlur={() => void finalizeIgnorePatternEdit(index)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary icon-only-button"
                    aria-label={t("libraries.ignorePatternsRemoveAria", { index: index + 1 })}
                    disabled={isSavingIgnorePatterns}
                    onClick={() => void removeIgnorePattern(index)}
                  >
                    <Trash2 aria-hidden="true" className="nav-icon" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderPatternRecognitionList(
    key: PatternSectionKey,
    title: string,
    placeholder: string,
  ) {
    const patterns = patternListValue(patternRecognitionInputs, key);
    const draftValue = patternRecognitionDrafts[key];
    const expanded = patternRecognitionSectionState[key];
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;
    return (
      <div className="ignore-pattern-section pattern-recognition-section" key={key}>
        <button
          type="button"
          className="secondary ignore-pattern-section-toggle ignore-pattern-section-toggle-plain"
          aria-expanded={expanded}
          onClick={() => togglePatternRecognitionSection(key)}
        >
          <span className="ignore-pattern-section-title">{title}</span>
          <span className="ignore-pattern-section-meta">
            <span className="badge">{patterns.length}</span>
            <ToggleIcon aria-hidden="true" className="nav-icon" />
          </span>
        </button>
        {expanded ? (
          <div className="ignore-pattern-section-body">
            <div className="ignore-pattern-row ignore-pattern-row-draft">
              <input
                type="text"
                value={draftValue}
                onChange={(event) => {
                  setPatternRecognitionDrafts((current) => ({ ...current, [key]: event.target.value }));
                  setPatternRecognitionStatus(null);
                }}
                placeholder={placeholder}
                spellCheck={false}
              />
              <button
                type="button"
                className="secondary icon-only-button"
                aria-label={t("libraries.patternRecognition.addPattern")}
                disabled={isSavingPatternRecognition || !draftValue.trim()}
                onClick={() => void addPatternRecognitionEntry(key)}
              >
                <Plus aria-hidden="true" className="nav-icon" />
              </button>
            </div>
            <div className="ignore-patterns-stack">
              {patterns.map((pattern, index) => (
                <div className="ignore-pattern-row ignore-pattern-row-saved" key={`${key}-${index}`}>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(event) => updatePatternRecognitionEntry(key, index, event.target.value)}
                    onBlur={() => void finalizePatternRecognitionEntry(key, index)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary icon-only-button"
                    aria-label={t("libraries.patternRecognition.removePattern", { index: index + 1 })}
                    disabled={isSavingPatternRecognition}
                    onClick={() => void removePatternRecognitionEntry(key, index)}
                  >
                    <Trash2 aria-hidden="true" className="nav-icon" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function qualityPickerKey(libraryId: number, fieldKey: string): string {
    return `${libraryId}:${fieldKey}`;
  }

  function toggleQualityPicker(libraryId: number, fieldKey: string) {
    const nextKey = qualityPickerKey(libraryId, fieldKey);
    setQualityPickerOpenKey((current) => (current === nextKey ? null : nextKey));
  }

  function updateOrderedQualityBoundary(
    libraryId: number,
    key: "resolution" | "video_codec" | "audio_channels" | "audio_codec" | "dynamic_range",
    boundary: "minimum" | "ideal",
    value: string,
  ) {
    updateLibraryQualityProfile(libraryId, (current) => {
      const category = current[key];
      const ranks = key === "resolution" ? resolutionCategoryRanks(resolutionOptions) : QUALITY_OPTION_RANKS[key];
      const nextCategory = { ...category, [boundary]: value };
      const minimumValue = String(boundary === "minimum" ? value : nextCategory.minimum);
      const idealValue = String(boundary === "ideal" ? value : nextCategory.ideal);
      if (ranks[idealValue] < ranks[minimumValue]) {
        if (boundary === "minimum") {
          nextCategory.ideal = value;
        } else {
          nextCategory.minimum = value;
        }
      }
      return { ...current, [key]: nextCategory };
    });
    setQualityPickerOpenKey(null);
  }

  function toggleLanguagePreference(
    libraryId: number,
    field: "audio_languages" | "subtitle_languages",
    value: string,
  ) {
    updateLibraryQualityProfile(libraryId, (current) => {
      const source = current.language_preferences[field];
      const nextValues = source.includes(value)
        ? source.filter((entry) => entry !== value)
        : [...source, value].sort();
      return {
        ...current,
        language_preferences: {
          ...current.language_preferences,
          [field]: nextValues,
        },
      };
    });
  }

  function updateLanguageDraft(fieldKey: string, value: string) {
    setQualityLanguageDrafts((current) => ({ ...current, [fieldKey]: value.toLowerCase() }));
    setQualityLanguageErrors((current) => ({ ...current, [fieldKey]: null }));
  }

  function submitCustomLanguagePreference(
    libraryId: number,
    field: "audio_languages" | "subtitle_languages",
    fieldKey: string,
  ) {
    const normalized = (qualityLanguageDrafts[fieldKey] ?? "").trim().toLowerCase();
    if (!normalized) {
      return;
    }
    if (!ISO_639_1_CODES.has(normalized)) {
      setQualityLanguageErrors((current) => ({
        ...current,
        [fieldKey]: t("libraries.quality.languageCodeInvalid"),
      }));
      return;
    }
    updateLibraryQualityProfile(libraryId, (current) => {
      const source = current.language_preferences[field];
      if (source.includes(normalized)) {
        return current;
      }
      return {
        ...current,
        language_preferences: {
          ...current.language_preferences,
          [field]: [...source, normalized].sort(),
        },
      };
    });
    setQualityLanguageDrafts((current) => ({ ...current, [fieldKey]: "" }));
    setQualityLanguageErrors((current) => ({ ...current, [fieldKey]: null }));
  }

  function renderPickerField(
    libraryId: number,
    fieldKey: string,
    label: string,
    values: string[],
    options: string[],
    onSelect: (value: string) => void,
    onRemove?: (value: string) => void,
    disabledOptions: Set<string> = new Set(),
    popoverClassName = "",
    customEntry?: {
      draft: string;
      error: string | null;
      placeholder: string;
      addLabel: string;
      onDraftChange: (value: string) => void;
      onSubmit: () => void;
    },
    optionLabels?: Map<string, string>,
  ) {
    const open = qualityPickerOpenKey === qualityPickerKey(libraryId, fieldKey);
    const displayOptions = [...new Set([...options, ...values])];
    return (
      <div className="field">
        <label>{label}</label>
        <div className="quality-picker-field-shell search-filter-picker">
          <button
            type="button"
            className={`quality-picker-field${open ? " is-open" : ""}`}
            aria-expanded={open}
            onClick={() => toggleQualityPicker(libraryId, fieldKey)}
          >
            <div className="quality-picker-values">
              {values.length > 0 ? (
                values.map((value) => (
                  <span className="badge quality-picker-chip" key={`${fieldKey}-${value}`}>
                    {optionLabels?.get(value) ?? value}
                  </span>
                ))
              ) : (
                <span className="quality-picker-empty">{t("libraries.quality.noneSelected")}</span>
              )}
            </div>
          </button>
          {open ? (
            <div className={`search-filter-picker-popover quality-picker-popover ${popoverClassName}`.trim()}>
              {customEntry ? (
                <div className="quality-picker-custom-entry">
                  <div className="quality-picker-custom-row">
                    <input
                      type="text"
                      value={customEntry.draft}
                      placeholder={customEntry.placeholder}
                      maxLength={2}
                      className={`quality-picker-custom-input${customEntry.error ? " is-invalid" : ""}`}
                      onChange={(event) => customEntry.onDraftChange(event.target.value.replace(/[^a-zA-Z]/g, "").slice(0, 2))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          customEntry.onSubmit();
                        }
                      }}
                    />
                    <button type="button" className="quality-picker-custom-submit" onClick={customEntry.onSubmit}>
                      {customEntry.addLabel}
                    </button>
                  </div>
                  {customEntry.error ? <div className="quality-picker-custom-error">{customEntry.error}</div> : null}
                </div>
              ) : null}
              {displayOptions.map((option) => {
                const isSelected = values.includes(option);
                const isDisabled = disabledOptions.has(option);
                return (
                  <button
                    type="button"
                    key={option}
                    className={`search-filter-picker-item${isSelected ? " is-selected" : ""}`}
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    disabled={isDisabled}
                    onClick={() => {
                      if (isSelected && onRemove) {
                        onRemove(option);
                        setQualityPickerOpenKey(null);
                        return;
                      }
                      onSelect(option);
                    }}
                  >
                    <span>{optionLabels?.get(option) ?? option}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderQualityWeightField(
    label: string,
    value: number,
    onChange: (value: number) => void,
  ) {
    return (
      <div className="field quality-weight-field">
        <label>{label}</label>
        <input
          className="quality-weight-input"
          type="number"
          min={0}
          max={10}
          value={value}
          style={weightFieldStyle(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    );
  }

  function renderQualityOrdinalRow(
    library: LibrarySummary,
    key: "resolution" | "video_codec" | "audio_channels" | "audio_codec" | "dynamic_range",
    options: string[],
    labels?: Map<string, string>,
  ) {
    const profile = settingsForms[library.id]?.quality_profile ?? library.quality_profile;
    const category = profile[key];
    const ranks = key === "resolution" ? resolutionCategoryRanks(resolutionOptions) : QUALITY_OPTION_RANKS[key];
    const minimumValue = String(category.minimum);
    const idealValue = String(category.ideal);
    const disabledForMinimum = new Set(
      options.filter((option) => ranks[option] > ranks[idealValue]),
    );
    const disabledForIdeal = new Set(
      options.filter((option) => ranks[option] < ranks[minimumValue]),
    );

    return (
      <div className="quality-settings-group" key={key}>
        <div className="quality-settings-group-title">{t(`libraries.quality.${key}`)}</div>
        {renderPickerField(
          library.id,
          `${key}:minimum`,
          t("libraries.quality.minimum"),
          [minimumValue],
          options,
          (value) => updateOrderedQualityBoundary(library.id, key, "minimum", value),
          undefined,
          disabledForMinimum,
          undefined,
          undefined,
          labels,
        )}
        {renderPickerField(
          library.id,
          `${key}:ideal`,
          t("libraries.quality.ideal"),
          [idealValue],
          options,
          (value) => updateOrderedQualityBoundary(library.id, key, "ideal", value),
          undefined,
          disabledForIdeal,
          undefined,
          undefined,
          labels,
        )}
        {renderQualityWeightField(
          t("libraries.quality.weight"),
          category.weight,
          (value) =>
            updateLibraryQualityProfile(library.id, (current) => ({
              ...current,
              [key]: { ...current[key], weight: value },
            })),
        )}
      </div>
    );
  }

  function renderQualitySettings(library: LibrarySummary) {
    const profile = settingsForms[library.id]?.quality_profile ?? library.quality_profile;
    return (
      <div className="quality-settings-panel field-span-full">
        {renderQualityOrdinalRow(library, "resolution", resolutionOptionIds, resolutionOptionLabels)}
        {renderQualityOrdinalRow(library, "video_codec", VIDEO_CODEC_OPTIONS, VIDEO_CODEC_OPTION_LABELS)}
        {renderQualityOrdinalRow(library, "audio_channels", AUDIO_CHANNEL_OPTIONS)}
        {renderQualityOrdinalRow(library, "audio_codec", AUDIO_CODEC_OPTIONS, AUDIO_CODEC_OPTION_LABELS)}
        {renderQualityOrdinalRow(library, "dynamic_range", DYNAMIC_RANGE_OPTIONS)}
        <div className="quality-settings-group">
          <div className="quality-settings-group-title">{t("libraries.quality.language_preferences")}</div>
          {renderPickerField(
            library.id,
            "language_preferences:audio",
          t("libraries.quality.audioLanguages"),
          profile.language_preferences.audio_languages,
          LANGUAGE_OPTIONS,
          (value) => toggleLanguagePreference(library.id, "audio_languages", value),
          (value) => toggleLanguagePreference(library.id, "audio_languages", value),
          new Set(),
          "quality-picker-popover-languages",
          {
            draft: qualityLanguageDrafts["language_preferences:audio"] ?? "",
            error: qualityLanguageErrors["language_preferences:audio"] ?? null,
            placeholder: t("libraries.quality.languageCodePlaceholder"),
            addLabel: t("libraries.quality.addLanguage"),
            onDraftChange: (value) => updateLanguageDraft("language_preferences:audio", value),
            onSubmit: () => submitCustomLanguagePreference(library.id, "audio_languages", "language_preferences:audio"),
          },
        )}
        {renderPickerField(
          library.id,
          "language_preferences:subtitle",
          t("libraries.quality.subtitleLanguages"),
          profile.language_preferences.subtitle_languages,
          LANGUAGE_OPTIONS,
          (value) => toggleLanguagePreference(library.id, "subtitle_languages", value),
          (value) => toggleLanguagePreference(library.id, "subtitle_languages", value),
          new Set(),
          "quality-picker-popover-languages",
          {
            draft: qualityLanguageDrafts["language_preferences:subtitle"] ?? "",
            error: qualityLanguageErrors["language_preferences:subtitle"] ?? null,
            placeholder: t("libraries.quality.languageCodePlaceholder"),
            addLabel: t("libraries.quality.addLanguage"),
            onDraftChange: (value) => updateLanguageDraft("language_preferences:subtitle", value),
            onSubmit: () =>
              submitCustomLanguagePreference(library.id, "subtitle_languages", "language_preferences:subtitle"),
          },
        )}
          {renderQualityWeightField(
            t("libraries.quality.weight"),
            profile.language_preferences.weight,
            (value) =>
              updateLibraryQualityProfile(library.id, (current) => ({
                ...current,
                language_preferences: { ...current.language_preferences, weight: value },
              })),
          )}
        </div>
        <div className="quality-settings-group quality-settings-group-numeric">
          <div className="quality-settings-group-title">
            {t("libraries.quality.visual_density")}
            <span className="quality-settings-hint">{t("libraries.quality.visualDensityHint")}</span>
          </div>
          <div className="field">
            <label>{t("libraries.quality.minimum")}</label>
            <input
              className="quality-density-input"
              type="number"
              min={0}
              step="0.001"
              value={Number(profile.visual_density.minimum)}
              onChange={(event) =>
                updateLibraryQualityProfile(library.id, (current) => {
                  const bounds = normalizeVisualDensityBounds(
                    Number(event.target.value),
                    Number(current.visual_density.ideal),
                    Number(current.visual_density.maximum),
                  );
                  return {
                    ...current,
                    visual_density: { ...current.visual_density, ...bounds },
                  };
                })
              }
            />
          </div>
          <div className="field">
            <label>{t("libraries.quality.ideal")}</label>
            <input
              className="quality-density-input"
              type="number"
              min={Number(profile.visual_density.minimum)}
              step="0.001"
              value={Number(profile.visual_density.ideal)}
              onChange={(event) =>
                updateLibraryQualityProfile(library.id, (current) => {
                  const bounds = normalizeVisualDensityBounds(
                    Number(current.visual_density.minimum),
                    Number(event.target.value),
                    Number(current.visual_density.maximum),
                  );
                  return {
                    ...current,
                    visual_density: {
                      ...current.visual_density,
                      ...bounds,
                    },
                  };
                })
              }
            />
          </div>
          <div className="field">
            <label>{t("libraries.quality.maximum")}</label>
            <input
              className="quality-density-input"
              type="number"
              min={Number(profile.visual_density.ideal)}
              step="0.001"
              value={Number(profile.visual_density.maximum)}
              onChange={(event) =>
                updateLibraryQualityProfile(library.id, (current) => {
                  const bounds = normalizeVisualDensityBounds(
                    Number(current.visual_density.minimum),
                    Number(current.visual_density.ideal),
                    Number(event.target.value),
                  );
                  return {
                    ...current,
                    visual_density: {
                      ...current.visual_density,
                      ...bounds,
                    },
                  };
                })
              }
            />
          </div>
          {renderQualityWeightField(
            t("libraries.quality.weight"),
            profile.visual_density.weight,
            (value) =>
              updateLibraryQualityProfile(library.id, (current) => ({
                ...current,
                visual_density: { ...current.visual_density, weight: value },
              })),
          )}
        </div>
      </div>
    );
  }

  const normalizedResolutionDrafts = resolutionCategoriesFromDrafts(resolutionCategoryDrafts);
  const resolutionCategoryChangeKind = resolutionCategoryChangeSummary(
    persistedResolutionCategories.current,
    normalizedResolutionDrafts,
  );
  const resolutionCategoryDefaultsChangeKind = resolutionCategoryChangeSummary(
    DEFAULT_RESOLUTION_CATEGORIES,
    normalizedResolutionDrafts,
  );

  return (
    <>
      <div className="settings-layout">
        <div className="settings-main-column">
          <AsyncPanel
            title={t("libraries.configured")}
            loading={isLoadingLibraries}
            error={error}
            collapseActions={
              <button
                type="button"
                className="small history-retention-primary-button"
                disabled={isLoadingLibraries || !libraries.length || isRunningFullScanAll}
                onClick={() => void runFullScanForAllLibraries()}
              >
                {t("libraries.fullScan")}
              </button>
            }
            collapseButtonClassName="async-panel-toggle-icon-button-flat"
            collapseState={{
              collapsed: !settingsPanelState.configuredLibraries,
              onToggle: () => toggleSettingsPanel("configuredLibraries"),
              bodyId: "configured-libraries-panel-body",
            }}
          >
            <div className="listing">
              {!libraries.length ? <div className="notice">{t("libraries.addFirstLibrary")}</div> : null}
              {libraries.map((library) => {
                const identityForm = libraryIdentityForms[library.id];
                const isEditingLibraryIdentity = Boolean(identityForm);
                const isSavingLibraryIdentity = Boolean(libraryIdentityPending[library.id]);
                const canSaveLibraryIdentity = Boolean(identityForm?.name.trim());

                return (
                  <div className="media-card library-settings-card" key={library.id}>
                  <div className="library-settings-header">
                    <div className="item-meta">
                      <div className="library-title-row">
                        <div className="library-title-meta">
                          <div className="library-title-main">
                            {isEditingLibraryIdentity ? (
                              <div className="library-title-inline-editor">
                                <input
                                  ref={(node) => {
                                    libraryNameInputRefs.current[library.id] = node;
                                  }}
                                  type="text"
                                  className="library-title-input"
                                  value={identityForm?.name ?? ""}
                                  aria-label={t("libraries.editNameAria", { name: library.name })}
                                  disabled={isSavingLibraryIdentity}
                                  onChange={(event) =>
                                    updateLibraryIdentityForm(library.id, { name: event.target.value })
                                  }
                                  onKeyDown={(event) => handleLibraryIdentityEditorKeyDown(event, library)}
                                />
                              </div>
                            ) : (
                              <h3>
                                <Link to={`/libraries/${library.id}`} className="file-link">
                                  {library.name}
                                </Link>
                              </h3>
                            )}
                            {!isEditingLibraryIdentity ? (
                              <TooltipTrigger
                                ariaLabel={t("libraries.detailsTooltipAria", { name: library.name })}
                                align="start"
                                maxWidth={420}
                                tooltipClassName="library-details-tooltip"
                                content={
                                  <div className="library-details-tooltip-content">
                                    <p className="library-details-tooltip-path">{library.path}</p>
                                    <div className="library-details-tooltip-stats">
                                      <span>{library.file_count} {t("libraries.files").toLowerCase()}</span>
                                      <span>{formatBytes(library.total_size_bytes)}</span>
                                      <span>{formatDuration(library.total_duration_seconds)}</span>
                                      <span>{t("libraries.lastScan")}: {formatDate(library.last_scan_at)}</span>
                                    </div>
                                  </div>
                                }
                              />
                            ) : null}
                            <div className="meta-tags library-title-tags">
                              {isEditingLibraryIdentity ? (
                                <select
                                  className="library-title-type-select"
                                  value={identityForm?.type ?? library.type}
                                  aria-label={t("libraries.editTypeAria", { name: library.name })}
                                  disabled={isSavingLibraryIdentity}
                                  onChange={(event) =>
                                    updateLibraryIdentityForm(library.id, { type: event.target.value as LibraryType })
                                  }
                                  onKeyDown={(event) => handleLibraryIdentityEditorKeyDown(event, library)}
                                >
                                  <option value="movies">{t("libraryTypes.movies")}</option>
                                  <option value="series">{t("libraryTypes.series")}</option>
                                  <option value="mixed">{t("libraryTypes.mixed")}</option>
                                  <option value="other">{t("libraryTypes.other")}</option>
                                </select>
                              ) : (
                                <span className="badge">{t(`libraryTypes.${library.type}`)}</span>
                              )}
                              {!isEditingLibraryIdentity ? (
                                <span className="badge">{t(`scanModes.${library.scan_mode}`)}</span>
                              ) : null}
                              {activeJobs
                                .filter((job) => job.library_id === library.id)
                                .map((job) => (
                                  <span className="badge scan-badge" key={job.id}>
                                    {job.files_total > 0 ? `${job.progress_percent}%` : t("libraries.active")}
                                  </span>
                                ))}
                            </div>
                          </div>
                        </div>
                        <div className="library-title-actions">
                          <button
                            type="button"
                            className="secondary icon-only-button"
                            aria-label={
                              library.show_on_dashboard
                                ? t("libraries.hideFromDashboardAria", { name: library.name })
                                : t("libraries.showOnDashboardAria", { name: library.name })
                            }
                            title={
                              library.show_on_dashboard
                                ? t("libraries.hideFromDashboardTooltip")
                                : t("libraries.showOnDashboardTooltip")
                            }
                            disabled={Boolean(dashboardVisibilityPending[library.id])}
                            onClick={() => void toggleLibraryDashboardVisibility(library)}
                          >
                            <DashboardVisibilityIcon visible={library.show_on_dashboard} />
                          </button>
                          {isEditingLibraryIdentity ? (
                            <>
                              <button
                                type="button"
                                className="secondary icon-only-button"
                                aria-label={t("libraries.saveEditAria", { name: library.name })}
                                title={t("libraries.saveEditTooltip")}
                                disabled={isSavingLibraryIdentity || !canSaveLibraryIdentity}
                                onClick={() => void saveLibraryIdentity(library)}
                              >
                                <Check aria-hidden="true" className="nav-icon" />
                              </button>
                              <button
                                type="button"
                                className="secondary icon-only-button"
                                aria-label={t("libraries.cancelEditAria", { name: library.name })}
                                title={t("libraries.cancelEditTooltip")}
                                disabled={isSavingLibraryIdentity}
                                onClick={() => stopEditingLibraryIdentity(library.id)}
                              >
                                <X aria-hidden="true" className="nav-icon" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="secondary icon-only-button"
                              aria-label={t("libraries.renameAria", { name: library.name })}
                              title={t("libraries.renameTooltip")}
                              onClick={() => startEditingLibraryIdentity(library)}
                            >
                              <Pencil aria-hidden="true" className="nav-icon" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="secondary icon-only-button"
                            aria-label={t("libraries.deleteAria", { name: library.name })}
                            title={t("libraries.deleteTooltip")}
                            onClick={() => void removeLibrary(library.id)}
                          >
                            <Trash2 aria-hidden="true" className="nav-icon" />
                          </button>
                          <button
                            type="button"
                            className="small"
                            title={t("libraries.scanNowTooltip")}
                            onClick={() => void runLibraryScan(library.id)}
                          >
                            {t("libraries.scanNow")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {activeJobs.find((job) => job.library_id === library.id) ? (
                    <div className="progress">
                      <span
                        style={{
                          width: `${activeJobs.find((job) => job.library_id === library.id)?.progress_percent ?? 0}%`,
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="library-settings-form">
                    <div className="field">
                      <div className="field-label-row">
                        <label htmlFor={`scan-mode-${library.id}`}>{t("libraries.scanMode")}</label>
                      </div>
                      <select
                        id={`scan-mode-${library.id}`}
                        value={settingsForms[library.id]?.scan_mode ?? library.scan_mode}
                        onChange={(event) =>
                          updateLibraryForm(library.id, { scan_mode: event.target.value })
                        }
                      >
                        <option value="manual">{t("scanModes.manual")}</option>
                        <option value="scheduled">{t("scanModes.scheduled")}</option>
                        <option
                          value="watch"
                          disabled={Boolean(desktopApp && libraryPathInspections[library.id] && !libraryPathInspections[library.id]?.watch_supported)}
                        >
                          {t("scanModes.watch")}
                        </option>
                      </select>
                    </div>
                    <div className="field">
                      <div className="field-label-row">
                        <label htmlFor={`duplicate-detection-mode-${library.id}`}>{t("libraries.duplicateDetectionMode")}</label>
                        <TooltipTrigger
                          ariaLabel={t("libraries.duplicateDetectionModeTooltipAria")}
                          content={t("libraries.duplicateDetectionModeHint")}
                        >
                          ?
                        </TooltipTrigger>
                      </div>
                      <select
                        id={`duplicate-detection-mode-${library.id}`}
                        value={settingsForms[library.id]?.duplicate_detection_mode ?? library.duplicate_detection_mode}
                        onChange={(event) =>
                          updateLibraryForm(library.id, {
                            duplicate_detection_mode: event.target.value as DuplicateDetectionMode,
                          })
                        }
                      >
                        <option value="off">{t("libraries.duplicateDetectionModes.off")}</option>
                        <option value="filename">{t("libraries.duplicateDetectionModes.filename")}</option>
                        <option value="filehash">{t("libraries.duplicateDetectionModes.filehash")}</option>
                        <option value="both">{t("libraries.duplicateDetectionModes.both")}</option>
                      </select>
                    </div>
                    {networkWatchFallbackApplied(
                      libraryPathInspections[library.id],
                      settingsForms[library.id]?.scan_mode ?? library.scan_mode,
                    ) ? (
                      <div className="field field-span-full">
                        <p className="field-hint">{t("libraries.watchUnavailableNetwork")}</p>
                      </div>
                    ) : null}
                    {(settingsForms[library.id]?.scan_mode ?? library.scan_mode) === "scheduled" ? (
                      <div className="field">
                        <div className="field-label-row">
                          <label htmlFor={`interval-minutes-${library.id}`}>{t("libraries.intervalMinutes")}</label>
                          <span className="field-label-spacer" aria-hidden="true" />
                        </div>
                        <input
                          id={`interval-minutes-${library.id}`}
                          type="number"
                          min={5}
                          value={settingsForms[library.id]?.interval_minutes ?? 60}
                          onChange={(event) =>
                            updateLibraryForm(library.id, {
                              interval_minutes: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                    ) : null}
                    {(settingsForms[library.id]?.scan_mode ?? library.scan_mode) === "watch" ? (
                      <div className="field">
                        <div className="field-label-row">
                          <label htmlFor={`debounce-seconds-${library.id}`}>{t("libraries.debounceSeconds")}</label>
                          <span className="field-label-spacer" aria-hidden="true" />
                        </div>
                        <input
                          id={`debounce-seconds-${library.id}`}
                          type="number"
                          min={3}
                          value={settingsForms[library.id]?.debounce_seconds ?? 15}
                          onChange={(event) =>
                            updateLibraryForm(library.id, {
                              debounce_seconds: Number(event.target.value),
                            })
                          }
                        />
                      </div>
                    ) : null}
                    <div className="field field-span-full">
                      <button
                        type="button"
                        className="secondary quality-settings-toggle"
                        aria-expanded={Boolean(qualitySectionOpen[library.id])}
                        onClick={() =>
                          setQualitySectionOpen((current) => ({ ...current, [library.id]: !current[library.id] }))
                        }
                      >
                        <span>{t("libraries.qualityScoreTitle")}</span>
                        {qualitySectionOpen[library.id] ? (
                          <ChevronDown aria-hidden="true" className="nav-icon" />
                        ) : (
                          <ChevronRight aria-hidden="true" className="nav-icon" />
                        )}
                      </button>
                    </div>
                    {qualitySectionOpen[library.id] ? renderQualitySettings(library) : null}
                  </div>
                  {libraryMessages[library.id] ? <div className="alert">{libraryMessages[library.id]}</div> : null}
                  </div>
                );
              })}
            </div>
          </AsyncPanel>

          <AsyncPanel
            title="Resolution categories"
            collapseState={{
              collapsed: !settingsPanelState.resolutionCategories,
              onToggle: () => toggleSettingsPanel("resolutionCategories"),
              bodyId: "resolution-categories-panel-body",
            }}
          >
            <div className="settings-sidebar-stack">
              <div className="field-label-row">
                <p className="field-hint">
                  Use shared buckets for statistics, metadata search, file detail, and quality-score resolution rules.
                </p>
                <TooltipTrigger
                  ariaLabel="Explain reduced default resolution thresholds"
                  content={RESOLUTION_CATEGORY_TOOLTIP}
                  preserveLineBreaks
                >
                  ?
                </TooltipTrigger>
              </div>
              <div className="resolution-category-settings">
                <div className="resolution-category-row resolution-category-add-row">
                  <div className="field">
                    <label htmlFor="resolution-category-new-label">Label</label>
                    <input
                      id="resolution-category-new-label"
                      type="text"
                      placeholder="New category"
                      value={newResolutionCategoryDraft.label}
                      onChange={(event) => updateNewResolutionCategoryDraft({ label: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="resolution-category-new-width">Min width</label>
                    <input
                      id="resolution-category-new-width"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={newResolutionCategoryDraft.min_width}
                      onChange={(event) => updateNewResolutionCategoryDraft({ min_width: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="resolution-category-new-height">Min height</label>
                    <input
                      id="resolution-category-new-height"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={newResolutionCategoryDraft.min_height}
                      onChange={(event) => updateNewResolutionCategoryDraft({ min_height: event.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="secondary icon-only-button"
                    aria-label="Add resolution category"
                    onClick={() => void addResolutionCategoryDraft()}
                    disabled={!newResolutionCategoryDraft.label.trim() || isSavingResolutionCategories}
                  >
                    <Plus aria-hidden="true" className="nav-icon" />
                  </button>
                </div>
                {resolutionCategoryDrafts.map((category, index) => (
                  <div className="resolution-category-row" key={category.id}>
                    <div className="field">
                      <label htmlFor={`resolution-category-label-${category.id}`}>Label</label>
                      <input
                        id={`resolution-category-label-${category.id}`}
                        type="text"
                        value={category.label}
                        onChange={(event) => updateResolutionCategoryDraft(index, { label: event.target.value })}
                        onBlur={() => void saveResolutionCategories()}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`resolution-category-width-${category.id}`}>Min width</label>
                      <input
                        id={`resolution-category-width-${category.id}`}
                        type="number"
                        min={0}
                        value={category.min_width}
                        onChange={(event) =>
                          updateResolutionCategoryDraft(index, { min_width: Number(event.target.value) })
                        }
                        onBlur={() => void saveResolutionCategories()}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`resolution-category-height-${category.id}`}>Min height</label>
                      <input
                        id={`resolution-category-height-${category.id}`}
                        type="number"
                        min={0}
                        value={category.min_height}
                        onChange={(event) =>
                          updateResolutionCategoryDraft(index, { min_height: Number(event.target.value) })
                        }
                        onBlur={() => void saveResolutionCategories()}
                      />
                    </div>
                    <button
                      type="button"
                      className="secondary icon-only-button"
                      aria-label={`Remove resolution category ${category.label || category.id}`}
                      onClick={() => void removeResolutionCategoryDraft(index)}
                      disabled={resolutionCategoryDrafts.length <= 1 || isSavingResolutionCategories}
                    >
                      <Trash2 aria-hidden="true" className="nav-icon" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="resolution-category-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void restoreDefaultResolutionCategories()}
                  disabled={
                    !appSettingsLoaded ||
                    isSavingResolutionCategories ||
                    resolutionCategoryDefaultsChangeKind === "none"
                  }
                >
                  Restore defaults
                </button>
              </div>
              {isSavingResolutionCategories ? <p className="field-hint">Saving resolution categories…</p> : null}
              {resolutionCategoryChangeKind === "labels" ? (
                <p className="field-hint">
                  Label changes save automatically. Search and detail pills update immediately; quality scores stay as-is.
                </p>
              ) : null}
              {resolutionCategoryChangeKind === "logic" ? (
                <p className="field-hint">
                  Threshold and category changes save automatically and queue quality-score recomputation for affected libraries.
                </p>
              ) : null}
              {resolutionCategoriesStatus ? <div className="alert">{resolutionCategoriesStatus}</div> : null}
            </div>
          </AsyncPanel>

          <AsyncPanel
            title={t("libraries.patternRecognition.title")}
            subtitle={t("libraries.patternRecognition.subtitle")}
            titleAddon={
              <TooltipTrigger
                ariaLabel={t("libraries.patternRecognition.rescanTooltipAria")}
                content={t("libraries.ignorePatternsHint")}
              >
                ?
              </TooltipTrigger>
            }
            loading={isLoadingIgnorePatterns}
            error={ignorePatternsLoadError}
            collapseState={{
              collapsed: !settingsPanelState.patternRecognition,
              onToggle: () => toggleSettingsPanel("patternRecognition"),
              bodyId: "pattern-recognition-panel-body",
            }}
          >
            <div className="settings-sidebar-stack">
              <div className="pattern-recognition-doc-row">
                <p className="field-hint">{t("libraries.patternRecognition.docsHint")}</p>
                <a href={PATTERN_DOCS_URL} target="_blank" rel="noreferrer" className="secondary small">
                  {t("libraries.patternRecognition.docsLink")}
                </a>
              </div>
              <div className="field">
                <div className="distribution-copy">
                  <div className="field-label-row">
                    <strong>{t("libraries.patternRecognition.showSeasonTitle")}</strong>
                    <TooltipTrigger
                      ariaLabel={t("libraries.patternRecognition.showSeasonTooltipAria")}
                      content={t("libraries.patternRecognition.showSeasonHint")}
                      preserveLineBreaks
                    >
                      ?
                    </TooltipTrigger>
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    aria-label={t("libraries.patternRecognition.restoreShowSeasonDefaults")}
                    disabled={isSavingPatternRecognition}
                    onClick={() => void restoreDefaultShowSeasonPatterns()}
                  >
                    {t("libraries.patternRecognition.restoreDefaults")}
                  </button>
                </div>
                <div className="field" style={{ marginTop: "0.75rem" }}>
                  <label>
                    <span>{t("libraries.patternRecognition.modeLabel")}</span>
                    <select
                      value={patternRecognitionInputs.show_season_patterns.recognition_mode}
                      disabled={isSavingPatternRecognition}
                      onChange={(event) =>
                        void updateShowSeasonRecognitionMode(event.currentTarget.value as "folder_depth" | "regex")
                      }
                    >
                      <option value="folder_depth">{t("libraries.patternRecognition.modeFolderDepth")}</option>
                      <option value="regex">{t("libraries.patternRecognition.modeRegex")}</option>
                    </select>
                  </label>
                </div>
                {patternRecognitionInputs.show_season_patterns.recognition_mode === "folder_depth" ? (
                  <div className="inline-form-grid">
                    <label>
                      <span>{t("libraries.patternRecognition.seriesFolderDepth")}</span>
                      <select
                        value={String(patternRecognitionInputs.show_season_patterns.series_folder_depth)}
                        disabled={isSavingPatternRecognition}
                        onChange={(event) =>
                          void updateShowSeasonDepth("series_folder_depth", Number.parseInt(event.currentTarget.value, 10))
                        }
                      >
                        {Array.from({ length: 8 }, (_, index) => index + 1).map((depth) => (
                          <option key={`series-depth-${depth}`} value={depth}>
                            {depth}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t("libraries.patternRecognition.seasonFolderDepth")}</span>
                      <select
                        value={String(patternRecognitionInputs.show_season_patterns.season_folder_depth)}
                        disabled={isSavingPatternRecognition}
                        onChange={(event) =>
                          void updateShowSeasonDepth("season_folder_depth", Number.parseInt(event.currentTarget.value, 10))
                        }
                      >
                        {Array.from({ length: 8 }, (_, index) => index + 1).map((depth) => (
                          <option key={`season-depth-${depth}`} value={depth}>
                            {depth}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="ignore-pattern-sections">
                    {renderPatternRecognitionList(
                      "series_folder_regexes",
                      t("libraries.patternRecognition.seriesFolderRegexes"),
                      String.raw`^(?P<title>.+?)$`,
                    )}
                    {renderPatternRecognitionList(
                      "season_folder_regexes",
                      t("libraries.patternRecognition.seasonFolderRegexes"),
                      String.raw`^(?:Season|Staffel)\s*(?P<season>\d{1,3})(?:\s+\([^)]*\))?(?:\s+\[[^\]]+\])*$`,
                    )}
                  </div>
                )}
              </div>

              <div className="field">
                <div className="distribution-copy">
                  <div className="field-label-row">
                    <strong>{t("libraries.patternRecognition.bonusTitle")}</strong>
                    <TooltipTrigger
                      ariaLabel={t("libraries.patternRecognition.bonusTooltipAria")}
                      content={t("libraries.patternRecognition.bonusHint")}
                      preserveLineBreaks
                    >
                      ?
                    </TooltipTrigger>
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={isSavingPatternRecognition}
                    onClick={() => void restoreDefaultBonusPatterns()}
                  >
                    {t("libraries.patternRecognition.restoreBonusDefaults")}
                  </button>
                </div>
                <div className="ignore-pattern-sections">
                  {renderPatternRecognitionList(
                    "bonus_folder_patterns",
                    t("libraries.patternRecognition.bonusFolders"),
                    "*/extras/*",
                  )}
                </div>
              </div>

              <div className="field">
                <div className="distribution-copy">
                  <div className="field-label-row">
                    <strong>{t("libraries.ignorePatternsTitle")}</strong>
                    <TooltipTrigger
                      ariaLabel={t("libraries.ignorePatternsTooltipAria")}
                      content={t("libraries.ignorePatternsTooltip")}
                      preserveLineBreaks
                    >
                      ?
                    </TooltipTrigger>
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={isSavingIgnorePatterns}
                    onClick={() => void restoreDefaultIgnorePatterns()}
                  >
                    {t("libraries.restoreIgnoreDefaults")}
                  </button>
                </div>
                <div className="ignore-pattern-sections">
                  {renderIgnorePatternSection(
                    t("libraries.ignorePatternsTitle"),
                    ignorePatternSectionState.combinedExpanded,
                    "ignore-patterns",
                  )}
                </div>
              </div>
              {isSavingPatternRecognition || isSavingIgnorePatterns ? (
                <p className="field-hint">{t("libraries.patternRecognition.saving")}</p>
              ) : null}
              {patternRecognitionStatus || ignorePatternsStatus ? (
                <div className="alert">{patternRecognitionStatus ?? ignorePatternsStatus}</div>
              ) : null}
            </div>
          </AsyncPanel>

          <AsyncPanel
            title={t("libraries.historyRetention.title")}
            collapseActions={
              <div className="history-retention-title-actions">
                <button
                  type="button"
                  className="history-retention-primary-button"
                  onClick={() => void reconstructHistory()}
                  disabled={!appSettingsLoaded || isHistoryReconstructionActive || hasActiveJobs}
                >
                  {isHistoryReconstructionActive
                    ? t("libraries.historyRetention.reconstructing")
                    : t("libraries.historyRetention.reconstructButton")}
                </button>
                <TooltipTrigger
                  ariaLabel={t("libraries.historyRetention.reconstructTooltipAria")}
                  content={t("libraries.historyRetention.reconstructTooltip")}
                  preserveLineBreaks
                />
              </div>
            }
            collapseButtonClassName="async-panel-toggle-icon-button-flat"
            collapseState={{
              collapsed: !settingsPanelState.historyRetention,
              onToggle: () => toggleSettingsPanel("historyRetention"),
              bodyId: "history-retention-panel-body",
            }}
          >
            <div className="settings-sidebar-stack history-retention-panel-content">
              {isLoadingHistoryStorage ? <p className="field-hint">{t("libraries.historyRetention.loading")}</p> : null}
              {historyStorageError ? <div className="alert">{historyStorageError}</div> : null}
              <div className="history-retention-tables">
                <div className="settings-table-shell history-retention-table-shell">
                  <table className="settings-data-table history-retention-table">
                    <thead>
                      <tr>
                        <th>{t("libraries.historyRetention.bucketLabel")}</th>
                        <th>{t("libraries.historyRetention.daysLabel")}</th>
                        <th>{t("libraries.historyRetention.storageLimitLabel")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {HISTORY_RETENTION_BUCKETS.map((bucket) => {
                        const bucketTitle = historyRetentionBucketTitle(bucket);
                        return (
                          <tr key={`history-retention-settings-${bucket}`}>
                            <th scope="row">{bucketTitle}</th>
                            <td>
                              <input
                                id={`${bucket}-history-days`}
                                className="history-retention-input"
                                aria-label={t("libraries.historyRetention.daysLabel")}
                                type="number"
                                min="0"
                                inputMode="numeric"
                                value={historyRetentionInputs[bucket].days}
                                disabled={isSavingHistoryRetention || !appSettingsLoaded}
                                onChange={(event) => updateHistoryRetentionInput(bucket, "days", event.target.value)}
                                onBlur={() => void saveHistoryRetention(bucket)}
                              />
                            </td>
                            <td>
                              <input
                                id={`${bucket}-history-gb`}
                                className="history-retention-input"
                                aria-label={t("libraries.historyRetention.storageLimitLabel")}
                                type="number"
                                min="0"
                                step="0.1"
                                inputMode="decimal"
                                value={historyRetentionInputs[bucket].storage_limit_gb}
                                disabled={isSavingHistoryRetention || !appSettingsLoaded}
                                onChange={(event) =>
                                  updateHistoryRetentionInput(bucket, "storage_limit_gb", event.target.value)
                                }
                                onBlur={() => void saveHistoryRetention(bucket)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="field-hint">{t("libraries.historyRetention.zeroUnlimited")}</p>
                <p className="field-hint">{t("libraries.historyRetention.scopeNote")}</p>
                <div className="settings-table-shell history-retention-table-shell">
                  <table className="settings-data-table history-retention-table">
                    <thead>
                      <tr>
                        <th>{t("libraries.historyRetention.bucketLabel")}</th>
                        <th>{t("libraries.historyRetention.currentStorage")}</th>
                        <th>{t("libraries.historyRetention.averagePerDay")}</th>
                        <th>{t("libraries.historyRetention.projected30Days")}</th>
                        <th>{t("libraries.historyRetention.projectedConfigured")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {HISTORY_RETENTION_BUCKETS.map((bucket) => {
                        const category = historyStorage?.categories[bucket];
                        return (
                          <tr key={`history-retention-forecast-${bucket}`}>
                            <th scope="row">{historyRetentionBucketTitle(bucket)}</th>
                            <td>{formatBytes(category?.current_estimated_bytes ?? 0)}</td>
                            <td>{formatBytes(category?.average_daily_bytes ?? 0)}</td>
                            <td>{formatBytes(category?.projected_bytes_30d ?? 0)}</td>
                            <td>{formatHistoryProjection(category?.projected_bytes_for_configured_days)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {historyReconstruction && isHistoryReconstructionActive ? (
                <div className="history-reconstruction-progress" role="status" aria-live="polite">
                  <div className="distribution-copy">
                    <strong>{formatHistoryReconstructionPhaseLabel(historyReconstruction)}</strong>
                    <span>{Math.round(historyReconstruction.progress_percent)}%</span>
                  </div>
                  {formatHistoryReconstructionPhaseDetail(historyReconstruction) ? (
                    <p className="field-hint history-reconstruction-progress-detail">
                      {formatHistoryReconstructionPhaseDetail(historyReconstruction)}
                    </p>
                  ) : null}
                  <div className="progress">
                    <span style={{ width: `${historyReconstruction.progress_percent}%` }} />
                  </div>
                  <div className="history-reconstruction-progress-meta">
                    <span>
                      {t("libraries.historyRetention.progressLibraries", {
                        completed: historyReconstruction.libraries_processed,
                        total: historyReconstruction.libraries_total,
                      })}
                    </span>
                    {historyReconstruction.current_library_name ? (
                      <span>
                        {t("libraries.historyRetention.progressCurrentLibrary", {
                          name: historyReconstruction.current_library_name,
                        })}
                      </span>
                    ) : null}
                    <span>
                      {t("libraries.historyRetention.progressEntries", {
                        libraryEntries: historyReconstruction.created_library_history_entries,
                        updatedLibraryEntries: historyReconstruction.updated_library_history_entries,
                        fileEntries: historyReconstruction.created_file_history_entries,
                      })}
                    </span>
                  </div>
                </div>
              ) : null}
              {hasActiveJobs ? (
                <p className="field-hint">{t("libraries.historyRetention.reconstructActiveScanHint")}</p>
              ) : null}
              {historyStorage && historyStorage.reclaimable_file_bytes > 0 ? (
                <p className="field-hint">
                  {t("libraries.historyRetention.reclaimableNote", {
                    reclaimable: formatBytes(historyStorage.reclaimable_file_bytes),
                  })}
                </p>
              ) : null}
              {historyRetentionStatus ? (
                <div className={`alert${historyRetentionStatusTone === "success" ? " success" : ""}`}>
                  {historyRetentionStatus}
                </div>
              ) : null}
            </div>
          </AsyncPanel>

          <AsyncPanel
            title={t("scanLogs.title")}
            subtitle={t("scanLogs.subtitle")}
            loading={isLoadingRecentScanJobs}
            error={recentScanJobsError}
            collapseState={{
              collapsed: !settingsPanelState.recentScanLogs,
              onToggle: () => toggleSettingsPanel("recentScanLogs"),
              bodyId: "recent-scan-logs-panel-body",
            }}
          >
            {recentScanJobs.length === 0 ? (
              <div className="notice">{t("scanLogs.empty")}</div>
            ) : (
              <>
                <div className="scan-log-list-shell">
                  <div className="scan-log-list">
                    {recentScanJobs.map((job) => {
                      const expanded = Boolean(expandedScanJobIds[job.id]);
                      return (
                        <div className="media-card scan-log-card" key={job.id}>
                          <button
                            type="button"
                            className="scan-log-summary"
                            aria-expanded={expanded}
                            onClick={() => void toggleScanJobExpansion(job.id)}
                          >
                            <div className="scan-log-summary-head">
                              <div className="scan-log-summary-copy">
                                <strong>{scanLogTitle(job)}</strong>
                                <span>{job.library_name ?? t("scanLogs.unknownLibrary")}</span>
                              </div>
                              <div className="meta-tags">
                                <span className={`badge scan-log-outcome badge-${job.outcome}`}>
                                  {formatOutcome(t, job.outcome)}
                                </span>
                                <span className="badge">{formatTriggerSource(t, job.trigger_source)}</span>
                                {job.job_type === "full" ? (
                                  <span className="badge">{formatScanJobType(t, job.job_type)}</span>
                                ) : null}
                                {expanded ? (
                                  <ChevronDown aria-hidden="true" className="nav-icon" />
                                ) : (
                                  <ChevronRight aria-hidden="true" className="nav-icon" />
                                )}
                              </div>
                            </div>
                          </button>
                          {expanded ? renderScanJobDetail(job) : null}
                        </div>
                      );
                    })}
                    {hasMoreRecentScanJobs ? (
                      <div className="scan-log-load-more">
                        <button
                          type="button"
                          className="secondary"
                          disabled={isLoadingMoreRecentScanJobs}
                          onClick={() => void loadMoreRecentScanJobs()}
                        >
                          {isLoadingMoreRecentScanJobs ? t("scanLogs.loadingMore") : t("scanLogs.loadMore")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </AsyncPanel>
        </div>

        <div className="settings-sidebar">
          <AsyncPanel
            title={t("libraries.createTitle")}
            error={submitError}
            collapseState={{
              collapsed: !settingsPanelState.createLibrary,
              onToggle: () => toggleSettingsPanel("createLibrary"),
              bodyId: "create-library-panel-body",
            }}
          >
            <form className="form-grid" onSubmit={handleSubmit}>
              <p className="field-hint field-span-full">
                {desktopApp ? t("libraries.createSubtitleDesktop") : t("libraries.createSubtitle")}
              </p>
              <div className="field">
                <label htmlFor="library-name">{t("libraries.name")}</label>
                <input
                  id="library-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t("libraries.namePlaceholder")}
                  required
                />
              </div>
              <div className="field">
                <div className="field-label-row">
                  <label htmlFor="library-type">{t("libraries.type")}</label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.typeTooltipAria")}
                    content={t("libraries.typeTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <select
                  id="library-type"
                  value={form.type}
                  onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as LibraryType }))}
                >
                  <option value="movies">{t("libraryTypes.movies")}</option>
                  <option value="series">{t("libraryTypes.series")}</option>
                  <option value="mixed">{t("libraryTypes.mixed")}</option>
                  <option value="other">{t("libraryTypes.other")}</option>
                </select>
              </div>
              {desktopApp ? (
                <div className="field field-span-full">
                  <label htmlFor="library-path">{t("pathBrowser.selected")}</label>
                  <div className="desktop-path-field">
                    <div className="desktop-path-row">
                      <input
                        id="library-path"
                        value={form.path}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, path: event.target.value }))
                        }
                        placeholder={t("libraries.desktopPathPlaceholder")}
                        required
                      />
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void selectDesktopLibraryPath()}
                      >
                        {t("libraries.chooseFolder")}
                      </button>
                    </div>
                    {formPathInspection ? (
                      <div className="meta-row">
                        <span className="badge">{t(`libraries.pathKinds.${formPathInspection.path_kind}`)}</span>
                        {!formPathInspection.exists || !formPathInspection.is_directory ? (
                          <span className="field-hint">{t("libraries.desktopPathMustExist")}</span>
                        ) : null}
                        {formPathInspection.exists && formPathInspection.is_directory && !formPathInspection.watch_supported ? (
                          <span className="field-hint">{t("libraries.watchUnavailableNetwork")}</span>
                        ) : null}
                      </div>
                    ) : null}
                    {formPathInspectionError ? <div className="alert">{formPathInspectionError}</div> : null}
                  </div>
                </div>
              ) : (
                <PathBrowser
                  value={form.path}
                  onChange={(path) => setForm((current) => ({ ...current, path }))}
                />
              )}
              <button type="submit" className="history-retention-primary-button" disabled={submitting}>
                {submitting ? t("libraries.creating") : t("libraries.createButton")}
              </button>
            </form>
          </AsyncPanel>

          <AsyncPanel
            title={t("libraries.appSettings")}
            collapseState={{
              collapsed: !settingsPanelState.appSettings,
              onToggle: () => toggleSettingsPanel("appSettings"),
              bodyId: "app-settings-panel-body",
            }}
          >
            <div className="settings-sidebar-stack">
              <div className="app-settings-performance-grid">
                <div className="field">
                  <label htmlFor="app-language">{t("libraries.language")}</label>
                  <select
                    id="app-language"
                    value={i18n.resolvedLanguage ?? "en"}
                    onChange={(event) => void i18n.changeLanguage(event.target.value)}
                  >
                    <option value="en">{t("language.en")}</option>
                    <option value="de">{t("language.de")}</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="app-theme">{t("libraries.theme")}</label>
                  <select
                    id="app-theme"
                    value={themePref}
                    onChange={(event) => setThemePref(event.target.value as ThemePreference)}
                  >
                    <option value="system">{t("theme.system")}</option>
                    <option value="light">{t("theme.light")}</option>
                    <option value="dark">{t("theme.dark")}</option>
                  </select>
                </div>
              </div>
              <div className="app-settings-divider" aria-hidden="true" />
              <div className="app-settings-section">
                <p className="app-settings-section-title">{t("libraries.scanSettingsTitle")}</p>
                <div className="app-settings-performance-grid">
                  <div className="field">
                    <div className="field-label-row">
                      <label htmlFor="scan-worker-count">{t("libraries.scanWorkerCount")}</label>
                      <TooltipTrigger
                        ariaLabel={t("libraries.scanWorkerCountTooltipAria")}
                        content={t("libraries.scanWorkerCountTooltip", { max: SCAN_WORKER_COUNT_MAX })}
                        preserveLineBreaks
                      >
                        ?
                      </TooltipTrigger>
                    </div>
                    <select
                      id="scan-worker-count"
                      value={scanWorkerCountInput}
                      disabled={isSavingScanPerformance || !appSettingsLoaded}
                      onChange={(event) => {
                        updateScanWorkerCountInput(event.target.value);
                        void saveScanPerformance(event.target.value, parallelScanJobsInputRef.current);
                      }}
                    >
                      {SCAN_WORKER_OPTIONS.map((workerCount) => (
                        <option key={workerCount} value={workerCount}>
                          {workerCount}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <div className="field-label-row">
                      <label htmlFor="parallel-scan-jobs">{t("libraries.parallelScanJobs")}</label>
                      <TooltipTrigger
                        ariaLabel={t("libraries.parallelScanJobsTooltipAria")}
                        content={t("libraries.parallelScanJobsTooltip", { max: PARALLEL_SCAN_JOB_COUNT_MAX })}
                        preserveLineBreaks
                      >
                        ?
                      </TooltipTrigger>
                    </div>
                    <select
                      id="parallel-scan-jobs"
                      value={parallelScanJobsInput}
                      disabled={isSavingScanPerformance || !appSettingsLoaded}
                      onChange={(event) => {
                        updateParallelScanJobsInput(event.target.value);
                        void saveScanPerformance(scanWorkerCountInputRef.current, event.target.value);
                      }}
                    >
                      {PARALLEL_SCAN_JOB_OPTIONS.map((workerCount) => (
                        <option key={workerCount} value={workerCount}>
                          {workerCount}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                  </div>
                </div>
              </div>
              <div className="app-settings-divider" aria-hidden="true" />
              <div className="app-settings-section">
                <p className="app-settings-section-title">{t("libraries.plotsChartsTitle")}</p>
                <div className="app-settings-performance-grid">
                  <div className="field">
                    <div className="field-label-row">
                      <label htmlFor="comparison-scatter-point-limit">{t("libraries.comparisonScatterPointLimit")}</label>
                      <TooltipTrigger
                        ariaLabel={t("libraries.comparisonScatterPointLimitTooltipAria")}
                        content={t("libraries.comparisonScatterPointLimitTooltip", { max: COMPARISON_SCATTER_POINT_LIMIT_MAX })}
                        preserveLineBreaks
                      >
                        ?
                      </TooltipTrigger>
                    </div>
                    <select
                      id="comparison-scatter-point-limit"
                      value={comparisonScatterPointLimitInput}
                      disabled={isSavingScanPerformance || !appSettingsLoaded}
                      onChange={(event) => {
                        updateComparisonScatterPointLimitInput(event.target.value);
                        void saveScanPerformance(
                          scanWorkerCountInputRef.current,
                          parallelScanJobsInputRef.current,
                          event.target.value,
                        );
                      }}
                    >
                      {COMPARISON_SCATTER_POINT_LIMIT_OPTIONS.map((pointLimit) => (
                        <option key={pointLimit} value={pointLimit}>
                          {pointLimit}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              {scanPerformanceStatus ? <div className="alert">{scanPerformanceStatus}</div> : null}
              <div className="app-settings-divider" aria-hidden="true" />
              <div className="app-settings-section">
                <p className="app-settings-section-title">{t("libraries.featureFlagsTitle")}</p>
                <div className="app-settings-flag-row">
                  <label className="app-settings-flag-toggle" htmlFor="show-analyzed-files-csv-export">
                    <input
                      id="show-analyzed-files-csv-export"
                      type="checkbox"
                      checked={showAnalyzedFilesCsvExport}
                      disabled={isSavingFeatureFlags || !appSettingsLoaded}
                      onChange={(event) => void toggleAnalyzedFilesCsvExport(event.target.checked)}
                    />
                    <span>{t("libraries.featureFlags.showAnalyzedFilesCsvExport")}</span>
                  </label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.featureFlags.showAnalyzedFilesCsvExportTooltipAria")}
                    content={t("libraries.featureFlags.showAnalyzedFilesCsvExportTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <div className="app-settings-flag-row">
                  <label className="app-settings-flag-toggle" htmlFor="show-full-width-app-shell">
                    <input
                      id="show-full-width-app-shell"
                      type="checkbox"
                      checked={showFullWidthAppShell}
                      disabled={isSavingFeatureFlags || !appSettingsLoaded}
                      onChange={(event) => void toggleFullWidthAppShell(event.target.checked)}
                    />
                    <span>{t("libraries.featureFlags.showFullWidthAppShell")}</span>
                  </label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.featureFlags.showFullWidthAppShellTooltipAria")}
                    content={t("libraries.featureFlags.showFullWidthAppShellTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <div className="app-settings-flag-row">
                  <label className="app-settings-flag-toggle" htmlFor="hide-quality-score-meter">
                    <input
                      id="hide-quality-score-meter"
                      type="checkbox"
                      checked={hideQualityScoreMeter}
                      disabled={isSavingFeatureFlags || !appSettingsLoaded}
                      onChange={(event) => void toggleHideQualityScoreMeter(event.target.checked)}
                    />
                    <span>{t("libraries.featureFlags.hideQualityScoreMeter")}</span>
                  </label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.featureFlags.hideQualityScoreMeterTooltipAria")}
                    content={t("libraries.featureFlags.hideQualityScoreMeterTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <div className="app-settings-flag-row">
                  <label className="app-settings-flag-toggle" htmlFor="unlimited-panel-size">
                    <input
                      id="unlimited-panel-size"
                      type="checkbox"
                      checked={unlimitedPanelSize}
                      disabled={isSavingFeatureFlags || !appSettingsLoaded}
                      onChange={(event) => void toggleUnlimitedPanelSize(event.target.checked)}
                    />
                    <span>{t("libraries.featureFlags.unlimitedPanelSize")}</span>
                  </label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.featureFlags.unlimitedPanelSizeTooltipAria")}
                    content={t("libraries.featureFlags.unlimitedPanelSizeTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <div className="app-settings-flag-row">
                  <label className="app-settings-flag-toggle" htmlFor="in-depth-dolby-vision-profiles">
                    <input
                      id="in-depth-dolby-vision-profiles"
                      type="checkbox"
                      checked={inDepthDolbyVisionProfiles}
                      disabled={isSavingFeatureFlags || !appSettingsLoaded}
                      onChange={(event) => void toggleInDepthDolbyVisionProfiles(event.target.checked)}
                    />
                    <span>{t("libraries.featureFlags.inDepthDolbyVisionProfiles")}</span>
                  </label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.featureFlags.inDepthDolbyVisionProfilesTooltipAria")}
                    content={t("libraries.featureFlags.inDepthDolbyVisionProfilesTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
              </div>
              {featureFlagsStatus ? <div className="alert">{featureFlagsStatus}</div> : null}
            </div>
          </AsyncPanel>
        </div>
      </div>
    </>
  );
}

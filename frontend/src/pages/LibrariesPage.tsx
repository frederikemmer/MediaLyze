import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

import { AsyncPanel } from "../components/AsyncPanel";
import { PathBrowser } from "../components/PathBrowser";
import { TooltipTrigger } from "../components/TooltipTrigger";
import { useAppData } from "../lib/app-data";
import {
  api,
  DEFAULT_QUALITY_PROFILE,
  type LibrarySummary,
  type PathInspection,
  type QualityProfile,
  type ResolutionCategory,
  type RecentScanJob,
  type ScanJobDetail,
} from "../lib/api";
import { getDesktopBridge, isDesktopApp } from "../lib/desktop";
import { formatBytes, formatDate, formatDuration } from "../lib/format";
import { getIgnorePatternSectionState, saveIgnorePatternSectionState } from "../lib/ignore-pattern-sections";
import {
  getLibraryStatisticsSettings,
  getOrderedLibraryStatisticDefinitions,
  moveLibraryStatistic,
  saveLibraryStatisticsSettings,
  updateLibraryStatisticVisibility,
  type LibraryStatisticId,
  type LibraryStatisticsSettings,
} from "../lib/library-statistics-settings";
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
  type: string;
  scan_mode: string;
};

const EMPTY_FORM: CreateLibraryForm = {
  name: "",
  path: ".",
  type: "mixed",
  scan_mode: "manual",
};

function createEmptyForm(isDesktop: boolean): CreateLibraryForm {
  return {
    ...EMPTY_FORM,
    path: isDesktop ? "" : EMPTY_FORM.path,
  };
}

type LibrarySettingsForm = {
  scan_mode: string;
  interval_minutes: number;
  debounce_seconds: number;
  quality_profile: QualityProfile;
  duplicate_detection_mode: "filename" | "content_hash" | "perceptual_hash";
};

type IgnorePatternGroup = "user" | "default";

type IgnorePatternDrafts = Record<IgnorePatternGroup, string>;

type PersistedIgnorePatterns = Record<IgnorePatternGroup, string[]>;
const VIDEO_CODEC_OPTIONS = ["h264", "hevc", "av1"];
const AUDIO_CHANNEL_OPTIONS = ["mono", "stereo", "5.1", "7.1"];

function formatProgressPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (value >= 99 || value <= 0) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
}
const AUDIO_CODEC_OPTIONS = ["aac", "ac3", "eac3", "dts", "dts_hd", "truehd", "flac"];
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
    interval_minutes: Number(library.scan_config.interval_minutes ?? 60),
    debounce_seconds: Number(library.scan_config.debounce_seconds ?? 15),
    quality_profile: cloneQualityProfile(library.quality_profile ?? DEFAULT_QUALITY_PROFILE),
    duplicate_detection_mode: library.duplicate_detection_mode ?? "filename",
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
    current.interval_minutes === settings.interval_minutes &&
    current.debounce_seconds === settings.debounce_seconds &&
    current.duplicate_detection_mode === settings.duplicate_detection_mode &&
    JSON.stringify(current.quality_profile) === JSON.stringify(settings.quality_profile)
  );
}

function normalizeIgnorePatterns(patterns: string[]): string[] {
  return patterns
    .map((line) => line.trim())
    .filter(Boolean);
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
  const [statisticsSettings, setStatisticsSettings] = useState<LibraryStatisticsSettings>(() => getLibraryStatisticsSettings());
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
  const [draggedStatisticId, setDraggedStatisticId] = useState<LibraryStatisticId | null>(null);
  const [dropTargetStatisticId, setDropTargetStatisticId] = useState<LibraryStatisticId | null>(null);
  const [form, setForm] = useState<CreateLibraryForm>(() => createEmptyForm(desktopApp));
  const [formPathInspection, setFormPathInspection] = useState<PathInspection | null>(null);
  const [formPathInspectionError, setFormPathInspectionError] = useState<string | null>(null);
  const [libraryPathInspections, setLibraryPathInspections] = useState<Record<number, PathInspection | null>>({});
  const [userIgnorePatternInputs, setUserIgnorePatternInputs] = useState<string[]>([]);
  const [defaultIgnorePatternInputs, setDefaultIgnorePatternInputs] = useState<string[]>([]);
  const [ignorePatternDrafts, setIgnorePatternDrafts] = useState<IgnorePatternDrafts>({ user: "", default: "" });
  const [ignorePatternSectionState, setIgnorePatternSectionState] = useState(() => getIgnorePatternSectionState());
  const [ignorePatternsLoadError, setIgnorePatternsLoadError] = useState<string | null>(null);
  const [ignorePatternsStatus, setIgnorePatternsStatus] = useState<string | null>(null);
  const [isLoadingIgnorePatterns, setIsLoadingIgnorePatterns] = useState(true);
  const [isSavingIgnorePatterns, setIsSavingIgnorePatterns] = useState(false);
  const [showDolbyVisionProfiles, setShowDolbyVisionProfiles] = useState(false);
  const [showAnalyzedFilesCsvExport, setShowAnalyzedFilesCsvExport] = useState(false);
  const [resolutionCategoryDrafts, setResolutionCategoryDrafts] = useState<ResolutionCategoryDraft[]>([]);
  const [newResolutionCategoryDraft, setNewResolutionCategoryDraft] = useState<NewResolutionCategoryDraft>(
    EMPTY_NEW_RESOLUTION_CATEGORY_DRAFT,
  );
  const [featureFlagsStatus, setFeatureFlagsStatus] = useState<string | null>(null);
  const [resolutionCategoriesStatus, setResolutionCategoriesStatus] = useState<string | null>(null);
  const [isSavingFeatureFlags, setIsSavingFeatureFlags] = useState(false);
  const [isSavingResolutionCategories, setIsSavingResolutionCategories] = useState(false);
  const ignorePatternsSaveTimer = useRef<number | null>(null);
  const persistedResolutionCategories = useRef<ResolutionCategory[]>(normalizeResolutionCategories(appSettings.resolution_categories));
  const ignorePatternsRequestId = useRef(0);
  const ignorePatternsSuccessId = useRef(0);
  const persistedIgnorePatterns = useRef<PersistedIgnorePatterns>({ user: [], default: [] });
  const resolutionOptions = normalizeResolutionCategories(appSettings.resolution_categories);
  const resolutionOptionIds = resolutionOptions.map((category) => category.id);
  const resolutionOptionLabels = new Map(resolutionOptions.map((category) => [category.id, category.label]));
  const { preference: themePref, setPreference: setThemePref } = useTheme();
  const { activeJobs, hasActiveJobs, refresh } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const orderedStatistics = getOrderedLibraryStatisticDefinitions(statisticsSettings);

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
    persistedResolutionCategories.current = persistedResolution;
    ignorePatternsSuccessId.current = ignorePatternsRequestId.current;
    setUserIgnorePatternInputs(persisted.user);
    setDefaultIgnorePatternInputs(persisted.default);
    setResolutionCategoryDrafts(cloneResolutionCategoryDrafts(persistedResolution));
    setShowDolbyVisionProfiles(appSettings.feature_flags.show_dolby_vision_profiles);
    setShowAnalyzedFilesCsvExport(appSettings.feature_flags.show_analyzed_files_csv_export);
  }, [appSettings, appSettingsLoaded]);

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
      interval_minutes: 60,
      debounce_seconds: 15,
      quality_profile: cloneQualityProfile(DEFAULT_QUALITY_PROFILE),
      duplicate_detection_mode: "filename",
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
          scan_config: buildScanConfig(next),
          quality_profile: next.quality_profile,
          duplicate_detection_mode: next.duplicate_detection_mode,
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

  async function runLibraryScan(libraryId: number) {
    const current = settingsForms[libraryId];
    if (current && autoSaveTimers.current[libraryId]) {
      window.clearTimeout(autoSaveTimers.current[libraryId]);
      delete autoSaveTimers.current[libraryId];
      try {
        const updated = await api.updateLibrarySettings(libraryId, {
          scan_mode: current.scan_mode,
          scan_config: buildScanConfig(current),
          quality_profile: current.quality_profile,
          duplicate_detection_mode: current.duplicate_detection_mode,
        });
        upsertLibrary(updated);
      } catch (reason) {
        setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
        return;
      }
    }

    try {
      await api.scanLibrary(libraryId, "incremental");
      await refresh();
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: null }));
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [libraryId]: (reason as Error).message }));
      return;
    }
  }

  async function renameLibrary(library: LibrarySummary) {
    const nextName = window.prompt(t("libraries.renamePrompt"), library.name);
    if (nextName === null) {
      return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === library.name) {
      return;
    }

    try {
      const updated = await api.updateLibrarySettings(library.id, { name: trimmedName });
      upsertLibrary(updated);
      setLibraryMessages((messages) => ({ ...messages, [library.id]: null }));
    } catch (reason) {
      setLibraryMessages((messages) => ({ ...messages, [library.id]: (reason as Error).message }));
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

  function toggleIgnorePatternSection(section: "customExpanded" | "defaultsExpanded") {
    persistIgnorePatternSectionStateValue({
      ...ignorePatternSectionState,
      [section]: !ignorePatternSectionState[section],
    });
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
    nextShowDolbyVisionProfiles: boolean,
    nextShowAnalyzedFilesCsvExport: boolean,
    nextResolutionCategories?: ResolutionCategory[],
  ) {
    return api.updateAppSettings({
      user_ignore_patterns: normalizeIgnorePatterns(nextUserPatterns),
      default_ignore_patterns: normalizeIgnorePatterns(nextDefaultPatterns),
      ...(nextResolutionCategories ? { resolution_categories: normalizeResolutionCategories(nextResolutionCategories) } : {}),
      feature_flags: {
        show_dolby_vision_profiles: nextShowDolbyVisionProfiles,
        show_analyzed_files_csv_export: nextShowAnalyzedFilesCsvExport,
      },
    });
  }

  async function persistIgnorePatterns(
    nextUserPatterns: string[],
    nextDefaultPatterns: string[],
    nextShowDolbyVisionProfiles = showDolbyVisionProfiles,
    nextShowAnalyzedFilesCsvExport = showAnalyzedFilesCsvExport,
    nextResolutionCategories?: ResolutionCategory[],
  ) {
    const requestId = ignorePatternsRequestId.current + 1;
    ignorePatternsRequestId.current = requestId;
    setIsSavingIgnorePatterns(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        nextUserPatterns,
        nextDefaultPatterns,
        nextShowDolbyVisionProfiles,
        nextShowAnalyzedFilesCsvExport,
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
        setShowDolbyVisionProfiles(updated.feature_flags.show_dolby_vision_profiles);
        setShowAnalyzedFilesCsvExport(updated.feature_flags.show_analyzed_files_csv_export);
        persistedResolutionCategories.current = normalizeResolutionCategories(updated.resolution_categories);
        setResolutionCategoryDrafts(cloneResolutionCategoryDrafts(persistedResolutionCategories.current));
        setIgnorePatternsStatus(null);
        setFeatureFlagsStatus(null);
        setResolutionCategoriesStatus(null);
      }
      setAppSettings(updated);
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

  async function toggleDolbyVisionProfiles(enabled: boolean) {
    const previousValue = showDolbyVisionProfiles;
    setShowDolbyVisionProfiles(enabled);
    setFeatureFlagsStatus(null);
    setIsSavingFeatureFlags(true);
    try {
      const updated = await persistAppSettingsSnapshot(
        userIgnorePatternInputs,
        defaultIgnorePatternInputs,
        enabled,
        showAnalyzedFilesCsvExport,
      );
      setShowDolbyVisionProfiles(updated.feature_flags.show_dolby_vision_profiles);
      setShowAnalyzedFilesCsvExport(updated.feature_flags.show_analyzed_files_csv_export);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setAppSettings(updated);
    } catch (reason) {
      setShowDolbyVisionProfiles(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
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
        showDolbyVisionProfiles,
        enabled,
      );
      setShowDolbyVisionProfiles(updated.feature_flags.show_dolby_vision_profiles);
      setShowAnalyzedFilesCsvExport(updated.feature_flags.show_analyzed_files_csv_export);
      setFeatureFlagsStatus(null);
      setIgnorePatternsStatus(null);
      setAppSettings(updated);
    } catch (reason) {
      setShowAnalyzedFilesCsvExport(previousValue);
      setFeatureFlagsStatus((reason as Error).message);
    } finally {
      setIsSavingFeatureFlags(false);
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
        showDolbyVisionProfiles,
        showAnalyzedFilesCsvExport,
        nextCategories,
      );
      const normalized = normalizeResolutionCategories(updated.resolution_categories);
      persistedResolutionCategories.current = normalized;
      setResolutionCategoryDrafts(cloneResolutionCategoryDrafts(normalized));
      setResolutionCategoriesStatus(null);
      setIgnorePatternsStatus(null);
      setFeatureFlagsStatus(null);
      setAppSettings(updated);
    } catch (reason) {
      setResolutionCategoriesStatus((reason as Error).message);
    } finally {
      setIsSavingResolutionCategories(false);
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

  function scheduleIgnorePatternsSave(nextUserPatterns: string[], nextDefaultPatterns: string[]) {
    setUserIgnorePatternInputs(nextUserPatterns);
    setDefaultIgnorePatternInputs(nextDefaultPatterns);
    setIgnorePatternsStatus(null);
    if (ignorePatternsSaveTimer.current) {
      window.clearTimeout(ignorePatternsSaveTimer.current);
    }
    ignorePatternsSaveTimer.current = window.setTimeout(() => {
      ignorePatternsSaveTimer.current = null;
      void persistIgnorePatterns(nextUserPatterns, nextDefaultPatterns);
    }, 450);
  }

  function flushIgnorePatternsSave(nextUserPatterns: string[], nextDefaultPatterns: string[]) {
    if (ignorePatternsSaveTimer.current) {
      window.clearTimeout(ignorePatternsSaveTimer.current);
      ignorePatternsSaveTimer.current = null;
    }
    return persistIgnorePatterns(nextUserPatterns, nextDefaultPatterns);
  }

  async function addIgnorePattern(group: IgnorePatternGroup) {
    const candidate = ignorePatternDrafts[group].trim();
    if (!candidate) {
      return;
    }
    const nextUserPatterns = group === "user" ? [...userIgnorePatternInputs, candidate] : userIgnorePatternInputs;
    const nextDefaultPatterns =
      group === "default" ? [...defaultIgnorePatternInputs, candidate] : defaultIgnorePatternInputs;
    const updated = await flushIgnorePatternsSave(nextUserPatterns, nextDefaultPatterns);
    if (updated) {
      setIgnorePatternDrafts((current) => ({ ...current, [group]: "" }));
    }
  }

  async function removeIgnorePattern(group: IgnorePatternGroup, index: number) {
    const sourcePatterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const nextPatterns = sourcePatterns.filter((_, rowIndex) => rowIndex !== index);
    if (group === "user") {
      setUserIgnorePatternInputs(nextPatterns);
      await flushIgnorePatternsSave(nextPatterns, defaultIgnorePatternInputs);
      return;
    }
    setDefaultIgnorePatternInputs(nextPatterns);
    await flushIgnorePatternsSave(userIgnorePatternInputs, nextPatterns);
  }

  function updateIgnorePattern(group: IgnorePatternGroup, index: number, value: string) {
    const sourcePatterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const nextPatterns = sourcePatterns.map((pattern, rowIndex) => (rowIndex === index ? value : pattern));
    if (group === "user") {
      scheduleIgnorePatternsSave(nextPatterns, defaultIgnorePatternInputs);
      return;
    }
    scheduleIgnorePatternsSave(userIgnorePatternInputs, nextPatterns);
  }

  async function finalizeIgnorePatternEdit(group: IgnorePatternGroup, index: number) {
    const sourcePatterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const currentValue = sourcePatterns[index];
    if (currentValue === undefined) {
      return;
    }
    const nextPatterns = sourcePatterns.map((pattern, rowIndex) => (rowIndex === index ? pattern.trim() : pattern));
    if (group === "user") {
      setUserIgnorePatternInputs(nextPatterns);
      await flushIgnorePatternsSave(nextPatterns, defaultIgnorePatternInputs);
      return;
    }
    setDefaultIgnorePatternInputs(nextPatterns);
    await flushIgnorePatternsSave(userIgnorePatternInputs, nextPatterns);
  }

  function updateStatisticsSettings(
    transform: (current: LibraryStatisticsSettings) => LibraryStatisticsSettings,
  ) {
    setStatisticsSettings((current) => saveLibraryStatisticsSettings(transform(current)));
  }

  function toggleStatisticVisibility(
    statisticId: LibraryStatisticId,
    area: "panelEnabled" | "tableEnabled" | "dashboardEnabled",
  ) {
    updateStatisticsSettings((current) =>
      updateLibraryStatisticVisibility(current, statisticId, {
        [area]: !current.visibility[statisticId][area],
      }),
    );
  }

  function handleStatisticDrop(targetId: LibraryStatisticId) {
    if (!draggedStatisticId) {
      return;
    }

    updateStatisticsSettings((current) => moveLibraryStatistic(current, draggedStatisticId, targetId));
    setDraggedStatisticId(null);
    setDropTargetStatisticId(null);
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
            <strong>{detail.scan_summary.duplicates.duplicate_files}</strong>
            <span>{t("scanLogs.metricDuplicates")}</span>
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
                <strong>{t("scanLogs.duplicateDetection")}</strong>
                <span className="scan-log-collapse-summary">
                  {detail.scan_summary.duplicates.mode ?? t("scanLogs.none")}
                </span>
              </span>
              <span className="scan-log-collapse-meta">
                <span className="badge">{detail.scan_summary.duplicates.groups_found}</span>
                <ChevronRight aria-hidden="true" className="nav-icon scan-log-collapse-icon" />
              </span>
            </summary>
            <div className="scan-log-collapse-content">
              <div className="scan-log-summary-grid">
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.artifacts_completed}</strong>
                  <span>{t("scanLogs.duplicateArtifacts")}</span>
                </div>
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.artifact_cache_hits}</strong>
                  <span>{t("scanLogs.duplicateCacheHits")}</span>
                </div>
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.groups_found}</strong>
                  <span>{t("scanLogs.duplicateGroups")}</span>
                </div>
                <div className="scan-log-stat">
                  <strong>{detail.scan_summary.duplicates.pending_files}</strong>
                  <span>{t("scanLogs.duplicatePending")}</span>
                </div>
              </div>
            </div>
          </details>

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
              {detail.scan_summary.analysis.failed_files.length > 0 ? (
                <div className="scan-log-scroll-area">
                  <div className="scan-log-path-list">
                    {detail.scan_summary.analysis.failed_files.map((entry) => (
                      <TooltipTrigger
                        key={`${detail.id}-${entry.path}`}
                        ariaLabel={t("scanLogs.failedFileReasonTooltipAria", { path: entry.path })}
                        content={entry.reason}
                        preserveLineBreaks
                        align="start"
                        className="scan-log-path-tooltip-trigger"
                      >
                        <code className="scan-log-path">{entry.path}</code>
                      </TooltipTrigger>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="notice scan-log-empty-detail">{t("scanLogs.none")}</div>
              )}
              {detail.scan_summary.analysis.failed_files_truncated_count > 0 ? (
                <div className="subtitle">
                  {t("scanLogs.moreEntries", { count: detail.scan_summary.analysis.failed_files_truncated_count })}
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    );
  }

  function renderIgnorePatternSection(
    group: IgnorePatternGroup,
    title: string,
    expanded: boolean,
    toggleKey: "customExpanded" | "defaultsExpanded",
    inputId: string,
  ) {
    const patterns = group === "user" ? userIgnorePatternInputs : defaultIgnorePatternInputs;
    const draftValue = ignorePatternDrafts[group];
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div className="ignore-pattern-section" key={group}>
        <button
          type="button"
          className="secondary ignore-pattern-section-toggle"
          aria-expanded={expanded}
          onClick={() => toggleIgnorePatternSection(toggleKey)}
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
                value={draftValue}
                onChange={(event) => {
                  setIgnorePatternDrafts((current) => ({ ...current, [group]: event.target.value }));
                  setIgnorePatternsStatus(null);
                }}
                placeholder={t("libraries.ignorePatternsPlaceholder")}
                spellCheck={false}
              />
              <button
                type="button"
                className="secondary icon-only-button"
                aria-label={t("libraries.ignorePatternsAddAria")}
                disabled={isSavingIgnorePatterns || !draftValue.trim()}
                onClick={() => void addIgnorePattern(group)}
              >
                <Plus aria-hidden="true" className="nav-icon" />
              </button>
            </div>
            <div className="ignore-patterns-stack">
              {patterns.map((pattern, index) => (
                <div className="ignore-pattern-row ignore-pattern-row-saved" key={`${group}-ignore-pattern-${index}`}>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(event) => updateIgnorePattern(group, index, event.target.value)}
                    onBlur={() => void finalizeIgnorePatternEdit(group, index)}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary icon-only-button"
                    aria-label={t("libraries.ignorePatternsRemoveAria", { index: index + 1 })}
                    disabled={isSavingIgnorePatterns}
                    onClick={() => void removeIgnorePattern(group, index)}
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
        {renderQualityOrdinalRow(library, "video_codec", VIDEO_CODEC_OPTIONS)}
        {renderQualityOrdinalRow(library, "audio_channels", AUDIO_CHANNEL_OPTIONS)}
        {renderQualityOrdinalRow(library, "audio_codec", AUDIO_CODEC_OPTIONS)}
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
            collapseState={{
              collapsed: !settingsPanelState.configuredLibraries,
              onToggle: () => toggleSettingsPanel("configuredLibraries"),
              bodyId: "configured-libraries-panel-body",
            }}
          >
            <div className="listing">
              {!libraries.length ? <div className="notice">{t("libraries.addFirstLibrary")}</div> : null}
              {libraries.map((library) => (
                <div className="media-card library-settings-card" key={library.id}>
                  <div className="library-settings-header">
                    <div className="item-meta">
                      <div className="meta-tags">
                        <span className="badge">{t(`libraryTypes.${library.type}`)}</span>
                        <span className="badge">{t(`scanModes.${library.scan_mode}`)}</span>
                        {activeJobs
                          .filter((job) => job.library_id === library.id)
                          .map((job) => (
                            <span className="badge scan-badge" key={job.id}>
                              {job.phase_label}
                            </span>
                          ))}
                      </div>
                      <div className="library-title-row">
                        <h3>
                          <Link to={`/libraries/${library.id}`} className="file-link">
                            {library.name}
                          </Link>
                        </h3>
                        <div className="library-title-actions">
                          <button
                            type="button"
                            className="secondary icon-only-button"
                            aria-label={t("libraries.renameAria", { name: library.name })}
                            onClick={() => void renameLibrary(library)}
                          >
                            <Pencil aria-hidden="true" className="nav-icon" />
                          </button>
                          <button
                            type="button"
                            className="secondary icon-only-button"
                            aria-label={t("libraries.deleteAria", { name: library.name })}
                            onClick={() => void removeLibrary(library.id)}
                          >
                            <Trash2 aria-hidden="true" className="nav-icon" />
                          </button>
                          <button
                            type="button"
                            className="small"
                            onClick={() => void runLibraryScan(library.id)}
                          >
                            {t("libraries.scanNow")}
                          </button>
                        </div>
                      </div>
                      <p className="media-meta">{library.path}</p>
                    </div>
                    <div className="library-stats">
                      <span>{library.file_count} {t("libraries.files").toLowerCase()}</span>
                      <span>{formatBytes(library.total_size_bytes)}</span>
                      <span>{formatDuration(library.total_duration_seconds)}</span>
                      <span>{t("libraries.lastScan")}: {formatDate(library.last_scan_at)}</span>
                    </div>
                  </div>
                  {activeJobs.find((job) => job.library_id === library.id) ? (
                    <>
                      <div className="progress">
                        <span
                          style={{
                            width: `${activeJobs.find((job) => job.library_id === library.id)?.progress_percent ?? 0}%`,
                          }}
                        />
                      </div>
                      <p className="media-meta">
                        {formatProgressPercent(activeJobs.find((job) => job.library_id === library.id)?.progress_percent ?? 0)}% ·{" "}
                        {activeJobs.find((job) => job.library_id === library.id)?.phase_detail ??
                          activeJobs.find((job) => job.library_id === library.id)?.phase_label}
                      </p>
                    </>
                  ) : null}
                  <div className="library-settings-form">
                    <div className="field">
                      <label htmlFor={`scan-mode-${library.id}`}>{t("libraries.scanMode")}</label>
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
                        <label htmlFor={`interval-minutes-${library.id}`}>{t("libraries.intervalMinutes")}</label>
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
                        <label htmlFor={`debounce-seconds-${library.id}`}>{t("libraries.debounceSeconds")}</label>
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
                    <div className="field">
                      <label htmlFor={`duplicate-detection-mode-${library.id}`}>
                        {t("libraries.duplicateDetectionMode")}{" "}
                        <TooltipTrigger
                          ariaLabel={t("libraries.duplicateDetectionModeTooltipAria")}
                          content={t("libraries.duplicateDetectionModeTooltip")}
                          preserveLineBreaks
                        />
                      </label>
                      <select
                        id={`duplicate-detection-mode-${library.id}`}
                        value={settingsForms[library.id]?.duplicate_detection_mode ?? library.duplicate_detection_mode}
                        onChange={(event) =>
                          updateLibraryForm(library.id, {
                            duplicate_detection_mode: event.target.value as LibrarySettingsForm["duplicate_detection_mode"],
                          })
                        }
                      >
                        <option value="filename">{t("duplicateDetectionModes.filename")}</option>
                        <option value="content_hash">{t("duplicateDetectionModes.content_hash")}</option>
                        <option value="perceptual_hash">{t("duplicateDetectionModes.perceptual_hash")}</option>
                      </select>
                    </div>
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
              ))}
            </div>
          </AsyncPanel>

          <AsyncPanel
            title={t("libraryStatistics.title")}
            collapseState={{
              collapsed: !settingsPanelState.libraryStatistics,
              onToggle: () => toggleSettingsPanel("libraryStatistics"),
              bodyId: "library-statistics-panel-body",
            }}
          >
            <div className="settings-sidebar-stack">
              <p className="settings-copy">{t("libraryStatistics.subtitle")}</p>
              <div className="settings-table-shell">
                <table className="settings-data-table library-statistics-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("libraryStatistics.name")}</th>
                      <th scope="col">{t("libraryStatistics.statistics")}</th>
                      <th scope="col">{t("libraryStatistics.table")}</th>
                      <th scope="col">{t("libraryStatistics.dashboard")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedStatistics.map((statistic) => {
                      const visibility = statisticsSettings.visibility[statistic.id];
                      return (
                        <tr
                          key={statistic.id}
                          className={dropTargetStatisticId === statistic.id ? "is-drop-target" : undefined}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (draggedStatisticId && draggedStatisticId !== statistic.id) {
                              setDropTargetStatisticId(statistic.id);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleStatisticDrop(statistic.id);
                          }}
                        >
                          <td>
                            <div className="statistic-name-cell">
                              <span
                                className={`statistics-drag-handle${draggedStatisticId === statistic.id ? " is-dragging" : ""}`}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", statistic.id);
                                  setDraggedStatisticId(statistic.id);
                                  setDropTargetStatisticId(statistic.id);
                                }}
                                onDragEnd={() => {
                                  setDraggedStatisticId(null);
                                  setDropTargetStatisticId(null);
                                }}
                                aria-hidden="true"
                              >
                                <GripVertical className="nav-icon" />
                              </span>
                              <span>{t(statistic.nameKey)}</span>
                            </div>
                          </td>
                          <td className="settings-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={visibility.panelEnabled}
                              disabled={!statistic.supportsPanel}
                              onChange={() => toggleStatisticVisibility(statistic.id, "panelEnabled")}
                            />
                          </td>
                          <td className="settings-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={visibility.tableEnabled}
                              disabled={!statistic.supportsTable}
                              onChange={() => toggleStatisticVisibility(statistic.id, "tableEnabled")}
                            />
                          </td>
                          <td className="settings-checkbox-cell">
                            <input
                              type="checkbox"
                              checked={visibility.dashboardEnabled}
                              disabled={!statistic.supportsDashboard}
                              onChange={() => toggleStatisticVisibility(statistic.id, "dashboardEnabled")}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                <label htmlFor="library-type">{t("libraries.type")}</label>
                <select
                  id="library-type"
                  value={form.type}
                  onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}
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
              <button type="submit" disabled={submitting}>
                {submitting ? t("libraries.creating") : t("libraries.createButton")}
              </button>
            </form>
          </AsyncPanel>

          <AsyncPanel
            title={t("libraries.ignorePatternsTitle")}
            subtitle={t("libraries.ignorePatternsSubtitle")}
            loading={isLoadingIgnorePatterns}
            error={ignorePatternsLoadError}
            collapseState={{
              collapsed: !settingsPanelState.ignorePatterns,
              onToggle: () => toggleSettingsPanel("ignorePatterns"),
              bodyId: "ignore-patterns-panel-body",
            }}
          >
            <div className="form-grid">
              <div className="field">
                <div className="field-label-row">
                  <label>{t("libraries.ignorePatternsLabel")}</label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.ignorePatternsTooltipAria")}
                    content={t("libraries.ignorePatternsTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
                <div className="ignore-pattern-sections">
                  {renderIgnorePatternSection(
                    "user",
                    t("libraries.ignorePatternsCustomTitle"),
                    ignorePatternSectionState.customExpanded,
                    "customExpanded",
                    "custom-ignore-patterns",
                  )}
                  {renderIgnorePatternSection(
                    "default",
                    t("libraries.ignorePatternsDefaultTitle"),
                    ignorePatternSectionState.defaultsExpanded,
                    "defaultsExpanded",
                    "default-ignore-patterns",
                  )}
                </div>
                <p className="field-hint">{t("libraries.ignorePatternsHint")}</p>
              </div>
              {ignorePatternsStatus ? <div className="alert">{ignorePatternsStatus}</div> : null}
            </div>
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
                <p className="field-hint">{t("libraries.languageHint")}</p>
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
                <p className="field-hint">{t("libraries.themeHint")}</p>
              </div>
              <div className="field">
                <div className="field-label-row">
                  <label>{t("libraries.featureFlagsTitle")}</label>
                </div>
                <div className="app-settings-flag-row">
                  <label className="app-settings-flag-toggle" htmlFor="show-dolby-vision-profiles">
                    <input
                      id="show-dolby-vision-profiles"
                      type="checkbox"
                      checked={showDolbyVisionProfiles}
                      disabled={isSavingFeatureFlags || !appSettingsLoaded}
                      onChange={(event) => void toggleDolbyVisionProfiles(event.target.checked)}
                    />
                    <span>{t("libraries.featureFlags.showDolbyVisionProfiles")}</span>
                  </label>
                  <TooltipTrigger
                    ariaLabel={t("libraries.featureFlags.showDolbyVisionProfilesTooltipAria")}
                    content={t("libraries.featureFlags.showDolbyVisionProfilesTooltip")}
                    preserveLineBreaks
                  >
                    ?
                  </TooltipTrigger>
                </div>
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

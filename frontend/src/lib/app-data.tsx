import {
  createContext,
  useEffect,
  useContext,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import i18n, { getStoredInterfaceLanguage } from "../i18n";
import { api, type AppSettings, type DashboardResponse, type JellyfinLibrary, type LibrarySummary } from "./api";
import { defaultPatternRecognitionSettings } from "./pattern-recognition";
import { DEFAULT_RESOLUTION_CATEGORIES, normalizeResolutionCategories } from "./resolution-categories";
import { readSessionCache, writeSessionCache, type SessionCacheOptions } from "./session-cache";

type AppDataContextValue = {
  appSettings: AppSettings;
  appSettingsLoaded: boolean;
  dashboard: DashboardResponse | null;
  dashboardLoaded: boolean;
  libraries: LibrarySummary[];
  librariesLoaded: boolean;
  jellyfinLibraries: JellyfinLibrary[];
  jellyfinLibrariesLoaded: boolean;
  loadAppSettings: (force?: boolean) => Promise<AppSettings>;
  loadDashboard: (force?: boolean, panels?: readonly string[] | null) => Promise<DashboardResponse>;
  loadLibraries: (force?: boolean) => Promise<LibrarySummary[]>;
  loadJellyfinLibraries: (force?: boolean) => Promise<JellyfinLibrary[]>;
  setAppSettings: (payload: AppSettings) => void;
  setDashboard: (payload: DashboardResponse) => void;
  setLibraries: (payload: LibrarySummary[]) => void;
  upsertLibrary: (payload: LibrarySummary) => void;
  removeLibrary: (libraryId: number) => void;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

const DEFAULT_SCAN_PERFORMANCE = {
  scan_worker_count: 4,
  parallel_scan_jobs: 2,
  comparison_scatter_point_limit: 5000,
};

const DEFAULT_TRANSCODING = {
  execution_mode: "hardware_required" as const,
  cpu_budget_percent: 90,
  cpu_parallel_jobs: "auto" as const,
  gpu_parallel_jobs_per_device: 1,
  selected_devices: "auto" as const,
  default_output_mode: "transcode_output" as const,
  on_error: "continue" as const,
  retry_count: 0,
  existing_output: "fail" as const,
  remove_partial_output: true,
};

const DEFAULT_HISTORY_RETENTION = {
  file_history: { days: 30, storage_limit_gb: 0 },
  library_history: { days: 365, storage_limit_gb: 0 },
  scan_history: { days: 30, storage_limit_gb: 0 },
  transcode_history: { days: 90, storage_limit_gb: 0 },
};

const DEFAULT_PATTERN_RECOGNITION = defaultPatternRecognitionSettings();
const DEFAULT_UI_PREFERENCES = {
  interface_language: "en" as const,
  color_theme: "system" as const,
};
const DEFAULT_TELEMETRY = {
  mode: "none" as const,
  environment_disabled: false,
  installation_id: null,
  installation_id_suffix: null,
  last_sent_at: null,
  last_user_visible_payload: null,
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  ignore_patterns: [],
  user_ignore_patterns: [],
  default_ignore_patterns: [],
  pattern_recognition: DEFAULT_PATTERN_RECOGNITION,
  resolution_categories: DEFAULT_RESOLUTION_CATEGORIES,
  scan_performance: DEFAULT_SCAN_PERFORMANCE,
  transcoding: DEFAULT_TRANSCODING,
  history_retention: DEFAULT_HISTORY_RETENTION,
  ui_preferences: DEFAULT_UI_PREFERENCES,
  telemetry: DEFAULT_TELEMETRY,
  feature_flags: {
    hide_automatic_update_reminders: false,
    show_analyzed_files_csv_export: false,
    show_full_width_app_shell: false,
    hide_quality_score_meter: false,
    show_music_quality_score: false,
    unlimited_panel_size: false,
    in_depth_dolby_vision_profiles: false,
    show_all_playbacks_when_unstacked: false,
  },
};
const DASHBOARD_SESSION_STORAGE_PREFIX = "medialyze-dashboard-cache:";
const DASHBOARD_SESSION_CACHE_OPTIONS: SessionCacheOptions = {
  prefix: DASHBOARD_SESSION_STORAGE_PREFIX,
  ttlMs: 5 * 60 * 1000,
  maxEntries: 8,
  maxTotalBytes: 6 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024,
};

function dashboardSessionStorageKey(panelKey: string | null): string {
  return `${DASHBOARD_SESSION_STORAGE_PREFIX}${panelKey ?? "all"}`;
}

function normalizeAppSettings(payload: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ignore_patterns: payload?.ignore_patterns ?? [],
    user_ignore_patterns: payload?.user_ignore_patterns ?? [],
    default_ignore_patterns: payload?.default_ignore_patterns ?? [],
    pattern_recognition: {
      analyze_bonus_content:
        payload?.pattern_recognition?.analyze_bonus_content ?? DEFAULT_PATTERN_RECOGNITION.analyze_bonus_content,
      duplicate_matching: {
        duration_tolerance_seconds:
          payload?.pattern_recognition?.duplicate_matching?.duration_tolerance_seconds ??
          DEFAULT_PATTERN_RECOGNITION.duplicate_matching.duration_tolerance_seconds,
        user_filename_suffix_regexes:
          payload?.pattern_recognition?.duplicate_matching?.user_filename_suffix_regexes ?? [],
        default_filename_suffix_regexes:
          payload?.pattern_recognition?.duplicate_matching?.default_filename_suffix_regexes ??
          DEFAULT_PATTERN_RECOGNITION.duplicate_matching.default_filename_suffix_regexes,
        effective_filename_suffix_regexes:
          payload?.pattern_recognition?.duplicate_matching?.effective_filename_suffix_regexes ??
          DEFAULT_PATTERN_RECOGNITION.duplicate_matching.effective_filename_suffix_regexes,
      },
      show_season_patterns: {
        recognition_mode:
          payload?.pattern_recognition?.show_season_patterns?.recognition_mode ??
          DEFAULT_PATTERN_RECOGNITION.show_season_patterns.recognition_mode,
        series_folder_depth:
          payload?.pattern_recognition?.show_season_patterns?.series_folder_depth ??
          DEFAULT_PATTERN_RECOGNITION.show_season_patterns.series_folder_depth,
        season_folder_depth:
          payload?.pattern_recognition?.show_season_patterns?.season_folder_depth ??
          DEFAULT_PATTERN_RECOGNITION.show_season_patterns.season_folder_depth,
        series_folder_regexes:
          payload?.pattern_recognition?.show_season_patterns?.series_folder_regexes ??
          DEFAULT_PATTERN_RECOGNITION.show_season_patterns.series_folder_regexes,
        season_folder_regexes:
          payload?.pattern_recognition?.show_season_patterns?.season_folder_regexes ??
          DEFAULT_PATTERN_RECOGNITION.show_season_patterns.season_folder_regexes,
        episode_file_regexes:
          payload?.pattern_recognition?.show_season_patterns?.episode_file_regexes ??
          DEFAULT_PATTERN_RECOGNITION.show_season_patterns.episode_file_regexes,
      },
      bonus_content: {
        user_folder_patterns: payload?.pattern_recognition?.bonus_content?.user_folder_patterns ?? [],
        default_folder_patterns: payload?.pattern_recognition?.bonus_content?.default_folder_patterns ?? [],
        effective_folder_patterns: payload?.pattern_recognition?.bonus_content?.effective_folder_patterns ?? [],
        user_file_patterns: [],
        default_file_patterns: [],
        effective_file_patterns: [],
      },
    },
    resolution_categories: normalizeResolutionCategories(payload?.resolution_categories),
    scan_performance: {
      scan_worker_count: payload?.scan_performance?.scan_worker_count ?? DEFAULT_SCAN_PERFORMANCE.scan_worker_count,
      parallel_scan_jobs: payload?.scan_performance?.parallel_scan_jobs ?? DEFAULT_SCAN_PERFORMANCE.parallel_scan_jobs,
      comparison_scatter_point_limit:
        payload?.scan_performance?.comparison_scatter_point_limit ??
        DEFAULT_SCAN_PERFORMANCE.comparison_scatter_point_limit,
    },
    transcoding: {
      execution_mode: payload?.transcoding?.execution_mode ?? DEFAULT_TRANSCODING.execution_mode,
      cpu_budget_percent:
        payload?.transcoding?.cpu_budget_percent ?? DEFAULT_TRANSCODING.cpu_budget_percent,
      cpu_parallel_jobs:
        payload?.transcoding?.cpu_parallel_jobs ?? DEFAULT_TRANSCODING.cpu_parallel_jobs,
      gpu_parallel_jobs_per_device:
        payload?.transcoding?.gpu_parallel_jobs_per_device ?? DEFAULT_TRANSCODING.gpu_parallel_jobs_per_device,
      selected_devices: payload?.transcoding?.selected_devices ?? DEFAULT_TRANSCODING.selected_devices,
      default_output_mode:
        payload?.transcoding?.default_output_mode ?? DEFAULT_TRANSCODING.default_output_mode,
      on_error: payload?.transcoding?.on_error ?? DEFAULT_TRANSCODING.on_error,
      retry_count: payload?.transcoding?.retry_count ?? DEFAULT_TRANSCODING.retry_count,
      existing_output: payload?.transcoding?.existing_output ?? DEFAULT_TRANSCODING.existing_output,
      remove_partial_output:
        payload?.transcoding?.remove_partial_output ?? DEFAULT_TRANSCODING.remove_partial_output,
    },
    history_retention: {
      file_history: {
        days: payload?.history_retention?.file_history?.days ?? DEFAULT_HISTORY_RETENTION.file_history.days,
        storage_limit_gb:
          payload?.history_retention?.file_history?.storage_limit_gb ??
          DEFAULT_HISTORY_RETENTION.file_history.storage_limit_gb,
      },
      library_history: {
        days: payload?.history_retention?.library_history?.days ?? DEFAULT_HISTORY_RETENTION.library_history.days,
        storage_limit_gb:
          payload?.history_retention?.library_history?.storage_limit_gb ??
          DEFAULT_HISTORY_RETENTION.library_history.storage_limit_gb,
      },
      scan_history: {
        days: payload?.history_retention?.scan_history?.days ?? DEFAULT_HISTORY_RETENTION.scan_history.days,
        storage_limit_gb:
          payload?.history_retention?.scan_history?.storage_limit_gb ??
          DEFAULT_HISTORY_RETENTION.scan_history.storage_limit_gb,
      },
      transcode_history: {
        days: payload?.history_retention?.transcode_history?.days ?? DEFAULT_HISTORY_RETENTION.transcode_history.days,
        storage_limit_gb:
          payload?.history_retention?.transcode_history?.storage_limit_gb ??
          DEFAULT_HISTORY_RETENTION.transcode_history.storage_limit_gb,
      },
    },
    ui_preferences: {
      interface_language: payload?.ui_preferences?.interface_language ?? DEFAULT_UI_PREFERENCES.interface_language,
      color_theme: payload?.ui_preferences?.color_theme ?? DEFAULT_UI_PREFERENCES.color_theme,
    },
    telemetry: {
      mode: payload?.telemetry?.mode ?? DEFAULT_TELEMETRY.mode,
      environment_disabled: payload?.telemetry?.environment_disabled ?? DEFAULT_TELEMETRY.environment_disabled,
      installation_id: payload?.telemetry?.installation_id ?? DEFAULT_TELEMETRY.installation_id,
      installation_id_suffix: payload?.telemetry?.installation_id_suffix ?? DEFAULT_TELEMETRY.installation_id_suffix,
      last_sent_at: payload?.telemetry?.last_sent_at ?? DEFAULT_TELEMETRY.last_sent_at,
      last_user_visible_payload:
        payload?.telemetry?.last_user_visible_payload ?? DEFAULT_TELEMETRY.last_user_visible_payload,
    },
    feature_flags: {
      hide_automatic_update_reminders:
        payload?.feature_flags?.hide_automatic_update_reminders
        ?? (payload?.feature_flags?.show_automatic_update_reminders === undefined
          ? false
          : !payload.feature_flags.show_automatic_update_reminders),
      show_analyzed_files_csv_export: payload?.feature_flags?.show_analyzed_files_csv_export ?? false,
      show_full_width_app_shell: payload?.feature_flags?.show_full_width_app_shell ?? false,
      hide_quality_score_meter: payload?.feature_flags?.hide_quality_score_meter ?? false,
      show_music_quality_score: payload?.feature_flags?.show_music_quality_score ?? false,
      unlimited_panel_size: payload?.feature_flags?.unlimited_panel_size ?? false,
      in_depth_dolby_vision_profiles: payload?.feature_flags?.in_depth_dolby_vision_profiles ?? false,
      show_all_playbacks_when_unstacked:
        payload?.feature_flags?.show_all_playbacks_when_unstacked ?? false,
    },
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [appSettings, setAppSettingsState] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [appSettingsLoaded, setAppSettingsLoaded] = useState(false);
  const [dashboard, setDashboardState] = useState<DashboardResponse | null>(() =>
    readSessionCache<DashboardResponse>(
      dashboardSessionStorageKey(null),
      DASHBOARD_SESSION_CACHE_OPTIONS,
    ),
  );
  const [dashboardLoaded, setDashboardLoaded] = useState(() =>
    readSessionCache<DashboardResponse>(
      dashboardSessionStorageKey(null),
      DASHBOARD_SESSION_CACHE_OPTIONS,
    ) !== null,
  );
  const [libraries, setLibrariesState] = useState<LibrarySummary[]>([]);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [jellyfinLibraries, setJellyfinLibraries] = useState<JellyfinLibrary[]>([]);
  const [jellyfinLibrariesLoaded, setJellyfinLibrariesLoaded] = useState(false);
  const appSettingsRequestRef = useRef<Promise<AppSettings> | null>(null);
  const dashboardRequestRef = useRef<Promise<DashboardResponse> | null>(null);
  const dashboardRequestKeyRef = useRef<string | null>(null);
  const dashboardPanelKeyRef = useRef<string | null>(null);
  const librariesRequestRef = useRef<Promise<LibrarySummary[]> | null>(null);
  const jellyfinLibrariesRequestRef = useRef<Promise<JellyfinLibrary[]> | null>(null);

  const setAppSettings = useEffectEvent((payload: AppSettings) => {
    setAppSettingsState(normalizeAppSettings(payload));
    setAppSettingsLoaded(true);
  });

  const setDashboard = useEffectEvent((payload: DashboardResponse) => {
    setDashboardState(payload);
    setDashboardLoaded(true);
    dashboardPanelKeyRef.current = null;
  });

  const setLibraries = useEffectEvent((payload: LibrarySummary[]) => {
    setLibrariesState(payload);
    setLibrariesLoaded(true);
  });

  const upsertLibrary = useEffectEvent((payload: LibrarySummary) => {
    setLibrariesState((current) => {
      const existingIndex = current.findIndex((library) => library.id === payload.id);
      if (existingIndex === -1) {
        return [...current, payload].sort((left, right) => left.name.localeCompare(right.name));
      }

      const next = [...current];
      next[existingIndex] = payload;
      return next;
    });
    setLibrariesLoaded(true);
  });

  const removeLibrary = useEffectEvent((libraryId: number) => {
    setLibrariesState((current) => current.filter((library) => library.id !== libraryId));
    setLibrariesLoaded(true);
  });

  const loadAppSettings = useEffectEvent(async (force = false) => {
    if (!force) {
      if (appSettingsRequestRef.current) {
        return appSettingsRequestRef.current;
      }
      if (appSettingsLoaded) {
        return appSettings;
      }
    }

    const request = api
      .appSettings()
      .then((payload) => {
        const normalized = normalizeAppSettings(payload);
        const persistedLanguage = normalized.ui_preferences?.interface_language;
        if (!getStoredInterfaceLanguage() && persistedLanguage && i18n.language !== persistedLanguage) {
          void i18n.changeLanguage(persistedLanguage);
        }
        setAppSettingsState(normalized);
        setAppSettingsLoaded(true);
        return normalized;
      })
      .finally(() => {
        if (appSettingsRequestRef.current === request) {
          appSettingsRequestRef.current = null;
        }
      });

    appSettingsRequestRef.current = request;
    return request;
  });

  const loadDashboard = useEffectEvent(async (force = false, panels?: readonly string[] | null) => {
    const panelKey = panels?.length ? [...new Set(panels)].sort().join(",") : null;
    const sessionCachedDashboard = readSessionCache<DashboardResponse>(
      dashboardSessionStorageKey(panelKey),
      DASHBOARD_SESSION_CACHE_OPTIONS,
    );
    if (!force) {
      if (
        dashboardRequestRef.current &&
        (dashboardRequestKeyRef.current === null || dashboardRequestKeyRef.current === panelKey)
      ) {
        return dashboardRequestRef.current;
      }
      if (
        dashboardLoaded &&
        dashboard &&
        (dashboardPanelKeyRef.current === null || dashboardPanelKeyRef.current === panelKey)
      ) {
        return dashboard;
      }
      if (sessionCachedDashboard) {
        setDashboardState(sessionCachedDashboard);
        setDashboardLoaded(true);
        dashboardPanelKeyRef.current = panelKey;
      }
    }

    const request = api
      .dashboard(panels)
      .then((payload) => {
        setDashboardState(payload);
        setDashboardLoaded(true);
        dashboardPanelKeyRef.current = panelKey;
        writeSessionCache(dashboardSessionStorageKey(panelKey), payload, DASHBOARD_SESSION_CACHE_OPTIONS);
        return payload;
      })
      .finally(() => {
        if (dashboardRequestRef.current === request) {
          dashboardRequestRef.current = null;
          dashboardRequestKeyRef.current = null;
        }
      });

    dashboardRequestRef.current = request;
    dashboardRequestKeyRef.current = panelKey;
    return request;
  });

  const loadLibraries = useEffectEvent(async (force = false) => {
    if (!force) {
      if (librariesRequestRef.current) {
        return librariesRequestRef.current;
      }
      if (librariesLoaded) {
        return libraries;
      }
    }

    const request = api
      .libraries()
      .then((payload) => {
        setLibrariesState(payload);
        setLibrariesLoaded(true);
        return payload;
      })
      .finally(() => {
        if (librariesRequestRef.current === request) {
          librariesRequestRef.current = null;
        }
      });

    librariesRequestRef.current = request;
    return request;
  });

  const loadJellyfinLibraries = useEffectEvent(async (force = false) => {
    if (!force) {
      if (jellyfinLibrariesRequestRef.current) return jellyfinLibrariesRequestRef.current;
      if (jellyfinLibrariesLoaded) return jellyfinLibraries;
    }
    const request = api.jellyfinLibraries()
      .then((payload) => {
        setJellyfinLibraries(payload);
        setJellyfinLibrariesLoaded(true);
        return payload;
      })
      .finally(() => {
        if (jellyfinLibrariesRequestRef.current === request) jellyfinLibrariesRequestRef.current = null;
      });
    jellyfinLibrariesRequestRef.current = request;
    return request;
  });

  const value = useMemo(
    () => ({
      appSettings,
      appSettingsLoaded,
      dashboard,
      dashboardLoaded,
      libraries,
      librariesLoaded,
      jellyfinLibraries,
      jellyfinLibrariesLoaded,
      loadAppSettings,
      loadDashboard,
      loadLibraries,
      loadJellyfinLibraries,
      setAppSettings,
      setDashboard,
      setLibraries,
      upsertLibrary,
      removeLibrary,
    }),
    [
      appSettings,
      appSettingsLoaded,
      dashboard,
      dashboardLoaded,
      libraries,
      librariesLoaded,
      jellyfinLibraries,
      jellyfinLibrariesLoaded,
      loadAppSettings,
      loadDashboard,
      loadLibraries,
      loadJellyfinLibraries,
      setAppSettings,
      setDashboard,
      setLibraries,
      upsertLibrary,
      removeLibrary,
    ],
  );

  useEffect(() => {
    void loadAppSettings().catch(() => undefined);
  }, [loadAppSettings]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used inside AppDataProvider");
  }
  return context;
}

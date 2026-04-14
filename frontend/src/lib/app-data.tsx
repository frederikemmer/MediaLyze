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

import { api, type AppSettings, type DashboardResponse, type LibrarySummary } from "./api";
import { DEFAULT_RESOLUTION_CATEGORIES, normalizeResolutionCategories } from "./resolution-categories";

type AppDataContextValue = {
  appSettings: AppSettings;
  appSettingsLoaded: boolean;
  dashboard: DashboardResponse | null;
  dashboardLoaded: boolean;
  libraries: LibrarySummary[];
  librariesLoaded: boolean;
  loadAppSettings: (force?: boolean) => Promise<AppSettings>;
  loadDashboard: (force?: boolean) => Promise<DashboardResponse>;
  loadLibraries: (force?: boolean) => Promise<LibrarySummary[]>;
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

const DEFAULT_APP_SETTINGS: AppSettings = {
  ignore_patterns: [],
  user_ignore_patterns: [],
  default_ignore_patterns: [],
  resolution_categories: DEFAULT_RESOLUTION_CATEGORIES,
  scan_performance: DEFAULT_SCAN_PERFORMANCE,
  feature_flags: {
    show_analyzed_files_csv_export: false,
    show_full_width_app_shell: false,
    hide_quality_score_meter: false,
  },
};

function normalizeAppSettings(payload: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ignore_patterns: payload?.ignore_patterns ?? [],
    user_ignore_patterns: payload?.user_ignore_patterns ?? [],
    default_ignore_patterns: payload?.default_ignore_patterns ?? [],
    resolution_categories: normalizeResolutionCategories(payload?.resolution_categories),
    scan_performance: {
      scan_worker_count: payload?.scan_performance?.scan_worker_count ?? DEFAULT_SCAN_PERFORMANCE.scan_worker_count,
      parallel_scan_jobs: payload?.scan_performance?.parallel_scan_jobs ?? DEFAULT_SCAN_PERFORMANCE.parallel_scan_jobs,
      comparison_scatter_point_limit:
        payload?.scan_performance?.comparison_scatter_point_limit ??
        DEFAULT_SCAN_PERFORMANCE.comparison_scatter_point_limit,
    },
    feature_flags: {
      show_analyzed_files_csv_export: payload?.feature_flags?.show_analyzed_files_csv_export ?? false,
      show_full_width_app_shell: payload?.feature_flags?.show_full_width_app_shell ?? false,
      hide_quality_score_meter: payload?.feature_flags?.hide_quality_score_meter ?? false,
    },
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [appSettings, setAppSettingsState] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [appSettingsLoaded, setAppSettingsLoaded] = useState(false);
  const [dashboard, setDashboardState] = useState<DashboardResponse | null>(null);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [libraries, setLibrariesState] = useState<LibrarySummary[]>([]);
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const appSettingsRequestRef = useRef<Promise<AppSettings> | null>(null);
  const dashboardRequestRef = useRef<Promise<DashboardResponse> | null>(null);
  const librariesRequestRef = useRef<Promise<LibrarySummary[]> | null>(null);

  const setAppSettings = useEffectEvent((payload: AppSettings) => {
    setAppSettingsState(normalizeAppSettings(payload));
    setAppSettingsLoaded(true);
  });

  const setDashboard = useEffectEvent((payload: DashboardResponse) => {
    setDashboardState(payload);
    setDashboardLoaded(true);
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

  const loadDashboard = useEffectEvent(async (force = false) => {
    if (!force) {
      if (dashboardRequestRef.current) {
        return dashboardRequestRef.current;
      }
      if (dashboardLoaded && dashboard) {
        return dashboard;
      }
    }

    const request = api
      .dashboard()
      .then((payload) => {
        setDashboardState(payload);
        setDashboardLoaded(true);
        return payload;
      })
      .finally(() => {
        if (dashboardRequestRef.current === request) {
          dashboardRequestRef.current = null;
        }
      });

    dashboardRequestRef.current = request;
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

  const value = useMemo(
    () => ({
      appSettings,
      appSettingsLoaded,
      dashboard,
      dashboardLoaded,
      libraries,
      librariesLoaded,
      loadAppSettings,
      loadDashboard,
      loadLibraries,
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
      loadAppSettings,
      loadDashboard,
      loadLibraries,
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

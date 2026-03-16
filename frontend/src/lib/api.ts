export type DistributionItem = {
  label: string;
  value: number;
};

export type QualityCategoryConfig = {
  weight: number;
  minimum: string | number;
  ideal: string | number;
};

export type QualityNumericCategoryConfig = {
  weight: number;
  minimum: number;
  ideal: number;
  maximum: number;
};

export type QualityLanguagePreferencesConfig = {
  weight: number;
  mode: "partial";
  audio_languages: string[];
  subtitle_languages: string[];
};

export type QualityProfile = {
  version: number;
  resolution: QualityCategoryConfig;
  visual_density: QualityNumericCategoryConfig;
  video_codec: QualityCategoryConfig;
  audio_channels: QualityCategoryConfig;
  audio_codec: QualityCategoryConfig;
  dynamic_range: QualityCategoryConfig;
  language_preferences: QualityLanguagePreferencesConfig;
};

export type QualityCategoryBreakdown = {
  key: string;
  score: number;
  weight: number;
  active: boolean;
  skipped: boolean;
  minimum: string | number | null;
  ideal: string | number | null;
  maximum?: string | number | null;
  actual: string | number | string[] | null;
  unknown_mapping: boolean;
  notes: string[];
};

export type QualityBreakdown = {
  score: number;
  score_raw: number;
  categories: QualityCategoryBreakdown[];
};

export const DEFAULT_QUALITY_PROFILE: QualityProfile = {
  version: 1,
  resolution: { weight: 8, minimum: "1080p", ideal: "4k" },
  visual_density: { weight: 10, minimum: 0.02, ideal: 0.04, maximum: 0.08 },
  video_codec: { weight: 5, minimum: "h264", ideal: "hevc" },
  audio_channels: { weight: 4, minimum: "stereo", ideal: "5.1" },
  audio_codec: { weight: 3, minimum: "aac", ideal: "eac3" },
  dynamic_range: { weight: 4, minimum: "sdr", ideal: "hdr10" },
  language_preferences: { weight: 6, mode: "partial", audio_languages: [], subtitle_languages: [] },
};

export type DashboardResponse = {
  totals: Record<string, number>;
  video_codec_distribution: DistributionItem[];
  resolution_distribution: DistributionItem[];
  hdr_distribution: DistributionItem[];
  audio_codec_distribution: DistributionItem[];
  audio_language_distribution: DistributionItem[];
  subtitle_distribution: DistributionItem[];
};

export type LibrarySummary = {
  id: number;
  name: string;
  path: string;
  type: "movies" | "series" | "mixed" | "other";
  last_scan_at: string | null;
  scan_mode: "manual" | "scheduled" | "watch";
  scan_config: Record<string, number>;
  created_at: string;
  updated_at: string;
  quality_profile: QualityProfile;
  file_count: number;
  total_size_bytes: number;
  total_duration_seconds: number;
  ready_files: number;
  pending_files: number;
};

export type LibraryStatistics = {
  video_codec_distribution: DistributionItem[];
  resolution_distribution: DistributionItem[];
  hdr_distribution: DistributionItem[];
  audio_codec_distribution: DistributionItem[];
  audio_language_distribution: DistributionItem[];
  subtitle_language_distribution: DistributionItem[];
  subtitle_codec_distribution: DistributionItem[];
  subtitle_source_distribution: DistributionItem[];
};

export type MediaFileRow = {
  id: number;
  library_id: number;
  relative_path: string;
  filename: string;
  extension: string;
  size_bytes: number;
  mtime: number;
  last_seen_at: string;
  last_analyzed_at: string | null;
  scan_status: string;
  quality_score: number;
  quality_score_raw: number;
  duration: number | null;
  video_codec: string | null;
  resolution: string | null;
  hdr_type: string | null;
  audio_codecs: string[];
  audio_languages: string[];
  subtitle_languages: string[];
  subtitle_codecs: string[];
  subtitle_sources: string[];
};

export type MediaFileSortKey =
  | "file"
  | "size"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "duration"
  | "audio_codecs"
  | "audio_languages"
  | "subtitle_languages"
  | "subtitle_codecs"
  | "subtitle_sources"
  | "mtime"
  | "last_analyzed_at"
  | "quality_score";

export type LibraryFileSearchField =
  | "file"
  | "size"
  | "quality_score"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "duration"
  | "audio_codecs"
  | "audio_languages"
  | "subtitle_languages"
  | "subtitle_codecs"
  | "subtitle_sources";

export type MediaFileTablePage = {
  total: number;
  offset: number;
  limit: number;
  items: MediaFileRow[];
};

export type MediaFileDetail = MediaFileRow & {
  media_format: {
    container_format: string | null;
    duration: number | null;
    bit_rate: number | null;
    probe_score: number | null;
  } | null;
  video_streams: Array<Record<string, string | number | null>>;
  audio_streams: Array<Record<string, string | number | boolean | null>>;
  subtitle_streams: Array<Record<string, string | number | boolean | null>>;
  external_subtitles: Array<Record<string, string | null>>;
  raw_ffprobe_json: Record<string, unknown> | null;
};

export type MediaFileQualityScoreDetail = {
  id: number;
  score: number;
  score_raw: number;
  breakdown: QualityBreakdown;
};

export type BrowseResponse = {
  current_path: string;
  parent_path: string | null;
  entries: Array<{
    name: string;
    path: string;
    is_dir: boolean;
  }>;
};

export type AppSettings = {
  ignore_patterns: string[];
  user_ignore_patterns: string[];
  default_ignore_patterns: string[];
  feature_flags: {
    show_dolby_vision_profiles: boolean;
  };
};

export type ScanJob = {
  id: number;
  library_id: number;
  library_name: string | null;
  status: string;
  job_type: string;
  files_total: number;
  files_scanned: number;
  errors: number;
  started_at: string | null;
  finished_at: string | null;
  progress_percent: number;
  phase_label: string;
  phase_detail: string | null;
};

export type ScanCancelResponse = {
  canceled_jobs: number;
};

const API_PREFIX = import.meta.env.VITE_API_PREFIX ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.detail ?? response.statusText;
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  appSettings: () => request<AppSettings>("/app-settings"),
  dashboard: () => request<DashboardResponse>("/dashboard"),
  activeScanJobs: () => request<ScanJob[]>("/scan-jobs/active"),
  libraries: () => request<LibrarySummary[]>("/libraries"),
  librarySummary: (id: string | number, signal?: AbortSignal) =>
    request<LibrarySummary>(`/libraries/${id}/summary`, { signal }),
  libraryStatistics: (id: string | number, signal?: AbortSignal) =>
    request<LibraryStatistics>(`/libraries/${id}/statistics`, { signal }),
  libraryFiles: (
    id: string | number,
    params?: {
      offset?: number;
      limit?: number;
      search?: string;
      filters?: Partial<Record<LibraryFileSearchField, string>>;
      sortKey?: MediaFileSortKey;
      sortDirection?: "asc" | "desc";
      signal?: AbortSignal;
    },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params?.search) {
      searchParams.set("search", params.search);
    }
    if (params?.filters) {
      const filterEntries: Array<[LibraryFileSearchField, string]> = [
        ["file", "file_search"],
        ["size", "search_size"],
        ["quality_score", "search_quality_score"],
        ["video_codec", "search_video_codec"],
        ["resolution", "search_resolution"],
        ["hdr_type", "search_hdr_type"],
        ["duration", "search_duration"],
        ["audio_codecs", "search_audio_codecs"],
        ["audio_languages", "search_audio_languages"],
        ["subtitle_languages", "search_subtitle_languages"],
        ["subtitle_codecs", "search_subtitle_codecs"],
        ["subtitle_sources", "search_subtitle_sources"],
      ];
      for (const [field, queryKey] of filterEntries) {
        const rawValue = params.filters[field];
        const value = rawValue?.trim();
        if (value) {
          searchParams.set(queryKey, value);
        }
      }
    }
    if (params?.sortKey) {
      searchParams.set("sort_key", params.sortKey);
    }
    if (params?.sortDirection) {
      searchParams.set("sort_direction", params.sortDirection);
    }
    const query = searchParams.toString();
    return request<MediaFileTablePage>(`/libraries/${id}/files${query ? `?${query}` : ""}`, {
      signal: params?.signal,
    });
  },
  libraryScanJobs: (id: string | number) => request<ScanJob[]>(`/libraries/${id}/scan-jobs`),
  file: (id: string | number) => request<MediaFileDetail>(`/files/${id}`),
  fileQualityScore: (id: string | number) => request<MediaFileQualityScoreDetail>(`/files/${id}/quality-score`),
  browse: (path = ".") => request<BrowseResponse>(`/browse?path=${encodeURIComponent(path)}`),
  updateAppSettings: (payload: {
    ignore_patterns?: string[];
    user_ignore_patterns?: string[];
    default_ignore_patterns?: string[];
    feature_flags?: {
      show_dolby_vision_profiles?: boolean;
    };
  }) =>
    request<AppSettings>("/app-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createLibrary: (payload: {
    name: string;
    path: string;
    type: string;
    scan_mode: string;
    scan_config?: Record<string, number>;
    quality_profile?: QualityProfile;
  }) =>
    request<LibrarySummary>("/libraries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateLibrarySettings: (
    libraryId: string | number,
    payload: {
      name?: string;
      scan_mode?: string;
      scan_config?: Record<string, number>;
      quality_profile?: QualityProfile;
    },
  ) =>
    request<LibrarySummary>(`/libraries/${libraryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteLibrary: (libraryId: string | number) =>
    request<void>(`/libraries/${libraryId}`, {
      method: "DELETE",
    }),
  scanLibrary: (libraryId: string | number, scanType: string) =>
    request<ScanJob>(`/libraries/${libraryId}/scan`, {
      method: "POST",
      body: JSON.stringify({ scan_type: scanType }),
    }),
  cancelActiveScanJobs: () =>
    request<ScanCancelResponse>("/scan-jobs/active/cancel", {
      method: "POST",
    }),
};

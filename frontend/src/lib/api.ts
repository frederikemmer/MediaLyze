export type DistributionItem = {
  label: string;
  value: number;
  filter_value?: string | null;
};

export type ResolutionCategory = {
  id: string;
  label: string;
  min_width: number;
  min_height: number;
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
  duplicate_detection_mode: "filename" | "content_hash" | "perceptual_hash";
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
  duplicate_distribution: DistributionItem[];
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
  resolution_category_id?: string | null;
  resolution_category_label?: string | null;
  hdr_type: string | null;
  audio_codecs: string[];
  audio_languages: string[];
  subtitle_languages: string[];
  subtitle_codecs: string[];
  subtitle_sources: string[];
  duplicate_group_key?: string | null;
  duplicate_group_label?: string | null;
  duplicate_group_member_count?: number;
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
  | "subtitle_sources"
  | "duplicates";

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

export type PathKind = "local" | "network" | "unknown";

export type PathInspection = {
  normalized_path: string;
  exists: boolean;
  is_directory: boolean;
  path_kind: PathKind;
  watch_supported: boolean;
};

export type AppSettings = {
  ignore_patterns: string[];
  user_ignore_patterns: string[];
  default_ignore_patterns: string[];
  resolution_categories?: ResolutionCategory[];
  feature_flags: {
    show_dolby_vision_profiles: boolean;
    show_analyzed_files_csv_export: boolean;
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
  phase_key: string;
  phase_label: string;
  phase_detail: string | null;
  phase_progress_percent: number;
  phase_current: number;
  phase_total: number;
  eta_seconds: number | null;
  scan_mode_label: string | null;
  duplicate_detection_mode: string | null;
  queued_for_analysis: number;
  unchanged_files: number;
};

export type ScanTriggerSource = "manual" | "scheduled" | "watchdog";
export type ScanOutcome = "successful" | "failed" | "canceled";

export type ScanFileList = {
  count: number;
  paths: string[];
  truncated_count: number;
};

export type ScanFileIssue = {
  path: string;
  reason: string;
};

export type ScanPatternHit = {
  pattern: string;
  count: number;
  paths: string[];
  truncated_count: number;
};

export type ScanSummary = {
  ignore_patterns: string[];
  discovery: {
    discovered_files: number;
    ignored_total: number;
    ignored_dir_total: number;
    ignored_file_total: number;
    ignored_pattern_hits: ScanPatternHit[];
  };
  changes: {
    queued_for_analysis: number;
    unchanged_files: number;
    reanalyzed_incomplete_files: number;
    new_files: ScanFileList;
    modified_files: ScanFileList;
    deleted_files: ScanFileList;
  };
  analysis: {
    queued_for_analysis: number;
    analyzed_successfully: number;
    analysis_failed: number;
    failed_files: ScanFileIssue[];
    failed_files_truncated_count: number;
  };
  duplicates: {
    mode: string | null;
    status: string | null;
    phase_started_at: string | null;
    phase_finished_at: string | null;
    artifacts_total: number;
    artifacts_completed: number;
    grouping_total: number;
    grouping_completed: number;
    groups_found: number;
    duplicate_files: number;
    pending_files: number;
    artifact_cache_hits: number;
    artifact_cache_misses: number;
    eta_seconds: number | null;
  };
  runtime?: Record<string, unknown>;
};

export type DuplicateGroup = {
  group_key: string;
  label: string;
  file_count: number;
  file_ids: number[];
  mode: string;
};

export type DuplicateGroupPage = {
  total: number;
  offset: number;
  limit: number;
  items: DuplicateGroup[];
};

export type DuplicateSummary = {
  mode: string;
  groups_found: number;
  duplicate_files: number;
  pending_files: number;
};

export type RecentScanJob = {
  id: number;
  library_id: number;
  library_name: string | null;
  status: string;
  outcome: ScanOutcome;
  job_type: string;
  trigger_source: ScanTriggerSource;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  discovered_files: number;
  ignored_total: number;
  new_files: number;
  modified_files: number;
  deleted_files: number;
  analysis_failed: number;
};

export type ScanJobDetail = RecentScanJob & {
  trigger_details: Record<string, unknown>;
  scan_summary: ScanSummary;
};

export type RecentScanJobPage = {
  items: RecentScanJob[];
  has_more: boolean;
};

export type ScanCancelResponse = {
  canceled_jobs: number;
};

type LibraryFilesRequestParams = {
  offset?: number;
  limit?: number;
  search?: string;
  filters?: Partial<Record<LibraryFileSearchField, string>>;
  sortKey?: MediaFileSortKey;
  sortDirection?: "asc" | "desc";
  signal?: AbortSignal;
};

type DownloadedCsv = {
  blob: Blob;
  filename: string | null;
};

const API_PREFIX = import.meta.env.VITE_API_PREFIX ?? "/api";
const LIBRARY_FILE_FILTER_QUERY_KEYS: Array<[LibraryFileSearchField, string]> = [
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
  ["duplicates", "search_duplicates"],
];

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

function buildLibraryFilesSearchParams(params?: LibraryFilesRequestParams): URLSearchParams {
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
    for (const [field, queryKey] of LIBRARY_FILE_FILTER_QUERY_KEYS) {
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
  return searchParams;
}

function buildLibraryFilesPath(
  id: string | number,
  params: LibraryFilesRequestParams | undefined,
  suffix = "/files",
): string {
  const query = buildLibraryFilesSearchParams(params).toString();
  return `/libraries/${id}${suffix}${query ? `?${query}` : ""}`;
}

function extractFilenameFromDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = /filename="?([^";]+)"?/i.exec(value);
  return basicMatch?.[1] ?? null;
}

export const api = {
  appSettings: () => request<AppSettings>("/app-settings"),
  dashboard: () => request<DashboardResponse>("/dashboard"),
  activeScanJobs: () => request<ScanJob[]>("/scan-jobs/active"),
  recentScanJobs: (params?: {
    limit?: number;
    sinceHours?: number;
    beforeFinishedAt?: string;
    beforeId?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params?.sinceHours !== undefined) {
      searchParams.set("since_hours", String(params.sinceHours));
    }
    if (params?.beforeFinishedAt) {
      searchParams.set("before_finished_at", params.beforeFinishedAt);
    }
    if (params?.beforeId !== undefined) {
      searchParams.set("before_id", String(params.beforeId));
    }
    const query = searchParams.toString();
    return request<RecentScanJobPage>(`/scan-jobs/recent${query ? `?${query}` : ""}`);
  },
  scanJobDetail: (jobId: string | number) => request<ScanJobDetail>(`/scan-jobs/${jobId}`),
  libraries: () => request<LibrarySummary[]>("/libraries"),
  librarySummary: (id: string | number, signal?: AbortSignal) =>
    request<LibrarySummary>(`/libraries/${id}/summary`, { signal }),
  libraryStatistics: (id: string | number, signal?: AbortSignal) =>
    request<LibraryStatistics>(`/libraries/${id}/statistics`, { signal }),
  libraryFiles: (id: string | number, params?: LibraryFilesRequestParams) =>
    request<MediaFileTablePage>(buildLibraryFilesPath(id, params), {
      signal: params?.signal,
    }),
  downloadLibraryFilesCsv: async (
    id: string | number,
    params?: Omit<LibraryFilesRequestParams, "offset" | "limit">,
  ): Promise<DownloadedCsv> => {
    const response = await fetch(`${API_PREFIX}${buildLibraryFilesPath(id, params, "/files/export.csv")}`, {
      signal: params?.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = payload?.detail ?? response.statusText;
      throw new Error(detail);
    }

    return {
      blob: await response.blob(),
      filename: extractFilenameFromDisposition(response.headers.get("Content-Disposition")),
    };
  },
  libraryScanJobs: (id: string | number) => request<ScanJob[]>(`/libraries/${id}/scan-jobs`),
  file: (id: string | number) => request<MediaFileDetail>(`/files/${id}`),
  fileQualityScore: (id: string | number) => request<MediaFileQualityScoreDetail>(`/files/${id}/quality-score`),
  browse: (path = ".") => request<BrowseResponse>(`/browse?path=${encodeURIComponent(path)}`),
  inspectPath: (path: string) =>
    request<PathInspection>("/paths/inspect", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  updateAppSettings: (payload: {
    ignore_patterns?: string[];
    user_ignore_patterns?: string[];
    default_ignore_patterns?: string[];
    resolution_categories?: ResolutionCategory[];
    feature_flags?: {
      show_dolby_vision_profiles?: boolean;
      show_analyzed_files_csv_export?: boolean;
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
    duplicate_detection_mode?: "filename" | "content_hash" | "perceptual_hash";
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
      duplicate_detection_mode?: "filename" | "content_hash" | "perceptual_hash";
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
  libraryDuplicates: (id: string | number, params?: { offset?: number; limit?: number; signal?: AbortSignal }) => {
    const searchParams = new URLSearchParams();
    if (params?.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    const query = searchParams.toString();
    return request<DuplicateGroupPage>(`/libraries/${id}/duplicates${query ? `?${query}` : ""}`, {
      signal: params?.signal,
    });
  },
  libraryDuplicatesSummary: (id: string | number, signal?: AbortSignal) =>
    request<DuplicateSummary>(`/libraries/${id}/duplicates/summary`, { signal }),
  cancelActiveScanJobs: () =>
    request<ScanCancelResponse>("/scan-jobs/active/cancel", {
      method: "POST",
    }),
};

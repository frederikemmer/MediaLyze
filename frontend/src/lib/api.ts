export type DistributionItem = {
  label: string;
  value: number;
  filter_value?: string | null;
};

export type NumericDistributionMetricId =
  | "quality_score"
  | "duration"
  | "size"
  | "bitrate"
  | "audio_bitrate";

export type NumericDistributionBin = {
  lower: number | null;
  upper: number | null;
  count: number;
  percentage: number;
};

export type NumericDistribution = {
  total: number;
  bins: NumericDistributionBin[];
};

type ScanConfigValue = string | number;

export type ComparisonFieldId =
  | "size"
  | "duration"
  | "quality_score"
  | "bitrate"
  | "audio_bitrate"
  | "resolution_mp"
  | "container"
  | "video_codec"
  | "resolution"
  | "hdr_type";

export type ComparisonFieldKind = "numeric" | "category";
export type ComparisonRendererId = "heatmap" | "scatter" | "bar";

export type ComparisonBucket = {
  key: string;
  label: string;
  lower: number | null;
  upper: number | null;
};

export type ComparisonHeatmapCell = {
  x_key: string;
  y_key: string;
  count: number;
};

export type ComparisonScatterPoint = {
  media_file_id: number;
  asset_name: string;
  x_value: number;
  y_value: number;
};

export type ComparisonBarEntry = {
  x_key: string;
  x_label: string;
  value: number;
  count: number;
};

export type ComparisonResponse = {
  x_field: ComparisonFieldId;
  y_field: ComparisonFieldId;
  x_field_kind: ComparisonFieldKind;
  y_field_kind: ComparisonFieldKind;
  available_renderers: ComparisonRendererId[];
  total_files: number;
  included_files: number;
  excluded_files: number;
  sampled_points: boolean;
  sample_limit: number;
  x_buckets: ComparisonBucket[];
  y_buckets: ComparisonBucket[];
  heatmap_cells: ComparisonHeatmapCell[];
  scatter_points: ComparisonScatterPoint[] | null;
  bar_entries: ComparisonBarEntry[] | null;
};

export type ResolutionCategory = {
  id: string;
  label: string;
  min_width: number;
  min_height: number;
};

export type LibraryHistoryTrendMetrics = {
  schema_version?: number;
  total_files: number;
  resolution_counts: Record<string, number>;
  average_bitrate: number | null;
  average_audio_bitrate: number | null;
  average_duration_seconds: number | null;
  average_quality_score: number | null;
  totals?: Record<string, number>;
  numeric_summaries?: Record<string, LibraryHistoryNumericSummary>;
  category_counts?: Record<string, Record<string, number>>;
  numeric_distributions?: Record<string, NumericDistribution>;
};

export type LibraryHistoryNumericSummary = {
  count: number;
  sum: number;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
};

export type LibraryHistoryPoint = {
  snapshot_day: string;
  trend_metrics: LibraryHistoryTrendMetrics;
};

export type LibraryHistoryResolutionCategory = {
  id: string;
  label: string;
};

export type LibraryHistoryResponse = {
  generated_at: string;
  library_id: number;
  oldest_snapshot_day: string | null;
  newest_snapshot_day: string | null;
  resolution_categories: LibraryHistoryResolutionCategory[];
  points: LibraryHistoryPoint[];
};

export type DashboardHistoryResponse = {
  generated_at: string;
  oldest_snapshot_day: string | null;
  newest_snapshot_day: string | null;
  resolution_categories: LibraryHistoryResolutionCategory[];
  points: LibraryHistoryPoint[];
  visible_library_ids: number[];
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

export type DuplicateDetectionMode = "off" | "filename" | "filehash" | "both";
export type LibraryType = "movies" | "series" | "mixed" | "other";

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
  container_distribution: DistributionItem[];
  video_codec_distribution: DistributionItem[];
  resolution_distribution: DistributionItem[];
  hdr_distribution: DistributionItem[];
  audio_codec_distribution: DistributionItem[];
  audio_spatial_profile_distribution: DistributionItem[];
  audio_language_distribution: DistributionItem[];
  subtitle_distribution: DistributionItem[];
  subtitle_codec_distribution: DistributionItem[];
  subtitle_source_distribution: DistributionItem[];
  numeric_distributions: Record<NumericDistributionMetricId, NumericDistribution>;
};

export type LibrarySummary = {
  id: number;
  name: string;
  path: string;
  type: LibraryType;
  last_scan_at: string | null;
  scan_mode: "manual" | "scheduled" | "scheduled_daily" | "watch";
  duplicate_detection_mode: DuplicateDetectionMode;
  scan_config: Record<string, ScanConfigValue>;
  created_at: string;
  updated_at: string;
  quality_profile: QualityProfile;
  show_on_dashboard: boolean;
  file_count: number;
  total_size_bytes: number;
  total_duration_seconds: number;
  ready_files: number;
  pending_files: number;
};

export type LibraryStatistics = {
  container_distribution: DistributionItem[];
  video_codec_distribution: DistributionItem[];
  resolution_distribution: DistributionItem[];
  hdr_distribution: DistributionItem[];
  audio_codec_distribution: DistributionItem[];
  audio_spatial_profile_distribution: DistributionItem[];
  audio_language_distribution: DistributionItem[];
  subtitle_language_distribution: DistributionItem[];
  subtitle_codec_distribution: DistributionItem[];
  subtitle_source_distribution: DistributionItem[];
  numeric_distributions: Record<NumericDistributionMetricId, NumericDistribution>;
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
  container: string | null;
  duration: number | null;
  bitrate: number | null;
  audio_bitrate: number | null;
  video_codec: string | null;
  resolution: string | null;
  resolution_category_id?: string | null;
  resolution_category_label?: string | null;
  hdr_type: string | null;
  audio_codecs: string[];
  audio_spatial_profiles: string[];
  audio_languages: string[];
  subtitle_languages: string[];
  subtitle_codecs: string[];
  subtitle_sources: string[];
  content_category?: "main" | "bonus" | string;
  series_id?: number | null;
  series_title?: string | null;
  season_id?: number | null;
  season_number?: number | null;
  episode_number?: number | null;
  episode_number_end?: number | null;
  episode_title?: string | null;
};

export type VideoStream = {
  stream_index: number;
  codec: string | null;
  profile: string | null;
  width: number | null;
  height: number | null;
  pix_fmt: string | null;
  color_space: string | null;
  color_transfer: string | null;
  color_primaries: string | null;
  frame_rate: number | null;
  bit_rate: number | null;
  hdr_type: string | null;
};

export type AudioStream = {
  stream_index: number;
  codec: string | null;
  profile: string | null;
  spatial_audio_profile: string | null;
  channels: number | null;
  channel_layout: string | null;
  sample_rate: number | null;
  bit_rate: number | null;
  language: string | null;
  default_flag: boolean;
  forced_flag: boolean;
};

export type SubtitleStream = {
  stream_index: number;
  codec: string | null;
  language: string | null;
  default_flag: boolean;
  forced_flag: boolean;
  subtitle_type: string | null;
};

export type ExternalSubtitle = {
  path: string;
  language: string | null;
  format: string | null;
};

export type MediaFileStreamDetails = {
  id: number;
  video_streams: VideoStream[];
  audio_streams: AudioStream[];
  subtitle_streams: SubtitleStream[];
  external_subtitles: ExternalSubtitle[];
};

export type MediaFileSortKey =
  | "file"
  | "container"
  | "size"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "duration"
  | "bitrate"
  | "audio_bitrate"
  | "audio_codecs"
  | "audio_spatial_profiles"
  | "audio_languages"
  | "subtitle_languages"
  | "subtitle_codecs"
  | "subtitle_sources"
  | "mtime"
  | "last_analyzed_at"
  | "quality_score";

export type LibraryFileSearchField =
  | "file"
  | "container"
  | "size"
  | "quality_score"
  | "bitrate"
  | "audio_bitrate"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "duration"
  | "audio_codecs"
  | "audio_spatial_profiles"
  | "audio_languages"
  | "subtitle_languages"
  | "subtitle_codecs"
  | "subtitle_sources";

export type MediaFileTablePage = {
  total: number | null;
  offset: number;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
  items: MediaFileRow[];
};

export type MediaFileDetail = MediaFileRow &
  MediaFileStreamDetails & {
  media_format: {
    container_format: string | null;
    duration: number | null;
    bit_rate: number | null;
    probe_score: number | null;
  } | null;
  raw_ffprobe_json: Record<string, unknown> | null;
};

export type MediaFileQualityScoreDetail = {
  id: number;
  score: number;
  score_raw: number;
  breakdown: QualityBreakdown;
};

export type MediaFileHistoryEntry = {
  id: number;
  media_file_id: number | null;
  library_id: number;
  relative_path: string;
  filename: string;
  captured_at: string;
  capture_reason: "scan_analysis" | "quality_recompute" | "history_reconstruction";
  snapshot_hash: string;
  snapshot: Partial<MediaFileDetail> & Record<string, unknown>;
};

export type MediaFileHistory = {
  file_id: number;
  library_id: number;
  relative_path: string;
  total: number;
  items: MediaFileHistoryEntry[];
};

export type MediaSeriesSummary = {
  id: number;
  library_id: number;
  title: string;
  normalized_title: string;
  relative_path: string;
  year: number | null;
  season_count: number;
  episode_count: number;
  total_size_bytes: number;
  total_duration_seconds: number;
  last_analyzed_at: string | null;
};

export type MediaSeasonDetail = {
  id: number;
  library_id: number;
  series_id: number;
  season_number: number;
  title: string;
  relative_path: string;
  episode_count: number;
  total_size_bytes: number;
  total_duration_seconds: number;
  episodes: MediaFileRow[];
};

export type MediaSeriesDetail = MediaSeriesSummary & {
  seasons: MediaSeasonDetail[];
};

export type GroupedSeriesTableRow = {
  kind: "series";
  series_id: number;
  title: string;
  relative_path: string;
  year: number | null;
  season_count: number;
  episode_count: number;
  total_size_bytes: number;
  total_duration_seconds: number;
  quality_score_average: number | null;
  bitrate_average: number | null;
  audio_bitrate_average: number | null;
  children_loaded: boolean;
};

export type GroupedLooseFileTableRow = {
  kind: "file";
  file: MediaFileRow;
};

export type GroupedMediaTableEntry = GroupedSeriesTableRow | GroupedLooseFileTableRow;

export type GroupedMediaTablePage = {
  total: number | null;
  offset: number;
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
  items: GroupedMediaTableEntry[];
};

export type MediaSeriesGroupedDetail = MediaSeriesSummary & {
  seasons: MediaSeasonDetail[];
  episodes_without_season: MediaFileRow[];
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
  pattern_recognition?: {
    analyze_bonus_content: boolean;
    show_season_patterns: {
      recognition_mode: "folder_depth" | "regex";
      series_folder_depth: number;
      season_folder_depth: number;
      series_folder_regexes: string[];
      season_folder_regexes: string[];
      episode_file_regexes?: string[];
    };
    bonus_content: {
      user_folder_patterns: string[];
      default_folder_patterns: string[];
      effective_folder_patterns: string[];
      user_file_patterns: string[];
      default_file_patterns: string[];
      effective_file_patterns: string[];
    };
  };
  resolution_categories?: ResolutionCategory[];
  scan_performance?: {
    scan_worker_count: number;
      parallel_scan_jobs: number;
      comparison_scatter_point_limit: number;
  };
  history_retention?: {
    file_history: {
      days: number;
      storage_limit_gb: number;
    };
    library_history: {
      days: number;
      storage_limit_gb: number;
    };
    scan_history: {
      days: number;
      storage_limit_gb: number;
    };
  };
  feature_flags: {
    show_analyzed_files_csv_export: boolean;
    show_full_width_app_shell: boolean;
    hide_quality_score_meter: boolean;
    unlimited_panel_size: boolean;
    in_depth_dolby_vision_profiles: boolean;
  };
};

export type HistoryStorageCategory = {
  entry_count: number;
  current_estimated_bytes: number;
  average_daily_bytes: number;
  projected_bytes_30d: number;
  projected_bytes_for_configured_days: number | null;
  days_limit: number;
  storage_limit_bytes: number;
  oldest_recorded_at: string | null;
  newest_recorded_at: string | null;
};

export type HistoryStorage = {
  generated_at: string;
  database_file_bytes: number;
  reclaimable_file_bytes: number;
  categories: {
    file_history: HistoryStorageCategory;
    library_history: HistoryStorageCategory;
    scan_history: HistoryStorageCategory;
  };
};

export type HistoryReconstructionResult = {
  generated_at: string;
  libraries_processed: number;
  libraries_with_media: number;
  created_file_history_entries: number;
  created_library_history_entries: number;
  updated_library_history_entries: number;
  oldest_reconstructed_snapshot_day: string | null;
  newest_reconstructed_snapshot_day: string | null;
};

export type HistoryReconstructionStatus = {
  status: "idle" | "queued" | "running" | "completed" | "failed";
  phase:
    | "idle"
    | "loading_libraries"
    | "loading_library"
    | "reconstructing_file_history"
    | "reconstructing_library_history"
    | "completed"
    | "failed";
  started_at: string | null;
  finished_at: string | null;
  progress_percent: number;
  libraries_total: number;
  libraries_processed: number;
  libraries_with_media: number;
  current_library_name: string | null;
  phase_total: number;
  phase_completed: number;
  created_file_history_entries: number;
  created_library_history_entries: number;
  updated_library_history_entries: number;
  result: HistoryReconstructionResult | null;
  error: string | null;
};

export type ScanJob = {
  id: number;
  library_id: number;
  library_name: string | null;
  status: string;
  job_type: string;
  discovered_files?: number;
  files_total: number;
  files_scanned: number;
  errors: number;
  started_at: string | null;
  finished_at: string | null;
  progress_percent: number;
  phase_label: string;
  phase_detail: string | null;
};

export type ScanTriggerSource = "manual" | "scheduled" | "watchdog";
export type ScanOutcome = "successful" | "completed_with_issues" | "failed" | "canceled";

export type ScanFileList = {
  count: number;
  paths: string[];
  truncated_count: number;
};

export type ScanFileIssue = {
  path: string;
  reason: string;
  detail?: string | null;
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
    mode: DuplicateDetectionMode;
    queued_for_processing: number;
    processed_successfully: number;
    processing_failed: number;
    failed_files: ScanFileIssue[];
    failed_files_truncated_count: number;
    duplicate_groups: number;
    duplicate_files: number;
  };
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

export type DuplicateGroupFile = {
  id: number;
  relative_path: string;
  filename: string;
  size_bytes: number;
};

export type DuplicateGroup = {
  mode: DuplicateDetectionMode;
  signature: string;
  label: string;
  file_count: number;
  total_size_bytes: number;
  items: DuplicateGroupFile[];
};

export type DuplicateGroupPage = {
  mode: DuplicateDetectionMode;
  total_groups: number;
  duplicate_file_count: number;
  offset: number;
  limit: number;
  items: DuplicateGroup[];
};

export type ScanCancelResponse = {
  canceled_jobs: number;
};

type LibraryFilesRequestParams = {
  offset?: number;
  limit?: number;
  cursor?: string | null;
  includeTotal?: boolean;
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
  ["container", "search_container"],
  ["size", "search_size"],
  ["quality_score", "search_quality_score"],
  ["bitrate", "search_bitrate"],
  ["audio_bitrate", "search_audio_bitrate"],
  ["video_codec", "search_video_codec"],
  ["resolution", "search_resolution"],
  ["hdr_type", "search_hdr_type"],
  ["duration", "search_duration"],
  ["audio_codecs", "search_audio_codecs"],
  ["audio_spatial_profiles", "search_audio_spatial_profiles"],
  ["audio_languages", "search_audio_languages"],
  ["subtitle_languages", "search_subtitle_languages"],
  ["subtitle_codecs", "search_subtitle_codecs"],
  ["subtitle_sources", "search_subtitle_sources"],
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
  if (params?.cursor) {
    searchParams.set("cursor", params.cursor);
  }
  if (params?.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }
  if (params?.includeTotal !== undefined) {
    searchParams.set("include_total", params.includeTotal ? "true" : "false");
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

function buildPanelQuery(panels?: readonly string[] | null): string {
  if (!panels?.length) {
    return "";
  }
  const searchParams = new URLSearchParams();
  for (const panelId of panels) {
    searchParams.append("panels", panelId);
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export const api = {
  appSettings: () => request<AppSettings>("/app-settings"),
  dashboard: (panels?: readonly string[] | null) => request<DashboardResponse>(`/dashboard${buildPanelQuery(panels)}`),
  dashboardHistory: (signal?: AbortSignal) =>
    request<DashboardHistoryResponse>("/dashboard/history", { signal }),
  dashboardComparison: (
    params: { xField: ComparisonFieldId; yField: ComparisonFieldId; signal?: AbortSignal },
  ) =>
    request<ComparisonResponse>(
      `/dashboard/comparison?x_field=${encodeURIComponent(params.xField)}&y_field=${encodeURIComponent(params.yField)}`,
      { signal: params.signal },
    ),
  activeScanJobs: () => request<ScanJob[]>("/scan-jobs/active"),
  historyStorage: () => request<HistoryStorage>("/history-storage"),
  historyReconstructionStatus: () => request<HistoryReconstructionStatus>("/history/reconstruct"),
  reconstructHistory: () =>
    request<HistoryReconstructionStatus>("/history/reconstruct", {
      method: "POST",
    }),
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
  libraryStatistics: (id: string | number, signal?: AbortSignal, panels?: readonly string[] | null) =>
    request<LibraryStatistics>(`/libraries/${id}/statistics${buildPanelQuery(panels)}`, { signal }),
  libraryHistory: (id: string | number, signal?: AbortSignal) =>
    request<LibraryHistoryResponse>(`/libraries/${id}/history`, { signal }),
  librarySeries: (id: string | number, signal?: AbortSignal) =>
    request<MediaSeriesSummary[]>(`/libraries/${id}/series`, { signal }),
  librarySeriesDetail: (libraryId: string | number, seriesId: string | number, signal?: AbortSignal) =>
    request<MediaSeriesDetail>(`/libraries/${libraryId}/series/${seriesId}`, { signal }),
  librarySeriesGroupedDetail: (
    libraryId: string | number,
    seriesId: string | number,
    params?: Omit<LibraryFilesRequestParams, "offset" | "limit" | "cursor" | "sortKey" | "sortDirection" | "includeTotal">,
  ) =>
    request<MediaSeriesGroupedDetail>(
      buildLibraryFilesPath(libraryId, params as LibraryFilesRequestParams | undefined, `/series/${seriesId}/grouped-detail`),
      { signal: params?.signal },
    ),
  libraryComparison: (
    id: string | number,
    params: { xField: ComparisonFieldId; yField: ComparisonFieldId; signal?: AbortSignal },
  ) =>
    request<ComparisonResponse>(
      `/libraries/${id}/statistics/comparison?x_field=${encodeURIComponent(params.xField)}&y_field=${encodeURIComponent(params.yField)}`,
      { signal: params.signal },
    ),
  libraryDuplicates: (
    id: string | number,
    params?: { offset?: number; limit?: number; signal?: AbortSignal },
  ) => {
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
  libraryFiles: (id: string | number, params?: LibraryFilesRequestParams) =>
    request<MediaFileTablePage>(buildLibraryFilesPath(id, params), {
      signal: params?.signal,
    }),
  libraryGroupedFiles: (id: string | number, params?: LibraryFilesRequestParams) =>
    request<GroupedMediaTablePage>(buildLibraryFilesPath(id, params, "/files/grouped"), {
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
  fileStreams: (id: string | number) => request<MediaFileStreamDetails>(`/files/${id}/streams`),
  fileQualityScore: (id: string | number) => request<MediaFileQualityScoreDetail>(`/files/${id}/quality-score`),
  fileHistory: (id: string | number, signal?: AbortSignal) =>
    request<MediaFileHistory>(`/files/${id}/history`, { signal }),
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
    pattern_recognition?: {
      analyze_bonus_content?: boolean;
      show_season_patterns?: {
        recognition_mode?: "folder_depth" | "regex";
        series_folder_depth?: number;
        season_folder_depth?: number;
        series_folder_regexes?: string[];
        season_folder_regexes?: string[];
      };
      bonus_content?: {
        user_folder_patterns?: string[];
        default_folder_patterns?: string[];
        user_file_patterns?: string[];
        default_file_patterns?: string[];
      };
    };
    resolution_categories?: ResolutionCategory[];
    scan_performance?: {
      scan_worker_count?: number;
      parallel_scan_jobs?: number;
      comparison_scatter_point_limit?: number;
    };
    history_retention?: {
      file_history?: {
        days?: number;
        storage_limit_gb?: number;
      };
      library_history?: {
        days?: number;
        storage_limit_gb?: number;
      };
      scan_history?: {
        days?: number;
        storage_limit_gb?: number;
      };
    };
    feature_flags?: {
      show_analyzed_files_csv_export?: boolean;
      show_full_width_app_shell?: boolean;
      hide_quality_score_meter?: boolean;
      unlimited_panel_size?: boolean;
      in_depth_dolby_vision_profiles?: boolean;
    };
  }) =>
    request<AppSettings>("/app-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createLibrary: (payload: {
    name: string;
    path: string;
    type: LibraryType;
    scan_mode: string;
    duplicate_detection_mode?: DuplicateDetectionMode;
    scan_config?: Record<string, ScanConfigValue>;
    quality_profile?: QualityProfile;
    show_on_dashboard?: boolean;
  }) =>
    request<LibrarySummary>("/libraries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateLibrarySettings: (
    libraryId: string | number,
    payload: {
      name?: string;
      type?: LibraryType;
      scan_mode?: string;
      duplicate_detection_mode?: DuplicateDetectionMode;
      scan_config?: Record<string, ScanConfigValue>;
      quality_profile?: QualityProfile;
      show_on_dashboard?: boolean;
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

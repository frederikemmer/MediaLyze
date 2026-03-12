export type DistributionItem = {
  label: string;
  value: number;
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
  browse: (path = ".") => request<BrowseResponse>(`/browse?path=${encodeURIComponent(path)}`),
  updateAppSettings: (payload: {
    ignore_patterns?: string[];
    user_ignore_patterns?: string[];
    default_ignore_patterns?: string[];
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

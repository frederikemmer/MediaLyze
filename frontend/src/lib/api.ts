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
  | "audio_bitrate"
  | "chapter_count";

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
  | "play_count"
  | "users_played"
  | "audio_channels"
  | "sample_rate"
  | "resolution_mp"
  | "container"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "audio_artist"
  | "audio_album"
  | "audio_genre"
  | "audio_year"
  | "track_number"
  | "bit_rate_mode"
  | "embedded_cover"
  | "chapter_count"
  | "audiobook_narrator"
  | "audiobook_author"
  | "audiobook_publisher"
  | "audiobook_series"
  | "audiobook_series_part";

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

export type DashboardHistoryLibrary = {
  id: number;
  name: string;
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
  visible_libraries: DashboardHistoryLibrary[];
};

export type UpdateReleaseNotes = {
  version: string;
  date: string | null;
  sections: Array<{
    title: string;
    items: string[];
  }>;
};

export type UpdateDesktopAsset = {
  platform: "darwin" | "win32" | "linux";
  arch: "arm64" | "x64";
  filename: string;
  download_url: string;
  size_bytes: number;
  sha256: string | null;
};

export type UpdateStatus = {
  current_version: string;
  latest_version: string | null;
  latest_release_url?: string | null;
  update_available: boolean;
  automatic_reminder_eligible?: boolean;
  checked_at: string | null;
  release_notes: UpdateReleaseNotes[];
  desktop_assets?: UpdateDesktopAsset[];
};

export type DesktopUpdateReminder = {
  version: string | null;
  reminded_at: string | null;
};

export type QualityCategoryConfig = {
  weight: number;
  minimum: string | number;
  ideal: string | number;
  maximum?: string | number | null;
  values?: string[];
  minimum_values?: string[];
  ideal_values?: string[];
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
  active_metrics?: string[] | null;
  resolution: QualityCategoryConfig;
  visual_density: QualityNumericCategoryConfig;
  video_codec: QualityCategoryConfig;
  audio_channels: QualityCategoryConfig;
  audio_codec: QualityCategoryConfig;
  dynamic_range: QualityCategoryConfig;
  language_preferences: QualityLanguagePreferencesConfig;
  audio_bitrate?: QualityNumericCategoryConfig;
  sample_rate?: QualityNumericCategoryConfig;
  music_tags?: QualityCategoryConfig;
  audiobook_tags?: QualityCategoryConfig;
  audiobook_chapters?: QualityCategoryConfig;
};

export type QualityCategoryBreakdown = {
  key: string;
  score: number;
  weight: number;
  active: boolean;
  skipped: boolean;
  minimum: string | number | string[] | null;
  ideal: string | number | string[] | null;
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
export type LibraryType = "movies" | "series" | "music" | "audiobooks" | "mixed" | "other";
export type HistoryAddedDateSource = "medialyze" | "jellyfin" | "connector";

export type ConnectorConnection = {
  id: number;
  provider: string;
  name: string;
  base_url: string;
  config: Record<string, unknown>;
  capabilities: Record<string, boolean>;
  enabled: boolean;
  sync_interval_minutes: number;
  path_mapping_mode: "automatic" | "manual";
  library_mapping_mode: "automatic" | "manual";
  server_name: string | null;
  server_version: string | null;
  last_status: string;
  last_error: string | null;
  last_sync_started_at: string | null;
  last_sync_finished_at: string | null;
  last_successful_sync_at: string | null;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
};

export type ConnectorLocation = {
  id: number;
  connector_library_id: number;
  remote_path: string;
  normalized_path: string;
};

export type ConnectorLibrary = {
  id: number;
  connection_id: number;
  remote_id: string;
  name: string;
  media_type: string | null;
  provider_payload: Record<string, unknown>;
  last_synced_at: string | null;
  locations: ConnectorLocation[];
  linked_library_ids: number[];
};

export type ConnectorBinding = {
  id: number;
  location_id: number;
  library_root_id: number;
  source_prefix: string;
  normalized_source_prefix: string;
  target_subpath: string;
  case_mode: "sensitive" | "insensitive";
  priority: number;
  active: boolean;
  origin: "automatic" | "manual" | string;
  confidence: number;
  evidence_count: number;
  verification_status: "verified" | "stale" | "imported" | string;
  last_verified_at: string | null;
};

export type ConnectorBindingWrite = Omit<ConnectorBinding, "id" | "normalized_source_prefix" | "origin" | "confidence" | "evidence_count" | "verification_status" | "last_verified_at"> & {
  id?: number;
};

export type ConnectorMappingOverview = {
  connection_id: number;
  path_mapping_mode: "automatic" | "manual";
  library_mapping_mode: "automatic" | "manual";
  coverage: {
    total_items: number;
    matched_items: number;
    attention_items: number;
    matched_percent: number;
  };
  libraries: Array<{
    id: number;
    remote_id: string;
    name: string;
    media_type: string | null;
    linked_library_ids: number[];
    required_library_ids: number[];
    locations: Array<{
      id: number;
      remote_path: string;
      bindings: ConnectorBinding[];
    }>;
    recommendation: null | {
      kind: "create_library";
      suggested_name: string;
      suggested_type: string;
      reason: string;
      accessible_paths: string[];
    };
  }>;
};

export type ConnectorItem = {
  id: number;
  connection_id: number;
  connector_library_id: number | null;
  remote_id: string;
  item_type: string;
  remote_path: string | null;
  title: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  match_status: string;
  mismatch_reason: string | null;
  last_synced_at: string | null;
};

export type ConnectorItemPage = {
  total: number;
  offset: number;
  limit: number;
  items: ConnectorItem[];
};

export type ConnectorSyncJob = {
  id: number;
  connection_id: number;
  job_type: string;
  sync_run_id: string | null;
  status: string;
  trigger_source: string;
  cancellation_requested: boolean;
  progress_phase: string | null;
  progress_detail: string | null;
  progress_current: number;
  progress_total: number | null;
  error: string | null;
  sync_summary: Record<string, unknown>;
};

export type ConnectorProviderDescriptor = {
  provider: string;
  configuration_fields: Array<{
    key: string;
    input_type: string;
    required: boolean;
    secret: boolean;
  }>;
  optional_capabilities: string[];
};

export type ConnectorUser = {
  remote_id: string;
  name: string;
  enabled_for_sync: boolean;
  last_synced_at: string | null;
};

export type ConnectorPlaybackSource = {
  connection_id: number;
  connection_name: string;
  provider: string;
  connector_item_id: number;
  user_data: Array<{
    remote_user_id: string;
    user_name: string;
    play_count: number;
    played: boolean;
    playback_position_ticks: number;
    last_played_date: string | null;
    is_favorite: boolean;
  }>;
  playback_events: Array<{
    remote_event_id: string;
    remote_user_id: string;
    user_name: string;
    played_at: string;
  }>;
  individual_playback_history_start_at: string | null;
};

export type FileConnectorSource = {
  connection_id: number;
  connection_name: string;
  provider: string;
  connector_item_id: number;
  remote_id: string;
  title: string;
  item_type: string;
  remote_path: string | null;
  match_method: string;
  preferred: boolean;
  original_title: string | null;
  series_name: string | null;
  season_name: string | null;
  date_created: string | null;
  premiere_date: string | null;
  production_year: number | null;
  overview: string | null;
  provider_ids: Record<string, unknown>;
  provider_payload: Record<string, unknown>;
};

export type JellyfinConnection = {
  base_url: string;
  enabled: boolean;
  sync_interval_minutes: number;
  api_key_configured: boolean;
  server_name: string | null;
  server_version: string | null;
  last_status: string;
  last_error: string | null;
  last_sync_started_at: string | null;
  last_sync_finished_at: string | null;
  last_successful_sync_at: string | null;
  next_scheduled_sync_at: string | null;
};

export type JellyfinSyncStatus = JellyfinConnection & {
  sync_job_id: number | null;
  sync_job_status: "queued" | "running" | "completed" | "canceled" | "failed" | null;
  sync_trigger_source: "manual" | "scheduled" | null;
  sync_job_active: boolean;
  sync_job_error: string | null;
  sync_heartbeat_at?: string | null;
  sync_summary: Record<string, unknown>;
  sync_phase: string | null;
  sync_phase_detail: string | null;
  sync_current: number;
  sync_total: number | null;
  sync_progress_tracks?: Array<{
    id: string;
    label: string;
    current: number;
    total: number | null;
    status: "queued" | "running" | "completed";
  }>;
  cancellation_requested?: boolean;
  item_count: number;
  matched_item_count: number;
  unmatched_item_count: number;
  library_count: number;
  user_count: number;
};

export type JellyfinSyncStart = {
  job_id: number;
  status: "queued" | "running";
  trigger_source: "manual" | "scheduled";
  accepted: boolean;
};

export type JellyfinMatchRecomputeStatus = {
  status: "idle" | "queued" | "running" | "success" | "error";
  active: boolean;
  rerun_pending: boolean;
  last_error: string | null;
};

export type JellyfinUser = {
  jellyfin_user_id: string;
  name: string;
  enabled_for_sync: boolean;
  last_synced_at: string | null;
};

export type JellyfinPathMapping = {
  id: number;
  jellyfin_path_prefix: string;
  medialyze_path_prefix: string;
  enabled: boolean;
};

export type JellyfinPathMappingBatchItem = Omit<JellyfinPathMapping, "id"> & {
  id?: number;
};

export type JellyfinLibrary = {
  id: number;
  name: string;
  collection_type: string | null;
  locations: string[];
  mapped_locations: string[];
  mapped_status: "linked" | "accessible" | "path_unmapped" | "path_not_accessible" | string;
  linked_library_id: number | null;
  linked_library_name: string | null;
  link_method?: "manual" | "path" | null;
  can_create_medialyze_library: boolean;
  data_scope: "jellyfin_only" | "linked";
  item_count: number;
  last_synced_at: string;
};

export type JellyfinDistribution = { label: string; value: number };

export type JellyfinCatalogSummary = {
  library_count: number;
  item_count: number;
  known_size_bytes: number;
  size_known_count: number;
  known_duration_seconds: number;
  duration_known_count: number;
  last_synced_at: string | null;
};

export type JellyfinLibraryOverview = {
  library: JellyfinLibrary;
  item_count: number;
  known_size_bytes: number;
  size_known_count: number;
  known_duration_seconds: number;
  duration_known_count: number;
  earliest_date_created: string | null;
  latest_date_created: string | null;
  item_type_distribution: JellyfinDistribution[];
  production_year_distribution: JellyfinDistribution[];
  added_month_distribution: JellyfinDistribution[];
  playback_distribution: JellyfinDistribution[];
  users: JellyfinUser[];
};

export type JellyfinLibraryItem = {
  id: number;
  jellyfin_item_id: string;
  title: string;
  original_title: string | null;
  item_type: string;
  series_name: string | null;
  season_name: string | null;
  index_number: number | null;
  parent_index_number: number | null;
  date_created: string | null;
  premiere_date: string | null;
  production_year: number | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  has_primary_image: boolean;
  play_count: number;
  played: boolean;
  played_user_count: number;
  favorite_user_count: number;
  match_status: string;
  media_file_id: number | null;
};

export type JellyfinLibraryItemPage = {
  items: JellyfinLibraryItem[];
  total: number;
  offset: number;
  limit: number;
};

export type JellyfinItemDetail = {
  item: JellyfinItem;
  library_id: number | null;
  library_name: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  match: JellyfinFileOverlay["match"];
  user_data: JellyfinFileOverlay["user_data"];
};

export type JellyfinItem = {
  id: number;
  jellyfin_item_id: string;
  item_type: string;
  path: string | null;
  title: string;
  original_title: string | null;
  series_name: string | null;
  season_name: string | null;
  index_number: number | null;
  parent_index_number: number | null;
  date_created: string | null;
  premiere_date: string | null;
  production_year: number | null;
  overview: string | null;
  provider_ids: Record<string, string>;
  image_tags: Record<string, string>;
  backdrop_image_tags: string[];
  match_status: string;
  mismatch_reason: string | null;
};

export type JellyfinFileOverlay = {
  match: {
    id: number;
    media_file_id: number;
    jellyfin_item_id: number;
    match_method: string;
    confidence: number;
    status: string;
    mismatch_reason: string | null;
  } | null;
  item: JellyfinItem | null;
  user_data: Array<{
    jellyfin_user_id: string;
    user_name: string;
    play_count: number;
    played: boolean;
    playback_position_ticks: number;
    last_played_date: string | null;
    is_favorite: boolean;
  }>;
  playback_events: Array<{
    jellyfin_activity_id: number;
    jellyfin_user_id: string;
    user_name: string;
    played_at: string;
  }>;
  individual_playback_history_start_at: string | null;
};

export const DEFAULT_QUALITY_PROFILE: QualityProfile = {
  version: 1,
  active_metrics: ["resolution", "visual_density", "video_codec", "audio_channels", "audio_codec", "dynamic_range", "language_preferences"],
  resolution: { weight: 8, minimum: "1080p", ideal: "4k", maximum: "8k" },
  visual_density: { weight: 10, minimum: 0.02, ideal: 0.04, maximum: 0.08 },
  video_codec: { weight: 5, minimum: "h264", ideal: "hevc", minimum_values: ["h264"], ideal_values: ["hevc"] },
  audio_channels: { weight: 4, minimum: "stereo", ideal: "5.1", maximum: "7.1" },
  audio_codec: { weight: 3, minimum: "aac", ideal: "eac3" },
  dynamic_range: { weight: 4, minimum: "sdr", ideal: "hdr10", minimum_values: ["sdr"], ideal_values: ["hdr10"] },
  language_preferences: { weight: 6, mode: "partial", audio_languages: [], subtitle_languages: [] },
  audio_bitrate: { weight: 0, minimum: 96000, ideal: 256000, maximum: 512000 },
  sample_rate: { weight: 0, minimum: 44100, ideal: 48000, maximum: 96000 },
  music_tags: { weight: 0, minimum: "partial", ideal: "complete" },
  audiobook_tags: { weight: 0, minimum: "partial", ideal: "complete" },
  audiobook_chapters: { weight: 0, minimum: "chapters", ideal: "chapters_with_titles" },
};

export type QualityProfileMediaType = "video" | "music" | "audiobook";

export type QualityProfileDefinition = {
  id: number;
  name: string;
  media_type: QualityProfileMediaType;
  profile: QualityProfile;
  is_default: boolean;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
  library_count: number;
};

export type CatalogSource = "official" | "local";
export type PlaybackMode =
  | "direct"
  | "direct_stream"
  | "transcode"
  | "video_transcode"
  | "conditional"
  | "unsupported";
export type CompatibilityStatus =
  | "direct_play"
  | "direct_stream"
  | "video_transcode"
  | "conditional"
  | "unsupported";

export type ProfileSource = {
  label: string;
  url: string;
};

export type CompatibilityProfileMetadata = {
  schema_version: 1;
  profile_version: number;
  id: string;
  name: string;
  status: "official" | "local";
  verified_by?: string | null;
  added: string;
  last_modified: string;
  notes?: string | null;
  sources: ProfileSource[];
  base_profile_id?: string | null;
  base_profile_version?: number | null;
  catalog_source?: CatalogSource | null;
};

export type HardwareVideoCapability = {
  hardware_decode: boolean;
  max_resolution?: string | null;
  max_width?: number | null;
  max_height?: number | null;
  max_fps?: number | null;
  bit_depth?: number[];
  hdr?: string[];
};

export type HardwareProfile = CompatibilityProfileMetadata & {
  category: string;
  manufacturer: string;
  year?: number | null;
  video: Record<string, HardwareVideoCapability>;
  audio: Record<string, boolean | "passthrough_only" | "limited">;
  containers: string[];
  subtitles: Record<string, boolean | "passthrough_only" | "limited">;
};

export type SoftwareCapability = {
  mode: PlaybackMode;
  max_resolution?: string | null;
  max_width?: number | null;
  max_height?: number | null;
  max_fps?: number | null;
  bit_depth?: number[];
  hdr?: string[];
  profiles?: string[];
  max_channels?: number | null;
  conditions?: CapabilityCondition[];
};

export type CapabilityCondition = {
  kind:
    | "client_version"
    | "os_version"
    | "setting"
    | "extension"
    | "hardware_decode"
    | "hdr_display"
    | "device_capability"
    | "tested_only";
  value: string;
  note?: string | null;
};

export type SoftwareCompatibilityRule = {
  id: string;
  match: {
    containers?: string[];
    video_codecs?: string[];
    audio_codecs?: string[];
    subtitle_formats?: string[];
    video_profiles?: string[];
    bit_depths?: number[];
    hdr?: string[];
    min_audio_channels?: number | null;
    max_audio_channels?: number | null;
  };
  mode: PlaybackMode;
  conditions?: CapabilityCondition[];
  note?: string | null;
  subtitle_action?: "direct" | "remux" | "convert" | "burn_in" | null;
};

export type SoftwareProfile = CompatibilityProfileMetadata & {
  category: string;
  developer: string;
  platforms: string[];
  video: Record<string, SoftwareCapability>;
  audio: Record<string, SoftwareCapability>;
  containers: Record<string, SoftwareCapability>;
  subtitles: Record<string, SoftwareCapability>;
  rules?: SoftwareCompatibilityRule[];
  server_fallback?: "unsupported" | "transcode";
};

export type CompatibilityProfile = CompatibilityProfileMetadata & {
  hardware_profile_id: string;
  software_profile_id: string;
};

export type CompatibilityFinding = {
  code: string;
  severity: "info" | "warning" | "error";
  scope: "container" | "video" | "audio" | "subtitle" | "metadata" | "profile";
  message: string;
  blocking: boolean;
  stream_index?: number | null;
};

export type CompatibilityEvaluation = {
  compatibility_profile_id: string;
  compatibility_profile_name: string;
  hardware_profile_id: string;
  hardware_profile_version: number;
  software_profile_id: string;
  software_profile_version: number;
  file_id: number;
  status: CompatibilityStatus;
  container_status?: CompatibilityStatus;
  video_status?: CompatibilityStatus;
  audio_status?: CompatibilityStatus;
  subtitle_status?: CompatibilityStatus;
  selected_audio_stream_index?: number | null;
  findings: CompatibilityFinding[];
};

export type ProfileEvaluation = {
  profile_type: "hardware" | "software";
  profile_id: string;
  profile_name: string;
  profile_version: number;
  file_id: number;
  status: CompatibilityStatus;
  container_status: CompatibilityStatus;
  video_status: CompatibilityStatus;
  audio_status: CompatibilityStatus;
  subtitle_status: CompatibilityStatus;
  selected_audio_stream_index?: number | null;
  findings: CompatibilityFinding[];
};

export type DashboardResponse = {
  totals: Record<string, number>;
  container_distribution: DistributionItem[];
  video_codec_distribution: DistributionItem[];
  resolution_distribution: DistributionItem[];
  hdr_distribution: DistributionItem[];
  video_bit_depth_distribution: DistributionItem[];
  bit_depth_distribution: DistributionItem[];
  audio_artist_distribution?: DistributionItem[];
  audio_album_distribution?: DistributionItem[];
  audio_genre_distribution?: DistributionItem[];
  audio_year_distribution?: DistributionItem[];
  audio_channel_distribution?: DistributionItem[];
  sample_rate_distribution?: DistributionItem[];
  track_number_distribution?: DistributionItem[];
  bit_rate_mode_distribution?: DistributionItem[];
  embedded_cover_distribution?: DistributionItem[];
  audiobook_narrator_distribution?: DistributionItem[];
  audiobook_author_distribution?: DistributionItem[];
  audiobook_publisher_distribution?: DistributionItem[];
  audiobook_series_distribution?: DistributionItem[];
  audiobook_series_part_distribution?: DistributionItem[];
  chapter_count_distribution?: DistributionItem[];
  audio_codec_distribution: DistributionItem[];
  audio_spatial_profile_distribution: DistributionItem[];
  audio_language_distribution: DistributionItem[];
  subtitle_distribution: DistributionItem[];
  subtitle_codec_distribution: DistributionItem[];
  subtitle_source_distribution: DistributionItem[];
  numeric_distributions: Partial<Record<NumericDistributionMetricId, NumericDistribution>>;
};

export type LibrarySummary = {
  id: number;
  name: string;
  path: string;
  roots?: Array<{
    id: number;
    path: string;
    display_name: string;
    path_key: string;
  }>;
  type: LibraryType;
  last_scan_at: string | null;
  scan_mode: "manual" | "scheduled" | "scheduled_daily" | "watch";
  duplicate_detection_mode: DuplicateDetectionMode;
  scan_config: Record<string, ScanConfigValue>;
  created_at: string;
  updated_at: string;
  quality_profile: QualityProfile;
  quality_profile_id?: number | null;
  show_on_dashboard: boolean;
  history_added_date_source?: HistoryAddedDateSource;
  preferred_connector_connection_id?: number | null;
  connector_links?: Array<{
    connection_id: number;
    connection_name: string;
    provider: string;
    connector_library_id: number;
    connector_library_name: string;
    link_method: string;
  }>;
  file_count: number;
  total_size_bytes: number;
  total_duration_seconds: number;
  ready_files: number;
  pending_files: number;
  linked_jellyfin_library?: {
    id: number;
    name: string;
    last_synced_at: string;
  } | null;
};

export type LibraryStatistics = {
  container_distribution: DistributionItem[];
  video_codec_distribution: DistributionItem[];
  resolution_distribution: DistributionItem[];
  hdr_distribution: DistributionItem[];
  video_bit_depth_distribution: DistributionItem[];
  bit_depth_distribution: DistributionItem[];
  audio_artist_distribution?: DistributionItem[];
  audio_album_distribution?: DistributionItem[];
  audio_genre_distribution?: DistributionItem[];
  audio_year_distribution?: DistributionItem[];
  audio_channel_distribution?: DistributionItem[];
  sample_rate_distribution?: DistributionItem[];
  track_number_distribution?: DistributionItem[];
  bit_rate_mode_distribution?: DistributionItem[];
  embedded_cover_distribution?: DistributionItem[];
  audiobook_narrator_distribution?: DistributionItem[];
  audiobook_author_distribution?: DistributionItem[];
  audiobook_publisher_distribution?: DistributionItem[];
  audiobook_series_distribution?: DistributionItem[];
  audiobook_series_part_distribution?: DistributionItem[];
  chapter_count_distribution?: DistributionItem[];
  audio_codec_distribution: DistributionItem[];
  audio_spatial_profile_distribution: DistributionItem[];
  audio_language_distribution: DistributionItem[];
  subtitle_language_distribution: DistributionItem[];
  subtitle_codec_distribution: DistributionItem[];
  subtitle_source_distribution: DistributionItem[];
  user_play_count_distribution: DistributionItem[];
  numeric_distributions: Partial<Record<NumericDistributionMetricId, NumericDistribution>>;
};

export type StorageMapBreadcrumb = {
  name: string;
  path: string;
};

export type StorageMapColorShare = {
  value: string | number | null;
  size_bytes: number;
};

export type StorageMapNode = {
  kind: "folder" | "file";
  name: string;
  path: string;
  size_bytes: number;
  file_count: number;
  file_id: number | null;
  extension: string | null;
  jellyfin_title: string | null;
  video_codec: string | null;
  resolution: string | null;
  resolution_category_id: string | null;
  resolution_category_label: string | null;
  hdr_type: string | null;
  quality_score: number | null;
  quality_score_raw: number | null;
  container: string | null;
  duration_seconds: number | null;
  bitrate: number | null;
  audio_bitrate: number | null;
  audio_codec: string | null;
  audio_channels: number | null;
  frame_rate: number | null;
  bit_depth: number | null;
  audio_language: string | null;
  subtitle_status: string | null;
  subtitle_language: string | null;
  analysis_status: string | null;
  color_distributions: Record<string, StorageMapColorShare[]>;
};

export type LibraryStorageMap = {
  library_id: number;
  library_name: string;
  path: string;
  total_size_bytes: number;
  file_count: number;
  breadcrumbs: StorageMapBreadcrumb[];
  items: StorageMapNode[];
};

export type MediaFileRow = {
  id: number;
  library_id: number;
  root_id?: number | null;
  root_name?: string | null;
  display_path?: string | null;
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
  bit_depth: number | null;
  audio_title?: string | null;
  audio_artist?: string | null;
  audio_album?: string | null;
  audio_album_artist?: string | null;
  audio_genre?: string | null;
  audio_date?: string | null;
  audio_disc?: string | null;
  audio_composer?: string | null;
  audio_channels?: number | null;
  sample_rate?: number | null;
  track_number?: string | null;
  bit_rate_mode?: string | null;
  has_embedded_cover?: boolean;
  chapter_count?: number | null;
  audiobook_narrator?: string | null;
  audiobook_author?: string | null;
  audiobook_publisher?: string | null;
  audiobook_series?: string | null;
  audiobook_series_part?: string | null;
  audiobook_description?: string | null;
  audiobook_copyright?: string | null;
  audiobook_asin?: string | null;
  audiobook_isbn?: string | null;
  audiobook_language?: string | null;
  audiobook_abridged?: string | null;
  embedded_cover_stream_index?: number | null;
  embedded_cover_codec?: string | null;
  embedded_cover_width?: number | null;
  embedded_cover_height?: number | null;
  analysis_failure_kind?: string | null;
  analysis_failure_reason?: string | null;
  analysis_failure_detail?: string | null;
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
  jellyfin_title?: string | null;
  jellyfin_production_year?: number | null;
  jellyfin_date_created?: string | null;
  jellyfin_series_name?: string | null;
  jellyfin_season_name?: string | null;
  jellyfin_play_count?: number | null;
  jellyfin_played_user_count?: number | null;
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
  bit_depth?: number | null;
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
  bit_depth?: number | null;
  bit_rate_mode?: string | null;
  compression_mode?: string | null;
  replay_gain?: string | null;
  replay_gain_peak?: string | null;
  writing_library?: string | null;
  md5_unencoded?: string | null;
  language: string | null;
  default_flag: boolean;
  forced_flag: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  album_artist?: string | null;
  genre?: string | null;
  date?: string | null;
  disc?: string | null;
  composer?: string | null;
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
  id: number;
  path: string;
  language: string | null;
  format: string | null;
};

export type MediaChapter = {
  chapter_index: number;
  start_time: number | null;
  end_time: number | null;
  duration: number | null;
  title?: string | null;
  tags?: Record<string, string> | null;
};

export type MediaFileStreamDetails = {
  id: number;
  video_streams: VideoStream[];
  audio_streams: AudioStream[];
  subtitle_streams: SubtitleStream[];
  external_subtitles: ExternalSubtitle[];
  chapters?: MediaChapter[];
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
  | "play_count"
  | "bit_depth"
  | "audio_title"
  | "audio_artist"
  | "audio_album"
  | "audio_album_artist"
  | "audio_genre"
  | "audio_date"
  | "audio_disc"
  | "audio_composer"
  | "audio_channels"
  | "sample_rate"
  | "track_number"
  | "bit_rate_mode"
  | "has_embedded_cover"
  | "chapter_count"
  | "audiobook_narrator"
  | "audiobook_author"
  | "audiobook_publisher"
  | "audiobook_series"
  | "audiobook_series_part"
  | "audiobook_description"
  | "audiobook_copyright"
  | "audiobook_language"
  | "audiobook_abridged"
  | "audiobook_asin"
  | "audiobook_isbn"
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
  | "jellyfin_name"
  | "container"
  | "size"
  | "quality_score"
  | "bitrate"
  | "audio_bitrate"
  | "bit_depth"
  | "audio_title"
  | "audio_artist"
  | "audio_album"
  | "audio_album_artist"
  | "audio_genre"
  | "audio_date"
  | "audio_disc"
  | "audio_composer"
  | "audio_channels"
  | "sample_rate"
  | "track_number"
  | "bit_rate_mode"
  | "has_embedded_cover"
  | "chapter_count"
  | "chapter_titles"
  | "audiobook_narrator"
  | "audiobook_author"
  | "audiobook_publisher"
  | "audiobook_series"
  | "audiobook_series_part"
  | "audiobook_description"
  | "audiobook_copyright"
  | "audiobook_asin"
  | "audiobook_isbn"
  | "audiobook_language"
  | "audiobook_abridged"
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

export type MediaFileSearchResult = {
  id: number;
  library_id: number;
  library_name: string;
  library_type: LibraryType;
  filename: string;
  relative_path: string;
  size_bytes: number;
  container: string | null;
  duration: number | null;
  quality_score: number;
  video_codec: string | null;
  resolution: string | null;
  hdr_type: string | null;
};

export type MediaFileSearchResponse = {
  query: string;
  library_id: number | null;
  limit: number;
  items: MediaFileSearchResult[];
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

export type TranscodeStreamAction = "keep" | "drop" | "copy" | "encode";

export type TranscodeStreamPlan = {
  stream_index: number;
  action: TranscodeStreamAction;
  codec?: string | null;
  encoder?: string | null;
  bitrate?: number | null;
  crf?: number | null;
  cq?: number | null;
  width?: number | null;
  height?: number | null;
  frame_rate?: number | null;
  pixel_format?: string | null;
  profile?: string | null;
  level?: string | null;
  preset?: string | null;
  gop_size?: number | null;
  language?: string | null;
  title?: string | null;
};

export type TranscodePlan = {
  version: 1;
  profile: "compatibility" | "storage" | "modern" | "expert";
  container: "mkv" | "mp4" | "webm";
  video_streams: TranscodeStreamPlan[];
  audio_streams: TranscodeStreamPlan[];
  subtitle_streams: TranscodeStreamPlan[];
  external_subtitles: Array<{
    subtitle_id: number;
    action: "drop" | "copy" | "encode";
    codec?: string | null;
    language?: string | null;
    title?: string | null;
  }>;
  dynamic_range: "preserve" | "sdr" | "hdr10" | "hlg" | "dolby_vision";
  chapters: "keep" | "drop";
  metadata: "keep" | "drop";
  cover: "keep" | "drop";
  attachments: "keep" | "drop";
  filename_template: string;
  filename_template_override?: boolean | null;
  include_subtitle_languages?: boolean;
  output_mode?: "transcode_output" | "same_directory" | "replace_original" | null;
  execution_mode?: "hardware_required" | "cpu_only" | null;
  replacement_confirmed?: boolean;
};

export type TranscodeEncoderCapability = {
  name: string;
  codec: string;
  hardware: boolean;
  available: boolean;
  tested: boolean;
  test_error: string | null;
  device_ids?: string[];
  options: string[];
  quality_mode?: "crf" | "cq" | "qp" | "global_quality" | null;
  quality_min?: number | null;
  quality_max?: number | null;
  quality_default?: number | null;
  quality_step?: number | null;
};

export type TranscodeHardwareDevice = {
  id: string;
  name: string;
  vendor: string;
  backend: string;
  driver_version: string | null;
  compute_capability: string | null;
  memory_total_bytes: number | null;
  render_node?: string | null;
  native_device_index?: number | null;
  device_class?: "integrated" | "dedicated" | "unknown";
  decoder_codecs: string[];
  encoder_names?: string[];
  encoder_codecs: string[];
  supported_pixel_formats: string[];
  supported_filters: string[];
  status: "available" | "unavailable" | "not_detected";
  failure_reason: string | null;
  last_tested_at: string | null;
};

export type TranscodeCapabilities = {
  ffmpeg_available: boolean;
  ffmpeg_path: string;
  version: string | null;
  ffmpeg_version?: string | null;
  containers: Array<"mkv" | "mp4" | "webm">;
  encoders: TranscodeEncoderCapability[];
  devices?: TranscodeHardwareDevice[];
  decoder_codecs?: string[];
  platform?: string | null;
  last_tested_at?: string | null;
  dolby_vision_passthrough: boolean;
  error: string | null;
};

export type TranscodeMatrixBenchmarkRun = {
  run: number;
  duration_seconds: number | null;
  success: boolean;
  error: string | null;
};

export type TranscodeMatrixBenchmarkLevel = {
  concurrency: number;
  runs: TranscodeMatrixBenchmarkRun[];
  median_seconds: number | null;
  slowdown_percent: number | null;
  passed: boolean;
  error: string | null;
};

export type TranscodeMatrixBenchmark = {
  tolerance_percent: number;
  test_ceiling: number;
  repetitions: number;
  width: number;
  height: number;
  frame_rate: number;
  frames: number;
  stream_loops: number;
  baseline_median_seconds: number | null;
  slowdown_limit_seconds: number | null;
  levels: TranscodeMatrixBenchmarkLevel[];
};

export type TranscodeMatrixCell = {
  decode_codec: string;
  encode_codec: string;
  status: "hardware" | "software" | "unsupported" | "not_tested";
  decoder: string | null;
  encoder: string | null;
  max_parallel_jobs: number | null;
  max_parallel_jobs_is_lower_bound: boolean;
  parallel_benchmark?: TranscodeMatrixBenchmark | null;
  detail: string | null;
};

export type TranscodeDeviceMatrix = {
  device_id: string;
  device_name: string;
  backend: string;
  tested_at: string;
  decode_codecs: string[];
  encode_codecs: string[];
  cells: TranscodeMatrixCell[];
};

export type TranscodeCapabilityMatrix = {
  status: "not_run" | "completed" | "failed";
  tested_at: string | null;
  ffmpeg_version: string | null;
  matrices: TranscodeDeviceMatrix[];
  error: string | null;
};

export type TranscodeValidation = {
  valid: boolean;
  output_path: string;
  output_filename: string;
  normalized_plan: TranscodePlan;
  ffmpeg_arguments: string[];
  ffmpeg_command: string;
  kept_streams: string[];
  changed_streams: string[];
  removed_streams: string[];
  added_streams: string[];
  warnings: string[];
  errors: string[];
  detected_hardware_encoders: string[];
  output_mode?: string;
  execution_mode?: string | null;
  device_id?: string | null;
  hardware_backend?: string | null;
  ffmpeg_version?: string | null;
  cpu_thread_budget?: number | null;
  cpu_budget_percent?: number | null;
};

export type TranscodeFileSummary = {
  id: number | null;
  filename: string;
  relative_path: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  dynamic_range: string | null;
  video_codec: string | null;
  audio_codecs: string[];
  audio_languages: string[];
};

export type TranscodeJob = {
  id: number;
  group_id: number;
  library_id: number;
  source_file_id: number | null;
  result_file_id: number | null;
  status: "queued" | "running" | "completed" | "canceled" | "failed";
  profile: string;
  plan_version: number;
  plan: TranscodePlan;
  ffmpeg_arguments: string[];
  ffmpeg_command: string;
  warnings: string[];
  source_path_snapshot: string;
  output_path_snapshot: string;
  output_relative_path: string;
  output_mode?: string;
  output_storage_root?: string | null;
  retry_count?: number;
  attempt?: number;
  cpu_budget_percent?: number | null;
  cpu_thread_budget?: number | null;
  device_id?: string | null;
  hardware_backend?: string | null;
  ffmpeg_version?: string | null;
  remove_partial_output?: boolean;
  on_error?: string;
  progress_percent: number;
  processed_seconds: number;
  speed: string | null;
  eta_seconds: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type TranscodeVariant = {
  id: number;
  group_id: number;
  job_id: number | null;
  original_file_id: number | null;
  output_file_id: number | null;
  library_root_id: number | null;
  output_relative_path: string;
  output_filename: string;
  output_mode?: string;
  source_path_snapshot: string;
  output_path_snapshot: string;
  analysis_status: string;
  created_at: string;
  updated_at: string;
  file: TranscodeFileSummary | null;
};

export type FileTranscode = {
  original: TranscodeFileSummary;
  profiles: Record<"compatibility" | "storage" | "modern", TranscodePlan>;
  attachments: Array<{
    stream_index: number;
    codec?: string | null;
    filename?: string | null;
    mimetype?: string | null;
    title?: string | null;
  }>;
  variants: TranscodeVariant[];
  jobs: TranscodeJob[];
};

export type TranscodeJobPage = {
  items: TranscodeJob[];
  total: number;
};

export type MediaFileRawProbe = {
  id: number;
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
  library_root_id?: number | null;
  root_alias?: string | null;
  display_path?: string;
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
  library_root_id?: number | null;
  root_alias?: string | null;
  display_path?: string;
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
  play_count_total?: number | null;
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
    duplicate_matching: {
      duration_tolerance_seconds: number;
      user_filename_suffix_regexes: string[];
      default_filename_suffix_regexes: string[];
      effective_filename_suffix_regexes: string[];
    };
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
  transcoding?: TranscodingSettings;
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
    transcode_history: {
      days: number;
      storage_limit_gb: number;
    };
  };
  ui_preferences?: {
    interface_language: "en" | "de" | "es" | "uk";
    color_theme: "system" | "light" | "dark";
  };
  telemetry?: {
    mode: TelemetryMode;
    environment_disabled: boolean;
    installation_id?: string | null;
    installation_id_suffix: string | null;
    last_sent_at: string | null;
    last_user_visible_payload: Record<string, unknown> | null;
  };
  feature_flags: {
    hide_automatic_update_reminders?: boolean;
    show_automatic_update_reminders?: boolean;
    show_analyzed_files_csv_export: boolean;
    show_full_width_app_shell: boolean;
    hide_quality_score_meter: boolean;
    show_music_quality_score: boolean;
    unlimited_panel_size: boolean;
    in_depth_dolby_vision_profiles: boolean;
    show_all_playbacks_when_unstacked: boolean;
  };
};

export type TranscodingSettings = {
  execution_mode: "hardware_required" | "cpu_only";
  cpu_budget_percent: number;
  cpu_parallel_jobs: "auto" | number;
  gpu_parallel_jobs_per_device: number;
  selected_devices: "auto" | string[];
  default_output_mode: "transcode_output" | "same_directory" | "replace_original";
  on_error: "continue" | "stop_queue";
  retry_count: number;
  existing_output: "fail" | "skip";
  remove_partial_output: boolean;
};

export type TelemetryPreviewMode = "none" | "minimal" | "enabled";
export type TelemetryMode = "none" | "initialized" | "off" | "minimal" | "enabled";

export type TelemetryPreview = {
  payload: Record<string, unknown>;
  redacted: boolean;
  mode: TelemetryPreviewMode;
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
    transcode_history: HistoryStorageCategory;
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
  unchanged_files?: number;
  discovery_complete?: boolean;
  new_files_live?: number;
  deleted_files_live?: number;
  modified_files_live?: number;
  files_total: number;
  files_scanned: number;
  errors: number;
  started_at: string | null;
  finished_at: string | null;
  progress_percent: number;
  progress_mode?: "indeterminate" | "determinate";
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
  root_id?: number | null;
  root_name?: string | null;
  display_path?: string | null;
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
  suppressed: boolean;
  items: DuplicateGroupFile[];
};

export type DuplicateGroupPage = {
  mode: DuplicateDetectionMode;
  total_groups: number;
  duplicate_file_count: number;
  include_suppressed: boolean;
  suppressed_group_count: number;
  offset: number;
  limit: number;
  items: DuplicateGroup[];
};

export type DuplicateSuppressionPayload = {
  mode: Exclude<DuplicateDetectionMode, "off" | "both">;
  signature: string;
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
  ["jellyfin_name", "search_jellyfin_name"],
  ["container", "search_container"],
  ["size", "search_size"],
  ["quality_score", "search_quality_score"],
  ["bitrate", "search_bitrate"],
  ["audio_bitrate", "search_audio_bitrate"],
  ["bit_depth", "search_bit_depth"],
  ["video_codec", "search_video_codec"],
  ["resolution", "search_resolution"],
  ["hdr_type", "search_hdr_type"],
  ["duration", "search_duration"],
  ["audio_codecs", "search_audio_codecs"],
  ["audio_spatial_profiles", "search_audio_spatial_profiles"],
  ["audio_languages", "search_audio_languages"],
  ["audio_title", "search_audio_title"],
  ["audio_artist", "search_audio_artist"],
  ["audio_album", "search_audio_album"],
  ["audio_album_artist", "search_audio_album_artist"],
  ["audio_genre", "search_audio_genre"],
  ["audio_date", "search_audio_date"],
  ["audio_disc", "search_audio_disc"],
  ["audio_composer", "search_audio_composer"],
  ["audio_channels", "search_audio_channels"],
  ["sample_rate", "search_sample_rate"],
  ["track_number", "search_track_number"],
  ["bit_rate_mode", "search_bit_rate_mode"],
  ["has_embedded_cover", "search_has_embedded_cover"],
  ["chapter_count", "search_chapter_count"],
  ["chapter_titles", "search_chapter_titles"],
  ["audiobook_narrator", "search_audiobook_narrator"],
  ["audiobook_author", "search_audiobook_author"],
  ["audiobook_publisher", "search_audiobook_publisher"],
  ["audiobook_series", "search_audiobook_series"],
  ["audiobook_series_part", "search_audiobook_series_part"],
  ["audiobook_description", "search_audiobook_description"],
  ["audiobook_copyright", "search_audiobook_copyright"],
  ["audiobook_asin", "search_audiobook_asin"],
  ["audiobook_isbn", "search_audiobook_isbn"],
  ["audiobook_language", "search_audiobook_language"],
  ["audiobook_abridged", "search_audiobook_abridged"],
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

function buildFileMediaPath(id: string | number, options: { download?: boolean } = {}): string {
  const query = options.download ? "?download=1" : "";
  return `/files/${id}/media${query}`;
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

function buildRepeatedQuery(key: string, values: readonly string[]): string {
  if (!values.length) return "";
  const params = new URLSearchParams();
  values.forEach((value) => params.append(key, value));
  return `?${params.toString()}`;
}

export const api = {
  appSettings: () => request<AppSettings>("/app-settings"),
  qualityProfiles: () => request<QualityProfileDefinition[]>("/quality-profiles"),
  createQualityProfile: (payload: {
    name: string;
    media_type: QualityProfileMediaType;
    profile: QualityProfile;
    is_default?: boolean;
  }) =>
    request<QualityProfileDefinition>("/quality-profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateQualityProfile: (
    profileId: number,
    payload: {
      name?: string;
      profile?: QualityProfile;
      is_default?: boolean;
    },
  ) =>
    request<QualityProfileDefinition>(`/quality-profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteQualityProfile: (profileId: number) =>
    request<void>(`/quality-profiles/${profileId}`, {
      method: "DELETE",
    }),
  hardwareProfiles: () => request<HardwareProfile[]>("/compatibility/hardware-profiles"),
  softwareProfiles: () => request<SoftwareProfile[]>("/compatibility/software-profiles"),
  compatibilityProfiles: () => request<CompatibilityProfile[]>("/compatibility/profiles"),
  createHardwareProfile: (payload: HardwareProfile) =>
    request<HardwareProfile>("/compatibility/hardware-profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateHardwareProfile: (id: string, payload: Partial<HardwareProfile>) =>
    request<HardwareProfile>(`/compatibility/hardware-profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteHardwareProfile: (id: string) =>
    request<void>(`/compatibility/hardware-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createSoftwareProfile: (payload: SoftwareProfile) =>
    request<SoftwareProfile>("/compatibility/software-profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSoftwareProfile: (id: string, payload: Partial<SoftwareProfile>) =>
    request<SoftwareProfile>(`/compatibility/software-profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteSoftwareProfile: (id: string) =>
    request<void>(`/compatibility/software-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createCompatibilityProfile: (payload: CompatibilityProfile) =>
    request<CompatibilityProfile>("/compatibility/profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCompatibilityProfile: (id: string, payload: Partial<CompatibilityProfile>) =>
    request<CompatibilityProfile>(`/compatibility/profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCompatibilityProfile: (id: string) =>
    request<void>(`/compatibility/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  fileCompatibility: (id: string | number, profileIds: string[] = []) =>
    request<CompatibilityEvaluation[]>(
      `/files/${id}/compatibility${buildRepeatedQuery("profile_ids", profileIds)}`,
    ),
  fileHardwareCompatibility: (id: string | number, profileIds: string[] = []) =>
    request<ProfileEvaluation[]>(
      `/files/${id}/hardware-compatibility${buildRepeatedQuery("profile_ids", profileIds)}`,
    ),
  fileSoftwareCompatibility: (id: string | number, profileIds: string[] = []) =>
    request<ProfileEvaluation[]>(
      `/files/${id}/software-compatibility${buildRepeatedQuery("profile_ids", profileIds)}`,
    ),
  updateStatus: () => request<UpdateStatus>("/update-status"),
  desktopUpdateReminder: () => request<DesktopUpdateReminder>("/desktop/update-reminder"),
  markDesktopUpdateReminder: (version: string) =>
    request<DesktopUpdateReminder>("/desktop/update-reminder/mark", {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
  dashboard: (panels?: readonly string[] | null) => request<DashboardResponse>(`/dashboard${buildPanelQuery(panels)}`),
  dashboardHistory: (signal?: AbortSignal) =>
    request<DashboardHistoryResponse>("/dashboard/history", { signal }),
  dashboardComparison: (
    params: {
      xField: ComparisonFieldId;
      yField: ComparisonFieldId;
      renderer?: ComparisonRendererId;
      signal?: AbortSignal;
    },
  ) =>
    request<ComparisonResponse>(
      `/dashboard/comparison?x_field=${encodeURIComponent(params.xField)}&y_field=${encodeURIComponent(params.yField)}${params.renderer ? `&renderer=${encodeURIComponent(params.renderer)}` : ""}`,
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
  libraryStorageMap: (
    id: string | number,
    params?: { path?: string; signal?: AbortSignal },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.path) {
      searchParams.set("path", params.path);
    }
    const query = searchParams.toString();
    return request<LibraryStorageMap>(
      `/libraries/${id}/storage-map${query ? `?${query}` : ""}`,
      { signal: params?.signal },
    );
  },
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
    params: {
      xField: ComparisonFieldId;
      yField: ComparisonFieldId;
      renderer?: ComparisonRendererId;
      signal?: AbortSignal;
    },
  ) =>
    request<ComparisonResponse>(
      `/libraries/${id}/statistics/comparison?x_field=${encodeURIComponent(params.xField)}&y_field=${encodeURIComponent(params.yField)}${params.renderer ? `&renderer=${encodeURIComponent(params.renderer)}` : ""}`,
      { signal: params.signal },
    ),
  libraryDuplicates: (
    id: string | number,
    params?: { offset?: number; limit?: number; includeSuppressed?: boolean; signal?: AbortSignal },
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.offset !== undefined) {
      searchParams.set("offset", String(params.offset));
    }
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    if (params?.includeSuppressed !== undefined) {
      searchParams.set("include_suppressed", params.includeSuppressed ? "true" : "false");
    }
    const query = searchParams.toString();
    return request<DuplicateGroupPage>(`/libraries/${id}/duplicates${query ? `?${query}` : ""}`, {
      signal: params?.signal,
    });
  },
  suppressDuplicateGroup: (id: string | number, payload: DuplicateSuppressionPayload) =>
    request<void>(`/libraries/${id}/duplicates/suppressions`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  unsuppressDuplicateGroup: (id: string | number, payload: DuplicateSuppressionPayload) => {
    const searchParams = new URLSearchParams();
    searchParams.set("mode", payload.mode);
    searchParams.set("signature", payload.signature);
    return request<void>(`/libraries/${id}/duplicates/suppressions?${searchParams.toString()}`, {
      method: "DELETE",
    });
  },
  libraryFiles: (id: string | number, params?: LibraryFilesRequestParams) =>
    request<MediaFileTablePage>(buildLibraryFilesPath(id, params), {
      signal: params?.signal,
    }),
  fileSearch: (params?: { query?: string; libraryId?: number | null; limit?: number; signal?: AbortSignal }) => {
    const searchParams = new URLSearchParams();
    if (params?.query) {
      searchParams.set("query", params.query);
    }
    if (params?.libraryId) {
      searchParams.set("library_id", String(params.libraryId));
    }
    if (params?.limit !== undefined) {
      searchParams.set("limit", String(params.limit));
    }
    const query = searchParams.toString();
    return request<MediaFileSearchResponse>(`/files/search${query ? `?${query}` : ""}`, {
      signal: params?.signal,
    });
  },
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
  downloadFileChaptersCsv: async (id: string | number, signal?: AbortSignal): Promise<DownloadedCsv> => {
    const response = await fetch(`${API_PREFIX}/files/${id}/chapters/export.csv`, { signal });
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
  downloadFileCover: async (
    id: string | number,
    options: { download?: boolean; signal?: AbortSignal } = {},
  ): Promise<DownloadedCsv> => {
    const query = options.download ? "?download=1" : "";
    const response = await fetch(`${API_PREFIX}/files/${id}/cover${query}`, { signal: options.signal });
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
  fileMediaUrl: (id: string | number, options: { download?: boolean } = {}) => `${API_PREFIX}${buildFileMediaPath(id, options)}`,
  libraryScanJobs: (id: string | number) => request<ScanJob[]>(`/libraries/${id}/scan-jobs`),
  file: (
    id: string | number,
    options: { includeRawFfprobe?: boolean } = {},
  ) =>
    request<MediaFileDetail>(
      `/files/${id}${options.includeRawFfprobe === false ? "?include_raw_ffprobe=false" : ""}`,
    ),
  fileRawFfprobe: (id: string | number, signal?: AbortSignal) =>
    request<MediaFileRawProbe>(`/files/${id}/raw-ffprobe`, { signal }),
  fileJellyfin: (id: string | number) => request<JellyfinFileOverlay>(`/files/${id}/jellyfin`),
  fileConnectors: (id: string | number) =>
    request<FileConnectorSource[]>(`/files/${id}/connectors`),
  jellyfinImageUrl: (itemId: string | number, imageType: "Primary" | "Backdrop" | "Thumb" = "Primary") =>
    `${API_PREFIX}/jellyfin/images/${itemId}/${imageType}`,
  fileStreams: (id: string | number) => request<MediaFileStreamDetails>(`/files/${id}/streams`),
  fileQualityScore: (id: string | number) => request<MediaFileQualityScoreDetail>(`/files/${id}/quality-score`),
  fileHistory: (id: string | number, signal?: AbortSignal) =>
    request<MediaFileHistory>(`/files/${id}/history`, { signal }),
  transcodeCapabilities: (refresh = false) =>
    request<TranscodeCapabilities>(`/transcoding/capabilities${refresh ? "?refresh=true" : ""}`),
  transcodeCapabilityMatrix: () =>
    request<TranscodeCapabilityMatrix>("/transcoding/capability-matrix"),
  testTranscodeCapabilityMatrix: () =>
    request<TranscodeCapabilityMatrix>("/transcoding/capability-matrix/test", { method: "POST" }),
  fileTranscode: (id: string | number, signal?: AbortSignal) =>
    request<FileTranscode>(`/files/${id}/transcode`, { signal }),
  validateFileTranscode: (id: string | number, plan: TranscodePlan, signal?: AbortSignal) =>
    request<TranscodeValidation>(`/files/${id}/transcode/validate`, {
      method: "POST",
      body: JSON.stringify(plan),
      signal,
    }),
  startFileTranscode: (id: string | number, plan: TranscodePlan) =>
    request<TranscodeJob>(`/files/${id}/transcode`, {
      method: "POST",
      body: JSON.stringify(plan),
    }),
  activeTranscodeJobs: () => request<TranscodeJobPage>("/transcode-jobs/active"),
  transcodeJobs: (params: {
    libraryId?: number;
    status?: TranscodeJob["status"];
    startedAfter?: string;
    startedBefore?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.libraryId) query.set("library_id", String(params.libraryId));
    if (params.status) query.set("status", params.status);
    if (params.startedAfter) query.set("started_after", params.startedAfter);
    if (params.startedBefore) query.set("started_before", params.startedBefore);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    const suffix = query.toString();
    return request<TranscodeJobPage>(`/transcode-jobs${suffix ? `?${suffix}` : ""}`);
  },
  transcodeJob: (id: string | number) => request<TranscodeJob>(`/transcode-jobs/${id}`),
  cancelTranscodeJob: (id: string | number) =>
    request<TranscodeJob>(`/transcode-jobs/${id}/cancel`, { method: "POST" }),
  browse: (path = ".") => request<BrowseResponse>(`/browse?path=${encodeURIComponent(path)}`),
  telemetryPreview: (mode: TelemetryPreviewMode = "minimal") =>
    request<TelemetryPreview>(`/telemetry/preview?mode=${encodeURIComponent(mode)}`),
  telemetrySendNow: () =>
    request<AppSettings>("/telemetry/send-now", {
      method: "POST",
    }),
  inspectPath: (path: string) =>
    request<PathInspection>("/paths/inspect", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  connectorProviders: () => request<string[]>("/connectors/providers"),
  connectorProviderDescriptors: () =>
    request<ConnectorProviderDescriptor[]>("/connectors/provider-descriptors"),
  connectors: () => request<ConnectorConnection[]>("/connectors"),
  createConnector: (payload: {
    provider: string;
    name: string;
    base_url: string;
    secret?: string;
    enabled?: boolean;
    sync_interval_minutes?: number;
    config?: Record<string, unknown>;
    path_mapping_mode?: "automatic" | "manual";
    library_mapping_mode?: "automatic" | "manual";
  }) => request<ConnectorConnection>("/connectors", { method: "POST", body: JSON.stringify(payload) }),
  updateConnector: (id: number, payload: Partial<{
    name: string;
    base_url: string;
    secret: string;
    enabled: boolean;
    sync_interval_minutes: number;
    config: Record<string, unknown>;
    path_mapping_mode: "automatic" | "manual";
    library_mapping_mode: "automatic" | "manual";
  }>) => request<ConnectorConnection>(`/connectors/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteConnector: (id: number) => request<void>(`/connectors/${id}`, { method: "DELETE" }),
  testConnector: (id: number, payload: { base_url?: string; secret?: string } = {}) =>
    request<{ success: boolean; server_name: string | null; server_version: string | null; error: string | null }>(
      `/connectors/${id}/test`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  syncConnector: (id: number) =>
    request<{ job_id: number; status: string; trigger_source: string; accepted: boolean }>(
      `/connectors/${id}/sync`,
      { method: "POST" },
    ),
  cancelConnectorSync: (id: number, jobId?: number | null) =>
    request<{ job_id: number | null; status: string | null; cancellation_requested: boolean }>(
      `/connectors/${id}/sync/cancel${jobId ? `?job_id=${jobId}` : ""}`,
      { method: "POST" },
    ),
  connectorSyncStatus: (id: number) =>
    request<ConnectorSyncJob | null>(`/connectors/${id}/sync/status`),
  connectorUsers: (id: number) => request<ConnectorUser[]>(`/connectors/${id}/users`),
  updateConnectorUsers: (id: number, enabledUserIds: string[]) =>
    request<ConnectorUser[]>(`/connectors/${id}/users`, {
      method: "PUT",
      body: JSON.stringify({ enabled_user_ids: enabledUserIds }),
    }),
  connectorLibraries: (id: number) => request<ConnectorLibrary[]>(`/connectors/${id}/libraries`),
  connectorMappingOverview: (id: number) =>
    request<ConnectorMappingOverview>(`/connectors/${id}/mapping-overview`),
  updateConnectorLibraryLinks: (
    id: number,
    links: Array<{ connector_library_id: number; library_ids: number[] }>,
  ) => request<ConnectorLibrary[]>(`/connectors/${id}/library-links`, {
    method: "PUT",
    body: JSON.stringify({ links }),
  }),
  connectorBindings: (id: number) => request<ConnectorBinding[]>(`/connectors/${id}/bindings`),
  updateConnectorBindings: (id: number, bindings: ConnectorBindingWrite[]) =>
    request<ConnectorBinding[]>(`/connectors/${id}/bindings`, {
      method: "PUT",
      body: JSON.stringify({ bindings }),
    }),
  connectorItems: (
    id: number,
    status?: string,
    offset = 0,
    limit = 100,
    attentionOnly = false,
  ) => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (status) params.set("status", status);
    if (attentionOnly) params.set("attention_only", "true");
    return request<ConnectorItemPage>(`/connectors/${id}/items?${params.toString()}`);
  },
  connectorItemStatusSummary: (id: number) =>
    request<Record<string, number>>(`/connectors/${id}/item-status-summary`),
  createLibraryForConnector: (
    connectionId: number,
    connectorLibraryId: number,
    payload: { name: string; path: string; paths?: string[]; type: LibraryType; scan_mode?: string },
  ) => request<LibrarySummary>(
    `/connectors/${connectionId}/libraries/${connectorLibraryId}/create-medialyze-library`,
    { method: "POST", body: JSON.stringify(payload) },
  ),
  fileConnectorPlayback: (fileId: string | number) =>
    request<ConnectorPlaybackSource[]>(`/files/${fileId}/connector-playback`),
  jellyfinConnection: () => request<JellyfinConnection>("/jellyfin/connection"),
  updateJellyfinConnection: (payload: {
    base_url?: string;
    api_key?: string;
    clear_api_key?: boolean;
    enabled?: boolean;
    sync_interval_minutes?: number;
  }) =>
    request<JellyfinConnection>("/jellyfin/connection", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  disconnectJellyfin: () =>
    request<void>("/jellyfin/connection", { method: "DELETE" }),
  testJellyfinConnection: (payload: { base_url?: string; api_key?: string }) =>
    request<{ ok: boolean; server_name: string | null; server_version: string | null; error: string | null }>(
      "/jellyfin/test",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  syncJellyfin: () =>
    request<JellyfinSyncStart>(
      "/jellyfin/sync",
      { method: "POST" },
    ),
  cancelJellyfinSync: (jobId?: number | null) =>
    request<{ job_id: number | null; status: string | null; cancellation_requested: boolean }>(`/jellyfin/sync/cancel${jobId ? `?job_id=${jobId}` : ""}`, {
      method: "POST",
    }),
  jellyfinSyncStatus: () => request<JellyfinSyncStatus>("/jellyfin/sync/status"),
  jellyfinUsers: () => request<JellyfinUser[]>("/jellyfin/users"),
  updateJellyfinUsers: (enabledUserIds: string[]) =>
    request<JellyfinUser[]>("/jellyfin/users", {
      method: "PATCH",
      body: JSON.stringify({ enabled_user_ids: enabledUserIds }),
    }),
  jellyfinPathMappings: () => request<JellyfinPathMapping[]>("/jellyfin/path-mappings"),
  updateJellyfinPathMappingsBatch: (
    mappings: JellyfinPathMappingBatchItem[],
    deleteIds: number[] = [],
  ) =>
    request<JellyfinPathMapping[]>("/jellyfin/path-mappings/batch", {
      method: "PUT",
      body: JSON.stringify({ mappings, delete_ids: deleteIds }),
    }),
  jellyfinMatchRecomputeStatus: () =>
    request<JellyfinMatchRecomputeStatus>("/jellyfin/matches/recompute/status"),
  createJellyfinPathMapping: (payload: Omit<JellyfinPathMapping, "id">) =>
    request<JellyfinPathMapping>("/jellyfin/path-mappings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateJellyfinPathMapping: (id: number, payload: Partial<Omit<JellyfinPathMapping, "id">>) =>
    request<JellyfinPathMapping>(`/jellyfin/path-mappings/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteJellyfinPathMapping: (id: number) =>
    request<void>(`/jellyfin/path-mappings/${id}`, { method: "DELETE" }),
  jellyfinLibraries: () => request<JellyfinLibrary[]>("/jellyfin/libraries"),
  jellyfinCatalogSummary: () => request<JellyfinCatalogSummary>("/jellyfin/catalog/summary"),
  jellyfinLibraryOverview: (id: string | number, userId?: string | null, signal?: AbortSignal) =>
    request<JellyfinLibraryOverview>(
      `/jellyfin/libraries/${id}/overview${userId ? `?user_id=${encodeURIComponent(userId)}` : ""}`,
      { signal },
    ),
  jellyfinLibraryItems: (id: string | number, params?: {
    offset?: number;
    limit?: number;
    search?: string;
    itemType?: string;
    productionYear?: number;
    played?: boolean | null;
    userId?: string | null;
    sortKey?: "title" | "year" | "added" | "duration" | "size" | "play_count";
    sortDirection?: "asc" | "desc";
    signal?: AbortSignal;
  }) => {
    const query = new URLSearchParams();
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.search) query.set("search", params.search);
    if (params?.itemType) query.set("item_type", params.itemType);
    if (params?.productionYear !== undefined) query.set("production_year", String(params.productionYear));
    if (params?.played !== undefined && params.played !== null) query.set("played", String(params.played));
    if (params?.userId) query.set("user_id", params.userId);
    if (params?.sortKey) query.set("sort_key", params.sortKey);
    if (params?.sortDirection) query.set("sort_direction", params.sortDirection);
    const suffix = query.toString();
    return request<JellyfinLibraryItemPage>(`/jellyfin/libraries/${id}/items${suffix ? `?${suffix}` : ""}`, { signal: params?.signal });
  },
  jellyfinItem: (id: string | number, signal?: AbortSignal) =>
    request<JellyfinItemDetail>(`/jellyfin/items/${id}`, { signal }),
  createLibraryFromJellyfin: (id: number) =>
    request<LibrarySummary>(`/jellyfin/libraries/${id}/create-medialyze-library`, { method: "POST" }),
  updateJellyfinLibraryLink: (id: number, linkedLibraryId: number | null) =>
    request<JellyfinLibrary>(`/jellyfin/libraries/${id}/link`, {
      method: "PATCH",
      body: JSON.stringify({ linked_library_id: linkedLibraryId }),
    }),
  updateAppSettings: (payload: {
    ignore_patterns?: string[];
    user_ignore_patterns?: string[];
    default_ignore_patterns?: string[];
    pattern_recognition?: {
      analyze_bonus_content?: boolean;
      duplicate_matching?: {
        duration_tolerance_seconds?: number;
        user_filename_suffix_regexes?: string[];
        default_filename_suffix_regexes?: string[];
      };
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
    transcoding?: Partial<TranscodingSettings>;
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
      transcode_history?: {
        days?: number;
        storage_limit_gb?: number;
      };
    };
    ui_preferences?: {
      interface_language?: "en" | "de" | "es" | "uk";
      color_theme?: "system" | "light" | "dark";
    };
    telemetry?: {
      mode?: "off" | "minimal" | "enabled";
    };
    feature_flags?: {
      hide_automatic_update_reminders?: boolean;
      show_analyzed_files_csv_export?: boolean;
      show_full_width_app_shell?: boolean;
      hide_quality_score_meter?: boolean;
      show_music_quality_score?: boolean;
      unlimited_panel_size?: boolean;
      in_depth_dolby_vision_profiles?: boolean;
      show_all_playbacks_when_unstacked?: boolean;
    };
  }) =>
    request<AppSettings>("/app-settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createLibrary: (payload: {
    name: string;
    path: string;
    paths?: string[];
    roots?: Array<{ id?: number; path: string; display_name?: string }>;
    type: LibraryType;
    scan_mode: string;
    duplicate_detection_mode?: DuplicateDetectionMode;
    scan_config?: Record<string, ScanConfigValue>;
    quality_profile?: QualityProfile;
    quality_profile_id?: number | null;
    show_on_dashboard?: boolean;
    history_added_date_source?: HistoryAddedDateSource;
  }) =>
    request<LibrarySummary>("/libraries", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateLibrarySettings: (
    libraryId: string | number,
    payload: {
      name?: string;
      path?: string;
      paths?: string[];
      roots?: Array<{ id?: number; path: string; display_name?: string }>;
      type?: LibraryType;
      scan_mode?: string;
      duplicate_detection_mode?: DuplicateDetectionMode;
      scan_config?: Record<string, ScanConfigValue>;
      quality_profile?: QualityProfile;
      quality_profile_id?: number | null;
      show_on_dashboard?: boolean;
      history_added_date_source?: HistoryAddedDateSource;
      preferred_connector_connection_id?: number | null;
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
  cancelLibraryScanJobs: (libraryId: number) =>
    request<ScanCancelResponse>(`/libraries/${libraryId}/scan/cancel`, {
      method: "POST",
    }),
};

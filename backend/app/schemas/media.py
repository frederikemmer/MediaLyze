from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import MediaFileHistoryCaptureReason, ScanStatus
from backend.app.schemas.quality import QualityBreakdownRead
from backend.app.schemas._time import UtcDateTime


class DistributionItem(BaseModel):
    label: str
    value: int
    filter_value: str | None = None


NumericDistributionMetricId = Literal[
    "quality_score",
    "duration",
    "size",
    "bitrate",
    "audio_bitrate",
]


class NumericDistributionBin(BaseModel):
    lower: float | None = None
    upper: float | None = None
    count: int
    percentage: float


class NumericDistribution(BaseModel):
    total: int
    bins: list[NumericDistributionBin]


class MediaFormatRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    container_format: str | None
    duration: float | None
    bit_rate: int | None
    probe_score: int | None


class VideoStreamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stream_index: int
    codec: str | None
    profile: str | None
    width: int | None
    height: int | None
    pix_fmt: str | None
    color_space: str | None
    color_transfer: str | None
    color_primaries: str | None
    frame_rate: float | None
    bit_rate: int | None
    hdr_type: str | None


class AudioStreamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stream_index: int
    codec: str | None
    profile: str | None
    spatial_audio_profile: str | None
    channels: int | None
    channel_layout: str | None
    sample_rate: int | None
    bit_rate: int | None
    bit_depth: int | None = None
    bit_rate_mode: str | None = None
    compression_mode: str | None = None
    replay_gain: str | None = None
    replay_gain_peak: str | None = None
    writing_library: str | None = None
    md5_unencoded: str | None = None
    language: str | None
    default_flag: bool
    forced_flag: bool
    # Music-specific metadata
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    genre: str | None = None
    date: str | None = None
    disc: str | None = None
    composer: str | None = None


class SubtitleStreamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stream_index: int
    codec: str | None
    language: str | None
    default_flag: bool
    forced_flag: bool
    subtitle_type: str | None


class ExternalSubtitleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    path: str
    language: str | None
    format: str | None


class MediaFileTableRow(BaseModel):
    id: int
    library_id: int
    relative_path: str
    filename: str
    extension: str
    size_bytes: int
    mtime: float
    last_seen_at: UtcDateTime
    last_analyzed_at: UtcDateTime | None
    scan_status: ScanStatus
    quality_score: int
    quality_score_raw: float = 0.0
    container: str | None = None
    duration: float | None = None
    bitrate: float | None = None
    audio_bitrate: float | None = None
    video_codec: str | None = None
    resolution: str | None = None
    resolution_category_id: str | None = None
    resolution_category_label: str | None = None
    hdr_type: str | None = None
    audio_codecs: list[str] = Field(default_factory=list)
    audio_spatial_profiles: list[str] = Field(default_factory=list)
    audio_languages: list[str] = Field(default_factory=list)
    subtitle_languages: list[str] = Field(default_factory=list)
    subtitle_codecs: list[str] = Field(default_factory=list)
    subtitle_sources: list[str] = Field(default_factory=list)
    content_category: str = "main"
    series_id: int | None = None
    series_title: str | None = None
    season_id: int | None = None
    season_number: int | None = None
    episode_number: int | None = None
    episode_number_end: int | None = None
    episode_title: str | None = None


class MediaFileDetail(MediaFileTableRow):
    media_format: MediaFormatRead | None = None
    video_streams: list[VideoStreamRead]
    audio_streams: list[AudioStreamRead]
    subtitle_streams: list[SubtitleStreamRead]
    external_subtitles: list[ExternalSubtitleRead]
    raw_ffprobe_json: dict[str, Any] | None


class MediaFileStreamDetails(BaseModel):
    id: int
    video_streams: list[VideoStreamRead]
    audio_streams: list[AudioStreamRead]
    subtitle_streams: list[SubtitleStreamRead]
    external_subtitles: list[ExternalSubtitleRead]


class MediaFileTablePage(BaseModel):
    total: int | None
    offset: int
    limit: int
    next_cursor: str | None = None
    has_more: bool = False
    items: list[MediaFileTableRow]


class MediaFileQualityScoreDetail(BaseModel):
    id: int
    score: int
    score_raw: float
    breakdown: QualityBreakdownRead


class MediaFileHistoryEntryRead(BaseModel):
    id: int
    media_file_id: int | None
    library_id: int
    relative_path: str
    filename: str
    captured_at: UtcDateTime
    capture_reason: MediaFileHistoryCaptureReason
    snapshot_hash: str
    snapshot: dict[str, Any]


class MediaFileHistoryRead(BaseModel):
    file_id: int
    library_id: int
    relative_path: str
    total: int
    items: list[MediaFileHistoryEntryRead]


class MediaSeriesSummaryRead(BaseModel):
    id: int
    library_id: int
    title: str
    normalized_title: str
    relative_path: str
    year: int | None = None
    season_count: int = 0
    episode_count: int = 0
    total_size_bytes: int = 0
    total_duration_seconds: float = 0
    last_analyzed_at: UtcDateTime | None = None


class MediaSeasonDetailRead(BaseModel):
    id: int
    library_id: int
    series_id: int
    season_number: int
    title: str
    relative_path: str
    episode_count: int = 0
    total_size_bytes: int = 0
    total_duration_seconds: float = 0
    episodes: list[MediaFileTableRow] = Field(default_factory=list)


class MediaSeriesDetailRead(MediaSeriesSummaryRead):
    seasons: list[MediaSeasonDetailRead] = Field(default_factory=list)


class GroupedSeriesTableRowRead(BaseModel):
    kind: Literal["series"]
    series_id: int
    title: str
    relative_path: str
    year: int | None = None
    season_count: int = 0
    episode_count: int = 0
    total_size_bytes: int = 0
    total_duration_seconds: float = 0
    quality_score_average: float | None = None
    bitrate_average: float | None = None
    audio_bitrate_average: float | None = None
    children_loaded: bool = False


class GroupedLooseFileTableRowRead(BaseModel):
    kind: Literal["file"]
    file: MediaFileTableRow


GroupedMediaTableEntryRead = Annotated[
    GroupedSeriesTableRowRead | GroupedLooseFileTableRowRead,
    Field(discriminator="kind"),
]


class GroupedMediaTablePageRead(BaseModel):
    total: int | None
    offset: int
    limit: int
    next_cursor: str | None = None
    has_more: bool = False
    items: list[GroupedMediaTableEntryRead]


class MediaSeriesGroupedDetailRead(MediaSeriesSummaryRead):
    seasons: list[MediaSeasonDetailRead] = Field(default_factory=list)
    episodes_without_season: list[MediaFileTableRow] = Field(default_factory=list)


class DashboardResponse(BaseModel):
    totals: dict[str, int | float]
    container_distribution: list[DistributionItem]
    video_codec_distribution: list[DistributionItem]
    resolution_distribution: list[DistributionItem]
    hdr_distribution: list[DistributionItem]
    audio_codec_distribution: list[DistributionItem]
    audio_spatial_profile_distribution: list[DistributionItem]
    audio_language_distribution: list[DistributionItem]
    subtitle_distribution: list[DistributionItem]
    subtitle_codec_distribution: list[DistributionItem]
    subtitle_source_distribution: list[DistributionItem]
    numeric_distributions: dict[NumericDistributionMetricId, NumericDistribution]

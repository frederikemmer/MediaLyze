from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import ScanStatus


class DistributionItem(BaseModel):
    label: str
    value: int


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
    channels: int | None
    channel_layout: str | None
    sample_rate: int | None
    bit_rate: int | None
    language: str | None
    default_flag: bool
    forced_flag: bool


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
    last_seen_at: datetime
    last_analyzed_at: datetime | None
    scan_status: ScanStatus
    quality_score: int
    duration: float | None = None
    video_codec: str | None = None
    resolution: str | None = None
    hdr_type: str | None = None
    audio_codecs: list[str] = Field(default_factory=list)
    audio_languages: list[str] = Field(default_factory=list)
    subtitle_languages: list[str] = Field(default_factory=list)
    subtitle_codecs: list[str] = Field(default_factory=list)
    subtitle_sources: list[str] = Field(default_factory=list)


class MediaFileDetail(MediaFileTableRow):
    media_format: MediaFormatRead | None = None
    video_streams: list[VideoStreamRead]
    audio_streams: list[AudioStreamRead]
    subtitle_streams: list[SubtitleStreamRead]
    external_subtitles: list[ExternalSubtitleRead]
    raw_ffprobe_json: dict[str, Any] | None


class MediaFileTablePage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[MediaFileTableRow]


class DashboardResponse(BaseModel):
    totals: dict[str, int | float]
    video_codec_distribution: list[DistributionItem]
    resolution_distribution: list[DistributionItem]
    hdr_distribution: list[DistributionItem]
    audio_codec_distribution: list[DistributionItem]
    audio_language_distribution: list[DistributionItem]
    subtitle_distribution: list[DistributionItem]

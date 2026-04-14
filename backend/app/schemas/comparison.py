from typing import Literal

from pydantic import BaseModel


ComparisonFieldId = Literal[
    "size",
    "duration",
    "quality_score",
    "bitrate",
    "audio_bitrate",
    "resolution_mp",
    "container",
    "video_codec",
    "resolution",
    "hdr_type",
]

ComparisonFieldKind = Literal["numeric", "category"]
ComparisonRendererId = Literal["heatmap", "scatter", "bar"]


class ComparisonBucket(BaseModel):
    key: str
    label: str
    lower: float | None = None
    upper: float | None = None


class ComparisonHeatmapCell(BaseModel):
    x_key: str
    y_key: str
    count: int


class ComparisonScatterPoint(BaseModel):
    media_file_id: int
    x_value: float
    y_value: float


class ComparisonBarEntry(BaseModel):
    x_key: str
    x_label: str
    value: float
    count: int


class ComparisonResponse(BaseModel):
    x_field: ComparisonFieldId
    y_field: ComparisonFieldId
    x_field_kind: ComparisonFieldKind
    y_field_kind: ComparisonFieldKind
    available_renderers: list[ComparisonRendererId]
    total_files: int
    included_files: int
    excluded_files: int
    sampled_points: bool
    sample_limit: int
    x_buckets: list[ComparisonBucket]
    y_buckets: list[ComparisonBucket]
    heatmap_cells: list[ComparisonHeatmapCell]
    scatter_points: list[ComparisonScatterPoint] | None = None
    bar_entries: list[ComparisonBarEntry] | None = None

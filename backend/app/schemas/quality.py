from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class QualityCategoryConfig(BaseModel):
    weight: int = Field(default=0, ge=0, le=10)
    minimum: str | float
    ideal: str | float


class QualityLanguagePreferencesConfig(BaseModel):
    weight: int = Field(default=0, ge=0, le=10)
    mode: Literal["partial"] = "partial"
    audio_languages: list[str] = Field(default_factory=list)
    subtitle_languages: list[str] = Field(default_factory=list)


class QualityProfile(BaseModel):
    version: int = 1
    resolution: QualityCategoryConfig = Field(
        default_factory=lambda: QualityCategoryConfig(weight=8, minimum="1080p", ideal="4k")
    )
    visual_density: QualityCategoryConfig = Field(
        default_factory=lambda: QualityCategoryConfig(weight=10, minimum=0.02, ideal=0.04)
    )
    video_codec: QualityCategoryConfig = Field(
        default_factory=lambda: QualityCategoryConfig(weight=5, minimum="h264", ideal="hevc")
    )
    audio_channels: QualityCategoryConfig = Field(
        default_factory=lambda: QualityCategoryConfig(weight=4, minimum="stereo", ideal="5.1")
    )
    audio_codec: QualityCategoryConfig = Field(
        default_factory=lambda: QualityCategoryConfig(weight=3, minimum="aac", ideal="eac3")
    )
    dynamic_range: QualityCategoryConfig = Field(
        default_factory=lambda: QualityCategoryConfig(weight=4, minimum="sdr", ideal="hdr10")
    )
    language_preferences: QualityLanguagePreferencesConfig = Field(
        default_factory=lambda: QualityLanguagePreferencesConfig(weight=6, mode="partial")
    )


class QualityCategoryBreakdownRead(BaseModel):
    key: str
    score: float
    weight: int
    active: bool
    skipped: bool = False
    minimum: str | float | None = None
    ideal: str | float | None = None
    actual: str | float | list[str] | None = None
    unknown_mapping: bool = False
    notes: list[str] = Field(default_factory=list)


class QualityBreakdownRead(BaseModel):
    score: int
    score_raw: float
    categories: list[QualityCategoryBreakdownRead] = Field(default_factory=list)

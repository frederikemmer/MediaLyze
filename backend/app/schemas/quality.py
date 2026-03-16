from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class QualityCategoryConfig(BaseModel):
    weight: int = Field(default=0, ge=0, le=10)
    minimum: str | float
    ideal: str | float


class QualityNumericCategoryConfig(BaseModel):
    weight: int = Field(default=0, ge=0, le=10)
    minimum: float = Field(default=0.0, ge=0.0)
    ideal: float = Field(default=0.0, ge=0.0)
    maximum: float | None = Field(default=None, ge=0.0)

    @model_validator(mode="after")
    def validate_boundaries(self) -> "QualityNumericCategoryConfig":
        if self.maximum is None:
            self.maximum = self.ideal * 2 if self.ideal > 0 else self.ideal
        if self.ideal < self.minimum:
            raise ValueError("ideal must be greater than or equal to minimum")
        if self.maximum < self.ideal:
            raise ValueError("maximum must be greater than or equal to ideal")
        return self


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
    visual_density: QualityNumericCategoryConfig = Field(
        default_factory=lambda: QualityNumericCategoryConfig(weight=10, minimum=0.02, ideal=0.04, maximum=0.08)
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
    maximum: str | float | None = None
    actual: str | float | list[str] | None = None
    unknown_mapping: bool = False
    notes: list[str] = Field(default_factory=list)


class QualityBreakdownRead(BaseModel):
    score: int
    score_raw: float
    categories: list[QualityCategoryBreakdownRead] = Field(default_factory=list)

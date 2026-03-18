from pydantic import BaseModel, Field


class FeatureFlagsRead(BaseModel):
    show_dolby_vision_profiles: bool = False
    show_analyzed_files_csv_export: bool = False


class FeatureFlagsUpdate(BaseModel):
    show_dolby_vision_profiles: bool | None = None
    show_analyzed_files_csv_export: bool | None = None


class AppSettingsRead(BaseModel):
    ignore_patterns: list[str] = Field(default_factory=list)
    user_ignore_patterns: list[str] = Field(default_factory=list)
    default_ignore_patterns: list[str] = Field(default_factory=list)
    feature_flags: FeatureFlagsRead = Field(default_factory=FeatureFlagsRead)


class AppSettingsUpdate(BaseModel):
    ignore_patterns: list[str] | None = None
    user_ignore_patterns: list[str] | None = None
    default_ignore_patterns: list[str] | None = None
    feature_flags: FeatureFlagsUpdate | None = None

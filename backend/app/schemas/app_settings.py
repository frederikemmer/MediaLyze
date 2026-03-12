from pydantic import BaseModel, Field


class AppSettingsRead(BaseModel):
    ignore_patterns: list[str] = Field(default_factory=list)


class AppSettingsUpdate(BaseModel):
    ignore_patterns: list[str] | None = None

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MediaLyze"
    app_version: str = "0.2.1"
    app_port: int = 8080
    api_prefix: str = "/api"
    config_path: Path = Field(default=Path("/config"))
    media_root: Path = Field(default=Path("/media"))
    database_filename: str = "medialyze.db"
    ffprobe_path: str = "ffprobe"
    scan_discovery_batch_size: int = 500
    scan_commit_batch_size: int = 5
    ffprobe_worker_count: int = 4
    scan_runtime_worker_count: int = 4
    disable_default_ignore_patterns: bool = False
    allowed_media_extensions: tuple[str, ...] = (
        ".mkv",
        ".mp4",
        ".avi",
        ".mov",
        ".m4v",
        ".ts",
        ".m2ts",
        ".wmv",
    )
    subtitle_extensions: tuple[str, ...] = (".srt", ".ass", ".ssa", ".sub", ".idx")

    @property
    def database_path(self) -> Path:
        return self.config_path / self.database_filename


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.config_path.mkdir(parents=True, exist_ok=True)
    settings.media_root.mkdir(parents=True, exist_ok=True)
    return settings

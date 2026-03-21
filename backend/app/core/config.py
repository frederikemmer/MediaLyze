from functools import lru_cache
import os
from pathlib import Path
from enum import Enum

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RuntimeMode(str, Enum):
    server = "server"
    desktop = "desktop"


def _repo_frontend_dist_path() -> Path:
    return Path(__file__).resolve().parents[3] / "frontend" / "dist"


def _default_desktop_config_path() -> Path:
    home = Path.home()
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "MediaLyze"
        return home / "AppData" / "Roaming" / "MediaLyze"
    if os.uname().sysname == "Darwin":
        return home / "Library" / "Application Support" / "MediaLyze"
    xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config_home:
        return Path(xdg_config_home) / "MediaLyze"
    return home / ".config" / "MediaLyze"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "MediaLyze"
    app_version: str = "0.2.2"
    runtime_mode: RuntimeMode = Field(default=RuntimeMode.server, validation_alias="MEDIALYZE_RUNTIME")
    app_host: str | None = None
    app_port: int = 8080
    api_prefix: str = "/api"
    config_path: Path | None = None
    media_root: Path | None = None
    frontend_dist_path: Path | None = None
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

    @model_validator(mode="after")
    def apply_runtime_defaults(self) -> "Settings":
        if self.app_host is None:
            self.app_host = "127.0.0.1" if self.runtime_mode == RuntimeMode.desktop else "0.0.0.0"
        if self.config_path is None:
            if self.runtime_mode == RuntimeMode.desktop:
                self.config_path = _default_desktop_config_path()
            else:
                self.config_path = Path("/config")
        if self.media_root is None:
            self.media_root = Path("/media")
        if self.frontend_dist_path is None:
            self.frontend_dist_path = _repo_frontend_dist_path()
        return self

    @property
    def is_desktop(self) -> bool:
        return self.runtime_mode == RuntimeMode.desktop

    @property
    def database_path(self) -> Path:
        return self.config_path / self.database_filename


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.config_path.mkdir(parents=True, exist_ok=True)
    if settings.runtime_mode == RuntimeMode.server:
        settings.media_root.mkdir(parents=True, exist_ok=True)
    return settings

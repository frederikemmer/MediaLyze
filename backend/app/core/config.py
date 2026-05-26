from functools import lru_cache
from importlib import metadata
import os
from pathlib import Path
import re
import tomllib
from enum import Enum

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Media extension groups by type
VIDEO_EXTENSIONS = (
    ".mkv",
    ".mp4",
    ".avi",
    ".mov",
    ".m4v",
    ".ts",
    ".m2ts",
    ".wmv",
)

AUDIO_EXTENSIONS = (
    ".mp3",
    ".flac",
    ".m4b",
    ".m4a",
    ".aac",
    ".aa",
    ".aax",
    ".ogg",
    ".oga",
    ".opus",
    ".wav",
    ".wma",
    ".aiff",
    ".aif",
    ".alac",
    ".mka",
    ".ape",
)


class RuntimeMode(str, Enum):
    server = "server"
    desktop = "desktop"


APP_VERSION_FALLBACK = "0.0.0"
APP_VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


def _normalize_app_version(value: str | None) -> str | None:
    candidate = (value or "").strip()
    if not candidate or candidate == "dev":
        return None
    return candidate if APP_VERSION_PATTERN.fullmatch(candidate) else APP_VERSION_FALLBACK


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _build_version_file_path() -> Path:
    return _repo_root() / ".medialyze-version"


def _read_build_version_file() -> str | None:
    try:
        candidate = _build_version_file_path().read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return candidate if APP_VERSION_PATTERN.fullmatch(candidate) else APP_VERSION_FALLBACK


def _read_package_version() -> str | None:
    try:
        return _normalize_app_version(metadata.version("medialyze"))
    except metadata.PackageNotFoundError:
        return None


def _read_pyproject_version() -> str | None:
    try:
        payload = tomllib.loads((_repo_root() / "pyproject.toml").read_text(encoding="utf-8"))
        return _normalize_app_version(payload.get("project", {}).get("version"))
    except (OSError, tomllib.TOMLDecodeError):
        return None


def resolve_app_version() -> str:
    for candidate in (
        _read_build_version_file(),
        _normalize_app_version(os.environ.get("MEDIALYZE_APP_VERSION")),
        _read_pyproject_version(),
        _read_package_version(),
    ):
        if candidate:
            return candidate
    return APP_VERSION_FALLBACK


def _repo_frontend_dist_path() -> Path:
    return _repo_root() / "frontend" / "dist"


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
    app_version: str = Field(default_factory=resolve_app_version, validation_alias="MEDIALYZE_APP_VERSION")
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
    scan_runtime_worker_count: int = 2
    disable_default_ignore_patterns: bool = False
    telemetry_disabled: bool = Field(default=False, validation_alias="MEDIALYZE_TELEMETRY_DISABLED")
    telemetry_endpoint: str = Field(
        default="https://www.medialyze.app/api/telemetry/ingest",
        validation_alias="MEDIALYZE_TELEMETRY_ENDPOINT",
    )
    telemetry_timeout_seconds: float = 2.0
    allowed_media_extensions: tuple[str, ...] = VIDEO_EXTENSIONS
    subtitle_extensions: tuple[str, ...] = (".srt", ".ass", ".ssa", ".sub", ".idx")

    @model_validator(mode="after")
    def apply_runtime_defaults(self) -> "Settings":
        self.app_version = resolve_app_version()
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


def get_allowed_media_extensions(library_type: str) -> tuple[str, ...]:
    """Return allowed media extensions based on library type.
    
    Args:
        library_type: One of "movies", "series", "music", "audiobooks", "mixed", "other"
        
    Returns:
        Tuple of allowed file extensions for the library type
    """
    if library_type in ("music", "audiobooks"):
        return AUDIO_EXTENSIONS
    elif library_type in ("movies", "series"):
        return VIDEO_EXTENSIONS
    else:  # "mixed" or "other"
        return VIDEO_EXTENSIONS + AUDIO_EXTENSIONS

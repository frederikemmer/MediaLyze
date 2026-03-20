from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / ".github" / "scripts" / "release_metadata.py"
SPEC = importlib.util.spec_from_file_location("release_metadata", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
release_metadata = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_metadata)


def write_repo_files(
    repo_root: Path,
    *,
    docker_version: str = "0.1.1",
    pyproject_version: str = "0.1.1",
    frontend_version: str = "0.1.1",
    desktop_version: str = "0.1.1",
    changelog: str | None = None,
) -> None:
    (repo_root / "frontend").mkdir(parents=True, exist_ok=True)
    (repo_root / "desktop").mkdir(parents=True, exist_ok=True)

    (repo_root / "Dockerfile").write_text(
        "\n".join(
            [
                "FROM node:24-alpine AS frontend-build",
                "ARG APP_VERSION=dev",
                "FROM python:3.12-alpine AS runtime",
                f"ARG APP_VERSION={docker_version}",
            ]
        ),
        encoding="utf-8",
    )
    (repo_root / "pyproject.toml").write_text(
        "\n".join(
            [
                "[project]",
                'name = "medialyze"',
                f'version = "{pyproject_version}"',
            ]
        ),
        encoding="utf-8",
    )
    (repo_root / "frontend" / "package.json").write_text(
        '{\n  "name": "medialyze-frontend",\n'
        f'  "version": "{frontend_version}"\n'
        "}\n",
        encoding="utf-8",
    )
    (repo_root / "desktop" / "package.json").write_text(
        '{\n  "name": "medialyze-desktop",\n'
        f'  "version": "{desktop_version}"\n'
        "}\n",
        encoding="utf-8",
    )
    (repo_root / "CHANGELOG.md").write_text(
        changelog
        or "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- Pending changes.",
                "",
                "## [0.1.1] - 2026-03-13",
                "",
                "### Added",
                "",
                "- First release.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def test_validate_release_metadata_accepts_matching_versions(tmp_path: Path) -> None:
    write_repo_files(tmp_path)

    version = release_metadata.validate_release_metadata(tmp_path, "refs/tags/v0.1.1")

    assert version == "0.1.1"


def test_validate_release_metadata_rejects_version_mismatch(tmp_path: Path) -> None:
    write_repo_files(tmp_path, docker_version="0.1.0")

    with pytest.raises(release_metadata.ReleaseMetadataError, match="Version mismatch"):
        release_metadata.validate_release_metadata(tmp_path, None)


def test_release_notes_returns_requested_section(tmp_path: Path) -> None:
    write_repo_files(
        tmp_path,
        changelog="\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- Pending changes.",
                "",
                "## [0.1.1] - 2026-03-13",
                "",
                "### Fixed",
                "",
                "- Important bug fix.",
                "",
                "## [0.1.0] - 2026-03-01",
                "",
                "### Added",
                "",
                "- Older release.",
                "",
            ]
        ),
    )

    notes = release_metadata.extract_release_notes(tmp_path, "0.1.1")

    assert "Important bug fix." in notes
    assert "Older release." not in notes


def test_validate_release_metadata_accepts_v_prefixed_changelog_sections(tmp_path: Path) -> None:
    write_repo_files(
        tmp_path,
        changelog="\n".join(
            [
                "# Changelog",
                "",
                "## vUnreleased",
                "",
                "### New",
                "",
                "- Pending changes.",
                "",
                "## v0.1.1",
                "",
                ">2026-03-13",
                "",
                "### Fixed",
                "",
                "- Important bug fix.",
                "",
            ]
        ),
    )

    version = release_metadata.validate_release_metadata(tmp_path, "refs/tags/v0.1.1")
    notes = release_metadata.extract_release_notes(tmp_path, "0.1.1")

    assert version == "0.1.1"
    assert "Important bug fix." in notes
    assert ">2026-03-13" not in notes

#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
BRACKETED_CHANGELOG_HEADING_RE = re.compile(
    r"^## \[(?P<version>[^\]]+)\](?: - (?P<date>\d{4}-\d{2}-\d{2}))?\s*$"
)
V_PREFIX_CHANGELOG_HEADING_RE = re.compile(
    r"^## v(?P<version>Unreleased|(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))\s*$"
)
DATE_BLOCKQUOTE_RE = re.compile(r"^>\s*\d{4}-\d{2}-\d{2}\s*$")


class ReleaseMetadataError(Exception):
    pass


def repo_root_from(path: Path | None) -> Path:
    if path is not None:
        return path.resolve()
    return Path(__file__).resolve().parents[2]


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ReleaseMetadataError(f"Required file not found: {path}") from exc


def read_runtime_docker_version(repo_root: Path) -> str:
    dockerfile = repo_root / "Dockerfile"
    runtime_stage = False

    for raw_line in read_text(dockerfile).splitlines():
        line = raw_line.strip()
        if line.startswith("FROM "):
            runtime_stage = line.endswith(" AS runtime")
            continue
        if runtime_stage and line.startswith("ARG APP_VERSION="):
            return line.partition("=")[2].strip()

    raise ReleaseMetadataError(
        "Unable to find 'ARG APP_VERSION=...' in the runtime stage of Dockerfile."
    )


def read_pyproject_version(repo_root: Path) -> str:
    pyproject_path = repo_root / "pyproject.toml"
    try:
        data = tomllib.loads(read_text(pyproject_path))
    except tomllib.TOMLDecodeError as exc:
        raise ReleaseMetadataError(f"Invalid TOML in {pyproject_path}: {exc}") from exc

    try:
        return str(data["project"]["version"])
    except KeyError as exc:
        raise ReleaseMetadataError("Missing [project].version in pyproject.toml.") from exc


def read_frontend_version(repo_root: Path) -> str:
    package_json_path = repo_root / "frontend" / "package.json"
    try:
        data = json.loads(read_text(package_json_path))
    except json.JSONDecodeError as exc:
        raise ReleaseMetadataError(f"Invalid JSON in {package_json_path}: {exc}") from exc

    version = data.get("version")
    if not isinstance(version, str):
        raise ReleaseMetadataError("Missing string version in frontend/package.json.")
    return version


def read_desktop_version(repo_root: Path) -> str:
    package_json_path = repo_root / "desktop" / "package.json"
    try:
        data = json.loads(read_text(package_json_path))
    except json.JSONDecodeError as exc:
        raise ReleaseMetadataError(f"Invalid JSON in {package_json_path}: {exc}") from exc

    version = data.get("version")
    if not isinstance(version, str):
        raise ReleaseMetadataError("Missing string version in desktop/package.json.")
    return version


def read_versions(repo_root: Path) -> dict[str, str]:
    return {
        "Dockerfile": read_runtime_docker_version(repo_root),
        "pyproject.toml": read_pyproject_version(repo_root),
        "frontend/package.json": read_frontend_version(repo_root),
        "desktop/package.json": read_desktop_version(repo_root),
    }


def parse_changelog_sections(repo_root: Path) -> dict[str, str]:
    changelog_path = repo_root / "CHANGELOG.md"
    sections: dict[str, list[str]] = {}
    current_section: str | None = None

    for line in read_text(changelog_path).splitlines():
        match = BRACKETED_CHANGELOG_HEADING_RE.match(line) or V_PREFIX_CHANGELOG_HEADING_RE.match(
            line
        )
        if match:
            current_section = match.group("version")
            sections[current_section] = []
            continue

        if current_section is not None:
            sections[current_section].append(line)

    return {name: normalize_changelog_section(content) for name, content in sections.items()}


def normalize_changelog_section(content: list[str]) -> str:
    normalized = list(content)

    while normalized and not normalized[0].strip():
        normalized.pop(0)

    if normalized and DATE_BLOCKQUOTE_RE.fullmatch(normalized[0].strip()):
        normalized.pop(0)

    return "\n".join(normalized).strip()


def ensure_semver(version: str) -> None:
    if not SEMVER_RE.fullmatch(version):
        raise ReleaseMetadataError(
            f"Version '{version}' is not valid SemVer in the expected x.y.z format."
        )


def validate_versions_match(versions: dict[str, str]) -> str:
    distinct_versions = set(versions.values())
    if len(distinct_versions) != 1:
        details = ", ".join(f"{name}={value}" for name, value in versions.items())
        raise ReleaseMetadataError(f"Version mismatch detected across release files: {details}")
    version = next(iter(distinct_versions))
    ensure_semver(version)
    return version


def validate_changelog(version: str, changelog_sections: dict[str, str]) -> None:
    if "Unreleased" not in changelog_sections:
        raise ReleaseMetadataError("CHANGELOG.md must contain an Unreleased section.")

    if version not in changelog_sections:
        raise ReleaseMetadataError(
            f"CHANGELOG.md must contain a '[{version}] - YYYY-MM-DD' section."
        )

    if not changelog_sections[version]:
        raise ReleaseMetadataError(f"CHANGELOG.md section for version {version} must not be empty.")


def validate_tag_ref(version: str, tag_ref: str | None) -> None:
    if not tag_ref:
        return

    if not tag_ref.startswith("refs/tags/"):
        raise ReleaseMetadataError(
            f"Tag validation expected a refs/tags/* ref, received '{tag_ref}'."
        )

    expected_tag = f"v{version}"
    actual_tag = tag_ref.removeprefix("refs/tags/")
    if actual_tag != expected_tag:
        raise ReleaseMetadataError(
            f"Git tag '{actual_tag}' does not match release version '{expected_tag}'."
        )


def validate_release_metadata(repo_root: Path, tag_ref: str | None) -> str:
    version = validate_versions_match(read_versions(repo_root))
    validate_changelog(version, parse_changelog_sections(repo_root))
    validate_tag_ref(version, tag_ref)
    return version


def extract_release_notes(repo_root: Path, version: str) -> str:
    ensure_semver(version)
    changelog_sections = parse_changelog_sections(repo_root)
    validate_changelog(version, changelog_sections)
    return changelog_sections[version]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate and extract MediaLyze release metadata.")
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root. Defaults to the current repository.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("version", help="Print the canonical repository version.")

    validate_parser = subparsers.add_parser(
        "validate", help="Validate version alignment, changelog entries, and optional tag ref."
    )
    validate_parser.add_argument(
        "--tag-ref",
        help="A Git ref such as refs/tags/v0.1.1 to validate against the repository version.",
    )

    notes_parser = subparsers.add_parser(
        "release-notes", help="Print the changelog section for a release version."
    )
    notes_parser.add_argument(
        "--version",
        help="Release version in x.y.z form. Defaults to the current repository version.",
    )

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    repo_root = repo_root_from(args.repo_root)

    try:
        if args.command == "version":
            print(validate_versions_match(read_versions(repo_root)))
            return 0

        if args.command == "validate":
            print(validate_release_metadata(repo_root, getattr(args, "tag_ref", None)))
            return 0

        if args.command == "release-notes":
            version = args.version or validate_versions_match(read_versions(repo_root))
            print(extract_release_notes(repo_root, version))
            return 0
    except ReleaseMetadataError as exc:
        print(f"release metadata validation failed: {exc}", file=sys.stderr)
        return 1

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

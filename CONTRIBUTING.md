# Contributing

Start with the [documentation guide](docs/README.md) and read [AGENTS.md](AGENTS.md) for repository rules and source ownership. `dev` is the development branch; `main` is the stable/release branch.

## Development

Use Python 3.12, Node.js 22 (the desktop workflow version), and installed FFmpeg/ffprobe for media-related work. The Docker frontend build currently uses Node.js 24. Local setup and combined macOS/Linux/Windows launchers are described in the [repository README](README.md#local-development).

From the repository root, a local Docker build is available with:

```bash
cp docker/env.example .env
docker compose -f docker-compose-dev.yaml up --build
```

Review `.env` and the [environment guide](docs/environment.md) before starting; use a development configuration and media directory. For desktop packaging, follow [Build Desktop](docs/build_desktop.md).

## Expectations

- Keep modules focused and typed; reuse shared components and current visual patterns.
- Add or update meaningful tests for changed logic.
- Keep scan/analysis read-only for media. Explicit transcoding follows the validated output policy; replacement requires confirmation.
- Update the relevant [documentation references](docs/README.md#current-references) when behavior changes, and the documentation index when adding a guide.
- Update `/ui-elements` with frontend visual changes and every shipped locale with user-visible text changes.
- Add release-relevant changes under `CHANGELOG.md` `vUnreleased`.

## Validation

Run checks appropriate to the changed behavior, using isolated writable paths rather than production state:

```bash
# Backend; paths must be dedicated disposable test directories.
CONFIG_PATH=/tmp/medialyze-test-config MEDIA_ROOT=/tmp/medialyze-test-media .venv/bin/python -m pytest
# Frontend, from the repository root.
npm --prefix frontend test -- --run
npm --prefix frontend run build
git diff --check
```

For UI work, inspect the affected page or `/ui-elements` in light/dark themes and at narrow widths; see [Design QA](docs/design-qa.md). For release work, also follow [release-metadata validation](docs/github_actions.md#release-metadata-validation). Historical benchmark/test counts do not replace fresh checks.

## Pull Requests

Keep scope focused. Explain the user-visible result, relevant validation, and material limitations. Do not include secrets, production databases, or machine-specific artifacts. Preserve unrelated local changes.

## License

By contributing to MediaLyze, you agree that your contribution is submitted under the GNU Affero General Public License v3.0 (`AGPL-3.0`).

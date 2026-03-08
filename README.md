# MediaLyze

MediaLyze is a self-hosted media library analyzer for large video collections. It scans directories below `MEDIA_ROOT`, runs `ffprobe`, stores normalized metadata in SQLite, and exposes a React/FastAPI web UI for technical statistics and file inspection.

## Features

- FastAPI backend with normalized SQLAlchemy models for libraries, media files, formats, streams, subtitles, and scan jobs
- Incremental and full scans using `path + size + mtime`
- Defensive `ffprobe` normalization for video, audio, subtitle, HDR, and external subtitle detection
- SQLite with WAL enabled and indexed filter fields
- React + Vite frontend with dashboard, libraries, library detail, file detail, and restricted path browser below `MEDIA_ROOT`
- Dockerized single-container deployment serving API and static frontend from one process

## Repository layout

```text
backend/   FastAPI app, DB models, scanner, services
frontend/  React + Vite application
tests/     Python tests
alembic/   Migration scaffolding
docs/      Additional notes
docker/    Reserved for future container assets
```

## Local development

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn backend.app.main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8080`.

### One-command local start

For local development without rebuilding Docker images:

```bash
./scripts/local_start.sh
```

On Windows PowerShell:

```powershell
.\scripts\local_start.ps1
```

Both scripts create `.venv` if needed, install backend/frontend dependencies when manifests changed, and start:

- FastAPI on `http://127.0.0.1:8080`
- Vite on `http://127.0.0.1:5173`

If a project-level `.env` file exists, both scripts load variables from it first. Explicitly exported environment variables still win, and missing values fall back to the built-in defaults, including `TZ`.

## Environment

Relevant variables:

- `CONFIG_PATH`: writable config/data directory, default `/config`
- `MEDIA_ROOT`: media mount root, default `/media`
- `APP_PORT`: HTTP port, default `8080`
- `TZ`: optional process/container timezone like `Europe/Berlin`, default `UTC`
- `FFPROBE_PATH`: optional override for the `ffprobe` binary path

`MEDIA_ROOT` must be mounted read-only in production.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8080`.

### SMB / NAS shares

The preferred setup is to mount the SMB/CIFS share on the Docker host and then point `MEDIA_HOST_DIR` at that mount path.

If you want Docker to mount the share itself, use a named volume with the local driver:

```yaml
services:
  medialyze:
    volumes:
      - nas_share:/media:ro

volumes:
  nas_share:
    driver: local
    driver_opts:
      type: cifs
      o: "addr=my-nas,username=myuser,password=mypassword,vers=3.0,ro,file_mode=0444,dir_mode=0555"
      device: "//my-nas/share"
```

The raw example with only `username` and `password` often works, but adding `addr=` and `vers=` makes CIFS mounts much more predictable across Docker hosts.

## Current assumptions

- The first functional version stores the raw `ffprobe` JSON per file for diagnostics.
- Scheduled scans and watch mode can be configured per library in the detail view.
- Library creation requires an existing directory below `MEDIA_ROOT`.

## Open points

- How aggressive the quality score should be tuned beyond the current codec/resolution/HDR/audio heuristic
- Which scheduled scan UX and watch-mode controls should be exposed first
- Whether series-specific episode detection should persist dedicated episode metadata in v1 or remain derived

# Build Desktop

This guide covers local desktop packaging on the target OS.

Important:

- Build the macOS app on macOS.
- Build the Windows installer on Windows.
- The packaged desktop app expects a bundled `ffprobe` binary.
- The frontend bundle must exist before running the Electron packaging step.
- `npm run dist` and `npm run dist:dir` only work inside `desktop/`, because the repository root does not have a `package.json`.
- If you want to run the desktop build from the repository root, use `npm --prefix desktop run dist` or `npm --prefix desktop run dist:dir`.

## macOS

Prerequisites:

- Python 3.12
- Node.js 22
- `ffprobe` in `PATH`, for example via `brew install ffmpeg`

Build an unpacked `.app` bundle:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev] pyinstaller

cd frontend
npm ci
npm run build

cd ../desktop
npm ci

mkdir -p ../dist/ffprobe-bundle
cp "$(command -v ffprobe)" ../dist/ffprobe-bundle/ffprobe

MEDIALYZE_FFPROBE_DIR="$(cd ../dist/ffprobe-bundle && pwd)" npm run build:backend
npm run dist:dir
```

Output:

- unpacked app: `dist/desktop-app/mac-*/MediaLyze.app`

Build a release `.dmg` instead:

```bash
npm run dist
```

From the repository root, the equivalent command is:

```bash
npm --prefix desktop run dist
```

Additional output:

- installer: `dist/desktop-app/MediaLyze-arm64.dmg`

## Windows

Prerequisites:

- Python 3.12
- Node.js 22
- `ffprobe.exe` in `PATH`, for example via `choco install ffmpeg -y`

Build a release `.exe` installer in PowerShell:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .[dev] pyinstaller

cd frontend
npm ci
npm run build

cd ..\desktop
npm ci

New-Item -ItemType Directory -Force ..\dist\ffprobe-bundle | Out-Null
Copy-Item (Get-Command ffprobe).Source ..\dist\ffprobe-bundle\ffprobe.exe

$env:MEDIALYZE_FFPROBE_DIR = (Resolve-Path ..\dist\ffprobe-bundle).Path
npm run build:backend
npm run dist
```

Output:

- installer: `dist/desktop-app/MediaLyze.Setup.exe`

If you want the unpacked desktop app directory instead of the installer:

```powershell
npm run dist:dir
```

From the repository root, the equivalent commands are:

```powershell
npm --prefix desktop run dist
npm --prefix desktop run dist:dir
```

Typical output:

- unpacked app directory: `dist/desktop-app/win-unpacked/`

## Notes

- `npm run build:backend` creates the packaged Python sidecar in `dist/desktop-backend/`.
- `npm run dist:dir` creates an unpacked app.
- `npm run dist` creates the platform installer format configured in `desktop/package.json`.
- The desktop build also regenerates the native app icons from `frontend/public/favicon.svg`.
- GitHub release builds use the same packaging flow and attach the resulting desktop artifacts to the release automatically.

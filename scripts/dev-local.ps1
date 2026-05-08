$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VenvDir = if ($env:VENV_DIR) { $env:VENV_DIR } else { Join-Path $RootDir ".venv" }
$ConfigPath = if ($env:CONFIG_PATH) { $env:CONFIG_PATH } else { Join-Path $RootDir ".local-config" }
$MediaRoot = if ($env:MEDIA_ROOT) { $env:MEDIA_ROOT } else { Join-Path $HOME "Desktop" }
$BackendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }
$BackendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8080 }
$FrontendPort = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 5173 }
$BackendLog = if ($env:BACKEND_LOG) { $env:BACKEND_LOG } else { Join-Path $ConfigPath "dev-api.log" }
$BackendPidFile = if ($env:BACKEND_PID_FILE) { $env:BACKEND_PID_FILE } else { Join-Path $ConfigPath "dev-api.pid" }
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$ShellExe = (Get-Process -Id $PID).Path

New-Item -ItemType Directory -Force -Path $ConfigPath | Out-Null

if (-not (Test-Path $PythonExe -PathType Leaf)) {
    Write-Host "Python virtualenv not found at $VenvDir"
    Write-Host "Create it first, then rerun this script."
    exit 1
}

if (-not (Test-Path (Join-Path $RootDir "frontend\node_modules") -PathType Container)) {
    Write-Host "frontend/node_modules is missing."
    Write-Host "Run: npm --prefix frontend install"
    exit 1
}

if (-not (Test-Path $MediaRoot -PathType Container)) {
    Write-Host "MEDIA_ROOT does not exist: $MediaRoot"
    exit 1
}

$env:CONFIG_PATH = $ConfigPath
$env:MEDIA_ROOT = $MediaRoot

function Stop-Backend {
    if (Test-Path $BackendPidFile -PathType Leaf) {
        $existingPid = Get-Content $BackendPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existingPid) {
            $existingPid = $existingPid.Trim()
        }
        if ($existingPid) {
            try {
                $process = Get-Process -Id ([int]$existingPid) -ErrorAction Stop
                Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
            }
            catch {
            }
        }
        Remove-Item $BackendPidFile -Force -ErrorAction SilentlyContinue
    }

    try {
        $listenerPids = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    }
    catch {
        $listenerPids = @()
    }

    foreach ($listenerPid in $listenerPids) {
        if ($listenerPid) {
            Stop-Process -Id $listenerPid -ErrorAction SilentlyContinue
        }
    }

    if ($listenerPids.Count -gt 0) {
        Start-Sleep -Milliseconds 500
    }
}

try {
    Stop-Backend

    Write-Host "Starting backend on http://$BackendHost`:$BackendPort"
    Write-Host "Backend log: $BackendLog"

    $quotedRootDir = $RootDir.Replace("'", "''")
    $quotedPythonExe = $PythonExe.Replace("'", "''")
    $quotedBackendLog = $BackendLog.Replace("'", "''")
    $backendCommand = @"
Set-Location -LiteralPath '$quotedRootDir'
& '$quotedPythonExe' -m uvicorn backend.app.main:app --reload --host '$BackendHost' --port '$BackendPort' *> '$quotedBackendLog'
"@

    $backendProcess = Start-Process `
        -FilePath $ShellExe `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            $backendCommand
        ) `
        -WorkingDirectory $RootDir `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $BackendPidFile -Value $backendProcess.Id

    $backendReady = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if ($backendProcess.HasExited) {
            Write-Host "Backend exited during startup. Recent log output:"
            Get-Content $BackendLog -Tail 80 -ErrorAction SilentlyContinue
            exit 1
        }

        try {
            Invoke-WebRequest -Uri "http://$BackendHost`:$BackendPort/api/health" -UseBasicParsing | Out-Null
            $backendReady = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }

    if (-not $backendReady) {
        Write-Host "Backend did not become healthy in time. Recent log output:"
        Get-Content $BackendLog -Tail 80 -ErrorAction SilentlyContinue
        exit 1
    }

    Write-Host "Backend is ready."
    Write-Host "Starting frontend on http://127.0.0.1:$FrontendPort"

    Push-Location (Join-Path $RootDir "frontend")
    try {
        & npm.cmd run dev -- --port $FrontendPort
        exit $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    Stop-Backend
}

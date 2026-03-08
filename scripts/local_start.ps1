$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

function Import-DotEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $separatorIndex = $trimmed.IndexOf("=")
        if ($separatorIndex -lt 1) {
            continue
        }

        $name = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()

        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if (-not [string]::IsNullOrWhiteSpace($name) -and -not (Test-Path "Env:$name")) {
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

Import-DotEnv -Path (Join-Path $RootDir ".env")

$ConfigPath = if ($env:CONFIG_PATH) { $env:CONFIG_PATH } else { Join-Path $RootDir "config" }
$MediaRoot = if ($env:MEDIA_ROOT) { $env:MEDIA_ROOT } else { Join-Path $RootDir "media" }
$AppPort = if ($env:APP_PORT) { $env:APP_PORT } else { "8080" }
$VitePort = if ($env:VITE_PORT) { $env:VITE_PORT } else { "5173" }
$TimeZone = if ($env:TZ) { $env:TZ } else { "UTC" }
$VenvDir = Join-Path $RootDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$BackendStamp = Join-Path $VenvDir ".backend-deps.stamp"
$FrontendStamp = Join-Path $RootDir "frontend\.frontend-deps.stamp"

New-Item -ItemType Directory -Force -Path $ConfigPath | Out-Null
New-Item -ItemType Directory -Force -Path $MediaRoot | Out-Null

if (-not (Test-Path $PythonExe)) {
    py -3 -m venv $VenvDir
}

$NeedsBackendInstall = -not (Test-Path $BackendStamp) -or ((Get-Item (Join-Path $RootDir "pyproject.toml")).LastWriteTimeUtc -gt (Get-Item $BackendStamp).LastWriteTimeUtc)
if ($NeedsBackendInstall) {
    & $PythonExe -m pip install -U pip
    & $PythonExe -m pip install -e '.[dev]'
    New-Item -ItemType File -Force -Path $BackendStamp | Out-Null
}

$NeedsFrontendInstall = -not (Test-Path (Join-Path $RootDir "frontend\node_modules")) -or -not (Test-Path $FrontendStamp) -or ((Get-Item (Join-Path $RootDir "frontend\package.json")).LastWriteTimeUtc -gt (Get-Item $FrontendStamp).LastWriteTimeUtc)
if ($NeedsFrontendInstall) {
    Push-Location (Join-Path $RootDir "frontend")
    try {
        npm install
    } finally {
        Pop-Location
    }
    New-Item -ItemType File -Force -Path $FrontendStamp | Out-Null
}

$env:CONFIG_PATH = $ConfigPath
$env:MEDIA_ROOT = $MediaRoot
$env:APP_PORT = $AppPort
$env:TZ = $TimeZone

$BackendProcess = Start-Process -FilePath $PythonExe -ArgumentList @("-m", "uvicorn", "backend.app.main:app", "--reload", "--host", "127.0.0.1", "--port", $AppPort) -PassThru
$FrontendProcess = Start-Process -FilePath "npm" -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", $VitePort) -WorkingDirectory (Join-Path $RootDir "frontend") -PassThru

Write-Host "Backend:  http://127.0.0.1:$AppPort"
Write-Host "Frontend: http://127.0.0.1:$VitePort"
Write-Host "CONFIG_PATH=$ConfigPath"
Write-Host "MEDIA_ROOT=$MediaRoot"
Write-Host "TZ=$TimeZone"
Write-Host ".env loaded: $(Test-Path (Join-Path $RootDir '.env'))"
Write-Host "Press Ctrl+C to stop both processes."

try {
    while (-not $BackendProcess.HasExited -and -not $FrontendProcess.HasExited) {
        Start-Sleep -Seconds 1
        $BackendProcess.Refresh()
        $FrontendProcess.Refresh()
    }
} finally {
    if (-not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force
    }
    if (-not $FrontendProcess.HasExited) {
        Stop-Process -Id $FrontendProcess.Id -Force
    }
}

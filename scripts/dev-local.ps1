$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VenvDir = if ($env:VENV_DIR) { $env:VENV_DIR } else { Join-Path $RootDir ".venv" }
$ConfigPath = if ($env:CONFIG_PATH) { $env:CONFIG_PATH } else { Join-Path $RootDir ".local-config" }
$MediaRoot = if ($env:MEDIA_ROOT) { $env:MEDIA_ROOT } else { Join-Path $HOME "Desktop" }
$BackendHost = if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "0.0.0.0" }
$BackendPort = if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8080 }
$FrontendHost = if ($env:FRONTEND_HOST) { $env:FRONTEND_HOST } else { "0.0.0.0" }
$FrontendPort = if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 5173 }
$BackendLog = if ($env:BACKEND_LOG) { $env:BACKEND_LOG } else { Join-Path $ConfigPath "dev-api.log" }
$FrontendLog = if ($env:FRONTEND_LOG) { $env:FRONTEND_LOG } else { Join-Path $ConfigPath "dev-vite.log" }
$FrontendErrorLog = if ($env:FRONTEND_ERROR_LOG) { $env:FRONTEND_ERROR_LOG } else { Join-Path $ConfigPath "dev-vite-error.log" }
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
$env:BACKEND_HOST = $BackendHost
$env:BACKEND_PORT = [string]$BackendPort
$env:APP_HOST = $BackendHost
$env:APP_PORT = [string]$BackendPort

function Get-AccessHosts([string]$BindHost) {
    if ($BindHost -ne "0.0.0.0") {
        return @($BindHost)
    }

    $addresses = @("127.0.0.1", [System.Net.Dns]::GetHostName())
    try {
        $addresses += [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).HostName
    }
    catch {
    }
    $addresses += @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.AddressState -eq "Preferred" -and $_.IPAddress -notmatch '^(127\.|169\.254\.|0\.)' } |
        Select-Object -ExpandProperty IPAddress)
    return @($addresses | Sort-Object -Unique)
}

$HealthHost = if ($BackendHost -eq "0.0.0.0") { "127.0.0.1" } else { $BackendHost }
$FrontendHealthHost = if ($FrontendHost -eq "0.0.0.0") { "127.0.0.1" } else { $FrontendHost }
$frontendProcess = $null

function Stop-Backend([switch]$ClearPreviousListener) {
    if (Test-Path $BackendPidFile -PathType Leaf) {
        $existingPid = Get-Content $BackendPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existingPid) {
            $existingPid = $existingPid.Trim()
        }
        if ($existingPid) {
            try {
                $descendants = @()
                # The reload parent may have exited while its worker still owns sockets.
                $pendingParents = @([int]$existingPid)
                $processTable = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
                while ($pendingParents.Count -gt 0) {
                    $parentId = $pendingParents[0]
                    $pendingParents = @($pendingParents | Select-Object -Skip 1)
                    $children = @($processTable | Where-Object { $_.ParentProcessId -eq $parentId })
                    $descendants += $children
                    $pendingParents += @($children | Select-Object -ExpandProperty ProcessId)
                }
                Stop-Process -Id ([int]$existingPid) -ErrorAction SilentlyContinue
                foreach ($child in $descendants) {
                    Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
                }
                Start-Sleep -Milliseconds 500
            }
            catch {
            }
        }
        Remove-Item $BackendPidFile -Force -ErrorAction SilentlyContinue
    }

    if (-not $ClearPreviousListener) { return }

    try {
        $listenerPids = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    }
    catch {
        $listenerPids = @()
    }

    foreach ($listenerPid in $listenerPids) {
        if ($listenerPid) {
            # Windows can report the dead reload parent's PID for inherited sockets.
            # Capture its workers before terminating the parent.
            $processTable = @(Get-CimInstance Win32_Process -ErrorAction Stop)
            $owner = $processTable | Where-Object { $_.ProcessId -eq $listenerPid }
            $workers = @($processTable | Where-Object {
                $_.ParentProcessId -eq $listenerPid -and
                $_.Name -match '^python(w)?\.exe$' -and
                $_.CommandLine -like "*spawn_main(parent_pid=$listenerPid,*"
            })
            if ($owner -and $owner.CommandLine -notlike '*uvicorn backend.app.main:app*') {
                throw "Backend port $BackendPort is occupied by process $listenerPid. Stop it or set BACKEND_PORT."
            }
            Stop-Process -Id $listenerPid -ErrorAction SilentlyContinue
            foreach ($worker in $workers) {
                Stop-Process -Id $worker.ProcessId -ErrorAction SilentlyContinue
            }
        }
    }

    if ($listenerPids.Count -gt 0) {
        Start-Sleep -Milliseconds 500
    }
    if (Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue) {
        throw "Backend port $BackendPort is still occupied. No new backend was started."
    }
}

try {
    Stop-Backend -ClearPreviousListener

    $quotedRootDir = $RootDir.Replace("'", "''")
    $quotedPythonExe = $PythonExe.Replace("'", "''")
    $quotedBackendLog = $BackendLog.Replace("'", "''")
    $backendCommand = @"
Set-Location -LiteralPath '$quotedRootDir'
& '$quotedPythonExe' -m uvicorn backend.app.main:app --reload --host '$BackendHost' --port '$BackendPort' --log-level error --no-access-log *> '$quotedBackendLog'
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
            Invoke-WebRequest -Uri "http://$HealthHost`:$BackendPort/api/health" -UseBasicParsing | Out-Null
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

    $viteScript = Join-Path $RootDir "frontend\node_modules\vite\bin\vite.js"
    $viteArguments = @("`"$viteScript`"", "--host", $FrontendHost, "--port", [string]$FrontendPort, "--strictPort", "--logLevel", "error")
    $frontendProcess = Start-Process `
        -FilePath (Get-Command node.exe).Source `
        -ArgumentList $viteArguments `
        -WorkingDirectory (Join-Path $RootDir "frontend") `
        -RedirectStandardOutput $FrontendLog `
        -RedirectStandardError $FrontendErrorLog `
        -WindowStyle Hidden `
        -PassThru

    $frontendReady = $false
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        if ($frontendProcess.HasExited) {
            Write-Host "Frontend exited during startup. Recent log output:"
            Get-Content $FrontendErrorLog -Tail 80 -ErrorAction SilentlyContinue
            Get-Content $FrontendLog -Tail 80 -ErrorAction SilentlyContinue
            exit 1
        }
        try {
            Invoke-WebRequest -Uri "http://$FrontendHealthHost`:$FrontendPort/" -UseBasicParsing | Out-Null
            $frontendReady = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $frontendReady) {
        Write-Host "Frontend did not become ready in time. Recent log output:"
        Get-Content $FrontendErrorLog -Tail 80 -ErrorAction SilentlyContinue
        Get-Content $FrontendLog -Tail 80 -ErrorAction SilentlyContinue
        exit 1
    }

    Write-Host "Everything is ready. Open one of these URLs:"
    foreach ($accessHost in (Get-AccessHosts $FrontendHost)) {
        Write-Host "  http://${accessHost}:$FrontendPort/"
    }
    $seenErrorLines = 0
    $seenBackendLines = 0
    while (-not $frontendProcess.HasExited) {
        $backendLines = @(Get-Content $BackendLog -ErrorAction SilentlyContinue)
        if ($backendLines.Count -gt $seenBackendLines) {
            $backendLines[$seenBackendLines..($backendLines.Count - 1)] | ForEach-Object { Write-Host $_ }
            $seenBackendLines = $backendLines.Count
        }
        $errorLines = @(Get-Content $FrontendErrorLog -ErrorAction SilentlyContinue)
        if ($errorLines.Count -gt $seenErrorLines) {
            $errorLines[$seenErrorLines..($errorLines.Count - 1)] | ForEach-Object { Write-Host $_ }
            $seenErrorLines = $errorLines.Count
        }
        Start-Sleep -Seconds 1
    }
    $frontendProcess.Refresh()
    if ($frontendProcess.ExitCode -ne 0) {
        Write-Host "Frontend exited with code $($frontendProcess.ExitCode). Recent log output:"
        if ($seenErrorLines -eq 0) {
            Get-Content $FrontendErrorLog -Tail 80 -ErrorAction SilentlyContinue
        }
        Get-Content $FrontendLog -Tail 80 -ErrorAction SilentlyContinue
        exit $frontendProcess.ExitCode
    }
}
finally {
    if ($frontendProcess -and -not $frontendProcess.HasExited) {
        Stop-Process -Id $frontendProcess.Id -ErrorAction SilentlyContinue
    }
    Stop-Backend
}

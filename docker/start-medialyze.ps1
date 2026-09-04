$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$composeFile = if ($env:MEDIALYZE_COMPOSE_FILE) {
    $env:MEDIALYZE_COMPOSE_FILE
} else {
    Join-Path $scriptDir "docker-compose.yaml"
}
$overrideFile = Join-Path ([System.IO.Path]::GetTempPath()) ("medialyze-compose-{0}.yaml" -f [guid]::NewGuid())
$composeArgs = @($args)
Push-Location $projectDir

try {
    $nvidiaAvailable = $false
    $nvidiaCommand = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($null -ne $nvidiaCommand) {
        try {
            & $nvidiaCommand.Source -L *> $null
            $nvidiaAvailable = $LASTEXITCODE -eq 0
        } catch {
            $nvidiaAvailable = $false
        }
    }
    $dockerReady = $false
    try {
        & docker info *> $null
        $dockerReady = $LASTEXITCODE -eq 0
    } catch {
        $dockerReady = $false
    }

    $overrideLines = @("services:", "  medialyze:")
    if ($nvidiaAvailable -and $dockerReady) {
        $overrideLines += "    gpus: all"
    }
    if ($overrideLines.Count -gt 2 -or (Test-Path -LiteralPath "/dev/dri")) {
        if (Test-Path -LiteralPath "/dev/dri") {
            $overrideLines += "    devices:"
            $overrideLines += "      - /dev/dri:/dev/dri"
            $groupIds = [System.Collections.Generic.List[string]]::new()
            $driDevices = Get-ChildItem -LiteralPath "/dev/dri" -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like "renderD*" -or $_.Name -like "card*" }
            foreach ($driDevice in $driDevices) {
                $gid = $null
                try {
                    $gid = (& stat -c "%g" -- $driDevice.FullName 2>$null).Trim()
                } catch {
                    try {
                        $gid = (& stat -f "%g" -- $driDevice.FullName 2>$null).Trim()
                    } catch {
                        $gid = $null
                    }
                }
                if ($gid -and $gid -match "^\d+$" -and -not $groupIds.Contains($gid)) {
                    $groupIds.Add($gid)
                }
            }
            if ($groupIds.Count -gt 0) {
                $overrideLines += "    group_add:"
                foreach ($gid in $groupIds) {
                    $overrideLines += "      - `"$gid`""
                }
            }
        }
        Set-Content -LiteralPath $overrideFile -Value $overrideLines -Encoding utf8
        & docker compose -f $composeFile -f $overrideFile up -d @composeArgs
    } else {
        & docker compose -f $composeFile up -d @composeArgs
    }
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
} finally {
    Remove-Item -LiteralPath $overrideFile -Force -ErrorAction SilentlyContinue
    Pop-Location
}

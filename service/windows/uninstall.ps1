param(
    [switch]$Purge        # also delete config.json, session files, status and log
)

# clock-out (Windows) uninstall: stop the service, remove the Startup shortcut. Data stays unless -Purge.

[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'lib\schedule.ps1')
$paths = Get-ClockOutPaths

# 1. stop: the service exits on its next tick (≤ 30 s) when it sees service.stop; wait up to 40 s, then kill
$running = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'service\.ps1' -and $_.CommandLine -notmatch '-Once|install\.ps1|uninstall\.ps1' })
if ($running.Count -gt 0) {
    Set-Content -Path (Join-Path $paths.Root 'service.stop') -Value (Get-Date).ToString('o') -Encoding UTF8
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and @($running | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }).Count -gt 0) { Start-Sleep -Seconds 2 }
    foreach ($p in $running) { if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; "service  killed pid $($p.ProcessId)" } else { "service  stopped pid $($p.ProcessId)" } }
    Remove-Item (Join-Path $paths.Root 'service.stop') -ErrorAction SilentlyContinue
} else {
    'service  not running'
}

# 2. shortcut
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'clock-out.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force; "startup shortcut  removed" } else { "startup shortcut  none" }

# 3. data
if ($Purge) {
    Remove-Item $paths.Root -Recurse -Force -ErrorAction SilentlyContinue
    "data    removed  $($paths.Root)"
} else {
    "data    kept     $($paths.Root)  (use -Purge to delete)"
}

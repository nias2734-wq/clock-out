param(
    [switch]$NoStart      # register only; do not start the service now
)

# clock-out (Windows) install: config.json with defaults, a Startup shortcut, and the service running.
# Safe to run again: existing config is kept, the shortcut is rewritten, a running service is left alone.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File "<plugin root>\service\windows\install.ps1"

[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'lib\schedule.ps1')
$paths = Get-ClockOutPaths
New-Item -ItemType Directory -Force $paths.Root, $paths.SessionsDir, $paths.StatusDir | Out-Null

# 1. config.json
if (-not (Test-Path $paths.ConfigFile)) {
    (Get-ServiceDefaults | ConvertTo-Json) | Out-File -FilePath $paths.ConfigFile -Encoding utf8
    "config  created  $($paths.ConfigFile)"
} else {
    "config  kept     $($paths.ConfigFile)"
}

# 2. Startup shortcut → service.vbs (starts service.ps1 without a console window)
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'clock-out.lnk'
$vbs = Join-Path $PSScriptRoot 'service.vbs'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$sc.Arguments = '"' + $vbs + '"'
$sc.WorkingDirectory = $PSScriptRoot
$sc.Description = 'clock-out: keeps Claude Code CronCreate sessions alive'
$sc.Save()
"startup shortcut  $lnk"

# 3. start now
$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'service\.ps1' -and $_.CommandLine -notmatch '-Once|install\.ps1' }
if ($running) {
    "service  already running (pid $($running.ProcessId -join ', '))"
} elseif ($NoStart) {
    "service  not started (-NoStart). Start: wscript.exe `"$vbs`""
} else {
    Start-Process (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList ('"' + $vbs + '"') -WorkingDirectory $PSScriptRoot
    Start-Sleep -Seconds 3
    $started = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'service\.ps1' -and $_.CommandLine -notmatch '-Once|install\.ps1' }
    if ($started) { "service  started (pid $($started.ProcessId -join ', '))" } else { "service  did not start; run by hand: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\service.ps1`"" }
}
"log     $($paths.LogFile)"
''
'Check:  powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'service.ps1') + '" -Once'
'Remove: powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'uninstall.ps1') + '"'

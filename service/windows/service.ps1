param(
    [switch]$Once,        # print the sessions and jobs the service sees, then exit
    [switch]$Reload,      # set by the service itself when it restarts after a code change
    [switch]$Stop         # ask a running service to exit
)

# clock-out — the part that runs outside Claude Code (Windows).
#
# A CronCreate job fires only while its session runs. The plugin module records every session's jobs in
# <configDir>\clock-out\sessions\<sessionId>.json; this service reads those files and wakes a stopped
# session with `claude --bg --resume` (lib\revive.ps1) when
#   - its next job is within reviveLeadMinutes (default 10),
#   - a recurring job of it expires within expiryLeadHours (default 24), or
#   - the clock passes expandAt (default 17:55, weekdays) — once a day, every stopped session with jobs.
# It has no window. Settings: <configDir>\clock-out\config.json (written by the plugin from /config).
# Log: <configDir>\clock-out\service.log. Install: install.ps1 (startup shortcut), remove: uninstall.ps1.
#
# Run by hand:  powershell -NoProfile -ExecutionPolicy Bypass -File service.ps1 -Once

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'lib\schedule.ps1')
. (Join-Path $PSScriptRoot 'lib\sessions.ps1')
. (Join-Path $PSScriptRoot 'lib\revive.ps1')

$script:Paths = Get-ClockOutPaths
New-Item -ItemType Directory -Force $script:Paths.SessionsDir, $script:Paths.StatusDir | Out-Null
$script:Config = Read-ServiceConfig $script:Paths.ConfigFile
$script:StopFile = Join-Path $script:Paths.Root 'service.stop'    # uninstall.ps1 / -Stop create it; the service exits on seeing it

if ($Stop) {
    Set-Content -Path $script:StopFile -Value (Get-Date).ToString('o') -Encoding UTF8
    'asked the service to stop'
    exit 0
}

if ($Once) {
    $now = Get-Date
    "clock-out  config $($script:Paths.ConfigFile)  dryRun=$($script:Config.dryRun)"
    $sessions = Get-ClockOutSessions $script:Paths $now
    if ($sessions.Count -eq 0) { '(no session with live jobs)' }
    foreach ($s in $sessions) {
        Format-ClockOutSession $s $now
        if (-not $s.Alive) {
            $why = Get-SessionReopenReason $s $now $script:Config
            if ($why -ne '') { "    → would wake now: $why" }
        }
    }
    exit 0
}

# ---- single instance -------------------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
$created = $false
$mutexName = 'ClockOutService_' + ($script:Paths.Root.ToLowerInvariant() -replace '[\\/:]', '_')
$script:Mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created -and $Reload) {
    try { $created = $script:Mutex.WaitOne(15000) } catch [System.Threading.AbandonedMutexException] { $created = $true }
}
if (-not $created) { Write-ServiceLog 'START refused: another service is running'; exit 0 }
Remove-Item $script:StopFile -ErrorAction SilentlyContinue
Write-ServiceLog "START pid=$PID dryRun=$($script:Config.dryRun) expandAt=$($script:Config.expandAt) weekdaysOnly=$($script:Config.weekdaysOnly)"

# ---- state ------------------------------------------------------------------------------------------------
$script:OpenedAt = @{}          # sessionId → last wake time; the same session is not woken again within 30 minutes
$script:DailyDate = $null       # 'yyyy-MM-dd' of the last expandAt sweep
$script:ConfigStamp = (Get-Item $script:Paths.ConfigFile -ErrorAction SilentlyContinue).LastWriteTime
$script:CodeFiles = @('service.ps1', 'lib\schedule.ps1', 'lib\sessions.ps1', 'lib\revive.ps1') | ForEach-Object { Join-Path $PSScriptRoot $_ }
$script:CodeStamp = ($script:CodeFiles | ForEach-Object { (Get-Item $_ -ErrorAction SilentlyContinue).LastWriteTime.Ticks }) -join ','
$script:Reloading = $false
$script:Summary = ''            # last list signature, to log only changes

function Update-Config {
    $stamp = (Get-Item $script:Paths.ConfigFile -ErrorAction SilentlyContinue).LastWriteTime
    if ($stamp -ne $script:ConfigStamp) {
        $script:ConfigStamp = $stamp
        $script:Config = Read-ServiceConfig $script:Paths.ConfigFile
        Write-ServiceLog "CONFIG reloaded dryRun=$($script:Config.dryRun) expandAt=$($script:Config.expandAt)"
    }
}

# Wake a stopped session if it has a reason; honours the 30-minute guard and dry run
function Invoke-WakeIfDue([pscustomobject]$s, [datetime]$now, [string]$forcedReason) {
    if ($s.Alive) { return $false }
    $why = $forcedReason
    if ($why -eq '') { $why = Get-SessionReopenReason $s $now $script:Config }
    if ($why -eq '') { return $false }
    if ($script:OpenedAt.ContainsKey($s.SessionId) -and ($now - $script:OpenedAt[$s.SessionId]).TotalMinutes -lt 30) { return $false }
    $script:OpenedAt[$s.SessionId] = $now
    [void](Invoke-Revive $s $why -DryRun:([bool]$script:Config.dryRun))
    return $true
}

function Invoke-Tick {
    if (Test-Path $script:StopFile) { Write-ServiceLog 'STOP requested'; $script:Form.Close(); return }
    # 1. code changed → restart with the new code
    $stamp = ($script:CodeFiles | ForEach-Object { (Get-Item $_ -ErrorAction SilentlyContinue).LastWriteTime.Ticks }) -join ','
    if ($stamp -ne $script:CodeStamp) { Write-ServiceLog 'RELOAD code changed'; $script:Reloading = $true; $script:Form.Close(); return }
    Update-Config
    $now = Get-Date
    $sessions = Get-ClockOutSessions $script:Paths $now
    # 2. log the list when it changes
    $sig = ($sessions | ForEach-Object { "$($_.ShortId):$($_.Alive):" + (($_.Jobs | ForEach-Object { $_.Id }) -join ',') }) -join ';'
    if ($sig -ne $script:Summary) { $script:Summary = $sig; Write-ServiceLog "LIST $sig" }
    # 3. due or expiring → wake
    foreach ($s in $sessions) { [void](Invoke-WakeIfDue $s $now '') }
    # 4. daily sweep at expandAt
    $today = $now.ToString('yyyy-MM-dd')
    if ($script:DailyDate -eq $today) { return }
    if ($script:Config.weekdaysOnly -and ($now.DayOfWeek -eq 'Saturday' -or $now.DayOfWeek -eq 'Sunday')) { return }
    try { $at = [TimeSpan]::Parse([string]$script:Config.expandAt) } catch { return }   # "17:55"; a bad value disables the sweep
    if ($now.TimeOfDay -lt $at) { return }
    $script:DailyDate = $today
    $n = 0
    foreach ($s in $sessions) { if (Invoke-WakeIfDue $s $now "daily sweep $($script:Config.expandAt)") { $n++ } }
    Write-ServiceLog "DAILY $($script:Config.expandAt): woke $n stopped session(s)"
}

# ---- message loop: a hidden form carries the timers and the watcher's callbacks --------------------------
$script:Form = New-Object System.Windows.Forms.Form
$script:Form.ShowInTaskbar = $false
$script:Form.WindowState = 'Minimized'
$script:Form.FormBorderStyle = 'FixedToolWindow'
$script:Form.Opacity = 0
$script:Form.Text = 'clock-out'

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 30000
$timer.Add_Tick({ try { Invoke-Tick } catch { Write-ServiceLog "TICK error $($_.Exception.Message)" } })

# A session file or the stamp changed (a job was created/deleted, a session started/ended): recompute 2 s later
$watcher = New-Object System.IO.FileSystemWatcher($script:Paths.SessionsDir)
$watcher.NotifyFilter = [System.IO.NotifyFilters]'LastWrite, FileName'
$watcher.SynchronizingObject = $script:Form
$debounce = New-Object System.Windows.Forms.Timer
$debounce.Interval = 2000
$debounce.Add_Tick({ $debounce.Stop(); try { Invoke-Tick } catch { Write-ServiceLog "WATCH error $($_.Exception.Message)" } })
$onChange = { $debounce.Stop(); $debounce.Start() }
$watcher.Add_Changed($onChange)
$watcher.Add_Created($onChange)
$watcher.Add_Deleted($onChange)
$watcher.EnableRaisingEvents = $true

$script:Form.Add_Shown({ $script:Form.Hide(); $timer.Start(); try { Invoke-Tick } catch { Write-ServiceLog "TICK error $($_.Exception.Message)" } })
[System.Windows.Forms.Application]::Run($script:Form)

$watcher.EnableRaisingEvents = $false
$timer.Stop()
Write-ServiceLog "EXIT pid=$PID reloading=$($script:Reloading)"
if ($script:Reloading) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -STA -File `"$PSCommandPath`" -Reload"
}
$script:Mutex.ReleaseMutex()

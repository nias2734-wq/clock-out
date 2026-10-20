# clock-out (Windows): session files → what to revive, and when.
# Dot-sourced by service.ps1, install.ps1 and uninstall.ps1. No side effects at load time.

$script:HeartbeatStaleMs = 3 * 60 * 1000     # a module heartbeat older than this means the module (and likely the session) is gone
$script:Epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)

function Get-ClaudeConfigDir {
    if ($env:CLAUDE_CONFIG_DIR) { return $env:CLAUDE_CONFIG_DIR }
    return (Join-Path $env:USERPROFILE '.claude')
}

# Folders the plugin module and the service share (same rule as hooks/paths.ts)
function Get-ClockOutPaths {
    $configDir = Get-ClaudeConfigDir
    $root = Join-Path $configDir 'clock-out'
    return [pscustomobject]@{
        ConfigDir       = $configDir
        Root            = $root
        ConfigFile      = Join-Path $root 'config.json'
        SessionsDir     = Join-Path $root 'sessions'
        StampFile       = Join-Path $root 'sessions\_stamp'
        StatusDir       = Join-Path $root 'status'
        LogFile         = Join-Path $root 'service.log'
        LiveSessionsDir = Join-Path $configDir 'sessions'      # Claude Code's <pid>.json per running session
    }
}

function ConvertFrom-EpochMs([object]$ms) {
    if ($null -eq $ms -or $ms -eq '') { return $null }
    return $script:Epoch.AddMilliseconds([double]$ms).ToLocalTime()
}

function ConvertTo-EpochMs([datetime]$when) {
    return [long](($when.ToUniversalTime() - $script:Epoch).TotalMilliseconds)
}

# Defaults the plugin's userConfig declares; config.json overrides them
function Get-ServiceDefaults {
    return [ordered]@{
        usageWidget          = $false
        alignPing            = $false
        expandAt             = '17:55'
        weekdaysOnly         = $true
        reviveLeadMinutes    = 10
        expiryLeadHours      = 24
        legacyTranscriptScan = $false
        dryRun               = $false     # log what would be revived, start nothing
        managedByPlugin      = $true      # the plugin module rewrites the fields above from /config; set false to edit by hand
    }
}

function Read-ServiceConfig([string]$path) {
    $cfg = Get-ServiceDefaults
    if (Test-Path $path) {
        try {
            $saved = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($p in $saved.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
        } catch { }
    }
    return [pscustomobject]$cfg
}

# One session file → the same view the plugin's /clock-out shows. $null when unreadable or no live jobs
function Read-ClockOutSession([string]$path, [datetime]$now, [hashtable]$liveIds) {
    try { $f = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    if ($null -eq $f -or $f.version -ne 1 -or -not $f.sessionId) { return $null }
    $jobs = @()
    foreach ($j in @($f.jobs)) {
        if ($null -ne $j.deletedAt -or $null -ne $j.goneAt -or $null -ne $j.firedAt) { continue }
        $next = ConvertFrom-EpochMs $j.nextFireAt
        if ($null -eq $next) { $next = Get-CronNext ([string]$j.cron) $now }
        $expires = ConvertFrom-EpochMs $j.expiresAt
        $jobs += [pscustomobject]@{
            Id = [string]$j.id; Cron = [string]$j.cron; Prompt = [string]$j.prompt; Recurring = [bool]$j.recurring
            HumanSchedule = $(if ($j.humanSchedule) { [string]$j.humanSchedule } else { [string]$j.cron })
            Next = $next; ExpiresAt = $expires; Dismissed = (@($f.dismissed) -contains [string]$j.id)
        }
    }
    if ($jobs.Count -eq 0) { return $null }
    $heartbeat = ConvertFrom-EpochMs $f.heartbeatAt
    $fresh = ($f.alive -eq $true) -and ($null -ne $heartbeat) -and (($now - $heartbeat).TotalMilliseconds -lt $script:HeartbeatStaleMs)
    $alive = $fresh -or $liveIds.ContainsKey([string]$f.sessionId)
    $active = @($jobs | Where-Object { -not $_.Dismissed })
    $nextAt = $null
    foreach ($j in $active) { if ($null -ne $j.Next -and ($null -eq $nextAt -or $j.Next -lt $nextAt)) { $nextAt = $j.Next } }
    return [pscustomobject]@{
        SessionId = [string]$f.sessionId; ShortId = ([string]$f.sessionId).Substring(0, 8)
        Cwd = [string]$f.cwd; Label = (Split-Path ([string]$f.cwd) -Leaf)
        Kind = $f.kind; Alive = $alive; BgSince = $f.bgSince; Next = $nextAt; Jobs = $jobs; Path = $path
    }
}

# Every session with live jobs, earliest next run first
function Get-ClockOutSessions([pscustomobject]$paths, [datetime]$now) {
    $liveIds = Get-LiveSessionIds $paths.LiveSessionsDir
    $list = @()
    foreach ($file in Get-ChildItem (Join-Path $paths.SessionsDir '*.json') -ErrorAction SilentlyContinue) {
        $s = Read-ClockOutSession $file.FullName $now $liveIds
        if ($null -ne $s) { $list += $s }
    }
    return @($list | Sort-Object { if ($null -eq $_.Next) { [datetime]::MaxValue } else { $_.Next } })
}

# Why a stopped session should be woken now; '' when it should not
function Get-SessionReopenReason([pscustomobject]$s, [datetime]$now, [pscustomobject]$cfg) {
    if ($null -ne $s.Next -and ($s.Next - $now).TotalMinutes -le [double]$cfg.reviveLeadMinutes) {
        return "next job at $($s.Next.ToString('HH:mm'))"
    }
    foreach ($j in @($s.Jobs | Where-Object { -not $_.Dismissed })) {
        if ($j.Recurring -and $null -ne $j.ExpiresAt -and ($j.ExpiresAt - $now).TotalHours -le [double]$cfg.expiryLeadHours) {
            return "recurring job $($j.Id) expires $($j.ExpiresAt.ToString('MM-dd HH:mm'))"
        }
    }
    return ''
}

# The first message a woken session gets (same wording as hooks/revive.ts reviveMessage)
function Get-ReviveMessage([pscustomobject]$s) {
    $lines = @()
    $i = 0
    foreach ($j in @($s.Jobs | Where-Object { -not $_.Dismissed })) {
        $i++
        $kind = 'one-shot'
        if ($j.Recurring) { $kind = 'recurring' }
        $lines += "$i. cron `"$($j.Cron)`" ($kind) prompt: $($j.Prompt)"
    }
    return ('clock-out woke this session so its scheduled jobs keep firing. Call CronList first. ' +
        'Jobs below that are missing: CronCreate them again with the same cron and prompt. ' +
        'A recurring job that expires within a day: CronDelete it and CronCreate it again. ' +
        "Do nothing else, report in one line, then stop. Keep this session running.`n" + ($lines -join "`n"))
}

function Format-ClockOutSession([pscustomobject]$s, [datetime]$now) {
    $state = 'stopped'
    if ($s.Alive) { $state = 'running' }
    $next = '-'
    if ($null -ne $s.Next) { $next = $s.Next.ToString('MM-dd HH:mm') }
    $out = @("$($s.Label) · $($s.ShortId)  $state  $($s.Jobs.Count) job(s)  next $next  $($s.Cwd)")
    foreach ($j in $s.Jobs) {
        $n = '-'
        if ($null -ne $j.Next) { $n = $j.Next.ToString('MM-dd HH:mm') }
        $tail = ''
        if ($j.Recurring -and $null -ne $j.ExpiresAt -and ($j.ExpiresAt - $now).TotalDays -le 2) { $tail += " · expires in $([Math]::Max(0, [Math]::Ceiling(($j.ExpiresAt - $now).TotalDays)))d" }
        if ($j.Dismissed) { $tail += ' · hidden' }
        $p = $j.Prompt -replace '\s+', ' '
        if ($p.Length -gt 60) { $p = $p.Substring(0, 60) + '…' }
        $out += "  - [$($j.Id)] $($j.HumanSchedule) · next $n$tail | $p"
    }
    return $out
}

# ---- cron (fallback when a job has no nextFireAt) ----------------------------------------------------------

function ConvertFrom-CronField([string]$text, [int]$min, [int]$max) {
    $set = @{}
    foreach ($part in $text.Split(',')) {
        $m = [regex]::Match($part.Trim(), '^(\*|\d+(?:-\d+)?)(?:/(\d+))?$')
        if (-not $m.Success) { return $null }
        $step = 1
        if ($m.Groups[2].Value -ne '') { $step = [int]$m.Groups[2].Value }
        $lo = $min; $hi = $max
        if ($m.Groups[1].Value -ne '*') {
            $r = $m.Groups[1].Value.Split('-')
            $lo = [int]$r[0]
            if ($r.Count -gt 1) { $hi = [int]$r[1] } elseif ($m.Groups[2].Value -eq '') { $hi = $lo }
        }
        if ($lo -lt $min -or $hi -gt $max -or $lo -gt $hi -or $step -lt 1) { return $null }
        for ($v = $lo; $v -le $hi; $v += $step) { $set[$v] = $true }
    }
    return $set
}

function Get-CronNext([string]$cron, [datetime]$from) {
    $f = $cron.Trim() -split '\s+'
    if ($f.Count -ne 5) { return $null }
    $minute = ConvertFrom-CronField $f[0] 0 59
    $hour = ConvertFrom-CronField $f[1] 0 23
    $dom = ConvertFrom-CronField $f[2] 1 31
    $month = ConvertFrom-CronField $f[3] 1 12
    $dow = ConvertFrom-CronField ($f[4] -replace '\b7\b', '0') 0 6
    if ($null -eq $minute -or $null -eq $hour -or $null -eq $dom -or $null -eq $month -or $null -eq $dow) { return $null }
    $start = $from.AddSeconds(-$from.Second).AddMilliseconds(-$from.Millisecond).AddMinutes(1)
    $hours = @($hour.Keys | Sort-Object)
    $minutes = @($minute.Keys | Sort-Object)
    for ($day = 0; $day -le 366; $day++) {
        $d = $start.Date.AddDays($day)
        if (-not $month.ContainsKey($d.Month)) { continue }
        $domOk = $dom.ContainsKey($d.Day); $dowOk = $dow.ContainsKey([int]$d.DayOfWeek)
        $dayOk = $true
        if ($f[2] -ne '*' -and $f[4] -ne '*') { $dayOk = $domOk -or $dowOk }
        elseif ($f[2] -ne '*') { $dayOk = $domOk }
        elseif ($f[4] -ne '*') { $dayOk = $dowOk }
        if (-not $dayOk) { continue }
        foreach ($h in $hours) { foreach ($m in $minutes) {
            $t = $d.AddHours($h).AddMinutes($m)
            if ($t -ge $start) { return $t }
        } }
    }
    return $null
}

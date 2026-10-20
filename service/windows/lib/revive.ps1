# clock-out (Windows): wake a stopped session in the background.
# Same rules as hooks/revive.ts: flags only on the first background start (bgSince unset and not listed by
# `claude agents --all`), a copy started by stray flags is stopped, bgSince is written to the session file.

function Write-ServiceLog([string]$line) {
    try {
        $paths = Get-ClockOutPaths
        New-Item -ItemType Directory -Force $paths.Root | Out-Null
        Add-Content -Path $paths.LogFile -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $line) -Encoding UTF8
    } catch { }
}

# Runs claude and returns @{ ExitCode; Output } with stdout and stderr joined (stderr lines unwrapped, not as ErrorRecords)
function Invoke-Claude([string[]]$arguments, [string]$cwd) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'claude'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    if ($cwd -and (Test-Path $cwd)) { $psi.WorkingDirectory = $cwd }
    # Windows argument quoting: wrap each argument, escape inner quotes as \"
    $psi.Arguments = ($arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(90000)) { try { $p.Kill() } catch { }; return @{ ExitCode = -1; Output = 'timeout' } }
    return @{ ExitCode = $p.ExitCode; Output = ($out.Result + "`n" + $err.Result) }
}

# Wakes $s (a Get-ClockOutSessions item). Returns a one-line outcome. With -DryRun logs the command and starts nothing
function Invoke-Revive([pscustomobject]$s, [string]$reason, [switch]$DryRun) {
    $wasBg = ($null -ne $s.BgSince) -or (Test-WasBackground $s.SessionId)
    $args = @('--bg', '--resume', $s.SessionId)
    if (-not $wasBg) { $args += '--dangerously-skip-permissions' }
    $args += (Get-ReviveMessage $s)
    if ($DryRun) {
        Write-ServiceLog "DRYRUN $($s.ShortId) would run: claude $(($args | Select-Object -First 4) -join ' ') ""<message>""  ($reason)"
        return "$($s.ShortId): dry run"
    }
    $ran = Invoke-Claude $args $s.Cwd
    if ($ran.ExitCode -ne 0) {
        Write-ServiceLog "REVIVE $($s.ShortId) failed exit=$($ran.ExitCode) $($ran.Output -replace '\s+', ' ')"
        return "$($s.ShortId): failed (exit $($ran.ExitCode))"
    }
    $note = ''
    $m = [regex]::Match($ran.Output, 'started a copy as (\w+)')
    if ($m.Success) {
        $copy = $m.Groups[1].Value
        $stopped = Invoke-Claude @('stop', $copy) $null
        $note = " copy $copy stopped(exit=$($stopped.ExitCode))"
    }
    # bgSince on the (stopped) session's file: the woken session's own module keeps writing it afterwards
    try {
        $f = Get-Content $s.Path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -eq $f.bgSince) {
            $f | Add-Member -NotePropertyName bgSince -NotePropertyValue (ConvertTo-EpochMs (Get-Date)) -Force
            ($f | ConvertTo-Json -Depth 8) | Out-File -FilePath $s.Path -Encoding utf8
        }
    } catch { }
    Write-ServiceLog "REVIVE $($s.ShortId) woken ($reason)$note"
    return "$($s.ShortId): woken$note"
}

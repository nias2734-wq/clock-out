# clock-out (Windows): which Claude Code sessions are running right now.
# Claude Code writes <configDir>\sessions\<pid>.json for each running session { pid, sessionId, kind, name, ... }.

# sessionId → record, for records whose process is alive
function Get-LiveSessionIds([string]$dir) {
    $ids = @{}
    foreach ($f in Get-ChildItem (Join-Path $dir '*.json') -ErrorAction SilentlyContinue) {
        try { $j = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
        if (-not $j.sessionId) { continue }
        if ($j.pid -and (Get-Process -Id $j.pid -ErrorAction SilentlyContinue)) { $ids[[string]$j.sessionId] = $j }
    }
    return $ids
}

# Whether `claude agents --json --all` lists the session as a (past or present) background session.
# Not reliable for a few seconds after `claude stop`; the session file's bgSince is checked first.
function Test-WasBackground([string]$sessionId) {
    try {
        $json = & claude agents --json --all 2>$null | Out-String
        $list = $json | ConvertFrom-Json
        foreach ($s in @($list)) { if ($s.sessionId -eq $sessionId -and $s.kind -eq 'background') { return $true } }
    } catch { }
    return $false
}

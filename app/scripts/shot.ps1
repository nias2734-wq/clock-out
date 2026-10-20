# Dev check: start the built app, capture the onboarding dialog and the status bar, then stop it.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\shot.ps1   (run from app\, after `npm run build`)
param([string]$OutDir = (Join-Path $PSScriptRoot '..\shots'))
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Shot -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder t, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
public struct RECT { public int Left, Top, Right, Bottom; }
public delegate bool EnumProc(IntPtr h, IntPtr l);
public static System.Collections.Generic.List<IntPtr> ByPids(System.Collections.Generic.HashSet<uint> pids, string title) {
    var list = new System.Collections.Generic.List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var sb = new System.Text.StringBuilder(128); GetWindowText(h, sb, 128);
        if (pids.Contains(p) && IsWindowVisible(h) && sb.ToString().Contains(title)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
}
'@
New-Item -ItemType Directory -Force $OutDir | Out-Null
$app = Resolve-Path (Join-Path $PSScriptRoot '..')
$p = Start-Process -FilePath 'npx.cmd' -ArgumentList 'electron', '.' -WorkingDirectory $app -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
# only this app's electron (VS Code and Claude Desktop are electron.exe too)
function Pids { $set = New-Object 'System.Collections.Generic.HashSet[uint32]'; Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -like '*clock-out*node_modules*' } | ForEach-Object { [void]$set.Add([uint32]$_.ProcessId) }; return $set }
function Snap([IntPtr]$h, [string]$name) {
    [void][Shot.Win]::SetForegroundWindow($h); Start-Sleep -Milliseconds 500   # CopyFromScreen sees whatever is on top
    $r = New-Object Shot.Win+RECT; [void][Shot.Win]::GetWindowRect($h, [ref]$r)
    $w = [Math]::Max(1, $r.Right - $r.Left); $hh = [Math]::Max(1, $r.Bottom - $r.Top)
    $bmp = New-Object System.Drawing.Bitmap $w, $hh; $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $hh)); $g.Dispose()
    $path = Join-Path $OutDir $name; $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    "shot $name ${w}x${hh} at $($r.Left),$($r.Top)"
}
$wins = [Shot.Win]::ByPids((Pids), 'clock-out')
"windows: $($wins.Count)"
if ($wins.Count -gt 0) { Snap $wins[0] 'a-1-onboarding.png'; [void][Shot.Win]::SetForegroundWindow($wins[0]); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
Start-Sleep -Seconds 7
$wins = [Shot.Win]::ByPids((Pids), 'clock-out')
"windows after: $($wins.Count)"
foreach ($w in $wins) { Snap $w 'a-2-statusbar.png' }
Get-Content (Join-Path $env:USERPROFILE '.claude\clock-out\app.log') -Tail 5 -ErrorAction SilentlyContinue | ForEach-Object { "  log: $_" }
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -like '*clock-out*node_modules*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"stopped"

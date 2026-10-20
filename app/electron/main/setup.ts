import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { app } from 'electron'

import type { SetupCheck, SetupFix } from '@shared/types'

import { log } from './log'
import { paths } from './paths'

// The user guide's checklist: is everything this app relies on in place, and the one-click fixes.
// Every check only reads; a fix runs only when the person presses its button.

const STARTUP_DIR = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const LEGACY_SHORTCUTS = ['Claude 사용량 위젯.lnk', 'clock-out.lnk']   // v1 widget, the PowerShell service of the plugin
const RECENT_MS = 10 * 60 * 1000

function run(file: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  return new Promise(res => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1
      const out = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
      // a missing executable prints nothing (spawn claude ENOENT): show the error itself, or the fix result reads "failed: "
      res({ code, out: out === '' && err !== null ? err.message : out })
    })
  })
}

// The plugin shipped with the app: <resources>/plugin when installed, the repository root in development
export function bundledPluginDir(): string {
  const packaged = join(process.resourcesPath, 'plugin')
  if (app.isPackaged && existsSync(join(packaged, '.claude-plugin', 'plugin.json'))) return packaged
  return resolve(app.getAppPath(), '..')
}

type PluginEntry = { id: string; version?: string; scope?: string; enabled?: boolean; installPath?: string; errors?: string[] }   // errors: why it does not load, e.g. 'Marketplace clock-out failed to load: cache-miss'

async function installedPlugin(): Promise<PluginEntry | undefined> {
  const ran = await run('claude', ['plugin', 'list', '--json'])
  if (ran.code !== 0) return undefined
  try {
    const start = ran.out.indexOf('[')
    const list = JSON.parse(ran.out.slice(start)) as PluginEntry[]
    return list.find(p => p.id.startsWith('clock-out@'))
  } catch { return undefined }
}

function recentSessionFiles(): { count: number; newest?: number } {
  let count = 0; let newest: number | undefined
  try {
    for (const name of readdirSync(paths.sessionsDir)) {
      if (!name.endsWith('.json')) continue
      const m = statSync(join(paths.sessionsDir, name)).mtimeMs
      newest = newest === undefined ? m : Math.max(newest, m)
      if (Date.now() - m < RECENT_MS) count++
    }
  } catch { /* none yet */ }
  return { count, newest }
}

// Sleep and hibernate timeouts of the active power plan while plugged in (AC), in seconds; 0 = never.
// powercfg prints min, max, increment, then the AC and DC values as hex: the AC value is the second to last.
async function acTimeout(setting: 'STANDBYIDLE' | 'HIBERNATEIDLE'): Promise<number | undefined> {
  const ran = await run('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', setting], 15_000)
  const hex = ran.out.match(/0x[0-9a-fA-F]+/g)
  if (ran.code !== 0 || hex === null || hex.length < 2) return undefined
  return parseInt(hex[hex.length - 2] as string, 16)
}

function minutes(sec: number): string {
  return sec === 0 ? 'never' : `${Math.round(sec / 60)} min`
}

async function legacyWidgetPids(): Promise<number[]> {
  const ran = await run('powershell.exe', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'claude-usage-widget\\.ps1|service\\.ps1' -and $_.CommandLine -notmatch '-Once' } | ForEach-Object { $_.ProcessId }"], 30_000)
  return ran.out.split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0)
}

export async function checkSetup(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = []

  // 1. Claude Code itself
  const version = await run('claude', ['--version'], 20_000)
  checks.push(version.code === 0
    ? { key: 'cli', state: 'ok', detail: version.out.split('\n')[0] ?? '' }
    : { key: 'cli', state: 'error', detail: 'claude not found on PATH', fix: 'openDownload' })

  // 2. Logged in (the usage bar and every revived session need it)
  let loggedIn = false
  try { loggedIn = Boolean((JSON.parse(readFileSync(paths.credentials, 'utf8')) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken) } catch { /* no file */ }
  checks.push(loggedIn ? { key: 'login', state: 'ok', detail: paths.credentials } : { key: 'login', state: 'error', detail: 'no login token', fix: 'openLogin' })

  // 3. The plugin: installed (user scope), or loaded from a development folder (CLAUDE_CODE_PLUGIN_DIRS)
  if (version.code === 0) {
    const p = await installedPlugin()
    if (p === undefined) checks.push({ key: 'plugin', state: 'error', detail: 'not installed', fix: 'installPlugin' })
    // still listed but not loaded, e.g. its marketplace folder (the app's resources\plugin) was removed
    else if (p.errors !== undefined && p.errors.length > 0) checks.push({ key: 'plugin', state: 'error', detail: `${p.id}: ${p.errors[0]}`, fix: 'installPlugin' })
    else if (p.id.endsWith('@inline')) checks.push({ key: 'plugin', state: 'ok', detail: `dev folder ${p.installPath ?? ''} (v${p.version ?? '?'})`, note: 'dev' })
    else if (p.enabled === false) checks.push({ key: 'plugin', state: 'warn', detail: `${p.id} v${p.version ?? '?'} is disabled`, fix: 'enablePlugin' })
    else checks.push({ key: 'plugin', state: 'ok', detail: `${p.id} v${p.version ?? '?'} (${p.scope ?? 'user'})` })
  } else {
    checks.push({ key: 'plugin', state: 'unknown', detail: 'needs Claude Code' })
  }

  // 4. Sessions report in (the plugin writes a session file and refreshes it every minute)
  const recent = recentSessionFiles()
  checks.push(recent.count > 0
    ? { key: 'records', state: 'ok', detail: `${recent.count}` }
    : { key: 'records', state: 'warn', detail: recent.newest === undefined ? 'none yet' : new Date(recent.newest).toLocaleString() })

  // 5. The PC stays awake (a sleeping PC cannot wake a session at the job time)
  const standby = await acTimeout('STANDBYIDLE')
  const hibernate = await acTimeout('HIBERNATEIDLE')
  if (standby === undefined || hibernate === undefined) checks.push({ key: 'sleep', state: 'unknown', detail: 'powercfg could not be read' })
  else if (standby === 0 && hibernate === 0) checks.push({ key: 'sleep', state: 'ok', detail: 'AC: sleep never, hibernate never' })
  else checks.push({ key: 'sleep', state: 'warn', detail: `AC: sleep ${minutes(standby)}, hibernate ${minutes(hibernate)}`, fix: 'disableSleep' })

  // 6. Windows Terminal, for "Open session"
  const wt = await run('where.exe', ['wt'], 10_000)
  checks.push(wt.code === 0 ? { key: 'terminal', state: 'ok', detail: wt.out.split('\n')[0] ?? '' } : { key: 'terminal', state: 'warn', detail: 'wt.exe not found; Attach opens a console window instead', fix: 'openTerminalStore' })

  // 7. Nothing else wakes the same sessions (the v1 widget, the plugin's PowerShell service)
  const shortcuts = LEGACY_SHORTCUTS.filter(n => existsSync(join(STARTUP_DIR, n)))
  const pids = await legacyWidgetPids()
  checks.push(shortcuts.length === 0 && pids.length === 0
    ? { key: 'conflict', state: 'ok', detail: '' }
    : { key: 'conflict', state: 'warn', detail: [...shortcuts, ...pids.map(p => `pid ${p}`)].join(', '), fix: 'disableLegacy' })

  return checks
}

export async function runFix(fix: SetupFix): Promise<{ ok: boolean; message: string }> {
  log(`FIX ${fix}`)
  if (fix === 'installPlugin') {
    const dir = bundledPluginDir()
    const ran = await run('claude', ['plugin', 'install', 'clock-out', '--marketplace', dir, '--scope', 'user', '-y'], 180_000)
    log(`FIX installPlugin exit=${ran.code} ${ran.out.replace(/\s+/g, ' ').slice(0, 300)}`)
    return { ok: ran.code === 0, message: ran.code === 0 ? 'installed' : ran.out.slice(0, 400) }
  }
  if (fix === 'disableSleep') {
    // the same as Settings > System > Power > "When plugged in, put my device to sleep after: Never"; no admin needed
    const a = await run('powercfg.exe', ['/change', 'standby-timeout-ac', '0'], 15_000)
    const b = await run('powercfg.exe', ['/change', 'hibernate-timeout-ac', '0'], 15_000)
    const ok = a.code === 0 && b.code === 0
    return { ok, message: ok ? 'sleep and hibernate set to never (plugged in)' : `${a.out} ${b.out}`.trim().slice(0, 300) }
  }
  if (fix === 'enablePlugin') {
    const p = await installedPlugin()
    if (p === undefined) return { ok: false, message: 'not installed' }
    const ran = await run('claude', ['plugin', 'enable', p.id], 60_000)
    return { ok: ran.code === 0, message: ran.out.slice(0, 400) }
  }
  if (fix === 'disableLegacy') {
    const removed: string[] = []
    for (const n of LEGACY_SHORTCUTS) {
      const p = join(STARTUP_DIR, n)
      if (existsSync(p)) { try { unlinkSync(p); removed.push(n) } catch { /* in use */ } }
    }
    // taskkill without /F asks the window to close, so the widget saves its position and exits cleanly
    for (const pid of await legacyWidgetPids()) { await run('taskkill.exe', ['/PID', String(pid)], 15_000); removed.push(`pid ${pid}`) }
    return { ok: true, message: removed.join(', ') || 'nothing to stop' }
  }
  return { ok: false, message: `unknown fix ${fix}` }
}

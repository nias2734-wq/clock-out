import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Notification } from 'electron'

import { copyIdIn, permissionRecord, reviveArgs } from '@shared/revive'
import { wasBackgroundIn } from '@shared/runMode'
import type { SessionFile, SessionView } from '@shared/schedule'
import type { AppSessionState } from '@shared/types'

import { patchSession, sessionState } from './appState'
import { log } from './log'
import { paths } from './paths'
import { getSettings } from './settings'

// Wakes stopped sessions with `claude --bg --resume <id>` (one attempt; wake.ts holds the lock, retries and the scheduler).
// Measured rules (see the plugin's revive.ts): flags only on the first background start; a copy started by
// stray flags is stopped at once; `claude agents --json --all` may miss a session for seconds after `claude stop`.

const RUN_TIMEOUT_MS = 90_000

type Listener = (text: string, kind: 'info' | 'warn') => void
const listeners = new Set<Listener>()
export function onNotice(l: Listener): () => void { listeners.add(l); return () => listeners.delete(l) }
// desktop false: the log and the open windows' toast only, no Windows notice (routine work such as the automatic cleanup)
export function notice(text: string, kind: 'info' | 'warn' = 'info', desktop = true): void {
  log(`${kind === 'warn' ? 'WARN' : 'NOTICE'} ${text}`)
  for (const l of listeners) l(text, kind)
  if (!desktop) return
  try { new Notification({ title: 'clock-out', body: text }).show() } catch { /* no notification support */ }
}

export function runClaude(args: string[], cwd: string | undefined): Promise<{ code: number; output: string }> {
  return new Promise(resolve => {
    execFile('claude', args, { cwd: cwd !== undefined && cwd !== '' ? cwd : undefined, windowsHide: true, timeout: RUN_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err === null ? 0 : typeof (err as NodeJS.ErrnoException & { code?: number | string }).code === 'number' ? Number((err as { code?: number }).code) : 1
      resolve({ code, output: `${stdout}\n${stderr}${err !== null && stdout === '' && stderr === '' ? `\n${err.message}` : ''}` })
    })
  })
}

export async function wasBackgroundBefore(sessionId: string): Promise<boolean> {
  const ran = await runClaude(['agents', '--json', '--all'], undefined)
  return ran.code === 0 && wasBackgroundIn(ran.output, sessionId)   // the CLI prints the array over many lines
}

export function readFile(sessionId: string): SessionFile | undefined {
  try { return JSON.parse(readFileSync(join(paths.sessionsDir, `${sessionId}.json`), 'utf8').replace(/^﻿/, '')) as SessionFile } catch { return undefined }
}

export type ReviveResult = { ok: boolean; message: string }
// One attempt: ok, or the failure with claude's output (wake.ts decides from it whether to try again)
export type AttemptResult = ReviveResult & { output?: string; code?: number }

// One `claude --bg --resume` attempt; wake.ts adds the per-session lock, the retries and the attempt records.
// message: the first message (an instruction forwarded from the remote jobs session), else the fixed check message.
// forceRemote: attach Remote Control on this first background start (open_remote from the remote jobs session).
export async function reviveOnce(s: SessionView, reason: string, opts: { message?: string; forceRemote?: boolean } = {}): Promise<AttemptResult> {
  const settings = getSettings()
  if (s.warnings.length > 0) return { ok: false, message: `${s.shortId} is not trusted: ${s.warnings.join(', ')}` }
  const file = readFile(s.sessionId)
  const app = sessionState(s.sessionId)
  // ran in the background before (then it has saved options and flags would start a copy): woken by clock-out (app-state,
  // or the session file before 0.13), recorded by its own plugin at start, or listed by `claude agents` (which misses it
  // for a few seconds after a stop)
  const wasBg = file?.bgSince !== undefined || app.bgSince !== undefined || file?.kind === 'background' || (await wasBackgroundBefore(s.sessionId))
  const withRemote = !wasBg && opts.forceRemote === true
  const args = reviveArgs(s.sessionId, wasBg, settings.permission, withRemote ? `clock-out · ${s.label}` : undefined, opts.message)
  if (settings.revive.dryRun) {
    const shown = args.slice(0, -1).join(' ')
    log(`DRYRUN ${s.shortId} would run: claude ${shown} "<message>" (${reason})`)
    return { ok: true, message: `[dry run] ${s.shortId}: claude ${shown}` }
  }
  const ran = await runClaude(args, s.cwd)
  if (ran.code !== 0) {
    log(`WAKE ${s.shortId} failed (exit ${ran.code}) ${ran.output.trim().slice(0, 160)}`)
    return { ok: false, message: `${s.shortId}: claude failed (exit ${ran.code})`, output: ran.output, code: ran.code }
  }
  let note = ''
  let flagsTook = !wasBg
  const copy = copyIdIn(ran.output)
  if (copy !== undefined) {
    flagsTook = false
    const stopped = await runClaude(['stop', copy], undefined)
    // a stopped copy still sits in `claude agents`: remove it like ensureRemote does
    if (stopped.code === 0) await runClaude(['rm', copy], undefined)
    note = stopped.code === 0 ? ` (a copy ${copy} was stopped and removed)` : ` (a copy ${copy} started; stop it with: claude stop ${copy})`
    // the session had saved options after all: wake the session itself without flags, with the same message
    const again = await runClaude(reviveArgs(s.sessionId, true, settings.permission, undefined, opts.message), s.cwd)
    if (again.code !== 0 || copyIdIn(again.output) !== undefined) {
      log(`WAKE ${s.shortId} failed without flags too (exit ${again.code})`)
      return { ok: false, message: `${s.shortId}: claude failed after a copy${note}`, output: again.output, code: again.code === 0 ? 1 : again.code }
    }
    note += ', woken again without flags'
  }
  // bgSince / remoteSince / the permission of this first start go to the app's own file (never the plugin's session file)
  const at = Date.now()
  const patch: Partial<AppSessionState> = {}
  if (file?.bgSince === undefined && app.bgSince === undefined) patch.bgSince = at
  if (withRemote && file?.remoteSince === undefined && app.remoteSince === undefined) patch.remoteSince = at
  if (flagsTook && app.permissionAtStart === undefined) patch.permissionAtStart = permissionRecord(settings.permission, at)
  if (Object.keys(patch).length > 0) { try { patchSession(s.sessionId, patch) } catch (err) { log(`APPSTATE write failed ${String(err)}`) } }
  return { ok: true, message: `${s.shortId}: woken${note}` }
}

// Stops a background session (`claude stop`): closing its window or /exit only detaches from it
export async function stopBackground(s: SessionView): Promise<string> {
  if (s.runsIn !== 'background') return `${s.shortId}: not a background session`
  const ran = await runClaude(['stop', s.shortId], undefined)
  log(`STOP ${s.shortId} exit ${ran.code}`)
  if (ran.code !== 0) return `${s.shortId}: claude stop failed (exit ${ran.code})`
  const left = s.jobs.filter(j => !j.isDismissed).length
  const lang = getSettings().language
  return lang === 'ko'
    ? `${s.label} · ${s.shortId} 을 껐습니다.${left > 0 ? ` 예약이 ${left}개 남아 있어 다음 예약 전에 clock-out 이 다시 켭니다. 다시 켜지 않게 하려면 그 예약을 '자동 깨우기 제외' 하세요.` : ''}`
    : `Stopped ${s.label} · ${s.shortId}.${left > 0 ? ` It still has ${left} job(s), so clock-out wakes it before the next one; use No auto-wake on them to keep it off.` : ''}`
}

// Opens a Windows Terminal window attached to a running session (the in-app terminal comes later)
export function attachSession(s: SessionView): string {
  try {
    const child = spawn('wt.exe', ['-w', 'new', 'claude', 'attach', s.shortId], { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', () => {
      const fallback = spawn('cmd.exe', ['/c', 'start', 'claude', 'attach', s.shortId], { detached: true, stdio: 'ignore' })
      fallback.unref()
    })
    child.unref()
    log(`ATTACH ${s.shortId}`)
    return `attached to ${s.shortId} in a new terminal`
  } catch (err) {
    return `could not open a terminal: ${String(err)}`
  }
}

// A new terminal window running the given command (Windows Terminal, else a console), started in cwd when it exists
export function openTerminal(cmd: string[], cwd?: string): void {
  const dir = cwd !== undefined && cwd !== '' && existsSync(cwd) ? cwd : undefined
  const child = spawn('wt.exe', ['-w', 'new', ...(dir !== undefined ? ['-d', dir] : []), ...cmd], { cwd: dir, detached: true, stdio: 'ignore' })
  child.on('error', () => { spawn('cmd.exe', ['/c', 'start', ...cmd], { cwd: dir, detached: true, stdio: 'ignore' }).unref() })
  child.unref()
}

// The panel's "open session" and a run notice's click: attach to a running session, else claude --resume in its folder
export function openSession(s: SessionView): string {
  if (s.isAlive) return attachSession(s)
  openTerminal(['claude', '--resume', s.sessionId], s.cwd)
  log(`RESUME ${s.shortId} in a terminal`)
  return `${s.shortId}: claude --resume in a new terminal`
}

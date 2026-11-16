// Which running background sessions can be stopped to free memory (about 0.5 GB each: claude.exe + its pty host),
// from the panel's "stop session" button and the automatic cleanup. Pure functions only; the commands are
// electron/main/cleanup.ts. A stopped session keeps its transcript and jobs, and `--bg --resume` brings them back.
import { DAY_MS, HEARTBEAT_STALE_MS, WEEK_MS } from './schedule'
import type { SessionFile, SessionView } from './schedule'
import type { AppSettings } from './types'

// Why a session cannot be stopped now: terminal = runs in a terminal window (/exit there) | remote = the remote jobs
// session | running = the session file records a running job (`claude agents` "working" is not used: a stopped session shows it too)
export type StopBlock = 'terminal' | 'remote' | 'running'

// What the button asks about before stopping (the automatic cleanup skips them): blocked = waits for the person's answer
// | attached = a `claude attach` window is open and loses its session
export type StopWarn = 'blocked' | 'attached'

// What only the commands can tell: `claude agents` state and whether an attach window is open (undefined = not asked yet)
export type LiveCheck = { state?: string; isAttached: boolean }

// The panel's answer for one session: block = cannot be stopped; warns = ask first
export type StopCheck = { block?: StopBlock; warns: StopWarn[] }

type Stoppable = Pick<SessionView, 'isAlive' | 'runsIn' | 'running'>

export function stopBlock(s: Stoppable, isRemote: boolean): StopBlock | undefined {
  if (isRemote) return 'remote'
  if (s.runsIn !== 'background') return 'terminal'
  if (s.running !== undefined) return 'running'
  return undefined
}

export function stopWarns(check: LiveCheck): StopWarn[] {
  const warns: StopWarn[] = []
  if (check.state === 'blocked') warns.push('blocked')
  if (check.isAttached) warns.push('attached')
  return warns
}

// The sessions "clean up done" stops: background sessions with no job left (hidden ones count as gone) that can be stopped now
export function tidyTargets(sessions: readonly SessionView[], remoteId: string | undefined): SessionView[] {
  // a session with a Remote Control link may be in use from a phone: only its own Stop button stops it
  return sessions.filter(s => s.isAlive && s.remoteUrl === undefined && !s.jobs.some(j => !j.isDismissed) && stopBlock(s, s.sessionId === remoteId) === undefined)
}

// The done list's "clean up the list" for one session: stop = claude stop, then hide its done rows (a running background
// session with no job left) | hide = only hide the done rows (stopped, jobs left, terminal or remote jobs session) | undefined = not now (a job runs)
export type ClearHow = 'stop' | 'hide'
export function clearHow(s: Pick<SessionView, 'isAlive' | 'jobs'>, block: StopBlock | undefined): ClearHow | undefined {
  if (!s.isAlive || s.jobs.some(j => !j.isDismissed)) return 'hide'
  if (block === undefined) return 'stop'
  return block === 'running' ? undefined : 'hide'
}

// The footer's "clean up done" list: the stoppable sessions above (stopped, then hidden) and stopped sessions with
// only done rows left (hidden only). The remote jobs session is left out of both.
export type TidyTarget = { s: SessionView; stop: boolean }
export function tidyList(sessions: readonly SessionView[], remoteId: string | undefined): TidyTarget[] {
  const doneOnly = sessions.filter(s => !s.isAlive && s.jobs.length === 0 && s.done.length > 0 && s.sessionId !== remoteId)
  return [...tidyTargets(sessions, remoteId).map(s => ({ s, stop: true })), ...doneOnly.map(s => ({ s, stop: false }))]
}

// The ids that `claude attach <id|name>` processes name, from their command lines (Win32_Process CommandLine, one per line).
// Only a command line that starts with claude counts: the desktop app's own claude.exe has "attach" inside its long flags.
export function attachTargets(commandLines: string): string[] {
  const ids: string[] = []
  for (const line of commandLines.split(/\r?\n/)) {
    const m = /^\s*(?:"[^"]*[\\/]claude(?:\.exe)?"|(?:\S*[\\/])?claude(?:\.exe)?)\s+attach\s+(?:"([^"]+)"|(\S+))/i.exec(line)
    const id = m?.[1] ?? m?.[2]
    if (id !== undefined) ids.push(id)
  }
  return ids
}

// An attach target names a session by its short id, its full id, or its name
export function isAttachedTo(s: Pick<SessionView, 'sessionId' | 'name'>, targets: readonly string[]): boolean {
  return targets.some(id => (id.length >= 8 && s.sessionId.startsWith(id)) || (s.name !== undefined && s.name !== '' && id === s.name))
}

// When the session last did something: the end of its newest run (or the fire time of a one-shot without a run record),
// else when this process started. bgSince is the first background start ever and the heartbeat is refreshed all the time
// it runs, so neither tells how long it has been idle.
export function idleSince(s: Pick<SessionView, 'done' | 'liveSince'>): number | undefined {
  const times = s.done.map(d => d.finishedAt ?? d.at)
  if (s.liveSince !== undefined) times.push(s.liveSince)
  return times.length === 0 ? undefined : Math.max(...times)
}

// Automatic cleanup, before the commands are asked: a background session with no job left (a job left means the
// daily sweep woke it on purpose), idle for idleMinutes. One under Remote Control is left alone: the person may still
// talk to it from the phone, and nothing would wake it again.
export function isAutoStopDue(s: SessionView, isRemote: boolean, cleanup: AppSettings['cleanup'], now: number): boolean {
  if (!cleanup.auto || !s.isAlive || stopBlock(s, isRemote) !== undefined || s.remoteUrl !== undefined) return false
  if (s.jobs.some(j => !j.isDismissed)) return false
  const since = idleSince(s)
  return since !== undefined && now - since >= cleanup.idleMinutes * 60_000
}

// A session file the app may delete (electron/main/cleanup.ts pruneSessionFiles): the session ended, no job is left or
// running, nothing was done in the last 7 days (the done list shows 7 days) and the file was not written for 8 days.
// isRunning = Claude Code lists a living process for it, or it is the remote jobs session. A job counts as left by the
// same rule as the list (sessionViewOf): not deleted, not gone, not fired. A session opened again gets a new file from the plugin.
export const PRUNE_AFTER_MS = 8 * DAY_MS
export function isPrunable(file: Pick<SessionFile, 'version' | 'heartbeatAt' | 'running' | 'jobs' | 'runs'>, mtimeMs: number, now: number, isRunning: boolean): boolean {
  if (isRunning || file.version !== 1 || file.running !== undefined) return false
  if (now - mtimeMs <= PRUNE_AFTER_MS) return false
  if (file.heartbeatAt !== undefined && now - file.heartbeatAt < HEARTBEAT_STALE_MS) return false
  const jobs = file.jobs ?? []
  if (jobs.some(j => j.deletedAt === undefined && j.goneAt === undefined && j.firedAt === undefined)) return false
  const since = now - WEEK_MS
  if ((file.runs ?? []).some(r => r.finishedAt >= since)) return false
  return !jobs.some(j => j.firedAt !== undefined && j.firedAt >= since)
}

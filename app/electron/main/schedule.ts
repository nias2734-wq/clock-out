import { readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FSWatcher } from 'node:fs'

import { isStillMissed, missedOf } from '@shared/missed'
import type { MissedJob } from '@shared/missed'
import { permissionDiffers } from '@shared/revive'
import { dismissedWith, jobsFromTranscript, liveTranscriptJobs, overviewOf, sessionFileFromTranscript, sessionViewOf, validateSessionFile, HEARTBEAT_STALE_MS } from '@shared/schedule'
import type { Overview, SessionFile, SessionView } from '@shared/schedule'
import type { AppState } from '@shared/types'

import { patchSession, readAppState } from './appState'
import { exists, readText } from './fsSafe'
import { inboxProblems } from './inbox'
import { log } from './log'
import { paths } from './paths'
import { getSettings, setSettings } from './settings'

// Reads every session file (and, when enabled, the transcripts of sessions without one) into an Overview.
// Sessions are alive when the plugin's heartbeat is fresh or Claude Code's own <config>/sessions/<pid>.json
// names them with a living process.

const TRANSCRIPT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000
const TRANSCRIPT_LIST_KEPT_MS = 30_000   // the transcript folders are not watched: their listing is taken again after this long
const transcriptCache = new Map<string, { size: number; jobs: ReturnType<typeof jobsFromTranscript> }>()
// session file name → the file as parsed at that mtime and size: an unchanged file is not read again (most files are ended sessions)
const sessionFileCache = new Map<string, { mtimeMs: number; size: number; file: SessionFile }>()

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readText(path).replace(/^﻿/, '')) as T } catch { return undefined }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM' }
}

export type LiveRecord = { pid: number; kind?: string; name?: string; bridge?: string; startedAt?: number }   // bridge: Remote Control address id

// sessionId → record, for records whose process still runs
export function liveSessions(): Map<string, LiveRecord> {
  const live = new Map<string, LiveRecord>()
  let names: string[] = []
  try { names = readdirSync(paths.liveSessionsDir) } catch { return live }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const rec = readJson<{ pid?: number; sessionId?: string; kind?: string; name?: string; bridgeSessionId?: string; startedAt?: number }>(join(paths.liveSessionsDir, name))
    if (rec?.sessionId === undefined || typeof rec.pid !== 'number') continue
    if (isProcessAlive(rec.pid)) live.set(rec.sessionId, { pid: rec.pid, kind: rec.kind, name: rec.name, bridge: rec.bridgeSessionId, startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : undefined })
  }
  return live
}

// One answer per folder while one overview is built: many sessions share a cwd
type CwdCheck = (cwd: string) => boolean
function cwdCheck(): CwdCheck {
  const known = new Map<string, boolean>()
  return cwd => {
    let found = known.get(cwd)
    if (found === undefined) { found = cwd !== '' && exists(cwd); known.set(cwd, found) }
    return found
  }
}

// The session file as last parsed, read again only when its mtime or size changed. A file that does not parse is not kept
// (it may be half written) and is read again on the next overview.
function cachedSessionFile(name: string): { file: SessionFile; mtime: number } | undefined {
  const path = join(paths.sessionsDir, name)
  let st: { mtimeMs: number; size: number }
  try { st = statSync(path) } catch { sessionFileCache.delete(name); return undefined }   // gone between list and stat
  const cached = sessionFileCache.get(name)
  if (cached !== undefined && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return { file: cached.file, mtime: st.mtimeMs }
  const file = readJson<SessionFile>(path)
  if (file === undefined) { sessionFileCache.delete(name); return undefined }
  sessionFileCache.set(name, { mtimeMs: st.mtimeMs, size: st.size, file })
  return { file, mtime: st.mtimeMs }
}

// files: every plugin session file read, normalized, for the missed-job check
function pluginSessions(now: number, live: Map<string, LiveRecord>, app: AppState, files: Map<string, SessionFile>, hasCwd: CwdCheck): SessionView[] {
  const views: SessionView[] = []
  let names: string[] = []
  try { names = readdirSync(paths.sessionsDir) } catch { return views }
  const listed = new Set(names)
  for (const name of sessionFileCache.keys()) if (!listed.has(name)) sessionFileCache.delete(name)
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const read = cachedSessionFile(name)
    if (read === undefined) continue
    const { file, mtime } = read
    if (file.version !== 1 || typeof file.sessionId !== 'string') continue
    const fresh = file.alive && file.heartbeatAt !== undefined && now - file.heartbeatAt < HEARTBEAT_STALE_MS
    const isAlive = fresh || live.has(file.sessionId)
    const normal: SessionFile = { ...file, dismissed: dismissedWith(file.dismissed ?? [], app.sessions[file.sessionId]?.hidden), jobs: file.jobs ?? [], runs: file.runs ?? [] }
    files.set(file.sessionId, normal)
    const warnings = validateSessionFile(normal, mtime, now, hasCwd(file.cwd))
    const view = sessionViewOf(normal, now, isAlive, 'plugin', warnings, getSettings().doneCleared[file.sessionId])
    const bridge = live.get(file.sessionId)?.bridge
    if (bridge !== undefined) view.remoteUrl = `https://claude.ai/code/${bridge}`
    views.push(view)
  }
  return views
}

type TranscriptEntry = { path: string; sessionId: string; mtime: number; size: number }
let transcriptList: { at: number; files: TranscriptEntry[] } | undefined

// Every <config>/projects/*/<sessionId>.jsonl written in the last 8 days, newest first; one listing serves TRANSCRIPT_LIST_KEPT_MS
function transcriptFiles(now: number): TranscriptEntry[] {
  if (transcriptList !== undefined && now >= transcriptList.at && now - transcriptList.at < TRANSCRIPT_LIST_KEPT_MS) return transcriptList.files
  const files: TranscriptEntry[] = []
  let projects: string[] = []
  try { projects = readdirSync(join(paths.configDir, 'projects')) } catch { return files }
  for (const project of projects) {
    const dir = join(paths.configDir, 'projects', project)
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const sessionId = name.slice(0, -'.jsonl'.length)
      try {
        const st = statSync(join(dir, name))
        if (now - st.mtimeMs > TRANSCRIPT_MAX_AGE_MS) continue
        files.push({ path: join(dir, name), sessionId, mtime: st.mtimeMs, size: st.size })
      } catch { /* vanished */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  transcriptList = { at: now, files }
  return files
}

// Sessions without a session file, from their transcripts (legacyTranscriptScan)
function transcriptSessions(now: number, live: Map<string, unknown>, skip: Set<string>, app: AppState, hasCwd: CwdCheck): SessionView[] {
  const views: SessionView[] = []
  const seenJobIds = new Set<string>()
  for (const f of transcriptFiles(now)) {
    if (skip.has(f.sessionId)) continue
    let cached = transcriptCache.get(f.path)
    if (cached === undefined || cached.size !== f.size) {
      let jobs: ReturnType<typeof jobsFromTranscript> = []
      try { jobs = jobsFromTranscript(readText(f.path).split('\n')) } catch { /* unreadable */ }
      cached = { size: f.size, jobs }
      transcriptCache.set(f.path, cached)
    }
    // a forked session copies its parent's transcript: the same job id stays with the newest file only
    const own = liveTranscriptJobs(cached.jobs.filter(j => !seenJobIds.has(j.id)), now)
    for (const j of cached.jobs) seenJobIds.add(j.id)
    if (own.length === 0) continue
    const file = sessionFileFromTranscript(f.sessionId, own)
    file.dismissed = dismissedWith([], app.sessions[f.sessionId]?.hidden)
    const warnings = validateSessionFile(file, f.mtime, now, hasCwd(file.cwd))
    views.push(sessionViewOf(file, now, live.has(f.sessionId), 'transcript', warnings, getSettings().doneCleared[f.sessionId]))
  }
  return views
}

let last: Overview = { builtAt: 0, sessions: [], jobCount: 0 }
// remote.ts adds the remote jobs session's state (set from index.ts; schedule.ts must not import remote.ts)
let remoteProvider: ((live: Map<string, LiveRecord>) => Overview['remote']) | undefined
export function setRemoteProvider(p: (live: Map<string, LiveRecord>) => Overview['remote']): void { remoteProvider = p }
// wake.ts tells which sessions it is waking now (set from wake.ts, which imports this file)
let wakingProvider: ((sessionId: string) => boolean) | undefined
export function setWakingProvider(p: (sessionId: string) => boolean): void { wakingProvider = p }
// the remote jobs session's id (remoteState.ts), left out of the missed jobs
let remoteSessionId: (() => string | undefined) | undefined
export function setRemoteSessionProvider(p: () => string | undefined): void { remoteSessionId = p }

// Missed jobs found so far (key → job): once found they stay until run, closed, deleted or a day old, even after the
// session is up again (its plugin then moves nextFireAt on and the job would no longer look missed)
const missedFound = new Map<string, MissedJob>()

// The app's own state of each session (app-state.json) on its view: bgSince / remoteSince of older session files win
function withAppState(s: SessionView, app: AppState, inbox: ReturnType<typeof inboxProblems>): void {
  const st = app.sessions[s.sessionId]
  if (st !== undefined) {
    s.bgSince ??= st.bgSince
    s.remoteSince ??= st.remoteSince
    if (st.lastAttemptAt !== undefined || st.blocked !== undefined) {
      s.wake = { lastAttemptAt: st.lastAttemptAt, lastSuccessAt: st.lastSuccessAt, nextRetryAt: st.nextRetryAt, failures: st.failures, blocked: st.blocked, lastError: st.lastError }
    }
    if (st.permissionAtStart !== undefined) {
      s.permissionAtStart = st.permissionAtStart
      s.permissionMismatch = permissionDiffers(st.permissionAtStart, getSettings().permission)
    }
  }
  if (wakingProvider?.(s.sessionId) === true) s.wake = { ...s.wake, inProgress: true }
  const box = inbox.get(s.sessionId)
  if (box !== undefined) s.inbox = box
}

function missedNow(now: number, sessions: SessionView[], files: Map<string, SessionFile>, app: AppState): MissedJob[] {
  const remote = remoteSessionId?.()
  for (const s of sessions) {
    const file = files.get(s.sessionId)
    if (file === undefined || s.sessionId === remote || s.warnings.length > 0) continue
    for (const m of missedOf(file, now, s.isAlive, file.dismissed, app.sessions[s.sessionId]?.missedDismissed)) missedFound.set(m.key, m)
  }
  for (const [key, m] of missedFound) {
    if (!isStillMissed(m, files.get(m.sessionId), now, app.sessions[m.sessionId]?.missedDismissed)) missedFound.delete(key)
  }
  return [...missedFound.values()].sort((a, b) => a.dueAt - b.dueAt)
}
export function currentOverview(): Overview { return last }

// The last overview when it was built within maxAgeMs, else a new one: the scheduler's tick often comes right after the watcher's
export function freshOverview(maxAgeMs: number): Overview {
  const age = Date.now() - last.builtAt
  return age >= 0 && age < maxAgeMs ? last : buildOverview()
}

export function buildOverview(): Overview {
  const now = Date.now()
  const live = liveSessions()
  const app = readAppState()
  const files = new Map<string, SessionFile>()
  const hasCwd = cwdCheck()
  const sessions = pluginSessions(now, live, app, files, hasCwd)
  if (getSettings().legacyTranscriptScan) {
    const known = new Set(sessions.map(s => s.sessionId))
    sessions.push(...transcriptSessions(now, live, known, app, hasCwd))
  }
  const inbox = inboxProblems()
  for (const s of sessions) {
    const rec = live.get(s.sessionId)
    if (rec?.kind !== undefined) s.runsIn = rec.kind === 'bg' || rec.kind === 'background' ? 'background' : 'terminal'
    s.liveSince = rec?.startedAt
    withAppState(s, app, inbox)
  }
  const missed = missedNow(now, sessions, files, app)
  last = { ...overviewOf(sessions, now), remote: remoteProvider?.(live), missed }
  // the remote jobs session's status tool reads this, so the phone and the app show the same list
  // (the plugin alone cannot see sessions found only in transcripts)
  try { writeFileSync(paths.overview, JSON.stringify(last), 'utf8') } catch { /* folder not there yet */ }
  return last
}

// Hides (or unhides) a job of a stopped session: the app then never revives that session for it.
// Kept in the app's own app-state.json (hidden), which overrides the dismissed list older versions wrote into session files.
export function toggleHide(jobId: string): string {
  const overview = buildOverview()
  const owner = overview.sessions.find(s => s.jobs.some(j => j.id === jobId))
  if (owner === undefined) return `No job ${jobId}`
  if (owner.isAlive) return `${jobId} belongs to running session ${owner.shortId}; delete it there with CronDelete`
  const hidden = owner.jobs.find(j => j.id === jobId)?.isDismissed !== true
  patchSession(owner.sessionId, { hidden: { ...readAppState().sessions[owner.sessionId]?.hidden, [jobId]: hidden } })
  log(`HIDE ${jobId} ${hidden ? 'hidden' : 'shown'} (${owner.shortId})`)
  return hidden ? `Hidden ${jobId}` : `Unhidden ${jobId}`
}

// The panel's "clean up the list": done rows of these sessions that ended by now are no longer shown (doneOf).
// Only the app's settings change; the session files and transcripts stay as they are.
export function clearDone(sessionIds: readonly string[]): void {
  if (sessionIds.length === 0) return
  const at = Date.now()
  const doneCleared = { ...getSettings().doneCleared }
  for (const id of sessionIds) doneCleared[id] = at
  setSettings({ doneCleared })
  log(`CLEAR done ${sessionIds.map(id => id.slice(0, 8)).join(',')}`)
}

// Recomputes when a session file changes (debounced) and on a timer; `listener` gets every new overview.
export function watchSchedule(listener: (o: Overview) => void, intervalMs: number): () => void {
  let timer: NodeJS.Timeout | undefined
  const fire = () => { try { listener(buildOverview()) } catch (err) { log(`SCHEDULE error ${String(err)}`) } }
  const debounced = () => { if (timer !== undefined) clearTimeout(timer); timer = setTimeout(fire, 1500) }
  let watcher: FSWatcher | undefined
  try { watcher = watch(paths.sessionsDir, debounced) } catch { /* folder appears once the plugin writes */ }
  const tick = setInterval(fire, intervalMs)
  fire()
  return () => { watcher?.close(); clearInterval(tick); if (timer !== undefined) clearTimeout(timer) }
}

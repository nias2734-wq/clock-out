import { existsSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FSWatcher } from 'node:fs'

import { jobsFromTranscript, liveTranscriptJobs, overviewOf, sessionFileFromTranscript, sessionViewOf, validateSessionFile, HEARTBEAT_STALE_MS } from '@shared/schedule'
import type { Overview, SessionFile, SessionView } from '@shared/schedule'

import { log } from './log'
import { paths } from './paths'
import { getSettings, setSettings } from './settings'

// Reads every session file (and, when enabled, the transcripts of sessions without one) into an Overview.
// Sessions are alive when the plugin's heartbeat is fresh or Claude Code's own <config>/sessions/<pid>.json
// names them with a living process.

const TRANSCRIPT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000
const transcriptCache = new Map<string, { size: number; jobs: ReturnType<typeof jobsFromTranscript> }>()

function readJson<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T } catch { return undefined }
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

function pluginSessions(now: number, live: Map<string, LiveRecord>): SessionView[] {
  const views: SessionView[] = []
  let names: string[] = []
  try { names = readdirSync(paths.sessionsDir) } catch { return views }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(paths.sessionsDir, name)
    const file = readJson<SessionFile>(path)
    if (file === undefined || file.version !== 1 || typeof file.sessionId !== 'string') continue
    const fresh = file.alive && file.heartbeatAt !== undefined && now - file.heartbeatAt < HEARTBEAT_STALE_MS
    const isAlive = fresh || live.has(file.sessionId)
    let mtime = 0
    try { mtime = statSync(path).mtimeMs } catch { /* gone between list and stat */ }
    const warnings = validateSessionFile({ ...file, dismissed: file.dismissed ?? [], jobs: file.jobs ?? [], runs: file.runs ?? [] }, mtime, now, file.cwd !== '' && existsSync(file.cwd))
    const view = sessionViewOf({ ...file, dismissed: file.dismissed ?? [], jobs: file.jobs ?? [], runs: file.runs ?? [] }, now, isAlive, 'plugin', warnings, getSettings().doneCleared[file.sessionId])
    const bridge = live.get(file.sessionId)?.bridge
    if (bridge !== undefined) view.remoteUrl = `https://claude.ai/code/${bridge}`
    views.push(view)
  }
  return views
}

// Transcripts under <config>/projects/*/<sessionId>.jsonl written in the last 8 days, newest first
function transcriptSessions(now: number, live: Map<string, unknown>, skip: Set<string>): SessionView[] {
  const views: SessionView[] = []
  let projects: string[] = []
  try { projects = readdirSync(join(paths.configDir, 'projects')) } catch { return views }
  const seenJobIds = new Set<string>()
  const files: { path: string; sessionId: string; mtime: number; size: number }[] = []
  for (const project of projects) {
    const dir = join(paths.configDir, 'projects', project)
    let names: string[] = []
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const sessionId = name.slice(0, -'.jsonl'.length)
      if (skip.has(sessionId)) continue
      try {
        const st = statSync(join(dir, name))
        if (now - st.mtimeMs > TRANSCRIPT_MAX_AGE_MS) continue
        files.push({ path: join(dir, name), sessionId, mtime: st.mtimeMs, size: st.size })
      } catch { /* vanished */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  for (const f of files) {
    let cached = transcriptCache.get(f.path)
    if (cached === undefined || cached.size !== f.size) {
      let jobs: ReturnType<typeof jobsFromTranscript> = []
      try { jobs = jobsFromTranscript(readFileSync(f.path, 'utf8').split('\n')) } catch { /* unreadable */ }
      cached = { size: f.size, jobs }
      transcriptCache.set(f.path, cached)
    }
    // a forked session copies its parent's transcript: the same job id stays with the newest file only
    const own = liveTranscriptJobs(cached.jobs.filter(j => !seenJobIds.has(j.id)), now)
    for (const j of cached.jobs) seenJobIds.add(j.id)
    if (own.length === 0) continue
    const file = sessionFileFromTranscript(f.sessionId, own)
    const warnings = validateSessionFile(file, f.mtime, now, file.cwd !== '' && existsSync(file.cwd))
    views.push(sessionViewOf(file, now, live.has(f.sessionId), 'transcript', warnings, getSettings().doneCleared[f.sessionId]))
  }
  return views
}

let last: Overview = { builtAt: 0, sessions: [], jobCount: 0 }
// remote.ts adds the remote jobs session's state (set from index.ts; schedule.ts must not import remote.ts)
let remoteProvider: (() => Overview['remote']) | undefined
export function setRemoteProvider(p: () => Overview['remote']): void { remoteProvider = p }
export function currentOverview(): Overview { return last }

export function buildOverview(): Overview {
  const now = Date.now()
  const live = liveSessions()
  const sessions = pluginSessions(now, live)
  if (getSettings().legacyTranscriptScan) {
    const known = new Set(sessions.map(s => s.sessionId))
    sessions.push(...transcriptSessions(now, live, known))
  }
  for (const s of sessions) {
    const rec = live.get(s.sessionId)
    if (rec?.kind !== undefined) s.runsIn = rec.kind === 'bg' || rec.kind === 'background' ? 'background' : 'terminal'
    s.liveSince = rec?.startedAt
  }
  last = { ...overviewOf(sessions, now), remote: remoteProvider?.() }
  // the remote jobs session's status tool reads this, so the phone and the app show the same list
  // (the plugin alone cannot see sessions found only in transcripts)
  try { writeFileSync(paths.overview, JSON.stringify(last), 'utf8') } catch { /* folder not there yet */ }
  return last
}

// Hides (or unhides) a job of a stopped session: the app then never revives that session for it.
// Writes the plugin's own file format; a transcript-only session gets a minimal file.
export function toggleHide(jobId: string): string {
  const overview = buildOverview()
  const owner = overview.sessions.find(s => s.jobs.some(j => j.id === jobId))
  if (owner === undefined) return `No job ${jobId}`
  if (owner.isAlive) return `${jobId} belongs to running session ${owner.shortId}; delete it there with CronDelete`
  const path = join(paths.sessionsDir, `${owner.sessionId}.json`)
  const file = readJson<SessionFile>(path) ?? { version: 1 as const, sessionId: owner.sessionId, cwd: owner.cwd, alive: false, dismissed: [], jobs: [], runs: [] }
  file.dismissed = file.dismissed ?? []
  const hidden = !file.dismissed.includes(jobId)
  file.dismissed = hidden ? [...file.dismissed, jobId] : file.dismissed.filter(id => id !== jobId)
  writeFileSync(path, JSON.stringify(file, null, 2), 'utf8')
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

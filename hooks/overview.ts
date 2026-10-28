import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isHiddenJob, readAppState } from './appState'
import { cronNext } from './cron'
import { clockOutPaths } from './paths'
import { readSessionFile } from './sessionFile'
import type { SessionFile } from './schema'
import type { ClockOutJobView, ClockOutOverview, ClockOutSessionView } from '../types'

export const HEARTBEAT_STALE_MS = 3 * 60 * 1000   // a heartbeat older than this means the module (and likely the session) is gone
const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRING_SOON_DAYS = 2

// The state library wants the atom written in the file that reads or updates it (so the engine can list what a
// module touches); pane.tsx declares the same reference for its read.
export const EMPTY_OVERVIEW: ClockOutOverview = { builtAt: 0, sessions: [], jobCount: 0 }
const overviewAtom = atom({ plugin: 'clock-out', key: 'overview' } as const, EMPTY_OVERVIEW)

export function shortId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

export function labelOf(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

// Claude Code keeps <configDir>/sessions/<pid>.json only while that process runs: a record is a second liveness signal.
async function liveSessionIds($: EngineInterface, dir: string): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const text = await $.fs.read(`${dir}/${entry.name}`)
        if (typeof text !== 'string') continue
        const rec = JSON.parse(text) as { sessionId?: string }
        if (typeof rec.sessionId === 'string') ids.add(rec.sessionId)
      } catch {
        // half-written record
      }
    }
  } catch {
    // no dir
  }
  return ids
}

// hidden: the app's hidden of this session (app-state.json), which overrides file.dismissed
export function sessionView(file: SessionFile, now: number, isAlive: boolean, isOwn: boolean, hidden?: Record<string, boolean>): ClockOutSessionView {
  const jobs: ClockOutJobView[] = []
  for (const j of file.jobs) {
    if (j.deletedAt !== undefined || j.goneAt !== undefined || j.firedAt !== undefined) continue
    const nextAt = j.nextFireAt ?? cronNext(j.cron, now)
    const run = [...file.runs].reverse().find(r => r.jobId === j.id)
    const view: ClockOutJobView = {
      id: j.id,
      cron: j.cron,
      humanSchedule: j.humanSchedule ?? j.cron,
      prompt: j.prompt,
      ...(j.title !== undefined ? { title: j.title } : {}),
      recurring: j.recurring,
      nextAt,
      isExpiringSoon: false,
      isDismissed: isHiddenJob(file.dismissed, hidden, j.id),
    }
    if (j.expiresAt !== undefined) {
      view.expiresAt = j.expiresAt
      view.expiresInDays = Math.max(0, Math.ceil((j.expiresAt - now) / DAY_MS))
      view.isExpiringSoon = j.expiresAt - now <= EXPIRING_SOON_DAYS * DAY_MS
    }
    if (run !== undefined) view.lastRun = { finishedAt: run.finishedAt, reason: run.reason, ...(run.taskOutcome !== undefined ? { taskOutcome: run.taskOutcome } : {}), durationMs: run.durationMs, answerHead: run.answerHead }
    jobs.push(view)
  }
  jobs.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity))
  const nextAt = jobs.filter(j => !j.isDismissed).map(j => j.nextAt).filter((t): t is number => t !== undefined).sort((a, b) => a - b)[0]
  return {
    sessionId: file.sessionId,
    shortId: shortId(file.sessionId),
    label: labelOf(file.cwd),
    cwd: file.cwd,
    kind: file.kind,
    name: file.name,
    isAlive,
    isOwn,
    nextAt,
    jobs,
  }
}

// Reads every session file and builds the view. Sessions without live jobs are left out.
export async function buildOverview($: EngineInterface): Promise<ClockOutOverview> {
  const now = await $.clock.now()
  const paths = await clockOutPaths($)
  const own = await $.session.id()
  const live = await liveSessionIds($, paths.liveSessionsDir)
  const app = await readAppState($)
  const sessions: ClockOutSessionView[] = []
  let entries: { name: string; kind: string }[] = []
  try {
    entries = await $.fs.list(paths.sessionsDir)
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const file = await readSessionFile($, `${paths.sessionsDir}/${entry.name}`)
    if (file === undefined) continue
    const fresh = file.alive && file.heartbeatAt !== undefined && now - file.heartbeatAt < HEARTBEAT_STALE_MS
    const isAlive = fresh || live.has(file.sessionId) || file.sessionId === own
    const view = sessionView(file, now, isAlive, file.sessionId === own, app?.sessions[file.sessionId]?.hidden)
    if (view.jobs.length === 0) continue
    sessions.push(view)
  }
  sessions.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity))
  const jobCount = sessions.reduce((n, s) => n + s.jobs.filter(j => !j.isDismissed).length, 0)
  return { builtAt: now, sessions, jobCount }
}

export async function refreshOverview($: EngineInterface, message?: string): Promise<ClockOutOverview> {
  const built = await buildOverview($)
  if (message !== undefined) built.message = message
  await update($, overviewAtom, () => built)
  return built
}

// Plain-text rendering, for the command's output and for terminals too narrow for the pane.
export function formatOverview(o: ClockOutOverview, now: number): string {
  if (o.sessions.length === 0) return 'No scheduled jobs in any session.'
  const lines: string[] = []
  for (const s of o.sessions) {
    const state = s.isAlive ? 'running' : 'stopped'
    const own = s.isOwn ? ' (this session)' : ''
    lines.push(`${s.label} · ${s.shortId}  ${state}${own}  ${s.jobs.length} job(s)  next ${fmtTime(s.nextAt, now)}`)
    for (const j of s.jobs) {
      const bits = [`[${j.id}] ${j.humanSchedule}`, `next ${fmtTime(j.nextAt, now)}`]
      if (j.expiresInDays !== undefined && j.isExpiringSoon) bits.push(`expires in ${j.expiresInDays}d`)
      if (j.lastRun !== undefined) bits.push(`last ${j.lastRun.reason === 'answer' ? 'answered (unverified)' : j.lastRun.reason} ${fmtTime(j.lastRun.finishedAt, now)} (${Math.round(j.lastRun.durationMs / 1000)}s)`)
      if (j.isDismissed) bits.push('hidden')
      lines.push(`  - ${bits.join(' · ')} | ${j.title ?? j.prompt.replace(/\s+/g, ' ').slice(0, 60)}`)
    }
  }
  if (o.message !== undefined) lines.push('', o.message)
  return lines.join('\n')
}

// "21:33" today, else "10-20 19:40"; "—" when unknown.
export function fmtTime(ms: number | undefined, now: number): string {
  if (ms === undefined) return '—'
  const d = new Date(ms)
  const n = new Date(now)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return hm
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

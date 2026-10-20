// How a fired job is shown (quiet | notify | open) and which running jobs the app still has to announce.
// Pure functions only; the notices and terminal windows are electron/main/runWatch.ts.
import type { JobView, SessionView } from './schedule'
import type { AppSettings, RunMode } from './types'

export type ModeSource = 'job' | 'session' | 'default'   // job: the plugin's job_mode tool | session: the jobs panel | default: settings

export const RUN_NOTICE_MAX_AGE_MS = 10 * 60 * 1000   // a run that fired longer ago than this (app restarted later) is not announced

// The job's own mode wins, then the session's choice in the panel, then the settings default
export function effectiveMode(jobMode: RunMode | undefined, sessionId: string, runMode: AppSettings['runMode']): { mode: RunMode; source: ModeSource } {
  if (jobMode !== undefined) return { mode: jobMode, source: 'job' }
  const chosen = runMode.sessions[sessionId]
  if (chosen !== undefined) return { mode: chosen, source: 'session' }
  return { mode: runMode.default, source: 'default' }
}

// The job a running prompt belongs to: the plugin's jobId, else the job whose prompt folds to the same first 120 chars
export function runningJob(s: Pick<SessionView, 'jobs' | 'running'>): JobView | undefined {
  const running = s.running
  if (running === undefined) return undefined
  if (running.jobId !== undefined) return s.jobs.find(j => j.id === running.jobId)
  const head = running.promptHead.trim()
  if (head === '') return undefined
  return s.jobs.find(j => j.prompt.replace(/\s+/g, ' ').trim().slice(0, 120) === head)
}

export function runKey(sessionId: string, firedAt: number): string { return `${sessionId}:${firedAt}` }

// Sessions running a job the watcher has not seen yet (`seen` holds runKey values); `isStale` marks one too old to announce
export function newRuns(sessions: SessionView[], seen: ReadonlySet<string>, now: number): { session: SessionView; key: string; isStale: boolean }[] {
  const found: { session: SessionView; key: string; isStale: boolean }[] = []
  for (const s of sessions) {
    if (s.running === undefined) continue
    const key = runKey(s.sessionId, s.running.firedAt)
    if (seen.has(key)) continue
    found.push({ session: s, key, isStale: now - s.running.firedAt > RUN_NOTICE_MAX_AGE_MS })
  }
  return found
}

// `claude agents --json --all` output → sessionId → state ('working' | 'blocked' | 'done' | 'stopped' …). The CLI prints
// the array over several lines, so the whole output is parsed; anything unreadable gives an empty map.
export function agentStates(output: string): Map<string, string> {
  const states = new Map<string, string>()
  for (const a of agentRecords(output)) if (typeof a.sessionId === 'string' && typeof a.state === 'string') states.set(a.sessionId, a.state)
  return states
}

// The same output: did this session ever run in the background (kind 'background', listed even after it stopped)
export function wasBackgroundIn(output: string, sessionId: string): boolean {
  return agentRecords(output).some(a => a.sessionId === sessionId && a.kind === 'background')
}

function agentRecords(output: string): { sessionId?: unknown; state?: unknown; kind?: unknown }[] {
  const start = output.indexOf('[')
  const end = output.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const list = JSON.parse(output.slice(start, end + 1)) as unknown
    return Array.isArray(list) ? list.filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null) : []
  } catch { return [] }   // not JSON
}

// Scheduled jobs as the app shows them: one view per session, built from the plugin's session files
// (<config>/clock-out/sessions/<id>.json) or, for sessions that never loaded the plugin, from Claude Code's
// transcripts. Pure functions only; reading files is the main process's job (electron/main/schedule.ts).
import { cronNext } from './cron'
import type { MissedJob } from './missed'
import type { PermissionRecord, RunMode } from './types'

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000
const EXPIRING_SOON_DAYS = 2
const MAX_PROMPT = 20_000

// The plugin's session file (hooks/schema.ts)
export type SessionFile = {
  version: 1
  sessionId: string
  cwd: string
  kind?: 'interactive' | 'background'
  pid?: number
  name?: string
  alive: boolean
  heartbeatAt?: number
  endedAt?: number
  bgSince?: number
  remoteSince?: number                 // the first --bg start carried --remote-control
  running?: { promptHead: string; firedAt: number; jobId?: string }   // a scheduled job runs now; jobId when the plugin matched its prompt to a job
  dismissed: string[]
  jobs: { id: string; cron: string; prompt: string; recurring: boolean; humanSchedule?: string; createdAt: number; expiresAt?: number; nextFireAt?: number; deletedAt?: number; firedAt?: number; goneAt?: number; mode?: RunMode }[]
  runs: { jobId?: string; promptHead?: string; firedAt: number; finishedAt: number; reason: string; taskOutcome?: TaskOutcome; durationMs: number; answerHead: string }[]
}

// A run's result as far as clock-out knows (hooks/schema.ts): answer → unverified (Claude answered; whether the job worked is
// not checked), any other reason → failed. Absent on runs recorded before 0.13: taskOutcomeOf(reason) gives the same.
export type TaskOutcome = 'unverified' | 'failed'
export const taskOutcomeOf = (reason: string): TaskOutcome => (reason === 'answer' ? 'unverified' : 'failed')

// The app's wake attempts of a session (app-state.json, electron/main/wake.ts)
export type WakeView = {
  lastAttemptAt?: number
  lastSuccessAt?: number
  nextRetryAt?: number                 // the scheduler tries again from then (all quick retries failed)
  failures?: number                    // failed attempts since the last success
  blocked?: string                     // a login / permission failure: no automatic wake until a manual one succeeds
  lastError?: string                   // the last failure's output, first 160 chars
  inProgress?: boolean                 // a wake (with its retries) runs now
}

// Instructions in a session's inbox the plugin could not submit (failed after 5 tries) or may have submitted (unknown)
export type InboxView = { failed: number; unknown: number; items: { state: 'failed' | 'unknown'; at: number; head: string; lastError?: string }[] }

export type JobView = {
  id: string
  cron: string
  humanSchedule: string
  prompt: string
  recurring: boolean
  nextAt?: number
  expiresAt?: number
  expiresInDays?: number
  isExpiringSoon: boolean
  isDismissed: boolean
  mode?: RunMode                       // set on the job by the plugin's job_mode tool; absent = session or default setting
  lastRun?: { finishedAt: number; reason: string; taskOutcome: TaskOutcome; durationMs: number; answerHead: string }
}

export type SessionView = {
  sessionId: string
  shortId: string
  label: string
  cwd: string
  kind?: 'interactive' | 'background'
  name?: string
  isAlive: boolean
  source: 'plugin' | 'transcript'     // where the jobs were read from
  bgSince?: number
  remoteSince?: number
  running?: { promptHead: string; firedAt: number; jobId?: string }
  remoteUrl?: string                   // claude.ai/code address while it runs under Remote Control
  runsIn?: 'background' | 'terminal'   // where it runs now, from Claude Code's own live record (bg = closing a window or /exit does not stop it)
  liveSince?: number                   // when the running process started, from the same live record
  nextAt?: number
  jobs: JobView[]
  done: DoneView[]                     // finished in the last 7 days, newest first (doneOf)
  warnings: string[]                   // validation problems; a session with warnings is never revived
  wake?: WakeView                      // absent when the app never tried to wake it
  permissionAtStart?: PermissionRecord // the permission flags of its first background start by the app
  permissionMismatch?: boolean         // permissionAtStart differs from the settings now (the session keeps the old one)
  inbox?: InboxView                    // absent when nothing failed
}

// A finished run, or a fired one-shot without a recorded run, for the panel's done list
export type DoneView = {
  at: number                           // when it fired
  jobId?: string
  prompt: string                       // the job's prompt, else the run's first 120 chars
  recurring?: boolean                  // absent when the job is no longer in the file
  finishedAt?: number
  reason?: string                      // answer | aborted | refusal | error; absent for a one-shot fired without a run record
  taskOutcome?: TaskOutcome            // set with reason
  durationMs?: number
  answerHead?: string
}

export type RemoteView = { enabled: boolean; isAlive: boolean; sessionId?: string; url?: string; error?: string }   // the remote jobs session
export type Overview = { builtAt: number; sessions: SessionView[]; jobCount: number; nextSession?: { shortId: string; label: string; nextAt: number }; remote?: RemoteView; missed?: MissedJob[] }   // missed: shared/missed.ts, oldest first

// The monitor button and menu treat the remote jobs session as on (open it or turn it off) only when the setting is on
// and it runs; on but not running yet (starting, failed) the button just starts / opens it as before
export function remoteIsOn(remote: Pick<RemoteView, 'enabled' | 'isAlive'> | undefined): boolean {
  return remote?.enabled === true && remote.isAlive
}

export function shortId(id: string): string { return id.slice(0, 8) }
export function labelOf(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Checks a session file before it is trusted. The app only ever starts `claude --bg --resume <id>` with a
// fixed message, but a tampered file could still point it at odd places; a warned session is shown, not revived.
export function validateSessionFile(file: SessionFile, fileMtimeMs: number, now: number, cwdExists: boolean): string[] {
  const warnings: string[] = []
  if (!UUID.test(file.sessionId)) warnings.push('session id is not a UUID')
  if (!cwdExists) warnings.push('working folder does not exist')
  if (fileMtimeMs > now + 5 * 60 * 1000) warnings.push('file is dated in the future')
  if (file.jobs.some(j => typeof j.prompt !== 'string' || j.prompt.length > MAX_PROMPT)) warnings.push('a job prompt is missing or too long')
  if (file.jobs.some(j => typeof j.cron !== 'string' || j.cron.trim().split(/\s+/).length !== 5)) warnings.push('a job has a malformed cron')
  return warnings
}

// Hidden job ids: the session file's dismissed (written by the app before 0.13) with the app's hidden (app-state.json) over it
export function dismissedWith(fileDismissed: readonly string[], hidden: Record<string, boolean> | undefined): string[] {
  const ids = new Set(fileDismissed)
  for (const [id, isHidden] of Object.entries(hidden ?? {})) { if (isHidden) ids.add(id); else ids.delete(id) }
  return [...ids]
}

// clearedAt: when the person cleaned this session's done list off the panel (settings doneCleared)
export function sessionViewOf(file: SessionFile, now: number, isAlive: boolean, source: SessionView['source'], warnings: string[] = [], clearedAt?: number): SessionView {
  const jobs: JobView[] = []
  for (const j of file.jobs) {
    if (j.deletedAt !== undefined || j.goneAt !== undefined || j.firedAt !== undefined) continue
    const run = [...file.runs].reverse().find(r => r.jobId === j.id)
    const view: JobView = {
      id: j.id, cron: j.cron, humanSchedule: j.humanSchedule ?? j.cron, prompt: j.prompt, recurring: j.recurring,
      nextAt: j.nextFireAt ?? cronNext(j.cron, now), isExpiringSoon: false, isDismissed: file.dismissed.includes(j.id), mode: j.mode,
    }
    if (j.expiresAt !== undefined) {
      view.expiresAt = j.expiresAt
      view.expiresInDays = Math.max(0, Math.ceil((j.expiresAt - now) / DAY_MS))
      view.isExpiringSoon = j.expiresAt - now <= EXPIRING_SOON_DAYS * DAY_MS
    }
    if (run !== undefined) view.lastRun = { finishedAt: run.finishedAt, reason: run.reason, taskOutcome: run.taskOutcome ?? taskOutcomeOf(run.reason), durationMs: run.durationMs, answerHead: run.answerHead }
    jobs.push(view)
  }
  jobs.sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity))
  const nextAt = jobs.filter(j => !j.isDismissed).map(j => j.nextAt).filter((t): t is number => t !== undefined).sort((a, b) => a - b)[0]
  return { sessionId: file.sessionId, shortId: shortId(file.sessionId), label: labelOf(file.cwd), cwd: file.cwd, kind: file.kind, name: file.name, isAlive, source, bgSince: file.bgSince, remoteSince: file.remoteSince, running: file.running, nextAt, jobs, done: doneOf(file, now, clearedAt), warnings }
}

// Runs of the last 7 days, plus fired one-shots of the last 7 days that have no run (fired before the plugin recorded runs).
// Those that ended at or before clearedAt are left out: the person cleaned them off the list.
export function doneOf(file: SessionFile, now: number, clearedAt?: number): DoneView[] {
  const since = now - WEEK_MS
  const jobOf = (id: string | undefined) => (id === undefined ? undefined : file.jobs.find(j => j.id === id))
  const done: DoneView[] = []
  for (const r of file.runs) {
    if (r.finishedAt < since) continue
    const job = jobOf(r.jobId)
    done.push({ at: r.firedAt, jobId: r.jobId, prompt: job?.prompt ?? r.promptHead ?? '', recurring: job?.recurring, finishedAt: r.finishedAt, reason: r.reason, taskOutcome: r.taskOutcome ?? taskOutcomeOf(r.reason), durationMs: r.durationMs, answerHead: r.answerHead })
  }
  for (const j of file.jobs) {
    if (j.recurring || j.firedAt === undefined || j.firedAt < since || done.some(d => d.jobId === j.id)) continue
    done.push({ at: j.firedAt, jobId: j.id, prompt: j.prompt, recurring: false })
  }
  const shown = clearedAt === undefined ? done : done.filter(d => (d.finishedAt ?? d.at) > clearedAt)
  return shown.sort((a, b) => b.at - a.at)
}

// The doneCleared setting kept on save: a time older than 7 days hides nothing doneOf still shows
export function prunedCleared(cleared: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(cleared).filter(([, at]) => at >= now - WEEK_MS))
}

export function overviewOf(sessions: SessionView[], now: number): Overview {
  // a session whose jobs have all run stays while it has something done in the last 7 days
  const kept = sessions.filter(s => s.jobs.length > 0 || s.done.length > 0).sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity))
  const jobCount = kept.reduce((n, s) => n + s.jobs.filter(j => !j.isDismissed).length, 0)
  const first = kept.find(s => s.nextAt !== undefined)
  return { builtAt: now, sessions: kept, jobCount, nextSession: first !== undefined && first.nextAt !== undefined ? { shortId: first.shortId, label: first.label, nextAt: first.nextAt } : undefined }
}

// ---- transcripts (sessions without the plugin) ------------------------------------------------------------
// A transcript line with a CronCreate call carries { cron, prompt, recurring } under message.content[].input,
// and its result line "Scheduled one-shot task <id> …" / "Scheduled recurring job <id> …"; a CronDelete result
// is "Cancelled job <id>.". The same call appears more than once (request copies), so calls are keyed by id.
export type TranscriptJob = { id: string; cron: string; prompt: string; recurring: boolean; createdAt: number; cwd: string; isCancelled: boolean }

export function jobsFromTranscript(lines: Iterable<string>): TranscriptJob[] {
  const creates = new Map<string, { cron: string; prompt: string; recurring: boolean; at?: number; cwd: string }>()
  const results = new Map<string, string>()
  const cancelled = new Set<string>()
  let fileCwd = ''
  for (const line of lines) {
    if (!line.includes('"CronCreate"') && !line.includes('Scheduled ') && !line.includes('Cancelled job')) continue
    let o: { timestamp?: string; cwd?: string; message?: { content?: unknown } }
    try { o = JSON.parse(line) as typeof o } catch { continue }
    if (typeof o.cwd === 'string') fileCwd = o.cwd
    const content = Array.isArray(o.message?.content) ? (o.message?.content as Record<string, unknown>[]) : []
    for (const c of content) {
      if (c.type === 'tool_use' && c.name === 'CronCreate' && typeof c.id === 'string') {
        const input = (c.input ?? {}) as { cron?: string; prompt?: string; recurring?: boolean }
        const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : undefined
        const known = creates.get(c.id)
        if (known !== undefined) { if (known.at === undefined && at !== undefined) known.at = at; if (known.cwd === '' && o.cwd) known.cwd = o.cwd; continue }
        creates.set(c.id, { cron: String(input.cron ?? ''), prompt: String(input.prompt ?? ''), recurring: input.recurring !== false, at, cwd: o.cwd ?? '' })
      }
      if (c.type === 'tool_result' && typeof c.tool_use_id === 'string') {
        const text = typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? (c.content as { text?: string }[]).map(x => x.text ?? '').join(' ') : ''
        const made = /^Scheduled .*?(?:task|job) ([0-9A-Za-z_-]+)/.exec(text)
        if (made?.[1] !== undefined) results.set(c.tool_use_id, made[1])
        const gone = /^Cancelled job ([0-9A-Za-z_-]+)/.exec(text)
        if (gone?.[1] !== undefined) cancelled.add(gone[1])
      }
    }
  }
  const jobs: TranscriptJob[] = []
  for (const [callId, cr] of creates) {
    const id = results.get(callId)
    if (id === undefined || cr.at === undefined) continue
    jobs.push({ id, cron: cr.cron, prompt: cr.prompt, recurring: cr.recurring, createdAt: cr.at, cwd: cr.cwd || fileCwd, isCancelled: cancelled.has(id) })
  }
  return jobs
}

// Keeps what should still be scheduled now: drops cancelled, fired one-shots and recurring jobs past 7 days;
// the same cron+prompt registered again (a re-registration) keeps only the newest.
export function liveTranscriptJobs(jobs: TranscriptJob[], now: number): TranscriptJob[] {
  const cancelledIds = new Set(jobs.filter(j => j.isCancelled).map(j => j.id))
  const latest = new Map<string, TranscriptJob>()
  for (const j of jobs) {
    if (cancelledIds.has(j.id)) continue
    if (j.recurring) { if (now - j.createdAt >= WEEK_MS) continue }
    else { const fire = cronNext(j.cron, j.createdAt); if (fire === undefined || fire <= now) continue }
    const key = `${j.cron}|${j.prompt}`
    const seen = latest.get(key)
    if (seen === undefined || seen.createdAt < j.createdAt) latest.set(key, j)
  }
  return [...latest.values()]
}

export function sessionFileFromTranscript(sessionId: string, jobs: TranscriptJob[]): SessionFile {
  const cwd = jobs[0]?.cwd ?? ''
  return {
    version: 1, sessionId, cwd, alive: false, dismissed: [], runs: [],
    jobs: jobs.map(j => ({ id: j.id, cron: j.cron, prompt: j.prompt, recurring: j.recurring, createdAt: j.createdAt, expiresAt: j.recurring ? j.createdAt + WEEK_MS : undefined })),
  }
}

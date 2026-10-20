// Missed jobs (놓친 예약): a stopped session's job whose nextFireAt went by while the PC slept or was off (or the wake
// failed). Pure decisions only; electron/main/missed.ts finds them on app start and on resume from sleep.
// Policy: skip — nothing runs again on its own; the panel offers "run now" (the job's prompt as the first message).
import type { SessionFile } from './schedule'

export const MISSED_WINDOW_MS = 24 * 3_600_000   // only jobs due in the last 24 hours are shown
const FIRE_GRACE_MS = 2 * 60_000                 // a run that fired this much before nextFireAt still counts as that fire

export type MissedJob = {
  key: string            // '<jobId>@<dueAt>' (missedKey): the same job's next miss is a new entry
  sessionId: string
  jobId: string
  prompt: string
  cron: string
  humanSchedule: string
  recurring: boolean
  dueAt: number          // the nextFireAt that went by
}

export const missedKey = (jobId: string, dueAt: number): string => `${jobId}@${dueAt}`

type FileJob = SessionFile['jobs'][number]

// A run (or the running job) of this job at or after dueAt: then it did fire
function firedSince(file: SessionFile, job: FileJob, dueAt: number): boolean {
  const since = dueAt - FIRE_GRACE_MS
  const head = job.prompt.slice(0, 120)
  const isThis = (r: { jobId?: string; promptHead?: string }) => r.jobId === job.id || (r.jobId === undefined && r.promptHead !== undefined && r.promptHead === head)
  if (file.runs.some(r => isThis(r) && r.firedAt >= since)) return true
  return file.running !== undefined && isThis(file.running) && file.running.firedAt >= since
}

// Still worth showing: the job is not deleted, did not fire since, is within the window and was not closed by the person
export function isStillMissed(m: MissedJob, file: SessionFile | undefined, now: number, dismissed: Record<string, number> | undefined): boolean {
  if (file === undefined || dismissed?.[m.key] !== undefined || now - m.dueAt > MISSED_WINDOW_MS) return false
  const job = file.jobs.find(j => j.id === m.jobId)
  return job !== undefined && job.deletedAt === undefined && !firedSince(file, job, m.dueAt)
}

// The missed jobs of one session now: stopped, the job live with a nextFireAt in the past 24 h (2 min grace), no run
// since, not hidden from automatic wakes, not closed
export function missedOf(file: SessionFile, now: number, isAlive: boolean, hiddenIds: readonly string[], dismissed: Record<string, number> | undefined): MissedJob[] {
  if (isAlive) return []
  const out: MissedJob[] = []
  for (const j of file.jobs) {
    if (j.deletedAt !== undefined || j.goneAt !== undefined || j.firedAt !== undefined || hiddenIds.includes(j.id)) continue
    const dueAt = j.nextFireAt
    if (dueAt === undefined || dueAt > now - FIRE_GRACE_MS) continue
    const m: MissedJob = { key: missedKey(j.id, dueAt), sessionId: file.sessionId, jobId: j.id, prompt: j.prompt, cron: j.cron, humanSchedule: j.humanSchedule ?? j.cron, recurring: j.recurring, dueAt }
    if (isStillMissed(m, file, now, dismissed)) out.push(m)
  }
  return out
}

// Closed entries older than the window no longer hide anything: dropped on save
export function prunedDismissed(dismissed: Record<string, number> | undefined, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(dismissed ?? {}).filter(([key]) => now - Number(key.slice(key.lastIndexOf('@') + 1)) <= MISSED_WINDOW_MS * 2))
}

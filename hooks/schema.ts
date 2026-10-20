// Session file: one JSON per session at <config>/clock-out/sessions/<sessionId>.json.
// Written only by that session's own module (single writer), read by every session's /clock-out and by the service.

export const SESSION_FILE_VERSION = 1

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000   // Claude Code deletes a recurring job 7 days after CronCreate

export type RunMode = 'quiet' | 'notify' | 'open'   // how the app shows a job when it fires (the app's RunMode, same names)
export const RUN_MODES: readonly RunMode[] = ['quiet', 'notify', 'open']

export type Job = {
  id: string                 // job id CronCreate returned   d0ae027c
  cron: string               // 5-field cron   3 21 * * *
  prompt: string
  recurring: boolean
  humanSchedule?: string     // "Every day at 9:03 PM"
  createdAt: number          // epoch ms of CronCreate; a job restored by --resume keeps the value recorded earlier
  expiresAt?: number         // createdAt + 7 days for recurring, absent for one-shot
  nextFireAt?: number        // epoch ms from CronCreate/CronList, scheduler offset included (the real time, not the cron minute)
  deletedAt?: number         // CronDelete
  firedAt?: number           // one-shot: the scheduled trigger ran
  goneAt?: number            // absent from CronList without a CronDelete (fired one-shot, 7-day expiry, or lost)
  reregisterTriedAt?: number // last automatic re-registration attempt
  mode?: RunMode             // set by the job_mode tool; absent = the app's per-session or default setting decides
}

// The turn ended with an answer (not a sign the work succeeded: no verifier yet) | it did not
export type TaskOutcome = 'unverified' | 'failed'

export type Run = {
  jobId?: string             // matched by prompt text (and nextFireAt when prompts repeat); absent when no job matched
  ambiguous?: true           // several jobs share the prompt and none fired within 2 min of firedAt: no jobId on purpose
  promptHead: string         // first 120 chars of the fired prompt
  firedAt: number
  finishedAt: number
  reason: string             // turn.complete reason   answer | aborted | refusal | error
  taskOutcome?: TaskOutcome  // answer → unverified, any other reason → failed; absent on runs recorded before 0.13
  durationMs: number
  answerHead: string         // first 200 chars of the answer
}

export const taskOutcomeOf = (reason: string): TaskOutcome => (reason === 'answer' ? 'unverified' : 'failed')

// A 7-day renewal in progress (reregister.ts): written before CronDelete, removed once the new job is created.
// Left behind by a crash, it is checked against CronList at the next start or heartbeat.
export type Renewal = {
  oldId: string
  cron: string
  prompt: string
  recurring: boolean
  mode?: RunMode
  phase: 'intent' | 'old_removed' | 'blocked'   // before CronDelete | old job deleted by the renewal | re-creating failed
  startedAt: number
  triedAt?: number           // last recovery attempt (a blocked renewal is retried every 10 min)
  lastError?: string
}

export type SessionFile = {
  version: typeof SESSION_FILE_VERSION
  sessionId: string
  cwd: string
  kind?: 'interactive' | 'background'   // from ~/.claude/sessions/<pid>.json when found
  pid?: number
  name?: string
  alive: boolean
  startedAt?: number
  heartbeatAt?: number       // refreshed every 60 s while the module runs
  endedAt?: number
  endReason?: string
  bgSince?: number           // first time this session was woken with --bg (later wakes must not pass flags)
  remoteSince?: number       // that first --bg start carried --remote-control: every later wake reconnects to the phone
  running?: { promptHead: string; firedAt: number; jobId?: string; ambiguous?: true }   // a scheduled job is running now (cleared when its turn ends); jobId when the prompt matched a job
  dismissed: string[]        // job ids the user hid from the service's list
  jobs: Job[]
  runs: Run[]                // newest last, at most RUNS_KEPT
  renewal?: Renewal          // a 7-day renewal not finished yet
  deliveredIds?: string[]    // inbox message ids already submitted here, newest last, at most DELIVERED_KEPT
}

export const RUNS_KEPT = 30
export const DELIVERED_KEPT = 200
const SAME_FIRE_MS = 2 * 60_000   // a fired prompt belongs to the job whose nextFireAt is this close

export function emptySessionFile(sessionId: string, cwd: string): SessionFile {
  return { version: SESSION_FILE_VERSION, sessionId, cwd, alive: false, dismissed: [], jobs: [], runs: [] }
}

export type JobMatch = { job?: Job; ambiguous?: true }

// The job a fired prompt belongs to: same prompt text, not deleted or gone. When several share the text, the one whose
// nextFireAt is nearest firedAt (within 2 min); otherwise none, marked ambiguous (never the first one by guess).
export function matchJob(file: SessionFile, prompt: string, firedAt?: number): JobMatch {
  const wanted = prompt.trim()
  const hits = file.jobs.filter(j => j.deletedAt === undefined && j.goneAt === undefined && j.prompt.trim() === wanted)
  if (hits.length <= 1) return { job: hits[0] }
  if (firedAt === undefined) return { ambiguous: true }
  const near = hits
    .filter(j => j.nextFireAt !== undefined && Math.abs(j.nextFireAt - firedAt) <= SAME_FIRE_MS)
    .sort((a, b) => Math.abs((a.nextFireAt ?? 0) - firedAt) - Math.abs((b.nextFireAt ?? 0) - firedAt))
  const [best, second] = near
  if (best === undefined) return { ambiguous: true }
  if (second !== undefined && Math.abs((second.nextFireAt ?? 0) - firedAt) === Math.abs((best.nextFireAt ?? 0) - firedAt)) return { ambiguous: true }
  return { job: best }
}

export function jobOfPrompt(file: SessionFile, prompt: string, firedAt?: number): Job | undefined {
  return matchJob(file, prompt, firedAt).job
}

export function liveJobs(file: SessionFile): Job[] {
  return file.jobs.filter(j => j.deletedAt === undefined && j.goneAt === undefined && j.firedAt === undefined)
}

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

export type Run = {
  jobId?: string             // matched by prompt text; absent when no job matched
  promptHead: string         // first 120 chars of the fired prompt
  firedAt: number
  finishedAt: number
  reason: string             // turn.complete reason   answer | aborted | refusal | error
  durationMs: number
  answerHead: string         // first 200 chars of the answer
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
  running?: { promptHead: string; firedAt: number; jobId?: string }   // a scheduled job is running now (cleared when its turn ends); jobId when the prompt matched a job
  dismissed: string[]        // job ids the user hid from the service's list
  jobs: Job[]
  runs: Run[]                // newest last, at most RUNS_KEPT
}

export const RUNS_KEPT = 30

export function emptySessionFile(sessionId: string, cwd: string): SessionFile {
  return { version: SESSION_FILE_VERSION, sessionId, cwd, alive: false, dismissed: [], jobs: [], runs: [] }
}

// The job a fired prompt belongs to: same prompt text, not deleted or gone
export function jobOfPrompt(file: SessionFile, prompt: string): Job | undefined {
  const wanted = prompt.trim()
  return file.jobs.find(j => j.deletedAt === undefined && j.goneAt === undefined && j.prompt.trim() === wanted)
}

export function liveJobs(file: SessionFile): Job[] {
  return file.jobs.filter(j => j.deletedAt === undefined && j.goneAt === undefined && j.firedAt === undefined)
}

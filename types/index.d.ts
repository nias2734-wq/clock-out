// State contract of clock-out: the overview the /clock-out pane draws (one value in the session's $.state).
// Self-contained: no import, no reference (the engine lays it beside the plugin for dependents).

export type ClockOutJobView = {
  id: string
  cron: string
  humanSchedule: string
  prompt: string
  title?: string             // short title the model gave with job_mode   "주간 보고 정리"
  recurring: boolean
  nextAt?: number            // epoch ms: nextFireAt from Claude Code when known, else computed from cron
  expiresAt?: number
  expiresInDays?: number     // ceil of days left; 0 when past
  isExpiringSoon: boolean    // within 2 days
  isDismissed: boolean
  lastRun?: { finishedAt: number; reason: string; taskOutcome?: 'unverified' | 'failed'; durationMs: number; answerHead?: string }   // taskOutcome: an answer is unverified, not success
}

export type ClockOutSessionView = {
  sessionId: string
  shortId: string            // first 8 chars
  label: string              // last path segment of cwd
  cwd: string
  kind?: 'interactive' | 'background'
  name?: string
  isAlive: boolean
  isOwn: boolean             // the session reading the overview
  nextAt?: number            // earliest nextAt over live jobs
  jobs: ClockOutJobView[]
}

export type ClockOutOverview = {
  builtAt: number
  sessions: ClockOutSessionView[]
  jobCount: number
  message?: string           // one line shown under the list (last action's outcome)
}

declare module 'claude-code' {
  interface PluginState {
    'clock-out': { overview: ClockOutOverview }
  }
}

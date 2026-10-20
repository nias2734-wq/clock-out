// State contract of clock-out: the overview the /clock-out pane draws (one value in the session's $.state).
// Self-contained: no import, no reference (the engine lays it beside the plugin for dependents).

export type ClockOutJobView = {
  id: string
  cron: string
  humanSchedule: string
  prompt: string
  recurring: boolean
  nextAt?: number            // epoch ms: nextFireAt from Claude Code when known, else computed from cron
  expiresAt?: number
  expiresInDays?: number     // ceil of days left; 0 when past
  isExpiringSoon: boolean    // within 2 days
  isDismissed: boolean
  lastRun?: { finishedAt: number; reason: string; durationMs: number; answerHead?: string }
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

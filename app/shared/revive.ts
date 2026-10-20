// Pure decisions behind reviving a stopped session. The main process (electron/main/revive.ts) runs the commands.
import type { SessionView } from './schedule'
import { parseHm } from './time'
import type { AppSettings } from './types'

// The first message a woken session gets. Fixed text on purpose: nothing from a session file is ever put into
// the prompt, so a tampered file cannot make the session do anything but check its own jobs.
export const REVIVE_MESSAGE =
  'clock-out woke this session so its scheduled jobs keep firing. Call CronList. If a job you expect is missing, ' +
  'CronCreate it again with the same cron and prompt. A recurring job that expires within a day: CronDelete it and ' +
  'CronCreate it again. Do nothing else, report in one line, then stop. Keep this session running.'

// Arguments after `claude`: flags only on the first background start (a session that already ran in the
// background keeps its saved options, and new flags would start a copy under another id).
// remoteName: that first start also carries --remote-control, and every later wake reconnects to the phone at the
// same address (measured 2026-10-19). message: the first message, REVIVE_MESSAGE unless an instruction is forwarded.
export function reviveArgs(sessionId: string, wasBackground: boolean, permission: AppSettings['permission'], remoteName?: string, message: string = REVIVE_MESSAGE): string[] {
  const args = ['--bg', '--resume', sessionId]
  if (!wasBackground) {
    args.push(...permissionArgs(permission))
    if (remoteName !== undefined) args.push('--remote-control', remoteName)
  }
  args.push(message)
  return args
}

export function permissionArgs(permission: AppSettings['permission']): string[] {
  if (permission.mode === 'bypass') return ['--dangerously-skip-permissions']
  return ['--permission-mode', 'acceptEdits', ...(permission.allowedTools.length > 0 ? ['--allowedTools', permission.allowedTools.join(',')] : [])]
}

export type ReopenReason = { kind: 'due' | 'expiry' | 'daily'; text: string }

// Why a stopped session should be woken now; undefined when it should not.
//   due    its next job is within leadMinutes
//   expiry a recurring job expires within expiryLeadHours (the woken session renews it)
//   daily  the daily sweep time (work end minus 5 minutes) has passed today, on a work day, and it was not done yet
export function reopenReason(s: SessionView, now: number, settings: AppSettings, dailyDoneToday: boolean): ReopenReason | undefined {
  if (s.isAlive || s.warnings.length > 0) return undefined
  const jobs = s.jobs.filter(j => !j.isDismissed)
  if (jobs.length === 0) return undefined
  if (s.nextAt !== undefined && s.nextAt - now <= settings.revive.leadMinutes * 60_000) {
    return { kind: 'due', text: `next job at ${new Date(s.nextAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}` }
  }
  for (const j of jobs) {
    if (j.recurring && j.expiresAt !== undefined && j.expiresAt - now <= settings.revive.expiryLeadHours * 3_600_000) {
      return { kind: 'expiry', text: `recurring job ${j.id} expires in ${j.expiresInDays ?? 0}d` }
    }
  }
  if (settings.revive.dailyAtEnd && !dailyDoneToday && isPastDailyTime(now, settings)) {
    return { kind: 'daily', text: `daily sweep at ${dailySweepHm(settings)}` }
  }
  return undefined
}

export function dailySweepHm(settings: AppSettings): string {
  const end = parseHm(settings.workHours.end)
  const m = Number.isNaN(end) ? 18 * 60 - 5 : Math.max(0, end - 5)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function isPastDailyTime(now: number, settings: AppSettings): boolean {
  const d = new Date(now)
  if (!settings.workHours.weekdays.includes(d.getDay())) return false
  const sweep = parseHm(dailySweepHm(settings))
  return d.getHours() * 60 + d.getMinutes() >= sweep
}

// "started a copy as <id>" in claude's output means flags were passed to a session with saved options
export function copyIdIn(output: string): string | undefined {
  return /started a copy as ([0-9A-Za-z_-]+)/.exec(output)?.[1]
}

// The copy a `--bg --resume <sessionId>` started instead of the session itself: claude names what it started in
// "backgrounded · <short id>" (and "started a copy as <id>" when flags caused it). undefined = the session itself came up.
export function resumedCopyIn(output: string, sessionId: string): string | undefined {
  const started = copyIdIn(output) ?? /backgrounded · ([0-9A-Za-z_-]+)/.exec(output)?.[1]
  return started !== undefined && !sessionId.startsWith(started) ? started : undefined
}

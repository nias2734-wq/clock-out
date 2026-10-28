// Pure decisions behind reviving a stopped session. The main process (electron/main/revive.ts) runs the commands.
import type { SessionView } from './schedule'
import { parseHm } from './time'
import { planPings, planZones, rangesOf } from './timeline'
import type { AppSettings, PermissionRecord } from './types'

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

// --allowedTools takes several values (<tools...>): whatever follows it up to the next flag is read as tool names, the
// first message too (measured 2026-10-20 with -p: `--allowedTools Read "msg"` lost the message). So the list comes first
// and the mode flag after it ends the list.
// 차단 목록(disallowedTools)은 넘기지 않음 | 플래그는 세션에 남아 사용자의 일반 작업까지 막으므로 플러그인(hooks/guard.ts)이 예약 실행 턴에서만 막음
export function permissionArgs(permission: AppSettings['permission']): string[] {
  if (permission.mode === 'bypass') return ['--dangerously-skip-permissions']
  const allowed = permission.allowedTools.length > 0 ? ['--allowedTools', permission.allowedTools.join(',')] : []
  return [...allowed, '--permission-mode', 'acceptEdits']
}

export function permissionRecord(permission: AppSettings['permission'], at: number): PermissionRecord {
  return { mode: permission.mode, allowedTools: [...permission.allowedTools], disallowedTools: [...permission.disallowedTools], at }
}

// The session still runs with the permission of its first background start: true when the settings now say otherwise
export function permissionDiffers(atStart: PermissionRecord, now: AppSettings['permission']): boolean {
  const same = (a: readonly string[], b: readonly string[]) => {
    const x = [...a].sort()
    const y = [...b].sort()
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  if (atStart.mode !== now.mode) return true
  // bypass ignores the allowed list; the block list is read by the plugin at every scheduled run, so it never differs
  return now.mode !== 'bypass' && !same(atStart.allowedTools, now.allowedTools)
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

// 원격 예약 작업 세션을 다시 켜는 것을 미룰 시각(epoch ms) | 지금이 근무일의 근무 영향 시간대(앱 타임라인의 빨간 칸)면 그 끝, 아니면 undefined
// 켤 때 보내는 메시지도 모델 턴이라 5시간 창을 연다   05:34 에 켜면 08:00 정렬 핑이 새 창을 못 열어 13:00 초기화가 10:34 로 당겨짐
export function remoteHoldUntil(now: number, settings: AppSettings): number | undefined {
  const d = new Date(now)
  if (!settings.workHours.weekdays.includes(d.getDay())) return undefined
  const zones = planZones(settings.workHours, planPings(settings.workHours, settings.alignPing.resetHours), settings.alignPing.enabled)
  const minute = d.getHours() * 60 + d.getMinutes()
  const range = rangesOf(zones, 'blocked').find(([a, b]) => (a < b ? minute >= a && minute < b : minute >= a || minute < b))
  if (range === undefined) return undefined
  const left = (((range[1] - minute) % 1440) + 1440) % 1440   // 자정을 넘는 시간대도 남은 분으로
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime() + left * 60_000
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

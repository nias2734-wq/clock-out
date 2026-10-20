import type { EngineInterface } from 'claude-code'

import { readAppSettings } from './appSettings'
import { blockedRun, hm, planPings, planZones, rangesOf } from './timeline'

// Checks a new job against the work day set in the clock-out app (app-settings.json). A job that would run in the
// hours that affect work (09:00 start, lunch 12–13 → 04:00 ~ 09:00) is refused once, with the reason and the free hours,
// so the model asks the person. The same cron asked again within 30 minutes goes through: the person chose it, and
// the app shows that job in red. Without the app's settings nothing is checked.

const CONFIRM_MS = 30 * 60_000
const refusedAt = new Map<string, number>()   // cron → when it was refused in this session (module memory)

const fmt = (r: [number, number]) => `${hm(r[0])} ~ ${hm(r[1])}`
const contains = (r: [number, number], m: number) => (r[0] < r[1] ? m >= r[0] && m < r[1] : m >= r[0] || m < r[1])

// The refusal text for the model, or undefined when the job may go through
export async function checkZone($: EngineInterface, cron: string): Promise<string | undefined> {
  const s = await readAppSettings($)
  const w = s?.workHours
  if (s === undefined || w === undefined) return undefined
  const plan = planPings(w, s.alignPing?.resetHours)
  const zones = planZones(w, plan, s.alignPing?.enabled !== false)
  const now = await $.clock.now()
  const hit = blockedRun(cron, zones, w.weekdays ?? [1, 2, 3, 4, 5], now)
  if (hit === undefined) return undefined

  const key = cron.trim()
  const before = refusedAt.get(key)
  if (before !== undefined && now - before < CONFIRM_MS) { refusedAt.delete(key); return undefined }
  refusedAt.set(key, now)

  const blocked = rangesOf(zones, 'blocked').find(r => contains(r, hit.minute)) ?? [hit.zone.start, hit.zone.end]
  const free = rangesOf(zones, 'free').map(fmt).join(', ')
  const moved = (hit.zone.moved ?? []).map(hm).join(', ')
  if (s.language === 'en') {
    const why = hit.zone.reason === 'shift'
      ? `A job then opens a 5-hour usage window from its full hour that is still open at the align ping before work, so the ping cannot open a fresh one and the planned ${moved} reset moves.`
      : `It is inside the 5-hour usage window that work (${w.start}) starts in, so work would not start at 0 % usage.`
    return `clock-out: this job runs at ${hm(hit.minute)}, inside the hours that affect the work day (${fmt(blocked)}). ${why} Tell the user this as information, not a rule, and mention that jobs at ${free} have no effect. If the user wants this time anyway, call CronCreate again with the same cron within 30 minutes and it will be scheduled (the clock-out app then shows it in red).`
  }
  const why = hit.zone.reason === 'shift'
    ? `이때 예약이 돌면 그 정시부터 5시간 사용량 창이 열려 출근 전 정렬 핑이 새 창을 열지 못하고, 계획한 ${moved} 초기화가 밀립니다.`
    : `출근(${w.start}) 때 쓸 5시간 사용량 창 안이라, 이때 쓰면 출근 때 사용량이 0% 에서 시작하지 않습니다.`
  return `clock-out: 이 예약은 ${hm(hit.minute)} 에 실행되는데, 이 시간(${fmt(blocked)})은 근무에 영향을 주는 시간입니다. ${why} 규칙이 아니라 참고 안내로 사용자에게 알려 주고, ${free} 에 도는 예약은 영향이 없다는 것도 함께 알려 주세요. 사용자가 이 시각을 원하면 같은 cron 으로 30분 안에 CronCreate 를 다시 호출하면 걸립니다(clock-out 앱에 빨갛게 표시됩니다).`
}

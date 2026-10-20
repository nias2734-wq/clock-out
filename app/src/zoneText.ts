import { hm, rangesOf } from '@shared/timeline'
import type { Zone } from '@shared/timeline'

import type { AppSettings } from '@shared/types'

// What a job in the hours that affect work does to the work day, in one sentence, and which hours have no effect.
// Information only: the person decides.
// Shared by the timeline (settings) and the job cards (panel).
export function blockedText(zone: Zone, zones: Zone[], workStart: string, lang: AppSettings['language']): string {
  const free = rangesOf(zones, 'free').map(([a, b]) => `${hm(a)} ~ ${hm(b)}`).join(', ')
  const moved = (zone.moved ?? []).map(hm).join(', ')
  if (lang === 'en') {
    const why = zone.reason === 'shift' ? `the ${moved} token reset may move` : `work (${workStart}) may not start at 0 % usage`
    return `Runs in hours that affect the work day: ${why}. For reference, jobs at ${free} have no effect.`
  }
  const why = zone.reason === 'shift' ? `토큰 초기화가 ${moved} 에서 밀릴 수 있습니다` : `출근(${workStart}) 때 사용량이 0% 에서 시작하지 못할 수 있습니다`
  return `근무에 영향을 주는 시간에 도는 예약입니다 — ${why}. 참고로 ${free} 에 도는 예약은 영향이 없습니다.`
}

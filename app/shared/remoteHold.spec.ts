import { describe, expect, it } from 'vitest'

import { remoteHoldUntil } from './revive'
import { DEFAULT_SETTINGS } from './types'
import type { AppSettings } from './types'

// 2026-10-27·28 의 실제 설정: 09:00 출근, 점심 11:30~13:00, 18:00 퇴근, 13·18시 초기화, 정렬 핑 켬
const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  workHours: { start: '09:00', lunchStart: '11:30', lunchEnd: '13:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
  alignPing: { enabled: true, model: 'haiku', resetHours: [13, 18] },
}
const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).getTime()   // 2026-10-27 = Tuesday

describe('remoteHoldUntil', () => {
  it('05:34 on a work day is held until the zone that moves the 08:00 ping ends', () => {
    const until = remoteHoldUntil(at(27, 5, 34), SETTINGS)
    expect(until).toBeDefined()
    const end = new Date(until ?? 0)
    expect(end.getDate()).toBe(27)
    expect(end.getHours() * 60 + end.getMinutes()).toBeGreaterThan(5 * 60 + 34)
    expect(end.getHours() * 60 + end.getMinutes()).toBeLessThanOrEqual(9 * 60)
    // 미룬 시각에 다시 물으면 더는 미루지 않는다
    expect(remoteHoldUntil(until ?? 0, SETTINGS)).toBeUndefined()
  })
  it('the 17:15 restart and the middle of the work day are not held', () => {
    expect(remoteHoldUntil(at(27, 17, 15), SETTINGS)).toBeUndefined()
    expect(remoteHoldUntil(at(27, 10, 0), SETTINGS)).toBeUndefined()
  })
  it('a weekend is not held', () => {
    expect(remoteHoldUntil(at(24, 5, 34), SETTINGS)).toBeUndefined()   // Saturday
  })
})

import { describe, expect, it } from 'vitest'

import { formatLocalStamp, formatRemaining, isAlignedReset, parseHm } from './time'

describe('time helpers', () => {
  it('parseHm', () => { expect(parseHm('09:05')).toBe(545); expect(parseHm('24:00')).toBeNaN() })
  it('formatRemaining', () => {
    const now = Date.UTC(2026, 9, 19, 0, 0, 0)
    expect(formatRemaining(now + 4 * 3600_000 + 50 * 60_000, now)).toBe('4h50m')
    expect(formatRemaining(now + 12 * 60_000, now)).toBe('12m')
    expect(formatRemaining(now + 3 * 86400_000 + 18 * 3600_000, now)).toBe('3d 18h')
  })
  it('isAlignedReset accepts the boundary hour within 3 minutes, either side', () => {
    expect(isAlignedReset(new Date(2026, 9, 19, 13, 1).getTime(), [13, 18])).toBe(true)
    expect(isAlignedReset(new Date(2026, 9, 19, 12, 59).getTime(), [13, 18])).toBe(true)
    expect(isAlignedReset(new Date(2026, 9, 19, 13, 30).getTime(), [13, 18])).toBe(false)
  })
  it('formatLocalStamp writes local wall-clock time, not UTC', () => {
    const ms = new Date(2026, 9, 19, 17, 55, 3).getTime()
    expect(formatLocalStamp(ms)).toBe('2026-10-19 17:55:03')
    expect(formatLocalStamp(ms, 'T')).toBe('2026-10-19T17:55:03')
    expect(Date.parse(formatLocalStamp(ms, 'T'))).toBe(ms)
  })
})

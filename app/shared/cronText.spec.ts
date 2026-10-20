import { describe, expect, it } from 'vitest'

import { describeCron } from './cronText'

describe('describeCron', () => {
  it('reads the common shapes', () => {
    expect(describeCron('3 21 * * *', 'ko')).toBe('매일 21:03')
    expect(describeCron('40 19 19 10 *', 'ko')).toBe('10-19 19:40')
    expect(describeCron('0 9 * * 1-5', 'ko')).toBe('평일 09:00')
    expect(describeCron('30 8 * * 1,3', 'ko')).toBe('매주 월·수 08:30')
    expect(describeCron('*/5 * * * *', 'ko')).toBe('5분마다')
    expect(describeCron('7 */2 * * *', 'ko')).toBe('2시간마다 07분')
    expect(describeCron('3 21 * * *', 'en')).toBe('daily 21:03')
  })
  it('leaves anything else as it is', () => {
    expect(describeCron('0 9 1-7 * 1', 'ko')).toBe('0 9 1-7 * 1')
    expect(describeCron('bad', 'ko')).toBe('bad')
  })
})

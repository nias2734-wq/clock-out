import { expect, test } from 'claude-code/testing'

import { cronNext, parseCron } from '../hooks/cron'

const at = (y: number, mo: number, d: number, h: number, mi: number): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

test('cronNext: daily at 21:03 from the same morning is that evening', async () => {
  expect(cronNext('3 21 * * *', at(2026, 10, 19, 10, 0))).toBe(at(2026, 10, 19, 21, 3))
})

test('cronNext: daily at 21:03 from 21:03 itself is the next day', async () => {
  expect(cronNext('3 21 * * *', at(2026, 10, 19, 21, 3))).toBe(at(2026, 10, 20, 21, 3))
})

test('cronNext: every 15 minutes', async () => {
  expect(cronNext('*/15 * * * *', at(2026, 10, 19, 10, 7))).toBe(at(2026, 10, 19, 10, 15))
})

test('cronNext: weekdays at 09:00 from a Saturday is Monday', async () => {
  // 2026-10-17 is a Saturday
  expect(cronNext('0 9 * * 1-5', at(2026, 10, 17, 12, 0))).toBe(at(2026, 10, 19, 9, 0))
})

test('cronNext: a pinned one-shot date', async () => {
  expect(cronNext('15 10 20 10 *', at(2026, 10, 19, 23, 0))).toBe(at(2026, 10, 20, 10, 15))
})

test('cronNext: day-of-month and day-of-week both set match either (standard cron)', async () => {
  // 2026-10-19 Monday; "0 8 25 * 1" fires Mon 10-19 08:00 (dow) before 10-25 (dom)
  expect(cronNext('0 8 25 * 1', at(2026, 10, 19, 7, 0))).toBe(at(2026, 10, 19, 8, 0))
})

test('parseCron rejects a 6-field or out-of-range expression', async () => {
  expect(parseCron('0 9 * * 1 2')).toBeUndefined()
  expect(parseCron('60 9 * * *')).toBeUndefined()
  expect(cronNext('bad', 0)).toBeUndefined()
})

// ── 0.13: day-of-week ranges through 7 (F-08). The same cases are expected of app/shared/cron.ts. ──

const dows = (cron: string) => [...(parseCron(cron)?.dow ?? [])].sort((a, b) => a - b)

test('day-of-week: 5-7, 0-7, 1-7/2, 7 and 5,6,0 expand over 0-7 before 7 becomes Sunday', async () => {
  expect(dows('0 9 * * 5-7')).toEqual([0, 5, 6])
  expect(dows('0 9 * * 5,6,0')).toEqual([0, 5, 6])
  expect(dows('0 9 * * 0-7')).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(dows('0 9 * * 1-7/2')).toEqual([0, 1, 3, 5])
  expect(dows('0 9 * * 7')).toEqual([0])
})

test('day-of-week: 7-5 is refused, and the next times of the Sunday ranges', async () => {
  expect(parseCron('0 9 * * 7-5')).toBeUndefined()
  expect(parseCron('0 9 * * 8')).toBeUndefined()
  // 2026-10-19 is a Monday
  expect(cronNext('0 9 * * 5-7', at(2026, 10, 19, 10, 0))).toBe(at(2026, 10, 23, 9, 0))
  expect(cronNext('0 9 * * 5-7', at(2026, 10, 24, 10, 0))).toBe(at(2026, 10, 25, 9, 0))
  expect(cronNext('0 9 * * 5,6,0', at(2026, 10, 24, 10, 0))).toBe(at(2026, 10, 25, 9, 0))
  expect(cronNext('0 9 * * 7', at(2026, 10, 19, 10, 0))).toBe(at(2026, 10, 25, 9, 0))
  expect(cronNext('0 9 * * 0-7', at(2026, 10, 19, 10, 0))).toBe(at(2026, 10, 20, 9, 0))
  expect(cronNext('0 9 * * 1-7/2', at(2026, 10, 23, 10, 0))).toBe(at(2026, 10, 25, 9, 0))
})

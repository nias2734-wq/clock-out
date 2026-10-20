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

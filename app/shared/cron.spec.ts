import { describe, expect, it } from 'vitest'

import { cronNext, parseCron } from './cron'

// Same expectations as the plugin's tests/cron.test.ts (F-08): the two copies must agree
const at = (y: number, mo: number, d: number, h: number, mi: number): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()
const dows = (cron: string) => [...(parseCron(cron)?.dow ?? [])].sort((a, b) => a - b)

describe('cron day-of-week through 7', () => {
  it('5-7, 0-7, 1-7/2, 7 and 5,6,0 expand over 0-7 before 7 becomes Sunday', () => {
    expect(dows('0 9 * * 5-7')).toEqual([0, 5, 6])
    expect(dows('0 9 * * 5,6,0')).toEqual([0, 5, 6])
    expect(dows('0 9 * * 0-7')).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(dows('0 9 * * 1-7/2')).toEqual([0, 1, 3, 5])
    expect(dows('0 9 * * 7')).toEqual([0])
  })
  it('7-5 is refused, and the next times of the Sunday ranges', () => {
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
})

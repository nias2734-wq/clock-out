import { describe, expect, it } from 'vitest'

import { isStillMissed, missedKey, missedOf, prunedDismissed, MISSED_WINDOW_MS } from './missed'
import type { SessionFile } from './schedule'

const MIN = 60_000
const HOUR = 60 * MIN
// Tuesday 2026-10-20 09:30 local: the PC slept through the 09:00 job
const NOW = new Date(2026, 9, 20, 9, 30).getTime()
const DUE = new Date(2026, 9, 20, 9, 0).getTime()

function file(extra: Partial<SessionFile> = {}, job: Partial<SessionFile['jobs'][number]> = {}): SessionFile {
  return {
    version: 1, sessionId: 'aaaa0000-0000-4000-8000-000000000001', cwd: 'C:\\proj', alive: false, dismissed: [], runs: [],
    jobs: [{ id: 'j1', cron: '0 9 * * *', prompt: 'build the report', recurring: true, createdAt: NOW - 2 * 24 * HOUR, nextFireAt: DUE, ...job }],
    ...extra,
  }
}

describe('missedOf', () => {
  it('a stopped session whose nextFireAt went by without a run: one missed job', () => {
    const m = missedOf(file(), NOW, false, [], undefined)
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ key: missedKey('j1', DUE), jobId: 'j1', prompt: 'build the report', dueAt: DUE })
  })
  it('not missed: running session, hidden job, closed by the person, run since, deleted or fired one-shot', () => {
    expect(missedOf(file(), NOW, true, [], undefined)).toEqual([])
    expect(missedOf(file(), NOW, false, ['j1'], undefined)).toEqual([])
    expect(missedOf(file(), NOW, false, [], { [missedKey('j1', DUE)]: NOW })).toEqual([])
    const ran = { jobId: 'j1', promptHead: 'build the report', firedAt: DUE + 30_000, finishedAt: DUE + 5 * MIN, reason: 'answer', durationMs: 1, answerHead: '' }
    expect(missedOf(file({ runs: [ran] }), NOW, false, [], undefined)).toEqual([])
    // a run recorded before jobIds (matched by its prompt head)
    expect(missedOf(file({ runs: [{ ...ran, jobId: undefined }] }), NOW, false, [], undefined)).toEqual([])
    expect(missedOf(file({ running: { promptHead: 'build the report', firedAt: DUE + 10_000, jobId: 'j1' } }), NOW, false, [], undefined)).toEqual([])
    expect(missedOf(file({}, { deletedAt: DUE - HOUR }), NOW, false, [], undefined)).toEqual([])
    expect(missedOf(file({}, { firedAt: DUE }), NOW, false, [], undefined)).toEqual([])
  })
  it('only the last 24 hours, and not within 2 min of the fire time (Claude may still be on it)', () => {
    expect(missedOf(file({}, { nextFireAt: NOW - MISSED_WINDOW_MS - MIN }), NOW, false, [], undefined)).toEqual([])
    expect(missedOf(file({}, { nextFireAt: NOW - MIN }), NOW, false, [], undefined)).toEqual([])
    expect(missedOf(file({}, { nextFireAt: undefined }), NOW, false, [], undefined)).toEqual([])
    // a run from the day before does not count for today's fire
    const yesterday = { jobId: 'j1', promptHead: 'x', firedAt: DUE - 24 * HOUR, finishedAt: DUE - 23 * HOUR, reason: 'answer', durationMs: 1, answerHead: '' }
    expect(missedOf(file({ runs: [yesterday] }), NOW, false, [], undefined)).toHaveLength(1)
  })
})

describe('isStillMissed', () => {
  const m = missedOf(file(), NOW, false, [], undefined)[0]!
  it('stays after the session came up (its plugin moved nextFireAt on) until it runs, is closed or a day passes', () => {
    expect(isStillMissed(m, file({ alive: true }, { nextFireAt: DUE + 24 * HOUR }), NOW + 10 * MIN, undefined)).toBe(true)
    expect(isStillMissed(m, file({ runs: [{ jobId: 'j1', firedAt: NOW + MIN, finishedAt: NOW + 2 * MIN, reason: 'answer', durationMs: 1, answerHead: '' }] }), NOW + 5 * MIN, undefined)).toBe(false)
    expect(isStillMissed(m, file(), NOW, { [m.key]: NOW })).toBe(false)
    expect(isStillMissed(m, file(), DUE + MISSED_WINDOW_MS + 1, undefined)).toBe(false)
    expect(isStillMissed(m, undefined, NOW, undefined)).toBe(false)
  })
})

describe('prunedDismissed', () => {
  it('drops closed entries whose due time is long past', () => {
    expect(prunedDismissed({ [missedKey('a', NOW - 3 * 24 * HOUR)]: 1, [missedKey('b', NOW - HOUR)]: 2 }, NOW)).toEqual({ [missedKey('b', NOW - HOUR)]: 2 })
  })
})

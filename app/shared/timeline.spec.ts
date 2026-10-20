import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { analyzeDay, blockedRun, hm, jobZones, occurrencesOn, planPings, planZones, simulateDay } from './timeline'
import type { WorkHours } from './types'

const W: WorkHours = { start: '09:00', lunchStart: '12:00', lunchEnd: '13:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] }
const WORKDAY = { yesterday: true, today: true }

describe('planPings', () => {
  it('09–18, lunch 12–13: pings 08:05 and 13:05, resets 13:00 and 18:00, the first ping is before work', () => {
    const p = planPings(W)
    expect(p.pings.map(hm)).toEqual(['08:05', '13:05'])
    expect(p.targets.map(hm)).toEqual(['13:00', '18:00'])
    expect(p.beforeStart.map(hm)).toEqual(['08:05'])
    expect(p.endAligned).toBe(true)
  })
  it('uses the lunch end (not the start time): lunch ends 12:30 → windows 07–12, 12–17; the end 18:00 is not a reset', () => {
    const p = planPings({ ...W, lunchStart: '11:30', lunchEnd: '12:30' })
    expect(p.pings.map(hm)).toEqual(['07:05', '12:05'])
    expect(p.targets.map(hm)).toEqual(['12:00', '17:00'])
    expect(p.endAligned).toBe(false)
  })
  it('chosen reset times win: 19 and 14 → pings 09:05 and 14:05', () => {
    const p = planPings(W, [19, 14])
    expect(p.targets.map(hm)).toEqual(['14:00', '19:00'])
    expect(p.pings.map(hm)).toEqual(['09:05', '14:05'])
    expect(p.isCustom).toBe(true)
    expect(p.tooClose).toEqual([])
  })
  it('a reset less than 5 hours after the previous one cannot happen: 12 and 15 → 15:00 too close', () => {
    expect(planPings(W, [12, 15]).tooClose.map(hm)).toEqual(['15:00'])
    expect(planPings(W, [8, 13, 18, 23]).tooClose).toEqual([])
    expect(planPings(W, [1, 22]).tooClose.map(hm)).toEqual(['01:00'])   // 22:00 → 01:00 is only 3 hours
  })
})

describe('simulateDay', () => {
  it('pings + work, no jobs: 08–13, 13–18, then nothing until the next call', () => {
    const ws = simulateDay(W, planPings(W), [], WORKDAY, true)
    // work resumes at 13:00, before the 13:05 ping, so work opens the afternoon window
    expect(ws.map(x => `${hm(x.start)}-${hm(x.end)} ${x.openedBy.kind}`)).toEqual(['08:00-13:00 ping', '13:00-18:00 work'])
  })
  it('without the ping the first window opens at work start and drifts: 09–14, 14–19', () => {
    const ws = simulateDay(W, planPings(W), [], WORKDAY, false)
    expect(ws.map(x => `${hm(x.start)}-${hm(x.end)}`)).toEqual(['09:00-14:00', '14:00-19:00'])
  })
  it('a nightly job opens its own window after work', () => {
    const jobs = [{ id: 'n', label: 'nightly', yesterday: [21 * 60 + 33], today: [21 * 60 + 33] }]
    const ws = simulateDay(W, planPings(W), jobs, WORKDAY, true)
    expect(ws.map(x => `${hm(x.start)}-${hm(x.end)} ${x.openedBy.kind}`)).toEqual(['21:00-02:00 job', '08:00-13:00 ping', '13:00-18:00 work', '21:00-02:00 job'])
  })
})

describe('analyzeDay', () => {
  it('a 06:00 job opens 06–11 first: the 08:05 ping does nothing, 13:00 and 18:00 are missed, the job is named', () => {
    const jobs = [{ id: 'early', label: 'early job', yesterday: [360], today: [360] }]
    const r = analyzeDay(W, planPings(W), jobs, WORKDAY, true)
    expect(r.windows.map(x => `${hm(x.start)}-${hm(x.end)}`)).toEqual(['06:00-11:00', '11:00-16:00', '16:00-21:00'])
    expect(r.missedTargets.map(hm)).toEqual(['13:00', '18:00'])
    expect(r.conflicts).toEqual([{ jobId: 'early', label: 'early job', minute: 360, moved: [780, 1080] }])
  })
  it('the nightly job does not conflict and both targets are hit', () => {
    const jobs = [{ id: 'n', label: 'nightly', yesterday: [21 * 60 + 33], today: [21 * 60 + 33] }]
    const r = analyzeDay(W, planPings(W), jobs, WORKDAY, true)
    expect(r.missedTargets).toEqual([])
    expect(r.conflicts).toEqual([])
    expect(r.resets.filter(x => x.isTarget).map(x => hm(x.minute))).toEqual(['13:00', '18:00'])
  })
})

describe('jobZones', () => {
  it('09–18, lunch 12–13: jobs free until 04:00, keep 04–09 empty, 09–18 shares the work limit, free again from 18:00', () => {
    const z = jobZones(W, planPings(W), [], WORKDAY, true)
    expect(z.map(x => `${hm(x.start)}-${hm(x.end)} ${x.kind}${x.reason ? ` ${x.reason}` : ''}${x.moved ? ` ${x.moved.map(hm).join(',')}` : ''}`)).toEqual([
      '00:00-04:00 free',
      '04:00-08:00 blocked shift 13:00,18:00',
      '08:00-09:00 blocked preWork',
      '09:00-18:00 shared',
      '18:00-00:00 free',
    ])
  })
})

describe('blockedRun', () => {
  const zones = planZones(W, planPings(W), true)
  const monday = new Date(2026, 9, 19).getTime()   // 2026-10-19 is a Monday
  it('finds a daily 06:30 job in the keep-empty hours, and says what it moves', () => {
    const b = blockedRun('30 6 * * *', zones, W.weekdays, monday)
    expect(b && hm(b.minute)).toBe('06:30')
    expect(b?.zone.reason).toBe('shift')
    expect(b?.zone.moved?.map(hm)).toEqual(['13:00', '18:00'])
  })
  it('08:30 breaks the 0 % start, 03:30 and 10:00 are fine, a weekend-only 06:30 is fine', () => {
    expect(blockedRun('30 8 * * *', zones, W.weekdays, monday)?.zone.reason).toBe('preWork')
    expect(blockedRun('30 3 * * *', zones, W.weekdays, monday)).toBeUndefined()
    expect(blockedRun('0 10 * * *', zones, W.weekdays, monday)).toBeUndefined()
    expect(blockedRun('30 6 * * 0,6', zones, W.weekdays, monday)).toBeUndefined()
  })
})

describe('hooks/timeline.ts', () => {
  it('is the same file as shared/timeline.ts (the plugin checks new jobs with it)', () => {
    const app = readFileSync(join(__dirname, 'timeline.ts'), 'utf8')
    const plugin = readFileSync(join(__dirname, '..', '..', 'hooks', 'timeline.ts'), 'utf8')
    expect(plugin).toBe(app)
  })
})

describe('occurrencesOn', () => {
  it('lists the fire minutes of a day', () => {
    const day = new Date(2026, 9, 19).getTime()
    expect(occurrencesOn('3 21 * * *', day)).toEqual([21 * 60 + 3])
    expect(occurrencesOn('0 */6 * * *', day)).toEqual([0, 360, 720, 1080])
    expect(occurrencesOn('40 19 20 10 *', day)).toEqual([])
  })
})

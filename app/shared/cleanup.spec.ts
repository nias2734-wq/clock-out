import { describe, expect, it } from 'vitest'

import { attachTargets, clearHow, idleSince, isAttachedTo, isAutoStopDue, stopBlock, stopWarns, tidyList, tidyTargets } from './cleanup'
import type { SessionView } from './schedule'

const NOW = new Date(2026, 9, 20, 10, 0).getTime()
const MIN = 60_000
const ID = '1a2b3c4d-0000-4000-8000-000000000001'
const CLEANUP = { auto: true, idleMinutes: 30 }

function view(extra: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: ID, shortId: '1a2b3c4d', label: 'docs', cwd: 'C:\\docs', name: 'nightly docs', isAlive: true, source: 'plugin', warnings: [],
    runsIn: 'background', liveSince: NOW - 120 * MIN, jobs: [],
    done: [{ at: NOW - 50 * MIN, jobId: 'job00001', prompt: '리마인더', recurring: false, finishedAt: NOW - 45 * MIN, reason: 'answer', durationMs: 5_000, answerHead: 'ok' }],
    ...extra,
  }
}

describe('stopBlock', () => {
  it('lets an idle background session go', () => {
    expect(stopBlock(view(), false)).toBeUndefined()
  })
  it('keeps the remote jobs session, a terminal session and a running job', () => {
    expect(stopBlock(view(), true)).toBe('remote')
    expect(stopBlock(view({ runsIn: 'terminal' }), false)).toBe('terminal')
    expect(stopBlock(view({ runsIn: undefined }), false)).toBe('terminal')
    expect(stopBlock(view({ running: { promptHead: 'x', firedAt: NOW } }), false)).toBe('running')
  })
})

describe('stopWarns', () => {
  it('asks first for an answer wait or an attach window, and ignores "working" (a stopped session shows it too)', () => {
    expect(stopWarns({ state: 'working', isAttached: false })).toEqual([])
    expect(stopWarns({ state: 'done', isAttached: false })).toEqual([])
    expect(stopWarns({ state: 'blocked', isAttached: false })).toEqual(['blocked'])
    expect(stopWarns({ state: 'blocked', isAttached: true })).toEqual(['blocked', 'attached'])
  })
})

describe('tidyTargets', () => {
  it('takes running background sessions with no job left that are not blocked', () => {
    const job = { id: 'job00002', cron: '0 23 * * *', humanSchedule: '0 23 * * *', prompt: 'nightly', recurring: true, isExpiringSoon: false, isDismissed: false }
    const idle = view()
    const hiddenJob = view({ sessionId: 'b', jobs: [{ ...job, isDismissed: true }] })
    const withJob = view({ sessionId: 'c', jobs: [job] })
    const stopped = view({ sessionId: 'd', isAlive: false })
    const terminal = view({ sessionId: 'e', runsIn: 'terminal' })
    const running = view({ sessionId: 'f', running: { promptHead: 'x', firedAt: NOW } })
    const remote = view({ sessionId: 'g' })
    expect(tidyTargets([idle, hiddenJob, withJob, stopped, terminal, running, remote], 'g')).toEqual([idle, hiddenJob])
  })
})

describe('clearHow', () => {
  const job = { id: 'job00002', cron: '0 23 * * *', humanSchedule: '0 23 * * *', prompt: 'nightly', recurring: true, isExpiringSoon: false, isDismissed: false }
  it('stops a running background session with no job left, else only hides', () => {
    expect(clearHow(view(), undefined)).toBe('stop')
    expect(clearHow(view({ jobs: [{ ...job, isDismissed: true }] }), undefined)).toBe('stop')
    expect(clearHow(view({ isAlive: false }), undefined)).toBe('hide')
    expect(clearHow(view({ jobs: [job] }), undefined)).toBe('hide')
    expect(clearHow(view(), 'terminal')).toBe('hide')
    expect(clearHow(view(), 'remote')).toBe('hide')
  })
  it('waits while a job runs', () => {
    expect(clearHow(view(), 'running')).toBeUndefined()
  })
})

describe('tidyList', () => {
  it('stops the tidy targets and only hides stopped sessions with only done rows', () => {
    const job = { id: 'job00002', cron: '0 23 * * *', humanSchedule: '0 23 * * *', prompt: 'nightly', recurring: true, isExpiringSoon: false, isDismissed: false }
    const idle = view()
    const linked = view({ sessionId: 'b', remoteUrl: 'https://claude.ai/code/x' })
    const stoppedDone = view({ sessionId: 'c', isAlive: false })
    const stoppedWithJob = view({ sessionId: 'd', isAlive: false, jobs: [job] })
    const stoppedRemote = view({ sessionId: 'g', isAlive: false })
    const terminal = view({ sessionId: 'e', runsIn: 'terminal' })
    expect(tidyList([idle, linked, stoppedDone, stoppedWithJob, stoppedRemote, terminal], 'g')).toEqual([{ s: idle, stop: true }, { s: stoppedDone, stop: false }])
  })
})

describe('attachTargets', () => {
  it('reads claude attach command lines and skips the desktop app', () => {
    const out = [
      '"C:\\Program Files\\WindowsApps\\Claude_2.42304.2.0_x64__pzs8sxrjxfjjc\\app\\claude.exe" --type=renderer --desktop-features="{\\"sshAttachmentTransport\\":1}"',
      'claude attach 5e6f7a8b',
      'claude attach 1a2b3c4d',
      '"C:\\Users\\user\\.local\\bin\\claude.exe" attach "nightly docs"',
      'claude --bg --resume 9c0d1e2f attach',
      '',
    ].join('\r\n')
    expect(attachTargets(out)).toEqual(['5e6f7a8b', '1a2b3c4d', 'nightly docs'])
  })
  it('matches by short id, full id or name', () => {
    expect(isAttachedTo(view(), ['1a2b3c4d'])).toBe(true)
    expect(isAttachedTo(view(), [ID])).toBe(true)
    expect(isAttachedTo(view(), ['nightly docs'])).toBe(true)
    expect(isAttachedTo(view(), ['5e6f7a8b', 'dc86'])).toBe(false)
  })
})

describe('idleSince', () => {
  it('takes the newest of the last run end and the process start', () => {
    expect(idleSince(view())).toBe(NOW - 45 * MIN)
    expect(idleSince(view({ liveSince: NOW - 10 * MIN }))).toBe(NOW - 10 * MIN)
    expect(idleSince(view({ done: [{ at: NOW - 40 * MIN, prompt: 'p', recurring: false }] }))).toBe(NOW - 40 * MIN)   // a one-shot without a run record
    expect(idleSince(view({ done: [], liveSince: undefined }))).toBeUndefined()
  })
})

describe('isAutoStopDue', () => {
  it('stops a background session with no job left after the idle minutes', () => {
    expect(isAutoStopDue(view(), false, CLEANUP, NOW)).toBe(true)
    expect(isAutoStopDue(view(), false, { auto: true, idleMinutes: 60 }, NOW)).toBe(false)
  })
  it('keeps a session with a job left: the daily sweep woke it for that', () => {
    const job = { id: 'job00002', cron: '0 23 * * *', humanSchedule: '0 23 * * *', prompt: 'nightly', recurring: true, isExpiringSoon: false, isDismissed: false }
    expect(isAutoStopDue(view({ jobs: [job] }), false, CLEANUP, NOW)).toBe(false)
    expect(isAutoStopDue(view({ jobs: [{ ...job, isDismissed: true }] }), false, CLEANUP, NOW)).toBe(true)   // a hidden job is not woken for either
  })
  it('never when off, stopped, remote, in a terminal, running, under Remote Control or of unknown idle time', () => {
    expect(isAutoStopDue(view(), false, { auto: false, idleMinutes: 30 }, NOW)).toBe(false)
    expect(isAutoStopDue(view({ isAlive: false }), false, CLEANUP, NOW)).toBe(false)
    expect(isAutoStopDue(view(), true, CLEANUP, NOW)).toBe(false)
    expect(isAutoStopDue(view({ runsIn: 'terminal' }), false, CLEANUP, NOW)).toBe(false)
    expect(isAutoStopDue(view({ running: { promptHead: 'x', firedAt: NOW - 60 * MIN } }), false, CLEANUP, NOW)).toBe(false)
    expect(isAutoStopDue(view({ remoteUrl: 'https://claude.ai/code/session_x' }), false, CLEANUP, NOW)).toBe(false)
    expect(isAutoStopDue(view({ done: [], liveSince: undefined }), false, CLEANUP, NOW)).toBe(false)
  })
})

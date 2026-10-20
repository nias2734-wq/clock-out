import { describe, expect, it } from 'vitest'

import { doneOf, jobsFromTranscript, liveTranscriptJobs, overviewOf, prunedCleared, remoteIsOn, sessionViewOf, validateSessionFile } from './schedule'
import type { SessionFile } from './schedule'

const NOW = new Date(2026, 9, 19, 10, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

function file(extra: Partial<SessionFile> = {}): SessionFile {
  return {
    version: 1, sessionId: 'aaaa0000-0000-4000-8000-000000000001', cwd: '/home/alice/tools', alive: true, heartbeatAt: NOW - 30_000,
    dismissed: [], runs: [],
    jobs: [
      { id: 'd0ae027c', cron: '3 21 * * *', prompt: 'nightly', recurring: true, humanSchedule: 'Every day at 9:03 PM', createdAt: NOW - 6 * DAY, expiresAt: NOW + DAY, nextFireAt: NOW + 11.5 * 60 * 60 * 1000 },
      { id: 'gone0001', cron: '0 0 * * *', prompt: 'x', recurring: true, createdAt: 1, deletedAt: NOW - 1 },
      { id: 'once0001', cron: '40 19 19 10 *', prompt: 'evening', recurring: false, createdAt: NOW - DAY },
    ],
    ...extra,
  }
}

describe('sessionViewOf / overviewOf', () => {
  it('keeps live jobs, computes next (nextFireAt first, cron fallback), expiry and the session next', () => {
    const v = sessionViewOf(file(), NOW, true, 'plugin')
    expect(v.jobs.map(j => j.id)).toEqual(['once0001', 'd0ae027c'])   // sorted by next run
    expect(v.jobs[1]?.expiresInDays).toBe(1)
    expect(v.jobs[1]?.isExpiringSoon).toBe(true)
    expect(v.jobs[0]?.nextAt).toBe(new Date(2026, 9, 19, 19, 40).getTime())
    expect(v.nextAt).toBe(new Date(2026, 9, 19, 19, 40).getTime())
    expect(v.label).toBe('tools')
  })
  it('a dismissed job does not count for the session next or the job count', () => {
    const v = sessionViewOf(file({ dismissed: ['once0001'] }), NOW, false, 'plugin')
    expect(v.nextAt).toBe(NOW + 11.5 * 60 * 60 * 1000)
    const o = overviewOf([v], NOW)
    expect(o.jobCount).toBe(1)
    expect(o.nextSession?.shortId).toBe('aaaa0000')
  })
})

describe('doneOf / done-only sessions', () => {
  const fired = file({
    jobs: [
      { id: 'once0002', cron: '7 9 19 10 *', prompt: 'reminder', recurring: false, createdAt: NOW - DAY, firedAt: NOW - 60 * 60 * 1000, mode: 'open' },
      { id: 'once0003', cron: '7 9 10 10 *', prompt: 'too old', recurring: false, createdAt: NOW - 10 * DAY, firedAt: NOW - 8 * DAY },
      { id: 'once0004', cron: '0 8 19 10 *', prompt: 'no run record', recurring: false, createdAt: NOW - DAY, firedAt: NOW - 2 * 60 * 60 * 1000 },
    ],
    runs: [
      { jobId: 'once0002', firedAt: NOW - 61 * 60 * 1000, finishedAt: NOW - 60 * 60 * 1000, reason: 'answer', durationMs: 60_000, answerHead: 'sent' },
      { promptHead: 'gone job', firedAt: NOW - 3 * DAY, finishedAt: NOW - 3 * DAY + 5000, reason: 'error', durationMs: 5000, answerHead: 'x' },
      { jobId: 'old', firedAt: NOW - 9 * DAY, finishedAt: NOW - 9 * DAY, reason: 'answer', durationMs: 1, answerHead: '' },
    ],
  })
  it('lists runs of the last 7 days and fired one-shots without a run, newest first, without duplicates', () => {
    const done = sessionViewOf(fired, NOW, false, 'plugin').done
    expect(done.map(d => d.jobId ?? d.prompt)).toEqual(['once0002', 'once0004', 'gone job'])
    expect(done[0]).toMatchObject({ prompt: 'reminder', recurring: false, reason: 'answer', answerHead: 'sent' })
    expect(done[1]?.reason).toBeUndefined()
  })
  it('keeps a session with nothing scheduled but something done this week, and drops it after 7 days', () => {
    const v = sessionViewOf(fired, NOW, false, 'plugin')
    expect(v.jobs).toEqual([])
    expect(overviewOf([v], NOW).sessions).toHaveLength(1)
    expect(overviewOf([sessionViewOf(fired, NOW + 8 * DAY, false, 'plugin')], NOW + 8 * DAY).sessions).toHaveLength(0)
  })
  it('hides what ended at or before the clean-up time, and drops a cleaned session with nothing left', () => {
    // once0002 ended 60 min ago, once0004 fired 2 h ago without a run, 'gone job' ended 3 days ago
    expect(doneOf(fired, NOW, NOW - 90 * 60 * 1000).map(d => d.jobId ?? d.prompt)).toEqual(['once0002'])
    expect(doneOf(fired, NOW, NOW - 60 * 60 * 1000)).toEqual([])
    const cleaned = sessionViewOf(fired, NOW, false, 'plugin', [], NOW - 1000)
    expect(cleaned.done).toEqual([])
    expect(overviewOf([cleaned], NOW).sessions).toHaveLength(0)
    // a run that ends after the clean-up shows again
    const later = { ...fired, runs: [...fired.runs, { jobId: 'x', promptHead: 'after', firedAt: NOW - 500, finishedAt: NOW - 100, reason: 'answer', durationMs: 400, answerHead: '' }] }
    expect(sessionViewOf(later, NOW, false, 'plugin', [], NOW - 1000).done.map(d => d.prompt)).toEqual(['after'])
  })
  it('keeps clean-up times of the last 7 days only', () => {
    expect(prunedCleared({ a: NOW - DAY, b: NOW - 8 * DAY }, NOW)).toEqual({ a: NOW - DAY })
  })
  it('passes the job mode to the job view', () => {
    const v = sessionViewOf(file({ jobs: [{ id: 'm1', cron: '0 9 * * *', prompt: 'p', recurring: true, createdAt: NOW, mode: 'quiet' }] }), NOW, true, 'plugin')
    expect(v.jobs[0]?.mode).toBe('quiet')
  })
})

describe('validateSessionFile', () => {
  it('passes a sound file and flags a bad id, missing cwd, future mtime, bad cron', () => {
    expect(validateSessionFile(file(), NOW, NOW, true)).toEqual([])
    const bad = file({ sessionId: 'not-a-uuid', jobs: [{ id: 'j', cron: 'every day', prompt: 'p', recurring: true, createdAt: 1 }] })
    const w = validateSessionFile(bad, NOW + 60 * 60 * 1000, NOW, false)
    expect(w).toContain('session id is not a UUID')
    expect(w).toContain('working folder does not exist')
    expect(w).toContain('file is dated in the future')
    expect(w).toContain('a job has a malformed cron')
  })
})

describe('transcripts', () => {
  const ts = (ms: number) => new Date(ms).toISOString()
  const create = (callId: string, cron: string, prompt: string, recurring: boolean, at: number) =>
    JSON.stringify({ type: 'assistant', timestamp: ts(at), cwd: 'C:\\work\\proj', message: { content: [{ type: 'tool_use', id: callId, name: 'CronCreate', input: { cron, prompt, recurring } }] } })
  const result = (callId: string, text: string, at: number) =>
    JSON.stringify({ type: 'user', timestamp: ts(at), message: { content: [{ type: 'tool_result', tool_use_id: callId, content: text }] } })

  it('pairs CronCreate calls with their result ids and drops cancelled, fired and expired jobs', () => {
    const lines = [
      create('c1', '3 21 * * *', 'nightly', true, NOW - 2 * DAY), result('c1', 'Scheduled recurring job abc12345 (Every day at 9:03 PM). Next run: …', NOW - 2 * DAY + 500),
      create('c1', '3 21 * * *', 'nightly', true, NOW - 2 * DAY),   // request copy of the same call
      create('c2', '0 9 * * *', 'old', true, NOW - 8 * DAY), result('c2', 'Scheduled recurring job old00001 (x)', NOW - 8 * DAY),
      create('c3', '15 9 19 10 *', 'fired', false, NOW - DAY), result('c3', 'Scheduled one-shot task fired001 (x)', NOW - DAY),
      create('c4', '0 9 * * *', 'del', true, NOW - DAY), result('c4', 'Scheduled recurring job del00001 (x)', NOW - DAY),
      result('x', 'Cancelled job del00001.', NOW - 1000),
      create('c5', '0 9 * * *', 'nores', true, NOW - DAY),
      'not json',
    ]
    const all = jobsFromTranscript(lines)
    expect(all.map(j => j.id).sort()).toEqual(['abc12345', 'del00001', 'fired001', 'old00001'])
    expect(all.find(j => j.id === 'abc12345')?.cwd).toBe('C:\\work\\proj')
    const live = liveTranscriptJobs(all, NOW)
    expect(live.map(j => j.id)).toEqual(['abc12345'])
  })
})

describe('remoteIsOn', () => {
  it('is on only while the setting is on and the session runs', () => {
    expect(remoteIsOn({ enabled: true, isAlive: true })).toBe(true)
    expect(remoteIsOn({ enabled: true, isAlive: false })).toBe(false)    // starting or failed: the button starts it as before
    expect(remoteIsOn({ enabled: false, isAlive: true })).toBe(false)    // turned off, claude stop not through yet
    expect(remoteIsOn(undefined)).toBe(false)
  })
})

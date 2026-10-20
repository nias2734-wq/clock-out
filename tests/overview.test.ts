import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryFs, runCommand } from './support'

const NOW = new Date(2026, 9, 19, 10, 0, 0, 0).getTime()   // 2026-10-19 10:00 local
const MIN = 60_000
const DAY = 24 * 60 * MIN
const ROOT = '/home/alice/.claude/clock-out/sessions'
const LIVE = '/home/alice/.claude/sessions'
const OWN = 'cccc0000-0000-4000-8000-000000000003'

function sessionFile(id: string, cwd: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, sessionId: id, cwd, alive: false, dismissed: [], jobs: [], runs: [], ...extra })
}

function fixture(on: On): Map<string, string> {
  const files = new Map<string, string>()
  // running: fresh heartbeat, one recurring job due tonight
  files.set(`${ROOT}/aaaa0000-0000-4000-8000-000000000001.json`, sessionFile('aaaa0000-0000-4000-8000-000000000001', '/home/alice/tools', {
    alive: true, heartbeatAt: NOW - 30_000,
    jobs: [{ id: 'd0ae027c', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, humanSchedule: 'Every day at 9:03 PM', createdAt: NOW - 6 * DAY, expiresAt: NOW + 1 * DAY, nextFireAt: NOW + 11 * 60 * MIN + 33 * MIN }],
    runs: [{ jobId: 'd0ae027c', promptHead: 'nightly sync', firedAt: NOW - 13 * 60 * MIN, finishedAt: NOW - 13 * 60 * MIN + 4000, reason: 'answer', durationMs: 4000, answerHead: 'done' }],
  }))
  // stopped: stale heartbeat, one one-shot without nextFireAt (computed from cron), one deleted job
  files.set(`${ROOT}/bbbb0000-0000-4000-8000-000000000002.json`, sessionFile('bbbb0000-0000-4000-8000-000000000002', 'C:\\Users\\alice\\proj', {
    alive: true, heartbeatAt: NOW - 10 * MIN,
    jobs: [
      { id: 'once0001', cron: '40 19 19 10 *', prompt: 'evening task', recurring: false, createdAt: NOW - DAY },
      { id: 'gone0001', cron: '0 0 * * *', prompt: 'x', recurring: true, createdAt: NOW - DAY, deletedAt: NOW - 1000 },
    ],
  }))
  // this session: no jobs → left out
  files.set(`${ROOT}/${OWN}.json`, sessionFile(OWN, '/home/alice/here', { alive: true, heartbeatAt: NOW }))
  files.set(`${ROOT}/_stamp`, 'x')
  memoryFs(on, files)
  return files
}

function session(on: On): void {
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: OWN }))
  on('session.cwd', () => ({ value: '/home/alice/here' }))
}

test('/clock-out lists sessions by next run with state, real next time, expiry and last run', async ($, on) => {
  fixture(on)
  session(on)
  const clock = mock.clock(on)
  await clock.set(NOW)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no surface in test' } }))

  const ran = await runCommand($, 'clock-out')
  const text = ran.text ?? ''
  const lines = text.split('\n')

  // stopped session first: its one-shot at 19:40 comes before the running session's 21:33
  expect(lines[0]).toBe('proj · bbbb0000  stopped  1 job(s)  next 19:40')
  expect(lines[1]).toContain('[once0001] 40 19 19 10 * · next 19:40 | evening task')
  expect(lines[2]).toBe('tools · aaaa0000  running  1 job(s)  next 21:33')
  expect(lines[3]).toContain('[d0ae027c] Every day at 9:03 PM · next 21:33 · expires in 1d · last ok')
  expect(text).not.toContain('gone0001')
  expect(text).not.toContain('here ·')
  expect(text).toContain('(pane not drawn: no surface in test)')
})

test('/clock-out hide toggles dismissed on a stopped session and refuses a running one', async ($, on) => {
  const files = fixture(on)
  session(on)
  const clock = mock.clock(on)
  await clock.set(NOW)

  const refused = await runCommand($, 'clock-out', 'hide d0ae027c')
  expect(refused.text).toContain('running session aaaa0000')

  const hidden = await runCommand($, 'clock-out', 'hide once0001')
  expect(hidden.text).toContain('Hidden once0001')
  expect(JSON.parse(files.get(`${ROOT}/bbbb0000-0000-4000-8000-000000000002.json`) ?? '{}').dismissed).toEqual(['once0001'])

  const shown = await runCommand($, 'clock-out', 'hide once0001')
  expect(shown.text).toContain('Unhidden once0001')
  expect(JSON.parse(files.get(`${ROOT}/bbbb0000-0000-4000-8000-000000000002.json`) ?? '{}').dismissed).toEqual([])

  const missing = await runCommand($, 'clock-out', 'hide nope')
  expect(missing.text).toBe('No job nope in any session.')
})

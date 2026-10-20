import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryFs } from './support'

// What a session records in its own file when it starts (hooks/heartbeat.ts)

const NOW = 1_800_000_000_000
const OWN = 'eeee0000-0000-4000-8000-000000000005'
const FILE = `/home/alice/.claude/clock-out/sessions/${OWN}.json`
const LIVE = '/home/alice/.claude/sessions/4242.json'   // Claude Code's live record of this process

function session(on: On, files: Map<string, string>): void {
  memoryFs(on, files)
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: OWN }))
  on('session.cwd', () => ({ value: '/home/alice/proj' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))   // beneath the plugin: the plugin's own session.start hook runs first
}

test('a session started with --bg records kind and bgSince in its own file; a later terminal start keeps bgSince', async ($, on) => {
  const files = new Map<string, string>()
  files.set(LIVE, JSON.stringify({ pid: 4242, sessionId: OWN, kind: 'bg' }))
  session(on, files)
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [] } }))
  const clock = mock.clock(on)
  await clock.set(NOW)

  await $.session.start({ cwd: '/home/alice/proj' } as never)
  expect(JSON.parse(files.get(FILE) ?? '{}')).toMatchObject({ kind: 'background', bgSince: NOW })

  files.set(LIVE, JSON.stringify({ pid: 4242, sessionId: OWN, kind: 'interactive' }))
  await clock.set(NOW + 60_000 * 60)
  await $.session.start({ cwd: '/home/alice/proj' } as never)
  expect(JSON.parse(files.get(FILE) ?? '{}')).toMatchObject({ kind: 'interactive', bgSince: NOW })
})

test('an interactive start records no bgSince', async ($, on) => {
  const files = new Map<string, string>()
  files.set(LIVE, JSON.stringify({ pid: 4242, sessionId: OWN, kind: 'interactive' }))
  session(on, files)
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [] } }))
  await mock.clock(on).set(NOW)

  await $.session.start({ cwd: '/home/alice/proj' } as never)
  expect(JSON.parse(files.get(FILE) ?? '{}').bgSince).toBeUndefined()
})

test('the CronList check 3 s after start records the answer itself (the timer call skips the jobs.ts hook)', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, JSON.stringify({
    version: 1, sessionId: OWN, cwd: '/home/alice/proj', alive: false, dismissed: [], runs: [],
    jobs: [{ id: 'lost0001', cron: '0 9 * * *', prompt: 'morning', recurring: true, createdAt: NOW - 3_600_000 }],
  }))
  session(on, files)
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [{ id: 'rest0001', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, humanSchedule: 'Every day at 9:03 PM', nextFireAt: NOW + 3_600_000 }] } }))
  const clock = mock.clock(on)
  await clock.set(NOW)

  await $.session.start({ cwd: '/home/alice/proj' } as never)
  await clock.set(NOW + 3_000)

  const byId = Object.fromEntries(JSON.parse(files.get(FILE) ?? '{}').jobs.map((j: { id: string }) => [j.id, j]))
  expect(byId.rest0001).toMatchObject({ cron: '3 21 * * *', prompt: 'nightly sync', nextFireAt: NOW + 3_600_000, expiresAt: NOW + 3_000 + 7 * 24 * 3_600_000 })
  expect(byId.lost0001.goneAt).toBe(NOW + 3_000)   // not in CronList any more
})

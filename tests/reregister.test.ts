import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { selectExpiring } from '../hooks/reregister'
import { emptySessionFile } from '../hooks/schema'
import { memoryFs, runCommand } from './support'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000
const OWN = 'dddd0000-0000-4000-8000-000000000004'
const FILE = `/home/alice/.claude/clock-out/sessions/${OWN}.json`

test('selectExpiring picks live recurring jobs within the lead, once a day', async () => {
  const file = emptySessionFile(OWN, '/x')
  file.jobs.push(
    { id: 'soon0001', cron: '3 21 * * *', prompt: 'a', recurring: true, createdAt: NOW - 6 * DAY - 2 * HOUR, expiresAt: NOW + 22 * HOUR },
    { id: 'tried001', cron: '3 21 * * *', prompt: 'b', recurring: true, createdAt: 1, expiresAt: NOW + 2 * HOUR, reregisterTriedAt: NOW - HOUR },
    { id: 'later001', cron: '3 21 * * *', prompt: 'c', recurring: true, createdAt: NOW, expiresAt: NOW + 7 * DAY },
    { id: 'once0001', cron: '0 9 20 10 *', prompt: 'd', recurring: false, createdAt: 1 },
    { id: 'gone0001', cron: '3 21 * * *', prompt: 'e', recurring: true, createdAt: 1, expiresAt: NOW + HOUR, deletedAt: NOW - 1 },
  )
  expect(selectExpiring(file, NOW, 24 * HOUR).map(j => j.id)).toEqual(['soon0001'])
  expect(selectExpiring(file, NOW + DAY, 24 * HOUR).map(j => j.id)).toEqual(['soon0001', 'tried001'])
})

function session(on: On, files: Map<string, string>): void {
  memoryFs(on, files)
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: OWN }))
  on('session.cwd', () => ({ value: '/home/alice/proj' }))
}

function fileText(jobs: object[]): string {
  return JSON.stringify({ version: 1, sessionId: OWN, cwd: '/home/alice/proj', alive: true, heartbeatAt: NOW, dismissed: [], jobs, runs: [] })
}

test('/clock-out reregister deletes and re-creates an expiring job; the file shows the new one', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, fileText([{ id: 'old00001', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, createdAt: NOW - 6 * DAY - HOUR, expiresAt: NOW + 23 * HOUR }]))
  session(on, files)
  const clock = mock.clock(on)
  await clock.set(NOW)
  const calls: string[] = []
  on('tool.call', { tool: 'CronDelete' }, (_$, e) => { calls.push(`delete ${e.id}`); return { result: { id: e.id } } })
  on('tool.call', { tool: 'CronCreate' }, (_$, e) => { calls.push(`create ${e.cron} ${e.prompt} ${String(e.recurring)}`); return { result: { id: 'new00001', humanSchedule: 'Every day at 9:03 PM', recurring: true, nextFireAt: NOW + HOUR } } })

  const ran = await runCommand($, 'clock-out', 'reregister')

  expect(calls).toEqual(['delete old00001', 'create 3 21 * * * nightly sync true'])
  expect(ran.text).toContain('old00001 → new00001: re-registered')
  const file = JSON.parse(files.get(FILE) ?? '{}')
  const byId = Object.fromEntries(file.jobs.map((j: { id: string }) => [j.id, j]))
  expect(byId.old00001.deletedAt).toBe(NOW)
  expect(byId.old00001.reregisterTriedAt).toBe(NOW)
  expect(byId.new00001.expiresAt).toBe(NOW + 7 * DAY)
})

test('/clock-out reregister leaves a job alone when nothing expires, and `all` renews every recurring job', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, fileText([{ id: 'fresh001', cron: '0 9 * * 1-5', prompt: 'standup', recurring: true, createdAt: NOW, expiresAt: NOW + 7 * DAY }]))
  session(on, files)
  const clock = mock.clock(on)
  await clock.set(NOW)
  const calls: string[] = []
  on('tool.call', { tool: 'CronDelete' }, (_$, e) => { calls.push(`delete ${e.id}`); return { result: { id: e.id } } })
  on('tool.call', { tool: 'CronCreate' }, () => { calls.push('create'); return { result: { id: 'fresh002', humanSchedule: 'x', recurring: true } } })

  const nothing = await runCommand($, 'clock-out', 'reregister')
  expect(nothing.text).toBe('Nothing expiring soon.')
  expect(calls).toEqual([])

  const all = await runCommand($, 'clock-out', 'reregister all')
  expect(calls).toEqual(['delete fresh001', 'create'])
  expect(all.text).toContain('fresh001 → fresh002')
})

test('a refused CronCreate falls back to a prompt for the model', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, fileText([{ id: 'old00002', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, createdAt: 1, expiresAt: NOW + HOUR }]))
  session(on, files)
  const clock = mock.clock(on)
  await clock.set(NOW)
  const submitted: string[] = []
  on('tool.call', { tool: 'CronDelete' }, (_$, e) => ({ result: { id: e.id } }))
  on('tool.call', { tool: 'CronCreate' }, () => ({ deny: 'permission mode asks' }))
  on('prompt.submit', (_$, e) => { submitted.push(e.text); return { text: '' } })

  const ran = await runCommand($, 'clock-out', 'reregister')
  await clock.advance(1_000)   // the fallback prompt is submitted from a timer, after the command hook returned

  expect(ran.text).toContain('old00002: CronCreate refused, asked the model')
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('cron "3 21 * * *"')
  expect(submitted[0]).toContain('nightly sync')
})

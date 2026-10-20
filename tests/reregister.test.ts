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

// ── 0.13: the renewal is recorded before CronDelete and recovered after a stop (F-03) ──

const MIN = 60_000
const renewalFile = (renewal: Record<string, unknown>, oldJob: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(fileText([{ id: 'old00009', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, createdAt: NOW - 7 * DAY, expiresAt: NOW, reregisterTriedAt: NOW - HOUR, mode: 'notify', ...oldJob }])), renewal })
const RENEWAL = { oldId: 'old00009', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, mode: 'notify', startedAt: NOW - HOUR }

// Starts the session at NOW and lets the CronList check 3 s later run
async function startSession($: { session: { start: (e: never) => Promise<unknown> } }, on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const clock = mock.clock(on)
  await clock.set(NOW)
  await $.session.start({ cwd: '/home/alice/proj' } as never)
  await clock.set(NOW + 3_000)
  return clock
}

test('the renewal is on file (intent) before CronDelete, old_removed with the delete, and gone once the new job exists', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, fileText([{ id: 'old00001', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, createdAt: NOW - 6 * DAY - HOUR, expiresAt: NOW + 23 * HOUR }]))
  session(on, files)
  await mock.clock(on).set(NOW)
  const seen: string[] = []
  on('tool.call', { tool: 'CronDelete' }, (_$, e) => { seen.push(`delete with ${JSON.parse(files.get(FILE) ?? '{}').renewal?.phase}`); return { result: { id: e.id } } })
  on('tool.call', { tool: 'CronCreate' }, () => { seen.push(`create with ${JSON.parse(files.get(FILE) ?? '{}').renewal?.phase}`); return { result: { id: 'new00001', humanSchedule: 'x', recurring: true } } })
  await runCommand($, 'clock-out', 'reregister')
  expect(seen).toEqual(['delete with intent', 'create with old_removed'])
  expect(JSON.parse(files.get(FILE) ?? '{}').renewal).toBeUndefined()
})

test('stopped right after the renewal deleted the old job: the next start finds it missing in CronList and re-creates it', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, renewalFile({ ...RENEWAL, phase: 'old_removed' }, { deletedAt: NOW - HOUR }))
  session(on, files)
  const created: string[] = []
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [] } }))
  on('tool.call', { tool: 'CronCreate' }, (_$, e) => { created.push(`${e.cron} ${e.prompt} ${String(e.recurring)}`); return { result: { id: 'new00009', humanSchedule: 'x', recurring: true, nextFireAt: NOW + HOUR } } })
  await startSession($ as never, on)
  expect(created).toEqual(['3 21 * * * nightly sync true'])
  const file = JSON.parse(files.get(FILE) ?? '{}')
  expect(file.renewal).toBeUndefined()
  expect(file.jobs.find((j: { id: string }) => j.id === 'new00009')?.mode).toBe('notify')   // the old job's run mode carries over
})

test('a job the user deleted while the renewal was only intended is not restored', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, renewalFile({ ...RENEWAL, phase: 'intent' }, { deletedAt: NOW - 30 * MIN }))
  session(on, files)
  const created: string[] = []
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [] } }))
  on('tool.call', { tool: 'CronCreate' }, () => { created.push('create'); return { result: { id: 'x', humanSchedule: 'x', recurring: true } } })
  await startSession($ as never, on)
  expect(created).toEqual([])
  expect(JSON.parse(files.get(FILE) ?? '{}').renewal).toBeUndefined()
})

test('an intended renewal whose old job is still scheduled is dropped and starts over at the next check', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, renewalFile({ ...RENEWAL, phase: 'intent' }, {}))
  session(on, files)
  const created: string[] = []
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [{ id: 'old00009', cron: '3 21 * * *', humanSchedule: 'x', prompt: 'nightly sync', recurring: true }] } }))
  on('tool.call', { tool: 'CronCreate' }, () => { created.push('create'); return { result: { id: 'x', humanSchedule: 'x', recurring: true } } })
  await startSession($ as never, on)
  const file = JSON.parse(files.get(FILE) ?? '{}')
  expect(created).toEqual([])
  expect(file.renewal).toBeUndefined()
  expect(file.jobs[0].reregisterTriedAt).toBeUndefined()
})

test('restoring refused: the renewal stays blocked with lastError, and a heartbeat 10 min later tries again', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, renewalFile({ ...RENEWAL, phase: 'old_removed' }, { deletedAt: NOW - HOUR }))
  session(on, files)
  let refuse = true
  let creates = 0
  on('tool.call', { tool: 'CronList' }, () => ({ result: { jobs: [] } }))
  on('tool.call', { tool: 'CronCreate' }, () => {
    creates++
    return refuse ? { deny: 'permission mode asks' } : { result: { id: 'new00009', humanSchedule: 'x', recurring: true } }
  })
  const clock = await startSession($ as never, on)
  expect(JSON.parse(files.get(FILE) ?? '{}').renewal).toMatchObject({ phase: 'blocked', lastError: 'permission mode asks', triedAt: NOW + 3_000 })
  await clock.set(NOW + 5 * MIN)
  expect(creates).toBe(1)   // not before 10 min
  refuse = false
  await clock.set(NOW + 11 * MIN)
  expect(creates).toBe(2)
  expect(JSON.parse(files.get(FILE) ?? '{}').renewal).toBeUndefined()
})

test('while a renewal is blocked, /clock-out reregister deletes no other job', async ($, on) => {
  const files = new Map<string, string>()
  files.set(FILE, JSON.stringify({ ...JSON.parse(fileText([{ id: 'soon0002', cron: '0 8 * * *', prompt: 'other', recurring: true, createdAt: 1, expiresAt: NOW + HOUR }])), renewal: { ...RENEWAL, phase: 'blocked', triedAt: NOW - MIN, lastError: 'permission mode asks' } }))
  session(on, files)
  await mock.clock(on).set(NOW)
  const deleted: string[] = []
  on('tool.call', { tool: 'CronDelete' }, (_$, e) => { deleted.push(e.id); return { result: { id: e.id } } })
  const ran = await runCommand($, 'clock-out', 'reregister')
  expect(deleted).toEqual([])
  expect(ran.text).toContain('old00009: renewal blocked (permission mode asks)')
})

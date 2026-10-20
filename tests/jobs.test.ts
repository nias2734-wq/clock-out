import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryFs } from './support'

const SESSION = 'aaaa0000-0000-4000-8000-000000000001'
const FILE = `/home/alice/.claude/clock-out/sessions/${SESSION}.json`

function session(on: On): void {
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: SESSION }))
  on('session.cwd', () => ({ value: '/home/alice/proj' }))
}

test('CronCreate records the job with the result id, nextFireAt and a 7-day expiry', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  const clock = mock.clock(on)
  await clock.set(1_700_000_000_000)
  on('tool.call', { tool: 'CronCreate' }, () => ({
    result: { id: 'job00001', humanSchedule: 'Every day at 9:03 PM', recurring: true, nextFireAt: 1_700_000_900_000 },
  }))

  await $.tool.call({ tool: 'CronCreate', cron: '3 21 * * *', prompt: 'nightly sync' })

  const file = JSON.parse(files.get(FILE) ?? '{}')
  expect(file.sessionId).toBe(SESSION)
  expect(file.jobs).toHaveLength(1)
  expect(file.jobs[0].id).toBe('job00001')
  expect(file.jobs[0].cron).toBe('3 21 * * *')
  expect(file.jobs[0].prompt).toBe('nightly sync')
  expect(file.jobs[0].recurring).toBe(true)
  expect(file.jobs[0].nextFireAt).toBe(1_700_000_900_000)
  expect(file.jobs[0].createdAt).toBe(1_700_000_000_000)
  expect(file.jobs[0].expiresAt).toBe(1_700_000_000_000 + 7 * 24 * 60 * 60 * 1000)
  expect(files.has('/home/alice/.claude/clock-out/sessions/_stamp')).toBe(true)
})

test('a one-shot CronCreate has no expiry', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  mock.clock(on)
  on('tool.call', { tool: 'CronCreate' }, () => ({
    result: { id: 'once0001', humanSchedule: 'Oct 20 at 10:15', recurring: false, nextFireAt: 5 },
  }))

  await $.tool.call({ tool: 'CronCreate', cron: '15 10 20 10 *', prompt: 'once', recurring: false })

  const file = JSON.parse(files.get(FILE) ?? '{}')
  expect(file.jobs[0].recurring).toBe(false)
  expect(file.jobs[0].expiresAt).toBeUndefined()
})

test('CronDelete marks the job deleted instead of removing it', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  const clock = mock.clock(on)
  await clock.set(1_000)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'job00002', humanSchedule: 'x', recurring: true } }))
  on('tool.call', { tool: 'CronDelete' }, () => ({ result: { id: 'job00002' } }))

  await $.tool.call({ tool: 'CronCreate', cron: '0 9 * * *', prompt: 'p' })
  await clock.set(2_000)
  await $.tool.call({ tool: 'CronDelete', id: 'job00002' })

  const file = JSON.parse(files.get(FILE) ?? '{}')
  expect(file.jobs).toHaveLength(1)
  expect(file.jobs[0].deletedAt).toBe(2_000)
})

test('CronList adds restored jobs and marks vanished ones gone', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  const clock = mock.clock(on)
  await clock.set(10_000)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'keep0001', humanSchedule: 'x', recurring: true } }))
  on('tool.call', { tool: 'CronList' }, () => ({
    result: {
      jobs: [
        { id: 'keep0001', cron: '0 9 * * *', humanSchedule: 'x', prompt: 'p', recurring: true, nextFireAt: 99_000 },
        { id: 'rest0001', cron: '5 5 * * *', humanSchedule: 'y', prompt: 'restored', recurring: true, nextFireAt: 77_000 },
      ],
    },
  }))

  await $.tool.call({ tool: 'CronCreate', cron: '0 9 * * *', prompt: 'p' })
  // a job the file knows but CronList no longer lists
  files.set(FILE, JSON.stringify({ ...JSON.parse(files.get(FILE) ?? '{}'), jobs: [...JSON.parse(files.get(FILE) ?? '{}').jobs, { id: 'gone0001', cron: '1 1 1 1 *', prompt: 'g', recurring: false, createdAt: 1 }] }))
  await clock.set(20_000)
  await $.tool.call({ tool: 'CronList' })

  const file = JSON.parse(files.get(FILE) ?? '{}')
  const byId = Object.fromEntries(file.jobs.map((j: { id: string }) => [j.id, j]))
  expect(byId.keep0001.nextFireAt).toBe(99_000)
  expect(byId.keep0001.goneAt).toBeUndefined()
  expect(byId.rest0001.prompt).toBe('restored')
  expect(byId.rest0001.createdAt).toBe(20_000)
  expect(byId.gone0001.goneAt).toBe(20_000)
})

test('a denied CronCreate records nothing', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  mock.clock(on)
  on('tool.call', { tool: 'CronCreate' }, () => ({ deny: 'no' }))

  await $.tool.call({ tool: 'CronCreate', cron: '0 9 * * *', prompt: 'p' })

  expect(files.has(FILE)).toBe(false)
})

// 09:00–18:00, lunch 12–13 → the hours 04:00 ~ 09:00 stay empty on work days
const SETTINGS = JSON.stringify({ language: 'ko', workHours: { start: '09:00', lunchStart: '12:00', lunchEnd: '13:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] }, alignPing: { enabled: true } })
const MONDAY_NOON = new Date(2026, 9, 19, 12, 0).getTime()

test('a daily 06:30 job is refused once with the reason, and goes through when asked again', async ($, on) => {
  const files = memoryFs(on)
  files.set('/home/alice/.claude/clock-out/app-settings.json', SETTINGS)
  session(on)
  const clock = mock.clock(on)
  await clock.set(MONDAY_NOON)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'early001', humanSchedule: 'x', recurring: true } }))

  const first = await $.tool.call({ tool: 'CronCreate', cron: '30 6 * * *', prompt: 'early' })
  expect(first.deny).toContain('04:00 ~ 09:00')
  expect(first.deny).toContain('13:00, 18:00 초기화가 밀립니다')
  expect(first.deny).toContain('18:00 ~ 04:00')
  expect(files.has(FILE)).toBe(false)

  await clock.set(MONDAY_NOON + 60_000)
  const again = await $.tool.call({ tool: 'CronCreate', cron: '30 6 * * *', prompt: 'early' })
  expect(again.deny).toBeUndefined()
  expect(JSON.parse(files.get(FILE) ?? '{}').jobs[0].id).toBe('early001')
})

test('jobs at 03:30 or 10:00 go through at once', async ($, on) => {
  const files = memoryFs(on)
  files.set('/home/alice/.claude/clock-out/app-settings.json', SETTINGS)
  session(on)
  const clock = mock.clock(on)
  await clock.set(MONDAY_NOON)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'fine0001', humanSchedule: 'x', recurring: true } }))

  expect((await $.tool.call({ tool: 'CronCreate', cron: '30 3 * * *', prompt: 'a' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'CronCreate', cron: '0 10 * * *', prompt: 'b' })).deny).toBeUndefined()
})

// job_mode (the plugin's own tool), called as the model would call it
type Answer = { result?: unknown; deny?: string; context?: readonly string[] }
const call = async ($: { tool: { call: unknown } }, input: Record<string, unknown>): Promise<Answer> =>
  ($.tool.call as (i: Record<string, unknown>) => Promise<Answer>)(input)

test('CronCreate adds a line telling the model to call job_mode with the new id', async ($, on) => {
  memoryFs(on)
  session(on)
  mock.clock(on)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'once0002', humanSchedule: 'x', recurring: false } }))
  const ran = await call($, { tool: 'CronCreate', cron: '15 10 20 10 *', prompt: '리마인드 테스트', recurring: false })
  expect(ran.context?.join('\n') ?? '').toContain('mcp__clock-out__job_mode')
  expect(ran.context?.join('\n') ?? '').toContain('once0002')
})

test('job_mode records the mode on the own job and answers in the app language', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  mock.clock(on)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'once0003', humanSchedule: 'x', recurring: false } }))
  await $.tool.call({ tool: 'CronCreate', cron: '15 10 20 10 *', prompt: 'remind me', recurring: false })

  const ko = String((await call($, { tool: 'mcp__clock-out__job_mode', jobId: 'once0003', mode: 'open' })).result)
  expect(ko).toContain('"화면에 열기"(open)')
  expect(JSON.parse(files.get(FILE) ?? '{}').jobs[0].mode).toBe('open')

  files.set('/home/alice/.claude/clock-out/app-settings.json', JSON.stringify({ language: 'en' }))
  const en = String((await call($, { tool: 'mcp__clock-out__job_mode', jobId: 'once0003', mode: 'notify' })).result)
  expect(en).toContain('"notify" (notify)')
  expect(JSON.parse(files.get(FILE) ?? '{}').jobs[0].mode).toBe('notify')
})

test('job_mode refuses an id this session does not have, and a mode outside the three', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  mock.clock(on)
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'mine0001', humanSchedule: 'x', recurring: true } }))
  on('tool.call', { tool: 'CronDelete' }, () => ({ result: { id: 'mine0001' } }))
  await $.tool.call({ tool: 'CronCreate', cron: '0 9 * * *', prompt: 'p' })

  const other = String((await call($, { tool: 'mcp__clock-out__job_mode', jobId: 'zzzz9999', mode: 'open' })).result)
  expect(other).toContain('"zzzz9999" 예약이 없습니다')
  expect(other).toContain('mine0001')
  const bad = String((await call($, { tool: 'mcp__clock-out__job_mode', jobId: 'mine0001', mode: 'loud' })).result)
  expect(bad).toContain('quiet, notify, open')
  expect(JSON.parse(files.get(FILE) ?? '{}').jobs[0].mode).toBeUndefined()

  await $.tool.call({ tool: 'CronDelete', id: 'mine0001' })
  const deleted = String((await call($, { tool: 'mcp__clock-out__job_mode', jobId: 'mine0001', mode: 'open' })).result)
  expect(deleted).toContain('예약이 없습니다')   // a deleted job is not a live job
})

test('a 7-day renewal keeps the mode of the job it replaces and adds no job_mode line', async ($, on) => {
  const files = memoryFs(on)
  session(on)
  mock.clock(on)
  files.set(FILE, JSON.stringify({
    version: 1, sessionId: SESSION, cwd: '/home/alice/proj', alive: true, dismissed: [], runs: [],
    jobs: [{ id: 'old00001', cron: '3 21 * * *', prompt: 'nightly', recurring: true, createdAt: 1, mode: 'quiet', reregisterTriedAt: 5, deletedAt: 6 }],
  }))
  on('tool.call', { tool: 'CronCreate' }, () => ({ result: { id: 'new00001', humanSchedule: 'x', recurring: true } }))
  const ran = await call($, { tool: 'CronCreate', cron: '3 21 * * *', prompt: 'nightly' })
  expect(ran.context ?? []).toEqual([])
  expect(JSON.parse(files.get(FILE) ?? '{}').jobs.find((j: { id: string }) => j.id === 'new00001').mode).toBe('quiet')
})

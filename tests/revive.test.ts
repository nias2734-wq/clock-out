import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryFs, runCommand } from './support'

const NOW = 1_800_000_000_000
const MIN = 60_000
const ROOT = '/home/alice/.claude/clock-out/sessions'
const OWN = 'cccc0000-0000-4000-8000-000000000003'
const STOPPED = 'bbbb0000-0000-4000-8000-000000000002'
const FILE = `${ROOT}/${STOPPED}.json`

function fixture(on: On, extra: Record<string, unknown> = {}): Map<string, string> {
  const files = new Map<string, string>()
  files.set(FILE, JSON.stringify({
    version: 1, sessionId: STOPPED, cwd: '/home/alice/proj', alive: false, endedAt: NOW - 60 * MIN, dismissed: [], runs: [],
    jobs: [{ id: 'd0ae027c', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, createdAt: NOW - 2 * 24 * 60 * MIN, expiresAt: NOW + 5 * 24 * 60 * MIN }],
    ...extra,
  }))
  memoryFs(on, files)
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: OWN }))
  on('session.cwd', () => ({ value: '/home/alice/here' }))
  return files
}

const ok = (stdout: string, stderr = '') => ({ value: { exitCode: 0, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

test('first revive passes the permission flag and sends the renewal message, without writing the woken session file', async ($, on) => {
  const files = fixture(on)
  const before = files.get(FILE)
  const clock = mock.clock(on)
  await clock.set(NOW)
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (e.argv[1] === 'agents') return ok('[]')
    return ok(`backgrounded · ${STOPPED.slice(0, 8)} · proj\n`)
  })

  const ran = await runCommand($, 'clock-out', 'revive bbbb0000')

  expect(ran.text).toContain('bbbb0000: woken in the background')
  expect(calls[0]).toEqual(['claude', 'agents', '--json', '--all'])
  expect(calls[1]?.slice(0, 5)).toEqual(['claude', '--bg', '--resume', STOPPED, '--dangerously-skip-permissions'])
  expect(calls[1]?.[5]).toContain('cron "3 21 * * *" (recurring) prompt: nightly sync')
  expect(files.get(FILE)).toBe(before)   // the woken session records bgSince itself at start (heartbeat.ts)
})

test('a later revive passes no flags, and a copy started by mistake is stopped', async ($, on) => {
  fixture(on, { bgSince: NOW - 24 * 60 * MIN })
  const clock = mock.clock(on)
  await clock.set(NOW)
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    if (e.argv[1] === 'stop') return ok('stopped 3bf76c58')
    return ok('backgrounded · 3bf76c58', 'note: background session bbbb0000 keeps its own saved options, so the flags you passed started a copy as 3bf76c58.')
  })

  const ran = await runCommand($, 'clock-out', 'revive bbbb0000')

  expect(calls[0]?.slice(0, 4)).toEqual(['claude', '--bg', '--resume', STOPPED])
  expect(calls[0]).not.toContain('--dangerously-skip-permissions')
  expect(calls[0]).not.toContain('agents')
  expect(calls[1]).toEqual(['claude', 'stop', '3bf76c58'])
  expect(ran.text).toContain('a copy 3bf76c58 was started by the flags and stopped')
})

test('revive refuses a running session and an unknown prefix', async ($, on) => {
  fixture(on, { alive: true, heartbeatAt: NOW - 10_000 })
  const clock = mock.clock(on)
  await clock.set(NOW)
  const calls: string[][] = []
  on('process.run', (_$, e) => { calls.push([...e.argv]); return ok('') })

  const running = await runCommand($, 'clock-out', 'revive bbbb')
  expect(running.text).toBe('bbbb0000 is already running.')
  const unknown = await runCommand($, 'clock-out', 'revive zzzz')
  expect(unknown.text).toContain('No single')
  expect(calls).toEqual([])
})

test('bgSince kept only in the app state file (0.13) also means no flags', async ($, on) => {
  const files = fixture(on)
  files.set('/home/alice/.claude/clock-out/app-state.json', JSON.stringify({ version: 1, sessions: { [STOPPED]: { bgSince: NOW - 24 * 60 * MIN } } }))
  await mock.clock(on).set(NOW)
  const calls: string[][] = []
  on('process.run', (_$, e) => { calls.push([...e.argv]); return ok('backgrounded · bbbb0000') })

  await runCommand($, 'clock-out', 'revive bbbb0000')

  expect(calls[0]?.slice(0, 4)).toEqual(['claude', '--bg', '--resume', STOPPED])
  expect(calls[0]).not.toContain('--dangerously-skip-permissions')
  expect(calls.some(c => c[1] === 'agents')).toBe(false)
})

test('a session file with kind background (recorded by that session at start) also means no flags', async ($, on) => {
  fixture(on, { kind: 'background' })
  await mock.clock(on).set(NOW)
  const calls: string[][] = []
  on('process.run', (_$, e) => { calls.push([...e.argv]); return ok('backgrounded · bbbb0000') })

  await runCommand($, 'clock-out', 'revive bbbb0000')

  expect(calls[0]?.slice(0, 4)).toEqual(['claude', '--bg', '--resume', STOPPED])
  expect(calls[0]).not.toContain('--dangerously-skip-permissions')
})

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ruleMatches } from '../hooks/guard'
import { memoryFs } from './support'

// 차단 목록(hooks/guard.ts): 예약 실행 턴에서만 막고, git push 는 원격 세션이 켜져 있으면 승인을 묻는다

const OWN = 'bbbb0000-0000-4000-8000-0000000000bb'
const REMOTE = 'aaaa0000-0000-4000-8000-0000000000aa'
const ROOT = '/home/alice/.claude/clock-out'
const BLOCK = ['Bash(git push*)', 'Bash(rm -rf*)', 'Bash(npm publish:*)']

async function setup(on: On, remote: boolean): Promise<Map<string, string>> {
  const files = memoryFs(on)
  await mock.clock(on).set(1_800_000_000_000)
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: OWN }))
  on('session.cwd', () => ({ value: '/home/alice/tools' }))
  files.set(`${ROOT}/app-settings.json`, JSON.stringify({ language: 'ko', permission: { disallowedTools: BLOCK }, remote: { enabled: remote } }))
  if (remote) files.set(`${ROOT}/remote.json`, JSON.stringify({ sessionId: REMOTE }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, () => ({ result: { stdout: 'ran' } }) as never)   // beneath the plugin: the command ran
  return files
}

type Answer = { result?: unknown; deny?: string }
const bash = async ($: { tool: { call: unknown } }, command: string, tool = 'Bash'): Promise<Answer> =>
  ($.tool.call as (i: Record<string, unknown>) => Promise<Answer>)({ tool, command })
const inboxOf = (files: Map<string, string>) => [...files.keys()].filter(k => k.startsWith(`${ROOT}/inbox/${REMOTE}/`)).map(k => String(JSON.parse(files.get(k) ?? '{}').text))

test('ruleMatches: prefix glob, settings-style :*, every part of a chained command, Bash rules for PowerShell too', async () => {
  expect(ruleMatches('Bash(git push*)', 'git push origin main')).toBe(true)
  expect(ruleMatches('Bash(git push*)', 'cd repo && git push')).toBe(true)
  expect(ruleMatches('Bash(git push*)', 'git pull')).toBe(false)
  expect(ruleMatches('Bash(npm publish:*)', 'npm publish --tag next')).toBe(true)
  expect(ruleMatches('Read', 'git push')).toBe(false)
})

test('a command typed by the user is not blocked, even one on the block list', async ($, on) => {
  await setup(on, false)
  await $.prompt.submit({ text: '지금 push 해줘' } as never)
  expect((await bash($, 'git push')).deny).toBeUndefined()
})

test('during a scheduled run a blocked command is refused, and allowed again after the run ends', async ($, on) => {
  await setup(on, false)
  await $.prompt.submit({ text: 'nightly', origin: { kind: 'scheduled-trigger' } } as never)
  expect((await bash($, 'rm -rf build')).deny).toContain('차단 목록: Bash(rm -rf*)')
  expect((await bash($, 'rm -rf build', 'PowerShell')).deny).toBeDefined()
  expect((await bash($, 'npm test')).deny).toBeUndefined()
  await $.turn.complete({ reason: 'answer', durationMs: 1, answer: 'done' } as never)
  expect((await bash($, 'rm -rf build')).deny).toBeUndefined()
})

test('git push in a scheduled run: refused; asks the remote jobs session only when remote is on', async ($, on) => {
  const files = await setup(on, true)
  await $.prompt.submit({ text: 'nightly', origin: { kind: 'scheduled-trigger' } } as never)
  const answer = await bash($, 'git push origin main')
  expect(answer.deny).toContain('승인을 요청했습니다')
  const inbox = inboxOf(files)
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toContain('승인 요청 · tools · bbbb0000')
  expect(inbox[0]).toContain('git push origin main')
})

test('git push in a scheduled run with remote off: refused, nothing sent', async ($, on) => {
  const files = await setup(on, false)
  await $.prompt.submit({ text: 'nightly', origin: { kind: 'scheduled-trigger' } } as never)
  expect((await bash($, 'git push')).deny).toContain('차단 목록: Bash(git push*)')
  expect(inboxOf(files)).toHaveLength(0)
})

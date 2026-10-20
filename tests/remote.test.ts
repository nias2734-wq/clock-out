import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryFs } from './support'

// The remote jobs session's tools (hooks/remote.ts), called as the model would call them.

const REMOTE = 'aaaa0000-0000-4000-8000-0000000000aa'   // the remote jobs session (this session in these tests)
const JOB = 'bbbb0000-0000-4000-8000-0000000000bb'      // a session that owns a job
const ROOT = '/home/alice/.claude/clock-out'
const NOW = 1_800_000_000_000
const MIN = 60_000

function setup(on: On, job: Record<string, unknown>, settings?: Record<string, unknown>): Map<string, string> {
  const files = memoryFs(on)
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: REMOTE }))
  on('session.cwd', () => ({ value: `${ROOT}/remote` }))
  files.set(`${ROOT}/remote.json`, JSON.stringify({ sessionId: REMOTE }))
  if (settings !== undefined) files.set(`${ROOT}/app-settings.json`, JSON.stringify(settings))
  files.set(`${ROOT}/sessions/${JOB}.json`, JSON.stringify({
    version: 1, sessionId: JOB, cwd: '/home/alice/tools', alive: true, heartbeatAt: NOW - MIN, dismissed: [],
    jobs: [{ id: 'job00001', cron: '3 21 * * *', prompt: 'pull develop', recurring: true, createdAt: NOW - 60 * MIN, humanSchedule: 'Every day at 9:03 PM' }],
    runs: [{ jobId: 'job00001', promptHead: 'pull develop', firedAt: NOW - 30 * MIN, finishedAt: NOW - 28 * MIN, reason: 'error', durationMs: 120_000, answerHead: 'merge conflict in a.ts' }],
    ...job,
  }))
  return files
}

// the plugin's own tools are not in the engine's typed tool list, so the call is made through a plain signature
type Answer = { result?: unknown; deny?: string }
const call = async ($: { tool: { call: unknown } }, input: Record<string, unknown>): Promise<string> => {
  const r = await ($.tool.call as (i: Record<string, unknown>) => Promise<Answer>)(input)
  return String(r.result ?? r.deny ?? '')
}

test('status lists the session, what runs now, and the last result of each job', async ($, on) => {
  setup(on, { running: { promptHead: 'pull develop', firedAt: NOW - 2 * MIN } })
  await mock.clock(on).set(NOW)
  const text = (await call($, { tool: 'mcp__clock-out__status' }))
  expect(text).toContain('tools · bbbb0000 — 켜짐')
  expect(text).toContain('▶ 실행 중')
  expect(text).toContain('[job00001] Every day at 9:03 PM')
  expect(text).toContain('마지막 ✗')
  expect(text).toContain('merge conflict in a.ts')
})

test('send leaves an instruction in the inbox of a running session with the plugin (no cross-session message)', async ($, on) => {
  const files = setup(on, {})
  await mock.clock(on).set(NOW)
  const sent: string[] = []
  on('session.send', (_$, e) => { sent.push(String(e.to)); return { isDelivered: true } })
  const text = await call($, { tool: 'mcp__clock-out__send', session: 'bbbb0000', text: '오늘은 release 브랜치로' })
  const inbox = [...files.keys()].filter(k => k.startsWith(`${ROOT}/inbox/${JOB}/`))
  expect(inbox).toHaveLength(1)
  expect(JSON.parse(files.get(inbox[0] ?? '') ?? '{}').text).toBe('[clock-out 원격 지시] 오늘은 release 브랜치로')
  expect(sent).toEqual([])
  expect(text).toContain('지시를 남겼습니다')
})

test('a session submits its inbox messages to itself once, oldest first, and not while its scheduled job runs', async ($, on) => {
  const files = setup(on, {})
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => { submitted.push(e.text); return { text: '' } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))   // beneath the plugin: the plugin's own session.start hook runs first
  const clock = mock.clock(on)
  await clock.set(NOW)
  const own = `${ROOT}/sessions/${REMOTE}.json`
  const ownFile = (running: boolean) => JSON.stringify({ version: 1, sessionId: REMOTE, cwd: `${ROOT}/remote`, alive: true, dismissed: [], jobs: [], runs: [], ...(running ? { running: { promptHead: 'x', firedAt: NOW } } : {}) })
  files.set(own, ownFile(true))
  files.set(`${ROOT}/inbox/${REMOTE}/2-0.json`, JSON.stringify({ text: 'second', at: 2 }))
  files.set(`${ROOT}/inbox/${REMOTE}/1-0.json`, JSON.stringify({ text: 'first', at: 1 }))
  await $.session.start({ cwd: `${ROOT}/remote` } as never)   // starts the 15 s inbox timer
  await clock.set(NOW + 16_000)
  expect(submitted).toEqual([])   // a job runs: the messages wait
  files.set(own, ownFile(false))
  await clock.set(NOW + 32_000)
  expect(submitted).toEqual(['first', 'second'])
  await clock.set(NOW + 48_000)
  expect(submitted).toEqual(['first', 'second'])   // marked delivered, not again
})

test('send to a stopped session leaves a wake request with the instruction for the app', async ($, on) => {
  const files = setup(on, { alive: false, heartbeatAt: NOW - 60 * MIN })
  await mock.clock(on).set(NOW)
  const text = (await call($, { tool: 'mcp__clock-out__send', session: 'bbbb', text: '22시로 미뤄' }))
  const req = JSON.parse(files.get(`${ROOT}/requests/${JOB}.json`) ?? '{}')
  expect(req.kind).toBe('wake')
  expect(req.message).toBe('[clock-out 원격 지시] 22시로 미뤄')
  expect(text).toContain('깨워서')
})

test('open_remote asks first while a job runs, then queues after the run', async ($, on) => {
  const files = setup(on, { alive: false, heartbeatAt: NOW - 60 * MIN, running: { promptHead: 'pull develop', firedAt: NOW - MIN } })
  await mock.clock(on).set(NOW)
  const asked = (await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000' }))
  expect(asked).toContain('취소되거나 중복 실행될 가능성이 있습니다')
  expect(asked).toContain('현재 작업 중인 내용을 중지하고 원격을 사용하시겠습니까?')
  expect(files.has(`${ROOT}/requests/${JOB}.json`)).toBe(false)
  await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000', when: 'afterRun' })
  expect(JSON.parse(files.get(`${ROOT}/requests/${JOB}.json`) ?? '{}')).toMatchObject({ kind: 'openRemote', when: 'afterRun' })
})

test('open_remote refuses a session that ran in the background without Remote Control', async ($, on) => {
  const files = setup(on, { bgSince: NOW - 600 * MIN })
  await mock.clock(on).set(NOW)
  const text = (await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000' }))
  expect(text).toContain('원격을 붙일 수 없습니다')
  expect(files.has(`${ROOT}/requests/${JOB}.json`)).toBe(false)
})

test('the remote jobs session cannot target itself', async ($, on) => {
  setup(on, {})
  await mock.clock(on).set(NOW)
  const text = (await call($, { tool: 'mcp__clock-out__send', session: 'zzzz', text: 'x' }))
  expect(text).toContain('찾지 못했습니다')
})

test('with the app running, status shows the app list, sessions found only in transcripts too, and send reaches them', async ($, on) => {
  const files = setup(on, {})
  const sent: string[] = []
  on('session.send', (_$, e) => { sent.push(String(e.to)); return { isDelivered: true } })
  await mock.clock(on).set(NOW)
  const TRANSCRIPT = 'cccc0000-0000-4000-8000-0000000000cc'
  files.set(`${ROOT}/overview.json`, JSON.stringify({
    builtAt: NOW - MIN, jobCount: 4,
    sessions: [
      { sessionId: TRANSCRIPT, shortId: 'cccc0000', label: '예약작업', isAlive: true, source: 'transcript', jobs: [
        { id: 'night001', humanSchedule: '10-19 19:40', prompt: '야간 작업 1일차', nextAt: NOW + 60 * MIN, isDismissed: false },
        { id: 'night002', humanSchedule: '10-20 19:40', prompt: '야간 작업 2일차', isDismissed: false },
        { id: 'night003', humanSchedule: '10-21 19:40', prompt: '야간 작업 3일차', isDismissed: false }] },
      { sessionId: JOB, shortId: 'bbbb0000', label: 'tools', isAlive: true, source: 'plugin', jobs: [{ id: 'job00001', humanSchedule: 'x', prompt: 'pull develop', isDismissed: false }] },
    ],
  }))
  const text = await call($, { tool: 'mcp__clock-out__status' })
  expect(text).toContain('세션 2개, 예약 4건(숨김 제외) — clock-out 앱 목록과 같음')
  expect(text).toContain('예약작업 · cccc0000 — 켜짐 · 대화 기록에서 읽음')
  await call($, { tool: 'mcp__clock-out__send', session: 'cccc', text: '내일 것만 취소해' })
  expect(sent).toEqual([TRANSCRIPT])
})

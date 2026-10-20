import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryFs } from './support'

// The remote jobs session's tools (hooks/remote.ts), called as the model would call them.

const REMOTE = 'aaaa0000-0000-4000-8000-0000000000aa'   // the remote jobs session (this session in these tests)
const JOB = 'bbbb0000-0000-4000-8000-0000000000bb'      // a session that owns a job
const ROOT = '/home/alice/.claude/clock-out'
const NOW = 1_800_000_000_000
const MIN = 60_000

function setup(on: On, job: Record<string, unknown>, settings?: Record<string, unknown>, own = REMOTE): Map<string, string> {
  const files = memoryFs(on)
  mock.env(on, { HOME: '/home/alice' })
  on('session.id', () => ({ value: own }))
  on('session.cwd', () => ({ value: own === REMOTE ? `${ROOT}/remote` : '/home/alice/tools' }))
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

// requests/<sessionId>.<id>.json, one file per request
const requestsOf = (files: Map<string, string>, sessionId: string) =>
  [...files.keys()].filter(k => k.startsWith(`${ROOT}/requests/${sessionId}.`)).map(k => ({ path: k, ...JSON.parse(files.get(k) ?? '{}') }))

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
  const [req, ...more] = requestsOf(files, JOB)
  expect(more).toHaveLength(0)
  expect(req?.path).toBe(`${ROOT}/requests/${JOB}.${req?.id}.json`)
  expect(req?.kind).toBe('wake')
  expect(req?.message).toBe('[clock-out 원격 지시] 22시로 미뤄')
  expect(text).toContain('깨워서')
})

test('open_remote asks first while a job runs, then queues after the run', async ($, on) => {
  const files = setup(on, { alive: false, heartbeatAt: NOW - 60 * MIN, running: { promptHead: 'pull develop', firedAt: NOW - MIN } })
  await mock.clock(on).set(NOW)
  const asked = (await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000' }))
  expect(asked).toContain('취소되거나 중복 실행될 가능성이 있습니다')
  expect(asked).toContain('현재 작업 중인 내용을 중지하고 원격을 사용하시겠습니까?')
  expect(requestsOf(files, JOB)).toHaveLength(0)
  await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000', when: 'afterRun' })
  expect(requestsOf(files, JOB)).toMatchObject([{ kind: 'openRemote', when: 'afterRun' }])
})

test('open_remote refuses a session that ran in the background without Remote Control', async ($, on) => {
  const files = setup(on, { bgSince: NOW - 600 * MIN })
  await mock.clock(on).set(NOW)
  const text = (await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000' }))
  expect(text).toContain('원격을 붙일 수 없습니다')
  expect(requestsOf(files, JOB)).toHaveLength(0)
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

// ── 0.13: inbox delivery records (F-01), run outcome in notices (F-02), app-state.json (F-04) ──

const OWN_FILE = `${ROOT}/sessions/${REMOTE}.json`
const INBOX = `${ROOT}/inbox/${REMOTE}`
const ownSession = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, sessionId: REMOTE, cwd: `${ROOT}/remote`, alive: true, dismissed: [], jobs: [], runs: [], ...extra })
const read = (files: Map<string, string>, path: string) => JSON.parse(files.get(path) ?? '{}')

// Starts the session (and its 15 s inbox timer) at NOW; returns the clock to step the reads with
async function started($: { session: { start: (e: never) => Promise<unknown> } }, on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const clock = mock.clock(on)
  await clock.set(NOW)
  await $.session.start({ cwd: `${ROOT}/remote` } as never)
  return clock
}

test('a failed submit leaves no deliveredAt and is retried after 15 s, then 60 s', async ($, on) => {
  const files = setup(on, {})
  files.set(OWN_FILE, ownSession())
  files.set(`${INBOX}/1-0.json`, JSON.stringify({ id: 'msg-1', text: 'first', at: 1 }))
  files.set(`${INBOX}/2-0.json`, JSON.stringify({ id: 'msg-2', text: 'second', at: 2 }))
  let refusals = 2
  let tries = 0
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    tries++
    if (refusals-- > 0) throw new Error('simulated submission rejection')
    submitted.push(e.text)
    return { text: '' }
  })
  const clock = await started($, on)

  await clock.set(NOW + 15_000)   // 1st read: refused
  const failed = read(files, `${INBOX}/1-0.json`)
  expect(failed.deliveredAt).toBeUndefined()
  expect(failed.submittingAt).toBeUndefined()
  expect(failed).toMatchObject({ attempts: 1, nextTryAt: NOW + 30_000 })
  expect(failed.lastError).toContain('prompt.submit')   // the kit reports the throwing hook as a rejected submit
  expect(read(files, `${INBOX}/2-0.json`).submittingAt).toBeUndefined()   // the one after it waits, to keep the order

  await clock.set(NOW + 30_000)   // 2nd read: refused again, next try 60 s later
  expect(read(files, `${INBOX}/1-0.json`)).toMatchObject({ attempts: 2, nextTryAt: NOW + 90_000 })
  for (const t of [45_000, 60_000, 75_000]) await clock.set(NOW + t)
  expect(tries).toBe(2)
  await clock.set(NOW + 90_000)
  expect(submitted).toEqual(['first', 'second'])
  expect(read(files, `${INBOX}/1-0.json`).deliveredAt).toBe(NOW + 90_000)
  expect(read(files, OWN_FILE).deliveredIds).toEqual(['msg-1', 'msg-2'])
})

test('after the 5th failed submit a message is failed and never submitted again', async ($, on) => {
  const files = setup(on, {})
  files.set(OWN_FILE, ownSession())
  files.set(`${INBOX}/1-0.json`, JSON.stringify({ id: 'msg-1', text: 'first', at: 1, attempts: 4, nextTryAt: NOW }))
  let tries = 0
  on('prompt.submit', () => { tries++; return { drop: 'a hook refused it' } })
  const clock = await started($, on)
  await clock.set(NOW + 15_000)
  expect(read(files, `${INBOX}/1-0.json`)).toMatchObject({ attempts: 5, state: 'failed', lastError: 'dropped: a hook refused it' })
  for (const t of [30_000, 45_000, 60_000, 6 * MIN]) await clock.set(NOW + t)
  expect(tries).toBe(1)
})

test('a message left with submittingAt and no deliveredAt (stopped mid-submit) becomes unknown and is not resubmitted', async ($, on) => {
  const files = setup(on, {})
  files.set(OWN_FILE, ownSession())
  files.set(`${INBOX}/1-0.json`, JSON.stringify({ id: 'msg-1', text: 'first', at: 1, submittingAt: NOW - MIN }))
  files.set(`${INBOX}/2-0.json`, JSON.stringify({ id: 'msg-2', text: 'second', at: 2 }))
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => { submitted.push(e.text); return { text: '' } })
  const clock = await started($, on)
  await clock.set(NOW + 15_000)
  await clock.set(NOW + 30_000)
  expect(read(files, `${INBOX}/1-0.json`).state).toBe('unknown')
  expect(read(files, `${INBOX}/1-0.json`).deliveredAt).toBeUndefined()
  expect(submitted).toEqual(['second'])
})

test('the same message id twice is submitted once; a message without an id goes by its file name', async ($, on) => {
  const files = setup(on, {})
  files.set(OWN_FILE, ownSession({ deliveredIds: ['3-0.json'] }))
  files.set(`${INBOX}/1-0.json`, JSON.stringify({ id: 'same', text: 'once', at: 1 }))
  files.set(`${INBOX}/2-0.json`, JSON.stringify({ id: 'same', text: 'once', at: 1 }))
  files.set(`${INBOX}/3-0.json`, JSON.stringify({ text: 'from an older app, already submitted', at: 3 }))
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => { submitted.push(e.text); return { text: '' } })
  const clock = await started($, on)
  await clock.set(NOW + 15_000)
  expect(submitted).toEqual(['once'])
  expect(read(files, `${INBOX}/2-0.json`).deliveredAt).toBe(NOW + 15_000)
  expect(read(files, `${INBOX}/3-0.json`).deliveredAt).toBe(NOW + 15_000)
})

test('messages and requests carry an id; two requests to one session are two files', async ($, on) => {
  const files = setup(on, {})
  await mock.clock(on).set(NOW)
  await call($, { tool: 'mcp__clock-out__send', session: 'bbbb0000', text: 'hello' })
  const posted = [...files.keys()].filter(k => k.startsWith(`${ROOT}/inbox/${JOB}/`)).map(k => read(files, k))
  expect(posted[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
  files.set(`${ROOT}/sessions/${JOB}.json`, JSON.stringify({ ...read(files, `${ROOT}/sessions/${JOB}.json`), alive: false, heartbeatAt: NOW - 60 * MIN }))
  await call($, { tool: 'mcp__clock-out__send', session: 'bbbb0000', text: 'one' })
  await call($, { tool: 'mcp__clock-out__send', session: 'bbbb0000', text: 'two' })
  const reqs = requestsOf(files, JOB)
  expect(reqs.map(r => r.message).sort()).toEqual(['[clock-out 원격 지시] one', '[clock-out 원격 지시] two'])
  expect(new Set(reqs.map(r => r.id)).size).toBe(2)
})

// A scheduled job of JOB fires and ends with `reason`; returns the notices that reached the remote jobs session's inbox
async function finishJob($: { prompt: { submit: (e: never) => Promise<unknown> }; turn: { complete: (e: never) => Promise<unknown> } }, on: On, files: Map<string, string>, reason: string) {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }) as never)
  await mock.clock(on).set(NOW)
  await $.prompt.submit({ text: 'npm run build', origin: { kind: 'scheduled-trigger' } } as never)
  await $.turn.complete({ reason, durationMs: 60_000, answer: '빌드 실패 원인을 찾았습니다' } as never)
  return [...files.keys()].filter(k => k.startsWith(`${INBOX}/`)).map(k => String(read(files, k).text))
}

test('a run that ended with error is recorded as taskOutcome failed and sent under notify failures', async ($, on) => {
  const files = setup(on, {}, { remote: { enabled: true, notify: 'failures' } }, JOB)
  const notices = await finishJob($ as never, on, files, 'error')
  expect(read(files, `${ROOT}/sessions/${JOB}.json`).runs.at(-1)).toMatchObject({ reason: 'error', taskOutcome: 'failed' })
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('✗')
})

test('an answered run is unverified, not success: no notice under failures', async ($, on) => {
  const files = setup(on, {}, { remote: { enabled: true, notify: 'failures' } }, JOB)
  const notices = await finishJob($ as never, on, files, 'answer')
  expect(read(files, `${ROOT}/sessions/${JOB}.json`).runs.at(-1)).toMatchObject({ reason: 'answer', taskOutcome: 'unverified' })
  expect(notices).toEqual([])
})

test('notify all sends an answered run too, marked as answered but unverified', async ($, on) => {
  const files = setup(on, {}, { remote: { enabled: true, notify: 'all' } }, JOB)
  const notices = await finishJob($ as never, on, files, 'answer')
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('응답 완료 · 성공 미검증')
  expect(notices[0]).not.toContain('✓')
})

test('open_remote reads remoteSince / bgSince from app-state.json when the session file has none', async ($, on) => {
  const files = setup(on, { alive: false, heartbeatAt: NOW - 60 * MIN })
  files.set(`${ROOT}/app-state.json`, JSON.stringify({ version: 1, sessions: { [JOB]: { bgSince: NOW - 600 * MIN } } }))
  await mock.clock(on).set(NOW)
  expect(await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000' })).toContain('원격을 붙일 수 없습니다')
  files.set(`${ROOT}/app-state.json`, JSON.stringify({ version: 1, sessions: { [JOB]: { bgSince: NOW - 600 * MIN, remoteSince: NOW - 600 * MIN } } }))
  expect(await call($, { tool: 'mcp__clock-out__open_remote', session: 'bbbb0000' })).toContain('꺼져 있어 깨웁니다')
  expect(requestsOf(files, JOB)).toMatchObject([{ kind: 'wake' }])
})

test('status without the app list marks a job the app hid in app-state.json and leaves it out of the count', async ($, on) => {
  const files = setup(on, {})
  files.set(`${ROOT}/app-state.json`, JSON.stringify({ version: 1, sessions: { [JOB]: { hidden: { job00001: true } } } }))
  await mock.clock(on).set(NOW)
  const text = await call($, { tool: 'mcp__clock-out__status' })
  expect(text).toContain('예약 0건(숨김 제외)')
  expect(text).toMatch(/\[job00001\][^\n]*· 숨김/)
})

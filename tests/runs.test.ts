import { expect, test } from 'claude-code/testing'

import { applyRun, applyRunning } from '../hooks/runs'
import { emptySessionFile } from '../hooks/schema'

function fileWithJobs() {
  const file = emptySessionFile('s1', '/home/alice/proj')
  file.jobs.push(
    { id: 'rec00001', cron: '3 21 * * *', prompt: 'nightly sync', recurring: true, createdAt: 1 },
    { id: 'one00001', cron: '0 9 20 10 *', prompt: '  evening task  ', recurring: false, createdAt: 1 },
  )
  return file
}

test('applyRun matches the job by prompt and keeps the outcome', async () => {
  const file = fileWithJobs()
  const run = applyRun(file, { prompt: 'nightly sync', firedAt: 1000 }, { reason: 'answer', durationMs: 4200, answer: 'done: 3 files' }, 5200)
  expect(run.jobId).toBe('rec00001')
  expect(file.runs).toHaveLength(1)
  expect(file.runs[0]?.reason).toBe('answer')
  expect(file.runs[0]?.answerHead).toBe('done: 3 files')
  expect(file.jobs[0]?.firedAt).toBeUndefined()   // recurring: stays
})

test('applyRun marks a fired one-shot and tolerates surrounding whitespace', async () => {
  const file = fileWithJobs()
  const run = applyRun(file, { prompt: 'evening task', firedAt: 1000 }, { reason: 'answer', durationMs: 10, answer: 'ok' }, 1010)
  expect(run.jobId).toBe('one00001')
  expect(file.jobs[1]?.firedAt).toBe(1010)
})

test('applyRun records an unmatched prompt without a jobId and caps the log', async () => {
  const file = fileWithJobs()
  for (let i = 0; i < 35; i++) applyRun(file, { prompt: `other ${i}`, firedAt: i }, { reason: 'error', durationMs: 1, answer: '' }, i + 1)
  expect(file.runs).toHaveLength(30)
  expect(file.runs[29]?.jobId).toBeUndefined()
  expect(file.runs[29]?.promptHead).toBe('other 34')
})

test('applyRunning names the job of the fired prompt, and leaves jobId out when none matches', async () => {
  const file = fileWithJobs()
  applyRunning(file, { prompt: 'evening task', firedAt: 1000 })
  expect(file.running).toEqual({ promptHead: 'evening task', firedAt: 1000, jobId: 'one00001' })
  applyRunning(file, { prompt: 'someone else', firedAt: 2000 })
  expect(file.running).toEqual({ promptHead: 'someone else', firedAt: 2000 })
})

// ── 0.13: answered is not success (F-02), same prompt in two jobs (F-07) ──

test('applyRun keeps the turn reason apart from the task outcome: answer is unverified, anything else failed', async () => {
  const file = fileWithJobs()
  expect(applyRun(file, { prompt: 'nightly sync', firedAt: 1 }, { reason: 'answer', durationMs: 1, answer: 'build failed, cause found' }, 2).taskOutcome).toBe('unverified')
  for (const reason of ['error', 'aborted', 'refusal']) {
    expect(applyRun(file, { prompt: 'nightly sync', firedAt: 1 }, { reason, durationMs: 1, answer: '' }, 2).taskOutcome).toBe('failed')
  }
})

const HOUR = 3_600_000
function twinJobs() {
  const file = emptySessionFile('s1', '/home/alice/proj')
  file.jobs.push(
    { id: 'morning1', cron: '0 9 * * *', prompt: 'same task', recurring: true, createdAt: 1, nextFireAt: 9 * HOUR },
    { id: 'evening1', cron: '0 21 * * *', prompt: 'same task', recurring: true, createdAt: 1, nextFireAt: 21 * HOUR },
  )
  return file
}

test('two jobs with the same prompt: the run goes to the one whose nextFireAt is within 2 min of firedAt', async () => {
  const file = twinJobs()
  const run = applyRun(file, { prompt: 'same task', firedAt: 21 * HOUR + 40_000 }, { reason: 'answer', durationMs: 1, answer: '' }, 21 * HOUR + 60_000)
  expect(run.jobId).toBe('evening1')
  expect(run.ambiguous).toBeUndefined()
})

test('two jobs with the same prompt and no nextFireAt near firedAt: no jobId, ambiguous (never the first job)', async () => {
  const file = twinJobs()
  const run = applyRun(file, { prompt: 'same task', firedAt: 15 * HOUR }, { reason: 'answer', durationMs: 1, answer: '' }, 15 * HOUR + 1)
  expect(run.jobId).toBeUndefined()
  expect(run.ambiguous).toBe(true)
  const tie = twinJobs()
  for (const j of tie.jobs) j.nextFireAt = 9 * HOUR
  expect(applyRun(tie, { prompt: 'same task', firedAt: 9 * HOUR }, { reason: 'answer', durationMs: 1, answer: '' }, 9 * HOUR + 1).ambiguous).toBe(true)
})

test('the job is decided when the prompt fires, even if CronList moves nextFireAt before the turn ends', async () => {
  const file = twinJobs()
  const pending = { prompt: 'same task', firedAt: 9 * HOUR + 30_000 }
  const match = applyRunning(file, pending)
  expect(file.running).toMatchObject({ jobId: 'morning1' })
  for (const j of file.jobs) j.nextFireAt = (j.nextFireAt ?? 0) + 24 * HOUR   // the next day's times
  expect(applyRun(file, { ...pending, match }, { reason: 'answer', durationMs: 1, answer: '' }, 9 * HOUR + 60_000).jobId).toBe('morning1')
})

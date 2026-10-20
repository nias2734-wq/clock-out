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

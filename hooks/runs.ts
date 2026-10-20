import type { EngineInterface, On } from 'claude-code'

import { matchJob, RUNS_KEPT, taskOutcomeOf } from './schema'
import type { JobMatch, Run, SessionFile } from './schema'
import { touchStamp, updateOwnSession } from './sessionFile'
import { noteOrder, noticeOfRun, REPLY_MARK, sendToRemote, takeOrder } from './remote'
import { labelOf } from './overview'

// A scheduled job firing is a prompt the engine submits with origin.kind 'scheduled-trigger'; the turn it starts
// ends with turn.complete (agentId absent for the main loop). The pair becomes one Run on the session file.
// While it runs, the file says so (running), so the remote jobs session can warn before reopening this session.
// An instruction from the remote jobs session (ORDER_MARK) is answered back to it when its turn ends.

export type Pending = { prompt: string; firedAt: number; match?: JobMatch }   // match: decided when it fired (nextFireAt moves on later)
export type Outcome = { reason: string; durationMs: number; answer: string }

const CRONLIST_RESYNC_DELAY_MS = 1_500   // a fired one-shot has left CronList by then

function head(text: string, n: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, n)
}

// Pure: records the run on the file and marks a fired one-shot. Returns the run.
export function applyRun(file: SessionFile, pending: Pending, outcome: Outcome, finishedAt: number): Run {
  const match = pending.match ?? matchJob(file, pending.prompt, pending.firedAt)
  const job = match.job === undefined ? undefined : file.jobs.find(j => j.id === match.job?.id)
  const run: Run = {
    jobId: job?.id,
    ...(match.ambiguous === true ? { ambiguous: true as const } : {}),
    promptHead: head(pending.prompt, 120),
    firedAt: pending.firedAt,
    finishedAt,
    reason: outcome.reason,
    taskOutcome: taskOutcomeOf(outcome.reason),
    durationMs: outcome.durationMs,
    answerHead: head(outcome.answer, 200),
  }
  file.runs = [...file.runs, run].slice(-RUNS_KEPT)
  if (job !== undefined && !job.recurring && job.firedAt === undefined) job.firedAt = finishedAt
  return run
}

// Pure: marks the file as running the fired prompt, with the job it belongs to when the prompt matches one. Returns the match.
export function applyRunning(file: SessionFile, pending: Pending): JobMatch {
  const match = matchJob(file, pending.prompt, pending.firedAt)
  const jobId = match.job?.id
  file.running = { promptHead: head(pending.prompt, 120), firedAt: pending.firedAt, ...(jobId !== undefined ? { jobId } : {}), ...(match.ambiguous === true ? { ambiguous: true as const } : {}) }
  return match
}

async function resyncCronList($: EngineInterface): Promise<void> {
  try {
    await $.tool.call({ tool: 'CronList' })
  } catch {
    // refused: the file keeps what it had
  }
}

export function registerRuns(on: On): void {
  let pending: Pending | undefined

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'scheduled-trigger') {
      const fired: Pending = { prompt: e.text, firedAt: await $.clock.now() }
      pending = fired
      await updateOwnSession($, file => { fired.match = applyRunning(file, fired) }).catch(() => undefined)
      await touchStamp($).catch(() => undefined)
    } else {
      noteOrder(e.text)   // typed or pasted with the mark; the inbox marks its own submissions
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const fired = pending
    if (fired !== undefined && e.agentId === undefined) {
      pending = undefined
      const now = await $.clock.now()
      // a refusal carries its text as `text`, every other reason as `answer`
      const said = e as { answer?: string; text?: string }
      const outcome: Outcome = { reason: e.reason, durationMs: e.durationMs, answer: said.answer ?? said.text ?? '' }
      let run: Run | undefined
      await updateOwnSession($, file => { run = applyRun(file, fired, outcome, now); delete file.running })
      await touchStamp($)
      $.clock.after(CRONLIST_RESYNC_DELAY_MS, () => { void resyncCronList($) })
      // the result to the remote jobs session, as the app's notify setting says
      const notice = run === undefined ? undefined : await noticeOfRun($, run).catch(() => undefined)
      if (notice !== undefined) await sendToRemote($, notice)
    } else if (e.agentId === undefined) {
      const asked = takeOrder()
      if (asked === undefined) return next(e)
      const said = e as { answer?: string; text?: string }
      const label = labelOf(await $.session.cwd())
      const short = (await $.session.id()).slice(0, 8)
      await sendToRemote($, `${REPLY_MARK} ${label} · ${short} ("${asked}"): ${head(said.answer ?? said.text ?? e.reason, 600)}`)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))
}

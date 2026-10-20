import type { EngineInterface } from 'claude-code'

import { clockOutPaths, sessionFilePath } from './paths'
import { liveJobs } from './schema'
import type { Job, SessionFile } from './schema'
import { readSessionFile, touchStamp, updateOwnSession } from './sessionFile'

// Claude Code deletes a recurring job 7 days after CronCreate. A session that is still running can renew its own
// jobs: CronDelete then CronCreate with the same cron and prompt (jobs.ts records both). A stopped session is
// woken by the service (or `/clock-out revive`) and renews on its next check.

const CHECK_MS = 10 * 60 * 1000
const RETRY_MS = 24 * 60 * 60 * 1000   // one attempt per job per day
const FALLBACK_DELAY_MS = 1_000

// Pure: live recurring jobs whose expiry is within leadMs and that were not tried in the last RETRY_MS.
export function selectExpiring(file: SessionFile, now: number, leadMs: number): Job[] {
  return liveJobs(file).filter(j =>
    j.recurring &&
    j.expiresAt !== undefined &&
    j.expiresAt - now <= leadMs &&
    (j.reregisterTriedAt === undefined || now - j.reregisterTriedAt >= RETRY_MS))
}

async function ownFile($: EngineInterface): Promise<SessionFile | undefined> {
  const paths = await clockOutPaths($)
  return readSessionFile($, sessionFilePath(paths, await $.session.id()))
}

// Re-registers one job. Returns a one-line outcome. On a refused CronCreate (a permission mode that asks),
// hands the task to the model with a prompt instead.
async function reregisterOne($: EngineInterface, job: Job): Promise<string> {
  const now = await $.clock.now()
  await updateOwnSession($, file => { for (const j of file.jobs) if (j.id === job.id) j.reregisterTriedAt = now })

  const deleted = await $.tool.call({ tool: 'CronDelete', id: job.id })
  if (deleted.deny !== undefined || deleted.isError === true) {
    return `${job.id}: CronDelete refused (${deleted.deny ?? deleted.text ?? 'error'})`
  }
  const created = await $.tool.call({ tool: 'CronCreate', cron: job.cron, prompt: job.prompt, recurring: true })
  if (created.deny === undefined && created.isError !== true && created.result !== undefined) {
    return `${job.id} → ${created.result.id}: re-registered (${created.result.humanSchedule})`
  }
  // The old job is gone and the new one was refused: let the model do it, so the schedule is not lost.
  // Submitted from a timer, not from this hook: the host refuses a prompt.submit raised inside a command.run hook.
  const text = `clock-out: the recurring job ${job.id} (cron "${job.cron}") was deleted to renew it before its 7-day expiry, ` +
    `but CronCreate was refused here. Call CronCreate now with cron "${job.cron}", recurring true and exactly this prompt, then stop:\n${job.prompt}`
  $.clock.after(FALLBACK_DELAY_MS, () => { void $.prompt.submit({ text }) })
  return `${job.id}: CronCreate refused, asked the model to re-register it`
}

// Renews what is about to expire (or, with `all`, every live recurring job). Returns the outcome lines.
export async function reregisterExpiring($: EngineInterface, leadMs: number, all = false): Promise<string[]> {
  const file = await ownFile($)
  if (file === undefined) return ['No session file yet.']
  const now = await $.clock.now()
  const jobs = all ? liveJobs(file).filter(j => j.recurring) : selectExpiring(file, now, leadMs)
  if (jobs.length === 0) return [all ? 'No recurring jobs in this session.' : 'Nothing expiring soon.']
  const lines: string[] = []
  for (const job of jobs) lines.push(await reregisterOne($, job))
  await touchStamp($)
  return lines
}

// Called from the module's one session.start hook: checks every 10 minutes.
export function startReregister($: EngineInterface, leadMs: number): void {
  $.clock.every(CHECK_MS, () => {
    void (async () => {
      try {
        const lines = await reregisterExpiring($, leadMs)
        if (lines.some(l => l.includes('re-registered') || l.includes('refused'))) $.ui.toast(`clock-out: ${lines.join('; ')}`)
      } catch {
        // next check tries again
      }
    })()
  })
}

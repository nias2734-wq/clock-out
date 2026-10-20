import type { EngineInterface } from 'claude-code'

import { clockOutPaths, sessionFilePath } from './paths'
import { liveJobs, WEEK_MS } from './schema'
import type { Job, Renewal, SessionFile } from './schema'
import { readSessionFile, touchStamp, updateOwnSession } from './sessionFile'

// Claude Code deletes a recurring job 7 days after CronCreate. A session that is still running can renew its own
// jobs: CronDelete then CronCreate with the same cron and prompt (jobs.ts records both). A stopped session is
// woken by the service (or `/clock-out revive`) and renews on its next check.
// The renewal is written to the session file before CronDelete (renewal, phase intent → old_removed) and removed once
// the new job exists, so a session stopped in between finds it at its next start or heartbeat and re-creates the job.

const CHECK_MS = 10 * 60 * 1000
const RETRY_MS = 24 * 60 * 60 * 1000   // one attempt per job per day
const BLOCKED_RETRY_MS = CHECK_MS      // a blocked renewal is tried again at most this often
const FALLBACK_DELAY_MS = 1_000

// Job ids this module is deleting to renew them: jobs.ts moves the renewal to old_removed in the same write as deletedAt,
// so a deletedAt while the phase is still intent means the user deleted the job.
export const renewalDeletes = new Set<string>()
let renewing = false   // a renewal or its recovery runs in this process

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

const samePrompt = (a: string, b: string) => a.trim() === b.trim()

async function clearRenewal($: EngineInterface, oldId: string, mutate?: (file: SessionFile) => void): Promise<void> {
  await updateOwnSession($, file => {
    if (file.renewal?.oldId === oldId) delete file.renewal
    mutate?.(file)
  })
  await touchStamp($)
}

// CronCreate for the renewal; a refusal leaves it blocked. The new job is recorded here too: a call this plugin makes
// from a timer does not pass through its own tool.call hooks (jobs.ts), as the test kit shows.
async function createRenewed($: EngineInterface, r: Renewal): Promise<{ newId?: string; error?: string; humanSchedule?: string }> {
  const created = await $.tool.call({ tool: 'CronCreate', cron: r.cron, prompt: r.prompt, recurring: r.recurring })
  if (created.deny === undefined && created.isError !== true && created.result !== undefined) {
    const res = created.result
    const now = await $.clock.now()
    await clearRenewal($, r.oldId, file => {
      if (file.jobs.some(j => j.id === res.id)) return
      const job: Job = { id: res.id, cron: r.cron, prompt: r.prompt, recurring: res.recurring, humanSchedule: res.humanSchedule, createdAt: now, nextFireAt: res.nextFireAt }
      if (res.recurring) job.expiresAt = now + WEEK_MS
      if (r.mode !== undefined) job.mode = r.mode
      file.jobs.push(job)
    })
    return { newId: res.id, humanSchedule: res.humanSchedule }
  }
  const error = (created.deny ?? created.text ?? 'error').slice(0, 300)
  const now = await $.clock.now()
  await updateOwnSession($, file => {
    if (file.renewal?.oldId !== r.oldId) return
    file.renewal.phase = 'blocked'
    file.renewal.lastError = error
    file.renewal.triedAt = now
  })
  await touchStamp($)
  return { error }
}

// Re-registers one job. Returns a one-line outcome. On a refused CronCreate (a permission mode that asks),
// hands the task to the model with a prompt instead.
async function reregisterOne($: EngineInterface, job: Job): Promise<string> {
  const now = await $.clock.now()
  const renewal: Renewal = { oldId: job.id, cron: job.cron, prompt: job.prompt, recurring: job.recurring, ...(job.mode !== undefined ? { mode: job.mode } : {}), phase: 'intent', startedAt: now }
  await updateOwnSession($, file => {
    for (const j of file.jobs) if (j.id === job.id) j.reregisterTriedAt = now
    file.renewal = renewal
  })

  renewalDeletes.add(job.id)
  let deleted
  try {
    deleted = await $.tool.call({ tool: 'CronDelete', id: job.id })
  } finally {
    renewalDeletes.delete(job.id)
  }
  if (deleted.deny !== undefined || deleted.isError === true) {
    await clearRenewal($, job.id)   // the old job is still scheduled
    return `${job.id}: CronDelete refused (${deleted.deny ?? deleted.text ?? 'error'})`
  }
  // deletedAt and old_removed in one write (jobs.ts does the same when its hook sees this call)
  const removedAt = await $.clock.now()
  await updateOwnSession($, file => {
    for (const j of file.jobs) if (j.id === job.id && j.deletedAt === undefined) j.deletedAt = removedAt
    if (file.renewal?.oldId === job.id && file.renewal.phase === 'intent') file.renewal.phase = 'old_removed'
  })

  const created = await createRenewed($, { ...renewal, phase: 'old_removed' })
  if (created.newId !== undefined) return `${job.id} → ${created.newId}: re-registered (${created.humanSchedule})`
  // The old job is gone and the new one was refused: let the model do it, so the schedule is not lost.
  // Submitted from a timer, not from this hook: the host refuses a prompt.submit raised inside a command.run hook.
  const text = `clock-out: the recurring job ${job.id} (cron "${job.cron}") was deleted to renew it before its 7-day expiry, ` +
    `but CronCreate was refused here. Call CronCreate now with cron "${job.cron}", recurring true and exactly this prompt, then stop:\n${job.prompt}`
  $.clock.after(FALLBACK_DELAY_MS, () => { void $.prompt.submit({ text }) })
  return `${job.id}: CronCreate refused, asked the model to re-register it`
}

// A renewal left in the session file (the session stopped mid-way, or CronCreate was refused): compared with CronList,
// the job is re-created when neither the old nor a new one is scheduled. A job the user deleted meanwhile stays deleted.
// Returns the outcome line, or undefined when there was nothing to do.
export async function recoverRenewal($: EngineInterface): Promise<string | undefined> {
  if (renewing) return undefined
  const file = await ownFile($)
  const r = file?.renewal
  if (file === undefined || r === undefined) return undefined
  const now = await $.clock.now()
  if (r.phase === 'blocked' && r.triedAt !== undefined && now - r.triedAt < BLOCKED_RETRY_MS) return undefined
  renewing = true
  try {
    // 1. deleted while the renewal had not deleted it yet: the user's CronDelete, not restored
    const old = file.jobs.find(j => j.id === r.oldId)
    if (r.phase === 'intent' && old?.deletedAt !== undefined) {
      await clearRenewal($, r.oldId)
      return `${r.oldId}: deleted by the user during its renewal, not restored`
    }
    // 2. what is scheduled now
    const listed = await $.tool.call({ tool: 'CronList' })
    if (listed.deny !== undefined || listed.isError === true || listed.result === undefined) {
      await updateOwnSession($, f => { if (f.renewal?.oldId === r.oldId) { f.renewal.triedAt = now; f.renewal.lastError = `CronList: ${listed.deny ?? listed.text ?? 'error'}`.slice(0, 300) } })
      return `${r.oldId}: renewal left as is, CronList refused`
    }
    const jobs = listed.result.jobs
    if (jobs.some(l => l.id !== r.oldId && l.cron === r.cron && samePrompt(l.prompt, r.prompt))) {
      await clearRenewal($, r.oldId)
      return `${r.oldId}: already re-created`
    }
    if (jobs.some(l => l.id === r.oldId)) {
      // never deleted: renew it again at the next check
      await clearRenewal($, r.oldId, f => { for (const j of f.jobs) if (j.id === r.oldId) delete j.reregisterTriedAt })
      return `${r.oldId}: still scheduled, renewal starts over`
    }
    // 3. neither is scheduled: create it again
    const created = await createRenewed($, r)
    return created.newId !== undefined ? `${r.oldId} → ${created.newId}: restored after an unfinished renewal` : `${r.oldId}: restoring refused (${created.error})`
  } finally {
    renewing = false
  }
}

// Renews what is about to expire (or, with `all`, every live recurring job). Returns the outcome lines.
// An unfinished renewal is settled first; while it stays blocked no other job is deleted.
export async function reregisterExpiring($: EngineInterface, leadMs: number, all = false): Promise<string[]> {
  const recovered = await recoverRenewal($)
  const file = await ownFile($)
  if (file === undefined) return ['No session file yet.']
  if (file.renewal !== undefined) {
    return [...(recovered !== undefined ? [recovered] : []), `${file.renewal.oldId}: renewal blocked (${file.renewal.lastError ?? file.renewal.phase}); no other job renewed until it is settled`]
  }
  const now = await $.clock.now()
  const jobs = all ? liveJobs(file).filter(j => j.recurring) : selectExpiring(file, now, leadMs)
  if (jobs.length === 0) return [...(recovered !== undefined ? [recovered] : []), all ? 'No recurring jobs in this session.' : 'Nothing expiring soon.']
  const lines: string[] = recovered !== undefined ? [recovered] : []
  renewing = true
  try {
    for (const job of jobs) {
      lines.push(await reregisterOne($, job))
      if ((await ownFile($))?.renewal !== undefined) break   // refused: the rest wait until this one is settled
    }
  } finally {
    renewing = false
  }
  await touchStamp($)
  return lines
}

// Called from the module's one session.start hook: checks every 10 minutes.
export function startReregister($: EngineInterface, leadMs: number): void {
  $.clock.every(CHECK_MS, () => {
    void (async () => {
      try {
        const lines = await reregisterExpiring($, leadMs)
        if (lines.some(l => l.includes('re-registered') || l.includes('refused') || l.includes('restored'))) $.ui.toast(`clock-out: ${lines.join('; ')}`)
      } catch {
        // next check tries again
      }
    })()
  })
}

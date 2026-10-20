import type { EngineInterface, SessionEndInput, SessionStartInput } from 'claude-code'

import { recordCronList } from './jobs'
import { clockOutPaths } from './paths'
import { recoverRenewal } from './reregister'
import { touchStamp, updateOwnSession } from './sessionFile'

const HEARTBEAT_MS = 60_000
const CRONLIST_SYNC_DELAY_MS = 3_000   // let the session finish starting before the first tool call

type LiveRecord = { pid?: number; kind?: 'interactive' | 'background'; name?: string }

// Claude Code writes <configDir>/sessions/<pid>.json for every running session: { pid, sessionId, kind, name, ... }.
// Reading it is the only way a module learns whether it runs in a background session.
async function findLiveRecord($: EngineInterface, sessionId: string): Promise<LiveRecord> {
  try {
    const paths = await clockOutPaths($)
    const entries = await $.fs.list(paths.liveSessionsDir)
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const text = await $.fs.read(`${paths.liveSessionsDir}/${entry.name}`)
        if (typeof text !== 'string') continue
        const record = JSON.parse(text) as { pid?: number; sessionId?: string; kind?: string; name?: string }
        if (record.sessionId !== sessionId) continue
        const kind = record.kind === 'bg' || record.kind === 'background' ? 'background' : record.kind === 'interactive' ? 'interactive' : undefined
        return { pid: record.pid, kind, name: record.name }
      } catch {
        // a half-written record: skip it
      }
    }
  } catch {
    // no sessions dir (older build, or a -p run): fine
  }
  return {}
}

async function syncCronList($: EngineInterface): Promise<void> {
  try {
    // recorded here: a call from this timer does not pass through jobs.ts's CronList hook
    const listed = await $.tool.call({ tool: 'CronList' })
    if (listed.deny === undefined && listed.isError !== true && listed.result !== undefined) await recordCronList($, listed.result.jobs)
  } catch {
    // refused or unavailable: the file keeps what it had
  }
}

// Called from the module's one session.start hook (register.tsx).
export async function startHeartbeat($: EngineInterface, e: SessionStartInput): Promise<void> {
    const sessionId = await $.session.id()
    const now = await $.clock.now()
    const live = await findLiveRecord($, sessionId)
    await updateOwnSession($, file => {
      file.cwd = e.cwd
      file.alive = true
      file.startedAt = now
      file.heartbeatAt = now
      delete file.endedAt
      delete file.endReason
      if (live.pid !== undefined) file.pid = live.pid
      if (live.kind !== undefined) file.kind = live.kind
      // kept after a later terminal resume overwrites kind: a session that ran with --bg has saved options, so later wakes pass no flags
      if (live.kind === 'background' && file.bgSince === undefined) file.bgSince = now
      if (live.name !== undefined) file.name = live.name
    })
    await touchStamp($)

    // an unfinished 7-day renewal is checked against CronList at start and on every heartbeat
    $.clock.after(CRONLIST_SYNC_DELAY_MS, () => { void syncCronList($).then(() => recoverRenewal($)).catch(() => undefined) })
    $.clock.every(HEARTBEAT_MS, () => {
      void (async () => {
        const at = await $.clock.now()
        await updateOwnSession($, file => { file.alive = true; file.heartbeatAt = at })
        await recoverRenewal($).catch(() => undefined)
      })()
    })
}

// Called from the module's one session.end hook. 1.5 s budget: one small write, nothing else.
export async function endSession($: EngineInterface, e: SessionEndInput): Promise<void> {
  const now = await $.clock.now()
  await updateOwnSession($, file => {
    file.alive = false
    file.endedAt = now
    file.endReason = e.reason
  })
}

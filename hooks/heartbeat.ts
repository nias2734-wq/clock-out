import type { EngineInterface, SessionEndInput, SessionStartInput } from 'claude-code'

import { clockOutPaths } from './paths'
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
    await $.tool.call({ tool: 'CronList' })   // jobs.ts records the answer
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
      if (live.name !== undefined) file.name = live.name
    })
    await touchStamp($)

    $.clock.after(CRONLIST_SYNC_DELAY_MS, () => { void syncCronList($) })
    $.clock.every(HEARTBEAT_MS, () => {
      void (async () => {
        const at = await $.clock.now()
        await updateOwnSession($, file => { file.alive = true; file.heartbeatAt = at })
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

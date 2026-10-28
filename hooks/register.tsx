import type { Register } from 'claude-code'

import { startCommand, registerCommand } from './command'
import { syncServiceConfig } from './config'
import { registerGuard } from './guard'
import { endSession, startHeartbeat } from './heartbeat'
import { registerJobs, startJobModeTool } from './jobs'
import { registerPane } from './pane'
import { startReregister } from './reregister'
import { registerRemote, startInbox, startRemoteTools } from './remote'
import { registerRuns } from './runs'

const HOUR_MS = 60 * 60 * 1000

// Wiring only. The engine allows one unmatched hook per event, so session.start / session.end are joined here.
export const register: Register = (on, options) => {
  const expiryLeadHours = Number(options.expiryLeadHours ?? 24)
  const expiryLeadMs = (Number.isFinite(expiryLeadHours) && expiryLeadHours > 0 ? expiryLeadHours : 24) * HOUR_MS

  on('session.start', async ($, e, next) => {
    await startHeartbeat($, e)
    await syncServiceConfig($, options)
    await startCommand($, expiryLeadMs)
    startReregister($, expiryLeadMs)
    await startJobModeTool($).catch(() => undefined)   // every session
    await startRemoteTools($, e.cwd).catch(() => undefined)   // only in the remote jobs session
    startInbox($)   // messages from the remote jobs session, its replies and notices
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    await endSession($, e)
    return next(e)
  })
  registerJobs(on)
  registerRuns(on)
  registerGuard(on)
  registerRemote(on)
  registerCommand(on, expiryLeadMs)
  registerPane(on)
}

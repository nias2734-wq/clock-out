import type { EngineInterface, On } from 'claude-code'

import { readAppState } from './appState'
import { buildOverview, formatOverview, refreshOverview } from './overview'
import { reregisterExpiring } from './reregister'
import { findSessionId, reviveSession } from './revive'
import { clockOutPaths, sessionFilePath } from './paths'
import { emptySessionFile } from './schema'
import { updateSessionFile } from './sessionFile'

export const PANE_ID = 'schedule'
export const COMMAND = 'clock-out'
const PANE_REFRESH_MS = 60_000

// /clock-out              list every session's jobs (text) and open the pane
// /clock-out hide <job>   hide (or unhide) a stopped session's job so the service stops reviving that session for it
// /clock-out revive <s>   wake a stopped session in the background (claude --bg --resume) so its jobs fire again
// /clock-out reregister [all]  re-register this session's expiring (or all) recurring jobs now
// Called from the module's one session.start hook (register.tsx): declares /clock-out and starts the pane refresh timer.
export async function startCommand($: EngineInterface, _expiryLeadMs: number): Promise<void> {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'clock-out: jobs of every session (list, revive a stopped session, hide a job)',
        argumentHint: '[hide <job> | revive <session> | reregister [all]]',
      })
    } catch {
      // a name refused (another plugin took it): the pane still works through ui.open elsewhere
    }
    // While the pane is open, keep it current without the person pressing Refresh.
    $.clock.every(PANE_REFRESH_MS, () => {
      void (async () => {
        try {
          const panes = await $.ui.panes()
          if (panes.some(p => p.id === PANE_ID && p.isShown)) await refreshOverview($)
        } catch {
          // no surface attached
        }
      })()
    })
}

export function registerCommand(on: On, expiryLeadMs: number): void {
  on('command.run', { command: COMMAND }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'hide') {
      if (arg === undefined || arg === '') return { text: 'Usage: /clock-out hide <job id>' }
      return { text: await toggleHide($, arg) }
    }
    if (verb === 'revive') {
      if (arg === undefined || arg === '') return { text: 'Usage: /clock-out revive <session id or prefix>' }
      const sessionId = await findSessionId($, arg)
      if (sessionId === undefined) return { text: `No single stopped-or-running session matches "${arg}".` }
      const message = await reviveSession($, sessionId)
      await refreshOverview($, message)
      return { text: message }
    }
    if (verb === 'reregister') {
      const lines = await reregisterExpiring($, expiryLeadMs, arg === 'all')
      await refreshOverview($, lines.join('; '))
      return { text: lines.join('\n') }
    }

    const overview = await refreshOverview($)
    const now = await $.clock.now()
    let text = formatOverview(overview, now)
    try {
      const opened = await $.ui.open({ id: PANE_ID, title: 'Schedule' })
      if (!opened.isPlaced) text += `\n(pane not drawn: ${opened.reason})`
    } catch {
      // no surface (a -p run): text is the whole answer
    }
    return { text }
  }).catch((_$, _e, next) => (next.called ? next(_e) : { text: 'service: the command failed; see the debug log.' }))
}

// Hides a job of a stopped session (the service then leaves that session alone for it), or unhides it.
// A running session's job is its own business: only CronDelete there removes it.
// This is the one place a session writes another session's file, and only when that session is stopped.
export async function toggleHide($: EngineInterface, jobId: string): Promise<string> {
  const overview = await buildOverview($)
  const owner = overview.sessions.find(s => s.jobs.some(j => j.id === jobId))
  if (owner === undefined) return `No job ${jobId} in any session.`
  if (owner.isAlive) return `${jobId} belongs to running session ${owner.shortId}: delete it there with CronDelete ${jobId}.`
  // the app's hidden (app-state.json) wins over dismissed, so toggling dismissed would change nothing; only the app writes it
  const appHidden = (await readAppState($))?.sessions[owner.sessionId]?.hidden
  if (appHidden !== undefined && Object.prototype.hasOwnProperty.call(appHidden, jobId)) {
    return `${jobId} was ${appHidden[jobId] === true ? 'hidden' : 'shown'} in the clock-out app: change it there (the app's choice overrides this command).`
  }
  const paths = await clockOutPaths($)
  let hidden = false
  await updateSessionFile($, sessionFilePath(paths, owner.sessionId), () => emptySessionFile(owner.sessionId, owner.cwd), file => {
    if (file.dismissed.includes(jobId)) {
      file.dismissed = file.dismissed.filter(id => id !== jobId)
    } else {
      file.dismissed.push(jobId)
      hidden = true
    }
  })
  const message = hidden
    ? `Hidden ${jobId}: the service will not revive ${owner.shortId} for it.`
    : `Unhidden ${jobId}: the service may revive ${owner.shortId} for it again.`
  await refreshOverview($, message)
  return message
}

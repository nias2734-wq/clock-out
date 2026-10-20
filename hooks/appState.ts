import type { EngineInterface } from 'claude-code'

import { clockOutPaths } from './paths'

// The desktop app's own state per session (<config>/clock-out/app-state.json), read-only from here. Since 0.13 the app
// keeps bgSince / remoteSince there instead of writing into the plugin's session files; older files still carry them.
// Same shape as the app's AppSessionState / AppState (app/shared/types.ts); copied because the plugin builds without app/.
export type AppPermissionRecord = { mode: 'work' | 'bypass'; allowedTools: string[]; disallowedTools: string[]; at: number }
export type AppSessionState = {
  bgSince?: number                      // the app woke it with --bg for the first time (later wakes pass no flags)
  remoteSince?: number                  // that first --bg start carried --remote-control
  lastAttemptAt?: number                // the last `claude --bg --resume` the app ran for it
  lastSuccessAt?: number                // the last wake that came up
  nextRetryAt?: number                  // a failed wake is tried again from then
  failures?: number                     // failed attempts since the last success
  blocked?: string                      // a login / permission failure: no automatic wake until a manual one succeeds
  lastError?: string                    // the last failure's output, first 160 chars
  permissionAtStart?: AppPermissionRecord
  hidden?: Record<string, boolean>      // jobId → hidden (true) or shown again (false); overrides the session file's dismissed
  missedDismissed?: Record<string, number>   // '<jobId>@<dueAt>' → when the person closed that missed job
}
export type AppStateFile = { version: 1; sessions: Record<string, AppSessionState>; requestsDone?: string[] }   // requestsDone: request ids the app carried out

export async function readAppState($: EngineInterface): Promise<AppStateFile | undefined> {
  try {
    const path = `${(await clockOutPaths($)).root}/app-state.json`
    if (!(await $.fs.exists(path))) return undefined
    const text = await $.fs.read(path)
    if (typeof text !== 'string') return undefined
    const parsed = JSON.parse(text.replace(/^﻿/, '')) as Partial<AppStateFile>
    return parsed.version === 1 && typeof parsed.sessions === 'object' && parsed.sessions !== null ? parsed as AppStateFile : undefined
  } catch {
    return undefined
  }
}

// bgSince / remoteSince of a session: the session file's value, else the app's
export async function backgroundOf($: EngineInterface, sessionId: string, file: { bgSince?: number; remoteSince?: number } | undefined): Promise<{ bgSince?: number; remoteSince?: number }> {
  const app = (await readAppState($))?.sessions[sessionId]
  return { bgSince: file?.bgSince ?? app?.bgSince, remoteSince: file?.remoteSince ?? app?.remoteSince }
}

// Whether a job is hidden: the app's hidden when it has the job, else the session file's dismissed (the app's dismissedWith)
export function isHiddenJob(fileDismissed: readonly string[], hidden: Record<string, boolean> | undefined, jobId: string): boolean {
  if (hidden !== undefined && Object.prototype.hasOwnProperty.call(hidden, jobId)) return hidden[jobId] === true
  return fileDismissed.includes(jobId)
}

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { paths } from './paths'

// <config>/clock-out/remote.json: which session is the remote jobs session. Written here, read by the plugin
// (hooks/remote.ts) to know where to send replies and finished-job notices.
export type RemoteState = { sessionId?: string; startedAt?: number }

export function readRemoteState(): RemoteState {
  try { return JSON.parse(readFileSync(paths.remoteState, 'utf8').replace(/^\uFEFF/, '')) as RemoteState } catch { return {} }
}

export function writeRemoteState(state: RemoteState): void {
  mkdirSync(dirname(paths.remoteState), { recursive: true })
  writeFileSync(paths.remoteState, JSON.stringify(state, null, 2), 'utf8')
}

export function isRemoteSession(sessionId: string): boolean {
  return readRemoteState().sessionId === sessionId
}

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { AppSessionState, AppState } from '@shared/types'

import { paths } from './paths'

// <config>/clock-out/app-state.json: what the app keeps per session (bgSince, wake attempts, hidden jobs …).
// Only this module writes it; the plugin's session files (sessions/<id>.json) are the plugin's and the app only reads them.
// A write goes to a temporary file first and then replaces the old one, so a reader never sees half a file.

const REQUESTS_KEPT = 200

const empty = (): AppState => ({ version: 1, sessions: {} })

// An unreadable or foreign file reads as empty (the wake guards then start over; nothing is lost from the plugin's files)
export function readAppState(): AppState {
  try {
    const parsed = JSON.parse(readFileSync(paths.appState, 'utf8').replace(/^﻿/, '')) as Partial<AppState>
    if (parsed.version !== 1 || typeof parsed.sessions !== 'object' || parsed.sessions === null) return empty()
    return { version: 1, sessions: parsed.sessions, requestsDone: Array.isArray(parsed.requestsDone) ? parsed.requestsDone.filter(x => typeof x === 'string') : undefined }
  } catch {
    return empty()
  }
}

let tmpCount = 0

// temporary file → rename; on Windows a rename can fail for a moment while a reader holds the file, so it is tried again
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${tmpCount++}.tmp`
  writeFileSync(tmp, text, 'utf8')
  for (let i = 0; ; i++) {
    try { renameSync(tmp, path); return } catch (err) {
      if (i >= 4) { try { unlinkSync(tmp) } catch { /* gone */ } throw err }
      const until = Date.now() + 20 * (i + 1)
      while (Date.now() < until) { /* short busy wait: this runs between two synchronous reads of the same process */ }
    }
  }
}

// Read, change, write in one synchronous step (no other code of this process runs in between)
export function updateAppState(change: (state: AppState) => void): AppState {
  const state = readAppState()
  change(state)
  writeAtomic(paths.appState, JSON.stringify(state, null, 2))
  return state
}

export function sessionState(sessionId: string): AppSessionState {
  return readAppState().sessions[sessionId] ?? {}
}

// Merges fields into one session's entry; a field given as undefined is removed
export function patchSession(sessionId: string, patch: Partial<AppSessionState>): AppSessionState {
  let out: AppSessionState = {}
  updateAppState(state => {
    const next: AppSessionState = { ...(state.sessions[sessionId] ?? {}), ...patch }
    for (const key of Object.keys(next) as (keyof AppSessionState)[]) if (next[key] === undefined) delete next[key]
    state.sessions[sessionId] = next
    out = next
  })
  return out
}

// A plugin request id carried out: true when it was new (false = the same request again, to be ignored)
export function markRequestDone(id: string): boolean {
  let isNew = false
  updateAppState(state => {
    const done = state.requestsDone ?? []
    isNew = !done.includes(id)
    if (isNew) state.requestsDone = [...done, id].slice(-REQUESTS_KEPT)
  })
  return isNew
}

export function isRequestDone(id: string): boolean {
  return readAppState().requestsDone?.includes(id) === true
}

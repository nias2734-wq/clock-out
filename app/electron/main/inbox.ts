import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { InboxView } from '@shared/schedule'

import { log } from './log'
import { paths } from './paths'

// Messages to a session go through <config>/clock-out/inbox/<sessionId>/*.json: that session's plugin reads its inbox
// every 15 s and submits each message (hooks/remote.ts deliverInbox). The plugin writes back submittingAt / deliveredAt,
// or state 'failed' (gave up after 5 tries) / 'unknown' (may or may not have been submitted; never resubmitted).

const PENDING_MAX_AGE_MS = 24 * 3_600_000      // an undelivered message without a state is dropped after this
const PROBLEM_MAX_AGE_MS = 7 * 24 * 3_600_000  // a failed / unknown one stays this long so the panel can show it
const HEAD_CHARS = 80
const HEADS_KEPT = 3

type Message = { id?: string; text?: string; at?: number; from?: string; deliveredAt?: number; state?: 'failed' | 'unknown'; lastError?: string }

let posted = 0

// Writes one message with its own uuid; the plugin only reads *.json, so the temporary *.tmp is never picked up half written
export function postInbox(sessionId: string, text: string, tag = 'app'): string {
  const dir = join(paths.inboxDir, sessionId)
  mkdirSync(dir, { recursive: true })
  const at = Date.now()
  const id = randomUUID()
  const path = join(dir, `${at}-${tag}${posted++}.json`)
  writeFileSync(`${path}.tmp`, JSON.stringify({ id, text, at, from: 'app' }, null, 2), 'utf8')
  renameSync(`${path}.tmp`, path)
  return id
}

function readMessage(path: string): Message | undefined {
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as Message } catch { return undefined }
}

// Delivered messages go; an undelivered one after a day (logged); failed / unknown ones stay a week for the panel
export function clearInboxes(now = Date.now()): void {
  let sessions: string[] = []
  try { sessions = readdirSync(paths.inboxDir) } catch { return }
  for (const s of sessions) {
    let names: string[] = []
    try { names = readdirSync(join(paths.inboxDir, s)) } catch { continue }
    for (const name of names) {
      const path = join(paths.inboxDir, s, name)
      // a *.tmp left by a crash between write and rename
      if (name.endsWith('.tmp')) { try { if (now - statSync(path).mtimeMs > PENDING_MAX_AGE_MS) unlinkSync(path) } catch { /* gone */ } continue }
      if (!name.endsWith('.json')) continue
      const m = readMessage(path)
      if (m === undefined) continue   // half-written: next time
      const age = now - (m.at ?? 0)
      try {
        if (m.deliveredAt !== undefined) unlinkSync(path)
        else if (m.state !== undefined) { if (age > PROBLEM_MAX_AGE_MS) unlinkSync(path) }
        else if (age > PENDING_MAX_AGE_MS) {
          log(`INBOX ${s.slice(0, 8)} dropped an undelivered message after a day: ${(m.text ?? '').replace(/\s+/g, ' ').slice(0, 40)}`)
          unlinkSync(path)
        }
      } catch { /* in use: next time */ }
    }
  }
}

// sessionId → its failed / unknown messages (count and the first words of the newest few), for the panel
export function inboxProblems(): Map<string, InboxView> {
  const out = new Map<string, InboxView>()
  let sessions: string[] = []
  try { sessions = readdirSync(paths.inboxDir) } catch { return out }
  for (const s of sessions) {
    let names: string[] = []
    try { names = readdirSync(join(paths.inboxDir, s)) } catch { continue }
    const bad: (Message & { state: 'failed' | 'unknown' })[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const m = readMessage(join(paths.inboxDir, s, name))
      if (m?.state === 'failed' || m?.state === 'unknown') bad.push(m as Message & { state: 'failed' | 'unknown' })
    }
    if (bad.length === 0) continue
    bad.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    out.set(s, {
      failed: bad.filter(m => m.state === 'failed').length,
      unknown: bad.filter(m => m.state === 'unknown').length,
      items: bad.slice(0, HEADS_KEPT).map(m => ({ state: m.state, at: m.at ?? 0, head: (m.text ?? '').replace(/\s+/g, ' ').slice(0, HEAD_CHARS), lastError: m.lastError?.slice(0, HEAD_CHARS) })),
    })
  }
  return out
}

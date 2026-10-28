import { Notification } from 'electron'

import { agentStates, effectiveMode, newRuns, runKey, runningJob } from '@shared/runMode'
import type { Overview, SessionView } from '@shared/schedule'
import type { RunMode } from '@shared/types'

import { log } from './log'
import { isRemoteSession } from './remoteState'
import { attachSession, openSession, runClaude } from './revive'
import { currentOverview } from './schedule'
import { getSettings } from './settings'

// Shows a fired job as its run mode asks: notify = a desktop notice (click opens the session), open = a terminal
// window attached to it, quiet = nothing. Fed by every new overview (schedule.ts watchSchedule); while a notify/open
// job runs, `claude agents --json --all` is asked every 30 s whether that session waits for the person's answer.

const BLOCKED_TICK_MS = 30_000
const SEEN_KEPT_MS = 2 * 24 * 60 * 60 * 1000   // forget a run this long after it fired

type Seen = { firedAt: number; sessionId: string; mode: RunMode; askBlocked: boolean }   // askBlocked: still to check for 'blocked'
const seen = new Map<string, Seen>()   // runKey → what was done for that run
const shown = new Set<Notification>()   // a notice dropped by the garbage collector loses its click handler
let active = false
let checking = false

// 알림 제목: 예약 제목 > 세션 이름 > 폴더 이름   폴더 이름만 쓰면 홈 폴더(C:\Users\<이름>)에서 건 예약이 모두 같은 이름으로 보임
function sessionName(s: SessionView): string {
  const title = runningJob(s)?.title
  if (title !== undefined && title !== '') return title
  return s.name !== undefined && s.name !== '' ? s.name : s.label
}

// A desktop notice; clicking it opens the session as it is then (attach, or resume when it has stopped)
function show(title: string, body: string, sessionId: string): void {
  try {
    const n = new Notification({ title, body })
    shown.add(n)
    n.on('click', () => {
      shown.delete(n)
      const s = currentOverview().sessions.find(x => x.sessionId === sessionId)
      log(`RUNWATCH click ${sessionId.slice(0, 8)} ${s === undefined ? 'gone' : openSession(s)}`)
    })
    n.on('close', () => shown.delete(n))
    n.show()
  } catch (err) {
    log(`RUNWATCH notice failed ${String(err)}`)
  }
}

// Called with every new overview: acts once per session · firedAt
export function checkRuns(o: Overview): void {
  if (!active) return
  const settings = getSettings()
  const ko = settings.language === 'ko'
  const now = Date.now()
  for (const { session: s, key, isStale } of newRuns(o.sessions, new Set(seen.keys()), now)) {
    const running = s.running as NonNullable<SessionView['running']>
    if (isRemoteSession(s.sessionId) || isStale) {   // the remote jobs session reports by itself; an old run was missed while the app was off
      seen.set(key, { firedAt: running.firedAt, sessionId: s.sessionId, mode: 'quiet', askBlocked: false })
      continue
    }
    const { mode, source } = effectiveMode(runningJob(s)?.mode, s.sessionId, settings.runMode)
    seen.set(key, { firedAt: running.firedAt, sessionId: s.sessionId, mode, askBlocked: mode !== 'quiet' })
    log(`RUNWATCH ${s.shortId} fired ${mode} (${source})`)
    const head = running.promptHead.slice(0, 80)
    if (mode === 'notify') show(ko ? `예약 실행: ${sessionName(s)}` : `Job started: ${sessionName(s)}`, ko ? `${head}\n눌러서 세션 열기` : `${head}\nClick to open the session`, s.sessionId)
    if (mode === 'open' && s.runsIn !== 'terminal') attachSession(s)   // a session in a terminal window is already on screen
  }
  for (const [key, v] of seen) if (now - v.firedAt > SEEN_KEPT_MS) seen.delete(key)
}

// Every 30 s, only while a notify/open job runs: one `claude agents` call, a notice for a session that waits for an answer
async function checkBlocked(): Promise<void> {
  if (!active || checking) return
  const running = new Map(currentOverview().sessions.filter(s => s.running !== undefined).map(s => [runKey(s.sessionId, (s.running as NonNullable<SessionView['running']>).firedAt), s]))
  const waiting = [...seen.entries()].filter(([key, v]) => v.askBlocked && running.has(key))
  if (waiting.length === 0) return
  checking = true
  try {
    const ran = await runClaude(['agents', '--json', '--all'], undefined)
    if (ran.code !== 0) return
    const states = agentStates(ran.output)
    const ko = getSettings().language === 'ko'
    for (const [key, v] of waiting) {
      if (states.get(v.sessionId) !== 'blocked') continue
      v.askBlocked = false
      const s = running.get(key) as SessionView
      log(`RUNWATCH ${s.shortId} blocked`)
      const head = (s.running?.promptHead ?? '').slice(0, 80)
      show(ko ? `답을 기다립니다: ${sessionName(s)}` : `Waiting for your answer: ${sessionName(s)}`, ko ? `${head}\n눌러서 세션 열기` : `${head}\nClick to open the session`, v.sessionId)
    }
  } finally {
    checking = false
  }
}

export function startRunWatch(): () => void {
  active = true
  checkRuns(currentOverview())
  const id = setInterval(() => { void checkBlocked() }, BLOCKED_TICK_MS)
  return () => { active = false; clearInterval(id) }
}

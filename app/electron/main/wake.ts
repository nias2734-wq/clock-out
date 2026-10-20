import { dailySweepHm, isPastDailyTime, reopenReason } from '@shared/revive'
import type { Overview, SessionView } from '@shared/schedule'
import type { AppSessionState } from '@shared/types'

import { patchSession, sessionState } from './appState'
import { postInbox } from './inbox'
import { log } from './log'
import { isRemoteSession } from './remoteState'
import { notice, readFile, reviveOnce } from './revive'
import type { AttemptResult, ReviveResult } from './revive'
import { buildOverview, liveSessions, setWakingProvider } from './schedule'
import { getSettings } from './settings'

// Every wake of a stopped session goes through here: the panel's button, the remote jobs session's requests, deleting a
// job, running a missed job and the scheduler. One wake per session at a time (in memory); a failed attempt is tried
// again after 5 s, 15 s, 45 s and 120 s (±20 %), then by the scheduler 10 min later; a login / permission failure is
// not tried again until a manual wake succeeds. Attempts and results go to app-state.json (appState.ts).

export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000]
export const RETRY_LATER_MS = 10 * 60_000       // after the quick retries: the scheduler tries again from then
export const JOIN_RECENT_MS = 30_000            // a session woken this recently takes a new message in its inbox instead
export const REVIVE_GUARD_MS = 30 * 60_000      // the scheduler does not wake a session again within this after a success
const TICK_MS = 30_000

// Only the scheduler respects blocked / nextRetryAt (mayAutoWake); a wake asked for by the person always tries
export type WakeOpts = { message?: string; forceRemote?: boolean }

export type WakeDeps = {
  attempt: (s: SessionView, reason: string, opts: { message?: string; forceRemote?: boolean }) => Promise<AttemptResult>
  isLive: (sessionId: string) => boolean          // Claude Code's live record (<config>/sessions/<pid>.json) names it
  hasPlugin: (sessionId: string) => boolean       // it has a plugin session file, so its inbox is read
  postInbox: (sessionId: string, text: string) => void
  readState: (sessionId: string) => AppSessionState
  patchState: (sessionId: string, patch: Partial<AppSessionState>) => void
  notice: (text: string, kind: 'info' | 'warn') => void
  sleep: (ms: number) => Promise<void>
  now: () => number
  random: () => number                            // 0..1, for the ±20 % spread of the retry delays
}

// claude's output on a failure that a retry cannot fix (not logged in, refused): the line that says so, first 160 chars.
// "permission" right after a dash is a flag name in a usage text (--permission-mode), not a refusal.
const BLOCKING = /\b(login|log in|logged in|logged out|auth\w*|unauthori[sz]ed|forbidden|credentials?|api key)\b|(?<![-\w])permission(?!-)/i

export function blockingReason(output: string): string | undefined {
  const line = output.split(/\r?\n/).find(l => BLOCKING.test(l))
  return line === undefined ? undefined : line.trim().slice(0, 160)
}

export const jittered = (ms: number, random: number): number => Math.round(ms * (0.8 + 0.4 * random))

// The scheduler may wake it now: not blocked, past nextRetryAt, no success within the 30 min guard, no wake in progress
export function mayAutoWake(st: AppSessionState, now: number, inProgress: boolean): boolean {
  if (inProgress || st.blocked !== undefined) return false
  if (st.nextRetryAt !== undefined && now < st.nextRetryAt) return false
  return st.lastSuccessAt === undefined || now - st.lastSuccessAt >= REVIVE_GUARD_MS
}

export function createWaker(deps: WakeDeps) {
  const inFlight = new Map<string, Promise<ReviveResult>>()

  const succeeded = (sessionId: string) =>
    deps.patchState(sessionId, { lastSuccessAt: deps.now(), failures: undefined, nextRetryAt: undefined, blocked: undefined, lastError: undefined })

  // A request that found the session just woken (or being woken): its message goes to the inbox, the plugin submits it
  function joined(s: SessionView, r: ReviveResult, opts: WakeOpts): ReviveResult {
    if (opts.message === undefined || !r.ok) return { ok: r.ok, message: `${s.shortId}: joined a wake in progress — ${r.message}` }
    if (!deps.hasPlugin(s.sessionId)) return { ok: false, message: `${s.shortId}: woken just now, but without the plugin the message cannot reach it` }
    deps.postInbox(s.sessionId, opts.message)
    return { ok: true, message: `${s.shortId}: woken just now; the message went to its inbox` }
  }

  async function run(s: SessionView, reason: string, opts: WakeOpts): Promise<ReviveResult> {
    const id = s.sessionId
    // 1. already up (the overview can be 30 s old): nothing to start
    if (deps.isLive(id)) return joined(s, { ok: true, message: 'already running' }, opts)
    for (let i = 0; ; i++) {
      // 2. one attempt, its time recorded first
      deps.patchState(id, { lastAttemptAt: deps.now() })
      const r = await deps.attempt(s, reason, { message: opts.message, forceRemote: opts.forceRemote })
      if (r.ok) {
        if (!r.message.startsWith('[dry run]')) { succeeded(id); deps.notice(`${s.label} · ${s.shortId} woken in the background — ${reason}`, 'info') }
        return r
      }
      const failures = (deps.readState(id).failures ?? 0) + 1
      const lastError = (r.output ?? r.message).trim().slice(0, 160)
      // 3. not logged in / refused: no retry, the scheduler leaves it until a manual wake succeeds
      const blocked = blockingReason(r.output ?? '')
      if (blocked !== undefined) {
        deps.patchState(id, { failures, lastError, blocked, nextRetryAt: undefined })
        deps.notice(`${s.label} · ${s.shortId}: could not wake — ${blocked}. Not tried again on its own; check the login, then wake it from the panel.`, 'warn')
        return { ok: false, message: `${s.shortId}: blocked — ${blocked}` }
      }
      // 4. quick retries used up: the scheduler tries again in 10 min
      const delay = RETRY_DELAYS_MS[i]
      if (delay === undefined) {
        deps.patchState(id, { failures, lastError, nextRetryAt: deps.now() + RETRY_LATER_MS })
        deps.notice(`${s.label} · ${s.shortId}: could not wake after ${i + 1} tries (${lastError.slice(0, 80)}); trying again in 10 min`, 'warn')
        return r
      }
      deps.patchState(id, { failures, lastError })
      log(`WAKE ${s.shortId} try ${i + 1} failed, next in ${Math.round(delay / 1000)} s`)
      await deps.sleep(jittered(delay, deps.random()))
      // 5. the failed attempt may still have started it (a timeout): look before starting again
      if (deps.isLive(id)) {
        succeeded(id)
        deps.notice(`${s.label} · ${s.shortId} woken in the background — ${reason}`, 'info')
        return { ok: true, message: `${s.shortId}: woken (came up after try ${i + 1})` }
      }
    }
  }

  function wake(s: SessionView, reason: string, opts: WakeOpts = {}): Promise<ReviveResult> {
    const id = s.sessionId
    const running = inFlight.get(id)
    // a wake for Remote Control needs its own start: it waits for the one in progress, then takes its turn
    if (running !== undefined) return opts.forceRemote === true ? running.then(() => wake(s, reason, opts)) : running.then(r => joined(s, r, opts))
    const st = deps.readState(id)
    if (opts.forceRemote !== true && st.lastSuccessAt !== undefined && deps.now() - st.lastSuccessAt < JOIN_RECENT_MS && deps.hasPlugin(id)) {
      return Promise.resolve(joined(s, { ok: true, message: 'woken just now' }, opts))
    }
    const p = run(s, reason, opts).finally(() => inFlight.delete(id))
    inFlight.set(id, p)
    return p
  }

  return { wake, isWaking: (sessionId: string) => inFlight.has(sessionId) }
}

const waker = createWaker({
  attempt: reviveOnce,
  isLive: id => liveSessions().has(id),
  hasPlugin: id => readFile(id) !== undefined,
  postInbox: (id, text) => { postInbox(id, text, 'wake') },
  readState: sessionState,
  patchState: (id, patch) => { try { patchSession(id, patch) } catch (err) { log(`APPSTATE write failed ${String(err)}`) } },
  notice,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: Date.now,
  random: Math.random,
})
setWakingProvider(waker.isWaking)

// The one way to wake a stopped session (see the top of this file)
export function wakeSession(s: SessionView, reason: string, opts: WakeOpts = {}): Promise<ReviveResult> {
  if (s.warnings.length > 0) return Promise.resolve({ ok: false, message: `${s.shortId} is not trusted: ${s.warnings.join(', ')}` })
  return waker.wake(s, reason, opts)
}
export const isWaking = waker.isWaking

const askedAt = new Map<string, number>()   // confirmBefore: when the "open the panel to revive" notice was shown
let dailyDate = ''

// The scheduler: every 30 s look at the overview and wake what is due (lead), expiring, or in the daily sweep.
// afterTick: more work on the same overview (index.ts passes the automatic cleanup, cleanup.ts)
export function startScheduler(afterTick?: (overview: Overview) => Promise<void>): () => void {
  let ticking = false
  const tick = () => {
    if (ticking) return
    ticking = true
    void (async () => {
      try {
        const settings = getSettings()
        const now = Date.now()
        const today = new Date(now).toDateString()
        const overview = buildOverview()
        const sweep = settings.revive.dailyAtEnd && dailyDate !== today && isPastDailyTime(now, settings)
        if (sweep) dailyDate = today
        for (const s of overview.sessions) {
          if (isRemoteSession(s.sessionId)) continue   // remote.ts keeps that one running
          let reason = reopenReason(s, now, settings, true)
          if (reason === undefined && sweep && !s.isAlive && s.warnings.length === 0 && s.jobs.some(j => !j.isDismissed)) reason = { kind: 'daily', text: `daily sweep at ${dailySweepHm(settings)}` }
          if (reason === undefined) continue
          if (!mayAutoWake(sessionState(s.sessionId), now, isWaking(s.sessionId))) continue
          if (settings.revive.confirmBefore) {
            const asked = askedAt.get(s.sessionId)
            if (asked !== undefined && now - asked < REVIVE_GUARD_MS) continue
            askedAt.set(s.sessionId, now)
            notice(`${s.label} · ${s.shortId}: ${reason.text} — open the schedule panel to revive`, 'warn')
            continue
          }
          // not awaited: one session's retries (up to about 4 min) do not hold up the others; the lock keeps it to one
          void wakeSession(s, reason.text).catch(err => log(`WAKE error ${String(err)}`))
        }
        await afterTick?.(overview)
      } catch (err) {
        log(`SCHEDULER error ${String(err)}`)
      } finally {
        ticking = false
      }
    })()
  }
  const id = setInterval(tick, TICK_MS)
  setTimeout(tick, 5_000)
  return () => clearInterval(id)
}

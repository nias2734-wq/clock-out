import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Notification: class { show() { /* none */ } }, shell: {} }))
vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-wake-'))
  return { paths: { root, sessionsDir: join(root, 'sessions'), appState: join(root, 'app-state.json'), inboxDir: join(root, 'inbox'), liveSessionsDir: join(root, 'live'), configDir: root, appSettings: join(root, 'app-settings.json'), remoteState: join(root, 'remote.json'), overview: join(root, 'overview.json'), log: join(root, 'app.log') } }
})

import type { SessionView } from '@shared/schedule'
import type { AppSessionState } from '@shared/types'

import type { AttemptResult } from './revive'
import { blockingReason, createWaker, jittered, mayAutoWake, JOIN_RECENT_MS, REVIVE_GUARD_MS, RETRY_DELAYS_MS, RETRY_LATER_MS } from './wake'
import type { WakeDeps } from './wake'

const S: SessionView = { sessionId: 'aaaa0000-0000-4000-8000-000000000001', shortId: 'aaaa0000', label: 'proj', cwd: 'C:\\proj', isAlive: false, source: 'plugin', jobs: [], done: [], warnings: [] }
const T0 = 1_000_000

// Fake surroundings: attempts answer from a script, sleeps only move the clock, app-state lives in a map
function fake(answers: AttemptResult[], extra: Partial<WakeDeps> = {}) {
  let clock = T0
  const state = new Map<string, AppSessionState>()
  const calls = { attempts: 0, sleeps: [] as number[], inbox: [] as string[], notices: [] as string[] }
  const deps: WakeDeps = {
    attempt: async () => { calls.attempts++; await Promise.resolve(); return answers.shift() ?? { ok: true, message: 'woken' } },
    isLive: () => false,
    hasPlugin: () => true,
    postInbox: (_id, text) => { calls.inbox.push(text) },
    readState: id => state.get(id) ?? {},
    patchState: (id, patch) => {
      const next: AppSessionState = { ...(state.get(id) ?? {}), ...patch }
      for (const k of Object.keys(next) as (keyof AppSessionState)[]) if (next[k] === undefined) delete next[k]
      state.set(id, next)
    },
    notice: text => { calls.notices.push(text) },
    sleep: async ms => { calls.sleeps.push(ms); clock += ms },
    now: () => clock,
    random: () => 0.5,
    ...extra,
  }
  return { deps, calls, state, waker: createWaker(deps) }
}

const fail = (output: string): AttemptResult => ({ ok: false, message: 'claude failed (exit 1)', output, code: 1 })

describe('wake retries', () => {
  it('first attempt fails, the retry 5 s later succeeds: success recorded, failures cleared', async () => {
    const { waker, calls, state } = fake([fail('ECONNRESET while starting'), { ok: true, message: 'woken' }])
    const r = await waker.wake(S, 'test')
    expect(r.ok).toBe(true)
    expect(calls.attempts).toBe(2)
    expect(calls.sleeps).toEqual([5_000])
    const st = state.get(S.sessionId)!
    expect(st.lastSuccessAt).toBe(T0 + 5_000)
    expect(st.lastAttemptAt).toBe(T0 + 5_000)
    expect(st.failures).toBeUndefined()
    expect(st.lastError).toBeUndefined()
  })
  it('a login failure is not retried and blocks automatic wakes', async () => {
    const { waker, calls, state } = fake([fail('Not logged in · Please run /login')])
    const r = await waker.wake(S, 'test')
    expect(r.ok).toBe(false)
    expect(calls.attempts).toBe(1)
    expect(calls.sleeps).toEqual([])
    const st = state.get(S.sessionId)!
    expect(st.blocked).toContain('Please run /login')
    expect(mayAutoWake(st, T0 + REVIVE_GUARD_MS * 10, false)).toBe(false)
  })
  it('all quick retries fail: 5 attempts, then nextRetryAt 10 min later', async () => {
    const { waker, calls, state } = fake(Array.from({ length: 5 }, () => fail('spawn timeout')))
    const r = await waker.wake(S, 'test')
    expect(r.ok).toBe(false)
    expect(calls.attempts).toBe(5)
    expect(calls.sleeps).toEqual(RETRY_DELAYS_MS)
    const st = state.get(S.sessionId)!
    const end = T0 + RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)
    expect(st.failures).toBe(5)
    expect(st.nextRetryAt).toBe(end + RETRY_LATER_MS)
    expect(mayAutoWake(st, end + RETRY_LATER_MS - 1, false)).toBe(false)
    expect(mayAutoWake(st, end + RETRY_LATER_MS, false)).toBe(true)
  })
  it('a failed attempt that started it after all (live record): no second start', async () => {
    let live = false
    const { waker, calls } = fake([fail('timed out')], { isLive: () => live, sleep: async () => { live = true } })
    const r = await waker.wake(S, 'test')
    expect(r.ok).toBe(true)
    expect(calls.attempts).toBe(1)
  })
})

describe('one wake per session', () => {
  it('three requests at once (timer, panel, remote with a message): claude runs once, the message goes to the inbox', async () => {
    const { waker, calls } = fake([])
    const results = await Promise.all([
      waker.wake(S, 'timer'),
      waker.wake(S, 'panel'),
      waker.wake(S, 'remote', { message: 'run the build' }),
    ])
    expect(calls.attempts).toBe(1)
    expect(results.every(r => r.ok)).toBe(true)
    expect(calls.inbox).toEqual(['run the build'])
    expect(waker.isWaking(S.sessionId)).toBe(false)
  })
  it('woken under 30 s ago: a message goes to the inbox without starting claude; Remote Control still starts', async () => {
    const { waker, calls, deps } = fake([])
    deps.patchState(S.sessionId, { lastSuccessAt: T0 - JOIN_RECENT_MS + 1 })
    expect((await waker.wake(S, 'remote', { message: 'hello' })).ok).toBe(true)
    expect(calls.attempts).toBe(0)
    expect(calls.inbox).toEqual(['hello'])
    await waker.wake(S, 'open remote', { forceRemote: true })
    expect(calls.attempts).toBe(1)
  })
  it('without the plugin a joined message cannot be passed and says so', async () => {
    const { waker } = fake([], { hasPlugin: () => false })
    const [, joined] = await Promise.all([waker.wake(S, 'timer'), waker.wake(S, 'remote', { message: 'x' })])
    expect(joined.ok).toBe(false)
  })
  it('already running by its live record: nothing started', async () => {
    const { waker, calls } = fake([], { isLive: () => true })
    expect((await waker.wake(S, 'panel')).ok).toBe(true)
    expect(calls.attempts).toBe(0)
  })
})

describe('mayAutoWake and blockingReason', () => {
  it('the 30 min guard counts from a success only; a wake in progress is skipped', () => {
    expect(mayAutoWake({}, T0, false)).toBe(true)
    expect(mayAutoWake({ lastAttemptAt: T0 - 1 }, T0, false)).toBe(true)
    expect(mayAutoWake({ lastSuccessAt: T0 - REVIVE_GUARD_MS + 1 }, T0, false)).toBe(false)
    expect(mayAutoWake({}, T0, true)).toBe(false)
  })
  it('login / auth / permission lines block; a usage text with --permission-mode does not', () => {
    expect(blockingReason('Invalid API key · Please run /login')).toBeDefined()
    expect(blockingReason('OAuth token has expired. authentication_error')).toBeDefined()
    expect(blockingReason('Error: permission denied for this workspace')).toBeDefined()
    expect(blockingReason('error: unknown option\n  --permission-mode <mode>\n  --dangerously-skip-permissions')).toBeUndefined()
    expect(blockingReason('Command failed: claude --bg --resume x\nETIMEDOUT')).toBeUndefined()
  })
  it('retry delays spread ±20 %', () => {
    expect(jittered(5_000, 0)).toBe(4_000)
    expect(jittered(5_000, 1)).toBe(6_000)
  })
})

import { writeFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logged = vi.hoisted(() => [] as string[])
vi.mock('./log', () => ({ log: (line: string) => { logged.push(line) } }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-usage-'))
  return { paths: { usageCache: join(root, 'cache.json'), credentials: join(root, '.credentials.json') } }
})

import { paths } from './paths'
import { fetchUsage, rowsOf } from './usage'

describe('rowsOf', () => {
  it('reads five_hour, seven_day and every per-model weekly limit from limits[]', () => {
    const rows = rowsOf({
      five_hour: { utilization: 31, resets_at: '2026-10-19T08:59:59Z' },
      seven_day: { utilization: 65, resets_at: '2026-10-20T19:59:59Z' },
      seven_day_opus: null,
      limits: [
        { kind: 'session', percent: 31, severity: 'normal' },
        { kind: 'weekly_all', percent: 65, severity: 'normal' },
        { kind: 'weekly_scoped', percent: 100, severity: 'critical', resets_at: '2026-10-20T19:59:59Z', scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 40, severity: 'normal', scope: { model: null } },
      ],
    })
    expect(rows.map(r => r.key)).toEqual(['five_hour', 'seven_day', 'model:Fable'])
    expect(rows[2]).toEqual({ key: 'model:Fable', label: 'Fable', percent: 100, resetsAt: '2026-10-20T19:59:59Z', isCritical: true })
  })
  it('works without limits[] (older answers)', () => {
    expect(rowsOf({ five_hour: { utilization: 10 } }).map(r => r.key)).toEqual(['five_hour'])
  })
})

// F-09: a failed fetch only marks the numbers stale, and the token never reaches the log or the status text
describe('fetchUsage failures', () => {
  const TOKEN = 'sk-ant-oat01-SECRETSECRETSECRET'
  const goodCredentials = () => writeFileSync(paths.credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }))
  const noToken = (text: string) => { expect(text).not.toContain('SECRET'); expect(text).not.toContain(TOKEN) }

  beforeEach(() => { logged.length = 0; writeFileSync(paths.usageCache, '{}') })
  afterEach(() => { vi.unstubAllGlobals() })

  it('a broken credentials file (the token in the broken text) is logged as its kind only', async () => {
    writeFileSync(paths.credentials, `{"claudeAiOauth":{"accessToken":"${TOKEN}"`)
    vi.stubGlobal('fetch', vi.fn())
    const state = await fetchUsage(true)
    expect(state.status).toBe('credentials not JSON')
    expect(state.isStale).toBe(true)
    for (const line of logged) noToken(line)
    noToken(JSON.stringify(state))
  })

  it('a timeout ends the fetch, marks the numbers stale and keeps the cached rows', async () => {
    goodCredentials()
    writeFileSync(paths.usageCache, JSON.stringify({ fetchedAt: '2026-10-20T09:00:00', res: { five_hour: { utilization: 12 } } }))
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error(`aborted with header Bearer ${TOKEN}`), { name: 'AbortError' })))
    })))
    const state = await fetchUsage(true, 50)
    expect(state.status).toBe('timeout')
    expect(state.isStale).toBe(true)
    expect(state.rows.map(r => r.key)).toEqual(['five_hour'])
    for (const line of logged) noToken(line)
  })

  it('401 and a network error: stale with a short reason, never the error text', async () => {
    goodCredentials()
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) })))
    expect(await fetchUsage(true)).toMatchObject({ status: 'status 401', isStale: true })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed: Bearer ${TOKEN}`) }))
    expect(await fetchUsage(true)).toMatchObject({ status: 'network error', isStale: true })
    for (const line of logged) noToken(line)
  })

  it('429: waits, stale, the wait in the cache', async () => {
    goodCredentials()
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, ok: false, json: async () => ({}) })))
    const state = await fetchUsage(true)
    expect(state.isWaiting).toBe(true)
    expect(state.isStale).toBe(true)
  })
})

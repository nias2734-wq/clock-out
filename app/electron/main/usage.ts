import { readFileSync, writeFileSync } from 'node:fs'

import { formatLocalStamp } from '@shared/time'
import type { UsageState, UsageWindow } from '@shared/types'

import { log } from './log'
import { paths } from './paths'

// Usage of the 5-hour and 7-day windows: GET https://api.anthropic.com/api/oauth/usage with the OAuth token
// Claude Code keeps in <config>/.credentials.json (same endpoint /usage shows). The token is read, sent to
// Anthropic only, and never logged or stored by this app.
//
// The API answers 429 after about 5 calls in 10 minutes, so the answer is cached in a file the v1 widget shares:
//   { fetchedAt, res, nextAllowed, backoffSec }   fresh for 60 s; after a 429 wait 5 min, doubling up to 60 min.

const FRESH_MS = 60_000
const BACKOFF_MIN_S = 300
const BACKOFF_MAX_S = 3600
const LABELS = { five_hour: '5h', seven_day: '7d' } as const

// The answer also carries limits[]: { kind, percent, severity, resets_at, scope: { model: { display_name } } }.
// kind 'weekly_scoped' with a model scope is a per-model weekly limit (e.g. Fable) separate from seven_day.
type Limit = { kind?: string; percent?: number; severity?: string; resets_at?: string; scope?: { model?: { display_name?: string | null } | null } | null }
type Res = Record<string, unknown> & { limits?: Limit[] }
type Cache = { fetchedAt?: string; res?: Res; nextAllowed?: string; backoffSec?: number }

function readCache(): Cache {
  try { return JSON.parse(readFileSync(paths.usageCache, 'utf8')) as Cache } catch { return {} }
}
function writeCache(c: Cache): void {
  try { writeFileSync(paths.usageCache, JSON.stringify(c, null, 2), 'utf8') } catch { /* shared file may be locked */ }
}

export function rowsOf(res: Cache['res']): UsageWindow[] {
  const rows: UsageWindow[] = []
  for (const key of ['five_hour', 'seven_day'] as const) {
    const w = res?.[key] as { utilization?: number; resets_at?: string } | null | undefined
    if (w == null || typeof w.utilization !== 'number') continue
    rows.push({ key, label: LABELS[key], percent: Math.round(w.utilization * 10) / 10, resetsAt: w.resets_at })
  }
  for (const l of res?.limits ?? []) {
    const name = l.scope?.model?.display_name
    if (l.kind !== 'weekly_scoped' || typeof name !== 'string' || name === '' || typeof l.percent !== 'number') continue
    rows.push({ key: `model:${name}`, label: name, percent: Math.round(l.percent * 10) / 10, resetsAt: l.resets_at, isCritical: l.severity === 'critical' })
  }
  return rows
}

function token(): string {
  const cred = JSON.parse(readFileSync(paths.credentials, 'utf8')) as { claudeAiOauth?: { accessToken?: string } }
  const t = cred.claudeAiOauth?.accessToken
  if (t === undefined || t === '') throw new Error('not logged in')
  return t
}

let last: UsageState = { rows: [], status: '', isWaiting: false }
export function currentUsage(): UsageState { return last }

// force = the "refresh now" menu: ignores the 60 s freshness but still honours a 429 wait
export async function fetchUsage(force = false): Promise<UsageState> {
  const now = Date.now()
  const cache = readCache()
  if (cache.res !== undefined) {
    const rows = rowsOf(cache.res)
    if (rows.length > 0) last = { ...last, rows, fetchedAt: cache.fetchedAt ? Date.parse(cache.fetchedAt) : undefined }
  }
  if (cache.nextAllowed !== undefined && now < Date.parse(cache.nextAllowed)) {
    const until = new Date(cache.nextAllowed)
    last = { ...last, status: `waiting until ${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`, isWaiting: true }
    return last
  }
  if (!force && cache.fetchedAt !== undefined && now - Date.parse(cache.fetchedAt) < FRESH_MS) {
    last = { ...last, status: '', isWaiting: false }
    return last
  }
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token()}`, 'anthropic-beta': 'oauth-2025-04-20' },
    })
    if (res.status === 429) {
      const backoff = Math.min(BACKOFF_MAX_S, (cache.backoffSec ?? 0) > 0 ? (cache.backoffSec ?? 0) * 2 : BACKOFF_MIN_S)
      const nextAllowed = new Date(now + backoff * 1000)
      writeCache({ ...cache, nextAllowed: nextAllowed.toISOString(), backoffSec: backoff })
      log(`USAGE 429, waiting ${backoff}s`)
      last = { ...last, status: `waiting until ${String(nextAllowed.getHours()).padStart(2, '0')}:${String(nextAllowed.getMinutes()).padStart(2, '0')}`, isWaiting: true }
      return last
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const body = (await res.json()) as Cache['res']
    // local and zone-less like the v1 widget writes; both readers parse it as local time
    writeCache({ fetchedAt: formatLocalStamp(now, 'T'), res: body, backoffSec: 0 })
    const rows = rowsOf(body)
    last = { rows, fetchedAt: now, status: rows.length === 0 ? 'no usage data' : '', isWaiting: false }
    log(`USAGE ok ${rows.map(r => `${r.key}=${r.percent}%`).join(' ')}`)
    return last
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`USAGE fail ${message}`)
    last = { ...last, status: message, isWaiting: false }
    return last
  }
}

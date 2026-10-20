import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Notification: class { show() { /* none */ } }, shell: {} }))
vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-remote-'))
  return { paths: { root, requestsDir: join(root, 'requests'), appState: join(root, 'app-state.json'), inboxDir: join(root, 'inbox'), sessionsDir: join(root, 'sessions'), liveSessionsDir: join(root, 'live'), remoteState: join(root, 'remote.json'), appSettings: join(root, 'app-settings.json'), overview: join(root, 'overview.json'), configDir: root, remoteDir: join(root, 'remote'), log: join(root, 'app.log') } }
})

import { paths } from './paths'
import { pendingRequests } from './remote'

describe('pendingRequests', () => {
  it('oldest requestedAt first; a file being written is left for the next read, an old unreadable one removed', () => {
    mkdirSync(paths.requestsDir, { recursive: true })
    const now = Date.now()
    const put = (name: string, text: string) => writeFileSync(join(paths.requestsDir, name), text)
    put('s1.b.json', JSON.stringify({ id: 'b', kind: 'wake', sessionId: 's1', requestedAt: now - 1_000 }))
    put('s1.a.json', JSON.stringify({ id: 'a', kind: 'wake', sessionId: 's1', requestedAt: now - 5_000 }))
    put('s2.json', JSON.stringify({ kind: 'openRemote', sessionId: 's2', requestedAt: now - 3_000 }))   // before 0.13: no id
    put('s3.c.json.tmp', '{')
    put('s3.d.json', '{"id":"d","kind":')                                                            // half written, just now
    put('s3.e.json', '{"id":"e"')
    utimesSync(join(paths.requestsDir, 's3.e.json'), new Date(now - 60_000), new Date(now - 60_000))   // unreadable for a minute
    put('s4.f.json', JSON.stringify({ id: 'f', kind: 'wake', sessionId: 's4', requestedAt: now - 25 * 3_600_000 }))
    const got = pendingRequests(now)
    expect(got.map(r => r.id)).toEqual(['a', 's2.json', 'b'])
    expect(existsSync(join(paths.requestsDir, 's3.d.json'))).toBe(true)
    expect(existsSync(join(paths.requestsDir, 's3.e.json'))).toBe(false)
    expect(existsSync(join(paths.requestsDir, 's4.f.json'))).toBe(false)
    expect(existsSync(join(paths.requestsDir, 's3.c.json.tmp'))).toBe(true)
  })
})

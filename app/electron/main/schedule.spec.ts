import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-schedule-'))
  return { paths: { root, configDir: root, sessionsDir: join(root, 'sessions'), liveSessionsDir: join(root, 'live'), appState: join(root, 'app-state.json'), appSettings: join(root, 'app-settings.json'), inboxDir: join(root, 'inbox'), overview: join(root, 'overview.json') } }
})
// the real readText, counted: how often a session file is read
vi.mock('./fsSafe', async importOriginal => {
  const real = await importOriginal<typeof import('./fsSafe')>()
  return { ...real, readText: vi.fn(real.readText) }
})

import { readText } from './fsSafe'
import { paths } from './paths'
import { buildOverview, freshOverview } from './schedule'

const ID = '1a2b3c4d-0000-4000-8000-000000000001'
const file = join(paths.sessionsDir, `${ID}.json`)
const reads = () => (readText as Mock).mock.calls.filter(c => c[0] === file).length

function put(prompt: string): void {
  const now = Date.now()
  writeFileSync(file, JSON.stringify({
    version: 1, sessionId: ID, cwd: paths.root, alive: false, dismissed: [], runs: [],
    jobs: [{ id: 'job00001', cron: '0 9 * * *', prompt, recurring: true, createdAt: now, nextFireAt: now + 3_600_000 }],
  }))
}

describe('buildOverview and the session file cache', () => {
  beforeEach(() => { rmSync(paths.sessionsDir, { recursive: true, force: true }); mkdirSync(paths.sessionsDir, { recursive: true }) })

  it('reads an unchanged session file once and a changed one again', () => {
    put('first')
    expect(buildOverview().sessions[0]?.jobs[0]?.prompt).toBe('first')
    const before = reads()
    expect(buildOverview().sessions[0]?.jobs[0]?.prompt).toBe('first')
    expect(reads()).toBe(before)

    put('a longer second prompt')   // another size
    expect(buildOverview().sessions[0]?.jobs[0]?.prompt).toBe('a longer second prompt')
    expect(reads()).toBe(before + 1)
  })

  it('reads a file of the same size again when its time changed', () => {
    put('aaaa')
    buildOverview()
    put('bbbb')
    const later = new Date(Date.now() + 10_000)
    utimesSync(file, later, later)
    expect(buildOverview().sessions[0]?.jobs[0]?.prompt).toBe('bbbb')
  })

  it('reads a half-written file again and drops a deleted one', () => {
    writeFileSync(file, '{"version":1,"sessionId":')
    expect(buildOverview().sessions).toEqual([])
    put('whole')
    expect(buildOverview().sessions[0]?.jobs[0]?.prompt).toBe('whole')
    rmSync(file)
    expect(buildOverview().sessions).toEqual([])
  })

  it('freshOverview gives the last overview while it is new enough, else builds one', () => {
    put('first')
    const built = buildOverview()
    expect(freshOverview(60_000)).toBe(built)
    expect(freshOverview(0)).not.toBe(built)
  })
})

import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Notification: class { show() { /* none */ } } }))
vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-cleanup-'))
  return { paths: { root, configDir: root, sessionsDir: join(root, 'sessions'), liveSessionsDir: join(root, 'live'), appState: join(root, 'app-state.json'), appSettings: join(root, 'app-settings.json'), inboxDir: join(root, 'inbox'), overview: join(root, 'overview.json'), remoteState: join(root, 'remote.json') } }
})

import { pruneSessionFiles } from './cleanup'
import { paths } from './paths'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const JOB = { id: 'job00001', cron: '0 9 * * *', prompt: 'p', recurring: true, createdAt: NOW - 20 * DAY }

// a session file last written `daysOld` days ago
function put(id: string, daysOld: number, extra: Record<string, unknown> = {}, name = `${id}.json`): string {
  const path = join(paths.sessionsDir, name)
  writeFileSync(path, JSON.stringify({ version: 1, sessionId: id, cwd: paths.root, alive: false, dismissed: [], jobs: [], runs: [], ...extra }))
  const at = new Date(NOW - daysOld * DAY)
  utimesSync(path, at, at)
  return path
}

describe('pruneSessionFiles', () => {
  it('deletes only files of sessions that ended more than 8 days ago with nothing left', () => {
    mkdirSync(paths.sessionsDir, { recursive: true })
    mkdirSync(paths.liveSessionsDir, { recursive: true })
    const ended = put('ended', 10)
    const deletedJob = put('deleted-job', 10, { jobs: [{ ...JOB, deletedAt: NOW - 12 * DAY }] })
    const kept = [
      put('job-left', 10, { jobs: [JOB] }),                                    // still revivable
      put('recent', 2),
      put('running-job', 10, { running: { promptHead: 'x', firedAt: NOW - 10 * DAY } }),
      put('live', 10),
      put('remote', 10),
      put('other-name', 10, {}, 'copy-of-other.json'),                         // the name is not its session id
      join(paths.sessionsDir, 'broken.json'),
      join(paths.sessionsDir, '_stamp'),
    ]
    writeFileSync(join(paths.sessionsDir, 'broken.json'), '{"version":1,')
    utimesSync(join(paths.sessionsDir, 'broken.json'), new Date(NOW - 10 * DAY), new Date(NOW - 10 * DAY))
    writeFileSync(join(paths.sessionsDir, '_stamp'), 'x')
    utimesSync(join(paths.sessionsDir, '_stamp'), new Date(NOW - 10 * DAY), new Date(NOW - 10 * DAY))
    writeFileSync(join(paths.liveSessionsDir, '1.json'), JSON.stringify({ pid: process.pid, sessionId: 'live' }))   // this test's own process is alive
    writeFileSync(paths.remoteState, JSON.stringify({ sessionId: 'remote' }))

    expect(pruneSessionFiles(NOW)).toBe(2)
    expect(existsSync(ended)).toBe(false)
    expect(existsSync(deletedJob)).toBe(false)
    expect(kept.filter(p => !existsSync(p))).toEqual([])
    expect(pruneSessionFiles(NOW)).toBe(0)
  })
})

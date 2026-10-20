import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// claude answers from a script; each call is recorded with its arguments
const claude = vi.hoisted(() => ({ calls: [] as string[][], answers: [] as { code: number; out: string }[] }))
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    claude.calls.push(args)
    if (args[0] === 'agents') { cb(null, '[]', ''); return }
    const a = claude.answers.shift() ?? { code: 0, out: 'backgrounded · aaaa0000' }
    cb(a.code === 0 ? null : Object.assign(new Error('failed'), { code: a.code }), a.out, '')
  },
  spawn: () => ({ on: () => undefined, unref: () => undefined }),
}))
vi.mock('electron', () => ({ Notification: class { show() { /* none */ } } }))
vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-revive-'))
  return { paths: { root, sessionsDir: join(root, 'sessions'), appState: join(root, 'app-state.json'), appSettings: join(root, 'app-settings.json'), log: join(root, 'app.log') } }
})

import type { SessionView } from '@shared/schedule'
import { DEFAULT_SETTINGS } from '@shared/types'

import { readAppState } from './appState'
import { paths } from './paths'
import { reviveOnce } from './revive'

const ID = 'aaaa0000-0000-4000-8000-000000000001'
const S: SessionView = { sessionId: ID, shortId: 'aaaa0000', label: 'proj', cwd: '', isAlive: false, source: 'plugin', jobs: [], done: [], warnings: [] }

describe('reviveOnce (F-04: the app writes only its own file)', () => {
  beforeEach(() => {
    claude.calls.length = 0
    claude.answers.length = 0
    mkdirSync(paths.sessionsDir, { recursive: true })
  })

  it('a first background start: the plugin session file stays byte for byte, bgSince and the permission go to app-state', async () => {
    const path = join(paths.sessionsDir, `${ID}.json`)
    const text = JSON.stringify({ version: 1, sessionId: ID, cwd: '', alive: false, dismissed: ['x'], jobs: [], runs: [{ firedAt: 1 }] }, null, 2)
    writeFileSync(path, text)
    const before = statSync(path).mtimeMs
    const r = await reviveOnce(S, 'test')
    expect(r.ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(text)
    expect(statSync(path).mtimeMs).toBe(before)
    const st = readAppState().sessions[ID]
    expect(st?.bgSince).toBeTypeOf('number')
    expect(st?.permissionAtStart).toMatchObject({ mode: 'work', allowedTools: DEFAULT_SETTINGS.permission.allowedTools, disallowedTools: DEFAULT_SETTINGS.permission.disallowedTools })
    // the start passed the flags: lists first, then the mode flag, then the message
    const start = claude.calls.find(a => a[0] === '--bg') ?? []
    expect(start.indexOf('--permission-mode')).toBeGreaterThan(start.indexOf('--disallowedTools'))
  })

  it('a failed start records nothing in app-state and returns claude\'s output for the retry decision', async () => {
    const other = 'bbbb0000-0000-4000-8000-000000000002'
    claude.answers.push({ code: 1, out: 'Not logged in · Please run /login' })
    const r = await reviveOnce({ ...S, sessionId: other, shortId: 'bbbb0000' }, 'test')
    expect(r.ok).toBe(false)
    expect(r.output).toContain('/login')
    expect(readAppState().sessions[other]).toBeUndefined()
  })
})

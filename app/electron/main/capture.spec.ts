import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// claude must not run in capture mode: any call to execFile fails the test
const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile, spawn: vi.fn() }))
vi.mock('electron', () => ({ Notification: class { show() { /* none */ } }, app: { isPackaged: false, getAppPath: () => '.' } }))
vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const configDir = mkdtempSync(join(tmpdir(), 'clockout-capture-'))
  return { paths: { configDir, root: join(configDir, 'clock-out'), sessionsDir: join(configDir, 'clock-out', 'sessions'), credentials: join(configDir, '.credentials.json') } }
})

import { paths } from './paths'
import { runClaude } from './revive'
import { checkSetup, runFix } from './setup'

describe('capture mode runs nothing on the PC', () => {
  afterEach(() => { delete process.env.CLOCKOUT_SHOT_DIR; execFile.mockClear() })

  it('claude agents answers from capture/agents.json, other claude commands fail without running', async () => {
    process.env.CLOCKOUT_SHOT_DIR = 'shots'
    mkdirSync(join(paths.configDir, 'clock-out', 'capture'), { recursive: true })
    writeFileSync(join(paths.configDir, 'clock-out', 'capture', 'agents.json'), JSON.stringify([{ sessionId: 's1', state: 'idle', kind: 'background' }]))
    expect(await runClaude(['agents', '--json', '--all'], undefined)).toEqual({ code: 0, output: '[{"sessionId":"s1","state":"idle","kind":"background"}]' })
    expect((await runClaude(['--bg', '--resume', 's1', 'hi'], 'C:\work')).code).toBe(1)
    expect((await runClaude(['stop', 's1'], undefined)).code).toBe(1)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('the setup check and its fixes run no program', async () => {
    process.env.CLOCKOUT_SHOT_DIR = 'shots'
    const checks = await checkSetup()
    expect(checks.map(c => c.key)).toEqual(['cli', 'login', 'plugin', 'records', 'sleep', 'terminal', 'conflict'])
    expect((await runFix('installPlugin')).ok).toBe(false)
    expect((await runFix('disableSleep')).ok).toBe(false)
    expect(execFile).not.toHaveBeenCalled()
  })
})

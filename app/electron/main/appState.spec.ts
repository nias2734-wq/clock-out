import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-appstate-'))
  return { paths: { root, appState: join(root, 'clock-out', 'app-state.json') } }
})

import { isRequestDone, markRequestDone, patchSession, readAppState, sessionState } from './appState'
import { paths } from './paths'

describe('app-state.json', () => {
  beforeEach(() => { mkdirSync(dirname(paths.appState), { recursive: true }); rmSync(paths.appState, { force: true }) })

  it('a missing or broken file reads as empty', () => {
    expect(readAppState()).toEqual({ version: 1, sessions: {} })
    writeFileSync(paths.appState, '{"version":1,"sessions":{"a":')
    expect(readAppState().sessions).toEqual({})
    writeFileSync(paths.appState, '{"version":2,"sessions":{"a":{}}}')
    expect(readAppState().sessions).toEqual({})
  })

  it('patches merge into one session, keep the other fields and sessions, and drop fields set to undefined', () => {
    patchSession('a', { bgSince: 1, lastAttemptAt: 2 })
    patchSession('b', { hidden: { j1: true } })
    patchSession('a', { lastSuccessAt: 3, failures: 2 })
    patchSession('a', { failures: undefined })
    expect(sessionState('a')).toEqual({ bgSince: 1, lastAttemptAt: 2, lastSuccessAt: 3 })
    expect(sessionState('b')).toEqual({ hidden: { j1: true } })
  })

  it('writes through a temporary file that does not stay behind, and the result is whole JSON', () => {
    patchSession('a', { bgSince: 5 })
    expect(readdirSync(dirname(paths.appState)).filter(n => n.endsWith('.tmp'))).toEqual([])
    expect(JSON.parse(readFileSync(paths.appState, 'utf8')).sessions.a.bgSince).toBe(5)
  })

  it('a request id is carried out once', () => {
    expect(markRequestDone('r1')).toBe(true)
    expect(isRequestDone('r1')).toBe(true)
    expect(markRequestDone('r1')).toBe(false)
    expect(isRequestDone('r2')).toBe(false)
  })
})

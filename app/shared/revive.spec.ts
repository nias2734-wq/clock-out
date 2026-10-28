import { describe, expect, it } from 'vitest'

import { copyIdIn, dailySweepHm, permissionArgs, permissionDiffers, permissionRecord, reopenReason, resumedCopyIn, reviveArgs, REVIVE_MESSAGE } from './revive'
import type { SessionView } from './schedule'
import { DEFAULT_SETTINGS } from './types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// Monday 2026-10-19 10:00 local
const NOW = new Date(2026, 9, 19, 10, 0).getTime()

function session(extra: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'bbbb0000-0000-4000-8000-000000000002', shortId: 'bbbb0000', label: 'proj', cwd: 'C:\\proj', isAlive: false, source: 'plugin',
    nextAt: NOW + 2 * HOUR, warnings: [], done: [],
    jobs: [{ id: 'j1', cron: '0 12 * * *', humanSchedule: 'noon', prompt: 'p', recurring: true, nextAt: NOW + 2 * HOUR, expiresAt: NOW + 5 * DAY, expiresInDays: 5, isExpiringSoon: false, isDismissed: false }],
    ...extra,
  }
}

describe('reviveArgs', () => {
  it('work mode on the first start: allowed tools, then acceptEdits, then only the fixed message (no block list flag)', () => {
    const args = reviveArgs('s1', false, DEFAULT_SETTINGS.permission)
    expect(args).toEqual([
      '--bg', '--resume', 's1',
      '--allowedTools', DEFAULT_SETTINGS.permission.allowedTools.join(','),
      '--permission-mode', 'acceptEdits',
      REVIVE_MESSAGE,
    ])
  })
  it('the message never follows a tool list flag (they take every value up to the next flag: measured 2026-10-20)', () => {
    const lists = new Set(['--allowedTools', '--disallowedTools'])
    const cases = [
      reviveArgs('s1', false, DEFAULT_SETTINGS.permission, undefined, 'do it'),
      reviveArgs('s1', false, DEFAULT_SETTINGS.permission, 'clock-out · proj', 'do it'),
      reviveArgs('s1', false, { ...DEFAULT_SETTINGS.permission, mode: 'bypass' }, undefined, 'do it'),
      reviveArgs('s1', false, { mode: 'work', allowedTools: ['Read'], disallowedTools: [] }, undefined, 'do it'),
    ]
    for (const args of cases) {
      expect(args[args.length - 1]).toBe('do it')
      expect(lists.has(args[args.length - 3] ?? '')).toBe(false)   // the value before the message belongs to a one-value flag
    }
  })
  it('the block list never goes into the flags: it would stay with the session and limit work done by hand', () => {
    expect(permissionArgs({ mode: 'bypass', allowedTools: ['Read'], disallowedTools: ['Bash(git push*)'] })).toEqual(['--dangerously-skip-permissions'])
    expect(permissionArgs({ mode: 'work', allowedTools: ['Read'], disallowedTools: ['Bash(git push*)'] })).toEqual(['--allowedTools', 'Read', '--permission-mode', 'acceptEdits'])
  })
  it('bypass mode on the first start passes the dangerous flag; a later wake passes no flags at all', () => {
    expect(reviveArgs('s1', false, { mode: 'bypass', allowedTools: [], disallowedTools: [] })).toEqual(['--bg', '--resume', 's1', '--dangerously-skip-permissions', REVIVE_MESSAGE])
    expect(reviveArgs('s1', true, { mode: 'bypass', allowedTools: [], disallowedTools: [] })).toEqual(['--bg', '--resume', 's1', REVIVE_MESSAGE])
  })
  it('the message never contains a job prompt', () => {
    expect(REVIVE_MESSAGE).not.toContain('${')
  })
})

describe('reopenReason', () => {
  it('due within the lead', () => {
    expect(reopenReason(session({ nextAt: NOW + 5 * 60_000 }), NOW, DEFAULT_SETTINGS, false)?.kind).toBe('due')
    expect(reopenReason(session(), NOW, DEFAULT_SETTINGS, false)).toBeUndefined()
  })
  it('expiry within the lead', () => {
    const s = session({ jobs: [{ ...session().jobs[0]!, expiresAt: NOW + 20 * HOUR, expiresInDays: 1 }] })
    expect(reopenReason(s, NOW, DEFAULT_SETTINGS, false)?.kind).toBe('expiry')
  })
  it('daily sweep after work end minus 5 minutes on a work day, once', () => {
    const at = new Date(2026, 9, 19, 17, 56).getTime()
    expect(dailySweepHm(DEFAULT_SETTINGS)).toBe('17:55')
    expect(reopenReason(session({ nextAt: at + 10 * HOUR }), at, DEFAULT_SETTINGS, false)?.kind).toBe('daily')
    expect(reopenReason(session({ nextAt: at + 10 * HOUR }), at, DEFAULT_SETTINGS, true)).toBeUndefined()
    const sat = new Date(2026, 9, 17, 17, 56).getTime()
    expect(reopenReason(session({ nextAt: sat + 10 * HOUR }), sat, DEFAULT_SETTINGS, false)).toBeUndefined()
  })
  it('never for running, warned, dismissed-only sessions', () => {
    expect(reopenReason(session({ isAlive: true, nextAt: NOW + 60_000 }), NOW, DEFAULT_SETTINGS, false)).toBeUndefined()
    expect(reopenReason(session({ warnings: ['x'], nextAt: NOW + 60_000 }), NOW, DEFAULT_SETTINGS, false)).toBeUndefined()
    const s = session({ nextAt: NOW + 60_000, jobs: [{ ...session().jobs[0]!, isDismissed: true }] })
    expect(reopenReason(s, NOW, DEFAULT_SETTINGS, false)).toBeUndefined()
  })
})

describe('copyIdIn', () => {
  it('finds the copy id in claude output', () => {
    expect(copyIdIn('note: the flags you passed started a copy as 3bf76c58. Without flags…')).toBe('3bf76c58')
    expect(copyIdIn('backgrounded · abcd1234')).toBeUndefined()
  })
})

describe('resumedCopyIn', () => {
  const ID = '2b3c4d5e-0000-4000-8000-000000000002'
  it('names the copy a resume came up as (app.log 2026-10-20)', () => {
    expect(resumedCopyIn('backgrounded · 6f7a8b9c\n  claude agents             list sessions\n  claude attach 6f7a8b9c    open in this terminal', ID)).toBe('6f7a8b9c')
    expect(resumedCopyIn('backgrounded · 6f7a8b9c\nnote: the flags you passed started a copy as 6f7a8b9c.', ID)).toBe('6f7a8b9c')
  })
  it('is undefined when the session itself came up, or the output names nothing', () => {
    expect(resumedCopyIn('backgrounded · 2b3c4d5e\n  claude attach 2b3c4d5e', ID)).toBeUndefined()
    expect(resumedCopyIn('', ID)).toBeUndefined()
  })
})

describe('permissionDiffers', () => {
  const start = permissionRecord(DEFAULT_SETTINGS.permission, 1)
  it('same settings in another order: no mismatch', () => {
    expect(permissionDiffers(start, { ...DEFAULT_SETTINGS.permission, allowedTools: [...DEFAULT_SETTINGS.permission.allowedTools].reverse() })).toBe(false)
  })
  it('a changed mode or allowed list: mismatch; a changed block list is not (the plugin reads it at every run)', () => {
    expect(permissionDiffers(start, { ...DEFAULT_SETTINGS.permission, mode: 'bypass' })).toBe(true)
    expect(permissionDiffers(start, { ...DEFAULT_SETTINGS.permission, allowedTools: ['Read'] })).toBe(true)
    expect(permissionDiffers(start, { ...DEFAULT_SETTINGS.permission, disallowedTools: [] })).toBe(false)
  })
  it('bypass ignores the allowed list', () => {
    const bypass = permissionRecord({ ...DEFAULT_SETTINGS.permission, mode: 'bypass' }, 1)
    expect(permissionDiffers(bypass, { ...DEFAULT_SETTINGS.permission, mode: 'bypass', allowedTools: ['Read'] })).toBe(false)
  })
})

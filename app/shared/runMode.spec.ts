import { describe, expect, it } from 'vitest'

import { agentStates, effectiveMode, newRuns, runKey, runningJob, RUN_NOTICE_MAX_AGE_MS, wasBackgroundIn } from './runMode'
import type { SessionView } from './schedule'

const NOW = new Date(2026, 9, 20, 9, 7).getTime()
const ID = 'aaaa0000-0000-4000-8000-000000000001'

function view(extra: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: ID, shortId: 'aaaa0000', label: 'tools', cwd: 'C:\\tools', isAlive: true, source: 'plugin', warnings: [], done: [],
    jobs: [
      { id: 'job00001', cron: '7 9 20 10 *', humanSchedule: '7 9 20 10 *', prompt: '리마인더:\n  회의 자료   보내기', recurring: false, isExpiringSoon: false, isDismissed: false, mode: 'open' },
      { id: 'job00002', cron: '0 23 * * *', humanSchedule: '0 23 * * *', prompt: 'nightly build', recurring: true, isExpiringSoon: false, isDismissed: false },
    ],
    ...extra,
  }
}

describe('effectiveMode', () => {
  const runMode = { default: 'notify' as const, sessions: { [ID]: 'quiet' as const } }
  it('job mode first, then the session choice, then the default', () => {
    expect(effectiveMode('open', ID, runMode)).toEqual({ mode: 'open', source: 'job' })
    expect(effectiveMode(undefined, ID, runMode)).toEqual({ mode: 'quiet', source: 'session' })
    expect(effectiveMode(undefined, 'other', runMode)).toEqual({ mode: 'notify', source: 'default' })
  })
})

describe('runningJob', () => {
  it('uses the plugin jobId when given', () => {
    expect(runningJob(view({ running: { promptHead: 'x', firedAt: NOW, jobId: 'job00002' } }))?.id).toBe('job00002')
  })
  it('falls back to the folded first 120 chars of the prompt', () => {
    expect(runningJob(view({ running: { promptHead: '리마인더: 회의 자료 보내기', firedAt: NOW } }))?.id).toBe('job00001')
    expect(runningJob(view({ running: { promptHead: 'something else', firedAt: NOW } }))).toBeUndefined()
    expect(runningJob(view())).toBeUndefined()
  })
})

describe('newRuns', () => {
  it('reports each session · firedAt once and marks old ones stale', () => {
    const fresh = view({ running: { promptHead: 'nightly build', firedAt: NOW - 60_000 } })
    const old = view({ sessionId: 'bbbb', running: { promptHead: 'x', firedAt: NOW - RUN_NOTICE_MAX_AGE_MS - 1 } })
    const idle = view({ sessionId: 'cccc' })
    const found = newRuns([fresh, old, idle], new Set(), NOW)
    expect(found.map(f => [f.session.sessionId, f.isStale])).toEqual([[ID, false], ['bbbb', true]])
    expect(newRuns([fresh], new Set([runKey(ID, NOW - 60_000)]), NOW)).toEqual([])
  })
})

describe('agentStates', () => {
  it('reads the multi-line JSON array the CLI prints', () => {
    const out = '[\n  {\n    "id": "aaaa0000",\n    "sessionId": "' + ID + '",\n    "state": "blocked"\n  },\n  { "sessionId": "b", "state": "done" },\n  { "id": "c" }\n]\n'
    const states = agentStates(out)
    expect(states.get(ID)).toBe('blocked')
    expect(states.get('b')).toBe('done')
    expect(states.size).toBe(2)
    expect(agentStates('error: not logged in').size).toBe(0)
  })
})

describe('wasBackgroundIn', () => {
  // the first line of this output is "[" alone: 0.8.0 parsed only that line and always said no
  const out = '[\n  {\n    "id": "aaaa0000",\n    "cwd": "C:\\tools",\n    "kind": "background",\n    "sessionId": "' + ID + '",\n    "state": "stopped"\n  },\n  { "pid": 1, "kind": "interactive", "sessionId": "b" }\n]\n'
  it('reads the whole multi-line array', () => {
    expect(wasBackgroundIn(out, ID)).toBe(true)
    expect(wasBackgroundIn(out, 'b')).toBe(false)
    expect(wasBackgroundIn(out, 'missing')).toBe(false)
    expect(wasBackgroundIn('error: not logged in', ID)).toBe(false)
    expect(wasBackgroundIn('{"not":"an array"}', ID)).toBe(false)
  })
})

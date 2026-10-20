import { describe, expect, it, vi } from 'vitest'

vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', () => ({ paths: { usageCache: '', credentials: '' } }))

import { rowsOf } from './usage'

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

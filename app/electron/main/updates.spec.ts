import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Notification: class {}, app: { getVersion: () => '0.13.1' }, shell: {} }))
vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./settings', () => ({ getSettings: () => ({ updateCheck: true, language: 'ko' }) }))

import { isNewer } from './updates'

describe('isNewer', () => {
  it('compares the release tag with this version number by number', () => {
    expect(isNewer('v0.14.0', '0.13.1')).toBe(true)
    expect(isNewer('v0.13.10', '0.13.9')).toBe(true)
    expect(isNewer('v0.13.1', '0.13.1')).toBe(false)
    expect(isNewer('v0.12.0', '0.13.1')).toBe(false)
    expect(isNewer('nightly', '0.13.1')).toBe(false)
  })
})

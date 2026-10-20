import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('./log', () => ({ log: () => undefined }))
vi.mock('./paths', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'clockout-inbox-'))
  return { paths: { root, inboxDir: join(root, 'inbox') } }
})

import { clearInboxes, inboxProblems, postInbox } from './inbox'
import { paths } from './paths'

const HOUR = 3_600_000

describe('inbox', () => {
  it('postInbox writes one whole message with its own uuid and leaves no temporary file', () => {
    const a = postInbox('s1', 'first')
    const b = postInbox('s1', 'second')
    expect(a).not.toBe(b)
    const names = readdirSync(join(paths.inboxDir, 's1'))
    expect(names.filter(n => n.endsWith('.tmp'))).toEqual([])
    const ids = names.map(n => (JSON.parse(readFileSync(join(paths.inboxDir, 's1', n), 'utf8')) as { id: string }).id).sort()
    expect(ids).toEqual([a, b].sort())
  })

  it('clearInboxes removes delivered ones, keeps failed / unknown ones for a week, and inboxProblems counts them', () => {
    const dir = join(paths.inboxDir, 's2')
    mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const put = (name: string, m: object) => writeFileSync(join(dir, name), JSON.stringify(m))
    put('1.json', { id: 'a', text: 'done', at: now - HOUR, deliveredAt: now })
    put('2.json', { id: 'b', text: 'gave up on this', at: now - 30 * HOUR, state: 'failed', lastError: 'dropped: busy' })
    put('3.json', { id: 'c', text: 'maybe went in', at: now - 2 * HOUR, state: 'unknown' })
    put('4.json', { id: 'd', text: 'old failure', at: now - 8 * 24 * HOUR, state: 'failed' })
    put('5.json', { id: 'e', text: 'never read', at: now - 25 * HOUR })
    put('6.json', { id: 'f', text: 'waiting', at: now - HOUR })
    clearInboxes(now)
    expect(readdirSync(dir).sort()).toEqual(['2.json', '3.json', '6.json'])
    const box = inboxProblems().get('s2')
    expect(box).toMatchObject({ failed: 1, unknown: 1 })
    expect(box?.items.map(i => i.head)).toEqual(['maybe went in', 'gave up on this'])
    expect(box?.items[1]?.lastError).toBe('dropped: busy')
    expect(existsSync(join(paths.inboxDir, 's1'))).toBe(true)
  })
})

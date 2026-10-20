import { describe, expect, it } from 'vitest'

import { reopenCommands } from './reopen'

const ID = '1a2b3c4d-0000-4000-8000-000000000001'
const base = { sessionId: ID, shortId: '1a2b3c4d', cwd: 'P:\projects\docs', isAlive: false }

describe('reopenCommands', () => {
  it('attaches to a running background session', () => {
    expect(reopenCommands({ ...base, isAlive: true, runsIn: 'background' })).toEqual({ kind: 'attach', commands: [{ text: 'claude attach 1a2b3c4d' }] })
  })
  it('resumes a stopped session in its folder, for PowerShell and cmd', () => {
    expect(reopenCommands(base)).toEqual({ kind: 'resume', commands: [
      { shell: 'powershell', text: `cd "P:\projects\docs"; claude --resume ${ID}` },
      { shell: 'cmd', text: `cd /d "P:\projects\docs" && claude --resume ${ID}` },
    ] })
  })
  it('still gives resume for a session open in a terminal, and drops cd without a folder', () => {
    expect(reopenCommands({ ...base, isAlive: true, runsIn: 'terminal' }).kind).toBe('terminal')
    expect(reopenCommands({ ...base, cwd: '' })).toEqual({ kind: 'resume', commands: [{ text: `claude --resume ${ID}` }] })
  })
})

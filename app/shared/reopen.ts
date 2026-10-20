// The commands that open a session again by hand, for the panel's popover on a session id (copy only; the panel runs nothing).
// Pure functions only.
import type { SessionView } from './schedule'

// attach = a background session runs now | resume = stopped, or read from a transcript | terminal = already open in a terminal window
export type ReopenKind = 'attach' | 'resume' | 'terminal'
export type ReopenCommand = { shell?: 'powershell' | 'cmd'; text: string }
export type Reopen = { kind: ReopenKind; commands: ReopenCommand[] }

type Reopenable = Pick<SessionView, 'sessionId' | 'shortId' | 'cwd' | 'isAlive' | 'runsIn'>

// --resume finds the conversation by the working folder, so it starts there: PowerShell's cd changes the drive,
// cmd's needs /d (cd "P:\x" from C: keeps C: as the current drive)
export function reopenCommands(s: Reopenable): Reopen {
  if (s.isAlive && s.runsIn === 'background') return { kind: 'attach', commands: [{ text: `claude attach ${s.shortId}` }] }
  const resume = `claude --resume ${s.sessionId}`
  const commands: ReopenCommand[] = s.cwd === ''
    ? [{ text: resume }]
    : [{ shell: 'powershell', text: `cd "${s.cwd}"; ${resume}` }, { shell: 'cmd', text: `cd /d "${s.cwd}" && ${resume}` }]
  return { kind: s.isAlive ? 'terminal' : 'resume', commands }
}

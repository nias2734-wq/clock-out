// Shared helpers for the tests: an in-memory file system answered through the fs.* events, and a command runner.
import type { CommandRunResult, FsEntry, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The engine resolves a path before the fs.* hooks see it (on Windows "/home/alice/x" arrives as "C:\home\alice\x"),
// so keys are normalized: forward slashes, no drive letter.
export function norm(path: string): string {
  return path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
}

export function memoryFs(on: On, files: Map<string, string> = new Map()): Map<string, string> {
  const list = (dir: string): FsEntry[] =>
    [...files.keys()]
      .filter(k => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/'))
      .map(k => ({ name: k.slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }))
  on('fs.exists', (_$, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.read', (_$, e) => {
    const text = files.get(norm(e.path))
    return text === undefined ? { deny: `missing ${e.path}` } : { value: text }
  })
  on('fs.write', (_$, e) => { files.set(norm(e.path), e.text); return { value: undefined } })
  on('fs.list', (_$, e) => ({ value: list(norm(e.path)) }))
  return files
}

// A run as the composer raises it, on a 120-column terminal.
export async function runCommand($: Engine, command: string, args = ''): Promise<CommandRunResult> {
  return $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
}

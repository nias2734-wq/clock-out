import type { EngineInterface } from 'claude-code'

import { clockOutPaths, sessionFilePath } from './paths'
import { emptySessionFile, SESSION_FILE_VERSION } from './schema'
import type { SessionFile } from './schema'

// Reads a session file; undefined when missing or unreadable (a half-written file is treated as missing, never thrown on).
export async function readSessionFile($: EngineInterface, path: string): Promise<SessionFile | undefined> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    const text = await $.fs.read(path)
    if (typeof text !== 'string') return undefined
    const parsed = JSON.parse(text) as Partial<SessionFile>
    if (parsed.version !== SESSION_FILE_VERSION || typeof parsed.sessionId !== 'string') return undefined
    return {
      ...emptySessionFile(parsed.sessionId, parsed.cwd ?? ''),
      ...parsed,
      dismissed: parsed.dismissed ?? [],
      jobs: parsed.jobs ?? [],
      runs: parsed.runs ?? [],
    } as SessionFile
  } catch {
    return undefined
  }
}

// Writes are serialized per path so two hooks of the same session never interleave a read-modify-write.
const queues = new Map<string, Promise<unknown>>()

export async function updateSessionFile(
  $: EngineInterface,
  path: string,
  init: () => SessionFile,
  mutate: (file: SessionFile) => void,
): Promise<SessionFile> {
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    const file = (await readSessionFile($, path)) ?? init()
    mutate(file)
    await $.fs.write(path, JSON.stringify(file, null, 2))
    return file
  })
  queues.set(path, next)
  return next
}

// The calling session's own file: the only file this session writes (except `hide` on a stopped session, see command.ts).
export async function updateOwnSession($: EngineInterface, mutate: (file: SessionFile) => void): Promise<SessionFile> {
  const paths = await clockOutPaths($)
  const sessionId = await $.session.id()
  const cwd = await $.session.cwd()
  const path = sessionFilePath(paths, sessionId)
  return updateSessionFile($, path, () => emptySessionFile(sessionId, cwd), mutate)
}

// Touch the stamp file: the service's FileSystemWatcher and other sessions' overview wake on it.
export async function touchStamp($: EngineInterface): Promise<void> {
  try {
    const paths = await clockOutPaths($)
    const now = await $.clock.now()
    await $.fs.write(paths.stamp, new Date(now).toISOString())
  } catch {
    // never let a stamp failure break the tool call that triggered it
  }
}

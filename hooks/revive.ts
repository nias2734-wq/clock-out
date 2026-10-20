import type { EngineInterface } from 'claude-code'

import { buildOverview } from './overview'
import { clockOutPaths, sessionFilePath } from './paths'
import { emptySessionFile, liveJobs } from './schema'
import type { SessionFile } from './schema'
import { readSessionFile, touchStamp, updateSessionFile } from './sessionFile'

// Wakes a stopped session in the background: `claude --bg --resume <id> "<first message>"`. The resumed session
// restores its jobs from the transcript; the first message asks it to check them and renew what is about to expire.
//
// Rules measured on Claude Code 2.1.3xx:
//   - a session that has run in the background before keeps its saved options; passing flags again starts a COPY
//     under a new id ("started a copy as <id>"), so flags go only on the first background start (bgSince unset);
//   - `claude agents --json --all` does not list a session for a few seconds after `claude stop`, so the file's
//     bgSince is the first source and the listing the second;
//   - a copy that slipped through is stopped at once so the schedule is not registered twice.

const RUN_TIMEOUT_MS = 90_000

export function reviveMessage(file: SessionFile): string {
  const lines = liveJobs(file).map((j, i) => `${i + 1}. cron "${j.cron}" (${j.recurring ? 'recurring' : 'one-shot'}) prompt: ${j.prompt}`)
  return (
    'clock-out woke this session so its scheduled jobs keep firing. Call CronList first. ' +
    'Jobs below that are missing: CronCreate them again with the same cron and prompt. ' +
    'A recurring job that expires within a day: CronDelete it and CronCreate it again. ' +
    'Do nothing else, report in one line, then stop. Keep this session running.\n' +
    lines.join('\n')
  )
}

async function wasBackgroundBefore($: EngineInterface, sessionId: string): Promise<boolean> {
  try {
    const ran = await $.process.run(['claude', 'agents', '--json', '--all'], { timeoutMs: 20_000 })
    if (ran.exitCode !== 0) return false
    const list = JSON.parse(ran.stdout) as { sessionId?: string; kind?: string }[]
    return list.some(s => s.sessionId === sessionId && s.kind === 'background')
  } catch {
    return false
  }
}

export async function reviveSession($: EngineInterface, sessionId: string): Promise<string> {
  const overview = await buildOverview($)
  const view = overview.sessions.find(s => s.sessionId === sessionId)
  if (view?.isAlive === true) return `${view.shortId} is already running.`

  const paths = await clockOutPaths($)
  const path = sessionFilePath(paths, sessionId)
  const file = (await readSessionFile($, path)) ?? emptySessionFile(sessionId, view?.cwd ?? '')
  const short = sessionId.slice(0, 8)
  const wasBg = file.bgSince !== undefined || (await wasBackgroundBefore($, sessionId))

  const argv = ['claude', '--bg', '--resume', sessionId]
  if (!wasBg) argv.push('--dangerously-skip-permissions')   // saved by the first background start; never repeated
  argv.push(reviveMessage(file))

  let ran
  try {
    ran = await $.process.run(argv, { cwd: file.cwd || undefined, timeoutMs: RUN_TIMEOUT_MS })
  } catch (err) {
    return `${short}: could not start claude (${String(err)})`
  }
  const said = `${ran.stdout}\n${ran.stderr}`
  if (ran.exitCode !== 0) return `${short}: claude --bg --resume failed (exit ${ran.exitCode}): ${said.trim().slice(0, 200)}`

  let copyNote = ''
  const copy = /started a copy as (\w+)/.exec(said)
  if (copy !== null && copy[1] !== undefined) {
    try {
      await $.process.run(['claude', 'stop', copy[1]], { timeoutMs: 20_000 })
      copyNote = ` (a copy ${copy[1]} was started by the flags and stopped)`
    } catch {
      copyNote = ` (a copy ${copy[1]} was started by the flags; stop it with: claude stop ${copy[1]})`
    }
  }

  const now = await $.clock.now()
  await updateSessionFile($, path, () => file, f => {
    if (f.bgSince === undefined) f.bgSince = now
  })
  await touchStamp($)
  return `${short}: woken in the background${copyNote}. It checks its jobs now; attach with: claude attach ${short}`
}

// Resolves a session from a full id or a prefix; undefined when none or ambiguous.
export async function findSessionId($: EngineInterface, idOrPrefix: string): Promise<string | undefined> {
  const overview = await buildOverview($)
  const hits = overview.sessions.filter(s => s.sessionId.startsWith(idOrPrefix))
  return hits.length === 1 ? hits[0]?.sessionId : undefined
}

import type { EngineInterface } from 'claude-code'

// Where the plugin keeps its files. Mirrors Claude Code's own config dir rule: CLAUDE_CONFIG_DIR, else ~/.claude.
export type ClockOutPaths = {
  configDir: string          // C:/Users/alice/.claude
  root: string               // <configDir>/clock-out
  sessionsDir: string        // <root>/sessions
  stamp: string              // <root>/sessions/_stamp  (touched whenever a job list changes)
  liveSessionsDir: string    // <configDir>/sessions   (Claude Code's <pid>.json per running session)
}

function slash(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export async function clockOutPaths($: EngineInterface): Promise<ClockOutPaths> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  let configDir: string
  if (configured !== undefined && configured !== '') {
    configDir = slash(configured)
  } else {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    configDir = `${slash(home)}/.claude`
  }
  const root = `${configDir}/clock-out`
  return {
    configDir,
    root,
    sessionsDir: `${root}/sessions`,
    stamp: `${root}/sessions/_stamp`,
    liveSessionsDir: `${configDir}/sessions`,
  }
}

export function sessionFilePath(paths: ClockOutPaths, sessionId: string): string {
  return `${paths.sessionsDir}/${sessionId}.json`
}

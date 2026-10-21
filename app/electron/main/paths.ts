import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

import { isCapture } from './capture'

// Same folder rule as the plugin (hooks/paths.ts) and the PowerShell service: CLAUDE_CONFIG_DIR, else ~/.claude
export function claudeConfigDir(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.claude')
}

export const paths = {
  configDir: claudeConfigDir(),
  root: join(claudeConfigDir(), 'clock-out'),
  sessionsDir: join(claudeConfigDir(), 'clock-out', 'sessions'),
  appSettings: join(claudeConfigDir(), 'clock-out', 'app-settings.json'),
  appState: join(claudeConfigDir(), 'clock-out', 'app-state.json'),       // the app's own per-session state (appState.ts); the plugin only reads it
  serviceConfig: join(claudeConfigDir(), 'clock-out', 'config.json'),
  log: join(claudeConfigDir(), 'clock-out', 'app.log'),
  remoteDir: join(claudeConfigDir(), 'clock-out', 'remote'),             // the remote jobs session's working folder
  remoteState: join(claudeConfigDir(), 'clock-out', 'remote.json'),
  updateCheck: join(claudeConfigDir(), 'clock-out', 'update-check.json'),  // the last release check and the version already announced
  overview: join(claudeConfigDir(), 'clock-out', 'overview.json'),           // the app's current overview, for the plugin
  requestsDir: join(claudeConfigDir(), 'clock-out', 'requests'),         // the plugin's wake / reopen requests
  inboxDir: join(claudeConfigDir(), 'clock-out', 'inbox'),               // messages between sessions, one folder per session
  credentials: join(claudeConfigDir(), '.credentials.json'),
  liveSessionsDir: join(claudeConfigDir(), 'sessions'),
  // shared with the v1 widget so two readers never exceed the usage API's rate limit together; capture mode keeps its own
  usageCache: isCapture() ? join(claudeConfigDir(), 'clock-out', 'capture', 'usage-cache.json') : join(tmpdir(), 'claude-usage-cache.json'),
}

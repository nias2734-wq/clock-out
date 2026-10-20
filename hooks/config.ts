import type { EngineInterface, PluginOptions } from 'claude-code'

import { clockOutPaths } from './paths'

// The service runs outside Claude Code and cannot read the plugin's userConfig, so the module copies the
// service's fields to <root>/config.json: on first run, and afterwards only while managedByPlugin is true
// (set it to false in the file to edit it by hand). dryRun is the service's own and is never overwritten.
const SERVICE_FIELDS = ['usageWidget', 'alignPing', 'expandAt', 'weekdaysOnly', 'reviveLeadMinutes', 'expiryLeadHours', 'legacyTranscriptScan'] as const

export async function syncServiceConfig($: EngineInterface, options: PluginOptions): Promise<void> {
  try {
    const paths = await clockOutPaths($)
    const path = `${paths.root}/config.json`
    let current: Record<string, unknown> = {}
    if (await $.fs.exists(path)) {
      const text = await $.fs.read(path)
      if (typeof text === 'string') current = JSON.parse(text) as Record<string, unknown>
      if (current.managedByPlugin === false) return
    }
    const next: Record<string, unknown> = { ...current, managedByPlugin: true }
    if (next.dryRun === undefined) next.dryRun = false
    let changed = Object.keys(current).length === 0
    for (const key of SERVICE_FIELDS) {
      const value = options[key]
      if (value === undefined) continue
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) { next[key] = value; changed = true }
    }
    if (changed) await $.fs.write(path, JSON.stringify(next, null, 2))
  } catch {
    // the service falls back to its defaults
  }
}

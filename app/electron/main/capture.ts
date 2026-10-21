import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Capture mode (CLOCKOUT_SHOT_DIR=<folder>): the app saves its windows as PNG and quits.
// Nothing in it reaches the real PC or account: no usage request, no `claude` run, no Windows autostart entry,
// no shared %TEMP% cache. What those would have answered comes from <config>/clock-out/capture/*.json (scripts/capture.mjs).

export const SHOT_DIR = process.env.CLOCKOUT_SHOT_DIR !== '' ? process.env.CLOCKOUT_SHOT_DIR : undefined

export function isCapture(): boolean {
  const dir = process.env.CLOCKOUT_SHOT_DIR
  return dir !== undefined && dir !== ''
}

// <config>/clock-out/capture/<name>.json, or undefined when the capture folder has none
export function captureFixture<T>(configDir: string, name: string): T | undefined {
  try { return JSON.parse(readFileSync(join(configDir, 'clock-out', 'capture', `${name}.json`), 'utf8')) as T } catch { return undefined }
}

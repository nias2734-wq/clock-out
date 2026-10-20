import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { prunedCleared } from '@shared/schedule'
import { DEFAULT_SETTINGS, RUN_MODES } from '@shared/types'
import type { AppSettings, RunMode } from '@shared/types'

import { paths } from './paths'

let current: AppSettings | undefined

function merge(saved: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    statusBar: { ...DEFAULT_SETTINGS.statusBar, ...saved.statusBar },
    workHours: { ...DEFAULT_SETTINGS.workHours, ...saved.workHours },
    alignPing: { ...DEFAULT_SETTINGS.alignPing, ...saved.alignPing },
    revive: { ...DEFAULT_SETTINGS.revive, ...saved.revive },
    permission: { ...DEFAULT_SETTINGS.permission, ...saved.permission },
    remote: { ...DEFAULT_SETTINGS.remote, ...saved.remote },
    runMode: mergeRunMode(saved.runMode),
    cleanup: mergeCleanup(saved.cleanup),
    doneCleared: mergeCleared(saved.doneCleared),
  }
}

// a hand-edited file may hold a non-number time: dropped instead of hiding every done row or none
function mergeCleared(saved: unknown): Record<string, number> {
  const cleared: Record<string, number> = {}
  if (typeof saved !== 'object' || saved === null) return cleared
  for (const [id, at] of Object.entries(saved)) if (typeof at === 'number' && Number.isFinite(at)) cleared[id] = at
  return cleared
}

// an empty number box or a hand-edited file gives 0 or NaN: fall back to the default instead of stopping sessions at once
function mergeCleanup(saved: Partial<AppSettings['cleanup']> | undefined): AppSettings['cleanup'] {
  const minutes = Number(saved?.idleMinutes)
  return {
    auto: typeof saved?.auto === 'boolean' ? saved.auto : DEFAULT_SETTINGS.cleanup.auto,
    idleMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.min(Math.round(minutes), 24 * 60) : DEFAULT_SETTINGS.cleanup.idleMinutes,
  }
}

// an unknown mode name (hand-edited file) falls back to the default instead of reaching the run watcher
function mergeRunMode(saved: Partial<AppSettings['runMode']> | undefined): AppSettings['runMode'] {
  const isMode = (m: unknown): m is RunMode => RUN_MODES.includes(m as RunMode)
  const sessions: Record<string, RunMode> = {}
  for (const [id, m] of Object.entries(saved?.sessions ?? {})) if (isMode(m)) sessions[id] = m
  const chosen = saved?.default
  return { default: isMode(chosen) ? chosen : DEFAULT_SETTINGS.runMode.default, sessions }
}

export function getSettings(): AppSettings {
  if (current !== undefined) return current
  try {
    // a BOM (PowerShell's Out-File writes one) would make JSON.parse throw and silently reset every setting
    current = merge(JSON.parse(readFileSync(paths.appSettings, 'utf8').replace(/^﻿/, '')) as Partial<AppSettings>)
  } catch {
    current = { ...DEFAULT_SETTINGS }
  }
  return current
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = merge({ ...getSettings(), ...patch })
  current = { ...next, doneCleared: prunedCleared(next.doneCleared, Date.now()) }
  mkdirSync(dirname(paths.appSettings), { recursive: true })
  writeFileSync(paths.appSettings, JSON.stringify(current, null, 2), 'utf8')
  return current
}

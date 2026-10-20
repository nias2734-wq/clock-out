// Types shared by main, preload and renderer. Keep this file free of Node and DOM.

export type UsageWindow = {
  key: string              // 'five_hour' | 'seven_day' | 'model:<name>' (a per-model weekly limit, e.g. model:Fable)
  label: string            // '5h' | '7d' | the model name (renderer translates the first two by key)
  percent: number          // 0..100, one decimal
  resetsAt?: string        // ISO 8601 from the API
  isCritical?: boolean     // the API marks the limit as reached (severity critical)
}

export type UsageState = {
  rows: UsageWindow[]
  fetchedAt?: number       // epoch ms of the last successful fetch
  status: string           // '' | 'waiting until HH:mm' | error text
  isWaiting: boolean       // 429 backoff in effect
}

export type WorkHours = {
  start: string            // '09:00'
  lunchStart: string       // '12:00'
  lunchEnd: string         // '13:00'
  end: string              // '18:00'
  weekdays: number[]       // 1..5 = Mon..Fri (JS getDay)
}

export type PermissionMode = 'work' | 'bypass'   // work = acceptEdits + allowed tools; bypass = --dangerously-skip-permissions

export type ThemeMode = 'system' | 'light' | 'dark'   // system = follow the Windows app mode

// How a fired job is shown: quiet = background only | notify = desktop notice at start and when it waits for an answer | open = a terminal window on it
export type RunMode = 'quiet' | 'notify' | 'open'
export const RUN_MODES: readonly RunMode[] = ['quiet', 'notify', 'open']

export type AppSettings = {
  version: 1
  language: 'ko' | 'en'
  theme: ThemeMode
  launchAtLogin: boolean
  onboardingDone: boolean
  statusBar: { x?: number; y?: number; expandedHeightRatio: number }
  workHours: WorkHours
  alignPing: { enabled: boolean; model: string; resetHours?: number[] }   // resetHours: chosen reset hours, absent = lunch end and 5 h later
  revive: { leadMinutes: number; expiryLeadHours: number; dailyAtEnd: boolean; confirmBefore: boolean; dryRun: boolean }
  permission: { mode: PermissionMode; allowedTools: string[] }
  legacyTranscriptScan: boolean
  remote: RemoteSettings
  runMode: { default: RunMode; sessions: Record<string, RunMode> }   // sessions: per-session choice from the jobs panel (sessionId → mode)
  cleanup: { auto: boolean; idleMinutes: number }   // auto: stop an idle background session with no job left after idleMinutes (shared/cleanup.ts)
  doneCleared: Record<string, number>   // sessionId → when the panel's "clean up the list" was pressed; done before it is hidden (schedule.ts doneOf)
}

// The remote jobs session (원격 예약 작업 세션): one session on the phone that sees every job and forwards instructions
export type RemoteSettings = {
  enabled: boolean                         // the remote jobs session runs (the panel's monitor button turns it on)
  permission: PermissionMode               // of the remote jobs session itself
  notify: 'off' | 'failures' | 'all'       // which finished jobs are reported to it (and pushed to the phone)
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  language: 'ko',
  theme: 'system',
  launchAtLogin: false,
  onboardingDone: false,
  statusBar: { expandedHeightRatio: 0.6 },
  workHours: { start: '09:00', lunchStart: '12:00', lunchEnd: '13:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
  alignPing: { enabled: true, model: 'haiku' },
  revive: { leadMinutes: 10, expiryLeadHours: 24, dailyAtEnd: true, confirmBefore: false, dryRun: false },
  permission: { mode: 'work', allowedTools: ['Bash(git *)', 'Bash(npm *)', 'Read', 'Edit', 'Write', 'Glob', 'Grep'] },
  legacyTranscriptScan: false,
  remote: { enabled: false, permission: 'work', notify: 'failures' },
  runMode: { default: 'notify', sessions: {} },
  cleanup: { auto: true, idleMinutes: 30 },
  doneCleared: {},
}

import type { StopCheck } from './cleanup'
import type { Overview } from './schedule'

// The user guide's checklist (electron/main/setup.ts)
export type SetupKey = 'cli' | 'login' | 'plugin' | 'records' | 'sleep' | 'terminal' | 'conflict'
export type SetupFix = 'disableSleep' | 'installPlugin' | 'enablePlugin' | 'disableLegacy' | 'openLogin' | 'openDownload' | 'openTerminalStore'
export type SetupCheck = { key: SetupKey; state: 'ok' | 'warn' | 'error' | 'unknown'; detail: string; fix?: SetupFix; note?: 'dev' }

// What the preload exposes to the renderer (window.clockOut)
export type AppInfo = { version: string; pluginDir: string }

export type ClockOutApi = {
  getAppInfo: () => Promise<AppInfo>
  openSetup: () => void
  checkSetup: () => Promise<SetupCheck[]>
  runFix: (fix: SetupFix) => Promise<{ ok: boolean; message: string }>
  openGuide: () => void
  openExternal: (url: string) => void   // https only, checked in main
  openMonitor: () => Promise<string>   // turn the remote jobs session on and open its address (remote.ts)
  stopMonitor: () => Promise<string>   // turn the remote jobs session off (remote.enabled = false, claude stop; remote.json kept so it resumes)
  getSchedule: () => Promise<Overview>
  hideJob: (jobId: string) => Promise<string>
  reviveSession: (sessionId: string) => Promise<string>
  attachSession: (sessionId: string) => Promise<string>
  openSession: (sessionId: string) => Promise<string>   // attach when it runs, else claude --resume in a terminal
  stopSession: (sessionId: string, confirmed?: boolean) => Promise<string>   // claude stop, background sessions only; refused with the reason when stopBlock says no, or when a warning came up that was not confirmed
  stopCheck: (sessionId: string) => Promise<StopCheck>   // why it cannot be stopped now, and what to ask first (asks claude agents and the attach windows)
  clearSession: (sessionId: string, confirmed?: boolean) => Promise<string>   // the done list's "clean up the list": claude stop when clearHow says so, then hide its done rows
  tidyDone: (sessionIds: string[]) => Promise<string>   // the "clean up done" button: stop the still-idle running ones, hide the done rows of all, one summary line
  copyText: (text: string) => void   // to the clipboard, through the main process
  deleteJob: (sessionId: string, jobId: string) => Promise<{ ok: boolean; text: string; canStop: boolean }>   // the session deletes it (deleteJob.ts)
  onNotice: (listener: (text: string, kind: 'info' | 'warn') => void) => () => void
  setExpanded: (expanded: boolean) => void      // grow the window below the bar / shrink back
  onSchedule: (listener: (o: Overview) => void) => () => void
  onCommand: (listener: (command: string) => void) => () => void   // main → page: 'expand' …
  getUsage: () => Promise<UsageState>
  refreshUsage: () => Promise<UsageState>
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  quit: () => void
  openSettings: () => void
  onSettings: (listener: (s: AppSettings) => void) => () => void
  setStripWidth: (width: number) => void   // the bar sizes itself to its content
  showStripMenu: () => void                // the bar's right-click menu (refresh, panel, remote monitor, settings, setup check, guide, quit)
  onboardingDone: () => void               // closes the first-run window and starts the app
  onUsage: (listener: (state: UsageState) => void) => () => void
}

import { contextBridge, ipcRenderer } from 'electron'

import type { StopCheck } from '@shared/cleanup'
import type { Overview } from '@shared/schedule'
import type { AppInfo, AppSettings, ClockOutApi, SetupCheck, UsageState } from '@shared/types'

// The only bridge between the page and Node: a fixed list of calls. Nothing else of Electron reaches the page.
const api: ClockOutApi = {
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  openSetup: () => { ipcRenderer.send('setup:open') },
  checkSetup: () => ipcRenderer.invoke('setup:check') as Promise<SetupCheck[]>,
  runFix: fix => ipcRenderer.invoke('setup:fix', fix) as Promise<{ ok: boolean; message: string }>,
  openGuide: () => { ipcRenderer.send('guide:open') },
  openExternal: url => { ipcRenderer.send('open:external', url) },
  openMonitor: () => ipcRenderer.invoke('remote:open'),
  stopMonitor: () => ipcRenderer.invoke('remote:stop'),
  getSchedule: () => ipcRenderer.invoke('schedule:get') as Promise<Overview>,
  hideJob: jobId => ipcRenderer.invoke('schedule:hide', jobId) as Promise<string>,
  reviveSession: sessionId => ipcRenderer.invoke('schedule:revive', sessionId) as Promise<string>,
  attachSession: sessionId => ipcRenderer.invoke('schedule:attach', sessionId) as Promise<string>,
  openSession: sessionId => ipcRenderer.invoke('schedule:open', sessionId) as Promise<string>,
  stopSession: (sessionId, confirmed) => ipcRenderer.invoke('schedule:stop', sessionId, confirmed === true) as Promise<string>,
  stopCheck: sessionId => ipcRenderer.invoke('schedule:stopCheck', sessionId) as Promise<StopCheck>,
  clearSession: (sessionId, confirmed) => ipcRenderer.invoke('schedule:clear', sessionId, confirmed === true) as Promise<string>,
  tidyDone: sessionIds => ipcRenderer.invoke('schedule:tidyDone', sessionIds) as Promise<string>,
  copyText: text => { ipcRenderer.send('clipboard:write', text) },
  deleteJob: (sessionId, jobId) => ipcRenderer.invoke('schedule:delete', sessionId, jobId),
  onNotice: listener => {
    const handler = (_e: unknown, text: string, kind: 'info' | 'warn') => listener(text, kind)
    ipcRenderer.on('notice', handler)
    return () => { ipcRenderer.removeListener('notice', handler) }
  },
  setExpanded: expanded => { ipcRenderer.send('strip:expand', expanded) },
  onCommand: listener => {
    const handler = (_e: unknown, command: string) => listener(command)
    ipcRenderer.on('command', handler)
    return () => { ipcRenderer.removeListener('command', handler) }
  },
  onSchedule: listener => {
    const handler = (_e: unknown, o: Overview) => listener(o)
    ipcRenderer.on('schedule', handler)
    return () => { ipcRenderer.removeListener('schedule', handler) }
  },
  getUsage: () => ipcRenderer.invoke('usage:get') as Promise<UsageState>,
  refreshUsage: () => ipcRenderer.invoke('usage:refresh') as Promise<UsageState>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  setSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,
  quit: () => { ipcRenderer.send('app:quit') },
  openSettings: () => { ipcRenderer.send('settings:open') },
  onSettings: listener => {
    const handler = (_e: unknown, s: AppSettings) => listener(s)
    ipcRenderer.on('settings', handler)
    return () => { ipcRenderer.removeListener('settings', handler) }
  },
  showStripMenu: () => ipcRenderer.send('strip:menu'),
  setStripWidth: width => { ipcRenderer.send('strip:width', width) },
  onboardingDone: () => { ipcRenderer.send('onboarding:done') },
  onUsage: listener => {
    const handler = (_e: unknown, state: UsageState) => listener(state)
    ipcRenderer.on('usage', handler)
    return () => { ipcRenderer.removeListener('usage', handler) }
  },
}

contextBridge.exposeInMainWorld('clockOut', api)

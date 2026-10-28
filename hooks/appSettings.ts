import type { EngineInterface } from 'claude-code'

import { clockOutPaths } from './paths'
import type { WorkHours } from './timeline'

// The desktop app's settings file (<config>/clock-out/app-settings.json), read-only from here. Absent without the app.
export type AppSettingsFile = {
  language?: 'ko' | 'en'
  workHours?: WorkHours & { weekdays?: number[] }
  alignPing?: { enabled?: boolean; resetHours?: number[] }
  remote?: { enabled?: boolean; notify?: 'off' | 'failures' | 'all' }
  permission?: { disallowedTools?: string[] }   // 예약 실행 턴에서만 막는 명령   "Bash(git push*)"
}

export async function readAppSettings($: EngineInterface): Promise<AppSettingsFile | undefined> {
  try {
    const path = `${(await clockOutPaths($)).root}/app-settings.json`
    if (!(await $.fs.exists(path))) return undefined
    const text = await $.fs.read(path)
    return typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) as AppSettingsFile : undefined
  } catch {
    return undefined
  }
}

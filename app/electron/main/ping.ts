import { execFile } from 'node:child_process'

import { formatLocalStamp } from '@shared/time'
import { planPings } from '@shared/timeline'

import { log } from './log'
import { getSettings } from './settings'
import { fetchUsage } from './usage'

// Aligns the 5-hour usage window with the work day: the window starts at the full hour of the first call, so a
// tiny call at (reset hour − 5):05 makes the window reset at that hour. The reset hours are the person's choice, or
// the lunch end and 5 hours later (shared/timeline.ts planPings). One call per hour slot per day, work days only.

let lastSlot = ''          // 'yyyy-MM-dd HH' of the last ping sent
let running = false

export function pingTick(): void {
  const settings = getSettings()
  if (!settings.alignPing.enabled || running) return
  const now = new Date()
  if (!settings.workHours.weekdays.includes(now.getDay())) return
  const hours = planPings(settings.workHours, settings.alignPing.resetHours).pings.map(m => Math.floor(m / 60))
  if (!hours.includes(now.getHours())) return
  const slot = formatLocalStamp(now.getTime()).slice(0, 13)
  if (slot === lastSlot) return
  lastSlot = slot
  running = true
  log(`PING sending (claude -p ok --model ${settings.alignPing.model})`)
  execFile('claude', ['-p', 'ok', '--model', settings.alignPing.model], { windowsHide: true, timeout: 120_000 }, err => {
    running = false
    log(`PING done ${err === null ? 'ok' : `failed ${err.message}`}`)
    void fetchUsage(true)   // the window just opened: show the new reset time now
  })
}

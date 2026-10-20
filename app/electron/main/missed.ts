import { prunedDismissed } from '@shared/missed'

import { readAppState, patchSession } from './appState'
import { log } from './log'
import { notice } from './revive'
import { buildOverview } from './schedule'
import { getSettings } from './settings'
import { wakeSession } from './wake'

// Missed jobs (놓친 예약, shared/missed.ts): looked for when the app starts and when Windows wakes from sleep
// (powerMonitor 'resume', index.ts). One Windows notice per job; nothing runs on its own. The panel shows
// Overview.missed with "run now" (runMissed) and "close" (dismissMissed).

const notified = new Set<string>()   // missed keys already in a notice since the app started

export function checkMissed(trigger: 'start' | 'resume'): void {
  const fresh = (buildOverview().missed ?? []).filter(m => !notified.has(m.key))
  if (fresh.length === 0) return
  for (const m of fresh) notified.add(m.key)
  log(`MISSED ${trigger}: ${fresh.map(m => `${m.sessionId.slice(0, 8)}/${m.jobId}`).join(', ')}`)
  const ko = getSettings().language === 'ko'
  const first = fresh[0]?.prompt.replace(/\s+/g, ' ').slice(0, 40) ?? ''
  notice(ko
    ? `놓친 예약 ${fresh.length}개 (PC 가 꺼져 있거나 절전 중이었습니다): ${first}${fresh.length > 1 ? ' 외' : ''}. 예약 창에서 지금 실행하거나 닫을 수 있습니다.`
    : `${fresh.length} missed job(s) while the PC was off or asleep: ${first}${fresh.length > 1 ? ' and more' : ''}. Run or close them from the jobs panel.`, 'warn')
}

function find(sessionId: string, key: string) {
  const overview = buildOverview()
  return { missed: overview.missed?.find(m => m.sessionId === sessionId && m.key === key), view: overview.sessions.find(s => s.sessionId === sessionId) }
}

function close(sessionId: string, key: string): void {
  const st = readAppState().sessions[sessionId]
  patchSession(sessionId, { missedDismissed: { ...prunedDismissed(st?.missedDismissed, Date.now()), [key]: Date.now() } })
}

// "Run now": wake the session with the job's prompt as its first message (a running session with the plugin gets it in
// its inbox through the same wake path); the entry is closed once the session took it
export async function runMissed(sessionId: string, key: string): Promise<string> {
  const { missed, view } = find(sessionId, key)
  if (missed === undefined || view === undefined) return `no missed job ${key}`
  log(`MISSED run ${sessionId.slice(0, 8)}/${missed.jobId}`)
  const r = await wakeSession(view, `missed job ${missed.jobId}`, { message: missed.prompt })
  if (r.ok) close(sessionId, key)
  return r.message
}

export function dismissMissed(sessionId: string, key: string): string {
  if (typeof key !== 'string' || key === '') return 'no key'
  close(sessionId, key)
  log(`MISSED closed ${sessionId.slice(0, 8)}/${key}`)
  return `closed ${key}`
}

import { execFile } from 'node:child_process'

import { attachTargets, clearHow, isAttachedTo, isAutoStopDue, idleSince, stopBlock, stopWarns, tidyList } from '@shared/cleanup'
import type { StopBlock, StopCheck } from '@shared/cleanup'
import { agentStates } from '@shared/runMode'
import type { Overview, SessionView } from '@shared/schedule'

import { log } from './log'
import { isRemoteSession } from './remoteState'
import { notice, runClaude, stopBackground } from './revive'
import { clearDone } from './schedule'
import { getSettings } from './settings'

// Stops background sessions that are done (each holds about 0.5 GB): the panel's "stop session" button after a fresh
// check, and the automatic cleanup on the scheduler's 30 s tick (wake.ts startScheduler). The two commands it needs
// (`claude agents`, the attach windows) run only when a session is about to be stopped or the panel asks.

const CHECK_KEPT_MS = 15_000         // the panel asks again on every selection; one answer serves them for this long
const RECHECK_MS = 5 * 60_000        // a due session that could not be stopped (waits for an answer, a window is open) is asked again after this

type Checked = { at: number; ok: boolean; states: Map<string, string>; targets: string[] }
let cached: Checked | undefined
let asking: Promise<Checked> | undefined

// Command lines of every claude.exe, one per line; a `claude attach <id>` window is one of them
function claudeCommandLines(): Promise<{ ok: boolean; out: string }> {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object { $_.CommandLine }"],
      { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve({ ok: err === null, out: String(stdout) }))
  })
}

async function ask(): Promise<Checked> {
  const [agents, lines] = await Promise.all([runClaude(['agents', '--json', '--all'], undefined), claudeCommandLines()])
  return { at: Date.now(), ok: agents.code === 0 && lines.ok, states: agentStates(agents.output), targets: attachTargets(lines.out) }
}

async function liveChecks(fresh: boolean): Promise<Checked> {
  if (!fresh && cached !== undefined && Date.now() - cached.at < CHECK_KEPT_MS) return cached
  asking ??= ask().finally(() => { asking = undefined })
  cached = await asking
  return cached
}

function checkOf(s: SessionView, c: Checked): StopCheck {
  const block = stopBlock(s, isRemoteSession(s.sessionId))
  return { block, warns: block !== undefined ? [] : stopWarns({ state: c.states.get(s.sessionId), isAttached: isAttachedTo(s, c.targets) }) }
}

// The panel's button state: no block = it can be stopped (or is not running at all); warns = the button asks first
export async function stopCheck(s: SessionView): Promise<StopCheck> {
  if (!s.isAlive) return { warns: [] }
  const block = stopBlock(s, isRemoteSession(s.sessionId))
  if (block !== undefined) return { block, warns: [] }
  return checkOf(s, await liveChecks(false))
}

const BLOCK_TEXT: Record<StopBlock, { ko: string; en: string }> = {
  terminal: { ko: '터미널 창에서 도는 세션이라 끄지 않습니다. 그 창에서 /exit 하세요', en: 'it runs in a terminal window; /exit there' },
  remote: { ko: '원격 예약 작업 세션은 끄지 않습니다', en: 'the remote jobs session is not stopped here' },
  running: { ko: '예약이 실행 중입니다', en: 'a job is running' },
}

// The panel's "stop session": asked again now (the button state may be 15 s old), then claude stop.
// confirmed = the person saw the answer-wait / attach window warning and pressed stop anyway
export async function stopIfDone(s: SessionView, confirmed: boolean): Promise<string> {
  const ko = getSettings().language === 'ko'
  const check: StopCheck = s.isAlive ? checkOf(s, await liveChecks(true)) : { warns: [] }
  if (check.block !== undefined) {
    log(`STOP ${s.shortId} refused: ${check.block}`)
    return ko ? `${s.shortId} 을 끄지 않았습니다: ${BLOCK_TEXT[check.block].ko}` : `${s.shortId} not stopped: ${BLOCK_TEXT[check.block].en}`
  }
  // a warning that appeared after the button was drawn: the button asks first on the next press
  if (check.warns.length > 0 && !confirmed) {
    log(`STOP ${s.shortId} needs confirm: ${check.warns.join(',')}`)
    return ko ? `${s.shortId}: 확인할 것이 생겨 끄지 않았습니다. 다시 누르세요` : `${s.shortId}: not stopped, something to confirm came up; press again`
  }
  return stopBackground(s)
}

// The done list's "clean up the list": claude stop first when clearHow says so (asked again now), then its done rows are hidden.
// confirmed = the person saw the answer-wait / attach window warning and pressed it anyway
export async function clearSession(s: SessionView, confirmed: boolean): Promise<string> {
  const ko = getSettings().language === 'ko'
  // only a running session with no job left may be stopped: ask the commands just for that one
  const mayStop = s.isAlive && !s.jobs.some(j => !j.isDismissed)
  const check: StopCheck = mayStop ? checkOf(s, await liveChecks(true)) : { warns: [] }
  const how = clearHow(s, check.block)
  if (how === undefined) {
    log(`CLEAR ${s.shortId} refused: ${check.block ?? ''}`)
    return ko ? `${s.shortId} 을 정리하지 않았습니다: ${BLOCK_TEXT.running.ko}` : `${s.shortId} not cleaned up: ${BLOCK_TEXT.running.en}`
  }
  if (how === 'stop') {
    if (check.warns.length > 0 && !confirmed) {
      log(`CLEAR ${s.shortId} needs confirm: ${check.warns.join(',')}`)
      return ko ? `${s.shortId}: 확인할 것이 생겨 정리하지 않았습니다. 다시 누르세요` : `${s.shortId}: not cleaned up, something to confirm came up; press again`
    }
    const ran = await runClaude(['stop', s.shortId], undefined)
    log(`CLEAR ${s.shortId} stop exit ${ran.code}`)
    if (ran.code !== 0) return ko ? `${s.shortId}: claude stop 이 실패해 정리하지 않았습니다(exit ${ran.code})` : `${s.shortId}: claude stop failed (exit ${ran.code}), not cleaned up`
  }
  clearDone([s.sessionId])
  return ko
    ? `${s.label} · ${s.shortId} ${how === 'stop' ? '을 끄고 ' : '의 '}완료 기록을 목록에서 정리했습니다. 대화 기록은 남아 있습니다.`
    : `${how === 'stop' ? 'Stopped' : 'Cleaned up'} ${s.label} · ${s.shortId}${how === 'stop' ? ' and cleaned up its done list' : ''}. The conversation stays.`
}

// The panel's "clean up done": after one fresh check, stops the chosen running sessions (the person confirmed the warnings
// in the list) and hides the done rows of those stopped and of the chosen stopped ones. Only sessions still on tidyList count.
export async function tidyDone(sessions: SessionView[], ids: readonly string[]): Promise<string> {
  const ko = getSettings().language === 'ko'
  const targets = tidyList(sessions.filter(s => ids.includes(s.sessionId)), sessions.find(s => isRemoteSession(s.sessionId))?.sessionId)
  const c = targets.some(t => t.stop) ? await liveChecks(true) : undefined
  const cleared: string[] = []
  let stopped = 0
  let failed = 0
  const skipped: StopBlock[] = []
  for (const { s, stop } of targets) {
    if (stop && c !== undefined) {
      const block = checkOf(s, c).block
      if (block !== undefined) { skipped.push(block); continue }
      const ran = await runClaude(['stop', s.shortId], undefined)
      log(`TIDY ${s.shortId} stop exit ${ran.code}`)
      if (ran.code !== 0) { failed++; continue }
      stopped++
    }
    cleared.push(s.sessionId)
  }
  clearDone(cleared)
  const gone = ids.length - targets.length   // jobs added, or stopped / started since the list was drawn
  const parts = [ko ? `${cleared.length}개 정리(그중 ${stopped}개는 끄고 정리)` : `cleaned up ${cleared.length} (stopped ${stopped} of them)`]
  for (const block of new Set(skipped)) {
    const n = skipped.filter(b => b === block).length
    parts.push(ko ? `${n}개는 ${BLOCK_TEXT[block].ko.replace(/입니다$/, '이라')} 건너뜀` : `skipped ${n}: ${BLOCK_TEXT[block].en}`)
  }
  if (gone > 0) parts.push(ko ? `${gone}개는 상태가 바뀌어 건너뜀` : `skipped ${gone}: changed since the list was drawn`)
  if (failed > 0) parts.push(ko ? `${failed}개는 claude stop 실패` : `${failed} failed (claude stop)`)
  return parts.join(', ')
}

const lastAsked = new Map<string, number>()   // sessionId → when the cleanup last tried it
let cleaning = false

// The automatic cleanup: a background session with no job left, idle for the set minutes, is stopped.
// Only the log and the open windows hear about it (no Windows notice): it is routine and the session's done list stays.
export async function autoCleanup(o: Overview): Promise<void> {
  const settings = getSettings()
  const now = Date.now()
  const due = o.sessions.filter(s => isAutoStopDue(s, isRemoteSession(s.sessionId), settings.cleanup, now) && now - (lastAsked.get(s.sessionId) ?? 0) >= RECHECK_MS)
  if (due.length === 0 || cleaning) return
  cleaning = true
  try {
    const c = await liveChecks(true)
    if (!c.ok) { log('CLEANUP skipped: claude agents or the process list failed'); return }
    const ko = settings.language === 'ko'
    for (const s of due) {
      lastAsked.set(s.sessionId, now)
      // the automatic cleanup also leaves a session waiting for an answer or with an attach window open
      const check = checkOf(s, c)
      if (check.block !== undefined || check.warns.length > 0) continue
      const idleMin = Math.round((now - (idleSince(s) ?? now)) / 60_000)
      const ran = await runClaude(['stop', s.shortId], undefined)
      log(`CLEANUP ${s.shortId} idle ${idleMin}m, stop exit ${ran.code}`)
      if (ran.code !== 0) continue
      notice(ko
        ? `자동 정리: ${s.label} · ${s.shortId} 을 껐습니다(남은 예약 없이 ${idleMin}분 쉼). 완료 기록은 그대로 있고 세션 열기로 다시 열 수 있습니다.`
        : `Cleanup: stopped ${s.label} · ${s.shortId} (no job left, idle ${idleMin} min). Its done list stays; Open session reopens it.`, 'info', false)
    }
  } finally {
    cleaning = false
  }
}

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { shell } from 'electron'

import { permissionArgs, resumedCopyIn } from '@shared/revive'
import type { RemoteView, SessionView } from '@shared/schedule'
import type { AppSettings } from '@shared/types'

import { isRequestDone, markRequestDone, sessionState } from './appState'
import { clearInboxes, postInbox } from './inbox'
import { log } from './log'
import { paths } from './paths'
import { readRemoteState, writeRemoteState } from './remoteState'
import { notice, readFile, runClaude } from './revive'
import { buildOverview, liveSessions } from './schedule'
import { getSettings } from './settings'
import { wakeSession } from './wake'

// The remote jobs session (원격 예약 작업 세션): a background session in <config>/clock-out/remote started with
// --remote-control, so the person reaches it from the Claude mobile app or claude.ai/code. Measured 2026-10-19:
//   - `claude --bg --remote-control "<name>"` connects without a terminal; the address is the live record's bridgeSessionId
//   - later `claude --bg --resume <id>` without flags reconnects to the same address (flags again would start a copy)
// It also carries out what the plugin's tools ask for (<config>/clock-out/requests/<sessionId>.<id>.json, oldest first):
//   wake        wake a stopped session, the forwarded instruction as its first message
//   openRemote  stop a session that never ran in the background and start it again under Remote Control
// and leaves the outcome in the remote jobs session's inbox (<config>/clock-out/inbox/<id>/), which its plugin submits.

const TICK_MS = 15_000
const RETRY_MS = 2 * 60_000            // a failed start is not retried sooner
const STOP_WAIT_MS = 15_000            // a stopped session leaves the live records within this
const BRIDGE_WAIT_MS = 20_000          // a started session gets its Remote Control address within this
const REQUEST_MAX_AGE_MS = 24 * 3_600_000
const HALF_WRITTEN_MS = 30_000         // an unreadable request newer than this may still be being written: read it next time
const GUIDE_VERSION = 1

const NAME = { ko: '원격 예약 작업', en: 'Remote jobs' }
const INTRO = {
  ko: 'clock-out 이 원격 예약 작업 세션을 시작했습니다. CLAUDE.md 의 역할을 따르세요. mcp__clock-out__status 로 현황을 한 번 확인하고 한 줄로 요약한 뒤 대기하세요.',
  en: 'clock-out started the remote jobs session. Follow the role in CLAUDE.md. Check mcp__clock-out__status once, sum it up in one line, then wait.',
}
const WAKE = { ko: 'clock-out 이 이 세션을 다시 켰습니다. 대기하세요.', en: 'clock-out restarted this session. Wait.' }
// a forwarded instruction wakes a stopped session: its jobs come back with --resume, but it should look first
const ORDER_TAIL = {
  ko: '\n\n(clock-out: 이 지시를 처리하려고 꺼져 있던 세션을 깨웠습니다. 먼저 CronList 로 예약이 살아 있는지 확인하세요.)',
  en: '\n\n(clock-out woke this stopped session for this instruction. Check your jobs with CronList first.)',
}

let lastStartAt = 0
let lastError: string | undefined
let openWhenReady = false            // the monitor button was pressed before the session had its address
let kick: (() => void) | undefined   // runs a tick now

const notifyText = (n: AppSettings['remote']['notify'], lang: AppSettings['language']) =>
  lang === 'ko' ? { off: '끔', failures: '실패만', all: '모든 실행' }[n] : { off: 'off', failures: 'failures only', all: 'every run' }[n]

function guideText(settings: AppSettings): string {
  const notify = notifyText(settings.remote.notify, settings.language)
  if (settings.language === 'en') {
    return `<!-- clock-out remote guide v${GUIDE_VERSION}: written by the clock-out app, changes are overwritten -->
# Remote jobs session (clock-out)

The clock-out app started this session. The user talks to it from the Claude mobile app or claude.ai/code.

## What to do
- Asked about the jobs: call \`mcp__clock-out__status\` and answer per session, briefly; running and failed first.
- Instructions about a job (move its time, run it again, change what it does): forward them with \`mcp__clock-out__send\` to the session that owns the job. Do not CronCreate / CronDelete here instead: jobs stay in their own session.
- When the target is unclear, show the status and let the user pick.
- To talk to that session directly, use \`mcp__clock-out__open_remote\`. When it answers that a job is running, show that text to the user as it is and let them choose.
- Do not edit files of other projects yourself; the session that owns the job does the work.

## Incoming messages
- Starting with \`[clock-out 응답]\`: that session's answer to a forwarded instruction. Sum it up for the user.
- Starting with \`[clock-out]\`: a finished job or something the app did. Send it with PushNotification as one line, then answer in one short line.

Notices: ${notify} (changed in the clock-out app).
`
  }
  return `<!-- clock-out remote guide v${GUIDE_VERSION}: clock-out 앱이 쓰는 파일이라 고쳐도 덮어씁니다 -->
# 원격 예약 작업 세션 (clock-out)

이 세션은 clock-out 앱이 띄운 "원격 예약 작업 세션"입니다. 사용자는 휴대폰 Claude 앱이나 claude.ai/code 에서 이 세션과 대화합니다.

## 할 일
- 예약 현황을 물으면 \`mcp__clock-out__status\` 를 부르고 세션별로 짧게 답합니다. 실행 중·실패를 먼저 말합니다.
- 예약 시각 변경, 다시 실행, 작업 내용 수정 같은 지시는 \`mcp__clock-out__send\` 로 그 예약이 있는 세션에 전달합니다. 이 세션에서 CronCreate·CronDelete 로 대신 걸지 않습니다. 예약은 원래 세션에 있어야 합니다.
- 대상 세션이 모호하면 status 결과를 보여 주고 사용자가 고르게 합니다.
- 사용자가 그 세션과 직접 대화하고 싶어 하면 \`mcp__clock-out__open_remote\` 를 씁니다. 예약이 실행 중이라는 안내가 오면 그 문장을 그대로 사용자에게 보여 주고 고르게 합니다.
- 다른 프로젝트 폴더의 파일을 직접 고치지 않습니다. 일은 예약이 있는 세션이 합니다.

## 들어오는 메시지
- \`[clock-out 응답]\` 으로 시작: 전달한 지시에 대한 그 세션의 답입니다. 사용자에게 요약해 보여 줍니다.
- \`[clock-out]\` 으로 시작: 예약 실행 결과나 앱이 한 일입니다. PushNotification 으로 한 줄 그대로 보내고, 답은 한 줄로 짧게 합니다.

알림: ${notify} (clock-out 앱 설정에서 바꿉니다).
`
}

function writeGuide(settings: AppSettings): void {
  mkdirSync(paths.remoteDir, { recursive: true })
  const path = join(paths.remoteDir, 'CLAUDE.md')
  const text = guideText(settings)
  try { if (readFileSync(path, 'utf8') === text) return } catch { /* not written yet */ }
  writeFileSync(path, text, 'utf8')
}

// the remote jobs session's permission: the app's work mode (acceptEdits + allowed tools) plus the plugin's own tools
function remotePermission(settings: AppSettings): AppSettings['permission'] {
  return { mode: settings.remote.permission, allowedTools: [...settings.permission.allowedTools, 'mcp__clock-out'], disallowedTools: settings.permission.disallowedTools }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor<T>(probe: () => T | undefined, ms: number): Promise<T | undefined> {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(1_000)) {
    const v = probe()
    if (v !== undefined) return v
  }
  return probe()
}

export function remoteView(): RemoteView {
  const settings = getSettings()
  const state = readRemoteState()
  const rec = state.sessionId !== undefined ? liveSessions().get(state.sessionId) : undefined
  return {
    enabled: settings.remote.enabled,
    isAlive: rec !== undefined,
    sessionId: state.sessionId,
    url: rec?.bridge !== undefined ? `https://claude.ai/code/${rec.bridge}` : undefined,
    error: settings.remote.enabled ? lastError : undefined,
  }
}

// Starts the remote jobs session, or wakes it again (same id, no flags: it keeps --remote-control)
async function ensureRemote(): Promise<void> {
  const settings = getSettings()
  if (!settings.remote.enabled) return
  writeGuide(settings)
  const state = readRemoteState()
  if (state.sessionId !== undefined && liveSessions().has(state.sessionId)) { lastError = undefined; return }
  if (Date.now() - lastStartAt < RETRY_MS) return
  lastStartAt = Date.now()

  if (state.sessionId !== undefined) {
    const sessionId = state.sessionId
    const ran = await runClaude(['--bg', '--resume', sessionId, WAKE[settings.language]], paths.remoteDir)
    const copy = ran.code === 0 ? resumedCopyIn(ran.output, sessionId) : undefined
    if (ran.code === 0 && copy === undefined) { log(`REMOTE woke ${sessionId.slice(0, 8)}`); lastError = undefined; return }
    if (copy !== undefined) {
      // a resume can come up as a copy with another id (seen 2026-10-20) and was left running; remove the copy first
      const stopped = await runClaude(['stop', copy], undefined)
      const removed = await runClaude(['rm', copy], undefined)
      log(`REMOTE resume of ${sessionId.slice(0, 8)} started copy ${copy}: stop exit ${stopped.code}, rm exit ${removed.code}`)
      // that time the session itself was running again a few seconds later: keep it instead of starting a new one
      if ((await waitFor(() => (liveSessions().has(sessionId) ? true : undefined), 10_000)) === true) { log(`REMOTE woke ${sessionId.slice(0, 8)} (after the copy)`); lastError = undefined; return }
    }
    log(`REMOTE resume failed (exit ${ran.code}${copy !== undefined ? `, copy ${copy}` : ''}) ${ran.output.trim().slice(0, 400)} — starting a new one`)
  }
  const args = ['--bg', ...permissionArgs(remotePermission(settings)), '--remote-control', NAME[settings.language], INTRO[settings.language]]
  const ran = await runClaude(args, paths.remoteDir)
  const short = /backgrounded · ([0-9a-f]{8})/.exec(ran.output)?.[1]
  if (ran.code !== 0 || short === undefined) {
    lastError = `start failed (exit ${ran.code}): ${ran.output.trim().slice(0, 160)}`
    notice(`remote jobs session: ${lastError}`, 'warn')
    return
  }
  const sessionId = await waitFor(() => [...liveSessions().keys()].find(id => id.startsWith(short)), 10_000)
  if (sessionId === undefined) { lastError = `started ${short} but it is not in the live records`; return }
  writeRemoteState({ sessionId, startedAt: Date.now() })
  lastError = undefined
  log(`REMOTE started ${short}`)
}

export async function stopRemote(): Promise<void> {
  const state = readRemoteState()
  if (state.sessionId === undefined || !liveSessions().has(state.sessionId)) return
  const ran = await runClaude(['stop', state.sessionId.slice(0, 8)], undefined)
  log(`REMOTE stop ${state.sessionId.slice(0, 8)} exit ${ran.code}`)
}

// id: a uuid from 0.13 plugins (hooks/remote.ts writeRequest); an older request goes by its file name
export type RemoteRequest = { id?: string; kind: 'wake' | 'openRemote'; sessionId: string; message?: string; when?: 'afterRun' | 'now'; requestedAt: number }

// The outcome of a request, as a message in the remote jobs session's inbox (hooks/remote.ts deliverInbox)
function writeResult(_sessionId: string, ok: boolean, text: string): void {
  notice(text, ok ? 'info' : 'warn')
  const remote = readRemoteState().sessionId
  if (remote === undefined) return
  postInbox(remote, `[clock-out] ${ok ? '✓' : '✗'} ${text}`, 'app')
}

// Stops a running session: a background one with `claude stop`, a terminal one by ending its process
async function stopSession(s: SessionView): Promise<boolean> {
  const rec = liveSessions().get(s.sessionId)
  if (rec === undefined) return true
  if (rec.kind === 'bg' || rec.kind === 'background') await runClaude(['stop', s.shortId], undefined)
  else { try { process.kill(rec.pid) } catch { /* already gone */ } }
  return (await waitFor(() => (liveSessions().has(s.sessionId) ? undefined : true), STOP_WAIT_MS)) === true
}

async function handle(req: RemoteRequest, lang: AppSettings['language']): Promise<'done' | 'wait'> {
  const view = buildOverview().sessions.find(s => s.sessionId === req.sessionId)
  const name = view !== undefined ? `${view.label} · ${view.shortId}` : req.sessionId.slice(0, 8)
  if (view === undefined) { writeResult(req.sessionId, false, `${name}: 예약이 있는 세션 목록에 없습니다`); return 'done' }

  if (req.kind === 'wake') {
    if (view.isAlive) { writeResult(req.sessionId, false, `${name} 은 이미 켜져 있습니다. send 로 다시 보내세요.`); return 'done' }
    const r = await wakeSession(view, 'remote request', { message: req.message !== undefined ? req.message + ORDER_TAIL[lang] : undefined })
    writeResult(req.sessionId, r.ok, r.ok ? `${name} 을 깨웠습니다${req.message !== undefined ? '. 지시를 처리하고 [clock-out 응답] 으로 답합니다' : ''}.` : `${name} 을 깨우지 못했습니다: ${r.message}`)
    return 'done'
  }

  // openRemote: only a session that never ran in the background can get --remote-control (else a copy starts)
  const file = readFile(req.sessionId)
  if (file?.running !== undefined && req.when === 'afterRun') return 'wait'
  const app = sessionState(req.sessionId)
  if ((file?.bgSince ?? app.bgSince) !== undefined && (file?.remoteSince ?? app.remoteSince) === undefined) {
    writeResult(req.sessionId, false, `${name} 은 원격 없이 백그라운드로 실행된 적이 있어 원격을 붙일 수 없습니다. send 로 지시를 전달하세요.`)
    return 'done'
  }
  if (view.isAlive && !(await stopSession(view))) { writeResult(req.sessionId, false, `${name} 을 멈추지 못해 원격으로 열지 못했습니다.`); return 'done' }
  const r = await wakeSession({ ...view, isAlive: false }, 'open under Remote Control', { forceRemote: true })
  if (!r.ok) { writeResult(req.sessionId, false, `${name} 을 원격으로 열지 못했습니다: ${r.message}`); return 'done' }
  const bridge = await waitFor(() => liveSessions().get(req.sessionId)?.bridge, BRIDGE_WAIT_MS)
  writeResult(req.sessionId, true, bridge !== undefined
    ? `${name} 을 원격으로 열었습니다: https://claude.ai/code/${bridge}`
    : `${name} 을 원격으로 열었습니다. Claude 앱 세션 목록에서 "clock-out · ${view.label}" 을 찾으세요.`)
  return 'done'
}

const remove = (path: string) => { try { unlinkSync(path) } catch { /* gone */ } }

// The request files to carry out now, oldest requestedAt first. Skipped: files being written (*.tmp, or unreadable and
// newer than 30 s); removed: unreadable older ones, requests older than a day, and an id carried out before
export function pendingRequests(now = Date.now()): { path: string; id: string; req: RemoteRequest }[] {
  let names: string[] = []
  try { names = readdirSync(paths.requestsDir) } catch { return [] }
  const out: { path: string; id: string; req: RemoteRequest }[] = []
  for (const name of names) {
    const path = join(paths.requestsDir, name)
    if (name.endsWith('.result.json')) { remove(path); continue }   // 0.7.0–0.7.2 results
    if (!name.endsWith('.json')) continue
    let req: RemoteRequest | undefined
    try { req = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as RemoteRequest } catch { req = undefined }
    if (req === undefined || typeof req.sessionId !== 'string' || typeof req.requestedAt !== 'number') {
      let age = Infinity
      try { age = now - statSync(path).mtimeMs } catch { /* gone */ }
      if (age > HALF_WRITTEN_MS) remove(path)
      continue
    }
    if (now - req.requestedAt > REQUEST_MAX_AGE_MS) { remove(path); continue }
    out.push({ path, id: typeof req.id === 'string' && req.id !== '' ? req.id : name, req })
  }
  return out.sort((a, b) => a.req.requestedAt - b.req.requestedAt)
}

let busy = false
async function processRequests(): Promise<void> {
  const lang = getSettings().language
  for (const { path, id, req } of pendingRequests()) {
    // the same id again (a second copy of one request, or a file left by a failed delete): carried out once only
    if (isRequestDone(id)) { log(`REMOTE request ${id} was already carried out`); remove(path); continue }
    log(`REMOTE request ${req.kind} ${req.sessionId.slice(0, 8)}${req.when !== undefined ? ` (${req.when})` : ''}`)
    try {
      const outcome = await handle(req, lang)
      if (outcome === 'wait') continue
      markRequestDone(id)
      remove(path)
    } catch (err) {
      log(`REMOTE request failed ${String(err)}`)
      remove(path)
      markRequestDone(id)
      writeResult(req.sessionId, false, `요청을 처리하지 못했습니다: ${String(err).slice(0, 120)}`)
    }
  }
}

// The "monitor jobs remotely" button (jobs panel, status bar): the setting is already on (index.ts turns it on);
// open the remote jobs session's address now, or as soon as it has one
export function openMonitor(): string {
  const lang = getSettings().language
  const url = remoteView().url
  if (url !== undefined) { void shell.openExternal(url); return lang === 'ko' ? '원격 예약 작업 세션을 열었습니다. 휴대폰 Claude 앱 세션 목록에도 있습니다.' : 'Opened the remote jobs session; it is in the Claude mobile app too.' }
  openWhenReady = true
  lastStartAt = 0
  kick?.()
  return lang === 'ko' ? '원격 예약 작업 세션을 시작합니다. 준비되면(30초 안팎) 브라우저로 열고, 휴대폰 Claude 앱 세션 목록에도 나타납니다.' : 'Starting the remote jobs session; it opens in the browser when ready (about 30 s) and shows in the Claude mobile app.'
}

export function startRemote(): () => void {
  mkdirSync(paths.requestsDir, { recursive: true })
  const tick = () => {
    if (busy) return
    busy = true
    void (async () => {
      try {
        await ensureRemote()
        const url = openWhenReady ? remoteView().url : undefined
        if (url !== undefined) { openWhenReady = false; void shell.openExternal(url) }
        await processRequests()
        clearInboxes()
      } catch (err) { log(`REMOTE tick error ${String(err)}`) } finally { busy = false }
    })()
  }
  kick = tick
  const id = setInterval(tick, TICK_MS)
  setTimeout(tick, 3_000)
  return () => clearInterval(id)
}

// Settings changed: turned on → start at once; turned off → stop the session; notify changed → rewrite the guide
export function onRemoteSettings(before: AppSettings, after: AppSettings): void {
  if (after.remote.enabled && !before.remote.enabled) { lastStartAt = 0; lastError = undefined }
  if (!after.remote.enabled && before.remote.enabled) void stopRemote()
  // the permission is fixed at the first start: a new one means a new remote jobs session
  if (after.remote.permission !== before.remote.permission) void stopRemote().then(() => { writeRemoteState({}); lastStartAt = 0 })
  if (after.remote.enabled && (after.remote.notify !== before.remote.notify || after.language !== before.language)) writeGuide(after)
  if (existsSync(paths.remoteDir) || after.remote.enabled) log(`REMOTE settings enabled=${after.remote.enabled} notify=${after.remote.notify}`)
}

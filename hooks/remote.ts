import type { EngineInterface, On } from 'claude-code'

import { readAppSettings } from './appSettings'
import { backgroundOf } from './appState'
import { buildOverview, fmtTime, labelOf } from './overview'
import { clockOutPaths } from './paths'
import { findSessionId } from './revive'
import { DELIVERED_KEPT, taskOutcomeOf } from './schema'
import type { TaskOutcome } from './schema'
import { readSessionFile, touchStamp, updateOwnSession } from './sessionFile'

// The remote jobs session (원격 예약 작업 세션): one session the desktop app starts in <config>/clock-out/remote with
// `claude --bg --remote-control`, so the person reaches it from the Claude mobile app. Only that session gets the
// three tools below. Sessions pass messages through inbox files, <config>/clock-out/inbox/<sessionId>/*.json: each
// session's plugin reads its own inbox every 15 s and submits what it finds as its own prompt. ($.session.send is held
// by Claude Code when the two sessions run in different permission modes, and a background session cannot approve it:
// measured 2026-10-19.) A session with a scheduled job running waits until the job ends.
//   - an instruction forwarded to a job's session starts with ORDER_MARK; that session's answer goes back with REPLY_MARK
//   - a finished scheduled job is reported with NOTICE_MARK, as the app's notify setting says (off / failures / all)
//   - the app's results (woke a session, opened one under Remote Control) arrive the same way, with NOTICE_MARK
// Long-running work (waking a stopped session, reopening one under Remote Control) is the app's: the tools leave a
// request file in <config>/clock-out/requests/ and the app carries it out (a plugin's process.run waits and times out).

export const ORDER_MARK = '[clock-out 원격 지시]'
export const REPLY_MARK = '[clock-out 응답]'
export const NOTICE_MARK = '[clock-out]'

const INBOX_POLL_MS = 15_000

export type RemoteState = { sessionId?: string }   // <config>/clock-out/remote.json, written by the app
// requests/<sessionId>.<id>.json, one file per request so a second request never overwrites the first
export type RemoteRequest = { id: string; kind: 'wake' | 'openRemote'; sessionId: string; message?: string; when?: 'afterRun' | 'now'; requestedAt: number }
// inbox/<sessionId>/<at>-<n>.json. deliveredAt is written only after prompt.submit returned.
export type InboxMessage = {
  id?: string                // uuid; a message without one goes by its file name
  text: string
  at: number
  from?: string
  submittingAt?: number      // prompt.submit started; left without deliveredAt (a crash) the message becomes unknown
  deliveredAt?: number
  attempts?: number          // failed submits so far
  lastError?: string
  nextTryAt?: number         // the next read before this leaves it (and the ones after it) waiting
  state?: 'failed' | 'unknown'   // gave up after MAX_ATTEMPTS | may or may not have been submitted: never resubmitted on its own
}

const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000]   // after the 1st, 2nd, 3rd and later failure
const MAX_ATTEMPTS = 5

const slashed = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

async function readJson<T>($: EngineInterface, path: string): Promise<T | undefined> {
  try {
    if (!(await $.fs.exists(path))) return undefined
    const text = await $.fs.read(path)
    return typeof text === 'string' ? JSON.parse(text.replace(/^﻿/, '')) as T : undefined
  } catch {
    return undefined
  }
}

export async function readRemoteState($: EngineInterface): Promise<RemoteState | undefined> {
  return readJson<RemoteState>($, `${(await clockOutPaths($)).root}/remote.json`)
}

let posted = 0   // makes inbox file names unique within one millisecond

// The forwarded instruction the current turn answers (runs.ts sends the answer back when the turn ends). Set here by
// the inbox: a prompt this plugin submits does not pass through this plugin's own prompt.submit hook.
let pendingOrder: string | undefined
export function noteOrder(text: string): void {
  if (text.trimStart().startsWith(ORDER_MARK)) pendingOrder = text.trimStart().slice(ORDER_MARK.length).replace(/\s+/g, ' ').trim().slice(0, 80)
}
export function takeOrder(): string | undefined {
  const order = pendingOrder
  pendingOrder = undefined
  return order
}

// Leaves a message in a session's inbox; that session submits it to itself when it next reads the inbox
export async function postToSession($: EngineInterface, sessionId: string, text: string): Promise<void> {
  const now = await $.clock.now()
  const message: InboxMessage = { id: crypto.randomUUID(), text, at: now, from: await $.session.id() }
  await $.fs.write(`${(await clockOutPaths($)).root}/inbox/${sessionId}/${now}-${posted++}.json`, JSON.stringify(message, null, 2))
}

// A line to the remote jobs session; false when there is none or it is this session
export async function sendToRemote($: EngineInterface, text: string): Promise<boolean> {
  const state = await readRemoteState($)
  if (state?.sessionId === undefined || state.sessionId === (await $.session.id())) return false
  await postToSession($, state.sessionId, text)
  return true
}

let delivering = false   // one inbox read at a time in this process (a submit can outlast the 15 s timer)

// Reads this session's inbox and submits each new message, oldest first. Not while a scheduled job of this session
// runs (an instruction then would cut into it): the messages wait for the next read.
export async function deliverInbox($: EngineInterface): Promise<number> {
  if (delivering) return 0
  delivering = true
  try {
    return await deliverInboxOnce($)
  } finally {
    delivering = false
  }
}

async function deliverInboxOnce($: EngineInterface): Promise<number> {
  const paths = await clockOutPaths($)
  const own = await $.session.id()
  const file = await readSessionFile($, `${paths.sessionsDir}/${own}.json`)
  if (file?.running !== undefined) return 0
  const seen = new Set(file?.deliveredIds ?? [])
  const dir = `${paths.root}/inbox/${own}`
  let entries: { name: string; kind: string }[] = []
  try { entries = await $.fs.list(dir) } catch { return 0 }
  let delivered = 0
  for (const name of entries.filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name).sort()) {
    const path = `${dir}/${name}`
    const message = await readJson<InboxMessage>($, path)
    if (message === undefined || message.deliveredAt !== undefined || message.state !== undefined) continue
    const id = message.id ?? name
    const now = await $.clock.now()
    // 1. an id already submitted here (the same message again): marked delivered, not submitted
    if (seen.has(id)) {
      await $.fs.write(path, JSON.stringify({ ...message, deliveredAt: now }, null, 2))
      continue
    }
    // 2. a submit started but never recorded its end (the session stopped): it may have entered, so never again
    if (message.submittingAt !== undefined) {
      await $.fs.write(path, JSON.stringify({ ...message, state: 'unknown' }, null, 2))
      continue
    }
    // 3. waiting for its retry: the ones after it wait too, to keep the order
    if (message.nextTryAt !== undefined && message.nextTryAt > now) break
    await $.fs.write(path, JSON.stringify({ ...message, submittingAt: now }, null, 2))
    const isOrder = message.text.trimStart().startsWith(ORDER_MARK)
    noteOrder(message.text)
    let error: string | undefined
    try {
      const answer = await $.prompt.submit({ text: message.text })
      if (answer.drop !== undefined) error = `dropped: ${answer.drop}`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    // 4. submit failed: attempts, error and next try (15 s → 60 s → 5 min), failed after the 5th
    if (error !== undefined) {
      if (isOrder) takeOrder()
      const attempts = (message.attempts ?? 0) + 1
      const retry = attempts >= MAX_ATTEMPTS
        ? { state: 'failed' as const }
        : { nextTryAt: now + (RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ?? 0) }
      const failed: InboxMessage = { ...message, attempts, lastError: error.slice(0, 300), ...retry }
      delete failed.submittingAt
      await $.fs.write(path, JSON.stringify(failed, null, 2))
      break
    }
    // 5. submitted: the id goes to the session file first, then deliveredAt (the app clears delivered ones)
    await updateOwnSession($, f => { f.deliveredIds = [...(f.deliveredIds ?? []).filter(x => x !== id), id].slice(-DELIVERED_KEPT) })
    seen.add(id)
    await $.fs.write(path, JSON.stringify({ ...message, submittingAt: now, deliveredAt: await $.clock.now() }, null, 2))
    delivered++
  }
  return delivered
}

// Called at session.start in every session
export function startInbox($: EngineInterface): void {
  $.clock.every(INBOX_POLL_MS, () => { void deliverInbox($).catch(() => undefined) })
}

async function writeRequest($: EngineInterface, fields: Omit<RemoteRequest, 'id'>): Promise<void> {
  const paths = await clockOutPaths($)
  const request: RemoteRequest = { id: crypto.randomUUID(), ...fields }
  await $.fs.write(`${paths.root}/requests/${request.sessionId}.${request.id}.json`, JSON.stringify(request, null, 2))
  await touchStamp($)
}

// Claude Code's live records: session id → the Remote Control address (bridgeSessionId) while that session runs
async function bridgeIds($: EngineInterface): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const dir = (await clockOutPaths($)).liveSessionsDir
  try {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      const rec = await readJson<{ sessionId?: string; bridgeSessionId?: string }>($, `${dir}/${entry.name}`)
      if (rec?.sessionId !== undefined && rec.bridgeSessionId !== undefined) out.set(rec.sessionId, rec.bridgeSessionId)
    }
  } catch {
    // no dir
  }
  return out
}

const remoteUrl = (bridge: string) => `https://claude.ai/code/${bridge}`
const durText = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`)
// an answer is not proof the work succeeded, so no ✓: only failed turns get a mark
const outcomeOf = (run: { reason: string; taskOutcome?: TaskOutcome }): TaskOutcome => run.taskOutcome ?? taskOutcomeOf(run.reason)
const runMark = (run: { reason: string; taskOutcome?: TaskOutcome }) => (outcomeOf(run) === 'failed' ? '✗' : '응답 완료 · 성공 미검증')

// The list the desktop app shows (<config>/clock-out/overview.json, rewritten every 30 s while it runs). It also has
// sessions found only in transcripts (started before the plugin), which this plugin cannot see on its own; without a
// fresh file the plugin's own list is used.
const APP_OVERVIEW_FRESH_MS = 3 * 60_000
type AppJob = { id: string; humanSchedule: string; prompt: string; title?: string; nextAt?: number; isDismissed: boolean; lastRun?: { finishedAt: number; reason: string; taskOutcome?: TaskOutcome; durationMs: number; answerHead?: string } }
type AppSession = { sessionId: string; shortId: string; label: string; isAlive: boolean; source?: 'plugin' | 'transcript'; running?: { promptHead: string; firedAt: number }; remoteUrl?: string; remoteSince?: number; jobs: AppJob[] }
type ListedSessions = { sessions: AppSession[]; jobCount: number; fromApp: boolean }

async function listedSessions($: EngineInterface): Promise<ListedSessions> {
  const now = await $.clock.now()
  const fromApp = await readJson<{ builtAt?: number; sessions?: AppSession[]; jobCount?: number }>($, `${(await clockOutPaths($)).root}/overview.json`)
  if (fromApp?.sessions !== undefined && fromApp.builtAt !== undefined && now - fromApp.builtAt < APP_OVERVIEW_FRESH_MS) {
    return { sessions: fromApp.sessions, jobCount: fromApp.jobCount ?? 0, fromApp: true }
  }
  const own = await buildOverview($)
  const paths = await clockOutPaths($)
  const bridges = await bridgeIds($)
  const sessions: AppSession[] = []
  for (const s of own.sessions) {
    const file = await readSessionFile($, `${paths.sessionsDir}/${s.sessionId}.json`)
    const bridge = bridges.get(s.sessionId)
    const { remoteSince } = await backgroundOf($, s.sessionId, file)
    sessions.push({ ...s, source: 'plugin', running: file?.running, remoteSince, remoteUrl: bridge !== undefined ? remoteUrl(bridge) : undefined })
  }
  return { sessions, jobCount: own.jobCount, fromApp: false }
}

// 1. status: every session with jobs, what runs now, the last result of each job, and the phone address if any
export async function statusText($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const listed = await listedSessions($)
  if (listed.sessions.length === 0) return '예약이 걸린 세션이 없습니다.'
  const lines: string[] = [`세션 ${listed.sessions.length}개, 예약 ${listed.jobCount}건(숨김 제외)${listed.fromApp ? ' — clock-out 앱 목록과 같음' : ' — 앱이 꺼져 있어 플러그인 기록만 봄(대화 기록으로만 찾은 세션은 빠짐)'}`]
  for (const s of listed.sessions) {
    const where = s.remoteUrl !== undefined ? ` · 휴대폰 ${s.remoteUrl}` : s.remoteSince !== undefined ? ' · 원격 가능(깨우면 붙음)' : ''
    lines.push(`■ ${s.label} · ${s.shortId} — ${s.isAlive ? '켜짐' : '꺼짐'}${s.source === 'transcript' ? ' · 대화 기록에서 읽음' : ''}${where}`)
    if (s.running !== undefined) lines.push(`  ▶ 실행 중 (${fmtTime(s.running.firedAt, now)}부터): ${s.running.promptHead.slice(0, 80)}`)
    for (const j of s.jobs) {
      const last = j.lastRun === undefined ? '아직 실행 없음'
        : `마지막 ${runMark(j.lastRun)} ${fmtTime(j.lastRun.finishedAt, now)} (${durText(j.lastRun.durationMs)})${j.lastRun.answerHead ? ` "${j.lastRun.answerHead.slice(0, 80)}"` : ''}`
      lines.push(`  - [${j.id}] ${j.humanSchedule} · 다음 ${fmtTime(j.nextAt, now)} · ${last}${j.isDismissed ? ' · 숨김' : ''}`)
      lines.push(`    ${j.title !== undefined ? `${j.title} — ` : ''}${j.prompt.replace(/\s+/g, ' ').slice(0, 100)}`)
    }
  }
  return lines.join('\n')
}

type Target = { sessionId: string; label: string; short: string; isAlive: boolean }
async function resolveTarget($: EngineInterface, session: string): Promise<Target | string> {
  const own = await $.session.id()
  const wanted = session.trim()
  const hits = (await listedSessions($)).sessions.filter(s => s.sessionId.startsWith(wanted))
  const hit = hits.length === 1 ? hits[0] : undefined
  const id = hit?.sessionId ?? (await findSessionId($, wanted))
  if (id === undefined) return `"${session}" 에 맞는 세션을 하나로 찾지 못했습니다. status 의 세션 id 앞 8자리를 쓰세요.`
  if (id === own) return '이 세션(원격 예약 작업 세션) 자신입니다.'
  const view = hit ?? (await buildOverview($)).sessions.find(s => s.sessionId === id)
  return { sessionId: id, label: view?.label ?? id.slice(0, 8), short: id.slice(0, 8), isAlive: view?.isAlive === true }
}

// 2. send: an instruction to the session that owns the job; it answers back with REPLY_MARK
export async function sendOrder($: EngineInterface, session: string, text: string): Promise<string> {
  const target = await resolveTarget($, session)
  if (typeof target === 'string') return target
  const order = `${ORDER_MARK} ${text.trim()}`
  const file = await readSessionFile($, `${(await clockOutPaths($)).sessionsDir}/${target.sessionId}.json`)
  if (target.isAlive && file !== undefined) {
    // a session with the plugin reads its inbox within 15 s (after its running job, if any)
    await postToSession($, target.sessionId, order)
    const busy = file.running !== undefined ? ' 지금 예약 작업이 실행 중이라 그 작업이 끝난 뒤에 받습니다.' : ''
    return `${target.label} · ${target.short} 에 지시를 남겼습니다(15초 안에 받음).${busy} 답은 "${REPLY_MARK}" 로 이 대화에 들어옵니다.`
  }
  if (target.isAlive) {
    // no plugin there (found only in its transcript): only Claude Code's own cross-session message reaches it, and that
    // is held when the permission modes differ (a terminal session asks its person; a background one cannot)
    const sent = await $.session.send({ to: { sessionId: target.sessionId }, text: order })
    if (!sent.isDelivered) return `${target.label} · ${target.short} 에 전달하지 못했습니다: ${sent.reason ?? '이유 모름'}`
    return `${target.label} · ${target.short} 은 플러그인 없이 시작된 세션이라 세션 간 메시지로 보냈습니다. 두 세션의 권한 모드가 다르면 그 세션에서 승인해야 받거나, 승인할 사람이 없으면 버려집니다. 답이 오지 않으면 그 세션을 원격으로 붙여(open_remote) 직접 말하세요.`
  }
  await writeRequest($, { kind: 'wake', sessionId: target.sessionId, message: order, requestedAt: await $.clock.now() })
  return `${target.label} · ${target.short} 은 꺼져 있어 clock-out 앱이 깨워서 지시를 넣습니다(30초 안팎). 답은 "${REPLY_MARK}" 로 이 대화에 들어옵니다.`
}

// 3. open_remote: the session itself on the phone. Which way depends on how it ran before (measured 2026-10-19):
//    never in the background → stop it and start `--bg --resume --remote-control`; already with Remote Control →
//    it is on the phone whenever it runs; in the background without it → Remote Control cannot be added (a copy).
export async function openRemote($: EngineInterface, session: string, when: 'afterRun' | 'now' | undefined): Promise<string> {
  const target = await resolveTarget($, session)
  if (typeof target === 'string') return target
  const file = await readSessionFile($, `${(await clockOutPaths($)).sessionsDir}/${target.sessionId}.json`)
  const name = `${target.label} · ${target.short}`
  const background = await backgroundOf($, target.sessionId, file)
  if (background.remoteSince !== undefined) {
    const bridge = (await bridgeIds($)).get(target.sessionId)
    if (bridge !== undefined) return `${name} 은 이미 원격으로 열려 있습니다: ${remoteUrl(bridge)} (Claude 앱 세션 목록에도 있습니다)`
    await writeRequest($, { kind: 'wake', sessionId: target.sessionId, requestedAt: await $.clock.now() })
    return `${name} 은 꺼져 있어 깨웁니다. 깨어나면 같은 원격 주소로 Claude 앱에 나타납니다.`
  }
  if (background.bgSince !== undefined) {
    return `${name} 은 원격 없이 백그라운드로 실행된 적이 있어 원격을 붙일 수 없습니다(옵션을 다시 주면 복사본이 생깁니다). send 도구로 지시를 전달하세요.`
  }
  if (file?.running !== undefined && when === undefined) {
    return `${name} 에서 예약 작업이 실행 중입니다("${file.running.promptHead.slice(0, 60)}"). 지금 열면 작업이 취소되거나 중복 실행될 가능성이 있습니다. ` +
      '현재 작업 중인 내용을 중지하고 원격을 사용하시겠습니까? 사용자에게 물어서, 끝난 뒤 열려면 when="afterRun", 지금 중지하고 열려면 when="now" 로 다시 부르세요.'
  }
  await writeRequest($, { kind: 'openRemote', sessionId: target.sessionId, when: file?.running !== undefined ? when : 'now', requestedAt: await $.clock.now() })
  return when === 'afterRun' && file?.running !== undefined
    ? `${name} 의 예약 작업이 끝나면 원격으로 엽니다. 열리면 "${NOTICE_MARK}" 메시지로 알려 드립니다.`
    : `${name} 을(를) 원격으로 엽니다${target.isAlive ? '(지금 떠 있는 창은 닫힙니다)' : ''}. 열리면 "${NOTICE_MARK}" 메시지로 알려 드립니다.`
}

const TOOLS = {
  status: {
    name: 'status',
    description: 'clock-out: 모든 세션의 예약 현황 — 켜짐/꺼짐, 지금 실행 중인 예약, 예약마다 다음 실행과 마지막 결과(✓/✗, 소요, 답 앞부분), 휴대폰 원격 주소.',
    inputSchema: { type: 'object', properties: {} },
  },
  send: {
    name: 'send',
    description: 'clock-out: 예약이 걸린 세션에 지시를 전달한다(예: 예약 시각 변경, 다시 실행, 작업 내용 수정). 그 세션이 처리하고 "[clock-out 응답]" 으로 답한다. 꺼진 세션은 앱이 깨워서 전달한다.',
    inputSchema: { type: 'object', properties: { session: { type: 'string', description: '세션 id 앞 8자리(status 참고)' }, text: { type: 'string', description: '그 세션에 보낼 지시' } }, required: ['session', 'text'] },
  },
  open_remote: {
    name: 'open_remote',
    description: 'clock-out: 그 세션을 휴대폰에서 직접 대화할 수 있게 원격으로 연다. 예약이 실행 중이면 먼저 안내문을 돌려주니 사용자에게 묻고 when 을 정해 다시 부른다.',
    inputSchema: { type: 'object', properties: { session: { type: 'string' }, when: { type: 'string', enum: ['afterRun', 'now'] } }, required: ['session'] },
  },
} as const

// Called at session.start: only the session started in <config>/clock-out/remote gets the tools
export async function startRemoteTools($: EngineInterface, cwd: string): Promise<void> {
  const paths = await clockOutPaths($)
  if (slashed(cwd) !== slashed(`${paths.root}/remote`)) return
  for (const spec of Object.values(TOOLS)) await $.tool.register({ ...spec, inputSchema: spec.inputSchema as Record<string, unknown>, isDeferred: false })
}

export function registerRemote(on: On): void {
  // one hook for the three tools (the matcher takes built-in names or a pattern)
  on('tool.call', { tool: /^mcp__clock-out__(status|send|open_remote)$/ }, async ($, e) => {
    const input = e as unknown as { tool: string; session?: string; text?: string; when?: string }
    if (input.tool.endsWith('__status')) return { result: await statusText($) }
    if (input.tool.endsWith('__send')) return { result: await sendOrder($, String(input.session ?? ''), String(input.text ?? '')) }
    const when = input.when === 'afterRun' || input.when === 'now' ? input.when : undefined
    return { result: await openRemote($, String(input.session ?? ''), when) }
  }).catch((_$, e, next) => next(e))
}

// For runs.ts: the line for a finished scheduled job, when the app's notify setting asks for it
export async function noticeOfRun($: EngineInterface, run: { reason: string; taskOutcome?: TaskOutcome; durationMs: number; promptHead: string; answerHead: string; finishedAt: number; title?: string }): Promise<string | undefined> {
  const settings = await readAppSettings($)
  const notify = settings?.remote?.enabled === true ? (settings.remote.notify ?? 'failures') : 'off'
  // 'failures' sends failed runs only; 'all' sends the unverified answers too
  if (notify === 'off' || (notify === 'failures' && outcomeOf(run) !== 'failed')) return undefined
  const label = labelOf(await $.session.cwd())
  const short = (await $.session.id()).slice(0, 8)
  return `${NOTICE_MARK} ${runMark(run)} ${fmtTime(run.finishedAt, run.finishedAt)} ${label} · ${short} · ${run.title ?? run.promptHead.slice(0, 50)} — ${run.reason} (${durText(run.durationMs)}): ${run.answerHead.slice(0, 80)}`
}

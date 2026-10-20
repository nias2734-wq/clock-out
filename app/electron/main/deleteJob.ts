import { describeCron } from '@shared/cronText'
import type { JobView, SessionView } from '@shared/schedule'

import { postInbox } from './inbox'
import { log } from './log'
import { readFile, runClaude } from './revive'
import { buildOverview, liveSessions } from './schedule'
import { getSettings } from './settings'
import { wakeSession } from './wake'

// Deleting a job from the jobs panel. A job lives only inside its session, so the session itself deletes it
// (CronDelete); the app only gets the instruction there, and waits until the job leaves the list:
//   running, with the plugin       → a message in its inbox (it submits it within 15 s, after a running job)
//   stopped                        → woken in the background with the instruction as its first message
//   running in the background, no plugin → stopped, then woken the same way (same id, its saved options)
//   running in a terminal, no plugin     → cannot be reached: the person types it there

const DELETE_WAIT_MS = 120_000
const STOP_WAIT_MS = 15_000

export type DeleteResult = { ok: boolean; text: string; canStop: boolean }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(probe: () => boolean, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(2_000)) if (probe()) return true
  return probe()
}

export function describeJob(j: JobView): string {
  const when = j.humanSchedule !== j.cron ? j.humanSchedule : describeCron(j.cron, getSettings().language)
  return `[${j.id}] ${when} · ${j.prompt.replace(/\s+/g, ' ').slice(0, 60)}`
}

function instruction(j: JobView, lang: 'ko' | 'en'): string {
  return lang === 'ko'
    ? `clock-out 앱에서 사용자가 이 세션의 예약 하나를 삭제해 달라고 했습니다: id ${j.id}, cron "${j.cron}", 내용 "${j.prompt.replace(/\s+/g, ' ').slice(0, 80)}". CronDelete 로 이 예약 하나만 지우고 결과를 한 줄로 답하세요. 다른 예약은 건드리지 마세요.`
    : `The user asked from the clock-out app to delete one job of this session: id ${j.id}, cron "${j.cron}", "${j.prompt.replace(/\s+/g, ' ').slice(0, 80)}". CronDelete only this job and answer in one line. Leave the other jobs alone.`
}

const stillListed = (sessionId: string, jobId: string) => buildOverview().sessions.find(s => s.sessionId === sessionId)?.jobs.some(j => j.id === jobId) === true

export async function deleteJob(sessionId: string, jobId: string): Promise<DeleteResult> {
  const lang = getSettings().language
  const ko = lang === 'ko'
  const view: SessionView | undefined = buildOverview().sessions.find(s => s.sessionId === sessionId)
  const job = view?.jobs.find(j => j.id === jobId)
  if (view === undefined || job === undefined) return { ok: false, text: ko ? '그 예약을 목록에서 찾지 못했습니다.' : 'That job is not in the list.', canStop: false }
  const what = describeJob(job)
  const message = instruction(job, lang)
  const hasPlugin = readFile(sessionId) !== undefined && view.source === 'plugin'
  log(`DELETE ${view.shortId} ${job.id} (${view.isAlive ? view.runsIn ?? 'running' : 'stopped'}, plugin ${hasPlugin})`)

  if (view.isAlive && hasPlugin) {
    postInbox(sessionId, message, 'del')
  } else if (view.isAlive && view.runsIn === 'terminal') {
    return {
      ok: false,
      text: ko ? `${view.label} · ${view.shortId} 은 터미널 창에서 플러그인 없이 실행 중이라 앱이 지시를 넣을 수 없습니다. 그 창에서 "예약 ${job.id} 삭제해줘" 라고 입력하세요. — ${what}`
        : `${view.label} · ${view.shortId} runs in a terminal without the plugin, so the app cannot reach it. Type "delete job ${job.id}" in that window. — ${what}`,
      canStop: false,
    }
  } else {
    if (view.isAlive) {
      // background without the plugin: stop, then wake with the instruction (no flags: same id, saved options)
      await runClaude(['stop', view.shortId], undefined)
      if (!(await until(() => !liveSessions().has(sessionId), STOP_WAIT_MS))) {
        return { ok: false, text: ko ? `${view.shortId} 을 멈추지 못해 삭제를 전달하지 못했습니다.` : `Could not stop ${view.shortId} to pass the deletion.`, canStop: false }
      }
    }
    const woke = await wakeSession({ ...view, isAlive: false }, 'delete a job', { message })
    if (!woke.ok) return { ok: false, text: ko ? `세션을 깨우지 못했습니다: ${woke.message}` : `Could not wake the session: ${woke.message}`, canStop: false }
  }

  const gone = await until(() => !stillListed(sessionId, jobId), DELETE_WAIT_MS)
  if (!gone) {
    return { ok: false, text: ko ? `2분 안에 삭제를 확인하지 못했습니다. 세션이 아직 처리 중일 수 있습니다(예약이 실행 중이면 끝난 뒤 처리). — ${what}` : `The deletion was not confirmed within 2 minutes; the session may still be on it. — ${what}`, canStop: false }
  }
  const runsIn = liveSessions().get(sessionId)?.kind
  return {
    ok: true,
    text: ko ? `예약을 삭제했습니다: ${what}` : `Deleted the job: ${what}`,
    canStop: runsIn === 'bg' || runsIn === 'background',
  }
}

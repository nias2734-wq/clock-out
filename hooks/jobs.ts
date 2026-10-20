import type { EngineInterface, On } from 'claude-code'

import { readAppSettings } from './appSettings'
import { touchStamp, updateOwnSession } from './sessionFile'
import { liveJobs, RUN_MODES, WEEK_MS } from './schema'
import { checkZone } from './zoneGuard'
import type { Job, RunMode } from './schema'

// job_mode: the model sets how the app shows a job when it fires (jobs[].mode). Every session gets it, unlike the
// remote jobs session's tools (status / send / open_remote in remote.ts).
export const JOB_MODE_TOOL = {
  name: 'job_mode',
  description: 'clock-out: 예약의 실행 방식을 정한다. CronCreate 로 예약을 만든 직후 호출해 실행 방식을 정한다. ' +
    '리마인더·사용자에게 질문하거나 결과를 직접 보여 줘야 하는 예약은 open(예약 시각에 그 세션을 터미널 창으로 띄움), ' +
    '사용자가 실행 사실만 알면 되는 것은 notify(백그라운드로 실행하고 시작·답 대기 때 데스크톱 알림), ' +
    '무인 작업은 호출하지 않아도 됨(앱 기본값). quiet(백그라운드로만 실행, 알림 없음)는 사용자가 원할 때 쓴다. ' +
    '정한 방식을 사용자에게 한 줄로 알리고, 사용자가 바꾸라고 하면 다시 호출.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'CronCreate 가 돌려준 예약 id' },
      mode: { type: 'string', enum: [...RUN_MODES] },
    },
    required: ['jobId', 'mode'],
  },
} as const

// Called at session.start in every session (the remote jobs session included)
export async function startJobModeTool($: EngineInterface): Promise<void> {
  await $.tool.register({ ...JOB_MODE_TOOL, inputSchema: JOB_MODE_TOOL.inputSchema as unknown as Record<string, unknown>, isDeferred: false })
}

const MODE_LABEL: Record<'ko' | 'en', Record<RunMode, string>> = {
  ko: { quiet: '조용히', notify: '알림', open: '화면에 열기' },
  en: { quiet: 'quiet', notify: 'notify', open: 'open on screen' },
}

async function language($: EngineInterface): Promise<'ko' | 'en'> {
  return (await readAppSettings($))?.language === 'en' ? 'en' : 'ko'
}

// Records the mode on this session's own job. Returns the sentence the model reads.
export async function setJobMode($: EngineInterface, jobId: string, mode: string): Promise<string> {
  const lang = await language($)
  if (!(RUN_MODES as readonly string[]).includes(mode)) {
    return lang === 'en' ? `clock-out: mode must be one of ${RUN_MODES.join(', ')}.` : `clock-out: mode 는 ${RUN_MODES.join(', ')} 중 하나여야 합니다.`
  }
  const wanted = mode as RunMode
  let found = false
  let live: string[] = []
  await updateOwnSession($, file => {
    const job = liveJobs(file).find(j => j.id === jobId.trim())
    live = liveJobs(file).map(j => j.id)
    if (job === undefined) return
    job.mode = wanted
    found = true
  })
  if (!found) {
    const ids = live.length > 0 ? live.join(', ') : (lang === 'en' ? 'none' : '없음')
    return lang === 'en'
      ? `clock-out: no live job "${jobId}" in this session (jobs here: ${ids}). Nothing recorded.`
      : `clock-out: 이 세션에 "${jobId}" 예약이 없습니다(이 세션의 예약: ${ids}). 기록하지 않았습니다.`
  }
  await touchStamp($)
  const label = MODE_LABEL[lang][wanted]
  return lang === 'en'
    ? `clock-out: job ${jobId} will run as "${label}" (${wanted}). Tell the user in one line; call again if they want another mode.`
    : `clock-out: 예약 ${jobId} 의 실행 방식을 "${label}"(${wanted}) 로 정했습니다. 사용자에게 한 줄로 알리고, 바꾸라고 하면 다시 부르세요.`
}

// The line added to a CronCreate result so the model remembers job_mode
async function modeHint($: EngineInterface, jobId: string): Promise<string> {
  const tool = `mcp__clock-out__${JOB_MODE_TOOL.name}`
  return (await language($)) === 'en'
    ? `clock-out: decide how this job (jobId "${jobId}") runs. A reminder, a question to the user or a result the user must see → call ${tool} with mode "open"; the user only needs to know it ran → "notify"; unattended work → no call needed (the app's default). Tell the user the chosen mode in one line.`
    : `clock-out: 이 예약(jobId "${jobId}")의 실행 방식을 정하세요. 리마인더·사용자에게 묻는 일·사용자가 결과를 직접 봐야 하는 예약이면 ${tool} 를 mode "open" 으로, 실행 사실만 알면 되면 "notify" 로 부르고, 무인 작업이면 부르지 않아도 됩니다(앱 기본값). 정한 방식을 사용자에게 한 줄로 알려 주세요.`
}

// Records what the model (or this plugin) does with CronCreate / CronDelete / CronList into the session file.
// The tool result is the source: CronCreate answers the job id and nextFireAt (the real next run, scheduler offset included).
export function registerJobs(on: On): void {
  on('tool.call', { tool: 'CronCreate' }, async ($, e, next) => {
    // 1. 근무일에 비워 둘 시간(예: 04:00 ~ 09:00)에 도는 예약은 한 번 거절해 사용자에게 묻게 한다
    const refusal = await checkZone($, e.cron).catch(() => undefined)
    if (refusal !== undefined) return { deny: refusal }
    // 2. 걸린 예약을 세션 파일에 기록
    const ran = await next(e)
    if (ran.deny !== undefined || ran.result === undefined || ran.isError === true) return ran
    const r = ran.result
    const now = await $.clock.now()
    const job: Job = {
      id: r.id,
      cron: e.cron,
      prompt: e.prompt,
      recurring: r.recurring,
      humanSchedule: r.humanSchedule,
      createdAt: now,
      nextFireAt: r.nextFireAt,
    }
    if (r.recurring) job.expiresAt = now + WEEK_MS
    let inherited = false
    await updateOwnSession($, file => {
      // 7일 만료 전 재등록(reregister.ts)이면 지워진 옛 예약의 실행 방식을 이어받는다
      const renewed = file.jobs.filter(j => j.mode !== undefined && j.reregisterTriedAt !== undefined && j.cron === job.cron && j.prompt.trim() === job.prompt.trim()).pop()
      if (renewed?.mode !== undefined) { job.mode = renewed.mode; inherited = true }
      file.jobs = [...file.jobs.filter(j => j.id !== job.id), job]
    })
    await touchStamp($)
    // 3. 모델에게 job_mode 로 실행 방식을 정하라고 한 줄 덧붙인다(사용자에게는 안 보임)
    if (inherited) return ran
    const hint = await modeHint($, job.id)
    return { ...ran, context: [...(ran.context ?? []), hint] }
  }).catch((_$, e, next) => next(e))   // 기록 중 실패해도 도구 호출 결과는 그대로 흘려보낸다

  // the matcher takes built-in names or a pattern, so the plugin's own tool goes by a pattern (as in remote.ts)
  on('tool.call', { tool: /^mcp__clock-out__job_mode$/ }, async ($, e) => {
    const input = e as unknown as { jobId?: unknown; mode?: unknown }
    return { result: await setJobMode($, String(input.jobId ?? ''), String(input.mode ?? '')) }
  }).catch((_$, e, next) => next(e))

  on('tool.call', { tool: 'CronDelete' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.result === undefined || ran.isError === true) return ran
    const id = ran.result.id
    const now = await $.clock.now()
    await updateOwnSession($, file => {
      for (const j of file.jobs) if (j.id === id && j.deletedAt === undefined) j.deletedAt = now
    })
    await touchStamp($)
    return ran
  }).catch((_$, e, next) => next(e))   // 기록 중 실패해도 도구 호출 결과는 그대로 흘려보낸다

  // CronList is the truth for what is scheduled right now: --resume restores jobs from the transcript, one-shots
  // vanish after firing, recurring ones vanish after 7 days. Sync the file to it.
  on('tool.call', { tool: 'CronList' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.result === undefined || ran.isError === true) return ran
    const listed = ran.result.jobs
    const now = await $.clock.now()
    let changed = false
    await updateOwnSession($, file => {
      const seen = new Set<string>()
      for (const l of listed) {
        seen.add(l.id)
        const known = file.jobs.find(j => j.id === l.id)
        if (known === undefined) {
          const recurring = l.recurring !== false
          const job: Job = { id: l.id, cron: l.cron, prompt: l.prompt, recurring, humanSchedule: l.humanSchedule, createdAt: now, nextFireAt: l.nextFireAt }
          if (recurring) job.expiresAt = now + WEEK_MS
          file.jobs.push(job)
          changed = true
        } else {
          if (known.nextFireAt !== l.nextFireAt) { known.nextFireAt = l.nextFireAt; changed = true }
          if (known.goneAt !== undefined) { delete known.goneAt; changed = true }   // came back (restored by --resume)
        }
      }
      for (const j of file.jobs) {
        if (!seen.has(j.id) && j.deletedAt === undefined && j.goneAt === undefined && j.firedAt === undefined) {
          j.goneAt = now
          changed = true
        }
      }
    })
    if (changed) await touchStamp($)
    return ran
  }).catch((_$, e, next) => next(e))   // 기록 중 실패해도 도구 호출 결과는 그대로 흘려보낸다
}

import type { EngineInterface, On } from 'claude-code'

import { readAppSettings } from './appSettings'
import { labelOf } from './overview'
import { NOTICE_MARK, readRemoteState, sendToRemote } from './remote'
import { isScheduledTurn } from './runs'

// 앱 설정의 차단 목록(permission.disallowedTools)을 예약 실행 턴에서만 적용한다.
// 사용자가 직접 하는 작업에는 관여하지 않는다 | 예전처럼 --disallowedTools 로 넘기면 그 세션에 옵션이 남아 일반 작업까지 막혔다.

const RULE = /^(?:Bash|PowerShell)\((.*)\)$/   // "Bash(git push*)" → git push*
const PUSH = /^git\s+push\b/

// 명령을 && · || · ; · | · 줄바꿈으로 나눈 조각들   "cd a && git push" 도 걸리게
const segmentsOf = (command: string) => command.split(/&&|\|\||[;|\r\n]/).map(s => s.trim()).filter(s => s !== '')

// 규칙 하나가 명령에 걸리는지   * 는 아무 글자, 끝의 :* 는 settings.json 표기(접두어)
export function ruleMatches(rule: string, command: string): boolean {
  const m = RULE.exec(rule.trim())
  if (m === null) return false
  const glob = (m[1] ?? '').replace(/:\*$/, '*').trim()
  if (glob === '') return false
  const re = new RegExp(`^${glob.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's')
  return segmentsOf(command).some(s => re.test(s))
}

// 막아야 하면 모델에게 줄 거절 문장, 아니면 undefined
export async function refusalOf($: EngineInterface, command: string): Promise<string | undefined> {
  const settings = await readAppSettings($)
  const rule = (settings?.permission?.disallowedTools ?? []).find(r => ruleMatches(r, command))
  if (rule === undefined) return undefined
  const en = settings?.language === 'en'
  const short = command.replace(/\s+/g, ' ').trim().slice(0, 120)

  // git push 는 원격 예약 작업 세션이 켜져 있으면 그쪽에 승인을 묻는다 | 승인은 원격에서 이 세션으로 보내는 지시(예약 턴 아님)로 온다
  const isPush = segmentsOf(command).some(s => PUSH.test(s))
  const remoteOn = settings?.remote?.enabled === true && (await readRemoteState($))?.sessionId !== undefined
  if (isPush && remoteOn) {
    const id = (await $.session.id()).slice(0, 8)
    const label = labelOf(await $.session.cwd())
    const asked = await sendToRemote($, en
      ? `${NOTICE_MARK} approval needed · ${label} · ${id}: a scheduled job wants to run \`${short}\`. To allow it, send session ${id} an instruction such as "push now".`
      : `${NOTICE_MARK} 승인 요청 · ${label} · ${id}: 예약 실행이 \`${short}\` 를 하려 합니다. 허용하려면 세션 ${id} 에 "지금 push 해" 같은 지시를 보내 주세요.`)
    if (asked) {
      return en
        ? 'clock-out: git push during a scheduled job needs the user\'s approval; it was asked in the remote jobs session. Do not push now. Finish the rest and say in the result that the push waits for approval.'
        : 'clock-out: 예약 실행 중 git push 는 사용자 승인이 필요해 원격 예약 작업 세션에 승인을 요청했습니다. 지금은 push 하지 말고 나머지를 마친 뒤, 결과에 "push 는 승인 대기" 라고 적으세요.'
    }
  }
  return en
    ? `clock-out: during a scheduled job this command is not run (block list in the clock-out app: ${rule}). Skip this step and say in the result that it was not done.`
    : `clock-out: 예약 실행 중에는 이 명령을 실행하지 않습니다(clock-out 앱 차단 목록: ${rule}). 이 단계는 건너뛰고 결과에 "하지 않음" 으로 적으세요.`
}

export function registerGuard(on: On): void {
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    if (!isScheduledTurn()) return next(e)
    const refusal = await refusalOf($, String((e as { command?: unknown }).command ?? ''))
    return refusal === undefined ? next(e) : { deny: refusal }
  }).catch((_$, e, next) => next(e))
}

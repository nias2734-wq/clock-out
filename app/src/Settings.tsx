import { AlertTriangle, AppWindow, Bell, BellOff, Clock, ExternalLink, FlaskConical, Plus, RotateCcw, Smartphone, X as XIcon, Languages, Monitor, Moon, Plug, Shield, Sliders, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import { dailySweepHm } from '@shared/revive'
import type { Overview } from '@shared/schedule'
import { hm, planPings } from '@shared/timeline'
import { DEFAULT_SETTINGS, RUN_MODES } from '@shared/types'
import type { AppSettings, PermissionMode } from '@shared/types'

import { api } from './api'
import { QuickStart, SetupChecklist } from './Setup'
import { Timeline } from './Timeline'

// The settings window (?view=settings). Every value the person set is editable here; a change is saved at once.
const L = {
  ko: {
    why: 'Claude 사용량은 5시간 단위 창으로 쌓였다가 초기화됩니다. 출근·점심·퇴근을 알려 주면 오후 업무와 퇴근 뒤 야간 예약이 각각 새 5시간으로 시작하도록, 정해진 시각에 아주 짧은 요청(핑)을 보내 초기화 시각을 맞추려고 시도합니다(실험 기능, 기본 꺼짐). 아래 타임라인에서 오늘 하루가 어떻게 흘러가는지 확인하세요.',
    title: '설정', work: '근무시간과 토큰 초기화', start: '출근', lunch: '점심', end: '퇴근', weekdays: '근무 요일',
    ping: '토큰 창 정렬', pingOn: '정렬 핑 보내기 (타임라인의 ⚡ 표시)',
    resets: '초기화 시각', resetAuto: '자동', resetCustom: '직접 지정', resetAutoHint: '점심 끝과 그 5시간 뒤', resetAdd: '시각 추가', resetRemove: '빼기', resetTooClose: '앞 초기화 뒤 5시간이 안 되어 이 시각에는 초기화될 수 없습니다',
    pingsAt: (p: string) => `정렬 핑 ${p} — 초기화 5시간 전에 보내 그 정시부터 창이 열리도록 시도합니다`,
    experimental: '실험 기능', pingNote: 'Anthropic 이 보장하는 동작이 아니라 관찰한 규칙에 기댑니다. 초기화 시각을 보장하지 않습니다.',
    model: '핑 모델', revive: '되살리기', lead: '예약 n분 전에 깨움', expiry: '반복 예약 만료 n시간 전에 깨움',
    daily: '퇴근 5분 전에 예약이 남은 꺼진 세션 깨움(자동 깨우기 제외·깨우기 차단 세션은 빼고)', confirm: '깨우기 전에 확인(알림만 하고 직접 누름)', dryRun: '시험 모드: 로그만 남기고 실제로 깨우지 않음',
    permission: '되살린 세션의 권한', work_mode: '작업 가능 모드', work_desc: '파일 수정은 묻지 않고, 아래 허용 도구만 묻지 않고 실행합니다 (acceptEdits)',
    bypass: 'bypass — 아무것도 묻지 않음', bypass_desc: '되살린 세션이 확인 없이 파일을 고치고 명령을 실행합니다. 아래 차단 도구만 막습니다',
    bypassWarn: 'bypass 를 켜면 사람 없이 켜진 세션이 차단 도구에 없는 명령은 무엇이든 확인 없이 실행합니다. 세션의 예약 프롬프트를 믿을 수 있을 때만 켜세요.',
    bypassYes: '위험을 이해하고 켭니다', cancel: '취소', allowed: '허용 도구 (한 줄에 하나)', denied: '차단 도구 (한 줄에 하나, 예약 실행 중에만 적용 · 허용 목록·bypass 보다 먼저. git push 는 원격 세션이 켜져 있으면 원격에 승인을 물음)',
    defaults: '권장 기본값으로', defaultsHint: 'push·publish·reset --hard 는 기본 차단합니다. 허용은 파일 읽기·수정과 git 조회·pull, 빌드·테스트만입니다.',
    savedOnce: '한 번 백그라운드로 돈 세션은 그때의 권한이 저장됩니다. 바꾼 설정은 다음에 처음 깨우는 세션부터 적용됩니다.',
    display: '화면', theme: '테마', themeSystem: 'Windows 설정 따라가기', themeLight: '라이트', themeDark: '다크', language: '언어', launch: 'Windows 로그인 시 자동 실행', updateCheck: '새 버전이 나오면 알림(하루 한 번 GitHub 확인)', legacy: '플러그인 없이 돈 세션의 대화 기록도 읽기',
    openGuide: '사용설명서 · 연동 점검 열기', guideHint: '설치 여부를 확인하고 버튼 하나로 설치합니다',
    plugin: '플러그인', pluginDesc: '세션 안에서 예약을 기록하고 만료를 스스로 연장하는 플러그인입니다.',
    close: '닫기',
    remote: '원격 예약 작업 세션', remoteWhy: '예약 작업을 총괄하는 원격 세션 하나를 띄웁니다. 퇴근 뒤 휴대폰 Claude 앱(또는 claude.ai/code)에서 채팅으로 모든 예약의 현황을 보고, 그 야간작업에 지시·수정하고, 필요하면 다른 세션을 원격으로 붙입니다. 예약 창 아래 "원격으로 예약 작업 모니터링" 버튼과 같습니다.',
    remoteOn: '원격 예약 작업 세션 켜기', remoteAlive: '실행 중', remoteStarting: '시작하는 중…', remoteOpen: '휴대폰·웹에서 열기',
    remoteNotify: '예약 결과 알림', notifyOff: '끔', notifyFailures: '실패만', notifyAll: '모든 실행',
    remotePerm: '이 세션의 권한', remotePermNote: '휴대폰에서 보낸 말이 이 PC 에서 실행됩니다. 권한은 세션을 처음 시작할 때 정해지므로, 권한을 바꾸면 원격 예약 작업 세션을 새로 시작합니다(이전 대화는 이어지지 않습니다).',
    remoteBypassWarn: '원격 세션에 bypass 를 주면 휴대폰에서 보낸 말로 이 PC 에서 차단 도구에 없는 명령이 확인 없이 실행됩니다.',
    runMode: '예약 실행 방식', runModeWhy: '예약 시각에 그 예약을 어떻게 보여 줄지 정합니다. 예약에서 정한 방식(Claude 가 예약을 만들 때 정함) > 예약 창에서 세션별로 고른 방식 > 이 기본값 순서로 적용됩니다.',
    runModeDefault: '기본값', quiet: '조용히', notify: '알림', open: '화면에 열기',
    cleanupAuto: '완료된 백그라운드 세션 자동 정리', cleanupAfter: '쉰 지 n분 뒤',
    cleanupHint: '남은 예약이 없는 백그라운드 세션이 마지막 실행 뒤 이만큼 쉬면 끕니다(세션당 메모리 약 0.5GB). 예약 실행 중·답 대기·터미널 창이 붙어 있으면 끄지 않고, 대화와 완료 기록은 남습니다.',
    quiet_desc: '백그라운드로 실행하고 따로 알리지 않습니다(원격 알림 설정은 그대로).', notify_desc: '백그라운드로 실행하고, 시작할 때와 답을 기다릴 때 Windows 알림을 띄웁니다. 알림을 누르면 그 세션이 터미널 창으로 열립니다.', open_desc: '예약 시각에 그 세션을 터미널 창으로 띄워 바로 보여 줍니다. 깨우기는 그대로 백그라운드로 합니다.',
  },
  en: {
    why: 'Claude usage adds up in 5-hour windows that then reset. Given your start, lunch and end, the app sends a tiny call (a ping) at set times to try to start the afternoon and the nightly jobs after work each with a fresh 5 hours (experimental, off by default). The timeline shows how today plays out.',
    title: 'Settings', work: 'Work hours and token resets', start: 'Start', lunch: 'Lunch', end: 'End', weekdays: 'Work days',
    ping: 'Align the 5-hour window', pingOn: 'Send the align ping (⚡ on the timeline)',
    resets: 'Reset times', resetAuto: 'Auto', resetCustom: 'Choose', resetAutoHint: 'lunch end and 5 hours later', resetAdd: 'Add a time', resetRemove: 'Remove', resetTooClose: 'Less than 5 hours after the previous reset: no window can end at this time',
    pingsAt: (p: string) => `Align ping ${p} — sent 5 hours before each reset to try to open the window on that hour`,
    experimental: 'Experimental', pingNote: 'This relies on observed behaviour, not on anything Anthropic guarantees. The reset times are not guaranteed.',
    model: 'Ping model', revive: 'Reviving', lead: 'Wake a stopped session N minutes before its job', expiry: 'Wake N hours before a recurring job expires',
    daily: 'Wake stopped sessions that still have jobs 5 minutes before the work end (not jobs with No auto-wake, not blocked sessions)', confirm: 'Ask before waking (notify only)', dryRun: 'Dry run: log only, never wake',
    permission: 'Permissions of a revived session', work_mode: 'Work mode', work_desc: 'Edits without asking, and the allowed tools below run without asking (acceptEdits)',
    bypass: 'bypass — never ask', bypass_desc: 'A revived session edits files and runs commands without confirmation; only the blocked tools below are stopped',
    bypassWarn: 'With bypass on, a session started without anyone watching runs any command not on the blocked list unasked. Enable it only when you trust the prompts of every scheduled job.',
    bypassYes: 'I understand the risk, enable', cancel: 'Cancel', allowed: 'Allowed tools (one per line)', denied: 'Blocked tools (one per line; only while a scheduled job runs, over the allowed list and bypass. git push asks in the remote jobs session when it is on)',
    defaults: 'Recommended defaults', defaultsHint: 'push, publish and reset --hard are blocked by default. Allowed: reading and editing files, git status/diff/log/fetch/pull, build and test.',
    savedOnce: 'A session that ran in the background once keeps that permission; a changed setting applies to sessions woken for the first time from now on.',
    display: 'Display', theme: 'Theme', themeSystem: 'Follow Windows', themeLight: 'Light', themeDark: 'Dark', language: 'Language', launch: 'Start with Windows', updateCheck: 'Tell me about a new version (checks GitHub once a day)', legacy: 'Also read transcripts of sessions that ran without the plugin',
    openGuide: 'Open user guide · setup check', guideHint: 'Checks the install and installs it with one button',
    plugin: 'Plugin', pluginDesc: 'The plugin records jobs inside each session and renews them before expiry.',
    close: 'Close',
    remote: 'Remote jobs session', remoteWhy: 'Starts one remote session that oversees every job. After work, from the Claude mobile app (or claude.ai/code), see the jobs, give their sessions instructions or changes, and attach other sessions to remote, by chat. The same as "Monitor jobs remotely" under the jobs panel.',
    remoteOn: 'Turn the remote jobs session on', remoteAlive: 'running', remoteStarting: 'starting…', remoteOpen: 'Open on phone / web',
    remoteNotify: 'Job result notices', notifyOff: 'Off', notifyFailures: 'Failures only', notifyAll: 'Every run',
    remotePerm: 'Permission of this session', remotePermNote: 'What you type on the phone runs on this PC. The permission is fixed when a session first starts, so changing it starts a new remote jobs session (the old conversation does not carry over).',
    remoteBypassWarn: 'With bypass, anything typed on the phone runs any command not on the blocked list on this PC without confirmation.',
    runMode: 'Job run mode', runModeWhy: 'How a job is shown when it fires. The mode set on the job (Claude picks it when it creates the job) comes first, then the one chosen per session in the jobs panel, then this default.',
    runModeDefault: 'Default', quiet: 'Quiet', notify: 'Notify', open: 'Open on screen',
    cleanupAuto: 'Clean up finished background sessions', cleanupAfter: 'after N idle minutes',
    cleanupHint: 'A background session with no job left is stopped once it has been idle this long after its last run (about 0.5 GB of memory each). Never while a job runs, it waits for your answer or a terminal window is attached; the conversation and the done list stay.',
    quiet_desc: 'Runs in the background with no notice (remote notices as set).', notify_desc: 'Runs in the background with a Windows notice when it starts and when it waits for your answer; clicking the notice opens the session in a terminal.', open_desc: 'Opens the session in a terminal window when the job fires. Waking still happens in the background.',
  },
}
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const DAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// A tool list, one per line: the text stays as typed (a new empty line while typing), the saved list drops empty lines
function ToolList({ label, value, onSave }: { label: string; value: string[]; onSave: (tools: string[]) => void }) {
  const parse = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean)
  const [text, setText] = useState(value.join('\n'))
  // a change from elsewhere (the defaults button, another window) replaces the text
  useEffect(() => { setText(old => (parse(old).join('\n') === value.join('\n') ? old : value.join('\n'))) }, [value])
  return (
    <label className="block">{label}
      <textarea rows={4} value={text} onChange={e => { setText(e.target.value); onSave(parse(e.target.value)) }} />
    </label>
  )
}

export function Settings({ initial, version }: { initial: AppSettings; version: string }) {
  const [s, setS] = useState<AppSettings>(initial)
  const [askBypass, setAskBypass] = useState(false)
  useEffect(() => { setS(initial) }, [initial])
  const l = L[s.language]
  const [overview, setOverview] = useState<Overview>({ builtAt: 0, sessions: [], jobCount: 0 })
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    void api.getSchedule().then(setOverview)
    const off = api.onSchedule(setOverview)
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => { off(); clearInterval(id) }
  }, [])

  const save = (patch: Partial<AppSettings>) => { const next = { ...s, ...patch }; setS(next); void api.setSettings(patch) }
  const remote = overview.remote
  // the chosen reset hours; removing the last one goes back to auto
  const plan = planPings(s.workHours, s.alignPing.resetHours)
  const resetHours = s.alignPing.resetHours ?? []
  const setResets = (hours: number[]) => save({ alignPing: { ...s.alignPing, resetHours: hours.length > 0 ? [...new Set(hours)].sort((a, b) => a - b) : undefined } })
  const setMode = (mode: PermissionMode) => {
    if (mode === 'bypass') { setAskBypass(true); return }
    save({ permission: { ...s.permission, mode } })
  }

  return (
    <div className="settings">
      <h1><Sliders size={18} /> {l.title} <span className="version">clock-out v{version}</span></h1>

      <SetupChecklist lang={s.language} compact />
      <QuickStart lang={s.language} foldable />

      <section>
        <h2><Clock size={15} /> {l.work}</h2>
        <p className="why">{l.why}</p>
        <div className="row">
          <label>{l.start} <input type="time" value={s.workHours.start} onChange={e => save({ workHours: { ...s.workHours, start: e.target.value } })} /></label>
          <label>{l.lunch} <input type="time" value={s.workHours.lunchStart} onChange={e => save({ workHours: { ...s.workHours, lunchStart: e.target.value } })} /> ~ <input type="time" value={s.workHours.lunchEnd} onChange={e => save({ workHours: { ...s.workHours, lunchEnd: e.target.value } })} /></label>
          <label>{l.end} <input type="time" value={s.workHours.end} onChange={e => save({ workHours: { ...s.workHours, end: e.target.value } })} /></label>
        </div>
        <div className="row">
          <span className="muted">{l.weekdays}</span>
          {[1, 2, 3, 4, 5, 6, 0].map(d => (
            <label key={d} className="chip"><input type="checkbox" checked={s.workHours.weekdays.includes(d)} onChange={e => save({ workHours: { ...s.workHours, weekdays: e.target.checked ? [...s.workHours.weekdays, d].sort() : s.workHours.weekdays.filter(x => x !== d) } })} /> {(s.language === 'ko' ? DAYS : DAYS_EN)[d]}</label>
          ))}
        </div>
        {/* reset times: auto (lunch end and 5 h later) or any whole hours; a window always starts on the hour */}
        <div className="row">
          <span className="muted">{l.resets}</span>
          <div className="segmented" role="radiogroup" aria-label={l.resets}>
            <button role="radio" aria-checked={!plan.isCustom} className={plan.isCustom ? '' : 'on'} onClick={() => save({ alignPing: { ...s.alignPing, resetHours: undefined } })}>{l.resetAuto}</button>
            <button role="radio" aria-checked={plan.isCustom} className={plan.isCustom ? 'on' : ''} onClick={() => { if (!plan.isCustom) setResets(plan.targets.map(m => m / 60)) }}>{l.resetCustom}</button>
          </div>
          {plan.targets.map(m => (
            <span key={m} className={`chip reset-chip ${plan.tooClose.includes(m) ? 'bad' : ''}`} title={plan.tooClose.includes(m) ? l.resetTooClose : undefined}><RotateCcw size={12} /> {hm(m)}
              {plan.isCustom && <button className="btn icon tiny" title={l.resetRemove} onClick={() => setResets(resetHours.filter(h => h * 60 !== m))}><XIcon size={12} /></button>}
            </span>
          ))}
          {plan.isCustom && (
            <label className="reset-add"><Plus size={13} />
              <select value="" aria-label={l.resetAdd} onChange={e => { if (e.target.value !== '') setResets([...resetHours, Number(e.target.value)]) }}>
                <option value="">{l.resetAdd}</option>
                {Array.from({ length: 24 }, (_, h) => h).filter(h => !resetHours.includes(h)).map(h => <option key={h} value={h}>{hm(h * 60)}</option>)}
              </select>
            </label>
          )}
          {!plan.isCustom && <span className="muted">{l.resetAutoHint}</span>}
        </div>
        {s.alignPing.enabled && <div className="muted small">{l.pingsAt(plan.pings.map(hm).join(', '))}</div>}
        <Timeline settings={s} overview={overview} now={now} />
        <div className="row">
          <label className="check"><input type="checkbox" checked={s.alignPing.enabled} onChange={e => save({ alignPing: { ...s.alignPing, enabled: e.target.checked } })} /> {l.pingOn} <span className="pill warn">{l.experimental}</span></label>
          <label className="muted">{l.model} <input className="short" value={s.alignPing.model} onChange={e => save({ alignPing: { ...s.alignPing, model: e.target.value } })} /></label>
        </div>
        <div className="note"><FlaskConical size={14} /> {l.pingNote}</div>
      </section>

      <section>
        <h2><Clock size={15} /> {l.revive}</h2>
        <div className="row">
          <label>{l.lead} <input type="number" className="short" min={1} max={120} value={s.revive.leadMinutes} onChange={e => save({ revive: { ...s.revive, leadMinutes: Number(e.target.value) } })} /></label>
          <label>{l.expiry} <input type="number" className="short" min={1} max={72} value={s.revive.expiryLeadHours} onChange={e => save({ revive: { ...s.revive, expiryLeadHours: Number(e.target.value) } })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={s.revive.dailyAtEnd} onChange={e => save({ revive: { ...s.revive, dailyAtEnd: e.target.checked } })} /> {l.daily} ({dailySweepHm(s)})</label>
        <label className="check"><input type="checkbox" checked={s.revive.confirmBefore} onChange={e => save({ revive: { ...s.revive, confirmBefore: e.target.checked } })} /> {l.confirm}</label>
        <label className="check"><input type="checkbox" checked={s.revive.dryRun} onChange={e => save({ revive: { ...s.revive, dryRun: e.target.checked } })} /> {l.dryRun}</label>
      </section>

      <section>
        <h2><Bell size={15} /> {l.runMode}</h2>
        <p className="why">{l.runModeWhy}</p>
        <div className="row">
          <span className="muted">{l.runModeDefault}</span>
          <div className="segmented" role="radiogroup" aria-label={l.runMode}>
            {RUN_MODES.map(m => (
              <button key={m} role="radio" aria-checked={s.runMode.default === m} className={s.runMode.default === m ? 'on' : ''} onClick={() => save({ runMode: { ...s.runMode, default: m } })}>
                {m === 'quiet' ? <BellOff size={13} /> : m === 'notify' ? <Bell size={13} /> : <AppWindow size={13} />}
                {l[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="note muted">{l[`${s.runMode.default}_desc`]}</div>
        <div className="row" title={l.cleanupHint}>
          <label className="check"><input type="checkbox" checked={s.cleanup.auto} onChange={e => save({ cleanup: { ...s.cleanup, auto: e.target.checked } })} /> {l.cleanupAuto}</label>
          <label className="muted">{l.cleanupAfter} <input type="number" className="short" min={1} max={1440} disabled={!s.cleanup.auto} value={s.cleanup.idleMinutes} onChange={e => save({ cleanup: { ...s.cleanup, idleMinutes: Number(e.target.value) } })} /></label>
        </div>
      </section>

      <section>
        <h2><Shield size={15} /> {l.permission}</h2>
        <label className="check"><input type="radio" checked={s.permission.mode === 'work'} onChange={() => setMode('work')} /> <b>{l.work_mode}</b> <span className="muted">— {l.work_desc}</span></label>
        <label className="check danger"><input type="radio" checked={s.permission.mode === 'bypass'} onChange={() => setMode('bypass')} /> <b>{l.bypass}</b> <span className="muted">— {l.bypass_desc}</span></label>
        {askBypass && (
          <div className="warning-box">
            <AlertTriangle size={16} /> <span>{l.bypassWarn}</span>
            <div className="actions">
              <button className="btn ghost small" onClick={() => setAskBypass(false)}>{l.cancel}</button>
              <button className="btn danger small" onClick={() => { setAskBypass(false); save({ permission: { ...s.permission, mode: 'bypass' } }) }}>{l.bypassYes}</button>
            </div>
          </div>
        )}
        {s.permission.mode === 'work' && <ToolList label={l.allowed} value={s.permission.allowedTools} onSave={allowedTools => save({ permission: { ...s.permission, allowedTools } })} />}
        {/* bypass 에서도 적용 | 플래그가 아니라 플러그인이 예약 실행 턴에서만 거절(hooks/guard.ts) */}
        <ToolList label={l.denied} value={s.permission.disallowedTools} onSave={disallowedTools => save({ permission: { ...s.permission, disallowedTools } })} />
        <div className="row">
          <button className="btn secondary small" onClick={() => save({ permission: { ...s.permission, allowedTools: [...DEFAULT_SETTINGS.permission.allowedTools], disallowedTools: [...DEFAULT_SETTINGS.permission.disallowedTools] } })}><RotateCcw size={13} /> {l.defaults}</button>
          <span className="muted">{l.defaultsHint}</span>
        </div>
        <div className="note muted">{l.savedOnce}</div>
      </section>

      <section>
        <h2><Smartphone size={15} /> {l.remote}</h2>
        <p className="why">{l.remoteWhy}</p>
        <label className="check"><input type="checkbox" checked={s.remote.enabled} onChange={e => save({ remote: { ...s.remote, enabled: e.target.checked } })} /> <b>{l.remoteOn}</b></label>
        {s.remote.enabled && (
          <div className="row">
            <span className={`dot ${remote?.isAlive === true ? 'ok' : remote?.error !== undefined ? 'danger' : 'warn'}`} />
            <span>{remote?.isAlive === true ? l.remoteAlive : remote?.error ?? l.remoteStarting}</span>
            {remote?.url !== undefined && <button className="btn primary small" onClick={() => api.openExternal(remote.url as string)}><ExternalLink size={13} /> {l.remoteOpen}</button>}
          </div>
        )}
        <div className="row">
          <span className="muted">{l.remoteNotify}</span>
          <div className="segmented" role="radiogroup" aria-label={l.remoteNotify}>
            {(['off', 'failures', 'all'] as const).map(n => (
              <button key={n} role="radio" aria-checked={s.remote.notify === n} className={s.remote.notify === n ? 'on' : ''} onClick={() => save({ remote: { ...s.remote, notify: n } })}>
                {n === 'off' ? l.notifyOff : n === 'failures' ? l.notifyFailures : l.notifyAll}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="muted">{l.remotePerm}</span>
          <div className="segmented" role="radiogroup" aria-label={l.remotePerm}>
            <button role="radio" aria-checked={s.remote.permission === 'work'} className={s.remote.permission === 'work' ? 'on' : ''} onClick={() => save({ remote: { ...s.remote, permission: 'work' } })}>{l.work_mode}</button>
            <button role="radio" aria-checked={s.remote.permission === 'bypass'} className={s.remote.permission === 'bypass' ? 'on' : ''} onClick={() => save({ remote: { ...s.remote, permission: 'bypass' } })}>bypass</button>
          </div>
        </div>
        {s.remote.permission === 'bypass' && <div className="warning-box"><AlertTriangle size={16} /> <span>{l.remoteBypassWarn}</span></div>}
        <div className="note muted">{l.remotePermNote}</div>
      </section>

      <section>
        <h2><Languages size={15} /> {l.display}</h2>
        <div className="row">
          <span>{l.theme}</span>
          <div className="segmented" role="radiogroup" aria-label={l.theme}>
            {(['system', 'light', 'dark'] as const).map(mode => (
              <button key={mode} role="radio" aria-checked={s.theme === mode} className={s.theme === mode ? 'on' : ''} onClick={() => save({ theme: mode })}>
                {mode === 'system' ? <Monitor size={13} /> : mode === 'light' ? <Sun size={13} /> : <Moon size={13} />}
                {mode === 'system' ? l.themeSystem : mode === 'light' ? l.themeLight : l.themeDark}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label>{l.language}
            <select value={s.language} onChange={e => save({ language: e.target.value as AppSettings['language'] })}><option value="ko">한국어</option><option value="en">English</option></select>
          </label>
          <label className="check"><input type="checkbox" checked={s.launchAtLogin} onChange={e => save({ launchAtLogin: e.target.checked })} /> {l.launch}</label>
        </div>
        <label className="check"><input type="checkbox" checked={s.updateCheck} onChange={e => save({ updateCheck: e.target.checked })} /> {l.updateCheck}</label>
        <label className="check"><input type="checkbox" checked={s.legacyTranscriptScan} onChange={e => save({ legacyTranscriptScan: e.target.checked })} /> {l.legacy}</label>
      </section>

      <section>
        <h2><Plug size={15} /> {l.plugin}</h2>
        <div className="muted">{l.pluginDesc}</div>
        <div className="row">
          <button className="btn primary small" onClick={() => api.openGuide()}>{l.openGuide}</button>
          <span className="muted">{l.guideHint}</span>
        </div>
      </section>

      <div className="actions end"><button className="btn primary small" onClick={() => window.close()}>{l.close}</button></div>
    </div>
  )
}

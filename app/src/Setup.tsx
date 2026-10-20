import { AlertTriangle, BookOpen, CheckCircle2, ChevronRight, CircleHelp, Loader2, Plug, RefreshCw, Rocket, Settings as SettingsIcon, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AppSettings, SetupCheck, SetupFix, SetupKey } from '@shared/types'

import { api } from './api'

// Shared by the first-run window (?view=setup), the top of Settings and the user guide:
// the setup check with one-click fixes, and the quick start.

type Lang = AppSettings['language']

const CHECK_TEXT: Record<Lang, Record<SetupKey, { title: string; ok: string; bad: string; why: string }>> = {
  ko: {
    cli: { title: 'Claude Code 설치', ok: '설치돼 있습니다', bad: 'claude 명령을 찾지 못했습니다', why: '세션을 되살리고 토큰 정렬 핑을 보내려면 claude 명령이 필요합니다.' },
    login: { title: 'Claude 로그인', ok: '로그인돼 있습니다', bad: '로그인 정보가 없습니다', why: '사용량 표시와 되살린 세션이 이 로그인을 씁니다. 터미널에서 claude 를 열고 /login 하세요.' },
    plugin: { title: 'clock-out 플러그인', ok: '설치돼 있습니다', bad: '설치돼 있지 않습니다', why: '각 세션 안에서 예약을 기록하고 만료 전에 스스로 다시 거는 부분입니다. 없으면 앱이 예약을 볼 수 없습니다.' },
    records: { title: '세션 기록 수신', ok: '최근 10분 안에 기록을 보낸 세션', bad: '최근 기록이 없습니다', why: '플러그인을 설치한 뒤 새로 연 Claude Code 세션부터 기록이 들어옵니다. 이미 실행 중이던 세션은 한 번 다시 열어야 합니다.' },
    sleep: { title: '절전 모드 해제', ok: '전원 연결 시 절전·최대 절전이 꺼져 있습니다', bad: 'PC 가 절전에 들어갈 수 있습니다', why: 'PC 가 잠들어 있으면 예약 시각에 세션을 깨울 수 없습니다. 버튼을 누르면 전원 연결 시 절전·최대 절전을 "사용 안 함"으로 바꿉니다(Windows 설정 > 전원과 같은 값, 관리자 권한 불필요). 화면 끄기는 그대로 둡니다.' },
    terminal: { title: 'Windows Terminal', ok: '있습니다', bad: '없습니다', why: '"예약 세션 확인하기" 버튼이 실행 중인 세션을 이 터미널 창으로 엽니다. 없으면 기본 콘솔 창으로 엽니다.' },
    conflict: { title: '겹치는 프로그램', ok: '다른 깨우기 프로그램이 없습니다', bad: '같은 세션을 깨우는 프로그램이 함께 있습니다', why: '예전 위젯(claude-usage-widget)이나 플러그인의 PowerShell 서비스가 함께 돌면 같은 세션을 두 번 깨울 수 있습니다. 이 앱 하나만 두세요.' },
  },
  en: {
    cli: { title: 'Claude Code installed', ok: 'found', bad: 'the claude command was not found', why: 'Reviving sessions and the align ping run the claude command.' },
    login: { title: 'Signed in to Claude', ok: 'signed in', bad: 'no login found', why: 'The usage bar and every revived session use this login. Open claude in a terminal and run /login.' },
    plugin: { title: 'clock-out plugin', ok: 'installed', bad: 'not installed', why: 'Records the jobs inside every session and renews them before expiry. Without it the app cannot see jobs.' },
    records: { title: 'Sessions reporting', ok: 'sessions reported in the last 10 minutes', bad: 'nothing recent', why: 'Sessions opened after the plugin was installed report in. A session that was already running needs to be reopened once.' },
    sleep: { title: 'Sleep turned off', ok: 'sleep and hibernate are off when plugged in', bad: 'the PC may go to sleep', why: 'A sleeping PC cannot wake a session at the job time. The button sets sleep and hibernate to "Never" when plugged in (the same as Windows Settings > Power; no admin needed). The screen still turns off.' },
    terminal: { title: 'Windows Terminal', ok: 'found', bad: 'not found', why: '"Open session" opens a running session in this terminal; without it a plain console window is used.' },
    conflict: { title: 'Overlapping programs', ok: 'nothing else wakes sessions', bad: 'another program wakes the same sessions', why: 'The old widget (claude-usage-widget) or the plugin’s PowerShell service would wake the same sessions twice. Keep only this app.' },
  },
}

const FIX_TEXT: Record<Lang, Record<SetupFix, string>> = {
  ko: { disableSleep: '절전 끄기', installPlugin: '플러그인 설치', enablePlugin: '플러그인 켜기', disableLegacy: '겹치는 프로그램 끄기', openLogin: '터미널에서 로그인', openDownload: '설치 안내 열기', openTerminalStore: 'Windows Terminal 받기' },
  en: { disableSleep: 'Turn sleep off', installPlugin: 'Install plugin', enablePlugin: 'Enable plugin', disableLegacy: 'Turn the others off', openLogin: 'Sign in in a terminal', openDownload: 'Open install guide', openTerminalStore: 'Get Windows Terminal' },
}

const UI = {
  ko: {
    check: '연동 점검', recheck: '다시 점검', checking: '점검 중…', allOk: '모두 준비됐습니다', needs: '해결이 필요한 항목이 있습니다',
    devNote: '개발 폴더(CLAUDE_CODE_PLUGIN_DIRS)로 적재돼 있습니다. 정식 설치와 함께 쓰면 두 번 적재되니 하나만 쓰세요.',
    confirmLegacy: '예전 위젯과 PowerShell 서비스의 시작프로그램 등록을 지우고, 실행 중이면 닫습니다. 계속할까요?',
    done: '완료', failed: '실패', quick: '빠른 시작', more: '자세히', less: '접기',
    setupTitle: '시작하기 · 연동 점검', setupLead: 'clock-out 이 Claude Code 와 함께 동작하려면 아래 항목이 모두 초록이어야 합니다. 빨간 항목은 오른쪽 버튼 하나로 해결됩니다.',
    openSettings: '설정 열기', openGuide: '사용설명서', finish: '완료',
  },
  en: {
    check: 'Setup check', recheck: 'Check again', checking: 'checking…', allOk: 'All set', needs: 'Some items need attention',
    devNote: 'Loaded from a development folder (CLAUDE_CODE_PLUGIN_DIRS). Do not also install it normally, or it loads twice.',
    confirmLegacy: 'Remove the startup entries of the old widget and the PowerShell service, and close them if running. Continue?',
    done: 'done', failed: 'failed', quick: 'Quick start', more: 'Details', less: 'Collapse',
    setupTitle: 'Get started · setup check', setupLead: 'For clock-out to work with Claude Code every item below should be green. Each red item is fixed with the button on its right.',
    openSettings: 'Open settings', openGuide: 'User guide', finish: 'Done',
  },
}

// The fixed details electron/main/setup.ts sends (English) in Korean; '' drops one that only repeats the row's own text
const DETAIL_KO: Record<string, string> = {
  'claude not found on PATH': 'PATH 에서 claude 를 찾지 못함', 'no login token': '', 'not installed': '', 'needs Claude Code': 'Claude Code 설치가 먼저 필요',
  'none yet': '아직 없음', 'powercfg could not be read': 'powercfg 를 읽지 못함', 'AC: sleep never, hibernate never': '',
  'wt.exe not found; Attach opens a console window instead': '',
}
function detailText(lang: Lang, detail: string): string {
  return lang === 'ko' ? DETAIL_KO[detail] ?? detail : detail
}

function StateIcon({ state }: { state: SetupCheck['state'] | 'busy' }) {
  if (state === 'busy') return <Loader2 size={16} className="spin muted" />
  if (state === 'ok') return <CheckCircle2 size={16} color="var(--ok)" />
  if (state === 'warn') return <AlertTriangle size={16} color="var(--warn)" />
  if (state === 'error') return <XCircle size={16} color="var(--danger)" />
  return <CircleHelp size={16} className="muted" />
}

// compact: when every item is green, show one line of icon chips instead of the full list (Settings)
export function SetupChecklist({ lang, compact = false }: { lang: Lang; compact?: boolean }) {
  const [checks, setChecks] = useState<SetupCheck[] | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const [busyFix, setBusyFix] = useState<SetupFix | undefined>(undefined)
  const [result, setResult] = useState<string>('')
  const ui = UI[lang]
  const load = () => { setChecks(undefined); void api.checkSetup().then(setChecks) }
  useEffect(load, [])

  const fix = async (f: SetupFix) => {
    if (f === 'disableLegacy' && !window.confirm(ui.confirmLegacy)) return
    setBusyFix(f); setResult('')
    const r = await api.runFix(f)
    setBusyFix(undefined)
    setResult(`${FIX_TEXT[lang][f]} — ${r.ok ? ui.done : `${ui.failed}: ${r.message}`}`)
    load()
  }
  const bad = checks?.filter(c => c.state === 'error' || c.state === 'warn').length ?? 0
  const rows: SetupCheck[] = checks ?? (['cli', 'login', 'plugin', 'records', 'sleep', 'terminal', 'conflict'] as SetupKey[]).map((key): SetupCheck => ({ key, state: 'unknown', detail: '' }))
  const folded = compact && checks !== undefined && bad === 0 && !expanded

  return (
    <section className="g-check">
      <div className="g-check-head">
        <h2><Plug size={16} /> {ui.check}</h2>
        <span className={checks === undefined ? 'muted' : bad === 0 ? 'ok-text' : 'warn-text'}>{checks === undefined ? ui.checking : bad === 0 ? ui.allOk : ui.needs}</span>
        <span className="grow" />
        {compact && checks !== undefined && bad === 0 && <button className="btn ghost small" onClick={() => setExpanded(!expanded)}>{expanded ? ui.less : ui.more}</button>}
        <button className="btn secondary small" onClick={load} disabled={checks === undefined}><RefreshCw size={13} /> {ui.recheck}</button>
      </div>
      {folded && (
        <div className="g-chips">
          {rows.map(c => <span key={c.key} className="g-chip" title={`${CHECK_TEXT[lang][c.key].ok}${detailText(lang, c.detail) ? ` (${detailText(lang, c.detail)})` : ''}`}><StateIcon state={c.state} />{CHECK_TEXT[lang][c.key].title}</span>)}
        </div>
      )}
      {!folded && <div className="g-rows">
        {rows.map(c => {
          const text = CHECK_TEXT[lang][c.key]
          return (
            <div key={c.key} className={`g-row ${c.state}`}>
              <StateIcon state={checks === undefined ? 'busy' : c.state} />
              <div className="g-row-main">
                <div className="g-row-title">{text.title} <span className="muted">{checks === undefined ? '' : `— ${c.state === 'ok' ? text.ok : text.bad}`}{detailText(lang, c.detail) !== '' && checks !== undefined ? ` (${detailText(lang, c.detail)})` : ''}</span></div>
                <div className="g-row-why">{text.why}</div>
                {c.note === 'dev' && <div className="g-row-why warn-text">{ui.devNote}</div>}
              </div>
              {c.fix !== undefined && checks !== undefined && (
                <button className={`btn ${c.state === 'error' ? 'primary' : 'secondary'} small`} disabled={busyFix !== undefined} onClick={() => { void fix(c.fix as SetupFix) }}>
                  {busyFix === c.fix ? <Loader2 size={13} className="spin" /> : null} {FIX_TEXT[lang][c.fix]}
                </button>
              )}
            </div>
          )
        })}
      </div>}
      {result !== '' && <div className="g-result">{result}</div>}
    </section>
  )
}

// foldable: starts closed (Settings, where it is a reminder rather than the first thing to read)
export function QuickStart({ lang, foldable = false }: { lang: Lang; foldable?: boolean }) {
  if (foldable) return (
    <details className="g-check g-fold">
      <summary><ChevronRight size={15} className="chev" /><Rocket size={16} /> {UI[lang].quick}</summary>
      <QuickSteps lang={lang} />
    </details>
  )
  return (
    <section className="g-check">
      <h2><Rocket size={16} /> {UI[lang].quick}</h2>
      <QuickSteps lang={lang} />
    </section>
  )
}

function QuickSteps({ lang }: { lang: Lang }) {
  return (
    <>
      {lang === 'ko' ? (
        <ol className="quick">
          <li>위 <b>연동 점검</b>에서 빨간 항목의 버튼을 누릅니다. 보통은 <b>플러그인 설치</b> 하나면 됩니다.</li>
          <li><b>근무시간</b>(출근·점심·퇴근)을 설정에 넣습니다. 토큰 5시간 창이 점심 끝과 퇴근 시각에 초기화되도록 핑 시각이 계산됩니다.</li>
          <li>Claude Code 세션을 새로 열고 평소처럼 예약을 겁니다. 예: <code>"매일 21:03 에 develop 을 pull 해 줘"</code></li>
          <li>상태바의 <b>예약</b> 버튼으로 모든 세션의 예약을 봅니다. 세션을 꺼도 예약 시각 전에 이 앱이 다시 켭니다.</li>
        </ol>
      ) : (
        <ol className="quick">
          <li>In the <b>setup check</b> above, press the button of any red item — usually just <b>Install plugin</b>.</li>
          <li>Enter your <b>work hours</b> in Settings; ping times are computed so the 5-hour window resets at lunch end and work end.</li>
          <li>Open a new Claude Code session and schedule as usual, e.g. <code>"pull develop every day at 21:03"</code>.</li>
          <li>Click <b>Jobs</b> on the status bar to see every session's jobs. Close a session — the app wakes it before the job is due.</li>
        </ol>
      )}
    </>
  )
}

// The first-run window: setup check, quick start, and the way on
export function SetupWindow({ settings, version }: { settings: AppSettings; version: string }) {
  const ui = UI[settings.language]
  return (
    <div className="guide">
      <h1><Plug size={19} /> {ui.setupTitle} <span className="version">v{version}</span></h1>
      <p className="lead">{ui.setupLead}</p>
      <SetupChecklist lang={settings.language} />
      <QuickStart lang={settings.language} />
      <div className="actions end">
        <button className="btn secondary small" onClick={() => api.openGuide()}><BookOpen size={13} /> {ui.openGuide}</button>
        <button className="btn secondary small" onClick={() => api.openSettings()}><SettingsIcon size={13} /> {ui.openSettings}</button>
        <button className="btn primary small" onClick={() => window.close()}>{ui.finish}</button>
      </div>
    </div>
  )
}

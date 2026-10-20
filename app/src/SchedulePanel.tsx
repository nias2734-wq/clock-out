import { AlertTriangle, Ban, BookOpen, Power, Trash2, ExternalLink, Smartphone, CalendarClock, Plug, Settings as SettingsIcon, X, CheckCircle2, EyeOff, Eye, FolderOpen, Hourglass, Play, Terminal, XCircle, CheckCheck, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { clearHow, stopBlock, tidyList } from '@shared/cleanup'
import type { ClearHow, StopBlock, StopCheck, StopWarn, TidyTarget } from '@shared/cleanup'
import { describeCron } from '@shared/cronText'
import { reopenCommands } from '@shared/reopen'
import { effectiveMode } from '@shared/runMode'
import type { ModeSource } from '@shared/runMode'
import { formatRemaining } from '@shared/time'
import { blockedRun, planPings, planZones } from '@shared/timeline'
import { remoteIsOn } from '@shared/schedule'
import type { Overview, SessionView } from '@shared/schedule'
import { RUN_MODES } from '@shared/types'
import type { AppSettings, RunMode } from '@shared/types'

import { api } from './api'
import { t, warningText } from './i18n'
import type { Lang } from './i18n'
import { blockedText } from './zoneText'

type Props = { overview: Overview; settings: AppSettings; now: number; version: string; onMessage: (text: string) => void }

// '오늘' | '내일' | '10-21 (수)'
function dayLabel(ms: number | undefined, now: number, lang: AppSettings['language']): string {
  if (ms === undefined) return ''
  const d = new Date(ms); d.setHours(0, 0, 0, 0)
  const n = new Date(now); n.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - n.getTime()) / 86_400_000)
  if (diff === 0) return t(lang, 'today')
  if (diff === 1) return t(lang, 'tomorrow')
  const day = new Date(ms)
  const wd = day.toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-US', { weekday: 'short' })
  return `${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')} (${wd})`
}

export function fmtAt(ms: number | undefined, now: number): string {
  if (ms === undefined) return '—'
  const d = new Date(ms); const n = new Date(now)
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? hm : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}

const DONE_SHOWN = 3   // done rows shown before "n more"
type Done = SessionView['done'][number]
function doneClass(d: Done): string { return d.reason === undefined ? 'muted' : d.reason === 'answer' ? 'ok-text' : 'danger-text' }
function doneIcon(d: Done) { return d.reason === undefined || d.reason === 'answer' ? <CheckCircle2 size={12} /> : <XCircle size={12} /> }
// a done row's hover text: the whole prompt, then the answer's first line (or that no result was recorded)
function doneTitle(d: Done, lang: Lang): string {
  const head = [d.jobId !== undefined ? `#${d.jobId}` : '', d.recurring === undefined ? '' : t(lang, d.recurring ? 'recurring' : 'oneShot')].filter(x => x !== '').join(' · ')
  return [head, d.prompt, d.reason === undefined ? t(lang, 'firedNoRun') : d.answerHead ? `↳ ${d.answerHead}` : ''].filter(x => x !== '').join('\n')
}

// running / stopped, and where it runs: a background session goes on after its window closes or /exit
function StatePill({ alive, runsIn, lang }: { alive: boolean; runsIn?: SessionView['runsIn']; lang: AppSettings['language'] }) {
  if (!alive) return <span className="pill off">{t(lang, 'stopped')}</span>
  if (runsIn === 'background') return <span className="pill ok" title={t(lang, 'runningBgHint')}>{t(lang, 'runningBg')}</span>
  if (runsIn === 'terminal') return <span className="pill ok" title={t(lang, 'runningTermHint')}>{t(lang, 'runningTerm')}</span>
  return <span className="pill ok">{t(lang, 'running')}</span>
}

const MODE_KEY = { quiet: 'modeQuiet', notify: 'modeNotify', open: 'modeOpen' } as const
const MODE_HINT_KEY = { quiet: 'modeQuietHint', notify: 'modeNotifyHint', open: 'modeOpenHint' } as const
const SOURCE_KEY = { job: 'srcJob', session: 'srcSession', default: 'srcDefault' } as const
function modeText(lang: Lang, mode: RunMode): string { return t(lang, MODE_KEY[mode]) }
function modeHint(lang: Lang, mode: RunMode): string { return t(lang, MODE_HINT_KEY[mode]) }
function sourceText(lang: Lang, source: ModeSource): string { return t(lang, SOURCE_KEY[source]) }

// The session's own run mode: 'use default' clears it
function ModePicker({ s, settings }: { s: SessionView; settings: AppSettings }) {
  const lang = settings.language
  const own = settings.runMode.sessions[s.sessionId]
  const choose = (mode: RunMode | undefined) => {
    const sessions = { ...settings.runMode.sessions }
    if (mode === undefined) delete sessions[s.sessionId]; else sessions[s.sessionId] = mode
    void api.setSettings({ runMode: { ...settings.runMode, sessions } })
  }
  return (
    <div className="card-head">
      <span className="muted">{t(lang, 'runMode')}</span>
      <div className="segmented" role="radiogroup" aria-label={t(lang, 'runMode')}>
        <button role="radio" aria-checked={own === undefined} className={own === undefined ? 'on' : ''} title={t(lang, 'modeFollowHint')} onClick={() => choose(undefined)}>
          {t(lang, 'modeFollow')} ({t(lang, 'modeNow')}: {modeText(lang, settings.runMode.default)})
        </button>
        {RUN_MODES.map(m => (
          <button key={m} role="radio" aria-checked={own === m} className={own === m ? 'on' : ''} title={modeHint(lang, m)} onClick={() => choose(m)}>{modeText(lang, m)}</button>
        ))}
      </div>
    </div>
  )
}

const BLOCK_KEY = { terminal: 'stopBlockTerminal', remote: 'stopBlockRemote', running: 'stopBlockRunning' } as const
const WARN_KEY = { blocked: 'stopWarnBlocked', attached: 'stopWarnAttached' } as const

// The main process's answer for the stop and clean-up buttons: it asks claude agents and the attach windows (cleanup.ts).
// enabled = false skips the commands (a session that will not be stopped). again() asks once more after a press.
function useStopCheck(s: SessionView, enabled: boolean): { check?: StopCheck; again: () => void } {
  const [checked, setChecked] = useState<{ sessionId: string; check: StopCheck } | undefined>(undefined)
  const [asked, setAsked] = useState(0)   // bumped to ask again (window focus, after a press)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void api.stopCheck(s.sessionId).then(check => { if (live) setChecked({ sessionId: s.sessionId, check }) })
    return () => { live = false }
  }, [s.sessionId, s.isAlive, s.runsIn, s.running?.firedAt, asked, enabled])
  // closing an attach window or answering the session happens elsewhere: ask again when this window gets focus back
  useEffect(() => {
    const again = () => setAsked(n => n + 1)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])
  return { check: enabled && checked?.sessionId === s.sessionId ? checked.check : undefined, again: () => setAsked(n => n + 1) }
}

// The "stop session" button of a running session (claude stop): off with the reason while it must not be stopped;
// with a warning (waits for an answer, an attach window is open) it asks first through onAsk.
function StopButton({ s, isRemote, lang, onMessage, onAsk }: { s: SessionView; isRemote: boolean; lang: Lang; onMessage: (text: string) => void; onAsk: (warns: StopWarn[]) => void }) {
  const { check, again } = useStopCheck(s, true)
  const block = stopBlock(s, isRemote) ?? check?.block
  const warns = block === undefined ? check?.warns ?? [] : []
  const hint = block !== undefined ? t(lang, BLOCK_KEY[block]) : [t(lang, 'stopHint'), ...warns.map(w => `⚠ ${t(lang, WARN_KEY[w])}`)].join('\n')
  const press = () => {
    if (warns.length > 0) { onAsk(warns); return }
    void api.stopSession(s.sessionId).then(text => { onMessage(text); again() })
  }
  return (
    <button className="btn secondary" disabled={block !== undefined} title={hint} onClick={press}>
      <Power size={14} /> {t(lang, 'stopSession')}
    </button>
  )
}

// The done list's "clean up the list" (shared/cleanup.ts clearHow): a running background session with no job left is
// stopped first, any other session only has its done rows hidden; off while a job runs. Always asks first through onAsk,
// one question that also carries the warnings (why = the reason a running session is only hidden)
function ClearButton({ s, isRemote, lang, onAsk }: { s: SessionView; isRemote: boolean; lang: Lang; onAsk: (how: ClearHow, warns: StopWarn[], why: StopBlock | undefined) => void }) {
  const mayStop = s.isAlive && !s.jobs.some(j => !j.isDismissed)
  const { check } = useStopCheck(s, mayStop)
  const block = mayStop ? stopBlock(s, isRemote) ?? check?.block : undefined
  const how = clearHow(s, block)
  const warns = how === 'stop' ? check?.warns ?? [] : []
  // terminal / remote jobs session: why it is not stopped, then what the button does instead
  const why = block !== undefined && how === 'hide' ? [t(lang, BLOCK_KEY[block])] : []
  const hint = how === undefined ? t(lang, 'stopBlockRunning')
    : [...why, t(lang, how === 'stop' ? 'clearStopHint' : 'clearHideHint'), t(lang, 'doneFade'), ...warns.map(w => `⚠ ${t(lang, WARN_KEY[w])}`)].join('\n')
  return (
    <button className="btn secondary small" disabled={how === undefined} title={hint} onClick={() => { if (how !== undefined) onAsk(how, warns, why.length > 0 ? block : undefined) }}>
      {how === 'stop' ? <Power size={13} /> : <EyeOff size={13} />} {t(lang, 'clearDone')}
    </button>
  )
}

// Where the reopen popover sits: under the clicked id, kept inside the window
type Pop = { s: SessionView; left: number; top: number }
const POP_WIDTH = 440
function popAt(s: SessionView, e: ReactMouseEvent<HTMLElement>): Pop {
  e.stopPropagation()   // the id inside a session row must not also select the row
  const r = e.currentTarget.getBoundingClientRect()
  return { s, left: Math.max(8, Math.min(r.left, window.innerWidth - POP_WIDTH - 8)), top: Math.min(r.bottom + 4, window.innerHeight - 280) }
}

// The session id as a link to the reopen popover
function IdLink({ s, text, lang, onPop }: { s: SessionView; text: string; lang: Lang; onPop: (p: Pop) => void }) {
  return <span role="button" className="mono id-link" title={`${s.sessionId}\n${t(lang, 'reopenIdHint')}`} onClick={e => onPop(popAt(s, e))}>{text}</span>
}

// Copy-only commands that open the session again (shared/reopen.ts); the remote address too while it runs under Remote Control
function ReopenPopover({ pop, remoteUrl, lang, onClose }: { pop: Pop; remoteUrl?: string; lang: Lang; onClose: () => void }) {
  const { kind, commands } = reopenCommands(pop.s)
  const [copied, setCopied] = useState<string | undefined>(undefined)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  useEffect(() => {
    if (copied === undefined) return
    const timer = setTimeout(() => setCopied(undefined), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  const lines = [...commands.map(c => ({ label: c.shell === 'powershell' ? 'PowerShell' : c.shell === 'cmd' ? 'cmd' : undefined, text: c.text })),
    ...(remoteUrl !== undefined ? [{ label: t(lang, 'reopenRemote'), text: remoteUrl }] : [])]
  const kindKey = { attach: 'reopenAttach', resume: 'reopenResume', terminal: 'reopenTerminal' } as const
  return (
    <div className="modal-backdrop clear" onClick={onClose}>
      <div className="modal popover" role="dialog" style={{ left: pop.left, top: pop.top, width: POP_WIDTH }} onClick={e => e.stopPropagation()}>
        <h3><Terminal size={16} /> {t(lang, 'reopenTitle')} <span className="mono muted">{pop.s.shortId}</span></h3>
        <p className="muted small">{t(lang, kindKey[kind])}</p>
        {kind === 'terminal' && <p className="warn-text small"><AlertTriangle size={12} /> {t(lang, 'reopenTwice')}</p>}
        {lines.map(l => (
          <div key={l.text}>
            {l.label !== undefined && <span className="muted small">{l.label}</span>}
            <div className="card-head">
              <div className="modal-what mono grow">{l.text}</div>
              <button className="btn secondary small" onClick={() => { api.copyText(l.text); setCopied(l.text) }}>
                {copied === l.text ? <><Check size={13} /> {t(lang, 'copied')}</> : <><Copy size={13} /> {t(lang, 'copy')}</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionRow({ s, selected, now, lang, onSelect, onPop }: { s: SessionView; selected: boolean; now: number; lang: Lang; onSelect: () => void; onPop: (p: Pop) => void }) {
  const live = s.jobs.filter(j => !j.isDismissed).length
  // nothing scheduled any more, kept for what it did in the last 7 days
  const isDoneOnly = s.jobs.length === 0
  return (
    <button className={`session ${selected ? 'selected' : ''} ${s.isAlive ? '' : 'stopped'} ${isDoneOnly ? 'done-only' : ''}`} onClick={onSelect}>
      <span className={`state-dot ${s.isAlive ? 'ok' : 'off'}`} />
      <span className="session-main">
        <span className="session-title">
          <span className="ellipsis">{s.label}</span>
          {s.warnings.length > 0 && <AlertTriangle size={13} color="var(--warn)" />}
          <span className="grow" />
          <span className="count">{isDoneOnly ? `${t(lang, 'doneShort')} ${s.done.length}` : live}</span>
        </span>
        <span className="session-sub">
          <IdLink s={s} text={s.shortId} lang={lang} onPop={onPop} />
          <span>·</span>
          <span>{fmtAt(s.nextAt, now)}{s.nextAt !== undefined && s.nextAt > now ? ` (${formatRemaining(s.nextAt, now)})` : ''}</span>
        </span>
      </span>
    </button>
  )
}

export function SchedulePanel({ overview, settings, now, version, onMessage }: Props) {
  const lang = settings.language
  // Claude Code's own wording when it gave one, otherwise the cron read into words
  const schedText = (j: SessionView['jobs'][number]) => (j.humanSchedule !== j.cron ? j.humanSchedule : describeCron(j.cron, lang))
  // jobs that run in the hours that affect the work day (09:00 start → 04:00 ~ 09:00) are drawn in red
  const { workHours, alignPing } = settings
  const zones = useMemo(() => planZones(workHours, planPings(workHours, alignPing.resetHours), alignPing.enabled), [workHours, alignPing])
  const blockedOf = (j: SessionView['jobs'][number]) => (j.isDismissed ? undefined : blockedRun(j.cron, zones, workHours.weekdays, now))
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  // delete flow: ask → the session deletes it → say which job went, and ask whether to stop the session.
  // stop = the stop button with a warning; clear = the done list's clean-up; tidy = the footer's "clean up done" list;
  // remote = the monitor button while the remote jobs session runs (open it or turn it off)
  type TidyRow = TidyTarget & { check: StopCheck }
  type Ask = { step: 'confirm'; sessionId: string; job: SessionView['jobs'][number] } | { step: 'busy'; title: string; what: string } | { step: 'done'; sessionId: string; ok: boolean; text: string; canStop: boolean }
    | { step: 'stop'; s: SessionView; warns: StopWarn[] } | { step: 'clear'; s: SessionView; how: ClearHow; warns: StopWarn[]; why?: StopBlock }
    | { step: 'tidy'; rows: TidyRow[] } | { step: 'remote' }
  const [ask, setAsk] = useState<Ask | undefined>(undefined)
  const jobText = (j: SessionView['jobs'][number]) => `[${j.id}] ${schedText(j)} · ${j.prompt.replace(/\s+/g, ' ').slice(0, 60)}`
  const runDelete = async (sessionId: string, j: SessionView['jobs'][number]) => {
    setAsk({ step: 'busy', title: t(lang, 'deleting'), what: jobText(j) })
    const r = await api.deleteJob(sessionId, j.id)
    setAsk({ step: 'done', sessionId, ...r })
  }
  const [pop, setPop] = useState<Pop | undefined>(undefined)
  const closePop = useCallback(() => setPop(undefined), [])
  const [doneOpen, setDoneOpen] = useState<Record<string, boolean>>({})   // sessionId → done list unfolded (default: open only when no job is left)
  const [doneAll, setDoneAll] = useState<Record<string, boolean>>({})     // sessionId → every done row, not just the newest DONE_SHOWN
  const [doneOnlyOpen, setDoneOnlyOpen] = useState(false)                // the left list's "sessions with only done jobs" group
  const selected = overview.sessions.find(s => s.sessionId === selectedId) ?? overview.sessions[0]
  const running = overview.sessions.filter(s => s.isAlive).length
  const isRemote = selected !== undefined && overview.remote?.sessionId === selected.sessionId
  const withJobs = overview.sessions.filter(s => s.jobs.length > 0)
  const doneOnly = overview.sessions.filter(s => s.jobs.length === 0)
  const tidy = tidyList(overview.sessions, overview.remote?.sessionId)
  const remoteOn = remoteIsOn(overview.remote)   // the remote jobs session is on and runs: the monitor button asks open / turn off
  const askTidy = async () => {
    setAsk({ step: 'busy', title: t(lang, 'tidyAll'), what: t(lang, 'tidyChecking') })
    // only the ones to stop need the commands; a stopped one is only hidden
    const checks = await Promise.all(tidy.map(r => (r.stop ? api.stopCheck(r.s.sessionId) : Promise.resolve<StopCheck>({ warns: [] }))))
    setAsk({ step: 'tidy', rows: tidy.map((r, i) => ({ ...r, check: checks[i] ?? { warns: [] } })) })
  }
  const runTidy = async (rows: TidyRow[]) => {
    const ids = rows.filter(r => r.check.block === undefined).map(r => r.s.sessionId)
    setAsk({ step: 'busy', title: t(lang, 'tidyBusy'), what: rows.map(r => `${r.s.label} · ${r.s.shortId}`).join(', ') })
    const text = await api.tidyDone(ids)
    setAsk({ step: 'done', sessionId: '', ok: true, text, canStop: false })
  }
  const remoteUrlOf = (s: SessionView) => s.remoteUrl ?? (overview.remote?.sessionId === s.sessionId ? overview.remote.url : undefined)
  const sessionRow = (s: SessionView) => <SessionRow key={s.sessionId} s={s} selected={s.sessionId === selected?.sessionId} now={now} lang={lang} onSelect={() => setSelectedId(s.sessionId)} onPop={setPop} />

  return (
    <div className="panel-wrap">
    <div className="panel">
      <aside className="sessions">
        <div className="sessions-head">
          <span>{t(lang, 'sessions')}</span>
          <span className="muted">{running} {t(lang, 'running')} · {overview.sessions.length - running} {t(lang, 'stopped')}</span>
        </div>
        {overview.sessions.length === 0 && (
          <div className="empty"><CalendarClock size={28} /><span>{t(lang, 'noJobsAnywhere')}</span><span className="muted small">{t(lang, 'noJobsHint')}</span></div>
        )}
        {withJobs.map(sessionRow)}
        {/* nothing scheduled any more, kept for what it did in the last 7 days: folded into one group at the bottom */}
        {doneOnly.length > 0 && (
          <button className="session done-group" aria-expanded={doneOnlyOpen} onClick={() => setDoneOnlyOpen(v => !v)}>
            {doneOnlyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="session-main"><span className="session-title"><span className="ellipsis">{t(lang, 'doneOnlyGroup')}</span><span className="grow" /><span className="count">{doneOnly.length}</span></span></span>
          </button>
        )}
        {doneOnlyOpen && doneOnly.map(sessionRow)}
      </aside>
      <section className="detail">
        {selected === undefined ? (
          <div className="empty big"><CalendarClock size={40} /><span>{t(lang, 'noJobsAnywhere')}</span></div>
        ) : (
          <>
            <header className="detail-head">
              <div className="detail-id">
                <div className="detail-title">
                  <span className="ellipsis">{selected.label}</span>
                  <StatePill alive={selected.isAlive} runsIn={selected.runsIn} lang={lang} />
                  {selected.source === 'transcript' && <span className="pill">{t(lang, 'fromTranscript')}</span>}
                  {selected.running !== undefined && <span className="pill warn" title={selected.running.promptHead}>▶ {t(lang, 'runningNow')}</span>}
                </div>
                <div className="detail-sub">
                  <IdLink s={selected} text={selected.sessionId} lang={lang} onPop={setPop} />
                  <span className="ellipsis" title={selected.cwd}><FolderOpen size={12} /> {selected.cwd}</span>
                  {selected.name ? <span className="ellipsis" title={selected.name}>{selected.name}</span> : null}
                </div>
              </div>
              <div className="actions">
                {!selected.isAlive && (
                  <button className="btn primary" disabled={selected.warnings.length > 0} title={selected.warnings.map(w => warningText(lang, w)).join(', ')} onClick={() => { onMessage(t(lang, 'reviving')); void api.reviveSession(selected.sessionId).then(onMessage) }}>
                    <Play size={14} /> {t(lang, 'revive')}
                  </button>
                )}
                {selected.isAlive && (
                  <button className="btn secondary" onClick={() => { void api.attachSession(selected.sessionId).then(onMessage) }}><Terminal size={14} /> {t(lang, 'attach')}</button>
                )}
                {/* no job left and a done list: the done list's "clean up the list" stops it instead (one stop button on screen) */}
                {selected.isAlive && (selected.done.length === 0 || selected.jobs.some(j => !j.isDismissed)) && <StopButton s={selected} isRemote={isRemote} lang={lang} onMessage={onMessage} onAsk={warns => setAsk({ step: 'stop', s: selected, warns })} />}
                {/* already attached to Remote Control (the remote jobs session did it): a shortcut to its address */}
                {selected.remoteUrl !== undefined && (
                  <button className="btn secondary" onClick={() => api.openExternal(selected.remoteUrl as string)}><ExternalLink size={14} /> {t(lang, 'onPhone')}</button>
                )}
              </div>
            </header>
            {selected.source === 'plugin' && <ModePicker s={selected} settings={settings} />}
            {selected.warnings.length > 0 && (
              <div className="banner warn"><AlertTriangle size={15} /> <span><b>{t(lang, 'notTrusted')}</b> — {selected.warnings.map(w => warningText(lang, w)).join(', ')}</span></div>
            )}
            <div className="cards">
              {selected.jobs.map(j => { const blocked = blockedOf(j); const run = effectiveMode(j.mode, selected.sessionId, settings.runMode); return (
                <article key={j.id} className={`card with-time ${j.isDismissed ? 'dismissed' : ''} ${j.isExpiringSoon && !j.isDismissed ? 'expiring' : ''} ${blocked !== undefined ? 'blocked' : ''}`}>
                  <div className="card-time">
                    <span className="card-time-hm">{j.nextAt === undefined ? '—' : new Date(j.nextAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    <span className="card-time-day">{dayLabel(j.nextAt, now, lang)}</span>
                    {j.nextAt !== undefined && j.nextAt > now && <span className="card-time-left">{formatRemaining(j.nextAt, now)} {t(lang, 'later')}</span>}
                  </div>
                  <div className="card-body">
                  <div className="card-head">
                    <span className="card-sched">{schedText(j)}</span>
                    <span className="pill">{j.recurring ? t(lang, 'recurring') : t(lang, 'oneShot')}</span>
                    {j.isDismissed && <span className="pill off">{t(lang, 'hidden')}</span>}
                    {selected.source === 'plugin' && <span className="pill" title={modeHint(lang, run.mode)}>{modeText(lang, run.mode)} · {sourceText(lang, run.source)}</span>}
                    <span className="grow" />
                    {schedText(j) !== j.cron && <span className="mono muted small" title="cron">{j.cron}</span>}
                    <button className="btn ghost tiny danger-text" title={t(lang, 'deleteAsk')} onClick={() => setAsk({ step: 'confirm', sessionId: selected.sessionId, job: j })}><Trash2 size={12} /> {t(lang, 'deleteJob')}</button>
                    {!selected.isAlive && (
                      <button className="btn ghost tiny" onClick={() => { void api.hideJob(j.id).then(onMessage) }} title={j.isDismissed ? t(lang, 'unhideHint') : t(lang, 'hideHint')}>
                        {j.isDismissed ? <><Eye size={12} /> {t(lang, 'unhide')}</> : <><EyeOff size={12} /> {t(lang, 'hide')}</>}
                      </button>
                    )}
                  </div>
                  {blocked !== undefined && <div className="banner danger small"><Ban size={14} /> <span>{blockedText(blocked.zone, zones, workHours.start, lang)}</span></div>}
                  <div className="card-meta">
                    {j.expiresInDays !== undefined && <span className={`meta ${j.isExpiringSoon ? 'warn-text' : 'muted'}`}><Hourglass size={12} /> {t(lang, 'expires')} {j.expiresInDays}{t(lang, 'days')}</span>}
                    {j.lastRun !== undefined && (
                      <span className={`meta ${j.lastRun.reason === 'answer' ? 'ok-text' : 'danger-text'}`}>
                        {j.lastRun.reason === 'answer' ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {t(lang, 'lastRun')} {fmtAt(j.lastRun.finishedAt, now)} · {Math.round(j.lastRun.durationMs / 1000)}s
                      </span>
                    )}
                    <span className="grow" />
                    <span className="mono muted small">#{j.id}</span>
                  </div>
                  <div className="card-prompt-box"><div className="card-prompt" title={j.prompt}>{j.prompt.replace(/\s+/g, ' ')}</div></div>
                  {j.lastRun?.answerHead ? <div className="card-answer">↳ {j.lastRun.answerHead}</div> : null}
                  </div>
                </article>
              ) })}
            </div>
            {selected.done.length > 0 && (() => {
              // folded while jobs are left (the cards above matter more); one line per run, the newest DONE_SHOWN first
              const open = doneOpen[selected.sessionId] ?? selected.jobs.length === 0
              const all = doneAll[selected.sessionId] === true
              const rows = all ? selected.done : selected.done.slice(0, DONE_SHOWN)
              const last = selected.done[0]
              return (
                <div className="cards">
                  <div className="card-head">
                    <button className="btn ghost tiny" aria-expanded={open} onClick={() => setDoneOpen(m => ({ ...m, [selected.sessionId]: !open }))}>
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <CheckCheck size={13} /> {t(lang, 'doneTitle')} <span className="muted">{selected.done.length}</span>
                    </button>
                    {!open && last !== undefined && <span className={`meta small ${doneClass(last)}`}>{t(lang, 'doneLast')} {fmtAt(last.at, now)} {doneIcon(last)}</span>}
                    <span className="grow" />
                    <ClearButton s={selected} isRemote={isRemote} lang={lang} onAsk={(how, warns, why) => setAsk({ step: 'clear', s: selected, how, warns, why })} />
                    <button className="btn secondary small" title={t(lang, 'openSessionHint')} onClick={() => { void api.openSession(selected.sessionId).then(onMessage) }}><Terminal size={13} /> {t(lang, 'openSession')}</button>
                  </div>
                  {open && <p className="muted small">{t(lang, 'doneFade')}</p>}
                  {open && (
                    <div className="card">
                      {rows.map(d => (
                        <div key={`${d.at}-${d.jobId ?? ''}`} className="card-head small" title={doneTitle(d, lang)}>
                          <span className={`meta mono ${doneClass(d)}`}>{doneIcon(d)} {fmtAt(d.at, now)}</span>
                          <span className="mono muted">{d.durationMs !== undefined ? `${Math.round(d.durationMs / 1000)}s` : '—'}</span>
                          <span className="ellipsis grow muted">{d.prompt.replace(/\s+/g, ' ')}</span>
                        </div>
                      ))}
                      {selected.done.length > DONE_SHOWN && (
                        <div><button className="btn ghost tiny" onClick={() => setDoneAll(m => ({ ...m, [selected.sessionId]: !all }))}>
                          {all ? t(lang, 'doneLess') : `${selected.done.length - DONE_SHOWN}${t(lang, 'doneMore')}`}
                        </button></div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </section>
    </div>
    {ask !== undefined && (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal">
          {ask.step === 'confirm' && <>
            <h3><Trash2 size={16} /> {t(lang, 'deleteAsk')}</h3>
            <div className="modal-what mono">{jobText(ask.job)}</div>
            <p className="muted small">{t(lang, 'deleteHow')}</p>
            <div className="actions end">
              <button className="btn ghost small" onClick={() => setAsk(undefined)}>{t(lang, 'cancel')}</button>
              <button className="btn danger small" onClick={() => { void runDelete(ask.sessionId, ask.job) }}>{t(lang, 'deleteYes')}</button>
            </div>
          </>}
          {ask.step === 'busy' && <>
            <h3>{ask.title}</h3>
            <div className="modal-what mono">{ask.what}</div>
          </>}
          {ask.step === 'stop' && <>
            <h3><Power size={16} /> {t(lang, 'stopWarnAsk')}</h3>
            <div className="modal-what mono">{ask.s.label} · {ask.s.shortId}</div>
            {ask.warns.map(w => <p key={w} className="warn-text"><AlertTriangle size={13} /> {t(lang, WARN_KEY[w])}</p>)}
            <div className="actions end">
              <button className="btn ghost small" onClick={() => setAsk(undefined)}>{t(lang, 'cancel')}</button>
              <button className="btn danger small" onClick={() => { const target = ask.s; setAsk(undefined); void api.stopSession(target.sessionId, true).then(onMessage) }}><Power size={13} /> {t(lang, 'stopWarnYes')}</button>
            </div>
          </>}
          {ask.step === 'clear' && <>
            <h3>{ask.how === 'stop' ? <Power size={16} /> : <EyeOff size={16} />} {t(lang, ask.how === 'stop' ? 'clearWarnAsk' : 'clearAsk')}</h3>
            <div className="modal-what">
              <div>{ask.s.label}{ask.s.name ? ` · ${ask.s.name}` : ''}</div>
              <div className="mono muted">{ask.s.sessionId}</div>
            </div>
            {ask.why !== undefined && <p className="muted small">{t(lang, BLOCK_KEY[ask.why])}</p>}
            <p className="meta">{ask.how === 'stop' ? <Power size={13} /> : <EyeOff size={13} />} {t(lang, ask.how === 'stop' ? 'clearStopHint' : 'clearHideHint')}</p>
            {ask.warns.map(w => <p key={w} className="warn-text"><AlertTriangle size={13} /> {t(lang, WARN_KEY[w])}</p>)}
            <p className="muted small">{t(lang, 'doneFade')}</p>
            <div className="actions end">
              <button className="btn ghost small" onClick={() => setAsk(undefined)}>{t(lang, 'cancel')}</button>
              {/* confirmed only when warnings were shown here: one that came up after the check is asked again (cleanup.ts clearSession) */}
              <button className="btn danger small" onClick={() => { const { s: target, warns } = ask; setAsk(undefined); void api.clearSession(target.sessionId, warns.length > 0).then(onMessage) }}>
                {ask.how === 'stop' ? <Power size={13} /> : <EyeOff size={13} />} {t(lang, ask.how === 'stop' ? 'clearWarnYes' : 'clearYes')}
              </button>
            </div>
          </>}
          {ask.step === 'remote' && <>
            <h3><Smartphone size={16} /> {t(lang, 'remoteOnAsk')}</h3>
            <div className="modal-what">
              <div>{t(lang, 'remoteBar')}</div>
              {overview.remote?.sessionId !== undefined && <div className="mono muted">{overview.remote.sessionId}</div>}
            </div>
            <p className="muted small">{t(lang, 'remoteOffHow')}</p>
            <div className="actions end">
              <button className="btn ghost small" onClick={() => setAsk(undefined)}>{t(lang, 'cancel')}</button>
              <button className="btn danger small" onClick={() => { setAsk(undefined); void api.stopMonitor().then(onMessage) }}><Power size={13} /> {t(lang, 'remoteOff')}</button>
              <button className="btn primary small" onClick={() => { setAsk(undefined); void api.openMonitor().then(onMessage) }}><ExternalLink size={13} /> {t(lang, 'onPhone')}</button>
            </div>
          </>}
          {ask.step === 'tidy' && <>
            <h3><EyeOff size={16} /> {t(lang, 'tidyAsk')}</h3>
            <div className="modal-what">
              {ask.rows.map(r => (
                <div key={r.s.sessionId} className="card-head small">
                  <span className="mono">{r.s.shortId}</span>
                  <span className="ellipsis">{r.s.label}{r.s.name ? ` · ${r.s.name}` : ''}</span>
                  <span className="grow" />
                  {r.check.block !== undefined
                    ? <span className="muted">{t(lang, 'tidySkip')}: {t(lang, BLOCK_KEY[r.check.block])}</span>
                    : <>
                      {r.check.warns.map(w => <span key={w} className="meta warn-text"><AlertTriangle size={12} /> {t(lang, WARN_KEY[w])}</span>)}
                      <span className="meta muted">{r.stop ? <Power size={12} /> : <EyeOff size={12} />} {t(lang, r.stop ? 'tidyStopRow' : 'tidyHideRow')}</span>
                    </>}
                </div>
              ))}
            </div>
            <p className="muted small">{t(lang, 'doneFade')}</p>
            <div className="actions end">
              <button className="btn ghost small" onClick={() => setAsk(undefined)}>{t(lang, 'cancel')}</button>
              <button className="btn danger small" disabled={ask.rows.every(r => r.check.block !== undefined)} onClick={() => { void runTidy(ask.rows) }}><EyeOff size={13} /> {t(lang, 'tidyYes')}</button>
            </div>
          </>}
          {ask.step === 'done' && <>
            <h3 className={ask.ok ? 'ok-text' : 'warn-text'}>{ask.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {ask.text}</h3>
            {ask.ok && ask.canStop && <p>{t(lang, 'stopAsk')}</p>}
            <div className="actions end">
              {ask.ok && ask.canStop ? <>
                <button className="btn ghost small" onClick={() => setAsk(undefined)}>{t(lang, 'stopNo')}</button>
                <button className="btn danger small" onClick={() => { const id = ask.sessionId; setAsk(undefined); void api.stopSession(id).then(onMessage) }}><Power size={13} /> {t(lang, 'stopYes')}</button>
              </> : <button className="btn primary small" onClick={() => setAsk(undefined)}>{t(lang, 'closeDialog')}</button>}
            </div>
          </>}
        </div>
      </div>
    )}
    {pop !== undefined && <ReopenPopover key={pop.s.sessionId} pop={pop} remoteUrl={remoteUrlOf(pop.s)} lang={lang} onClose={closePop} />}
    <footer className="panel-footer">
      <span className="muted small">clock-out v{version}</span>
      <span className="grow" />
      {/* every finished session at once: running background ones are stopped, all are cleaned off the list (tidyList) */}
      <button className="btn secondary small" disabled={tidy.length === 0} title={t(lang, tidy.length === 0 ? 'tidyNone' : 'tidyHint')} onClick={() => { void askTidy() }}>
        <EyeOff size={13} /> {t(lang, 'tidyAll')}{tidy.length > 0 ? ` ${tidy.length}` : ''}
      </button>
      {/* the remote jobs session: see and manage every job by chat from the phone */}
      {/* while it runs it asks: open it or turn it off; otherwise it turns it on (if off) and opens it */}
      <button className="btn primary small" title={remoteOn ? t(lang, 'monitorOnHint') : t(lang, 'monitorHint')} onClick={() => { if (remoteOn) setAsk({ step: 'remote' }); else void api.openMonitor().then(onMessage) }}>
        <Smartphone size={13} /> {t(lang, 'monitor')}{remoteOn && <span className="dot ok" />}
      </button>
      <button className="btn secondary small" onClick={() => api.openSetup()}><Plug size={13} /> {t(lang, 'setupCheck')}</button>
      <button className="btn secondary small" onClick={() => api.openSettings()}><SettingsIcon size={13} /> {t(lang, 'settings')}</button>
      <button className="btn secondary small" onClick={() => api.openGuide()}><BookOpen size={13} /> {t(lang, 'guideShort')}</button>
    </footer>
    </div>
  )
}

// The panel's own window (?view=panel), docked under the status bar: a slim draggable title row with close,
// the panel, and the toast for this window's actions
export function PanelWindow({ overview, settings, now, version, message, onMessage }: Props & { message: string }) {
  const lang = settings.language
  return (
    <div className="panel-window">
      <div className="panel-title">
        <span className="drag-area">{t(lang, 'schedule')} <span className="muted">· {overview.jobCount}</span></span>
        <button className="btn icon close" title={t(lang, 'close')} onClick={() => api.setExpanded(false)}><X size={15} /></button>
      </div>
      <SchedulePanel overview={overview} settings={settings} now={now} version={version} onMessage={onMessage} />
      {message !== '' && <div className="toast">{message}</div>}
    </div>
  )
}

import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { Overview } from '@shared/schedule'
import { formatRemaining, isAlignedReset } from '@shared/time'
import { planPings } from '@shared/timeline'
import type { AppSettings, UsageState, UsageWindow } from '@shared/types'

import { api } from './api'
import { t } from './i18n'
import { fmtAt } from './SchedulePanel'

type Props = {
  usage: UsageState; settings: AppSettings; overview: Overview; expanded: boolean; now: number; version: string
  onToggle: () => void; onQuit: () => void
}

// A bar's colour: red from 80 %, orange from 50 %, green below
function tone(percent: number): 'ok' | 'warn' | 'danger' {
  if (percent >= 80) return 'danger'
  if (percent >= 50) return 'warn'
  return 'ok'
}

function Window({ row, now, boundaries, lang }: { row: UsageWindow; now: number; boundaries: number[]; lang: AppSettings['language'] }) {
  const resetAt = row.resetsAt !== undefined ? Date.parse(row.resetsAt) : undefined
  const aligned = resetAt === undefined || row.key !== 'five_hour' || isAlignedReset(resetAt, boundaries)
  const label = row.key === 'five_hour' ? t(lang, 'fiveHour') : row.key === 'seven_day' ? t(lang, 'sevenDay') : `${row.label} ${t(lang, 'weekly')}`
  // the reset time shows on hover only (today: 12:59, another day: 10-24 05:00); the bar keeps the time left
  const resetText = resetAt === undefined ? '' : `${label} · ${lang === 'ko' ? `${fmtAt(resetAt, now)} 에 초기화` : `resets ${fmtAt(resetAt, now)}`}${aligned ? '' : ` (${t(lang, 'offBoundary')})`}`
  return (
    <span className="cell" title={resetAt === undefined ? label : resetText}>
      <span className="label">{label}</span>
      <span className="bar"><span className={`fill ${row.isCritical === true ? 'danger' : tone(row.percent)}`} style={{ width: `${Math.min(100, row.percent)}%` }} /></span>
      <span className={`pct ${row.isCritical === true ? 'danger-text' : ''}`}>{row.percent}%</span>
      {resetAt !== undefined && (
        <span className={`reset ${aligned ? '' : 'warn-text'}`}>{formatRemaining(resetAt, now)}</span>
      )}
    </span>
  )
}

export function StatusBar({ usage, settings, overview, expanded, now, version, onToggle, onQuit }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // The window follows the bar's natural width: the info row's own width (max-content, never stretched by the
  // window) plus the buttons, the paddings and the gap, rounded up with slack for fractional DPI scaling.
  // Sent while expanded too, so the panel is never narrower than the bar and its buttons are never cut off.
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const info = el.querySelector('.drag-inner') as HTMLElement | null
    const actions = el.querySelector('.strip-actions') as HTMLElement | null
    if (info === null || actions === null) return
    const fit = () => api.setStripWidth(Math.ceil(info.getBoundingClientRect().width + actions.getBoundingClientRect().width) + 12 + 4 + 8 + 2 + 4)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(info)
    ro.observe(actions)
    return () => ro.disconnect()
  })
  const lang = settings.language
  const plan = { boundaries: planPings(settings.workHours, settings.alignPing.resetHours).targets.map(m => Math.round(m / 60)) }
  const dot = usage.rows.length === 0 ? 'dim' : usage.isWaiting || usage.status !== '' ? 'warn' : 'ok'
  const fetched = usage.fetchedAt !== undefined ? new Date(usage.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  const next = overview.nextSession

  return (
    // refresh, remote monitor, settings, setup check and the guide are on the right-click menu (main process, strip:menu)
    <div className="strip" ref={ref} title={t(lang, 'stripMenuHint')} onContextMenu={e => { e.preventDefault(); api.showStripMenu() }}>
      <div className="strip-measure">
        <span className="drag">
         <span className="drag-inner">
          <span className={`dot ${dot}`} title={[usage.isWaiting ? `${t(lang, 'waiting')} ${usage.status.replace('waiting until ', '')}` : usage.status, fetched !== '' ? `${fetched} ${t(lang, 'refreshed')}` : ''].filter(x => x !== '').join(' · ') || 'ok'} />
          <span className="brand" title={`clock-out v${version}
${t(lang, 'stripMenuHint')}`}>Claude</span>
          {settings.permission.mode === 'bypass' && <span className="pill danger" title="bypass permissions on">bypass</span>}
          {usage.rows.length === 0 && <span className="muted">{usage.status || t(lang, 'loading')}</span>}
          {usage.rows.map(row => <Window key={row.key} row={row} now={now} boundaries={plan.boundaries} lang={lang} />)}
          <span className="cell">
            <span className="label">{t(lang, 'nextJob')}</span>
            {next === undefined ? <span className="muted">—</span> : <span className="next-pill"><b>{fmtAt(next.nextAt, now)}</b> <span>{next.label}</span></span>}
          </span>
         </span>
        </span>
        <span className="strip-actions">
          <button className={`btn jobs ${expanded ? 'active' : ''}`} title={t(lang, 'schedule')} onClick={onToggle}>
            {t(lang, 'schedule')}
            {overview.jobCount > 0 && <span className="badge">{overview.jobCount}</span>}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button className="btn icon close" title={t(lang, 'close')} onClick={onQuit}><X size={15} /></button>
        </span>
      </div>
    </div>
  )
}

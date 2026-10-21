import { ChevronDown, ChevronUp, GripVertical, Smartphone, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { remoteStage } from '@shared/schedule'
import type { Overview, RemoteStage } from '@shared/schedule'
import { formatDayTime, formatRemaining, isAlignedReset } from '@shared/time'
import { planPings } from '@shared/timeline'
import type { AppSettings, UsageState, UsageWindow } from '@shared/types'

import { api } from './api'
import { fill, t } from './i18n'
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

// stale: the last fetch failed, so the bar shows older values faded with this line first on hover
function Window({ row, now, boundaries, lang, stale }: { row: UsageWindow; now: number; boundaries: number[]; lang: AppSettings['language']; stale?: string }) {
  const resetAt = row.resetsAt !== undefined ? Date.parse(row.resetsAt) : undefined
  const aligned = resetAt === undefined || row.key !== 'five_hour' || isAlignedReset(resetAt, boundaries)
  const label = row.key === 'five_hour' ? t(lang, 'fiveHour') : row.key === 'seven_day' ? t(lang, 'sevenDay') : `${row.label} ${t(lang, 'weekly')}`
  // the reset time shows on hover only (10/24(토) 05:00); the bar keeps the time left
  const resetText = resetAt === undefined ? '' : `${label} · ${lang === 'ko' ? `${formatDayTime(resetAt, lang)} 에 초기화` : `resets ${formatDayTime(resetAt, lang)}`}${aligned ? '' : ` (${t(lang, 'offBoundary')})`}`
  return (
    <span className={`cell ${stale !== undefined ? 'stale' : ''}`} title={[stale, resetAt === undefined ? label : resetText].filter(x => x !== undefined).join('\n')}>
      <span className="label">{label}</span>
      <span className="bar"><span className={`fill ${row.isCritical === true ? 'danger' : tone(row.percent)}`} style={{ width: `${Math.min(100, row.percent)}%` }} /></span>
      <span className={`pct ${row.isCritical === true ? 'danger-text' : ''}`}>{row.percent}%</span>
      {resetAt !== undefined && (
        <span className={`reset ${aligned ? '' : 'warn-text'}`}>{formatRemaining(resetAt, now)}</span>
      )}
    </span>
  )
}

const STAGE = {
  on: { tone: 'ok', text: 'remoteStageOn', hint: 'remoteStageOnHint' },
  address: { tone: 'warn', text: 'remoteStageAddress', hint: 'remoteStageAddressHint' },
  starting: { tone: 'warn', text: 'remoteStageStarting', hint: 'remoteStageStartingHint' },
  error: { tone: 'danger', text: 'remoteStageError', hint: 'remoteStageErrorHint' },
} as const satisfies Record<RemoteStage, { tone: string; text: string; hint: string }>

export function StatusBar({ usage, settings, overview, expanded, now, version, onToggle, onQuit }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // The window follows the bar's natural width: the info row's own width (max-content, never stretched by the
  // window) plus the buttons, the paddings and the gap, rounded up with slack for fractional DPI scaling.
  // Sent while expanded too, so the panel is never narrower than the bar and its buttons are never cut off.
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const info = el.querySelector('.drag-inner') as HTMLElement | null
    const grip = el.querySelector('.grip') as HTMLElement | null
    const actions = el.querySelector('.strip-actions') as HTMLElement | null
    if (info === null || grip === null || actions === null) return
    const fit = () => api.setStripWidth(Math.ceil(grip.getBoundingClientRect().width + 6 + info.getBoundingClientRect().width + actions.getBoundingClientRect().width) + 6 + 4 + 8 + 2 + 4)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(info)
    ro.observe(actions)
    return () => ro.disconnect()
  })
  // dragging by any spot but the buttons: moves only after 4 px, so a plain click (the remote cell) still clicks
  const drag = useRef<{ x: number; y: number; moving: boolean } | undefined>(undefined)
  const dragged = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') !== null) return
    drag.current = { x: e.screenX, y: e.screenY, moving: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d === undefined) return
    const dx = e.screenX - d.x; const dy = e.screenY - d.y
    if (!d.moving && Math.abs(dx) + Math.abs(dy) < 4) return
    if (!d.moving) { d.moving = true; api.dragStrip('start') }
    api.dragStrip('move', dx, dy)
  }
  const onPointerUp = () => {
    if (drag.current?.moving === true) { api.dragStrip('end'); dragged.current = true }
    drag.current = undefined
  }
  const lang = settings.language
  const plan ={ boundaries: planPings(settings.workHours, settings.alignPing.resetHours).targets.map(m => Math.round(m / 60)) }
  const dot = usage.rows.length === 0 ? 'dim' : usage.isWaiting || usage.status !== '' ? 'warn' : 'ok'
  const fetched = usage.fetchedAt !== undefined ? new Date(usage.fetchedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  const next = overview.nextSession
  const stale = usage.isStale === true && usage.rows.length > 0 ? fill(t(lang, 'usageStale'), { at: fetched || '—' }) : undefined
  const stage = remoteStage(overview.remote)

  return (
    // refresh, remote monitor, settings, setup check and the guide are on the right-click menu (main process, strip:menu)
    <div className="strip" ref={ref} title={t(lang, 'stripMenuHint')} onContextMenu={e => { e.preventDefault(); api.showStripMenu() }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onClickCapture={e => { if (dragged.current) { dragged.current = false; e.stopPropagation() } }}>
      <div className="strip-measure">
        {/* the info row stays outside the drag region (a drag region takes no hover or right-click, so the reset-time
            tooltips and the menu would not show): the grip is a native drag region, the rest moves by onPointerMove */}
        <span className="drag">
         <span className="grip"><GripVertical size={14} /></span>
         <span className="drag-inner">
          <span className={`dot ${dot}`} title={[usage.isWaiting ? `${t(lang, 'waiting')} ${usage.status.replace('waiting until ', '')}` : usage.status, fetched !== '' ? `${fetched} ${t(lang, 'refreshed')}` : ''].filter(x => x !== '').join(' · ') || 'ok'} />
          <span className="brand" title={`clock-out v${version}
${t(lang, 'stripMenuHint')}`}>Claude</span>
          {settings.permission.mode === 'bypass' && <span className="pill danger" title="bypass permissions on">bypass</span>}
          {usage.rows.length === 0 && <span className="muted">{usage.status || t(lang, 'loading')}</span>}
          {usage.rows.map(row => <Window key={row.key} row={row} now={now} boundaries={plan.boundaries} lang={lang} stale={stale} />)}
          <span className="cell">
            <span className="label">{t(lang, 'nextJob')}</span>
            {next === undefined ? <span className="muted">—</span> : <span className="next-pill"><b>{fmtAt(next.nextAt, now)}</b> <span>{next.label}</span></span>}
          </span>
          {/* the remote jobs session in words, not by colour alone; clicking opens it (the same as the menu's open item) */}
          {stage !== undefined && (
            <span className="cell" title={fill(t(lang, STAGE[stage].hint), { error: overview.remote?.error ?? '' })} onClick={() => { void api.openMonitor() }}>
              <span className={`pill ${STAGE[stage].tone}`}><Smartphone size={12} />&nbsp;{t(lang, STAGE[stage].text)}</span>
            </span>
          )}
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

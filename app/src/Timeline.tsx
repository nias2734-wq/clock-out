import { AlertTriangle, Ban, Briefcase, CalendarCheck, CalendarClock, Moon, RotateCcw, Sun, Users, Utensils, Zap } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import type { Overview } from '@shared/schedule'
import { analyzeDay, hm, occurrencesOn, planPings, planZones, rangesOf } from '@shared/timeline'
import type { DayJob, UsageWindow, Zone } from '@shared/timeline'
import { parseHm } from '@shared/time'
import type { AppSettings } from '@shared/types'

import { blockedText } from './zoneText'

// One work day on a 24-hour line, to answer "when can my scheduled jobs run without spoiling my work day?"
// Rows: what a job does to the work day at each time (no effect / affects work / shares my limit) → the 5-hour token windows → my work day → today's jobs.
// The rows carry short labels and times; longer explanations are in the hover tooltip.

type Lang = AppSettings['language']
const DAY = 1440
const WORK_DAYS = { yesterday: true, today: true }   // always drawn as a work day: this is the plan, not a calendar
const clampMin = (m: number) => Math.min(Math.max(m, 0), DAY)
const pct = (m: number) => `${(clampMin(m) / DAY) * 100}%`
const span = (a: number, b: number) => ({ left: pct(a), width: `${((clampMin(b) - clampMin(a)) / DAY) * 100}%` })
const hh = (m: number) => hm(m).slice(0, 2)            // '04:00' → '04', for labels inside narrow bars
const range = (a: number, b: number) => `${hm(a)} ~ ${hm(b)}`

const T = {
  ko: {
    rowZone: '예약', rowWindow: '토큰 창', rowWork: '근무', rowJobs: '예약 작업',
    zone: { free: '영향 없음', blocked: '근무 영향', shared: '업무와 공유' },
    zoneTip: {
      free: (r: string) => `${r} — 이때 도는 예약은 계산상 출근 0% 시작 계획과 계획한 초기화에 영향이 없습니다.`,
      shift: (r: string, moved: string) => `${r} — 근무에 영향이 있습니다. 이때 예약이 돌면 그 정시부터 5시간 창이 열려 정렬 핑 때까지 이어지고, 핑이 새 창을 열지 못해 ${moved} 초기화가 밀립니다.`,
      preWork: (r: string, start: string) => `${r} — 근무에 영향이 있습니다. 출근(${start}) 때 쓰일 창이 이미 열려 있어서, 이때 쓰면 출근 때 0% 에서 시작하지 않습니다.`,
      shared: (r: string) => `${r} — 근무 시간과 같은 5시간 창이라 내 사용량 한도를 함께 씁니다.`,
    },
    windowTip: (a: string, b: string, by: string) => `5시간 창 ${a} ~ ${b}. ${by} ${b} 에 사용량이 0% 로 초기화될 것으로 계산합니다(예상).`,
    openedBy: { ping: (t: string) => `${t} 정렬 핑으로 열려고 시도합니다.`, work: (t: string) => `${t} 근무 시작(또는 재개)으로 열립니다.`, job: (t: string, l: string) => `${t} 예약 "${l}" 이 엽니다.` },
    resetTip: { ok: (t: string, why: string) => `${t} 초기화 — 계획한 시각입니다(예상). ${why}`, off: (t: string) => `${t} 초기화 — 근무 중인데 계획한 시각이 아닙니다.`, neutral: (t: string) => `${t} 초기화 — 근무 밖이라 상관없습니다.` },
    whyLunch: '오후 근무를 0% 에서 시작하려는 계획입니다.', whyEnd: '퇴근 뒤 예약을 0% 에서 시작하려는 계획입니다.', whyOther: '계획한 초기화 시각입니다.', whyChosen: '직접 지정한 초기화 시각입니다.',
    workTip: (a: string, b: string) => `근무 ${a} ~ ${b}: 이 시간에는 Claude 를 쓰는 것으로 보고 계산합니다.`,
    lunchTip: (a: string, b: string) => `점심 ${a} ~ ${b}: 쓰지 않는 시간.`,
    pingTip: (t: string, before: boolean) => `${t} 정렬 핑: haiku 에 아주 짧은 요청을 보내 이 시각의 정시부터 5시간 창이 열리도록 시도합니다(실험 기능, 보장하지 않음).${before ? ' 출근 전이라 이때 PC 가 켜져 있어야 합니다(연동 점검의 절전 해제).' : ''}`,
    jobTip: { ok: (t: string, l: string) => `${t} 예약 "${l}" — 문제없습니다.`, shared: (t: string, l: string) => `${t} 예약 "${l}" — 근무 시간 창 안이라 내 한도를 같이 씁니다.`, bad: (t: string, l: string, why: string) => `${t} 예약 "${l}" — ${why}` },
    now: '지금',
    lead: {
      free: (r: string) => <><b>{r}</b> 에 도는 예약은 근무에 영향이 없습니다.</>,
      blocked: (r: string, start: string, reset: string) => <><b>{r}</b> 에 도는 예약은 출근({start}) 0% 시작이나 {reset} 초기화에 영향을 줄 수 있습니다.</>,
      shared: (r: string) => <><b>{r}</b> 예약은 근무와 같은 한도를 씁니다.</>,
    },
    notWorkday: '근무일 하루 기준의 예상입니다. 실제 초기화 시각은 보장하지 않습니다.',
    sumBefore: (t: string, s: string) => `${t} 핑은 출근(${s}) 전입니다. 이때 PC 가 켜져 있어야 합니다 — 연동 점검의 절전 해제를 확인하세요.`,
    sumMissed: (t: string, actual: string, tooClose: boolean) => `원하는 ${t} 초기화가 일어나지 않습니다${tooClose ? ' — 앞 초기화 뒤 5시간이 안 되어 창이 그때 끝날 수 없습니다' : ''}. 실제 초기화: ${actual}.`,
    targetTip: (t: string) => `원하는 초기화 ${t} — 이 시각에는 초기화되지 않습니다. 아래 안내를 참고하세요.`,
    sumEndOff: (e: string, r: string) => `퇴근(${e})과 두 번째 초기화(${r})가 다릅니다. 점심 끝 기준으로 맞췄습니다.`,
    sumConflict: (t: string, l: string, moved: string) => `${t} 예약 "${l}" 때문에 ${moved} 초기화가 밀립니다. 참고로 초록 구간에 도는 예약은 영향이 없습니다.`,
    sumPingOff: '정렬 핑이 꺼져 있어 첫 창이 출근 시각에 열립니다.',
  },
  en: {
    rowZone: 'Jobs OK?', rowWindow: 'Windows', rowWork: 'Work', rowJobs: 'Jobs',
    zone: { free: 'No effect', blocked: 'Affects work', shared: 'Shares limit' },
    zoneTip: {
      free: (r: string) => `${r} — a job here is not expected to affect the planned 0 % start or resets.`,
      shift: (r: string, moved: string) => `${r} — affects work. A job here opens a 5-hour window from its full hour that is still open at the align ping, so the ping cannot open a fresh one and the ${moved} reset moves.`,
      preWork: (r: string, start: string) => `${r} — affects work. The window work starts in (${start}) is already open; using it now means work does not start at 0 %.`,
      shared: (r: string) => `${r} — the same 5-hour window as your work, so it spends your limit.`,
    },
    windowTip: (a: string, b: string, by: string) => `5-hour window ${a} – ${b}. ${by} Usage is expected to reset to 0 % at ${b} (estimate).`,
    openedBy: { ping: (t: string) => `The ${t} align ping tries to open it.`, work: (t: string) => `Opened by work at ${t}.`, job: (t: string, l: string) => `Opened by the job "${l}" at ${t}.` },
    resetTip: { ok: (t: string, why: string) => `Reset at ${t} — the planned time (estimate). ${why}`, off: (t: string) => `Reset at ${t} — during work, not planned.`, neutral: (t: string) => `Reset at ${t} — outside work, harmless.` },
    whyLunch: 'Meant to start the afternoon at 0 %.', whyEnd: 'Meant to start the jobs after work at 0 %.', whyOther: 'A planned reset.', whyChosen: 'A reset time you chose.',
    workTip: (a: string, b: string) => `Work ${a} – ${b}: assumed to be using Claude.`,
    lunchTip: (a: string, b: string) => `Lunch ${a} – ${b}: idle.`,
    pingTip: (t: string, before: boolean) => `${t} align ping: a tiny haiku call that tries to open the window from this full hour (experimental, not guaranteed).${before ? ' Before work: the PC must be on (sleep off).' : ''}`,
    jobTip: { ok: (t: string, l: string) => `${t} job "${l}" — fine.`, shared: (t: string, l: string) => `${t} job "${l}" — inside a work window, shares your limit.`, bad: (t: string, l: string, why: string) => `${t} job "${l}" — ${why}` },
    now: 'now',
    lead: {
      free: (r: string) => <>Jobs at <b>{r}</b> do not affect your work day.</>,
      blocked: (r: string, start: string, reset: string) => <>Jobs at <b>{r}</b> may affect the 0 % start at {start} or the {reset} resets.</>,
      shared: (r: string) => <>Jobs at <b>{r}</b> share your work limit.</>,
    },
    notWorkday: 'An estimate for one work day; the actual reset times are not guaranteed.',
    sumBefore: (t: string, s: string) => `The ${t} ping is before work (${s}); the PC must be on then — check "sleep turned off" in the setup check.`,
    sumMissed: (t: string, actual: string, tooClose: boolean) => `The ${t} reset you want does not happen${tooClose ? ' — it is less than 5 hours after the previous reset, so no window can end then' : ''}. Actual resets: ${actual}.`,
    targetTip: (t: string) => `Wanted reset ${t} — it does not happen at this time. See below.`,
    sumEndOff: (e: string, r: string) => `Work end (${e}) and the second reset (${r}) differ; the plan follows the lunch end.`,
    sumConflict: (t: string, l: string, moved: string) => `The ${t} job "${l}" moves the ${moved} reset. For reference, jobs in the green ranges have no effect.`,
    sumPingOff: 'The align ping is off: the first window opens when work starts.',
  },
}

const ZONE_ICON = { free: CalendarCheck, blocked: Ban, shared: Users }
const OPENER_ICON = { ping: Zap, work: Briefcase, job: CalendarClock }

function jobsOf(overview: Overview, todayStart: number): DayJob[] {
  const out: DayJob[] = []
  for (const s of overview.sessions) for (const j of s.jobs) {
    if (j.isDismissed) continue
    out.push({ id: j.id, label: `${s.label} · ${j.prompt.replace(/\s+/g, ' ').slice(0, 40)}`, yesterday: occurrencesOn(j.cron, todayStart - DAY * 60_000), today: occurrencesOn(j.cron, todayStart) })
  }
  return out
}

export function Timeline({ settings, overview, now }: { settings: AppSettings; overview: Overview; now: number }) {
  const lang: Lang = settings.language
  const t = T[lang]
  const body = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<number | undefined>(undefined)   // minute under the mouse
  const [mark, setMark] = useState<string | undefined>(undefined)       // tooltip of the item under the mouse
  const w = settings.workHours
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  const todayStart = d.getTime()
  const pingOn = settings.alignPing.enabled

  // the simulation runs 288 times for the zones: only when the inputs change, not on every mouse move
  const { plan, jobs, report, zones } = useMemo(() => {
    const plan = planPings(w, settings.alignPing.resetHours)
    const jobs = jobsOf(overview, todayStart)
    return { plan, jobs, report: analyzeDay(w, plan, jobs, WORK_DAYS, pingOn), zones: planZones(w, plan, pingOn) }
  }, [w, settings.alignPing.resetHours, pingOn, overview, todayStart])

  const nowMin = (now - todayStart) / 60_000
  const s = parseHm(w.start); const ls = parseHm(w.lunchStart); const le = parseHm(w.lunchEnd); const e = parseHm(w.end)
  const hoursOk = ![s, ls, le, e].some(Number.isNaN)
  const inWork = (m: number) => (m >= s && m < ls) || (m >= le && m < e)
  const whyOf = (m: number) => (plan.isCustom ? t.whyChosen : m === plan.targets[0] ? t.whyLunch : m === plan.targets[1] ? t.whyEnd : t.whyOther)
  const actualResets = report.resets.filter(r => r.minute < DAY).map(r => hm(r.minute)).join(', ') || '—'
  const openerText = (x: UsageWindow) => x.openedBy.kind === 'ping' ? t.openedBy.ping(hm(x.openedBy.minute)) : x.openedBy.kind === 'work' ? t.openedBy.work(hm(x.openedBy.minute)) : t.openedBy.job(hm(x.openedBy.minute), x.openedBy.label ?? '')
  const zoneAt = (m: number) => zones.find(z => m >= z.start && m < z.end)
  const zoneTip = (z: Zone) => z.kind === 'free' ? t.zoneTip.free(range(z.start, z.end)) : z.kind === 'shared' ? t.zoneTip.shared(range(z.start, z.end))
    : z.reason === 'shift' ? t.zoneTip.shift(range(z.start, z.end), (z.moved ?? []).map(hm).join(', ')) : t.zoneTip.preWork(range(z.start, z.end), w.start)

  const tipOf = (text: string) => ({ onMouseEnter: () => setMark(text), onMouseLeave: () => setMark(undefined) })
  const onMove = (ev: MouseEvent<HTMLDivElement>) => {
    const r = body.current?.getBoundingClientRect()
    if (r === undefined || r.width === 0) return
    setCursor(Math.round(clampMin(((ev.clientX - r.left) / r.width) * DAY)))
  }
  const describe = (m: number): string => { const z = zoneAt(m); return z === undefined ? '' : zoneTip(z).replace(`${range(z.start, z.end)} — `, `${t.zone[z.kind]} ${range(z.start, z.end)}: `) }

  // one line per kind of range: no effect, affects work, shares the limit
  const lead: ReactNode[] = []
  const fmt = (rs: [number, number][]) => rs.map(([a, b]) => range(a, b)).join(', ')
  const free = rangesOf(zones, 'free'); const blocked = rangesOf(zones, 'blocked'); const shared = rangesOf(zones, 'shared')
  if (free.length > 0) lead.push(<li key="f" className="free"><CalendarCheck size={15} /><span>{t.lead.free(fmt(free))}</span></li>)
  if (blocked.length > 0) lead.push(<li key="b" className="blocked"><Ban size={15} /><span>{t.lead.blocked(fmt(blocked), w.start, plan.targets.filter(tg => !report.missedTargets.includes(tg)).map(hm).join(', '))}</span></li>)
  if (shared.length > 0) lead.push(<li key="s" className="shared"><Users size={15} /><span>{t.lead.shared(fmt(shared))}</span></li>)

  const warnings: string[] = []
  for (const tg of plan.targets) if (report.missedTargets.includes(tg) && (report.conflicts.length === 0 || plan.tooClose.includes(tg))) warnings.push(t.sumMissed(hm(tg), actualResets, plan.tooClose.includes(tg)))
  if (!pingOn) warnings.push(t.sumPingOff)
  if (pingOn) for (const p of plan.beforeStart) warnings.push(t.sumBefore(hm(p), w.start))
  if (!plan.isCustom && !plan.endAligned && plan.targets[1] !== undefined) warnings.push(t.sumEndOff(w.end, hm(plan.targets[1])))
  // a job in the keep-empty hours: what it does to the work day; other conflicts as they are
  const blockedJobs = new Set<string>()
  for (const j of jobs) for (const m of j.today) {
    const z = zoneAt(m)
    if (z?.kind !== 'blocked' || blockedJobs.has(j.id)) continue
    blockedJobs.add(j.id)
    warnings.push(`${hm(m)} "${j.label}" — ${blockedText(z, zones, w.start, lang)}`)
  }
  for (const c of report.conflicts) if (!blockedJobs.has(c.jobId)) warnings.push(t.sumConflict(hm(c.minute), c.label, c.moved.map(hm).join(', ')))

  // job time labels take about 90 minutes of width: to the right of the dot, or to the left when the next dot is close,
  // or none when both sides are taken (the dot and its tooltip stay)
  const LABEL_MIN = 90
  const jobMarks = jobs.flatMap(j => j.today.map(m => ({ j, m }))).sort((a, b) => a.m - b.m)
  let usedUntil = -DAY
  const sideOf = (m: number, next: number | undefined): 'right' | 'left' | undefined => {
    const side = (next === undefined || next - m >= LABEL_MIN + 10) && m >= usedUntil && m + LABEL_MIN <= DAY ? 'right' : m - LABEL_MIN >= usedUntil ? 'left' : undefined
    usedUntil = side === 'right' ? m + LABEL_MIN : m + 10
    return side
  }

  return (
    <div className="timeline">
      <ul className="tl-lead">{lead}</ul>

      <div className="tl-chart">
        <div className="tl-labels">
          <span className="tl-l-axis" />
          <span>{t.rowZone}</span><span>{t.rowWindow}</span><span>{t.rowWork}</span>
          {jobMarks.length > 0 && <span>{t.rowJobs}</span>}
        </div>

        <div className="tl-body" ref={body} onMouseMove={onMove} onMouseLeave={() => { setCursor(undefined); setMark(undefined) }}>
          {/* 0. sky and hours */}
          <div className="tl-sky">
            <span className="tl-celestial moon" style={{ left: pct(120) }}><Moon size={11} /></span>
            <span className="tl-celestial sun" style={{ left: pct(720) }}><Sun size={12} /></span>
            <span className="tl-celestial moon" style={{ left: pct(1320) }}><Moon size={11} /></span>
          </div>
          <div className="tl-axis">
            {Array.from({ length: 13 }, (_, i) => i * 2).map(h => <span key={h} className="tl-hour" style={{ left: pct(h * 60) }}>{h}</span>)}
          </div>

          {/* 1. when a job may run */}
          <div className="tl-row">
            {zones.map(z => {
              const Icon = ZONE_ICON[z.kind]; const len = z.end - z.start
              return (
                <div key={z.start} className={`tl-zone ${z.kind}`} style={span(z.start, z.end)} {...tipOf(zoneTip(z))}>
                  {len >= 50 && <Icon size={12} />}
                  {len >= 170 && <span>{t.zone[z.kind]}</span>}
                </div>
              )
            })}
          </div>

          {/* 2. 5-hour windows: what opened each, and the time range; the reset is where one ends */}
          <div className="tl-row">
            {report.windows.map(x => {
              const Icon = OPENER_ICON[x.openedBy.kind]
              return (
                <div key={x.start} className={`tl-win by-${x.openedBy.kind}`} style={span(x.start, x.end)} {...tipOf(`${t.windowTip(hm(x.start), hm(x.end), openerText(x))}${x.openedBy.kind === 'ping' ? ` ${t.pingTip(hm(x.openedBy.minute), plan.beforeStart.includes(x.openedBy.minute))}` : ''}`)}>
                  <Icon size={11} /><span>{hh(x.start)}–{hh(x.end)}</span>
                </div>
              )
            })}
            {/* a chosen reset that does not happen: a hollow red mark where it should have been */}
            {report.missedTargets.map(tg => <span key={`m${tg}`} className="tl-reset missed" style={{ left: pct(tg) }} {...tipOf(t.targetTip(hm(tg)))}><RotateCcw size={9} strokeWidth={3} /></span>)}
            {report.resets.map(r => {
              const kind = r.isTarget ? 'ok' : r.minute > s && r.minute < e ? 'off' : 'neutral'
              const text = kind === 'ok' ? t.resetTip.ok(hm(r.minute), whyOf(r.minute)) : kind === 'off' ? t.resetTip.off(hm(r.minute)) : t.resetTip.neutral(hm(r.minute))
              return kind === 'neutral' ? null : <span key={r.minute} className={`tl-reset ${kind}`} style={{ left: pct(r.minute) }} {...tipOf(text)}><RotateCcw size={9} strokeWidth={3} /></span>
            })}
          </div>

          {/* 3. my work day */}
          <div className="tl-row">
            {hoursOk && <>
              <div className="tl-work" style={span(s, ls)} {...tipOf(t.workTip(w.start, w.lunchStart))}><span>{w.start}</span></div>
              <div className="tl-lunch" style={span(ls, le)} {...tipOf(t.lunchTip(w.lunchStart, w.lunchEnd))}><Utensils size={11} /></div>
              <div className="tl-work" style={span(le, e)} {...tipOf(t.workTip(w.lunchEnd, w.end))}><span>{w.end}</span></div>
            </>}
          </div>

          {/* 4. today's jobs */}
          {jobMarks.length > 0 && (
            <div className="tl-row">
              {jobMarks.map(({ j, m }, i) => {
                const c = report.conflicts.find(x => x.jobId === j.id)
                const kind = c !== undefined || zoneAt(m)?.kind === 'blocked' ? 'bad' : inWork(m) ? 'shared' : 'ok'
                const text = kind === 'bad' ? t.jobTip.bad(hm(m), j.label, zoneAt(m) !== undefined ? zoneTip(zoneAt(m) as Zone) : '') : kind === 'shared' ? t.jobTip.shared(hm(m), j.label) : t.jobTip.ok(hm(m), j.label)
                const side = sideOf(m, jobMarks[i + 1]?.m)
                return (
                  <span key={`${j.id}-${m}`} className={`tl-job ${kind} ${side ?? ''}`} style={{ left: pct(m) }} {...tipOf(text)}>
                    <i />{side !== undefined && <b>{hm(m)}</b>}
                  </span>
                )
              })}
            </div>
          )}

          <span className="tl-now" style={{ left: pct(nowMin) }} {...tipOf(`${t.now} ${hm(nowMin)}`)}><b>{hm(nowMin)}</b></span>
          {cursor !== undefined && <span className="tl-cursor" style={{ left: pct(cursor) }} />}
          {cursor !== undefined && (
            <div className="tl-tip" style={{ left: `clamp(140px, ${pct(cursor)}, calc(100% - 140px))` }}>
              <div className="head">{hm(cursor)}</div>
              <div>{mark ?? describe(cursor)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="tl-foot muted small">
        {plan.targets.map(tg => report.missedTargets.includes(tg)
          ? <span key={tg} className="tl-chip missed" title={t.targetTip(hm(tg))}><RotateCcw size={11} strokeWidth={2.6} />{hm(tg)}</span>
          : <span key={tg} className="tl-chip ok" title={t.resetTip.ok(hm(tg), whyOf(tg))}><RotateCcw size={11} strokeWidth={2.6} />{hm(tg)}</span>)}
        {pingOn && plan.pings.map(p => <span key={p} className="tl-chip ping" title={t.pingTip(hm(p), plan.beforeStart.includes(p))}><Zap size={11} />{hm(p)}</span>)}
        <span className="grow" />
        <span>{t.notWorkday}</span>
      </div>
      {warnings.length > 0 && (
        <ul className="tl-warnings">
          {warnings.map((x, i) => <li key={i}><AlertTriangle size={14} /><span>{x}</span></li>)}
        </ul>
      )}
    </div>
  )
}

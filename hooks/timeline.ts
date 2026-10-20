// The 5-hour usage window and the work day, as pure functions (no Node, no DOM).
//
// Rule (measured): a window starts at the full hour of the first call made while no window is open, and resets
// 5 hours later. So the reset times of a day are decided by when the first call after each reset happens — a
// tiny "ping", the person working, or a scheduled job firing.
//
// Plan: the afternoon should start with a fresh window at lunch end, and the evening (when nightly jobs run) with a
// fresh window at work end. So a ping opens a window at (lunch-end hour − 5 h) and another at the lunch-end hour.
// With 09:00–18:00 and lunch 12:00–13:00: pings 08:05 and 13:05 → resets 13:00 and 18:00.
//
// The plugin carries the same file as hooks/timeline.ts (it checks new jobs against the plan). Keep the two
// identical: app/shared/timeline.spec.ts fails when they differ. Hence no imports but ./cron, which both have.
import { cronNext } from './cron'

// The work day as the app settings hold it ('09:00'); the app's WorkHours has these and more
export type WorkHours = { start: string; lunchStart: string; lunchEnd: string; end: string }

// '09:30' → 570; NaN when it is not a time of day
function parseHm(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (m === null) return NaN
  const h = Number(m[1]); const mi = Number(m[2])
  return h > 23 || mi > 59 ? NaN : h * 60 + mi
}

export const WINDOW_MIN = 300   // a usage window lasts 5 hours
const DAY = 1440
const PING_MINUTE = 5           // pings go out a few minutes after the hour (the window still starts on the hour)

export type PingPlan = {
  pings: number[]          // minutes of the day the align ping is sent   [485, 785] = 08:05, 13:05
  targets: number[]        // minutes of the day a reset should happen      [780, 1080] = 13:00, 18:00
  beforeStart: number[]    // pings earlier than the work start: the PC must be on then
  endAligned: boolean      // the second reset lands on the work end hour
  isCustom: boolean        // the reset times were chosen by the person (else: lunch end and 5 hours later)
  tooClose: number[]       // chosen resets less than 5 hours after the previous one: a window cannot end there
}

// resetHours: the hours the person wants the window to reset at ([13, 18]); empty or absent → lunch end and 5 h later.
// Each reset needs a window opened 5 hours before it, so the ping goes out at (reset hour − 5):05.
export function planPings(w: WorkHours, resetHours?: number[]): PingPlan {
  const start = parseHm(w.start); const lunchEnd = parseHm(w.lunchEnd); const end = parseHm(w.end)
  const safe = (v: number, fallback: number) => Number.isNaN(v) ? fallback : v
  const lunchEndH = Math.floor(safe(lunchEnd, 13 * 60) / 60)
  const endH = Math.floor(safe(end, 18 * 60) / 60)
  const isCustom = resetHours !== undefined && resetHours.length > 0
  const wrap = (h: number) => ((h % 24) + 24) % 24
  const resets = isCustom ? [...new Set(resetHours.map(wrap))].sort((a, b) => a - b) : [lunchEndH, lunchEndH + 5].map(wrap)
  const targets = resets.map(h => h * 60)
  const pings = resets.map(h => wrap(h - 5) * 60 + PING_MINUTE).sort((a, b) => a - b)
  return {
    pings,
    targets,
    beforeStart: pings.filter(p => p < safe(start, 9 * 60)),
    endAligned: targets.includes(endH * 60),
    isCustom,
    tooClose: targets.filter((tg, i) => targets.length > 1 && tg - (targets[i - 1] ?? (targets[targets.length - 1] ?? 0) - DAY) < 300),
  }
}

// Minutes of a day (local) at which a cron fires; dayStartMs = local midnight of that day
export function occurrencesOn(cron: string, dayStartMs: number): number[] {
  const out: number[] = []
  let t = dayStartMs - 60_000
  for (let i = 0; i < 1440; i++) {
    const next = cronNext(cron, t)
    if (next === undefined || next >= dayStartMs + DAY * 60_000) break
    out.push(Math.round((next - dayStartMs) / 60_000))
    t = next
  }
  return out
}

export type DayJob = { id: string; label: string; yesterday: number[]; today: number[] }   // fire minutes of each day
export type Opener = { kind: 'ping' | 'work' | 'job'; minute: number; jobId?: string; label?: string }
export type UsageWindow = { start: number; end: number; openedBy: Opener }   // minutes from today 00:00 (may be < 0)

type Interval = [number, number]

function workIntervals(w: WorkHours, dayOffset: number, isWorkDay: boolean): Interval[] {
  if (!isWorkDay) return []
  const s = parseHm(w.start); const ls = parseHm(w.lunchStart); const le = parseHm(w.lunchEnd); const e = parseHm(w.end)
  if ([s, ls, le, e].some(Number.isNaN)) return []
  const out: Interval[] = []
  if (ls > s) out.push([s + dayOffset, Math.min(ls, e) + dayOffset])
  if (e > le) out.push([Math.max(le, s) + dayOffset, e + dayOffset])
  return out
}

// Simulates yesterday and today and returns every window that touches today (minutes from today 00:00).
// The person is assumed to be using Claude throughout work hours (outside lunch) on work days.
export function simulateDay(w: WorkHours, plan: PingPlan, jobs: DayJob[], workDays: { yesterday: boolean; today: boolean }, pingOn: boolean): UsageWindow[] {
  const events: Opener[] = []
  for (const offset of [-DAY, 0]) {
    const isWorkDay = offset === 0 ? workDays.today : workDays.yesterday
    if (pingOn && isWorkDay) for (const p of plan.pings) events.push({ kind: 'ping', minute: p + offset })
    for (const j of jobs) for (const m of offset === 0 ? j.today : j.yesterday) events.push({ kind: 'job', minute: m + offset, jobId: j.id, label: j.label })
  }
  events.sort((a, b) => a.minute - b.minute)
  const work = [...workIntervals(w, -DAY, workDays.yesterday), ...workIntervals(w, 0, workDays.today)]

  // the first call at or after `t`
  const nextCall = (t: number): Opener | undefined => {
    let best: Opener | undefined = events.find(e => e.minute >= t)
    for (const [a, b] of work) {
      const m = t >= a && t < b ? t : a >= t ? a : undefined
      if (m !== undefined && (best === undefined || m < best.minute)) best = { kind: 'work', minute: m }
    }
    return best
  }

  const windows: UsageWindow[] = []
  let t = -DAY
  for (let guard = 0; guard < 20; guard++) {
    const call = nextCall(t)
    if (call === undefined || call.minute >= DAY) break
    const start = Math.floor(call.minute / 60) * 60
    windows.push({ start, end: start + WINDOW_MIN, openedBy: call })
    t = start + WINDOW_MIN
  }
  return windows.filter(x => x.end > 0 && x.start < DAY)
}

export type DayReport = {
  windows: UsageWindow[]
  resets: { minute: number; isTarget: boolean }[]               // resets that fall within today
  missedTargets: number[]                                       // planned resets that do not happen
  conflicts: { jobId: string; label: string; minute: number; moved: number[] }[]   // jobs whose firing moves a planned reset
}

const near = (a: number, b: number) => Math.abs(a - b) <= 3

export function analyzeDay(w: WorkHours, plan: PingPlan, jobs: DayJob[], workDays: { yesterday: boolean; today: boolean }, pingOn: boolean): DayReport {
  const windows = simulateDay(w, plan, jobs, workDays, pingOn)
  const resetsOf = (ws: UsageWindow[]) => ws.map(x => x.end).filter(m => m > 0 && m <= DAY)
  const resetMinutes = resetsOf(windows)
  const hits = (rs: number[]) => plan.targets.filter(tg => rs.some(r => near(r, tg)))
  const hitNow = hits(resetMinutes)
  const conflicts: DayReport['conflicts'] = []
  for (const j of jobs) {
    const without = resetsOf(simulateDay(w, plan, jobs.filter(x => x.id !== j.id), workDays, pingOn))
    const regained = hits(without).filter(tg => !hitNow.includes(tg))
    if (regained.length > 0) {
      const opener = windows.find(x => x.openedBy.jobId === j.id)
      conflicts.push({ jobId: j.id, label: j.label, minute: opener?.openedBy.minute ?? j.today[0] ?? 0, moved: regained })
    }
  }
  return {
    windows,
    resets: resetMinutes.map(m => ({ minute: m, isTarget: plan.targets.some(tg => near(m, tg)) })),
    missedTargets: plan.targets.filter(tg => !hitNow.includes(tg)),
    conflicts,
  }
}

export type ZoneKind = 'free' | 'shared' | 'blocked'
export type Zone = { start: number; end: number; kind: ZoneKind; reason?: 'shift' | 'preWork'; moved?: number[] }

// When a new job may run today: every `step` minutes a one-off test job is added and the day simulated again.
// blocked shift   — the job opens a window that is still open at the ping, so a planned reset moves (09–18: 04:00–08:00)
// blocked preWork — the job runs before work inside the window that is open when work starts, so work does not start at 0 %
// shared          — the job runs inside a window that also covers work hours: it spends the same limit as the person
// free            — none of these
export function jobZones(w: WorkHours, plan: PingPlan, jobs: DayJob[], workDays: { yesterday: boolean; today: boolean }, pingOn: boolean, step = 5): Zone[] {
  const hits = (ws: UsageWindow[]) => plan.targets.filter(tg => ws.some(x => x.end > 0 && x.end <= DAY && near(x.end, tg)))
  const baseHits = hits(simulateDay(w, plan, jobs, workDays, pingOn))
  const work = workIntervals(w, 0, workDays.today)
  const workStart = work[0]?.[0]
  const out: Zone[] = []
  for (let m = 0; m < DAY; m += step) {
    const ws = simulateDay(w, plan, [...jobs, { id: '\0probe', label: '', yesterday: [], today: [m] }], workDays, pingOn)
    const lost = baseHits.filter(tg => !hits(ws).includes(tg))
    const at = ws.find(x => m >= x.start && m < x.end)
    const z: Omit<Zone, 'start' | 'end'> = lost.length > 0 ? { kind: 'blocked', reason: 'shift', moved: lost }
      : workStart !== undefined && m < workStart && at !== undefined && at.end > workStart ? { kind: 'blocked', reason: 'preWork' }
      : at !== undefined && work.some(([a, b]) => at.start < b && at.end > a) ? { kind: 'shared' }
      : { kind: 'free' }
    const last = out[out.length - 1]
    if (last !== undefined && last.kind === z.kind && last.reason === z.reason) {
      last.end = m + step
      if (z.moved !== undefined) last.moved = [...new Set([...(last.moved ?? []), ...z.moved])].sort((a, b) => a - b)
    } else out.push({ start: m, end: m + step, ...z })
  }
  return out
}

// The zones of the plan alone (pings and work, no jobs): the hours that must stay empty on a work day
export function planZones(w: WorkHours, plan: PingPlan, pingOn: boolean): Zone[] {
  return jobZones(w, plan, [], { yesterday: true, today: true }, pingOn)
}

// The first run of `cron` within 7 days that lands in a zone that affects work (kind 'blocked') on a work day (weekdays 0 = Sunday)
export function blockedRun(cron: string, zones: Zone[], weekdays: number[], fromMs: number): { at: number; minute: number; zone: Zone } | undefined {
  const until = fromMs + 7 * DAY * 60_000
  let t = fromMs
  for (let i = 0; i < 2100; i++) {   // enough for */5 over a week
    const next = cronNext(cron, t)
    if (next === undefined || next > until) return undefined
    const d = new Date(next)
    const minute = d.getHours() * 60 + d.getMinutes()
    const zone = zones.find(z => minute >= z.start && minute < z.end)
    if (zone?.kind === 'blocked' && weekdays.includes(d.getDay())) return { at: next, minute, zone }
    t = next
  }
  return undefined
}

// Same-kind zones that touch, across midnight too, as one range: free 18:00–24:00 + 00:00–04:00 → [1080, 240]
export function rangesOf(zones: Zone[], kind: ZoneKind): [number, number][] {
  const merged: [number, number][] = []
  for (const z of zones) {
    if (z.kind !== kind) continue
    const last = merged[merged.length - 1]
    if (last !== undefined && last[1] === z.start) last[1] = z.end
    else merged.push([z.start, z.end])
  }
  const first = merged[0]; const last = merged[merged.length - 1]
  if (merged.length > 1 && first !== undefined && last !== undefined && first[0] === 0 && last[1] === DAY) { merged.pop(); merged[0] = [last[0], first[1]] }
  return merged
}

export function hm(minute: number): string {
  const m = ((Math.round(minute) % DAY) + DAY) % DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

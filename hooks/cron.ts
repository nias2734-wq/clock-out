// Next fire time of a 5-field cron expression (minute hour day-of-month month day-of-week), local time.
// Used only when Claude Code gave no nextFireAt (a job restored before this plugin recorded it).
// Supports *, n, a-b, */s, a-b/s and comma lists; day-of-week 0 and 7 are Sunday. Like Claude Code's
// scheduler the real run may be up to 30 minutes later (per-job offset), so callers prefer nextFireAt.

function fieldSet(text: string, min: number, max: number): Set<number> | undefined {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim())
    if (m === null) return undefined
    const [, range, stepText] = m
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!(step >= 1)) return undefined
    let lo = min
    let hi = max
    if (range !== '*' && range !== undefined) {
      const [a, b] = range.split('-').map(Number)
      if (a === undefined || Number.isNaN(a)) return undefined
      lo = a
      hi = b === undefined || Number.isNaN(b) ? (stepText === undefined ? a : max) : b
    }
    if (lo < min || hi > max || lo > hi) return undefined
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

export type CronSpec = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean }

export function parseCron(cron: string): CronSpec | undefined {
  const f = cron.trim().split(/\s+/)
  if (f.length !== 5) return undefined
  const minute = fieldSet(f[0] ?? '', 0, 59)
  const hour = fieldSet(f[1] ?? '', 0, 23)
  const dom = fieldSet(f[2] ?? '', 1, 31)
  const month = fieldSet(f[3] ?? '', 1, 12)
  const dow = fieldSet((f[4] ?? '').replace(/\b7\b/g, '0'), 0, 6)
  if (!minute || !hour || !dom || !month || !dow) return undefined
  return { minute, hour, dom, month, dow, domAny: f[2] === '*', dowAny: f[4] === '*' }
}

// Standard cron rule: when both day fields are restricted, a day matches if either does.
function dayMatches(spec: CronSpec, d: Date): boolean {
  const domOk = spec.dom.has(d.getDate())
  const dowOk = spec.dow.has(d.getDay())
  if (spec.domAny && spec.dowAny) return true
  if (spec.domAny) return dowOk
  if (spec.dowAny) return domOk
  return domOk || dowOk
}

// First match strictly after `fromMs`, within 366 days; undefined when never.
export function cronNext(cron: string, fromMs: number): number | undefined {
  const spec = parseCron(cron)
  if (spec === undefined) return undefined
  const start = new Date(fromMs)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  const minutes = [...spec.minute].sort((a, b) => a - b)
  const hours = [...spec.hour].sort((a, b) => a - b)
  for (let day = 0; day <= 366; day++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day)
    if (!spec.month.has(d.getMonth() + 1) || !dayMatches(spec, d)) continue
    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0)
        if (t.getTime() >= start.getTime()) return t.getTime()
      }
    }
  }
  return undefined
}

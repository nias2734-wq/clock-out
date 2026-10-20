// Pure time helpers shared by main and renderer.

// 'HH:mm' → minutes since midnight; NaN when malformed
export function parseHm(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (m === null) return NaN
  const h = Number(m[1]); const mi = Number(m[2])
  if (h > 23 || mi > 59) return NaN
  return h * 60 + mi
}

export function formatHm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Local time as 'YYYY-MM-DD HH:mm:ss' (sep 'T' gives the zone-less form PowerShell's ToString('s') writes)
export function formatLocalStamp(ms: number, sep = ' '): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Remaining time as '4h50m' / '12m'
export function formatRemaining(untilMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((untilMs - nowMs) / 1000))
  const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h${m}m`
  return `${m}m`
}

// The align-ping plan and the day simulation live in timeline.ts.

// Whether a reset time (epoch ms) sits on one of the planned boundaries: within 3 minutes of the full hour
// (the API reports 12:59 for a window that started at 08:00)
export function isAlignedReset(resetAtMs: number, boundaries: number[]): boolean {
  const d = new Date(resetAtMs)
  const minutes = d.getHours() * 60 + d.getMinutes()
  return boundaries.some(h => Math.abs(minutes - h * 60) <= 3)
}

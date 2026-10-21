import { readFileSync, writeFileSync } from 'node:fs'

import { Notification, app, shell } from 'electron'

import { isCapture } from './capture'
import { log } from './log'
import { paths } from './paths'
import { getSettings } from './settings'

// New release notice: once a day the latest GitHub release is compared with this app's version.
// Nothing is downloaded or installed; the notice opens the release page.

const LATEST_URL = 'https://api.github.com/repos/nias2734-wq/clock-out/releases/latest'
const CHECK_MS = 24 * 60 * 60 * 1000
const FIRST_DELAY_MS = 60_000   // after the start, so it never competes with the first usage fetch
const TIMEOUT_MS = 15_000

type Checked = { checkedAt?: number; latest?: string; announced?: string }   // announced: the version already shown, never twice

// 'v0.14.0' > '0.13.1': true; anything unparsable is not newer
export function isNewer(tag: string, current: string): boolean {
  const parts = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number)
  const a = parts(tag); const b = parts(current)
  if (a === undefined || b === undefined) return false
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

function readChecked(): Checked {
  try { return JSON.parse(readFileSync(paths.updateCheck, 'utf8')) as Checked } catch { return {} }
}

async function check(): Promise<void> {
  if (!getSettings().updateCheck) return
  const before = readChecked()
  if (before.checkedAt !== undefined && Date.now() - before.checkedAt < CHECK_MS) return
  try {
    const res = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) { log(`UPDATE check status ${res.status}`); return }
    const body = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = body.tag_name ?? ''
    const newer = isNewer(tag, app.getVersion())
    log(`UPDATE latest ${tag} (this ${app.getVersion()})`)
    writeFileSync(paths.updateCheck, JSON.stringify({ ...before, checkedAt: Date.now(), latest: tag }))
    if (!newer || before.announced === tag) return
    const ko = getSettings().language === 'ko'
    const n = new Notification({ title: 'clock-out', body: ko ? `새 버전 ${tag} 이 나왔습니다. 눌러서 릴리스 페이지를 엽니다.` : `clock-out ${tag} is out. Click to open the release page.` })
    n.on('click', () => { void shell.openExternal(body.html_url ?? 'https://github.com/nias2734-wq/clock-out/releases') })
    n.show()
    writeFileSync(paths.updateCheck, JSON.stringify({ checkedAt: Date.now(), latest: tag, announced: tag }))
  } catch (err) {
    log(`UPDATE check failed ${err instanceof Error ? err.name : 'error'}`)
  }
}

// capture mode asks nothing; the timer runs hourly and check() skips until a day has passed since the last check
export function startUpdateCheck(): void {
  if (isCapture()) return
  setTimeout(() => { void check() }, FIRST_DELAY_MS)
  setInterval(() => { void check() }, 60 * 60 * 1000)
}

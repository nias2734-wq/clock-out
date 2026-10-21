// Dev check: captures every window of the built app into PNGs, on fake data only, then quits.
// Usage (from app\, after `npm run build`): node scripts/capture.mjs [--out shots] [--theme light|dark] [--lang ko|en] [--usage fresh|stale] [--remote off|on|starting]
//
// Isolation: CLAUDE_CONFIG_DIR, TEMP and the Electron profile point into a fresh folder under %TEMP%\clock-out-capture.
// The app in capture mode sends no usage request, runs no claude, and leaves the Windows autostart entry alone
// (electron/main/capture.ts); `claude agents`, the setup check and the usage answer come from that folder's capture/*.json.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const opt = { out: 'shots', theme: 'light', lang: 'ko', usage: 'fresh', remote: 'off' }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i]?.replace(/^--/, '')
  if (key === undefined || !(key in opt) || argv[i + 1] === undefined) { console.error(`unknown option ${argv[i]}`); process.exit(2) }
  opt[key] = argv[i + 1]
}

// 1. a fresh fake folder: config, work folders, TEMP, Electron profile
const base = join(tmpdir(), 'clock-out-capture')
rmSync(base, { recursive: true, force: true })
const root = join(base, 'config')
const co = join(root, 'clock-out')
for (const d of ['sessions', 'inbox', 'capture']) mkdirSync(join(co, d), { recursive: true })
mkdirSync(join(root, 'sessions'), { recursive: true })
mkdirSync(join(base, 'tmp'), { recursive: true })
const out = resolve(appDir, opt.out)
mkdirSync(out, { recursive: true })

const now = Date.now()
const M = 60_000
const H = 60 * M
const D = 24 * H
// the next hh:mm (tomorrow when today's has passed)
const nextAt = (h, m) => { const d = new Date(now); d.setHours(h, m, 0, 0); if (d.getTime() <= now) d.setTime(d.getTime() + D); return d.getTime() }
// a session's folder must exist, or it gets the "working folder does not exist" warning
const work = name => { const p = join(base, 'work', name); mkdirSync(p, { recursive: true }); return p }
const put = (rel, obj) => writeFileSync(join(co, rel), JSON.stringify(obj, null, 2))
// a live record in <config>/sessions: this script's own pid, alive while the app runs
const live = (name, rec) => writeFileSync(join(root, 'sessions', `${name}.json`), JSON.stringify({ pid: process.pid, startedAt: now - 2 * H, status: 'idle', ...rec }))
const en = opt.lang === 'en'

const SHOP = '4c1e7a2b-9d3f-4e61-8a50-2f7b1c9e0d34'    // running in the background
const BUILD = '8f02d6c9-31ab-4b7e-9c44-6d1e2a7f5b90'   // stopped: wake blocked, message failed, permission differs, a missed job
const REPORT = '2b7c4e1a-6f58-4d2c-b3a9-90e8d1f64c27'  // stopped: wake retried later, message unknown, a missed job
const REMOTE = '7d3a9e51-0c2b-4f86-a1d4-5e9b3c7f2a60'  // the remote jobs session (--remote on|starting)

// 2. plugin session files
put(`sessions/${SHOP}.json`, {
  version: 1, sessionId: SHOP, cwd: work('web-shop'), kind: 'background', alive: true, heartbeatAt: now - 20_000, dismissed: [],
  jobs: [
    { id: 'a1b2c3d4', cron: '0 23 * * *', prompt: en ? 'Pull develop, run npm run build and summarise the cause if it fails' : 'develop 을 pull 하고 npm run build 를 돌려 실패하면 원인을 요약해 줘', recurring: true, createdAt: now - 2 * D, expiresAt: now + 5 * D, nextFireAt: nextAt(23, 0) },
    { id: 'e5f6a7b8', cron: '30 7 * * 1-5', prompt: en ? 'Run the e2e tests and write docs/e2e-report.md' : 'e2e 테스트를 돌리고 결과를 docs/e2e-report.md 에 정리해 줘', recurring: true, createdAt: now - D, expiresAt: now + 6 * D, nextFireAt: nextAt(7, 30) },
  ],
  runs: [
    { jobId: 'a1b2c3d4', firedAt: now - D, finishedAt: now - D + 200_000, reason: 'answer', taskOutcome: 'unverified', durationMs: 200_000, answerHead: en ? 'Build failed: found the cause (missing env var)' : '빌드 실패 원인을 찾았습니다(환경 변수 누락)' },
    { jobId: 'e5f6a7b8', firedAt: now - 20 * H, finishedAt: now - 20 * H + 95_000, reason: 'error', taskOutcome: 'failed', durationMs: 95_000, answerHead: 'connection refused: staging:443' },
  ],
})
live('live-shop', { sessionId: SHOP, kind: 'bg' })
put(`sessions/${BUILD}.json`, {
  version: 1, sessionId: BUILD, cwd: work('nightly-build'), kind: 'background', alive: false, endedAt: now - 6 * H, heartbeatAt: now - 6 * H, dismissed: [],
  jobs: [
    { id: 'b1c2d3e4', cron: '0 23 * * *', prompt: en ? 'Nightly release build and upload the artefacts' : '야간 릴리스 빌드를 만들고 산출물을 올려 줘', recurring: true, createdAt: now - 3 * D, expiresAt: now + 4 * D, nextFireAt: nextAt(23, 0) },
    { id: 'b5c6d7e8', cron: '30 6 * * *', prompt: en ? 'Check the overnight build logs and list the warnings' : '밤사이 빌드 로그를 확인하고 경고를 정리해 줘', recurring: true, createdAt: now - 3 * D, expiresAt: now + 4 * D, nextFireAt: now - 2 * H },
    { id: 'b9c0d1e2', cron: '0 20 * * *', prompt: en ? 'Clean the old preview deployments' : '오래된 미리보기 배포를 정리해 줘', recurring: true, createdAt: now - 3 * D, expiresAt: now + 4 * D, nextFireAt: nextAt(20, 0) },
  ],
  runs: [
    { jobId: 'b1c2d3e4', firedAt: now - 2 * D, finishedAt: now - 2 * D + 300_000, reason: 'answer', taskOutcome: 'unverified', durationMs: 300_000, answerHead: en ? 'Release build done, 3 artefacts uploaded' : '릴리스 빌드 완료, 산출물 3개 업로드' },
    { jobId: 'b1c2d3e4', firedAt: now - D, finishedAt: now - D + 40_000, reason: 'error', taskOutcome: 'failed', durationMs: 40_000, answerHead: 'npm ERR! missing script: build:release' },
    { jobId: 'b5c6d7e8', firedAt: now - 2 * D + 7 * H, finishedAt: now - 2 * D + 7 * H + 60_000, reason: 'answer', durationMs: 60_000, answerHead: en ? 'No new warnings' : '새 경고 없음' },
  ],
})
put(`sessions/${REPORT}.json`, {
  version: 1, sessionId: REPORT, cwd: work('report-bot'), kind: 'background', alive: false, endedAt: now - 9 * H, heartbeatAt: now - 9 * H, dismissed: [],
  jobs: [
    { id: 'c1d2e3f4', cron: '0 9 * * 1-5', prompt: en ? 'Write the daily report from yesterday’s commits' : '어제 커밋으로 일일 보고를 써 줘', recurring: true, createdAt: now - D, expiresAt: now + 6 * D, nextFireAt: now - 5 * H },
    { id: 'c5d6e7f8', cron: '0 22 * * *', prompt: en ? 'Collect the open PRs and summarise their state' : '열린 PR 을 모아 상태를 요약해 줘', recurring: true, createdAt: now - D, expiresAt: now + 6 * D, nextFireAt: nextAt(22, 0) },
  ],
  runs: [],
})

// 3. the app's own records: a blocked wake, a retry, the permission of the first start, one job excluded from auto-wake
const NARROW = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git fetch*)', 'Bash(git pull*)', 'Bash(npm run build*)', 'Bash(npm test*)', 'Bash(npm run test*)', 'Bash(npm ci*)']
const DENIED = ['Bash(git push*)', 'Bash(git reset --hard*)', 'Bash(git clean*)', 'Bash(npm publish*)', 'Bash(rm -rf*)']
put('app-state.json', {
  version: 1,
  sessions: {
    [BUILD]: {
      bgSince: now - 3 * D, lastAttemptAt: now - 30 * M, failures: 1, blocked: 'Invalid API key · Please run /login', lastError: 'Invalid API key · Please run /login',
      permissionAtStart: { mode: 'work', allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash(git *)', 'Bash(npm *)'], disallowedTools: [], at: now - 3 * D },
      hidden: { b9c0d1e2: true },
    },
    [REPORT]: {
      bgSince: now - D, lastAttemptAt: now - 2 * M, lastSuccessAt: now - D, failures: 4, nextRetryAt: now + 8 * M, lastError: 'claude --bg exited with code 1 (timed out after 60 s)',
      permissionAtStart: { mode: 'work', at: now - D, allowedTools: NARROW, disallowedTools: DENIED },
    },
  },
})
mkdirSync(join(co, 'inbox', BUILD), { recursive: true })
put(`inbox/${BUILD}/1.json`, { id: 'm1', text: en ? '[clock-out remote] build the release branch tonight instead of develop' : '[clock-out 원격 지시] 오늘은 develop 대신 release 브랜치로 빌드해', at: now - 50 * M, from: 'remote', state: 'failed', attempts: 5, lastError: 'submit failed: session busy' })
mkdirSync(join(co, 'inbox', REPORT), { recursive: true })
put(`inbox/${REPORT}/2.json`, { id: 'm2', text: en ? '[clock-out remote] add the deploy count to the report' : '[clock-out 원격 지시] 보고에 배포 횟수도 넣어 줘', at: now - 70 * M, from: 'remote', submittingAt: now - 69 * M, state: 'unknown' })

// 4. the remote jobs session: on = running with its claude.ai address, starting = on but not up yet
if (opt.remote !== 'off') writeFileSync(join(co, 'remote.json'), JSON.stringify({ sessionId: REMOTE, startedAt: now - H }))
if (opt.remote === 'on') live('live-remote', { sessionId: REMOTE, kind: 'bg', name: 'clock-out remote', bridgeSessionId: 'session_01CaptureDemo' })

put('app-settings.json', {
  version: 1, language: opt.lang, theme: opt.theme, launchAtLogin: false, onboardingDone: true,
  revive: { leadMinutes: 10, expiryLeadHours: 24, dailyAtEnd: true, confirmBefore: false, dryRun: true },
  remote: { enabled: opt.remote !== 'off', permission: 'work', notify: 'failures' },
})

// 5. what the app would have asked outside: the usage answer (fresh = an hour ahead, stale = two hours old) and `claude agents`
const pad = n => String(n).padStart(2, '0')
const local = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
put('capture/usage-cache.json', {
  fetchedAt: local(opt.usage === 'stale' ? now - 2 * H : now + H), backoffSec: 0,
  res: {
    five_hour: { utilization: 22, resets_at: new Date(nextAt(13, 0)).toISOString() },
    seven_day: { utilization: 41, resets_at: new Date(now + 3 * D + 5 * H).toISOString() },
    limits: [{ kind: 'weekly_scoped', percent: 18, severity: 'normal', resets_at: new Date(now + 3 * D + 5 * H).toISOString(), scope: { model: { display_name: 'Fable' } } }],
  },
})
put('capture/agents.json', [{ sessionId: SHOP, state: 'idle', kind: 'background' }, { sessionId: BUILD, state: 'stopped', kind: 'background' }, { sessionId: REPORT, state: 'stopped', kind: 'background' }])

// 6. the app: no dev plugin folder, no dev server, everything else pointed into the fake folder
const env = { ...process.env, CLOCKOUT_SHOT_DIR: out, CLAUDE_CONFIG_DIR: root, TEMP: join(base, 'tmp'), TMP: join(base, 'tmp') }
delete env.ELECTRON_RENDERER_URL
delete env.CLAUDE_CODE_PLUGIN_DIRS
const child = spawn(join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.'], { cwd: appDir, env, stdio: 'inherit' })
const timer = setTimeout(() => { console.error('capture timed out after 240 s'); child.kill() }, 240_000)
child.on('exit', code => { clearTimeout(timer); console.log(`capture exit ${code} -> ${out}`); process.exit(code ?? 1) })

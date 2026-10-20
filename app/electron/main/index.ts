import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { BrowserWindow, Menu, Tray, app, clipboard, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { remoteIsOn } from '@shared/schedule'
import type { AppSettings, SetupFix } from '@shared/types'

import { log } from './log'
import { paths } from './paths'
import { pingTick } from './ping'
import { deleteJob } from './deleteJob'
import { checkMissed, dismissMissed, runMissed } from './missed'
import { readRemoteState } from './remoteState'
import { attachSession, notice, onNotice, openSession, openTerminal } from './revive'
import { startScheduler, wakeSession } from './wake'
import { onRemoteSettings, openMonitor, remoteView, startRemote } from './remote'
import { checkRuns, startRunWatch } from './runWatch'
import { autoCleanup, clearSession, stopCheck, stopIfDone, tidyDone } from './cleanup'
import { buildOverview, currentOverview, setRemoteProvider, setRemoteSessionProvider, toggleHide, watchSchedule } from './schedule'
import { getSettings, setSettings } from './settings'
import { bundledPluginDir, checkSetup, runFix } from './setup'
import { currentUsage, fetchUsage } from './usage'

// clock-out desktop: a slim always-on-top status bar (usage, next job, schedule button) with a tray icon.
// Phase A: tray, status bar window, usage, settings store, first-run notice. Schedule list and revival follow.

const STRIP_HEIGHT = 32
const PANEL_WIDTH = 1000      // the jobs panel's width (narrower screens: the work area minus a margin)
const PANEL_GAP = 4           // space between the bar and the panel under it
const STRIP_WIDTH = 720   // first size; the renderer then asks for its content width (strip:width)
const USAGE_INTERVAL_MS = 5 * 60 * 1000
const SHOT_DIR = process.env.CLOCKOUT_SHOT_DIR   // dev: capture each window to this folder, then quit

let tray: Tray | undefined
let strip: BrowserWindow | undefined
let settingsWin: BrowserWindow | undefined

// Theme: 'system' follows the Windows app mode; the pages read it through prefers-color-scheme
function applyTheme(): void {
  nativeTheme.themeSource = getSettings().theme ?? 'system'
}
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0d1117' : '#ffffff'
}

function openSettings(): void {
  if (settingsWin !== undefined && !settingsWin.isDestroyed()) { settingsWin.focus(); return }
  settingsWin = new BrowserWindow({ width: 760, height: 820, minWidth: 620, minHeight: 500, title: 'clock-out', icon: iconPath(), backgroundColor: windowBackground(), autoHideMenuBar: true, minimizable: false, maximizable: false, webPreferences: lockedWebPreferences })
  settingsWin.setMenu(null)
  settingsWin.on('closed', () => { settingsWin = undefined })
  loadView(settingsWin, 'settings')
}

let guideWin: BrowserWindow | undefined
let setupWin: BrowserWindow | undefined

// "Get started · setup check": opened by itself on the first run, and from the tray / settings
function openSetup(): void {
  if (setupWin !== undefined && !setupWin.isDestroyed()) { setupWin.focus(); return }
  setupWin = new BrowserWindow({ width: 820, height: 860, minWidth: 620, minHeight: 500, title: 'clock-out', icon: iconPath(), backgroundColor: windowBackground(), autoHideMenuBar: true, webPreferences: lockedWebPreferences })
  setupWin.setMenu(null)
  setupWin.on('closed', () => { setupWin = undefined })
  loadView(setupWin, 'setup')
}

function openGuide(): void {
  if (guideWin !== undefined && !guideWin.isDestroyed()) { guideWin.focus(); return }
  guideWin = new BrowserWindow({ width: 860, height: 900, minWidth: 640, minHeight: 500, title: 'clock-out', icon: iconPath(), backgroundColor: windowBackground(), autoHideMenuBar: true, minimizable: true, maximizable: true, webPreferences: lockedWebPreferences })
  guideWin.setMenu(null)
  guideWin.on('closed', () => { guideWin = undefined })
  loadView(guideWin, 'guide')
}

let panelWin: BrowserWindow | undefined

// Where the jobs panel goes: right under the bar, its left edge on the bar's left edge; if that runs off the
// screen, its right edge on the bar's right edge; if there is no room below, above the bar.
function panelBounds(): Electron.Rectangle | undefined {
  if (strip === undefined || strip.isDestroyed()) return undefined
  const b = strip.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  const width = Math.min(PANEL_WIDTH, area.width - 16)
  const height = Math.round(area.height * getSettings().statusBar.expandedHeightRatio)
  let x = b.x
  if (x + width > area.x + area.width) x = b.x + b.width - width
  x = Math.min(Math.max(x, area.x), area.x + area.width - width)
  let y = b.y + b.height + PANEL_GAP
  if (y + height > area.y + area.height) y = Math.max(area.y, b.y - PANEL_GAP - height)
  return { x, y, width, height }
}

function tellStrip(command: 'panel-open' | 'panel-closed'): void {
  if (strip !== undefined && !strip.isDestroyed()) strip.webContents.send('command', command)
}

// Opens or closes the jobs panel window. The bar itself never moves.
function setExpanded(expanded: boolean): void {
  if (expanded) {
    if (panelWin !== undefined && !panelWin.isDestroyed()) { panelWin.focus(); return }
    const bounds = panelBounds()
    if (bounds === undefined) return
    panelWin = new BrowserWindow({
      ...bounds, frame: false, resizable: true, minWidth: 640, minHeight: 320, skipTaskbar: true,
      minimizable: false, maximizable: false, fullscreenable: false, show: false,
      title: 'clock-out', backgroundColor: windowBackground(), webPreferences: lockedWebPreferences,
    })
    panelWin.setMenu(null)
    panelWin.once('ready-to-show', () => panelWin?.show())
    panelWin.on('closed', () => { panelWin = undefined; tellStrip('panel-closed') })
    loadView(panelWin, 'panel')
    const b = strip?.getBounds()
    log(`PANEL open at ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}; bar at ${b?.x},${b?.y} ${b?.width}x${b?.height}`)
    tellStrip('panel-open')
  } else if (panelWin !== undefined && !panelWin.isDestroyed()) {
    panelWin.close()
  }
}

// Every window that shows live data gets the same pushes
function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
}

// icon.png for windows; tray.png for the tray (Electron picks tray@1.5x / @2x by display scale)
function iconPath(file = 'icon.png'): string {
  return join(__dirname, '../../resources', file)
}

function loadView(win: BrowserWindow, view: string): void {
  if (process.env.ELECTRON_RENDERER_URL !== undefined) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

// Dev helper: a PNG of the window's own page (no screen capture, so nothing in front can get in the way)
async function shot(win: BrowserWindow, name: string): Promise<void> {
  if (SHOT_DIR === undefined) return
  try {
    mkdirSync(SHOT_DIR, { recursive: true })
    const image = await win.webContents.capturePage()
    writeFileSync(join(SHOT_DIR, `${name}.png`), image.toPNG())
    log(`SHOT ${name}`)
  } catch (err) {
    log(`SHOT ${name} failed ${String(err)}`)
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function placeInsideScreen(x: number | undefined, y: number | undefined): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea
  const nx = x === undefined ? area.x + area.width - STRIP_WIDTH - 16 : Math.min(Math.max(x, area.x), area.x + area.width - STRIP_WIDTH)
  const ny = y === undefined ? area.y + 8 : Math.min(Math.max(y, area.y), area.y + area.height - STRIP_HEIGHT)
  return { x: nx, y: ny }
}

const lockedWebPreferences = {
  contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
  preload: join(__dirname, '../preload/index.js'),
}

// A transparent window is 64 px tall however small it is asked to be (measured 1219x64 for 32), and its clear lower
// half still takes clicks — over the jobs panel's close button. Cut the window down to the bar itself.
function fitStripShape(win: BrowserWindow, width: number): void {
  win.setShape([{ x: 0, y: 0, width, height: STRIP_HEIGHT }])
}

function createStrip(): BrowserWindow {
  const settings = getSettings()
  const { x, y } = placeInsideScreen(settings.statusBar.x, settings.statusBar.y)
  const win = new BrowserWindow({
    x, y, width: STRIP_WIDTH, height: STRIP_HEIGHT,
    // transparent: Windows keeps an opaque frameless window at least 39 px tall, which left a 7 px band under the 32 px bar
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
    backgroundColor: windowBackground(), title: 'clock-out',
    webPreferences: lockedWebPreferences,
  })
  win.setMenu(null)
  win.setAlwaysOnTop(true, 'screen-saver')
  fitStripShape(win, STRIP_WIDTH)
  win.on('moved', () => {
    const [nx = 0, ny = 0] = win.getPosition()
    setSettings({ statusBar: { ...getSettings().statusBar, x: nx, y: ny } })
    // the panel follows the bar
    const bounds = panelBounds()
    if (panelWin !== undefined && !panelWin.isDestroyed() && bounds !== undefined) panelWin.setPosition(bounds.x, bounds.y)
  })
  loadView(win, 'strip')
  return win
}

// First run: say what this app does before it does anything. Resolves true when the person accepted.
function onboarding(): Promise<boolean> {
  if (getSettings().onboardingDone) return Promise.resolve(true)
  return new Promise(resolve => {
    const win = new BrowserWindow({
      width: 600, height: 380, resizable: false, minimizable: false, maximizable: false,
      title: 'clock-out', icon: iconPath(), backgroundColor: windowBackground(), autoHideMenuBar: true,
      webPreferences: lockedWebPreferences,
    })
    win.setMenu(null)
    let accepted = false
    ipcMain.once('onboarding:done', () => { accepted = true; win.close() })
    win.on('closed', () => resolve(accepted))
    // capturePage needs a painted window: wait for the first paint, not just the load
    win.once('ready-to-show', () => {
      if (SHOT_DIR === undefined) return
      void (async () => { await sleep(2500); await shot(win, 'onboarding'); setSettings({ onboardingDone: true }); accepted = true; win.close() })()
    })
    loadView(win, 'onboarding')
  })
}

function pushUsage(): void {
  broadcast('usage', currentUsage())
}

function toggleStrip(): void {
  if (strip === undefined) return
  if (strip.isVisible()) strip.hide(); else strip.show()
}

// "Monitor jobs remotely": turn the remote jobs session on (if off) and open it; the panel button and the bar's menu
function monitorRemotely(): string {
  const before = getSettings()
  if (!before.remote.enabled) {
    const next = setSettings({ remote: { ...before.remote, enabled: true } })
    onRemoteSettings(before, next)
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('settings', next)
  }
  return openMonitor()
}

// Turns the remote jobs session off, the same as the setting's checkbox: enabled = false keeps the 15 s tick from starting it
// again, and remote.json stays, so the next "monitor" resumes the same session (its conversation carries on)
function stopMonitor(): string {
  const before = getSettings()
  if (before.remote.enabled) {
    const next = setSettings({ remote: { ...before.remote, enabled: false } })
    onRemoteSettings(before, next)
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('settings', next)
  }
  return before.language === 'ko' ? '원격 예약 작업 세션을 껐습니다. 다시 누르면 같은 세션을 이어서 켭니다.' : 'Turned the remote jobs session off; pressing monitor again resumes the same session.'
}

// Items of the tray menu and the bar's right-click menu, in the settings language
type MenuKey = 'refresh' | 'panel' | 'monitor' | 'monitorOpen' | 'monitorStop' | 'settings' | 'setup' | 'guide' | 'toggleStrip' | 'dataFolder' | 'log' | 'quit'
const MENU_ITEMS: Record<MenuKey, { ko: string; en: string; click: () => void }> = {
  refresh: { ko: '사용량 새로고침', en: 'Refresh usage', click: () => { void fetchUsage(true).then(pushUsage) } },
  panel: { ko: '예약 창 열기', en: 'Open the jobs panel', click: () => setExpanded(true) },
  monitor: { ko: '원격으로 예약 작업 모니터링', en: 'Monitor jobs remotely', click: () => { monitorRemotely() } },
  // shown instead of monitor while the remote jobs session runs (menuOf); the item names the action, so no question first
  monitorOpen: { ko: '원격 모니터링 열기', en: 'Open remote monitoring', click: () => { monitorRemotely() } },
  monitorStop: { ko: '원격 모니터링 끄기', en: 'Turn remote monitoring off', click: () => { notice(stopMonitor(), 'info', false) } },
  settings: { ko: '설정', en: 'Settings', click: openSettings },
  setup: { ko: '연동 점검', en: 'Setup check', click: openSetup },
  guide: { ko: '사용설명서', en: 'User guide', click: openGuide },
  toggleStrip: { ko: '상태바 보이기 / 숨기기', en: 'Show / hide status bar', click: toggleStrip },
  dataFolder: { ko: '데이터 폴더 열기', en: 'Open data folder', click: () => { void shell.openPath(paths.root) } },
  log: { ko: '로그 열기', en: 'Open log', click: () => { void shell.openPath(paths.log) } },
  quit: { ko: '종료', en: 'Quit', click: () => app.quit() },
}
const TRAY_MENU: (MenuKey | '-')[] = ['refresh', 'toggleStrip', 'settings', 'setup', 'guide', '-', 'dataFolder', 'log', '-', 'quit']
const STRIP_MENU: (MenuKey | '-')[] = ['refresh', 'panel', 'monitor', 'settings', 'setup', 'guide', '-', 'quit']

function menuOf(keys: (MenuKey | '-')[]): MenuItemConstructorOptions[] {
  const lang = getSettings().language
  // monitor becomes open + turn off while the remote jobs session runs (the bar's menu is built on every right-click)
  const expanded = keys.flatMap(k => (k === 'monitor' && remoteIsOn(remoteView()) ? ['monitorOpen', 'monitorStop'] as const : [k]))
  return expanded.map(k => (k === '-' ? { type: 'separator' as const } : { label: MENU_ITEMS[k][lang], click: MENU_ITEMS[k].click }))
}

// built again when the language changes (settings:set)
function setTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(menuOf(TRAY_MENU)))
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(iconPath('tray.png')))
  tray.setToolTip('clock-out')
  setTrayMenu()
  tray.on('click', toggleStrip)
}

function registerIpc(): void {
  ipcMain.handle('usage:get', () => currentUsage())
  ipcMain.handle('usage:refresh', async () => fetchUsage(true))
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const before = getSettings()
    const next = setSettings(patch)
    onRemoteSettings(before, next)
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    if (patch.theme !== undefined) applyTheme()
    if (patch.language !== undefined) setTrayMenu()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('settings', next)
    return next
  })
  ipcMain.handle('remote:open', () => monitorRemotely())
  ipcMain.handle('remote:stop', () => stopMonitor())
  ipcMain.on('strip:menu', () => { if (strip !== undefined && !strip.isDestroyed()) Menu.buildFromTemplate(menuOf(STRIP_MENU)).popup({ window: strip }) })
  ipcMain.on('settings:open', openSettings)
  ipcMain.on('guide:open', openGuide)
  ipcMain.on('setup:open', openSetup)
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), pluginDir: bundledPluginDir() }))
  ipcMain.handle('setup:check', () => checkSetup())
  ipcMain.handle('setup:fix', async (_e, fix: SetupFix) => {
    if (fix === 'openLogin') { openTerminal(['claude']); return { ok: true, message: 'opened' } }
    if (fix === 'openDownload') { void shell.openExternal('https://docs.claude.com/en/docs/claude-code/setup'); return { ok: true, message: 'opened' } }
    if (fix === 'openTerminalStore') { void shell.openExternal('https://aka.ms/terminal'); return { ok: true, message: 'opened' } }
    return runFix(fix)
  })
  ipcMain.on('open:external', (_e, url: string) => { if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url) })
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.handle('schedule:get', () => currentOverview())
  ipcMain.handle('schedule:hide', (_e, jobId: string) => toggleHide(String(jobId)))
  ipcMain.on('strip:expand', (_e, expanded: boolean) => setExpanded(expanded === true))
  ipcMain.handle('schedule:revive', async (_e, sessionId: string) => {
    const s = buildOverview().sessions.find(x => x.sessionId === sessionId)
    if (s === undefined) return `no session ${String(sessionId).slice(0, 8)}`
    return (await wakeSession(s, 'asked from the panel')).message
  })
  // missed jobs (Overview.missed): run one now (its prompt as the first message) or close it
  ipcMain.handle('schedule:runMissed', async (_e, sessionId: string, key: string) => {
    const text = await runMissed(String(sessionId), String(key))
    broadcast('schedule', buildOverview())
    return text
  })
  ipcMain.handle('schedule:dismissMissed', (_e, sessionId: string, key: string) => {
    const text = dismissMissed(String(sessionId), String(key))
    broadcast('schedule', buildOverview())
    return text
  })
  ipcMain.handle('schedule:delete', (_e, sessionId: string, jobId: string) => deleteJob(String(sessionId), String(jobId)))
  ipcMain.handle('schedule:stop', async (_e, sessionId: string, confirmed: boolean) => {
    const s = buildOverview().sessions.find(x => x.sessionId === sessionId)
    return s === undefined ? `no session ${String(sessionId).slice(0, 8)}` : stopIfDone(s, confirmed === true)
  })
  ipcMain.handle('schedule:clear', async (_e, sessionId: string, confirmed: boolean) => {
    const s = buildOverview().sessions.find(x => x.sessionId === sessionId)
    const text = s === undefined ? `no session ${String(sessionId).slice(0, 8)}` : await clearSession(s, confirmed === true)
    broadcast('schedule', buildOverview())   // the cleaned rows go now, not on the next 30 s tick
    return text
  })
  ipcMain.handle('schedule:tidyDone', async (_e, sessionIds: string[]) => {
    const text = await tidyDone(buildOverview().sessions, Array.isArray(sessionIds) ? sessionIds.map(String) : [])
    broadcast('schedule', buildOverview())
    return text
  })
  // the session id popover's copy button (the sandboxed page has no clipboard of its own)
  ipcMain.on('clipboard:write', (_e, text: string) => { if (typeof text === 'string') clipboard.writeText(text) })
  ipcMain.handle('schedule:stopCheck', async (_e, sessionId: string) => {
    const s = currentOverview().sessions.find(x => x.sessionId === sessionId)
    return s === undefined ? undefined : stopCheck(s)
  })
  ipcMain.handle('schedule:attach', (_e, sessionId: string) => {
    const s = currentOverview().sessions.find(x => x.sessionId === sessionId)
    return s === undefined ? `no session ${String(sessionId).slice(0, 8)}` : attachSession(s)
  })
  ipcMain.handle('schedule:open', (_e, sessionId: string) => {
    const s = currentOverview().sessions.find(x => x.sessionId === sessionId)
    return s === undefined ? `no session ${String(sessionId).slice(0, 8)}` : openSession(s)
  })
  ipcMain.on('strip:width', (_e, width: number) => {
    if (strip === undefined || strip.isDestroyed() || !Number.isFinite(width)) return
    const area = screen.getPrimaryDisplay().workArea
    const w = Math.min(Math.max(Math.ceil(width), 320), area.width)
    const [x = 0, y = 0] = strip.getPosition()
    strip.setBounds({ x: Math.min(x, area.x + area.width - w), y, width: w, height: STRIP_HEIGHT })
    fitStripShape(strip, w)
  })
}

// Capture mode runs beside an installed copy: its own profile folder, so the single-instance lock does not stop it
if (SHOT_DIR !== undefined) app.setPath('userData', join(app.getPath('temp'), 'clock-out-shot-profile'))
// a capture window covered by other windows is not painted and captures as an empty image
if (SHOT_DIR !== undefined) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// One instance: a second start just shows the status bar of the first
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { strip?.show(); strip?.focus() })
  app.whenReady().then(async () => {
    log(`START pid=${process.pid} version=${app.getVersion()}`)
    applyTheme()
    nativeTheme.on('updated', () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setBackgroundColor(windowBackground()) })
    registerIpc()
    const firstRun = !getSettings().onboardingDone
    if (!(await onboarding())) { log('EXIT onboarding declined'); app.quit(); return }
    if (firstRun && SHOT_DIR === undefined) openSetup()   // first run: check Claude Code and offer the plugin install right away
    createTray()
    strip = createStrip()
    strip.webContents.on('did-finish-load', () => {
      void fetchUsage().then(pushUsage)
      if (SHOT_DIR !== undefined) void (async () => {
        const win = strip as BrowserWindow
        // selects the session whose row shows this text (the 0.13 captures use the fake folders nightly-build and report-bot)
        const pick = (text: string) => `[...document.querySelectorAll('.session')].find(b => b.textContent.includes('${text}'))?.click()`
        await sleep(4000); await shot(win, 'statusbar')
        // the right-click menu is a native popup a capture does not see: its items go to the log
        log(`SHOT strip menu ${menuOf(STRIP_MENU).map(m => m.label ?? '—').join(' | ')}`)
        log(`SHOT strip titles ${String(await win.webContents.executeJavaScript("[...document.querySelectorAll('.strip .cell, .strip .dot')].map(c => c.title).join(' | ')"))}`)
        win.webContents.send('command', 'expand'); await sleep(3500); if (panelWin !== undefined) await shot(panelWin, 'schedule')
        await shot(win, 'statusbar-open')
        if (panelWin !== undefined) {
          // the delete confirmation on the first job card, then cancelled (nothing is deleted)
          await panelWin.webContents.executeJavaScript("document.querySelector('.card .btn.danger-text')?.click()")
          await sleep(800); await shot(panelWin, 'schedule-delete')
          await panelWin.webContents.executeJavaScript("document.querySelector('.modal .btn.ghost')?.click()")
          await sleep(500)
          // a running session (run mode badges), its done list at the bottom, then a session with only done jobs left
          await panelWin.webContents.executeJavaScript("[...document.querySelectorAll('.session')].find(b => b.querySelector('.state-dot.ok'))?.click()")
          await sleep(1500); await shot(panelWin, 'schedule-running')
          await panelWin.webContents.executeJavaScript("(() => { const d = document.querySelector('.detail'); if (d) d.scrollTop = d.scrollHeight })()")
          await sleep(800); await shot(panelWin, 'schedule-done')
          // the stop button's state and reason (a tooltip does not show in a capture)
          const stopState = "[...document.querySelectorAll('.detail-head .lucide-power, .detail > .cards > .card-head .btn.small')].map(i => i.closest('button')).map(b => (b.disabled ? 'off: ' : 'on: ') + b.textContent.trim() + ' / ' + b.title.replace(/\\n/g, ' ¶ ')).join(' | ')"
          log(`SHOT stop button ${String(await panelWin.webContents.executeJavaScript(stopState))}`)
          // the reopen popover on the running session's full id, then on a stopped session's short id in the list
          await panelWin.webContents.executeJavaScript("document.querySelector('.detail-sub .id-link')?.click()")
          await sleep(800); await shot(panelWin, 'schedule-reopen-attach')
          await panelWin.webContents.executeJavaScript("document.querySelector('.modal-backdrop.clear')?.click(); [...document.querySelectorAll('.session')].find(b => b.querySelector('.state-dot.off'))?.querySelector('.id-link')?.click()")
          await sleep(800); await shot(panelWin, 'schedule-reopen-resume')
          await panelWin.webContents.executeJavaScript("document.querySelector('.modal-backdrop.clear')?.click()")
          // the folded "only done jobs" group opened, and a session in it
          await panelWin.webContents.executeJavaScript("document.querySelector('.session.done-group')?.click()")
          await sleep(500)
          await panelWin.webContents.executeJavaScript("[...document.querySelectorAll('.session.done-only')].pop()?.click()")
          await sleep(5000); await shot(panelWin, 'schedule-done-only')   // the main process asks claude agents for the button state
          log(`SHOT stop button ${String(await panelWin.webContents.executeJavaScript(stopState))}`)
          // the footer's "clean up done" list, then cancelled (nothing is stopped or hidden)
          await panelWin.webContents.executeJavaScript("document.querySelector('.panel-footer .lucide-eye-off')?.closest('button')?.click()")
          await sleep(6000); await shot(panelWin, 'schedule-tidy')
          await panelWin.webContents.executeJavaScript("document.querySelector('.modal .btn.ghost')?.click()")
          await sleep(500)
          // the done list's "clean up the list" question on a running background session with no job left, then cancelled
          await panelWin.webContents.executeJavaScript("[...document.querySelectorAll('.session')].find(b => b.querySelector('.state-dot.ok') && b.classList.contains('done-only'))?.click()")
          await sleep(5000)
          await panelWin.webContents.executeJavaScript("document.querySelector('.detail > .cards > .card-head .btn.small .lucide-power, .detail > .cards > .card-head .btn.small .lucide-eye-off')?.closest('button')?.click()")
          await sleep(800); await shot(panelWin, 'schedule-clear')
          await panelWin.webContents.executeJavaScript("document.querySelector('.modal .btn.ghost')?.click()")
          await sleep(500)
          // the monitor button while the remote jobs session runs: open it or turn it off, then cancelled
          await panelWin.webContents.executeJavaScript("document.querySelector('.panel-footer .lucide-smartphone')?.closest('button')?.click()")
          await sleep(800); await shot(panelWin, 'schedule-remote')
          log(`SHOT monitor button ${String(await panelWin.webContents.executeJavaScript("document.querySelector('.panel-footer .lucide-smartphone')?.closest('button')?.title ?? ''"))}`)
          await panelWin.webContents.executeJavaScript("document.querySelector('.modal .btn.ghost')?.click()")
          await sleep(500)
          // 0.13: missed jobs on top, a session the app could not wake (login, not delivered, permission differs) with its
          // results unfolded, and one whose wake is retried later
          await panelWin.webContents.executeJavaScript(pick('nightly-build'))
          await sleep(1500); await shot(panelWin, 'schedule-alerts')
          await panelWin.webContents.executeJavaScript("document.querySelector('.detail > .cards > .card-head .btn.ghost.tiny')?.click(); setTimeout(() => { const d = document.querySelector('.detail'); if (d) d.scrollTop = d.scrollHeight }, 300)")
          await sleep(1200); await shot(panelWin, 'schedule-alerts-done')
          await panelWin.webContents.executeJavaScript(pick('report-bot'))
          await sleep(1500); await shot(panelWin, 'schedule-retry')
          await panelWin.webContents.executeJavaScript("document.querySelector('.session')?.click()")
        }
        openSettings(); await sleep(6000); if (settingsWin !== undefined) await shot(settingsWin, 'settings')
        if (settingsWin !== undefined) {
          // the timeline, with the mouse at 06:00 (25 % of the line) and then at 14:24 (60 %)
          const hoverAt = (x: number) => `document.querySelector('.timeline')?.closest('section')?.scrollIntoView(); (() => { const b = document.querySelector('.tl-body'); if (!b) return; const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * ${x}, clientY: r.top + 60 })) })()`
          await settingsWin.webContents.executeJavaScript(hoverAt(0.25))
          await sleep(2000); await shot(settingsWin, 'settings-timeline')
          await settingsWin.webContents.executeJavaScript(hoverAt(0.6))
          await sleep(1500); await shot(settingsWin, 'settings-timeline-cursor')
          // the remote jobs session's section (its h2 holds the phone icon)
          await settingsWin.webContents.executeJavaScript("document.querySelector('.lucide-smartphone')?.closest('section')?.scrollIntoView()")
          await sleep(1000); await shot(settingsWin, 'settings-remote')
          // the job run mode section (its h2 holds the bell icon)
          await settingsWin.webContents.executeJavaScript("document.querySelector('.lucide-bell')?.closest('section')?.scrollIntoView()")
          await sleep(1000); await shot(settingsWin, 'settings-runmode')
          // the permission section (shield icon), the align ping's experimental note (flask icon), then back to the timeline
          await settingsWin.webContents.executeJavaScript("document.querySelector('h2 .lucide-shield')?.closest('section')?.scrollIntoView()")
          await sleep(1000); await shot(settingsWin, 'settings-permission')
          await settingsWin.webContents.executeJavaScript("document.querySelector('.lucide-flask-conical')?.closest('.note')?.scrollIntoView({ block: 'center' })")
          await sleep(1000); await shot(settingsWin, 'settings-ping')
          await settingsWin.webContents.executeJavaScript("document.querySelector('.timeline')?.closest('section')?.scrollIntoView()")
          await sleep(500)
        }
        openGuide(); await sleep(9000); if (guideWin !== undefined) await shot(guideWin, 'guide')
        openSetup(); await sleep(9000); if (setupWin !== undefined) await shot(setupWin, 'setup')
        const other = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
        nativeTheme.themeSource = other; await sleep(1500)
        if (panelWin !== undefined) await shot(panelWin, `schedule-${other}`)
        // a window covered by another one is not repainted after the theme change: bring it up first
        if (settingsWin !== undefined) { settingsWin.focus(); await sleep(1000); await shot(settingsWin, `settings-timeline-${other}`) }
        if (setupWin !== undefined) await shot(setupWin, `setup-${other}`)
        if (panelWin !== undefined) { panelWin.focus(); await panelWin.webContents.executeJavaScript(pick('nightly-build')); await sleep(1200); await shot(panelWin, `schedule-alerts-${other}`) }
        if (settingsWin !== undefined) {
          settingsWin.focus(); await settingsWin.webContents.executeJavaScript("document.querySelector('h2 .lucide-shield')?.closest('section')?.scrollIntoView()")
          await sleep(1000); await shot(settingsWin, `settings-permission-${other}`)
        }
        setExpanded(false); await sleep(1500); await shot(win, `statusbar-${other}`)
        applyTheme()
        app.quit()
      })()
    })
    setInterval(() => { void fetchUsage().then(pushUsage) }, USAGE_INTERVAL_MS)
    setRemoteProvider(remoteView)   // before the first overview is built
    setRemoteSessionProvider(() => readRemoteState().sessionId)
    watchSchedule(o => { broadcast('schedule', o); checkRuns(o) }, 30_000)
    onNotice((text, kind) => broadcast('notice', text, kind))
    if (SHOT_DIR === undefined && process.env.CLOCKOUT_REVIVE === undefined) {
      startScheduler(autoCleanup); startRemote(); startRunWatch(); setInterval(pingTick, 60_000); pingTick()
      // jobs that went by while the PC was off or asleep: one notice, nothing runs on its own (missed.ts)
      checkMissed('start')
      powerMonitor.on('resume', () => { try { checkMissed('resume'); broadcast('schedule', currentOverview()) } catch (err) { log(`MISSED error ${String(err)}`) } })
    }
    // dev: CLOCKOUT_REVIVE=<session id> wakes that session once and quits
    if (process.env.CLOCKOUT_REVIVE !== undefined) {
      const target = buildOverview().sessions.find(x => x.sessionId.startsWith(process.env.CLOCKOUT_REVIVE as string))
      void (target === undefined ? Promise.resolve({ ok: false, message: 'no such session' }) : wakeSession(target, 'dev')).then(r => { log(`DEVREVIVE ${r.message}`); app.quit() })
    }
    app.setLoginItemSettings({ openAtLogin: getSettings().launchAtLogin })
  }).catch(err => { log(`START failed ${String(err)}`); app.quit() })
  app.on('window-all-closed', () => { /* tray app: stay alive without windows */ })
  app.on('before-quit', () => log(`EXIT pid=${process.pid}`))
}

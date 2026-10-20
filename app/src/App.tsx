import { useEffect, useState } from 'react'

import type { Overview } from '@shared/schedule'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings, UsageState } from '@shared/types'

import { api } from './api'
import { Guide } from './Guide'
import { SetupWindow } from './Setup'
import { Onboarding } from './Onboarding'
import { PanelWindow } from './SchedulePanel'
import { Settings } from './Settings'
import { StatusBar } from './StatusBar'

const view = new URLSearchParams(window.location.search).get('view') ?? 'strip'

export function App() {
  const [usage, setUsage] = useState<UsageState>({ rows: [], status: '', isWaiting: false })
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [overview, setOverview] = useState<Overview>({ builtAt: 0, sessions: [], jobCount: 0 })
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [now, setNow] = useState(Date.now())
  const [version, setVersion] = useState('')

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getAppInfo().then(info => setVersion(info.version))
    void api.getUsage().then(setUsage)
    void api.getSchedule().then(setOverview)
    const offUsage = api.onUsage(setUsage)
    const offSchedule = api.onSchedule(setOverview)
    const offNotice = api.onNotice(text => setMessage(text))
    const offSettings = api.onSettings(setSettings)
    const offCommand = api.onCommand(command => {
      if (command === 'expand') { setExpanded(true); api.setExpanded(true) }
      if (command === 'panel-open') setExpanded(true)
      if (command === 'panel-closed') setExpanded(false)
    })
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => { offUsage(); offSchedule(); offCommand(); offNotice(); offSettings(); clearInterval(id) }
  }, [])

  useEffect(() => { if (message === '') return; const id = setTimeout(() => setMessage(''), 6000); return () => clearTimeout(id) }, [message])

  if (view === 'onboarding') return <Onboarding settings={settings} />
  if (view === 'settings') return <Settings initial={settings} version={version} />
  if (view === 'guide') return <Guide settings={settings} version={version} />
  if (view === 'setup') return <SetupWindow settings={settings} version={version} />
  if (view === 'panel') return <PanelWindow overview={overview} settings={settings} now={now} version={version} message={message} onMessage={setMessage} />

  const toggle = () => { const next = !expanded; setExpanded(next); api.setExpanded(next) }
  return (
    <div className="root">
      <StatusBar usage={usage} settings={settings} overview={overview} expanded={expanded} now={now} version={version}
        onToggle={toggle} onQuit={() => api.quit()} />
      {message !== '' && !expanded && <div className="toast toast-bar">{message}</div>}
    </div>
  )
}

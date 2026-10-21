import { ShieldAlert } from 'lucide-react'

import type { AppSettings } from '@shared/types'

import { api } from './api'

// First-run notice: what the app does and what a revived session may do without anyone watching.
// Shown in its own window (not a native dialog) so it matches the app and can be captured for the docs.
const TEXT = {
  ko: {
    title: 'clock-out 이 하는 일',
    points: [
      '예약(CronCreate)을 건 Claude Code 세션이 꺼져 있으면, 예약 시각 전에 그 세션을 백그라운드로 다시 켭니다.',
      '다시 켜진 세션은 설정한 권한 모드로 사람 없이 파일을 고치고 명령을 실행할 수 있습니다. 기본은 "작업 가능 모드"이고, 확인을 전혀 하지 않는 bypass 는 설정에서 따로 켜야 합니다.',
      '이 앱은 PC 밖으로 아무것도 보내지 않습니다. 예외는 사용량 조회(api.anthropic.com)와 하루 한 번 새 버전 확인(api.github.com, 설정에서 끌 수 있음)이며, 로그인 토큰은 저장하거나 기록하지 않습니다.',
      '모든 되살림은 알림과 로그로 남습니다.',
    ],
    ok: '이해했습니다, 시작', quit: '종료',
  },
  en: {
    title: 'What clock-out does',
    points: [
      'When a Claude Code session with CronCreate jobs is stopped, this app wakes it in the background before the job is due.',
      'A revived session acts without anyone watching, under the permission mode you choose. The default is "work mode"; the no-confirmation bypass must be enabled separately in Settings.',
      'Nothing leaves this PC except the usage query to api.anthropic.com and a daily new-version check on api.github.com (can be turned off in Settings); your login token is never stored or logged.',
      'Every revival is shown as a notification and written to the log.',
    ],
    ok: 'I understand, start', quit: 'Quit',
  },
}

export function Onboarding({ settings }: { settings: AppSettings }) {
  const s = TEXT[settings.language]
  return (
    <div className="onboarding">
      <div className="onboarding-head">
        <ShieldAlert size={22} color="var(--warn)" />
        <h1>{s.title}</h1>
      </div>
      <ul>
        {s.points.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
      <div className="onboarding-actions">
        <button className="btn ghost" onClick={() => api.quit()}>{s.quit}</button>
        <button className="btn primary" onClick={() => { void api.setSettings({ onboardingDone: true }).then(() => api.onboardingDone()) }}>{s.ok}</button>
      </div>
    </div>
  )
}

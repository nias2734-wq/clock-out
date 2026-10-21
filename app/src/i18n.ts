// Strings of the renderer. Keys are stable; ko is the default.
const ko = {
  fiveHour: '5시간', sevenDay: '주간', weekly: '주간', loading: '불러오는 중', refreshed: '갱신', schedule: '예약', settings: '설정', guide: '사용설명서 · 연동 점검', guideShort: '사용설명서', setupCheck: '연동 점검', close: '종료',
  waiting: '갱신 대기', nextJob: '다음', stripMenuHint: '버튼 밖 아무 곳이나 끌면 옮겨집니다 · 우클릭하면 메뉴(새로고침 · 원격 모니터링 · 설정 · 연동 점검 · 사용설명서 · 숨기기)', offBoundary: '근무 리듬과 어긋남', noJobs: '예약 없음', noJobsAnywhere: '어느 세션에도 예약이 없습니다',
  noJobsHint: 'Claude Code 세션에서 CronCreate 로 예약을 걸면 여기에 나타납니다',
  sessions: '세션', running: '실행 중', stopped: '꺼짐', runningBg: '백그라운드에서 실행 중', runningTerm: '터미널에서 실행 중', runningBgHint: '백그라운드에서 도는 세션입니다. 창을 닫거나 /exit 해도 계속 돌고 예약도 울립니다. 완전히 끄려면 "세션 끄기".', runningTermHint: '터미널 창에서 도는 세션입니다. 그 창에서 /exit 하면 꺼집니다.', stopSession: '세션 끄기', deleteJob: '삭제', deleteAsk: '이 예약을 삭제할까요?', deleteHow: '삭제는 그 예약이 있는 세션이 직접 합니다. 꺼져 있으면 깨워서 지웁니다.', deleting: '삭제하는 중… (세션이 처리할 때까지 최대 2분)', deleteYes: '삭제', cancel: '취소', stopAsk: '세션을 종료하시겠습니까?', stopYes: '세션 종료', stopNo: '그대로 두기', closeDialog: '닫기', stopHint: '백그라운드 세션을 끕니다(claude stop). 예약이 남아 있으면 다음 예약 전에 clock-out 이 다시 켭니다.', jobs: '개', revive: '되살리기', attach: '예약 세션 확인하기', onPhone: '휴대폰·웹에서 열기', monitor: '원격으로 예약 작업 모니터링', monitorHint: '예약 작업을 총괄하는 원격 세션을 열어, 휴대폰 Claude 앱에서 채팅으로 현황을 보고 지시·수정하고 다른 세션을 원격으로 붙입니다.', monitorOnHint: '켜져 있음 — 누르면 열기/끄기', remoteOnAsk: '원격 예약 작업 세션이 켜져 있습니다', remoteOff: '원격 끄기', remoteOffHow: '원격 끄기는 이 세션을 끄고(claude stop) 설정의 원격 예약 작업 세션도 끕니다. 대화 기록은 남아, 다시 누르면 같은 세션을 이어서 켭니다.', runningNow: '예약 실행 중', remoteBar: '원격 예약 작업 세션', hide: '자동 깨우기 제외', unhide: '다시 포함',
  hideHint: '세션이 꺼져 있을 때 이 예약 때문에 세션을 깨우지 않습니다. 목록·실행에는 영향 없습니다(세션이 켜져 있으면 예약은 그대로 울립니다)', unhideHint: '세션이 꺼져 있을 때 이 예약 때문에 다시 세션을 깨웁니다', hideDone: '자동 깨우기에서 뺐습니다', unhideDone: '자동 깨우기에 다시 넣었습니다',
  recurring: '반복', oneShot: '1회', today: '오늘', tomorrow: '내일', later: '후',
  expires: '만료', days: '일', lastRun: '마지막 실행', hidden: '자동 깨우기 제외', fromTranscript: '대화 기록에서 읽음',
  notTrusted: '이 세션은 되살리지 않습니다', reviving: '되살리는 중…',
  runMode: '실행 방식', modeFollow: '기본값 따름', modeNow: '현재', modeQuiet: '조용히', modeNotify: '알림', modeOpen: '화면에 열기',
  modeQuietHint: '백그라운드로 실행하고 따로 알리지 않습니다(원격 알림 설정은 그대로)', modeNotifyHint: '백그라운드로 실행하고, 시작할 때와 답을 기다릴 때 Windows 알림을 띄웁니다. 알림을 누르면 세션이 열립니다', modeOpenHint: '예약 시각에 그 세션을 터미널 창으로 띄워 바로 보여 줍니다',
  modeFollowHint: '설정의 기본값을 따릅니다. 예약에서 따로 정한 방식이 있으면 그것이 먼저입니다', srcJob: '예약에서 지정', srcSession: '세션 설정', srcDefault: '기본값',
  clearDone: '목록에서 정리', clearStopHint: '예약이 끝난 백그라운드 세션을 꺼서 메모리(세션당 약 0.5GB)를 돌려받고(claude stop) 완료 기록을 목록에서 정리합니다.', clearHideHint: '완료 기록을 목록에서 정리합니다. 세션은 끄지 않습니다.',
  doneFade: '완료 기록은 7일 뒤 자연히 사라집니다. 지금 정리하면 바로 사라지고, 대화 기록은 남아 세션 id 의 명령으로 다시 열 수 있습니다.', clearWarnAsk: '이 세션을 끄고 목록에서 정리할까요?', clearWarnYes: '끄고 정리', clearAsk: '완료 기록을 목록에서 정리할까요?', clearYes: '정리',
  stopBlockTerminal: '터미널 창에서 도는 세션입니다. 그 창에서 /exit 하면 꺼집니다', stopBlockRemote: '원격 예약 작업 세션은 여기서 끄지 않습니다(아래 "원격으로 예약 작업 모니터링" 버튼이나 설정에서 끕니다)', stopBlockRunning: '예약이 실행 중이라 끌 수 없습니다',
  stopWarnBlocked: '이 세션은 답을 기다리는 중입니다', stopWarnAttached: '열린 attach 창이 연결 끊김 상태가 됩니다', stopWarnAsk: '이 세션을 끌까요?', stopWarnYes: '끄기',
  reopenTitle: '다시 여는 명령', reopenIdHint: '눌러서 이 세션을 다시 여는 명령을 복사합니다', reopenAttach: '백그라운드에서 실행 중입니다. 터미널에서 이 명령으로 붙습니다', reopenResume: '꺼져 있습니다. 터미널에서 이 명령으로 이어서 엽니다', reopenTerminal: '이미 터미널 창에서 열려 있습니다', reopenTwice: '새 창에서 또 열면 같은 세션이 두 곳에서 돌게 됩니다', reopenRemote: '원격 주소(claude.ai)', copy: '복사', copied: '복사됨',
  doneLast: '마지막', doneMore: '개 더 보기', doneLess: '접기', doneOnlyGroup: '완료만 남은 세션',
  tidyAll: '완료 정리', tidyHint: '완료만 남은 세션을 한 번에 목록에서 정리합니다. 켜진 백그라운드 세션은 끄고(claude stop) 정리합니다. 원격으로 연결된 세션은 뺍니다', tidyNone: '정리할 세션이 없습니다. 남은 예약이 없는 백그라운드 세션(예약 실행 중이 아닌 것)과 꺼진 완료만 남은 세션을 정리합니다', tidyChecking: '세션 상태를 확인하는 중…', tidyAsk: '완료된 세션을 목록에서 정리할까요?', tidyYes: '모두 정리', tidyBusy: '정리하는 중…', tidySkip: '건너뜀', tidyStopRow: '끄고 정리', tidyHideRow: '정리',
  doneTitle: '완료 · 최근 7일', doneShort: '완료', openSession: '세션 열기', openSessionHint: '실행 중이면 터미널 창으로 붙고, 꺼져 있으면 터미널에서 claude --resume 으로 엽니다', firedNoRun: '실행됨 · 결과 기록 없음',
  runAnswered: '응답 완료 · 성공 미검증', runFailed: '실패', outcomeHint: 'clock-out 은 Claude 가 답했는지만 압니다. 작업이 성공했는지는 결과를 직접 확인하세요.',
  missedTitle: '놓친 예약', missedWhy: 'PC 가 꺼져 있거나 절전 중이었습니다. 자동으로 다시 실행하지 않습니다.', missedRun: '지금 실행', missedRunHint: '세션을 깨우고 이 예약의 프롬프트를 첫 메시지로 보냅니다', missedClose: '닫기', missedCloseHint: '실행하지 않고 목록에서 닫습니다', missedClosed: '놓친 예약을 닫았습니다',
  wakeBlocked: '자동 깨우기 멈춤', wakeBlockedFix: '로그인/권한을 해결한 뒤 되살리기를 누르세요', wakeFailed: '깨우기 실패 {n}회', wakeRetryAt: '{at} 에 다시 시도', waking: '깨우는 중',
  inboxFailed: '전달 실패 {n}건', inboxFailedWhy: '5번 시도했지만 세션에 넣지 못한 지시입니다', inboxUnknown: '전달됐는지 불명 {n}건', inboxUnknownWhy: '자동으로 다시 보내지 않습니다. 세션을 열어 받았는지 확인하세요',
  permAtStart: '적용된 권한', permWork: '작업 가능 모드', permAllowed: '허용', permDenied: '차단', permMismatch: '설정과 다름 — 이 세션은 처음 켤 때의 권한을 유지합니다(Claude Code 제약)',
  usageStale: '마지막 조회 실패 — {at} 값',
  remoteStageOn: '원격 켜짐', remoteStageAddress: '원격 주소 준비 중', remoteStageStarting: '원격 시작 중', remoteStageError: '원격 오류',
  remoteStageOnHint: '원격 예약 작업 세션이 실행 중입니다. 누르면 휴대폰·claude.ai 에서 여는 주소를 엽니다. 끄려면 우클릭 메뉴의 "원격 모니터링 끄기".',
  remoteStageAddressHint: '원격 예약 작업 세션은 실행 중이고 claude.ai 주소가 아직 기록되지 않았습니다. 보통 1분 안에 생깁니다.',
  remoteStageStartingHint: '원격 예약 작업 세션을 켜는 중입니다. 15초마다 다시 확인합니다.',
  remoteStageErrorHint: '원격 예약 작업 세션을 켜지 못했습니다: {error}. 2분 뒤 다시 시도합니다.',
  warnNotUuid: '세션 id 가 UUID 형식이 아닙니다', warnNoCwd: '작업 폴더가 없습니다', warnFuture: '파일 날짜가 미래입니다', warnPrompt: '예약 프롬프트가 없거나 너무 깁니다', warnCron: '예약의 cron 형식이 잘못됐습니다',
} as const
const en: Record<keyof typeof ko, string> = {
  fiveHour: '5h', sevenDay: '7d', weekly: '7d', loading: 'loading', refreshed: 'updated', schedule: 'Jobs', settings: 'Settings', guide: 'User guide · setup check', guideShort: 'Guide', setupCheck: 'Setup check', close: 'Quit',
  waiting: 'waiting', stripMenuHint: 'Drag anywhere but the buttons to move · right-click for the menu (refresh · remote monitor · settings · setup check · user guide · hide)', offBoundary: 'off the work rhythm', nextJob: 'next', noJobs: 'no jobs', noJobsAnywhere: 'No scheduled jobs in any session',
  noJobsHint: 'Jobs you create with CronCreate in a Claude Code session show up here',
  sessions: 'Sessions', running: 'running', stopped: 'stopped', runningBg: 'running in the background', runningTerm: 'running in a terminal', runningBgHint: 'A background session: closing its window or /exit does not stop it, and its jobs still fire. To stop it, use "Stop session".', runningTermHint: 'Runs in a terminal window; /exit there stops it.', stopSession: 'Stop session', deleteJob: 'Delete', deleteAsk: 'Delete this job?', deleteHow: 'The session that owns it deletes it; a stopped one is woken for it.', deleting: 'Deleting… (up to 2 minutes while the session does it)', deleteYes: 'Delete', cancel: 'Cancel', stopAsk: 'Stop the session too?', stopYes: 'Stop session', stopNo: 'Keep it running', closeDialog: 'Close', stopHint: 'Stops this background session (claude stop). If jobs remain, clock-out wakes it before the next one.', jobs: 'jobs', revive: 'Revive', attach: 'Open session', onPhone: 'Open on phone / web', monitor: 'Monitor jobs remotely', monitorHint: 'Opens the remote session that oversees every job: from the Claude mobile app, see them, give instructions, and attach other sessions to remote, by chat.', monitorOnHint: 'On — press to open or turn off', remoteOnAsk: 'The remote jobs session is on', remoteOff: 'Turn remote off', remoteOffHow: 'Turn remote off stops this session (claude stop) and turns the remote jobs session off in Settings. The conversation stays; pressing again resumes the same session.', runningNow: 'job running', remoteBar: 'Remote jobs session', hide: 'No auto-wake', unhide: 'Include again',
  hideHint: 'While the session is stopped, it is not woken for this job. The list and the job itself are not affected (a running session still fires it)', unhideHint: 'While the session is stopped, it is woken for this job again', hideDone: 'Left out of automatic wakes', unhideDone: 'Back in automatic wakes',
  recurring: 'recurring', oneShot: 'one-shot', today: 'today', tomorrow: 'tomorrow', later: 'from now',
  expires: 'expires in', days: 'd', lastRun: 'last run', hidden: 'no auto-wake', fromTranscript: 'from transcript',
  notTrusted: 'this session will not be revived', reviving: 'reviving…',
  runMode: 'Run mode', modeFollow: 'Use default', modeNow: 'now', modeQuiet: 'Quiet', modeNotify: 'Notify', modeOpen: 'Open on screen',
  modeQuietHint: 'Runs in the background with no notice (remote notices as set)', modeNotifyHint: 'Runs in the background with a Windows notice when it starts and when it waits for your answer; clicking it opens the session', modeOpenHint: 'Opens the session in a terminal window when the job fires',
  modeFollowHint: 'Follows the default in Settings; a mode set on the job itself comes first', srcJob: 'set on the job', srcSession: 'session setting', srcDefault: 'default',
  clearDone: 'Clean up the list', clearStopHint: 'Stops this finished background session to give back its memory (about 0.5 GB each; claude stop) and cleans its done list off the panel.', clearHideHint: 'Cleans the done list off the panel. The session is not stopped.',
  doneFade: 'Done entries drop off by themselves after 7 days. Cleaning up removes them now; the conversation stays and the command under the session id opens it again.', clearWarnAsk: 'Stop this session and clean it up?', clearWarnYes: 'Stop and clean up', clearAsk: 'Clean the done list off the panel?', clearYes: 'Clean up',
  stopBlockTerminal: 'Runs in a terminal window; /exit there stops it', stopBlockRemote: 'The remote jobs session is not stopped here (turn it off with "Monitor jobs remotely" below or in Settings)', stopBlockRunning: 'A job is running',
  stopWarnBlocked: 'This session waits for your answer', stopWarnAttached: 'The open attach window will be disconnected', stopWarnAsk: 'Stop this session?', stopWarnYes: 'Stop',
  reopenTitle: 'Commands to open it again', reopenIdHint: 'Click to copy a command that opens this session again', reopenAttach: 'Runs in the background; this command attaches to it in a terminal', reopenResume: 'Stopped; this command resumes it in a terminal', reopenTerminal: 'Already open in a terminal window', reopenTwice: 'Opening it in another window runs the same session in two places', reopenRemote: 'Remote address (claude.ai)', copy: 'Copy', copied: 'Copied',
  doneLast: 'last', doneMore: ' more', doneLess: 'Show less', doneOnlyGroup: 'Sessions with only done jobs',
  tidyAll: 'Clean up done', tidyHint: 'Cleans every session with only done jobs off the list at once; a running background one is stopped first (claude stop). Sessions linked by Remote Control are left out', tidyNone: 'Nothing to clean up: background sessions with no job left (and none running) and stopped sessions with only done jobs are cleaned up', tidyChecking: 'Checking the sessions…', tidyAsk: 'Clean the finished sessions off the list?', tidyYes: 'Clean up all', tidyBusy: 'Cleaning up…', tidySkip: 'skipped', tidyStopRow: 'stop and clean up', tidyHideRow: 'clean up',
  doneTitle: 'Done · last 7 days', doneShort: 'done', openSession: 'Open session', openSessionHint: 'Attaches in a terminal while it runs; otherwise opens it with claude --resume in a terminal', firedNoRun: 'fired · no result recorded',
  runAnswered: 'answered · success not verified', runFailed: 'failed', outcomeHint: 'clock-out only knows that Claude answered. Check the result yourself to know whether the job worked.',
  missedTitle: 'Missed jobs', missedWhy: 'The PC was off or asleep. They are not run again on their own.', missedRun: 'Run now', missedRunHint: 'Wakes the session with this job’s prompt as its first message', missedClose: 'Close', missedCloseHint: 'Closes it without running', missedClosed: 'Closed the missed job',
  wakeBlocked: 'Automatic wake stopped', wakeBlockedFix: 'fix the login / permission, then press Revive', wakeFailed: 'wake failed {n} times', wakeRetryAt: 'retry at {at}', waking: 'waking',
  inboxFailed: '{n} not delivered', inboxFailedWhy: 'Instructions that five tries could not submit to the session', inboxUnknown: '{n} may not have arrived', inboxUnknownWhy: 'Not sent again on their own. Open the session to see whether it got them',
  permAtStart: 'Permission in use', permWork: 'work mode', permAllowed: 'allowed', permDenied: 'blocked', permMismatch: 'Differs from Settings — this session keeps the permission of its first start (a Claude Code limit)',
  usageStale: 'Last fetch failed — values from {at}',
  remoteStageOn: 'Remote on', remoteStageAddress: 'Remote: address pending', remoteStageStarting: 'Remote starting', remoteStageError: 'Remote error',
  remoteStageOnHint: 'The remote jobs session runs. Click to open its address (phone, claude.ai). To turn it off, use "Turn remote monitoring off" on the right-click menu.',
  remoteStageAddressHint: 'The remote jobs session runs; its claude.ai address is not written yet. It usually appears within a minute.',
  remoteStageStartingHint: 'Starting the remote jobs session; checked again every 15 s.',
  remoteStageErrorHint: 'The remote jobs session did not start: {error}. It is tried again after 2 minutes.',
  warnNotUuid: 'session id is not a UUID', warnNoCwd: 'working folder does not exist', warnFuture: 'file is dated in the future', warnPrompt: 'a job prompt is missing or too long', warnCron: 'a job has a malformed cron',
}
export type Lang = 'ko' | 'en'
export function t(lang: Lang, key: keyof typeof ko): string {
  return lang === 'ko' ? ko[key] : en[key]
}
// A string with {n} / {at} slots filled: fill(t(lang, 'wakeFailed'), { n: 3 })
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, key: string) => (values[key] === undefined ? all : String(values[key])))
}

// A session warning from validateSessionFile (shared/schedule.ts, English) in the page's language; an unknown one stays as is
const WARNING_KEYS = ['warnNotUuid', 'warnNoCwd', 'warnFuture', 'warnPrompt', 'warnCron'] as const
export function warningText(lang: Lang, warning: string): string {
  const key = WARNING_KEYS.find(k => en[k] === warning)
  return key === undefined ? warning : t(lang, key)
}

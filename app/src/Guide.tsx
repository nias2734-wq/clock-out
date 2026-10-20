import { BookOpen, ChevronRight, Settings as SettingsIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type { AppSettings } from '@shared/types'

import { QuickStart, SetupChecklist } from './Setup'

// The user guide (?view=guide): the setup check and quick start (src/Setup.tsx), then every feature and how the app
// works with Claude Code. Only the long explanations are collapsible.

const TITLE = { ko: '사용설명서', en: 'User guide' }

// What the product is for, in a few lines: the first thing a new user reads
function Intro({ lang }: { lang: AppSettings['language'] }) {
  return lang === 'ko' ? (
    <section className="g-check">
      <h2>퇴근하세요. 예약 작업은 clock-out 이 지킵니다.</h2>
      <p className="lead">터미널, VS Code, JetBrains(IntelliJ 등), Cursor 에서 Claude Code 를 쓰시나요? Claude Code 에 "매일 밤 9시에 빌드해 줘" 처럼 건 예약은 그 세션 안에만 살아 있습니다. 창을 닫으면 조용히 멈추고, Claude 앱 화면에도 나오지 않습니다.</p>
      <p className="lead">clock-out 은 흩어진 예약을 한 화면에 모아 보여 주고, 꺼진 세션은 예약 시각 직전에 다시 켜 줍니다. 퇴근 뒤에도 예약 작업이 제시간에 돌아갑니다.</p>
      <ul className="quick">
        <li><b>한눈에</b> — 모든 세션의 예약과 다음 실행 시각을 상태바와 예약 창에서 확인</li>
        <li><b>알아서</b> — 꺼진 세션을 예약 몇 분 전에 깨우고, 7일 만료 전에 예약을 다시 걸어 줌</li>
        <li><b>토큰까지</b> — 출근 때 사용량 0% 로 시작하도록 초기화 시각을 맞추고, 예약을 걸어도 되는 시간을 알려 줌</li>
        <li><b>어디서나</b> — 퇴근 뒤 휴대폰 Claude 앱에서 예약 현황을 보고, 그 야간작업에 지시하거나 수정</li>
      </ul>
    </section>
  ) : (
    <section className="g-check">
      <h2>Clock out. Your Claude Code schedules keep working.</h2>
      <p className="lead">Using Claude Code in a terminal, VS Code, JetBrains or Cursor? A job you schedule there ("build every night at 9") lives only inside that session: close the window and it silently stops, and the Claude app never shows it.</p>
      <p className="lead">clock-out gathers every session's jobs in one place and wakes a stopped session just before its job is due — so your jobs run on time after you have gone home.</p>
      <ul className="quick">
        <li><b>At a glance</b> — every session's jobs and next run on the status bar and the jobs panel</li>
        <li><b>On its own</b> — wakes a stopped session minutes before its job and renews jobs before their 7-day expiry</li>
        <li><b>Tokens too</b> — lines up the usage resets so work starts at 0 %, and shows when jobs may run</li>
        <li><b>Anywhere</b> — after work, see the jobs and give their sessions instructions from the Claude mobile app</li>
      </ul>
    </section>
  )
}

function Section({ title, icon, children, open = false }: { title: string; icon?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="g-section" open={open}>
      <summary><ChevronRight size={15} className="chev" />{icon}{title}</summary>
      <div className="g-body">{children}</div>
    </details>
  )
}

function KoContent() {
  return (
    <>
      <Section title="기능">
        <h3>상태바</h3>
        <p>화면 위에 항상 떠 있는 한 줄입니다. 끌어서 원하는 곳에 둡니다.</p>
        <ul>
          <li><b>5시간 · 주간 · 모델별 주간(예: Fable)</b> 사용량 막대와 리셋까지 남은 시간. 리셋 시각은 마우스를 올리면 보입니다. 80% 넘으면 빨강, 50% 넘으면 주황입니다.</li>
          <li>5시간 리셋 시각이 설정한 근무 리듬과 어긋나면 남은 시간이 주황으로 보입니다.</li>
          <li><b>다음</b>: 가장 가까운 예약 시각과 그 세션 이름.</li>
          <li>빨간 <b>bypass</b> 표시: 되살린 세션이 아무것도 묻지 않는 모드로 켜집니다(설정에서 끔).</li>
          <li>오른쪽 버튼: 예약(예약 창 열기) · 종료. 상태바를 <b>우클릭</b>하면 메뉴가 나옵니다: 사용량 새로고침 · 예약 창 열기 · 원격으로 예약 작업 모니터링 · 설정 · 연동 점검 · 사용설명서 · 종료.</li>
        </ul>
        <h3>예약 창</h3>
        <ul>
          <li>왼쪽: 예약이 있는 세션 목록. 초록 점은 실행 중, 회색은 꺼짐. 숫자는 예약 수. 실행 중이면 <b>백그라운드</b>인지 <b>터미널</b>인지도 표시합니다 — 백그라운드 세션은 창을 닫거나 /exit 해도 계속 돌고, 끄려면 <b>세션 끄기</b>를 누릅니다.</li>
          <li>오른쪽: 고른 세션의 예약 카드 — 일정, 반복/1회, 실제 다음 실행 시각(Claude Code 가 최대 30분 늦추는 것까지 반영), 7일 만료까지 남은 날, 마지막 실행 결과(✓/✗, 걸린 시간, 답 첫 줄).</li>
          <li><b>되살리기</b>: 꺼진 세션을 지금 백그라운드로 켭니다. <b>예약 세션 확인하기</b>: 실행 중인 세션을 터미널 창으로 열어 지금 무엇을 하는지 봅니다(그 창을 닫아도 백그라운드 세션은 계속 돕니다). <b>숨기기</b>: 꺼진 세션의 그 예약 때문에는 다시 켜지 않습니다.</li>
          <li><b>실행 방식</b>: 세션 머리에서 그 세션의 예약을 조용히 · 알림 · 화면에 열기 중 무엇으로 보여 줄지 고릅니다. 예약 카드의 배지가 실제로 적용될 방식과 그 출처(예약에서 지정 · 세션 설정 · 기본값)를 보여 줍니다.</li>
          <li><b>완료 · 최근 7일</b>: 실행된 1회 예약과 최근 7일의 실행 기록(시각, ✓/✗, 걸린 시간, 답 첫 줄). 한 줄에 하나씩 최근 3개만 보이고(나머지는 "n개 더 보기", 답 첫 줄은 마우스를 올리면 보임), 남은 예약이 있으면 접혀 있습니다. 남은 예약 없이 이 기록만 있는 세션은 왼쪽 목록 맨 아래 <b>완료만 남은 세션</b> 묶음에 모입니다. <b>세션 열기</b>: 실행 중이면 터미널 창으로 붙고, 꺼져 있으면 터미널에서 <code>claude --resume</code> 으로 엽니다.</li>
          <li><b>목록에서 정리</b>: 완료 기록은 7일 뒤 자연히 사라지고, 완료 구획 머리의 이 버튼을 누르면 바로 사라집니다(대화 기록은 남아 세션 id 의 명령으로 다시 열 수 있음). 남은 예약이 없는 백그라운드 세션은 메모리 약 0.5GB 를 쓰므로 이 버튼이 먼저 끄고 정리하고, 꺼진 세션·터미널 창 세션은 목록에서만 정리합니다. 예약 실행 중이면 눌리지 않고, 누르면 세션 이름·id 와 할 일(정리만 / 끄고 정리)을 한 번 보여 주고 묻습니다. 답 대기 중이거나 attach 창이 열려 있으면 그 경고도 같은 창에 나옵니다. 아래쪽 <b>완료 정리</b>는 남은 예약이 없는 백그라운드 세션과 꺼진 완료만 남은 세션을 목록으로 보여 주고 한 번에 정리합니다(원격으로 연결된 세션은 뺌). 설정의 <b>자동 정리</b>를 켜 두면(기본 30분) 남은 예약이 없는 세션은 알아서 끕니다(답 대기·attach 창이 있으면 건너뜀).</li>
          <li><b>세션 id 를 누르면</b> 그 세션을 다시 여는 명령이 나옵니다 — 켜져 있으면 <code>claude attach &lt;id&gt;</code>, 꺼져 있으면 작업 폴더로 가서 <code>claude --resume &lt;id&gt;</code>(PowerShell · cmd 각각). [복사] 를 눌러 터미널에 붙여 넣으세요.</li>
          <li>⚠ 표시 세션은 기록 파일이 이상해서(폴더 없음, 잘못된 id 등) 자동으로 켜지 않습니다.</li>
        </ul>
        <h3>자동 되살리기</h3>
        <ul>
          <li>예약 <b>10분 전</b>에 그 세션이 꺼져 있으면 켭니다.</li>
          <li>반복 예약이 <b>7일 만료 하루 전</b>이면 세션을 켜서 스스로 다시 걸게 합니다(실행 중인 세션은 플러그인이 알아서 다시 겁니다).</li>
          <li><b>퇴근 5분 전</b>, 근무 요일에 한 번: 예약이 남은 꺼진 세션을 모두 켭니다.</li>
          <li>같은 세션은 30분 안에 두 번 켜지 않습니다. 모든 되살림은 알림과 로그로 남습니다.</li>
        </ul>
        <h3>예약 실행 방식</h3>
        <p>백그라운드로 켜진 세션에서 예약이 돌면 화면에는 아무것도 나타나지 않습니다. 그래서 예약마다 실행 방식을 정합니다.</p>
        <ul>
          <li><b>조용히</b>: 백그라운드로 실행하고 따로 알리지 않습니다(원격 알림 설정은 그대로).</li>
          <li><b>알림</b>(기본값): 백그라운드로 실행하고, 시작할 때와 사용자 답을 기다릴 때 Windows 알림을 띄웁니다. 알림을 누르면 그 세션이 터미널 창으로 열립니다.</li>
          <li><b>화면에 열기</b>: 예약 시각에 그 세션을 터미널 창으로 띄워 바로 보여 줍니다. 미리 깨우는 것은 그대로 백그라운드로 합니다.</li>
          <li>적용 순서: 예약에서 정한 방식 → 예약 창에서 세션별로 고른 방식 → 설정의 기본값. Claude 가 예약을 만들 때 내용을 보고 정해 한 줄로 알려 주며(리마인더·질문은 화면에 열기), "이 예약은 조용히로 바꿔" 처럼 말하면 바꿉니다.</li>
        </ul>
        <h3>토큰 창 정렬</h3>
        <p>5시간 창은 첫 호출의 정시부터 5시간입니다. 점심 끝 5시간 전과 점심 끝 시각에 아주 작은 호출(<code>claude -p ok --model haiku</code>)을 한 번씩 보내, 오후 업무와 퇴근 뒤 야간 예약이 각각 새 5시간으로 시작하게 합니다. 09:00–18:00·점심 12–13시면 핑 08:05·13:05, 초기화 13:00·18:00 입니다. 출근 전 핑은 그 시각에 PC 가 켜져 있어야 하고, 새벽 예약이 창을 먼저 열면 계획이 밀립니다 — 설정의 <b>근무시간과 토큰 초기화</b> 타임라인에서 오늘 하루를 그대로 확인할 수 있습니다.</p>
      </Section>
      <Section title="원격 예약 작업 세션 (휴대폰에서 관리)">
        <p>예약 창 아래 <b>원격으로 예약 작업 모니터링</b> 버튼(또는 상태바 우클릭 메뉴)을 누르면, 예약 작업을 총괄하는 원격 세션 하나가 생깁니다. 휴대폰 Claude 앱이나 claude.ai/code 의 세션 목록에 "원격 예약 작업" 으로 나타나고, 거기서 채팅으로 관리합니다. 켜져 있으면 버튼에 초록 점이 붙고, 다시 누르면 <b>휴대폰·웹에서 열기</b> / <b>원격 끄기</b> 를 묻습니다(우클릭 메뉴는 "원격 모니터링 열기" · "원격 모니터링 끄기" 두 항목). 원격 끄기는 설정의 원격 예약 작업 세션도 끄고, 대화 기록은 남아 다음에 누르면 같은 세션을 이어서 켭니다.</p>
        <ul>
          <li><b>현황</b>: "예약 현황 보여줘" — 모든 세션의 예약, 지금 실행 중인 것, 마지막 결과(✓/✗)를 답합니다.</li>
          <li><b>지시·수정</b>: "tools 세션 예약 22시로 미뤄줘", "오늘은 release 브랜치로 해" — 그 예약이 있는 세션에 지시를 전달하고, 그 세션의 답이 <code>[clock-out 응답]</code> 으로 돌아옵니다. 꺼진 세션은 깨워서 전달합니다. 예약은 원래 세션에 그대로 있습니다.</li>
          <li><b>다른 세션 원격으로 붙이기</b>: 그 세션과 직접 대화하고 싶으면 "tools 세션 원격으로 붙여줘". 예약이 실행 중이면 "취소되거나 중복 실행될 수 있다" 는 안내 뒤에 끝나고 붙일지, 지금 붙일지 고릅니다. 다른 세션은 이렇게 요청할 때만 원격이 붙습니다.</li>
          <li><b>알림</b>: 예약이 끝나면 결과를 원격 세션으로 보내고, 원격 세션이 휴대폰 알림으로 넘깁니다(끔 / 실패만 / 모든 실행).</li>
          <li>한 번 원격으로 붙인 세션은 그 뒤로 깨울 때마다 같은 주소로 휴대폰에 다시 붙습니다. 원격 없이 이미 백그라운드로 돈 세션에는 원격을 붙일 수 없어(복사본이 생김) 지시 전달만 됩니다.</li>
          <li>휴대폰에서 보낸 말이 이 PC 에서 실행되므로 원격 세션의 권한은 기본이 작업 가능 모드입니다. PC 가 켜져 있어야 합니다(연동 점검의 절전 해제).</li>
        </ul>
      </Section>
      <Section title="Claude Code 연동 방식">
        <p>두 부분이 나눠 일합니다.</p>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />플러그인 (각 Claude Code 세션 안)</summary>
          <ul>
            <li><code>CronCreate</code>·<code>CronDelete</code>·<code>CronList</code> 결과를 가로채 <code>~/.claude/clock-out/sessions/&lt;세션 id&gt;.json</code> 에 적습니다. 세션마다 자기 파일만 씁니다.</li>
            <li>1분마다 "살아 있음"을 적고, 세션이 끝나면 "꺼짐"을 적습니다.</li>
            <li>예약이 울리면 그 결과(성공/실패, 걸린 시간)를 적습니다.</li>
            <li>반복 예약이 만료 24시간 안이면 스스로 지우고 다시 겁니다.</li>
            <li>세션 안에서 <code>/clock-out</code> 으로 같은 목록을 텍스트로 볼 수 있습니다.</li>
          </ul>
        </details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />이 앱 (세션 밖)</summary>
          <ul>
            <li>위 파일들을 읽어 목록을 만들고, 실행 중인지는 기록 시각과 Claude Code 자신의 실행 목록(<code>~/.claude/sessions</code>)으로 판단합니다.</li>
            <li>꺼진 세션을 <code>claude --bg --resume &lt;세션 id&gt;</code> 로 백그라운드에서 다시 켭니다. 다시 켜진 세션은 대화 기록에서 예약을 복원합니다.</li>
            <li>처음 백그라운드로 켤 때만 권한 옵션을 넘깁니다. 한 번 백그라운드로 돈 세션은 그 옵션을 기억하기 때문에, 다시 넘기면 다른 id 의 복사본이 생깁니다(생기면 앱이 바로 멈춥니다).</li>
            <li>켤 때 보내는 첫 메시지는 앱 안의 고정 문장입니다("CronList 로 확인하고 빠진 예약만 다시 걸어라"). 기록 파일의 내용은 넣지 않습니다.</li>
          </ul>
        </details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />플러그인이 없을 때</summary>
          <p>설정의 "플러그인 없이 돈 세션의 대화 기록도 읽기"를 켜면 <code>~/.claude/projects</code> 의 대화 기록에서 예약을 찾아 보여 줍니다. 다만 실행 결과·만료 자동 연장·실행 중 판단의 정확도는 떨어집니다.</p>
        </details>
      </Section>
      <Section title="설정 안내">
        <ul>
          <li><b>근무시간</b>: 출근·점심·퇴근·근무 요일. 핑 시각과 퇴근 일괄 되살림이 여기서 정해집니다.</li>
          <li><b>되살리기</b>: 몇 분 전에 켤지, 만료 몇 시간 전에 켤지, 퇴근 일괄 여부, 켜기 전에 확인할지, 시험 모드(로그만).</li>
          <li><b>예약 실행 방식</b>: 세션별로 고르지 않은 예약에 쓸 기본값(조용히 · 알림 · 화면에 열기).</li>
          <li><b>권한</b>: <b>작업 가능 모드</b>(기본) — 파일 수정과 허용 도구 목록은 묻지 않고 실행. <b>bypass</b> — 아무것도 묻지 않음. 사람 없이 켜진 세션이 어떤 명령이든 실행하므로 경고를 거쳐야 켜집니다.</li>
          <li><b>화면</b>: 테마(Windows 따라가기·라이트·다크), 언어, Windows 시작 시 자동 실행.</li>
        </ul>
        <button className="btn secondary small" onClick={() => { /* opened from main */ window.clockOut.openSettings() }}><SettingsIcon size={13} /> 설정 열기</button>
      </Section>
      <Section title="문제 해결">
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />예약 창에 세션이 안 보입니다</summary>
          <p>그 세션이 플러그인을 적재하기 전에 열린 세션입니다. 세션을 닫았다 다시 열거나, 설정에서 대화 기록 읽기를 켜세요. 위 점검의 "세션 기록 수신"이 초록이면 정상입니다.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />되살렸는데 예약이 안 울렸습니다</summary>
          <p>트레이 메뉴 → Open log 에서 <code>NOTICE … woken</code> 줄을 찾으세요. 없으면 세션이 ⚠(신뢰 안 함) 상태이거나 숨김 처리된 예약일 수 있습니다. 반복 예약은 Claude Code 가 최대 30분 늦게 돌립니다.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />같은 세션이 두 개 생겼습니다</summary>
          <p>예전 위젯이나 PowerShell 서비스가 함께 돌고 있을 수 있습니다. 위 점검의 "겹치는 프로그램"에서 끄기를 누르세요. 남은 복사본은 <code>claude stop &lt;id&gt;</code> 로 멈춥니다.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />사용량이 "갱신 대기"로 멈춰 있습니다</summary>
          <p>사용량 서버는 10분에 5번 넘게 물으면 잠시 막습니다. 앱이 5분부터 최대 60분까지 기다렸다가 다시 묻습니다.</p></details>
      </Section>
      <Section title="데이터와 개인정보">
        <ul>
          <li>PC 밖으로 나가는 것은 사용량 조회(api.anthropic.com) 하나입니다. 로그인 토큰은 저장하거나 기록하지 않습니다.</li>
          <li>포트를 열지 않고, 자동 업데이트·원격 전송이 없습니다.</li>
          <li>파일 위치: 세션 기록 <code>~/.claude/clock-out/sessions</code>, 앱 설정 <code>~/.claude/clock-out/app-settings.json</code>, 로그 <code>~/.claude/clock-out/app.log</code>.</li>
        </ul>
      </Section>
    </>
  )
}

function EnContent() {
  return (
    <>
      <Section title="Features">
        <ul>
          <li><b>Status bar</b>: 5-hour, weekly and per-model weekly usage (e.g. Fable) with reset countdowns (the reset time shows on hover), the next job, a red <b>bypass</b> pill when bypass is on, buttons for jobs · quit. <b>Right-click</b> the bar for the menu: refresh usage · open the jobs panel · monitor jobs remotely · settings · setup check · user guide · quit.</li>
          <li><b>Jobs panel</b>: sessions (green = running), job cards with real next run, expiry, last run; <b>Revive</b>, <b>Open session</b>, <b>Hide</b>. ⚠ sessions are never revived automatically.</li>
          <li><b>Run mode</b>: how a fired job is shown — <b>Quiet</b> (background, no notice), <b>Notify</b> (default; a Windows notice when it starts and when it waits for your answer, click to open the session), <b>Open on screen</b> (a terminal window on the session at the job time). The job's own mode comes first (Claude picks it when it creates the job), then the session's choice in the jobs panel, then the default in Settings.</li>
          <li><b>Done · last 7 days</b>: fired one-shots and the runs of the last 7 days stay in the jobs panel one line each, the newest 3 first ("n more" for the rest, the answer on hover), folded while jobs are left; sessions with nothing left gather in <b>Sessions with only done jobs</b> at the bottom of the list; <b>Open session</b> attaches while it runs, else opens it with <code>claude --resume</code>.</li>
          <li><b>Clean up the list</b>: done entries drop off by themselves after 7 days; this button at the head of the done list removes them now (the conversation stays, and the command under the session id opens it again). A background session with no job left holds about 0.5 GB of memory, so the button stops it first; a stopped or terminal session is only cleaned off the list. It is off while a job runs; pressing it shows the session name and id and what it will do (clean up only / stop and clean up) and asks once, with any warning (waits for your answer, an attach window is open) in the same question. <b>Clean up done</b> at the bottom lists every background session with no job left and every stopped session with only done jobs, and cleans them up at once (sessions linked by Remote Control are left out). With <b>Clean up finished background sessions</b> on in Settings (30 min by default), a session with no job left is stopped by itself (skipped while it waits for an answer or an attach window is open).</li>
          <li><b>Click a session id</b> for the command that opens it again — <code>claude attach &lt;id&gt;</code> while it runs, else <code>claude --resume &lt;id&gt;</code> in its folder (PowerShell and cmd) — and <b>Copy</b> it into a terminal.</li>
          <li><b>Automatic revival</b>: 10 minutes before a job, a day before a recurring job expires, and once 5 minutes before your work end; never twice within 30 minutes.</li>
          <li><b>Window alignment</b>: a tiny <code>claude -p ok</code> call 5 h before lunch end and at lunch end, so the afternoon and the nightly jobs each start with a fresh window. Settings › Work hours and token resets draws today on a timeline.</li>
        </ul>
      </Section>
      <Section title="Remote jobs session (manage from the phone)">
        <p>Press <b>Monitor jobs remotely</b> under the jobs panel (or the status bar's right-click menu): one remote session that oversees every job starts, shows up as "Remote jobs" in the Claude mobile app or claude.ai/code, and you manage the jobs there by chat. While it is on the button shows a green dot, and pressing it again asks <b>Open on phone / web</b> or <b>Turn remote off</b> (the right-click menu shows "Open remote monitoring" and "Turn remote monitoring off"). Turning it off also turns it off in Settings; the conversation stays, and the next press resumes the same session.</p>
        <ul>
          <li><b>Status</b>: "show the jobs" — every session's jobs, what runs now, the last result (✓/✗).</li>
          <li><b>Instructions</b>: "move the tools job to 22:00" — forwarded to the session that owns the job; its answer comes back as <code>[clock-out 응답]</code>. A stopped session is woken for it. Jobs stay where they are.</li>
          <li><b>Attach another session</b>: "attach the tools session to remote" to talk to it directly. While a job runs you are told it may be cancelled or run twice, and choose after it or now. Other sessions get remote only when asked like this.</li>
          <li><b>Notices</b>: finished jobs are reported to the remote session, which pushes them to the phone (off / failures / every run).</li>
          <li>A session attached once reconnects at the same address on every later wake. One that already ran in the background without remote cannot get it (a copy would start); instructions still reach it.</li>
        </ul>
      </Section>
      <Section title="How it works with Claude Code">
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />The plugin (inside each session)</summary>
          <p>Hooks CronCreate / CronDelete / CronList and writes <code>~/.claude/clock-out/sessions/&lt;id&gt;.json</code> (each session writes only its own file), a heartbeat every minute, the result of every fired job, and renews recurring jobs 24 h before expiry. <code>/clock-out</code> shows the list as text.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />This app (outside sessions)</summary>
          <p>Reads those files, decides liveness from heartbeats and Claude Code's own <code>~/.claude/sessions</code>, and wakes a stopped session with <code>claude --bg --resume &lt;id&gt;</code> and a fixed first message. Permission flags go only on the first background start (later flags would start a copy, which the app stops).</p></details>
      </Section>
      <Section title="Data and privacy">
        <p>The only network call is the usage query to api.anthropic.com; the login token is never stored or logged. No port, no auto-update. Files live in <code>~/.claude/clock-out/</code>.</p>
      </Section>
    </>
  )
}

export function Guide({ settings, version }: { settings: AppSettings; version: string }) {
  const lang = settings.language
  return (
    <div className="guide">
      <h1><BookOpen size={19} /> {TITLE[lang]} <span className="version">v{version}</span></h1>
      <Intro lang={lang} />
      <SetupChecklist lang={lang} />
      <QuickStart lang={lang} />
      {lang === 'ko' ? <KoContent /> : <EnContent />}
    </div>
  )
}

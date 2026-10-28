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
        <li><b>토큰까지</b> — 예약을 걸어도 되는 시간을 알려 주고, (실험 기능) 초기화 시각을 근무 리듬에 맞추려고 시도함</li>
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
        <li><b>Tokens too</b> — shows when jobs may run, and (experimental) tries to line the usage resets up with your work day</li>
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
        <p>화면 위에 항상 떠 있는 한 줄입니다. 버튼(예약 · 종료) 밖 아무 곳이나 끌어서(또는 왼쪽 끝 손잡이 ⋮⋮ 로) 원하는 곳에 둡니다. 원격 예약 작업 세션이 켜져 있으면 "원격 켜짐 / 시작 중 / 주소 준비 중 / 오류" 를 글자로 보여 주고, 누르면 그 세션을 엽니다.</p>
        <ul>
          <li><b>5시간 · 주간 · 모델별 주간(예: Fable)</b> 사용량 막대와 리셋까지 남은 시간. 리셋 시각은 마우스를 올리면 보입니다. 80% 넘으면 빨강, 50% 넘으면 주황입니다.</li>
          <li>5시간 리셋 시각이 설정한 근무 리듬과 어긋나면 남은 시간이 주황으로 보입니다.</li>
          <li>사용량 조회가 실패하면(로그인 만료·네트워크·조회 제한) 막대가 흐려지고, 마우스를 올리면 "마지막 조회 실패 — 몇 시 값" 이 보입니다. 예약 보기와 깨우기는 그대로 동작합니다.</li>
          <li><b>다음</b>: 가장 가까운 예약 시각과 그 세션 이름.</li>
          <li>빨간 <b>bypass</b> 표시: 되살린 세션이 아무것도 묻지 않는 모드로 켜집니다(설정에서 끔).</li>
          <li>오른쪽 버튼: 예약(예약 창 열기) · 종료. 상태바를 <b>우클릭</b>하면 메뉴가 나옵니다: 사용량 새로고침 · 예약 창 열기 · 원격으로 예약 작업 모니터링 · 설정 · 연동 점검 · 사용설명서 · 상태바 숨기기 · 종료. 숨긴 상태바는 작업 표시줄 오른쪽 clock-out 트레이 아이콘(안 보이면 ^ 안)을 누르면 다시 보입니다.</li>
        </ul>
        <h3>예약 창</h3>
        <ul>
          <li>왼쪽: 예약이 있는 세션 목록. 초록 점은 실행 중, 회색은 꺼짐. 숫자는 예약 수. 실행 중이면 <b>백그라운드</b>인지 <b>터미널</b>인지도 표시합니다 — 백그라운드 세션은 창을 닫거나 /exit 해도 계속 돌고, 끄려면 <b>세션 끄기</b>를 누릅니다.</li>
          <li>오른쪽: 고른 세션의 예약 카드 — 일정, 반복/1회, 실제 다음 실행 시각(Claude Code 가 최대 30분 늦추는 것까지 반영), 7일 만료까지 남은 날, 마지막 실행 결과(걸린 시간, 답 첫 줄). 결과는 <b>응답 완료 · 성공 미검증</b>(회색) 또는 <b>✗ 실패</b>(빨강, 오류·중단·거절로 끝남)입니다. clock-out 은 Claude 가 답했는지만 압니다. 작업이 성공했는지는 결과를 직접 확인하세요.</li>
          <li><b>되살리기</b>: 꺼진 세션을 지금 백그라운드로 켭니다. <b>예약 세션 확인하기</b>: 실행 중인 세션을 터미널 창으로 열어 지금 무엇을 하는지 봅니다(그 창을 닫아도 백그라운드 세션은 계속 돕니다). <b>자동 깨우기 제외</b>: 세션이 꺼져 있을 때 그 예약 때문에는 세션을 깨우지 않습니다. 목록·실행에는 영향 없습니다(세션이 켜져 있으면 예약은 그대로 울립니다). 제외한 예약은 <b>다시 포함</b>으로 되돌립니다.</li>
          <li><b>놓친 예약</b>: PC 가 꺼져 있거나 절전 중이어서 지나간 꺼진 세션의 예약(최근 24시간)은 예약 창 위에 모아 보여 주고 알림을 띄웁니다. 자동으로 다시 실행하지 않습니다. <b>지금 실행</b>은 세션을 깨우며 그 예약의 프롬프트를 첫 메시지로 보내고, <b>닫기</b>는 실행하지 않고 목록에서 닫습니다. 앱을 켤 때와 절전에서 깨어날 때 찾습니다.</li>
          <li><b>세션 머리의 경고 줄</b>: 빨간 <b>자동 깨우기 멈춤</b> — 로그인·권한 문제로 깨우지 못해 자동 깨우기를 멈췄습니다. 해결한 뒤 <b>되살리기</b>를 누르세요. 주황 <b>깨우기 실패 n회 · hh:mm 에 다시 시도</b> — 일시 실패라 그 시각에 다시 시도합니다. <b>깨우는 중</b> 표시가 있으면 되살리기 버튼이 잠깁니다. 빨간 <b>전달 실패</b> / 주황 <b>전달됐는지 불명</b> — 원격 지시를 그 세션에 넣지 못했거나 넣었는지 알 수 없습니다(지시 앞부분 표시, 자동으로 다시 보내지 않음).</li>
          <li><b>적용된 권한</b>: 세션 id 옆에 그 세션을 처음 백그라운드로 켤 때 넘긴 권한(작업 가능 모드 · 허용 n · 차단 n, 마우스를 올리면 목록)이 보입니다. 지금 설정과 다르면 <b>설정과 다름</b> 줄이 붙습니다 — 이 세션은 처음 켤 때의 권한을 유지합니다(Claude Code 제약).</li>
          <li><b>실행 방식</b>: 세션 머리에서 그 세션의 예약을 조용히 · 알림 · 화면에 열기 중 무엇으로 보여 줄지 고릅니다. 예약 카드의 배지가 실제로 적용될 방식과 그 출처(예약에서 지정 · 세션 설정 · 기본값)를 보여 줍니다.</li>
          <li><b>완료 · 최근 7일</b>: 실행된 1회 예약과 최근 7일의 실행 기록(시각, 걸린 시간, 응답 완료 · 성공 미검증 / 실패, 답 첫 줄). 한 줄에 하나씩 최근 3개만 보이고(나머지는 "n개 더 보기", 답 첫 줄은 마우스를 올리면 보임), 남은 예약이 있으면 접혀 있습니다. 남은 예약 없이 이 기록만 있는 세션은 왼쪽 목록 맨 아래 <b>완료만 남은 세션</b> 묶음에 모입니다. <b>세션 열기</b>: 실행 중이면 터미널 창으로 붙고, 꺼져 있으면 터미널에서 <code>claude --resume</code> 으로 엽니다.</li>
          <li><b>목록에서 정리</b>: 완료 기록은 7일 뒤 자연히 사라지고, 완료 구획 머리의 이 버튼을 누르면 바로 사라집니다(대화 기록은 남아 세션 id 의 명령으로 다시 열 수 있음). 남은 예약이 없는 백그라운드 세션은 메모리 약 0.5GB 를 쓰므로 이 버튼이 먼저 끄고 정리하고, 꺼진 세션·터미널 창 세션은 목록에서만 정리합니다. 예약 실행 중이면 눌리지 않고, 누르면 세션 이름·id 와 할 일(정리만 / 끄고 정리)을 한 번 보여 주고 묻습니다. 답 대기 중이거나 attach 창이 열려 있으면 그 경고도 같은 창에 나옵니다. 아래쪽 <b>완료 정리</b>는 남은 예약이 없는 백그라운드 세션과 꺼진 완료만 남은 세션을 목록으로 보여 주고 한 번에 정리합니다(원격으로 연결된 세션은 뺌). 설정의 <b>자동 정리</b>를 켜 두면(기본 30분) 남은 예약이 없는 세션은 알아서 끕니다(답 대기·attach 창이 있으면 건너뜀).</li>
          <li><b>세션 id 를 누르면</b> 그 세션을 다시 여는 명령이 나옵니다 — 켜져 있으면 <code>claude attach &lt;id&gt;</code>, 꺼져 있으면 작업 폴더로 가서 <code>claude --resume &lt;id&gt;</code>(PowerShell · cmd 각각). [복사] 를 눌러 터미널에 붙여 넣으세요.</li>
          <li>⚠ 표시 세션은 기록 파일이 이상해서(폴더 없음, 잘못된 id 등) 자동으로 켜지 않습니다.</li>
        </ul>
        <h3>자동 되살리기</h3>
        <ul>
          <li>예약 <b>10분 전</b>에 그 세션이 꺼져 있으면 켭니다.</li>
          <li>반복 예약이 <b>7일 만료 하루 전</b>이면 세션을 켜서 스스로 다시 걸게 합니다(실행 중인 세션은 플러그인이 알아서 다시 겁니다).</li>
          <li><b>퇴근 5분 전</b>, 근무 요일에 한 번: 예약이 남은 꺼진 세션을 켭니다. '자동 깨우기 제외' 예약만 남은 세션, 경고가 붙은 세션, 깨우기가 차단된 세션, 30분 안에 깨운 세션은 켜지 않습니다.</li>
          <li>깨우기가 실패하면 5초 · 15초 · 45초 · 2분 뒤에 다시 시도하고, 그래도 안 되면 10분 뒤에 다시 시도합니다. 로그인·권한 문제로 실패하면 다시 시도하지 않고 세션 머리에 빨간 줄로 알립니다.</li>
          <li>깨우기에 성공한 세션은 30분 안에 다시 켜지 않습니다. 모든 되살림은 알림과 로그로 남습니다.</li>
        </ul>
        <h3>예약 실행 방식</h3>
        <p>백그라운드로 켜진 세션에서 예약이 돌면 화면에는 아무것도 나타나지 않습니다. 그래서 예약마다 실행 방식을 정합니다.</p>
        <ul>
          <li><b>조용히</b>: 백그라운드로 실행하고 따로 알리지 않습니다(원격 알림 설정은 그대로).</li>
          <li><b>알림</b>(기본값): 백그라운드로 실행하고, 시작할 때와 사용자 답을 기다릴 때 Windows 알림을 띄웁니다. 알림을 누르면 그 세션이 터미널 창으로 열립니다.</li>
          <li><b>화면에 열기</b>: 예약 시각에 그 세션을 터미널 창으로 띄워 바로 보여 줍니다. 미리 깨우는 것은 그대로 백그라운드로 합니다.</li>
          <li>적용 순서: 예약에서 정한 방식 → 예약 창에서 세션별로 고른 방식 → 설정의 기본값. Claude 가 예약을 만들 때 내용을 보고 정해 한 줄로 알려 주며(리마인더·질문은 화면에 열기), "이 예약은 조용히로 바꿔" 처럼 말하면 바꿉니다.</li>
        </ul>
        <h3>토큰 창 정렬 (실험 기능, 기본 꺼짐)</h3>
        <p>Anthropic 이 보장하는 동작이 아니라 관찰한 규칙에 기댑니다. 초기화 시각을 보장하지 않습니다. 관찰한 규칙은 "5시간 창은 첫 호출의 정시부터 5시간" 입니다. 켜 두면 점심 끝 5시간 전과 점심 끝 시각에 아주 작은 호출(<code>claude -p ok --model haiku</code>)을 한 번씩 보내, 오후 업무와 퇴근 뒤 야간 예약이 각각 새 5시간으로 시작하도록 시도합니다. 09:00–18:00·점심 12–13시면 핑 08:05·13:05, 예상 초기화 13:00·18:00 입니다. 출근 전 핑은 그 시각에 PC 가 켜져 있어야 하고, 새벽 예약이 창을 먼저 열면 계획이 밀립니다 — 설정의 <b>근무시간과 토큰 초기화</b> 타임라인에서 오늘 하루를 그대로 확인할 수 있습니다.</p>
      </Section>
      <Section title="원격 예약 작업 세션 (휴대폰에서 관리)">
        <p>예약 창 아래 <b>원격으로 예약 작업 모니터링</b> 버튼(또는 상태바 우클릭 메뉴)을 누르면, 예약 작업을 총괄하는 원격 세션 하나가 생깁니다. 휴대폰 Claude 앱이나 claude.ai/code 의 세션 목록에 "원격 예약 작업" 으로 나타나고, 거기서 채팅으로 관리합니다. 켜져 있으면 버튼에 초록 점이 붙고, 다시 누르면 <b>휴대폰·웹에서 열기</b> / <b>원격 끄기</b> 를 묻습니다(우클릭 메뉴는 "원격 모니터링 열기" · "원격 모니터링 끄기" 두 항목). 원격 끄기는 설정의 원격 예약 작업 세션도 끄고, 대화 기록은 남아 다음에 누르면 같은 세션을 이어서 켭니다.</p>
        <ul>
          <li><b>현황</b>: "예약 현황 보여줘" — 모든 세션의 예약, 지금 실행 중인 것, 마지막 결과(응답 완료 · 성공 미검증 / ✗ 실패)를 답합니다.</li>
          <li><b>지시·수정</b>: "tools 세션 예약 22시로 미뤄줘", "오늘은 release 브랜치로 해" — 그 예약이 있는 세션에 지시를 전달하고, 그 세션의 답이 <code>[clock-out 응답]</code> 으로 돌아옵니다. 꺼진 세션은 깨워서 전달합니다. 예약은 원래 세션에 그대로 있습니다. 5번 시도해도 넣지 못한 지시는 예약 창의 그 세션에 <b>전달 실패</b>로, 넣었는지 알 수 없는 지시는 <b>전달됐는지 불명</b>으로 보이고 자동으로 다시 보내지 않습니다.</li>
          <li><b>다른 세션 원격으로 붙이기</b>: 그 세션과 직접 대화하고 싶으면 "tools 세션 원격으로 붙여줘". 예약이 실행 중이면 "취소되거나 중복 실행될 수 있다" 는 안내 뒤에 끝나고 붙일지, 지금 붙일지 고릅니다. 다른 세션은 이렇게 요청할 때만 원격이 붙습니다.</li>
          <li><b>알림</b>: 예약이 끝나면 결과를 원격 세션으로 보내고, 원격 세션이 휴대폰 알림으로 넘깁니다(끔 / 실패만 / 모든 실행). "실패만" 은 오류·중단·거절로 끝난 실행입니다. 답을 한 실행은 작업이 실패했어도 여기 들지 않으니 결과를 직접 확인하세요.</li>
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
            <li>예약이 울리면 그 결과(응답 완료 · 실패, 걸린 시간, 답 첫 줄)를 적습니다. 응답 완료는 Claude 가 답했다는 뜻이고 작업 성공을 뜻하지 않습니다.</li>
            <li>반복 예약이 만료 24시간 안이면 스스로 지우고 다시 겁니다.</li>
            <li>세션 안에서 <code>/clock-out</code> 으로 같은 목록을 텍스트로 볼 수 있습니다.</li>
          </ul>
        </details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />이 앱 (세션 밖)</summary>
          <ul>
            <li>위 파일들을 읽어 목록을 만들고, 실행 중인지는 기록 시각과 Claude Code 자신의 실행 목록(<code>~/.claude/sessions</code>)으로 판단합니다.</li>
            <li>꺼진 세션을 <code>claude --bg --resume &lt;세션 id&gt;</code> 로 백그라운드에서 다시 켭니다. 다시 켜진 세션은 대화 기록에서 예약을 복원합니다.</li>
            <li>처음 백그라운드로 켤 때만 권한 옵션을 넘깁니다. 한 번 백그라운드로 돈 세션은 그 옵션을 기억하기 때문에, 다시 넘기면 다른 id 의 복사본이 생깁니다(생기면 앱이 바로 멈춥니다). 그때 넘긴 권한은 앱 기록(<code>~/.claude/clock-out/app-state.json</code>)에 남아 예약 창에 <b>적용된 권한</b>으로 보입니다.</li>
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
          <li><b>권한</b>: <b>작업 가능 모드</b>(기본) — 파일 수정과 허용 도구 목록은 묻지 않고 실행. 권장 허용 목록은 파일 읽기·수정, git status·diff·log·fetch·pull, 빌드·테스트(npm run build·test, npm ci)입니다. <b>차단 도구</b> — push·publish·reset --hard·clean·rm -rf 는 기본 차단하며 bypass 에서도 적용됩니다. 차단은 <b>예약이 실행되는 동안에만</b> 걸리고, 같은 세션을 사람이 직접 쓸 때는 걸리지 않습니다. 예약 실행 중 git push 는 원격 예약 작업 세션이 켜져 있으면 그쪽에 승인을 묻고, 꺼져 있으면 막습니다. 차단 목록을 바꾸면 다음 예약 실행부터 바로 적용됩니다. <b>권장 기본값으로</b> 버튼은 두 목록을 이 값으로 되돌립니다(예전에 저장한 목록은 자동으로 바꾸지 않음). <b>bypass</b> — 아무것도 묻지 않음. 사람 없이 켜진 세션이 어떤 명령이든 실행하므로 경고를 거쳐야 켜집니다. 바꾼 권한은 다음에 처음 백그라운드로 켜는 세션부터 적용됩니다.</li>
          <li><b>토큰 창 정렬</b>: 실험 기능이라 기본으로 꺼져 있습니다. 켜도 초기화 시각을 보장하지 않습니다.</li>
          <li><b>화면</b>: 테마(Windows 따라가기·라이트·다크), 언어, Windows 시작 시 자동 실행.</li>
        </ul>
        <button className="btn secondary small" onClick={() => { /* opened from main */ window.clockOut.openSettings() }}><SettingsIcon size={13} /> 설정 열기</button>
      </Section>
      <Section title="문제 해결">
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />예약 창에 세션이 안 보입니다</summary>
          <p>그 세션이 플러그인을 적재하기 전에 열린 세션입니다. 세션을 닫았다 다시 열거나, 설정에서 대화 기록 읽기를 켜세요. 위 점검의 "세션 기록 수신"이 초록이면 정상입니다.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />되살렸는데 예약이 안 울렸습니다</summary>
          <p>트레이 메뉴 → Open log 에서 <code>NOTICE … woken</code> 줄을 찾으세요. 없으면 세션이 ⚠(신뢰 안 함) 상태이거나 자동 깨우기에서 제외한 예약일 수 있습니다. 세션 머리에 빨간 <b>자동 깨우기 멈춤</b> 줄이 있으면 로그인(터미널에서 <code>claude</code> → <code>/login</code>)이나 권한 문제를 해결한 뒤 되살리기를 누르세요. PC 가 꺼져 있었다면 예약 창 위 <b>놓친 예약</b>에서 지금 실행할 수 있습니다. 반복 예약은 Claude Code 가 최대 30분 늦게 돌립니다.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />같은 세션이 두 개 생겼습니다</summary>
          <p>예전 위젯이나 PowerShell 서비스가 함께 돌고 있을 수 있습니다. 위 점검의 "겹치는 프로그램"에서 끄기를 누르세요. 남은 복사본은 <code>claude stop &lt;id&gt;</code> 로 멈춥니다.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />사용량이 "갱신 대기"로 멈춰 있습니다</summary>
          <p>사용량 서버는 짧은 시간에 여러 번 물으면 잠시 막습니다(관찰한 값으로 10분에 5번 안팎, 공개된 규칙은 아닙니다). 앱이 5분부터 최대 60분까지 기다렸다가 다시 묻습니다. 그동안 막대는 흐리게 마지막 값을 보여 주고, 예약 보기와 깨우기는 그대로 동작합니다.</p></details>
      </Section>
      <Section title="데이터와 개인정보">
        <ul>
          <li>PC 밖으로 나가는 것은 사용량 조회(api.anthropic.com)와 새 버전 확인(api.github.com) 두 가지입니다. 로그인 토큰은 저장하거나 기록하지 않습니다.</li>
          <li>포트를 열지 않고, 자동 업데이트·원격 전송이 없습니다. 새 버전 알림(설정에서 끌 수 있음)은 하루 한 번 GitHub 의 최신 릴리스 번호만 확인하고, 내려받거나 설치하지 않습니다.</li>
          <li>파일 위치: 세션 기록 <code>~/.claude/clock-out/sessions</code>, 앱 기록(깨우기·적용된 권한) <code>~/.claude/clock-out/app-state.json</code>, 앱 설정 <code>~/.claude/clock-out/app-settings.json</code>, 로그 <code>~/.claude/clock-out/app.log</code>.</li>
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
          <li><b>Status bar</b>: drag it anywhere but its buttons (or by the grip ⋮⋮ at its left end). While the remote jobs session is on it says Remote on / starting / address pending / error in words (click to open it). 5-hour, weekly and per-model weekly usage (e.g. Fable) with reset countdowns (the reset date and time show on hover, e.g. 10/24(Sat) 05:00), the next job, a red <b>bypass</b> pill when bypass is on, buttons for jobs · quit. When a usage fetch fails (expired login, network, rate limit) the bars fade and the hover says when the values are from; jobs and wakes carry on. <b>Right-click</b> the bar for the menu: refresh usage · open the jobs panel · monitor jobs remotely · settings · setup check · user guide · hide the status bar · quit. Click the clock-out tray icon (under ^ if not shown) to bring a hidden bar back.</li>
          <li><b>Jobs panel</b>: sessions (green = running), job cards with real next run, expiry, last run; <b>Revive</b>, <b>Open session</b>, <b>No auto-wake</b> (a stopped session is not woken for that job; the list and the job itself are not affected). ⚠ sessions are never revived automatically.</li>
          <li><b>Run results</b>: <b>answered · success not verified</b> (grey) or <b>✗ failed</b> (red: ended with an error, abort or refusal). clock-out only knows that Claude answered. Check the result yourself to know whether the job worked.</li>
          <li><b>Missed jobs</b>: jobs of stopped sessions that went by while the PC was off or asleep (last 24 hours) are listed on top of the jobs panel with a notice, found on app start and on resume from sleep. They are not run again on their own: <b>Run now</b> wakes the session with the job's prompt as its first message, <b>Close</b> drops it.</li>
          <li><b>Session warnings</b>: red <b>Automatic wake stopped</b> (a login or permission failure: fix it, then press Revive), orange <b>wake failed n times · retry at hh:mm</b>, a <b>waking</b> pill while a wake runs, red <b>not delivered</b> / orange <b>may not have arrived</b> for remote instructions (never sent again on their own). Next to the session id, <b>Permission in use</b> shows the flags of its first background start; <b>Differs from Settings</b> means the session keeps them (a Claude Code limit).</li>
          <li><b>Run mode</b>: how a fired job is shown — <b>Quiet</b> (background, no notice), <b>Notify</b> (default; a Windows notice when it starts and when it waits for your answer, click to open the session), <b>Open on screen</b> (a terminal window on the session at the job time). The job's own mode comes first (Claude picks it when it creates the job), then the session's choice in the jobs panel, then the default in Settings.</li>
          <li><b>Done · last 7 days</b>: fired one-shots and the runs of the last 7 days (answered · not verified / failed) stay in the jobs panel one line each, the newest 3 first ("n more" for the rest, the answer on hover), folded while jobs are left; sessions with nothing left gather in <b>Sessions with only done jobs</b> at the bottom of the list; <b>Open session</b> attaches while it runs, else opens it with <code>claude --resume</code>.</li>
          <li><b>Clean up the list</b>: done entries drop off by themselves after 7 days; this button at the head of the done list removes them now (the conversation stays, and the command under the session id opens it again). A background session with no job left holds about 0.5 GB of memory, so the button stops it first; a stopped or terminal session is only cleaned off the list. It is off while a job runs; pressing it shows the session name and id and what it will do (clean up only / stop and clean up) and asks once, with any warning (waits for your answer, an attach window is open) in the same question. <b>Clean up done</b> at the bottom lists every background session with no job left and every stopped session with only done jobs, and cleans them up at once (sessions linked by Remote Control are left out). With <b>Clean up finished background sessions</b> on in Settings (30 min by default), a session with no job left is stopped by itself (skipped while it waits for an answer or an attach window is open).</li>
          <li><b>Click a session id</b> for the command that opens it again — <code>claude attach &lt;id&gt;</code> while it runs, else <code>claude --resume &lt;id&gt;</code> in its folder (PowerShell and cmd) — and <b>Copy</b> it into a terminal.</li>
          <li><b>Automatic revival</b>: 10 minutes before a job, a day before a recurring job expires, and once 5 minutes before your work end (a stopped session that still has jobs, except jobs with No auto-wake and blocked or warned sessions); never twice within 30 minutes of a successful wake. A failed wake is tried again after 5 s, 15 s, 45 s and 2 min, then 10 minutes later; a login or permission failure is not tried again.</li>
          <li><b>Window alignment</b> (experimental, off by default): it relies on observed behaviour, not on anything Anthropic guarantees, and the reset times are not guaranteed. A tiny <code>claude -p ok</code> call 5 h before lunch end and at lunch end tries to start the afternoon and the nightly jobs each with a fresh window. Settings › Work hours and token resets draws today on a timeline.</li>
        </ul>
      </Section>
      <Section title="Remote jobs session (manage from the phone)">
        <p>Press <b>Monitor jobs remotely</b> under the jobs panel (or the status bar's right-click menu): one remote session that oversees every job starts, shows up as "Remote jobs" in the Claude mobile app or claude.ai/code, and you manage the jobs there by chat. While it is on the button shows a green dot, and pressing it again asks <b>Open on phone / web</b> or <b>Turn remote off</b> (the right-click menu shows "Open remote monitoring" and "Turn remote monitoring off"). Turning it off also turns it off in Settings; the conversation stays, and the next press resumes the same session.</p>
        <ul>
          <li><b>Status</b>: "show the jobs" — every session's jobs, what runs now, the last result (answered · not verified / ✗ failed).</li>
          <li><b>Instructions</b>: "move the tools job to 22:00" — forwarded to the session that owns the job; its answer comes back as <code>[clock-out 응답]</code>. A stopped session is woken for it. Jobs stay where they are.</li>
          <li><b>Attach another session</b>: "attach the tools session to remote" to talk to it directly. While a job runs you are told it may be cancelled or run twice, and choose after it or now. Other sessions get remote only when asked like this.</li>
          <li><b>Notices</b>: finished jobs are reported to the remote session, which pushes them to the phone (off / failures / every run). "Failures" are runs that ended with an error, abort or refusal; a run that answered is not one even if the job did not work.</li>
          <li>A session attached once reconnects at the same address on every later wake. One that already ran in the background without remote cannot get it (a copy would start); instructions still reach it.</li>
        </ul>
      </Section>
      <Section title="How it works with Claude Code">
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />The plugin (inside each session)</summary>
          <p>Hooks CronCreate / CronDelete / CronList and writes <code>~/.claude/clock-out/sessions/&lt;id&gt;.json</code> (each session writes only its own file), a heartbeat every minute, the result of every fired job, and renews recurring jobs 24 h before expiry. <code>/clock-out</code> shows the list as text.</p></details>
        <details className="g-sub"><summary><ChevronRight size={14} className="chev" />This app (outside sessions)</summary>
          <p>Reads those files, decides liveness from heartbeats and Claude Code's own <code>~/.claude/sessions</code>, and wakes a stopped session with <code>claude --bg --resume &lt;id&gt;</code> and a fixed first message. Permission flags go only on the first background start (later flags would start a copy, which the app stops). Work mode allows reading and editing files, git status/diff/log/fetch/pull, build and test by default, and blocks push, publish, reset --hard, clean and rm -rf (also under bypass, but only while a scheduled job runs: the plugin refuses them in that turn, so the same session used by hand is not limited; git push asks in the remote jobs session when it is on); Settings › <b>Recommended defaults</b> restores both lists.</p></details>
      </Section>
      <Section title="Data and privacy">
        <p>The app's own network calls are the usage query to api.anthropic.com and the new-version check; the login token is never stored or logged. No port, no auto-update; the new-version notice (can be turned off in Settings) reads the latest release number from GitHub once a day and downloads nothing. Files live in <code>~/.claude/clock-out/</code>.</p>
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

# clock-out 앱 진행 기록

> 개발 중에 남긴 작업 기록입니다(2026-10-19, 단계별). 세션 id 는 `<예약작업-id>` 같은 자리표시자로 바꿨습니다.

계획: 개발자 개인 계획 파일(저장소에 없음). 앱 폴더 `app/` — 이 기록의 상대 경로(`src/…`, `electron/…`, `shared/…`, `scripts/…`, `shots/`, `docs/…`, `dist/…`)는 모두 `app/` 기준. 실행: `npm run build` 뒤 `npx electron .`, 개발은 `npm run dev`.

## A단계 (2026-10-19 11:25 ~ 11:40, 사용량 한도 때문에 중간에 멈춤)

### 한 것
- `app/` 뼈대: electron-vite + React 18 + TypeScript. 진입점 `electron/main/index.ts`, `electron/preload/index.ts`, `src/index.html`. 공용 순수 코드 `shared/`.
- 트레이 아이콘(`scripts/make-icon.js` 가 의존성 없이 PNG 생성), 트레이 메뉴(사용량 갱신 · 상태바 보이기/숨기기 · 데이터 폴더 · 로그 · 종료).
- 상태바 창: 프레임 없음, 항상 위, 작업 표시줄 숨김, 끌어서 이동(`-webkit-app-region`), 위치 기억(`app-settings.json`), 화면 밖 보정.
- 사용량: `electron/main/usage.ts` 가 v1 과 같은 규칙(60초 캐시, 429 뒤 5분→60분 대기)으로 `/api/oauth/usage` 조회. 캐시 파일은 v1 과 공유(`%TEMP%\claude-usage-cache.json`)해 둘이 떠도 10분 5회를 안 넘김. 토큰은 저장·기록 안 함.
- 5시간 리셋 시각이 근무시간에서 계산한 경계(`shared/time.ts planPingHours`)와 어긋나면 주황.
- 설정 저장소 `electron/main/settings.ts` (`~/.claude/clock-out/app-settings.json`, 기본값 `shared/types.ts DEFAULT_SETTINGS`): 근무시간·핑·되살리기·권한 모드(기본 work = acceptEdits + 허용 도구, bypass 는 선택)·언어.
- 온보딩 경고 창(첫 실행, 한국어/영어): 앱이 하는 일, 되살린 세션이 사람 없이 동작함, 데이터가 PC 밖으로 안 나감, 모든 되살림은 알림·로그.
- Electron 잠금: `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, preload 는 6개 호출만 노출, CSP `default-src 'self'`, 단일 실행 잠금.
- `scripts/shot.ps1`: 빌드한 앱을 띄워 창을 캡처하고 종료(이 앱의 electron 프로세스만 고름 — VS Code·Claude 앱도 electron.exe).

### 검증
```
npx vitest run        → 7 passed (planPingHours · parseHm · formatRemaining · isAlignedReset)
npx tsc -p .          → 오류 0
npx electron-vite build → out/main, out/preload, out/renderer 생성
scripts/shot.ps1      → shots/a-statusbar.png (720×39): ● Claude │ 5h ▮▮▮▮ 89% 1h22m (13:00) │ 7d 60% 3d 19h │ 11:37 갱신 │ 다음 예약 — │ 예약 ▾ ⚙ ×
app.log               → START, USAGE ok five_hour=89% seven_day=60%
```

### 안 한 것 · 다음
- 상태바의 `다음 예약`·`예약 ▾` 는 자리만 있음(B단계에서 세션 파일 읽기와 펼침 창).
- 온보딩 창 캡처는 못 남김(캡처 스크립트가 창을 앞으로 못 가져옴). 창 자체는 떴음(settings 의 `onboardingDone` 이 false 일 때 START 뒤 표시).
- PowerShell 로 쓴 `app-settings.json` 은 BOM 이 붙어 JSON.parse 가 실패했음 → 앱은 항상 BOM 없이 쓰고, 읽을 때도 BOM 을 벗기게 B단계에서 고칠 것.
- `shots/` 는 저장소에 넣지 않음(.gitignore).

### 11:40 작은 수정
- 리셋 시각 정렬 판정을 정시 ±3분으로(API 가 12:59 로 알려 줌). 상태바 폭 860 (내용이 잘리던 것; B단계에서 내용 폭에 맞추기).

## A단계 마무리 (2026-10-19 13:05 ~ 13:12, 예약 세션)

### 한 것
- 온보딩을 네이티브 대화상자에서 **앱 창**(`src/Onboarding.tsx`, `?view=onboarding`)으로 바꿈: 앱과 같은 다크 테마, 한국어/영어, "이해했습니다, 시작" / "종료". 수락해야 트레이·상태바가 뜬다.
- 상태바가 **내용 폭에 맞춰 스스로 크기를 정함**(렌더러가 `ResizeObserver` 로 재고 `strip:width` IPC 로 main 이 `setBounds`). 오전에 잘리던 버튼이 다 보인다.
- 설정 파일 읽을 때 BOM 허용(PowerShell 이 쓴 파일도 설정이 초기화되지 않음).
- 개발용 캡처: `CLOCKOUT_SHOT_DIR=<폴더>` 로 실행하면 온보딩 창과 상태바를 `capturePage` 로 PNG 저장하고 스스로 종료. 화면 위에 다른 창이 있어도 상관없다(오전의 `shot.ps1` 은 그 문제로 엉뚱한 창을 찍었음).
- 리셋 시각 정렬 판정 정시 ±3분.

### 검증
```
npx vitest run            → 7 passed
npx tsc -p .              → 오류 0
npx electron-vite build   → 성공
CLOCKOUT_SHOT_DIR=shots npx electron .  → docs/a-onboarding.png (600×380), docs/a-statusbar.png (내용 폭)
app.log: START → SHOT onboarding → USAGE ok five_hour=17% seven_day=63% → SHOT statusbar → EXIT
```
상태바 캡처: `● Claude │ 5시간 ▮ 17% 4h50m (17:59) │ 주간 ▮▮ 63% 1d 15h (04:59) │ 13:09 갱신 │ 다음 예약 — │ 예약 ▾ ⚙ ×` — 17:59 는 퇴근 18:00 경계와 맞아 회색.

### 안 한 것
- 트레이 메뉴 캡처(네이티브 메뉴라 capturePage 불가). 메뉴 항목은 코드로만 확인.
- `다음 예약`·`예약 ▾` 는 B단계.

## B단계 (2026-10-19 13:12 ~ 13:20)

### 한 것
- `shared/schedule.ts`: 세션 파일 → 세션/예약 뷰(실제 다음 실행 `nextFireAt`, 없으면 cron 계산, 만료 n일, 마지막 실행), 세션 파일 검증(UUID·작업 폴더 존재·미래 시각·프롬프트 길이·cron 형식 — 어긋나면 ⚠ 표시하고 되살리지 않음), 대화 기록 파싱(플러그인 없던 세션용, `legacyTranscriptScan` 설정).
- `electron/main/schedule.ts`: 세션 파일·대화 기록 읽기, 떠 있음 판정(heartbeat 3분 + Claude Code 의 `sessions/<pid>.json` 프로세스 생존), 숨기기(꺼진 세션만), 폴더 감시(1.5초 디바운스) + 30초 주기로 렌더러에 밀어 줌.
- 펼침 창(`src/SchedulePanel.tsx`): `예약 N ▾` 를 누르면 창이 아래로 커짐(작업 영역 60%, 항상 위 해제). 왼쪽 세션 목록(떠 있음/꺼짐 점, 예약 수, 다음 실행과 남은 시간, ⚠), 오른쪽 상세(폴더·이름·출처, 되살리기/붙기 버튼, 예약 카드: id·사람말 일정·cron·다음·만료·마지막 실행 ✓/✗·프롬프트·답 머리, 숨기기/다시 보기).
- 상태바에 `다음 23:55 live1` 과 `예약 1` 수.
- 캡처 모드가 펼침 창도 찍음(`command: expand` IPC).

### 검증
```
npx vitest run → 11 passed (schedule 뷰·검증·대화 기록 파싱 4개 추가)
npx tsc -p .   → 0, electron-vite build → 성공
docs/b-statusbar.png, docs/b-schedule.png (꺼진 live1 세션의 23:55 예약 카드)
```

### 안 한 것
- 되살리기·붙기 버튼은 자리만(C단계). 대화 기록 스캔 기본값은 꺼짐(설정 화면에서 켬, D단계).

## C단계 (2026-10-19 13:20 ~ 13:24)

### 한 것
- `shared/revive.ts`(순수): 되살리기 인자(`reviveArgs` — 처음 백그라운드 시작에만 권한 플래그: work 모드 = `--permission-mode acceptEdits --allowedTools …`, bypass = `--dangerously-skip-permissions`; 그 뒤는 플래그 없음), 고정 첫 메시지(세션 파일의 프롬프트를 절대 끼워 넣지 않음), 되살릴 이유(`reopenReason`: 예약 n분 전 · 반복 만료 n시간 전 · 퇴근 5분 전 일괄, 근무 요일만, 하루 한 번), 복사본 id 추출.
- `electron/main/revive.ts`: `claude --bg --resume` 실행(작업 폴더에서), 복사본 생기면 `claude stop`, 세션 파일에 `bgSince`, 알림(OS 토스트 + 앱 안 토스트 + 로그), dry run 은 로그만. 붙기는 `wt -w new claude attach <id>`(없으면 cmd start). 앱 안 스케줄러: 30초마다 판단, 같은 세션 30분 가드, "되살리기 전 확인" 설정이면 깨우지 않고 알림만.
- 패널의 되살리기·붙기 버튼 연결, 알림 토스트(접힌 상태에서는 상태바 아래).

### 검증
```
npx vitest run → 19 passed (reviveArgs·reopenReason·dailySweep·copyIdIn 8개 추가)
npx tsc -p . → 0, build → 성공
실측: CLOCKOUT_REVIVE=<live1-id> npx electron .  → NOTICE "live1 · <live1-id> woken in the background — dev"
      claude agents --json → <live1-id> kind=background (같은 id, 플래그 없이 깨움)  → claude stop 으로 정리
```

## D단계 (2026-10-19 13:24 ~ 13:28)

### 한 것
- 설정 창(`src/Settings.tsx`, ⚙ 버튼·트레이 메뉴): 근무시간(출근·점심·퇴근·근무 요일) → **계산된 핑 시각과 리셋 경계가 바로 보임**(09:00~18:00 이면 핑 09:05·13:05, 경계 14:00·18:00, 출근 전 핑은 출근으로 당겼다는 안내), 핑 켜기·모델, 되살리기(n분 전·만료 n시간 전·퇴근 5분 전 일괄·깨우기 전 확인·시험 모드), **권한 모드**(작업 가능 모드 = acceptEdits + 허용 도구 목록 편집 / bypass 는 빨간 경고 상자에서 "위험을 이해하고 켭니다" 를 눌러야 켜짐, 켜지면 상태바에 빨간 점), 언어·자동 실행·대화 기록 스캔, 플러그인 설치 줄.
- 설정 변경은 즉시 저장되고 모든 창에 반영(`settings` 이벤트). 자동 실행은 `setLoginItemSettings`.
- `electron/main/ping.ts`: 근무 요일의 계산된 시각(또는 직접 지정한 시각)에 `claude -p ok --model haiku` 한 번, 뒤이어 사용량 갱신.

### 검증
```
npx vitest run → 19 passed, tsc 0, build 성공
docs/d-settings.png (설정 창), docs/d-schedule.png (대화 기록 스캔 켠 뒤 실제 세션 3개: 예약작업·tools·live1), docs/d-statusbar.png (다음 19:40 예약작업 · 예약 5)
```

### 13:30 Fable 한도 표시 (사용자 요청)
- 사용량 응답의 `limits[]` 중 `kind: weekly_scoped` + 모델 scope 항목을 모델별 주간 한도 행으로 표시(`Fable 주간 100%`, severity critical 이면 빨강). 모델 이름은 고정하지 않음. `electron/main/usage.test.ts` 2개 추가(21 passed).
- v1 위젯(개인 PowerShell 스크립트, `ConvertTo-UsageRows`)에도 같은 행 추가. 자가 재시작 뒤 로그 `OK 5시간=34% 주간=65% Fable 주간=100%`.

## E단계 (2026-10-19 13:30 ~ 13:33)

### 한 것
- `npm run dist` → **`app/dist/clock-out-setup-0.1.0.exe` (84MB, NSIS, 설치 폴더 선택 가능, 사용자 단위 설치)**. 256px 아이콘(`scripts/make-icon.js`).
- 서명 인증서가 없어 `signAndEditExecutable: false`(이 PC 는 심볼릭 링크 권한이 없어 서명 도구 압축 해제가 실패했음). 그래서 exe 자체 아이콘은 Electron 기본이고 SmartScreen 경고가 한 번 뜬다(README 안내).
- README 맨 앞에 데스크톱 앱 절(다운로드·화면·자동 되살리기·근무시간·권한·개인정보, 캡처 2장).

### 검증
```
dist/win-unpacked/clock-out.exe (설치 파일과 같은 패키지) 를 캡처 모드로 실행
app.log: START → USAGE ok five_hour=34% seven_day=65% model:Fable=100% → SHOT statusbar/schedule/settings → EXIT
```

### 안 한 것
- 설치 파일을 실제로 설치·제거해 보는 것(시작 메뉴·바탕화면 바로가기 생성)은 사용자 PC 에 흔적을 남기므로 하지 않음. 실행은 같은 패키지(win-unpacked)로 확인.
- GitHub Releases 업로드(저장소가 아직 없음), 코드 서명, 앱 안 터미널 칸(F단계).
- v1 위젯 종료: 사용자가 앱을 설치해 쓰기 시작할 때. 둘이 같이 떠 있으면 같은 세션을 두 번 깨울 수 있으니 하나만.

## UI 수정 (2026-10-19 13:35 ~ 13:48, 사용자 요청: 잘림 · 사용자 친화 · 라이트/다크/Windows 따라가기)

### 원인
- 펼친 창 폭이 1100px 고정인데 Fable 칸이 추가된 상태바 내용은 약 1130px → 오른쪽 `예약 ▴ ⚙ ×` 가 잘림.
- 접힌 폭을 `scrollWidth + 2`(정수 내림)로 재서 125% 배율 같은 화면에서 1~2px 모자랄 수 있었음.

### 고친 것
- 상태바를 정보 영역(줄어들 수 있음)과 버튼 묶음(`flex: none`, 절대 안 줄어듦)으로 나눔. 넘치면 정보 쪽이 잘리고 버튼은 항상 보임.
- 폭 측정: 정보 줄의 `max-content` 폭 + 버튼 폭 + 여백을 `getBoundingClientRect` 로 재고 올림 + 4px. 펼친 동안에도 보고받아 창을 넓힘.
- 펼친 창: 폭 = max(1000, 상태바 폭 + 24), 펼친 동안 크기 조절 가능(최소 360px 높이), 접으면 원래 위치·상태바 높이로.
- 테마: 설정 > 화면 > 테마 = **Windows 설정 따라가기(기본) · 라이트 · 다크**. `nativeTheme.themeSource` 로 적용하고 CSS 는 `prefers-color-scheme` 하나로 두 팔레트(GitHub Primer 라이트/다크). 창 배경색도 테마 따라 바뀜.
- 화면 다듬기: 아이콘 버튼(새로고침·설정·닫기, 닫기 호버 빨강), 예약 수 배지, bypass 를 빨간 알약으로, 세션 목록 머리(떠 있음/꺼짐 수)·예약 수 배지·선택 강조, 상세 머리(상태 알약·폴더 아이콘), 예약 카드(반복/1회 알약·남은 시간·만료·마지막 실행 아이콘, 프롬프트 두 줄 말줄임), 빈 화면 안내, 토스트 그림자, 설정 창 카드형·요일 칩·분할 버튼.
- 프롬프트 두 줄 말줄임에서 셋째 줄이 비치던 것: 여백을 바깥 상자로 옮김.
- cron 식이 사람말 일정과 같으면 오른쪽에 다시 쓰지 않음.

### 검증
```
npx vitest run → 21 passed, tsc 0, build 성공
캡처: docs/d-statusbar(.png/-dark), d-schedule(-dark), d-settings(-dark)
  상태바 1185px 에 버튼 4개 모두 보임, 펼친 창 1208px, 라이트·다크 둘 다
설치 파일 재생성: dist/clock-out-setup-0.1.0.exe (13:47)
```

## 사용설명서 · 연동 점검 (2026-10-19 13:50 ~ 13:55, 사용자 요청)

### 한 것
- 사용설명서 창(`src/Guide.tsx`, `?view=guide`). 여는 곳: 상태바 `?` 버튼, 트레이 메뉴 "User guide · setup check", 설정 창의 버튼. **첫 실행 때 온보딩 뒤 자동으로 열림.**
- 맨 위 **연동 점검**(`electron/main/setup.ts`): Claude Code 설치(`claude --version`) · 로그인(자격증명 파일) · clock-out 플러그인(`claude plugin list --json`, 개발 폴더 적재면 그 사실과 주의) · 세션 기록 수신(최근 10분 세션 파일 수) · Windows Terminal(`where wt`) · 겹치는 프로그램(예전 위젯·PowerShell 서비스의 시작프로그램과 프로세스). 항목마다 왜 필요한지 한 줄과 **바로 해결 버튼**: 플러그인 설치 · 플러그인 켜기 · 겹치는 프로그램 끄기(확인 창 뒤 시작프로그램 해제 + taskkill 로 정상 종료) · 터미널에서 로그인 · 설치 안내 열기.
- **플러그인 설치 버튼**은 `claude plugin install clock-out --marketplace <앱에 동봉된 플러그인 폴더> --scope user -y`. 설치 파일에 플러그인 파일을 `resources/plugin` 으로 함께 넣음(GitHub 없이 설치 가능).
- 펼치기/접기 절: 빠른 시작(기본 펼침) · 기능(상태바·예약 창·자동 되살리기·토큰 창 정렬) · **Claude Code 연동 방식**(플러그인이 하는 일 / 앱이 하는 일 / 플러그인이 없을 때, 각각 다시 펼치기) · 설정 안내(설정 열기 버튼) · 문제 해결(4가지) · 데이터와 개인정보. 한국어/영어.

### 검증
```
npx vitest run → 21 passed, tsc 0, build 성공
캡처 docs/e-guide.png: 6개 점검이 실제 상태대로(플러그인=개발 폴더, 세션 기록 5개, 예전 위젯 pid 28536 경고+끄기 버튼)
설치 명령 실측(임시 CLAUDE_CONFIG_DIR, 실제 설정은 건드리지 않음):
  저장소 폴더로   → ✔ Successfully installed plugin: clock-out@clock-out (scope: user)
  설치 파일 동봉본(dist/win-unpacked/resources/plugin)으로 → ✔ 같은 결과
설치 파일 재생성 dist/clock-out-setup-0.1.0.exe (13:54)
```

### 안 한 것
- "겹치는 프로그램 끄기"는 실제로 누르지 않음(지금 쓰시는 v1 위젯을 끄게 되므로). 동작은 코드로만 확인.
- 이 PC 는 개발 폴더로 적재 중이라 정식 설치 버튼을 누르면 두 번 적재됨 → 점검 화면에 그 주의를 표시함.

## 0.2.0 (2026-10-19 14:00 ~ 14:16, 사용자 요청: 사용설명서 꺼내기 · 설정 맨 위 연동 점검 · 첫 설치 연동 점검 · 절전 · 예약 창 위치 · 붙기 이름 · 버전 관리)

- 상태바에 글자 버튼 `사용설명서`, 예약 창 아래 줄에 `연동 점검 · 설정 · 사용설명서` 와 버전.
- 설정 창 맨 위에 연동 점검과 빠른 시작(공용 부품 `src/Setup.tsx`). 첫 실행 때 경고 창 다음에 "시작하기 · 연동 점검" 창이 자동으로 뜸.
- 연동 점검에 절전 항목: `powercfg /query` 로 전원 연결 시 절전·최대 절전 시간을 읽고, 버튼이 `powercfg /change standby-timeout-ac 0`, `hibernate-timeout-ac 0` 실행(관리자 권한 불필요 — 같은 값으로 다시 써서 확인).
- 예약 창을 별도 창으로 분리: 상태바는 움직이지 않고 예약 창이 바로 아래 왼쪽 끝을 맞춰 열림(공간 없으면 오른쪽 맞춤 또는 위). 로그 `PANEL open at 0,166 1000x691; bar at 0,123 1285x39`.
- "붙기" → "예약 세션 확인하기".
- 버전: `scripts/version.js` 가 루트 package.json 기준으로 플러그인·마켓플레이스·앱을 맞추고 `--check` 로 검사. CHANGELOG 버전별 정리, 태그 v0.1.0 · v0.2.0. 앱 테스트는 `*.spec.ts` 로(플러그인 테스트와 분리).
- 검증: version --check 일치, plugin validate 통과 · test 25 pass, app tsc 0 · vitest 21 pass, 캡처 docs/f-*.png, 설치 파일 dist/clock-out-setup-0.2.0.exe.

## 0.3.0 (2026-10-19 14:20 ~ 14:40, 사용자 요청: 근무시간·토큰 정렬 합치기 · 24시간 타임라인 · 예약 시각 강조 · 핑 계산 수정 · 타임라인 아이콘화 · UI/UX 개선)

- 설정의 근무시간과 토큰 정렬을 한 구획 "근무시간과 토큰 초기화" 로 합침.
- `shared/timeline.ts`: 핑 계획(점심 끝 시각 −5시간, 점심 끝 시각), 어제·오늘 이틀 모의 실행(핑·근무·예약), 예약을 빼면 계획한 초기화가 돌아오는 경우를 충돌로 판정.
- `src/Timeline.tsx`: 하늘 그라데이션(밤·별·달 → 일출 → 해 → 일몰 → 밤) 위에 아이콘만 둠. 근무·점심 띠, 5시간 창, ↻ 초기화 배지, ⚡ 핑, 예약 배지(충돌이면 빨간 깜빡임), 지금 빨간 선. 글자는 전부 마우스 호버 설명으로, 선 위 아무 곳에 올리면 그 시각·근무 상태·열린 창을 보여줌. 문제만 아래에 문장으로.
- 설정: 연동 점검이 모두 초록이면 칩 한 줄로 접힘(`자세히`), 빠른 시작은 접힌 상태로.
- 예약 카드: 다음 실행 시각을 크게, Claude Code 문구가 없으면 cron 을 말로(`shared/cronText.ts`, 매일 21:03 / 10-19 19:40). 상태바 다음 예약 강조.
- 검증: app tsc 0 · vitest 28 pass, 캡처(라이트·다크·호버) 확인. 연동 점검이 접힌 모습은 이 PC 에 "겹치는 프로그램" 경고가 있어 캡처로 보지 못함.

## 0.4.0 (2026-10-19 14:50 ~ 15:00, 사용자 요청: 타임라인이 보기 힘듦 — 시간 표시, 예약을 언제 걸 수 있는지 보이게)

- 목적(사용자): 09시 출근이면 출근 때 사용량 0% 에서 시작하고 13시에 초기화돼야 하므로, 그 앞 시간대는 예약을 막고 그 전에는 예약이 가능함을 보여 준다.
- `shared/timeline.ts` `jobZones`: 5분마다 시험 예약을 넣고 하루를 다시 모의 실행해 예약 가능 / 비워 두기 / 업무와 공유로 나눔. 09–18·점심 12–13 → 00–04 가능, 04–08 비워 두기(핑 무력화), 08–09 비워 두기(출근 0% 깨짐), 09–18 공유, 18–24 가능. 테스트 1건.
- 사용자가 말한 "05시 이전 가능" 은 실제로는 04시 이전: 04:10 예약 → 04:00–09:00 창이 08:05 핑 때 열려 있어 핑이 무력, 09시 근무가 09–14 를 열어 13시 초기화가 14시로 밀림(모의 실행 확인).
- `src/Timeline.tsx` 다시 그림: 위에 세 문장 요약, 2시간 눈금·시간 격자·행 이름, 구간 띠, 창 `08–13`(여는 주체 아이콘), 초기화 배지, 근무 시작·끝, 예약 시각(겹치면 왼쪽에), 지금. 하늘 그라데이션은 얇은 띠로.
- 검증: app tsc 0 · vitest 29 pass, 캡처 라이트·다크·호버 확인.

## 0.5.0 (2026-10-19 15:20 ~ 15:40, 사용자 요청: 비워 두기 시간 예약을 플러그인이 잡기 · 상태바 아이콘 재배치)

- 플러그인 `hooks/zoneGuard.ts` + `jobs.ts` CronCreate 훅 앞단: 앱 설정의 근무시간으로 비워 두기 구간을 계산해, 그 시간에 도는 예약은 한 번 `{ deny }` 로 이유·가능 시간을 돌려줌. 같은 cron 이 30분 안에 다시 오면 통과. 테스트 2건(06:30 거절 후 재요청 통과, 03:30·10:00 즉시 통과).
- `shared/timeline.ts` 를 import 없는 파일로 만들어 `hooks/timeline.ts` 로 그대로 복사, 앱 테스트가 두 파일 동일 여부 검사. `planZones`(예약 없이 계획만으로 구간), `blockedRun`(cron 의 7일 안 첫 비워 두기 실행) 추가.
- 앱: 타임라인과 예약 카드에서 비워 두기 예약을 빨갛게, 무엇이 밀리는지와 옮길 시간을 한 문장으로(`src/zoneText.ts`).
- 상태바: 5시간 · 주간 · 모델 주간 · 새로고침 · 다음 예약 · 예약 n · 설정 · 사용설명서(아이콘) · 닫기.
- 사용자 실측(가드 전 플러그인): 새 세션에서 "매일 아침" 요청에 Claude 가 08:57 을 골랐고, 06:30·08:57 이 타임라인에서 빨갛게 표시됨을 캡처로 확인.
- 검증: plugin validate · test 27 pass, app tsc 0 · vitest 32 pass.

## 0.6.0 (2026-10-19 15:45 ~ 15:55, 사용자 요청: 원하는 초기화 시간을 자유롭게, 표시도)

- `planPings(w, resetHours)`: 원하는 초기화 정시 목록을 받아 핑을 (초기화 −5시간):05 로 역산. 비우면 자동(점심 끝, 5시간 뒤). `isCustom`, `tooClose`(앞 초기화 뒤 5시간 미만이라 불가능) 추가. 설정 필드 `alignPing.manualHours`(UI 없던 핑 시각) → `alignPing.resetHours`.
- 설정: "초기화 시각 [자동 | 직접 지정]" + 시각 칩(× 빼기) + "시각 추가" 선택, 아래에 필요한 핑 시각. 불가능한 시각 칩은 빨간 취소선.
- 타임라인: 원하는데 안 일어나는 초기화는 빨간 점선 배지·취소선 칩, 경고에 이유와 실제 초기화 시각.
- 검증: 테스트(19·14 → 핑 09:05·14:05, 12·15 → 15:00 불가, 22·01 → 01:00 불가), app vitest 33 · plugin test 27, `CLAUDE_CONFIG_DIR` 를 임시 폴더로 돌려 실제 설정을 건드리지 않고 직접 지정(12·15) 화면 캡처.

## 0.7.0 (2026-10-19 16:20 ~ 17:20, 사용자 요청: 원격 예약 작업 세션 — 퇴근 뒤 휴대폰에서 예약 현황 보기·지시·수정)

- 실험(계획 Phase 0):
  - `claude remote-control` 은 창 없이 연결되고 플러그인도 적재된다.
  - `--session-id` 는 원격 id 만 받는다.
  - `claude --bg --resume <id> --remote-control "<이름>"` 은 같은 id·같은 예약으로 원격이 연결된다.
  - 이후 옵션 없이 resume 하면 같은 원격 주소로 다시 붙는다.
  - 옵션을 다시 주면 복사본이 생긴다.
  - 휴대폰에서 두 세션에 보낸 메시지에 답이 왔다(사용자 확인).
- 플러그인:
  - `hooks/remote.ts`: 원격 세션 전용 도구 status·send·open_remote, 결과 파일을 메시지로 전달.
  - `runs.ts`: running 기록, `[clock-out 원격 지시]` 답을 `[clock-out 응답]` 으로 돌려보냄, 실행 결과 알림.
  - `revive.ts` 첫 bg 시작에 `--remote-control`.
  - `appSettings.ts` 로 앱 설정 읽기 통합.
  - 테스트 6건.
- 앱:
  - `electron/main/remote.ts`: 원격 세션 시작·유지, CLAUDE.md, 요청 처리(wake / openRemote).
  - `remoteState.ts`, `reviveArgs` 에 원격 이름·첫 메시지.
  - 설정 "원격 예약 작업 세션" 구획, 예약 창 실행 중 배지·휴대폰 열기·원격으로 열기, 상태바 휴대폰 아이콘.
  - 권한을 바꾸면 원격 세션을 새로 시작.
- 검증: plugin validate · test 33 · tsc, app tsc · vitest 33, 실제 명령(`--bg --permission-mode acceptEdits --allowedTools … --remote-control`)으로 새 폴더에서 원격 연결 확인, 설정 원격 구획 캡처.
- 남은 실측: 설치 후 원격 켜기 → 휴대폰에서 현황·지시 전달·응답·원격 열기·알림(사용자와 함께).

## 0.7.1 (2026-10-19, 사용자 지적: "총괄 세션을 버튼으로 만들고 거기서 관리"인데 세션마다 원격 연결로 만들었다)

- 예약 창 아래 "원격으로 예약 작업 모니터링" 버튼, 상태바 휴대폰 아이콘 → 총괄(원격 예약 작업) 세션을 켜거나 다시 쓰고, 준비되면 주소를 연다(`remote:open`, `openMonitor`).
- 원격 켤 때 모든 세션의 첫 백그라운드 시작에 붙이던 `--remote-control` 제거. 다른 세션은 총괄 세션의 open_remote 요청 때만 원격.
- 예약 창 세션별 "원격으로 열기" 버튼 제거, 이미 원격인 세션의 "휴대폰·웹에서 열기" 만 남김. 사용설명서·README 문구 정리.
- 검증: plugin test 33 · tsc, app tsc · vitest 33, 예약 창·상태바 캡처.

## 0.7.2 (2026-10-19 17:00 ~ 17:15, 사용자 실측: 원격 세션 status 9건 vs 앱 12건)

- 원인(앱 계산을 직접 출력해 확인): 앱은 "플러그인 없이 돈 세션의 대화 기록도 읽기"(켜짐)로 대화 기록에서만 찾은 세션도 센다 — 예약작업 <예약작업-id>(3), tools <tools-id>(1), 실험 복사본 <실험복사본-id>(1). 플러그인 status 는 세션 파일만 본다.
- 수정: 앱이 보여 주는 목록을 `overview.json` 으로 쓰고, 원격 세션의 status·send 가 그것을 읽음(앱이 꺼져 있으면 플러그인 목록, 그렇다고 표시). 테스트 1건.
- 정리: 실험 복사본 <실험복사본-id> 의 bg 기록(`claude rm`)·세션 파일·대화 기록 삭제.

## 0.7.3 (2026-10-19 17:10 ~ 17:30, 사용자 요청: 예약 작업 알림이 원격으로 오는지 테스트)

- 실측 1: 17:13 테스트 예약 결과가 원격 세션에 안 감. Claude Code 메시지 "Cross-session message held … the two sessions are in different permission modes … non-interactive sessions can't ask, so there the message expires" — 보내는 세션 acceptEdits, 원격 세션 bypass. live1(터미널) 로 보낸 지시는 그 터미널에서 거절됨.
- 수정: `$.session.send` 대신 세션별 inbox 파일. 각 세션 플러그인이 15초마다 자기 inbox 를 읽어 스스로 prompt.submit(예약 실행 중이면 끝난 뒤). 앱 결과도 inbox 로. 플러그인이 스스로 제출한 프롬프트는 자기 prompt.submit 훅을 거치지 않아 지시 표시는 inbox 가 직접 함(noteOrder/takeOrder).
- 실측 2: 지시 → 작업 세션 11초 안에 받음 → [clock-out 응답] 이 원격 세션에 도착. 17:24 예약 끝 → [clock-out] ✓ 가 원격 세션에 도착 → PushNotification "Mobile push requested".
- 권한을 bypass 로 바꾼 뒤 원격 세션이 <옛원격-id> → <새원격-id> 로 새로 시작됨(설계대로). 옛 원격 세션 <옛원격-id>, 테스트 세션 <테스트-id> 정리.
- 검증: plugin test 35 · tsc, app tsc · vitest.

## 0.7.4 (2026-10-19 17:30 ~ 17:40, 사용자 지적: <tools-id> 를 exit 했는데 계속 "떠 있음", "떠 있음" 말이 이상함)

- 확인: <tools-id> 는 pid 4176 `claude.exe --resume <tools-id> --dangerously-skip-permissions "claude-usage-widget 이 이 세션을 다시 열었습니다…"` (오늘 10:50, v1 위젯이 백그라운드로 깨움), Claude Code 기록 kind bg · idle. attach 창에서 /exit 는 창만 닫고 세션은 계속 돈다 → 표시는 맞았고 구분이 안 보였던 것.
- 수정: SessionView.runsIn(live record kind), "백그라운드에서 실행 중 / 터미널에서 실행 중" + 툴팁, 백그라운드 세션에 "세션 끄기"(claude stop, 남은 예약이 있으면 다시 켜진다고 안내). "떠 있음" → "실행 중".
- 검증: app tsc, 실제 데이터 예약 창 캡처(예약작업 <예약작업-id> "백그라운드에서 실행 중" + 세션 끄기).

## 0.7.5 (2026-10-19 17:40 ~ 17:50, 사용자 요청: 예약 삭제 버튼 — 확인 창, 세션이 직접 삭제, 삭제 뒤 세션 종료를 물음, 무엇을 지웠는지 명시)

- `electron/main/deleteJob.ts`: 실행 중+플러그인 → inbox, 꺼짐 → 지시를 첫 메시지로 깨움, 백그라운드·플러그인 없음 → 멈춘 뒤 깨움, 터미널·플러그인 없음 → 그 창에서 입력하라고 안내. 목록에서 사라질 때까지 최대 2분 대기.
- 예약 카드 "삭제" → 확인 창(id·시각·내용) → 삭제 중 → "예약을 삭제했습니다: [id] …" → 백그라운드면 "세션을 종료하시겠습니까?" [그대로 두기 / 세션 종료].
- 실측: 테스트 세션 rc-del 에서 실행 중 경로 9초, 꺼진 경로 12초로 삭제 확인. 꺼진 경로 첫 시도에서 복사본(<복사본-id>)이 생겨 실패 → revive 의 bg 판정에 세션 파일 kind 추가, 복사본이 생기면 플래그 없이 다시 깨움. 테스트 세션·복사본 정리.
- 검증: app tsc · vitest, plugin test 35, 확인 창 캡처(취소로 닫음).

## 0.8.0 (2026-10-19 야간작업 23:05 ~ , 공개 준비와 릴리스)

### 무엇을 했나
- 로그·사용량 캐시 시각을 로컬 시각으로 기록. 전에는 UTC 로 쓰고 로컬로 읽어 캐시가 늘 9시간 지난 것으로 보였고, 그래서 사용량을 매번 다시 요청했다.
- 상태바 창을 투명 창으로 바꿔 상태바 아래 7px 띠 제거. 새 아이콘(밤하늘 둥근 사각 + 6시 시계 + 초승달)을 창·트레이·설치 파일에 연결.
- 다크 버튼 대비, 경고·연동 점검 문구 한국어화, 예약 카드 시간 칸.
- 연동 점검: claude 를 못 찾으면 빈 오류 대신 실제 오류, 목록엔 있지만 로드 실패한 플러그인은 오류로 표시.
- 공개 준비: README 재작성(왜 clock-out 인가 절 포함), `docs/screenshots`, 메타데이터 `<owner>` 자리표시자, `.gitignore`, 개발 기록을 `docs/dev-notes` 로 이동.
- exe 아이콘: `signAndEditExecutable: false` 라 `clock-out.exe` 아이콘이 Electron 기본이었다. `app/scripts/after-pack.js`(electron-builder afterPack)가 electron-builder 캐시의 rcedit 로 아이콘·제품명·버전을 넣는다. rcedit 가 캐시에 없으면 경고 한 줄만 내고 빌드는 계속. 심볼릭 링크 권한이 있는 PC 에서는 `signAndEditExecutable` 을 켜도 된다.
- 버전 0.8.0, README 스크린샷을 0.8.0 빌드로 다시 캡처(가짜 설정 폴더).

### 검증
```
plugin validate 통과 · plugin test 35 pass · 루트 tsc 0 · version --check 일치
app tsc 0 · vitest 34 passed · electron-vite build · electron-builder --win nsis → dist/clock-out-setup-0.8.0.exe
win-unpacked/clock-out.exe: 새 아이콘 확인, 버전 정보 clock-out / 0.8.0.0 / 0.8.0, resources/plugin 의 plugin.json·marketplace.json 0.8.0
```
- 실측 E2E(테스트 세션, 정리 완료): 예약 기록, 지시 → 원격 inbox 응답, 끝난 예약 알림, 예약 삭제(실행 중 18.7초 / 꺼진 경로 8.3초, 다른 예약 유지), 세션 stop 뒤 같은 id 로 되살림(복사본 없음).

### 안 한 것
- 설치 파일 실제 설치, 코드 서명, GitHub 저장소·Releases(`<owner>` 자리표시자 그대로).

## 0.9.0 (2026-10-20, 사용자 보고: 09:07 리마인더 예약이 백그라운드 세션에서 돌아 몰랐고, 일회성이라 목록에서도 사라짐)

- 실행 방식 quiet / notify / open (예약별 > 세션별 > 기본값 notify). 플러그인 `job_mode` 도구: CronCreate 직후 Claude 가 정하고 한 줄로 알림(실측: 리마인더 요청 → open 지정).
- 완료 · 최근 7일 구획, 완료만 남은 세션도 목록에 남김.
- 정리: 버튼 + 자동(남은 예약 없음·실행/답 대기/attach 없음·마지막 실행 30분 뒤). 백그라운드 세션 하나 약 0.5GB(실측).
- 버그: wasBackgroundBefore 가 여러 줄 JSON 첫 줄만 읽어 항상 false. 원격 세션 resume 때 생긴 복사본 방치(stop·rm 하도록).
- 검증: plugin test 40, app vitest 54, tsc, 가짜 config 캡처. 실제 Windows 알림 클릭·자동 정리 stop 은 설치본에서 확인 필요.

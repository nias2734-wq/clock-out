# Security

[English](#reporting-a-vulnerability) · [한국어](#한국어)

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **[Security → Report a vulnerability](https://github.com/nias2734-wq/clock-out/security/advisories/new)** (GitHub Security Advisories). Only the maintainer sees the report until a fix is published.

Include, if you can:

- clock-out version (app and plugin), Claude Code version (`claude --version`), Windows version
- what an attacker needs (same Windows user? another user on the PC? a message from the phone?) and what they gain
- steps to reproduce, or a proof of concept

Do not paste a login token, `.credentials.json`, or anything from your real session files into the report. Replace session ids and paths with placeholders.

This is a one-person project; expect a first answer within about a week. Fixes go to the latest version only.

## Supported versions

Only the latest release gets security fixes.

## What clock-out handles, and the limits

clock-out starts Claude Code sessions while nobody is watching, so the main risks are **what those sessions may run** and **who can put instructions into them**.

| Area | What it does | Limit you should know |
| --- | --- | --- |
| Login token | The app reads Claude Code's OAuth token from `<config>/.credentials.json` **only to ask for usage** (`api.anthropic.com/api/oauth/usage`). It is sent only there, in the request header, and is not stored elsewhere or written to `app.log` (`app/electron/main/usage.ts`). The setup check only looks at whether a token exists. | The app runs as you and can read the file, like any program you run. |
| Unattended permissions | Revived sessions run in **work mode** by default: file edits and an allowed-tools list run without asking (the list is in the README, *Permissions and security*). | Anything on the allowed list runs with no one watching. Keep the list as narrow as the jobs need. |
| bypass | `--dangerously-skip-permissions` is never the default. It is turned on only through a warning, and the status bar shows a red pill while it is on. | With bypass, a session runs **every** command without asking. |
| Remote session | Off by default. When on, text you send from the phone (claude.ai Remote Control) runs on this PC as you. | Anyone who can use your claude.ai account can then run commands on this PC, with the permissions above (all commands, with bypass). |
| File messages | Sessions, the plugin and the app talk through files under `~/.claude/clock-out/` (`inbox/`, `requests/`, `sessions/`). | These folders are protected **only by your Windows user account**. Any program running as the same user can read them or drop an instruction into a session's inbox. clock-out does not sign or authenticate these files. |
| Network | The app itself makes one request (the usage query). Pings, revivals and the remote session run the `claude` command; Claude Code does the talking. No open port, no auto-update, no telemetry. The plugin calls no network API. | — |
| Installer | Not code-signed (SmartScreen warns). | Download only from this repository's Releases. |

---

## 한국어

### 보안 문제 신고

보안 문제는 **공개 이슈로 올리지 마세요.**

GitHub 의 비공개 신고를 써 주세요: **[Security → Report a vulnerability](https://github.com/nias2734-wq/clock-out/security/advisories/new)** (GitHub Security Advisories). 수정이 공개되기 전까지는 관리자만 내용을 봅니다.

가능하면 아래를 적어 주세요.

- clock-out 버전(앱·플러그인), Claude Code 버전(`claude --version`), Windows 버전
- 공격자에게 필요한 조건(같은 Windows 사용자인지, PC 의 다른 사용자인지, 휴대폰에서 보낸 메시지인지)과 얻는 것
- 재현 절차 또는 개념 증명

로그인 토큰, `.credentials.json`, 실제 세션 파일 내용은 붙이지 마세요. 세션 id 와 경로는 예시 값으로 바꿔 주세요.

1인 프로젝트라 첫 답은 1주일 안쪽을 목표로 합니다. 수정은 최신 버전에만 합니다.

### 지원 버전

보안 수정은 최신 릴리스에만 들어갑니다.

### clock-out 이 다루는 민감한 것과 한계

clock-out 은 사람이 보지 않는 동안 Claude Code 세션을 켭니다. 그래서 핵심 위험은 **그 세션이 무엇을 실행할 수 있는가** 와 **누가 그 세션에 지시를 넣을 수 있는가** 입니다.

| 영역 | 하는 일 | 알아 둘 한계 |
| --- | --- | --- |
| 로그인 토큰 | 앱은 Claude Code 의 OAuth 토큰(`<config>/.credentials.json`)을 **사용량 조회에만** 읽습니다(`api.anthropic.com/api/oauth/usage`). 그 요청의 헤더로만 보내고, 따로 저장하거나 `app.log` 에 남기지 않습니다(`app/electron/main/usage.ts`). 연동 점검은 토큰이 있는지만 봅니다. | 앱은 사용자 권한으로 돌기 때문에, 사용자가 실행한 다른 프로그램처럼 이 파일을 읽을 수 있습니다. |
| 무인 실행 권한 | 되살린 세션은 기본으로 **작업 가능 모드** 로 돕니다. 파일 수정과 허용 도구 목록은 묻지 않고 실행합니다(목록은 README 의 *권한과 보안*). | 허용 목록에 있는 것은 아무도 보지 않는 동안 실행됩니다. 예약 작업에 필요한 만큼만 남기세요. |
| bypass | `--dangerously-skip-permissions` 는 기본값이 아닙니다. 경고 창을 거쳐야만 켜지고, 켜져 있는 동안 상태바에 빨간 표시가 붙습니다. | bypass 를 켜면 세션이 **모든** 명령을 묻지 않고 실행합니다. |
| 원격 세션 | 기본은 꺼짐입니다. 켜면 휴대폰(claude.ai 원격 제어)에서 보낸 말이 이 PC 에서 사용자 권한으로 실행됩니다. | claude.ai 계정을 쓸 수 있는 사람은 위 권한으로(bypass 면 모든 명령을) 이 PC 에서 실행할 수 있습니다. |
| 파일 통신 | 세션·플러그인·앱은 `~/.claude/clock-out/` 아래 파일(`inbox/`, `requests/`, `sessions/`)로 주고받습니다. | 이 폴더는 **Windows 사용자 계정 권한으로만** 보호됩니다. 같은 사용자로 도는 프로그램은 누구나 읽을 수 있고, 세션의 inbox 에 지시를 넣을 수도 있습니다. clock-out 은 이 파일에 서명이나 인증을 하지 않습니다. |
| 네트워크 | 앱이 직접 보내는 요청은 사용량 조회 하나입니다. 핑·되살리기·원격 세션은 `claude` 명령을 실행하고, 통신은 Claude Code 가 합니다. 열린 포트·자동 업데이트·원격 전송이 없습니다. 플러그인은 네트워크 API 를 부르지 않습니다. | — |
| 설치 파일 | 코드 서명이 없습니다(SmartScreen 경고). | 이 저장소의 Releases 에서만 받으세요. |

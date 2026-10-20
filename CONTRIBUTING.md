# Contributing

[English](#development-environment) · [한국어](#한국어)

Issues and pull requests are welcome. For a security problem, see [SECURITY.md](SECURITY.md) instead of opening an issue.

## Development environment

- Windows 10 · 11 (the app and the background service are Windows only)
- Node 24 and npm
- Claude Code CLI (`claude`), a version from the table in the README (*Supported Claude Code versions*). Type generation, `claude plugin validate` and `claude plugin test` work **without signing in**.

The repository has two parts: the plugin at the root (`hooks/`, `tests/`, `.claude-plugin/`) and the desktop app in `app/`.

## Build and test

Repository root (the plugin):

```
npm ci              # TypeScript
npm run types       # writes the plugin API types to .claude-plugin/types/ (git-ignored)
npm run check       # types → tsc -p . → claude plugin validate . → claude plugin test . → version check
```

`.claude-plugin/types/` is written by Claude Code itself when it loads a plugin from a folder; it is not in git. On a fresh clone, `tsc -p .` fails with *Cannot find module 'claude-code'* until you run `npm run types`. Run it again after updating Claude Code. The script (`scripts/types.js`) starts `claude --plugin-dir . -p` once with an empty, signed-out config folder, so nothing in your real `~/.claude` is read or written and no prompt goes to the model.

`app/` (the desktop app):

```
npm ci
npx tsc --noEmit -p .
npx vitest run
npx electron-vite build
```

GitHub Actions (`.github/workflows/ci.yml`) runs the same steps on `windows-latest` for every push and pull request.

When you run the app or a plugin session by hand, point `CLAUDE_CONFIG_DIR` at a scratch folder so your real sessions and settings are not touched.

## Rules to keep

- **`app/shared/timeline.ts` and `hooks/timeline.ts` are the same file, byte for byte.** Change one, copy it onto the other. `app/shared/timeline.spec.ts` fails when they differ.
- **One version for the plugin and the app.** Do not edit version numbers by hand:
  ```
  node scripts/version.js x.y.z     # sets it in every file
  node scripts/version.js --check   # fails if files differ or CHANGELOG.md has no "## x.y.z" section
  ```
  Releases are versioned by the maintainer; a pull request does not need to bump the version.
- **Tests**: plugin tests are `tests/*.test.ts` (`claude plugin test .`); app tests are `*.spec.ts` (vitest), so the plugin runner never picks them up. A bug fix comes with a test that fails without the fix.
- **No real data**: no real session ids, session names, paths with your user name, or tokens in code, tests, screenshots or logs. Use placeholder values.
- JavaScript/TypeScript: `const` by default, `let` when reassigned, no `var`. Comments match the language and tone of the file around them.

## Pull requests

- One topic per pull request. Describe **what** changed and **why**, and how you checked it (commands and their output).
- `npm run check` (root) and the `app/` commands above pass, and CI is green.
- Say in the pull request what a user will notice; the maintainer writes the `CHANGELOG.md` section at release.
- If you change what the app or the plugin writes under `~/.claude/clock-out/`, say how existing files from older versions are read.
- If the screens change, attach a screenshot (made with a scratch `CLAUDE_CONFIG_DIR`).

---

## 한국어

이슈와 PR 을 환영합니다. 보안 문제는 이슈 대신 [SECURITY.md](SECURITY.md) 를 보세요.

### 개발 환경

- Windows 10 · 11 (앱과 백그라운드 서비스는 Windows 전용)
- Node 24, npm
- Claude Code CLI(`claude`) — README 의 *지원·검증한 Claude Code 버전* 표에 있는 버전. 타입 생성, `claude plugin validate`, `claude plugin test` 는 **로그인 없이** 됩니다.

저장소는 두 부분입니다. 루트의 플러그인(`hooks/`, `tests/`, `.claude-plugin/`)과 `app/` 의 데스크톱 앱입니다.

### 빌드와 테스트

저장소 루트(플러그인):

```
npm ci              # TypeScript
npm run types       # 플러그인 API 타입을 .claude-plugin/types/ 에 만듦(git 에 없음)
npm run check       # 타입 생성 → tsc -p . → claude plugin validate . → claude plugin test . → 버전 점검
```

`.claude-plugin/types/` 는 Claude Code 가 폴더에서 플러그인을 불러올 때 직접 쓰는 파일이라 git 에 없습니다. 새로 clone 한 곳에서는 `npm run types` 전까지 `tsc -p .` 가 *Cannot find module 'claude-code'* 로 실패합니다. Claude Code 를 업데이트한 뒤에도 다시 돌리세요. 스크립트(`scripts/types.js`)는 비어 있고 로그인하지 않은 설정 폴더로 `claude --plugin-dir . -p` 를 한 번 실행합니다. 그래서 실제 `~/.claude` 는 읽지도 쓰지도 않고, 모델에 프롬프트를 보내지 않습니다.

`app/`(데스크톱 앱):

```
npm ci
npx tsc --noEmit -p .
npx vitest run
npx electron-vite build
```

GitHub Actions(`.github/workflows/ci.yml`)가 push 와 PR 마다 `windows-latest` 에서 같은 단계를 돌립니다.

앱이나 플러그인 세션을 손으로 띄울 때는 `CLAUDE_CONFIG_DIR` 을 임시 폴더로 지정해 실제 세션과 설정을 건드리지 않게 하세요.

### 지킬 규칙

- **`app/shared/timeline.ts` 와 `hooks/timeline.ts` 는 바이트까지 같은 파일입니다.** 한쪽을 고치면 다른 쪽에 그대로 복사하세요. 다르면 `app/shared/timeline.spec.ts` 가 실패합니다.
- **플러그인과 앱은 버전 하나를 씁니다.** 버전 숫자를 손으로 고치지 마세요.
  ```
  node scripts/version.js x.y.z     # 모든 파일에 버전을 맞춤
  node scripts/version.js --check   # 파일끼리 다르거나 CHANGELOG.md 에 "## x.y.z" 절이 없으면 실패
  ```
  릴리스 버전은 관리자가 올립니다. PR 에서 버전을 올릴 필요는 없습니다.
- **테스트** — 플러그인 테스트는 `tests/*.test.ts`(`claude plugin test .`), 앱 테스트는 `*.spec.ts`(vitest)입니다. 이름이 달라서 플러그인 테스트 실행기가 앱 테스트를 집어 가지 않습니다. 버그 수정에는 수정 전에 실패하는 테스트를 같이 넣어 주세요.
- **실제 데이터 금지** — 코드·테스트·스크린샷·로그에 실제 세션 id, 세션 이름, 사용자 이름이 든 경로, 토큰을 넣지 마세요. 예시 값으로 바꾸세요.
- JavaScript/TypeScript 는 `const` 가 기본, 다시 대입할 때만 `let`, `var` 는 쓰지 않습니다. 주석은 주변 파일의 언어와 말투를 따릅니다.

### PR

- PR 하나에 주제 하나. **무엇을**, **왜** 바꿨는지와 어떻게 확인했는지(명령과 출력)를 적어 주세요.
- 루트의 `npm run check` 와 위 `app/` 명령이 통과하고 CI 가 초록이어야 합니다.
- 사용자가 알아챌 변화를 PR 에 적어 주세요. `CHANGELOG.md` 의 절은 릴리스 때 관리자가 씁니다.
- 앱이나 플러그인이 `~/.claude/clock-out/` 아래에 쓰는 형식을 바꾸면, 예전 버전이 쓴 파일을 어떻게 읽는지 적어 주세요.
- 화면이 바뀌면 스크린샷을 붙여 주세요(임시 `CLAUDE_CONFIG_DIR` 로 찍은 것).

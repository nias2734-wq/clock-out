## What and why / 무엇을, 왜

<!-- What changed, and the problem it fixes. Link the issue if there is one. / 무엇을 바꿨고 어떤 문제를 고치는지. 이슈가 있으면 링크. -->

## How I checked / 확인한 방법

<!-- Commands you ran and their output. / 돌린 명령과 출력. -->

```
npm run check            # root: types, tsc, plugin validate, plugin test, version check
cd app && npx tsc --noEmit -p . && npx vitest run && npx electron-vite build
```

## Checklist / 확인 목록

- [ ] `npm run check` (root) and the `app/` commands pass / 루트 `npm run check` 와 `app/` 명령 통과
- [ ] A bug fix has a test that fails without it / 버그 수정에 수정 전 실패하는 테스트 포함
- [ ] `app/shared/timeline.ts` and `hooks/timeline.ts` are still identical (if touched) / 고쳤다면 두 timeline.ts 가 같음
- [ ] No real session ids, session names, user paths or tokens in code, tests, screenshots or logs / 실제 세션 id·세션 이름·사용자 경로·토큰 없음
- [ ] If the files under `~/.claude/clock-out/` change shape, files from older versions are still read / `~/.claude/clock-out/` 파일 형식을 바꿨다면 이전 버전 파일도 읽힘
- [ ] User-visible change described above (the maintainer writes CHANGELOG.md at release) / 사용자에게 보이는 변화를 위에 적음(CHANGELOG.md 는 릴리스 때 관리자가 씀)

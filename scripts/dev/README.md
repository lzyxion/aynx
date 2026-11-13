# scripts/dev — 개발 검증 도구

> **fake-agent-headless.mjs** — 오케스트레이션 헤드리스 작업자 · 판정형의 가짜 CLI(개발 빌드 전용 · 모델 호출 없음). 개발 앱을 띄우기 전
> `AYNX_DEV_FAKE_AGENT=<이 파일의 절대 경로>` 를 주면 서버 손이 진짜 CLI 대신 `node <이 파일> <턴 인자>` 를 띄운다 — 인자를 읽어
> Claude stream-json · Codex `--json` 꼴의 JSONL 을 내고 그 턴의 토큰으로 `commit_changes` · `report_done` · `report_review` 를 부른다.
> 지시문 표식 `[fake:blocked|noreport|mismatch|fail|changes|slow]` 로 갈래를 고른다(머리말). 같은 흐름의 cargo 시험은
> `src-tauri/src/orchestration/tests_headless.rs`(가짜 작업자 JSONL 판).

## run-harness.mjs — 하네스 한 판을 통째로 돌린다 (권장 · Edge 는 러너가 띄우고 반드시 끈다)

**헤드리스 하네스는 이 러너로 돌린다.** 2026-09-30 에 손으로 띄운 헤드리스 Edge 약 75벌(msedge 686개)이
꺼지지 않고 남아 PC 가 느려졌다 — 러너는 vite → Edge(새 임시 프로필) → 하네스 → 정리까지 한 프로세스가 쥔다.

```bash
node scripts/dev/run-harness.mjs new-shell-cwd-harness.mjs <outdir>
node scripts/dev/run-harness.mjs file-tree-harness.mjs <outdir> --size 1100x800
node scripts/dev/run-harness.mjs blocks-harness.mjs out.png -- scripts/dev/blocks-search.example.js   # `--` 뒤는 하네스에 그대로
# 옵션: --size WxH(기본 1200x900) · --vite-port N · --cdp-port N · --keep-vite · --timeout 초(기본 600)
#       --settle ms(첫 적재 뒤 가라앉기, 기본 3000) · --no-cdp-arg
```

- 하네스 파일은 이름만 주면 `scripts/dev/` 에서 찾는다. 종료 코드는 **하네스의 것**(시한 초과는 124).
- 포트를 안 주면 빈 포트를 고른다. `--vite-port` 에 이미 vite 가 답하면 **그것을 쓰고 끄지 않는다**
  (`--keep-vite` 로 남긴 vite 를 다음 판들이 이어 쓰는 길 — 다 쓰면 그 vite 는 손으로 끈다).
- 하네스에는 `PAGE_PORT`·`CDP_PORT` 환경 변수와 위치 인자 `<outdir> <cdp>` 를 **둘 다** 준다. 둘째 인자를 다른
  뜻으로 쓰는 판은 러너 안 `ARG_STYLE` 표에 적혀 있다 — `blocks-harness`(outdir 만 · 둘째는 주입 스크립트) ·
  `messenger-harness`(CDP 포트만). 새 판이 그런 모양이면 표에 한 줄 더하거나 `--no-cdp-arg` 를 쓴다.
- 첫 적재가 끝나고 `--settle` 동안 새로고침이 없을 때 하네스를 붙인다. 하네스들은 "사람이 몇 초 늦게 돌린다"
  (그동안 vite 변환이 데워짐)를 전제로 `Page.reload` 뒤 4~5초만 재기 때문에, 곧바로 붙이면 file-tree · ui-scale 이
  타일이 안 떠 FAIL 났다.
- **정리:** 성공 · 실패 · 예외 · SIGINT/SIGTERM · 시한 초과 어느 길이든 Edge 트리(`taskkill /T /F`, 그 밖 OS 는
  프로세스 그룹) → 같은 프로필 명령줄로 한 번 더 쓸기 → 러너가 띄운 vite 트리 → 임시 프로필(`%TEMP%\aynx-harness-*`,
  잠금이 풀릴 때까지 재시도) 순. Windows 에서 러너가 **강제로** 죽으면(시그널이 없어 `kill`·`taskkill /F` 는 곧
  즉사다) finally 가 못 도니, 떨어져 나간 감시 프로세스가 러너의 생존을 1초마다 보다 같은 정리를 대신한다.
- Edge 경로는 `EDGE` 환경 변수가 먼저, 없으면 Windows 기본 경로. 없으면 분명한 오류로 멈춘다.
- 하네스 안에서 `Page.reload` 뒤에는 고정 sleep 대신 `boot-wait.mjs` 의 `waitBoot(ev)`(스플래시가 걷히고 탭 줄이 설 때까지)를
  쓴다 — 찬 vite 에서는 부팅이 4.5초를 넘겨 첫 키가 사라졌다(2026-10-27). 오른쪽 위 단추를 진짜 마우스로 누르는 판은
  `waitToastsGone(ev)` 로 부팅 토스트("탭 N개를 복원했습니다")가 걷힌 뒤 누른다(포인터가 오르면 토스트가 줄지 않는다).
- **여러 판을 동시에 돌리지 않는다** — 같은 `.vite/deps` 를 나눠 쓰는 dev 서버끼리 재최적화가 서로의 청크를 지운다
  (ui-scale 절). 여러 판이면 `--keep-vite` 한 벌에 차례로 붙인다.

### kill-harness-edge.mjs — 남은 하네스 Edge 쓸어 내기

```bash
node scripts/dev/kill-harness-edge.mjs --dry-run   # 끌 것만 보기
node scripts/dev/kill-harness-edge.mjs             # 끈다 (끈 pid · cdp 포트 · 프로필을 찍는다)
```

명령줄에 `--remote-debugging-port` 가 있고 `--user-data-dir` 가 임시 폴더 아래이면서 `aynx-harness-` 또는 `claude`
(에이전트 스크래치패드)를 품은 Edge **만** 트리째 끈다 — 사용자의 Edge·다른 디버그 Edge 는 건드리지 않는다.
Windows 전용(`Get-CimInstance Win32_Process`), 다른 OS 는 "not implemented" 스텁. 프로필 폴더는 지우지 않는다.

### 손으로 띄우기 (예비 — 러너를 못 쓸 때만)

아래 절마다 적힌 `npx vite --port P --strictPort` + `msedge --headless=new --remote-debugging-port=… --user-data-dir=…`
+ `PAGE_PORT=P node scripts/dev/<판>.mjs <outdir> <cdp>` 가 예전 방식이다. **이 길로 띄운 Edge 는 아무도 끄지
않는다** — 판이 끝나면 반드시 Edge 트리를 끄고(`taskkill /PID <pid> /T /F` 또는 위 kill-harness-edge) vite 도 끈다.

**`agent-signal` 을 흉내 내려면 `agent-signal-fake.mjs` 의 `fakeAgentSignal(payload)` 로** — 상태의 권위가 Rust 표(`agent_state.rs`)라
창은 페이로드의 `agentState`·`seq`·`state`·`completed`·`notify` 만 적는다. 도우미가 `stepHookSignal` 로 그 몫을 채워 Rust 와 같은 모양을 쏜다(`window.__emit` 직접은 점이 안 움직인다).

## cdp.mjs — WebView2 CDP 로 앱 조작·캡처

앱을 원격 디버깅 포트를 켜서 띄운 뒤, 페이지 안에서 JS 평가·키 입력·캡처를 한다.
창이 다른 창에 가려 있어도 `Page.captureScreenshot` 은 웹뷰 내용을 그대로 찍는다
(OS 창 캡처는 앞 창에 가려 실패한 적이 있다).

```bash
# 개발 인스턴스 (포트 9222)
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
# 릴리스 exe 단독 실행은 9223 을 쓰면 둘을 구분할 수 있다 (cdp.mjs 는 9222 → 9223 순으로 찾는다)
# 사용자 릴리스 앱이 9222 를 쓰고 있으면 반드시 CDP_PORT=9223 node scripts/dev/cdp.mjs … — 그 포트에만 붙는다
# (다른 하네스는 9222 고정이라 그때는 쓰지 않는다)

node scripts/dev/cdp.mjs eval "document.title"          # JS 평가 (await 지원)
node scripts/dev/cdp.mjs shot out.png [reload]           # 웹뷰 캡처 (reload = 캐시 무시 리로드 후)
node scripts/dev/cdp.mjs key Ctrl+Shift+KeyN [count]     # 키 조합 (ev.code 이름)
node scripts/dev/cdp.mjs console 5                       # 콘솔 메시지 5초 수집
node scripts/dev/cdp.mjs script file.js                  # 파일 내용 평가
```

- 개발 인스턴스는 WebView2 사용자 폴더가 따로다(`io.github.lzyxion.aynx-dev`) — 릴리스 Aynx 가 떠 있어도
  9222 가 먹는다. 개발 창은 `%APPDATA%\aynx-dev` 를 쓰고 제목이 `Aynx (dev)` 다
  ([docs/log/2026-09-26-dev-release-isolation.md](../../docs/log/2026-09-26-dev-release-isolation.md)).

- Node 22+ (전역 `WebSocket`). 의존성 없음.
- 앱 내부 명령은 `window.__TAURI_INTERNALS__.invoke('cmd', args)` 로 부를 수 있다
  (예: `session_stats`, `list_hosts`).
- 합성 클릭(`el.click()`)은 핸들러는 태우지만 사용자 활성화가 없어 **클립보드 API 는 실패**한다.
- 검색 오버레이 검증 예: `input.q` 에 타이핑, `[data-chip="scope"]` 칩, 타일의
  `.xterm-decoration` 개수로 하이라이트 확인.

## render-web.mjs — Tauri 없이 헤드리스 Edge 로 화면 렌더·측정

사용자가 앱을 띄워 둔 채라 디버그 포트가 없을 때의 우회로. `tauri dev` 의 vite(1420)만 있으면
된다 — `__TAURI_INTERNALS__` 스텁(invoke 는 전부 거부)을 주입해 시작 화면 같은 정적 화면을 그린다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224 \
  --user-data-dir=%TEMP%/edge-aynx --window-size=520,900 http://localhost:1420/
node scripts/dev/render-web.mjs 520 out.png     # 폭 520 으로 렌더 → 시작 화면 카드 폭·잘림 측정 + 캡처
```

측정 부분(`.start .card`)은 예시다 — 다른 화면이면 스크립트 안의 표현식을 바꾼다. 세션·설정을
쓰는 화면은 invoke 가 거부되어 비거나 오류가 난다(그건 CDP 9222 로 실제 앱에서 본다).

## convo-path-links-harness.mjs — AI 타일 대화 면의 파일 경로 링크

`MarkdownBlocks` 의 `paths`(2026-11-11 — `pane/AiFlip.svelte`). `ai-flip-harness` 의 스텁에 `local_stat` · `local_read_text` 를 더하고, 지금 폴더는
터미널 출력에 OSC 7 을 먹여 알린다. 걸릴 것 / 안 걸릴 것(맨 이름 · 코드 블록 안 · 굵게 안) · 줄 꼬리(`:12` · `:12-20` · `#L12` · `#L12-L20`) ·
폴더를 모를 때 상대 경로 없음 · 클릭 → stat 경로 · 문서 타일 · 줄 강조(.md 블록 · .ts 줄 띠) · 고른 채 클릭은 안 엶 · Tab → Enter 를 판정한다.
진짜 마우스 끌기는 헤드리스에서 고르기를 만들지 못해 건너뛴다(스크립트로 건 고르기 + click 이 대신 본다).

```bash
node scripts/dev/run-harness.mjs convo-path-links-harness.mjs <outdir> --size 1280x860
```

## flat-corner-harness.mjs — 평면 상태줄 왼쪽 · 오른쪽의 안쪽 모서리 곡선

`+page.svelte` 의 `.canvas-corner` 절(2026-11-03). 재질(평면 · 글래스) × 자리(왼쪽 · 오른쪽) × 배율(1 · 1.25 · 1.5) 마다
조각 · L 위 변 · 기둥 선의 자리를 재고 모서리를 6배 확대해 찍는다. 배율 1 에서는 창 전체와 세션 판(Ctrl+Shift+M)을 연 모서리도
찍어 자르는 상자의 곡률을 본다. 숫자가 맞아도 반투명 겹침 · 소수 배율 실금은 그림에서만 보이니 확대 그림을 눈으로 본다.

```bash
node scripts/dev/run-harness.mjs flat-corner-harness.mjs <outdir> --size 1100x700
# <outdir>/corner-<flat|glass>-<left|right>-<1|1.25|1.5>.png · -full.png · -sheet.png
```

## file-ui-remote-harness.mjs — 원격 창의 파일 타일 보기 요청

원격 창 흉내로 뜨고 탭은 `mirror-layout` 방송으로 세운다. 토글 → 요청 한 번 · 그 값의 거울 갱신에 유지 · 슬라이더 연타 = 요청 하나 · 거절돼도 안내 없음 · 집 PC 없으면 안 보냄. 실제 GUI · 주 창 왕복은 아니다(주 창 적용은 `file-ui-keep-harness` ⑨).

```bash
node scripts/dev/run-harness.mjs file-ui-remote-harness.mjs <outdir> --size 1100x800
```

## file-ui-keep-harness.mjs — 파일 타일 보기 설정 유지

숨김 · 보기 · 장소 · 미리 보기 · 크기의 F5 유지 · 새 타일 = 마지막 값 · 다른 타일 · 복원은 그대로 · 설정 기본 보기와의 관계 · 원격 파일 타일 · 복제 · 망가진 값(헤드리스 스텁).

```bash
node scripts/dev/run-harness.mjs file-ui-keep-harness.mjs <outdir> --size 1100x800
```

## agent-seen-harness.mjs — 완료 확인 공유

`app/agent-seen.svelte.ts`(2026-11-04). 원격 창 흉내 + 탭 직접 세우기 · 신호는 `fakeAgentSignal` · 다른 창의 몫은 `window.__emit('agent-seen', …)` 주입. 표식 → 보기 → op 한 번 · 수신(옛 seq · 권한 배너 유지) · 숨김/가림막/비포커스/입력 없음 · 폰 solo · 스냅숏으로 깨어남을 판정한다. `REPRO=1` 이면 폰 자체의 지우기까지만(고치기 전 코드 재현용). 서버 왕복은 Rust 시험이 본다.

```bash
node scripts/dev/run-harness.mjs agent-seen-harness.mjs <outdir> --size 400x844
```

## trust-bubble-harness.mjs — 대화 면 신뢰 안내 말풍선

`pane/AiFlip.svelte` · `pane/claude-trust.ts`(2026-11-04). Claude 질문은 2.1.318 실측 글자를 가짜 터미널에 넣는다. 말풍선 · 옅은 면(어둡게 · 밝게) · 꼬리 · 칸 막힘 · Enter/글자/보내기가 `write_session` 으로 안 샘 · ✕ · 질문 사라짐 · 다시 물음 · 단추 · 보내기 직전 재확인 · 문장 인용 · 사람이 말한 뒤 · 훅을 받은 뒤 · Codex 모양과 영구 닫기를 판정한다. 폰 400 은 `phone-convo-harness.mjs` 의 "폰 신뢰" 줄.

```bash
node scripts/dev/run-harness.mjs trust-bubble-harness.mjs <outdir> --size 1280x860
# <outdir>/trust-claude-dark.png · trust-claude-light.png · trust-codex-dark.png
```

## phone-convo-harness.mjs — 폰 배치의 AI 타일 첫 화면

`pane/AiFlip.svelte` 의 첫 화면(2026-11-04). 원격 창 흉내로 뜨고 탭은 `applyMirrorTabs` 로 직접 세운다. 처음 볼 때 대화 면 · 움직임 · 포커스 없음 · 숨은 탭 안 넘어감 · 대화 면 = 키 띠 숨음(끈적 Ctrl 풀림 · 치던 글 유지 · 첫 프레임 깜빡임 없음 · 왕복해도 `resize_session` 없음) · 터미널로 돌리면 유지 · 새 CLI = 다시 · 설정 줄 · 옵션 터미널 · 넓은 폭 변화 없음을 판정한다. 화면 키보드 자체는 헤드리스에 없다 — 실제 폰에서 본다.

```bash
node scripts/dev/run-harness.mjs phone-convo-harness.mjs <outdir> --size 400x844
```

## sheet-tile-drag-harness.mjs — 세션 판 칸 끌기

`SessionSheet.svelte` 의 칸 끌기(2026-11-04). 놓는 곳 표(판의 칸 · 시작 타일 · 판 아래 타일 · 탭 줄 · 창 밖) · 보던 탭 유지 · 마지막 탭의 시작 타일 · 받지 않는 자리 · 끄는 중 blur · 왕복 뒤 세션을 판정한다.
판정표는 합성 `DragEvent` 로, 칸에서 끌기가 시작되는지와 칸 → 칸 하나는 `Input.setInterceptDrags` + 진짜 마우스 입력으로 돈다. OS 끌기 창 · 창 밖 커서 · Esc 취소 · 다른 창 탭 줄은 어느 쪽으로도 재현되지 않으니 사람이 본다.

```bash
node scripts/dev/run-harness.mjs sheet-tile-drag-harness.mjs <outdir> --size 1280x860   # 헤드리스 스텁
HARNESS_REAL=1 CDP_PORT=9222 PAGE_PORT=1420 node scripts/dev/sheet-tile-drag-harness.mjs <outdir>   # 이 워크트리의 개발 앱(만든 탭 · 워크스페이스는 끝에 지운다)
```

## blocks-harness.mjs — 헤드리스 Edge 에 가짜 로컬 세션을 열고 OSC 133/7 바이트를 직접 밀어 넣기

render-web.mjs 의 스텁을 확장한 것. `open_local_session` 을 가로채 Tauri `Channel` 의 콜백 id 를
잡아 두고, `window.__feed(sessionId, text)` 로 셸 출력을 흉내 낸다 — 진짜 셸 없이 블록(A·B·C·D)·
cwd(OSC 7)·실패 표시·블록 검색·거울 push 까지 검증할 수 있다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224 \
  --user-data-dir=%TEMP%/edge-aynx --window-size=1100,700 http://localhost:1420/
node scripts/dev/blocks-harness.mjs out.png                          # 블록 3개(성공·실패·성공) 주입 후 캡처
node scripts/dev/blocks-harness.mjs out.png scripts/dev/blocks-search.example.js   # 주입 뒤 페이지에서 스크립트 평가(예: #검색·점프 확인)
CDP_PORT=9231 node scripts/dev/blocks-harness.mjs out.png            # 9224 를 다른 판이 쓰고 있을 때
```

블록 뒤에 **OSC 8 하이퍼링크 · OSC 52 원격 클립보드** 두 판이 더 붙는다
(docs/log/2026-09-23-osc52-osc8.md). 기대 출력:

```
osc8 hover → menu: 1 link: ["https://example.com","https://example.com"]
osc8 open_url (plain / ctrl): 0 1
osc52 write → clipboard: ["aynx-osc52"] toast: 1
osc52 query → writes: 1 reads: 0 new invokes: 0
```

- **스텁이 `load_settings` 로 WebGL 을 끈다.** 가속 렌더러에서는 화면 글자가 canvas 라
  `.xterm-rows` 가 통째로 비어 있어 링크 라벨의 좌표를 잴 수 없다.
- OSC 8 은 **주소가 화면 글자에 없다** — 라벨만 보인다. 그래서 진짜
  `Input.dispatchMouseEvent` 로 포인터를 올리고, 앱이 붙든 `hoveredLink` 를 **우클릭 메뉴의
  `title`** 로 읽는다. 그 **우클릭만은 합성 이벤트**다: CDP 의 오른쪽 버튼은 `contextmenu`
  DOM 이벤트를 만들지 않는다.
- `open_url (plain / ctrl): 0 1` 이 조작 규칙 그 자체다 — 그냥 클릭은 열지 않는다.
- OSC 52 쓰기는 `navigator.clipboard` 스텁(`window.__clip`)으로 받는다. `reads` 는 플러그인
  invoke `plugin:clipboard-manager|read_text` 와 웹 API `readText` 를 **둘 다** 센다
  (docs/log/2026-09-28-clipboard-plugin.md). **읽기 요청(`?`) 줄의
  `writes 1 · reads 0 · new invokes 0`** 이 요점이다: 아무 답도 나가지 않았다는 뜻이고,
  그것이 이 기능의 유일한 보안 불변이다.

## keygen-harness.mjs — 호스트 폼과 공개키 설치 고르개를 스텁 위에서 몰아 본다

`blocks-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다
(docs/log/2026-09-17-keygen.md). `web-01` 을 수정 모드로 열고 "새 키 만들기…" 모달을 채워
제출한 뒤, 설치 고르개의 무리 셋을 확인한다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/keygen-harness.mjs out-prefix   # <prefix>-modal.png · <prefix>-groups.png
```

- **앱의 모듈 인스턴스를 직접 부른다** — `performance.getEntriesByType('resource')` 에서 실제
  URL(`?t=<시각>` 포함)을 찾아 `import()` 한다. URL 을 손으로 적으면 Vite HMR 의 질의가 달라
  `$state` 를 공유하지 않는 **사본**이 생기고, "함수는 먹는데 화면이 안 바뀌는" 증상이 된다.
- **암호구는 로그에 찍지 않는다.** 단언은 `typeof`·`length` 로 "보냈는가" 만 본다.

## host-form-tabs-harness.mjs — 호스트 폼의 세 탭(접속 · 표시 · 세션)

`keygen-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다
(docs/log/2026-09-20-host-form-tabs.md). 추가 모드(볼트 줄이 없다)와 수정 모드를 차례로 열어
왼쪽 내비의 세 칸을 눌러 보고, 각 섹션이 **언마운트되지 않고** 자기 id 를 그대로 들고 있는지
센다. 이어 **접속 탭에서** 잘못된 스크롤백으로 제출해 오류가 세션 탭으로 데려가는지, 창을
520px 로 줄여 [저장]이 화면 안에 남는지 보고, 마지막으로 **앱이 그리는 고르개·자동완성**
(네이티브 `<select>`·`<datalist>` 를 대신한 `Dropdown`·`Combobox`)을 연다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx-hostform --window-size=1100,800 http://localhost:1420/
node scripts/dev/host-form-tabs-harness.mjs out-prefix 9224
# <prefix>-add.png · -edit-connect.png · -edit-display.png · -edit-session.png · -error-jump.png · -short.png
# <prefix>-dropdown.png (경유 호스트 목록) · <prefix>-combobox.png (그룹 칸 자동완성)
# <prefix>-icon-search.png (아이콘 칸에 `deb` — 격자가 데비안 하나로 좁은 판)
# <prefix>-tags.png (태그 칸 아래에 칩이 쌓인 판)
```

- **첫 줄이 `import hosts module: module not loaded yet` 이면 그대로 한 번 더 돌린다.**
  Vite 를 막 띄운 뒤의 첫 판은 `hosts.svelte.ts` 가 아직 네트워크 기록에 없어 모듈을 잡지
  못한다 — 두 번째부터는 붙는다(잠깐 기다렸다 돌려도 된다).
- 오류 제출은 **두 번** 한다. 같은 실수를 두 번 해도 탭이 다시 따라오는지가 요점이다
  (`formErrorField` 를 비우지 않으면 두 번째에 안 움직인다).
- `<form novalidate>` 가 빠지면 이 하네스의 `requestSubmit()` 이 **조용히 아무 일도 하지
  않는다** — `error:` 가 `null` 로 나오면 그것부터 의심한다.
- **⑤ 는 폼을 다시 열고 시작한다.** ③ 이 남긴 오류 한 줄과 나쁜 스크롤백을 지워야 "Enter 로
  골랐지 제출하지 않았다"(`no submit (calls before/after): 0 0` · `no error: true`)를 잴 수
  있다. `Escape`·`Enter`·`↓` 는 `Input.dispatchKeyEvent` 로 넣는다 — 여기서 걸린 판단이 기본
  동작 취소와 포커스 되돌리기라 가짜 이벤트로는 잴 수 없다.
- 그룹 칸에 `pr` 을 치면 줄이 **둘**이다(`prod` · `prod/web` — 조상 경로도 후보다). 하네스는
  `↓` 로 둘째 줄을 고른 뒤 Enter 를 누른다. 두 PNG 는 **눈으로 본다**: 상자의 둥근 모서리·
  테두리·그림자·줄 하이라이트가 우클릭 메뉴(`.ctx-menu`)와 같아야 한다.
- **⑥ 은 아이콘 칸이 검색창인지를 본다** (`IconPicker` · docs/log/2026-09-20-host-form-tabs.md
  의 "아이콘 칸 = 검색"). `deb` 를 치면 격자가 **하나**로 좁아지고 그 하나에 `hint` 가 붙되
  **값은 아직 안 바뀐다**; Enter 가 `svg:debian` 을 넣고 칸에는 `Debian` 이 남으며 격자는
  34개로 돌아온다(`on` 하나). 이어 `🐧` 는 곧바로 값이 되고 안내 한 줄(`.nomatch`)이 서며,
  빈 칸은 값을 지운다. `picks`·`hint`·`on`·`nomatch` 넷이 그 세 상태의 눈금이다.
- **⑦ 은 태그가 칩인지를 본다** (`TagInput` · 같은 문서의 "태그 = 칩 입력"). Enter · 쉼표 ·
  칸 떠나기 · `×` · 빈 칸의 `Backspace` 다섯 몸짓이 각각 칩 목록을 어떻게 바꾸는지 찍는다.
  마지막 두 줄이 요점이다: [저장]을 **진짜 마우스로** 누르되 `mousePressed` 와
  `mouseReleased` 를 갈라 보내, 누른 순간(`focusout`)에 이미 치던 글자가 칩이 되어 있고
  제출은 아직 0건임을 본다 — 그 한 프레임이 "저장을 누르러 간 손이 태그를 잃지 않는다" 다.
  **⑦ 은 폼을 실제로 제출하므로 마지막 블록이어야 한다**(스텁이 `edit_host` 를 거절해 오류
  한 줄이 남는다).

## polish-harness.mjs — 스니펫 기본값·설명과 tmux 팝오버 새로고침

`blocks-harness.mjs` 의 사본 (docs/log/2026-09-17-polish-snippets-tmux-errors.md).
`load_snippets` 가 `df -h {{경로=/var|어느 경로를 볼지}}` 하나를 주고, `;` 팔레트로 그것을 넣어
**칸이 기본값으로 채워진 채 열리는지**와 나가는 바이트(`write_session`)를 본다. 이어서 tmux
호스트를 열어 팝오버의 새로고침을 누른다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9225   --user-data-dir=%TEMP%/edge-aynx-polish --window-size=1100,800 http://localhost:1420/
node scripts/dev/polish-harness.mjs out-prefix 9225   # <prefix>-snippet-default.png · <prefix>-tmux-refresh.png
```

- **포트를 인자로 받는다.** 9224 한 자리를 여럿이 쓰면 서로의 스텁 위로 `Page.reload` 를 걸어
  둘 다 엉뚱한 화면을 본다. 혼자 돌 때는 인자를 생략하면 9224 다.
- `ssh_tmux_list` 스텁은 **부를 때마다 다른 답**(1줄 → 2줄)을 준다. 호출 횟수만 세면 화면이
  실제로 갈렸는지는 모른다.
- 사용자의 `tauri dev` 가 살아 있는 서버라 다른 편집의 HMR 이 페이지를 갈아 끼울 수 있다 —
  긴 시나리오는 중간에 모듈을 **다시 import** 한다 (`window.__H` 가 사라지는 증상).

## tmux-kill-harness.mjs — tmux 목록 팝오버의 끄기 단추

`polish-harness.mjs` 의 tmux 판 사본. 스텁 tmux 세션 넷(이 타일 `aynx-1` · 클라이언트 둘 `work` · 빈 `배포` · 끄기를 거절하는 `fail`)으로
칩 → 목록 → 줄 끝 끄기 → 확인 대화(제목 · 본문 · 점 · 단추 · 첫 포커스 취소) → `ssh_tmux_kill{id, name}`(명령 글자 없음) → 같은 자리에
다시 열려 목록을 다시 읽는지 · 실패 알림 한 줄 · 이 타일의 세션을 끈 뒤에는 다시 열지 않는지 · 클릭 이후 콘솔 오류 · 예외 0 을 본다.

```bash
node scripts/dev/run-harness.mjs scripts/dev/tmux-kill-harness.mjs <outdir>   # tmux-kill-{list,confirm,failed,here}.png
```

## connect-diag-harness.mjs — 접속 실패 갈래마다 배너를 읽고, SSH 이름 카드를 확인한다

`blocks-harness.mjs` 의 사본에 `open_ssh_session`·`session_info` 스텁을 얹었다
(docs/log/2026-09-17-connect-diagnostics.md). 호스트 독에서 `web-01` 을 열고
`window.__openErr` 를 갈아 끼우며 **아홉 갈래**를 차례로 거부시켜 배너의 `.why`·`.hint` 를
읽은 뒤, `window.__sessionInfo` 를 답하게 하고 `.pane-name` 에 `pointerover`·`pointerenter` 를 보내
SSH 이름 카드(`[data-session-info-card]`)의 줄 · 이름 칸에 `title` 이 없음 · 접근성 설명(`aria-describedby`)을
본다. 페이지 시계를 31초 앞당겨 호버 재조회와 새 값(지연 경고색)이 카드에 오는지도 본다
(docs/log/2026-09-28-tile-header-tooltips.md "SSH 이름 카드"). 포트는 `CDP_PORT`·`PAGE_PORT` 로 바꾼다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,700 http://localhost:1420/
node scripts/dev/connect-diag-harness.mjs outdir   # connect-error-hint.png · session-info-card-{dark,light}.png
```

- 갈래를 늘렸으면 스크립트 안 `CASES` 표에 한 줄을 더한다 (페이로드는 Rust `OpenDiag` 모양 그대로).
- **분류 자체는 여기서 확인되지 않는다** — 페이로드를 우리가 만들어 넣기 때문이다. `russh`/io
  오류 → 갈래의 표는 `cargo test` 의 순수 함수 테스트가 쥔다.

## passphrase-harness.mjs — 개인키 암호구 모달을 스텁 위에서 몰아 본다

`blocks-harness.mjs` 의 사본에 `open_ssh_session` 스텁을 얹었다
(docs/log/2026-09-19-identity-file-auth.md). 암호구 없이 부르면 `passphrase_required` 로
거절하고 실려 오면 붙는 스텁이라, **네 갈래**를 한 판에 몬다: 처음 묻기(제목·파일 이름·
지문·시도 횟수) → 넣고 붙기(두 번째 호출의 `passphrase`·`passphraseFor`) → 틀리기
(`wrong: true` → "암호구가 맞지 않습니다.") → 취소(`declinedKeys` → **비밀번호 모달**).
(예전의 다섯째 갈래 — 체크박스 [에이전트에 넣기] → `ssh-add` 타일 — 는 볼트 ②(`75cc26a`)에서 기능이 빠져
2026-09-27 에 걷었다. 같은 까닭으로 `keygen-agent-harness.mjs` 도 지웠다.)

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/passphrase-harness.mjs outdir 9224   # passphrase-prompt.png
```

- **암호구의 값은 찍지 않는다** — 단언은 `typeof`·`length` 뿐이다(`keygen-harness.mjs` 와
  같은 규칙). "DOM 에 안 남는다"·"우리가 찍는 로그에 안 섞인다" 도 함께 본다.
- **주입 스크립트 안의 주석에 백틱을 쓰지 않는다** — 템플릿 리터럴이 거기서 끝나
  Node 가 `SyntaxError` 로 죽는다.
- `window.__calls` 는 인자 객체를 **참조로** 들고 있어 `declinedKeys` 가 나중에 변한다 —
  그래서 스텁 안에서 그 순간의 모양을 복사해 `window.__ppCalls` 에 적는다.

## host-remove-harness.mjs — 호스트 제거가 즐겨찾기·스니펫·워크스페이스 저장 트리를 함께 치우는지 본다

`blocks-harness.mjs` 의 사본 (docs/log/2026-09-17-host-remove-fanout.md). 즐겨찾기 두 칸 ·
호스트 스니펫 하나 + 전역 하나 · 다른 워크스페이스의 `web-01` 잎과 로컬 잎 · `web-01` 타일 하나가
열린 배치를 심고, 독(`Ctrl+Shift+H`)에서 `web-01` 을 우클릭 → 제거 → 인라인 확인까지 몬다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/host-remove-harness.mjs host-remove-confirm.png
CDP_PORT=9225 node scripts/dev/host-remove-harness.mjs out.png   # 9224 를 이미 다른 판이 쓰고 있을 때
```

- 확인 문구의 숫자(`즐겨찾기 1 · 스니펫 1 · 저장된 워크스페이스 타일 1 · 열린 타일 1`)와, 그 뒤 백엔드로 나간 짐
  (`save_snippets`·`workspaces_apply`의 `rewriteHostAliases`)·`localStorage['aynx:favorites']` 를 함께 단언한다.
- `load_snippets`는 JSON 문자열, `workspaces_load`는 `{ state: "v2", file }` 객체다. cold 저장 트리는 제거 후 접히며 열린 SSH 타일은 닫지 않는다.
- 다른 헤드리스 판이 9224 를 쓰고 있으면 그 탭을 리로드해 버린다. 자기 `--user-data-dir` 로 하나
  더 띄우고 `CDP_PORT` 를 준다.

## host-history-harness.mjs — 접속 이력: 최근 정렬 · 말풍선 · 팔레트 "최근" 묶음

`host-remove-harness.mjs` 의 사본 (docs/log/2026-09-23-host-history.md). 호스트 셋 · 즐겨찾기
한 칸(`web-01`) · `host_history_list` 스텁에 이력 둘(`db-01` 2분 전 성공 · `app-01` 1시간 전
성공 + 5분 전 `tcp_refused` 실패)을 심고 띄운다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/host-history-harness.mjs outdir   # host-history-palette.png · host-history-dock.png
```

(격리 서버면 `PAGE_PORT=1434 CDP_PORT=9250` 을 앞에 붙인다 — 2026-09-25 부터 host-history · host-remove ·
host-form-tabs 도 다른 하네스처럼 두 변수를 읽는다.)

- 단언: 팔레트(`Ctrl+Shift+P`) 빈 질의의 첫 머리글 "최근" · 묶음 `db-01|app-01`(줄에
  `data-recent`) · 첫 줄 선택 · 한 글자(`d`)를 치면 묶음이 사라짐 · Escape 로 닫힘 · 독 줄 순서가 정렬 버튼
  (`[data-host-sort]`) 한 번에 `web-01|db-01|app-01` → `db-01|app-01|web-01` · `save_settings`
  의 `hosts = {sort:"recent"}` · `app-01` 줄 `title` 에 마지막 접속·실패 · 이력 없는 줄은 `title` 없음.

## vault-harness.mjs — 자격증명 금고의 저장 체크·잠금 해제 관문

`passphrase-harness.mjs` 의 사본에 금고 스텁(`vault_*`)을 얹었다
(docs/log/2026-09-19-vault.md 의 "② 인증 연결").

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9226   --user-data-dir=%TEMP%/edge-aynx-vault --window-size=1100,800 http://localhost:1420/
node scripts/dev/vault-harness.mjs <outdir> 9226   # <outdir>/vault-save-check.png · vault-unlock.png
```

- 시나리오 다섯: ① 금고 없음 + 저장 체크 → `vault_create(null)` → `vault_store_password` ·
  ② 잠김 → 접속 **전에** 잠금 해제 모달(틀린 마스터 → 줄만, Escape → 건너뛰고 접속) ·
  ③ `stored_rejected` → 줄 + 체크가 미리 켜짐 · ④ 암호구 모달에 에이전트 체크가 없다 ·
  **⑤ 대기열 드레인**(2026-09-22).
- ⑤가 보는 것: `ensureVaultUnlocked()` 를 **세 번** 불러 셋을 줄 세운 뒤, 틀린 마스터에는
  아무도 깨어나지 않고 맞은 마스터 한 번에 **셋 다** 깨어난다. ⑤-b 는 Escape 도 셋을 깨우고,
  그 뒤에 새로 부른 하나에는 모달이 **다시** 뜬다
  (docs/log/2026-09-22-vault-unlock-queue.md). 타일을 세 개 세우는 대신 **앱의 모듈
  인스턴스**(`app/prompts.svelte`)를 `?t=` URL 로 import 해 직접 부른다.
- **시나리오마다 `localStorage` 에 상태를 적고 페이지를 새로고침한다.** 앱이 금고 상태를
  몇 초 기억하므로(`$lib/vault` 의 TTL) 같은 페이지에서 상태만 갈아 끼우면 옛 답이 남아
  관문이 안 뜨는 것처럼 보인다.
- **비밀은 찍지 않는다** — 스텁이 값을 받아도 기록에 남기는 것은 `typeof` 와 길이뿐이다.

## vault-settings-harness.mjs — 설정 › 보안 화면 (볼트 + AI 위임 호스트)

`vault-harness.mjs`(② 접속 흐름)의 짝 — 이쪽은 **화면**을 본다
(docs/log/2026-09-19-vault.md ③ · docs/log/2026-09-21-fleet-delegation-ui.md).

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9227   --user-data-dir=%TEMP%/edge-aynx-vault3 --window-size=1200,900 http://localhost:1420/
node scripts/dev/vault-settings-harness.mjs <outdir> 9227   # <outdir>/vault-settings.png · vault-host-form.png · delegation.png
```

- 시나리오 다섯: ① 볼트 없음 + 마스터 설정 모달 · ② 열림+마스터(삭제·변경) · ③ 잠김 ·
  ④ 호스트 목록 표식 + 호스트 폼의 저장된 자격증명 · **⑤ AI 위임 호스트 표**(2026-09-21).
- ⑤가 보는 것: 권한 칩 넷의 켜짐/꺼짐 · 고아 줄(`alias_known:false`)의 경고 한 마디와
  흐림 · [제거]는 **두 번 눌러야** 지운다(첫 번째는 글자만 바뀐다) · [호스트 설정…]이
  호스트 폼을 **세션 탭**으로 연다. 부팅 알림("설정에 없는 AI 위임 n개")도 같은 화면에 뜬다.
- **비밀은 절대 찍지 않는다** — 금고 명령이 받은 값은 `typeof`·길이로만 기록한다.

## vault-veil-harness.mjs — 볼트가 가림막과 함께 잠긴다

`vault-harness.mjs`(접속 흐름) · `vault-settings-harness.mjs`(화면)의 셋째 짝이고, 보는 것은
**잠그는 사건과 다시 여는 문**이다 (docs/log/2026-09-19-vault.md 의 "가림막과 함께 잠긴다").

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9228   --user-data-dir=%TEMP%/edge-aynx-veil --window-size=1200,900 http://localhost:1420/
node scripts/dev/vault-veil-harness.mjs <outdir> 9228   # <outdir>/vault-veil-unlock.png · vault-settings-2.png
```

- 시나리오 셋: ① 마스터 없음 — `Ctrl+Shift+B` → `vault_lock` 한 번, 걷어도 잠긴 채, 접속하면
  **칸 없는 관문** → Enter → `vault_unlock{master:null}` · ② 마스터 있음 — 칸이 서고 틀리면
  줄만, 그동안 `open_ssh_session` 은 0번 · ③ 설정 — 자동 잠금 줄이 **없고** 마스터 없이도
  [잠그기] 가 선다.
- 인자 기록은 `present`/`empty`/`null`/`absent` **넷**이다. `null` 과 `empty` 를 가르는 것이
  이 하네스의 단언이다 — 마스터 없는 볼트는 `null` 로 열려야 하고, 빈 문자열이면 백엔드에서
  "틀린 마스터" 가 된다.

## console-hosts-harness.mjs — 대시보드 세션 칸의 목록 모드(호스트로 묶은 한 벌)

> **2026-09-28 부터 낡음** — 이 판이 보던 화면(세션 칸 목록 모드 · 거르개 칩)은 대시보드 세션 칸의 카드 한 면으로 합쳐지며 사라졌다
> ([docs/log/2026-09-28-dashboard-session-cards.md](../../docs/log/2026-09-28-dashboard-session-cards.md)). 스텁은 다른 하네스의 재료로 남긴다.

`connect-diag-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다
(docs/log/2026-09-21-console-host-groups.md). 독에서 `web-01` 을 열어 **이 창의 타일 하나**를
만들고, 그 타일의 거울 키(`report_session` 의 `key`)를 `list_console_sessions` 스텁에 **같은
streamId 로** 실어 중복 제거를 재현한다. 나머지는 지어낸다: 다른 창의 공유 세션 · 살아 있는
헤드리스(작업안 실행 중) · 아직 안 붙은 위임 · 고아 위임.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/console-hosts-harness.mjs <prefix>   # <prefix>-console-hosts.png
```

- 단언: 묶음 순서(실패 → 작업중) · 같은 streamId 는 **한 줄** · 머리줄이 최악 상태 ·
  거르개 칩 셋(`전체3 · 타일1 · 헤드리스1`) · **아직 안 붙은 위임과 고아는 대시보드에 없다**
  (그 목록은 설정 › 보안으로 옮겨 갔다 — 아래 `vault-settings-harness.mjs` ⑤) ·
  경과가 **마지막 활동**(방금 흘린 블록) 기준인지 · 가로 넘침 0.
- `blocks-harness.mjs` 의 `__feed` 를 가져다 **SSH 타일에 OSC 133 블록 한 건**을 흘린다 —
  이 창 줄의 명령·종료 코드·경과는 전역 거울이 아니라 그 블록에서 온다.
- `vault_status` 스텁을 `null` 로 두면 접속 경로가 `hasMaster` 를 읽다 죽어 타일이 안 열린다
  (그러면 `report_session` 이 없어 streamId 를 못 잡는다).

## status-signals-harness.mjs — 상태바 후미 전역 신호 넷

`console-hosts-harness.mjs` 의 사본 — 대시보드는 `▶` 로 한 번만 연다(작업안 칸 · 왼쪽 기둥을 덮지 않음). 나머지는 **띠만** 본다
(docs/log/2026-09-21-statusbar-signals.md). 스텁 네 칸(`window.__activity`·`__ops`·`__settings`·
`__vault`)이 신호 하나씩을 먹인다.

```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/status-signals-harness.mjs <prefix>   # <prefix>-status-signals.png · -vertical.png
```

- 시나리오는 **두 판**이다: 넷이 전부 켜진 모습(툴팁 전문·`▶` 배지 `1`)과, 스텁을 뒤집어
  (도장 2분 전 · 도는 것 없음 · 자동 승인 꺼짐 · 볼트 `absent`) **넷이 전부 사라지는** 모습.
  조건부가 이 기능의 전부라 켜진 판 하나만으로는 검증이 절반이다.
- 재조회는 **창 포커스** 한 길로 깨운다(신호 셋이 그 길을 쓴다). 자동 승인과 띠의 자리만은
  `load_settings` 를 다시 태워야 한다 — 앱 모듈 인스턴스로 `loadSettings()` 를 직접 부른다.
- 신호에는 `data-status-id` 가 **없다**(끌어 옮기는 순서에 들지 않는다). 대신 뜻 하나에
  `data-signal` 한 값(`ai`·`running`·`auto-approve`·`vault-open`·`vault-locked` — 볼트 둘은 2026-10-23 자물쇠가 독으로 옮겨 가며 걷혔다)이 붙는다.
  2026-10-24 End-4 알약부터 `notify` 는 늘 서는 알약 단추이고 `auto-approve` · `keep-awake` 는 그 안의 표시 span 이다(누를 수 없다).
- `✦` 의 "연결됨" 은 진짜 시계(60초 창)라, 도장은 **포커스 직전에** 다시 찍는다(툴팁은 이름만 — 경과 초는 싣지 않는다).

## review-card-harness.mjs — 화면 아래 가운데 검토 대기 카드 (그 자리에서 승인)

`status-signals-harness.mjs` 의 사본 — 먹이는 칸은 하나다(`window.__ops` = `list_operations`
의 답, 재조회는 **창 포커스**로 깨운다). 스텁의 `approve_operation`·`reject_operation` 은 그 작업안을
목록에서 빼고, `window.__approveFails` 에 문자열을 넣으면 그 사유로 승인을 거부한다.
docs/log/2026-09-27-review-popup-card.md (앞선 판 docs/log/2026-09-22-review-card.md). **기본 포트가
vite 1438 · CDP 9270** 이다(1420/9222 는 개발 앱의 것).

```bash
npx vite --port 1438 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9270   --user-data-dir=%TEMP%/edge-aynx-review --window-size=1200,800 http://localhost:1438/
PAGE_PORT=1438 node scripts/dev/review-card-harness.mjs <outdir> 9270
# <outdir>/review-card-one.png · -many.png · -danger.png · -left.png · -veiled.png
```

- 시나리오 열둘: ① 대기 0 → 카드도 토스트 기둥도 없다 · ② 안전 작업안 하나 — 명령 **전문**(줄바꿈 그대로)·
  제목·사유·경로·검증·대상 둘(canary 하나), 아래 상태바 **바로 위**(틈 ≤ 24px) 본문 가운데 · 폭 560 ·
  ③ 셋 + 13 KB·대상 8 — `1 / 3`·‹ ›(끝에서 꺼짐)·명령 상자가 **정확히 열 줄**에서 안쪽 스크롤·
  "대상 8 ▾" 펼침·보던 것이 사라지면 `1 / 2`(맨 앞으로) · ④ **포커스** — xterm 숨은 textarea 에
  포커스를 둔 채 [거절]을 **`Input.dispatchMouseEvent` 로** 누르면 포커스가 그대로이고, 이어 친 Enter 가
  승인도 거절도 부르지 않는다 · ⑤ 안전 승인 한 번 = `approve_operation{manual}` · ⑥ 위험(`rm -rf`) —
  첫 클릭은 무장만(`확인했습니다 — 실행`·경고 줄), ›‹ 와 Escape 가 풀고, 두 번째 클릭에 **한 번** 나간다 ·
  ⑦ 승인 거부 → 오른쪽 위 토스트(`승인 거부: …`), 카드와 단추는 그대로 · ⑧ 접기 한 줄 · 새 머리가
  다시 편다 · ⑧-b [나중에](2026-11-13) — 대기 둘을 모두 치움(승인 · 거절 없음) · 새 작업안이 오면 그것만 카드로 · 대기가 비면 치운 표도 빈다 · ⑨ 대시보드 작업안·에이전트 칸에서 물러나고 세션 칸에서 선다 · ⑩ 왼쪽 상태바
  (`loadSettings` 로 옮긴다) — 띠 오른쪽·본문 안 · ⑪ 가림막 — 개수 한 줄만, z 118 로 가림막(115) 위 ·
  ⑫ 잡히지 않은 예외·콘솔 오류 0.
- **④ 는 `element.click()` 으로는 의미가 없다** — 프로그램 클릭은 애초에 포커스를 옮기지 않는다.
  진짜 마우스 이벤트여야 `mousedown` 의 기본 동작(포커스 이동)을 카드가 막는지 본다.
- 부팅은 시작 화면이라 터미널이 없다 — ④ 앞에서 `openInNewTab(newLocalPane())` 으로 로컬 셸 탭을 연다.
- 가림막·대시보드·설정은 앱 모듈 인스턴스(`importApp`)를 직접 부른다. 모듈이 많아 리소스 타이밍
  버퍼(기본 250)를 넘으므로 스텁 첫 줄에서 `setResourceTimingBufferSize(10000)` 한다.

## run-notify-harness.mjs — 작업안 실행 결과 알림 (토스트 · 알림 센터 · OS 알림 · 가림막)

> **낡은 구간 있음** — 대시보드 작업안 칸을 보는 ⑩ · ⑪ 의 화면은 2026-10-07 에 사라졌고, 알림 센터는 지금 독의 알림 칸이다.

`review-card-harness.mjs` 의 사본(docs/log/2026-09-28-run-result-notify.md). 먹이는 칸은 넷이다 —
`window.__ops`(`list_operations`) · `window.__results[id]`(`operation_results`, 없으면 빈 맵) ·
`window.__resultsFail`(id 배열 — 그 작업안의 결과 읽기를 거부) · `window.__focused`(`document.hasFocus`
를 갈아 끼운다). 종료 이벤트는 `window.__emit('operation-state', {operationId, state})` 로 쏘고, OS 알림은
`window.Notification` 을 갈아 끼워 `window.__osNotes` 에 모은다(플러그인의 발사가 곧
`new Notification(title, {body})` 다). 대상 이름은 스텁 `list_console_sessions` 가 준다(`s1` → `web-01` …).
**기본 포트가 vite 1440 · CDP 9272** 다.

```bash
npx vite --port 1440 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9272   --user-data-dir=%TEMP%/edge-aynx-runnotify --window-size=1200,800 http://localhost:1440/
PAGE_PORT=1440 node scripts/dev/run-notify-harness.mjs <outdir> 9272
# <outdir>/run-notify-success.png · -partial · -canary · -validate · -cancelled · -auto · -unavailable · -stack · -center · -veiled
```

- 시나리오: ⑧ 부팅 때 이미 끝나 있던 작업안(스텁 첫 목록의 `op-old`)은 이벤트가 와도 알리지 않는다(맨 먼저
  본다) · ① 성공 3초·단추 없음 · ② 일부 실패 6초 + [결과 보기]·이름 둘 + `외 N` · ③ canary 멈춤 ·
  ③′ canary 검증에서 멈춤(canary 성공 + 나머지 시작 전 취소 + `validate` 있음 → `canary 검증 실패로 멈춤`) · ④ 취소 무채 ·
  ⑤ `자동` 칩 · ⑥ 결과 읽기 실패 → 상태만 · ⑦ 이미 알린 것·겹친 이벤트 셋·포커스 그물 → 한 번 · ⑨ 거절·만료
  없음 · ⑩ 대시보드 작업안 칸이면 토스트 없이 센터만(에이전트 칸에서는 뜬다) · ⑪ 토스트 [결과 보기]와 알림
  센터 줄(`[data-notify-run]`) → 대시보드 작업안 칸 · ⑬ OS 알림 — 창이 뒤일 때만·설정 끄면 없음 ·
  ⑫ 가림막 — 개수만(합쳐 센다)·가림막 위에 보인다·센터에는 전문 · 기존 토스트는 한 줄 그대로 · ⑭ 오류 0.
- 토스트는 판마다 `dismiss` 로 걷는다(3초·6초 시계가 다음 판에 끼지 않게). 쌓인 모습(`-stack`)은
  `holdToasts()` 로 시계를 멈추고 찍는다.

## run-history-harness.mjs — 작업안 실행 기록 (채팅 독의 작업안 갈래 › 기록 — 한 줄 목록 + 그 자리 펼침)

`run-notify-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다(docs/log/2026-09-28-run-history.md). 먹이는
칸: `window.__auditRuns`(`audit_runs` — 스텁이 `sinceMs`·`limit` 으로 자르고 최신순으로 준다) ·
`window.__auditFail`(참이면 거부) · `window.__ops`(`list_operations`) · `window.__results[id]`. 데이터는 목업
안 A 의 줄들(오늘 셋 · 어제 넷 · 그저께 다섯 · 20일 전 하나)이고 시각은 **지금** 기준 로컬 날짜로 만든다(화면이
로컬 날짜로 묶는다). 이름은 감사 스냅샷(`targetLabels`)에서 온다(`s1` → `web-01` …). **기본 포트가 vite 1441 ·
CDP 9273** 다.

```bash
npx vite --port 1441 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9273   --user-data-dir=%TEMP%/edge-aynx-runhistory --window-size=1280,860 http://localhost:1441/
PAGE_PORT=1441 node scripts/dev/run-history-harness.mjs <outdir> 9273
# <outdir>/run-history-list.png · -collapsed · -canary · -optin · -filtered · -narrow · -empty · plans-exec · polish-untitled
# 또는 러너(Edge · vite 정리 포함): node scripts/dev/run-harness.mjs run-history-harness.mjs <outdir> --size 1400x900
```

- 시나리오: ① 보기 단추 둘(진행 · 기록 — 비교 · 행렬은 2026-10-25 에 걷었다) · 알약 묶음(고른 것 = `--accent-soft`) ·
  감사 알약(머리 줄 오른쪽 · `감사 N` · title 에 폴더 · 바닥 띠 없음) · 기간 7일 요청 · ② 하루 묶음(오늘 · 어제 · 접힌 그저께
  `N건 더 ▾`)과 줄 모양(시각 · 표식 · 제목 — 없으면 명령 한 번 · 대상 · 결과 · 수동/자동) · 아코디언(가장 최근 줄이 펼쳐져 그
  바로 아래 상세 하나) · ③ 요약(상자 없음) · 비율 막대(무채) · ⑤ 상세 — 발췌 있음(대상 표 **실패 먼저** · canary · exit · 시간 ·
  stderr 덩어리) · 펼친 줄을 다시 누르면 접히고 저절로 다시 펴지 않음 · ⑦ canary 검증 멈춤 · canary 멈춤 문구 ·
  ⑥ 발췌 없음(끔 → 한 줄 + 설정 링크 → 설정 독의 그 토글과 경로를 밝힌 안내문 · 켬 → 사유 한 줄) ·
  ⑧ ↑↓·End(펼침이 따라간다) · ④ 거르기(결과 · 승인 · 호스트 · 검색 · 기간 30일 — 걸린 칩만 채움) · ⑫ `openPlansAt(id)` — 메모리에
  없으면 폴링 한 바퀴 뒤 기록으로, 있으면 진행 보기에 머문다 · 실행 카드(제목 · 상태 알약 n/m · 결과 줄) · ⑮ 좁은 독(380px)에서
  본문이 가로로 넘치지 않고 제목 칸 ≥ 150px · ⑬ 빈 상태 · 읽기 실패 + [다시 읽기] · ⑯ 제목 없는 긴 한 줄 · ⑭ 오류 0.
- 지우기(2026-11-13 — 작업안 바닥 줄): ⑫ 진행 [완료된 실행 지우기] — 줄이 나가는 중(`inert`) → 빠지고 폴링 뒤에도 안 돌아옴 · 꺼짐 ·
  ⑬-b [기록 지우기] — 줄마다 차례 지연(`Element.prototype.animate` 를 엿들어 0 · 25 · 50ms) · 빈 상태 · 다시 열어도 비어 있음 ·
  `clearHistoryView(0)` 로 되돌림 · ⑬-c 골라 지우기 — 줄의 × 하나만 · 거른 채 [보이는 기록 지우기] = 보이는 것만(지운 시각은 안 건드림).
  숨긴 id(`aynx:run-history-hidden`)는 되돌리지 않으므로 ⑬-c 는 끝(⑭ 앞)에 둔다.
- 거르기·기간은 모듈 상태라 판을 넘어 남는다 — 시나리오 순서가 그 가정을 탄다(⑬ 앞에서 기간을 7일로 되돌린다).

## plans-dock-harness.mjs — 작업안 = 채팅 독의 갈래 (2026-10-25)

`run-history-harness.mjs` 의 스텁 그대로(작업안 대기 둘을 먹인다). 러너로만 돌린다:
`node scripts/dev/run-harness.mjs plans-dock-harness.mjs <outdir> --size 1400x900`
→ `dock-plans.png` · `dock-chat.png` · `phone-plans.png` · `remote-plans-dock.png`.

- ① `openPlans` → 채팅 독 + 작업안 갈래(탭 트리에 작업안 타일 없음) · 갈래 칸(독 폭 전체 알약 · 34px · 고른 칸 `--accent-soft`) ·
  작업안 칸 배지 = 승인 대기 수(aria-label 에도) · 머리줄 '작업안' · 📌 · ✕ 만 · 검토 카드는 물러난다
- ② 채팅 갈래 — 머리줄(제목 ▾ · +) · 작업안 배지는 남음 · `plansShown` 거짓 · `aynx:dock` 의 `chatSection`
- ③ `togglePlans` · `toggleChatDock` 의 갈래 규칙 · ④ `openPlansAt` → 작업안 갈래의 그 카드
- ⑤ 원격 폰 흉내(`sessionStorage` 표식 → `window.__AYNX_REMOTE__` · 390x844) — 전체 화면 덮개 · 보기 탭 두 칸 반반 · 거절/승인 44 ·
  휴대폰 '뒤로'(`history.back`) = 닫기 · 시트의 작업안 줄 → 덮개 · ⑥ 원격 데스크톱 폭 — 주 창과 같은 채팅 독의 작업안 갈래(덮는 판 없음 —
  2026-11-13) · ⑦ 예외 0(`stub:` 거절 제외)

## remote-chat-dock-harness.mjs — 원격 웹 창의 사이드 채팅 (2026-11-01)

처음부터 원격 창 흉내(`window.__AYNX_REMOTE__`)로 뜬다. 사이드 채팅 명령은 스텁(채팅 하나 · 턴이 돌고 권한 카드 하나 대기 · 통로
`side_chat_subscribe` 의 Channel id 로 사건을 손으로 흘린다). 러너로만 돌린다(개발 앱 · 1420 포트를 쓰지 않는다):
`node scripts/dev/run-harness.mjs remote-chat-dock-harness.mjs <outdir> --size 1400x900` → `remote-dock.png` · `phone-chat.png`.

- ① 원격 데스크톱 폭 — 채팅 독 마운트 · `toggleChatDock` 으로 열림 · 독 안 작업안 몸통 숨음 · ▾ 점 = 권한 · 권한 카드
- ② 독의 작업안 칸 → 독의 작업안 갈래(주 창과 같다 · 덮는 판 없음 — 2026-11-13)
- ③ 다른 창이 먼저 답한 카드(`[unknown-request]`) — 오류 줄 · 대괄호 낱말 없이 삼키고 다시 맞춘다
- ④ 다른 창이 보낸 사람 글(`userAccepted{text}`) — 곧바로 말풍선
- ⑤ 원격 폰(390x844) — 독 없음 · 상태줄 말풍선(점 = 권한) → 전체 화면 덮개 · 포커스 = 뒤로 단추 · `enterkeyhint="enter"` · 그림 고르기 ·
  Enter = 줄바꿈(`side_chat_send` 없음) · 휴대폰 '뒤로' = 닫기 · 시트의 사이드 채팅 줄 → 덮개 · ⑥ 예외 0

## projects-harness.mjs — 프로젝트 (프로젝트 독 · 여는 길 · 팔레트 · 폼 · 워크트리)

`host-history-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다
(docs/log/2026-09-24-projects.md). `projects_list` 에 로컬 하나·원격 하나를 심는다. 독은
`Ctrl+Shift+J`(프로젝트 독)로 연다 — 호스트 독(`Ctrl+Shift+H`)에는 프로젝트가 **없어야** 맞다(①).
네이티브 확인은 `plugin:dialog|message` 를 `"No"` 로 스텁한다(플러그인의 `ask` 가 그 명령을 부른다).

```bash
node scripts/dev/run-harness.mjs projects-harness.mjs <outdir>     # 권장 (러너 — 약 2분 반)
# 예비(손으로 — 끝나면 Edge 를 직접 끈다):
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9224   --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 http://localhost:1420/
node scripts/dev/projects-harness.mjs <outdir> 9224
# <outdir>/projects-dock.png · projects-menu.png · projects-palette.png · projects-form.png
#          worktree-menu.png · worktree-prompt.png · agent-dot.png
#          worktree-cleanup.png(병합됨 칩 옆 [정리]) · worktree-suggest.png(이름 칸 브랜치 제안 — docs/log/2026-10-05-worktree-one-to-one.md)
```

- 스텁 프로젝트는 **새 모양**(`agent` · `setupScript` — 옛 `command` 칸 없음)이고, 원격 시작 명령은 에이전트 id
  (`codex`)다 — 추가 인자는 Rust 가 붙인다. `agent_args_targets` 도 스텁해야 한다: 비면 프로젝트 폼(F2)이 그 표를
  끝없이 다시 읽어 페이지가 멎는다(2026-09-30 판이 ③ 에서 시한 초과로 멈춘 까닭).
- ③ **키보드**: 검색 칸에 `api` → Enter 가 원격을 연다 · ↓↓ + F2 = 편집 폼 · 줄에서 Delete = 확인.
- ⑥ **워크트리**(docs/log/2026-09-24-worktrees.md): 스텁 `git_worktree_list`·`ssh_git_worktree_list`
  두 줄씩, `git_worktree_add` 는 `<dir 또는 C:\src\proj-wt>\<이름>` 을 돌려준다. 옆목록(첫 줄 `주 폴더`
  표식 · 툴팁 = 온전한 경로) · 이름 칸 아래 **온전한 자리**(비었을 때 `<이름>`, 잘리지 않는다) · 막힌
  이름은 git 을 부르지 않는다 · 만들고 나서 여는 순서 · 알림 문구와 [폴더 열기] · 탭 제목 ·
  원격 `start.worktree` 와 "만듭니다" 알림(단추 없음)을 본다.
- ⑫ **옛 판 훅 알림**(docs/log/2026-09-27-remote-hook-version.md): `agentSignal` 을 `hookVersion`·`hookLatest`
  와 함께 직접 불러 — 원격 AI 타일의 옛 판 → 알림 한 번 → [다시 설치…] 가 프로젝트 메뉴와 같은 확인 창·설치
  (그 타일의 세션) · 같은 호스트는 다시 권하지 않음 · 로컬 옛 판 → [설정 열기]. PNG `hook-version-remote.png`.
- ⑦·⑧ **에이전트 상태 점**(docs/log/2026-10-01-agent-status-three.md — 2026-10-03 다시 맞춤): 점은 셋(실행 중 ·
  권한 대기 · 완료)이고 근거는 훅 신호(`agent-signal` — 스텁 버스 `window.__emit`)뿐이다. 열린 직후 · 출력만으로는 점이
  없고(미상 없음), `waiting` 은 범주 `permission` 일 때만 권한 대기, 범주 없음 · `idle` 은 상태를 바꾸지 않는다. 완료는 그
  탭을 안 볼 때만 서고 보면 사라진다. 독의 워크트리 줄 점도 같은 신호로 세운다. 아래 launcher 하네스의 입력 대기 만들기는
  아직 옛 규칙이다.
- ⑥ 워크트리 줄은 **모두 왼쪽 폴더 이름 · 오른쪽 브랜치**다(주 폴더 줄도 — 27180b8). 줄 모양 `W:proj* · main`.
- ⑪ **평범한 셸에서 친 claude · 권한 물음 알림**(docs/log/2026-09-25-shell-claude-signals.md): `addLocal` 로
  연 타일이 `injectMcpToken:false` + `streamId` 로 열리고, `reportRunningCommand(…, 'claude')` +
  `agentCommandStarted`(OSC 133 스텁) 뒤에만 `agent-signal` 이 먹는다 · `waiting`+`permission` 만 알린다.
  PNG `agent-permission-toast.png`. 스텁은 `performance.setResourceTimingBufferSize(10000)` 을 건다 —
  `importApp` 이 찾는 모듈 URL 이 기본 버퍼(250) 밖으로 밀리지 않게.
- OS 알림 제목 앞머리는 글자로 박지 않고 앱 모듈의 `APP_TITLE`(`app/instance.ts`)을 읽어 맞춘다 — vite 개발
  서버에서는 `import.meta.env.DEV` 라 **`Aynx (dev)`** 다(docs/log/2026-09-26-dev-release-isolation.md).
  값이 `Aynx (dev)`·`Aynx` 둘 중 하나가 아니면 판을 멈춘다.

- 우클릭은 **합성 `contextmenu`** 다(CDP 의 오른쪽 버튼은 그 DOM 이벤트를 만들지 않는다).
  메뉴는 다음 틱에 서므로 150ms 뒤에 본다.
- 로컬 "열기" 는 스텁 인자(`open_local_session { cwd, injectMcpToken }`·`write_session "claude\r"`)와
  **앱 모듈 인스턴스**(`app/tabs.svelte` 의 `residentWindowTabs()`) 둘로 본다. 원격 "열기" 는
  `open_ssh_session { start, noTmux }` — 첫 입력은 Rust 가 조립하므로 `write_ssh` 가 0 이어야 맞다.

## start-board-mirror-harness.mjs — 원격 창의 시작 화면 = 집 PC 한 벌

원격 창 흉내로 뜨고 스텁 `mirror_get` · 이벤트 `mirror-layout` 으로 실제 받기 길을 지난다(`app/mirror` → `followHomeStartBoard`). 폰 쌓기 순서 · 넓은 창 좌표 · 편집 요소 없음 · 망가진 값 무시 · 프로필을 스스로 안 입힘 · 다시 읽어도 마지막 값 · 줄 고르기, 끝에 집 PC 창 흉내로 `mirror_publish` 재발행을 본다.

```bash
node scripts/dev/run-harness.mjs start-board-mirror-harness.mjs <outdir> --size 1280x860
# <outdir>/board-phone.png · board-wide.png
```

## toast-position-harness.mjs — 토스트 자리

`Toasts.svelte` 의 자리(2026-11-04): 상태바 네 자리 × 모양 셋에서 오른쪽 끝을 잰다 — 오른쪽 상태바면 그 바로 왼쪽(틈 12px) · 나머지는 창 오른쪽에서 12px. 채팅 독 · 세션 판을 열어도 그대로이고 폰 배치(폭 400)는 오른쪽 끝이다.

```bash
node scripts/dev/run-harness.mjs toast-position-harness.mjs <outdir> --size 1280x860
# <outdir>/toast-right-flat.png · toast-right-hug.png · toast-right-panel.png · toast-phone.png
```

## toast-harness.mjs — 토스트 모양·움직임 (오른쪽에서 들고 나기 · flip · 둥근 표식)

`notify-center-harness.mjs` 의 스텁 사본 (docs/log/2026-09-25-toast-redesign.md). **기본 포트가
vite 1434 · CDP 9250** 다.

```bash
npx vite --port 1434 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-toast --window-size=1200,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/toast-harness.mjs <outdir> 9250   # toast-stack.png · -light.png · toast-with-card.png (카드는 2026-09-27 부터 기둥 밖 아래 가운데)
```

- 토스트는 **앱 모듈 인스턴스**(`/lib/toast.svelte.ts`)로 밀어 넣고, 표본은 한 `evaluate` 안에서
  시간을 재며 뜬다(왕복 지연이 표본 시각을 흔들지 않게).
- 미는 칸은 `transform` 이 아니라 **`translate` 속성**이다 — 전이 도중의 계산값이
  `calc(39.8% + 9.5px)` 처럼 퍼센트 섞인 꼴이라 제 폭으로 풀어 읽는다(`TX`). 출발점은 표본 시각과
  무관하게 **첫 키프레임**으로 본다.

## dock-slide-harness.mjs — 독이 닫히는 140ms 동안의 그림 (본문 · 폭 · 제목)

`projects-harness.mjs` 의 스텁을 줄인 사본 (docs/log/2026-09-25-dock-slide.md). vite 1434 · CDP 9250.

```bash
PAGE_PORT=1434 node scripts/dev/dock-slide-harness.mjs <outdir> 9250   # dock-closing.png
```

- 폭 손잡이를 **실제로 끌어**(`Input.dispatchMouseEvent`) 프로젝트 독을 호스트 폭과 다르게 만든 뒤
  닫고, 40·100·300ms 표본을 한 `evaluate` 안의 타이머로 뜬다. `hidden` 은 마이크로태스크 한 번 뒤에
  본다(Svelte 가 그때 비운다).
- 본문 칸이 보이는지는 칸의 계산 `display` 로 읽으므로 **상자가 이미 `display:none` 이면 판단하지
  않는다**(안쪽 계산값은 부모를 따르지 않는다) — 그때는 상자를 본다.

## dock-segments-harness.mjs — 런처 독의 칸 (칸 줄 · 키 · 상태바 독 칸 · 옛 순서 접기 — 10-18 통합 독에 맞춰 칸 넷 · 알림 기본)

`dock-slide-harness.mjs` 의 사본 (docs/log/2026-09-25-unified-dock.md). 호스트 셋 · 프로젝트 둘을 심고 Ctrl+Shift+K/S는 독을 열지 않는지 본다.

```bash
npx vite --port 1434 --strictPort     # 다른 작업이 파일을 고치는 중이면 ui-scale 절의 no-HMR 설정
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-dock --window-size=1100,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/dock-segments-harness.mjs <outdir> 9250
# dock-hosts.png · dock-projects.png · dock-light.png · statusbar-merged.png(띠 앞 520px, 2배)
```

- 첫 판은 `sessionStorage['seg-old-order']` 표식으로 **일곱 칸 시절의 `aynx:status-order`** 를 심고 다시 띄워, 독 칸이 셋 중
  첫째 자리에 접히는지 본다. 그다음 표식을 지우고 한 번 더 띄운다.
- "여닫이가 돌았나" 는 `.dock.getAnimations().length` 로 본다 — 열린 채 칸을 바꾸면 0, 닫힌 데서 열면 0 보다 크다
  (키를 누르고 40ms 안에 잰다).
- 검색 칸 선은 **커서가 든 채** 재므로 `--line-strong` 이 맞다(포커스 표시).

## hosts-tree-harness.mjs — 호스트 칸의 트리 (펼침 저장 · 검색 저절로 펼침 · 키 · 메뉴 · 끌어 놓기)

`dock-segments-harness.mjs` 의 사본 (docs/log/2026-09-25-hosts-tree.md). 호스트 표만 다르다 — 운영(web-01 · web-02 ·
운영/db(db-01 · db-02)) · 개발(dev-01) · 그룹 없는 lab-01.

```bash
npx vite --port 1434 --strictPort     # 다른 작업이 파일을 고치는 중이면 ui-scale 절의 no-HMR 설정
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-tree --window-size=1100,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/hosts-tree-harness.mjs <outdir> 9250
# hosts-tree.png · hosts-tree-search.png · hosts-tree-light.png
```

- 첫 판에만 `aynx:hosts:expanded = ["운영"]` 과 옛 `aynx:hosts:view = grid` 를 심는다(`sessionStorage['tree-seeded']` 표식). 같은
  탭으로 다시 돌리면 앞 판이 바꿔 둔 펼침 위에서 돈다 — **새 탭**에서 돌린다(`/json/new`).
- 앱이 그려질 때(`.statusbar`)까지 다시 띄운다 — 첫 판은 모듈을 처음 옮기느라 4.5초 안에 안 선다.
- 끌어 놓기는 CDP 의 드래그 대신 **한 `DataTransfer` 로 합성한** `dragstart → dragover → drop` 이다(받았는지는 dragover 의
  `defaultPrevented`). `get_host_meta` 스텁은 호스트마다 제 그룹을 돌려준다 — 그룹 옮기기가 "이미 그 그룹" 이면 쓰지 않는다.

## file-tree-harness.mjs — 파일 타일의 트리 보기 (게으른 읽기 · 키 · 대상 폴더 · 끌어 놓기 · 큰 폴더 · 보기 전환)

`file-glyphs-harness.mjs` 의 사본 (docs/log/2026-09-25-file-tree-view.md). 스텁이 **바뀌는 가짜 디스크**(`window.__FS` —
중첩 · 3000 개 폴더 · 링크 · `local_mkdir`/`local_copy` 가 실제로 적힌다)와 늦게 답하는 가짜 SFTP(`/srv/app` 1.5s ·
`/srv/secret` 거절)를 든다. 읽은 폴더는 `window.__lists`/`__sftpLists` 에 쌓인다(게으른 읽기 확인).

```bash
npx vite --port 1434 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-filetree --window-size=1100,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/file-tree-harness.mjs <outdir> 9250
# files-tree.png · files-tree-sftp-loading.png · files-tree-light.png · files-navigate-toggle.png
```

- SFTP 타일은 로컬 파일 타일을 **원본으로 빌려** 연다(`noteSession(로컬 타일 id, 7)` → `newSftpPane(로컬 타일 id, …)`) — 원본 존재
  판정이 "그 id 의 패널이 있는가" 뿐이라 터미널 없이 선다.
- 끌어 놓기는 한 `DataTransfer` 로 합성한 `dragover`/`drop` 이다. OS 파일은 `dt.items.add(new File(…))`(종류 `Files`).
- 우클릭 메뉴는 합성 `contextmenu` 이벤트로 연다(CDP 의 오른쪽 버튼은 그 이벤트를 만들지 않는다).

## ui-scale-harness.mjs — UI 크기(웹뷰 확대)·앱 글꼴·터미널 글자 되돌려 맞추기

`dock-slide-harness.mjs` 의 사본 (docs/log/2026-09-25-ui-scale-font.md). vite 1436 · CDP 9260.

```bash
PAGE_PORT=1436 node scripts/dev/ui-scale-harness.mjs <outdir> 9260   # ui-scale-settings.png
```

- 스텁이라 웹뷰가 실제로 확대되지는 않는다 — `plugin:webview|set_webview_zoom` **호출**(값)을 본다.
- 터미널 글자는 둘로 본다: 설정 모듈의 `termFontSize`(같은 URL 을 `import()` 하면 앱과 같은 인스턴스)와,
  마지막 `resize_session` 의 cols 로 잰 xterm 셀 폭의 비(WebGL 렌더러라 DOM 측정 요소가 없다).
- 다른 작업이 파일을 고치는 중이면 HMR 새로고침이 시나리오를 끊는다 — 그때는 `server.hmr:false` ·
  `watch:null` · 따로 된 `cacheDir` 을 얹은 설정 파일로 vite 를 띄운다(같은 `.vite/deps` 를 여러 dev
  서버가 나눠 쓰면 재최적화가 서로의 청크를 지워 500 이 난다).

## dashboard-harness.mjs — 대시보드 (캔버스 덮기 · 타일 유지 · 닫는 길)

> **2026-10-07 부터 낡음** — 이 판이 보던 전체 화면 대시보드는 세션 목록 판과 작업안으로 나뉘어 사라졌다. 아래는 그때의 기록이다.

관리뷰 패널을 흡수한 전체 화면 대시보드가 약속한 것만 본다
(docs/log/2026-09-25-dashboard.md). 스텁은 `review-card-harness.mjs` 의 사본(로컬 셸 +
`list_operations` 한 칸)이고, 탭 둘 · 터미널 둘을 키(`Ctrl+Shift+N`·`Ctrl+Shift+T`)로 만든다.

```bash
npx vite --port 1437 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9265   --user-data-dir=%TEMP%/edge-aynx-dash --window-size=1200,800 http://localhost:1437/
PAGE_PORT=1437 node scripts/dev/dashboard-harness.mjs <outdir> 9265   # dashboard-sessions.png · -operations.png
```

- 단언: 칸 단추 넷(에이전트 · 세션 · 작업안 · 사용량 — docs/log/2026-09-26-agent-usage.md) · 판의 상자 = `.pane` 의 상자 · 탭 바/상태바 밖 · 불투명 · 터미널이 DOM 에 그대로 ·
  **`resize_session` 호출 수가 여닫는 동안 그대로**(덮기라 xterm 이 크기를 다시 재지 않는다) ·
  열리면 키보드가 안으로 · Escape 로 닫히고 터미널로 · 다른 탭/지금 탭 클릭 · 목록 줄 클릭
  (`focusTile`)으로 걷힘 · `openConsoleAt('operations')` → 작업안 칸(보기 셋 · 비교로 옮겨도 칸 안) · 검토 카드는
  작업안 칸에서만 물러남 · 콘솔 예외 0. 2026-09-28 부터 칸은 세션 · 작업안 · 사용량 셋이고 새 창은 **세션 칸**으로 연다
  (세션 칸의 "줄" 은 카드 `[data-session-card]` 다).
- ⑪ **세션 카드 축소판**(docs/log/2026-09-29-dashboard-thumbs.md) — 창을 1400×900 으로 넓히고 세션 여덟(탭 셋)을
  세워 넷에 색 출력을 `__feed` 로 먹인다(실패는 OSC 133 `D;1`). 스냅샷 호출 수는 창구(`termActionsOf`)의
  `screenSnapshot` 을 감싸 세고, 1초 칸의 비용은 `setInterval` 을 감싸 **`thumbTick` 을 부르는 시계만** 잰다(앱의 다른
  1초 시계가 섞이지 않게). 보기 저장값(`aynx:dashboard:session-view`)은 처음 새로 고치기 **전에** 지운다 — 앞선 실행이
  남긴 "간단히" 로 시작하지 않게. 캡처 `dashboard-{thumbs,compact}-{dark,light}.png`.
- 같은 dev 서버를 다른 작업이 함께 쓰면(`svelte-kit sync` 등) 페이지가 도중에 리로드되어 스텁
  표가 비는 일이 있다 — 그때는 다시 돌린다.

## tab-slide-harness.mjs — 탭 전환 슬라이드 (방향 · 크기 그대로 · 키보드 · 연타)

사람이 탭을 고를 때 캔버스가 옆으로 미끄러지는 움직임(docs/log/2026-09-29-tab-slide.md)을 본다. 스텁은
`dashboard-harness.mjs` 를 줄인 것(로컬 셸 — 세션 id 가 100 부터 탭 순서대로)이고, 탭 셋 · 터미널 셋을 키로 만든다.

```bash
npx vite --port 1430 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9231   --user-data-dir=%TEMP%/edge-aynx-slide --window-size=1200,800 http://localhost:1430/
PAGE_PORT=1430 node scripts/dev/tab-slide-harness.mjs <outdir> 9231   # <outdir>/tab-slide-{000,120,240,480}.png
```

- 단언: Ctrl+Tab → 두 탭의 층(상자 + 분할선 층)만 움직이고 방향이 맞다(오른쪽 탭으로 가면 떠나는 층 음수 · 들어오는 층
  양수) · 480ms · 떠나는 층 `inert` · 키보드는 곧바로 새 탭의 터미널 · 친 글자는 새 탭 세션의 `write_session` ·
  멎으면 애니메이션 0 · 그려진 탭은 활성 탭 하나 · Ctrl+Shift+Tab 은 반대 · 연타 5회(그려진 탭 ≤ 2 · 도중 전환 200ms ·
  끝은 마지막 탭만) · 되돌아가기는 **멈춘 그 자리**에서 이어 간다(움직임을 `pause()` 하고 `ready` 를 기다린 뒤 잰다 —
  멈춤은 다음 프레임에 확정된다) · 탭 닫기 · 대시보드에서 탭 · 움직임 줄이기는 슬라이드 없음 · 처음부터 끝까지
  `resize_session` 호출 수 그대로 · 콘솔 예외 0. 끝에 `ALL OK`.
- 장면은 전환 하나의 애니메이션을 전부 멈추고 `currentTime` 을 옮겨 찍는다(탭마다 색 다른 글을 `__feed` 로 먹인 뒤).

## hidden-tab-measure-harness.mjs — 숨은 탭의 글자 폭 재기 (탭 전환 멈춤 계측)

탭 둘 · 타일 셋씩(한글 · 기호 · 굵게 · 기울임 섞인 400줄)을 만들고 탭을 여섯 번 오간 뒤, 숨은 탭에 출력을 흘리고 돌아간다.
`.xterm-char-measure-element` 의 `offsetWidth` 를 가로채 **재기 수 · 0 폭 수 · 그 자리(동기 · rAF · 유휴 작업의 예약 스택)** 와
longtask 최장을 단계마다 찍는다(`<outdir>/hidden-tab-measure.json`). 단언: 행 그리기의 0 폭 재기 0 · 숨길 때는 타일당 한 번
(새 DOM 렌더러 생성자의 'W')뿐 · 콘솔 예외 0. `-- --dom` 은 WebGL 끈 설정 — 다시 보인 탭의 DOM 행이 숨은 동안 온 마지막 출력
(`MARK-<세션>`)까지 그려졌는지 · 기본 글자 간격이 칸 폭으로 틀어지지 않았는지도 본다. `-- --report` 는 숫자만(수정 전 비교용).

```bash
node scripts/dev/run-harness.mjs hidden-tab-measure-harness.mjs <outdir> --size 1600x1000
node scripts/dev/run-harness.mjs hidden-tab-measure-harness.mjs <outdir> --size 1600x1000 -- --dom
```

- 헤드리스는 재기 한 번이 싸서 longtask 는 크게 안 벌어진다 — 판정은 **재기 수**로 한다(릴리스 앱은 번당 ~1ms).
- xterm 번들은 압축이라 스택의 클래스 이름이 짧다(`Yt` = DomRenderer · `Qt` = RenderService · `ei` = SelectionService).

## agent-board-harness.mjs — 대시보드 에이전트 칸 (나를 기다리는 것 · 카드 · 승인 없음)

> **2026-09-28 부터 낡음** — 이 판이 보던 화면(에이전트 칸 — 나를 기다리는 것 · 에이전트 카드)은 대시보드 세션 칸의 카드 한 면으로 합쳐지며 사라졌다
> ([docs/log/2026-09-28-dashboard-session-cards.md](../../docs/log/2026-09-28-dashboard-session-cards.md)). 스텁은 다른 하네스의 재료로 남긴다.

`launcher-harness.mjs`(프로젝트 · 이벤트 버스 `__emit`) + `dashboard-harness.mjs`(`list_operations`)의
합본 (docs/log/2026-09-25-agent-board.md). 빈 창을 먼저 보고, 프로젝트 셋으로 AI 타일 넷(주 폴더 ·
워크트리 탭 · 원격 · 끝난 것)과 작업안 하나를 심는다 — 상태는 `agent-signal` 훅 이벤트와 `agentExit` 로.

```bash
npx vite --port 1434 --strictPort     # 다른 작업이 파일을 고치는 중이면 ui-scale 절의 no-HMR 설정
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-agents --window-size=1200,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/agent-board-harness.mjs <outdir> 9250
# agents-board.png · agents-board-empty.png · agents-board-light.png
```

- 단언: 새 창 토글 = 에이전트 칸 · 칸 셋 · 빈 상태 [프로젝트 열기] → 독 프로젝트 칸 · 대기 줄 순서/글자/대상 이름/만료 ·
  카드 순서·알약·시각·세 열 · 단추는 [타일로 가기]·[검토] 뿐 · **강조색 요소 = 입력 대기 점·알약 + 주 동작 하나** ·
  검토 카드 물러남 · 키보드(←→↑↓ · 줄 ↑↓ · Enter) · [검토] → 작업안 칸 · 카드/줄 → focusTile + 걷힘 · 예외 0.
- CDP 의 `keyDown` 으로 버튼을 Enter 로 누르려면 `text: "
"` 가 실려야 한다(키 코드만으로는 버튼이 눌리지 않는다).
- 첫 판은 차가운 dev 서버의 의존성 재최적화로 모듈 적재가 깨질 수 있다 — 한 번 더 돌린다.
- 지난 대화 덩어리는 비워 둔다(`agent_sessions_list` 빈 답) — 그쪽은 아래 `convo-harness.mjs`.

## convo-harness.mjs — 사용량 칸 · 상태바 고리 · 팔레트 `대화 ` · 다시 뜬 뒤의 재개 타일

> **2026-10-03 다시 맞춤** — 이 판이 보던 대시보드 에이전트 칸의 "지난 대화" 덩어리(범위 목록 · 줄 · 호버 단추 · 열림 ·
> 거르개 · 키보드 · 줄의 토큰 풀이)는 2026-09-28 에 빠졌다(4dda594 ·
> [docs/log/2026-09-28-dashboard-session-cards.md](../../docs/log/2026-09-28-dashboard-session-cards.md)). 그 구간을 걷어 내고
> 남은 문(사용량 칸 · 상태바 고리 · 팔레트 `대화 `/"사용량" · 다시 뜬 뒤의 재개 타일)만 본다. 시작 화면 · 기록 시트는
> 아래 `project-start-harness.mjs`.

`agent-board-harness.mjs` 의 사본에 워크트리(`git_worktree_list` — 저장소마다) · `agent_sessions_list`
(요청한 경로마다 묶음 + 기타) · `agent_session_launch_spec`(부른 인자를 `window.__launch` 에 쌓는다) ·
집 폴더(`plugin:path|resolve_directory`) 스텁을 더했다 (docs/log/2026-09-26-agent-sessions.md).

```bash
node scripts/dev/run-harness.mjs convo-harness.mjs <outdir> --settle 10000
# convo-palette.png · usage-section.png · usage-rings-left.png · usage-rings-bottom.png · usage-section-1920.png
```

- 단언: 대시보드에 지난 대화 덩어리가 없다 · 사용 한도 카드(사용량 칸 맨 위) · 팔레트 `대화 ` 줄 · 힌트 · 바닥 줄이 넘치지
  않는다 · Enter = 재개 → 그 명령의 AI 타일 · autorun 이 `agent_autorun_command` 를 지나 `--settings` 가 붙는다 ·
  `대화 resume` 은 부분 글자만 · 빈 찾기 = 최신순 · 접두사 없는 질의에는 대화가 없다 · 상태바 고리(값 · 단 · 묵음 · 이름 =
  `aria-label`, 말풍선은 호버 막대 카드) · 네 자리에서 고리 묶음이 **가운데 묶음의 맨 앞(상태바 길이 28%)** · 뒤에 워크스페이스와
  가르는 선(8b2b110) · 팔레트 "사용량" · 사용량 칸(칸 단추 셋 = 세션 · 작업안 · 사용량) · 다시 뜬 뒤 재개 타일이 autorun 을
  다시 돌리고 팔레트 줄이 "열림" · 예외 0. FAIL 이 있으면 종료 코드 1.
- 상태바 기본 자리는 왼쪽 기둥이라(f8416d7) 고리 숫자에 `%` 가 없다 — 단언은 그때 방향을 읽어 기대를 고른다.
- 잔디는 다섯 주라 날짜에 따라 카드 머리의 달이 셋까지 걸린다.
- 스텁 안(템플릿 문자열)의 주석에 역따옴표를 쓰지 않는다 — 스크립트 전체가 구문 오류로 죽는다.

## project-start-harness.mjs — 프로젝트 시작 화면 + 재개가 갈 자리

> **2026-10-03 다시 맞춤** — 대시보드 지난 대화 줄을 보던 구간은 걷었다(4dda594 에 그 덩어리가 빠졌다). 팔레트의 **밖에서 열린
> 대화** Enter 는 이제 그 대화의 기록 시트를 펴고, 시트의 [재개]가 한 번 묻는다(`openConversationById`).
> **알려진 앱 버그(남겨 둔 FAIL 둘)**: 팔레트 `Ctrl+Enter`(기록 보기) 뒤 포커스가 시트가 아니라 터미널에 남는다 —
> `revealPane`(app/tabs.svelte.ts)이 미뤄 둔 `requestAnimationFrame(() => focusPaneBody(id))` 가 시트가 받은 포커스를 빼앗는다.
> 그래서 이어지는 Escape 도 시트를 닫지 못한다.

`convo-harness.mjs` 스텁을 줄인 사본 (docs/log/2026-09-26-project-start-screen.md). 로컬 프로젝트 셋(aynx — 주 폴더
대화 7 · 워크트리 feat-y 대화 2 · 시작 명령 `npm run dev` / quiet — 대화 0 / infra — 시작 명령 없음) + 원격 하나,
`list_ai_clis` 는 Claude · Codex 설치됨.

```bash
npx vite --port 1436 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9252   --user-data-dir=%TEMP%/edge-aynx-pstart --window-size=1200,900 http://localhost:1436/
PAGE_PORT=1436 node scripts/dev/project-start-harness.mjs <outdir> 9252
# pstart.png · pstart-split.png · pstart-light.png
```

- 단언: 대화가 있으면 새 탭의 첫 타일 = 시작 화면(머리 · 브랜치 · S C X R · 5줄 + 더 보기 · 첫 줄 선택 · 바닥 줄 ·
  헤더 없음 · 키보드가 안에) · 호버는 단추만 옮긴다 · ↓ Enter · Shift+Enter · S(ㄴ) C X R · 단추 클릭 — 전부 같은 탭 ·
  같은 자리 · 제목 그대로 · Shift+S 무시 · 분할 안은 그 칸만 · 열림 줄 → 그 타일 · 대화 0 · 원격 → 곧장 · 재개가 갈
  자리 1–4(`openConversationById` — 대시보드·팔레트와 같은 함수) · 0 이 되어도 화면 유지 · 저장 짐에 주소만(제목 없음) ·
  설정 off · 예외 0.
- 숨은 탭의 시작 화면도 DOM 에 있다 — 단언은 **보이는 것**(`getClientRects().length > 0`)만 본다.

- 2026-09-27 부터 대화가 0 인 프로젝트(quiet)도 시작 화면이 선다 — ② 는 "그래도 시작 화면 · Enter = 기본 셸" 을 본다
  (docs/log/2026-09-27-folder-conversations.md).

## folder-convos-harness.mjs — 이 폴더의 지난 대화 (상태바 칸 · Ctrl+Shift+Y · ⋯) + 시작 화면이 늘 선다

`project-start-harness.mjs` 스텁의 사본 (docs/log/2026-09-27-folder-conversations.md). 로컬 프로젝트 둘(aynx — 주 폴더 대화 7 ·
워크트리 feat-y 대화 3 · 빈 워크트리 empty / quiet — 대화 0) + 원격 하나, 사용량 스캔에 한 대화의 토큰, `git_worktree_add`.

```bash
npx vite --port 1487 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9297   --user-data-dir=%TEMP%/edge-aynx-fconv --window-size=1200,900 http://localhost:1487/
PAGE_PORT=1487 node scripts/dev/folder-convos-harness.mjs <outdir> 9297
# fconv.png · fconv-split.png · fconv-empty.png · fconv-menu.png · pstart-empty.png
```

- 셸이 알려 준 폴더(OSC 7)는 바이트를 밀지 않고 `app/pane-cwd` 의 `noteReportedCwd` 로 심는다(파서는 blocks 판이 본다).
- 단언: 부팅에 목록을 읽지 않음 · 상태바 칸(배지 · 흐림 없음 · 말풍선 · `messages-square` 아이콘 · 포커스가 옮겨도 안 읽음) · `Ctrl+Shift+Y` → 팔레트 자리(칩 ·
  ⎇ · 첫 줄 · 줄 모양) · Tab · 거르기 · Enter = 같은 탭 옆 분할(방향 · 포커스 · 빛남) · 열림 → 그 타일 · Shift+Enter · Ctrl+Enter ·
  밖에서 열림 묻기 · ⋯ 메뉴(단축키 글자 · 아이콘) · 같은 키 토글 · 팔레트 줄 · 빈 상태 둘 · 0 이어도 흐림 없음 · 탭 폴백 · 모든 대화 · 시작 화면(대화 0 ·
  빈 워크트리 칩/단추 · 새 워크트리 · off) · 저장 짐에 제목 없음 · 예외 0.
- 프로젝트를 여는 길 자체를 보는 판(projects · launcher · palette · agent-board)은 `load_settings` 에 `start_screen = "off"` 를
  싣는다 — 시작 화면은 이 판과 project-start 판이 본다.

## remote-convos-harness.mjs — 원격 지난 대화 (원격 시작 화면 · SSH 타일의 Ctrl+Shift+Y · 대시보드 "어디서" · 원격 기록 보기)

> **2026-09-28** — 대시보드 "어디서"(지난 대화 덩어리) 구간은 낡았다: 그 덩어리가 빠졌다. 사용량 칸의 출처 칩 · 시작 화면 · 기록 보기 구간은 그대로다.

`folder-convos-harness.mjs` 스텁의 줄임판 (docs/log/2026-09-27-remote-conversations.md). 원격 프로젝트 aynx-lab(dev-01 · `~/work/aynx-lab` ·
시작 명령 claude · tmux 켬) + 로컬 하나, 서버의 대화 일곱. `agent_sessions_remote_list` 스텁은 처음(또는 `force`) 넷만 `complete=false`(4/7),
이어 부르면 일곱 — `window.__remote.{fail, delay}` 로 실패 · 늦음을 건다. `agent_session_remote_launch_spec` 은 줄의 폴더 · 명령.
2단계(2026-09-27): 호스트 lab-02 를 더 심고 세션 번호 → 별칭(`window.__sessAlias`)으로 lab-02 세션이면 그 서버의 두 줄을 준다.
`agent_conversation_transcript_remote`(최신 쪽 · 커서 4096 앞 쪽 · `window.__viewGone` 이면 `[session-gone]`) · `agent_usage_summary`(인자의
`local` · `hosts` 로 오늘 값과 `remote` 덮개 — `window.__cov`) · `agent_usage_remote_read`(두 번째에 끝 · 덮개를 비운다) · `agent_usage_remote_limits`(Codex 42%).

```bash
npx vite --port 1567 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9377   --user-data-dir=%TEMP%/edge-aynx-rconv --window-size=1200,900 http://localhost:1567/
PAGE_PORT=1567 node scripts/dev/remote-convos-harness.mjs <outdir> 9377
# rconv-start-offline.png · rconv-start.png · rconv-picker.png · rconv-split.png · rconv-viewer.png · rconv-dash.png · rconv-usage.png
```

- 단언: 붙은 세션이 없으면 원격 목록을 **부르지 않는다**(시작 화면 · 호스트 칩 · "새로 시작 — dev-01에서" · 셸 + AI 전부 + 시작 명령 · 조용한 한 줄) ·
  그 별칭에 SSH 타일이 붙으면 시작 화면이 스스로 읽는다(읽는 중 → 4/7 → 다 읽음 · 이어 부름 둘 · 칩 · `~` 를 서버 홈으로 · 밖에서 열림 ·
  Codex 토큰 · 바닥의 V) · 실패 한 줄(새로 시작 · 읽은 줄 그대로) · 시작 화면 Enter = 그 자리에 SSH 재개 타일(별칭 · 폴더 · 명령 · 프로젝트 tmux · MCP 토큰 없음) ·
  SSH 타일 `Ctrl+Shift+Y`(셸이 알려 준 폴더 · 칩 · 호스트 칩 · "방금 읽음 · F5" · Ctrl+Enter 안내 · 1분 캐시) · Tab · F5 = force(페이지 새로 고침 아님) ·
  Enter = 옆 SSH 타일(빛남) · 열림 → 그 타일 · Codex Shift+Enter = `codex fork` · **Ctrl+Enter = 원격 기록 보기**(호스트 칩 · 붙은 세션 번호로 부름 ·
  로컬 기록 경로 안 부름 · 이전 쪽 = 커서 · 세션이 사라지면 한 줄) · 로컬 타일은 원격 호출 없음 · 저장 짐에 `startProject.host` · 제목 없음 ·
  **대시보드 칩**(이 PC · dev-01 · 흐린 lab-02 "방금 읽음 · 연결 없음" · 모두 · 한 목록 · 호스트 칩 · 서버 폴더 · 끊긴 호스트는 부르지 않음 · 모두 = 9줄) ·
  **사용량 칸**(같은 선택 · 요약 인자 `local`/`hosts` · 호스트마다 덮개 한 줄 · 붙은 dev-01 만 [전체 사용량 읽기] · 읽는 중 [멈춤] · 붙은 세션으로 이어 부름 ·
  다 셈 · 호스트면 Codex 한도 카드와 한 줄 · 이 PC 로 돌아가면 원격 인자 없음) · 예외 0.
- 셸이 알려 준 폴더는 `noteReportedCwd` 로 심는다(OSC 7 바이트는 밀지 않는다).

## launcher-harness.mjs — 빈 탭 launcher (세 단 · 화살표 · 타자 → 팔레트)

`projects-harness.mjs` 의 사본 (docs/log/2026-09-25-launcher.md). 호스트 넷 · 이력 셋 · 프로젝트 셋 ·
셸 셋 · 즐겨찾기 하나를 심고, Aynx 를 AI 타일로 열어 **입력 대기**로 만든 뒤 새 탭의
launcher 를 본다. 마지막에 `sessionStorage` 표식으로 **빈 사용자** 판을 다시 싣는다.

```bash
npx vite --port 1434 --strictPort     # 다른 작업이 파일을 고치는 중이면 ui-scale 절의 no-HMR 설정
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-launcher --window-size=1100,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/launcher-harness.mjs <outdir> 9250
# launcher-dark.png · launcher-light.png · launcher-narrow.png · launcher-empty.png
# launcher-field.png · launcher-palette-open.png (검색 칸 → 팔레트가 그 자리에 펼쳐진다)
```

- 칸 → 팔레트 정렬(⑤-2): 판의 왼쪽·오른쪽·위와 검색 줄 위가 칸과 1px 안 — 클릭 · 글자 · 분할 안(셸 타일 옆에
  `openPaneHere(newStartPane())` — 시작 타일은 `splitActive` 로 안 나뉜다) · 125%(CDP 로 CSS 880×640 · dpr 1.25 —
  웹뷰 확대와 같은 좌표계 흉내). `Ctrl+Shift+P` 는 예전 자리(위 12vh · 가운데).

- **`performance.setResourceTimingBufferSize(5000)`** 를 주입 스크립트 첫머리에 둔다. 기본 버퍼(250)가 앱
  모듈 수보다 작아 늦게 올린 모듈은 `importApp` 이 `module not loaded yet` 으로 못 찾는다 — 다른 하네스의
  "첫 판은 한 번 더 돌린다" 증상의 일부가 이것일 수 있다.
- (2026-10-01 에 낡음 — 점은 훅 신호로만 선다, `agent-signal` 의 `waiting`+`permission` 을 쓸 것) 입력 대기는
  `agentOutput` → 3.6초 → `agentTitle`(projects ⑦ 과 같은 순서). 그 전에 `isAgentPane` 이 참이
  될 때까지 기다린다 — 첫 입력(`claude`)이 실려야 AI 타일로 읽힌다.
- no-HMR(`watch:null`) 서버는 파일을 고쳐도 **옛 변환을 계속 준다** — 고쳤으면 서버를 다시 띄운다
  (`npx` 셸만 죽이면 node 가 남아 포트를 쥔다 — 그 pid 를 따로 끈다).

## palette-harness.mjs — 명령 팔레트 (모양 · 키 힌트 · Ctrl+Enter · 설정 색인)

`launcher-harness.mjs` 의 사본 (docs/log/2026-09-25-palette.md). 호스트 넷(web-01 · web-02 · dev-01 ·
db-02) · 프로젝트 둘을 심고 `Ctrl+Shift+P` 로 연다.

```bash
npx vite --port 1434 --strictPort     # 다른 작업이 파일을 고치는 중이면 ui-scale 절의 no-HMR 설정
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9250   --user-data-dir=%TEMP%/edge-aynx-palette --window-size=1100,800 http://localhost:1434/
PAGE_PORT=1434 node scripts/dev/palette-harness.mjs <outdir> 9250
# palette-dark.png · palette-settings.png · palette-light.png
```

- 강조색 검사는 팔레트 안 **모든 요소**의 글자·바탕·테두리·`stroke`·`fill` 을 `var(--accent)`/`--accent-soft`
  의 계산값과 비교한다 — 고른 줄의 바탕 하나만 허용.
- 설정은 2026-10-02 부터 **모달**이다(1df6879 · docs/log/2026-10-02-settings-modal.md) — 떠 있는 동안 `anyModalOpen()`
  이라 전역 키가 통째로 쉰다. 그래서 스위치(체크박스) 위에서도 · 글자 칸(`#approval-ttl`, number)에서도 `Ctrl+Shift+P` 는
  팔레트를 열지 않는다(인쇄 대화상자는 캡처 단계의 `isBrowserChromeCombo` 가 막는다). 설정 위의 팔레트는
  `app/overlays.svelte.ts` 의 `openPalette` 로 연다. 터미널(xterm 숨은 textarea)에서는 여전히 열리는지 본다.
- 합자 스위치를 Space 로 켜고 끄면 터미널이 포커스를 가져간다(애드온 재장착) — 시나리오는 스위치에 다시
  포커스를 놓고 이어 간다.
- 차가운 서버의 첫 판은 500(의존성 재최적화)이나 `module not loaded yet` 으로 끝날 수 있다 — 한 번 더 돌린다.

## tile-header-reveal-harness.mjs — 타일 머리줄 버튼의 드러냄 (포커스 · 호버 · 키보드 · 터치)

`tile-enter-harness.mjs` 의 스텁 사본 (docs/log/2026-09-25-leftovers-surface-header.md). 새 셸 + 분할로
타일 둘을 세우고, 포커스 아닌 타일의 `⋯ 📁 ⤢ ×` 가 숨었다가(opacity 0 · pointer-events none) 드러나는
길 넷을 본다.

```bash
npx vite --port 1436 --strictPort     # 다른 작업이 파일을 고치는 중이면 ui-scale 절의 no-HMR 설정
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9260   --user-data-dir=%TEMP%/edge-aynx-reveal --window-size=1100,800 http://localhost:1436/
PAGE_PORT=1436 node scripts/dev/tile-header-reveal-harness.mjs <outdir> 9260
# reveal-rest.png · reveal-hover.png
```

- 호버는 **진짜 포인터**(`Input.dispatchMouseEvent`)다 — `:hover` 는 합성 이벤트로 켜지지 않는다. 포인터를 먼저
  탭 줄 빈 곳에 둔다(마지막 판의 포인터 자리가 남아 있으면 "숨는다" 가 거짓으로 깨진다).
- 드러나도 **이름 폭이 그대로**인지 잰다 — 자리는 늘 남아야 한다.
- 키보드는 숨은 `⋯` 에 `focus()` 를 걸어 본다. 숨김을 `visibility` 로 바꾸면 포커스 자체가 안 받아져 이 줄이 깨진다.
- 터치는 `Emulation.setEmulatedMedia` 의 `hover: none` 이다.
- 타일 코드 칩은 **✦(AI 읽기 허용) 타일에서만** 선다 — 포커스·호버·`hover: none` 이어도 아니면 빠진다. 코드는 이름
  말풍선(`.pane-name` 의 `title` 끝 ` · p<n>`)으로 확인한다 (2026-10-05).

## agent-banner-harness.mjs — 에이전트 알림 배너 (턴 끝 · 권한 물음)

`notify-center-harness.mjs` 의 스텁 사본 (docs/log/2026-09-27-agent-banners.md). AI 타일 다섯(탭마다 하나)과 빈 탭을
세우고 `agent-signal` 을 흉내 내 쌓기 · 합치기 · × · 저절로 해결 · [보기] + 타일 빛 · 탭 고르기로 해결 · 넘침 칩 ·
Escape · 10초 알약 · 호버 멈춤 · 창이 뒤일 때 OS + 배너 · 타일 닫힘 · 센터의 "확인할 것"/"지난 알림" · 배지 색을 본다.
⑬ 은 **보고 있는 타일도 긴 턴이면**(`[ai] notify_focused_after_secs` 를 1초로 낮춰) — 배너가 서고 방문으로 안 풀리며,
사람이 돌아올 때까지 안 접히고, 그 타일에 키·누름이면 풀리는지 · 짧은 턴 · 0 = 끔 · 다른 탭에 갔다 오면 풀리는지를 본다.
⑭ 는 **서브 에이전트**(docs/log/2026-10-04-subagent-signals.md) — `agent` 를 실은 `subagent-start`·`subagent-stop` 을 흉내 내
"Stop → 서브 2개 → 배너 없음 · 탭 점 실행 중 + 수 2 → 하나 끝 → 수 1 → 중복·모르는 id·id 없음은 그대로 → 마지막 끝 → 완료
배너 한 번 · 탭 점 완료 → 메인이 깨어나 다시 stop → 두 번째 배너 없음 → 새 턴의 stop 은 다시 알림" 을 본다
(PNG `agent-banners-subagents.png` — 수 2 인 순간).

```bash
npx vite --port 1437 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9247   --user-data-dir=%TEMP%/edge-aynx-banner --window-size=1200,800 http://localhost:1437/
PAGE_PORT=1437 node scripts/dev/agent-banner-harness.mjs <outdir> 9247
# agent-banners.png · agent-banners-pill.png · agent-banners-light.png   (접힘을 실제로 기다려 약 70초)
```

- 창 포커스는 `document.hasFocus` 스텁(`window.__focus`)에 **`focus`/`blur` 사건을 함께** 낸다 — 배너가 창 포커스를
  사건으로 따라간다(`windowFocused()` 는 반응형이 아니다).
- `performance.setResourceTimingBufferSize` 를 넉넉히 건다 — 기본 250 이면 늦게 올린 모듈을 `importApp` 이 못 찾는다.

## messenger-harness.mjs — 메신저 에이전트 알림의 몸통 (둘째 줄 · 대화 가리킴)

> 켜진 채널은 `["discord","slack"]` 이다 — 스텁의 `[messenger]` 에 `slack` 칸이 없으면 기본 켬(5a09c08). 등록 여부는 Rust 가 본다.

`agent-banner-harness.mjs` 의 스텁 사본 (docs/log/2026-09-27-discord-notify.md "둘째 줄"). `messenger_send` ·
`git_change_snapshot` 을 스텁으로 받아 **프런트가 넘기는 것**만 본다: 첫 줄의 프로젝트 · 워크트리 이름, 둘째 줄
(시간 · 도구 수 · 파일 수), 대화 가리킴 `{agent, id, event}`, 글자 칸에 대화 글자가 없음, 권한 물음·싣기 끔·메신저 끔·
프로젝트 밖 폴더. 진짜 전송과 대화 파일 읽기는 `cargo test`(`messenger::tests` · `agent_transcript::tests`).

```bash
npx vite --port 1557 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9367   --user-data-dir=%TEMP%/edge-aynx-messenger --window-size=1200,800 http://localhost:1557/
PAGE_PORT=1557 node scripts/dev/messenger-harness.mjs 9367
```

## new-shell-cwd-harness.mjs — 새로 여는 셸·AI 타일이 뜰 폴더

`folder-convos-harness.mjs` 스텁의 줄임판 (docs/log/2026-09-27-new-terminal-cwd.md). 셸 둘(pwsh · cmd) · AI CLI 하나 ·
로컬 프로젝트 aynx(`C:\src\proj`) · 원격 프로젝트 api, 설정 `[ai] start_dir = D:\ai-home` · `start_screen = "off"`.

```bash
npx vite --port 1517 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9327   --user-data-dir=%TEMP%/edge-aynx-newcwd --window-size=1200,900 http://localhost:1517/
PAGE_PORT=1517 node scripts/dev/new-shell-cwd-harness.mjs <outdir> 9327
# new-shell-cwd.png
```

- 보는 값은 하나 — 새로 나간 `open_local_session` 의 `cwd`(`null` = 홈).
- 셸의 폴더는 **진짜 OSC 9;9 바이트**를 그 세션의 채널로 밀어 알린다(`window.__feed` — blocks 판과 같은 모양). `app/pane-cwd` 의
  `noteReportedCwd` 로 심으면 반응형 사본만 바뀌고 여는 자리가 읽는 `paneCwd`(터미널 파서 값)는 모른다.
- 단언: 빈 탭 → 홈 · 셸이 알린 폴더(셸 · AI) · 모르는 셸 → 홈 / AI 는 설정 폴더 · 파일 타일 · 프로젝트 새 탭에 `projectFolder` ·
  안(대소문자·구분자 무시) / 밖으로 cd / 아직 모름 / SSH 포커스 / AI → 규칙대로 · `Ctrl+Shift+N` · `addLocal` · 원격 프로젝트 탭은
  폴더 없음(→ 홈) · 저장 짐 · 예외 0.

## dock-dots-harness.mjs — 독의 에이전트 점 (워크트리 · 접힌 프로젝트 · 호스트 · 접힌 폴더 · 독 입구)

`projects-harness.mjs` · `hosts-tree-harness.mjs` 스텁의 줄임판 (docs/log/2026-09-27-dock-agent-dots.md). 로컬 프로젝트 aynx(워크트리 main ·
feat-x · 주 저장소 안의 `.claude/worktrees/agent-1`) + 호스트 셋(dev-01 · lab-02 는 폴더 `lab`, nas 최상위). 타일은 앱 모듈
(`openInNewTab`)로 연다 — 홈에서 시작한 로컬 claude 하나, dev-01 의 SSH claude 하나.

```bash
npx vite --port 1587 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9397   --user-data-dir=%TEMP%/edge-aynx-dockdots --window-size=1200,900 http://localhost:1587/
PAGE_PORT=1587 node scripts/dev/dock-dots-harness.mjs <outdir> 9397
# dockdots-projects.png · dockdots-hosts.png · dockdots-entrance.png
```

- 셸의 폴더는 `app/pane-cwd` 의 `noteReportedCwd` 로 심는다(독은 반응형 사본만 읽는다), 상태는 `window.__emit('agent-signal', …)`.
- 단언: 폴더 밖 → 점 없음 · cd 로 주 폴더 안 → 접힌 프로젝트 점 + 말풍선 · 펼치면 워크트리 줄로 · cd 가 줄을 옮긴다 · 가장 깊은 줄만 ·
  접힌 말풍선 `<워크트리> — <에이전트> <상태>` · 점 클릭은 선택뿐 · 입구 점은 독이 닫혔고 입력 대기일 때만 · 접힌 폴더 lab · 펼치면
  dev-01 줄 · 로컬 타일은 호스트 줄에 없음 · 원격 대기 → 입구 말풍선 "호스트: …" · 예외 0.

## profile-switcher-harness.mjs — 테마 프로필 빠른 전환 (Ctrl+Shift+U · 위에서 내려오는 카드 줄)

`toast-harness.mjs` 의 스텁 사본 (docs/log/2026-09-28-profile-switcher.md). 프로필 넷(사진 둘 · 사진 없음 · 라이트)을
`load_theme_profiles` 로 주고, `wallpaper_resolve` 는 SVG 그라디언트 data URL 을 준다. **기본 포트가 vite 1430 · CDP 9231** 이다.

```bash
npx vite --port 1430 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9231   --user-data-dir=%TEMP%/edge-aynx-ps --window-size=1200,800 http://localhost:1430/
PAGE_PORT=1430 node scripts/dev/profile-switcher-harness.mjs <outdir> 9231
#   → switcher-dark.png · switcher-light.png · settings-cards.png · switcher-empty.png
```

- 키는 전부 **진짜 키**(`Input.dispatchKeyEvent`)로 스텁 셸 타일의 xterm 에 포커스를 둔 채 누른다 — 터미널이 전역 조합을
  삼키고 창이 실행하는 길 그대로다.
- 단언: 열리면 지금 쓰는 프로필이 골라짐 · 키보드는 listbox · 캔버스 위 가장자리 바로 아래 · 맨 글자가 셸로 새지 않음 ·
  → + Enter 가 다음 벌을 입힘(`save_settings` 의 월페이퍼 이름 · `save_theme_profiles` 의 `active`)·닫힘·포커스 터미널 ·
  End/Tab 돌아 나오기/Shift+Tab/Home/숫자 · Esc 는 저장 없음 · 같은 단축키 · 바깥 클릭 · 가림막이 닫음 · 카드 클릭으로
  라이트 벌 · reduce 면 애니메이션 없음 · 설정 카드(같은 얼굴 `ProfileCardFace`) 넷 · 빈 목록 한 줄 · 예외 0.
- 빈 목록 판은 `sessionStorage['ps-empty']` 를 켜고 새로 읽는다(주입 스크립트가 그 값을 본다).

## (공통) 포트 · 한 번에 모두 돌리기

- **돌리는 길은 `run-harness.mjs`(맨 위)** — 포트 고르기 · 새 Edge · 정리를 러너가 한다. 아래는 손으로 띄울 때의 규칙.
- 모든 하네스는 `PAGE_PORT`(vite · 기본은 파일마다 다르다)와 CDP 포트(둘째 인자 또는 `CDP_PORT`)를 받는다 — 예전에
  `localhost:1420`·`9224` 를 박아 두었던 판(blocks · connect-diag · keygen · passphrase · vault* · identities-only)도
  2026-09-27 에 `PAGE_PORT`·`CDP_PORT` 를 읽게 했다. 다른 작업과 겹치지 않게 **자기 포트 한 벌**로 돌린다.
- 판마다 **새 Edge(새 `--user-data-dir`)** 로 돌린다 — `localStorage`·주입 스크립트가 앞 판에서 넘어오지 않게.
- 차가운 vite 의 첫 판은 의존성 재최적화로 모듈 적재가 깨질 수 있다(2026-09-27 의 `agent-banner` 첫 판이 그랬다) —
  실패하면 한 번 더 돌린다.
- 단언이 없는 판(값만 찍는 것: keygen · passphrase · host-form-tabs · identities-only · vault* 등)은 출력의
  `(want …)` 표시와 이 문서의 기대 출력을 눈으로 맞춘다 — 종료 코드만으로는 모른다.

## (공통) 주입 스크립트 고치기

- 주입 스크립트는 `blocks-harness.mjs` 안 `script` 를 고쳐 바꾼다. `push_session_block` 호출 수는
  타일의 AI 공유가 켜져 있을 때만 는다(기본 꺼짐 — 프라이버시 게이트 확인용).

## ai-flip-harness.mjs — AI 타일 안에서 터미널 ⇄ 대화 넘기기 (단추 · 단축키 · 따라가기 · 입력 칸)

`ask-ai-harness.mjs` 의 스텁(가짜 로컬 세션 · `write_session`/`resize_session` 기록 · 훅 신호)에 `agent_conversation_transcript`
(창 안의 `window.__tx` 를 끝에서 거꾸로 쪽으로)를 더했다. AI 타일은 `newAiPane('claude')`, 타일 ↔ 대화는 훅 `start` 의 `session`.
셸 타일은 `openDefaultShell()` 을 곧장 부른다(헤드리스에서 시작 화면 위의 `Ctrl+Shift+N` 이 안 먹는 판이 있다 — ask-ai 도 같은 자리).

```bash
node scripts/dev/run-harness.mjs ai-flip-harness.mjs <outdir> --size 1280x860
# <outdir>/flip-unknown.png · flip-term.png · flip-mid.png(움직임 도중) · flip-convo.png · flip-follow.png · flip-sending.png · flip-back.png · flip-permission.png
```

시나리오: ① 셸 타일엔 단추 없음 · 단축키는 안내 ② AI 타일 단추 ③ 넘김 — 도중 두 층이 움직임 · 끝: 터미널 층 `display:block`
· 왼쪽 밖 · 포인터 없음 · xterm 폭 그대로 · `resize_session` 0 · 항목 · 코드 블록 [복사] · 키보드는 터미널 · 맨 아래 ④ 넘긴 동안
출력이 버퍼에 ⑤ 따라가기(맨 아래 = 따라감 · 올려 읽는 중 = 자리 지킴) ⑥ 글자 → 터미널로 · `write` 로 나감 · 타일 상자 안 밀림
⑦ ↓ 는 대화 면 스크롤 · Enter 삼킴 · 단축키 넘김(포커스 = 입력 칸 · 단추 이름 바뀜) · Escape 돌아옴(CLI 로 안 감) · 터미널 면이면 읽기 멈춤
⑧ IME(`imeSetComposition`) 조합이 입력 칸에서 · 조합 중 Enter 는 안 보냄 ⑨ 대화를 모르는 AI 타일 — 한 줄 ⑩ 콘솔 오류 0
⑪ 입력 칸 한 줄 Enter → `hello\r` · 보내는 중 말풍선 → 기록에 나타나면 걷힘 ⑫ Shift+Enter 여러 줄 → `ESC[200~ab\rcd ESC[201~\r`
⑬ 권한 대기(훅 `waiting`/`permission`) → "터미널에서 답하기 →" · 누르면 터미널. ⑭ 입력 칸 알약 모양(placeholder · 44px · 칸 안 둥근 보내기 단추) · 내 말 오른쪽 말풍선 ⑮ 실행 중 신호면 점 셋 · 끝의 결과 없는
도구에 스피너 · 머리줄 로딩 없음 · 끝나면 둘 다 없음(`flip-working.png`) ⑯ 훅 10판 `session` 신호로 연결 · 상태 그대로 ⑰ 새 id →
대화 면이 그 대화로 ⑱ F5 — `probe_session`/`attach_session` 스텁으로 재부착 · 연결이 타일 명세 사본으로 살아남음(`flip-after-f5.png`).
⑨ 는 이제 빈 면 + 입력 칸(문구 없음).

## block-view-harness.mjs — 명령 블록 리치 보기 카드 (블록 단추 · 커지기 · 형식 · 닫기)

`ask-ai-harness.mjs` 의 스텁(가짜 로컬 세션 + OSC 133 먹이기)이다. 셸 타일은 `openDefaultShell()` 을 곧장 부르고 그 탭으로 간다
(숨은 탭의 상자는 0 크기 — 카드 자리 · 움직임을 잴 수 없다).

```bash
node scripts/dev/run-harness.mjs block-view-harness.mjs <outdir> --size 1280x860
# <outdir>/bv-hover.png · bv-mid.png(커지는 도중) · bv-tree.png · bv-table.png · bv-raw.png · bv-short.png · bv-csv.png ·
#   bv-columns.png(docker ps 표) · bv-tsv-raw.png(탭 출력 = 원문)
```

시나리오: ① 출력이 있는 끝난 블록 줄에만 단추(출력 없는 블록 · 셸 통합 없는 타일엔 없다 · 실패 줄은 [AI에게 묻기] 와 한 묶음) ② 손을
올린 줄에만 보임 ③ 커지는 중간 프레임 scale 0.42–1 · transform-origin = 줄 가운데 · 끝은 안쪽 16px · 막 · 터미널 display 그대로 ·
포커스는 카드 ④ JSON 트리(기본 · 개수) → 표(열 합집합 · 머리 두 번 = 내림차순) → 원문 ⑤ Esc → 줄어드는 표본 · DOM 정리 · 터미널로
포커스 ⑥ 막 누르기 · × ⑦ 짧은 출력 = 줄 바로 아래 작은 카드 · 투명 막 ⑧ CSV → 표 ⑧' 줄 맞춘 표 — 바이트를 xterm 에 먹여
버퍼에서 읽은 글로: `docker ps`(값 안 공백 · `CONTAINER ID` 한 열 · 빈 PORTS) · 첫 열이 한글인 PowerShell 표(2칸 폭) → 표, 진짜 탭으로
보낸 ``ConvertTo-Csv -Delimiter "`t"`` 출력 → 원문(버퍼에서 탭은 공백 — TSV 판정은 없다) ⑨ 콘솔 오류 0. `ask-ai-harness` 는 단추가
`.aynx-row-acts` 묶음 안으로 들어가 줄 · 표시 판정을 `closest(...)` 로 고쳤다.

## ask-ai-harness.mjs — 명령 블록을 AI 타일에 넘기기 (실패 줄 단추 · 우클릭 · Ctrl+Shift+X)

`blocks-harness.mjs` 의 스텁에 `write_session` 기록(`window.__writes`) · `agent-signal` 방송(`window.__emit`) · AI CLI
감지(`list_ai_clis` · `mcp_status`)를 더했다 (docs/log/2026-09-28-ask-ai-block.md). AI 타일은 `newAiPane`(autorun) 으로
열고, "CLI 가 떴다" 는 그 세션에 A·B·C 를 먹여, 괄호 붙여넣기는 `ESC[?2004h`, 답 쓰는 중은 훅 `start` 로 세운다.
새 타일의 **붙여 넣기 준비**는 괄호 붙여넣기 + CLI 가 그린 뒤 3초 조용함(`ASK_QUIET_MS` · 90fb2e1 — 훅 `stop` 은 보지
않는다)이라, 하네스는 `C` 와 TUI 그림을 **650ms 떨어진 두 덩어리**로 먹이고(출력 시각은 500ms 스로틀) 붙을 때까지 본다.
`Runtime.enable` 이 되풀이하는 첫 적재(스텁 없음)의 콘솔 오류는 세지 않는다. FAIL 이 있으면 종료 코드 1. 실패 줄 단추는 DOM 렌더러에서만 잡히므로 `load_settings` 가 `webgl: false` 를 준다(시간 표식을 같은
줄에 세우려고 `mark_after_secs: 1`).

```bash
npx vite --port 1444 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9277 \
  --user-data-dir=%TEMP%/edge-aynx-askai --window-size=1280,860 http://localhost:1444/
PAGE_PORT=1444 node scripts/dev/ask-ai-harness.mjs <outdir> 9277
# <outdir>/ask-ai-hover.png · -picker-empty · -new-tile · -direct · -picker-many · -menu  (20초 시한 때문에 ~50초)
```

시나리오: ① 블록 없는 타일(단축키 → 안내 · 메뉴 줄 없음) · ② 실패 줄에만 단추 · 호버 → 보임 · 같은 줄 시간 표식 가림 ·
누르는 동안 터미널 포커스 유지 · ③ AI 타일 없음 → 상자(새로 열기 둘 · 기본 · 공유 꺼짐 한 줄) · 단추 아래 오른쪽 맞춤 ·
Esc → 닫고 원본으로 포커스 · ④ 새 타일 20초 시한(넣지 않고 알림 · 공유 꺼짐 말은 세션에 한 번) · ⑤ 새 타일 오른쪽에
열고 준비 뒤 한 번 붙여 넣기(괄호 · Enter 없음 · 포커스 · 빛) · ⑥ 이 탭에 하나 → 단축키로 곧장(마지막 블록 · 40줄 ·
"(앞 60줄 생략)") · ⑦ 괄호 붙여넣기 꺼진 타일 → 넣지 않음 · ⑧ 여럿 → 줄 순서 · 마지막에 씀 · 답 쓰는 중 · ↑↓ ·
⑨ 다른 탭 줄 → 탭 전환 · ⑩ 우클릭(성공 블록 · 중립 문장 · 메뉴 통로) · ⑪ 콘솔 오류 0. 끝에 `ALL OK`.

스크롤백 위의 블록은 화면에 그려져야 데코(단추)가 DOM 에 생긴다 — 하네스는 명령 점프(`commandsOf(id).jump(-1)`)로
맨 위 프롬프트까지 올린다(가상 스크롤이라 `scrollTop` 대입은 되돌아간다).

## branch-graph-harness.mjs — 브랜치 그래프 타일(`kind:"branches"`)

`dock-dots-harness.mjs` 스텁의 사본 (docs/log/2026-09-29-branch-graph.md). 그래프 · 바뀐 파일 답을 스텁으로 심고, 독 배지 클릭 ·
워크트리 줄 우클릭 · 팔레트 · 목록 ↑↓ · Enter · 접기 줄 펴기 · 파일 → 문서 타일 · 턴 끝 "새 변경 있음" · 원격 세션 없음을 몬다.

```bash
npx vite --port 1591 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9401 \
  --user-data-dir=%TEMP%/edge-aynx-branches --window-size=1400,900 http://localhost:1591/
PAGE_PORT=1591 node scripts/dev/branch-graph-harness.mjs outdir 9401   # branches-{dark,light,folds,narrow}.png
```

파일 줄을 그냥 누르면 diff 타일이 열린다(2026-10-05) — 문서 타일 단언은 **Ctrl+클릭**으로 한다.

## diff-tile-harness.mjs — diff 타일(`kind:"diff"`)

`branch-graph-harness.mjs` 스텁의 사본 (docs/log/2026-10-05-diff-tile.md). `git_diff_files` · `git_diff_file` 를 범위 · 경로마다
스텁으로 답하고, 독 "변경 보기" · 범위 단추 · 커밋 고르개 · 나란히(폭 1400/1000) · 좁은 모드(700 — 드롭다운 · `[` `]`) ·
5천 줄 · 이진 · 잘림 · 병합 커밋 · 그래프 입구(파일 · Ctrl+클릭 · ✎) · 원격 세션 없음을 몬다. 2단계: 가짜 로컬 세션의 AI 타일 둘
(`ESC[?2004h`)을 세워 줄 고르기 · `C` · 코멘트 · 받을 곳 · Ctrl+Shift+X 쓰기(괄호 붙여넣기 한 번 · Enter 없음) · [복사] 를 본다
(`diff-comments.png` · `diff-comments-split.png`).

```bash
node scripts/dev/run-harness.mjs diff-tile-harness.mjs <outdir> --size 1400x900   # diff-{dark,light,split,narrow}.png
```

## logos-icons-harness.mjs — logos 전체 아이콘 (늦게 받는 표 · 고르개 검색 · 저장 뒤 독 줄)

`hosts-tree-harness.mjs` 의 사본 (docs/log/2026-09-29-logos-full-icons.md). 이미 `svg:logos:mariadb-icon`
을 쓰는 호스트가 독에 있어 표(JSON 한 벌)를 **한 번** 받아 로고로 서는지, lab-01 편집 폼의 아이콘 칸이
빈 칸 = 큐레이션 34 · `mongodb` = logos 두 칸(정사각 표장이 첫 칸) · `a` = 200칸 + "N개 더" 인지,
저장이 `svg:logos:mongodb-icon` 을 싣고 독 줄이 그 로고로 서는지 본다. ⑥은 **lucide("기본" 칸)** — 색
`#e5484d` 인 nas-01 폼에서 [로고/기본] 스위치 · "기본에서 N개" 한 줄(이모지로 안 떨어짐) · 빈 칸 24 ·
`database` → `svg:lucide:database` · 미리보기와 독 줄의 획이 호스트 색(굵기 1.75) · 칸 기억.

```bash
npx vite --port 1430 --strictPort
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-logos --window-size=1100,800 http://localhost:1430/
PAGE_PORT=1430 node scripts/dev/logos-icons-harness.mjs outdir 9231
# logos-dock.png · logos-search.png · logos-more.png · logos-saved.png · lucide-featured.png · lucide-dock.png
```

- 표 요청은 **`?` 없는 주소만** 센다 — 개발 서버에서는 `?url` 가져오기(주소 한 줄짜리 모듈)도 같은
  파일 이름으로 네트워크 기록에 뜬다.
- 스텁의 `edit_host` 가 빠지면 제출이 `stub: edit_host` 로 멈추고 `set_host_meta` 까지 가지 않는다.

## rust-module-scc.mjs — Rust 모듈 의존 순환(SCC) 측정

`node scripts/dev/rust-module-scc.mjs [--edges]` — `src-tauri/src` 의 `crate::<모듈>` 간선(주석·`#[cfg(test)] mod` 제외)으로 가장 큰 강결합 요소의 크기와 구성원을 찍는다(층 나누기 리팩터의 진척 잣대).

## 워크스페이스 v2 스텁 (2026-10-02)

공용 주입 문자열은 `workspace-stub.mjs::WORKSPACE_STUB`다. `workspaces_load`는 v2, `workspaces_claim_writer`는 generation, `workspaces_apply`는 scope별 저장 변경/metadata/호스트 별칭 변경을 흉내 낸다. 개별 판은 `window.__workspaceSeed`로 초기 파일을 지정한다. `convo-harness`는 v2 파일을 sessionStorage에 보관해 다시 뜬 복원을 본다.

`workspaces-harness`는 별도 v2 스텁으로 프로젝트 소속/이동·aux·삭제를 검사한다. 세로 도구 → 구분선 → 워크스페이스 목록(제 스크롤·추가 버튼), 가로에서는 현재 칩 없이 이름과 함께 나열된 목록(현재 표시 · 고른 아이콘 색)을 단언한다. STEP 6 구현에서는 하네스를 실행하지 않았으며 실행 게이트는 외부에서 돌린다.

## orch-tab-harness.mjs — 오케스트레이션 탭(앨범 먼저 · 프로듀서 채팅)

```powershell
node scripts/dev/run-harness.mjs orch-tab-harness.mjs <outdir> --size 1400x900
$env:ORCH_ONLY = "v3-all"; node scripts/dev/run-harness.mjs orch-tab-harness.mjs <outdir> --size 1400x900
$env:ORCH_ONLY = "v3-track"; node scripts/dev/run-harness.mjs orch-tab-harness.mjs <outdir> --size 1400x900
Remove-Item Env:ORCH_ONLY  # 다음 기본 전체 실행 전에 선택 해제
```

**기본 실행(`ORCH_ONLY` 없음) = 남은 옛 묶음 + v3 16개 전부.** `v3-all`은 v3만, `v3-…`는 해당 시나리오만 실행한다.
모델 호출 · 개발 앱 없이 격리 vite + 헤드리스 Edge + Tauri 메모리 스텁으로 실제 Svelte 화면을 검사한다(앱의 1420에 연결하지 않는다).
설계 [앨범 먼저](../../docs/log/2026-10-30-orchestration-album-first.md) 5절 · 12절. 하네스 실행에는 Edge가 필요하다.

| 선택 | 검사 |
| --- | --- |
| 기본의 이어진 옛 묶음 | 탭 틀 · 초안→사람 시작→같은 탭 앨범 · CLI 창/PTY 쓰기 없음 · 탭 닫기는 구독만/다시 열면 같은 채팅 · 앨범 판/상태/사람 관문 · 로고/막대/좁은 폭 · fork/이관 |
| `producer` | ⑪ 프로듀서 응답/도구/대기열/끊기/권한/거절/종료/resume/좁은 폭 + ⑫ 깨움. **현재 코드에 남은 선택 옵션**이다 |
| `wake` · `fixb` · `remote` · `db` | 각각 ⑫ 깨움 · ⑬/⑭ 실기 회귀 · ⑮ 원격 구독/폰 폭 · DB 연결 폼 설명 |
| `v3-library` · `v3-artists` · `v3-nav-esc` | 라이브러리 상태×저장소 필터/아티스트 열 · 프로필 편집/종류 잠금/삭제 거절 · 경로/빵부스러기/←/Esc 제외/새 탭/옛 표지 폐기 |
| `v3-new-album` · `v3-new-album-fail` | 초안 기본값/구성/위험/이름 · 첫 말 시작 · 오류/글 보존/멱등 재시도/sent:false 복원 |
| `v3-fork` · `v3-adopt` · `v3-new-remote-reauth` | probe→잠긴 초안→fork 시작 · 사람 adopt 귀속/입력 채우기만 · 원격 시작 REAUTH/취소/거울 불변 |
| `v3-album-perm` · `v3-album-perm-remote` | next 허용 칸/고정 검증·한도 · 넓힘/좁힘/위험/rev 충돌 · 원격 넓힘 재확인/좁힘 표 없음 |
| `v3-producer-lives` · `v3-producer-end` | 탭 닫기/경로 이동 뒤 생존/같은 채팅 재부착 · 명시 끝내기 확인/조율 멈춤 |
| `v3-track` · `v3-track-judge` · `v3-track-blocked` · `v3-track-verify-ask` | 트랙 경로/시도 선택/가사/파일/기록/diff/중단 · 판정/사람 관문 · 막힘/권한/사람 필요 종 · 검증 확인 고정/후보 교체 무효화 |

옛 설정 묶음과 `settings` · `wake-o6` · `logo-settings` 선택은 제거됐다. `stage1` 복원 검사도 없다.
AI 시작 · 보드 자동 배치 · 닫기 확인 · 줄 아래 펼침/별도 작업자 상세 검사는 현재 경로/수명/트랙 시나리오로 대체했다.
초안에는 서버 채팅이 없고 `producer_album_start`가 Run/귀속/첫 말을 만든다. 스텁 `window.__pc` · `window.__pcEmit`은 채팅별 Channel/subGen을 쓰며,
재구독 때 Channel 전송 index는 0부터, 채팅 사건 seq는 계속된다. 원격 시나리오는 `finally`에서 표식을 지우고 reload 뒤 로컬 복귀를 확인한다.
스크린샷은 `orch-*.png` · `album-*.png` · `producer-*.png` · `v3-*.png` · `polish-*.png` 등이다. 기하는 탭 슬라이드 종료 뒤 두 프레임을 지나 한 번 판정한다.

## dock-unified-harness.mjs — 통합 독 (상태바 알림 배지 · 아이콘 줄 · 실행 단추 3×2 · 칸 카드 · 가장자리 호버 · 하단 즐겨찾기 독)

`node scripts/dev/run-harness.mjs dock-unified-harness.mjs <outdir>` (2026-10-18 — 걷힌 `floating-status-harness` · `shell-menu-harness` ·
`notify-center-harness` · `status-chips-harness` 의 자리)

백엔드를 스텁한 실제 Svelte 화면에서 CDP 포인터와 키보드로 검증한다. 옛 저장 순서(걷힌 칸 id 가 든 `aynx:status-order`)를 심고 띄워
상태바에 칸이 하나도 없는지(독 입구도 걷힘), 셸 메뉴 · 알림 팝오버 · 설정 글리프가 없는지, 즐겨찾기가 비면 하단 독이 숨는지 본다. 즐겨찾기를 하나 더하면 아래 가운데 호버로 올라오고 즐겨찾기 칸만 담는지도 본다(10-18 실기 뒤). 가장자리 호버: 창 끝 16px 고정 띠(상태바 자리 · 모양 무관 — 창 끝 10px 은 열고 20px 은 아님 · 측정용 상자 없음) · 250ms 전에는 안 열림 · 머물면 알림 칸 · 커서를 떼도 안 닫힘 · Esc 뒤 띠에 머물면 다시 안 열림 ·
벗어났다 들어오면 열림 · 바깥 누르기로 닫힘 · 단추를 누른 채로는 안 열리고 놓고 머물면 열림. 독: 아이콘 줄 넷(글자 없음 · 오른쪽 위) ·
실행 단추(기본 셸 이름 · 정사각형) · 칸 넷 · 고른 칸 = 2px 밑줄만 · 칸 높이 · 알림 바닥 줄. 알림 배지(칸 · 상태바 — 종 글리프 없음) ·
[모두 읽음](끝남만 · 권한 물음은 남음) · 배지로 여닫기. ▾ 펼침(셸 전부 · 한 번에 하나 · AI ▾ 두 줄 · 첫 Esc 는 펼침만) · 셸 줄로 한 번만
열기(기본 셸 안 바뀜) · 기본 셸 칸. 칸 클릭 · ←/→ · Ctrl+Shift+H · 세션 요약 줄 → 세션 목록 · 설정 단추 → 설정 모달. 상태바 자리
(왼쪽 panel/flat · 위 · 아래 panel · 오른쪽 panel)마다 띠 자리 · 호버로 열기 · 독 쪽. 라이트/다크 캡처 한 장씩. 함께 도는 판:
`browser-shortcuts-checks` · `tooltip-checks` · `color-theme-checks`(이 셋의 실패 중 색 테마 두 줄 · 툴팁 키보드 포커스 한 줄은 10-18
기준 base 에서도 실패하던 것이다).

## survival/ — 생존·재부착 보장 표(설계 10절)를 행 하나씩 시험한다 (실제 개발 앱 · CDP 9222)

```bash
npx vite --port 1420 --strictPort                 # 먼저 — 하네스는 vite 를 띄우지 않는다
node scripts/dev/survival/run.mjs <행> [--repeat N] [--tiles N] [--case …] [--verbose] [--cdp 9222] [--exe <개발 exe>]
SURVIVAL_SSH_TMUX=<tmux 호스트 별칭> SURVIVAL_SSH_PLAIN=<일반 호스트 별칭> node scripts/dev/survival/run.mjs ssh-drop
```

- 대상은 **이 저장소의 개발 GUI**(`src-tauri/target/debug/aynx.exe` — `--exe`)뿐이다. GUI·서버 pid 는 실행 파일 경로(서버는
  `%APPDATA%\aynx-dev\server-bin\…` 그림자 사본)로 가린다 — 설치본(`Program Files`)·다른 워크트리 앱은 건드리지 않는다. GUI 가
  떠 있지 않으면 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 로 하네스가 띄운다(`tauri dev` 아래가 아니라
  exe 직접 — GUI kill·재실행 행이 `tauri dev` 를 끝내지 않게). **서버 코드를 고쳤으면** 서버가 옛 그림자에서 돌고 있으니 [다시 시작]
  (`session_server_restart`)으로 새 서버를 띄운 뒤 잰다(판이 같으면 GUI 는 옛 서버를 그대로 쓴다).
- 결과는 **JSON 한 줄**(`verdict`: `pass`·`fail`·`n/a` + 측정값). 끝나면 하네스 Edge(이 하네스는 하나도 띄우지 않는다)와 고아 셸(개발
  셸 통합 스크립트를 명령줄에 품은 부모 없는 셸)을 세고 0 이 아니면 `fail`. 실패·예외로 빠져도 연 탭은 닫는다(타일 닫기 = 세션 종료).
- 공통 부품(`lib.mjs`): 번호 루프 셸(로컬 pwsh `1..N | % { "n=$_" … }` 자체 종료 · 원격 bash `for`) · 화면 직렬화(`tear.snapshotPane`)의
  번호 연속 검사(누락·중복) · 셸 pid 비교 · 서버 핸들·작업 집합(`Get-Process`) · 볼트 가림막 걷기(`unveil` — 마스터 없는 볼트만,
  마스터면 `SURVIVAL_VAULT_MASTER`). 페이지 도우미는 `window.__sv`(vite 경로 import — 앱과 같은 모듈 인스턴스).

| 행 | 하는 일 · 판정 |
| --- | --- |
| `f5` | 번호 루프 중 `Page.reload` × N → 번호 누락·중복 0 · 셸 pid 그대로 · 서버 핸들 ±16 |
| `webview-crash` | 이 GUI 의 `msedgewebview2 --type=renderer` kill → 앱이 다시 읽고(`webview_crash.rs`) 다시 붙는다(체크포인트+링) |
| `gui-close` | `CloseMainWindow`(사람의 X) → 트레이 · 셸·서버 그대로 → 재실행(single-instance 가 주 창을 연다) → 연속 |
| `gui-kill` | `Stop-Process` GUI → 셸·서버 그대로 → 재실행 → 연속 · 핸들 ±16 |
| `gui-relaunch` | `--tiles 16`(≤2s) · `--tiles 64`(≤5s): 재실행 → 마지막 타일이 **새 번호**를 그릴 때까지(`liveMs`) · 갈래 `phases` |
| `server-shutdown` · `server-kill` | [다시 시작] · 서버 TerminateProcess → 옛 셸 0 · "세션 서버가 멈췄습니다" ≤2s · Enter 로 새 셸 · autorun 재실행 0 |
| `stale-lease` | F5 뒤 옛 임대로 write·resize → `[stale-lease]` · 옛 ACK 무해 · 붙은 세션에 둘째 attach 거절(출력은 계속 흐른다) |
| `race` | `session-server` 10개 동시 × 10 → 서버 1 · GUI 3개 동시 × 3 → GUI 1·서버 1·페이지 섬(개발 앱 세션은 끝난다) |
| `memory` | 떨어진 세션 64개(링 가득) → 서버 작업 집합 증가 ≤ Σ(링 256 KiB + 체크포인트) |
| `vault-zero` | 시험 HTTP MCP 서버 + 볼트 헤더 → 프록시 URL 200 → GUI kill 503(티켓 정지) → 재실행·해제 뒤 같은 URL 200. 스스로 치운다 |
| `ssh-drop` | 원격에서 이 연결의 sshd `kill -9` → 끊김 표시 · Enter 재접속 · tmux 호스트는 루프가 이어진다. 방화벽·절전은 손 절차(`ssh.mjs` 머리말) |
| `boundary` | `--case c1a,c1b,c2,c3,c4,c5`(기본 전부): 링 경계 깨진 글자 · 체크포인트 오프셋 · 대체 화면(vim) · resize 중 재부착(대조군 포함) · 재생 억제(OSC 9/52·BEL·DSR) · 유실 바이트 = 배너 |

실측 기록은 노트 저장소 `docs/verification/2026-10-10-survival-matrix.md`.

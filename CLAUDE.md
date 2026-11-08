# AYNX

*A Hyprland-style workspace for AI coding agents.* — **Hyprland 감성의 AI 코딩 에이전트 작업 공간.
Claude Code · Codex 를 셸 · SSH 세션 · 파일 · DB 와 나란히 타일로 띄우는 데스크톱 앱.**

Tauri 2 + Svelte 5 로 만든 **개인용 AI 코딩 에이전트 작업 공간**(Windows 11 / WebView2).
터미널 에뮬레이션은 xterm.js 에 맡기고, 세션 수명·다중 세션 UI 는 Rust 가 쥔다.
지금은 **Windows 11 만 지원**하고 **Linux · macOS 지원은 미정**이다(나중에 지원할 수 있어 아래 규칙은 유지한다 — 2026-11-05 사용자 결정) — OS 를 타는
코드는 **Rust 함수 하나** 안에 모아 `#[cfg(...)]` 로 몸통만 가르고, 아직 구현하지 않은 OS 는
**명시적 `None` 스텁**으로 남긴다(그 스텁이 곧 문서다). 프런트는 OS 를 알면 안 된다 —
표준 프로토콜이 먼저이고 OS 조회는 폴백이다 (`src-tauri/src/cwd.rs` 가 본보기).

세부 규칙과 사건 기록은 아래로 링크만 한다 — **여기에 다시 적지 않는다.**
- [docs/conventions.md](docs/conventions.md) — **두 번 이상 깨진** 코드 규칙만 모은 곳.
- [docs/log/](docs/log/) — 일자별 사건 기록. 각 함정의 "왜" 는 여기 있다.
- [docs/internal/next.md](docs/internal/next.md) — **지금 상태와 다음 작업 순서**(living). 세션을 이어받을 때 먼저 본다.
- [scripts/dev/README.md](scripts/dev/README.md) — CDP 로 앱을 조작·캡처하는 검증 도구.

`docs/log/` · `docs/internal/` · `docs/verification/` · `scripts/lab/` 은 **비공개 노트 저장소(있을 때)**
`aynx-notes` 로 가는 정션이다(노트 저장소의 `tools/link-notes.ps1` 이 건다). 공개 저장소만 받았다면 이 링크들은
열리지 않는다 — 규칙 자체는 이 파일과 `docs/conventions.md` 에 있다.

비공개 작업 지시(노트 저장소에 있을 때만 불러와진다 — 파일이 없으면 Claude Code 가 이 줄을 무시한다):

@docs/internal/CLAUDE.private.md

## 커밋 전 게이트 (필수)

프런트를 건드렸으면 다섯 다 통과해야 커밋한다:

```
npm run check && npm run build && npm test && npm run check:cycles && npm run check:bundle
```

`check:bundle` 은 방금 만든 릴리스 번들(`build/`)에서 **선언 없는 대입**(strict ESM 에서 ReferenceError)을
찾는다 — 그래서 `build` 뒤에 둔다 → [docs/log/2026-10-14-vi-freeze-decrqm.md](docs/log/2026-10-14-vi-freeze-decrqm.md).

Rust(`src-tauri/`)를 건드렸으면 추가로:

```
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

함정 둘:
- `cargo test` 출력을 파이프(`| head` 등)로 받으면 **SIGPIPE** 로 죽는다 — 출력은 **파일로** 받아라.
- `tauri dev` 가 도는 중 `npm run build` 는 페이지를 리로드시킨다. `vite.config` 의
  `server.watch.ignored` 가 이미 회피한다(그 목록을 건드리지 말 것).

게이트에 `npm test` 를 넣은 이유·설정은 [docs/conventions.md](docs/conventions.md) 참고.
(문서 전용 변경이면 `npm run check` 한 번으로 충분하다.)

릴리스 빌드: `npm run tauri build` → `src-tauri/target/release/bundle/{nsis,msi}/` (무서명 ·
NSIS 는 현재 사용자 설치). 상세는 [docs/log/2026-09-07-release-build.md](docs/log/2026-09-07-release-build.md).

## 작업 방식

**재발을 실제로 보기 전에는 방어 기계(자가 회복 등)를 미리 늘리지 않는다** — 최소 수정 우선.
(ConPTY 건에서 확인된 원칙: 진단 카운터만 두고 되돌린 자가 회복은
[docs/log/2026-09-05-silent-session-selfheal.md](docs/log/2026-09-05-silent-session-selfheal.md).)

## 핵심 함정 (한 줄 + 링크)

- **GUI 는 한 개** — single-instance 플러그인이 둘째 실행을 첫 창 포커스로 돌리고 끝낸다(identifier 로 개발/릴리스 구분 —
  **다른 워크트리의 개발 앱 둘은 동시에 못 뜬다**). `mcp::start` 는 setup 에서라 둘째 실행이 `mcp.json` 을 덮지 않는다. 둘째 실행은 플러그인 앞의
  문(`single_instance_gate.rs`)을 지나고 플러그인 콜백은 메인 스레드 밖에서 미룬다(부팅 중 WM_COPYDATA 교착 — ④ 경쟁 실측).
- **세션 서버는 진입 첫 줄에서 물려받은 "Ctrl+C 무시" 를 걷고(`server/os.rs::enable_ctrl_c_for_children`), `CREATE_NEW_PROCESS_GROUP` 으로
  띄우지 않는다.** 그 속성은 콘솔이 없어도 ConPTY 셸까지 상속돼 키보드 Ctrl+C 가 셸을 못 끊는다(개발 앱은 npm→cargo 사슬에서 이미 그렇다 —
  진단은 PEB ConsoleFlags bit0) → [docs/log/2026-10-10-ctrl-c-inherit.md](docs/log/2026-10-10-ctrl-c-inherit.md).
- **웹뷰 렌더러가 죽으면 앱이 페이지를 다시 읽는다**(`webview_crash.rs` — F5 와 같은 재부착, 60초에 3회면 크래시 고리로 보고 멈춤).
  생존·복구 보장은 `scripts/dev/survival/run.mjs <행>` 하네스가 행마다 판정한다(실측 docs/verification/2026-10-10-survival-matrix.md).
- **번들 문법 수준은 `build-target.js` 하나(es2021)** — 기본 es2020 이면 esbuild 압축이 xterm `requestMode` 의 `let` 을 떨어뜨려 vim(DECRQM) 에 릴리스 타일만 영영 멈춘다 → [docs/log/2026-10-14-vi-freeze-decrqm.md](docs/log/2026-10-14-vi-freeze-decrqm.md).
- **개발 빌드는 릴리스와 따로 산다** — `npm run tauri dev`(디버그 빌드)는 `%APPDATA%\aynx-dev` ·
  `~/.aynx-dev` · WebView2 `io.github.lzyxion.aynx-dev` · MCP 서버 이름 `aynx-sessions-dev`(릴리스 `aynx-sessions`) 를 쓴다(스위치는
  `cfg!(debug_assertions)` 하나, 결정은 `src-tauri/src/instance.rs` 한 곳 — 앱 소유 경로는 전부
  `instance::{config,data,home}_root` 를 거친다). 개발 폴더가 처음 뜰 때 릴리스의 비밀이 아닌 설정을 한 번
  복사한다(볼트·토큰 제외, 다시 받으려면 폴더를 지운다) →
  [docs/log/2026-09-26-dev-release-isolation.md](docs/log/2026-09-26-dev-release-isolation.md).
- **Tauri 명령은 기본 `async fn`.** 동기 명령이 UI 스레드를 오래 잡으면, 관계없는 **살아 있는
  다른 세션의 출력이 영구히 침묵**한다. 동기는 예외이고 근거 주석이 붙는다 →
  [docs/conventions.md](docs/conventions.md) 의 "Tauri 명령은 기본 async fn" 절.
- **로컬 PTY 생성은 `SPAWN_LOCK` 으로 직렬화.** Windows ConPTY 동시 생성 경쟁(자식이 파이프
  핸들을 교차 상속 → 출력 파이프 사망, 빈 검은 타일) →
  [docs/log/2026-09-05-conpty-spawn-race.md](docs/log/2026-09-05-conpty-spawn-race.md).
- **메뉴 항목은 menu-runner 통로 하나를 거친다** (`src/lib/browser/menu-runner.ts` 의
  `runOnMenu`): 스냅샷 → 닫기 → 실행. 순서를 뒤집으면 항목이 조용히 죽고 화면엔 흔적이 없다 —
  **항목을 추가했으면 콘솔을 한 번 열고 눌러 본다** →
  [docs/conventions.md](docs/conventions.md) 의 "메뉴를 닫는 코드" 절.
- **키바인딩(`src/lib/keybindings.ts`):** 조합 문자열은 `ev.code`(물리 키, IME 안전)로만
  만들고 수식 순서는 `Ctrl → Alt → Shift` 고정. 전역 타일·창 조작은 대개 **`Ctrl+Shift` 계열**,
  타일 간 포커스는 `Alt+화살표`·이동은 `Alt+Shift+화살표`·확장은 `Ctrl+Alt+화살표`,
  독 칸 여닫기는 `Ctrl+Shift+H · J · K` = 호스트 · 프로젝트 · DB(id `open-*-dock`).
  **`Ctrl+Alt+화살표` = 타일 크기 조절**(분할선 밀기 · 이동과 함께 Hyprland dwindle 과 같다 — 2026-11-05 · 키는 2026-11-02 사용자 결정 — 예전 `Ctrl+Shift+화살표` 는 셸 · 글 칸의 낱말 고르기라 돌려줬다 ·
  인텔 드라이버 회전 핫키가 켜진 PC 에서는 OS 가 선점하니 설정에서 다시 묶는다). 점프(`Ctrl+↑/↓`)는 그대로. Meta(⊞) 는 v1 에서 무시. id 는 `settings.toml` 키라 **바꾸면 안 된다**
  (라벨만 바꾼다). 검색은 `Ctrl+F`(이 터미널)·`Ctrl+Shift+F`(전체) — 앱이 가로채므로 셸의
  readline·vim 의 `Ctrl+F` 에 닿지 않는다(알고 한 선택, 설정에서 되돌린다). 그 자리를 내주고
  SFTP 는 `Ctrl+Shift+O` 로 옮겼다 →
  [docs/log/2026-09-08-terminal-search.md](docs/log/2026-09-08-terminal-search.md).
  테마 프로필 전환은 `Ctrl+Shift+U`(리눅스 IBus 유니코드 입력과 겹침 — 알고 받음) →
  [docs/log/2026-09-28-profile-switcher.md](docs/log/2026-09-28-profile-switcher.md).
  앱이 뜻을 두지 않은 **브라우저 가속키**(`Ctrl+P` 인쇄 등)는 `isBrowserChromeCombo` 목록
  하나로 막는다(새로고침·개발자 도구는 일부러 살려 둔다) →
  [docs/log/2026-09-08-browser-accelerators.md](docs/log/2026-09-08-browser-accelerators.md).
- **네이티브 우클릭 메뉴는 창 전역에서 막는다** — 앱 메뉴(이미 `preventDefault` 한 것)와
  편집 필드(`.xterm` 제외)만 예외. 판정은 `keybindings.ts` 의
  `shouldBlockNativeContextMenu` 하나이고, 창 리스너는 **버블 단계**여야 앱 메뉴가 산다 →
  [docs/log/2026-09-08-native-context-menu.md](docs/log/2026-09-08-native-context-menu.md).
- **용어:** 사용자 문구는 **창 > 워크스페이스 > 탭 > 타일 > 세션** · 호스트 · 파일 —
  [docs/conventions.md](docs/conventions.md) 의 용어표. 모든 빌드·창에서 워크스페이스 v2를 사용한다.
  터미널 우클릭 설정 라벨에 **'PuTTY식' 문구를 쓰지 않는다** — '메뉴 / 복사·붙여넣기'.

## 보안 제약 (불변 — 사용자 명시)

- **AYNX 세션 서버는 CLI 전역에 등록하지 않는다 — AYNX 가 띄우는 로컬 AI 타일과 감싸개가 있는 로컬 셸 타일(PowerShell · Git Bash · 셸 통합 켬 — 그 셸에서 친 `claude` · `codex`, 2026-10-26)에만 실리고 MCP 토큰은 사용자 CLI 설정 파일에 없다** → [docs/log/2026-10-03-mcp-sessions-inject.md](docs/log/2026-10-03-mcp-sessions-inject.md) · [docs/log/2026-10-26-agent-enable.md](docs/log/2026-10-26-agent-enable.md).

- 비밀번호·키 암호구는 **사용자가 켠 볼트에만** 저장한다 (옵트인 — 켜지 않으면 예전 그대로
  한 번 쓰고 버리고 다음 접속에 다시 묻는다). 볼트는 OS 저장소가 아니라 **자체 파일
  하나**(`vault.bin`, 통째로 암호화)이고 마스터 암호는 **선택**이다 — 걸지 않으면 "이 PC 의
  내 계정으로 로그인한 사람은 볼 수 있다" 를 화면이 그대로 밝힌다. **가림막이 걸리면 볼트도
  잠기고, 가림막을 걷는 것이 곧 볼트를 여는 것이다**(마스터 없으면 Enter). **보는 창이 0개여도 잠긴다**(마지막 창 파괴·GUI 종료/kill —
  이때 HTTP MCP 티켓은 폐기가 아니라 정지, 가림막을 걷으면 같은 티켓으로 복구 — 2026-10-09 결정). **마스터를 걸었으면 앱을 다시 켤 때(메인 창 부팅에
  볼트가 잠겨 있으면 — 세션 서버가 새로 뜬 날 포함) 무조건 가림막이 선다** · **가림막은 집 PC 창 전체에 하나처럼 서고 걷힌다**(원격 웹 창 제외) — 건너뛰는 길은 없고, 마스터를 잊으면 `vault.bin` 을 손으로 지운다(앱 안에
  지우는 길을 두지 않는다 — 2026-10-28 · [docs/log/2026-10-28-lock-screens.md](docs/log/2026-10-28-lock-screens.md)) — 자물쇠를 그린
  가림막 자신이 그 관문이고, 다른 키·클릭으로는 걷히지 않는다. 시계는 프라이버시의 무입력
  자동 잠금 하나뿐이고 볼트 쪽 자동 잠금 칸은 없다. 볼트 **밖**(설정 파일·
  로그·`Debug`·MCP)에는 한 글자도 남기지 않고, **볼트 값은 세션 서버 프로세스 밖으로 나가지 않는다**(GUI 는 상태·종류·대상·참조만 — SSH 인증·헤드리스는 서버 프로세스에서 직접 읽고 **값을 돌려주는 op 는 없다**)
  (프런트가 받는 것은 `has_*`·`list` 의 종류와 대상뿐). 개인키 파일 자체는 저장하지 않고
  접속 순간 읽어 서명한 뒤 버린다(에이전트 우선 · `IdentityFile` 은 그다음).
  **헤드리스 위임은 기본적으로 볼트를 쓰지 않고, 호스트별 위임 '볼트의 키 암호구
  사용'(`vault_passphrase`)을 켠 호스트에서만** 그 키의 암호구를 볼트에서 꺼내 쓴다
  (2026-09-22 — 비밀번호는 여전히 아니고, 볼트가 잠겨 있으면 그 접속은 아예 서지 않는다).
  **위임의 편집은 호스트 폼 · 타일 AI 권한 팝오버(둘 다 Tauri 명령)뿐이고 MCP 에는 위임·권한을 바꾸는 도구가 없다**(오케스트레이션 조율 도구는 Run 장부만 바꾼다).
  **Run(앨범)은 사람이 [새 앨범]에서 첫 말을 보내는 Tauri 명령 `producer_album_start` 로만 열린다** — 사람이 정한 저장소 · 아티스트별 등급 · 허용 명령 ·
  수락 규칙 · 검증 · 한도를 Run 에 담고, 띄운 프로듀서 세대와 Run · 조정자 묶음 · 귀속을 한 잠금에서 확정한다(첫 말 전송 실패는 `sent:false` — 앨범은 남고 사람이 다시 보낸다).
  **범위는 사람만 정한다 — AI · MCP 에는 앨범을 열거나 구성을 넓힐 길이 없다**(시험 `album_opens_only_from_human_op` · `start_run_is_gone` ·
  `album_config_has_no_mcp_writer` · `run_without_album_is_inert`). **앨범 구성은 시작 때와 [앨범 권한]에서만 사람이 바꾼다**(Tauri `orchestration_album_widen` ·
  `_set` — 서버 `widens` 하나가 넓힘 판정 · `_set` 은 넓힘을 거절, 시험 `album_set_rejects_widening` · 다음 턴부터 지금 rev).
  **아티스트는 권한 없는 프로필**(이름 · 아이콘 · CLI · 종류 · 모델 · 강도 · 지침 — `orchestration-artists.toml` · 시험 `artist_has_no_permission`)이고,
  편집은 Tauri `orchestration_artist_set` · `_remove` 뿐(원격 ALLOW · 산 앨범의 멤버는 삭제 거절). MCP 에는 구성 · 아티스트 쓰기 도구가 없다 →
  [docs/log/2026-10-30-orchestration-album-first.md](docs/log/2026-10-30-orchestration-album-first.md) 2절 · 3절 · 6절.
  **원격 세션의 AI 권한은 호스트 하나**(Off · Read · Ask · Auto · YOLO = 끔 · 읽기 · 승인 후 실행 · 허용 목록 자동 · 무엇이든 자동 — 이름은 모든 언어에서 이 영어 낱말 · 2026-10-23 — 사람이 연 타일과
  헤드리스에 똑같이), 로컬 타일은 타일별 읽기 허용만(실행 대상 아님 · AI CLI 타일은 없음), 호스트 목록에 없는 원격 타일은 끔 →
  [docs/log/2026-10-07-ai-permission-unify.md](docs/log/2026-10-07-ai-permission-unify.md) ·
  [docs/log/2026-09-19-vault.md](docs/log/2026-09-19-vault.md) ·
  [docs/log/2026-09-19-identity-file-auth.md](docs/log/2026-09-19-identity-file-auth.md) ·
  [docs/log/2026-09-21-fleet-delegation-ui.md](docs/log/2026-09-21-fleet-delegation-ui.md) ·
  [docs/log/2026-09-22-delegation-vault-passphrase.md](docs/log/2026-09-22-delegation-vault-passphrase.md).
- **예외 하나 — 외부 MCP 서버 환경변수(볼트 `mcp_env`).** stdio 서버는 평문 환경변수가 있어야 돌기
  때문에, 이 값만은 볼트가 **열려 있는 동안** **세션 서버의** 루프백 실행 브로커가 `aynx mcp-run` 도우미(별도
  프로세스)를 거쳐 그 서버 자식 환경에 평문으로 넘긴다. 브로커는 64자 실행 티켓만 확인하고 상대
  프로세스는 확인하지 않는다. 티켓은 Claude `--mcp-config` 파일·Codex `-c` 인자(셸 첫 입력 → 스크롤백·
  셸 히스토리 · 감싸개가 있는 로컬 셸 타일은 그 타일의 장식 파일)에 남고 설정을 바꾸거나 세션 서버가 끝날 때까지(GUI 를 꺼도 산다) 다시 쓸 수 있다 — 그러니 **이 값은 같은 사용자 계정의
  프로세스, 그 타일(로컬 AI 타일 · 감싸개가 있는 로컬 셸 타일 전부 — 2026-10-26)의 AI 에이전트 자신을 포함해, 에게 노출된다고 본다**(마스터 암호는 볼트를 여는
  순간만 지킨다). 알고 받은 한계(2026-10-03 사용자 결정): 평문 `.mcp.json` 과 같은 등급이고, 디스크·
  설정 파일·프런트·MCP RPC 에는 여전히 값이 없다. 볼트가 잠기면 브로커도 값을 내주지 않는다 →
  [docs/log/2026-10-03-mcp-scopes-env.md](docs/log/2026-10-03-mcp-scopes-env.md).
  HTTP 헤더 값은 세션 서버 안 프록시가 붙여 AYNX 프로세스(GUI·세션 서버) 밖의 CLI·도우미로 나가지 않는다 →
  [docs/log/2026-10-04-mcp-http-header-proxy.md](docs/log/2026-10-04-mcp-http-header-proxy.md).
- **앱은 사용자가 명시적으로 위임한 범위 안에서만 실행한다** (2026-09-11 재정의 — 규모에서 매
  쓰기의 실시간 감독은 불가능하다). 위임의 형식은 둘: (a) 그 자리 사람 승인, (b) 사전 정책
  (자동 승인)이되 **범위·한도가 명시된** 것(호스트 · DB 연결의 **YOLO** 는 범위 = 그 호스트 · 그 연결 전부 — 명령 정책 · 빈도 한도 없이,
  caps · 전체 스위치 · 감사는 그대로 → [docs/log/2026-10-23-approve-all.md](docs/log/2026-10-23-approve-all.md)). 지켜지는 것: 원시 `send_command` 는 만들지 않는다(서버 op `ssh_exec` 도 아니다 —
  대상은 서버 표의 세션 id, 호출자는 GUI Rust 고정 조립 함수뿐, 프런트·MCP 명령 없음을 시험이 지킨다). **AI 문자열→PTY 길은 없다**(3차 3a —
  2차의 붙여넣기 전달 `orchestration::deliver` 는 걷혔다). **AI 자유 글과 실행 입력의 경계 — AI가 작성한 자유 글을 새 작업 지시로 실행 재료에 싣는 앱 경로는 오케스트레이션 작업자·검토자의 헤드리스 턴뿐이다. 프로듀서 채팅에는 사람이 제출한 입력 외에 서버가 Run 장부에서 제한된 타입으로 만든 깨움 메시지만 새 사용자 턴으로 넣을 수 있다. MCP 결과·작업자 대화·보고·판정 본문을 그대로 채팅 입력으로 전달하는 경로는 두지 않는다**(사이드 채팅 stdin 은 사람 문자열 — 아래 ③ · 프로듀서 채팅 — 아래 ④). 헤드리스 턴은 첫 지시
  (`spawn_worker`) · 이어지는 지시(MCP `send_prompt` = 같은 대화를 resume 하는 **새 턴** — `orchestration/resume.rs`)를 셸 없는 인자 배열의
  마지막(옵션 → `--` → 서버 머리줄 `[` 로 시작하는 지시)로만 싣는다. 대상은 **사람이 연 앨범의 Run 이 띄운 쓰기형 작업자**(`idle` ·
  대화가 끊기지 않았을 때 · 한 번에 한 턴 — 도는 중이면 `busy{attemptIds}` · 큐 없음 · 결과는 `started` 또는 `rejected{spawn-failed}` —
  예약 수락과 실제 시작이 나뉠 수 있다(생성 대기 상한을 넘으면 `started{launching:true}` · 뒤에 못 서면 그 턴이 `failed:spawn-failed` · `idle` · 사건으로 보인다 — 끝내 모르는 상태는 없다)). 셸 타일 · 사람이 연 타일 · 원격 타일 · 프로듀서 채팅에는 길이 없다. 작업자에게는 권한 화면이 없다(비대화형 — 허용 밖은 CLI 가 거절하고
  작업자는 `report_done{blocked}` 로 알린다: 비종결 · worktree 유지 · 사람이 [앨범 권한]에서 넓히면 조정자가 같은 대화를 잇는다). **오케스트레이션 검증**: 검증 문자열은 사람만 설정한다
  (**[새 앨범]의 구성에서만** — 글자는 앨범 시작 때 Run 에 고정되고 도중에 바뀌지 않는다 · [앨범 권한]은 사람 확인 ↔ 자동 실행만 · MCP 로 정하거나 바꿀 수 없다). 실행 대상 코드는 AI 가 바꿀 수 있다 — 그래서 실행은 **사람 확인(후보별 — 후보 OID ·
  명령 해시 · 통합 머리에 묶임)** 또는 **사람이 켠 자동 실행 위임 범위 안에서만** 한다(자동은 '전부 자동' 과 같은 위험 등급 표시). 승인 ·
  실패 덮어쓰기는 Tauri 명령뿐(MCP 도구 없음). 검증은 사용자 권한 · 샌드박스 없이 돈다(OS 격리는 아직 없다 — 무인 검증의 임의 코드 실행 위험은 사용자가 수용했다, 2026-10-16) →
  [docs/log/2026-10-15-orchestration-integration-design.md](docs/log/2026-10-15-orchestration-integration-design.md) 5절. 무인 검증(자동 실행)은
  후보마다 **지금 앨범 구성의 자동 실행 칸 · 저장소 신원**으로 다시 판정하고, 거둬졌으면 사람 확인으로 돌린다. 작업자의 권한은 **앨범 구성의 그 아티스트 등급 ·
  허용 명령**(편집은 [앨범 권한] Tauri 명령 · 원격은 넓힘만 REAUTH)을 **턴마다 지금 rev** 에서 읽고, 모델 · 강도 · 지침은 아티스트 목록의 지금 값이다
  (넓힘 · 좁힘 모두 다음 턴부터 · 도는 턴의 인자는 그대로 — 시험 `album_change_applies_next_turn`) — 남는 위험은
  그 역할의 권한과 사람 감독이 진다 → [docs/log/2026-10-16-orchestration-headless-design.md](docs/log/2026-10-16-orchestration-headless-design.md) · AI 는 자기 실행을 **자가 승인 못 한다**(approve 는 Tauri 전용, MCP 아님 — 세션 서버로 가는 **승인 등급 프레임은
  `approve_operation` 하나만** 만들고(소스 훑기 시험), 서버가 만료·상한·정책·권한·빈도를 다시 판정한다 — 서버 안 자동 승인 진입점도 `approve_in(…, "auto")` 하나, 시험 `auto_approve_has_one_entry`) ·
  위임되지 않은 범위는 여전히 승인 대기. 쓰기(실행)는 단계가 아니라 **이미 선 기능**이다
  (단계 8·9·10).
- 세션 로깅은 기본 꺼짐, **세션별 옵트인**.
- **메신저 웹훅 URL 은 채널마다 자기 파일(`<설정 루트>/discord-webhook` · `<설정 루트>/slack-webhook`)에만** — 프런트·MCP·로그·`Debug` 로 나가지 않고(`configured` 하나), 멘션은 늘 막는다(Discord `allowed_mentions` · Slack `& < >` 걷기) →
  [docs/log/2026-09-27-discord-notify.md](docs/log/2026-09-27-discord-notify.md) ·
  [docs/log/2026-09-28-messenger-channels.md](docs/log/2026-09-28-messenger-channels.md).
- 포트 포워드는 **127.0.0.1 전용**.
- **DB 비밀번호는 볼트 `db_password`(대상 = DB 연결 id)에만** — 연결 목록은 `<설정 루트>/db-connections.json` 하나(경유 `via` = 호스트
  별칭 · 비밀번호 칸 없음 · 서버가 열 때 id 로 다시 읽음). 담는 길은 쿼리 타일 접속 모달 하나(인증 성공 뒤), 값은
  세션 서버 안에서만 읽는다. DB 연결·드라이버는 세션 서버에 살고 session_core 밖이다. **MCP 의 DB 도구는 연결마다 사람이 준
  AI 권한(Off · Schema · Read · Ask · YOLO — `delegation.toml` `[[database]]` + 신원 스냅샷, 대상을 바꾸면 끔 · 편집은 Tauri 명령뿐 ·
  허용 목록 자동 승인 없음) 안에서만** 보이고(끔이면 목록에도 없다 · 판정은 세션 서버), AI 는 **사람 타일과 따로 연 AI 전용 읽기 전용 연결**로만
  읽는다(가드 읽기 전용 + 엔진 READ ONLY — 사람의 트랜잭션·쓰기 모드에 닿지 않음). **Read 이상이면 조회 결과 행이 모델 제공자로
  간다**(Schema 는 행 없음 · 호출마다 감사 `db_read`, 값은 남기지 않음). **AI 의 쓰기는 작업안뿐**(MCP 는 초안 저장만 — 대상 `db:<id>`
  하나 · Ask 이상 연결만 · 사람 승인(연결이 YOLO 면 자동 승인) · 실행 직전 권한·신원 재판정 · 따로 연 쓰기 연결의 한 트랜잭션 ·
  `maxAffected` 넘으면 커밋 전 되돌림). DB 비밀번호는 여전히 볼트 → 세션 서버 안에서만(AI 연결도 볼트에서만 — 없거나 잠기면 실패,
  경유 SSH 는 헤드리스 규칙). **쿼리 타일은
  읽기 전용이 기본**(문장 하나 · 첫 낱말 허용 목록 · 엔진 READ ONLY — 최종 방어선은 DB 계정 권한, 쓰기는 타일마다 확인 뒤 켜고
  저장하지 않는다). TLS 신뢰 = 내장 공개 CA + CA 파일(OS 저장소 안 씀 · verify-ca 는 CA 파일만) →
  [docs/log/2026-10-12-query-tile.md](docs/log/2026-10-12-query-tile.md) ·
  [docs/log/2026-10-13-db-write-mcp-design.md](docs/log/2026-10-13-db-write-mcp-design.md).
- **오케스트레이션 역할 토큰** — **로컬 AI 타일마다 MCP 토큰**(감싸개가 있는 로컬 셸 타일도 — AI 타일인가는 서버 표의 따로 칸,
  셸 타일의 AI 읽기 허용은 예전 그대로)(`src-tauri/src/tile_token.rs` — 세션 서버가 세션 `open` 에서 뽑아
  `(stream, sessionEpoch)` 에 묶는다: 요청마다 그 회차가 살아 있어야 하고 아니면 `stale-tile` · 회차가 바뀌거나 세션 회수 · 타일 닫기 때 폐기 ·
  F5 · 웹뷰 크래시 재부착은 그대로). **타일 토큰은 Run 을 열지도 이어받지도
  조율하지도 못한다** — 타일의 목록에 타일 도구 · 조율 도구가 없고, 불러도 서버가 거절한다(호출자 갈래에 타일이 없어 모르는 도구 — 시험
  `tile_token_cannot_open_or_coordinate`).
  **조정자 토큰은 없다 — 조정자는 프로듀서 채팅의 채팅 토큰(종류 `producer`)에 서버 표가 붙인 역할**(Run 세대 ↔ 자리 묶음
  `Slot.coordinator = (gen, Seat{chat, proc})` — 묶음이 서는 길은 둘뿐: **사람의 앨범 시작 op**(`producer_album_start` — **Run 은 이 길로만 열린다** · 띄운 세대 · 묶음 · 귀속과 Run 이 한 잠금에서) ·
  조정자 없는 멈춘 Run 을 **그 앨범에 귀속된** 프로듀서 채팅이 `adopt_run`(세대 +1 · 알림 `run-adopted` · 판정은 `adopt_verdict` 하나 · 시간 한도 · 보류는 `not-adoptable` · 사람 [재개] 는
  조정자가 있어야 선다 — 없으면 `no-coordinator`)). 프로듀서 채팅은 사람이 오케스트레이션 탭에서 연 것뿐이다(Tauri `producer_album_start` · `producer_chat_open` · AI · MCP 에는 길이 없다) ·
  귀속의 자리는 Run 파일의 `producers`(채팅 하나 = 앨범 하나 `already-produced` · 귀속은 사람의 앨범 시작 · [새 프로듀서로 이어받기] op 만 세운다 ·
  `adopt_run` 은 토큰의 앨범 하나만 `out-of-scope:run`).
  **프로듀서 호출의 신원은 HTTP 인증 시 확정한 채팅 ID와 재사용하지 않는 프로세스 세대이며, 요청 처리 중 현재 세대로 바꾸지 않는다. 조정자 역할은 그 신원과 Run 세대의 서버 묶음으로만 부여한다. 앨범 시작과 adopt_run은 묶음을 확정하는 잠금 안에서 인증 신원의 유효성과 논리적 채팅의 앨범 귀속을 다시 확인한다. 논리적 채팅 하나는 앨범 하나에만 귀속되며, 프로세스 재시작·재부착·모델 변경으로 귀속을 초기화하지 않는다.**
  (잠금 안 확인이 실패하면 `not-a-tile` — 낱말은 옛 이름 그대로.)
  **프로세스 종료 시 해당 세대의 토큰을 먼저 회수하고 그 세대의 조정자 묶음을 해제한 뒤 재시작 가능한 종료 상태를 알린다. 옛 세대의 지연된 요청과 정리는 새 세대에 영향을 주지 않는다. adopt_run은 귀속 복원과 자동 재개를 구분하며, 사람이 일시정지한 Run은 귀속을 복원해도 사람이 재개하기 전까지 멈춘 상태를 유지한다. 서버 재시작으로 orphaned가 된 Run의 권한은 대화 resume으로 복원하지 않는다.**
  (묶음 해제 = 그 자리의 `wait_run` 취소 · 잠정 커서 되돌림.) 묶음은 프로세스 끝(사람의 [프로듀서 끝내기] 포함 — 토큰 칸 먼저) · 중단 · Run 끝 · 세대 교체 때 곧바로 푼다 · **조율 요청은 예상 `runId` · `gen` 이 묶음과 맞을 때만**: `stale-run` · `stale-generation` ·
  `run-ended` · `not-coordinator`. `adopt_run` · `complete_run` 의 멱등 기록은 **역할 판정보다 먼저** `(chat, ProcId, requestId)`
  로 찾는다(`chat_token::with_request` — 그 세대의 토큰 칸 · 성공 뒤 · Run 이 끝난 뒤의 재시도도 처음 결과 · 프로세스가 바뀐 뒤의 재시도는 `already-produced{runId}`).
  앨범 시작은 `(chat, clientId)` 로 처음 확정 답(`sent:false` 포함)을 돌려준다(확정 전 오류는 재시도 가능). 작업자 토큰(판정형 턴은 검토자 토큰 — 같은 규칙)은 **턴마다** 뽑고 **그 턴의 프로세스 트리 종료가 확인된 뒤에**
  거둔다(늦은 보고를 `late` 로 받으려고 — 10-15 사용자 결정 · 생성 실패면 곧바로 · `idle` 에는 산 토큰이 없다 · 서버 재시작 뒤 orphaned Run 에는
  되살리지 않는다). Claude 턴의 토큰은 **그 턴의** MCP 파일(`orch-<att>-t<n>.json` — 턴 claim 이 쥐고 턴 끝에 지운다), Codex 는 그 턴 프로세스의
  환경 변수에만 있다. 역할은 서버 표에서만 읽고 조정자의 조율은 자기 Run 안에서만이다. 값은 프런트·로그·
  `Debug`·영속 파일(`<데이터 루트>/orchestration/run-<id>.json`)에 나가지 않는다(타일 토큰은 셸 환경에 서버가 넣고 GUI Rust 만 서버 op
  `mcp_tile_token` 으로 읽어 그 타일의 `--mcp-config` 파일에만 쓴다 — 셸 타일의 장식 파일에는 그 경로만 · 시험 `tile_token_never_reaches_frontend` · 프로듀서
  채팅 토큰은 그 프로세스의 임시 `--mcp-config` · 환경에만 — 시험 `chat_token_never_reaches_frontend`).
  **역할 토큰 · 타일 토큰 · 채팅 토큰은 같은 계정 안의 보안 경계가 아니다**(작업자는 같은 사용자 권한으로 돈다 — 방어선은 앨범 구성의 권한 + 사람 감독) →
  [docs/log/2026-10-14-orchestration-design.md](docs/log/2026-10-14-orchestration-design.md) C-1 ·
  [docs/log/2026-10-16-orchestration-headless-design.md](docs/log/2026-10-16-orchestration-headless-design.md) 3-1 ·
  [docs/log/2026-10-30-orchestration-structured-producer.md](docs/log/2026-10-30-orchestration-structured-producer.md) 2절 · 6절.
- **대화 기록이 MCP 로 나가는 길은 조정자 `read_worker` 하나 — 자기 Run 작업자의 고정 대화만**(처음 받은 대화 id · 그 CLI 대화 폴더 안 · 기록된 cwd = 그 worktree). 다른 대화(사람 타일 · 다른 Run · 작업자가 옮겨 간 대화)는 MCP 로 나가지 않고, 본문은 로그 · 감사 · 영속 파일 · `Debug` 에 없다 → 같은 설계 C-6.
- **원격 타일에는 MCP 토큰을 주지 않는다 — 신호 전용 토큰(스트림별)만.** 훅은 앱이 건 `-R`
  (양쪽 끝 루프백)로 `/agent-signal` 에 닿고, 그 토큰은 그 타일의 상태 점 신호에만 통한다(세션이 닫히면 거둔다) →
  [docs/log/2026-09-24-remote-agent-signals.md](docs/log/2026-09-24-remote-agent-signals.md).
  받는 타일: **앱이 AI 를 띄운 타일, 또는 호스트의 에이전트 활성화(`sessions.toml` `agent`)가 켜졌으면 그 호스트의 모든 원격 타일**
  (손으로 띄운 CLI · 재접속 · tmux 포함 · 빠른 접속은 토글이 늘 끔) — **호스트 AI 권한은 관여하지 않는다**(2026-10-27 — 10-08 의
  "AI 권한 Read 이상이면 모든 타일" 을 바꿈 · 판정은 세션 서버 `ssh/open.rs` `signal_stream` 한 곳, 프런트는 스트림 id 만) →
  [docs/log/2026-10-27-signal-by-agent.md](docs/log/2026-10-27-signal-by-agent.md) ·
  [docs/log/2026-10-08-remote-signals-by-permission.md](docs/log/2026-10-08-remote-signals-by-permission.md) ·
  [docs/log/2026-10-26-agent-enable.md](docs/log/2026-10-26-agent-enable.md).
  원격의 주소·토큰은 서버 파일 `~/.config/aynx/signal/<스트림>.env`(0600, 접속마다 원자 교체)로 전달하고 **셸에는 스트림 id 만**
  export 한다(에이전트 활성화 호스트는 + PATH 심 폴더 — 비밀 아님 · 셸 통합 끔·SFTP 실패 때만 예전 export 폴백 — `src-tauri/src/remote_signal_file.rs`).
  **로컬 타일은 모두 같은 신호 전용 토큰을 받고, MCP 토큰은 로컬 셸 타일(셸 통합 감싸개가 있는 셸 — PowerShell · Git Bash · 셸 통합 켬)과
  AI 타일 — 타일마다 따로**(3차 4단계 타일 토큰 · 서버 전역 토큰은 `mcp.json` 에 남되 조율 도구는 `not-a-tile`) 받는다(평범한 셸에서 친 `claude` 도
  신호를 보내게 · 2026-10-26 부터는 그 `claude` · `codex` 가 AI 타일과 같은 추가 인자 · MCP · `--no-daemon` 을 받게 — GUI Rust 가 열 때 쓰는 타일
  장식 파일 `src-tauri/src/agent_tile.rs` · 셸에는 그 경로 `AYNX_TILE_AGENT` 만 · 감싸개 타일의 autorun 은 장식하지 않는다. cmd · WSL · 셸 통합 끔은
  예전 그대로) → [docs/log/2026-09-25-shell-claude-signals.md](docs/log/2026-09-25-shell-claude-signals.md) ·
  [docs/log/2026-10-26-agent-enable.md](docs/log/2026-10-26-agent-enable.md).
  **신호 전용 토큰 표·에이전트 상태 표·`/agent-signal` 수신은 세션 서버 프로세스에 있다**(127.0.0.1 임시 포트, 신호 토큰만 받고
  MCP 토큰은 받지 않음). 로컬·원격 타일 토큰 모두 서버 안에서 뽑고 거두며 **파이프·GUI 를 지나지 않는다**(③-3b2 — 원격 파일·export 도 서버의
  SFTP 채널이 쓴다). 세션 자원 회수 때 서버가 거둔다 →
  [docs/log/2026-10-09-session-server-signals.md](docs/log/2026-10-09-session-server-signals.md).
  **권한 결정 토큰(스트림별 · 로컬 AI 타일 · 감싸개 셸 타일만 · 결정 경로 `/agent-permission` 전용)** 은 신호 전용 토큰과 따로다(서로의 경로에서 401 ·
  같은 수명 · 셸 환경으로만 — 파이프 · GUI · 프런트에 값 없음). 권한 훅은 그 타일 장식의 CLI 프로세스에만 실리고(사용자 전역 훅 파일 아님) **도구 입력
  본문(명령 · 파일 내용 · URL · MCP 인자)을 앱으로 보낸다** — 그 세션을 보는 창의 카드로만, 로그 · MCP · 영속에는 없다. 결정은 훅 응답으로만 가고 PTY 에
  쓰지 않는다 → [docs/log/2026-11-01-tile-permission-hook.md](docs/log/2026-11-01-tile-permission-hook.md)
  (같은 장식의 Codex `Interrupt` 훅만은 **신호 경로**로 그 타일의 신호 전용 토큰을 써 `interrupt` 하나를 보낸다 — 상태 점 전용 그대로 ·
  대화 면 [중지]는 Esc 키 하나(사람 키) + 서버 op `agent_state_interrupt` — 2026-11-02.)
- 에이전트 포워딩은 **호스트별 옵트인(기본 꺼짐)**, 헤드리스 위임 접속에는 없다 →
  [docs/log/2026-09-23-agent-forwarding.md](docs/log/2026-09-23-agent-forwarding.md).
- **원격 웹 클라이언트는 tailnet 안 브라우저만** — 관문(`src-tauri/src/remote/`)은 **127.0.0.1 에만** 묶이고 노출은 사용자가 직접 건, 또는 집 PC 설정 화면의 [연결]로 건
  `tailscale serve` 가 한다(앱 실행은 고정 인자 · Funnel 길 없음 · 집 PC 전용 — `remote/serve.rs` · Funnel 이 그 포트를 내보내면 열지 않는다). 신원은 **집 PC 사람이 6자리 코드를 보고 [허용] 한 기기 페어링
  토큰**(Tailscale 헤더는 참고), 원격 창은 자기 가림막을 걷고 연결된 동안만 창으로 센다(마스터 암호는 선택 — 없으면 단추). 원격 창은
  집 PC 창과 동등하되 **앱 명령의 문은 `remote/deny.rs` 하나**(표 넷 — 명령마다 정확히 하나, 시험이 `generate_handler!` 와 맞춘다):
  집 PC 전용 = 볼트 마스터 바꾸기·전체 삭제 · 기기 페어링 답 · 자동 승인 정책(`[automation]`) · `tailscale serve` 걸기·끄기 · 원격 접속 켜기·이름·포트(끄기·기기
  폐기는 원격도 된다) / 재확인 = 작업안 승인·AI 권한 올리기는 **마스터가 있으면 그 순간 다시 묻는다**(1회용 표 — 암호는 HTTP 몸으로만,
  ws·로그에 없음) / 프로듀서 채팅 명령(`producer_chat_*`)은 ALLOW(사람의 말 · 결정 · 끊기 — `decide` 는 허용 목록 두 카드에만 뜻 · 앨범 시작 `producer_album_start` · 앨범 권한 넓힘 `orchestration_album_widen` 은 REAUTH ·
  앨범 영구 삭제 `orchestration_delete_archived` · 앨범 병합 `orchestration_merge` 는 REAUTH(병합 미리 보기는 ALLOW) · 넓힘 없는 변경 `orchestration_album_set` · 기본값 읽기 · 아티스트 명령 · 이름 변경 · `producer_fork_probe` 는 ALLOW — 서버가 다시 판정) / 사이드 채팅 명령(`side_chat_*` · `side_chats_*`)도 ALLOW(권한 카드 `side_chat_decide` 포함 · 재확인 없음 → [docs/log/2026-11-01-remote-side-chat.md](docs/log/2026-11-01-remote-side-chat.md)). 플러그인은 `capabilities/remote.json` ACL 이 막고, 그 ACL 이 연 **이벤트 emit 은 이름으로 다시 거른다**(`deny::REMOTE_EMIT`
  넷만 — 기본 거절 · 집 PC 리스너가 받는 순간 일을 하는 이벤트를 원격이 못 낸다). 집 PC 에는 원격이 열 때 OS 알림 + 상태바 "원격 접속 중"
  (둘 다 끌 수 없다). 볼트 값·MCP 토큰·웹훅 URL 은 여전히 원격으로 나가지 않는다 →
  [docs/log/2026-10-15-remote-web-client-design.md](docs/log/2026-10-15-remote-web-client-design.md).
- OS 자격증명 저장은 **(닫힘) OS 저장소 대신 자체 볼트** — 2026-09-19. Credential Manager·
  Keychain·libsecret 은 잠금 개념도 다시 묻는 시점도 백업 방법도 달라, 쓰면 OS 마다 UX 가
  갈리고 그걸 설명하려 프런트가 OS 를 알아야 한다(위에서 금지한 바로 그 모양). 나중에 붙인다면
  볼트 **키를 감싸는 자리**(`protect_key_bytes`)가 그 문이다 —
  [docs/log/2026-09-19-vault.md](docs/log/2026-09-19-vault.md) 2절.

## 아키텍처 한눈에

**고칠 파일은 지도에서 먼저 찾는다** — 백엔드 [docs/modules.md](docs/modules.md) ·
프런트 [docs/modules-frontend.md](docs/modules-frontend.md) (층별 표 · 현재 층 위반 · "어디를 고치나").
불변식은 각 파일 머리말에 있다. 아래는 방향만 잡는 몇 줄이다.

**프런트 (`src/lib/`)**
- 큰 모듈은 폴더로 나누고 **옛 경로를 배럴로 남긴다** — 자식은 배럴을 부르지 않는다
  (규칙: [docs/modules-frontend.md](docs/modules-frontend.md) 의 "배럴 규칙").
- 타일 배치는 **이진 분할 트리**: 순수 트리·스펙은 `session/`(`spec.ts` · `tree.ts` · `tree-edit.ts` …,
  `session.ts` 는 배럴), 순수 기하는 `layout.ts`, 둘 다 필요한 조작은 `tree-ops.ts`. 키바인딩은 `keybindings.ts`.
- `app/` 은 도메인 상태 모듈(tabs · panes · sessions · hosts · prompts …), 큰 화면의 조각은
  `pane/`(PaneHost) · `term/`(Terminal) · `console/`(대시보드) · `dialogs/`(`+page` 모달) · `settings/model/`(설정 모델).
- 호스트 · 프로젝트 · 설정은 타일 트리 밖에 **떠 있는 독**이다(`Dock.svelte` + `app/dock.svelte.ts`) →
  [docs/log/2026-09-25-unified-dock.md](docs/log/2026-09-25-unified-dock.md).

**백엔드 (`src-tauri/src/`)**
- 세션: `server/`(세션 서버 — serve·sessions·ssh_ops·tunnel·hub·credit·proxy·client·launch) · `pty.rs`(로컬 자원) · `ssh.rs` + `ssh/`(원격) ·
  `headless.rs` · `ssh_pool.rs` · `port_forward.rs` · `db/`(쿼리 타일) — **로컬·SSH·풀·포워드·헤드리스·DB 는 모두 세션 서버 프로세스에 산다(③-2·③-3b2).**
  GUI 가 원격에 닿는 길은 서버 op `ssh_exec`(명령은 GUI Rust 고정 조립 함수만)와 SFTP 채널 터널뿐이다. `reap.rs`(누수 그물) · `handoff.rs`(창 간 이관).
- `mcp.rs` + `mcp/` 는 **읽기·계획 + 오케스트레이션 조율**(역할별 토큰 — 프로듀서 채팅: 귀속 앨범 이어받기, 조정자: 작업 정의·작업자 띄우기·이어지는 지시(resume 턴)·완료, 작업자: 자기 보고, 검토자: 판정).
  `/mcp` 인증 순서(`mcp/http.rs`): 전역 토큰 → **타일 토큰**(`Caller::Tile{stream}` · 요청마다 회차 확인) → **채팅(사이드 · 프로듀서 — 종류 · 세대는 표에서 ·
  `Caller::Producer{chat, proc}`)** → 작업자 · 검토자 턴 토큰. **프로듀서 채팅**의 목록 = 13(작업안 여섯은 앨범 구성 칸 "프로듀서 작업안 도구"를 켰을 때만 —
  기본 꺼짐 · 띄울 때 고정 · 호출마다 지금 값으로 재판정 `producer-plan-tools-off`) + DB(권한대로) + `adopt_run` + 조율 도구 전부(처음부터 고정 —
  조율은 그 채팅 세대가 서버 표에서 산 Run 의 조정자로 묶였을 때만 `orchestration/tile.rs` · 요청마다 **필수 `runId` · `gen`**, `get_run` 만 생략 가능해 둘을 돌려준다 ·
  아니면 `not-coordinator`). **로컬 AI 타일 · 감싸개 셸 타일은 13 + DB**(읽기 · DB · 작업안 도구는 전역과 같은 판정 · 조율 도구 없음 — 불러도 모르는 도구 ·
  INSTRUCTIONS 에 안내 한 줄: 사람에게 오케스트레이션 탭 · [오케스트레이션으로 이어 가기]를 알린다 — 시험
  `tile_token_cannot_open_or_coordinate`). 사이드 채팅은 읽기 일곱. **목록은 조정자가 돼도 바뀌지 않는다**(Codex 는 대화 중 목록 갱신을 받지 않는다 — `list_changed` 에
  기대지 않음). CLI 미리 허용(타일 도구 · 조율 도구 — Claude `--allowedTools` · Codex `approval_mode`)은 프로듀서 실행 재료(`server/producer/launch.rs` `preallowed`)에만 있다 —
  타일 autorun · 감싸개 셸 타일의 장식 파일에는 없다(시험 `tile_autorun_has_no_coordination_preallow`).
  도구 노출 · 미리 허용 · 서버 판정은 **세 겹 별개**다(판정은 늘 서버 — `orchestration/start.rs` · `tile.rs`). 전역 토큰(`mcp.json`)의 목록은 바뀌지 않는다.
  조율 도구 스키마 합은 7.5 KB 이하(시험 `coordination_schemas_fit_budget`) — 긴 계약은 INSTRUCTIONS 의 오케스트레이션 절(프로듀서 채팅만 받는다).
  명령 실행·승인·키 전송 도구는 없다. 지금 선 것은 프로듀서 채팅의 `adopt_run` ·
  조정자 `get_run`·`create_task`·`update_task`·`wait_run`·`spawn_worker`·`stop_worker`·
  `send_prompt`(이어지는 지시 = resume 턴 — `orchestration/resume.rs`) · `read_worker` · `get_diff`(고정 보고 커밋의 파일 목록·파일별 패치 — 읽기 전용) ·
  `complete_run`(Q5 — 서버 `completable` 판정 · 남은 idle 은 닫음 · 결과 `export{ok, branch | reason}` — 내보내기 실패도 Done · `serverTemp` 는 서버 임시 자리만 센다 — 작업자 worktree · 브랜치는 사람 [정리]) · 작업자 `get_task`·`commit_changes`·`report_done` · 검토자 `get_task`(검토 지시서)·`get_diff`(고정 대상만)·`report_review`(pass · changes-requested · 찾은 것 ≤20) 이다(`src-tauri/src/orchestration.rs` · [docs/log/2026-10-14-orchestration-design.md](docs/log/2026-10-14-orchestration-design.md)).
  조정자 worktree 도구 셋 · `aynx wt` CLI 는 3차 6단계에 걷었다(작업자 worktree 는 서버가 만들고 정리는 사람 — 남은 것은 사람의 [worktree 지우기] op ·
  공통 구현 `orchestration/worktree.rs`).
  **화면 = 오케스트레이션 탭 안의 라이브러리 › 스튜디오 › 앨범 › 트랙** — `OrchMark{view, repo?, runId?, taskId?, attemptId?, fromRepo?}` 가 경로이고(`fromRepo` = 스튜디오를 거쳐 든 앨범 · 트랙의 돌아갈 곳), 지금 워크스페이스의
  현재 오케스트레이션 탭을 우선해 그 안에서 이동한다(없으면 하나 만든다 · [새 탭으로 열기]는 같은 경로 복제 · ← · Esc 는 한 단계 위).
  라이브러리 · 스튜디오 · 아티스트는 플레이어 한 잎, [새 앨범]은 서버 채팅 없는 창 메모리의 초안(보내기 전 떠나면 사라짐), 앨범 · 트랙은 **그 앨범의 프로듀서 채팅 잎
  `kind:"producer"` + 플레이어 잎 `kind:"run"`**(채팅이 없으면 플레이어 전체 폭 — 끝난 앨범은 다시 열면 채팅 잎 없이 열고, 대화는 사람이 [프로듀서 대화 기록]으로 왼쪽에 읽기 전용으로 연다 · 서버 open 없음) · 아래 재생 막대 띠다. 트랙 줄 · 지금 곡 · 사람 필요 알림은 트랙 경로로 간다.
  **아티스트 · 앨범 구성 편집은 탭 안의 아티스트 · [새 앨범] · [앨범 권한]뿐** — 설정에 오케스트레이션 화면은 없다. 화면 용어는 앨범(Run) · 트랙(Task) ·
  아티스트(작업자 정의 — 코드 낱말 role) · 프로듀서(조정자)다. **프로듀서 수명은 앨범** — 탭 닫기 · 화면 이동 · 창 이관은 구독만 풀고, 같은 앨범을 다시 열면
  같은 chat · conv 에 재부착한다(새 open · 첫 말 없음). [프로듀서 끝내기]만 확인 뒤 채팅을 닫고 조율 멈춤으로 만든다(작업자는 계속) · 앨범 끝은 쉬는 순간 닫거나
  10분 뒤 끊고 닫는다 → [docs/log/2026-10-30-orchestration-album-first.md](docs/log/2026-10-30-orchestration-album-first.md) 4절 · 5절.
  **역할**(3차 3a — `orchestration/roles.rs`): 조정자는 `spawn_worker{role:<아티스트 id>}` 로 **그 앨범에 들인 아티스트**에서 id 만 고르고,
  등급 · 허용 명령은 앨범 구성 · CLI · 종류(쓰기형 · 판정형) · 모델 · 강도 · 지침은 아티스트 목록에서 서버가 붙인다(옛 `cli` 인자 · `role:"reviewer"` 는
  `bad-args` · 앨범에 없으면 `unknown-role` · 읽기 등급 작업형은 `role-read-only`). 작업자 · 판정형은 **Run 의 저장소 신원이 그대로일 때만** 뜬다(`repo-changed`).
  CLI · 종류는 Attempt 사본에 고정(바뀌면 다음 턴 `role-changed` · 지우면 `role-removed`), 나머지는 턴마다 지금 값. **수락 규칙**(판정형 역할 R 의
  pass N — 수락 순간의 지금 앨범 구성)을 못 채우면 조정자 수락은 `accept-rule-unmet{unmet[], reviewsLeft, hint}`, 사람 수락은 넘고 산출물에 면제
  (`waived[]`)를 적는다. 반려 수가 되돌림 한도를 넘으면 다시 띄우기가 `rework-limit`.
  **판정형(검토자)**(`orchestration/review.rs`)은 Task 의 현재 보고 커밋을 읽기만 하는 **역할 기반 보조 검토 — 독립 보증이 아니다**(같은 계정 ·
  이름표 토큰). 작업자 수명과 따로(Task 상태 · `current_attempt` 안 바꿈 · 작업자 한도 밖 · 보고당 · Run 당 동시 하나 · 총 `maxReviews`), 대상 report/OID 고정,
  보고 교체 · 반려 · 취소 · 수락이 무효화(늦은 판정은 `stale`). 실행은 작업자 권한 모드와 **무관한 고정 인자 · 헤드리스 턴**(3차 2단계 — `orchestration/turn.rs` 의 판정형 줄:
  Claude `-p --output-format stream-json --verbose --setting-sources "" --tools Read,Grep,Glob --settings {disableAllHooks} --permission-prompts none --strict-mcp-config`
  + 지침 턴 파일 `--append-system-prompt-file`(고정 문장 + 전역 CLAUDE.md 를 읽기만) · Codex `-a never exec --json -s read-only --ignore-user-config --ignore-rules
  --disable plugins --disable hooks --skip-git-repo-check` — 세션 · PTY · 타일 · 붙이기 없음 · 턴(= 프로세스)이 끝나면 끝 · 판정 없이 끝나면 종결) · cwd = 서버 빈 폴더 ·
  보고 커밋은 Run 자리의 분리 HEAD 읽기 자리(추적 symlink 가 밖이면 거절 `symlink-outside`). 조정자 수락은 지금 앨범 구성의 수락 규칙이 정한다.
  **검증 글자 · 다섯 한도는 시작 때 고정**하고 도중에 바꾸지 않는다. 영속 Run 은 판 4만 읽고 미지원 판은 건너뛴다(로그 한 줄) · 앨범 없는 Run 은 실행 · 수락 · 검증을 못 한다(`run_without_album_is_inert`).
  GUI `write` op 는 입력 출처(`keyboard`·`paste`·`protocol` — 프런트 `src/lib/term/input-source.ts`)를 싣는다(원격 웹의 크기 주인 판정 — 터미널 응답은 사람 입력이 아니다). 작업자 타일이 없으므로 개입 잠금도 없다(3a).
  **작업자 생성 주체는 AI(조정자의 `spawn_worker`)** 이고, 세션 서버가 **GUI 요청 없이 띄우는 것은 둘뿐**이다 — ① **헤드리스 턴**(작업자 · 해결자 · 판정형 모두 —
  셸 없는 CLI 하나 · 파이프 · 표준 입력 즉시 EOF · 창 없음 · **생성과 동시에 Job** · 세션 · PTY · 타일 아님 — `server/workers.rs` 의 `run_turn_blocking` · 턴 = 프로세스 하나 ·
  이어지는 지시는 같은 대화의 resume 턴 · 실행 시한 = 시작 때 고정한 `Run.limits.turn_minutes`)
  ② **수락 전 검증 명령**: 사람이 [새 앨범](Tauri)에서 정한 한 줄(시작 때 Run 에 고정)을, 통합 후보마다 **사람이 [검증 실행] 으로 확인했거나 사람이 켠
  '검증 자동 실행' 범위 안에서** Run 전용 검증 worktree(분리 HEAD)에서 `cmd /d /s /v:off /c` 하나로(PTY · 세션 아님 · 실행 전 Job 귀속 ·
  시한 · 최소 환경 허용 목록 — `orchestration/verify.rs` · `server/os.rs` 의 `verify_spawn`). 헤드리스 턴과 검증의 OS 몸은 `server/os.rs` 의 `spawn_in_job`
  하나 — **`SPAWN_LOCK` 아래**, 헤드리스 턴의 환경은 PTY 와 같은 공용 정화(`pty::scrub_env_names`)(시험 `server_spawns_only_turns_and_verify` ·
  `headless_spawn_holds_spawn_lock` · `headless_env_uses_tile_scrub` · `verify_command_only_from_album_start`).
  ③ **사이드 채팅 프로세스는 GUI 요청(사람 창(집 PC 주 창 · 원격 웹 창 — 보조 창 제외) Tauri 명령 → 서버 op `side_chat_open` · `side_chat_send`)으로만 선다.** 셸 없는 CLI 하나 · 고정 인자 ·
  같은 `spawn_in_job` · 공용 정화. stdin 에 닿는 것은 **사람이 보낸 글(+앱 고정 연결 머리글 · 사람이 첨부한 그림 — 서버가 앱 첨부 폴더 안 · 그림 형식 · 10 MB · 8장으로 다시 확인)과 사람의 권한 결정**뿐 — MCP · 오케스트레이션 · AI 문자열에서
  stdin 으로 가는 길은 없다(`server/side_chat.rs` — 첫 보내기 때만 띄움 · 프로세스 몸은 공용 코어 `server/chat_proc/` · `Stdin::Pipe` 는 이것만 · 시험 `side_chat_stdin_only_human` · `side_chat_env_uses_tile_scrub`). 그 MCP 는 프로세스 세대마다의 **채팅 토큰**(`chat_token.rs` — 세션 읽기 도구 일곱만 ·
  사람이 연결 칩으로 고른 세션 하나만 · 읽기 권한은 기존 그대로 · 판정은 호출마다 서버 · 값은 그 프로세스의 임시 `--mcp-config` · 환경에만 — 시험 `chat_token_never_reaches_frontend`). 외부 MCP 는 **사람이 설정에서 사이드 채팅에 고른 서버만**(세션 서버가 저장된 설정을 직접 읽는다 — op 에 목록 칸 없음 · 사용자 CLI 설정의 서버는 여전히 안 실림 · 비밀 값은 AI 타일과 같은 브로커 — 시험 `side_chat_ops_take_no_server_list`), '묻지 않기' 는 서버마다 설정(Tauri)에서만 —
  알고 받은 한계: 연결 칩을 붙인 채팅에서 AI 가 읽은 터미널 내용이 그 서버로 나갈 수 있다(2026-10-25).
  ④ **프로듀서 채팅 프로세스**(오케스트레이션 탭의 프로듀서 채팅 잎 — 사이드 채팅과 같은 프로세스 코어 `server/chat_proc/` 위의 별도 레지스트리
  `server/producer/`)도 **GUI 요청(Tauri → 서버 op `producer_album_start` · 귀속 채팅의 `producer_chat_send` — `producer_chat_open` 은 resume · adopt 만, 띄우지 않는다)으로만 선다.** 셸 없는 CLI 하나 · 고정 인자 ·
  같은 `spawn_in_job` · 공용 정화 · cwd = **그 앨범의 저장소**(Claude — 서버가 Run 에서 읽음 · op 몸의 경로를 믿지 않는다) · Codex 는 **서버 빈 폴더**(신뢰된
  저장소의 `.codex/config.toml` 이 MCP · 훅 · 실행 정책을 들여오지 않게 — 저장소 경로는 앱 고정 지침으로). [오케스트레이션으로 이어 가기](AI 타일 메뉴)는 그 타일
  대화를 **앨범 시작의 fork 갈래에서 갈라 온다**(원래 타일은 그대로 · `producer_fork_probe{agent, conv}` 가 기록된 cwd 의 git toplevel(주 저장소)을 정함 →
  그 저장소로 잠긴 [새 앨범] 초안 → 사람이 구성 · 첫 말을 보냄 · 시작 때 서버가 저장소를 다시 정해 다르면 `out-of-scope:repo`(시험 `producer_fork_repo_from_conversation`) · Claude `--resume --fork-session` · Codex `thread/fork`) — 갈라 온 **Codex** 프로듀서의 첫 사람 글 앞에는 **앱 고정 지침 머리글**(틀 + 프로듀서 고정 지침 ·
  끼우는 것은 서버가 Run 에서 읽은 앨범 저장소 경로와 runId 뿐 — 사이드 채팅 ③ 의 연결 머리글과 같은 종류 · 짓는 곳 `launch::album_fork_brief` 하나 · 붙이는 곳 전송기 하나 · AI 문자열 없음 ·
  실측 P6: 지침 없이 시작한 대화를 `thread/fork` 하면 `developerInstructions` 가 서지 않는다 · 시험 `producer_fork_brief_fixed`). **사람 입력과 깨움은 서버의 단일 전송 예약 경로를 사용한다. CLI에 보냈지만
  아직 턴 시작이 확인되지 않은 입력도 실행 중으로 취급하며, 전송 예약 전에 접수된 사람 입력을 깨움보다 우선한다. interrupt는 대상 턴의 대기 요청을 취소하고, 취소된 요청의 늦은
  응답은 깨움 확인 범위를 전진시키지 않는다. 깨움의 전송·확인·재시도와 Run별 누적 한도는 프로세스 재시작이나 adopt로 초기화하지 않는다**(`dispatch` 하나 — 대기열 · clientId 중복 제거 ·
  시험 `producer_stdin_only_human_or_wake`). **앱이 깨움 — 깨움 메시지는 전용 모듈의 생성·검증 경로를 거친 WakeNote를 wake_text 한 곳에서 직렬화한다. 재료는 해당 Run에 속하는
  서버 발급 ID, Run 세대, 사건 번호와 허용된 열거 값뿐이다. ID는 run-/task-/att- 접두사와 32자리 소문자 hex 형식을 각각 검사한다. 제목·설명·보고·판정·대화·명령·경로·오류 상세 등
  자유 글은 싣지 않는다. 열거 값은 AI의 보고에 영향을 받을 수 있으며, 사람의 지시나 승인으로 취급하지 않는다**(재료 · 판정 · 장부 = `orchestration/wake.rs` — 장부 줄의
  `(actor, action, outcome, target)` 허용 목록(사람의 `album_changed` → `album-changed` 포함) · 시험 `wake_text_takes_no_free_text` · `wake_only_from_ledger` / 시계 · 세 걸음(L4 예약 → L1 판정 · 장부 → L4 같은 전송기) =
  `server/producer/wake.rs`). 깨우는 때는 Run running(보류 없음) · 그 자리가 지금 세대로 묶임 · 프로듀서가 쉼(대기열 빔 · 보류 없음 · 권한 대기 없음)뿐이다 — 사람 일시정지 ·
  보류 · 조율 한도면 깨우지 않는다. 상한: **사람 말 사이 = `Run.album.wake_max`**(기본 30 · 0 = 끔 · 0~200 · [새 앨범] · 사람의 [앨범 권한] 편집뿐 · 원격은 올림만 REAUTH · 앨범 없음/판정 실패면 깨우지 않음) ·
  앨범당 누적 200 고정(`Run.wakes` — 칸 없음 · 초기화 없음) · 최소 간격 20초 · 무반응 3 범위 · 재시도 1 — 꺼지면 사람 알림(`wake-limit` · `wake-ignored` · `wake-failed` ·
  `wake-turn-timeout`). 타일에는 깨움이 없다(타일 PTY 에 쓰는 길 없음 — 타일은 조정자 자리가 되지 못한다). 제어 프레임(결정 · 끊기 · 모델 · 강도)은 사람 op 에서만 — 깨움 턴 시한(30분)의
  끊기 하나는 시계가 깨움 턴에만 붙인다. **프로듀서는 직접 파일을 변경하거나 읽기 전용 실행 경계를 벗어날 수 없다. Claude에는 Read·Grep·Glob만 제공하고, Codex에는 읽기 전용 샌드박스 안의 읽기 작업만 허용한다. 파일 변경·실행 경계 확대·외부 MCP·웹 검색은 프로듀서 권한 카드로도 허용하지 않는다. AYNX의 읽기·작업안·조율 도구는 각 서버 관문의 기존 권한 검사를 받는다. producer_chat_*의 원격 허용은 이 제한을 넓히지 않으며, 본문은 해당 프로듀서 채팅의 유효한 구독 연결에만 전달한다**
  (Claude `--setting-sources ""` · `--strict-mcp-config` · `MCP_TOOL_TIMEOUT` · Codex `approvalPolicy: never` · 웹 검색 끔 · `windows.sandbox` · `notify=[]` · 이름으로 끌 수 없는 사용자 MCP 면
  띄우지 않음 · **사람이 [허용] 할 수 있는 카드는 앨범 저장소 밖 Read · AYNX DB 읽기 도구 둘뿐 — 그 밖 승인 요청은 어댑터가 카드 없이 거절**(`side_chat::guard` · 시험
  `producer_approval_allowlist`) · DB 읽기 카드는 Claude 만이고 **Codex 는 `db_query` 를 미리 허용한다**(`never` 에서 미리 허용 밖 MCP 도구는 묻지 않고 실패한다 — 행을 읽을지는
  서버의 연결 AI 권한이 정한다 · AI 타일과 같은 등급) · `producer_chat_*` 원격은 ALLOW). 배달: 사건은 방송하지 않고(`RELAYED` 밖) GUI 라우터(`server/producer_proxy.rs` `route`)가 사건 몸의
  `(창, subGen)` 구독 가운데 이 GUI 가 같은 채팅의 Channel 을 쥔 산 창에만 보낸다(원격 창 Channel 은 `remote::bridge` 가 그 ws 로 · 시험 `producer_subs_route` · `producer_subs_gen`) ·
  창이 사라지거나 다시 뜨면 GUI 가 그 순간 쥔 그 창의 `subGen` 만 서버에서 뗀다(op 몸 `producerSubs` — 같은 라벨의 새 페이지가 건 구독은 남는다) · 보내기가 실패한 통로(느린 수신자)는
  그 구독만 걷는다 · 원격 창 · 탭이 떠난 창은 구독만 풀고 채팅을 닫지 않는다 · 권한 결정은 여러 창에서 와도 한 번만 먹는다(시험 `producer_subs_windows_gen` ·
  `producer_slow_receiver_alone` · `producer_two_windows_one_decision`) ·
  앱은 토큰 · 볼트 값을 사건 · 스냅숏에 구조적으로 싣지 않는다. 작업자는:
  Run 이 만든 worktree(Git 훅 끔 · Run 의 자리 안 · 곁 기록 `worktrees.json` 쓰기는 프로세스 간 파일 잠금) 에서 **셸 없이 CLI 를 헤드리스 턴으로**
  (인자 배열 = 옵션 → `--` → `[` 로 시작하는 지시 · 사용자 추가 인자 없음 · 그 턴의 작업자 토큰만 · 비대화형 — Claude `-p … --permission-prompts none` ·
  Codex `-a never exec --json` · Codex 쓰기형은 네트워크 켬) 띄우고 효과 직전 지금 앨범 구성 · 신원을 다시 본다 — 상태는 `running`(턴이 돈다) → 턴 끝에
  보고가 있으면 `reported`(닫힘) · 없으면 `idle`(열림 — `blocked` 표지 가능 · worktree 쥠 · 동시 자리 안 차지) · 중단은 트리 종료 확인 뒤에만 `stopped`
  (`server/workers.rs` · `orchestration/{spawn,attempts,resume,roles,worktree}.rs`).
  작업자 worktree 의 기준은 **Run 통합 머리**(조정자의 `base` 인자는 거절). **수락 = 서버가 Run 통합 ref(`refs/aynx/orch/<run16>/int` — id hex 앞 16자(경로 길이),
  비브랜치, 사람용 브랜치 `orch-<run8>-int` 는 앨범 판 [브랜치로 내보내기] · Run 완료 때)에 Task 마다 squash 커밋 하나**를 `merge-tree`(속성 출처 =
  old 트리) → `commit-tree` → **의도 저장 확인 뒤** `update-ref --stdin` 트랜잭션(통합 ref + 완료 증거 + 보고 커밋 보존 ref)으로 쌓는 것 — 조정자에게는
  **비동기**(`wait_run{until: settled}`). 병합 드라이버 · `merge.default` · 필터(LFS) · renormalize · submodule 저장소는 통합 전에 거절(드라이버 ·
  필터가 돌지 않게), 충돌이면 Task `conflict`, 예상 밖 통합 ref 변경은 Run 보류 → 사람의 [조정]. **main 병합은 사람의 [병합] 또는 사람이 앨범마다 켠 자동 병합으로만 — AI · MCP 에는 길이 없다**(`orchestration/{accept,merge,integrate}.rs` · 병합 몸 `album_merge.rs` — `git merge --no-ff` · 스쿼시 없음 · push 없음 · 훅 끔 · 검사가 막으면 안 한다 · 자동은 완료 뒤 한 번 · 재시도 없음 · 켬은 넓힘 + 위험 확인 + 검증 명령 필수 · 시험 `album_merge_has_no_mcp_path`).
  **보관함**(`orchestration/store/archive.rs` — 사람의 Tauri 명령뿐 · MCP 없음 · 옛 orphaned [닫기]가 이 보관이다): 끝난 앨범을 `archived/` 로(남은 작업자 worktree · 서버 임시 자리가 있으면 거절) · 복원은 끝난 기록으로만(프로세스 · 토큰 · 묶음 없음) · 영구 삭제(원격 REAUTH)는 이 앨범의 ref 먼저 다음 파일 — 내보낸 브랜치는 그대로.
  **정리**(`orchestration/cleanup.rs`): 서버 임시 자리(검증 · 검토 worktree · 검토자 빈 cwd)는 끝난 Run · orphaned 에서 서버가 지우되 소유(곁 기록
  `role` · Run 장부) · 실제 경로 · 프로세스 0 · **쉬는 상태와 같을 때만**(아니면 남기고 `cleanup-pending`) · 재시작 = 재정리, 작업자 worktree · 보존 ref ·
  통합 ref 는 사람 [정리]만. **어느 worktree 를 지우든 안의 정션 · 링크를 링크만 먼저 걷는다**(`git worktree remove` 는 정션을 따라간다).
  여러 저장소를 함께 만지는 명령은 `session_commands.rs`.
  ③-3c 부터 MCP·`mcp.json`·거울·라우팅·작업안·실행기·감사는 **세션 서버**(`server/ai.rs`)에 산다 — GUI 는 같은 이름의 명령
  프록시(`server/ai_proxy.rs`). `/mcp` 와 `/agent-signal` 은 한 루프백 리스너(경로별 문지기·토큰·상한 분리), 서버 재시작 = 새 포트·토큰.

**세션의 표·임대는 `session_core` 가 쥔다.** 세션은 스트림(`historyStreamId`) 열쇠와 회차·임대(`sessionEpoch`·`leaseEpoch`)로
살고, 창은 임대만 빌린다 — 페이지 리로드·웹뷰 크래시는 임대만 풀고(새 페이지가 다시 붙는다 — 로컬·SSH 모두), 창 파괴·타일
닫기만 세션을 끝낸다. 옛 임대의 호출은 `[stale-lease]` 로 거부된다 →
[docs/log/2026-10-08-session-core-local.md](docs/log/2026-10-08-session-core-local.md).
임대(주)는 하나 그대로이고, 그 밖에 **시청자**가 빼앗지 않고 덧붙는다(원격 웹 R2-A — `session_core/viewers.rs` 머리말: 쓰기는 둘 다 ·
닫기는 주만 · 크기·터미널 질의 응답은 마지막 사람 입력의 쪽 · 느린 시청자는 생산자를 세우지 않고 떨어져 재동기화).


**로컬 PTY·SSH 세션은 세션 서버 프로세스(`aynx session-server`, `src-tauri/src/server/`)에 산다** — GUI 의 세션 명령은 `server/proxy.rs` 의 같은 이름 파이프 프록시이고, 출력은 이진 프레임 + ACK 크레딧이다. GUI 종료·강제 종료·마지막 창 X(quitAll)는 임대만 풀어 셸이 살고 다시 켜면 복원이 붙는다. **마지막 창을 닫으면 GUI 는 기본으로 트레이에 남는다**(`[app] tray_on_close`, Windows — 나머지 OS 는 스텁이라 GUI 종료). **복원이 데려가지 않은 세션은 닫지 않고 "떨어진 세션" 목록에 남는다**([새 탭에 붙이기]·[닫기] — 독·세션 판·트레이·부팅 안내). 타일·보조 창 닫기와 트레이 [모든 세션 종료](세션·서버·GUI 모두)만 세션을 끝낸다. 서버는 세션 0·클라이언트 0·작업안 0 이 10분이면 자진 종료한다. 볼트·신호·브로커·SSH·MCP·거울·작업안도 서버(③-3a~c) — GUI 에 남는 것은 창·렌더링·승인 버튼·알림(사전 정책 자동 승인의 시계는 서버 `operations/auto.rs` — 서버 안 `approve_in(method: auto)` 하나, 파이프 승인 프레임 아님, 사람이 검토 중인 작업안은 GUI 가 `ops_reviewing` 으로 알림 · 창 0개 = 볼트 잠금이라 `vault_passphrase` 헤드리스 대상의 무인 실행은 실패한다) → [docs/log/2026-10-09-session-server-local.md](docs/log/2026-10-09-session-server-local.md).

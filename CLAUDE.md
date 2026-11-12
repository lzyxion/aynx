# Aynx

*A Hyprland-style workspace for AI coding agents.* — **Hyprland 감성의 AI 코딩 에이전트 작업 공간.
Claude Code · Codex 를 셸 · SSH 세션 · 파일 · DB 와 나란히 타일로 띄우는 데스크톱 앱.**

Tauri 2 + Svelte 5 로 만든 **개인용 AI 코딩 에이전트 작업 공간**(Windows 11 / WebView2).
터미널 에뮬레이션은 xterm.js 에 맡기고, 세션 수명·다중 세션 UI 는 Rust 가 쥔다.
지금은 **Windows 11 만 지원**하고 **Linux · macOS 지원은 미정**이다(나중에 지원할 수 있어 아래 규칙은 유지한다 — 사용자 결정) — OS 를 타는
코드는 **Rust 함수 하나** 안에 모아 `#[cfg(...)]` 로 몸통만 가르고, 아직 구현하지 않은 OS 는
**명시적 `None` 스텁**으로 남긴다(그 스텁이 곧 문서다). 프런트는 OS 를 알면 안 된다 —
표준 프로토콜이 먼저이고 OS 조회는 폴백이다 (`src-tauri/src/cwd.rs` 가 본보기).
표시명은 `Aynx`, 코드 · 경로 식별자는 `aynx`, 환경 변수는 `AYNX_*` 다.

세부 규칙은 아래로 링크만 한다 — **여기에 다시 적지 않는다.**
- [docs/conventions.md](docs/conventions.md) — **두 번 이상 깨진** 코드 규칙만 모은 곳.
- [docs/invariants.md](docs/invariants.md) · [docs/architecture.md](docs/architecture.md) — 보안 제약과 아키텍처의 전문.
- [scripts/dev/README.md](scripts/dev/README.md) — CDP 로 앱을 조작·캡처하는 검증 도구.

코드 주석과 문서가 가리키는 `docs/log/…` · `docs/verification/…` 는 **비공개 작업 기록의 이름**이다 — 공개 저장소에는
없다. 규칙 자체는 이 파일과 위 문서들에 있다.

비공개 작업 지시(노트 저장소에 있을 때만 불러와진다 — 파일이 없으면 Claude Code 가 이 줄을 무시한다):

@docs/internal/CLAUDE.private.md

## 커밋 전 게이트 (필수)

프런트를 건드렸으면 다섯 다 통과해야 커밋한다:

```
npm run check && npm run build && npm test && npm run check:cycles && npm run check:bundle
```

`check:bundle` 은 방금 만든 릴리스 번들(`build/`)에서 **선언 없는 대입**(strict ESM 에서 ReferenceError)을
찾는다 — 그래서 `build` 뒤에 둔다.

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
NSIS 는 현재 사용자 설치).
CI: main push · PR 마다 `.github/workflows/ci.yml` 이 위 게이트를 Windows 러너에서 돌린다. 공개 릴리스는 태그 `vX.Y.Z` push →
`release.yml` 이 게이트 · 버전 대조(package.json · tauri.conf.json · Cargo.toml) 뒤 설치 파일 둘 + SHA-256 을 **초안**으로 올린다 —
"What's new" 를 채우고 사람이 공개한다.

## 작업 방식

**재발을 실제로 보기 전에는 방어 기계(자가 회복 등)를 미리 늘리지 않는다** — 최소 수정 우선.
(ConPTY 건에서 확인된 원칙 — 그때 자가 회복은 되돌리고 진단 카운터만 두었다.)

## 핵심 함정 (한 줄 + 링크)

- **GUI 는 한 개** — single-instance 플러그인이 둘째 실행을 첫 창 포커스로 돌리고 끝낸다(identifier 로 개발/릴리스 구분 —
  **다른 워크트리의 개발 앱 둘은 동시에 못 뜬다**). `mcp::start` 는 setup 에서라 둘째 실행이 `mcp.json` 을 덮지 않는다. 둘째 실행은 플러그인 앞의
  문(`single_instance_gate.rs`)을 지나고 플러그인 콜백은 메인 스레드 밖에서 미룬다(부팅 중 WM_COPYDATA 교착).
- **세션 서버는 진입 첫 줄에서 물려받은 "Ctrl+C 무시" 를 걷고(`server/os.rs::enable_ctrl_c_for_children`), `CREATE_NEW_PROCESS_GROUP` 으로
  띄우지 않는다.** 그 속성은 콘솔이 없어도 ConPTY 셸까지 상속돼 키보드 Ctrl+C 가 셸을 못 끊는다(개발 앱은 npm→cargo 사슬에서 이미 그렇다 —
  진단은 PEB ConsoleFlags bit0).
- **웹뷰 렌더러가 죽으면 앱이 페이지를 다시 읽는다**(`webview_crash.rs` — F5 와 같은 재부착, 60초에 3회면 크래시 고리로 보고 멈춤).
  생존·복구 보장은 `scripts/dev/survival/run.mjs <행>` 하네스가 행마다 판정한다.
- **번들 문법 수준은 `build-target.js` 하나(es2021)** — 기본 es2020 이면 esbuild 압축이 xterm `requestMode` 의 `let` 을 떨어뜨려 vim(DECRQM) 에 릴리스 타일만 영영 멈춘다.
- **개발 빌드는 릴리스와 따로 산다** — `npm run tauri dev`(디버그 빌드)는 `%APPDATA%\aynx-dev` ·
  `~/.aynx-dev` · WebView2 `io.github.lzyxion.aynx-dev` · MCP 서버 이름 `aynx-sessions-dev`(릴리스 `aynx-sessions`) 를 쓴다(스위치는
  `cfg!(debug_assertions)` 하나, 결정은 `src-tauri/src/instance.rs` 한 곳 — 앱 소유 경로는 전부
  `instance::{config,data,home}_root` 를 거친다). 개발 폴더가 처음 뜰 때 릴리스의 비밀이 아닌 설정을 한 번
  복사한다(볼트·토큰 제외, 다시 받으려면 폴더를 지운다).
- **Tauri 명령은 기본 `async fn`.** 동기 명령이 UI 스레드를 오래 잡으면, 관계없는 **살아 있는
  다른 세션의 출력이 영구히 침묵**한다. 동기는 예외이고 근거 주석이 붙는다 →
  [docs/conventions.md](docs/conventions.md) 의 "Tauri 명령은 기본 async fn" 절.
- **로컬 PTY 생성은 `SPAWN_LOCK` 으로 직렬화.** Windows ConPTY 동시 생성 경쟁(자식이 파이프
  핸들을 교차 상속 → 출력 파이프 사망, 빈 검은 타일).
- **메뉴 항목은 menu-runner 통로 하나를 거친다** (`src/lib/browser/menu-runner.ts` 의
  `runOnMenu`): 스냅샷 → 닫기 → 실행. 순서를 뒤집으면 항목이 조용히 죽고 화면엔 흔적이 없다 —
  **항목을 추가했으면 콘솔을 한 번 열고 눌러 본다** →
  [docs/conventions.md](docs/conventions.md) 의 "메뉴를 닫는 코드" 절.
- **키바인딩(`src/lib/keybindings.ts`):** 조합 문자열은 `ev.code`(물리 키, IME 안전)로만
  만들고 수식 순서는 `Ctrl → Alt → Shift` 고정. 전역 타일·창 조작은 대개 **`Ctrl+Shift` 계열**,
  타일 간 포커스는 `Alt+화살표`·이동은 `Alt+Shift+화살표`·확장은 `Ctrl+Alt+화살표`,
  독 칸 여닫기는 `Ctrl+Shift+H · J · K` = 호스트 · 프로젝트 · DB(id `open-*-dock`).
  **`Ctrl+Alt+화살표` = 타일 크기 조절**(분할선 밀기 · 이동과 함께 Hyprland dwindle 과 같다 · 키는 사용자 결정 ·
  인텔 드라이버 회전 핫키가 켜진 PC 에서는 OS 가 선점하니 설정에서 다시 묶는다). 점프(`Ctrl+↑/↓`)는 그대로. Meta(⊞) 는 v1 에서 무시. id 는 `settings.toml` 키라 **바꾸면 안 된다**
  (라벨만 바꾼다). 검색은 `Ctrl+F`(이 터미널)·`Ctrl+Shift+F`(전체) — 앱이 가로채므로 셸의
  readline·vim 의 `Ctrl+F` 에 닿지 않는다(알고 한 선택, 설정에서 되돌린다).
  SFTP 는 `Ctrl+Shift+O`.
  테마 프로필 전환은 `Ctrl+Shift+U`(리눅스 IBus 유니코드 입력과 겹침 — 알고 받음).
  앱이 뜻을 두지 않은 **브라우저 가속키**(`Ctrl+P` 인쇄 등)는 `isBrowserChromeCombo` 목록
  하나로 막는다(새로고침·개발자 도구는 일부러 살려 둔다).
- **네이티브 우클릭 메뉴는 창 전역에서 막는다** — 앱 메뉴(이미 `preventDefault` 한 것)와
  편집 필드(`.xterm` 제외)만 예외. 판정은 `keybindings.ts` 의
  `shouldBlockNativeContextMenu` 하나이고, 창 리스너는 **버블 단계**여야 앱 메뉴가 산다.
- **용어:** 사용자 문구는 **창 > 워크스페이스 > 탭 > 타일 > 세션** · 호스트 · 파일 —
  [docs/conventions.md](docs/conventions.md) 의 용어표.
  터미널 우클릭 설정 라벨에 **'PuTTY식' 문구를 쓰지 않는다** — '메뉴 / 복사·붙여넣기'.

## 보안 제약 (불변 — 사용자 명시)

전문은 [docs/invariants.md](docs/invariants.md) 에 있고 그 문장이 기준이다. **아래 영역의 코드를 건드리기 전에 해당 절을 먼저 읽는다.**
이 한 줄들은 사용자가 명시한 불변이라 바꾸려면 사용자 결정이 필요하다.

1. **Aynx 세션 서버는 CLI 전역에 등록하지 않는다** — Aynx 가 띄우는 로컬 AI 타일 · 감싸개가 있는 로컬 셸 타일에만 실리고 MCP 토큰은 사용자 CLI 설정 파일에 없다. `src-tauri/src/agent_tile.rs` · `mcp/` → [전문 1](docs/invariants.md#inv-1)
2. 비밀번호·키 암호구는 **사용자가 켠 볼트에만** 저장한다(예외 있음 — DB 빌린 값, 전문 8). **볼트 값은 세션 서버 프로세스 밖으로 나가지 않는다** · **값을 돌려주는 op 는 없다** · **가림막이 걸리면 볼트도 잠기고, 가림막을 걷는 것이 곧 볼트를 여는 것이다**(건너뛰는 길 없음). 헤드리스 위임은 기본적으로 볼트를 쓰지 않는다(`vault_passphrase` 를 켠 호스트만 예외).
   **위임의 편집은 호스트 폼 · 타일 AI 권한 팝오버(둘 다 Tauri 명령)뿐이고 MCP 에는 위임·권한을 바꾸는 도구가 없다** · **Run(앨범)은 사람이 [새 앨범]에서 첫 말을 보내는 Tauri 명령 `producer_album_start` 로만 열린다** · **범위는 사람만 정한다 — AI · MCP 에는 앨범을 열거나 구성을 넓힐 길이 없다** · **아티스트는 권한 없는 프로필**.
   **원격 세션의 AI 권한은 호스트 하나**, 로컬 타일은 타일별 읽기 허용만. `src-tauri/src/vault.rs` · `orchestration/` → [전문 2](docs/invariants.md#inv-2)
3. **예외 하나 — 외부 MCP 서버 환경변수(볼트 `mcp_env`).** 볼트가 열려 있는 동안 세션 서버의 브로커가 `aynx mcp-run` 도우미를 거쳐 평문으로 넘기므로, 이 값은 같은 계정의 프로세스(그 타일의 AI 에이전트 자신 포함)에 노출된다고 본다 — 알고 받은 한계. 디스크·설정 파일·프런트·MCP RPC 에는 값이 없다. → [전문 3](docs/invariants.md#inv-3)
4. **앱은 사용자가 명시적으로 위임한 범위 안에서만 실행한다** — 그 자리 사람 승인, 또는 **범위·한도가 명시된** 사전 정책. 원시 `send_command` 는 만들지 않는다 · **AI 문자열→PTY 길은 없다** · AI 는 자기 실행을 **자가 승인 못 한다**(승인 등급 프레임은 `approve_operation` 하나). AI 자유 글을 실행 재료에 싣는 길은 오케스트레이션 작업자·검토자의 헤드리스 턴뿐이고 프로듀서 채팅에는 깨움 메시지만 더 들어간다(예외 있음 — 전문). 검증 문자열은 사람만 설정한다. `operations/auto.rs` · `src-tauri/src/orchestration.rs` → [전문 4](docs/invariants.md#inv-4)
5. 세션 로깅은 기본 꺼짐, **세션별 옵트인**. → [전문 5](docs/invariants.md#inv-5)
6. **메신저 웹훅 URL 은 채널마다 자기 파일(`<설정 루트>/discord-webhook` · `<설정 루트>/slack-webhook`)에만** — 프런트·MCP·로그·`Debug` 로 나가지 않고, 멘션은 늘 막는다. → [전문 6](docs/invariants.md#inv-6)
7. 포트 포워드는 **127.0.0.1 전용**. `port_forward.rs` → [전문 7](docs/invariants.md#inv-7)
8. **DB 비밀번호는 볼트 `db_password`(대상 = DB 연결 id)에만 저장한다** — 예외 있음: 그 연결의 사람 쿼리 타일이 붙어 있는 동안 인증한 값을 세션 서버 메모리에 빌려 AI 연결이 쓴다(전문). AI 는 사람이 준 연결별 AI 권한 안에서 **사람 타일과 따로 연 AI 전용 읽기 전용 연결**로만 읽고(**Read 이상이면 조회 결과 행이 모델 제공자로 간다**), **AI 의 쓰기는 작업안뿐**. 타일 없이 볼트 값으로 새로 여는 것은 헤드리스 위임이 켜진 연결만. `src-tauri/src/db/` · `db/borrowed.rs` → [전문 8](docs/invariants.md#inv-8)
9. **타일 토큰은 Run 을 열지도 이어받지도 조율하지도 못한다** · **조정자 토큰은 없다 — 조정자는 프로듀서 채팅의 채팅 토큰(종류 `producer`)에 서버 표가 붙인 역할** · **역할 토큰 · 타일 토큰 · 채팅 토큰은 같은 계정 안의 보안 경계가 아니다**. 토큰 값은 프런트·로그·`Debug`·영속 파일에 나가지 않는다. `src-tauri/src/tile_token.rs` · `chat_token.rs` → [전문 9](docs/invariants.md#inv-9)
10. **대화 기록이 MCP 로 나가는 길은 조정자 `read_worker` 하나 — 자기 Run 작업자의 고정 대화만**. → [전문 10](docs/invariants.md#inv-10)
11. **원격 타일에는 MCP 토큰을 주지 않는다 — 신호 전용 토큰(스트림별)만.** 원격 **셸에는 스트림 id 만** 넘기고, 신호 토큰은 **파이프·GUI 를 지나지 않는다**. 로컬 MCP 토큰은 감싸개 셸 타일 · AI 타일마다 따로이고 권한 결정 토큰은 신호 토큰과 따로다. `ssh/open.rs` · `src-tauri/src/remote_signal_file.rs` → [전문 11](docs/invariants.md#inv-11)
12. 에이전트 포워딩은 **호스트별 옵트인(기본 꺼짐)**, 헤드리스 위임 접속에는 없다. → [전문 12](docs/invariants.md#inv-12)
13. **원격 웹 클라이언트는 tailnet 안 브라우저만** — 관문은 **127.0.0.1 에만** 묶이고 노출은 `tailscale serve`(Funnel 길 없음), **앱 명령의 문은 `remote/deny.rs` 하나**. 볼트 값·MCP 토큰·웹훅 URL 은 원격으로 나가지 않는다. `src-tauri/src/remote/` → [전문 13](docs/invariants.md#inv-13)
14. OS 자격증명 저장은 **(닫힘) OS 저장소 대신 자체 볼트** — 나중에 붙인다면 볼트 **키를 감싸는 자리**(`protect_key_bytes`)가 그 문이다. → [전문 14](docs/invariants.md#inv-14)

## 아키텍처 한눈에

**고칠 파일은 지도에서 먼저 찾는다** — 백엔드 [docs/modules.md](docs/modules.md) ·
프런트 [docs/modules-frontend.md](docs/modules-frontend.md) (층별 표 · 현재 층 위반 · "어디를 고치나").
불변식은 각 파일 머리말에 있다. 아래는 방향만 잡는 몇 줄이다.
전문은 [docs/architecture.md](docs/architecture.md).

**프런트 (`src/lib/`)**
- 큰 모듈은 폴더로 나누고 **옛 경로를 배럴로 남긴다** — 자식은 배럴을 부르지 않는다
  (규칙: [docs/modules-frontend.md](docs/modules-frontend.md) 의 "배럴 규칙").
- 타일 배치는 **이진 분할 트리**: 순수 트리·스펙은 `session/`(`spec.ts` · `tree.ts` · `tree-edit.ts` …,
  `session.ts` 는 배럴), 순수 기하는 `layout.ts`, 둘 다 필요한 조작은 `tree-ops.ts`. 키바인딩은 `keybindings.ts`.
- `app/` 은 도메인 상태 모듈(tabs · panes · sessions · hosts · prompts …), 큰 화면의 조각은
  `pane/`(PaneHost) · `term/`(Terminal) · `console/`(대시보드) · `dialogs/`(`+page` 모달) · `settings/model/`(설정 모델).
- 호스트 · 프로젝트 · 설정은 타일 트리 밖에 **떠 있는 독**이다(`Dock.svelte` + `app/dock.svelte.ts`).

**백엔드 (`src-tauri/src/`)**
- **로컬·SSH·풀·포워드·헤드리스·DB 는 모두 세션 서버 프로세스에 산다.** 볼트·신호·브로커·MCP·거울·작업안도 서버(`server/`)이고, GUI 에 남는 것은 창·렌더링·승인 버튼·알림이다. GUI 가 원격에 닿는 길은 서버 op `ssh_exec` 와 SFTP 채널 터널뿐이다 → [전문](docs/architecture.md#arch-backend)
- `mcp.rs` + `mcp/` 는 **읽기·계획 + 오케스트레이션 조율** — 명령 실행·승인·키 전송 도구는 없다 → [전문](docs/architecture.md#arch-mcp)
- 세션 서버가 **GUI 요청 없이 띄우는 것은 둘뿐**이다 — 헤드리스 턴 · 수락 전 검증 명령. 사이드 채팅 · 프로듀서 채팅 프로세스는 GUI 요청으로만 선다 → [전문](docs/architecture.md#arch-orch-spawn)
- 사이드 채팅의 stdin 에는 사람이 보낸 글과 사람의 권한 결정만, 프로듀서 채팅에는 사람 입력과 서버가 Run 장부에서 만든 깨움 메시지만 들어간다 — MCP · 오케스트레이션 · AI 문자열에서 stdin 으로 가는 길은 없다. **프로듀서는 직접 파일을 변경하거나 읽기 전용 실행 경계를 벗어날 수 없다** → [전문](docs/architecture.md#arch-orch-spawn)
- **main 병합은 사람의 [병합] 또는 사람이 앨범마다 켠 자동 병합으로만 — AI · MCP 에는 길이 없다** → [전문](docs/architecture.md#arch-orch-accept)
- **세션의 표·임대는 `session_core` 가 쥔다.** 창은 임대만 빌린다 — 리로드 · 웹뷰 크래시는 임대만 풀고, 창 파괴 · 타일 닫기만 세션을 끝낸다 → [전문](docs/architecture.md#arch-session-core)
- **AI 가 읽는 세션 거울(`context.rs`)은 창이 있으면 프런트, 없으면 세션 서버가 쓴다** → [전문](docs/architecture.md#arch-mirror)
- 마지막 창을 닫아도 세션은 산다 — **복원이 데려가지 않은 세션은 닫지 않고 "떨어진 세션" 목록에 남는다**. 타일·보조 창 닫기와 트레이 [모든 세션 종료]만 세션을 끝낸다 → [전문](docs/architecture.md#arch-server)
- 오케스트레이션(`src-tauri/src/orchestration/` · `server/producer/` · `mcp/`)을 고치기 전에 [docs/architecture.md](docs/architecture.md#arch-mcp) 와 [docs/invariants.md](docs/invariants.md#inv-4) 의 해당 절(전문 4 · 9 · 10)을 읽는다.

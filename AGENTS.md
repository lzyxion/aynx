# Aynx

*A Hyprland-style workspace for AI coding agents.* — Claude Code · Codex 를 셸 · SSH 세션 · 파일 · DB 와 나란히 타일로 띄우는
데스크톱 앱. Tauri 2 + Svelte 5(Windows 11 / WebView2) · 터미널 에뮬레이션은 xterm.js, 세션 수명 · 다중 세션 UI 는 Rust 가 쥔다.

- **Windows 11 만 지원**하고 Linux · macOS 는 미정이다. 그래도 OS 를 타는 코드는 **Rust 함수 하나** 안에 모아 `#[cfg(...)]` 로 몸통만
  가르고, 구현하지 않은 OS 는 **명시적 `None` 스텁**으로 남긴다. 프런트는 OS 를 알면 안 된다 — 표준 프로토콜이 먼저이고 OS 조회는
  폴백이다(`src-tauri/src/cwd.rs` 가 본보기).
- 표시명은 `Aynx`, 코드 · 경로 식별자는 `aynx`, 환경 변수는 `AYNX_*` 다.

세부 규칙은 링크만 한다 — **여기에 다시 적지 않는다.**
- [docs/conventions.md](docs/conventions.md) — **두 번 이상 깨진** 코드 규칙.
- [docs/invariants.md](docs/invariants.md) · [docs/architecture.md](docs/architecture.md) — 보안 제약과 아키텍처의 전문.
- [docs/modules.md](docs/modules.md) · [docs/modules-frontend.md](docs/modules-frontend.md) — 모듈 지도. **고칠 파일은 여기서 먼저 찾는다.**
- [scripts/dev/README.md](scripts/dev/README.md) — CDP 로 앱을 조작 · 캡처하는 검증 도구.

코드 주석과 문서가 가리키는 `docs/log/…` · `docs/verification/…` 는 **비공개 작업 기록의 이름**이다 — 공개 저장소에는 없다.

비공개 작업 지시(노트 저장소를 연결한 작업 폴더에만 있다 — 있으면 작업 전에 읽는다):

@docs/internal/CLAUDE.private.md

## 커밋 전 게이트 (필수)

프런트를 건드렸으면 다섯 다 통과해야 커밋한다(`check:bundle` 은 `build` 가 만든 번들을 읽으니 그 뒤에 둔다):

```
npm run check && npm run build && npm test && npm run check:cycles && npm run check:bundle
```

Rust(`src-tauri/`)를 건드렸으면 추가로:

```
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

- `cargo test` 출력을 파이프(`| head` 등)로 받으면 **SIGPIPE** 로 죽는다 — 출력은 **파일로** 받는다.
- 문서 전용 변경이면 `npm run check` 한 번으로 충분하다.
- 릴리스: 버전은 `package.json` · `tauri.conf.json` · `Cargo.toml`(과 잠금 파일)을 함께 올리고, 노트를 **태그 전에 `CHANGELOG.md` 의
  그 버전 칸**에 쓴다. 태그 `vX.Y.Z` 는 **main CI 가 성공한 커밋**에 붙인다 — `release.yml` 이 초안을 올리고 공개는 사람이 한다.

## 주석 관리

- 코드만으로 파악하기 어려운 제약, 예외 처리의 이유, 유지해야 할 동작을 주석에 기록한다.
- 작업을 마치기 전에 최종 diff와 변경 지점 주변의 주석을 검토한다.
- 구현 변경으로 틀려진 주석은 갱신하거나 제거한다. 작업 과정 메모와 해결된 TODO도 정리한다.
- 의도가 불분명한 기존 주석은 근거를 확인한 뒤 수정한다.

## 핵심 함정

파일 하나에 갇힌 함정은 **그 파일 머리말 주석**에 있다 — 고치기 전에 머리말을 읽는다. 여기에는 파일을 열기 전에 알아야 하는 것만 둔다.

- **개발 앱끼리는 한 번에 하나만 뜬다**(single-instance) — 둘째 실행은 오류 없이 이미 뜬 앱을 앞으로 가져오고 끝나는데, 그 앱이
  **다른 워크트리 것일 수 있다.** CDP 로 조작하기 전에 이 워크트리의 앱인지 확인한다. 릴리스 앱과는 함께 뜬다 — 개발 빌드
  (`npm run tauri dev`)는 폴더 · 식별자가 따로이고(`aynx-dev`), 앱 소유 경로는 전부 `src-tauri/src/instance.rs` 를 거친다.
- **Tauri 명령은 기본 `async fn`** — 동기 명령이 UI 스레드를 오래 잡으면 관계없는 다른 세션의 출력이 영구히 침묵한다. 동기는 예외이고
  근거 주석이 붙는다 → [conventions](docs/conventions.md) 의 "Tauri 명령은 기본 async fn" 절.
- **메뉴 항목은 `runOnMenu` 통로 하나를 거친다**(`src/lib/browser/menu-runner.ts` — 스냅샷 → 닫기 → 실행). 순서를 뒤집으면 항목이
  조용히 죽는다 — **항목을 추가했으면 콘솔을 열고 한 번 눌러 본다** → [conventions](docs/conventions.md) 의 "메뉴를 닫는 코드" 절.
- **키바인딩(`src/lib/keybindings.ts`)** — 조합 문자열은 `ev.code`(물리 키, IME 안전)로만 만들고 수식 순서는 `Ctrl → Alt → Shift` 고정.
  id 는 `settings.toml` 키라 **바꾸면 안 된다**(라벨만 바꾼다).
- **사용자 문구의 용어**는 창 > 워크스페이스 > 탭 > 타일 > 세션 · 호스트 · 파일 — 한 사물에 한 단어 →
  [conventions](docs/conventions.md) 의 용어표.

## 보안 제약 (불변 — 사용자 명시)

전문은 [docs/invariants.md](docs/invariants.md) 에 있고 **그 문장이 기준이다.** 아래 한 줄들은 요약이고 예외 · 범위는 전문에 있으니,
**줄 끝에 적힌 영역의 코드를 건드리기 전에 그 절을 먼저 읽는다.** 불변을 바꾸려면 사용자 결정이 필요하다. (경로는 `src-tauri/src/` 기준.)
[docs/security.md](docs/security.md) 에 적힌 한계는 **알고 둔 것**이다 — 취약점으로 보고 고치지 않는다.

1. **Aynx 세션 서버는 CLI 전역에 등록하지 않는다** — MCP 토큰은 사용자 CLI 설정 파일에 없다. `agent_tile.rs` · `mcp/` → [전문 1](docs/invariants.md#inv-1)
2. 비밀번호 · 키 암호구는 **사용자가 켠 볼트에만**(예외 — DB 빌린 값은 전문 8). **볼트 값은 세션 서버 프로세스 밖으로 나가지 않고, 값을
   돌려주는 op 는 없다.** 가림막을 걷는 것이 곧 볼트를 여는 것이다. 헤드리스 위임은 `vault_passphrase` 를 켠 호스트만 볼트를 쓴다.
   **위임 · AI 권한 · 앨범의 범위는 사람만 정한다** — Tauri 명령뿐이고 MCP 에는 바꾸는 도구가 없다. `vault.rs` · `orchestration/` → [전문 2](docs/invariants.md#inv-2)
3. 예외 하나 — **외부 MCP 서버 환경변수(볼트 `mcp_env`)** 는 볼트가 열려 있는 동안 같은 계정의 프로세스에 노출된다고 본다(알고 받은 한계).
   디스크 · 설정 파일 · 프런트 · MCP RPC 에는 값이 없다. → [전문 3](docs/invariants.md#inv-3)
4. **앱은 사용자가 명시적으로 위임한 범위 안에서만 실행한다** — 그 자리 사람 승인, 또는 **범위 · 한도가 명시된** 사전 정책. 원시
   `send_command` 는 만들지 않는다 · **AI 문자열→PTY 길은 없다** · AI 는 자기 실행을 **자가 승인 못 한다**(승인 등급 프레임은
   `approve_operation` 하나). 메신저 다리와 사이드 채팅 · 채팅 타일 권한 답의 범위도 이 절이 정한다.
   `operations/auto.rs` · `server/messenger_bridge.rs` · `orchestration.rs` → [전문 4](docs/invariants.md#inv-4)
5. 세션 로깅은 기본 꺼짐, **세션별 옵트인**. → [전문 5](docs/invariants.md#inv-5)
6. **메신저 웹훅 URL · 봇 토큰은 채널마다 자기 파일에만** — 프런트 · MCP · 로그 · `Debug` 로 나가지 않고, 봇 토큰을 읽는 것은 세션 서버뿐이다. → [전문 6](docs/invariants.md#inv-6)
7. 포트 포워드는 **127.0.0.1 전용**. `port_forward.rs` → [전문 7](docs/invariants.md#inv-7)
8. **DB 비밀번호는 볼트 `db_password` 에만**(빌린 값 예외는 전문). AI 는 **따로 연 읽기 전용 연결**로만 읽고 **AI 의 쓰기는 작업안뿐**.
   `db/` · `db/borrowed.rs` → [전문 8](docs/invariants.md#inv-8)
9. **타일 토큰은 Run 을 열지도 이어받지도 조율하지도 못한다.** 역할 · 타일 · 채팅 토큰은 **같은 계정 안의 보안 경계가 아니다.** 토큰 값은
   프런트 · 로그 · `Debug` · 영속 파일에 나가지 않는다. `tile_token.rs` · `chat_token.rs` → [전문 9](docs/invariants.md#inv-9)
10. **대화 기록이 MCP 로 나가는 길은 조정자 `read_worker` 하나 — 자기 Run 작업자의 고정 대화만.** 터미널 화면 거울은 여기 들지 않고
    사람이 준 읽기 권한을 따른다. → [전문 10](docs/invariants.md#inv-10)
11. **원격 타일에는 MCP 토큰을 주지 않는다** — 신호 전용 토큰만. `ssh/open.rs` · `remote_signal_file.rs` → [전문 11](docs/invariants.md#inv-11)
12. 에이전트 포워딩은 **호스트별 옵트인(기본 꺼짐)**, 헤드리스 위임 접속에는 없다. → [전문 12](docs/invariants.md#inv-12)
13. **원격 웹 클라이언트는 tailnet 안 브라우저만** — 관문은 127.0.0.1, 노출은 `tailscale serve`(Funnel 없음), **앱 명령의 문은
    `remote/deny.rs` 하나.** tailnet 밖에서 앱에 닿는 길은 메신저 다리 하나뿐이다(전문 4 의 범위만). `remote/` → [전문 13](docs/invariants.md#inv-13)
14. OS 자격증명 저장은 **(닫힘) OS 저장소 대신 자체 볼트**. → [전문 14](docs/invariants.md#inv-14)

## 아키텍처 한눈에

전문은 [docs/architecture.md](docs/architecture.md).

- **프런트(`src/lib/`)의 큰 모듈은 폴더로 나누고 옛 경로를 배럴로 남긴다** — 자식은 배럴을 부르지 않는다
  ([modules-frontend](docs/modules-frontend.md) 의 "배럴 규칙").
- **세션 · 볼트 · MCP · 작업안 · 메신저 다리는 모두 세션 서버 프로세스에 산다.** GUI 에 남는 것은 창 · 렌더링 · 승인 버튼 · 알림이고,
  GUI 가 원격에 닿는 길은 서버 op `ssh_exec` 와 SFTP 채널 터널뿐이다 → [전문](docs/architecture.md#arch-backend)
- **세션의 표 · 임대는 `session_core` 가 쥔다** — 리로드 · 웹뷰 크래시는 임대만 풀고, 창 파괴 · 타일 닫기만 세션을 끝낸다 →
  [전문](docs/architecture.md#arch-session-core)
- `mcp.rs` + `mcp/` 는 **읽기 · 계획 + 오케스트레이션 조율** — 명령 실행 · 승인 · 키 전송 도구는 없다 → [전문](docs/architecture.md#arch-mcp)
- **오케스트레이션**(`orchestration/` · `server/producer/` · `mcp/`)은 서버가 스스로 띄우는 것 · 채팅 stdin 에 들어가는 것 · main 병합의
  길이 좁게 정해져 있다 — 고치기 전에 [architecture](docs/architecture.md#arch-mcp) 와 [invariants](docs/invariants.md#inv-4) 의
  전문 4 · 9 · 10 을 읽는다.

## 이 파일을 고칠 때

- 여기에는 **파일을 열기 전에 알아야 하는 것**만 둔다. 구조 설명 · 이력 · 날짜는 넣지 않는다 — 코드와 `docs/` 에 있다.
- 새 줄은 **뻔하지 않고 · 두 번 이상 겪었고 · 그대로 실행할 수 있는 지시**일 때만 더한다. 한 영역에만 걸리는 규칙은 그 영역의 문서나
  파일 머리말로 보낸다.
- `CLAUDE.md` 는 이 파일을 불러오기만 한다(`@AGENTS.md`) — 지침은 여기에 적는다.

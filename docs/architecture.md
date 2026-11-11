# 아키텍처

[`CLAUDE.md`](../CLAUDE.md) 의 "아키텍처 한눈에" 의 전문이다. 요약과 어긋나면 여기 문장이 기준이다.
보안 제약의 전문은 [invariants.md](invariants.md) 에 있다.

**고칠 파일은 지도에서 먼저 찾는다** — 백엔드 [docs/modules.md](modules.md) ·
프런트 [docs/modules-frontend.md](modules-frontend.md) (층별 표 · 현재 층 위반 · "어디를 고치나").
불변식은 각 파일 머리말에 있다. 아래는 방향만 잡는 몇 줄이다.

<a id="arch-frontend"></a>
## 프런트

**프런트 (`src/lib/`)**
- 큰 모듈은 폴더로 나누고 **옛 경로를 배럴로 남긴다** — 자식은 배럴을 부르지 않는다
  (규칙: [docs/modules-frontend.md](modules-frontend.md) 의 "배럴 규칙").
- 타일 배치는 **이진 분할 트리**: 순수 트리·스펙은 `session/`(`spec.ts` · `tree.ts` · `tree-edit.ts` …,
  `session.ts` 는 배럴), 순수 기하는 `layout.ts`, 둘 다 필요한 조작은 `tree-ops.ts`. 키바인딩은 `keybindings.ts`.
- `app/` 은 도메인 상태 모듈(tabs · panes · sessions · hosts · prompts …), 큰 화면의 조각은
  `pane/`(PaneHost) · `term/`(Terminal) · `console/`(대시보드) · `dialogs/`(`+page` 모달) · `settings/model/`(설정 모델).
- 호스트 · 프로젝트 · 설정은 타일 트리 밖에 **떠 있는 독**이다(`Dock.svelte` + `app/dock.svelte.ts`) →
  [docs/log/2026-09-25-unified-dock.md](log/2026-09-25-unified-dock.md).

<a id="arch-backend"></a>
## 백엔드 — 세션

**백엔드 (`src-tauri/src/`)**
- 세션: `server/`(세션 서버 — serve·sessions·ssh_ops·tunnel·hub·credit·proxy·client·launch) · `pty.rs`(로컬 자원) · `ssh.rs` + `ssh/`(원격) ·
  `headless.rs` · `ssh_pool.rs` · `port_forward.rs` · `db/`(쿼리 타일) — **로컬·SSH·풀·포워드·헤드리스·DB 는 모두 세션 서버 프로세스에 산다.**
  GUI 가 원격에 닿는 길은 서버 op `ssh_exec`(명령은 GUI Rust 고정 조립 함수만)와 SFTP 채널 터널뿐이다. `reap.rs`(누수 그물) · `handoff.rs`(창 간 이관).

<a id="arch-mcp"></a>
## MCP 와 오케스트레이션

- `mcp.rs` + `mcp/` 는 **읽기·계획 + 오케스트레이션 조율**(역할별 토큰 — 프로듀서 채팅: 귀속 앨범 이어받기, 조정자: 작업 정의·작업자 띄우기·이어지는 지시(resume 턴)·완료, 작업자: 자기 보고, 검토자: 판정).
  `/mcp` 인증 순서(`mcp/http.rs`): 전역 토큰 → **타일 토큰**(`Caller::Tile{stream}` · 요청마다 회차 확인) → **채팅(사이드 · 프로듀서 — 종류 · 세대는 표에서 ·
  `Caller::Producer{chat, proc}`)** → 작업자 · 검토자 턴 토큰. **프로듀서 채팅**의 목록 = 13(작업안 여섯은 앨범 구성 칸 "프로듀서 작업안 도구"를 켰을 때만 —
  기본 꺼짐 · 띄울 때 고정 · 호출마다 지금 값으로 재판정 `producer-plan-tools-off`) + DB(늘 일곱 · 권한은 호출마다 서버 판정) + `adopt_run` + 조율 도구 전부(처음부터 고정 —
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
  `complete_run`(서버 `completable` 판정 · 남은 idle 은 닫음 · 결과 `export{ok, branch | reason}` — 내보내기 실패도 Done · `serverTemp` 는 서버 임시 자리만 센다 — 작업자 worktree · 브랜치는 사람 [정리]) · 작업자 `get_task`·`commit_changes`·`report_done` · 검토자 `get_task`(검토 지시서)·`get_diff`(고정 대상만)·`report_review`(pass · changes-requested · 찾은 것 ≤20) 이다(`src-tauri/src/orchestration.rs` · [docs/log/2026-10-14-orchestration-design.md](log/2026-10-14-orchestration-design.md)).
  작업자 worktree 는 서버가 만들고 정리는 사람 — 남은 것은 사람의 [worktree 지우기] op ·
  공통 구현 `orchestration/worktree.rs`.

<a id="arch-orch-screen"></a>
### 오케스트레이션 화면 구성

**화면 = 오케스트레이션 탭 안의 라이브러리 › 스튜디오 › 앨범 › 트랙** — `OrchMark{view, repo?, runId?, taskId?, attemptId?, fromRepo?}` 가 경로이고(`fromRepo` = 스튜디오를 거쳐 든 앨범 · 트랙의 돌아갈 곳), 지금 워크스페이스의
현재 오케스트레이션 탭을 우선해 그 안에서 이동한다(없으면 하나 만든다 · [새 탭으로 열기]는 같은 경로 복제 · ← · Esc 는 한 단계 위).
라이브러리 · 스튜디오 · 아티스트는 플레이어 한 잎, [새 앨범]은 서버 채팅 없는 창 메모리의 초안(보내기 전 떠나면 사라짐), 앨범 · 트랙은 **그 앨범의 프로듀서 채팅 잎
`kind:"producer"` + 플레이어 잎 `kind:"run"`**(채팅이 없으면 플레이어 전체 폭 — 끝난 앨범은 다시 열면 채팅 잎 없이 열고, 대화는 사람이 [프로듀서 대화 기록]으로 왼쪽에 읽기 전용으로 연다 · 서버 open 없음) · 아래 재생 막대 띠다. 트랙 줄 · 지금 곡 · 사람 필요 알림은 트랙 경로로 간다.
**아티스트 · 앨범 구성 편집은 탭 안의 아티스트 · [새 앨범] · [앨범 권한]뿐** — 설정에 오케스트레이션 화면은 없다. 화면 용어는 앨범(Run) · 트랙(Task) ·
아티스트(작업자 정의 — 코드 낱말 role) · 프로듀서(조정자)다. **프로듀서 수명은 앨범** — 탭 닫기 · 화면 이동 · 창 이관은 구독만 풀고, 같은 앨범을 다시 열면
같은 chat · conv 에 재부착한다(새 open · 첫 말 없음). [프로듀서 끝내기]만 확인 뒤 채팅을 닫고 조율 멈춤으로 만든다(작업자는 계속) · 앨범 끝은 쉬는 순간 닫거나
10분 뒤 끊고 닫는다 → [docs/log/2026-10-30-orchestration-album-first.md](log/2026-10-30-orchestration-album-first.md) 4절 · 5절.

<a id="arch-orch-roles"></a>
### 역할

**역할**(`orchestration/roles.rs`): 조정자는 `spawn_worker{role:<아티스트 id>}` 로 **그 앨범에 들인 아티스트**에서 id 만 고르고,
등급 · 허용 명령은 앨범 구성 · CLI · 종류(쓰기형 · 판정형) · 모델 · 강도 · 지침은 아티스트 목록에서 서버가 붙인다(옛 `cli` 인자 · `role:"reviewer"` 는
`bad-args` · 앨범에 없으면 `unknown-role` · 읽기 등급 작업형은 `role-read-only`). 작업자 · 판정형은 **Run 의 저장소 신원이 그대로일 때만** 뜬다(`repo-changed`).
CLI · 종류는 Attempt 사본에 고정(바뀌면 다음 턴 `role-changed` · 지우면 `role-removed`), 나머지는 턴마다 지금 값. **수락 규칙**(판정형 역할 R 의
pass N — 수락 순간의 지금 앨범 구성)을 못 채우면 조정자 수락은 `accept-rule-unmet{unmet[], reviewsLeft, hint}`, 사람 수락은 넘고 산출물에 면제
(`waived[]`)를 적는다. 반려 수가 되돌림 한도를 넘으면 다시 띄우기가 `rework-limit`.

<a id="arch-orch-review"></a>
### 판정형(검토자)

**판정형(검토자)**(`orchestration/review.rs`)은 Task 의 현재 보고 커밋을 읽기만 하는 **역할 기반 보조 검토 — 독립 보증이 아니다**(같은 계정 ·
이름표 토큰). 작업자 수명과 따로(Task 상태 · `current_attempt` 안 바꿈 · 작업자 한도 밖 · 보고당 · Run 당 동시 하나 · 총 `maxReviews`), 대상 report/OID 고정,
보고 교체 · 반려 · 취소 · 수락이 무효화(늦은 판정은 `stale`). 실행은 작업자 권한 모드와 **무관한 고정 인자 · 헤드리스 턴**(`orchestration/turn.rs` 의 판정형 줄:
Claude `-p --output-format stream-json --verbose --setting-sources "" --tools Read,Grep,Glob --settings {disableAllHooks} --permission-prompts none --strict-mcp-config`
+ 지침 턴 파일 `--append-system-prompt-file`(고정 문장 + 전역 CLAUDE.md 를 읽기만) · Codex `-a never exec --json -s read-only --ignore-user-config --ignore-rules
--disable plugins --disable hooks --skip-git-repo-check` — 세션 · PTY · 타일 · 붙이기 없음 · 턴(= 프로세스)이 끝나면 끝 · 판정 없이 끝나면 종결) · cwd = 서버 빈 폴더 ·
보고 커밋은 Run 자리의 분리 HEAD 읽기 자리(추적 symlink 가 밖이면 거절 `symlink-outside`). 조정자 수락은 지금 앨범 구성의 수락 규칙이 정한다.
**검증 글자 · 다섯 한도는 시작 때 고정**하고 도중에 바꾸지 않는다. 영속 Run 은 판 4만 읽고 미지원 판은 건너뛴다(로그 한 줄) · 앨범 없는 Run 은 실행 · 수락 · 검증을 못 한다(`run_without_album_is_inert`).
GUI `write` op 는 입력 출처(`keyboard`·`paste`·`protocol` — 프런트 `src/lib/term/input-source.ts`)를 싣는다(원격 웹의 크기 주인 판정 — 터미널 응답은 사람 입력이 아니다). 작업자 타일이 없으므로 개입 잠금도 없다.

<a id="arch-orch-spawn"></a>
### 서버가 띄우는 것 ①~④

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
알고 받은 한계: 연결 칩을 붙인 채팅에서 AI 가 읽은 터미널 내용이 그 서버로 나갈 수 있다.
④ **프로듀서 채팅 프로세스**(오케스트레이션 탭의 프로듀서 채팅 잎 — 사이드 채팅과 같은 프로세스 코어 `server/chat_proc/` 위의 별도 레지스트리
`server/producer/`)도 **GUI 요청(Tauri → 서버 op `producer_album_start` · 귀속 채팅의 `producer_chat_send` — `producer_chat_open` 은 resume · adopt 만, 띄우지 않는다)으로만 선다.** 셸 없는 CLI 하나 · 고정 인자 ·
같은 `spawn_in_job` · 공용 정화 · cwd = **그 앨범의 저장소**(Claude — 서버가 Run 에서 읽음 · op 몸의 경로를 믿지 않는다) · Codex 는 **서버 빈 폴더**(신뢰된
저장소의 `.codex/config.toml` 이 MCP · 훅 · 실행 정책을 들여오지 않게 — 저장소 경로는 앱 고정 지침으로). [오케스트레이션으로 이어 가기](AI 타일 메뉴)는 그 타일
대화를 **앨범 시작의 fork 갈래에서 갈라 온다**(원래 타일은 그대로 · `producer_fork_probe{agent, conv}` 가 기록된 cwd 의 git toplevel(주 저장소)을 정함 →
그 저장소로 잠긴 [새 앨범] 초안 → 사람이 구성 · 첫 말을 보냄 · 시작 때 서버가 저장소를 다시 정해 다르면 `out-of-scope:repo`(시험 `producer_fork_repo_from_conversation`) · Claude `--resume --fork-session` · Codex `thread/fork`) — 갈라 온 **Codex** 프로듀서의 첫 사람 글 앞에는 **앱 고정 지침 머리글**(틀 + 프로듀서 고정 지침 ·
끼우는 것은 서버가 Run 에서 읽은 앨범 저장소 경로와 runId 뿐 — 사이드 채팅 ③ 의 연결 머리글과 같은 종류 · 짓는 곳 `launch::album_fork_brief` 하나 · 붙이는 곳 전송기 하나 · AI 문자열 없음 ·
지침 없이 시작한 대화를 `thread/fork` 하면 `developerInstructions` 가 서지 않는다 · 시험 `producer_fork_brief_fixed`). **사람 입력과 깨움은 서버의 단일 전송 예약 경로를 사용한다. CLI에 보냈지만
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
끊기 하나는 시계가 깨움 턴에만 붙인다. **프로듀서는 직접 파일을 변경하거나 읽기 전용 실행 경계를 벗어날 수 없다. Claude에는 Read·Grep·Glob만 제공하고, Codex에는 읽기 전용 샌드박스 안의 읽기 작업만 허용한다. 파일 변경·실행 경계 확대·외부 MCP·웹 검색은 프로듀서 권한 카드로도 허용하지 않는다. Aynx의 읽기·작업안·조율 도구는 각 서버 관문의 기존 권한 검사를 받는다. producer_chat_*의 원격 허용은 이 제한을 넓히지 않으며, 본문은 해당 프로듀서 채팅의 유효한 구독 연결에만 전달한다**
(Claude `--setting-sources ""` · `--strict-mcp-config` · `MCP_TOOL_TIMEOUT` · Codex `approvalPolicy: never` · 웹 검색 끔 · `windows.sandbox` · `notify=[]` · 이름으로 끌 수 없는 사용자 MCP 면
띄우지 않음 · **사람이 [허용] 할 수 있는 카드는 앨범 저장소 밖 Read · Aynx DB 읽기 도구 둘뿐 — 그 밖 승인 요청은 어댑터가 카드 없이 거절**(`side_chat::guard` · 시험
`producer_approval_allowlist`) · DB 읽기 카드는 Claude 만이고 **Codex 는 `db_query` 를 미리 허용한다**(`never` 에서 미리 허용 밖 MCP 도구는 묻지 않고 실패한다 — 행을 읽을지는
서버의 연결 AI 권한이 정한다 · AI 타일과 같은 등급) · `producer_chat_*` 원격은 ALLOW). 배달: 사건은 방송하지 않고(`RELAYED` 밖) GUI 라우터(`server/producer_proxy.rs` `route`)가 사건 몸의
`(창, subGen)` 구독 가운데 이 GUI 가 같은 채팅의 Channel 을 쥔 산 창에만 보낸다(원격 창 Channel 은 `remote::bridge` 가 그 ws 로 · 시험 `producer_subs_route` · `producer_subs_gen`) ·
창이 사라지거나 다시 뜨면 GUI 가 그 순간 쥔 그 창의 `subGen` 만 서버에서 뗀다(op 몸 `producerSubs` — 같은 라벨의 새 페이지가 건 구독은 남는다) · 보내기가 실패한 통로(느린 수신자)는
그 구독만 걷는다 · 원격 창 · 탭이 떠난 창은 구독만 풀고 채팅을 닫지 않는다 · 권한 결정은 여러 창에서 와도 한 번만 먹는다(시험 `producer_subs_windows_gen` ·
`producer_slow_receiver_alone` · `producer_two_windows_one_decision`) ·
앱은 토큰 · 볼트 값을 사건 · 스냅숏에 구조적으로 싣지 않는다.

<a id="arch-orch-workers"></a>
### 작업자

작업자는:
Run 이 만든 worktree(Git 훅 끔 · Run 의 자리 안 · 곁 기록 `worktrees.json` 쓰기는 프로세스 간 파일 잠금) 에서 **셸 없이 CLI 를 헤드리스 턴으로**
(인자 배열 = 옵션 → `--` → `[` 로 시작하는 지시 · 사용자 추가 인자 없음 · 그 턴의 작업자 토큰만 · 비대화형 — Claude `-p … --permission-prompts none` ·
Codex `-a never exec --json` · Codex 쓰기형은 네트워크 켬) 띄우고 효과 직전 지금 앨범 구성 · 신원을 다시 본다 — 상태는 `running`(턴이 돈다) → 턴 끝에
보고가 있으면 `reported`(닫힘) · 없으면 `idle`(열림 — `blocked` 표지 가능 · worktree 쥠 · 동시 자리 안 차지) · 중단은 트리 종료 확인 뒤에만 `stopped`
(`server/workers.rs` · `orchestration/{spawn,attempts,resume,roles,worktree}.rs`).

<a id="arch-orch-accept"></a>
### 통합 · 수락 · main 병합

작업자 worktree 의 기준은 **Run 통합 머리**(조정자의 `base` 인자는 거절). **수락 = 서버가 Run 통합 ref(`refs/aynx/orch/<run16>/int` — id hex 앞 16자(경로 길이),
비브랜치, 사람용 브랜치 `orch-<run8>-int` 는 앨범 판 [브랜치로 내보내기] · Run 완료 때)에 Task 마다 squash 커밋 하나**를 `merge-tree`(속성 출처 =
old 트리) → `commit-tree` → **의도 저장 확인 뒤** `update-ref --stdin` 트랜잭션(통합 ref + 완료 증거 + 보고 커밋 보존 ref)으로 쌓는 것 — 조정자에게는
**비동기**(`wait_run{until: settled}`). 병합 드라이버 · `merge.default` · 필터(LFS) · renormalize · submodule 저장소는 통합 전에 거절(드라이버 ·
필터가 돌지 않게), 충돌이면 Task `conflict`, 예상 밖 통합 ref 변경은 Run 보류 → 사람의 [조정]. **main 병합은 사람의 [병합] 또는 사람이 앨범마다 켠 자동 병합으로만 — AI · MCP 에는 길이 없다**(`orchestration/{accept,merge,integrate}.rs` · 병합 몸 `album_merge.rs` — `git merge --no-ff` · 스쿼시 없음 · push 없음 · 훅 끔 · 검사가 막으면 안 한다 · 자동은 완료 뒤 한 번 · 재시도 없음 · 켬은 넓힘 + 위험 확인 + 검증 명령 필수 · 시험 `album_merge_has_no_mcp_path`).

<a id="arch-orch-archive"></a>
### 보관함 · 정리

**보관함**(`orchestration/store/archive.rs` — 사람의 Tauri 명령뿐 · MCP 없음): 끝난 앨범을 `archived/` 로(남은 작업자 worktree · 서버 임시 자리가 있으면 거절) · 복원은 끝난 기록으로만(프로세스 · 토큰 · 묶음 없음) · 영구 삭제(원격 REAUTH)는 이 앨범의 ref 먼저 다음 파일 — 내보낸 브랜치는 그대로.
**정리**(`orchestration/cleanup.rs`): 서버 임시 자리(검증 · 검토 worktree · 검토자 빈 cwd)는 끝난 Run · orphaned 에서 서버가 지우되 소유(곁 기록
`role` · Run 장부) · 실제 경로 · 프로세스 0 · **쉬는 상태와 같을 때만**(아니면 남기고 `cleanup-pending`) · 재시작 = 재정리, 작업자 worktree · 보존 ref ·
통합 ref 는 사람 [정리]만. **어느 worktree 를 지우든 안의 정션 · 링크를 링크만 먼저 걷는다**(`git worktree remove` 는 정션을 따라간다).
여러 저장소를 함께 만지는 명령은 `session_commands.rs`.

<a id="arch-mcp-server"></a>
### 세션 서버 안의 MCP

MCP·`mcp.json`·거울·라우팅·작업안·실행기·감사는 **세션 서버**(`server/ai.rs`)에 산다 — GUI 는 같은 이름의 명령
프록시(`server/ai_proxy.rs`). `/mcp` 와 `/agent-signal` 은 한 루프백 리스너(경로별 문지기·토큰·상한 분리), 서버 재시작 = 새 포트·토큰.

<a id="arch-mirror"></a>
## 세션 거울

**AI 가 읽는 세션 거울(`context.rs`)은 창이 있으면 프런트, 없으면 세션 서버가 쓴다**(세션 서버가 출력을 같은 뜻으로 해석하는 해석기
`screen_mirror.rs` 를 세션마다 늘 돌리고, 붙은 주 창이 없을 때만 거울에 쓴다 · 문지기는 그대로) →
[docs/log/2026-11-09-db-borrowed-password.md](log/2026-11-09-db-borrowed-password.md) 11절.

<a id="arch-session-core"></a>
## 세션 코어 · 임대

**세션의 표·임대는 `session_core` 가 쥔다.** 세션은 스트림(`historyStreamId`) 열쇠와 회차·임대(`sessionEpoch`·`leaseEpoch`)로
살고, 창은 임대만 빌린다 — 페이지 리로드·웹뷰 크래시는 임대만 풀고(새 페이지가 다시 붙는다 — 로컬·SSH 모두), 창 파괴·타일
닫기만 세션을 끝낸다. 옛 임대의 호출은 `[stale-lease]` 로 거부된다 →
[docs/log/2026-10-08-session-core-local.md](log/2026-10-08-session-core-local.md).
임대(주)는 하나 그대로이고, 그 밖에 **시청자**가 빼앗지 않고 덧붙는다(원격 웹 — `session_core/viewers.rs` 머리말: 쓰기는 둘 다 ·
닫기는 주만 · 크기·터미널 질의 응답은 마지막 사람 입력의 쪽 · 느린 시청자는 생산자를 세우지 않고 떨어져 재동기화).

<a id="arch-server"></a>
## 세션 서버

**로컬 PTY·SSH 세션은 세션 서버 프로세스(`aynx session-server`, `src-tauri/src/server/`)에 산다** — GUI 의 세션 명령은 `server/proxy.rs` 의 같은 이름 파이프 프록시이고, 출력은 이진 프레임 + ACK 크레딧이다. GUI 종료·강제 종료·마지막 창 X(quitAll)는 임대만 풀어 셸이 살고 다시 켜면 복원이 붙는다. **마지막 창을 닫으면 GUI 는 기본으로 트레이에 남는다**(`[app] tray_on_close`, Windows — 나머지 OS 는 스텁이라 GUI 종료). **복원이 데려가지 않은 세션은 닫지 않고 "떨어진 세션" 목록에 남는다**([새 탭에 붙이기]·[닫기] — 독·세션 판·트레이·부팅 안내 · **쿼리 타일의 DB 연결도** — 창이 사라지면 TTL 없이 남고 열린 트랜잭션만 10분 뒤 되돌림, 리로드만 10분 TTL → `db/table.rs` 머리말). 타일·보조 창 닫기와 트레이 [모든 세션 종료](세션·서버·GUI 모두)만 세션을 끝낸다. 서버는 세션 0·클라이언트 0·작업안 0 이 10분이면 자진 종료한다. 볼트·신호·브로커·SSH·MCP·거울·작업안도 서버 — GUI 에 남는 것은 창·렌더링·승인 버튼·알림(사전 정책 자동 승인의 시계는 서버 `operations/auto.rs` — 서버 안 `approve_in(method: auto)` 하나, 파이프 승인 프레임 아님, 사람이 검토 중인 작업안은 GUI 가 `ops_reviewing` 으로 알림 · 창 0개 = 볼트 잠금이라 `vault_passphrase` 헤드리스 대상의 무인 실행은 실패한다) → [docs/log/2026-10-09-session-server-local.md](log/2026-10-09-session-server-local.md).

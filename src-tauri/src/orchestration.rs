//! **오케스트레이션** — 조정자 AI 가 작업자 AI 에게 일을 맡기고 사람이 감시 · 감독한다(설계
//! docs/log/2026-10-14-orchestration-design.md · 지금은 G 표 **6단계: 진행 기록(대화 고정 · 전방 증분 · `read_worker`)**까지).
//!
//! 세션 서버 프로세스의 AI 평면(`server::ai::AiPlane::orch`)이 한 벌 쥔다 — GUI 가 없어도(창 0개 · GUI 종료) Run 은 산다.
//!
//! **3차 3a(10-16 — docs/log/2026-10-16-orchestration-headless-design.md)에서 작업자 · 해결자도 헤드리스 턴이 됐다.** 아래 단계별 절 가운데
//! PTY 세션 · 부트스트랩 시한 · 훅 신호 → 입력 상태(3단계) · `send_prompt` 붙여넣기 전달(5단계 `deliver.rs`) · 보고 뒤 자동 종료(`autostop.rs`) ·
//! `requireReview`(5단계) · 사람의 시작 op · [이어 가기] · 작업자 타일 붙이기(`attachMode`) · worktree 도구 셋은 **역사 기록**이다 — 지금 동작은
//! 맨 아래 "3차 3a" · "3차 5단계" · "3차 6단계" 절과 불변식.
//!
//! ## 2단계에 선 것
//!
//! - 모델(`model.rs`) — Run · Task(버전 · DAG) · Attempt/Report/AcceptedArtifact(정의만 — 3 · 4단계가 채운다).
//! - 저장소(`store.rs`) — **잠금 하나** 안의 Task 생성/갱신 · 버전 비교 · 순환 검사 · 한도 예약 · 멱등, 사건마다 `seq` · 조건 변수 ·
//!   영속 · 이벤트 `orchestration-changed`, **역할 토큰 표**(조정자 — Run 세대마다, 작업자 — Attempt 마다(3단계)).
//! - 브레이크 — 사람의 일시정지 · 재개 · 중단 · [이어 가기](세대 +1) · 한도(Task 50 · 분당 60 · 동시 대기 2 · 동시 Run 2 · 조율 2시간 →
//!   paused · 실행 = 조율 + 30분 → stopping). 브레이크가 실행 경로(3단계 생성 · 5단계 전달)보다 **먼저** 선다(설계 G).
//! - 영속(`persist.rs`) — `<데이터 루트>/orchestration/run-<id>.json`, 서버 재시작 뒤 **orphaned(읽기 전용 · 토큰 없음)**.
//! - MCP 조율 도구(`tools.rs`) — 조정자 `get_run` · `create_task` · `update_task` · `wait_run`, 작업자 `get_task`(4단계에 `report_done`).
//! - 사람 쪽 서버 op(`ops.rs`) — GUI 의 Tauri 명령(`server::orchestration_proxy`)이 같은 이름으로 부른다.
//! - 감사 — `audit::AuditRecord{kind: "orchestration"}` 고정 칸(토큰 · 본문 없음).
//!
//! ## 3단계에 선 것(2026-10-15)
//!
//! - 조정자 `spawn_worker` · `stop_worker`(`tools.rs` → `attempts.rs`) — 한도 슬롯 · Attempt · 작업자 토큰을 잠금 하나에서, 띄우기는
//!   서버 손(`spawn::WorkerLauncher` — 서버는 `server::workers`)이 스레드에서. 사람의 [중단](`ops.rs`) · Run 중단은 트리 종료 확인 뒤에만
//!   `stopped`(아니면 `stop-unconfirmed`). 작업자 토큰은 그 프로세스 종료 확인 뒤 거둔다(사용자 결정 1).
//! - 재료 틀(`spawn.rs` — 환경 허용 목록) · 첫 지시(머리줄 `[` · ≤ 24 KiB, 넘으면 Run 폴더 파일) · 인자 배열(옵션 → `--` → 프롬프트).
//! - **worktree op 층**(`worktree.rs` — 만들기 · 보수적 지우기 · 곁 기록, 사람 op `orchestration_wt_remove`). (3차 6단계 · Q6) 그 위의 조정자 MCP
//!   도구 셋 · `aynx wt` CLI 는 걷었다 — 작업자 worktree 는 서버가 만들고 정리는 사람의 [정리]다.
//! - 부트스트랩 시한(60초 → `awaiting-human`) · 훅 신호 → 입력 상태(`working` · `ready` · 권한 대기) · 재시작 뒤 잔존 자원 안내.
//!
//! ## 4단계에 선 것(2026-10-15)
//!
//! - 작업자 `report_done`(`report.rs`) — 서버가 그 worktree 의 git(HEAD · 미커밋 · base 이후 바뀐 파일)을 읽어 `Report` 를 만든다.
//!   현재 Attempt 만(`stale-attempt`) · 한 번(`already-reported`) · 중단 뒤면 `late`(기록만). Task → `reported`.
//! - 수락 · 반려 — 조정자 `update_task{state}` · 사람 op `orchestration_review_task`(보드 [수락] · [반려] · 뒤집기). 수락 = 불변
//!   `AcceptedArtifact`(미커밋 보고 `dirty-report` · 실패 보고 `not-success` 거절), 반려 · 뒤집기 = `ReviewRecord` 새 줄.
//! - 의존 Task 의 기준 = 그 선행의 **유효한** 수락 커밋(하나 — `base` 인자보다 의존이 이긴다) · 여럿이면 `needs-merge`. **(3단계부터는 통합 ref 가 없는
//!   옛 Run 에만 — 새 Run 은 통합 머리, 아래 3단계 절.)**
//!   반려 뒤 재작업은 새 Attempt — `spawn_worker{reuseWorktreeOf}` 로 앞 Attempt 의 worktree 를 이어 쓸 수 있다(끝났고 깨끗할 때만).
//! - 보드의 "보고 뒤 변경"(op `orchestration_report_drift` — 보드가 열려 있을 때만 가볍게).
//!
//! ## 5단계에 선 것(2026-10-15)
//!
//! - 조정자 `send_prompt`(`deliver.rs`) — 어댑터 경계 `WorkerChannel`(1차 = PTY 괄호 붙여넣기 `PtyPaste`), 입력 허용 상태(G-1 실측 —
//!   Stop 뒤 4초 무신호 · 서브에이전트 0 · 권한 대기 없음 · 고정 대화 · Codex 출력 조용함), Attempt 마다 전달 하나, Enter 직전 전부
//!   재검사, 결과 상태(`rejected` · `pasted-unconfirmed` · `submitted-unconfirmed` · `acknowledged`), 미확인이면 `needs-recovery`.
//! - 사람 개입 — GUI `write` op 의 출처(`protocol` 은 개입 아님) → 60초 잠금 · 초안(`human-draft`), 사람 op [돌려주기]
//!   (`orchestration_return_control`) · [복구 완료](`orchestration_recover`). 도구 · 권한 뒤 60초 무신호 = `stalled`(awaiting-human).
//! - 감사 `prompt_sent`(상태 · 길이 · SHA-1), 전문은 보드(서버 메모리)에만.
//!
//! ## 6단계에 선 것(2026-10-15)
//!
//! - **대화 고정**(`progress.rs` — 설계 C-6): Attempt 의 대화는 처음 받은 id(Claude `--session-id` · Codex 첫 `start`)이고, 그 파일은 **그 CLI 의
//!   대화 폴더 안** · 기록된 cwd 가 **그 Attempt 의 worktree** 일 때만 받는다. 뒤에 다른 id 가 오면 고정은 그대로 · `conversationChanged` 경고.
//! - **전방 증분 판독**(`agent_transcript::forward` — 같은 줄 파서) · 조정자 `read_worker`(항목 50 · 발췌 1 KiB · 응답 64 KiB · changedFiles) ·
//!   서버 시계 2초 — 고정 파일이 자라면 seq · 이벤트(`wait_run` 이 깬다) · 보드 최근 활동(op `orchestration_worker_activity`) · [기록 보기]
//!   (op `orchestration_worker_transcript` — 고정 파일만).
//!
//! ## 10-15 — 서버가 집행하는 작업자 커밋 · 작업자 타일 붙이기 방식
//!
//! - 작업자 `commit_changes`(`commit.rs`) — 작업자가 무엇을(전부 · 파일 목록 · 메시지) 커밋할지 정하고, git 쓰기는 서버가 그 Attempt 의
//!   worktree · 브랜치(서버 기록)에만 한다 — 신뢰된 git 절대 경로 · 셸 없음 · `GIT_*` 걷기 · 훅 끔 · 전용 임시 index · `update-ref` CAS.
//!   Codex 작업자의 `writable_roots` 시도는 걷었다(작업자에게 `.git` 쓰기는 없다). 감사 `worker_committed`(커밋 · 파일 수 · 요청 id).
//!   거절은 모두 남는다 — 타임라인 · 감사 `commit_rejected`(사유 · Attempt · 요청 id · 파일 수 — 경로 · 메시지 없음) · Attempt 의
//!   `lastCommitRejection`(보드 · `get_run` · `read_worker`). 사람이 풀어야 하는 사유(`filters-configured` · `no-git-identity` ·
//!   `worktree-mismatch` · `commit-failed`)는 감독 알림 `commit-rejected` 도(같은 Attempt 의 같은 사유 되풀이는 한 번).
//! - `report_done` — HEAD 그대로 + 깨끗하면 `noChanges`, 브랜치가 바뀌었거나 HEAD 가 기준의 후손이 아니면 `mismatch`(수락 불가 `report-mismatch`).
//! - Run 의 `attachMode`(`onDemand` 기본 · `always`) — 서버는 저장 · 표시 · 이벤트 `orchestration-worker` 에 싣기만, 붙이기는 창이 한다.
//!
//! ## 통합 설계 1단계(10-15 — docs/log/2026-10-15-orchestration-integration-design.md)
//!
//! - **공용 git 실행기**(`git.rs`) — `commit_changes` 의 실행기를 빼며 끝 코드를 보존하고 stdout 바이트 상한(넘으면 `output-too-large`)을 둔다.
//! - 조정자 `get_diff`(`diff.rs`) — 보고 하나의 고정 OID 로 바뀐 파일 목록(≤500) · 파일별 패치 쪽(32 KiB), 잘림은 `truncated`. 보드의
//!   [파일 목록](op `orchestration_report_files`)이 같은 목록.
//! - **보고 뒤 자동 종료**(`autostop.rs`) — Run 옵션 `autoStopReported`(기본 켬). 보고한 턴에 묶고 사람 입력 · 새 턴 · [유지]가 취소,
//!   확정은 쓰기 경계 + 잠금 안 재검사 뒤 `stop_worker` 와 같은 길. 보고는 `late` 가 되지 않는다.
//!
//! ## 통합 설계 2단계(10-15) — 영속 v2 · 의도 기록 · 취소 계약
//!
//! - **영속 판 {1, 2}**(`persist.rs` · D12) — v1 은 새 칸 기본값(통합 없음 = 1차 동작)으로 읽고, 그 밖의 판은 거절.
//! - **통합 작업 기록**(`model::IntegrationJob` — 영속 의도)과 그 수명(`integrate.rs`): 관문 → `prepared` → (3단계 후보) → `committing` →
//!   **의도 저장 확인**(쓰기 줄이 결과를 돌려준다 — `store::SaveWait`) → ref 트랜잭션 하나(`commit: ok` 로 판정) → 결과. 저장 실패면 CAS 없이
//!   보류. 사람 [취소] · Run 중단 · 세대 교체는 커밋 단계 전까지만(같은 잠금에서 직렬화), 중단은 커밋 중인 Job 을 기다린다.
//! - **재시작 복구** — orphaned Run 의 `committing` Job 은 완료 증거 ref(`done/<jobId>`)로 판정. 통합 ref 가 기대 머리와 다르면 보류.
//! - **Run 보류**(`hold`) · **Run 완료**(사람의 [Run 완료] → `done` — 지금까지 없던 Done 경로) · 보드 보류 막대 · [Run 완료] 단추.
//! - (2단계 시점) 실제 통합은 3단계로 넘겼다 — 아래 절.
//!
//! ## 통합 설계 3단계(10-15) — 통합
//!
//! - **시작 op 가 통합 ref 를 만든다**(`accept.rs` — git 2.42 미만이면 `git-too-old`): 주 작업 폴더의 지금 `HEAD` 에서
//!   `refs/aynx/orch/<run16>/int`(비브랜치 — N1 · 이름은 id hex 앞 16자 — `integrate::refs`). 사람용 브랜치 `orch-<run8>-int` 는 [브랜치로 내보내기] · Run 완료 때.
//! - **수락 = 통합 ref 에 Task 마다 squash 커밋 하나**(D1) — 조정자 `update_task{accepted}` · 사람 [수락]은 **비동기**(Task `integrating` →
//!   `wait_run{until: settled}`). 지원 범위 검사(병합 드라이버 · `merge.default` · 필터 · renormalize · submodule — `merge.rs`) →
//!   `merge-tree`(속성 출처 = old 트리 · merge-base 조상 검사) → `commit-tree`(trailer) · 후보 ref → 의도 저장 확인 뒤 ref 트랜잭션
//!   (통합 ref + `done/<job>` + 보고 커밋 보존 `accepted/<task>`). 충돌이면 Task `conflict` + 구조 기록(해결 Attempt 는 3b).
//! - **새 Attempt 의 기준 = 통합 머리**(2-2) — `base` 인자 거절 · `needs-merge` 없음(통합 ref 가 없는 옛 Run 에만 1차 규칙).
//! - 통합 ref 가 기대 머리와 다르면 자동 채택하지 않고 **Run 보류** → 사람의 [조정](되돌리기 · 받아들이기).
//!
//! ## 통합 설계 5단계(10-16) — 검토자
//!
//! - 조정자 `spawn_worker{role: "reviewer"}`(`review.rs`) — Task 의 **현재 보고**(수락할 수 있는 성공 보고)를 읽기만 하는 AI 세션. 작업자 수명과
//!   따로(Task 상태 · `current_attempt` 안 바꿈 · 작업자 한도에 안 셈) · 보고당 · Run 당 동시 하나 · 총 `maxReviews`. 대상 report/OID 고정.
//!   보고 교체 · 반려 · 취소 · 수락이 활성 검토를 무효화(검토자 멈춤 · 늦은 판정은 `stale`).
//! - 검토자 토큰(`Caller::Reviewer`) — 도구는 `get_task`(검토 지시서) · `get_diff`(고정 대상만) · `report_review`(pass · changes-requested ·
//!   찾은 것 ≤20). 커밋 · `report_done` · 조율 도구 없음. **역할 기반 보조 검토 — 같은 계정 경계가 아니다.**
//! - 실행: cwd = 서버 빈 폴더, 보고 커밋 = Run 자리의 분리 HEAD worktree(읽기 자리 · symlink 밖이면 거절), 인자 = 작업자 권한 모드와 무관한
//!   고정 인자. (3차 2단계) **헤드리스 턴**(`turn.rs` 의 판정형 줄 — Claude `-p --output-format stream-json` · 설정 출처 통제 B ·
//!   `--tools Read,Grep,Glob` / Codex `exec --json -s read-only` · 통제 넷) — 세션 · PTY · 타일 · 붙이기가 없고 턴(= 프로세스)이 끝나면 끝이다
//!   (판정 없이 끝나면 `exited` · 종결). 판정 뒤 자동 종료는 없다(턴 시한이 받친다).
//! - Run 옵션 `requireReview`(기본 끔) — 조정자 수락은 현재 보고의 마지막 유효 판정이 pass 일 때만, 사람 수락은 넘고 면제를 기록한다.
//!
//! ## 3차 3a(10-16) — 헤드리스 작업자 · 맡긴 저장소의 역할 · 수락 규칙
//!
//! - **작업자 · 해결자도 헤드리스 턴**(`server::workers` — 판정형과 같은 `run_turn_blocking`). 상태: `running`(턴이 돈다) → 턴 끝에 보고가 있으면
//!   `reported`(닫힘) · 없으면 `idle`(열림 · worktree 쥠 · 동시 자리 안 차지 · `blocked` 표지 가능) · 중단은 트리 종료 확인 뒤 `stopped`. 판정형은
//!   한 턴(판정 → `reported` · 없으면 `exited`). 술어 넷(`model.rs`)이 실행 방식(PTY 옛 파일 · 헤드리스)마다 갈린다.
//! - **턴 토큰**(턴마다 새 · 그 턴의 트리 종료 확인 뒤 회수 · `idle` 에는 산 토큰 없음) · **턴 MCP 파일**(`orch-<att>-t<n>.json` — 턴 claim).
//! - 조정자 `send_prompt`(`resume.rs`) = **같은 대화를 resume 하는 새 턴**: `idle` · 대화 고정 · 끊기지 않음 · 맡기기 · 역할 · 동시 · 턴 한도 · 글
//!   상한 관문 → `started{turn}`(생성 대기 상한을 넘으면 `launching: true` — 예약만 섰다) · `rejected{spawn-failed}`. 도는 중이면 `busy{attemptIds}`(큐 없음). init 의 대화 id 가 다르면 그 턴은 실패 ·
//!   대화 끊김(`conversation-broken`).
//! - **역할 · 맡기기**(`roles.rs`) — `spawn_worker{role:<id>}` 는 지금 맡기기의 역할 표에서만(옛 `cli` → `bad-args`), 맡기지 않은 저장소 ·
//!   앱 밖 변경 · 신원 바뀜이면 새 Attempt · 새 턴 · 조정자 수락을 거절(`not-delegated` · `delegation-changed`). CLI · 종류는 Attempt 사본 고정
//!   (`role-changed` · `role-removed`), 모델 · 강도 · 권한 · 허용 명령 · 지침은 턴마다 지금 값. 효과 직전(서버 손)에 다시 본다(`turn_preflight`).
//!   판정 총 한도는 맡기기 `max_reviews`, 실행 시한은 `turn_minutes`.
//! - **수락 규칙**(수락 순간의 지금 맡기기) — 조정자 `accept-rule-unmet{unmet[], reviewsLeft, hint}` · 사람은 넘고 `waived[]` 를 산출물에.
//!   **되돌림 한도** `rework-limit{used, max}`. 무인 검증은 후보마다 맡기기 · 명령 해시 · 확인 칸을 다시 보고, 어긋나면 사람 확인으로.
//! - **영속 판 3**(`FILE_VERSION` — {1, 2, 3} 읽기). 걷은 것: `deliver.rs` · `autostop.rs` · 작업자 PTY 세션 · 입력 추적 · 신호 → 상태 ·
//!   [돌려주기] · [복구 완료] · [유지] op.
//!
//! ## 3차 5단계(10-17) — AI 가 Run 을 연다
//!
//! - 타일 도구 **`start_run`**(`start.rs` — 설계 3-2 의 판정 0~8: 멱등 먼저 · 산 타일 · `already-coordinating` · repo 생략 = 시작 폴더의 toplevel ·
//!   맡기기 `not-delegated` · `delegation-changed` + 알림 `delegation-needed{repo}` · `out-of-scope:<칸>` · 동시 · git · 통합 ref · 시작 빈도
//!   `run-rate-limited` · `origin = ai` · 그 타일이 재시작 없이 조정자(묶음 gen 1) · 이벤트 `orchestration-board`) · **`adopt_run`**(조정자 CLI 가 끝나 멈춘
//!   Run 만 · 세대 +1 · 곧바로 running · 알림 `run-adopted`) · 조정자 **`complete_run`**(Q5 — `completable` · idle 닫기 · `export{ok, branch | reason}`).
//! - (그때) 도구 목록 · CLI 미리 허용은 맡긴 저장소가 하나라도 있을 때 모든 로컬 AI 타일 — 오케스트레이션 탭 2단계(아래 절)에 프로듀서 채팅으로 옮겼다.
//!   조율 도구 스키마 합 ≤ 7.5 KB(설명 다이어트 — 긴 계약은 INSTRUCTIONS 의 오케스트레이션 절).
//!
//! ## 3차 6단계(10-17) — 옛 길 걷기
//!
//! - **Run 은 AI 타일의 `start_run` 으로만 열린다** — 사람의 시작 op(`orchestration_start_run`) · 시작 미리 보기 · 사람이 띄운 조정자 타일(GUI 의
//!   `active_gen` · `bind_coordinator` 묶기 · autorun 의 `orchestrationRunId` 갈래) · [이어 가기](`continue_run` — 복구 길은 `adopt_run`)를 걷었다.
//! - 조정자 worktree 도구 셋(`list_worktrees` · `create_worktree` · `remove_worktree`)과 `aynx wt` CLI · 조정자 타일의 `AYNX_CLI` 를 걷었다(Q6) —
//!   남은 것: 사람의 [worktree 지우기] op · [정리] · 공통 구현(`worktree.rs` — 예약 · 곁 기록 · 파일 잠금 · 정션 먼저 걷는 보수적 삭제).
//! - 2차 시작 대화의 옛 칸(`workerPermission` · `attachMode` · `autoStopReported` · `allowedClis` · `reviewerClis` · `deliveries`)은 **영속 파일 읽기 ·
//!   다시 저장 때 보존만**(새 Run 은 쓰지 않고 보기 · MCP 에는 싣지 않는다). Run 완료 결과의 서버 임시 자리 칸은 `serverTemp`(작업자 worktree 는 남는다).
//!
//! ## 오케스트레이션 탭 2단계(10-30 — aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md) — 프로듀서 채팅
//!
//! - **조정자 자리 = 프로듀서 채팅**(`store::Seat{chat, proc}` — 오케스트레이션 탭의 구조화 채팅 프로세스 · `server::producer`). Run 은 그 채팅의
//!   `start_run` 으로만 열리고(스튜디오 = 그 채팅의 맡긴 저장소 하나) 귀속은 Run 파일의 `producers`(채팅 하나 = 앨범 하나 — `producer_ever` 색인).
//!   이어받기는 `adopt_verdict` 하나(목록 요약 `adoptable` 과 같은 함수). 앱이 깨움(`wake.rs`)은 그 채팅에만.
//! - **타일은 자리가 되지 못한다** — 1단계(10-29)의 터미널 프로듀서 길(타일 표지 op · 타일 자리 · 타일 멱등 ·
//!   호출 표지 · 시작 폴더)은 걷었다. 로컬 AI 타일 · 감싸개 셸 타일의 목록은 13 + DB 뿐이고 CLI 미리 허용도 없다 — 타일 토큰으로 타일 도구 ·
//!   조율 도구를 부르면 모르는 도구다(`tools.rs` `is_tool_for` 에 갈래가 없다 · 시험 `tile_token_cannot_open_or_coordinate`).
//!
//! ## 불변식(CLAUDE.md "보안 제약" · 설계 결정 절)
//!
//! - **역할 토큰은 같은 계정 안의 보안 경계가 아니다**(설계 C-1 (가)) — 같은 Windows 계정의 프로세스는 토큰을 읽을 수 있다. 토큰이
//!   보장하는 것은 정상 에이전트의 역할 구분 · 귀속 · 실수 방지이고, 방어선은 맡긴 역할의 권한 + 사람 감독이다.
//! - 역할은 **서버 표에서만** 읽는다. 조정자의 조율은 자기 Run 안에서만(다른 Run 은 `not-found`).
//! - 토큰 값은 프런트 · 로그 · `Debug` · 영속 파일 · 이벤트에 나가지 않는다. **조정자 토큰은 없다** — 조정자는 프로듀서 채팅의 **채팅 토큰**
//!   (`crate::chat_token` 종류 `producer` — 인증 때 확정한 `(chat, ProcId)` · 값은 그 프로세스의 임시 `--mcp-config` · 환경에만)에 서버 표의 묶음
//!   (`Slot.coordinator`)이 붙인 역할이고, 조율 요청은 예상 `runId` · `gen` 이 묶음과 맞을 때만이다(`tile.rs`).
//! - 조정자는 Run 을 멈추거나 사람의 상태(일시정지 · 재개 · 중단)를 바꾸지 못한다(사람 전용 op). 프로듀서 채팅은 **맡긴 저장소 · 맡긴 값 ·
//!   시작 빈도 안에서만** Run 을 열고(`start_run`) 조정자는 완료할 수 있다(`complete_run` — main 은 건드리지 않는다). 키 전송 · 권한 응답 · 승인 ·
//!   실행 · 위임 편집 도구는 어느 역할에도 없다.
//! - **AI 문자열 → PTY 길은 없다**(3a). AI 문자열이 프로세스에 닿는 길은 헤드리스 턴의 **실행 인자** 하나 — 첫 지시(`spawn_worker`) ·
//!   이어지는 지시(`send_prompt` → resume 턴), 셸 없는 인자 배열의 `--` 뒤 머리줄 `[` 로 시작하는 한 칸(시험 `send_prompt_is_resume_turn_not_pty`).
//! - 서버가 GUI 요청 없이 띄우는 것은 **둘뿐** — **헤드리스 턴**(작업자 · 해결자 · 판정형 — `server::os::spawn_in_job`)과 **수락 전 검증 명령**(사람이 저장소 맡기기에서 정한 한 줄의 Run 사본을 후보마다 사람 확인 ·
//!   또는 사람이 켠 자동 실행으로 — `verify.rs`, 시험 `server_spawns_only_turns_and_verify`). 통합 git(`merge-tree` 등)은 세션이 아니라
//!   서버 집행 git 이다(셸 없음 · 훅 끔 · 지원 범위 밖 저장소는 거절 — 드라이버 · 필터가 돌지 않게).
//! - 자동 재개 없음 — 서버가 다시 뜨면 남은 Run 은 orphaned 로 보이고 사람이 판단한다.

mod accept;
pub(crate) mod album;
pub(crate) mod config;
pub(crate) mod repo_identity;
pub(crate) mod album_start;
pub(crate) mod album_change;
mod album_merge;
pub(crate) mod artists;
mod attempts;
mod cleanup;
mod commit;
mod diff;
pub(crate) mod git;
mod integrate;
mod merge;
mod model;
pub(crate) mod notice;
pub(crate) mod ops;
mod persist;
pub(crate) mod progress;
mod report;
mod resolve;
mod resume;
mod review;
pub(crate) mod roles;
pub(crate) mod spawn;
mod start;
mod store;
mod tile;
mod tools;
pub(crate) mod turn;
pub(crate) mod verify;
pub(crate) mod wake;
pub(crate) mod worktree;

pub(crate) use attempts::SpawnVerdict;
pub(crate) use integrate::GitRefs;
pub(crate) use model::{AttemptKind, TurnArgsLabel, TurnRecord, WorkerCli};
pub(crate) use persist::store_dir;
pub(crate) use notice::EVT_NOTICE;
pub(crate) use store::reason::NOT_A_TILE;
pub(crate) use model::RunState;
pub(crate) use store::{Caller, Orchestration, Seat, EVT_CHANGED, EVT_PROGRESS};
pub(crate) use start::{repo_toplevel, tile_tool_schemas, TILE_TOOLS};
pub(crate) use tools::{coordinator_tool_schemas, is_tool_for, reviewer_tool_schemas, worker_tool_schemas, COORDINATOR_TOOLS};

/// 프로듀서 채팅이 묻지 않고 부를 오케스트레이션 도구 전부(타일 도구 + 조율 도구). 프로듀서 CLI 미리 허용(`server::producer::launch::preallowed`) ·
/// 시험이 이 한 표를 본다. 로컬 AI 타일 · 감싸개 셸 타일에는 미리 허용이 없다(목록에도 없다).
pub(crate) fn preallowed_tools() -> impl Iterator<Item = &'static str> {
    TILE_TOOLS.iter().chain(COORDINATOR_TOOLS.iter()).copied()
}

/// 충돌 해결 자리를 깐다(서버 손 — `server::workers` 가 worktree 를 만든 뒤 · 블로킹 git). 되살린 경로 수.
pub(crate) fn seed_conflict(worktree: &std::path::Path, seed: &spawn::ResolveSeed) -> Result<usize, store::OrchError> {
    resolve::seed_blocking(worktree, &seed.old, &seed.conflict_commit)
}

/// 검토 자리를 만든다(서버 손 — `server::workers`, 블로킹 git): 보고 커밋의 분리 HEAD worktree(Run 자리 안 · 훅 끔 · 곁 파일
/// `role: review`) + 빈 cwd. `(자리, cwd)`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn review_place(
    repo: &std::path::Path,
    worktree_dir: &str,
    cwd_root: &std::path::Path,
    run_id: &str,
    task_id: &str,
    attempt_id: &str,
    commit: &str,
    sidecar: Option<&std::path::Path>,
) -> Result<(String, String), store::OrchError> {
    review::place_blocking(repo, worktree_dir, cwd_root, run_id, task_id, attempt_id, commit, sidecar)
}

/// 검토 자리의 추적 symlink 대상이 모두 자리 안인가(9절 위험 5 확정 — 아니면 `symlink-outside`).
pub(crate) fn review_links_ok(place: &std::path::Path) -> Result<(), store::OrchError> {
    review::check_links_blocking(place)
}

/// Run id 모양(`run-` + 32 hex)인가 — GUI 의 조정자 역할 설정 파일 이름 검사(`agent_mcp`).
pub(crate) fn is_run_id(s: &str) -> bool {
    model::is_id("run", s)
}

/// Attempt id 모양(`att-` + 32 hex)인가 — 작업자 역할 설정 파일 이름 검사(`agent_mcp`).
pub(crate) fn is_attempt_id(s: &str) -> bool {
    model::is_id("att", s)
}

#[cfg(test)]
pub(crate) mod test_album;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_album;
#[cfg(test)]
mod tests_spawn;
#[cfg(test)]
mod tests_report;
#[cfg(test)]
mod tests_wt;
#[cfg(test)]
mod tests_headless;
#[cfg(test)]
mod tests_progress;
#[cfg(test)]
mod tests_commit;
#[cfg(test)]
mod tests_stage1;
#[cfg(test)]
mod tests_stage2;
#[cfg(test)]
mod tests_stage3;
#[cfg(test)]
mod tests_stage3b;
#[cfg(test)]
mod tests_stage4;
#[cfg(test)]
mod tests_stage5;
#[cfg(test)]
mod tests_stage6;
#[cfg(test)]
mod tests_archive;
#[cfg(test)]
mod tests_merge;
#[cfg(test)]
mod tests_turn;
#[cfg(test)]
mod tests_state;
#[cfg(test)]
mod tests_tile;
#[cfg(test)]
mod tests_start;
#[cfg(test)]
mod tests_producer;
#[cfg(test)]
mod tests_wake;

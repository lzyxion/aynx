//! 파이프 위의 **프레임 셋**과 판 협상 — 순수(입출력은 [`read_frame`]·[`write_frame`] 두 함수뿐).
//!
//! ```text
//! [u32 LE 길이][JSON 한 덩어리]          길이 상한 MAX_FRAME (넘으면 끊는다) — 몸의 첫 바이트가 `{`
//!   {"t":"request","id":7,"kind":"read","op":"ping","body":null}
//!   {"t":"response","id":7,"ok":true,"body":{...}}              실패면 "error":{"code","message"}
//!   {"t":"event","seq":3,"name":"…","body":{...}}                서버 → 클라이언트, seq 는 연결마다 1부터
//!   {"t":"ack","stream":"…","sessionEpoch":1,"leaseEpoch":2,"consumed":4096}   클라이언트 → 서버(판 2, 응답 없음)
//! [u32 LE 길이][0x01][u32 LE 머리 길이][머리 JSON][바이트…]      출력 스트림(판 2) — 서버 → 클라이언트, base64 없음
//!   머리 = {"stream":"…","sessionEpoch":1,"leaseEpoch":2,"offset":8192}
//! [u32 LE 길이][0x02][u64 LE 채널 번호][바이트…]                 채널 터널(판 5) — **양방향**, 0 바이트 = 그 방향의 끝(EOF)
//!   {"t":"chanack","chan":3,"consumed":65536}                     채널 크레딧(판 5) — 받은 쪽이 소비한 누적 바이트(양방향)
//! ```
//!
//! **채널 터널(판 5 — ③-3b2)**: 서버가 연 SSH 서브시스템 채널(SFTP)의 바이트를 [`Frame::Channel`] 로 그대로 나른다 — GUI 의
//! russh-sftp 클라이언트가 그 위에서 돈다(`server::tunnel`). 흐름 제어는 출력/ACK 와 같은 규칙을 **양방향**으로: 보낸 쪽은
//! 받은 쪽이 [`Frame::ChanAck`] 로 돌려준 누적 소비량과의 차이가 예산을 넘으면 멈춘다(단조 증가만, 보낸 끝을 넘는 ACK 는
//! 버린다 — `server::credit::Ledger`).
//!
//! **출력과 ACK(판 2 — ③-2)**: 서버는 세션 출력을 [`Frame::Output`] 으로 보내고(오프셋 = 꼬리 링 축), 클라이언트는 화면에
//! 반영한 오프셋을 [`Frame::Ack`] 로 돌려준다 — 그 차이(송신 − ACK)가 크레딧이다(`server::credit`). JSON 프레임은 늘 `{` 로
//! 시작하므로 첫 바이트 하나로 가른다 — 판 1 의 JSON 프레임 모양(특히 `hello`·`shutdown`)은 그대로다.
//!
//! **등급**(설계 4.6): 같은 exe 라는 확인은 "사람이 승인했다" 의 증명이 아니라서 요청마다 등급을 싣고, 서버는
//! op 가 요구하는 등급과 **정확히 같을 때만** 받는다([`required_grade`]). `Approve` 를 요구하는 op 는 **`ops_approve`
//! 하나뿐**이다(판 6 · ③-3c) — 승인 등급으로 그 밖의 op 를 부르면 `approve-refused`, `ops_approve` 를 쓰기·읽기 등급으로
//! 부르면 `grade-mismatch`. 승인 프레임을 만드는 코드는 GUI 의 Tauri 명령 `approve_operation` 하나다(`server::client::request_approve`
//! — 시험 `approve_frames_come_from_one_place` 가 소스를 훑어 고정한다). 서버는 승인 프레임을 믿고 끝내지 않는다 — 만료·상한·
//! 자동 승인 정책·대상별 자동 실행 권한·빈도 한도를 **서버가 다시** 본다(`operations::approval::approve_in`).
//!
//! **판에 무관한 op 둘** — `hello`·`shutdown` 의 요청 모양은 판이 바뀌어도 **바꾸지 않는다**. 판이 어긋난 GUI 도
//! 그 서버를 정상 종료시킬 수 있어야 사람이 "새 서버로" 를 고를 수 있다(설계 4.2 — 조용한 교체 없음).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// 이 빌드가 말하는 프로토콜 판 범위. 프레임·op 의 모양을 바꾸면 `MAX` 를 올리고, 옛 판을 더 말하지 않게 되면 `MIN` 을 올린다.
///
/// 판 2(③-2): 로컬 세션 op 표 · 출력 스트림 프레임 · ACK. 판 1 서버는 세션을 쥐지 않으므로(③-1) 판 1 을 더 말하지 않는다 —
/// 판 1 서버를 만나면 GUI 가 판 불일치로 보고, 세션이 없음이 확실하니(판 1 = 세션 op 없음) 스스로 갈아 띄운다(`client`).
///
/// 판 3(③-3a): 신호 평면 op(`signal_*`·`agent_state*`) · `hello`·`status` 의 `signal_port` · `open` 몸의 `signal` 이 열쇠 대신
/// "신호를 받을 스트림인가"(bool) · `local-released` 이벤트 없음(로컬 토큰은 서버가 스스로 거둔다). 판 2 서버는 세션을 쥐고
/// 있을 수 있으므로 **조용히 갈지 않는다** — 판 불일치로 사람의 [다시 시작] 을 기다린다(`client::SESSIONLESS_MAX`).
///
/// 판 4(③-3b1): 볼트 평면 op(`vault_*`·`mcp_prepare`·`mcp_retain` — `server::vault_ops`) · `status` 의 `mcp`. 판 3 서버도 세션을
/// 쥐고 있을 수 있으므로 같은 규칙(사람의 [다시 시작])이다.
///
/// 판 5(③-3b2): SSH 평면 — `open_ssh`·`ssh_info`·`ssh_log_path`·`forward_*`·`worktree_answer`·`headless_*`·`ssh_exec*`·
/// `chan_*`, 세션 op(`write`·`close`·`attach`·`adopt`·`stats` …)의 kind 무관화, 채널 터널 프레임([`Frame::Channel`] ·
/// [`Frame::ChanAck`]), 신호 토큰 op 넷(`signal_issue`·`signal_revoke`·`signal_written`·`signal_live`) 삭제, 과도기 볼트 op
/// 삭제. 판 4 서버도 세션을 쥐고 있을 수 있으므로 같은 규칙(사람의 [다시 시작])이다.
///
/// 판 6(③-3c): AI 평면 — MCP(`/mcp` · `mcp.json`)·거울·라우팅·작업안·결과·실행기·감사가 서버로 왔다(`server::ai`). 거울 묶음
/// `ctx_batch` · 작업안 op(`ops_*`) · MCP 좌표(`mcp_coords`·`mcp_token`·`mcp_activity`) · `console_sessions` · `audit_status` ·
/// `agent_mcp_claim(s)` · 헤드리스 op 의 몸이 스트림 열쇠로 바뀜(`headless_open` 이 거울·라우팅까지 잇는다) · **승인 등급이 처음으로
/// 받아들여진다 — `ops_approve` 하나만**. 판 5 서버도 세션을 쥐고 있을 수 있으므로 같은 규칙(사람의 [다시 시작])이다.
///
/// 판 7(③-4): 떨어진 세션 목록 — `sessions_detached`(읽기)·`close_detached`·`session_ai_read`, `release_unclaimed` 를
/// `restore_done` 으로 바꿈(복원이 데려가지 않은 세션을 **닫지 않고** 표시만 — 답이 `{closed, unclaimed}`) · `probe` 답의 `aiRead` ·
/// 이벤트 `sessions-detached-changed`·`operation-auto-refused` · 서버 자동 승인 op `ops_reviewing`·`ops_unseen_take` · `ops_list` 의
/// `autoRefusals` · 찾기 파일의 `sessions`. **승인 등급은 여전히 `ops_approve` 하나**(서버 자동 승인은 파이프 프레임이 아니다).
/// 판 6 서버도 세션을 쥐고 있을 수 있으므로 같은 규칙(사람의 [다시 시작])이다.
///
/// 판 8(쿼리 타일 5단계): DB 평면 op(`db_open`·`db_query`·`db_cancel`·`db_schema`·`db_objects`·`db_table_detail`·`db_definition`·`db_set_write`·`db_close` —
/// `server::db_ops`). **처음으로 `MIN` 을 올리지 않는다** — 판 7 의 op 모양은 하나도 바뀌지 않았고 새 op 만 늘었다. 그래서 새 GUI 는
/// 판 7 서버에 그대로 붙어(협상 = 7) 셸·SSH 세션을 잃지 않고, DB op 만 "세션 서버 재시작 필요" 로 거절한다
/// ([`DB_PROTOCOL`] — GUI `server::db_proxy` 가 보내기 전에, 서버 `serve` 가 받을 때 두 번 본다).
///
/// 판 9(쿼리 타일 1단계 — 트랜잭션 작업): 새 op `db_tx`(작업 열기 · 커밋 · 되돌리기 · 연장 · 상태) · `db_query` 몸의 `txId` ·
/// `db_query`·`db_open` 답의 `tx` · 이벤트 `db-state {state: "tx"}`. 판 8 과 같은 규칙으로 **`MIN` 을 올리지 않는다** — 옛 op 의
/// 모양은 그대로이고(답에 칸이 늘었을 뿐 — 판 8 GUI 는 모르는 칸을 버린다) 새 op 만 늘었다. 새 GUI 가 판 8 서버에 붙으면 쿼리
/// 타일은 그대로 쓰고 **트랜잭션 작업만** "세션 서버 재시작 필요"(`[server-outdated]`)로 거절한다([`DB_TX_PROTOCOL`]).
///
/// 판 10(쿼리 타일 2단계 — 스크립트 실행): 새 op `db_script`(문장 목록을 한 요청으로 — 전부 검증 → 한 트랜잭션 → 첫 오류에서 전부
/// 되돌림) · `db_open` 답의 `scripts`(판 10 표지) · `lastScript`. 같은 규칙으로 **`MIN` 을 올리지 않는다** — 새 GUI 가 판 9 서버에
/// 붙으면 [스크립트 실행] 만 숨긴다(`opened.scripts` 없음) · 보내면 `[server-outdated]`([`DB_SCRIPT_PROTOCOL`]).
///
/// 판 11(쿼리 타일 3단계 3a — 자체 DB MCP): **op 는 늘지 않았다** — 바뀐 것은 이 서버의 MCP(`/mcp`)가 DB 도구(구조 · 읽기 조회)를
/// 낸다는 것이다(권한은 `delegation.toml` `[[database]]` — GUI 가 쓰고 서버가 도구 호출마다 읽는다). 판은 **표지**로만 올린다: 새 GUI 가
/// 판 10 서버에 붙으면(협상 = 10) DB 연결 폼의 AI 권한 칸이 "세션 서버를 다시 시작해야 AI 가 DB 를 봅니다" 를 밝힌다
/// ([`DB_AI_PROTOCOL`] — `delegation::database::db_ai_list` 의 `serverReady`). 같은 규칙으로 **`MIN` 을 올리지 않는다**.
///
/// 판 12(쿼리 타일 3단계 3b — AI 의 DB 쓰기 작업안): 역시 **op 는 늘지 않았다** — MCP 에 `create_db_write_plan`(초안만) · 작업안의
/// `db` 칸 · 결과의 `db` 칸 · 감사의 `dbWrite` 칸이 늘었고, 승인은 그대로 `ops_approve` 하나다(DB 작업안은 서버가 DB 실행 태스크로 가른다).
/// 판은 **표지**로만 올린다: 새 GUI 가 판 11 서버에 붙으면 AI 권한 칸의 'Ask' 가 "세션 서버를 다시 시작해야 쓰기 작업안이 섭니다"
/// 를 밝힌다([`DB_WRITE_PLAN_PROTOCOL`] — `db_ai_list` 의 `writePlans`). 판 11 GUI 는 모르는 칸(`db`)을 버린다(검토 카드는 문장 글을
/// `command` 로 그대로 보인다). 같은 규칙으로 **`MIN` 을 올리지 않는다**.
///
/// 판 13(쿼리 타일 — 자동 커밋 토글 · 실행 단위 세이브포인트, 10-14): op 는 늘지 않았다 — `db_set_write` 몸의 `autoCommit` · 답의
/// `autoCommit` · `db_open` 답의 `autoCommit`(표지) · `db_script` 답의 `outcome: "workUndone"` 이 늘었다. 판 12 서버는 `autoCommit` 을
/// **버리므로**(끈 줄 알고 친 문장이 곧바로 커밋된다) 새 GUI 는 판 12 서버에 그 칸을 보내지 않고(`[server-outdated]` —
/// [`DB_AUTOCOMMIT_PROTOCOL`]) 화면은 `opened.autoCommit` 이 없으면 토글을 숨긴다. 같은 규칙으로 **`MIN` 을 올리지 않는다**.
///
/// 판 14(쿼리 타일 — Codex 검토 반영 1, 10-14): op 도 칸도 늘지 않았다 — **판정 동작**이 바뀌었다(작업 안 실행의 "이번 실행만 되돌림" 은
/// 복구를 확인했을 때만 · 증명할 수 없는 끝은 `unknown` · 응답 대기 중단 = 결과 미확인 + 연결 버림 · 자동 커밋 끔 조회의 PG · MySQL
/// 실행 중 읽기 전용 거절은 다시 돌지 않고 `[db-needs-work]` · MySQL 종료문 `AND NO CHAIN NO RELEASE` · 작업 · 스크립트 안 MySQL `CALL` ·
/// `CREATE/DROP TEMPORARY` 거절). 판 13 GUI 도 모두 아는 값(`unknown` · 문구)만 받는다. 판은 **표지**로만 올린다 — GUI 프록시가 `db_open`
/// 답에 `txVerdicts`(협상 ≥ 14)를 얹어 화면이 판 13 서버(예전 판정 — 다시 돌기)와 가를 수 있게 한다([`DB_TX_VERDICT_PROTOCOL`]).
/// 같은 규칙으로 **`MIN` 을 올리지 않는다**.
///
/// 판 15(쿼리 타일 — Codex 검토 반영 2, 10-14): op 도 칸도 늘지 않았다 — **연결별 조정 장치**가 섰다(실행 · 작업 시작 · [커밋] ·
/// [되돌리기] · 모드 바꾸기 · 메타 조회 · 방치 되돌리기가 한 번에 하나 — 작업 id · 모드 검증도 그 안에서). 그래서 실행이 도는 동안의
/// [커밋] · [되돌리기] · 작업 시작 · 모드 바꾸기 · 메타 조회는 바쁨으로 거절되고(판 14 서버는 커밋을 받아 실행과 겹칠 수 있었다), 방치
/// 되돌리기가 엔진에 닿지 못하면 다시 간다. 실행 결과 미확인 오류에 이유 코드 `[db-unconfirmed]` 가 붙는다(판 14 GUI 는 모르는 코드라 문구 그대로 —
/// 내용은 같다). 판은 **표지**로만 올린다 — GUI 프록시가 `db_open`
/// 답에 `txSerial`(협상 ≥ 15)을 얹는다([`DB_TX_SERIAL_PROTOCOL`]). 같은 규칙으로 **`MIN` 을 올리지 않는다**.
///
/// 판 16(원격 웹 R1a-2): 새 op `vault_verify_master`(마스터 확인만 — 상태를 바꾸지 않는다 · 값 없음 · 실패 빈도 제한). 같은 규칙으로
/// **`MIN` 을 올리지 않는다** — 새 GUI 가 판 15 서버에 붙으면 그 op 만 보내지 않는다(`[server-outdated]` — [`VAULT_VERIFY_PROTOCOL`]).
///
/// 판 17(원격 웹 R2-A — 다중 시청자): 새 op `attach_viewer`·`detach_viewer` · 출력 머리의 `route`(시청자 싱크의 GUI 경로 번호 — 없으면
/// 주의 것, 옛 GUI 는 모르는 칸을 버린다) · 이벤트 `session-size-owner`·`session-viewer-ended` · `attach` 답의 `sizeOwner`. 쓰기·크기·ACK
/// 의 몸은 그대로다(시청자의 열쇠를 실을 뿐 — 옛 서버에는 시청자가 생기지 않는다). 같은 규칙으로 **`MIN` 을 올리지 않는다** — 새 GUI 가
/// 판 16 서버에 붙으면 시청자 op 만 보내지 않는다(`[server-outdated]` — [`VIEWER_PROTOCOL`]).
pub(crate) const PROTOCOL_MIN: u32 = 7;
///
/// 판 18(로컬 자원 모니터): 새 op `resource_snapshot`(읽기 — 관찰 임대 · `since` 뒤 표본). 같은 규칙으로 **`MIN` 을 올리지 않는다** —
/// 새 GUI 가 판 17 서버에 붙으면 그 op 만 보내지 않는다(`[server-outdated]` — [`RESOURCE_PROTOCOL`]).
///
/// 판 19(사이드 채팅 v2 — `server::side_chat`): 새 op `side_chat_*` 여덟 · 이벤트 `side-chat-event`. 같은 규칙으로 **`MIN` 을 올리지
/// 않는다** — 새 GUI 가 판 18 서버에 붙으면 그 op 만 보내지 않는다(`[server-outdated]` — [`SIDE_CHAT_PROTOCOL`]).
///
/// 판 20(오케스트레이션 2단계 단계 2 — `server::producer`): 새 op `producer_chat_*` · `orchestration_revoke_producer`(2026-11-05 걷음 — 부르는 화면이 없었다) · 이벤트
/// `producer-chat-event`. 같은 규칙으로 **`MIN` 을 올리지 않는다** — 새 GUI 가 판 19 서버에 붙으면 그 op 만 보내지 않는다([`PRODUCER_PROTOCOL`]).
///
/// 판 21(사이드 채팅 보는 창 여럿 — 2026-11-01 원격 웹 창): `side_chat_*` 의 몸은 그대로이고 **뜻이 바뀐다** — `open` · `attach` 가 임대를
/// 덮지 않고 덧붙이며, 사건 `side-chat-event` 의 몸이 `{window}` → `{windows: [...]}` · `side_chat_list` 줄의 `window` → `viewers`(수) ·
/// `userAccepted` 에 `text` · `files`. 옛 서버와 섞이면 주 창이 끊기거나 본문이 버려지므로 **사이드 채팅 op 는 판 21 미만이면 보내지도
/// 받지도 않는다**(`[server-outdated]` — 세션 서버 다시 시작 · [`SIDE_CHAT_VIEWERS_PROTOCOL`]). 같은 규칙으로 **`MIN` 을 올리지 않는다**.
///
/// 판 22(타일 권한 카드 — 2026-11-01 `server::tile_permission`): 새 op `tile_permission_decide`(쓰기) · `tile_permission_snapshot`(읽기) · 이벤트
/// `tile-permission-event`(방송 아님 — GUI 가 몸의 `windows` 통로에만). 같은 규칙으로 **`MIN` 을 올리지 않는다** — 새 GUI 가 판 21 서버에 붙으면
/// 그 op 만 보내지 않는다(`[server-outdated]` — [`TILE_PERMISSION_PROTOCOL`]).
///
/// 판 23(2026-11-02): 타일 권한 카드의 **질문 카드** — `tile_permission_decide` 의 결정 `answer` + `answers`(Claude `AskUserQuestion`) · 신호 평면 op
/// `agent_state_interrupt`(대화 면 [중지]). 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 22 서버면 답만 보내지 않는다([`TILE_QUESTION_PROTOCOL`])
/// · `agent_state_interrupt` 는 옛 서버가 모르는 op 로 거절한다(창은 삼킨다).
///
/// 판 24(2026-11-02 면 규칙): op `tile_permission_face`(쓰기 — 창이 그 타일의 지금 면을 알린다 · 서버가 대화 면으로 보는 창이 없으면 카드 없이 TUI 로) ·
/// 스냅숏의 `tuiAsking` · 사건 `{t: "tui"}`. 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 23 서버면 면을 알리지 않는다(예전처럼 카드).
///
/// 판 25(2026-11-04 완료 확인 공유): op `agent_state_seen`(쓰기 — 표시 전용) · 방송 `agent-seen{stream, seq}`. 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 24 서버면
/// 보내지 않는다(창마다 따로 지우는 예전 그대로 · [`AGENT_SEEN_PROTOCOL`]).
///
/// 판 26(2026-11-05 앨범 보관함): op `orchestration_archive` · `_archive_list` · `_restore` · `_delete_archived` · 요약의 `worktreesLeft`(옛 op `orchestration_close_orphaned` 는 걷었다).
/// 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 25 서버면 보관함은 비어 보이고 쓰기는 `[server-outdated]`([`ALBUM_ARCHIVE_PROTOCOL`]).
///
/// 판 27(2026-11-07 앨범 병합): op `orchestration_merge_preview`(읽기) · `orchestration_merge`(쓰기) · 앨범 구성 칸 `autoMerge` · 상세의 `merge` · `mergedOutside`.
/// 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 26 서버면 [병합]만 `[server-outdated]` 이고 복사는 그대로다([`ALBUM_MERGE_PROTOCOL`]).
///
/// 판 28(2026-11-09 DB 연결 폼 [연결 테스트]): op `db_test`(쓰기 — 저장 안 한 초안으로 한 번 붙고 닫는다 · 표 · 접속 기록 없음). 같은 규칙으로
/// **`MIN` 을 올리지 않는다** — 판 27 서버면 폼이 [연결 테스트] 단추를 숨긴다(`db_ai_list` 의 `connTest` · 보내면 `[server-outdated]` — [`DB_TEST_PROTOCOL`]).
///
/// 판 29(2026-11-09 ② DB 타일도 떨어진 세션으로): 새 op 없음 — 창이 사라지면 쿼리 타일의 DB 연결이 TTL 없이 남고 `sessions_detached` 답에
/// `kind: "db"` 줄(새 칸 `conn` · `writable` · `inTx`)이 실린다 · `restore_done` 의 `keep` 에 `query:<tileKey>` · `close_detached` 가 DB 줄도 닫는다.
/// 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 28 서버면 DB 줄이 없을 뿐이고(그 서버는 예전처럼 10분 TTL) GUI 가 `keep` 의 DB 열쇠를 빼고
/// 보낸다([`DETACHED_DB_PROTOCOL`]).
///
/// 판 30(2026-11-10 쿼리 타일 데이터 탭): 새 op 없음 — `db_query` 몸의 `readOnly`(타일 모드와 무관하게 가드 · 엔진 읽기 전용 · 열린 작업이면
/// 거절). 옛 서버는 모르는 칸을 버리고 타일 모드대로 돌리므로, 같은 규칙으로 **`MIN` 을 올리지 않되** GUI 가 판 29 서버에는 그 조회를 보내지
/// 않는다(`[server-outdated]` — [`DB_READ_QUERY_PROTOCOL`]).
///
/// 판 31(2026-11-13 사이드 채팅 완료 확인 공유): op `side_chat_seen`(쓰기 — 표시 전용) · 방송 `side-chat-seen{chat, epoch, seq}`. 판 25 와 같은
/// 결이고 같은 규칙으로 **`MIN` 을 올리지 않는다** — 판 30 서버면 보내지 않는다(배너는 창마다 따로 풀리는 예전 그대로 · [`SIDE_CHAT_SEEN_PROTOCOL`]).
///
/// 판 32(2026-11-14 사이드 채팅 파일 첨부): 새 op 없음 — `side_chat_send` 몸의 `files`(그림 밖 첨부 — 서버가 그 채팅 cwd 의 `attachments/` 에 사본을
/// 두고 글 끝에 경로를 붙인다). 옛 서버는 모르는 칸을 **버리므로**(사람이 붙인 파일이 소리 없이 빠진다) 판 30 과 같은 규칙으로 **`MIN` 을 올리지 않되**
/// GUI 가 판 31 서버에는 파일이 든 보내기를 보내지 않는다(`[server-outdated]` — [`SIDE_CHAT_FILES_PROTOCOL`]).
pub(crate) const PROTOCOL_MAX: u32 = 32;

/// DB 평면 op 가 서는 판 — 협상된 판이 이보다 낮으면 DB op 를 보내지도 받지도 않는다.
pub(crate) const DB_PROTOCOL: u32 = 8;

/// 트랜잭션 작업 op(`db_tx`)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const DB_TX_PROTOCOL: u32 = 9;

/// 스크립트 실행 op(`db_script`)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const DB_SCRIPT_PROTOCOL: u32 = 10;

/// 세션 서버의 MCP 가 DB 도구를 내는 판(op 없음 — 표지). 낮으면 화면이 AI 권한 칸에 "세션 서버 재시작 필요" 를 밝힌다.
pub(crate) const DB_AI_PROTOCOL: u32 = 11;

/// 세션 서버가 AI 의 DB 쓰기 작업안(MCP `create_db_write_plan` · DB 실행 태스크)을 아는 판(op 없음 — 표지, 3b). 낮으면 화면이 '승인 후
/// 실행' 단계에 "세션 서버 재시작 필요" 를 밝힌다.
pub(crate) const DB_WRITE_PLAN_PROTOCOL: u32 = 12;

/// 자동 커밋 토글(`db_set_write` 의 `autoCommit`)이 서는 판 — 낮으면 GUI 가 그 칸을 보내지 않는다(서버가 버리면 끈 줄 알고 친 문장이
/// 곧바로 커밋된다).
pub(crate) const DB_AUTOCOMMIT_PROTOCOL: u32 = 13;

/// 작업 안 실행 · 끝내기의 판정을 Codex 검토 반영 1 의 규칙으로 하는 판(op 없음 — 표지). 낮으면 GUI 프록시가 `db_open` 답의 `txVerdicts` 를
/// 거짓으로 둔다(그 서버는 자동 커밋 끔 조회의 읽기 전용 거절을 다시 돈다 · `[db-needs-work]` 를 내지 않는다).
pub(crate) const DB_TX_VERDICT_PROTOCOL: u32 = 14;

/// 연결별 조정 장치(Codex 검토 반영 2)가 선 판(op 없음 — 표지). 낮으면 GUI 프록시가 `db_open` 답의 `txSerial` 을 거짓으로 둔다(그 서버는
/// 실행 중 [커밋]을 받아 실행과 겹칠 수 있다 — 화면은 어느 판이든 실행 중 단추를 막는다).
pub(crate) const DB_TX_SERIAL_PROTOCOL: u32 = 15;

/// 마스터 확인 op(`vault_verify_master` — 원격 웹 R1a-2)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const VAULT_VERIFY_PROTOCOL: u32 = 16;

/// 시청자 op(`attach_viewer`·`detach_viewer` — 원격 웹 R2-A)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const VIEWER_PROTOCOL: u32 = 17;

/// 자원 모니터 op(`resource_snapshot`)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const RESOURCE_PROTOCOL: u32 = 18;

/// 사이드 채팅 op(`side_chat_*`)가 서는 판 — 판 19 에 섰고 판 21 에 보는 창 여럿으로 뜻이 바뀌었다(위 `PROTOCOL_MAX` 의 판 21). 낮으면 그
/// op 만 보내지도 받지도 않는다(판 19 · 20 서버도 거절 — 옛 임대 하나의 뜻과 섞지 않는다).
pub(crate) const SIDE_CHAT_VIEWERS_PROTOCOL: u32 = 21;

/// 타일 권한 카드 op(`tile_permission_*`)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const TILE_PERMISSION_PROTOCOL: u32 = 22;

/// 질문 카드의 답(`decision: "answer"`)이 서는 판.
pub(crate) const TILE_QUESTION_PROTOCOL: u32 = 23;

/// 면 알림(`tile_permission_face`)이 서는 판.
pub(crate) const TILE_FACE_PROTOCOL: u32 = 24;

/// 완료 확인 공유(`agent_state_seen`)가 서는 판.
pub(crate) const AGENT_SEEN_PROTOCOL: u32 = 25;

/// 앨범 보관함 op 가 서는 판.
pub(crate) const ALBUM_ARCHIVE_PROTOCOL: u32 = 26;

/// 앨범 병합 op 가 서는 판.
pub(crate) const ALBUM_MERGE_PROTOCOL: u32 = 27;

/// DB 연결 폼의 [연결 테스트] op(`db_test`)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const DB_TEST_PROTOCOL: u32 = 28;

/// 쿼리 타일이 떨어진 세션 목록에 오르는 판(2026-11-09 ②) — 낮으면 GUI 가 복원 알림의 `keep` 에서 DB 열쇠를 뺀다.
pub(crate) const DETACHED_DB_PROTOCOL: u32 = 29;

/// 읽기 전용 조회(`db_query` 의 `readOnly` — 데이터 탭)가 서는 판 — 낮으면 GUI 가 그 조회를 보내지 않는다(옛 서버는 깃발을 버린다).
pub(crate) const DB_READ_QUERY_PROTOCOL: u32 = 30;

/// 사이드 채팅 완료 확인 공유(`side_chat_seen`)가 서는 판.
pub(crate) const SIDE_CHAT_SEEN_PROTOCOL: u32 = 31;

/// 사이드 채팅 보내기의 파일 첨부(`side_chat_send` 의 `files`)가 서는 판 — 낮으면 GUI 가 파일이 든 보내기를 보내지 않는다(옛 서버는 칸을 버린다).
pub(crate) const SIDE_CHAT_FILES_PROTOCOL: u32 = 32;

/// 프로듀서 채팅 op(`producer_chat_*`)가 서는 판 — 낮으면 그 op 만 보내지도 받지도 않는다.
pub(crate) const PRODUCER_PROTOCOL: u32 = 20;

/// 출력 스트림 프레임의 표지 바이트(몸의 첫 바이트). JSON 프레임은 `{`(0x7B)로 시작한다.
const OUTPUT_TAG: u8 = 0x01;
/// 채널 터널 프레임의 표지 바이트(판 5).
const CHANNEL_TAG: u8 = 0x02;

/// 프레임 하나의 상한 — 출력 스트림(③-2)도 이 안에서 쪼갠다.
pub(crate) const MAX_FRAME: usize = 16 * 1024 * 1024;

/// 판 범위 `{min, max}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ProtocolRange {
    pub min: u32,
    pub max: u32,
}

impl ProtocolRange {
    pub(crate) const OURS: ProtocolRange = ProtocolRange {
        min: PROTOCOL_MIN,
        max: PROTOCOL_MAX,
    };
}

/// 두 범위가 겹치면 **겹친 가장 높은 판**, 아니면 `None`. GUI 가 서버보다 새로워도 겹치면 붙는다(구버전 서버 유지).
pub(crate) fn negotiate(a: ProtocolRange, b: ProtocolRange) -> Option<u32> {
    let lo = a.min.max(b.min);
    let hi = a.max.min(b.max);
    (lo <= hi && a.min <= a.max && b.min <= b.max).then_some(hi)
}

/// 요청 등급 — 읽기(목록·상태) / 쓰기(세션 조작·종료) / 승인(작업안 승인 `ops_approve` 하나 — 판 6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Grade {
    Read,
    Write,
    Approve,
}

/// 실패 응답의 몸 — `code` 는 기계가 가르는 ASCII, `message` 는 로그·상태용 한 줄(영어 — 사람 문구는 GUI 가 만든다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct WireError {
    pub code: String,
    pub message: String,
}

impl WireError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        WireError {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// 실패 코드 표 — 클라이언트가 이 글자로 가른다.
pub(crate) mod code {
    /// 판 범위가 겹치지 않는다 — GUI 는 "세션 서버 판 불일치 — 서버 재시작 필요" 로 보인다.
    pub const PROTOCOL_MISMATCH: &str = "protocol-mismatch";
    /// hello 전에 판에 무관하지 않은 op 를 보냈다.
    pub const NEED_HELLO: &str = "need-hello";
    /// 모르는 op.
    pub const UNKNOWN_OP: &str = "unknown-op";
    /// op 가 요구하는 등급과 실은 등급이 다르다.
    pub const GRADE_MISMATCH: &str = "grade-mismatch";
    /// 승인 등급 — `ops_approve` 밖의 op 에는 받지 않는다.
    pub const APPROVE_REFUSED: &str = "approve-refused";
    /// 몸을 풀 수 없다.
    pub const BAD_BODY: &str = "bad-body";
    /// 세션 op 가 실패했다(`message` 는 사람 문구 — 세션 코어의 이유 코드 `[stale-lease]` 등을 그대로 싣는다).
    pub const SESSION: &str = "session";
}

/// 출력 스트림 프레임의 머리 — 어느 세션의 어느 임대 몫인지와 첫 바이트의 오프셋(꼬리 링 축).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputHeader {
    pub stream: String,
    pub session_epoch: u64,
    pub lease_epoch: u64,
    pub offset: u64,
    /// 시청자 싱크의 GUI 경로 번호(판 17 — GUI 가 `attach_viewer` 에 실어 보낸 것). 없으면 주 임대의 프레임.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<u64>,
}

/// ACK 몸 — 클라이언트가 화면에 반영한 오프셋(`consumed`). 옛 임대의 ACK 는 서버가 버린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ack {
    pub stream: String,
    pub session_epoch: u64,
    pub lease_epoch: u64,
    pub consumed: u64,
}

/// 파이프 위의 프레임 한 장.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub(crate) enum Frame {
    Request {
        id: u64,
        kind: Grade,
        op: String,
        #[serde(default)]
        body: Value,
    },
    Response {
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<WireError>,
    },
    Event {
        seq: u64,
        name: String,
        #[serde(default)]
        body: Value,
    },
    /// 클라이언트 → 서버: 소비 오프셋(크레딧). 응답이 없다.
    Ack(Ack),
    /// 서버 → 클라이언트: 세션 출력 — JSON 이 아니라 이진 프레임으로 오간다([`encode`]·[`decode`]).
    #[serde(skip)]
    Output { header: OutputHeader, bytes: Vec<u8> },
    /// 양방향: 채널 터널의 바이트(판 5). 0 바이트 = 그 방향의 끝. 이진 프레임.
    #[serde(skip)]
    Channel { chan: u64, bytes: Vec<u8> },
    /// 양방향: 채널 터널의 크레딧 — 받은 쪽이 소비한 누적 바이트(판 5). 응답이 없다.
    #[serde(rename = "chanack")]
    ChanAck { chan: u64, consumed: u64 },
}

impl Frame {
    pub(crate) fn ok(id: u64, body: Value) -> Frame {
        Frame::Response {
            id,
            ok: true,
            body: Some(body),
            error: None,
        }
    }

    pub(crate) fn err(id: u64, e: WireError) -> Frame {
        Frame::Response {
            id,
            ok: false,
            body: None,
            error: Some(e),
        }
    }
}

/// 이 조각의 op 표 — 이름 → 요구 등급. 모르면 `None`.
pub(crate) fn required_grade(op: &str) -> Option<Grade> {
    match op {
        "hello" | "ping" | "status" => Some(Grade::Read),
        "shutdown" => Some(Grade::Write),
        // 로컬 세션(③-2 — `server::sessions`). 목록·살피기·폴더·통계 = 읽기, 나머지(열기·쓰기·크기·닫기·붙기·떨어지기·
        // 체크포인트·이관·창 거둠·모두 종료) = 쓰기.
        "probe" | "local_cwd" | "stats" | "live_streams" | "sessions_detached" => Some(Grade::Read),
        "open" | "write" | "resize" | "close" | "attach" | "detach" | "checkpoint"
        | "restore_done" | "close_detached" | "session_ai_read" | "detach_window" | "close_window" | "adopt" | "set_home"
        | "close_all" => Some(Grade::Write),
        // 다중 시청자(판 17 — 원격 웹 R2-A). 붙기·떼기 = 쓰기(시청자의 쓰기·크기·ACK 는 예전 op 그대로).
        "attach_viewer" | "detach_viewer" => Some(Grade::Write),
        // 크기 되찾기(10-20 — 입력 없이 크기 주인이 된다 · 셸에 쓰지 않는다). 쓰기.
        "claim_size" => Some(Grade::Write),
        // SSH 평면(③-3b2 — `server::sessions`·`server::ssh_ops`). 연결 상태·로그 경로·포워드 목록 = 읽기, 열기·포워드 걸기/
        // 끊기·워크트리 답·헤드리스 열기/닫기·exec·채널 열기/닫기 · 연결 칩(5단계) = 쓰기. `ssh_exec` 는 원시 send_command 가 아니다(`ssh_ops`
        // 머리말 — 대상은 서버 표의 세션 id, 부르는 쪽은 GUI Rust 의 고정 조립 함수뿐, 프런트·MCP 에는 이 op 로 가는 길이 없다).
        "ssh_info" | "ssh_log_path" | "forward_list" | "ssh_alias" | "ssh_find" => Some(Grade::Read),
        "open_ssh" | "forward_add" | "forward_remove" | "worktree_answer" | "headless_open" | "headless_close"
        | "ssh_exec" | "ssh_exec_cancel" | "chan_open" | "chan_close" | "ssh_copy_id" => Some(Grade::Write),
        // 신호 평면(③-3a — `server::signals`). 상태 스냅숏 = 읽기, 상태 지우기 = 쓰기. 토큰 op 넷은 ③-3b2 에서 지웠다(토큰이
        // 파이프를 타지 않는다).
        "agent_states_snapshot" | "agent_conversation_links" => Some(Grade::Read),
        // 띄우며 적은 연결(`agent_conversation_launched` — 장부에 id 만 적는다)도 쓰기.
        // 대화 면 [중지]의 상태 풀기(`agent_state_interrupt` — 실행 · 권한 대기일 때만 `interrupt` 하나)도 쓰기.
        // 완료 확인 공유(`agent_state_seen`)도 쓰기 — 표는 바꾸지 않고 방송만 한다.
        "agent_state_forget" | "agent_state_interrupt" | "agent_state_seen" | "agent_conversation_launched" => Some(Grade::Write),
        // 볼트 평면(③-3b1 — `server::vault_ops`). 상태·목록·있나 = 읽기, 나머지(만들기·열기·잠그기·마스터·담기·지우기·정리·
        // MCP 실행 준비·티켓 회수) = 쓰기. **값을 돌려주는 op 는 없다**(③-3b2 에서 과도기 op 삭제).
        "vault_status" | "vault_list" | "vault_has" => Some(Grade::Read),
        "vault_create" | "vault_unlock" | "vault_verify_master" | "vault_lock" | "vault_set_master" | "vault_store" | "vault_delete"
        | "vault_delete_all" | "vault_prune" | "mcp_prepare" | "mcp_retain" => {
            Some(Grade::Write)
        }
        // AI 평면(③-3c — `server::ai`). MCP 좌표·토큰·활동 도장·관제판 세션 목록·작업안 목록/결과·감사 상태·실행 설정 파일
        // 주장 목록 = 읽기. 거울 묶음·거절·대상 수정·취소 요청·실행 설정 파일 주장 = 쓰기. **승인은 `ops_approve` 하나**.
        // `mcp_token` 은 `mcp.json` 에 이미 평문인 앱 소유 값이다(결정 6). `mcp_tile_token`(3차 4단계)은 로컬 AI 타일 하나의 토큰 — GUI Rust 가
        // 그 타일의 `--mcp-config` 에만 쓴다(프런트 명령 없음).
        // `mcp_tools` · `mcp_calls`(10-19 — 설정 화면의 도구 목록 · 최근 호출, 비밀 없음).
        "mcp_coords" | "mcp_token" | "mcp_tile_token" | "mcp_activity" | "mcp_tools" | "mcp_calls" | "console_sessions" | "ops_list"
        | "ops_results" | "audit_status" | "agent_mcp_claims" => Some(Grade::Read),
        "ctx_batch" | "ops_reject" | "ops_modify_targets" | "ops_cancel" | "agent_mcp_claim" | "ops_reviewing"
        | "ops_unseen_take" => Some(Grade::Write),
        "ops_approve" => Some(Grade::Approve),
        // 오케스트레이션(2026-10-14 — `crate::orchestration::ops`). 요약·상세 = 읽기, 일시정지·재개·중단·Task 상태 = 쓰기.
        // 승인 등급 op 는 없다. 3단계: 작업자 [중단] · worktree 지우기(쓰기). 4단계: 사람의 수락 · 반려(쓰기) · 보고 뒤 변경(읽기).
        // (3차 6단계) 사람의 Run 시작 · [이어 가기] · 시작 미리 보기 · 조정자 타일 묶기(`_active_gen` · `_bind_coordinator`) · worktree 만들기 ·
        // 목록 op 는 걷었다 · (2단계 단계 6 뒤) 사람의 [이 타일의 MCP 거두기](`orchestration_revoke_tile`)도 걷었다 — 등급 표에도 없다(시험 `orchestration_ops_all_have_grades` 가 `ops::is_op` 와 맞춘다).
        "orchestration_snapshot" | "orchestration_run" => Some(Grade::Read),
        "orchestration_report_drift" => Some(Grade::Read),
        "orchestration_pause" | "orchestration_resume" | "orchestration_stop" | "orchestration_set_task_state"
        | "orchestration_stop_worker"
        | "orchestration_wt_remove" => Some(Grade::Write),
        // 앨범 보관함(판 26 — `orchestration/store/archive.rs`): 목록 = 읽기, 보관 · 복원 · 영구 삭제 = 사람의 쓰기.
        "orchestration_archive_list" => Some(Grade::Read),
        "orchestration_archive" | "orchestration_restore" | "orchestration_delete_archived" => Some(Grade::Write),
        // 3차 5단계 Q3: AI 가 연 · 이어받은 앨범의 탭 배치 장부(그 세대에 한 번 — 서버 장부를 바꾸므로 쓰기).
        "orchestration_review_task" => Some(Grade::Write),
        // 6단계: 보드 최근 활동 · [기록 보기](읽기 — 그 Attempt 의 고정 대화 파일만).
        "orchestration_worker_activity" | "orchestration_worker_transcript" => Some(Grade::Read),
        // 리뷰 F11: 감독 사건 미확인 목록(읽기) · 확인(쓰기 — 큐에서 뺀다).
        "orchestration_notices" => Some(Grade::Read),
        "orchestration_notices_ack" => Some(Grade::Write),
        // 통합 설계 2단계(10-15): [Run 완료] · 보류 해제 · 통합 [취소] — 모두 사람의 쓰기.
        "orchestration_complete_run" | "orchestration_release_hold" | "orchestration_cancel_integration" => Some(Grade::Write),
        "orchestration_report_files" => Some(Grade::Read),
        // 통합 설계 3단계(10-15): [조정] 재료(읽기) · [조정] · [브랜치로 내보내기](사람의 쓰기).
        "orchestration_reconcile_preview" => Some(Grade::Read),
        "orchestration_reconcile" | "orchestration_export" => Some(Grade::Write),
        // 앨범 병합(판 27 — `orchestration/album_merge.rs`): 검사 = 읽기, [병합] = 사람의 쓰기(승인 등급 프레임이 아니다 — 작업안 승인과 다른 길).
        "orchestration_merge_preview" => Some(Grade::Read),
        "orchestration_merge" => Some(Grade::Write),
        // 통합 설계 4단계(10-16): [검증 실행] · [검증 실패인데 수락] — 사람의 쓰기(승인 등급 프레임이 아니다 — 작업안 승인과 다른 길).
        "orchestration_approve_verify" | "orchestration_override_verify" => Some(Grade::Write),
        // 통합 설계 6단계(10-16): [정리] 재료(읽기) · [정리] · 남긴 서버 임시 자리 [그래도 지우기](사람의 쓰기).
        "orchestration_cleanup_preview" => Some(Grade::Read),
        "orchestration_cleanup" | "orchestration_discard_temp" => Some(Grade::Write),
        // DB 평면(판 8 — `server::db_ops`). 스키마·객체·컬럼 목록 = 읽기, 열기·쿼리(읽기 전용 모드여도 사람이 친 글자를 엔진에
        // 넣는다)·취소·쓰기 전환·닫기 = 쓰기.
        "db_schema" | "db_objects" | "db_table_detail" | "db_definition" => Some(Grade::Read),
        "db_open" | "db_test" | "db_query" | "db_cancel" | "db_set_write" | "db_close" | "db_tx" | "db_script" => Some(Grade::Write),
        // 자원 모니터(판 18 — `server::resources`). 표본 읽기 = 읽기(관찰 임대를 갱신하지만 세션 · 파일 · 권한은 바꾸지 않는다).
        "resource_snapshot" => Some(Grade::Read),
        // 사이드 채팅(판 19 — `server::side_chat`). 스냅숏(다시 붙기) · 목록 = 읽기, 열기 · 보내기 · 끊기 · 모델 · 강도 · 사람의 권한 결정 · 닫기 = 쓰기
        // (권한 결정도 승인 등급 프레임이 아니다 — 작업안 승인과 다른 길 · 설계 0절).
        "side_chat_attach" | "side_chat_list" => Some(Grade::Read),
        "side_chat_open" | "side_chat_send" | "side_chat_interrupt" | "side_chat_set_model" | "side_chat_set_effort"
        | "side_chat_decide" | "side_chat_close" | "side_chat_link" => Some(Grade::Write),
        // 완료 확인 공유(판 31)도 쓰기 — `agent_state_seen` 과 같이 표는 바꾸지 않고 방송만 한다.
        "side_chat_seen" => Some(Grade::Write),
        // 프로듀서 채팅(판 20 — `server::producer`). 스냅숏 · 상태 · 목록 = 읽기, 나머지 = 쓰기(사람의 결정도 승인 등급 프레임이 아니다).
        "producer_chat_attach" | "producer_chat_status" | "producer_chat_list" | "producer_fork_probe" | "orchestration_album_defaults" => Some(Grade::Read),
        "orchestration_album_widen" | "orchestration_album_set" | "orchestration_rename_album" => Some(Grade::Write),
        "producer_album_start" | "orchestration_artist_remove" => Some(Grade::Write),
        "producer_chat_open" | "producer_chat_send" | "producer_chat_interrupt" | "producer_chat_set_model" | "producer_chat_set_effort"
        | "producer_chat_decide" | "producer_chat_queue_cancel" | "producer_chat_close" | "producer_chat_subscribe"
        | "producer_chat_unsubscribe" => Some(Grade::Write),
        // 타일 권한 카드(판 22 — `server::tile_permission`). 스냅숏 = 읽기, 사람의 결정 = 쓰기(**승인 등급 프레임이 아니다** — 작업안 승인과 다른 길 ·
        // CLI 훅의 응답으로만 가고 PTY 에 쓰지 않는다).
        "tile_permission_snapshot" => Some(Grade::Read),
        "tile_permission_decide" | "tile_permission_face" => Some(Grade::Write),
        _ => None,
    }
}

/// hello 없이도 받는 op — 모양이 판에 무관하다(머리말).
pub(crate) fn version_free(op: &str) -> bool {
    matches!(op, "hello" | "shutdown")
}

/// 요청 하나가 등급 검사를 지나는가 — 실패면 돌려줄 오류. 승인 등급은 승인 op(`ops_approve`)에만 통한다.
pub(crate) fn check_grade(op: &str, kind: Grade) -> Result<(), WireError> {
    if kind == Grade::Approve && required_grade(op) != Some(Grade::Approve) {
        return Err(WireError::new(
            code::APPROVE_REFUSED,
            "approve frames are accepted only for ops_approve",
        ));
    }
    match required_grade(op) {
        None => Err(WireError::new(code::UNKNOWN_OP, format!("unknown op: {op}"))),
        Some(g) if g != kind => Err(WireError::new(
            code::GRADE_MISMATCH,
            format!("op {op} requires {g:?}, got {kind:?}"),
        )),
        Some(_) => Ok(()),
    }
}

/// `hello` 요청 몸.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Hello {
    pub protocol: ProtocolRange,
    pub app_version: String,
    pub client: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
}

/// `hello` 응답 몸.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Welcome {
    /// 협상된 판.
    pub protocol: u32,
    pub server_pid: u32,
    pub app_version: String,
    pub started_at_ms: u64,
    pub launch_mode: String,
    /// 신호 평면 포트(③-3a — `server::signal_http`, 127.0.0.1) — 못 띄웠으면 `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal_port: Option<u16>,
}

/// 프레임을 바이트로 — 길이 접두 포함. 출력 프레임은 이진(머리 JSON + 바이트 그대로).
pub(crate) fn encode(frame: &Frame) -> std::io::Result<Vec<u8>> {
    if let Frame::Channel { chan, bytes } = frame {
        let n = 1 + 8 + bytes.len();
        if n > MAX_FRAME {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut buf = Vec::with_capacity(4 + n);
        buf.extend_from_slice(&(n as u32).to_le_bytes());
        buf.push(CHANNEL_TAG);
        buf.extend_from_slice(&chan.to_le_bytes());
        buf.extend_from_slice(bytes);
        return Ok(buf);
    }
    if let Frame::Output { header, bytes } = frame {
        let head = serde_json::to_vec(header).map_err(std::io::Error::other)?;
        let n = 1 + 4 + head.len() + bytes.len();
        if n > MAX_FRAME {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut buf = Vec::with_capacity(4 + n);
        buf.extend_from_slice(&(n as u32).to_le_bytes());
        buf.push(OUTPUT_TAG);
        buf.extend_from_slice(&(head.len() as u32).to_le_bytes());
        buf.extend_from_slice(&head);
        buf.extend_from_slice(bytes);
        return Ok(buf);
    }
    let body = serde_json::to_vec(frame).map_err(std::io::Error::other)?;
    if body.len() > MAX_FRAME {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut buf = Vec::with_capacity(4 + body.len());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    Ok(buf)
}

/// 바이트(길이 접두 뒤의 몸)를 프레임으로.
pub(crate) fn decode(body: &[u8]) -> std::io::Result<Frame> {
    if body.first() == Some(&CHANNEL_TAG) {
        if body.len() < 9 {
            return Err(std::io::Error::other("short channel frame"));
        }
        let mut id = [0u8; 8];
        id.copy_from_slice(&body[1..9]);
        return Ok(Frame::Channel {
            chan: u64::from_le_bytes(id),
            bytes: body[9..].to_vec(),
        });
    }
    if body.first() == Some(&OUTPUT_TAG) {
        let rest = &body[1..];
        if rest.len() < 4 {
            return Err(std::io::Error::other("short output frame"));
        }
        let hl = u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
        let rest = &rest[4..];
        if hl > rest.len() {
            return Err(std::io::Error::other("bad output header length"));
        }
        let header: OutputHeader = serde_json::from_slice(&rest[..hl]).map_err(std::io::Error::other)?;
        return Ok(Frame::Output { header, bytes: rest[hl..].to_vec() });
    }
    serde_json::from_slice(body).map_err(std::io::Error::other)
}

pub(crate) async fn write_frame<W: AsyncWrite + Unpin>(w: &mut W, frame: &Frame) -> std::io::Result<()> {
    let buf = encode(frame)?;
    w.write_all(&buf).await?;
    w.flush().await
}

/// 프레임 한 장을 읽는다. 깨끗한 EOF(길이 앞에서 끊김)는 `Ok(None)`.
pub(crate) async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<Frame>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(len) as usize;
    if n > MAX_FRAME {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut body = vec![0u8; n];
    r.read_exact(&mut body).await?;
    decode(&body).map(Some)
}

//! MCP 서버 — 실행 중인 앱을 **읽기 전용 MCP 서버**로 열어 세션 컨텍스트를 내준다.
//!
//! **③-3c 부터 세션 서버 프로세스에서 돈다**(`crate::server::ai` — 신호 평면과 같은 127.0.0.1 리스너의 `/mcp` 갈래, 요청마다
//! 스레드 하나는 `crate::loopback_http`). `mcp.json`(포트·토큰)의 주인도 서버고 토큰은 서버가 뜰 때마다 새로 뽑는다 — 아래
//! "포트·토큰 지속" 절은 옛 이야기다(포트를 지속하지 않는다). GUI 가 꺼져도 AI 타일의 CLI 가 같은 주소로 읽는다.
//!
//! 설계안대로 앱에 AI 를 내장하지 않는다. 대신 로컬의 CLI 에이전트(Claude Code·Codex 등)가
//! 표준 프로토콜로 물어볼 수 있게 [`crate::context`] 저장소를 HTTP 로 서빙한다. 두뇌·키·과금은
//! 전부 에이전트 소유고, 우리는 어차피 갖고 있는 데이터를 내주기만 한다.
//!
//! 서버는 표준(HTTP+Bearer) 하나이며 aynx이 띄우는 로컬 AI 타일에만 실행 설정으로 싣는다
//! ([`crate::agent_mcp`]). CLI 전역 등록은 만들지 않고 시작 때 이전 등록만 해제한다.
//!
//! ## 왜 손수 짠 Streamable-HTTP 인가 (프레임워크 대신)
//!
//! 우리가 필요한 MCP 표면은 아주 작고 **상태가 없다** — 전역 토큰의 도구 13개(읽기·계획 — 실행 없음) + DB 권한이 있을 때 DB 도구
//! 최대 7개(구조 · 읽기 조회 · 쓰기 작업안 초안 — 쿼리 타일 3a · 3b)와 오케스트레이션 역할 토큰의 조율 도구(조정자 `get_run`·
//! `create_task`·`update_task`·`wait_run` · 작업자 `get_task`·`report_done` — `crate::orchestration`), 세션도 구독도
//! 없다. 무거운 async MCP 프레임워크를 들이면 Tauri 의 tokio 런타임과 얽히고 의존성만 불어난다.
//! 그래서 [`tiny_http`] 로 **블로킹 서버를 별도 `std::thread`** 에서 돌린다 — 런타임과 완전히
//! 분리돼 SSH 펌프·keepalive 를 굶길 일이 없다(세션 로깅 스레드와 같은 격리 원칙).
//!
//! ## 요청 하나에 스레드 하나 (2026-09-22)
//!
//! 처음에는 그 스레드 **하나**가 요청을 순서대로 처리했다 — 도구가 전부 즉답이었으니 충분했다.
//! [`wait_for_operation`](롱폴, 한 번에 최대 120초)이 생기면서 그 줄이 막힌다: 대기 한 번이
//! 뒤에 선 `list_sessions` 까지 세운다. 그래서 tiny_http 가 문서에 적어 둔 방식 그대로
//! **요청마다 스레드 하나**를 띄운다([`serve`]). 대기 도구만 따로 스레드로 빼지 않은 이유는
//! 그럴 필요가 없기 때문이다 — 공유 상태는 이미 전부 `Arc<Mutex<..>>` 고([`Store`](crate::context::Store) ·
//! [`OperationStore`](crate::operations::OperationStore) · [`ResultStore`](crate::operations::ResultStore) · [`McpSignal`] · `last_seen` 도장), 토큰·포트는
//! 불변이며, 락 순서(컨텍스트→작업안→우편함)는 **한 요청 안의 순서**라 스레드가 여럿이어도
//! 같은 순서로 잡힌다. 갈래를 둘로 두는 쪽이 오히려 "이 길로 온 요청만 다르다" 는 함정을 만든다.
//!
//! **단, 대기 도구는 컨텍스트 잠금을 아예 잡지 않는다**([`tools_call`](rpc::tools_call) 이 잠그기 **전에**
//! 갈라낸다). 잡은 채로 자면 스레드를 나눈 의미가 없다 — 거울 갱신(`context::report`)까지
//! 최대 120초 멈춘다.
//!
//! ## 왜 stdio 가 아니라 localhost HTTP 인가
//!
//! stdio 전송은 에이전트가 **서버 프로세스를 새로 스폰**하는 구조라, 이미 떠 있는 앱의 세션
//! 데이터에 닿지 못한다. 떠 있는 앱 프로세스가 직접 서빙하는 HTTP 라야 라이브 컨텍스트가 나온다.
//!
//! ## 잠금과 프라이버시
//!
//! - **127.0.0.1 바인딩만** — 절대 0.0.0.0 이 아니다. 다른 기기에서 접근 불가.
//! - **모든 요청에 `Authorization: Bearer <token>` 필수** — 없거나 틀리면 401. 같은 기기의
//!   다른 로컬 프로세스가 세션 내용을 긁어가지 못하게 한다.
//! - 도구는 저장소에서 **AI 가 읽을 수 있는 세션만** 본다([`crate::context::ai_readable`] — 원격은 호스트의
//!   AI 권한(`delegation.toml`), 로컬은 타일의 "AI 읽기 허용"). 작업안 대상은 원격 호스트 중 'Ask' 이상뿐이다.
//!
//! ## 포트·토큰 지속 (`~/.aynx/mcp.json`)
//!
//! `{port, token}`을 앱 소유 `~/.aynx/mcp.json`에 저장하고 재시작 때 같은 포트로 바인딩한다.
//! CLI 사용자 설정에는 토큰을 쓰지 않는다. 실행 시 지금 서버 좌표를 읽는다.
//!
//! 시작할 때 포트를 정하는 규칙은 이렇다(자세한 것은 [`bind_saved`]):
//!
//! 1. 저장된 포트가 있으면 **그 포트에 먼저** 평범하게 바인딩한다.
//! 2. 실패하면 그 포트에 **정말 누가 듣고 있는지** 확인한다(127.0.0.1 로 connect).
//!    - 듣고 있다 → 남의 포트다. 3번으로.
//!    - 거절당한다(아무도 안 듣는다) → 방금 종료한 우리 자신이 남긴 `TIME_WAIT` 잔재다.
//!      Windows 는 이 잔재만으로도 bind 를 거절하므로 `SO_REUSEADDR` 로 한 번 더 시도한다.
//!      (재사용 플래그는 **아무도 듣지 않을 때만** 쓴다 — 남의 리스너를 가로채지 않게.)
//! 3. 그래도 안 되면 OS 가 주는 임시 포트로 바인딩하고 `mcp.json` 을 갱신한다.
//!
//! 토큰은 한 번 만들면 유지한다. 포트가 바뀌어도 다음 실행 설정은 지금 포트를 쓴다.
//!
//! ## 이전 CLI 전역 등록 해제
//!
//! 시작 직후 블로킹 풀에서 이 인스턴스의 현재·옛 이름만 걷는다
//! ([`spawn_unregister_migration`]). Claude 사용자 범위·Codex config.toml에 항목이 있을 때만
//! 해제하며 다른 인스턴스·다른 서버는 그대로다. 결과는 기존 우편함으로 한 번 알린다.
//!
//! ## 프로토콜 버전
//!
//! `initialize` 응답의 `protocolVersion` 은 **`"2024-11-05"`** 를 쓴다. MCP 최초 안정 버전이자
//! Claude Code 가 협상에서 받아들이는 값이다. 우리 표면(도구 나열/호출)은 이후 개정에서도
//! 그대로라 최신 버전으로 올릴 이유가 없다.
//!
//! ## 불변식 (CLAUDE.md "보안 제약")
//!
//! - 원시 `send_command`(AI 문자열 → PTY)는 만들지 않는다. 작업안은 **적고 검토를 요청**할 뿐이다.
//! - 토큰 = 역할(2026-10-14 설계 C-1): 전역 토큰은 13개 그대로, 조정자 토큰(Run 세대마다)은 13개 + 자기 Run 의 조율 도구,
//!   작업자 토큰(Attempt 마다 — 3단계)은 자기 Task 만. 역할은 서버 표에서만 읽는다(`http.rs`). **역할 토큰은 같은 계정 안의
//!   보안 경계가 아니다**(작업자는 같은 사용자 권한으로 돈다 — 방어선은 작업자 권한 모드 + 사람 감독).
//! - 승인·거절·취소는 `crate::operations` 의 Tauri 명령뿐 — 이 서버에는 그 길이 없다(AI 는 자가 승인 못 한다).
//! - 위임(`crate::delegation`)을 고치는 도구도 없다 — 편집은 호스트 폼 · DB 연결 폼뿐 (docs/log/2026-09-21-fleet-delegation-ui.md).
//! - DB 도구는 연결마다 사람이 준 AI 권한(`delegation.toml` `[[database]]`) 안에서만 보이고, `crate::db::ai` 의 **AI 전용 읽기 전용
//!   연결**로만 읽는다(쓰기 도구 없음 — 쿼리 타일 3a · docs/log/2026-10-13-db-write-mcp-design.md).
//! - 원격 타일에는 이 서버의 토큰을 주지 않는다 — `/agent-signal` 신호 전용 토큰은 `crate::agent_signal`.
//! - 각 불변식이 **실제로 지켜지는 자리**는 아래 자식 파일의 머리말에 다시 적혀 있다
//!   (`send_command`·승인·위임 쓰기 없음 → `rpc.rs`·`schema.rs`·`plan.rs` · 상수시간 토큰 비교·신호 전용 토큰 → `http.rs`).
//!
//! ## 자식 모듈 (역할별 — 다른 모듈은 아래 재수출로 `crate::mcp::X` 를 그대로 쓴다)
//!
//! **도구 하나를 더하거나 고치려면**: 스키마 `schema.rs` · 갈래 `rpc.rs` `tools_call` · 구현(아래 도구 파일 중 하나).
//!
//! | 파일 | 맡는 것 |
//! |---|---|
//! | `mcp/state.rs` | `McpState`·`McpSignal`(창 깨우기)·`McpActivity`, `mcp_activity` 명령 |
//! | `mcp/server.rs` | `~/.aynx/mcp.json` 포트·토큰 지속, 재바인딩, `start` |
//! | `mcp/http.rs` | 요청마다 스레드·문지기(경로·출처·메서드·Bearer — 전역 또는 역할 토큰 → 호출자·본문 상한) |
//! | `mcp/rpc.rs` | JSON-RPC `dispatch`(호출자별)·활동 도장·`tools_call`(도구 이름 → 구현 · 역할 도구는 `crate::orchestration`)·봉투 |
//! | `mcp/schema.rs` | `initialize` 결과·`INSTRUCTIONS`·`tools_list_result`(전역 13개)·`tools_list_for`(역할별) |
//! | `mcp/sessions.rs` | 옵트인 게이트 `shared_entry`·읽기 모드·`list_sessions`/`list_console_sessions`·`get_last_command`·`get_scrollback` |
//! | `mcp/blocks.rs` | `list_commands`·`get_command`·`get_session_snapshot`·`compare_command_results` |
//! | `mcp/plan.rs` | 작업안 도구 `create_execution_plan`·`request_execution`·`get_operation`(실행 없음) |
//! | `mcp/plan_read.rs` | `wait_for_operation`·`get_operation_results`·`get_auto_approval_policy`(읽기 전용) |
//! | `mcp/cli.rs` | AI CLI 설치 감지·해제 배선(`ADAPTERS`)·서버 상태 모양·`list_ai_clis` |
//! | `mcp/db.rs` | DB 도구(쿼리 타일 3a · 3b) — `list_db_connections`·구조 넷·`db_query`(읽기 전용)·`create_db_write_plan`(작업안 초안 — 실행 없음) · 연결마다 AI 권한 판정 · 감사 `db_read` · DB 평면은 `crate::db::ai`(+ 사전 검증 `ai_plan`)로만 |
//! | `mcp/register.rs` | `mcp_status`·전역 등록 해제 이관·`take_mcp_notice` |
//! | `mcp/insight.rs` | 설정 화면의 들여다보기 — 도구 목록(`tools/list` 의 스키마 함수에서) · 최근 도구 호출 고리(이름 · 시각 · 호출자 종류 · 결과만) |
//!
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `mcp::register::mcp_status` 처럼 정의 경로를 쓴다.

mod blocks;
mod chat_read;
pub(crate) mod cli;
pub(crate) mod db;
mod http;
pub(crate) mod insight;
mod plan;
mod plan_read;
pub(crate) mod register;
mod rpc;
mod schema;
mod server;
pub(crate) mod sessions;
pub(crate) mod state;

use blocks::*;
pub(crate) use db::DbEnv;
pub(crate) use cli::*;
pub(crate) use http::*;
use plan::*;
pub(crate) use plan_read::*;
pub(crate) use register::*;
pub(crate) use rpc::*;
use schema::*;
pub(crate) use server::*;
pub(crate) use sessions::*;
pub(crate) use state::*;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_chat;

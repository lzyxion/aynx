//! 읽기·계획 MCP 서버 — 세션 서버(`crate::server::ai`)의 127.0.0.1 리스너 `/mcp` 갈래로 세션 컨텍스트를 내준다. 앱에 AI 를 내장하지 않는다.
//!
//! - async MCP 프레임워크 · stdio 전송은 쓰지 않는다 — 프레임워크는 tokio 런타임과 얽히고, stdio 는 떠 있는 앱의 세션 데이터에 닿지 못한다.
//! - 대기 도구(`wait_for_operation`)는 컨텍스트 잠금을 잡지 않는다 — 잡은 채 자면 거울 갱신(`context::report`)까지 최대 120초 멈춘다.
//!   락 순서는 컨텍스트 → 작업안 → 우편함.
//! - Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `mcp::register::mcp_status` 처럼 정의 경로를 쓴다.
//! - `mcp/state.rs` = GUI 우편함 `McpState` · 서버 `McpSignal` · `mcp/server.rs` = `mcp.json` 쓰기(주인은 세션 서버).
//!
//! ## 불변식 (AGENTS.md "보안 제약" — docs/invariants.md 전문 1 · 4 · 9 · 11)
//!
//! - CLI 전역 등록은 만들지 않는다 — 로컬 AI 타일 · 감싸개 셸 타일에만 실행 설정으로 싣고([`crate::agent_mcp`]), 시작 때 이 인스턴스의 이전 등록만 걷는다.
//! - 127.0.0.1 바인딩만 · 모든 요청에 Bearer 필수(`http.rs`).
//! - 도구는 AI 가 읽을 수 있는 세션만 본다([`crate::context::ai_readable`] — 원격은 호스트 AI 권한, 로컬은 타일의 "AI 읽기 허용"). 작업안 대상은 원격 호스트 중 'Ask' 이상뿐이다.
//! - 원시 `send_command`(AI 문자열 → PTY)는 만들지 않는다. 작업안은 **적고 검토를 요청**할 뿐이다.
//! - 역할은 서버 표에서만 읽는다(`http.rs`). **역할 토큰은 같은 계정 안의 보안 경계가 아니다** — 방어선은 작업자 권한 모드 + 사람 감독.
//! - 승인·거절·취소는 `crate::operations` 의 Tauri 명령뿐 — 이 서버에는 그 길이 없다(AI 는 자가 승인 못 한다).
//! - 위임(`crate::delegation`)을 고치는 도구도 없다 — 편집은 Tauri 명령뿐이다 (docs/log/2026-09-21-fleet-delegation-ui.md).
//! - DB 도구는 연결마다 사람이 준 AI 권한(`delegation.toml` `[[database]]`) 안에서만 보이고, `crate::db::ai` 의 **AI 전용 읽기 전용
//!   연결**로만 읽는다 — 쓰기는 작업안 초안(`create_db_write_plan`)뿐이다.
//! - 원격 타일에는 이 서버의 토큰을 주지 않는다 — `/agent-signal` 신호 전용 토큰은 `crate::agent_signal`.

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

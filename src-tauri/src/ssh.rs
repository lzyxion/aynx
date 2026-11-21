//! russh 기반 SSH 세션.
//!
//! 불변식:
//! - 비밀번호·키 암호구는 볼트(`crate::vault`)에만 — 볼트를 켜지 않았으면 한 번 쓰고 버린다
//!   (docs/log/2026-09-19-vault.md · docs/log/2026-09-19-identity-file-auth.md).
//! - 원격 타일에는 MCP 토큰을 주지 않는다 — 스트림별 신호 전용 토큰만 `-R` 로(→ docs/invariants.md 전문 11).
//! - 헤드리스 위임 접속은 [`crate::headless`] 가 맡는다 — 에이전트 포워딩이 없다. `ssh` 는 `headless` 를 부르지 않는다.
//! - 호스트 키 Changed 는 거부다 — accept-new 로도 안 뚫린다.
//! - 같은 호스트의 타일은 전송로 하나를 나눠 쓴다 — 전송로는 **마지막 사용자만** 끊는다([`unpin_shared`]).
//!
//! 현재 위층을 부름: [`open`] 이 접속 앞뒤로 기능 모듈을 직접 조립한다.
//!
//! 자식: `error`(`SshOpenError`·실패 분류·`HostKeyDecision`) · `params`(별칭/빠른 접속 → `ConnectParams`) ·
//! `handler`(호스트 키 콜백·`ExitSignal`) · `remote_cmd`(첫 입력 글자) · `session` · `auth` · `connect` · `open` · `exec` · `commands`.
//!
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `ssh::session::write_ssh` 처럼 정의 경로를 쓴다.

mod auth;
pub(crate) mod commands;
mod connect;
mod error;
mod exec;
mod handler;
pub(crate) mod open;
mod params;
mod remote_cmd;
pub(crate) mod session;

pub(crate) use auth::*;
pub(crate) use commands::*;
pub(crate) use connect::*;
pub(crate) use error::*;
pub(crate) use exec::*;
pub(crate) use handler::*;
pub(crate) use params::*;
pub(crate) use remote_cmd::*;
pub(crate) use session::*;

#[cfg(test)]
mod tests;

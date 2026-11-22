//! 작업안 저장소 + 실행 브로커 — AI(MCP)가 적은 계획을 사람이 앱에서 승인하면 SSH exec 로 돌려 대상별 결과를 모은다.
//! 저장소·결과·실행기·만료·감사 · 사전 정책 자동 승인의 시계(`auto::sweep`)는 세션 서버에 산다(`approval::OpsPlane`) — GUI 에는 같은 이름의 Tauri 명령 껍데기만 남는다.
//!
//! ## 불변식 — AI(MCP)는 실행 경로에 닿지 못한다 (AGENTS.md "보안 제약" — docs/invariants.md 전문 4)
//!
//! - **승인·취소는 Tauri 명령([`approve_operation`](approval::approve_operation)·[`cancel_operation`](approval::cancel_operation))뿐, MCP 에 없다.**
//!   승인 등급 프레임(`ops_approve`)을 만드는 곳은 `approval::approve_operation` 하나다. 자동 승인은 서버 안 함수 호출 `approve_in(method: auto)` 이다(파이프 프레임 아님).
//! - **원시 `send_command` 는 없다** — executor 는 저장된 작업안을 `operation_id` 로 읽을 뿐, 승인에 명령 문자열을 다시 받지 않는다(AI 재주입 차단).
//! - 실행은 [`crate::ssh::run_exec`] 의 exec 채널(PTY 미요청)로 나간다 — 사용자의 대화형 셸을 오염시키지 않는다.
//! - 승인 진입은 [`approval_reject_reason`] 이 게이트하고, 모든 승인·실행·거절·취소는 [`crate::audit`] 로 기록된다. 실행은 값과 무관하게 항상 순차 canary.
//! - 두 잠금을 함께 잡을 때의 순서는 **언제나 컨텍스트 먼저, 작업안 나중**이다(교착 방지).
//! - 작업안·결과는 **메모리 전용**이다(보존 한도 [`FINISHED_RETENTION`]) — 파일에는 감사 로그만 남는다.
//!
//! 자식: `model` · `analysis`(승인 요약의 앱 분석) · `store` · `expiry` · `lifecycle` · `gate` · `results` · `classification` · `audit_hook` · `events` ·
//! `target` · `executor` · `commands` · `approval`(승인·취소 Tauri 명령 · `OpsPlane`) · `auto`(자동 승인의 시계) · `notify` · `db_exec`(DB 작업안 실행).
//! Tauri 명령은 재수출로 등록되지 않는다 — `lib.rs` 는 `operations::approval::approve_operation` 처럼 정의 경로를 쓴다.

pub(crate) mod analysis;
pub(crate) mod approval;
pub(crate) mod auto;
mod audit_hook;
mod classification;
pub(crate) mod commands;
pub(crate) mod db_exec;
mod events;
mod executor;
mod expiry;
mod gate;
mod lifecycle;
mod model;
pub(crate) mod notify;
mod results;
mod store;
mod target;

pub(crate) use analysis::{Computed, Effect};
use audit_hook::*;
use classification::*;
pub(crate) use events::*;
pub(crate) use executor::*;
pub(crate) use expiry::*;
pub(crate) use gate::*;
use lifecycle::*;
pub(crate) use model::*;
pub(crate) use results::*;
pub(crate) use store::*;
use target::*;

// tests.rs 는 `use super::*` 로 부모 스코프의 std 이름을 본다.
#[cfg(test)]
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::sync::{Arc, Mutex};

#[cfg(test)]
mod tests;

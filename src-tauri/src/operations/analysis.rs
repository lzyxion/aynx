//! 승인 요약의 앱 분석(docs/log/2026-10-21-approval-summary.md) — 작업안 원문(셸 명령 · DB 문장)만 보고 결정적으로 매기는 효과와 그 근거.
//! AI 가 적은 글(`summary` · 선언 `effect`)은 **한 글자도 보지 않는다** — 그래서 둘을 견줄 수 있다([`mismatch`]).
//!
//! - **순수**다 — 셸 · 세션 · 저장소에 닿지 않는다. 실행을 막는 경계도 아니다(경계는 사람의 승인 · 게이트).
//! - **보수적**이다 — 표에 없는 프로그램 · 치환 · 해석 못 한 따옴표 · 구분 줄 없는 heredoc 은 [`Computed::Unknown`](비교에서는 쓰기와 같은 무게).
//!   오탐(괜히 붉음)이 미탐(삭제를 읽기로)보다 낫다. 표를 늘릴 때는 시험을 함께 늘린다.
//! - 자동 승인 분해기(`policy::split_segments`)는 쓰지 않는다 — 파이프 · 리다이렉트 · 치환을 거절하도록 만든 것이라 흔한 읽기 명령을 나누지 못한다.
//!   자동 승인 거부 사유는 여기서 다시 만들지 않는다(카드는 서버의 `autoRefusals` 를 그대로 보인다).

mod command;
mod command_lines;
mod shell_effect;
mod shell_lex;
mod sql;
mod summary;
mod types;

pub use types::{Computed, Effect, PlanAnalysis};
pub(crate) use command::analyze_plan;
pub(crate) use sql::analyze_db;
pub(crate) use summary::{clean_summary, SUMMARY_MAX_CHARS};
pub(crate) use types::mismatch;

#[cfg(test)]
use super::DbPlanStmt;
#[cfg(test)]
use command::analyze_command;
#[cfg(test)]
use command_lines::command_lines;
#[cfg(test)]
use types::{CmdLine, LineMark};

#[cfg(test)]
mod tests;
